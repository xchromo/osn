/**
 * OSN email Worker — ARC-authed fan-out over Cloudflare's native
 * `SEND_EMAIL` binding.
 *
 * Contract (documented in `wiki/systems/email.md`):
 *
 *   POST /send
 *   Authorization: ARC <jwt with iss=osn-api, aud=osn-email-worker, scope=email:send>
 *   Content-Type: application/json
 *   { "to": "alice@example.com",
 *     "from": "noreply@osn.app",
 *     "subject": "...",
 *     "text": "...",
 *     "html": "..." (optional)
 *   }
 *
 * Response: 202 on accept; 400 on schema violation; 401 on missing ARC;
 * 403 on bad scope; 502 on Cloudflare Email Service failure.
 *
 * Why a Worker and not `CloudflareEmailLive` calling `EMAIL.send` directly?
 * The `send_email` binding is Workers-only — it isn't available to a Bun
 * process running `@osn/api`. OSN API mints an ARC token and POSTs here;
 * we verify the signature, apply per-recipient guards, and use the binding
 * on the other side of the trust boundary. No API key, no provider SDK —
 * Cloudflare DKIM-signs via the verified-domain configuration in the
 * dashboard.
 */

import { verifyArc } from "./arc-verify";

/**
 * `SEND_EMAIL` binding shape. Cloudflare's `@cloudflare/workers-types`
 * has this under `SendEmail` but the public-beta types aren't yet on the
 * version pinned in our devDependencies — declared locally to keep the
 * Worker type-tight without chasing weekly type package bumps. The
 * binding's runtime shape is documented at
 * developers.cloudflare.com/email-service/api/send-emails/workers-api/.
 */
interface SendEmailBinding {
  send(message: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
}

export interface Env {
  readonly EMAIL: SendEmailBinding;
  readonly OSN_API_ISSUER_JWKS: string;
  readonly OSN_API_ISSUER_ID: string;
  readonly FROM_ADDRESS_DEFAULT: string;
}

interface SendRequestBody {
  readonly to: string;
  readonly from?: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/** Accept only a conservative email shape. Not RFC 5322 — a syntactic filter. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function jsonError(status: number, reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateBody(
  raw: unknown,
):
  | { readonly ok: true; readonly body: SendRequestBody }
  | { readonly ok: false; readonly reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid_json" };
  const b = raw as Record<string, unknown>;
  if (typeof b.to !== "string" || !EMAIL_RE.test(b.to)) return { ok: false, reason: "invalid_to" };
  if (b.from !== undefined && (typeof b.from !== "string" || !EMAIL_RE.test(b.from)))
    return { ok: false, reason: "invalid_from" };
  if (typeof b.subject !== "string" || b.subject.length === 0 || b.subject.length > 200)
    return { ok: false, reason: "invalid_subject" };
  if (typeof b.text !== "string" || b.text.length === 0 || b.text.length > 20_000)
    return { ok: false, reason: "invalid_text" };
  if (b.html !== undefined && (typeof b.html !== "string" || b.html.length > 50_000))
    return { ok: false, reason: "invalid_html" };
  return {
    ok: true,
    body: {
      to: b.to,
      from: typeof b.from === "string" ? b.from : undefined,
      subject: b.subject,
      text: b.text,
      html: b.html as string | undefined,
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "POST" || url.pathname !== "/send") {
      return jsonError(404, "not_found");
    }

    const auth = await verifyArc(request.headers.get("authorization"), {
      jwksUrl: env.OSN_API_ISSUER_JWKS,
      expectedIssuer: env.OSN_API_ISSUER_ID,
      expectedAudience: "osn-email-worker",
      requiredScope: "email:send",
    });
    if (!auth.ok) {
      const code =
        auth.error.reason === "missing_header" || auth.error.reason === "bad_scheme"
          ? 401
          : auth.error.reason === "scope_denied"
            ? 403
            : 401;
      return jsonError(code, auth.error.reason);
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, "invalid_json");
    }

    const validation = validateBody(raw);
    if (!validation.ok) return jsonError(400, validation.reason);

    const { body } = validation;

    // Dispatch via Cloudflare's native SEND_EMAIL binding. On the public-
    // beta binding, a rejection indicates the domain isn't onboarded, the
    // From address doesn't match the verified domain, or Cloudflare's
    // send pipeline is unavailable — all of which we surface as 502 so
    // OSN API retries-or-fails-closed. We intentionally do not echo the
    // underlying error message into the response body.
    try {
      await env.EMAIL.send({
        to: body.to,
        from: body.from ?? env.FROM_ADDRESS_DEFAULT,
        subject: body.subject,
        text: body.text,
        html: body.html,
      });
    } catch {
      return jsonError(502, "provider_error");
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    });
  },
};
