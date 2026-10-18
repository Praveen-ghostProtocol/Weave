# DESIGN.md — Weave v0

Scope: a canvas, a form, a sidebar, an empty state. Four surfaces, one
sitting. This is not a marketing site — no hero, no sections, no scroll
story. Treat anything below as a rule for *those four surfaces only*.

**Design read:** a private, utility tool for mapping out who you are —
closer to a drafting table or a field notebook than a SaaS dashboard. Calm,
legible, a little personal. Not playful, not corporate.

---

## 1. Type

Two fonts, both via `next/font/google` (self-hosted, no `<link>` tags):

- **IBM Plex Sans** — UI text, labels, node titles, markdown body in the
  editor. Humanist, legible at small sizes, has more character than Inter
  without tipping into "designed."
- **IBM Plex Mono** — numbers only: the export char/token counter, node
  counts, timestamps. Monospace makes a running count readable as it
  changes instead of jittering the layout.

No serif anywhere. This is a tool, not a journal app — don't reach for
"personal = editorial serif."

Scale (desktop; shrink by ~1 step on mobile, don't reflow the ratio):

| Role | Size / weight |
|---|---|
| Empty-state headline | 22px / 600 |
| Panel section title (editor, sidebar) | 15px / 600 |
| Node title (canvas card + editor title field) | 14px / 600 |
| Body / form text | 14px / 400, line-height 1.5 |
| Domain tag, meta, timestamps | 12px / 500, Plex Mono, tracking slightly open |
| Export char/token counter | 13px / 500, Plex Mono |

No `text-6xl` anything. The biggest text on the page is 22px.

## 2. Color — "graphite & moss"

One accent, used identically everywhere (buttons, selected-edge highlight,
focus rings, the export CTA). Flat color, no gradients.

| Token | Light | Dark |
|---|---|---|
| `--surface` (canvas background) | `#F4F3F0` cool stone | `#1A1B17` graphite |
| `--surface-raised` (panels, node cards) | `#FFFFFF` | `#22241E` |
| `--ink` (primary text) | `#211F1B` | `#ECEAE3` |
| `--ink-muted` (secondary text, placeholders) | `#6B6A63` | `#9B9A8F` |
| `--line` (borders, edges, dividers) | `#DEDCD5` | `#34362E` |
| `--accent` (moss green — actions, active edge, focus) | `#3D5A45` | `#74AE87` |
| `--danger` (delete confirm only) | `#A23B2E` | `#D97862` |

Why moss green, not SaaS blue/purple: the product is about mapping a person,
not selling software. Blue-purple glow reads as "AI tool." Flat moss green
on warm stone reads as ink on a map — intentional, not templated. No second
accent. Domain tags get a single neutral chip style (`--line` border,
`--ink-muted` text) — don't build a rainbow tag-color system for v0, nobody
asked for it and it's one more thing to keep consistent.

## 3. Shape & elevation

One radius scale, no exceptions:
- `8px` — node cards, panels, the editor surface.
- `6px` — inputs, buttons.
- full / pill — tag chips only.

No drop shadows for hierarchy. Use 1px `--line` borders instead — flat,
blueprint-like. The only shadow allowed is a soft `0 1px 3px` on the node
editor/export panel *when it overlays the canvas* (so it visibly floats
above it), tinted toward `--ink` at low opacity, never pure black.

## 4. The three surfaces

**Canvas (graph view).** Full-bleed, `--surface` background with a faint
dot grid (`--line` at ~40% opacity, 24px spacing) so empty canvas doesn't
look broken, just unpopulated. Nodes are flat cards: title + domain tag
chip, 8px radius, 1px border, no shadow at rest; a 2px `--accent` border on
hover/selected. Edges are 1.5px `--line` lines that turn `--accent` when
either endpoint is selected. No minimap, no zoom controls cluttering the
corner beyond react-flow's default — this product has tens of nodes, not
hundreds, it doesn't need cockpit chrome.

**Node editor.** A fixed-width (~420px) panel, not a modal — modals block
seeing the graph you're editing, which matters when you're linking nodes.
Slides in from the right, `--surface-raised`, generous 24px padding. Form
rhythm: label above input (never placeholder-as-label), 8px gap between
label and field, 20px gap between fields. Title field and domain-tag field
are compact at the top; the markdown body textarea takes the remaining
height of the panel — this is the one field that matters most, let it
breathe. Save/cancel pinned to the bottom of the panel, not floating.

**Export sidebar.** Narrower (~320px), `--surface-raised`, a checkbox list
of nodes (no canvas multi-select per plan.md) with a sticky running counter
at the top in Plex Mono ("~1,240 characters / ~310 tokens") that updates
live as selection changes. The export action is a single full-width button
at the bottom, disabled (not hidden) at zero selection with `--ink-muted`
text so it's visibly inert rather than visibly broken.

**Export sidebar — AI draft assist (addendum).** Raw export stays exactly as
above and stays primary — it's the zero-setup default. AI draft assist adds
to this sidebar, it doesn't get its own surface, its own route, or a
different visual language. No message bubbles, no avatar, no "AI is
typing" animation — this is a second button and a text result, not a chat
product.

- **API key — a settings affordance, not a form field in the main flow.**
  A small icon-only button (Phosphor `Key`, 16px, ghost — no border at
  rest) sits in the sticky header next to "Select all / Select none". Its
  tint *is* the key-status indicator: `--ink-muted` when no key is stored,
  `--accent` when one is. Click expands an inline row directly below the
  header (pushes the checkbox list down, nothing floats over the canvas):
  a labeled `type="password"` input ("Anthropic API key"), a "Save" button,
  and a "Clear" text link. Helper text below the input, 12px `--ink-muted`:
  "Stored only in this browser. Used only to call Anthropic directly." Save
  collapses the row back to the icon. This is the only place the key is
  ever shown or edited — never surfaced in the export flow itself.
- **The action pair.** The footer below the checkbox list now holds two
  stacked, full-width, same-height buttons, 8px gap: "Export selection"
  (unchanged — filled `--accent`, primary) above "Draft with AI" (secondary
  — 1px `--line` border, `--ink` text, transparent fill). Same disabled
  treatment at zero selection as today (`--ink-muted` text, `--line`
  border). The outline-vs-filled distinction is the only new visual
  grammar, and it reuses tokens the disabled state already established
  (muted border+text = inert, full-contrast border+text = enabled-but-
  secondary) — no new color, no new radius.
- **No key set.** "Draft with AI" stays enabled-looking (not greyed — this
  isn't a broken state, it's a discoverable one). Clicking it with no key
  stored expands the settings row above (per above) and focuses the input,
  instead of firing a request. No silent no-op, no crash.
- **Loading.** Button label swaps to "Drafting…", button disabled for the
  duration. No spinner glyph, no shimmer — matches the existing
  "Export selection" → "Copied" label-swap pattern already in this sidebar.
  One state-machine idiom for both buttons, not two half-finished ones.
- **Error.** Button label swaps to "Draft failed — try again",
  `--danger`-tinted border (same `data-state="error"` pattern the export
  button already uses), plus one inline line of actual error text below the
  footer (bad key vs. rate limit vs. network — whichever it was, not a
  generic "something went wrong").
- **Result.** On success, a result block appears *above* the footer
  buttons (between the checkbox list and the action pair, inside the same
  panel — not a new overlay, not a modal): a small "AI draft" label, a
  "Copy" text button beside it, a dismiss (×), and a read-only, selectable
  text block (`max-h-60 overflow-y-auto`, 14px Plex Sans — it's prose, not
  data, so it doesn't get Plex Mono) holding the synthesized brief. Copy
  copies just that text, independent of the raw-export clipboard state.
  Dismissing clears the result without clearing the selection, so the user
  can immediately try raw export or redraft.

Shared layout rule: canvas is the base layer; editor and export sidebar are
panels that sit on top of it from opposite edges, never a third column that
permanently shrinks the canvas. Only one panel open at a time on narrow
viewports.

## 5. Empty state

Not "No nodes yet." This is the moment someone opens the app for the first
time and the product has to say what it's for in one line. On the empty
canvas: the dot-grid background (already there, not a special empty-state
asset), centered, max 2 lines —

> **Start mapping who you are.**
> One node per part of your life — work, people, projects. Link them as you go.

— and a single button, "Add your first node." No illustration, no
placeholder ghost cards, no sad-folder icon. The dot grid itself is the
visual: it's the same canvas you'll fill in, just empty, which is a more
honest empty state than a bespoke graphic that disappears the moment it's
populated.

## 6. Motion

Minimal and functional only: panel slide-in/out (~200ms, ease-out), node
hover/selected border transition, button `:active` → `scale-[0.98]`. No
scroll-triggered anything (there's no scroll — it's a canvas and two
panels). Honor `prefers-reduced-motion`: panels appear instantly, no
transform transition. Animate `transform`/`opacity` only.

## 7. Accessibility baseline (non-negotiable, not style)

- Real `<button>` for actions, visible focus ring in `--accent` on every
  interactive element (canvas nodes included — they're keyboard-selectable,
  not just draggable).
  - **Provide a non-drag way to position/select nodes** — react-flow drag
    is mouse-only; arrow-key nudge or a keyboard-accessible node list is
    needed so this isn't drag-or-nothing (flagging per web-design-guidelines'
    drag/gesture rule — see Open Questions).
- Label above every form input, errors inline below the field, not a toast.
- Node delete (cascades edges, per spec) requires a confirm step — it's
  destructive and silent data loss is explicitly prohibited.
- Warn before navigating away with an unsaved node edit open.
- Contrast: body text and `--ink-muted` both meet WCAG AA against
  `--surface` and `--surface-raised` in both modes — verify this once real
  Tailwind tokens are set, the hexes above were picked for it but weren't
  run through a checker.
- API key input is `type="password"` (no plaintext key visible over a
  shoulder) but has a visible label, not placeholder-as-label, same as
  every other field. The key-status icon's color difference is not the
  only signal — it also needs a text equivalent (`aria-label`/`title`:
  "API key set" / "No API key set") since color alone isn't an accessible
  state indicator. A draft error is announced (e.g. `role="alert"` or
  `aria-live="polite"` on the inline error line), not just visually swapped
  in, so it isn't silent for screen-reader users either.

## 8. Explicit avoid list

Don't reach for any of these — they're the default moves that make a tool
like this look AI-templated instead of designed:

- **Bento grids.** Nothing here is a marketing feature grid.
- **Centered-hero-with-two-buttons.** There's no hero. The empty state is
  not a landing page.
- **Gradient blobs / mesh backgrounds / glow effects.** Flat color only.
- **Generic shadcn-default look** (if shadcn/ui components are used,
  restyle radius/color/shadow to the tokens above — don't ship default
  `zinc` theme with default blue focus rings).
- **Emoji as icons.** Use one icon library (Phosphor or Tabler — pick one,
  don't mix) at a consistent stroke width. No 🔗 for "link," no 📝 for
  "edit."
- **Decorative eyebrows / section numbering / status dots.** This is a
  3-surface tool, not an 8-section page — there's nothing to label "001."
- **Card-on-card elevation theater.** One radius, one border style, no
  stacked shadows to fake depth.
- **SaaS blue/purple as a default accent "because that's what tools look
  like."** The accent is moss green, specified above, everywhere.
- **A bespoke "no data" illustration for the empty state.** Use the actual
  canvas, per Section 5.
- **Chat-app visual language for AI draft assist.** No message bubbles, no
  avatar/chat-head icon, no "AI is typing" shimmer or animated dots. It's a
  button and a text result in the existing export sidebar, not a chatbot
  bolted onto the side.

---

## Resolved

1. **Keyboard alternative to drag-positioning nodes**: a focused node moves
   with arrow keys (large step with Shift held). No separate keyboard-only
   node list needed for v0 — arrow-key nudge is the whole requirement.
   Folded into Task 11 (graph view)'s acceptance criteria.
2. **Icon library**: Phosphor Icons (`@phosphor-icons/react`), regular
   weight only, no duotone/fill — fits the flat, no-shadow-theater look.
   Added to Task 2's dependency list.

Everything else above is intentionally decided, not left open — this is a
4-surface tool; there wasn't much room for ambiguity.
