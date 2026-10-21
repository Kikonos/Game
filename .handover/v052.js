export const meta = {
  name: 'blockhours-v052-player-fixes',
  description: 'BLOCK HOURS v0.5.2: the player\'s fix list (top-bar blur, counter-offers, crew roster strip, commercial deadhead flights on the map, always-on flight paths, flight-type labels, art windows + smooth crown); review, verify, fix, readiness',
  phases: [
    { title: 'Build', detail: 'engine lane ∥ art lane, then map lane ∥ UI lane' },
    { title: 'Review', detail: 'player-eye review + QA/iPad review → refute' },
    { title: 'Fix', detail: 'fix confirmed findings, readiness (≤ 2 rounds)' },
  ],
}

const WT = '/home/user/wt/acmi'
const SCRATCH = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi/v052'
const REF = `${SCRATCH}/ref`
const OPUS = { model: 'opus', effort: 'high' }

const COMMON = `
PROJECT: BLOCK HOURS v0.5.1 (released) — a browser game (Vite 6 + React 19 + TypeScript strict; hand-written CSS; d3-geo map; lz-string saves; PWA; vitest) where the player runs a small ACMI / wet-lease / charter airline. Work ONLY in ${WT} (branch acmi). Docs: ${WT}/docs/acmi/BRIEF.md ("Player decisions" override everything), DESIGN.md, BUILD-PLAN.md (ground rules: engine determinism — engine RNG only, read APIs pure, ids via nextId; money only via ledger helpers; flights only via core helpers; SAVE_VERSION stays 1 with ??= defaults in load), LIVERY.md. The player is a former ACMI flight attendant who plays on an iPad (A16) in LANDSCAPE as a home-screen app (1180×820; Safari 1180×750), touch only; desktop must still work. Calm visuals: nothing flickers, only aircraft move.
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · npx tsx scripts/acmi-bot.ts <seed> 365 (run seeds one at a time) · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID; never pkill node/vite/tsx). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; touch via page.touchscreen.tap; view PNGs with Read. scripts/ipad-shots.cjs (--standalone for the home-screen app) shoots every screen. window.__contrail exposes the store and dev helpers.
Rules: other agents may work in this worktree at the same time — edit ONLY the files you own (your task lists them); shared files (src/engine/core/types.ts, src/ui/store.ts) get minimal additive edits, re-read before editing, retry if Edit says the file changed. No git commit/checkout/merge/reset/stash (the orchestrator commits). Temp files in ${SCRATCH}/<your-label>/. TypeScript strict, terse comments in the existing style, no new npm dependencies. Keep tsc, vitest and vite build green for your files. Reports are data for the orchestrator: concrete, ≤ 400 words, listing the exact exported functions/props other lanes use.
`

const REQUEST = `
THE PLAYER'S FIX LIST for v0.5.2 (agreed with them; their screenshots are in ${REF}/ — look at them):
A. TOP-BAR BLUR: on the iPad home-screen app the top bar's company name, date/time and cash look blurred/soft (ref 1, 4, 6). Make all top-bar text crisp (likely a backdrop-filter/blur, transform, opacity or will-change on the header or its children; also check text-rendering, fractional transforms and the safe-area band).
B. COUNTER-OFFERS (ref 1-counter-expired.png): the player countered an urgent AOG-cover offer ("Counter $6.9K sent · reply by 7 Mar 18:10") but the offer expired before the client replied. New rule: the client ALWAYS answers before the offer expires — urgent jobs (AOG cover etc.) reply within 1–3 game hours, normal offers within ~1 game day; the offer's expiry clock pauses while a counter is pending; the answer can be accept, reject, or meet halfway; urgent/short-notice clients are more likely to concede (the player has leverage) — make it plausible and a bit uncertain, deterministic via the engine RNG; clear inbox message and card status for each outcome.
C. CREW ROSTER STRIP ("Next 14 days" on the crew card; ref 2-sick-roster.jpg, 3-joining-roster.jpg): show EVERYTHING that blocks a person, not only flying duties: sick days, joining/onboarding period, training, days off, standby, positioning on our aircraft, and deadheading on other airlines — each a distinct colour + label, with start/end times where relevant, tappable for details. Fix the "Joining" card: a captain joining on 26 May 2027 shows "Rest until 26 May 2027" and "Hired 26 May 2027" (a future date) — it must read "Joins 26 May 2027" (or "Starts"), no fake rest, and the strip shows the joining period. Same care for "Sick" (show expected return) and "Training".
D. COMMERCIAL DEADHEAD FLIGHTS ON THE MAP: when our crew travel as passengers on another airline (deadhead), the map shows that flight: a GREY aircraft icon (clearly different from our own aircraft icons), a small floating flight-number label that follows the icon (e.g. "TP 1342"), and its path origin → destination as a thin grey dotted line while airborne. Tapping it opens a panel: airline name, flight number, origin → destination, departure/arrival times, time to landing, and which of our crew are on board (names + roles). Use REAL airlines that plausibly operate each route (hub carriers and the main airlines of the origin/destination countries, e.g. TAP from LIS, Lufthansa via FRA/MUC, Iberia via MAD, Ryanair/easyJet on European point-to-point) with invented but realistic flight numbers using the airline's IATA code; if a connection is needed, show each leg. Deterministic.
E. MAP FLIGHT PATHS: while one of OUR aircraft is airborne, its current flight path is ALWAYS drawn (not only when tapped), from take-off to landing, then disappears. Operating (revenue) = solid green line; Positioning and Ferry (no passengers) = dotted amber line (Ferry also tagged "FERRY" on the aircraft label/panel). Commercial deadheads = thin grey dotted (item D). Calm: no flicker, smooth at 4×, fine on an A16.
F. FLIGHT TYPES (ref 6-upnext-types.jpg — the player drew a column with Deadhead / Operating / Ferry next to the "Up Next" list): widen the Up Next panel and label every leg, and use the same labels everywhere (map paths and panels, Schedule blocks/legend, flight details, crew roster):
   | Operating   | revenue flight | solid green |
   | Positioning | our aircraft empty, FULL crew aboard (cabin crew needed at the destination) | dotted amber |
   | Ferry       | our aircraft empty, PILOTS ONLY (e.g. to maintenance, or cabin crew travel separately) | dotted amber + FERRY tag |
   | Deadhead    | our crew as passengers on another airline | grey icon, thin grey dotted |
   The engine decides pilots-only vs full crew automatically: cabin crew fly on the positioning leg only when they are needed at the destination for the next operating leg (and it's legal/cheaper than deadheading them); otherwise it's a ferry with pilots only. Costs/crew legality must follow (cabin crew not on a ferry don't log that duty).
G. AIRCRAFT ART (src/ui/components/aircraft/**):
   G1 (ref 4-fleet-no-windows.jpg): on the Fleet cards and some other screens the aircraft shows NO passenger windows, doors or details. Every size (hero/card/mini and whatever Fleet/market/offer/map panels use) must keep windows (scaled sensibly; at very small sizes a thin window line is fine), doors where they fit, and the key details. Check every place AircraftArt is used.
   G2 (ref 5-bumpy-crown.jpg): "the art looks great but you took the tracing too literally, resulting in a bumpy uneven surface, especially on the ceiling (crown) of the aircraft". Fit SMOOTH curves through the traced outlines: the crown, belly and tail cone must be clean, fair curves (monotone curvature where the real aircraft is smooth — no wobbles), while the NOSE shape, cockpit windows, proportions, fin and engines stay as approved (the player approved the noses from their reference photos; keep them within ~0.002 L). Apply to every traced type (traced/*.ts and derived/stretched types). Check at hero size and 2× zoom on the crown.`

// ---------- Build ----------
const ENGINE = `${COMMON}${REQUEST}
TASK (BUILD — ENGINE LANE): implement the engine side of B, C, D and F. You OWN src/engine/** (incl. tests), src/data/** and scripts/**. Other lanes (art, map, UI) run in parallel or after you — write ${SCRATCH}/api-engine.md EARLY (first 15 minutes) with the exact signatures you will export, then keep it updated:
- B: counter-offer state machine (pending counter pauses expiry; reply time 1–3 h urgent / ~1 day normal, always before expiry; outcomes accept / reject / meet-halfway with plausible odds weighted by urgency and the counter size; inbox messages; offer card status data).
- C: a pure read API crewCalendar(g, crewId, from, to) → blocks [{kind: 'duty'|'positioning'|'deadhead'|'sick'|'joining'|'training'|'off'|'standby'|'rest', start, end, label, detail, flightIds?}] covering every state that blocks a person; plus fields for the crew card header: status text with the right date ("Joins 26 May 2027", "Sick · back ~12 Mar", "Training until …"); fix whatever made a joining captain show "Rest until <join date>" and a future "Hired" date.
- D: commercial deadhead itineraries: when crew are deadheaded, store/derive the commercial flight(s): airline (real, plausible for the route — build a compact route→carrier table: hub carriers, flag carriers of origin/destination, low-cost carriers for intra-European point-to-point), IATA-coded flight numbers, dep/arr times, great-circle path endpoints, connection legs if needed, crew on board. Pure read API commercialFlightsBetween(g, t0, t1) / commercialFlightsAirborne(g, t) for the map. Deterministic, saved or re-derivable without RNG drift.
- F: flight type classification flightKind(g, flight) → 'operating'|'positioning'|'ferry' with pilots-only ferry logic when cabin crew aren't needed at the destination (roster/duty/cost consistent), and expose it on flights for the UI/map.
Tests for each. Bot seeds 1–3 (one at a time): solvent, margin −5…+12%, uncovered < 2%, 0 illegal duties/crew flown, < 10 s; same-seed determinism. Port 6101.`

const ART = `${COMMON}${REQUEST}
TASK (BUILD — ART LANE): implement G1 and G2. You OWN src/ui/components/aircraft/** (renderer, traced profiles, specs, editor) and src/dev/gallery.tsx. Do not touch anything else. Port 6102.
- G1: find every AircraftArt usage (grep) and its size; make windows/doors/details render at all of them (Fleet cards first — compare with ${REF}/4-fleet-no-windows.jpg). Shots before/after of the Fleet screen at 1180×820.
- G2: smooth the crown/belly/tail cone of every traced profile with a fairing pass (e.g. least-squares smoothing spline or curvature-limited Bézier fit on the polylines, applied offline to the traced/*.ts data or at render time — your call; data-side is simpler to verify) while keeping x ≤ nose region (cockpit and nose, ~first 12–15% of L) and the tail-cone end within 0.002 L of the approved shape. Prove it: per type, max deviation from the approved trace (should be small, < ~0.004 L) and a curvature plot or 2× crown crops before/after; LOOK at them. Compare against ${REF}/5-bumpy-crown.jpg (A320 hero) — the bumps must be gone.
- Keep the v0.5.1 livery sticker clipping intact (tests must stay green; re-run the clipping/magenta checks).
Return the exported changes and the before/after PNG paths (Fleet screen, A320/A321/737/757/767/A330/777/747/A380/A350 crown crops, 2×).`

const MAP = (eng) => `${COMMON}${REQUEST}
TASK (BUILD — MAP LANE): implement the map side of D, E and F. You OWN src/ui/map/** and map CSS (src/styles/**/map*.css or the map section of the touch styles). Use the engine APIs in ${SCRATCH}/api-engine.md (engine lane report below). Port 6103.
- E: always-on current flight path for each of our airborne aircraft (solid green operating; dotted amber positioning/ferry; FERRY tag), appearing at take-off, disappearing on landing; efficient (no per-frame re-rasterization of the base map; reuse the existing live-layer approach), smooth at 4×.
- D: grey commercial deadhead icons with a floating flight-number label that follows the icon, thin grey dotted path, tap → panel (airline, flight no., route, times, time to landing, our crew on board). Must not be confused with our aircraft; hit targets ≥ 44 px; works with pan/pinch.
- F: Up Next panel widened with a type column (Operating / Positioning / Ferry / Deadhead for crew travelling) + the same labels in map panels. Compare with ${REF}/6-upnext-types.jpg.
Verify at 1180×820 touch, 4×, with several flights airborne including a positioning, a ferry and a commercial deadhead (use dev helpers or a bot-advanced save). Shots in ${SCRATCH}/map/; LOOK at them; measure frame times at 4× (no regressions vs v0.5.1).
Engine lane report:
${eng}`

const UI = (eng, art) => `${COMMON}${REQUEST}
TASK (BUILD — UI LANE): implement A, the UI side of B, C and F. You OWN src/ui/** except src/ui/map/** and src/ui/components/aircraft/**, plus src/styles/** except map styles. Use ${SCRATCH}/api-engine.md. Port 6104.
- A: find and remove the cause of the blurred top bar on iPad (WebKit) — check backdrop-filter, filter, transform: translateZ/scale with fractional values, opacity on text, will-change, -webkit-font-smoothing, and the standalone safe-area band; verify crisp text in a DPR-2 WebKit-like screenshot (Playwright webkit is NOT installed; use Chromium DPR 2 and reason about WebKit specifics; prefer removing blur behind text entirely).
- B: offer card/modal states for a pending counter (clock paused, "client replies by …"), and the three outcomes; inbox texts.
- C: the crew card's Next 14 days strip renders all calendar block kinds with distinct colours, labels, tap details and a small legend; header status lines ("Joins 26 May 2027", "Sick · back ~12 Mar", "Training until …"); compare with ${REF}/2-sick-roster.jpg and 3-joining-roster.jpg.
- F: flight-type labels/colours in the Schedule (blocks + legend), flight details and crew roster, matching the map lane's colours (Operating green, Positioning/Ferry amber dotted pattern, Deadhead grey).
Shots before/after at 1180×820 in ${SCRATCH}/ui/; LOOK at them.
Engine lane report:
${eng}
Art lane report (for context):
${art}`

// ---------- Review ----------
const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      area: { type: 'string', enum: ['art', 'engine', 'map', 'ui'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } },
  },
  required: ['summary', 'findings'],
}
const AREAS = ['art', 'engine', 'map', 'ui']
const OWN = { art: 'src/ui/components/aircraft/**, src/dev/gallery.tsx', engine: 'src/engine/**, src/data/**, scripts/**', map: 'src/ui/map/** and map styles', ui: 'src/ui/** except map and aircraft, src/styles/** except map styles' }
const REVIEW_RULES = (port) => `${COMMON}${REQUEST}
REVIEW RULES: do not edit src/ or docs/ (temp files only in ${SCRATCH}/review-${port}/). Port ${port}. Assume problems exist; every finding needs evidence (screenshot path, repro, file:line) and a concrete fix. Areas: ${AREAS.map((a) => `${a} = ${OWN[a]}`).join('; ')}.`
const REVIEWS = [
  { key: 'player', port: 6111, prompt: `TASK (PLAYER-EYE REVIEW): you are the player — a former ACMI flight attendant on an iPad home-screen app (1180×820, touch). Check every item A–G of the fix list against their screenshots: is each one fixed the way they asked? Play ~2 game months at 1×/2×/4×: counter an urgent offer and a normal one (several times), open crew cards (sick, joining, training, off, deadheading crew), watch flights on the map (operating, positioning, ferry, commercial deadheads; tap them), read Up Next and the Schedule. Judge correctness against airline reality (would a crew member nod?), clarity, and calm visuals.` },
  { key: 'qa', port: 6112, prompt: `TASK (QA & iPad REVIEW): hunt bugs and regressions: console errors, save → reload mid-flight with commercial deadheads and pending counters, old v0.5.1 saves loading with defaults, determinism (bot seeds 1–3 twice), performance at 4× with many paths and grey icons (frame times vs v0.5.1), map pan/pinch with labels, tap targets ≥ 44 px, text ≥ 12 px, overflow at 1180×750 and 1180×820, livery sticker clipping still intact on all types (magenta test), art smoothness on every traced type, windows present at every AircraftArt size.` },
]
const VERDICTS = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { idx: { type: 'integer' }, real: { type: 'boolean' }, note: { type: 'string' } }, required: ['idx', 'real', 'note'] } } }, required: ['verdicts'] }
const VERIFY = (list, port) => `${REVIEW_RULES(port)}
TASK (REFUTE): for each finding below, try to reproduce it yourself. real=false if it does not reproduce, is already handled, or is by design per the fix list/BRIEF; default to real=false when you cannot confirm. Note what you saw.
${list.map((f, i) => `[${i}] [${f.area}/${f.severity}] ${f.problem}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}`
const FIX = (area, list, round) => `${COMMON}${REQUEST}
TASK (FIX — ${area.toUpperCase()}, round ${round}): fix the verified findings below. You own: ${OWN[area]}; other fix lanes run concurrently on the other areas. Re-check each first; fix all high and medium and the cheap lows. Keep tsc, vitest, vite build green; re-shoot affected screens or re-run bot seeds 1–3 one at a time (engine). Port ${6120 + round * 10 + AREAS.indexOf(area)}.
Return (≤ 300 words): per finding fixed / skipped (why).
${list.map((f, i) => `${i + 1}. [${f.severity}] ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}${f.note ? `\n   verifier: ${f.note}` : ''}`).join('\n')}`
const READY_SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' }, report: { type: 'string' }, blockers: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: AREAS }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } } }, required: ['ready', 'report', 'blockers'] }
const READY = (fixes, round) => `${COMMON}${REQUEST}
TASK (RELEASE READINESS v0.5.2, round ${round}): you own everything; the fix lanes are done (reports below). Port ${6151 + round}. Verify: tsc, vitest, vite build; bot seeds 1–3 one at a time; scripts/ipad-shots.cjs --standalone at 1180×820 and 1180×750 and LOOK at every shot; a touch play-through covering every fix-list item A–G (each one explicitly confirmed with a screenshot); save → reload mid-flight; zero console errors; frame times at 4× not worse than v0.5.1. Fix anything small yourself (< ~30 lines); list the rest as blockers. ready=true only if every item A–G is fixed as the player asked and nothing regressed. Shots in ${SCRATCH}/ready-${round}/ and list the key ones (one per item) in the report.
Fix reports:
${fixes}`

// ================= RUN =================
phase('Build')
const [eng, art] = await parallel([
  () => agent(ENGINE, { label: 'v052:engine', phase: 'Build', ...OPUS }),
  () => agent(ART, { label: 'v052:art', phase: 'Build', ...OPUS }),
])
const engText = eng ?? '(engine lane failed — read api-engine.md and the code)'
const [map, ui] = await parallel([
  () => agent(MAP(engText), { label: 'v052:map', phase: 'Build', ...OPUS }),
  () => agent(UI(engText, art ?? '(art lane failed)'), { label: 'v052:ui', phase: 'Build', ...OPUS }),
])

phase('Review')
const reports = `## ENGINE\n${engText}\n## ART\n${art}\n## MAP\n${map}\n## UI\n${ui}`
const reviews = await parallel(REVIEWS.map((r) => () => agent(`${REVIEW_RULES(r.port)}\n${r.prompt}\nBuild reports:\n${reports}`, { label: `v052:review:${r.key}`, phase: 'Review', schema: FINDINGS, ...OPUS })))
const raw = reviews.flatMap((r) => (r ? r.findings : []))
log(`${raw.length} findings (${raw.filter((f) => f.severity === 'high').length} high)`)
const confirmed = []
await parallel(AREAS.map((area) => async () => {
  const xs = raw.filter((f) => f.area === area)
  if (!xs.length) return
  const v = await agent(VERIFY(xs, 6115 + AREAS.indexOf(area)), { label: `v052:verify:${area}`, phase: 'Review', schema: VERDICTS, ...OPUS })
  xs.forEach((f, i) => { const vv = v ? v.verdicts.find((x) => x.idx === i) : null; if (!vv || vv.real) confirmed.push({ ...f, note: vv ? vv.note : 'unverified' }) })
}))
log(`${confirmed.length} confirmed`)

phase('Fix')
const runFix = async (list, round) => {
  const areas = AREAS.filter((a) => list.some((f) => f.area === a))
  const reps = await parallel(areas.map((a) => () => agent(FIX(a, list.filter((f) => f.area === a), round), { label: `v052:fix:${a}:r${round}`, phase: 'Fix', ...OPUS })))
  return areas.map((a, i) => `## ${a}\n${reps[i] ?? '(failed)'}`).join('\n\n')
}
let fixText = confirmed.length ? await runFix(confirmed, 1) : 'no confirmed findings'
let ready = await agent(READY(fixText, 1), { label: 'v052:ready:1', phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
if (ready && !ready.ready && ready.blockers.length) {
  fixText = await runFix(ready.blockers, 2)
  ready = await agent(READY(fixText, 2), { label: 'v052:ready:2', phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
}
return { engine: engText.slice(0, 1200), art: (art ?? '').slice(0, 1200), map: (map ?? '').slice(0, 1200), ui: (ui ?? '').slice(0, 1200), findings: raw.length, confirmed: confirmed.length, ready: ready ? ready.ready : null, blockers: ready ? ready.blockers : null, report: ready ? ready.report : null }
