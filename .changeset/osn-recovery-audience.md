---
"@osn/db": minor
"@osn/api": minor
---

The `osn-recovery` token audience, for restricted recovery sessions

Account recovery has to end in a session that can enrol a fresh passkey and do
nothing else. This adds that primitive. **No route mints one yet** — the
recovery endpoints are separate work, and the tests are this change's reader.

The restriction is a distinct access-token audience, `osn-recovery`, not a
column. There is no single guard a column could be checked in: four entry points
in osn-api verify access tokens, and `pulse/api`, `zap/api` and `cire/api` verify
the same token over JWKS with no access to OSN's database. All seven already pin
`osn-access`, so all seven reject the new audience with **no change to any of
them** — fail-closed by construction, and not waiting on three other services to
deploy. `resolvePasskeyEnrollPrincipal` is the only resolver taught to accept it,
which makes `/passkey/register/begin` and `/complete` the only two routes it
reaches.

`sessions.restricted_until` (new column, migration `0008`) is the source of truth
for **rotation**, not for request-time authorisation: `refreshTokens` copies it
forward and re-mints on the recovery audience, or the restriction would die on
the first silent refresh five minutes in. It also pins an absolute 15-minute
expiry that never slides — and that guard has to be explicit, because a
restricted session's whole life sits inside half of a 30-day TTL, so the sliding
window's own condition is always true for exactly the session that must expire on
schedule. `completePasskeyRegistration` clears the column and restores an
ordinary TTL, which is what lifts the restriction.

A recovery-audience caller **bypasses the passkey step-up gate**, deliberately:
losing a phone does not delete its passkey row, so the gate would otherwise block
the common recovery case. The alternative — letting a restricted session mint
step-up tokens — would hand it `/recovery/generate`, `DELETE /account`,
`GET /account/export` and `/account/email/complete` as well.

Two behaviour changes beyond the issue, both closing ways the restriction would
have failed open:

- `verifyRefreshToken` now **rejects a restricted session unless the caller opts
  in**, and `refreshTokens` is the only caller that does. `GET /authorize`
  resolves the signed-in user from the session cookie rather than an access
  token, so without this a recovery session would have completed an OIDC
  authorization and signed the user into every relying party.
- `ACCESS_TOKEN_AUDIENCE` moves into `constants.ts` beside the new one, and the
  reserved OIDC client-id deny-list references both by name instead of repeating
  the literals — the deny-list can no longer drift from the audiences it guards.
