---
"@osn/social": minor
---

Mobile UX overhaul — the app was desktop-only (fixed 240px rail at every
viewport width, ~135px of content on a phone). Now responsive at a single
`md` (768px) breakpoint, per the audit + plan in
`wiki/apps/social-mobile-ux.md`:

- **Shell** — below `md` the rail is replaced by a fixed bottom tab bar
  (`MobileNav`, four destinations, 20px icons) and a top bar
  (`MobileTopBar`: wordmark, theme toggle, account control). Nav items are
  shared via `components/nav.tsx`; the account dropdown and auth/switcher
  dialogs are extracted (`AccountMenu`, `AuthDialogs`,
  `ProfileSwitcherDialog`) and mounted per shell. `/` now highlights
  Connections in both shells. The bare `/authorize` route keeps no shell.
- **Viewport** — `h-dvh` everywhere (`h-screen` gone), `viewport-fit=cover`
  + `pt-safe`/`pb-safe`/`px-safe`/`pb-nav` utilities, paired `theme-color`
  metas kept in sync with the resolved theme.
- **Dialogs** — `ResponsiveDialogContent` renders every app dialog as a
  full-width bottom sheet below `md` (`rounded-t-card`,
  `max-h-[85dvh] overflow-y-auto`, `pb-safe`); the shared centered card at
  `md+`. `@osn/ui` primitives untouched.
- **Touch** — form controls render 16px below 768px (kills iOS focus
  auto-zoom; documented type-scale exception), row actions bump `h-7 →
  max-md:h-10`, tabs get `max-md:min-h-11` + `overflow-x-auto`, rows gain
  `active:` feedback, `touch-action: manipulation`, page padding
  `px-4 py-6 md:px-8 md:py-8`, toasts top-center on mobile.
- **Guardrails** — `DESIGN.md` gains a Responsive layout section locking the
  breakpoint policy; new `MobileNav` + `isNavActive` tests; verified
  headless-Chromium at 320/390/768/1280 widths with zero horizontal
  overflow in both themes.
