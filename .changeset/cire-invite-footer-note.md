---
"@cire/api": minor
"@cire/db": minor
"@cire/organiser": minor
"@cire/web": minor
---

Footer note on the cire guest invite: an organiser can write a closing line the
couple signs off with — "Looking forward to celebrating with you", "No boxed
gifts please" — shown at the bottom of the invite just above their names.

Like the other optional invite modules (hero, Our Story, event inspiration,
dress code) it has **no built-in default**: leave it blank and nothing renders,
so every existing wedding keeps today's footer (couple's title over the legal
links) until an organiser fills it in.

- `@cire/db`: nullable `footer_message` column on `wedding_invite_customisations`
  + forward-only D1 migration `0048_invite_footer_message.sql` (plus the lockstep
  DDL mirror in `cire/api/src/db/setup.ts`).
- `@cire/api`: `footerMessage` added to the total `PUT /invite/text` body
  (`copyField(300)`, same cap as the welcome greeting; over-cap ⇒ 400, whole body
  rejected). Trimmed on save and collapsed to `null` when empty/whitespace-only,
  and surfaced as `footer.message` on both the organiser `GET /invite` and the
  public `GET /api/invite/:slug`.
- `@cire/web`: `SiteFooter` takes a `message` prop and renders it above the
  couple's closing name, gated on the shared `hasFooterMessage` predicate in
  `invite-emptiness.ts` so a whitespace-only note stays hidden. Wired through
  both design packs' `Document.astro` (classic + gala); `footer` is optional on
  the wire so a mid-deploy payload from an older API simply renders no note.
- `@cire/organiser`: a "Footer Note" fieldset in the invite builder, carrying the
  same live **"Shown" / "Hidden — empty"** badge the Hero and Our Story sections
  use (mirrored predicate in `cire/organiser/src/lib/invite-emptiness.ts`), so the
  organiser sees whether a guest will get the line before they save.
