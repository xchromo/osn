---
title: Component Library (Zaidan)
aliases:
  - zaidan
  - shadcn
  - UI components
  - design system
tags:
  - architecture
  - frontend
  - solidjs
  - tailwind
  - design-system
status: current
related:
  - "[[frontend-patterns]]"
  - "[[monorepo-structure]]"
  - "[[testing-patterns]]"
  - "[[pulse]]"
packages:
  - "@osn/ui"
  - "@pulse/app"
last-reviewed: 2026-04-13
---

# Component Library (Zaidan)

OSN uses **Zaidan**-style components — the SolidJS equivalent of shadcn/ui. Components are copy-pasted source files (not imported from `node_modules`) backed by **Kobalte** headless primitives and styled with **Tailwind CSS** + **CVA** (class-variance-authority).

## Why Zaidan / shadcn-style?

- **Owned source** — components live in the repo, not behind a version pin. Customise freely without forking a library.
- **Kobalte underneath** — headless primitives give proper ARIA semantics, focus trapping, portal rendering, and keyboard navigation for free.
- **CVA variants** — type-safe variant props (`variant="secondary"`, `size="sm"`) with consistent class composition.
- **Tailwind-native** — uses the same CSS variable theme the app already defines, no separate token system.

## Where Components Live

All shared UI primitives live in `@osn/ui`:

```
osn/ui/src/
├── lib/
│   └── utils.ts              ← cn() utility (clsx + tailwind-merge)
├── components/
│   └── ui/
│       ├── avatar.tsx         ← Avatar, AvatarImage, AvatarFallback
│       ├── badge.tsx          ← Badge (variant-based)
│       ├── button.tsx         ← Button + buttonVariants (CVA)
│       ├── card.tsx           ← Card, CardHeader, CardTitle, etc.
│       ├── checkbox.tsx       ← Checkbox (Kobalte)
│       ├── dialog.tsx         ← Dialog, DialogContent, etc. (Kobalte)
│       ├── input.tsx          ← Input
│       ├── label.tsx          ← Label
│       ├── popover.tsx        ← Popover, PopoverTrigger, etc. (Kobalte)
│       ├── radio-group.tsx    ← RadioGroup, RadioGroupItem (Kobalte)
│       ├── tabs.tsx           ← Tabs, TabsList, TabsTrigger (Kobalte)
│       └── textarea.tsx       ← Textarea
└── auth/
    ├── Register.tsx           ← uses Button, Input, Label
    └── SignIn.tsx             ← uses Button, Input, Label, cn()
```

Consuming apps import via subpath exports:

```typescript
import { Button } from "@osn/ui/ui/button";
import { Card } from "@osn/ui/ui/card";
import { cn } from "@osn/ui/lib/utils";
```

## Dependency Stack

| Package | Role |
|---------|------|
| `@kobalte/core` | Headless UI primitives (Dialog, Popover, Tabs, RadioGroup, Checkbox) |
| `class-variance-authority` | Type-safe variant definitions for Button, Badge |
| `clsx` | Conditional class string joining |
| `tailwind-merge` | Intelligent Tailwind class deduplication |

These are dependencies of `@osn/ui`. Consuming apps get them transitively — no extra installs needed.

## The `cn()` Utility

Every component uses `cn()` for class composition. It wraps `clsx` (conditional joining) with `tailwind-merge` (conflict resolution):

```typescript
import { cn } from "@osn/ui/lib/utils";

// Later classes win over earlier ones when they conflict:
cn("px-4 py-2", props.class)
// If props.class contains "px-2", the result is "py-2 px-2" (not "px-4 py-2 px-2")
```

Use `cn()` whenever you compose Tailwind classes from multiple sources (base styles + props + conditionals).

## Component Patterns

### Variant Components (Button, Badge)

Use CVA for components with discrete visual variants:

```tsx
import { Button } from "@osn/ui/ui/button";

<Button variant="default">Primary action</Button>
<Button variant="secondary" size="sm">Secondary</Button>
<Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
<Button variant="destructive">Delete</Button>
```

For links that need button styling, use the exported `buttonVariants` function:

```tsx
import { buttonVariants } from "@osn/ui/ui/button";

<A href="/settings" class={buttonVariants({ variant: "secondary", size: "sm" })}>
  Settings
</A>
```

### Kobalte Components (Dialog, Popover, Tabs, RadioGroup, Checkbox)

These wrap Kobalte primitives with styling. They provide proper accessibility out of the box:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@osn/ui/ui/dialog";

<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Modal Title</DialogTitle>
    </DialogHeader>
    {/* content */}
  </DialogContent>
</Dialog>
```

Key behaviours you get for free:
- **Dialog** — portaled to `<body>`, overlay click dismisses, Escape key dismisses, focus trapped
- **Popover** — portaled, auto-positioned, outside click/Escape dismisses
- **Tabs** — `role="tablist"` / `role="tab"` / `role="tabpanel"`, keyboard arrow navigation
- **RadioGroup** — grouped `role="radiogroup"`, single selection, keyboard navigation
- **Checkbox** — `role="checkbox"`, indeterminate support

### Simple Styled Components (Input, Label, Card, Textarea)

Thin wrappers that apply consistent base styling and accept a `class` prop for overrides:

```tsx
import { Input } from "@osn/ui/ui/input";
import { Label } from "@osn/ui/ui/label";
import { Card } from "@osn/ui/ui/card";

<Card class="p-4">
  <Label for="email">Email</Label>
  <Input id="email" type="email" class="mt-1" />
</Card>
```

## CSS Theme Variables

Components reference CSS variables defined in each app's root CSS (e.g. `pulse/app/src/App.css`). The variable naming follows the shadcn convention:

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --radius: 0.625rem;
}
```

Tailwind maps these via `@theme inline` to utility classes (`bg-primary`, `text-muted-foreground`, etc.). Dark mode overrides go in `.dark {}`.

**Any new app** that uses `@osn/ui` components must define these CSS variables in its root stylesheet. Copy from `pulse/app/src/App.css` as the starting point.

## Adding a New Component

1. Create the file in `osn/ui/src/components/ui/<name>.tsx`
2. Follow the existing pattern: `splitProps` for `class`, compose with `cn()`, spread `...others`
3. For interactive components, use Kobalte primitives from `@kobalte/core/<name>`
4. For variant components, use CVA and export both the component and the `variants` function
5. Add a subpath export in `osn/ui/package.json`:
   ```json
   "./ui/<name>": "./src/components/ui/<name>.tsx"
   ```
6. No barrel file needed — consumers import individual components by path

## Testing Considerations

- Components render standard HTML — tests use `@solidjs/testing-library` with role/label queries
- **Kobalte portals**: Dialog and Popover content is portaled to `<body>`. Use `screen.queryByText()` (searches full document) instead of `container.querySelector()` (searches render container only)
- **Avatar DOM structure**: The `Avatar` wrapper is `span.relative`, not `span.inline-flex`. The fallback text is inside a nested `<span>`. Tests that need to find avatars should select `span.relative`
- **Close-friend ring**: Applied to the outer `Avatar` wrapper via `cn()`, not to the inner `<img>` or fallback `<span>`

## Source Files

- [osn/ui/src/components/ui/](../../osn/ui/src/components/ui/) — all component source
- [osn/ui/src/lib/utils.ts](../../osn/ui/src/lib/utils.ts) — `cn()` utility
- [osn/ui/package.json](../../osn/ui/package.json) — subpath exports
- [pulse/app/src/App.css](../../pulse/app/src/App.css) — CSS variable theme
