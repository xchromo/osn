---
"@osn/api": patch
---

Stop passkey add/remove from signing a Bearer-only caller out of every device.

Passkey register (H1) and passkey delete (S-L3) revoke every session on the
account except the caller's own, and the caller's own session was read only
from the HttpOnly cookie. A request that authenticated with a Bearer access
token but carried no cookie — a cross-origin call, a proxy that strips
cookies, a native client — looked sessionless, so both paths took the "no self
to preserve" branch and deleted **every** session on the account. Removing or
adding a passkey logged the user out everywhere, including on the device they
were using.

Access tokens now carry a `sid` claim: `sha256(session_hash + ":" + profile_id)`
truncated to 128 bits. It is one-way (the session hash is itself a SHA-256 of a
160-bit random token) and per-profile — sessions are account-scoped and shared
across profile switches, so a plain session id would have let an observer tie
two profiles of one account together, which P6 forbids. Recognition is by
recomputation over the account's session rows (bounded by
`MAX_SESSIONS_PER_ACCOUNT`), via the new `resolveSessionByBinding`. No new
secret, no schema change.

`issueTokens` and `refreshTokens` generate the session token before signing the
JWT so the access token binds to the session it ships with — on refresh, the
rotated-in session, not the retired one. `switchProfile` resolves the caller's
session from the old profile's `sid` and re-derives it for the target profile.
The two routes read the cookie first and fall back to `sid`; with neither, the
account-wide revocation stands, so a token minted before this claim existed
degrades to the old behaviour rather than failing.
