/**
 * RFC 6238 time-based one-time passwords, and the RFC 4648 base32 that carries
 * the shared secret to an authenticator app.
 *
 * The scheme: a 20-byte secret is generated once, shown to the user as a QR
 * code (`totpUri`) or as base32 text they can type, and thereafter both sides
 * derive the same six digits from it and the current 30-second step. The
 * server keeps the secret because HMAC verification needs the raw key —
 * unlike recovery codes and session tokens in this package, a TOTP secret
 * cannot be stored as a hash. Encrypting it at rest is the caller's job, not
 * this module's.
 *
 * Deliberately its own module importing nothing but `./timing-safe`:
 * `@shared/crypto`'s index pulls in `@osn/db` and `drizzle-orm`, which a
 * caller deriving six digits has no business loading. Import it as
 * `@shared/crypto/totp`.
 */

import { timingSafeEqualString } from "./timing-safe";

/** RFC 4648 §6 alphabet — uppercase letters then the digits 2 to 7. */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * What `base32Decode` accepts once whitespace and `=` padding are stripped.
 * Tested BEFORE case-folding, never after: Unicode uppercasing maps `ß` to
 * `SS`, `ı` to `I`, `ſ` to `S` and `ﬀ` to `FF`, so folding first would let all
 * four through a check against the alphabet.
 */
const BASE32_INPUT = /^[A-Za-z2-7]*$/;

/** RFC 4226 §4 recommends 160 bits of shared secret. */
const TOTP_SECRET_BYTES = 20;

/** RFC 4226 §4 R6 — the shared secret must be at least 128 bits. */
const TOTP_MIN_SECRET_BYTES = 16;

const TOTP_DIGITS = 6;

/** RFC 6238's default time step X. */
const TOTP_STEP_SECONDS = 30;

/** One step either side, which is RFC 6238 §5.2's recommendation for drift. */
const TOTP_DEFAULT_WINDOW = 1;

/**
 * Hard ceiling on the drift window, so the work one call performs is bounded
 * whatever the caller passes. Ten steps is ±5 minutes; a window large enough
 * to matter beyond that is a clock problem, not a drift problem.
 */
const TOTP_MAX_WINDOW = 10;

/** Six ASCII digits. `\d` would do — without `u` it is ASCII-only — but say it. */
const SIX_ASCII_DIGITS = /^[0-9]{6}$/;

/** A fresh 160-bit TOTP shared secret. */
export function generateTotpSecret(): Uint8Array {
  const bytes = new Uint8Array(TOTP_SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Base32 of `bytes`: uppercase, unpadded, RFC 4648 alphabet. */
export function base32Encode(bytes: Uint8Array): string {
  let carry = 0;
  let bits = 0;
  let out = "";
  for (const byte of bytes) {
    carry = (carry << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(carry >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(carry << (5 - bits)) & 0x1f];
  return out;
}

/**
 * Bytes from base32. Tolerant of what a person retypes — lowercase, spaces
 * between groups, and the `=` padding some apps display — and strict about
 * everything else: any other character throws a `TypeError`. Bits left over in
 * a trailing partial group are discarded, so a truncated string decodes to the
 * whole bytes it does carry rather than failing.
 *
 * The thrown message names no part of the input. This function's argument is a
 * shared secret a user pasted, and an error message is the one place a
 * fragment of it would reach a log.
 */
export function base32Decode(input: string): Uint8Array {
  const compact = input.replace(/[\s=]/g, "");
  if (!BASE32_INPUT.test(compact)) {
    throw new TypeError("base32Decode: input has a character outside the RFC 4648 alphabet");
  }

  const symbols = compact.toUpperCase();
  const out = new Uint8Array(Math.floor((symbols.length * 5) / 8));
  let carry = 0;
  let bits = 0;
  let index = 0;
  for (const symbol of symbols) {
    carry = (carry << 5) | BASE32_ALPHABET.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (carry >>> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}

/**
 * The `otpauth://` URI an authenticator app scans, per the Key Uri Format the
 * ecosystem settled on.
 *
 * The issuer appears twice, as the label prefix and as the `issuer` parameter,
 * because apps differ in which they read. Both halves of the label are
 * percent-encoded and joined with a literal colon, so a colon inside either
 * field arrives as `%3A` and cannot be mistaken for the separator. The
 * parameters are assembled by hand rather than through `URLSearchParams`,
 * which form-encodes a space as `+` — an authenticator would show that plus
 * sign to the user.
 */
export function totpUri(opts: { secret: Uint8Array; accountName: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.accountName)}`;
  const params = [
    `secret=${base32Encode(opts.secret)}`,
    `issuer=${encodeURIComponent(opts.issuer)}`,
    "algorithm=SHA1",
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_STEP_SECONDS}`,
  ].join("&");
  return `otpauth://totp/${label}?${params}`;
}

/**
 * The six-digit code for one counter value: HMAC-SHA-1 over the counter as an
 * 8-byte big-endian integer, RFC 4226 §5.3 dynamic truncation, then modulo a
 * million and zero-padded.
 *
 * Throws a `TypeError` on a counter that is not a non-negative safe integer,
 * or a secret below the 128-bit floor. Both would otherwise fail quietly:
 * `setBigUint64` wraps a negative counter modulo 2^64 and returns a plausible
 * wrong code, and WebCrypto refuses a zero-length HMAC key with a `DataError`
 * that says nothing about which argument was wrong.
 */
export async function deriveTotpCode(secret: Uint8Array, counter: number): Promise<string> {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new TypeError("deriveTotpCode: counter must be a non-negative safe integer");
  }
  if (secret.length < TOTP_MIN_SECRET_BYTES) {
    throw new TypeError(`deriveTotpCode: secret must be at least ${TOTP_MIN_SECRET_BYTES} bytes`);
  }

  // Copied, not passed through: it re-types the array as one backed by a plain
  // ArrayBuffer, which is what WebCrypto's BufferSource accepts, and it stops
  // the caller's buffer from being the live HMAC key.
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );

  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(counter), false);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));

  const offset = mac[mac.length - 1] & 0x0f;
  const truncated =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];

  return (truncated % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

/**
 * Whether `code` is valid for `secret` at `at`, allowing `window` steps of
 * clock drift either side.
 *
 * Never throws and never returns early on a match: every candidate in the
 * window is derived and every one is compared, so a valid code and an invalid
 * code of the same shape do the same work. A malformed code, an unusable
 * secret or an unusable date is `false`, not an exception — this runs behind
 * routes that take the code from an untrusted request body.
 */
export async function verifyTotpCode(opts: {
  secret: Uint8Array;
  code: string;
  at?: Date;
  window?: number;
}): Promise<boolean> {
  const { secret, code, at = new Date(), window = TOTP_DEFAULT_WINDOW } = opts;

  if (!SIX_ASCII_DIGITS.test(code)) return false;
  if (secret.length < TOTP_MIN_SECRET_BYTES) return false;

  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  if (!Number.isSafeInteger(counter) || counter < 0) return false;

  // Clamped at both ends. The lower bound keeps a nonsensical window from
  // disabling verification silently; the upper bound keeps `window` from
  // choosing how much CPU one request spends. A NaN window collapses to the
  // current step alone rather than falling through Math.max unnoticed.
  const span = Number.isFinite(window)
    ? Math.min(TOTP_MAX_WINDOW, Math.max(0, Math.trunc(window)))
    : 0;

  const counters = Array.from({ length: span * 2 + 1 }, (_, index) =>
    Math.max(0, counter - span + index),
  );
  const candidates = await Promise.all(counters.map((step) => deriveTotpCode(secret, step)));

  // Bitwise `|`, not `||=` or `.some`: both short-circuit, which would make
  // the number of comparisons depend on whether — and where — the code matched.
  const matched = candidates.reduce(
    (accumulated, candidate) => accumulated | (timingSafeEqualString(candidate, code) ? 1 : 0),
    0,
  );
  return matched === 1;
}
