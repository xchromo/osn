---
"@cire/api": minor
"@cire/db": minor
"@cire/organiser": minor
"@cire/web": minor
---

Closing section on the cire guest invite: the couple can now end the invite in
their own words. A new LAST SECTION carries an optional image — a monogram,
motif or signature — over an optional closing line ("Looking forward to
celebrating with you", "No boxed gifts please").

Like the hero and Our Story it is a conditional segment with **no built-in
defaults**: set neither and the whole section renders nothing, so every existing
wedding is unchanged. The two pieces are independent — either alone is valid.

It renders **after the guest claims their code**, inside the same gate as the
events list: the note is addressed to the invited household, not to anyone
holding the URL. And it is **not** part of `SiteFooter`, which stays site-wide
chrome (the couple's title over the legal links + privacy control) rendered on
every document including `/privacy`, `/terms` and 404.

It carries **no new theme setting** — it paints whatever surface the organiser
chose for "Code Entry & Welcome", so the couple's two direct addresses to their
guests match and the builder gains no extra knob.

- `@cire/db`: two forward-only D1 migrations on `wedding_invite_customisations`
  — `footer_message` (`0049_invite_footer_message.sql`) and `footer_image_key` /
  `footer_image_crop` (`0050_invite_footer_image.sql`), plus the lockstep DDL
  mirror in `cire/api/src/db/setup.ts`.
- `@cire/api`: `footerMessage` on the total `PUT /invite/text` body
  (`copyField(300)`, over-cap ⇒ 400, trimmed and collapsed to `null` when
  empty), and `footer` joining `INVITE_IMAGE_SLOTS` so the existing upload /
  remove / crop routes serve it with no new endpoints. Both surfaced as a
  `footer` object on the organiser and public invite reads. The theme body is
  untouched.

  Adding a third image slot meant replacing the service's five
  `slot === "hero" ? … : …` branches with one `SLOT_COLUMNS` map — each of those
  would otherwise have written the new slot's image into the story's columns.
  `asset-reconcile`'s `loadReferencedKeys` also learned the new column: that
  query decides which R2 objects are live, so an unlisted slot's images would
  have been swept as orphans past the grace window. Both are pinned by tests
  (slot isolation on upload/remove/crop; a reconcile case seeding every slot).
- `@cire/web`: new `InviteClosing.tsx` rendered by both design packs'
  `InvitePage` inside `<Show when={claimResult()}>`, below the events. Hidden
  entirely via the shared `isFooterEmpty` predicate; the image uses the same
  crop-fraction CSS technique as the story photo, capped at `min(200px, 45vw)`
  and square by default. Deliberately not `opacity-0` — a section that needs the
  unlock motion chunk to become visible is one that can stay invisible when that
  chunk fails to load. `footer` is optional on the wire so a mid-deploy payload
  from an older API renders nothing.
- `@cire/organiser`: a "Closing Section" card in the invite builder with the
  image field, the note field and a live preview on the welcome surface, plus
  the **"Shown" / "Hidden — empty"** badge driven by `isFooterEmpty` (note OR
  image). Storage and the wire stay `footer_*` while the organiser-facing label
  is "Closing Section": a documented mapping, so "footer" never appears next to
  a page that also has a legal footer.
