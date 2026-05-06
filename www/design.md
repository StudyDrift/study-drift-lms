# Lextures Marketing Site — Design System

Inspired by the OpenSwarm aesthetic: clean, minimal, purposeful. No dark mode. Built for institutional credibility, not visual novelty.

---

## Core Principles

- **Light over dark.** White and near-white backgrounds. Sections differentiate through subtle surface tones, not color drama.
- **Typography-first.** Hierarchy is earned by font weight and size, not gradient text or glow effects.
- **Borders over shadows.** Prefer a 1px border to deep drop shadows. Shadows are `shadow-sm` at most.
- **Generous whitespace.** Sections breathe. Content is not crowded.
- **One accent color.** Indigo (`#4f46e5`) is used sparingly — buttons, icons, highlights only.

---

## Color Palette

| Token           | Value       | Use                                     |
|-----------------|-------------|-----------------------------------------|
| `bg-white`      | `#ffffff`   | Page background, card backgrounds       |
| `bg-surface`    | `#f8fafc`   | Alternate section backgrounds           |
| `bg-surface-2`  | `#f1f5f9`   | Subtle insets, quote blocks             |
| `border-default`| `#e2e8f0`   | Card borders, section dividers          |
| `text-primary`  | `#0f172a`   | Headings, high-importance text          |
| `text-body`     | `#334155`   | Body copy                               |
| `text-muted`    | `#64748b`   | Captions, secondary labels              |
| `text-faint`    | `#94a3b8`   | Timestamps, footnotes                   |
| `accent`        | `#4f46e5`   | Primary buttons, icon backgrounds, links|
| `accent-hover`  | `#4338ca`   | Button hover state                      |
| `accent-light`  | `#eef2ff`   | Icon container backgrounds, tinted cards|
| `accent-border` | `#c7d2fe`   | Accent-adjacent borders                 |

---

## Typography

**Fonts loaded:** DM Sans (body, UI), Instrument Serif (display/hero emphasis)

| Role          | Family            | Weight | Size (desktop)  |
|---------------|-------------------|--------|-----------------|
| Hero H1       | Instrument Serif  | 400    | 52–60px, italic |
| H2 (section)  | DM Sans           | 700    | 36–40px         |
| H3 (card)     | DM Sans           | 600    | 18px            |
| Body (large)  | DM Sans           | 400    | 18–20px         |
| Body (default)| DM Sans           | 400    | 15–16px         |
| Eyebrow       | DM Sans           | 500    | 13px, uppercase, letter-spacing |

---

## Spacing

- Section vertical padding: `py-24 sm:py-32`
- Container: `max-w-6xl mx-auto px-4 sm:px-6 lg:px-8`
- Card padding: `p-6 sm:p-7`
- Grid gap: `gap-5` (cards), `gap-8` (major layout splits)

---

## Components

### Buttons

**Primary:**
- `bg-indigo-600 text-white rounded-md px-6 py-3 text-sm font-semibold`
- Hover: `bg-indigo-700`
- No glow, no scale animation — just a clean color shift

**Secondary:**
- `border border-slate-300 bg-white text-slate-700 rounded-md px-6 py-3 text-sm font-semibold`
- Hover: `border-slate-400 bg-slate-50`

### Cards

- `bg-white border border-slate-200 rounded-xl p-6 shadow-sm`
- Hover: `hover:border-indigo-200 hover:shadow-md` (subtle lift)
- No glassmorphism. No backdrop blur.

### Feature Icon

- Container: `h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center`
- Icon: `text-indigo-600 h-5 w-5`

### Nav

- Sticky, `bg-white/95 backdrop-blur-sm border-b border-slate-200`
- Links: `text-slate-600 hover:text-slate-900 text-sm font-medium`

### Section Dividers

- Alternate sections use `bg-surface` (`#f8fafc`) — no border required
- When borders needed: `border-t border-slate-200`

---

## What Was Removed

- Dark backgrounds (`bg-slate-950`, `bg-bg-deep`)
- Glass panels (`backdrop-blur`, `bg-white/[0.03]`)
- Noise texture overlay
- Radial gradient glows
- `rounded-full` pill buttons (replaced with `rounded-md`)
- `text-gradient` shimmer on hero text
- Sky-blue glow shadows (`shadow-[0_0_24px...]`)
- `ring-1 ring-white/10` treatment
