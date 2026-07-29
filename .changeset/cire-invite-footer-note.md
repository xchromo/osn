---
"@cire/api": minor
"@cire/db": minor
"@cire/organiser": minor
"@cire/web": minor
---

Footer sign-off on the cire guest invite: an organiser can add a closing line
the couple signs off with — "Looking forward to celebrating with you", "No boxed
gifts please" — and an optional image above it (a monogram, motif or signature),
shown at the bottom of the invite just above their names.

Like the other optional invite modules (hero, Our Story, event inspiration,
dress code) neither has a **built-in default**: leave them blank and nothing
renders, so every existing wedding keeps today's footer (couple's title over the
legal links) until an organiser fills them in. The two are independent — either
alone is valid.

- `@cire/db`: nullable `footer_message` column on `wedding_invite_customisations`
  (`0048_invite_footer_message.sql`) + `footer_image_key` / `footer_image_crop`
  (`0049_invite_footer_image.sql`), both forward-only D1 migrations, plus the
  lockstep DDL mirror in `cire/api/src/db/setup.ts`.
- `@cire/api`: `footerMessage` added to the total `PUT /invite/text` body
  (`copyField(300)`, same cap as the welcome greeting; over-cap ⇒ 400, whole body
  rejected). Trimmed on save and collapsed to `null` when empty/whitespace-only,
  and surfaced as `footer.message` on both the organiser `GET /invite` and the
  public `GET /api/invite/:slug`.
- `@cire/api`: `footer` joins `INVITE_IMAGE_SLOTS`, so the existing upload /
  remove / crop routes serve it with no new endpoints. Adding a third slot meant
  replacing the service's five `slot === "hero" ? … : …` branches with one
  `SLOT_COLUMNS` map — each of those would otherwise have written the footer's
  image into the story's columns. `asset-reconcile`'s `loadReferencedKeys` also
  learned the new column: that query decides which R2 objects are live, so an
  unlisted slot's images would have been swept as orphans past the grace window.
  Both are pinned by tests (slot isolation on upload/remove/crop; a reconcile
  case seeding every slot).
- `@cire/web`: `SiteFooter` takes `message`, `imageUrl` and `imageCrop` props and
  renders the motif then the note above the couple's closing name, gated on the
  shared `hasFooterMessage` predicate in `invite-emptiness.ts` so a
  whitespace-only note stays hidden. The image uses the same crop-fraction CSS
  technique as the story photo, capped at `min(200px, 45vw)` and square by
  default. Wired through both design packs' `Document.astro` (classic + gala);
  `footer` is optional on the wire so a mid-deploy payload from an older API
  simply renders neither.
- `@cire/organiser`: a "Footer" fieldset in the invite builder with the note
  field and an `ImageField` for the new slot (square default crop aspect),
  carrying the same live **"Shown" / "Hidden — empty"** badge the Hero and Our
  Story sections use — driven by `isFooterEmpty` (note OR image), mirrored in
  `cire/organiser/src/lib/invite-emptiness.ts` — so the organiser sees whether a
  guest will get a sign-off before they save.
