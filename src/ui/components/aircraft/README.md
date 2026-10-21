# Aircraft art and liveries

`AircraftArt` draws every type nose-RIGHT, in flight (no gear), from the traced profiles in
`traced/*.ts` (or the parametric spec in `specs/*.ts`) via `geometry.ts`. The outlines, noses,
windows and engines are approved artwork: **never change them** — `stickers.test.ts` hashes
`g.fus`, `g.fin.fill`, `g.windows` and every engine cowl and fails on any change.

**Fairing (v0.5.2)**: the traced top / bottom lines are drawn through `fairLine` (`fair.ts`): the nose
(x < 0.09 L) and the tail-cone tip (x > 0.975 L) stay exactly as traced; between them a stiff Whittaker
smoother (second + third differences, eased off at both junctions) keeps every point within 0.0012 L
(junctions) … 0.0032 L (cabin) of the trace — no crown / belly bumps. Fin vertices on the crown follow
it. The trace files stay the record; `fair.test.ts` checks the bounds per type. `?fair=0` in the gallery
draws the raw traces. Silhouette traces (`outline`, the Concorde) are not faired.

**Fairing**: traced crown / belly lines are faired in `fair.ts`; the crown is held straight over the
constant-section span `TracedProfile.cabin` (default `CABIN` 0.2–0.65 L; 747 aft of the hump).

**Level of detail**: windows and doors follow the drawn scale and screen density (`artLod(pxPerM, dpr)`,
measured after layout): `full` ≥ 8 CSS px/m, `card` (separate windows ≥ ~1 device px, darker door
outlines), `band` below 4.6 px/m at 1× or 5.2 device px/m on dense screens (each run of windows one slim
band, `g.windowBands`; the 2× iPad Fleet card and market rows keep separate windows). `detail="simple"` only drops titles and fine lines.

## Files

| File | What |
|---|---|
| `AircraftArt.tsx` | Colours, z-order, level of detail; the two sticker passes; auto ink colours (`autoFinInk`, `autoBodyInk`) |
| `geometry.ts` | Paths in metres (nose-left, y up). `fin.poly` = the fin fill outline as a polygon; `pathPoly(d)` samples any path it builds |
| `stickers.ts` | Sticker frames, coordinate mapping, fitting and layout (pure; tested) |
| `fontMetrics.ts` | Space Grotesk advances (500 / 700) and cap ink for text fitting without a DOM |
| `logos.ts` | The 15 original logos (`LOGOS`), `Monogram`, `LogoGlyph` |
| `../livery/*` | Editor sheet (`LiveryEditor`), `LiveryPreview`, `ColorPicker`, `LogoPicker`; styles in `styles/acmi/livery.css` |

## Livery (engine type `Livery`, `src/engine/core/types.ts`)

- `primary`, `secondary`, `tail` (`solid` · `split` · `stripe` · `sweep`): the scheme, as in v0.5.
- `plain: true`: all-white airframe — no scheme areas, white fin, grey engine bands. Stickers still draw.
  `WHITE_LIVERY` (`src/data/livery.ts`) is plain with `stickers: []` (nothing at all).
- `code`, `titles`: `{ text?, color?, weight? }`. Omitted text = the `code` / `name` props; omitted colour = auto contrast.
- `logo`: `{ id: LogoId | 'mono', color, color2?, text? }` (`mono` = roundel with 1–3 letters).
- `stickers`: up to 6 placements `{ id, kind: 'code' | 'titles' | 'logo', side: 'fin' | 'fuselage', x?, y?, scale, rotation? }`.
  Absent = the legacy look (`defaultStickers`: code on the fin + titles; with a logo, the logo takes the fin).

## Stickers

**Frames** (so one livery fits every type):
- fin: `x` = chord fraction leading edge (0) → trailing edge (1), `y` = root (0) → tip (1), bilinear on `fin.quad`;
- fuselage: `x` = fraction of L nose tip (0) → tail (1), `y` = fraction of H crown line (0) → belly line (1).
- `x`/`y` omitted = auto: the code sits in the biggest box inside the real fin outline around the scheme's
  anchor (`finInset`, 4 % chord margin, per-glyph widths); a fin logo takes the biggest square in the fin;
  titles start behind the forward door in the title band, as v0.5.

**Scale** 1 = fits its zone (0.3–3); **rotation** ±45° clockwise.

**Clipping** — the fix for letters floating off the fin: every sticker is drawn twice, clipped to the
fuselage (`fc`; outline mode also `tz`, never on the Concorde delta) and to the fin (`tc`). A decal that
straddles the fin root reads as one, and nothing ever paints outside the airframe, at any size or position.
Windows, doors and cockpit draw over fuselage stickers; wing, stabiliser and engines pass in front.

**Coordinates**: geometry is nose-left; the art mirrors it once, so geometry `(x, y)` is viewBox `(-x, -y)`.
All `stickers.ts` exports speak viewBox coords: `frameToView` / `viewToFrame` (inverse bilinear on the fin),
`sideAt`, `placeAt` (drag → side + clamped frame coords), `stickerLayout` (boxes in draw order),
`hitBox`, `snapTargets`, `airframeClipPaths`. Text never mirrors.

**Detail `simple`** (≤ 120 px): fin stickers stay; fuselage text drops; fuselage logos stay if ≥ 6 % of L;
windows and doors stay (as bands at small sizes).

**Auto ink**: fin text uses the accent when it reads on the fin (2.2:1), else white / ink; on a split or
stripe area it switches, and a box straddling the divide gets the colour that reads on both. Fuselage text
uses the primary unless it vanishes on white.

## Editor (`LiveryEditor`)

Host owns `value` and persists it (`onChange` fires per animation frame while dragging). One finger drags
a sticker (hit boxes padded to 44 px), two fingers pinch its size, ctrl+wheel on desktop; within 8 px the
centre snaps to the fin inset / title band / window line and a cyan guide shows. While selected, the whole
sticker shows faintly outside the airframe, so the trim is visible. Tabs: Scheme (+ White), Colours, Text
(text, colour with Auto + custom picker and contrast warning, weight), Logo, Layout (show/hide, size, tilt,
add logo to fin / fuselage, reset). `mode: 'aircraft'` adds the Company · All white · Custom header and a
lock message (client paint).

## Gallery checks (`/gallery.html`)

- `?types=a,b&livery=blockhours|redsplit|greenstripe|navysolid|used|white|logo|plainlogo|stickers&bg=dark,blue&size=hero,card,mini&compare=1`
  — `&logo=<id>|mono &plain=1 &tail=<scheme> &codecolor=%23hex &weight=500` override the livery.
- `?gallery=logos[&types=a320ceo,b77w]` — the 15 logos at 64 / 28 / 14 px, tail badges, each logo on each type's tail.
- `?gallery=float[&codes=WW,MQ,XQZ]` — tail code in every scheme; with a scratch copy of the v0.5 renderer at
  `aircraft/zzLegacyArt.tmp.tsx` (not committed) it shows v0.5 | now side by side.
- `?gallery=clip[&stickers=0]` — magenta stickers at scale 3 in the corners (`stickers=0` = the silhouette mask);
  diff the two screenshots: no magenta pixel may fall outside the mask.
- `?gallery=editor[&livery=…]` — the editor sheet with local state (`#g-livery-json` holds the value).
- `?gallery=lod[&types=…&detail=simple]` — each type at 60…720 px wide (window / door level of detail).
- `?gallery=crown[&types=…][&fair=0]` — each type 1150 px wide, for crown / belly / tail-cone checks (raw with `fair=0`).
- `?gallery=compare&type=<id>`, `?gallery=sheet` — traced-profile reference overlays (see `src/dev/gallery.tsx`).
