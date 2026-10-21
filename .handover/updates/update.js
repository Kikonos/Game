export const meta = {
  name: 'blockhours-update',
  description: 'Build one agreed BLOCK HOURS update (args: version, name, doc, features): design doc, engine lane then UI ∥ map lanes, player-eye + QA + realism/balance reviews, refute, fix, readiness (≤ 2 rounds)',
  phases: [
    { title: 'Design', detail: 'one design doc with lane ownership and APIs' },
    { title: 'Build', detail: 'engine lane, then UI ∥ map lanes' },
    { title: 'Review', detail: 'player-eye, QA/iPad, realism & balance → refute' },
    { title: 'Fix', detail: 'fix confirmed findings, readiness (≤ 2 rounds)' },
  ],
}

const V = args.version
const WT = '/home/user/wt/acmi'
const SCRATCH = `/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi/updates/${V}`
const DOC = `${WT}/docs/acmi/${args.doc}`
const OPUS = { model: 'opus', effort: 'high' }
const PORT0 = 6200 + Math.round(parseFloat(V.slice(1)) * 100) % 100 * 10

const COMMON = `
PROJECT: BLOCK HOURS (released up to v0.5.2) — a browser game (Vite 6 + React 19 + TypeScript strict; hand-written CSS; d3-geo map; lz-string saves; PWA; vitest) where the player runs a small ACMI / wet-lease / charter airline. You are building update ${V} "${args.name}". Work ONLY in ${WT} (branch acmi). Docs: ${WT}/docs/acmi/BRIEF.md ("Player decisions" override everything: real names, invented events allowed, Dubai player, iPad landscape, calm visuals, 1×/2×/4× only), DESIGN.md, BUILD-PLAN.md (ground rules: engine determinism — engine RNG only, read APIs pure, ids via nextId; money only via ledger helpers; flights only via core helpers; SAVE_VERSION stays 1 with ??= defaults in load so OLD SAVES KEEP WORKING), LIVERY.md, RESEARCH.md (industry facts and numbers), and this update's design doc ${DOC} once written. The player is a former ACMI flight attendant (euroAtlantic 767/777, Getjet/Airhub A320/A330) playing on an iPad (A16) home-screen app in LANDSCAPE (1180×820; Safari 1180×750), touch only; desktop must still work. They want it hard but not grindy, realistic, calm (nothing flickers; only aircraft move).
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · npx tsx scripts/acmi-bot.ts <seed> 365 (one seed at a time) · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID; never pkill node/vite/tsx). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; touch via page.touchscreen.tap; view PNGs with Read. scripts/ipad-shots.cjs (--standalone) shoots every screen. window.__contrail exposes the store and dev helpers.
Rules: agents may work in this worktree at the same time — edit ONLY the files you own (your task lists them); shared files (src/engine/core/types.ts, src/ui/store.ts, src/engine/core/balance.ts) get minimal additive edits, re-read before editing, retry if Edit says the file changed. No git commit/checkout/merge/reset/stash (the orchestrator commits). Temp files in ${SCRATCH}/<your-label>/. TypeScript strict, terse comments in the existing style, no new npm dependencies. Keep tsc, vitest and vite build green. Reports are data for the orchestrator: concrete, ≤ 400 words, listing exported functions/props other lanes use.
`
const FEATURES = `\nTHE AGREED FEATURES FOR ${V}:\n${args.features}\n`

const DESIGN = `${COMMON}${FEATURES}
TASK (DESIGN — write ${DOC}; do not edit src/): read the relevant code and docs, then design ${V} so three lanes can build it in parallel. For each feature: data model (optional fields + load defaults), engine rules with concrete numbers (cite RESEARCH.md or realistic industry values), player-facing UI (which screen, layout at 1180×820, touch interactions), inbox texts, balance intent, bot behaviour (scripts/acmi-bot.ts must play the new systems sensibly), tests and acceptance criteria. Then a FILE-OWNERSHIP table for three lanes — ENGINE (src/engine/**, src/data/**, scripts/**, tests), UI (src/ui/** except src/ui/map/** and src/ui/components/aircraft/**; src/styles/** except map styles), MAP (src/ui/map/**, map styles; may be empty for some updates) — and the exact function/prop signatures between them. Keep it as simple as the player asked; don't add features they didn't agree to.
Return (≤ 300 words): summary + ownership table.`

const ENGINE = (d) => `${COMMON}${FEATURES}
TASK (BUILD — ENGINE LANE): implement the ENGINE lane of ${DOC} exactly (read it first). Write ${SCRATCH}/api-engine.md early with the exported signatures and keep it current. Tests for every rule. Bot (scripts/acmi-bot.ts) plays the new systems; run seeds 1–6 one at a time: solvent, margin −5…+12% (mean ~+2–5%), uncovered < 2%, 0 illegal duties/crew flown, ≥ 1 meaningful action per week, < 10 s each; same-seed determinism (incl. save/load mid-game). Old saves (create one from the previous release behaviour or a hand-made JSON) load with defaults. Port ${PORT0 + 1}.
Design summary: ${d}`
const UI = (d, e) => `${COMMON}${FEATURES}
TASK (BUILD — UI LANE): implement the UI lane of ${DOC} on top of the engine APIs (${SCRATCH}/api-engine.md; engine report below). iPad landscape touch first: targets ≥ 44 px, text ≥ 12 px, modals fit 750 px, no overflow at 1180×750/1180×820, calm (no flicker). Before/after screenshots at 1180×820 in ${SCRATCH}/ui/ — LOOK at them. Port ${PORT0 + 2}.
Design summary: ${d}
Engine report: ${e}`
const MAP = (d, e) => `${COMMON}${FEATURES}
TASK (BUILD — MAP LANE): implement the MAP lane of ${DOC} (if the doc gives the map lane nothing, verify that and return "nothing to do"). Use ${SCRATCH}/api-engine.md. Efficient (no per-frame base-map redraws), smooth at 4×, calm. Shots in ${SCRATCH}/map/. Port ${PORT0 + 3}.
Design summary: ${d}
Engine report: ${e}`

const FINDINGS = { type: 'object', properties: { summary: { type: 'string' }, findings: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: ['engine', 'ui', 'map'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } } }, required: ['summary', 'findings'] }
const AREAS = ['engine', 'ui', 'map']
const OWN = { engine: 'src/engine/**, src/data/**, scripts/**', ui: 'src/ui/** except map and aircraft art, src/styles/** except map styles', map: 'src/ui/map/** and map styles' }
const RR = (port) => `${COMMON}${FEATURES}
REVIEW RULES: do not edit src/ or docs/ (temp files only in ${SCRATCH}/review-${port}/). Port ${port}. Assume problems exist; every finding needs evidence (screenshot path, repro, file:line) and a concrete fix. Areas: ${AREAS.map((a) => `${a} = ${OWN[a]}`).join('; ')}.`
const REVIEWS = [
  { key: 'player', port: PORT0 + 4, prompt: `TASK (PLAYER-EYE REVIEW): you are the player (former ACMI flight attendant) on the iPad home-screen app at 1180×820 with touch. Use every new feature of ${V} for real over ~3 game months at 1×/2×/4×. Is each agreed feature there and working as they described it? Is it clear, fun, not grindy, not too complex? Would an airline insider nod at the details? Anything visually inconsistent with the rest of the game?` },
  { key: 'qa', port: PORT0 + 5, prompt: `TASK (QA & iPad REVIEW): hunt bugs and regressions across ${V} and the existing game: console errors; save → reload mid-flight; OLD SAVES from v0.5.2 load with defaults; determinism (bot seeds 1–3 twice); performance at 4× (frame times not worse than before); tap targets/text sizes/overflow at 1180×750 and 1180×820; edge cases of every new feature (empty states, extremes, cancellations, conflicts).` },
  { key: 'realism', port: PORT0 + 6, prompt: `TASK (REALISM & BALANCE REVIEW): compare every new rule and number of ${V} with RESEARCH.md and real airline/ACMI practice (durations, costs, regulations, how real clients/lessors/operators behave). Run bot seeds 1–6 and judge balance: hard but fair, not grindy, no exploit, no dead feature. Propose concrete numbers.` },
]
const VERDICTS = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: { idx: { type: 'integer' }, real: { type: 'boolean' }, note: { type: 'string' } }, required: ['idx', 'real', 'note'] } } }, required: ['verdicts'] }
const VERIFY = (list, port) => `${RR(port)}
TASK (REFUTE): for each finding, try to reproduce it. real=false if it does not reproduce, is already handled, or is by design per ${DOC}/BRIEF; default real=false if you cannot confirm. Note what you saw.
${list.map((f, i) => `[${i}] [${f.area}/${f.severity}] ${f.problem}\n  evidence: ${f.evidence}\n  fix: ${f.fix}`).join('\n')}`
const FIX = (area, list, round) => `${COMMON}${FEATURES}
TASK (FIX — ${area.toUpperCase()}, round ${round}): fix the verified findings below. You own: ${OWN[area]}; other fix lanes run concurrently. Re-check each first; fix all high/medium and cheap lows. Keep tsc/vitest/build green; re-shoot affected screens or re-run bot seeds (one at a time). Port ${PORT0 + 7 + AREAS.indexOf(area)}.
Return (≤ 300 words): per finding fixed / skipped (why).
${list.map((f, i) => `${i + 1}. [${f.severity}] ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}${f.note ? `\n   verifier: ${f.note}` : ''}`).join('\n')}`
const READY_SCHEMA = { type: 'object', properties: { ready: { type: 'boolean' }, report: { type: 'string' }, blockers: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: AREAS }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } } }, required: ['ready', 'report', 'blockers'] }
const READY = (fixes, round) => `${COMMON}${FEATURES}
TASK (RELEASE READINESS ${V}, round ${round}): you own everything; the fix lanes are done (reports below). Port ${PORT0 + 9 - round}. Verify: tsc, vitest, vite build; bot seeds 1–6 one at a time (targets as in the engine lane); scripts/ipad-shots.cjs --standalone at 1180×820 and 1180×750 — LOOK at every shot; a touch play-through confirming EVERY agreed feature with a screenshot each; save → reload mid-flight; old v0.5.2 save loads; zero console errors; frame times at 4× not worse. Fix small things yourself (< ~30 lines); list the rest as blockers. ready=true only if every agreed feature works as the player asked and nothing regressed. Shots in ${SCRATCH}/ready-${round}/; name one key shot per feature in the report, plus a short player-facing "what's new" list.
Fix reports:
${fixes}`

// ================= RUN =================
phase('Design')
const d = (await agent(DESIGN, { label: `${V}:design`, phase: 'Design', ...OPUS })) ?? `(design agent failed — read ${DOC} if present, else design your lane yourself)`
phase('Build')
const e = (await agent(ENGINE(d), { label: `${V}:engine`, phase: 'Build', ...OPUS })) ?? '(engine lane failed — read api-engine.md and the code)'
const [u, m] = await parallel([
  () => agent(UI(d, e), { label: `${V}:ui`, phase: 'Build', ...OPUS }),
  () => agent(MAP(d, e), { label: `${V}:map`, phase: 'Build', ...OPUS }),
])
phase('Review')
const reports = `## DESIGN\n${d}\n## ENGINE\n${e}\n## UI\n${u}\n## MAP\n${m}`
const reviews = await parallel(REVIEWS.map((r) => () => agent(`${RR(r.port)}\n${r.prompt}\nBuild reports:\n${reports}`, { label: `${V}:review:${r.key}`, phase: 'Review', schema: FINDINGS, ...OPUS })))
const raw = reviews.flatMap((r) => (r ? r.findings : []))
log(`${raw.length} findings (${raw.filter((f) => f.severity === 'high').length} high)`)
const confirmed = []
await parallel(AREAS.map((area) => async () => {
  const xs = raw.filter((f) => f.area === area)
  if (!xs.length) return
  const v = await agent(VERIFY(xs, PORT0 + 4 + AREAS.indexOf(area)), { label: `${V}:verify:${area}`, phase: 'Review', schema: VERDICTS, ...OPUS })
  xs.forEach((f, i) => { const vv = v ? v.verdicts.find((x) => x.idx === i) : null; if (!vv || vv.real) confirmed.push({ ...f, note: vv ? vv.note : 'unverified' }) })
}))
log(`${confirmed.length} confirmed`)
phase('Fix')
const runFix = async (list, round) => {
  const areas = AREAS.filter((a) => list.some((f) => f.area === a))
  const reps = await parallel(areas.map((a) => () => agent(FIX(a, list.filter((f) => f.area === a), round), { label: `${V}:fix:${a}:r${round}`, phase: 'Fix', ...OPUS })))
  return areas.map((a, i) => `## ${a}\n${reps[i] ?? '(failed)'}`).join('\n\n')
}
let fixText = confirmed.length ? await runFix(confirmed, 1) : 'no confirmed findings'
let ready = await agent(READY(fixText, 1), { label: `${V}:ready:1`, phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
if (ready && !ready.ready && ready.blockers.length) {
  fixText = await runFix(ready.blockers, 2)
  ready = await agent(READY(fixText, 2), { label: `${V}:ready:2`, phase: 'Fix', schema: READY_SCHEMA, ...OPUS })
}
return { version: V, findings: raw.length, confirmed: confirmed.length, ready: ready ? ready.ready : null, blockers: ready ? ready.blockers : null, report: ready ? ready.report : null }
