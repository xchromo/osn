---
"@osn/api": patch
---

`publicError`'s tag walk reads each own key with a plain property access instead of allocating an `Object.getOwnPropertyDescriptor` per key, fixing an 8.7x slowdown on the common untagged-error path (tracker#446). `GET /account/security-events` now sets `Cache-Control: private, no-store`, since the list is per-user and names authentication events (tracker#346).
