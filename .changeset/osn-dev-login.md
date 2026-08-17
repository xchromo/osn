---
"@osn/api": patch
---

Add a passkey-less dev sign-in (`GET|POST /dev/login`) for the `local` and `dev`
tiers, so the seeded wedding is reachable without enrolling a WebAuthn
credential.

A passkey is the only primary login factor, which leaves any seeded account
permanently locked out — a seed script cannot enrol a credential on its own
behalf. The route mints a **real** OSN session for one fixed principal
(`usr_dev_bootstrap_owner`, the id the cire seed writes as the seeded wedding's
owner), so the OIDC authorize/token chain, the organiser portal, the vendor
portal and `@osn/social` all run untouched. There is no bypass anywhere else in
the stack, no identifier parameter, and nothing to enumerate.

**Two gates, both fail closed**, both applied in `buildAppDeps` — the tier must
parse as `local` or `dev` (same predicate as the OpenAPI-docs gate, so a typo'd
`OSN_ENV` leaves it off), and `DEV_LOGIN_SECRET` must be set. Fail either and the
routes are never mounted, so the path answers 404 rather than a 401 that would
admit the surface exists. The secret is compared in constant time; the endpoint
carries its own 10/min limiter.

`return_to` is optional and checked against the tier's own CORS allowlist before
any redirect — an off-list target is a 400, so the endpoint cannot be turned into
an open redirect that leaks the session cookie. `GET` is the primary verb: the
origin guard rejects a POST without a matching `Origin`, and a URL keeps the
secret out of every public frontend bundle.

The principal is provisioned idempotently on first use (`onConflictDoNothing`
inside a single `commitBatch`), since `osn-db-dev` is never reset. Its handle
`dev_bootstrap` is now in `RESERVED_HANDLES` so no real registration can occupy
the row first.
