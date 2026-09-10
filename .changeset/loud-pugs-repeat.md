---
"@shared/observability": minor
"@osn/api": minor
---

Let an account at the passkey cap complete a recovery.

An account holding `MAX_PASSKEYS_PER_ACCOUNT` credentials that lost its last
device was unreachable: it could not enrol another, and it could not delete one
to make room, because deleting needs a WebAuthn step-up and a restricted
recovery session cannot mint a step-up at all.

An enrolment from a restricted recovery session is now held to a ceiling one
credential above the cap. At that ceiling it pays for its slot by reclaiming
`recovery`-provenance credentials, newest first, in the same batch as the insert
— so a second recovery on an account that never pruned is admitted rather than
refused, and the count stays bounded. Nothing else changes: an ordinary
enrolment at the cap is refused exactly as before, and no credential the account
established for itself can be reclaimed.

Adds the `passkey_reclaimed` security-event kind and the
`osn.auth.recovery.passkey_reclaim` counter.
