---
"@cire/invites": patch
---

Import the `ImageCrop` type the classic invite page already uses.

`InvitePage.tsx` names `ImageCrop` in the `footer.imageCrop` field of
`InviteCustomisationResponse` but never imports it, so the file has not
type-checked since the type was introduced. Nothing failed at runtime — Astro
strips types at build — and `@cire/invites` ships no `check` script, so neither
the build nor CI ever looked.

Adds the missing `import type { ImageCrop } from "../../components/image-crop"`.
The module was already there, with tests.
