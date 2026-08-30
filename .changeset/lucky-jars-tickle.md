---
"@zap/api": patch
"@zap/db": patch
---

Drop a wasted read after every chat and message write, and stop `listC2bMessages` silently restarting at page 1 on an unknown cursor.

The four write paths (`createChat`, `provisionC2bChat`, `sendMessage`, `sendC2bMessage`) re-read the row they had just inserted before returning it. Every column was already known, so that was one more sequential D1 round-trip per write for nothing — three to four on the enquiry hot path. They now return the values they wrote. Timestamps go through a new `storedNow()` helper because Drizzle stores `timestamp` columns as whole seconds: an untruncated `Date` would make a write's response disagree with every later read of the same row by up to 999ms.

`listC2bMessages` now fails with a validation error on a `before` cursor it cannot find, matching `listMessages`; the route answers 400 rather than 200-with-page-1, which used to send a paginating caller round the same page for ever. `chats_class_idx` is dropped — `EXPLAIN QUERY PLAN` gives an identical plan with and without it, so it was write amplification only.
