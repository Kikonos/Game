# Aircraft art and liveries (v0.10 sprites, v0.11 painting)

`AircraftArt` draws the player's final aircraft art, nose RIGHT, in flight: one sprite per type (and per airframe
variant), **exactly as drawn** — the art is never changed. The livery is *painted* on (compose.ts + paintModel.ts):
fin, fuselage and engine cowls, through the sprite's own light, with the titles, tail code and logos painted in as
decals before the light, so they carry the same shading, panel lines, doors and windows.

## Pipeline (`scripts/sprites.py`)

`python3 scripts/sprites.py <input-dir> [--check <dir>] [--only id,id]` (numpy, scipy, scikit-image, Pillow with
WebP). Input: `sprites/<id>.png` and `masks/<id>-mask.png` (4096 × 1640, flat #00FF00 background). The Gemini masks
(fin #FF0000, engines + pylons #0000FF) are imprecise and are only **hints**: which piece above the crown is the fin,
roughly where the engines and pylons are. It rewrites `public/aircraft/` and `sprites.gen.ts`:

1. keys the green out (alpha from the green excess, solid inside), unmixes the edge colour and removes green spill,
   trims to the aircraft with a 1.2 % even margin; writes `<id>-2048.webp` / `<id>-1024.webp` (lossy colour q86,
   lossless alpha); identical sprites (a359 / a359ulr) share one set (`same`);
2. **paint regions** (`segment`), at the art's own resolution (~3770 px): every edge between regions is a watershed of
   the luminance gradient, so it lands on a drawn outline. Seeds:
   - **fin** — the airframe above the fuselage's crown curve (the cabin crown fitted ahead of the fin, joined by a
     cubic to the tail-cone top behind it), from the tail to where the dorsal fillet meets the cabin: the whole drawn
     fin, rudder and fillet, no sky, no stabiliser, up to the drawn outline;
   - **body** — pixels lit like the white tube at their height (the cylinder shading P(t) measured on clean cabin
     columns; looser on the tail cone), plus compact bright pieces framed by an outline (doors, exits, fairing
     panels); the nose and radome are always body; the wing-body / belly fairing and the stabiliser's root fairing
     are fuselage (grown from the body over pixels lit like it, no outline between), winglets and aerials above the
     crown never;
   - **unpainted** — much darker than the tube there (wing, stabiliser, shadows), anything grey outside the tube;
   - per engine (`scripts/sprites-paint.json` `eng`: cowl trailing edge x, lip front x, cowl top y — the trailing
     edge snapped to the strongest dark→bright step within 6 px) the **cowl** between them, the **exhaust**
     (nozzle, plug) behind it and the **pylon** above it (inside Gemini's blue); hard limits after the watershed: no
     cowl behind its trailing edge or above its top, no fuselage inside the nacelle outline; the **lip** = the front
     7.5 % of each cowl row (follows the lip's curve);
   - clean-up: thin drawn lines with the same paint both sides take it; small unpainted pieces framed only by paint
     (and not by the sky) take it; the outline fringe takes the nearest solid label;
   - per-sprite corrections: `seed` (watershed seeds — the edge still follows the drawn outline) and `force`
     polygons (2048-px coordinates) in `scripts/sprites-paint.json`;
3. writes `<id>-mask.png` (2048 wide RGB: R fin, G body, B cowl incl. lip; box-filtered coverage = anti-aliased;
   never overlapping; 0 off the silhouette) and `<id>-shade.webp` (1024 wide grey, lossy q95: the painting model's
   light, see below, over each region's lit white × 255 / 1.25; the whites go in the data as `white`);
4. measures the layout: nose / tail x, crown and belly lines, the fin outline and frame quad, the sticker zone, the
   window line, the title band, the tube (`body`: crown / belly every 8 px, for the paint geometry), the engines
   (`eng`: cowl trailing edge, lip front, lip width).

`--check <dir>` writes `mask-<id>.png` (fin red, body green, cowl blue, lip gold, exhaust purple, pylon cyan,
unpainted as drawn, region edges yellow) and `mask-<id>-2x.png` (2× crops with a 10-px grid: fin tip, fin root /
stabiliser / tail cone, wing-body fairing and belly, every engine incl. the exhaust, nose). Current set:
`.handover/updates/shots-paint/masks/`. The 4096 px originals are not in the repo (`.handover/updates/sprites-src/`).
About 3.0 MB for the whole set (art 2.3 MB, masks 0.4 MB, shading 0.3 MB).

## Painting model (`paintModel.ts`, pure)

Per region the art is split into a smooth **shading** S (its linear luminance after a 13-px grey closing — windows,
door and panel lines, aerials out — blurred inside the region only, over the region's own lit white: the fin is
drawn a little greyer than the fuselage, one paint must look one colour) and the **detail** (the pixel against S).
A painted pixel = the paint colour lit by S through a curve that is steeper for dark paints (S^(1 + 0.9 (1 − √L)),
so navy keeps the cylinder shading and the lit top) with a faint sky sheen screened on the lit top of dark paint,
times the art over its shading (every line, door, window stays), dark detail pressed in a little more on dark paint
(lines still read on navy), glints screened on. White paint gives the art back exactly; plain = the untouched sprite.
S comes from `<id>-shade.webp` (built once); without it `shadingOf` computes it in the browser (≈ 0.6 s per 2048
sprite). One composed bitmap per sprite + width + paint key (colours and decals), LRU 120; art, mask and shading are
kept per sprite/width for the last 4.

## Files

| File | What |
|---|---|
| `AircraftArt.tsx` | `<svg>` in the sprite's 2048-px frame: the painted bitmap (decals included) as `<image>`; the sticker being edited (and all stickers until the bitmap is ready) drawn live on top, clipped to the fin and the fuselage zone; editor ghost and guides |
| `stickerInk.ts` | Ink choice for the stickers (`stickerInk`, `stickerGround`): the paint under them |
| `paintModel.ts` | The painting model (pure): `shadingOf`, `shadingFromField`, `paintRegions` |
| `compose.ts` | Paint layers (fin scheme, body layers, cowl + intake lips, decals: text in Space Grotesk, logos as Path2D) → `paintRegions` → one bitmap per sprite + width + `paintKey` (object URL, LRU 120) |
| `bodyPaint.ts` | v0.10 body paint geometry (pure): the tube at x, belly split, stripes (window line, sweep into the fin), nose; `bodyColourAt` for sticker inks |
| `sprites.ts` | Sprite ids, asset URLs (art, mask, shade), layout lookup, real lengths (`LENGTH_M`, `metresPerPx` for same-scale views), `BODY_PAINT` |
| `sprites.gen.ts` | Generated layout data (do not edit) |
| `stickers.ts` | Sticker frames, fitting, layout, the tail schemes on the fin (`finSecondAreas`) — pure, tested |
| `ink.ts` | Colour helpers and auto ink (`autoFinInk`, `autoBodyInk`, `contrast`) |
| `fontMetrics.ts`, `logos.ts` | Text fitting without a DOM; the 15 logos |
| `../../../data/variants.ts` | Airframe variants (engines, door layout) → sprite, engines text, exit limit |

Size: the 1024 asset for cards and rows, the 2048 once the drawn width passes 1100 device px (never steps down).
`pxPerM` sizes the art by the real aircraft length (A320 37.6 m … 747-8 76.3 m).

## Livery

- Fin (mask red): the livery's `primary`, with the scheme's second-colour areas (`split` / `stripe` / `sweep`) in
  `secondary`, and swept stripes on top; painted through the art's light (above).
- Fuselage (mask green, v0.10 `livery.body`, all optional): `color` (whole fuselage), `belly` {color, split share
  crown→belly, tilt ±1}, up to 3 `stripes` {color, y, h, windows (on the window line), sweep (up into the fin)},
  `nose`. Drawn in that order; absent = the white fuselage as drawn. The belly colour covers the belly fairing (it
  is fuselage in the mask); stripes and the belly split follow the measured crown / belly lines.
- Cowls (mask blue; never the exhaust, fan or pylon): `body.engines` (default `primary`), `body.lip` an intake ring
  (per engine and row the front `lip` px of the cowl, `eng` in the data).
- Presets (`data/livery.ts BODY_PRESETS`): Eurowhite, Classic cheatline, Full colour, Belly band — in the livery's
  own colours. `plain: true` = the sprite untouched (stickers still paint in, on white). `WHITE_LIVERY` draws nothing.
- `BODY_PAINT = true` (sprites.ts): the editor's Body and Tail tabs; false brings back the v0.10 tail-only editor.

## Stickers

Frames (one livery fits every type): fin `x` = chord leading edge (0) → trailing edge (1), `y` = root (0) → tip (1),
bilinear on the measured fin quad; fuselage `x` = share of the length nose (0) → tail (1), `y` = crown (0) → belly
(1). Auto: the code in the biggest box inside the fin around the scheme's anchor (stepping off a colour divide), a
fin logo the biggest square in the fin, titles in the title band behind the forward door. v0.11 stickers are decals:
painted into the fin and body paint layers before the light, so the mask clips them to the fin and the fuselage
(never on the wing, stabiliser, engines or windows' glass edges) and they carry the shading and the lines. The one
being dragged in the editor is drawn live as SVG (clipped to the fuselage zone and the fin) until it is let go. A
placed sticker keeps at least half of it on the airframe (`MIN_VISIBLE`).

## Gallery (`/gallery.html`, dev)

`?types=a,b&livery=blockhours|redsplit|greenstripe|navysolid|used|white|logo|plainlogo|stickers&bg=dark,blue,light&size=hero,card,mini`
(`&logo=<id>|mono &plain=1 &tail=<scheme> &codecolor=%23hex &weight=500 &primary=%23hex &secondary=%23hex
&preset=eurowhite|cheatline|fullColour|bellyBand &body=<json>`); `scripts/paint-shots.cjs <url> <dir>` renders the
presets and a dark full colour on 16 types with contact sheets; `?gallery=compare` (real-length scale),
`logos`, `clip[&stickers=0]` (magenta stickers at scale 3 in the corners: none may show off the airframe), `editor`,
`lod`, `layout` (the measured fin, frame, zone and title band over each sprite).
