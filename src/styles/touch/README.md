# Touch / iPad styles

BLOCK HOURS targets an iPad (11", 1180×820 landscape, 820×1180 portrait, DPR 2) played with
fingers, in Safari, as a home-screen web app and inside the Claude app's artifact viewer,
while desktop (1440×900, mouse) keeps its look. These files adapt the base design system
(`../app.css`) and screens (`../screens.css`) and load after them, in this order:

| file        | owner      | covers |
|-------------|------------|--------|
| `shell.css` | foundation | top bar, sidebar / rail, ticker, compact bars, More sheet, dialog frame, toasts |
| `start.css` | start      | Loading, Title, New Game, Dashboard (HQ), Goals, Inbox, Finance, Intel, charts |
| `map.css`   | map        | Network Map (MapScreen, WorldMap), Routes, route detail, Route Planner |
| `ops.css`   | ops        | Fleet, Market + Order / Buy-used / Lease, Expansion, Brand, game-modal content |

Edit only your own file. Don't touch the cabin editor / seat map / aircraft art rules.

## Layout tiers

Copy these queries exactly (they mirror `src/ui/useMedia.ts`):

| tier      | query | where | shell |
|-----------|-------|-------|-------|
| `wide`    | `(min-width: 1100px) and (min-height: 500px)` | iPad landscape, desktop | 220px sidebar with labels, top bar, news ticker |
| `medium`  | `(min-width: 700px) and (max-width: 1099.98px) and (min-height: 500px)` | iPad portrait, artifact viewer | 80px rail (icon over short label), top bar, ticker |
| `compact` | `(max-width: 699.98px), (max-height: 499.98px)` | Split View, Slide Over, phones | two-row top bar, bottom tabs + More sheet (side rail when < 500px tall); no ticker |

- "medium or narrower": `@media (max-width: 1099.98px), (max-height: 499.98px)`.
- Orientation, when it matters on top of a tier: `(orientation: portrait)`.
- The shell itself carries `.shell.wide` / `.shell.medium` / `.shell.compact(.short)`, but
  screens should use the queries (content may also render outside the shell).

Space available to a screen (`.main`, CSS px):

| view | viewport | `.main` |
|------|----------|---------|
| landscape (home-screen app) | 1180×820 | 960×716 (standalone: 960×672) |
| Safari landscape | 1180×750 | 960×646 |
| portrait (home-screen app) | 820×1180 | 740×1076 (standalone: 740×1032) |
| Split View | 590×820 | 590×~650 |
| desktop | 1440×900 | 1226×810 |

Use the room: two or three columns in landscape, stacked or two columns in portrait.
`.grid-2/3/4` already collapse at 1100px and 720px.

## Touch

`html.touch` is set while `(hover: none) and (pointer: coarse)` matches (forced for testing with
`?touch` or `window.__CONTRAIL_FORCE_TOUCH__`). Write touch rules as `.touch .thing { ... }`.
In React: `useTouch()`; tiers: `useTier()` / `tierNow()`; any query: `useMedia(q)`.

- Hover effects only inside `@media (hover: hover) { ... }`; never a bare `:hover` (it sticks
  after a tap on iOS). Give tappable things an `:active` pressed state instead.
- Tap targets: 44px (`--tap`) for buttons; 36px (`--tap-dense`) only for dense segmented
  controls and table-row actions. Already handled globally on touch: `.btn` 44, `.btn-sm` 40,
  `.btn-xs` 36, `.btn-icon` 44×44, `button.chip` 40, `.tab` 40, `.seg button` 40, `.stepper`
  buttons 44×44, `.toggle` 64×44 hit area, `.input`/`.select` 44 (16px text, so iOS never
  zooms), range thumbs 26px, `.table td` 12px padding, `tr.clickable` 52px.
  Custom controls (`.something` buttons, list rows that act as buttons) need their own sizing.
- Type: body 14.5px, secondary text >= 12px (`.tiny`, `.upper`, `.kpi-label`, table headers are
  bumped to 12px on touch). Anything at 10–11.5px in screens.css needs a `.touch` override.
- No information only in `title=` or hover tooltips. `data-tip` / `title` on non-interactive
  elements show a callout on tap (TapTip in Toasts.tsx); prefer visible text where it matters.
- `user-select: none` + `-webkit-touch-callout: none` are set on chrome and controls; content
  text stays selectable.
- Wide content (tables, boards) scrolls inside its own `overflow-x: auto` wrapper; the page
  never scrolls sideways. Use `overscroll-behavior: contain` on inner scrollers.
- Keep primary actions reachable: sticky headers/footers inside long panels where it helps.

## Safe areas & tokens (app.css `:root`)

- `--safe-t/r/b/l`: insets the in-flow layout must clear. Home-screen app on iPad: 24px top
  (status bar), 20px bottom (home indicator). The shell already clears them; full-screen
  pre-game screens (Title, New Game) must clear them themselves.
- `--vp-safe-t/b`: viewport insets for `position: fixed` layers (the artifact host pads the
  page top/bottom itself, so there `--safe-t/b` are 0 but `--vp-safe-t/b` are not).
- `--edge-l/r`: `max(16px, inset)`, for things touching the physical screen edges.
- `--main-pl/pr/pb`: `.screen` padding per tier (`--main-pr` includes `--safe-r`).
- `--topbar-h` (58, touch 64), `--ticker-h` (32, touch 40), `--side-w`, `--tabbar-h` (58).
- Never use `env()` directly: the harness simulates insets by overriding these tokens.

## Dialogs

`<Modal>` (components/ui.tsx) gives every dialog: width by `size` (normal 600 on touch,
`wide` 900, `xwide` 1180), header with a 44px close button and footer that stay put while only
`.modal-body` scrolls, `max-height` within the safe areas, a bottom sheet with a drag-to-dismiss
grip on compact, and on-screen keyboard handling (the dialog shrinks to the visible area and
the focused field scrolls into view). Put actions in `footer`, not at the end of the body.

## Checking your work

```
node scripts/ipad-shots.cjs --url http://localhost:<port>/ --out <dir> \
  --view landscape,portrait,safari,split --screens <yours> [--standalone | --embed] [--size 700x600]
```

Look at every PNG and fix what the report flags: horizontal overflow, elements beyond the
viewport, targets under 40×40, text under 12px, errors. `node scripts/ipad-shots.cjs --help`
lists views and screens.

## Devices and UI size (v0.12, `src/ui/device.ts`, `src/styles/acmi/devices.css`)

- `<html data-device="iphone|ipad|android|mac|windows|other" data-form="phone|tablet|computer"
  data-input="touch|mouse|hybrid" data-standalone>` from UA Client Hints, platform/UA, touch points and the
  any-pointer queries (never the screen size). Settings › Display › Device overrides it. Use these only where a
  device really needs its own treatment; the tiers above stay the main mechanism.
- Phones and tablets keep `html.touch` with a keyboard and trackpad attached.
- Phone landscape is `@media (max-height: 499.98px)`: the rail runs the full height, screen heads are one line,
  toolbars scroll sideways. Upright phones get the RotateHint card.
- Settings › Display › Size zooms `<html>` (CSS `zoom`). Pointer and rect values are then screen px: convert with
  `toCss()` / `cssRect()` from device.ts before using them as page px (positions, widths, time-per-px), and use
  `var(--app-h)` / `var(--app-w)` instead of `100dvh` / `100vw`.
- Check every screen at the iPhone, Mac and Windows sizes, light and dark:
  `node <notes>/.handover/updates/shots-devices/device-check.cjs --url http://localhost:<port>/`.
