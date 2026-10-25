# Aircraft art and liveries (v0.10: the player's raster sprites)

`AircraftArt` draws the player's final aircraft art, nose RIGHT, in flight: one sprite per type (and per airframe
variant), **exactly as drawn** — no redraw, no filters. The only change to the picture is the livery tint (a multiply)
on the fin, the fuselage (v0.10 body paint) and the engines; everything else (titles, code, logos) is a sticker drawn
on top.

## Pipeline (`scripts/sprites.py`)

`python3 scripts/sprites.py <input-dir>` (Pillow with WebP + numpy). Input: `sprites/<id>.png` and
`masks/<id>-mask.png` (4096 × 1640, flat #00FF00 background; the mask has the fin + rudder solid #FF0000 and every
nacelle + pylon solid #0000FF). It rewrites `public/aircraft/` and `sprites.gen.ts`:

1. checks each mask against its sprite (outside the red / blue areas the pixels must match; a misaligned mask falls
   back to its hard colour areas, a missing one to no tint) and prints the mismatch count;
2. keys the green out (alpha from the green excess, solid inside the airframe), unmixes the edge colour and removes
   green spill, trims to the aircraft with a 1.2 % even margin;
3. writes `<id>-2048.webp` and `<id>-1024.webp` (lossy colour q86, lossless alpha) and `<id>-mask.png` (**2048** wide,
   R = fin coverage, G = fuselage (body), B = engine coverage, anti-aliased, never overlapping); identical sprites
   (a359 / a359ulr) share one set (`same`);
4. measures the layout in pixels of the 2048 asset (x right, y down): nose / tail x, crown and belly lines, the fin
   outline and its frame quad, the fuselage sticker zone (crown to belly, above the windows over the wing, clear of
   the engines and of the near wing where it crosses the fuselage side), the window line and the title band;
5. v0.10 `body_mask` derives the fuselage from the art itself: the tube between the measured crown and belly (straight
   across under the wing and, for the hidden tail-cone top, under the fin — the fin fillet above that line joins the
   fin), minus whatever is much darker than the white fuselage's own cylinder shading at that height (wing,
   stabiliser, winglets; looser over the tapering tail cone), minus the wing-body fairing where it is drawn brighter
   than the belly; enclosed details (windows, doors, lines) and the nose/cockpit go back in; overwing exit hatches are
   kept. Per-sprite corrections in `scripts/sprites-body.json` (`cutFill` seeds flood-filled to the drawn outline,
   `cutEllipse`, `add` / `cut` polygons) cut the fairings drawn in the fuselage's shading (787-8/-9, A330-200/-900,
   A340-200/-300, 747s, 757s). The tube lines are exported as `body` (crown / belly every 8 px) for the paint
   geometry. Checks: `.handover/updates/shots-body/mask-<id>*.png` (red body, navy fin, gold engines; 2× crops of
   the wing and the tail).

The 4096 px originals are not in the repo (`.handover/updates/sprites-src/`). About 2.5 MB for the whole set.

## Files

| File | What |
|---|---|
| `AircraftArt.tsx` | `<svg>` in the sprite's 2048-px frame: the (tinted) bitmap as `<image>`, stickers clipped to the fin and the fuselage zone, editor ghost and guides; ink choice (`stickerInk`, `stickerGround`) |
| `compose.ts` | The tint: multiply of the fin, body and engine colours over the white art where the mask says (`applyTints`, pure), one bitmap per sprite + width + colours (object URL, LRU 120); decoded masks kept for the last 8 sprite/widths |
| `bodyPaint.ts` | v0.10 body paint geometry (pure): the tube at x, belly split, stripes (window line, sweep into the fin), nose; `bodyColourAt` for sticker inks |
| `sprites.ts` | Sprite ids, asset URLs, layout lookup, real lengths (`LENGTH_M`, `metresPerPx` for same-scale views), `BODY_PAINT` |
| `sprites.gen.ts` | Generated layout data (do not edit) |
| `stickers.ts` | Sticker frames, fitting, layout, the tail schemes on the fin (`finSecondAreas`) — pure, tested |
| `ink.ts` | Colour helpers and auto ink (`autoFinInk`, `autoBodyInk`, `contrast`) |
| `fontMetrics.ts`, `logos.ts` | Text fitting without a DOM; the 15 logos |
| `../../../data/variants.ts` | Airframe variants (engines, door layout) → sprite, engines text, exit limit |

Size: the 1024 asset for cards and rows, the 2048 once the drawn width passes 1100 device px (never steps down).
`pxPerM` sizes the art by the real aircraft length (A320 37.6 m … 747-8 76.3 m).

## Livery

- Fin (mask red): the livery's `primary`, with the scheme's second-colour areas (`split` / `stripe` / `sweep`) in
  `secondary`, and swept stripes on top. Multiplied over the white art, so panel lines and shading show.
- Fuselage (mask green, v0.10 `livery.body`, all optional): `color` (whole fuselage), `belly` {color, split share
  crown→belly, tilt ±1}, up to 3 `stripes` {color, y, h, windows (on the window line), sweep (up into the fin)},
  `nose`. Drawn in that order; absent = the white fuselage as drawn (older liveries look exactly as before).
- Engines (mask blue): `body.engines` (default `primary`, as before v0.10), `body.lip` an intake ring (the front 11 %
  of each engine's columns in the mask).
- Presets (`data/livery.ts BODY_PRESETS`): Eurowhite, Classic cheatline, Full colour, Belly band — in the livery's
  own colours. `plain: true` = the sprite untouched (stickers still draw). `WHITE_LIVERY` draws nothing at all.
- `BODY_PAINT = true` (sprites.ts): the editor's Body and Tail tabs; false brings back the v0.10 tail-only editor.

## Stickers

Frames (one livery fits every type): fin `x` = chord leading edge (0) → trailing edge (1), `y` = root (0) → tip (1),
bilinear on the measured fin quad; fuselage `x` = share of the length nose (0) → tail (1), `y` = crown (0) → belly
(1). Auto: the code in the biggest box inside the fin around the scheme's anchor (stepping off a colour divide), a
fin logo the biggest square in the fin, titles in the title band behind the forward door. Every sticker is drawn
twice, clipped to the fuselage zone and to the fin, so nothing paints outside the airframe or over the wing and
engines. A placed sticker keeps at least half of it on the airframe (`MIN_VISIBLE`).

## Gallery (`/gallery.html`, dev)

`?types=a,b&livery=blockhours|redsplit|greenstripe|navysolid|used|white|logo|plainlogo|stickers&bg=dark,blue,light&size=hero,card,mini`
(`&logo=<id>|mono &plain=1 &tail=<scheme> &codecolor=%23hex &weight=500`); `?gallery=compare` (real-length scale),
`logos`, `clip[&stickers=0]` (magenta stickers at scale 3 in the corners: none may show off the airframe), `editor`,
`lod`, `layout` (the measured fin, frame, zone and title band over each sprite).
