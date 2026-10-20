export const meta = {
  name: 'blockhours-livery-v051',
  description: 'BLOCK HOURS v0.5.1: livery editor (clipped sticker letters, colours, drag), 15 logos, per-aircraft & client liveries on contracts, visual consistency pass; review, verify, fix, readiness',
  phases: [
    { title: 'Design', detail: 'one design doc for liveries + client paint requests' },
    { title: 'Build', detail: 'art/editor lane ∥ engine/contracts lane, then UI wiring + visual consistency lane' },
    { title: 'Review', detail: 'player-eye review + QA/iPad review → refute' },
    { title: 'Fix', detail: 'fix confirmed findings, readiness (≤ 2 rounds)' },
  ],
}

const WT = '/home/user/wt/acmi'
const SCRATCH = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi/livery'
const OPUS = { model: 'opus', effort: 'high' }

const COMMON = `
PROJECT: BLOCK HOURS v0.5 (released) — a browser game (Vite 6 + React 19 + TypeScript strict; hand-written CSS; d3-geo map; lz-string saves; PWA; vitest) where the player runs a small ACMI / wet-lease / charter airline. Work ONLY in ${WT} (branch acmi, which now contains the merged aircraft art). Docs: ${WT}/docs/acmi/BRIEF.md (plan of record; "Player decisions" at the end override everything), DESIGN.md, BUILD-PLAN.md (ground rules: engine determinism — engine RNG only, read APIs pure, ids via nextId; money only via ledger helpers; flights only via core helpers; SAVE_VERSION stays 1 with ??= defaults in load). Aircraft art: src/ui/components/aircraft/ (AircraftArt.tsx renders every type nose-RIGHT with no landing gear, from traced profiles in traced/*.ts and specs/*.ts; geometry.ts; README.md there documents liveries). The player is a former ACMI flight attendant who plays on an iPad (A16) in LANDSCAPE (1180×750 Safari, 1180×820 home-screen app), touch only; desktop must still work. The art outlines were traced from the player's photos and approved — never change airframe outlines, noses, windows or engines.
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · npx tsx scripts/acmi-bot.ts <seed> 365 · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID; never pkill node/vite/tsx). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; touch via page.touchscreen.tap and synthesized pointer events; view PNGs with Read. scripts/ipad-shots.cjs takes iPad screenshots of every screen. window.__contrail exposes the store and dev helpers.
Rules: other agents may work in this worktree at the same time — edit ONLY the files you own (your task lists them); shared files get minimal additive edits, re-read before editing, retry if Edit says the file changed. No git commit/checkout/merge/reset/stash (the orchestrator commits). Temp files in ${SCRATCH}/<your-label>/. TypeScript strict, terse comments in the existing style, no new npm dependencies. Keep tsc, vitest and vite build green for your files. Reports are data for the orchestrator: concrete, ≤ 400 words.
`

const REQUEST = `
PLAYER REQUEST (verbatim intent):
1. BUG: in the aircraft customiser the letters on the tail sometimes float outside the fin. Fix it.
2. More customisation: letter colours; drag letters (tail code, titles) around the aircraft body; anything dragged outside the airframe is clipped automatically, like a sticker — nothing ever floats outside the aircraft.
3. About 15 generic airline-style logos designed by us (original artwork, not real airline marks), usable on the tail and fuselage, colourable.
4. Each aircraft can have a different livery, the company livery, or plain all-white.
5. Clients can request, as part of an offer, that the aircraft be painted in their livery for the contract (especially long-term contracts); this is part of the deal.
6. Fix any visual inconsistencies across the game.`

// ---------- Design ----------
const DESIGN = `${COMMON}${REQUEST}
TASK (DESIGN — write ${WT}/docs/acmi/LIVERY.md; do not edit src/): read the current livery model (grep -rn "livery" src; AircraftArt.tsx, geometry.ts, the customiser in NewGame.tsx / Fleet.tsx / wherever it lives, save.ts, engine types) and design v0.5.1 so three builders can implement it in parallel without stepping on each other. Cover:
- **Data model** (engine types, saved): CompanyLivery (base scheme from the existing set, colours, tail code text + colour + font weight, titles text + colour, logo id + colour(s), placements of each sticker element as {elementId, side: fuselage|fin, x, y (fractions of the airframe frame), scale, rotation?}); per-aircraft liveryRef: 'company' | 'white' | {custom: Livery} | {client: contractId}; client livery spec for a contract (client brand colours, title text = client name, logo id from a client-side generic set or a simple monogram, scheme). Defaults so existing saves load unchanged (??=).
- **Renderer contract**: how AircraftArt draws stickers clipped to the airframe (one clipPath from the fuselage+fin outlines per type, sticker layers inside it), tail-code fit-to-fin (auto-size so it never exceeds the fin box), mirrored-art handling (art is mirrored to nose-right — text must read correctly and drag coordinates must map correctly), the logo set (15 original vector logos as path data in src/ui/components/aircraft/logos.ts with names; simple, bold, readable at mini size).
- **Editor UX on iPad**: where it lives (company livery in New Game + Company/Fleet screen; per-aircraft livery in the aircraft card), drag with touch (pointer events, snapping guides, pinch or slider to scale), colour pickers (preset swatches + custom), preview at hero/card/mini, reset, apply to all / to one aircraft, white option.
- **Client paint requests (engine)**: which archetypes request it and how often (long ACMI bases / multi-month & multi-year deals mostly; ad hoc rarely), the offer terms (client pays paint or splits, rate bonus or required, paint shop downtime of N days before the contract at a paint-capable station, repaint/strip at the end with downtime and cost, penalty if declined: the client may withdraw or lower the rate), feasibility/schedule integration (paint downtime blocks the aircraft on the Schedule like maintenance), finance lines (paint cost, client reimbursement), map/fleet/schedule show the client livery during the contract, real client names are used (the BRIEF allows it), what the bot does. Use RESEARCH.md numbers if present; otherwise realistic ones (narrowbody full paint ~7–10 days, ~$150–250k; widebody ~10–14 days, ~$300–500k; decal/partial livery 2–3 days, ~$30–80k).
- **File ownership** for 3 lanes: ART (renderer, clipping, logos, editor components), ENGINE (types, save defaults, offers/feasibility/schedule/finance/bot for paint requests, tests), UI (screens wiring: customiser placement, per-aircraft livery picker, offer modal paint terms, schedule paint blocks, inbox texts) + the VISUAL CONSISTENCY pass. Define the exact function/prop signatures between lanes.
- **Acceptance criteria and tests** per lane.
Return (≤ 300 words): summary of the design and the file-ownership table.`

// ---------- Build ----------
const ART = (design) => `${COMMON}${REQUEST}
TASK (BUILD — ART & EDITOR LANE): implement the ART lane of ${WT}/docs/acmi/LIVERY.md exactly (read it first; it defines your files and the signatures other lanes rely on). Must include: the tail-letter float bug fixed for every type (tail code auto-fits and is clipped to the fin), sticker elements clipped to the airframe on every type (verify all ~39 types at hero/card/mini), letter colours, touch drag (and scale) of tail code / titles / logo with correct coordinates on the mirrored art, 15 original logos (logos.ts) that look good and distinct at mini size, all-white option, and a reusable editor component the UI lane mounts. Port 6001. Show before/after screenshots of the float bug and a gallery of the 15 logos on an A320 and a 777 tail into ${SCRATCH}/art/ and LOOK at them. Tests for clipping math and coordinate mapping.
Design summary from the design agent:
${design}`

const ENGINE = (design) => `${COMMON}${REQUEST}
TASK (BUILD — ENGINE LANE): implement the ENGINE lane of ${WT}/docs/acmi/LIVERY.md exactly (read it first). Must include: livery data model + save defaults (old saves load unchanged), per-aircraft liveryRef, client paint requests on offers for the right archetypes with clear terms, paint/strip downtime that blocks the aircraft on the schedule (and feasibility explains it), finance lines, decision texts, the bot handling them sensibly, and tests (offer generation rates, feasibility with paint downtime, finance, save/load, determinism). Run the bot for seeds 1–3 (one at a time): balance targets must still hold (solvent, margin −5…+12%, uncovered < 2%, 0 illegal duties flown, < 10 s each). Port 6002.
Design summary from the design agent:
${design}`

const UI = (design, art, eng) => `${COMMON}${REQUEST}
TASK (BUILD — UI LANE + VISUAL CONSISTENCY): implement the UI lane of ${WT}/docs/acmi/LIVERY.md (read it first) on top of the finished ART and ENGINE lanes (reports below): mount the livery editor (company livery in New Game and the Company/Fleet screen; per-aircraft picker incl. company / own custom / all white), offer modal paint-request terms (accept/decline the paint with consequences), paint/strip blocks on the Schedule, client livery visible on the map panels, fleet cards and schedule during the contract, inbox texts. Then do the VISUAL CONSISTENCY pass over the whole game: run scripts/ipad-shots.cjs at 1180×750 and 1180×820, look at EVERY screen and modal, and fix inconsistencies (spacing scale, font sizes/weights, colour tokens, button styles, icon sizes, alignment, truncation, empty states, aircraft art sizes and backgrounds, dark/light surfaces, touch targets ≥ 44 px, text ≥ 12 px, nothing clipped, modals fit 750 px). Keep calm visuals; nothing flickers. Port 6003. Before/after shots in ${SCRATCH}/ui/.
ART lane report:
${art}
ENGINE lane report:
${eng}`

// ---------- Review ----------
const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      area: { type: 'string', enum: ['art', 'engine', 'ui'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } },
  },
  required: ['summary', 'findings'],
}
const REVIEW_RULES = (port) => `${COMMON}${REQUEST}
REVIEW RULES: do not edit src/ or docs/ (temp files only in ${SCRATCH}/review-${port}/). Port ${port}. Assume problems exist; every finding needs evidence (screenshot path, repro, file:line) and a concrete fix. Areas: art = src/ui/components/aircraft/**; engine = src/engine/**, scripts/**; ui = everything else under src/ui and src/styles.`
const REVIEWS = [
  { key: 'player', port: 6011, prompt: `TASK (PLAYER-EYE REVIEW): you are the player — a former ACMI flight attendant on an iPad in landscape. Play with the livery features for real (touch only, 1180×820): design a company livery, drag the tail code and titles around (try to drag them off the aircraft — they must clip, never float), change letter colours, try all 15 logos, give one aircraft its own livery and another all-white, accept a long-term contract whose client asks for its livery (check the offer terms, the paint downtime on the schedule, the money, the client livery on the map/fleet during the contract and the repaint at the end), and decline one. Judge: does it feel good, is it clear, does anything look off or inconsistent, is the tail-letter bug gone on every type? Also look at every other screen for visual inconsistencies.` },
  { key: 'qa', port: 6012, prompt: `TASK (QA & iPad REVIEW): hunt bugs: livery state after save → reload, old saves (create a save with the previous code path if possible, or a hand-made v0.5 save JSON) load with defaults, drag edge cases (multi-touch, very fast drags, dragging onto the fin from the fuselage, every aircraft type incl. Concorde and turboprops), clipping on all ~39 types at hero/card/mini, text overflow with long titles, colour contrast, performance (map with 8 painted aircraft at 4×), console errors, determinism (bot seeds 1–3 identical across two runs), tap targets ≥ 44 px, modals fitting 750 px, anything that flickers.` },
]

const VERDICTS = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { idx: { type: 'integer' }, real: { type: 'boolean' }, note: { type: 'string' } }, required: ['idx', 'real', 'note'] } } }, required: ['verdicts'] }
const VERIFY = (list, port) => `${REVIEW_RULES(port)}
TASK (REFUTE): for each finding below, try to reproduce it yourself. real=false if it does not reproduce, is already handled, or is by design per LIVERY.md/BRIEF.md; default to real=false when you cannot confirm. Note what you saw.
${list.map((f, i) => `[${i}] [${f.area}/${f.severity}] ${f.problem}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}`

const FIX = (area, list, round) => `${COMMON}${REQUEST}
TASK (FIX — ${area.toUpperCase()}, round ${round}): fix the verified findings below. You own: ${area === 'art' ? 'src/ui/components/aircraft/**' : area === 'engine' ? 'src/engine/**, scripts/**' : 'src/ui/** except src/ui/components/aircraft/**, src/styles/**'}; other fix lanes run concurrently on the other areas. Re-check each first; fix all high and medium and the cheap lows. Keep tsc, vitest, vite build green; re-shoot affected screens (art/ui) or re-run bot seeds 1–3 one at a time (engine). Port ${6020 + round * 10 + ['art', 'engine', 'ui'].indexOf(area)}.
Return (≤ 300 words): per finding fixed / skipped (why).
${list.map((f, i) => `${i + 1}. [${f.severity}] ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}${f.note ? `\n   verifier: ${f.note}` : ''}`).join('\n')}`

const READY_SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' }, report: { type: 'string' }, blockers: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: ['art', 'engine', 'ui'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } } }, required: ['ready', 'report', 'blockers'] }
const READY = (fixes, round) => `${COMMON}${REQUEST}
TASK (RELEASE READINESS v0.5.1, round ${round}): you own everything; the fix lanes are done (reports below). Port ${6051 + round}. Verify: tsc, vitest, vite build; bot seeds 1–3 one at a time (solvent, margin −5…+12%, uncovered < 2%, 0 illegal duties flown, < 10 s); scripts/ipad-shots.cjs at 1180×750 and 1180×820 and LOOK at every shot; a touch play-through using every livery feature (design, drag off the airframe → clipped, colours, logos, per-aircraft and white, client paint request accepted and declined); save → reload mid-flight; zero console errors; nothing floats outside any aircraft at hero/card/mini on all types. Fix anything small yourself (< ~30 lines); list the rest as blockers. ready=true only if the player would enjoy it with no visible defect. Shots in ${SCRATCH}/ready-${round}/.
Fix reports:
${fixes}`

// ================= RUN =================
phase('Design')
const design = await agent(DESIGN, { label: 'livery:design', phase: 'Design', ...OPUS })
const designText = design ?? '(design agent failed — read docs/acmi/LIVERY.md if it exists, else design your lane yourself)'

phase('Build')
const [art, eng] = await parallel([
  () => agent(ART(designText), { label: 'livery:art', phase: 'Build', ...OPUS }),
  () => agent(ENGINE(designText), { label: 'livery:engine', phase: 'Build', ...OPUS }),
])
const ui = await agent(UI(designText, art ?? '(art lane failed)', eng ?? '(engine lane failed)'), { label: 'livery:ui+visual', phase: 'Build', ...OPUS })

phase('Review')
const reviews = await parallel(REVIEWS.map((r) => () => agent(`${REVIEW_RULES(r.port)}\n${r.prompt}\nBuild reports:\n## ART\n${art}\n## ENGINE\n${eng}\n## UI\n${ui}`, { label: `livery:review:${r.key}`, phase: 'Review', schema: FINDINGS, ...OPUS })))
const raw = reviews.flatMap((r) => (r ? r.findings : []))
log(`${raw.length} findings (${raw.filter((f) => f.severity === 'high').length} high)`)
const confirmed = []
for (const area of ['art', 'engine', 'ui']) {
  const xs = raw.filter((f) => f.area === area)
  if (!xs.length) continue
  const v = await agent(VERIFY(xs, 6015 + ['art', 'engine', 'ui'].indexOf(area)), { label: `livery:verify:${area}`, phase: 'Review', schema: VERDICTS, ...OPUS })
  xs.forEach((f, i) => { const vv = v ? v.verdicts.find((x) => x.idx === i) : null; if (!vv || vv.real) confirmed.push({ ...f, note: vv ? vv.note : 'unverified' }) })
}
log(`${confirmed.length} confirmed`)

phase('Fix')
const runFix = async (list, round) => {
  const areas = ['art', 'engine', 'ui'].filter((a) => list.some((f) => f.area === a))
  const reps = await parallel(areas.map((a) => () => agent(FIX(a, list.filter((f) => f.area === a), round), { label: `livery:fix:${a}:r${round}`, phase: 'Fix', ...OPUS })))
  return areas.map((a, i) => `## ${a}\n${reps[i] ?? '(failed)'}`).join('\n\n')
}
let fixText = confirmed.length ? await runFix(confirmed, 1) : 'no confirmed findings'
let ready = await agent(READY(fixText, 1), { label: 'livery:ready:1', phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
if (ready && !ready.ready && ready.blockers.length) {
  fixText = await runFix(ready.blockers, 2)
  ready = await agent(READY(fixText, 2), { label: 'livery:ready:2', phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
}
return { design: designText.slice(0, 1500), art: (art ?? '').slice(0, 1500), engine: (eng ?? '').slice(0, 1500), ui: (ui ?? '').slice(0, 1500), findings: raw.length, confirmed: confirmed.length, ready: ready ? ready.ready : null, blockers: ready ? ready.blockers : null, report: ready ? ready.report : null }
