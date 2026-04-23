/**
 * Resend provider adapter. Swap at deploy time (not at code-change time)
 * by replacing this file with another provider's adapter — the shape
 * `sendViaProvider({ to, from, subject, text, html, apiKey })` is the
 * Worker's only provider contract.
 */

export interface ProviderSendInput {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly apiKey: string;
}

export interface ProviderResult {
  readonly ok: boolean;
  readonly status: number;
  readonly providerMessageId?: string;
}

/**
 * Posts the email to Resend's API. Returns a minimal result — the body
 * is intentionally not echoed back to the caller (the provider may
 * include the recipient address in error responses, which we do not
 * want to propagate into OSN's logs).
 */
export async function sendViaResend(input: ProviderSendInput): Promise<ProviderResult> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
  const providerMessageId =
    body && typeof body.id === "string" && body.id.length <= 64 ? body.id : undefined;
  return { ok: true, status: res.status, providerMessageId };
}
