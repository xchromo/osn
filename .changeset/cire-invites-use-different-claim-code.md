---
"@cire/invites": patch
---

Add a "Use a different claim code" button below the post-claim welcome
section, for a shared device or a code that opened the wrong household's
invite. Local UI only — it swaps back to the code entry form and clears the
currently-claimed invite from view; the household's `cire_session` cookie is
untouched, so reloading without submitting a new code restores the same
invite. Submitting a different code overwrites the session the same way any
first claim does.
