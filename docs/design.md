# Lextures — visual design system

This document describes the product UI direction for the Lextures learning management system. It is inspired by modern **SaaS dashboard** patterns: calm, structured, and content-first.

## Design intent

- **Light-first**: Primary workspace sits on white (`#FFFFFF`) with generous whitespace.
- **Layered surfaces**: Sidebars and secondary regions use a subtle cool gray (`#F8F9FA` range) to separate navigation from content without heavy chrome.
- **Soft depth**: Cards and elevated surfaces use **thin borders** (`slate-200`–`slate-100`) and **very soft shadows**—enough to read hierarchy, not a “neumorphic” stack.
- **Friendly geometry**: **12–16px** corner radius on cards, inputs, and primary controls; pill-shaped search and secondary actions where it fits.

## Color


| Role                   | Usage                                  | Reference                                                                      |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------ |
| **Primary accent**     | Primary buttons, active nav, key links | Indigo / violet family — e.g. `#6366F1` (Tailwind `indigo-500` / `indigo-600`) |
| **Success / progress** | Positive metrics, completion           | Teal / emerald (`teal-500`–`600`)                                              |
| **Warning**            | Low-urgency tags, cautions             | Amber (`amber-500`)                                                            |
| **Text primary**       | Headings, emphasis                     | `slate-900`                                                                    |
| **Text secondary**     | Descriptions, metadata                 | `slate-500`–`slate-600`                                                        |
| **Borders**            | Dividers, card outlines                | `slate-200`                                                                    |
| **Page background**    | Main canvas behind content             | White or `slate-50`                                                            |


Avoid pure black text; **slate-900** keeps contrast high while staying soft.

## Typography

- **Font stack**: A contemporary **sans-serif** optimized for UI—e.g. **Plus Jakarta Sans** or **Inter** (variable weights, clear at small sizes).
- **Headings**: Semibold, tight tracking (`tracking-tight`) for page titles.
- **Body**: Regular/medium for UI labels; **muted gray** for helper and timestamp text.

## Layout

- **App shell**: Fixed **left navigation** + **scrollable main column**. Main column may include a **top bar** (search, workspace context, primary actions).
- **Content**: Prefer **card grids** for lists and summaries; align to a consistent horizontal rhythm (`px-6` / `p-8` on desktop).

## Components

### Navigation (sidebar)

- Light gray background, **right border** only.
- Items: icon + label, **rounded** hover (`hover:bg-white` or `hover:bg-slate-100`).
- **Active** state: light indigo wash (`bg-indigo-50`) + **indigo** text and icon—not a heavy filled bar unless the pattern is icon-only.

### Top bar

- White background, **bottom border**, optional **shadow-sm**.
- **Search**: Rounded field, muted fill (`bg-slate-100`), placeholder in `slate-500`.

### Buttons

- **Primary**: Filled indigo, white text, rounded-lg or rounded-full for prominent CTAs.
- **Secondary**: Outline (`border-slate-200`) or ghost on light surfaces.

### Cards

- **White** surface, `rounded-2xl`, `border border-slate-200`, `shadow-sm`.
- Optional header art or illustration band; metadata row at bottom in **smaller, muted** type.

### Forms (auth and settings)

- Centered **card** on a very subtle tinted or radial background (optional).
- Inputs: white fields, **slate-200** border, **indigo** focus ring.

## Iconography

- **Line-style** icons (e.g. Lucide), consistent stroke; active state inherits accent color.

## Accessibility

- Maintain **WCAG contrast** for text on `slate-50` / white / indigo buttons.
- Visible **focus** styles (ring) on links and controls; semantic headings and `nav` labels.

## Implementation notes

- Tailwind utility classes map the palette above (`slate-`*, `indigo-*`, `teal-*` for positive metrics).
- Global font and `body` background are set in `clients/web/src/index.css`; page shells live under `clients/web/src/components/layout/`.