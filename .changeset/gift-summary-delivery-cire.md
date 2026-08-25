---
"@cire/api": minor
---

Mail the couple their registry gift summary at the moment the retention sweep deletes the per-gift detail. The sweep asks osn-api for the address of the account that owns the wedding (cire stores none of its own) and sends one email per wedding through the new `registry-gift-summary` template. Delivery is best-effort and never blocks the deletion: no address, no mail, and the sweep runs on.
