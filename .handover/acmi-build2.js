export const meta = {
  name: 'acmi-build-v05b',
  description: 'Finish BLOCK HOURS v0.5: B3 ops/finance/events + B5 screens + real names, integrate and rebrand, adversarial gameplay + QA review, fixes',
  phases: [
    { title: 'Build', detail: 'B3, B5 (continue) and real-names pass' },
    { title: 'Integrate', detail: 'wire end-to-end, rebrand to BLOCK HOURS, roster adjust, headless bot year' },
    { title: 'Review', detail: 'gameplay/realism critic + QA/iPad critic' },
    { title: 'Fix', detail: 'engine fixes + UI fixes' },
  ],
}

const WT = '/home/user/wt/acmi'
const SCRATCH = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi'
const COMMON = `
PROJECT: "BLOCK HOURS" (formerly CONTRAIL), a browser game (Vite 6 + React 19 + TypeScript strict; hand-written CSS; d3-geo world map; lz-string saves; PWA; vitest) in which the player runs a small ACMI / wet-lease / charter operator. Work ONLY in ${WT} (branch acmi). Before coding read: ${WT}/docs/acmi/BRIEF.md (plan of record), ${WT}/docs/acmi/DESIGN.md (technical design: state model, time model, module map, algorithms, UI plan), ${WT}/docs/acmi/BUILD-PLAN.md (your builder section: owned files, functions, acceptance criteria, tests) and the relevant parts of ${WT}/docs/acmi/RESEARCH.md (facts and numbers). The skeleton already builds and runs. Builders B1 (contracts), B2 (crew/HR) and B4 (live map) are FINISHED — their reports are in ${SCRATCH}/reports-b124.md. IMPORTANT player decisions (end of BRIEF.md): the game is named BLOCK HOURS; home base chosen at start; named crew with an adjustable auto-roster; use REAL company/government/agency/broker/rival names (factual and neutral, never invent wrongdoing); the old airline game is replaced.
TARGET: iPad (A16) in LANDSCAPE (1180×750 Safari, 1180×820 home-screen app), touch; desktop must still work. Calm visuals: no flicker, no scrolling tickers, quiet toasts; only aircraft positions animate.
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; view PNGs with Read. window.__contrail exposes the store (and __contrail.dev helpers per DESIGN).
Rules: other builders work in this worktree at the same time — edit ONLY files you own per BUILD-PLAN.md (shared files: only the minimal additive edits BUILD-PLAN allows; re-read before editing; if Edit says the file changed, re-read and retry). If you need a change in another builder's file, implement a local workaround and list the request in your report. No git commit/checkout/merge/reset (the orchestrator commits). Never pkill node/vite/tsx. Temp files in ${SCRATCH}/. TypeScript strict, terse comments, no new npm dependencies. Keep the build green for YOUR files (ignore transient errors in files you don't own). If your files already contain partial work from an interrupted attempt, continue it. EFFICIENCY: session usage is limited — avoid re-reading large files, screenshot selectively, keep the report short.
`

const BUILDERS_ALL = [
  { key: 'B1', port: 5601, title: 'Contracts & commercial', extra: 'Make offers feel alive and varied (fictional clients/brokers from RESEARCH §11; pay levels from §4; requirements and risks). Feasibility must explain clearly why an aircraft can or cannot do a job (positioning time, range/tech stop, runway, ETOPS, maintenance window, crew).' },
  { key: 'B2', port: 5602, title: 'Crew & HR', extra: 'The FTL checker must follow RESEARCH §5.1 (simplified as DESIGN says) with unit tests for edge cases (sectors, report time bands, augmented crews, min rest home/away, cumulative 7/14/28-day and yearly limits). Auto-roster must stay fast (< 50 ms for a month of flights with 2–4 aircraft and ~120 crew) and deterministic.' },
  { key: 'B3', port: 5603, title: 'Operations, maintenance, finance & events', extra: 'Flight execution, delays and their knock-on effects (crew legality, re-roster), AOG with a recovery decision, A/C checks that block the schedule, month-end statements with MGH billing and receivables, a handful of events with clear decisions in the inbox, auto-pause hooks, goals.' },
  { key: 'B4', port: 5604, title: 'Live map', extra: 'The map is the game: aircraft move smoothly in real time along great circles between actual departure and arrival, parked aircraft sit at airports, maintenance shows a hangar state, day/night terminator, offer pins, airport/aircraft panels. 60 fps on an A16 with ~10 aircraft; no flicker. Code against the documented selectors/signatures so it works with the stubs and lights up as B1–B3 land.' },
  { key: 'B5', port: 5605, title: 'Screens', extra: 'Contracts (offers + active + detail/accept dialog with feasibility), Schedule (per-aircraft Gantt timeline, touch scroll/zoom across days/weeks, tap block → details, today line), Crew (list with filters, duty/flight-hour bars, roster per person, hire/training), Fleet (aircraft cards, maintenance status), Finance (monthly statement, receivables), Company (reputation, goals), Inbox (messages, decisions), New Game polish. Touch targets >= 44px; readable at 1180×750.' },
]

const builder = (b) => `${COMMON}
TASK (BUILDER ${b.key} — ${b.title}): implement your section of BUILD-PLAN.md completely, with its tests, meeting its acceptance criteria. ${b.extra}
Your dev-server port: ${b.port}. Verify your work in the running app where applicable (screenshots at 1180×750, hasTouch).
Return (<= 400 words): what you implemented, tests added, acceptance criteria status, cross-builder requests, known gaps.`

const INTEGRATE = (reports) => `${COMMON}
TASK (INTEGRATE): all five builders finished (reports below). Make the game work end-to-end as v0.5 per BRIEF/DESIGN. Port 5611.
1. npx tsc --noEmit, npx vitest run, npx vite build must pass; resolve cross-builder requests and mismatches.
2. Write/finish scripts/acmi-bot.ts (headless): new Startup game, accepts suitable offers each week, runs a full game year; prints a monthly report (cash, BH flown vs MGH, contracts by type, flights, cancellations, crew legality violations (must be 0 when auto-rostered), crew utilisation, AOG/maintenance days, events) and asserts no exceptions/NaN. Tune balance defaults so a reasonable player can stay solvent but must work for it (RESEARCH §4.5: break-even near ~200 BH/aircraft/month; thin margins), and so there is a meaningful decision roughly every game week (BRIEF pacing).
3. Play the real UI at 1180×750 with touch through: New Game → see offers on the map and in Contracts → accept a job with feasibility → see flights on the Schedule → watch the aircraft fly on the map at 1×/2×/4× → crew assigned and legal → month-end statement → an event decision. Fix everything broken. Keep visuals calm.
4. Update README.md for the new game (what it is, controls, dev commands), the PWA manifest/name/description in vite.config.ts, index.html title/description, and scripts/ipad-shots.cjs screen list for the new screens.
Return (<= 500 words): what works end-to-end, bot results (12-month table), fixes made, remaining issues.

Builder reports:
${reports}`

const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      area: { type: 'string', enum: ['engine', 'ui'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['area', 'severity', 'problem', 'fix'] } },
  },
  required: ['summary', 'findings'],
}

const GAMEPLAY = (integ) => `${COMMON}
TASK (ADVERSARIAL GAMEPLAY & REALISM REVIEW — do not edit source files): you are two people at once: (1) a former ACMI flight attendant who flew 767-300ER/777-200ER for a Portuguese ACMI and A320/A330 for a Lithuanian/Maltese ACMI, and (2) a veteran tycoon-game designer. Play the game (headless bot scripts/acmi-bot.ts plus the real UI on port 5621 at 1180×750 touch) for at least a game year. Assume problems exist. Judge: Is it fun in the first 30 minutes? Is there always something meaningful to do while waiting at 1×/2×/4×? Is anything grindy, confusing or spreadsheet-like? Does the map feel alive and calm? Are decisions weighty? Realism a crew member would notice: FTL legality, crew complements (ceil(seats/50) minimum), augmented long-haul crews, positioning/deadheads, layovers/hotels/per diems, MGH billing, who pays fuel in wet lease vs charter, maintenance checks, permits, contract archetypes and their pay, government late payments. Balance: too easy/too hard, money flow, pacing of growth. Return structured findings with concrete fixes (area engine or ui).
Integration report:
${integ}`

const QA = (integ) => `${COMMON}
TASK (ADVERSARIAL QA & iPad UI REVIEW — do not edit source files): hunt bugs and UI problems. Port 5622. Use scripts/ipad-shots.cjs (--view safari,landscape) and your own Playwright touch play-through (page.touchscreen.tap, synthesized pointer events for drags/pinch) at 1180×750 and 1180×820, plus desktop 1440×900. Check: console/page errors; crashes on edge cases (accept/decline/expire offers, double-booking, cancel contract, AOG during a flight, crew out of hours, save → reload → continue mid-flight, month end, bankruptcy-ish cash); determinism; performance (frame time with 4 aircraft flying at 4× — use performance marks); horizontal overflow; text < 12px; tap targets < 44px; clipped/overlapping text; modals fitting 750px height; anything that flickers; touch gestures on map and schedule. Assume problems exist. Return structured findings with evidence and concrete fixes (area engine or ui).
Integration report:
${integ}`

const FIX = (area, port, findings) => `${COMMON}
TASK (FIX — ${area.toUpperCase()}): fix the confirmed review findings below (area ${area}). Re-verify each first; skip false positives with a note. Fix all high and medium, and low ones that are cheap. You may edit any ${area === 'engine' ? 'engine/data/scripts/test' : 'UI/style'} file (another fix agent handles the ${area === 'engine' ? 'UI' : 'engine'} side concurrently — coordinate through function signatures; don't edit their files). Port ${port}. Keep npx tsc --noEmit, npx vitest run, npx vite build green; re-run scripts/acmi-bot.ts (engine) or re-screenshot affected screens (ui).
Return (<= 400 words): per finding fixed / skipped (why).

Findings:
${findings}`


const BUILDERS = BUILDERS_ALL.filter((b) => b.key === 'B3' || b.key === 'B5')
const NAMES = `${COMMON}
TASK (REAL NAMES): the player wants REAL names instead of the fictional ones. Replace the fictional clients, brokers, agencies, governments, rival ACMI operators, tour operators and sports clubs used by offer generation and events (src/data/naming.ts, src/engine/contracts/clients.ts, src/engine/contracts/flavor.ts and any other place the B1 report or a grep for the fictional names shows) with real ones that fit each archetype and region, e.g. airlines (TAP Air Portugal, Lufthansa, Eurowings, LOT, Saudia, flynas, Azul, Air Canada, Aer Lingus, Condor, Jet2, TUI fly, Corendon, Air Sénégal, TAAG...), governments/ministries (Portuguese Government, UK Foreign Office, German Federal Foreign Office, Ministry of Defence of …), agencies (UN WFP, UNHCR, IOM, UN DPO, Frontex, ECHO), brokers (Chapman Freeborn, Air Charter Service, Air Partner, ACC Aviation, ACMI brokers), rival ACMI operators for sub-charter (Hi Fly, Wamos Air, euroAtlantic, Getjet, Airhub, Avion Express, Titan Airways, Privilege Style, Air Atlanta Icelandic, Heston Airlines, KlasJet, Smartwings, Global Crossing), sports clubs/teams, tour operators (TUI, Jet2holidays, Sunweb, Corendon), and pilgrim agencies. Keep names factual and context-plausible (who would really charter what), keep tone neutral, never attribute invented accidents, crimes, safety problems or misconduct to real entities; generic simulation outcomes (late payment, schedule change, competing bid) are fine. Note SmartLynx ceased operations in Nov 2025 — exclude it from active rivals. Update tests that assert names. npx tsc --noEmit and npx vitest run must pass for your files. Return (<= 250 words): what changed, files.`

const INTEGRATE2 = (reports) => INTEGRATE(reports).replace('4. Update README.md for the new game', `4. Rebrand everything to BLOCK HOURS (title, wordmark/logo text, loading screen, New Game, menus, PWA manifest name/short_name/description in vite.config.ts, index.html title/description/apple title, favicon/icons may keep the current mark), make sure the player can manually adjust the auto-roster (swap/assign/unassign crew on a duty with legality warnings — implement the minimal UI + engine call if missing), and make home-base choice available in New Game. Then update README.md for the new game`)

phase('Build')
const reports = await parallel([
  ...BUILDERS.map((b) => () => agent(builder(b), { label: `acmi:${b.key}`, phase: 'Build', ...(b.key === 'B5' ? { model: 'sonnet', effort: 'medium' } : { model: 'opus', effort: 'high' }) })),
  () => agent(NAMES, { label: 'acmi:real-names', phase: 'Build', model: 'sonnet', effort: 'medium' }),
])
const rep = `See ${SCRATCH}/reports-b124.md for B1, B2 and B4.\n\n` + BUILDERS.map((b, i) => `## ${b.key} ${b.title}\n${reports[i] ?? '(builder failed — inspect its files and finish them)'}`).join('\n\n') + `\n\n## Real names\n${reports[2] ?? '(failed — finish replacing fictional names)'}`
phase('Integrate')
const integ = await agent(INTEGRATE2(rep), { label: 'acmi:integrate', phase: 'Integrate', model: 'opus', effort: 'high' })
phase('Review')
const [g, q] = await parallel([
  () => agent(GAMEPLAY(integ ?? '(integration failed)'), { label: 'acmi:review:gameplay', phase: 'Review', schema: FINDINGS, model: 'opus', effort: 'high' }),
  () => agent(QA(integ ?? '(integration failed)'), { label: 'acmi:review:qa', phase: 'Review', schema: FINDINGS, model: 'opus', effort: 'high' }),
])
const all = [...(g ? g.findings : []), ...(q ? q.findings : [])]
log(`${all.length} findings (${all.filter((f) => f.severity === 'high').length} high)`)
const fmt = (fs) => fs.map((f, i) => `${i + 1}. [${f.severity}] ${f.problem}\n   evidence: ${f.evidence ?? '-'}\n   fix: ${f.fix}`).join('\n')
phase('Fix')
const fixes = await parallel([
  () => (all.some((f) => f.area === 'engine') ? agent(FIX('engine', 5631, fmt(all.filter((f) => f.area === 'engine'))), { label: 'acmi:fix:engine', phase: 'Fix', model: 'opus', effort: 'high' }) : Promise.resolve('no findings')),
  () => (all.some((f) => f.area === 'ui') ? agent(FIX('ui', 5632, fmt(all.filter((f) => f.area === 'ui'))), { label: 'acmi:fix:ui', phase: 'Fix', model: 'sonnet', effort: 'medium' }) : Promise.resolve('no findings')),
])
return { integ, gameplay: g ? g.summary : null, qa: q ? q.summary : null, findings: all.length, fixes }
