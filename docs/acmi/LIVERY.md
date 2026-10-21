# BLOCK HOURS v0.5.1 — liveries, stickers and client paint

Design for the v0.5.1 livery release, split into three parallel lanes: **ART**, **ENGINE** and **UI**. BRIEF.md "Player decisions" still overrides everything. BUILD-PLAN.md ground rules apply unchanged:
- engine RNG only;
- read APIs are pure;
- ids come from `nextId`;
- money moves only through the ledger helpers;
- flights change only through the core helpers;
- `SAVE_VERSION` stays 1, with `??=` defaults.

The airframe outlines, noses, windows and engines are approved artwork. **No lane changes them.** Stickers and liveries are only ever painted *inside* those outlines.

## 0. What the player asked for → where it lands

| # | Request | Lane | Section |
|---|---|---|---|
| 1 | Tail letters float outside the fin | ART | §2.3, §2.4 |
| 2 | Letter colours; drag code/titles/logo; clip like a sticker | ART (renderer, editor), ENGINE (data), UI (hosting) | §1.1, §2, §3 |
| 3 | ~15 original logos, tail and fuselage, colourable | ART | §2.6 |
| 4 | Per-aircraft livery: company / custom / plain white | ENGINE (data, actions), UI (picker) | §1.2, §3.3 |
| 5 | Client paint requests as part of an offer | ENGINE (terms, schedule, money, bot), UI (modal, schedule) | §4 |
| 6 | Visual inconsistencies across the game | UI | §5.3 |

### Root cause of bug 1 (from reading `AircraftArt.tsx` and `geometry.ts`)
1. The fin-code `<text>` is drawn **outside** any clip. The `tc` clip is applied only to `lv.fin`, so nothing stops a glyph from leaving the fin.
2. Its size comes from `liveryGeometry` → `code: { size, w }`:
   - `w` is a fraction of the chord at the *centre* height of the text, on the **quad** `[[rootLE, H/2], [rootTE, H/2], tipLE, tipTE]`.
   - That quad has straight edges and a root at `H/2`, which isn't the real crown. A traced fin is curved and often concave, and the fin narrows above the text centre, so the upper corners of the letters cross the swept leading edge.
3. Glyph width is estimated as a constant `0.64 em`. Space Grotesk 700 capitals such as W, M and Q are about 0.8–0.9 em, so codes like "WW" or "MQ" overflow.

The fix is the sticker pipeline in §2: clip every sticker to the airframe, and fit the code into a rectangle measured inside the real fin polygon with per-glyph advances.

---

## 1. Data model (ENGINE owns `src/engine/core/types.ts` additions and `src/data/livery.ts`)

All new fields are **optional** or additive union members. A v0.5 save loads unchanged and renders exactly as it did.

### 1.1 `Livery` (extended in place; the Brand section of `types.ts`)

```ts
export type TailStyle = 'solid' | 'split' | 'stripe' | 'sweep';          // unchanged
export type StickerKind = 'code' | 'titles' | 'logo';
export type StickerSide = 'fuselage' | 'fin';

/** One sticker on the airframe. Position is a centre point in the frame of its side (§2.2), so one livery fits every type. */
export interface StickerPlacement {
  /** Unique within the livery: 'code', 'titles', 'logo', 'logo2'. UI-made, not an engine id. */
  id: string;
  kind: StickerKind;
  side: StickerSide;
  /** fin: x = chord fraction from the leading edge (0) to the trailing edge (1), y = root (0) to tip (1), bilinear on the fin quad.
   *  fuselage: x = fraction of L from the nose tip (0) to the tail-cone end (1), y = fraction of H from the crown line (0) to the belly line (1).
   *  Omitted = auto (today's anchor for the scheme / the type's title band). */
  x?: number;
  y?: number;
  /** × the auto-fit size (1 = fits its zone exactly). Clamped 0.3–3; beyond the zone it is clipped like a sticker. */
  scale: number;
  /** Degrees clockwise on screen, −45…45. Default 0 (upright, reads left→right). */
  rotation?: number;
}

export interface LiveryText {
  /** Omitted = the default text: company code / company name (client livery: client designator / client name). */
  text?: string;
  /** Omitted = auto contrast (the current codeFill / titleFill rules). */
  color?: string;
  weight?: 500 | 700;            // default 700
}

export interface LiveryLogo {
  id: LogoId | 'mono';           // 'mono' = monogram of `text` (1–3 letters) in a roundel
  color: string;
  /** Second tone for two-tone logos; default = color. */
  color2?: string;
  text?: string;
}

export interface Livery {
  primary: string;
  secondary: string;
  tail: TailStyle;
  /** v0.5.1. Plain airframe: no scheme colour areas, grey engine accents. Stickers still draw. */
  plain?: boolean;
  code?: LiveryText;
  titles?: LiveryText;
  logo?: LiveryLogo;
  /** Absent = legacy: [code auto on the fin, titles auto on the fuselage]. Present = exactly these draw (≤ 6). */
  stickers?: StickerPlacement[];
}
```

`CompanyLivery` in the brief is simply `g.company.livery: Livery`. The "base scheme from the existing set" is `tail` plus `plain`.

### 1.2 Per-aircraft livery (Fleet section)

```ts
export type LiveryRef = 'company' | 'white' | { custom: Livery };

export interface Aircraft {
  // …existing
  /** Player's choice. Undefined = 'company'. */
  livery?: LiveryRef;
  /** Contract whose client livery is physically on the aircraft (set when the paint-in ends, cleared when the strip ends). Overrides `livery`. */
  paintedFor?: string;
}
```

This deliberately differs from the suggested `{client: contractId}` member. Client paint is physical state that the engine sets and clears. Keeping it apart from the player's choice means:
- stripping it restores the player's choice without a "previous" field;
- the UI picker can never overwrite a client paint.

Resolution order lives in `liveryOf` (§1.5): `paintedFor` → client livery, then `'white'` → `WHITE_LIVERY`, then `{custom}` → custom, then company.

**Player-chosen livery changes are cosmetic, instant and free** (a game abstraction). Only client paint costs money and downtime. While `paintedFor` is set, or a paint event is booked, the aircraft's picker is locked.

### 1.3 Client paint terms (Contracts section)

```ts
export type PaintKind = 'full' | 'decals';          // decals = plain white body + client titles + fin logo, 2–3 days

export interface PaintTerms {
  kind: PaintKind;
  /** true: a condition of the deal. false: optional, and turning it off costs `declinePct` of the rate/price. */
  required: boolean;
  declinePct: number;          // 0.02–0.05 (optional); for required it is the cut the client asks on a counter without paint (0.05–0.08)
  /** Share of paint-in + strip the client reimburses (1, 0.5 or 0). */
  clientShare: number;
  /** Per aircraft, USD, quoted at generation (stored, never re-rolled). */
  cost: number;
  stripCost: number;
  days: number;
  stripDays: number;
  /** Client livery to paint (built by clientLivery, §4.2). */
  livery: Livery;
}

export interface ContractOffer { /* … */ paint?: PaintTerms; counter?: { /* … */ paint?: boolean } }
export interface Contract {
  /* … */
  paint?: PaintTerms & { accepted: boolean; inMx?: Record<string, string>; outMx?: Record<string, string> };   // aircraftId → maintenance id
}
```

### 1.4 Maintenance and ledger additions

```ts
export type MaintKind = 'A' | 'C' | 'AOG' | 'line' | 'paint';
export interface MaintenanceEvent { /* … */ paint?: { phase: 'in' | 'out'; contractId: string } }
export type LedgerCat = /* … */ | 'paint';
```

### 1.5 Constants and pure helpers (ENGINE: `src/data/livery.ts`, `src/engine/ops/paint.ts`)

```ts
// src/data/livery.ts (no React; engine-safe)
export const LOGO_IDS = ['arc', 'swift', 'globe', 'polaris', 'compass', 'sunrise', 'wave', 'peaks', 'chevrons', 'ribbon', 'orbit', 'kite', 'feather', 'spark', 'prism'] as const;
export type LogoId = (typeof LOGO_IDS)[number];
export const LOGO_NAMES: Record<LogoId, string>;            // 'Arc', 'Swift', …
export const CLIENT_LOGOS: readonly LogoId[] = ['globe', 'compass', 'wave', 'peaks', 'orbit', 'prism', 'arc'];
export const CLIENT_PALETTE: readonly [string, string][];   // 16 generic primary/secondary pairs; NOT copies of real liveries
export const WHITE_LIVERY: Livery = { primary: '#ffffff', secondary: '#c0c7d6', tail: 'solid', plain: true, stickers: [] };
export const BRAND_LIVERY: Livery = { primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' };   // Title screen
export const MARKET_LIVERY: Livery = { ...WHITE_LIVERY };                                          // aircraft-market cards
export const PAINT_SHOPS: readonly string[] = ['LIS', 'MAD', 'MLA', 'VNO', 'SNN', 'LDE', 'TLS', 'HAM', 'BUD', 'IST', 'AUH', 'SIN']; // filtered to AIRPORT_BY_CODE at load
export const MAX_STICKERS = 6, MAX_TITLE = 28, MAX_CODE = 3;

// src/engine/ops/paint.ts (pure unless noted)
export interface ResolvedLivery { livery: Livery; code: string; name: string; source: 'company' | 'white' | 'custom' | 'client'; contractId?: string; clientName?: string }
export function liveryOf(g: GameState, ac: Aircraft | string): ResolvedLivery;
export function normaliseLivery(l: Partial<Livery> | undefined, fallback?: Livery): Livery;   // clamps x/y 0–1, scale 0.3–3, rotation ±45, hex colours, text lengths, ≤ 6 stickers, unique ids, valid logo id
export function clientLivery(client: Client, kind: PaintKind): Livery;                       // hashUnit(client.id): same client → same livery, every contract
export function paintStatus(g: GameState, aircraftId: string): { paintedFor?: string; clientName?: string; booked?: MaintenanceEvent; locked: boolean };
// actions (ActionResult, never throw)
export function setCompanyLivery(g: GameState, l: Livery): ActionResult;
export function setAircraftLivery(g: GameState, aircraftId: string, ref: LiveryRef): ActionResult;              // refused while locked
export function setFleetLivery(g: GameState, ref: LiveryRef): ActionResult<{ changed: number; skipped: number }>;  // "apply to all"; skips locked aircraft
```

`liveryOf` resolves text as follows:
- **Company** liveries: code = `livery.code?.text ?? company.code`, name = `livery.titles?.text ?? company.name`.
- **White**: no code and no titles.
- **Client** liveries: code = `clientPrefix(client.name)` (its existing designator), name = client name. Long government names fall back to the country plus "Government", up to 28 characters.

### 1.6 Load defaults (`opsModule.load`, ENGINE)
- `for (const ac of Object.values(g.fleet)) if (ac.paintedFor && !g.contracts[ac.paintedFor]) delete ac.paintedFor;` (self-heal).
- `g.company.livery = normaliseLivery(g.company.livery)`. This is idempotent; legacy liveries keep `stickers` undefined.
- No other `??=` is needed, because every new field is optional and its absence means today's behaviour. `SAVE_VERSION` stays 1.

---

## 2. Renderer contract (ART)

### 2.1 Props (backwards compatible; every current caller keeps working)

```ts
export interface AircraftArtProps {
  typeId: string; livery: Livery;
  code?: string;       // default code text (livery.code.text wins)
  name?: string;       // default titles text (livery.titles.text wins)
  className?: string; gear?: boolean; height?: number | string; detail?: 'full' | 'simple'; pxPerM?: number;
  /** Editor only. */
  svgRef?: React.Ref<SVGSVGElement>;
  selected?: string;                                // placement id: dashed box + handles
  guides?: { x?: number[]; y?: number[] };          // viewBox coords, drawn as thin cyan lines
}
```

Every sticker `<g>` carries `data-sticker={id}` so the editor can hit-test with `elementFromPoint`, with a fallback to `stickerLayout` boxes.

### 2.2 Frames and coordinate mapping (`src/ui/components/aircraft/stickers.ts`, pure, tested)

The geometry is nose-left and y-up. The art is mirrored once (`FLIP = scale(-1,1)`), and path y is already negated, so a geometry point `(x, y)` is at viewBox `(-x, -y)`. All editor maths happens in **viewBox coords**, which are the nose-right screen frame. The flip is handled only inside these helpers:

```ts
export type V = readonly [number, number];
export interface StickerBox { id: string; kind: StickerKind; side: StickerSide; cx: number; cy: number; w: number; h: number; rot: number; fontSize?: number; text?: string }
export function frameToView(typeId: string, side: StickerSide, x: number, y: number): V;      // fin: finAt(quad, x, y); fuselage: (x·L, H/2 − y·H); then (-gx, -gy)
export function viewToFrame(typeId: string, side: StickerSide, X: number, Y: number): V;      // inverse; fin = inverse bilinear (Newton, 6 iterations)
export function sideAt(typeId: string, X: number, Y: number): StickerSide | null;           // point-in-polygon: fin polygon first, then fuselage
export function finInset(typeId: string, scheme: TailStyle): { cx: number; cy: number; w: number; h: number };  // viewBox rect wholly inside the fin polygon (margin 4% chord)
export function stickerLayout(typeId: string, lv: Livery, defaults: { code?: string; name?: string }, detail?: 'full' | 'simple'): StickerBox[];
export function defaultStickers(lv: Livery): StickerPlacement[];                            // legacy look as explicit placements (editor start point)
export function snapTargets(typeId: string, side: StickerSide): { x: number[]; y: number[] };  // fin centre line, fin inset centre, title band line, window line
```

When a drag moves a sticker's centre across the fin root, the editor switches `side` to whatever `sideAt` returns there and re-expresses x/y in that frame. That is the only way `side` changes.

### 2.3 Clipping (fixes bug 1, implements "nothing floats outside")
- Every sticker is drawn **twice**, once per pass, with the same viewBox transform. A sticker that straddles the fin root therefore reads as one continuous decal, and nothing outside the union of fuselage and fin is ever painted:
  - **pass F (fuselage)**: inside the existing `fc` clip (in outline mode also `tz`, so stickers never spill onto the Concorde delta). It is drawn after the scheme fills and before windows, doors, lines and cockpit, so windows sit on top like real cut-outs.
  - **pass T (fin)**: inside the existing `tc` clip, after `lv.fin` and before `fin.edge` and `fin.lines`.
- The approved z-order of the airframe pieces does not change. The wing, stabiliser and engines still pass in front of fuselage stickers.
- ART also exports `airframeClipPaths(typeId): string[]` (`[g.fus, g.fin.fill]`) for the editor's dimmed "outside" overlay.

### 2.4 Text fitting (tail code and titles)
- `geometry.ts` gains (additively) `fin.poly: V[]`, the fin outline polygon. It is sampled from the same points that build `fin.fill`: the traced polygon, or the parametric edge sampled with `sampleChain`. **No outline changes.**
- `finInset` scans the polygon for the largest axis-aligned rectangle around the scheme's code anchor. The anchors are the current `(s, t)` values per `TailStyle`.
- **Glyph advances** come from a static table, `aircraft/fontMetrics.ts`, holding Space Grotesk advances for weights 500 and 700, A–Z, 0–9 and space, in em, with 0.62 as the fallback. Then:
  - text width = Σ advances + letter-spacing;
  - code `fontSize = min(inset.h × 0.78, inset.w / width) × scale`;
  - titles: the same fit inside the existing `g.titles` band.
- At `scale = 1` the text box lies fully inside the fin polygon. At `scale > 1` it is clipped (pass T), so it can never float.
- **Text never mirrors.** Each sticker is drawn as `<g transform={`${FLIP} translate(X Y) rotate(r)`}>` with `textAnchor="middle"`, so it reads left-to-right on the nose-right art.

### 2.5 `plain`, mini sizes and the white option
- `plain: true` skips `lv.fus`, `lv.fus2` and `lv.fin`. The fin gradient becomes the white fuselage gradient, and engine `accent` becomes `#c9d1dd`.
- `detail: 'simple'` (≤ 120 px wide) keeps fin stickers (code and logo) and drops fuselage text titles. Fuselage logos stay if their box is ≥ 6 % of L.

### 2.6 Logos (`src/ui/components/aircraft/logos.ts`)

```ts
export interface LogoDef { id: LogoId; name: string; paths: { d: string; tone: 1 | 2 }[] }   // viewBox 0 0 100 100, centred, nose-right facing
export const LOGOS: Record<LogoId, LogoDef>;   // `satisfies Record<LogoId, LogoDef>`: compile error if out of sync with data/livery.ts
export function Monogram(props: { text: string; color: string; color2?: string }): JSX.Element;  // roundel + 1–3 letters (fontMetrics fit)
```

The 15 original marks are simple, bold, and at most 2 tones:

| id | name | description |
|---|---|---|
| arc | Arc | thick rising arc with tapered ends |
| swift | Swift | three-stroke forward chevron bird, no circle |
| globe | Globe | circle with two meridians and one parallel |
| polaris | Polaris | four-point star, long horizontal arms |
| compass | Compass | eight-point rose with alternating tones |
| sunrise | Sunrise | half-disc on a bar with 5 short rays |
| wave | Wave | two stacked sine strokes |
| peaks | Peaks | two overlapping mountain triangles |
| chevrons | Chevrons | three nested forward chevrons |
| ribbon | Ribbon | folded band, two tones |
| orbit | Orbit | dot with a tilted elliptical ring |
| kite | Kite | diamond split on its long diagonal |
| feather | Feather | single quill with three cuts |
| spark | Spark | 8-ray burst, alternating ray lengths |
| prism | Prism | triangle split in two tones |

Rules:
- **Avoid lookalikes of real marks:**
  - no crane or bird in a circle;
  - no maple leaf, shamrock or kangaroo;
  - no Delta-style widget;
  - no Star Alliance-style pentagon.
- **Legibility:** at a 14 px fin they must still read, so use a minimum stroke of 9 viewBox units and no holes under 12 units.

### 2.7 Editor components (`src/ui/components/livery/*`, ART)

```ts
export interface LiveryEditorProps {
  value: Livery; onChange: (l: Livery) => void;
  code: string; name: string;                         // default texts for previews
  types?: string[];                                   // preview type chips; default fleet types or ['a320ceo','b738','b763','b77w']
  mode: 'company' | 'aircraft';
  aircraft?: { ref: LiveryRef; onRef: (r: LiveryRef) => void; locked?: string };   // aircraft mode header: Company · White · Custom
  onApplyAll?: () => void;                            // company mode: "Use on all aircraft"
}
export function LiveryEditor(p: LiveryEditorProps): JSX.Element;
export function LiveryPreview(p: { livery: Livery; code?: string; name?: string; typeId: string; sizes?: ('hero' | 'card' | 'mini')[] }): JSX.Element;
export function ColorPicker(p: { label: string; value: string | undefined; onChange: (c: string | undefined) => void; presets?: string[]; auto?: boolean; contrastWith?: string }): JSX.Element;
export function LogoPicker(p: { value: LiveryLogo | undefined; onChange: (l: LiveryLogo | undefined) => void }): JSX.Element;
```

The editor is self-contained and keeps no game state. Hosts own the value and persist it.

---

## 3. Editor UX on iPad (landscape 1180×750, touch first; desktop works the same with a mouse)

### 3.1 Layout (full-screen sheet)
- **Left, about 62 %: stage.**
  - a hero `AircraftArt` with `svgRef`, `touch-action: none`;
  - type chips under it (A320 · 737 · 767 · 777…) to check the livery on other airframes;
  - a size strip below: hero / card (300 px) / mini (90 px).
- **Right, about 38 %: tool panel.** Five segmented tabs:
  - **Scheme:** Solid · Split · Stripe · Sweep · White.
  - **Colours:** primary and accent.
  - **Text:** code text, colour and weight; titles text, colour and weight.
  - **Logo:** grid of 15 plus Monogram plus None; colour 1 and 2.
  - **Layout:** a list of stickers with show/hide, scale and rotate sliders, "Add logo to fin", "Add logo to fuselage", and Reset.
- **Footer:** Cancel · Reset all · (company mode) "Use on all aircraft" · Save.

### 3.2 Interactions
- **Drag:** `pointerdown` on a sticker selects it and calls `setPointerCapture`. `pointermove` maps through `svg.getScreenCTM().inverse()` → viewBox → `viewToFrame`, and `onChange` fires on every animation frame (rAF-throttled).
  - The part of the airframe outside the clip is dimmed with an overlay, so the "sticker" behaviour is visible while dragging.
  - Hit boxes are padded to at least 44 CSS px.
  - Tapping an empty spot deselects.
- **Snap:** within 8 CSS px of a `snapTargets` line, the sticker snaps and a guide shows.
- **Scale:** two-finger pinch on the stage scales the selected sticker (distance ratio). The slider covers the same 0.3–3 range. Rotation uses a slider only (no twist gesture), clamped to ±45° with a detent at 0.
- **Colour:** 12 preset swatches plus **Auto** (the contrast rule), plus **Custom**:
  - hue strip and saturation/lightness pad (each ≥ 44 px tall);
  - hex field;
  - a contrast warning when text vs its background is < 2:1.
- **Reset:** per-sticker (back to auto position, scale 1) and for the whole livery (`defaultStickers`).
- One-step **Undo** is optional; there's no redo.

### 3.3 Where it lives
| Place | Host | Persists via |
|---|---|---|
| New Game | Keep the quick swatches and tail Seg. Add **"Customise livery…"** to open the sheet with local state. | `createGame({ livery })` (normalised) |
| Company screen | New **Livery** card: preview, Edit, "Use on all aircraft" | `setCompanyLivery`, `setFleetLivery('company')` |
| Fleet aircraft card | Livery row: Seg Company · White · Custom, plus Edit (custom). Locked with "In Saudia colours until 12 Mar" while `paintStatus().locked`. | `setAircraftLivery` |

---

## 4. Client paint requests (ENGINE)

### 4.1 Who asks, and how often (rolled in `finalize` with `g.rng`; terms stored on the offer)

| Archetype / condition | Chance | Kind | Required |
|---|---|---|---|
| seasonBase 30–59 d | 8 % | decals | optional |
| seasonBase 60–119 d | 30 % | decals | 60 % required |
| seasonBase **long variant** 120–240 d (new: 12 % of seasonBase rolls when `opts.days` is unset; lead ≥ 30 d) | 75 % | full 80 % / decals 20 % | 70 % required |
| capacityLease (v0.7, 1–5 y) | 90 % | full | required |
| troopRotation with a UN/agency client | 25 % | decals on white ("UN" style titles) | required |
| tourSeries ≥ 56 d | 10 % | decals | optional |
| sports (big club) / adhoc ≥ 5 d (corporate) | 2 % / 1 % | decals | optional |
| aogCover, repatriation, governments' urgent work | 0 | — | — |

Further rules:
- **Full paint** is only offered when `lead ≥ days + 7`; otherwise the roll downgrades to decals.
- **Multi-aircraft** base deals paint every aircraft.

### 4.2 Terms and numbers (`BAL.paint`, ENGINE's block of `balance.ts`)

| | Narrowbody | Widebody |
|---|---|---|
| Full paint | $150–250k, 7–10 days | $300–500k, 10–14 days |
| Decals (titles + fin logo on white) | $30–50k, 2–3 days | $50–80k, 2–3 days |
| Strip after full paint (back to our colours) | 0.9 × cost, same days | 0.9 × cost, same days |
| Decal removal | $8–15k, 1 day | $10–20k, 1 day |

- **Client share:**
  - full paint: 100 % (55 %), 50 % (35 %), or 0 % with the rate +4 % (10 %);
  - decals: 100 % (80 %), or 0 % (20 %).
- **Declining:**
  - *Optional* paint: the player can switch it off at signing, and the rate/price drops by `declinePct` (2–5 %).
  - *Required* paint: the toggle is locked on. A counter with paint off is allowed. In `onOfferReply`, the client then withdraws 50 % of the time (`lost`, with an inbox message naming the rival that took it). Otherwise it accepts at the countered price × (1 − `declinePct` 5–8 %).
- **`clientLivery(client, kind)`** is hash-based (`hashUnit(client.id)`), so a client always looks the same:
  - colours: `CLIENT_PALETTE` pair;
  - scheme: full = hash-picked `TailStyle`; decals = `plain`;
  - titles: client name;
  - code: client designator;
  - logo: `CLIENT_LOGOS` pick, or `'mono'` with the designator for governments and agencies.

  Real client names are used (BRIEF). **No real logos or colour schemes are reproduced.**

### 4.3 Feasibility and schedule integration
- **Pure helper** (in `src/engine/contracts/paintTerms.ts`):

  ```ts
  export interface PaintSlot { shop: string; start: Minute; end: Minute; ferryIn: PositioningLeg[]; ferryOut: PositioningLeg[] }
  export function paintWindow(g: GameState, aircraftId: string, terms: Pick<PaintTerms, 'days'>, before: Minute, after?: Minute): PaintSlot | null;
  export function paintQuote(o: ContractOffer, paint: boolean): { product: Product; cost: number; reimbursed: number; days: number };
  ```

  `paintWindow` picks the latest slot that ends at least 24 h before `before` (the first anchor of the programme). The shop is the home base if it is in `PAINT_SHOPS`, otherwise the `PAINT_SHOPS` airport that minimises ferry-in + ferry-out block time. It uses `anchorsOf` and `chainForward`.
- **`feasibility(g, offerId, aircraftId, opts?: { paint?: boolean })`** adds `CheckId 'paint'` and `report.paint?: PaintSlot`:
  - `no` when the slot is needed and none fits;
  - `warn` when ferry-in exceeds 6 h block, or the aircraft is already `paintedFor` another client (it would fly this job in someone else's colours);
  - `paint: false` on a required offer gives `no` ("Client requires their livery"). The default is `true` when the offer has paint.
- **Accept/counter:**
  - `acceptOffer(g, offerId, aircraftIds, opts?: { paint?: boolean })`;
  - `counterOffer(g, offerId, price, aircraftIds, opts?: { paint?: boolean })`.

  After `generateFlights`, each aircraft gets a `MaintenanceEvent { kind: 'paint', paint: { phase: 'in', contractId } }` at the slot. It is booked through `scheduleCheck(g, acId, 'paint', start, shop, { paint: { contractId, phase, days, cost } })`. This is a minimal branch in `maintenance.ts` that bypasses the A/C airport rule, uses `days`/`cost`, and books the ferry with `planPositioning(…, 'ferry', null)`.

  Paint therefore **blocks the aircraft on the Schedule exactly like a check**. It is an anchor for every later feasibility check, puts the aircraft in the hangar on the map, and appears in the finance forecast (the `kind !== 'AOG'` branch).
- **Paint-in end** (`onMaintEnd` branch): `post(g, 'paint', -cost)`; `ac.paintedFor = contractId`; `invoice` the client share (`otherRevenue`, `payment.dueDays`); inbox message.
- **Strip:**
  - At `contract.end`, or at `cancelContract`, `dailyPaint(g)` books the strip with `paintWindow(…, after = last arrival)` at the first gap within 30 days. Until then the aircraft keeps flying in client colours, and a warning is sent once.
  - Strip end: `post(g, 'paint', -stripCost)`, `delete ac.paintedFor`, and an invoice for the strip share only if the contract *completed* (no reimbursement when we cancelled).
- **Display:** the client livery is visible on the map, Fleet, Schedule and panels from paint-in end to strip end, through `liveryOf`.
- **Bot** (`scripts/acmi-bot.ts`):
  - accepts required paint;
  - takes optional paint when `clientShare ≥ 0.5` or there is a rate bonus;
  - never counters on paint;
  - logs paint jobs and net paint cost.

---

## 5. File ownership and lane interfaces

### 5.1 Ownership

| Lane | Owns (create/edit) | Shared files: minimal additive edits only |
|---|---|---|
| **ART** | `src/ui/components/aircraft/AircraftArt.tsx`; `stickers.ts` (+ `stickers.test.ts`); `fontMetrics.ts`; `logos.ts` (+ `logos.test.ts`); `README.md` (new, documents liveries); `src/ui/components/livery/{LiveryEditor,LiveryPreview,ColorPicker,LogoPicker}.tsx`; `src/styles/acmi/livery.css`; `src/dev/gallery.tsx`; `TailBadge` in `src/ui/components/Logo.tsx` | `geometry.ts` (add `fin.poly` only, no path changes); `src/styles/acmi/index.css` (one `@import './livery.css'`) |
| **ENGINE** | `src/data/livery.ts`; `src/engine/ops/paint.ts` (+ `paint.test.ts`); `src/engine/contracts/paintTerms.ts` (+ `paintTerms.test.ts`); `scripts/acmi-bot.ts` | `core/types.ts` (fields in §1); `core/balance.ts` (`BAL.paint` block); `contracts/offers.ts`, `feasibility.ts`, `accept.ts`, `index.ts`; `ops/maintenance.ts` (paint branches), `ops/index.ts` (exports, load, daily hook); `newGame.ts` (normalise livery); `core/plumbing.test.ts` (purity entries) |
| **UI** | `src/ui/screens/{NewGame,Company,Fleet,Schedule,Finance,Title}.tsx`, `screens/scheduleLogic.ts`, `screens/screenLogic.ts`; `src/ui/modals/{OfferModal,BlockSheet}.tsx`, new `src/ui/modals/LiveryModal.tsx`; `src/ui/map/{LiveLayers,MapPanels,OpsMap,mapLogic}.ts(x)`; `src/ui/shell/Shell.tsx`; `src/styles/acmi/{screens,map,shell}.css`, `src/styles/touch/*`; `scripts/ipad-shots.cjs` | `src/ui/store.ts` (`ModalSpec { kind: 'livery'; target: 'company' \| { aircraftId: string } }`, dev helper `dev.paintOffer()`); `src/ui/game/Modals.tsx` (route the new kind) |

### 5.2 Start order (same worktree, so files appear live)
1. **Hour 0:**
   - ENGINE lands `types.ts` additions, `src/data/livery.ts`, and `paint.ts` exports, with real `liveryOf`/`normaliseLivery` and stubbed actions returning `{ok:false,error:'soon'}`.
   - ART lands `stickers.ts`/`logos.ts` signatures and a `LiveryEditor` shell.
   - UI starts with the consistency pass (§5.3) while it waits.
2. Then all three lanes work against §1–§4 signatures. tsc must stay green at every save.

### 5.3 UI visual-consistency pass (found by reading the code; extend with `scripts/ipad-shots.cjs`)
- Every `AircraftArt` caller passes `liveryOf(g, ac)` (`Fleet.tsx:68`, `MapPanels.tsx:144`). The Title screen uses `BRAND_LIVERY`, and market cards use `MARKET_LIVERY` instead of the inline literals at `Fleet.tsx:118` and `Title.tsx:112`.
- **Map glyphs** (`LiveLayers.tsx:304`) are coloured per aircraft from `liveryOf(...).livery.primary`. White aircraft get a light fill with a dark outline.
- **`TailBadge`** (Shell, New Game) mirrors the real fin: scheme, code colour/weight, and logo if set. The props stay compatible.
- **Hangar and paint labels:**
  - The status label "in check" and the hangar line (`mapLogic.ts:254`) read "Paint shop → 12 Mar" for paint.
  - `scheduleLogic.ts:83` gets a `paint` label ("Paint · Saudia" / "Repaint") and a hatched block in the client primary, plus a new legend item.
  - BlockSheet shows the shop, dates, cost and client share, with no Reschedule button for paint.
- Finance gets the label "Paint & livery" for `paint`.
- **Sweep the shots for:**
  - inconsistent art heights per card type;
  - mixed badge styles;
  - truncated titles;
  - touch targets under 44 px;
  - hard-coded colours instead of tokens;
  - number and date formats (`money`, `fmtDay` everywhere);
  - horizontal scroll at 1180×750 and 1180×820.

### 5.4 Inbox copy deck (ENGINE writes it verbatim; UI renders it and may propose wording)
- `Paint booked: {reg} in {client} colours`: "{Full repaint | Decals} at {shopCity}, {start}–{end}. {cost}; {client} pays {share}."
- `{reg} now flies in {client} colours`: "Out of the paint shop at {shopCity}. {client} invoiced {amount}."
- `{reg} back in {company} colours`: "Repaint done at {shopCity}. {cost}."
- `{reg} still wears {client} colours`: "No paint-shop slot within 30 days; it flies in their livery until one opens."
- `{client} walked away`: "They wanted their colours on the aircraft for {title}. {rival} took the job."

---

## 6. Acceptance criteria and tests

**ART**
- `stickers.test.ts`:
  - For every type id in `PROFILE_BY_ID` plus every traced type, × 4 schemes, × codes `['AW','WW','MQ','88','XQZ']` × weights 500/700: all 4 corners of the auto-fit code box (scale 1) lie inside `fin.poly`.
  - Titles fit inside the title band.
  - `frameToView`/`viewToFrame` round-trip within 1e-3 for both sides.
  - `sideAt` is correct at the fin centre, the mid-fuselage and outside.
  - A legacy livery (no `stickers`) gives the same code/titles anchors as v0.5.
- `logos.test.ts`:
  - 15 ids that equal `LOGO_IDS`;
  - unique names;
  - every path non-empty;
  - all coordinates within 0–100.
- **Playwright clip check:** render the gallery with each sticker in `#ff00ff` at scale 3, dragged to the corners. No magenta pixel may appear outside the silhouette mask (the same art rendered with stickers off).
- iPad shots: the editor at 1180×750 and 1180×820 has no page scroll.
- Outline, nose, window and engine paths are byte-identical to v0.5 (snapshot `g.fus`, `g.fin.fill`, `g.windows`, engine `cowl`).

**ENGINE**
- `paint.test.ts`:
  - A v0.5 save JSON without the new fields loads, renders through `liveryOf` as the company livery, and round-trips.
  - `normaliseLivery` clamps every field.
  - `clientLivery` is deterministic per client.
  - `setAircraftLivery` is refused while locked.
- `paintTerms.test.ts`:
  - Over 600 seeded offers, the frequencies land within ±50 % of §4.1 and there is no paint on aogCover or repatriation.
  - `feasibility` gives `paint: no` without a gap.
  - A required offer plus `paint:false` gives an error.
  - Accept books paint-in (it ends ≥ 24 h before the first leg), the contract flights don't overlap it, `paintedFor` is set at the end, and cost and invoice post through the ledger.
  - Completion books the strip; cancellation books the strip without reimbursement.
  - The counter-without-paint reply is either lost or a rate cut.
- `plumbing.test.ts`: `liveryOf`, `paintStatus`, `paintWindow`, `paintQuote` and `feasibility` leave the state JSON and the RNG unchanged.
- Bot: `npx tsx scripts/acmi-bot.ts 1|2|3 365` runs with no crash, at least 1 paint job across the 3 seeds, net paint cost ≤ 2 % of revenue, and year-end cash within ±10 % of v0.5.

**UI**
- `ipad-shots.cjs` covers:
  - New Game → Customise;
  - Company livery card;
  - the Fleet card picker (Company/White/Custom, and locked);
  - OfferModal with required and optional paint (client-livery mini art, terms, toggle with the price effect, feasibility "paint" row);
  - a Schedule paint block and its BlockSheet;
  - the map with a client-painted aircraft.
- A Playwright touch test (synthesised pointer events): drag the code from the fin to mid-fuselage, then save. `g.company.livery.stickers` holds the new side and x/y, and Fleet and the map reflect it after a save/reload.
- A two-pointer pinch changes the scale.
- All controls are at least 44 px; no horizontal scroll at 1180×750; desktop mouse drag works.
- Everything in §5.3 is done or listed as deferred with a reason.

All lanes: `npx tsc --noEmit`, `npx vitest run` and `npx vite build` stay green.
