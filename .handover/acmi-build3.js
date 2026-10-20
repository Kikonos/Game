export const meta = {
  name: 'acmi-build-v05c',
  description: 'Finish BLOCK HOURS v0.5 on Fable: assess B3, finish it in 3 parallel lanes + bot/balance, integrate (engine + UI lanes, then end-to-end), 6-lens adversarial review, triage, verify, fix by area, release-readiness loop',
  phases: [
    { title: 'Assess', detail: 'state of B3 vs its acceptance criteria' },
    { title: 'Build', detail: 'B3 lanes: flights+maintenance, finance+goals+company, events+market; then bot & balance' },
    { title: 'Integrate', detail: 'engine lane + UI lane in parallel, then end-to-end play-through' },
    { title: 'Review', detail: '6 adversarial lenses → triage → batched refutation' },
    { title: 'Fix', detail: 'engine / ui / map / content lanes → release readiness, up to 2 rounds' },
  ],
}

const WT = '/home/user/wt/acmi'
const SCRATCH = '/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi'
const COMMON = `
PROJECT: "BLOCK HOURS" (formerly CONTRAIL), a browser game (Vite 6 + React 19 + TypeScript strict; hand-written CSS; d3-geo world map; lz-string saves; PWA; vitest) in which the player runs a small ACMI / wet-lease / charter operator. Work ONLY in ${WT} (branch acmi). Before coding read: ${WT}/docs/acmi/BRIEF.md (plan of record; the "Player decisions" section at the end overrides everything else), ${WT}/docs/acmi/DESIGN.md (technical design: state model, time model, module map, algorithms, UI plan), ${WT}/docs/acmi/BUILD-PLAN.md (ground rules, owned files, acceptance criteria, tests) and the relevant parts of ${WT}/docs/acmi/RESEARCH.md (industry facts and numbers). Builders B1 (contracts), B2 (crew/HR), B4 (live map), B5 (screens) and the real-names pass are FINISHED: reports in ${SCRATCH}/reports-b124.md and ${SCRATCH}/reports-b5names.md. B3 (ops/maintenance/finance/events/goals/market + bot) was ~80% done by a previous agent whose debug scripts and logs are in ${SCRATCH}/b3/ (dbg.ts, c2.log, bot.log).
PLAYER DECISIONS: the game is named BLOCK HOURS; home base chosen at start (Lisbon default; Vilnius, Malta, Madrid, Riga offered); named crew with an auto-roster the player can adjust; REAL company/government/agency/broker/rival names (factual, neutral, never invent wrongdoing); the old airline game is replaced (no "classic" copy). Pace: speeds 1×/2×/4× + pause only; calm, no flicker, no tickers, quiet toasts; the map is the game.
BRAND FILES ARE OFF LIMITS (they are merged from another branch later): src/ui/brand/** (LogoMark/wordmark), src/ui/screens/Title.tsx, src/ui/screens/Loading.tsx, src/ui/art/** (aircraft art), index.html, vite.config.ts, public/**, favicon/icons. Never edit them. Every other BLOCK HOURS string (shell, menus, New Game, toasts, README, in-game copy) is in scope.
TARGET: iPad (A16) in LANDSCAPE (1180×750 Safari, 1180×820 home-screen app), touch; desktop must still work.
Commands (in ${WT}): npx tsc --noEmit · npx vitest run · npx vite build · headless year: npx tsx scripts/acmi-bot.ts <seed> 365 · dev server: VITE_CACHE_DIR=node_modules/.vite-<PORT> nohup npx vite --port <PORT> --strictPort > ${SCRATCH}/vite-<PORT>.log 2>&1 &  (only your port; kill by PID; never pkill node/vite/tsx). Playwright (Chromium, global): require('/opt/node22/lib/node_modules/playwright'); never "playwright install"; view PNGs with Read. window.__contrail exposes the store and __contrail.dev helpers (DESIGN).
Rules: other agents work in this worktree at the same time — edit ONLY the files you own (listed in your task); for shared files make the minimal additive edit, re-read before editing, and if Edit says the file changed, re-read and retry. If you need a change in a file you don't own, write a local workaround and list the request in your report. No git commit/checkout/merge/reset/stash (the orchestrator commits). Temp files in ${SCRATCH}/<your-label>/. TypeScript strict, terse comments in the existing style, no new npm dependencies, no Math.random/Date.now in src/engine (engine RNG only), SAVE_VERSION stays 1 (default new fields with ??= in load). Keep npx tsc --noEmit, npx vitest run and npx vite build green for your files. Reports are data for the orchestrator: be concrete, ≤ 400 words unless told otherwise.
`

// ---------- Assess ----------
const ASSESS_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    checks: { type: 'object', properties: { tsc: { type: 'string' }, vitest: { type: 'string' }, build: { type: 'string' }, bot: { type: 'string' } }, required: ['tsc', 'vitest', 'build', 'bot'] },
    lanes: { type: 'object', properties: { flights: { type: 'string' }, finance: { type: 'string' }, events: { type: 'string' }, bot: { type: 'string' } }, required: ['flights', 'finance', 'events', 'bot'] },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'checks', 'lanes', 'blockers'],
}
const ASSESS = `${COMMON}
TASK (ASSESS B3 — read-only; write nothing under src/): establish exactly where B3 stands so three builders can finish it in parallel. Run npx tsc --noEmit, npx vitest run, npx vite build and timeout 120 npx tsx scripts/acmi-bot.ts 1 365 (capture output to ${SCRATCH}/assess/). Read src/engine/ops/* and scripts/acmi-bot.ts against the B3 table and acceptance list in BUILD-PLAN.md (§B3) and DESIGN §5.5–5.11 and §7.3. For each lane list, concretely (file, function): what is implemented and verified, what is stubbed/partial, what is missing, which tests exist/fail. Lanes: flights = flights.ts + maintenance.ts (state machine, delays, ripple, AOG, checks, pruneFlights); finance = finance.ts + goals.ts + company.ts (month end, payments, receivables, rescue, cashForecast, goals, reputation); events = events.ts + market.ts (dailyEvents, resolveDecision, onDecisionExpire, decision kinds, market, approvals, policies); bot = scripts/acmi-bot.ts + the BAL ops block (targets §7.3, balance). Also check sim.ts/core hooks are wired (onMonthEnd, dailyFinance, dailyEvents, pruneFlights, checkGoals, refreshMarket). Port 5801 if you need the app. Return the structured assessment; lanes are the briefs the builders will read, so make them precise.`

// ---------- Build (B3 lanes) ----------
const LANES = [
  { key: 'flights', port: 5802, title: 'B3 flights & maintenance', owns: 'src/engine/ops/flights.ts, src/engine/ops/maintenance.ts and their *.test.ts; the "flights/maintenance" lines of the BAL ops block in src/engine/core/balance.ts', scope: 'onFlightDep/onFlightArr full state machine (readiness, one random delay, technical delays never become AOG, AOG as its own roll via aogChance, ripple with turn minima, crew check, eta with wind noise, costs, stats, reputation and deferred drift), delayFlight with ripple, pruneFlights, checkStatus, scheduleCheck/cancelCheck/planChecks/onMaintStart/onMaintEnd/aogChance per DESIGN §5.6 (gaps ≥ aCheckHours + 1 h home / 2 h away, maintenance nights first, notice cancellations of base-contract legs with ≥ 12 h notice, ferries via planPositioning), C-check warnings at 90/60/30 days. Acceptance: delays ripple without breaking turn minima and move on-time stats; AOG pauses (setting), posts the 5-option decision incl. sub-charter, blocks departures until resolved; A-checks auto-booked into idle/maintenance nights before due; with a 90-day HAM base on the owned A320 the A-check costs no cancelled revenue legs. Tests: state machine + ripple, AOG blocking and rate, check planning (maintenance nights, notice cancellations), 90-day determinism.' },
  { key: 'finance', port: 5803, title: 'B3 finance, goals & company', owns: 'src/engine/ops/finance.ts, src/engine/ops/goals.ts, src/engine/ops/company.ts and their *.test.ts; the "finance" lines of the BAL ops block', scope: 'onMonthEnd (rent, insurance, overhead, close/open statements, bestMonthProfit, statement message, requestPause), onPayment/dailyFinance/cashForecast (receivables, late payers esp. governments with a message, solvency → rescue decision after 30 days negative → gameOver), GOALS + checkGoals (7 goals with real progress: first contract, first $1M month, 3 aircraft, first widebody, ETOPS 180, first long-haul with augmented crew, first ULR), company reputation/fields. Acceptance: statement has every fixed line exactly once; charter fuel and fees only on charter, ferry and non-billable positioning legs; MGH billing correct; government receivables mostly late with a message; rescue flow. Tests: month-end lines, sub-charter billing/cost, receivables, rescue, goals.' },
  { key: 'events', port: 5804, title: 'B3 events, market & approvals', owns: 'src/engine/ops/events.ts, src/engine/ops/market.ts and their *.test.ts; the "events/market" lines of the BAL ops block', scope: 'dailyEvents, resolveDecision, onDecisionExpire per DESIGN §5.8 event table; resolvers keyed by decision.kind: crewShort (applyDiscretion/replaceCrew), sickCrew, aog (swap = planPositioning + reassignFlights; sub-charter via subcharterFlights + post), latePayment, rescue, changeRequest; permit-delay and season-nudge messages; urgent evacuation offers via generateOffer. refreshMarket/acquireAircraft/onDelivery/onLeaseEnd per §5.10 (tier ≤ 2 from the start, guaranteed narrowbody lease in month 1–2 and an old 767/A330 by month 4–6, scarce otherwise), APPROVALS/applyApproval/onApprovalDone/setPolicies per §5.11. Every decision has clear, weighty options with consequences the inbox explains. Tests: each resolver, expiry defaults, market guarantees, approvals.' },
]
const laneBuilder = (l, brief) => `${COMMON}
TASK (${l.title.toUpperCase()}): finish this part of B3 completely, meeting its acceptance criteria, with tests. You OWN: ${l.owns}. Shared with the other two B3 lanes (additive edits only, re-read first): src/engine/ops/index.ts, src/engine/core/types.ts (optional fields in the ops section only), src/engine/sim.ts hooks (only if a hook for your function is missing). Do NOT edit scripts/acmi-bot.ts (a later agent owns it) nor files of the other lanes (flights.ts/maintenance.ts | finance.ts/goals.ts/company.ts | events.ts/market.ts): if you need something there, code against its current signature and list the request.
Scope: ${l.scope}
Assessment of the current state (continue the partial work, don't restart it):
${brief}
Port ${l.port}. Keep it deterministic (engine RNG, nextId, Object.values order; read APIs pure per DESIGN §4.1). Before reporting: npx tsc --noEmit and npx vitest run green for your files.
Return (≤ 400 words): implemented, tests added, acceptance status per criterion, requests for other lanes, known gaps.`

const BOT = (assess, laneReports) => `${COMMON}
TASK (B3 BOT & BALANCE): the three B3 lanes are done (reports below). You OWN scripts/acmi-bot.ts and the whole BAL ops block in src/engine/core/balance.ts, and you MAY make small fixes anywhere in src/engine/ops/* and src/engine/sim.ts (nobody else edits them now). Port 5805.
1. npx tsc --noEmit, npx vitest run, npx vite build green (fix what the lanes left broken).
2. Finish scripts/acmi-bot.ts per DESIGN §7.3: headless new Startup game (Lisbon, 2× A320ceo), a simple but sensible policy (accept feasible offers each week preferring base deployments + ad hoc fill-ins, hire when crew utilisation is high, book checks, resolve decisions reasonably, lease a widebody when affordable), run 365 days; print a monthly table: cash, revenue, profit, BH flown vs MGH, contracts by type, flights, cancellations, crew legality violations (must be 0 when auto-rostered), crew utilisation, AOG count, maintenance days, events/decisions, goals reached; assert no exceptions/NaN/negative-infinite values; print the save size. It must run 365 days in < 10 s. Run it for seeds 1, 2, 3.
3. Tune balance so a reasonable player stays solvent but must work for it (RESEARCH §4.5: break-even near ~200 BH/aircraft/month; thin margins; a widebody acquirable within 12 months; 1–3 AOGs per aircraft-year; a meaningful decision roughly every game week; governments pay late). Record the before/after numbers.
4. Determinism: two runs with the same seed must produce identical final state JSON; a save/load at day 90 must continue identically to day 180.
Return (≤ 500 words): the 12-month table for seed 1, targets met/missed with numbers, balance changes, fixes made, remaining issues.

Assessment: ${assess}

Lane reports:
${laneReports}`

// ---------- Integrate ----------
const ROSTER_API = `Manual roster adjustment API (engine lane writes src/engine/crew/rosterActions.ts and documents the final signatures in ${SCRATCH}/api-roster.md within its first steps; the UI lane codes against that file). Intended shape, adapt to the existing crew/pairing model: dutyCandidates(g, dutyOrFlightId, role) → pure list of { crewId, legal, reasons[] } sorted legal-first; assignCrew(g, dutyOrFlightId, crewId, role) → ActionResult (replaces the holder of that slot or adds an extra above the legal minimum); unassignCrew(g, dutyOrFlightId, crewId) → ActionResult (refuses below the legal minimum unless force); swapCrew(g, dutyA, crewA, dutyB, crewB) → ActionResult; dutyLegality(g, dutyOrFlightId) → pure { legal, warnings[] }. Manual assignments survive the rolling re-plan (mark them locked) and illegal ones are flagged red in the UI, never silently accepted.`

const INTEG_ENGINE = (bot) => `${COMMON}
TASK (INTEGRATE — ENGINE LANE): make the engine complete and consistent for v0.5. You OWN src/engine/**, src/data/**, scripts/** and all tests. A UI lane works concurrently on src/ui/** and src/styles/**: do not edit those; it codes against your APIs. Port 5811.
First (within your first steps): ${ROSTER_API}
Then:
1. npx tsc --noEmit, npx vitest run, npx vite build green. Resolve every cross-builder request in ${SCRATCH}/reports-b124.md, ${SCRATCH}/reports-b5names.md and the B3/bot report below; fix signature mismatches between contracts/crew/ops.
2. New-game options: home base choice (LIS default; VNO, MLA, MAD, RIX and 2–3 more ACMI-style bases), company name/code/livery; starting crew and aircraft located at the chosen base; offers and positioning use the base. Document in ${SCRATCH}/api-newgame.md.
3. The player-facing engine surface the screens need (list anything missing that the B5 report asked for and add it): contracts (offers, feasibility explanations, accept/counter/decline, active contracts, cancel/sub-charter), schedule data per aircraft (flights, positioning, maintenance, idle), crew (list, duty/flight-hour bars, roster per person, hire with lead time, training), fleet (status, checks), finance (statement, receivables, cash forecast), company (reputation, goals), inbox (messages, decisions, resolve). Pure read APIs stay pure (plumbing test).
4. Save → reload → continue: identical state, clock, event queue, flights in the air; saves under the existing key prefix; SAVE_VERSION stays 1 with ??= defaults.
5. Re-run the bot for seeds 1–3 after your changes and keep its targets.
Return (≤ 500 words): what changed, the API notes you wrote, bot table for seed 1, open issues.

B3 bot & balance report:
${bot}`

const INTEG_UI = (bot) => `${COMMON}
TASK (INTEGRATE — UI LANE): make every screen work on real engine data. You OWN src/ui/** (screens, modals, shell, game, store, map), src/styles/acmi/** and src/styles/touch/**, README.md and scripts/ipad-shots.cjs — minus the brand files listed above. An engine lane works concurrently on src/engine/**; it documents APIs in ${SCRATCH}/api-roster.md and ${SCRATCH}/api-newgame.md (read them when you reach those features; if they don't exist yet, implement against the intended shape below and leave a clear TODO comment for the end-to-end agent). Port 5812; verify with Playwright at 1180×750 (hasTouch) and keep screenshots in ${SCRATCH}/integ-ui/.
1. Wire Contracts (offers with expiry, detail/accept with the feasibility explanation per aircraft, counter, decline; active contracts; cancel/sub-charter), Schedule (per-aircraft Gantt across days/weeks with touch scroll/zoom, blocks coloured by contract, positioning, maintenance, idle, today line, tap → details), Crew (list + filters, duty/flight-hour bars, roster per person, hire/training with lead times), Fleet (cards, maintenance status, book a check), Finance (statement, receivables, forecast), Company (reputation, goals), Inbox (messages, decisions with their options), map panels (aircraft/airport/offer pins) to the real engine. Empty states for everything, no crash on missing data.
2. Rebrand strings to BLOCK HOURS everywhere in your files (shell, menus, New Game, toasts, settings, README) — not the brand files.
3. New Game: home base selector (list from the engine's api-newgame.md; LIS default) plus name/code/livery; show the chosen base on the map after start.
4. Manual roster adjustment UI on a duty (from the Schedule block and the Crew roster): see legal candidates, assign/unassign/swap, illegal choices flagged red with reasons, locked manual assignments shown. ${ROSTER_API}
5. Speed control shows only ⏸ 1× 2× 4× with labels; important decisions auto-pause (setting). Touch targets ≥ 44 px, text ≥ 12 px, no horizontal overflow at 1180×750 and 1180×820, modals fit 750 px height. Nothing flickers; only aircraft move.
6. README.md for BLOCK HOURS (what it is, controls, dev commands, release process unchanged: play/ on main) and scripts/ipad-shots.cjs screen list for the new screens (New Game → Ops Map → every tab → OfferModal → DecisionModal).
Return (≤ 500 words): what is wired per screen, what still depends on missing engine APIs (exact names), screenshots taken, open issues.

B3 bot & balance report (for context on what the engine produces):
${bot}`

const E2E = (eng, ui) => `${COMMON}
TASK (INTEGRATE — END TO END): the engine and UI lanes are done (reports below); you now own everything except the brand files. Port 5813. Play the real game as the player would, at 1180×750 with touch (page.touchscreen.tap; synthesized pointer events for drags/pinch), and fix everything broken, including the hand-offs between the lanes (roster adjust UI ↔ rosterActions, home base ↔ New Game, any "TODO end-to-end" comments).
Play-through: New Game (choose Vilnius once, Lisbon once) → offers appear on the map and in Contracts → open one, read the feasibility explanation, accept with an aircraft → flights (positioning + revenue) on the Schedule → the aircraft flies on the map at 1×, 2× and 4× in real time and parks at the right airport → crew assigned and legal; adjust one assignment manually (legal and illegal attempt) → run to month end: statement arrives, cash moves, receivables → a decision event (delay/sick crew/AOG/late payment) with a choice → save, reload, continue mid-flight → a second contract overlapping the first (conflict shown) → book an A-check → hire crew → 3 game months at 4× with no console errors.
Also: npx tsc --noEmit, npx vitest run, npx vite build green; bot seeds 1–3 pass; scripts/ipad-shots.cjs runs and its shots look right (keep them in ${SCRATCH}/e2e/). Calm visuals: no flicker, no layout jumps on tick, quiet toasts.
Return (≤ 600 words): what works end-to-end (step by step with evidence), fixes made, bot table seed 1, remaining issues with severity.

Engine lane report:
${eng}

UI lane report:
${ui}`

// ---------- Review ----------
const FINDINGS = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: {
      area: { type: 'string', enum: ['engine', 'ui', 'map', 'content'] },
      severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' },
    }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } },
  },
  required: ['summary', 'findings'],
}
const AREAS = 'Areas: engine = src/engine/**, src/data/**, scripts/**; ui = src/ui/** except the map, src/styles/**; map = src/ui/map/**, map CSS; content = client/broker/rival names and flavour text in src/data/naming.ts, src/engine/contracts/clients.ts, src/engine/contracts/flavor.ts (UI copy counts as ui).'
const REVIEW_COMMON = (port) => `${COMMON}
REVIEW RULES: do not edit files under src/, scripts/ or docs/ (temp files only, in ${SCRATCH}/review-${port}/). Port ${port}. Assume problems exist and go looking for them; every finding needs evidence (a reproduction, a number, a screenshot path, or file:line) and a concrete fix. ${AREAS} Severity: high = wrong/broken/crash/unfair; medium = clearly worse than it should be; low = polish.`
const LENSES = [
  { key: 'gameplay', port: 5821, prompt: `TASK (ADVERSARIAL GAMEPLAY & REALISM REVIEW): you are two people at once: (1) a former ACMI flight attendant who flew 767-300ER/777-200ER for a Portuguese ACMI and A320/A330 for Lithuanian/Maltese ACMIs, and (2) a veteran tycoon-game designer. Play at least a game year: the headless bot (npx tsx scripts/acmi-bot.ts 1 365, read its table) AND the real UI at 1180×750 touch for the first 30 minutes of a game at 1×/2×/4×. Judge: is it fun in the first 30 minutes; is there always something meaningful to do while waiting; is anything grindy, confusing or spreadsheet-like; does the map feel alive and calm; are decisions weighty with visible consequences; is the ladder (narrowbody → widebody → ETOPS → long haul → ULR) legible and earned. Realism a crew member would notice: FTL legality, crew complements (ceil(seats/50) minimum), augmented long-haul crews, positioning/deadheads, layovers/hotels/per diems, MGH billing, who pays fuel in wet lease vs charter, maintenance checks, permits, contract archetypes and their pay, government late payments.` },
  { key: 'qa', port: 5822, prompt: `TASK (ADVERSARIAL QA & iPad UI REVIEW): hunt bugs and UI problems. Use scripts/ipad-shots.cjs (--view safari,landscape) and your own Playwright touch play-through (page.touchscreen.tap, synthesized pointer events for drags/pinch) at 1180×750 and 1180×820, plus desktop 1440×900. Check: console/page errors; crashes on edge cases (accept/decline/expire offers, double-booking, cancel contract, AOG during a flight, crew out of hours, save → reload → continue mid-flight, month end, near-zero cash, game over); horizontal overflow; text < 12 px; tap targets < 44 px; clipped/overlapping text; modals not fitting 750 px height; anything that flickers or jumps on tick; touch gestures on map and schedule (pan, pinch, tap vs drag); keyboard-less flows; landscape-only behaviour.` },
  { key: 'engine', port: 5823, prompt: `TASK (ENGINE CORRECTNESS & DETERMINISM REVIEW): read src/engine/** critically and write throwaway harnesses in your temp dir. Check: determinism (same seed → identical state JSON after 365 days; save/load at day 90 continues identically; no Math.random/Date.now in src/engine; read APIs pure per DESIGN §4.1 — call each 100× and diff state + RNG); event queue (stale events ignored, no double-firing, no orphan flights after cancel/reassign/sub-charter); FTL: run the roster over a bot year and count legality violations (must be 0), check min rest home/away, cumulative 7/14/28-day and yearly limits, augmented crews, min cabin crew; money: every cash movement goes through the ledger, statements balance (opening + lines = closing), no NaN/Infinity, no money created by cancel/retime/reload; time: minutes integer, no drift between flight times and map positions; save size over a year; performance of a 365-day bot (< 10 s).` },
  { key: 'perf', port: 5824, prompt: `TASK (PERFORMANCE & CALM REVIEW): the target is an iPad A16 at 60 fps with ~6–10 aircraft flying at 4×, with nothing flickering. In the real UI (Playwright, 1180×750) create a game, use __contrail.dev.fleet(8)/demoFlights to get aircraft moving, and measure: frame time distribution over 30 s at 4× on the map (requestAnimationFrame deltas), React commit counts per tick (React Profiler API or a render counter), layout thrash (forced reflows), DOM node count growth over 10 game days, memory growth over a game year at 4×, main-thread long tasks (> 50 ms) during month end and roster re-plans, map pan/pinch smoothness, unnecessary re-renders of screens that aren't visible, the service worker/PWA build size. Report numbers with the method used and point to the code responsible for each hot spot.` },
  { key: 'finance', port: 5825, prompt: `TASK (FINANCE, BALANCE & INDUSTRY NUMBERS REVIEW): compare the game's numbers with RESEARCH.md §4 (ACMI rates per block hour by type, MGH, charter prices, crew costs, per diems, hotels, deadheads, maintenance reserves, lease rates, insurance, overhead, break-even near ~200 BH/aircraft/month, thin margins) and §5–§6. Run the bot for seeds 1–5 and read the monthly tables: is a reasonable player solvent but working for it; is any contract type a money printer or a trap; are urgent jobs worth their premium; do late government payments bite; is the widebody reachable in ~12 months without being trivial; are per-diem/hotel/deadhead costs visible and realistic; do MGH shortfalls bill correctly; are sub-charter prices sane. Propose concrete BAL numbers with the reasoning.` },
  { key: 'content', port: 5826, prompt: `TASK (CONTENT, NAMES & COPY REVIEW): the player wants real companies, governments, agencies, brokers, rivals, tour operators and sports clubs, used factually and neutrally. Read src/data/naming.ts, src/engine/contracts/clients.ts, src/engine/contracts/flavor.ts, event/decision texts in src/engine/ops/events.ts, and all UI copy. Check: every real entity is plausible for its archetype and region (who would really charter what, which rivals really do ACMI/sub-charter; SmartLynx ceased operations in Nov 2025 and must not be an active rival); no invented accidents, crimes, safety problems or misconduct attributed to real entities (routine outcomes like late payment, schedule change, competing bid are fine); no logos/trademarks beyond names; variety (no repetitive offer text); correct aviation terminology and ICAO/IATA codes; typos, inconsistent terms (ACMI/wet lease/MGH/positioning/deadhead/FDP), leftover CONTRAIL mentions (outside save keys and __contrail), unclear decision options, numbers formatted consistently (currency, hours as h:mm or BH). Each finding with file:line.` },
]
const reviewPrompt = (l, e2e) => `${REVIEW_COMMON(l.port)}
${l.prompt}
Return structured findings (as many as are real; include lows).
End-to-end integration report:
${e2e}`

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'integer' }, area: { type: 'string', enum: ['engine', 'ui', 'map', 'content'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
      problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' }, sources: { type: 'string' },
    }, required: ['id', 'area', 'severity', 'problem', 'evidence', 'fix'] } },
    dropped: { type: 'array', items: { type: 'string' } },
  },
  required: ['items', 'dropped'],
}
const TRIAGE = (all) => `You are triaging review findings for the BLOCK HOURS v0.5 build (worktree ${WT}; read code only to disambiguate). ${AREAS}
Merge duplicates and overlapping findings into one item each (keep the best evidence and the most complete fix, note the sources), drop items that are out of scope for v0.5 (BRIEF.md "Later releases": roster board polish, training/expiry, attrition, department heads, market scarcity rules beyond v0.5, Hajj/UN/VIP archetypes, market cycles, sound, tutorial) unless they describe a bug, drop pure opinions without evidence, keep everything actionable. Assign the area by the files the fix touches (a UI copy issue is ui; a map issue is map; a names/flavour issue is content; a number in balance.ts is engine). Normalise severity. Number the items 1..n ordered by severity then area.
Findings (JSON):
${JSON.stringify(all)}`

const VERDICTS = {
  type: 'object',
  properties: { verdicts: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'integer' }, real: { type: 'boolean' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, note: { type: 'string' },
  }, required: ['id', 'real', 'severity', 'note'] } } },
  required: ['verdicts'],
}
const VERIFY = (batch, port) => `${REVIEW_COMMON(port)}
TASK (REFUTE REVIEW FINDINGS): for each finding below, try to REFUTE it: reproduce it yourself in the code (file:line), a harness, the bot or the real UI (Playwright 1180×750 touch). Mark real=false when it does not reproduce, is already handled, is by design per BRIEF/DESIGN/RESEARCH, or is out of scope for v0.5. Default to real=false if you cannot confirm it. Adjust the severity to what you observed and say in the note what you did and what the fixer should know.
Findings:
${batch.map((f) => `#${f.id} [${f.area}/${f.severity}] ${f.problem}\n  evidence: ${f.evidence}\n  fix: ${f.fix}${f.files ? `\n  files: ${f.files}` : ''}`).join('\n')}`

// ---------- Fix ----------
const OWN = {
  engine: { port: 5841, owns: 'src/engine/**, src/data/** (except naming/flavour/clients text), scripts/**, all engine tests, src/engine/core/balance.ts', others: 'ui, map and content lanes edit src/ui/**, src/styles/** and the naming/flavour files concurrently; coordinate through function signatures only' },
  ui: { port: 5842, owns: 'src/ui/** except src/ui/map/** and the brand files, src/styles/acmi/** except map CSS, src/styles/touch/** except touch/map.css, README.md, scripts/ipad-shots.cjs', others: 'engine, map and content lanes edit src/engine/**, src/ui/map/** and the naming/flavour files concurrently; if a fix needs an engine change, implement the UI side and list the exact engine change needed' },
  map: { port: 5843, owns: 'src/ui/map/**, src/styles/touch/map.css and any acmi map CSS', others: 'engine, ui and content lanes edit everything else concurrently' },
  content: { port: 5844, owns: 'src/data/naming.ts, src/engine/contracts/clients.ts, src/engine/contracts/flavor.ts, text tables in src/engine/ops/events.ts (strings only) and their tests', others: 'engine, ui and map lanes edit the code around your strings concurrently — change strings and data only' },
}
const fmt = (fs) => fs.map((f) => `#${f.id} [${f.severity}] ${f.problem}\n   evidence: ${f.evidence}\n   fix: ${f.fix}${f.files ? `\n   files: ${f.files}` : ''}${f.note ? `\n   verifier: ${f.note}` : ''}`).join('\n')
const FIX = (area, items, round) => `${COMMON}
TASK (FIX — ${area.toUpperCase()}, round ${round}): fix the verified findings below. You OWN: ${OWN[area].owns}. ${OWN[area].others}. Port ${OWN[area].port + (round - 1) * 10}. Re-check each finding first; skip anything already fixed with a note. Fix all high and medium and the cheap lows. Keep npx tsc --noEmit, npx vitest run and npx vite build green; re-run the bot (engine/content) or re-screenshot the affected screens at 1180×750 (ui/map) into ${SCRATCH}/fix-${area}-${round}/. Calm visuals; brand files untouched.
Return (≤ 400 words): per finding fixed / skipped (why), plus any change another lane must make (exact file + signature).
Findings:
${items}`

const READY_SCHEMA = {
  type: 'object',
  properties: {
    ready: { type: 'boolean' }, report: { type: 'string' },
    blockers: { type: 'array', items: { type: 'object', properties: { area: { type: 'string', enum: ['engine', 'ui', 'map', 'content'] }, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' }, files: { type: 'string' } }, required: ['area', 'severity', 'problem', 'evidence', 'fix'] } },
  },
  required: ['ready', 'report', 'blockers'],
}
const READY = (fixReports, round) => `${COMMON}
TASK (RELEASE READINESS, round ${round}): you own everything except the brand files; the fix lanes are done (reports below). Port ${5845 + (round - 1) * 10}. Run the integration checklist: npx tsc --noEmit, npx vitest run, npx vite build; bot seeds 1–3 (365 days, < 10 s, 0 legality violations, no NaN, targets); scripts/ipad-shots.cjs at 1180×750 and 1180×820 (New Game → Ops Map → every tab → OfferModal → DecisionModal) and look at every shot; a touch play-through of the first game month at 4× with zero console errors; save → reload → continue mid-flight; nothing flickers. Fix small leftovers yourself (anything under ~30 lines). Anything larger goes in blockers with area/severity/evidence/fix — be honest: ready=true only if a player could enjoy this build today without hitting a crash, a dead screen, an illegal roster or a nonsensical number. Keep the shots in ${SCRATCH}/ready-${round}/.
Return the structured report (report ≤ 400 words: what you verified, with numbers).
Fix reports:
${fixReports}`

// ================= RUN =================
phase('Assess')
const assess = await agent(ASSESS, { label: 'acmi:assess', phase: 'Assess', schema: ASSESS_SCHEMA, model: 'fable', effort: 'medium' })
log(assess ? `B3 state: ${assess.summary.slice(0, 200)}` : 'assessment failed — lanes will self-assess')
const brief = (k) => (assess ? `${assess.lanes[k]}\n\nChecks: tsc ${assess.checks.tsc}; vitest ${assess.checks.vitest}; build ${assess.checks.build}; bot ${assess.checks.bot}\nBlockers: ${assess.blockers.join('; ') || 'none'}` : '(no assessment — read the files and the B3 section yourself)')

phase('Build')
const laneReports = await parallel(LANES.map((l) => () => agent(laneBuilder(l, brief(l.key)), { label: `acmi:B3:${l.key}`, phase: 'Build', model: 'fable' })))
const laneText = LANES.map((l, i) => `## ${l.title}\n${laneReports[i] ?? '(lane failed — inspect its files and finish them)'}`).join('\n\n')
const bot = await agent(BOT(assess ? assess.summary : '(none)', laneText), { label: 'acmi:B3:bot-balance', phase: 'Build', model: 'fable' })
const botText = bot ?? '(bot/balance agent failed — finish scripts/acmi-bot.ts and the balance yourself)'

phase('Integrate')
const [eng, ui] = await parallel([
  () => agent(INTEG_ENGINE(botText), { label: 'acmi:integrate:engine', phase: 'Integrate', model: 'fable' }),
  () => agent(INTEG_UI(botText), { label: 'acmi:integrate:ui', phase: 'Integrate', model: 'fable' }),
])
const e2e = await agent(E2E(eng ?? '(engine lane failed)', ui ?? '(UI lane failed)'), { label: 'acmi:integrate:e2e', phase: 'Integrate', model: 'fable' })
const e2eText = e2e ?? '(end-to-end agent failed)'

phase('Review')
const reviews = await parallel(LENSES.map((l) => () => agent(reviewPrompt(l, e2eText), { label: `acmi:review:${l.key}`, phase: 'Review', schema: FINDINGS, model: 'fable' })))
const raw = reviews.flatMap((r, i) => (r ? r.findings.map((f) => ({ ...f, lens: LENSES[i].key })) : []))
log(`${raw.length} raw findings from ${reviews.filter(Boolean).length}/6 lenses (${raw.filter((f) => f.severity === 'high').length} high)`)
const triage = await agent(TRIAGE(raw), { label: 'acmi:triage', phase: 'Review', schema: TRIAGE_SCHEMA, model: 'fable', effort: 'medium' })
const items = triage ? triage.items : raw.map((f, i) => ({ ...f, id: i + 1 }))
log(`${items.length} after triage (${triage ? triage.dropped.length : 0} dropped)`)
const batches = []
for (const area of ['engine', 'ui', 'map', 'content']) {
  const xs = items.filter((f) => f.area === area)
  for (let i = 0; i < xs.length; i += 6) batches.push({ area, items: xs.slice(i, i + 6) })
}
const verdictLists = await parallel(batches.map((b, i) => () => agent(VERIFY(b.items, 5831 + i), { label: `acmi:verify:${b.area}:${i + 1}`, phase: 'Review', schema: VERDICTS, model: 'fable' })))
const verdictById = new Map()
verdictLists.filter(Boolean).forEach((v) => v.verdicts.forEach((x) => verdictById.set(x.id, x)))
const confirmed = items.map((f) => { const v = verdictById.get(f.id); return v ? { ...f, severity: v.severity, note: v.note, real: v.real } : { ...f, real: true, note: 'unverified (verifier failed) — re-check' } }).filter((f) => f.real)
log(`${confirmed.length} confirmed (${confirmed.filter((f) => f.severity === 'high').length} high); ${items.length - confirmed.length} refuted`)

phase('Fix')
const runFixes = async (list, round) => {
  const areas = ['engine', 'ui', 'map', 'content'].filter((a) => list.some((f) => f.area === a))
  const reps = await parallel(areas.map((a) => () => agent(FIX(a, fmt(list.filter((f) => f.area === a)), round), { label: `acmi:fix:${a}:r${round}`, phase: 'Fix', model: 'fable' })))
  return areas.map((a, i) => `## ${a} (round ${round})\n${reps[i] ?? '(lane failed)'}`).join('\n\n')
}
let fixText = confirmed.length ? await runFixes(confirmed, 1) : 'no confirmed findings'
let ready = await agent(READY(fixText, 1), { label: 'acmi:readiness:1', phase: 'Fix', schema: READY_SCHEMA, model: 'fable' })
let rounds = 1
if (ready && !ready.ready && ready.blockers.length) {
  log(`not ready after round 1: ${ready.blockers.length} blockers — fixing round 2`)
  const list = ready.blockers.map((b, i) => ({ ...b, id: 1000 + i }))
  fixText = await runFixes(list, 2)
  ready = await agent(READY(fixText, 2), { label: 'acmi:readiness:2', phase: 'Fix', schema: READY_SCHEMA, model: 'fable' })
  rounds = 2
}
log(ready ? (ready.ready ? 'READY for release' : `still ${ready.blockers.length} blockers`) : 'readiness agent failed')
return {
  assess: assess ? assess.summary : null,
  bot: botText.slice(0, 2500),
  e2e: e2eText.slice(0, 2500),
  reviews: reviews.map((r, i) => `${LENSES[i].key}: ${r ? r.summary : '(failed)'}`),
  raw: raw.length, triaged: items.length, confirmed: confirmed.length,
  confirmedList: confirmed.map((f) => `#${f.id} [${f.area}/${f.severity}] ${f.problem}`),
  rounds, ready: ready ? ready.ready : null, blockers: ready ? ready.blockers : null, readyReport: ready ? ready.report : null,
}
