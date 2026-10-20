export const meta = {
  name: 'aircraft-art-trace',
  description: 'Trace exact aircraft profiles (nose, cockpit windows, fuselage) from the user reference photos, drive the renderer from the traces, swap Overture for Concorde, measure the match per type and loop until it fits',
  phases: [
    { title: 'Trace', detail: '4 tracing agents (poster narrow, poster wide, Airbus family, Concorde) ∥ renderer upgrade' },
    { title: 'Apply', detail: 'wire traced profiles into each spec file; Concorde replaces Overture' },
    { title: 'Measure', detail: 'reference-vs-render overlays and IoU per type' },
    { title: 'Fix', detail: 'per-spec-file corrections, re-measure, up to 3 rounds' },
    { title: 'Finish', detail: 'gallery, tsc, vitest, build, compare sheet' },
  ],
}

const WT = '/home/user/wt/brand'
const SCRATCH = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/brand'
const REF = `${SCRATCH}/userref`
const TR = `${SCRATCH}/trace`

const CONTRACT = `
DATA CONTRACT — traced profiles. One file per aircraft type: ${WT}/src/ui/components/aircraft/traced/<typeId>.ts exporting "export const profile: TracedProfile = {...}" (import the type from "./types"). The renderer loads them with import.meta.glob('./traced/*.ts', { eager: true }) keyed by filename, so NO index file is needed and no other file has to change for a trace to take effect.
CANONICAL FRAME (same as the renderer's internal geometry): nose faces LEFT, x grows aft, y grows DOWN (SVG). Units: fractions of the fuselage length L measured from the nose tip (x = 0) to the aft end of the tail cone (x = 1). y = 0 at the height of the nose tip; a point 10% of L below the nose tip has y = 0.10. The poster photos face RIGHT: mirror them (x' = 1 − x) when tracing. The Airbus-family poster and the Concorde drawing already face LEFT.
interface TracedProfile {
  typeId: string; source: string;            // e.g. 'airbus-boeing-comparison.jpg crop [x0,y0,x1,y1]'
  lengthPx: number;                          // fuselage length in source pixels (scale record)
  top: [number, number][];                   // upper fuselage line nose tip → tail cone end, ≥ 50 points, ≥ 20 of them in x ≤ 0.15 (nose); follows the crown UNDER the fin root (exclude the fin)
  bottom: [number, number][];                // lower fuselage line nose tip → tail cone end, ≥ 50 points, ≥ 20 in the nose; EXCLUDE landing gear, engines and wing (follow the belly through the wing-root fairing)
  cockpit: [number, number][][];             // one polygon per visible windscreen pane (dark glass), traced from the photo: usually 3 (or 2) side panes; include the forward pane if visible
  windows: { y: number; h: number; from: number; to: number; pitch: number; gaps: [number, number][] };  // passenger window row: centre y, height, x-range, pitch, gaps (doors/emergency exits/wing box)
  doors: { x: number; w: number; h: number; y: number }[];   // main doors (x = fore edge)
  fin?: [number, number][];                  // vertical fin polygon (root along the crown, leading edge, tip, trailing edge) — required for types where the renderer's parametric fin is visibly wrong
  wingRoot?: { from: number; to: number; y: number };        // where the wing meets the fuselage (x-range, y of the root chord centre)
  engines?: { x: number; y: number; w: number; h: number }[];  // nacelle bounding boxes (same frame)
  outline?: [number, number][];              // FULL closed silhouette (fuselage + wing + fin + nacelles) — used instead of top/bottom for the Concorde
  notes?: string;
}
Every trace ships with evidence in ${TR}/<typeId>/: crop.png (the reference crop, upscaled ×3, mirrored to the canonical frame), mask.png (binary aircraft silhouette of the crop, same size; gear removed), overlay.png (crop with the traced top/bottom/cockpit/outline drawn in red/green at 2 px) and nose.png (the front 20% at ×6 with the overlay). Tooling: python3 with PIL + numpy only (no cv2/skimage): segment the aircraft from the blue gradient background by colour distance to a per-row background estimate taken from the margins, clean the mask with numpy morphology, take column-wise min/max y of the mask for the top/bottom lines (then cut away gear/engines/wing with an x/y clip you choose and reinspect), find the dark windscreen panes as connected components of dark pixels in the nose box; then LOOK at overlay.png and nose.png (Read the PNGs) and correct the points by hand until the red line sits on the airframe edge everywhere; iterate at least 3 times per type. Smooth noisy lines with a small moving average; keep the nose tip sharp where the photo is sharp. A trace is finished only when overlay.png shows no visible gap between the red line and the airframe at the nose, the crown, the belly and the tail cone, and nose.png shows the panes exactly where the photo has them.
`

const COMMON = `
PROJECT: BLOCK HOURS (browser game: Vite 6 + React 19 + TypeScript strict, vitest). Work ONLY in ${WT} (git branch "brand"; do not commit/checkout/merge/reset/stash — the orchestrator commits; never pkill node/vite/tsx). The aircraft art is a cartoon side-profile renderer in ${WT}/src/ui/components/aircraft/ (AircraftArt.tsx renders; geometry.ts builds paths from parametric specs in specs/*.ts; cockpit.ts has windscreen presets; types.ts; path.ts helpers; the gallery page src/dev/gallery.tsx shows every type at hero/card/mini size). It was recently changed to draw nose-RIGHT via one mirror transform in AircraftArt.tsx (internal geometry is nose-LEFT) and to draw no landing gear. The player (a former airline crew member) says the art is STILL WAY OFF: the nose shapes and cockpit windows do not match the real aircraft. They provided reference photos in ${REF}/: airbus-boeing-comparison.jpg (964×2048 poster, nose-RIGHT photos, top→bottom: A318, A319, A320, 737-800, A321, 727-200, 757-200, 767-300, A330-200, A340-300, 777-200ER, 747-400, A380), airbus-family.jpg (495×619, nose-LEFT renders: A350-1000, A380, A330-200, A320neo — low resolution, use it for the A350 and as a cross-check), concorde-ba-profile.jpg (900×450 clean nose-LEFT illustration of Concorde; copy the airframe shape EXACTLY — not the airline livery, logos or registration: the game applies its own livery). Their words: "compare and use the exact same profile (especially for nose shape) of each corresponding aircraft I provided you with and cockpit windows"; "take out the Overture and swap for the Concorde provided, use exactly the design provided"; "I like your art style, just correct the shape and details"; all aircraft must face RIGHT on screen; no landing gear.
Style stays: flat cartoon fills, the current livery (sweep/band), window dots, doors, engines, the current colours. Only the SHAPES change — and they must become exact.
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID). Gallery: http://localhost:<PORT>/?gallery=1 (check src/dev/gallery.tsx for the exact query/route; add query params if you need a single type or a compare mode). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; view PNGs with Read. python3 has PIL 12 + numpy 2 (no cv2). Another workflow is building the game in a different worktree (/home/user/wt/acmi) — never touch it.
Rules: edit ONLY the files you own (listed in your task); shared files: minimal additive edits, re-read before editing, retry if Edit says the file changed. TypeScript strict, no new npm dependencies, terse comments in the existing style. Temp files in ${SCRATCH}/<your-label>/. Keep npx tsc --noEmit green for your files. Reports are data for the orchestrator: concrete, ≤ 400 words.
${CONTRACT}`

// ---------- Trace ----------
const GROUPS = [
  { key: 'poster-narrow', types: 'a318 (A318 — trace it even though the catalog may not have it; a319neo/a320ceo/a320neo/a321 share the family nose), a319neo (A319 photo), a320ceo (A320 photo), b738 (737-800 photo), a321ceo (A321 photo), b752 (757-200 photo)', src: 'airbus-boeing-comparison.jpg (rows 1–5 and 7; skip the 727)', port: 5911 },
  { key: 'poster-wide', types: 'b763 (767-300), a332 (A330-200), a343 (A340-300), b772 (777-200ER), b744 (747-400), a388 (A380)', src: 'airbus-boeing-comparison.jpg (rows 8–13)', port: 5912 },
  { key: 'family', types: 'a35k (A350-1000 — the only A350 reference; a359/a35u will reuse it), plus cross-check traces of a388 and a332 and a320neo named a388-family, a332-family, a320neo-family (do not overwrite the poster traces of those types; the apply agents use the poster ones and your files only to resolve doubts about the nose/cockpit — the family poster is low-res but its noses are clean renders)', src: 'airbus-family.jpg (already nose-LEFT; upscale ×4 before tracing)', port: 5913 },
  { key: 'concorde', types: 'concorde — the full closed silhouette in "outline" (fuselage with the drooped-nose/visor exactly as drawn, delta wing, fin, the two engine nacelle boxes under the wing as part of the silhouette), cockpit panes (the visor windows as drawn), window row (small, closely pitched), doors, fin polygon, engines boxes, plus top/bottom for the fuselage alone so the window row can be placed. Also record in notes the proportions: fuselage length ≈ 61.7 m, span 25.6 m, fin height — so the renderer can scale it among the other types', src: 'concorde-ba-profile.jpg (already nose-LEFT; upscale ×3; the drawing is clean so segmentation by "not white" is enough; ignore the text under the aircraft and the registration)', port: 5914 },
]
const TRACE = (g) => `${COMMON}
TASK (TRACE — ${g.key}): produce exact traced profiles for: ${g.types}. Source: ${REF}/${g.src}. You OWN ${WT}/src/ui/components/aircraft/traced/<those typeIds>.ts and ${TR}/<typeId>/* only (create the traced/ folder if missing; if traced/types.ts does not exist yet, a renderer agent is writing it concurrently with exactly the interface above — do not create it yourself; write your files against the interface and run npx tsc --noEmit at the end; if types.ts is still missing then, note it and finish). Work type by type: crop generously, mirror if the source faces right, segment, extract, overlay, LOOK, correct, repeat (≥ 3 iterations per type; the nose and the windscreen panes are what the player cares about most, then the crown/belly curvature and the tail cone). Perspective in the photos is small; correct obvious foreshortening at the nose by keeping the profile tangent-continuous. Exclude landing gear completely. Port ${g.port} only if you need the app.
Return (≤ 400 words): per type — file written, lengthPx, point counts, what the nose/cockpit look like in words (so the apply agent can sanity-check), any doubt; list of evidence PNGs.`

const RENDERER = `${COMMON}
TASK (RENDERER — traced profiles support): make the renderer draw a type from its traced profile whenever ${WT}/src/ui/components/aircraft/traced/<typeId>.ts exists, else fall back to the parametric spec exactly as today. You OWN: src/ui/components/aircraft/traced/types.ts (write it FIRST, verbatim from the contract, so the tracing agents can compile), src/ui/components/aircraft/traced/load.ts (import.meta.glob('./*.ts', { eager: true }) → Map<typeId, TracedProfile>; exclude types.ts/load.ts), geometry.ts, AircraftArt.tsx, path.ts, cockpit.ts, types.ts (additive: optional "traced?: boolean" or similar on specs if useful) and src/dev/gallery.tsx. Do NOT edit specs/*.ts (apply agents own them) nor traced/<typeId>.ts (trace agents own them). Port 5901.
Implement:
1. Fuselage path from top/bottom: convert the polylines to a smooth closed path (Catmull-Rom → cubic Béziers, or monotone smoothing; keep the nose tip and tail cone end exact; no wobble: resample/smooth lightly, do not over-smooth the nose). Windows row, doors, titles and the livery band position from the profile's windows/doors; cockpit panes from profile.cockpit polygons (fill the current glass colour, same stroke style). Wings, engines, fin and stabiliser remain parametric from the spec but are placed using profile.wingRoot/engines/fin when present (fin polygon used directly when given). The mirror to nose-right and the no-gear rule stay untouched. artViewBox must use the traced geometry.
2. outline mode: when profile.outline is present (Concorde), the whole silhouette is one path filled as the fuselage (livery band clipped to it), cockpit from profile.cockpit, windows from profile.windows, nacelles drawn as separate shaded shapes on top using profile.engines, fin shading optional. The Concorde must look as good as the rest at hero/card/mini sizes.
3. Scale: all types in the gallery and in the game share one metres-per-unit scale; a traced type's real length comes from the spec (or add lengthM to the profile/spec) so the Concorde and the A380 are the right relative size.
4. Gallery: add a compare mode (query param, e.g. ?gallery=compare&type=a320ceo) that renders the type at exactly the pixel length of ${TR}/<typeId>/crop.png (read lengthPx from the profile; serve the PNGs by copying them to public/dev-ref/ or by an absolute file URL — your choice) under/over the reference crop at 50% opacity, nose aligned, so a human and the measure agent can see deviations; and ?gallery=sheet rendering every type with a traced profile next to its crop.
5. npx tsc --noEmit, npx vitest run, npx vite build green; do not break the current look of untraced types (compare the gallery before/after for e175, atr72, b788: identical).
Return (≤ 400 words): what was implemented, the exact gallery URLs for compare/sheet, how scale is derived, any contract deviation (there should be none).`

// ---------- Apply ----------
const SPECS = [
  { key: 'narrow-airbus', file: 'specs/narrow-airbus.ts', types: 'a319neo ← a319neo trace; a320ceo ← a320ceo; a320neo ← a320ceo trace (neo differs only by engines/sharklets — keep those parametric), a321ceo ← a321ceo; a321neo/a321xlr ← a321ceo trace. a220_100/a220_300/c919 stay parametric but review their nose against the A320 family trace and adjust if they are clearly wrong', port: 5921 },
  { key: 'narrow-boeing', file: 'specs/narrow-boeing.ts', types: 'b738 ← b738 trace; b38m/b3jm ← b738 trace (MAX nose is the same; engines differ); b752 ← b752 trace', port: 5922 },
  { key: 'wide-twin', file: 'specs/wide-twin.ts', types: 'a332 ← a332 trace; a333/a339 ← a332 trace with their own lengths (stretch the parallel section between wing and tail, keep the traced nose and tail cone — implement a stretch helper if the renderer lacks one, in your spec file, or request it); b763 ← b763; b772 ← b772; b77l/b77w/b779 ← b772 trace with their lengths (the 777X nose is the same family); a359/a35u/a35k ← a35k trace with their lengths; b788/b789/b78x have no reference: leave them parametric, do not touch', port: 5923 },
  { key: 'heavy', file: 'specs/heavy.ts', types: 'b744 ← b744 trace; b748 ← b744 trace stretched; a388 ← a388 trace; a343 ← a343 trace', port: 5924 },
  { key: 'concorde', file: 'specs/concorde.ts (new) + src/data/aircraft.ts + src/data/acmiTypes.ts (or wherever "overture" is referenced: grep -rn overture src) + specs/index.ts (additive registration only)', types: 'concorde ← concorde trace (outline mode). Replace the Overture catalog entry with Concorde: id "concorde", name "Concorde", maker Aérospatiale/BAC, 4 engines, ~100 seats, range ~3,900 nm, cruise Mach 2.0 (~1,165 kt), MTOW 185 t, length 61.7 m, span 25.6 m; keep whatever gameplay role/tier/availability the Overture entry had (if the game treated Overture as a future delivery, make Concorde a rare heritage/VIP type available from the start instead — it is a retired aircraft). Remove the overture spec and every "overture" reference (tests included); migrate nothing (SAVE_VERSION frozen; the old game is replaced)', port: 5925 },
]
const APPLY = (s, traces, renderer) => `${COMMON}
TASK (APPLY — ${s.key}): wire the traced profiles into the specs you own: ${s.types}. You OWN ${s.file}. Do not edit the renderer files or traced/<type>.ts (if a trace is wrong, write the correction request in your report — but first try to fix it from the spec side only if the contract allows it; otherwise report). Port ${s.port}.
How: for a traced type, the spec keeps wings/engines/fin/stabiliser parameters (positions must agree with the trace's wingRoot/engines/fin); for derived types (same family, different length) reuse the family trace with a stretch of the constant-section (between the end of the nose/cockpit region and the start of the tail cone) so the nose and tail cone shapes are preserved exactly — use the renderer's stretch helper if it exists, else implement the stretch as a small pure function in your spec file that produces a derived TracedProfile and registers it (ask the renderer notes below how a spec can supply a profile programmatically; if there is no such hook, write the derived profile as a generated traced/<type>.ts file — you may create traced files ONLY for derived types that have no trace of their own).
Verify in the gallery (compare mode) for every type you touched at hero size and at mini size (32 px): the nose, cockpit and tail must match the reference crop; nothing may look broken at mini size. Save screenshots to ${SCRATCH}/apply-${s.key}/. npx tsc --noEmit and npx vitest run green.
Return (≤ 400 words): per type what it is driven by, what you verified, trace corrections needed (typeId + what is wrong, precisely).

Trace reports:
${traces}

Renderer notes:
${renderer}`

// ---------- Measure ----------
const MEASURE_SCHEMA = {
  type: 'object',
  properties: {
    sheet: { type: 'string' },
    types: { type: 'array', items: { type: 'object', properties: {
      typeId: { type: 'string' }, lane: { type: 'string', enum: ['narrow-airbus', 'narrow-boeing', 'wide-twin', 'heavy', 'concorde', 'renderer', 'trace'] },
      noseIoU: { type: 'number' }, bodyIoU: { type: 'number' }, verdict: { type: 'string', enum: ['match', 'close', 'off'] }, deviations: { type: 'string' },
    }, required: ['typeId', 'lane', 'noseIoU', 'bodyIoU', 'verdict', 'deviations'] } },
    summary: { type: 'string' },
  },
  required: ['sheet', 'types', 'summary'],
}
const MEASURE = (round, applyReports) => `${COMMON}
TASK (MEASURE, round ${round} — read-only on src/): judge how exactly each traced type now matches its reference. Port ${5931 + round}. For every type with a reference (a319neo, a320ceo, a320neo, a321ceo, b738, b752, b763, a332, a343, b772, b744, a388, a35k, concorde) and the derived ones (a321neo, a333, a339, b77w, b77l, a359, a35u, b748, b38m): render the type with Playwright from the gallery compare mode at the reference crop's pixel length (nose-aligned, gear-free), rasterise to a mask (non-background pixels), and compute IoU against ${TR}/<typeId>/mask.png (for derived types compare against their family trace's mask after the same stretch — or skip IoU and judge visually): noseIoU over the front 22% of the fuselage length above the belly line, bodyIoU over the fuselage box excluding wing/engines/gear rows. Also produce ${TR}/measure-${round}/sheet.png: for each type a row with reference crop | render | 50% overlay | nose ×4 overlay, and LOOK at every row. Verdict: match = noseIoU ≥ 0.93 and bodyIoU ≥ 0.95 and nothing visibly off at nose ×4; close = small visible deviation; off = clearly wrong. Lane = which agent should fix it (the spec lane that owns the type; "trace" when the trace itself is wrong; "renderer" when the smoothing/path code distorts the trace). Deviations must be precise and actionable ("tip 0.012 L too high; windscreen aft pane 15% too tall; crown drops too early at x = 0.08").
Apply reports (what was done):
${applyReports}`

const FIX = (lane, items, round, extra) => `${COMMON}
TASK (FIX — ${lane}, round ${round}): correct these types so they MATCH their references (verdict match). ${extra} Port ${5941 + round * 10 + ['narrow-airbus', 'narrow-boeing', 'wide-twin', 'heavy', 'concorde', 'renderer', 'trace'].indexOf(lane)}. Re-check in the gallery compare mode after each change; save before/after to ${SCRATCH}/fix-${lane}-${round}/. npx tsc --noEmit green.
Return (≤ 300 words): per type what changed and what the compare shows now.
Types and deviations:
${items}`
const LANE_OWN = {
  'narrow-airbus': 'You OWN specs/narrow-airbus.ts and traced/<derived type>.ts files you generated earlier.',
  'narrow-boeing': 'You OWN specs/narrow-boeing.ts and traced/<derived type>.ts files you generated earlier.',
  'wide-twin': 'You OWN specs/wide-twin.ts and traced/<derived type>.ts files you generated earlier.',
  'heavy': 'You OWN specs/heavy.ts and traced/<derived type>.ts files you generated earlier.',
  'concorde': 'You OWN specs/concorde.ts, traced/concorde.ts and the Concorde catalog entry.',
  'renderer': 'You OWN geometry.ts, AircraftArt.tsx, path.ts, cockpit.ts, traced/load.ts and src/dev/gallery.tsx — fix the path building/smoothing so traces are reproduced faithfully; never edit specs or traces.',
  'trace': 'You OWN the traced/<typeId>.ts files named below and their evidence folders — re-trace against the reference photo with the overlay method until overlay.png and nose.png are exact.',
}

const FINISH = (measure) => `${COMMON}
TASK (FINISH): everything is applied. Port 5951. Run npx tsc --noEmit, npx vitest run, npx vite build (fix anything small). Regenerate the gallery shots to ${SCRATCH}/final/: gallery-hero-dark.png, gallery-card-dark.png, gallery-mini-dark.png, gallery-hero-blue.png, plus the sheet (?gallery=sheet) as ${SCRATCH}/final/compare-sheet.png and per-type hero crops for a320ceo, a321ceo, b738, b752, b763, a332, a343, b772, b744, a388, a35k, concorde as ${SCRATCH}/final/<type>-hero.png. Check: every aircraft faces right, no landing gear anywhere, Overture gone from the catalog/gallery/tests, Concorde present and correctly sized, titles readable, nothing clipped at mini size. Also look at the New Game / fleet UI once if it renders aircraft art (screenshot at 1180×750). Report any remaining visible defect honestly (type + what).
Return (≤ 300 words): checks, file list of shots, defects left.
Final measure summary:
${measure}`

// ================= RUN =================
phase('Trace')
const [traces, renderer] = await parallel([
  () => parallel(GROUPS.map((g) => () => agent(TRACE(g), { label: `art:trace:${g.key}`, phase: 'Trace', model: 'fable' }))),
  () => agent(RENDERER, { label: 'art:renderer', phase: 'Trace', model: 'fable' }),
])
const traceText = GROUPS.map((g, i) => `## ${g.key}\n${traces && traces[i] ? traces[i] : '(trace agent failed — check traced/ for partial files)'}`).join('\n\n')
const rendererText = renderer ?? '(renderer agent failed — check traced/types.ts, load.ts and geometry.ts for partial work)'
log('traces + renderer done')

phase('Apply')
const applies = await parallel(SPECS.map((s) => () => agent(APPLY(s, traceText, rendererText), { label: `art:apply:${s.key}`, phase: 'Apply', model: 'fable' })))
let applyText = SPECS.map((s, i) => `## ${s.key}\n${applies[i] ?? '(apply agent failed)'}`).join('\n\n')

phase('Measure')
let m = await agent(MEASURE(1, applyText), { label: 'art:measure:1', phase: 'Measure', schema: MEASURE_SCHEMA, model: 'fable' })
const bad = (mm) => (mm ? mm.types.filter((t) => t.verdict !== 'match') : [])
log(m ? `round 1: ${m.types.length} types, ${bad(m).length} not matching` : 'measure failed')

phase('Fix')
let round = 1
while (m && bad(m).length && round <= 3) {
  const lanes = [...new Set(bad(m).map((t) => t.lane))]
  const reps = await parallel(lanes.map((lane) => () => agent(
    FIX(lane, bad(m).filter((t) => t.lane === lane).map((t) => `- ${t.typeId} [${t.verdict}] noseIoU ${t.noseIoU.toFixed(3)} bodyIoU ${t.bodyIoU.toFixed(3)}: ${t.deviations}`).join('\n'), round, LANE_OWN[lane] ?? ''),
    { label: `art:fix:${lane}:r${round}`, phase: 'Fix', model: 'fable' },
  )))
  applyText = lanes.map((l, i) => `## fix ${l} (round ${round})\n${reps[i] ?? '(failed)'}`).join('\n\n')
  round += 1
  m = await agent(MEASURE(round, applyText), { label: `art:measure:${round}`, phase: 'Measure', schema: MEASURE_SCHEMA, model: 'fable' })
  log(m ? `round ${round}: ${bad(m).length} not matching` : 'measure failed')
}

phase('Finish')
const fin = await agent(FINISH(m ? `${m.summary}\n${m.types.map((t) => `${t.typeId}: ${t.verdict} (nose ${t.noseIoU.toFixed(2)}, body ${t.bodyIoU.toFixed(2)})`).join('; ')}` : '(no measure)'), { label: 'art:finish', phase: 'Finish', model: 'fable' })
return {
  rounds: round - 1,
  remaining: m ? bad(m).map((t) => `${t.typeId}: ${t.verdict} — ${t.deviations}`) : null,
  measure: m ? m.summary : null,
  sheet: m ? m.sheet : null,
  finish: fin,
}
