---
"@zap/api": patch
"@zap/db": patch
---

Enforce the chat class on the c2c write path, and finish the returned-row conversion.

`sendMessage` never checked `chats.class`, so a member of a `c2b` (consumer-to-business) chat could write an encrypted message into it through the public route. A `c2b` chat is defined as server-visible, moderatable and DSAR-exportable; a ciphertext row inside one is none of those — the account export filters on a non-null `body` so the row is dropped silently, and the internal reader renders it as an empty string with no signal that content was withheld. It now fails `NotC2cChat`, which the route reports as 409, mirroring the check `sendC2bMessage` already made the other way round.

`addMember` and `updateChat` were the last two write paths still re-reading the row they had just written. They now return what they wrote, through `storedNow()` — and `updateChat` keeps the stored title when a request sends none, which is what Drizzle's omit-undefined `SET` does and what the read-back used to get right by accident.

`zap/db`'s DDL lockstep test now also checks `drizzle/meta/`: `drizzle-kit generate` reads the journal and the latest snapshot rather than the `.sql` files, so a journal that has lost an entry makes the next generate re-emit a migration already applied to production.
