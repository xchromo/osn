import { createSignal, createMemo, Show, onCleanup, createEffect } from "solid-js";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useAuth } from "@osn/client/solid";
import { createRegistrationClient, type RegistrationClient } from "@osn/client";
import { toast } from "solid-toast";
import { OSN_ISSUER_URL, OSN_CLIENT_ID } from "../lib/auth";

type Step = "details" | "verify" | "passkey" | "done";

const HANDLE_RE = /^[a-z0-9_]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterProps {
  onCancel: () => void;
}

export function Register(props: RegisterProps) {
  const { adoptSession } = useAuth();
  const client: RegistrationClient = createRegistrationClient({
    issuerUrl: OSN_ISSUER_URL,
    clientId: OSN_CLIENT_ID,
  });

  const [step, setStep] = createSignal<Step>("details");
  const [email, setEmail] = createSignal("");
  const [handle, setHandle] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [otp, setOtp] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [userId, setUserId] = createSignal<string | null>(null);
  const [authCode, setAuthCode] = createSignal<string | null>(null);

  // WebAuthn feature detection. On native Tauri the system webview may not
  // expose a platform authenticator, in which case we skip step 3 entirely and
  // finish sign-in with just the verified email. Users can add a passkey later
  // from account settings once we ship that screen.
  const passkeySupported = browserSupportsWebAuthn();

  // Live handle availability check (debounced).
  const [handleStatus, setHandleStatus] = createSignal<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  let handleTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (handleTimer) clearTimeout(handleTimer);
  });

  function onHandleInput(value: string) {
    const next = value.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setHandle(next);
    if (handleTimer) clearTimeout(handleTimer);
    if (!next) {
      setHandleStatus("idle");
      return;
    }
    if (!HANDLE_RE.test(next)) {
      setHandleStatus("invalid");
      return;
    }
    setHandleStatus("checking");
    handleTimer = setTimeout(async () => {
      try {
        const { available } = await client.checkHandle(next);
        // Guard against stale results if the user kept typing.
        if (handle() !== next) return;
        setHandleStatus(available ? "available" : "taken");
      } catch {
        if (handle() !== next) return;
        setHandleStatus("invalid");
      }
    }, 300);
  }

  const detailsValid = createMemo(() => EMAIL_RE.test(email()) && handleStatus() === "available");

  async function submitDetails(e: Event) {
    e.preventDefault();
    if (!detailsValid() || busy()) return;
    setBusy(true);
    try {
      await client.beginRegistration({
        email: email(),
        handle: handle(),
        displayName: displayName().trim() || undefined,
      });
      toast.success("Verification code sent");
      setStep("verify");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send code");
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e: Event) {
    e.preventDefault();
    if (busy() || otp().length !== 6) return;
    setBusy(true);
    try {
      const result = await client.completeRegistration({ email: email(), code: otp() });
      setUserId(result.userId);
      setAuthCode(result.code);
      toast.success("Email verified");
      setStep("passkey");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  // If the environment can't do WebAuthn, don't stall the user on a step they
  // can't complete — finish sign-in as soon as we reach the passkey step.
  createEffect(() => {
    if (step() === "passkey" && !passkeySupported && !busy() && authCode()) {
      void skipPasskeyForNow();
    }
  });

  async function enrollPasskey() {
    const id = userId();
    const code = authCode();
    if (!id || !code || busy()) return;
    setBusy(true);
    try {
      const options = (await client.passkeyRegisterBegin(id)) as Parameters<
        typeof startRegistration
      >[0]["optionsJSON"];
      const attestation = await startRegistration({ optionsJSON: options });
      await client.passkeyRegisterComplete({ userId: id, attestation });
      const session = await client.exchangeAuthCode(code);
      await adoptSession(session);
      toast.success(`Welcome, @${handle()}`);
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Passkey setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function skipPasskeyForNow() {
    const code = authCode();
    if (!code || busy()) return;
    setBusy(true);
    try {
      const session = await client.exchangeAuthCode(code);
      await adoptSession(session);
      toast.success(`Welcome, @${handle()}`);
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="max-w-sm mx-auto px-4 py-8">
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-2xl font-bold text-foreground">Create your OSN account</h2>
        <button
          type="button"
          onClick={props.onCancel}
          class="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      <Show when={step() === "details"}>
        <form onSubmit={submitDetails} class="flex flex-col gap-4">
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              autocomplete="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Handle</span>
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground">@</span>
              <input
                type="text"
                required
                autocomplete="username"
                value={handle()}
                onInput={(e) => onHandleInput(e.currentTarget.value)}
                placeholder="lowercase, numbers, _"
                class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <Show when={handleStatus() === "checking"}>
              <span class="text-xs text-muted-foreground">Checking…</span>
            </Show>
            <Show when={handleStatus() === "available"}>
              <span class="text-xs text-green-600">@{handle()} is available</span>
            </Show>
            <Show when={handleStatus() === "taken"}>
              <span class="text-xs text-destructive">@{handle()} is taken</span>
            </Show>
            <Show when={handleStatus() === "invalid"}>
              <span class="text-xs text-destructive">
                1–30 chars: lowercase letters, numbers, underscores
              </span>
            </Show>
          </label>

          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Display name (optional)</span>
            <input
              type="text"
              value={displayName()}
              onInput={(e) => setDisplayName(e.currentTarget.value)}
              class="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={!detailsValid() || busy()}
            class="rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy() ? "Sending…" : "Send verification code"}
          </button>
        </form>
      </Show>

      <Show when={step() === "verify"}>
        <form onSubmit={submitOtp} class="flex flex-col gap-4">
          <p class="text-sm text-muted-foreground">
            We sent a 6-digit code to <strong>{email()}</strong>. Enter it below to verify.
          </p>
          <label class="flex flex-col gap-1">
            <span class="text-sm font-medium">Verification code</span>
            <input
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxLength={6}
              required
              value={otp()}
              onInput={(e) => setOtp(e.currentTarget.value.replace(/\D/g, "").slice(0, 6))}
              class="rounded-md border border-input bg-background px-3 py-2 text-sm tracking-[0.5em] text-center"
            />
          </label>
          <button
            type="submit"
            disabled={otp().length !== 6 || busy()}
            class="rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {busy() ? "Verifying…" : "Verify email"}
          </button>
          <button
            type="button"
            onClick={() => setStep("details")}
            class="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Use a different email
          </button>
        </form>
      </Show>

      <Show when={step() === "passkey"}>
        <Show
          when={passkeySupported}
          fallback={
            <p class="text-sm text-muted-foreground">
              Signing you in… (passkeys aren&apos;t supported in this environment — you can add one
              later once we ship the mobile app).
            </p>
          }
        >
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted-foreground">
              Set up a passkey so you can sign back in with Face ID, Touch ID, or your device PIN —
              no password required.
            </p>
            <button
              type="button"
              onClick={enrollPasskey}
              disabled={busy()}
              class="rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {busy() ? "Setting up…" : "Create passkey"}
            </button>
            <button
              type="button"
              onClick={skipPasskeyForNow}
              disabled={busy()}
              class="text-xs text-muted-foreground hover:text-foreground"
            >
              Skip for now (you can add one later)
            </button>
          </div>
        </Show>
      </Show>

      <Show when={step() === "done"}>
        <p class="text-sm text-muted-foreground">You&apos;re all set. Loading Pulse…</p>
      </Show>
    </div>
  );
}
