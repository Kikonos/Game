export const meta = {
  name: 'v025-round3',
  description: 'BLOCK HOURS v0.25 round 3: crew planning tuning and a balance pass on v025c (v025b stays the safe candidate)',
  phases: [
    { title: 'Build', detail: '2 lanes from origin/v025b' },
    { title: 'Integrate', detail: 'merge into v025c, What is New, full checks' },
    { title: 'Review', detail: 'engine and UI/player reviewers' },
    { title: 'Fix', detail: 'fix findings, final checks, FINAL3.md' },
  ],
}
const COMMON = `
You work on BLOCK HOURS, a realistic browser ACMI/charter airline sim with scheduled routes (Vite 6, React 19, strict TS, vitest; deterministic engine: no Date.now/Math.random in engine, use the game RNG; money only through the ledger; SAVE_VERSION 1 with ??= defaults and onLoad repairs; old saves must load). Branch v025b (origin/v025b, head bdcfd9a7) is the finished, fully checked v0.25 candidate after two rounds: see /home/user/work/v025/FINAL.md and /home/user/work/v025/FINAL2.md (open items), /home/user/work/v025/hunt/TRIAGE.md (deferred items with details) and the hunters' notes /home/user/work/v025/hunt/*.md (repros). This is ROUND 3 on top of it (short: everything must be pushed by 13:15 UTC).
The player: working flight attendant; realism (real companies, numbers, procedures), plain short wording, uncluttered UI, explanations only behind "?". iPad 1180x788 touch PWA, iPhone 852x393, Mac 1440x900, Windows. Save: /home/user/work/v025/malteser.json (copy before use).
Tools: bot \`npx tsx scripts/acmi-bot.ts <seed> <days> [--wide --inv --routes --det --base=X]\`; \`npx tsx scripts/invariants.ts save <file> <days>\`; scripts/crewcheck.ts; scripts/zplay.ts; Playwright (require('playwright'), chromium.launch() no options; never playwright install).
Container restarts happen every 25–50 min: keep the STATE file named below, commit WIP after each item, push often, resume from STATE (and from an existing worktree) if present.
4 CPUs shared with one other agent: vitest --maxWorkers=2. Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RF9bn7dpReK5tAwKUQRQ8G
(no model names anywhere). Never force-push. Never touch main, claude/contrail-airline-game, v025 or v025b. Do not release.
`
const LANES = [
  { key: 'r3-crewplan', title: 'Crew Planning hire advice tuning (FINAL2 F1)', items: `F1 from FINAL2.md: as home aircraft fly little, Crew Planning shows "Short" with a primary Hire button while Utilisation shows many crew under 15 h. Causes per FINAL2: hireHold almost never holds, and the floor homeMin = 5 sets per aircraft at home. A quick fix made the --player bot run short (red alarms 15 -> 47). Do a proper tuning study: run the --player bot (\`npx tsx scripts/acmi-bot.ts <seed> 365 --player --inv --crewcheck\` and --routes --base=MLA) on seeds 1-3 before/after each candidate rule; candidates: size the home floor on the next 28 days of planned home duties (with a sensible minimum for standby cover per EASA), let the hold count idle crew while no flight of the family is short, show "Round up" (secondary) instead of a primary Hire when the shortfall is only standby cover. Accept a rule only if red alarms, cancellations and margin stay within noise of the baseline on all seeds and the player save at 30 and 60 days shows Planning consistent with Utilisation. If no rule passes, change nothing in the engine and only reword the Planning hint (behind "?") to explain the standby floor. Report the study table.` },
  { key: 'r3-balance', title: 'Balance pass: enjoyable but not too easy', items: `From FINAL.md/FINAL2.md open items and bot gates: (1) summer block hours per aircraft below the 180-320 target on several seeds — find why (offer volume/fit, crew, maintenance windows) and fix the cause; (2) first contract arrives day 42 on seed 1 (MLA day 22) — the first weeks should have a playable first job within ~1-3 weeks; (3) the High preventive maintenance programme never pays for itself (r2-ops note): make its benefits realistic (technical delays, reliability for ETOPS approvals, client satisfaction on reliability) or its cost realistic, cite numbers; (4) seed 1 margin 15.7% vs gate 12%: check if a careful bot is too comfortable; target a typical year margin of ~5-12% for decent play. Prefer fixing inputs over fudge. Measure before/after on bots seeds 1-3 --wide --inv, MLA --routes --inv and the --player bot; write /home/user/work/v025/balance3.md. Determinism and saves unchanged.` },
]
const REPORT = { type: 'object', properties: { branch: { type: 'string' }, head: { type: 'string' }, pushed: { type: 'boolean' },
  done: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, player_sees: { type: 'string' } }, required: ['id', 'player_sees'] } },
  not_done: { type: 'array', items: { type: 'string' } }, checks: { type: 'string' }, notes: { type: 'string' } },
  required: ['branch', 'head', 'pushed', 'done', 'not_done', 'checks'] }

phase('Build')
const lanes = await parallel(LANES.map((l) => () => agent(COMMON + `
## Your lane: ${l.key} — ${l.title}
Setup: \`git -C /home/user/Game fetch -q origin v025b && git -C /home/user/Game worktree add -b v025-${l.key} /home/user/wt/b-${l.key} origin/v025b && cp -al /home/user/Game/node_modules /home/user/wt/b-${l.key}/node_modules\` (if it exists you are resuming). STATE: /home/user/work/v025/STATE-${l.key}.txt. Push to origin v025-${l.key}.
TIME: write \`date -u\` at your first start in STATE. Hard stop: 120 minutes after your first start or 11:30 UTC, whichever is first. Work in order; with 20 minutes left stop starting items and finish checks, push and report. Revert any unfinished item; never leave half-done code. Do not edit src/data/whatsNew.ts.
Items:
${l.items}`, { label: `build:${l.key}`, phase: 'Build', schema: REPORT, model: 'opus', effort: 'high' })))
const built = lanes.map((r, i) => r ? `=== ${LANES[i].key} ===\n${JSON.stringify(r)}` : `=== ${LANES[i].key} === NO RESULT`).join('\n\n')

phase('Integrate')
const integrated = await agent(COMMON + `
## Your job: integrate round 2. STATE /home/user/work/v025/STATE-r3-integrate.txt. Finish by 12:15 UTC.
Lane reports:
${built}
- Create worktree /home/user/wt/v025c on a new branch v025c from origin/v025b (cp -al node_modules). Merge origin/v025-r3-crewplan and origin/v025-r3-balance (merge commits) — skip a lane whose report says its checks failed or that has no commits, and say so. tsc + that lane's tests after each merge.
- What's New: extend the existing top entry v0.25 (it is not released yet) with short plain lines for what the player will notice from round 3 (≤ 200 chars, no em dash, no semicolon, no internal names); keep whatsNew tests passing.
- Checks: tsc; FULL vitest --maxWorkers=2; bots 1 and 2 365 --wide --inv, 1 365 --routes --inv --base=MLA, 3 365 --wide --inv --base=MAD (0 errors); 2 365 --det identical; invariants on a copy of the save 30 d (0 errors); vite build; Playwright smoke on all three devices (0 console errors).
- Push v025c. Plain report: merges, checks table, what broke.`, { label: 'integrate', phase: 'Integrate', model: 'opus', effort: 'high' })

phase('Review')
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, scenario: { type: 'string' } },
  required: ['severity', 'file', 'summary', 'scenario'] } } }, required: ['findings'] }
const REVIEWS = [
  { key: 'engine', focus: 'engine and balance changes of round 3 (git diff origin/v025b..origin/v025c -- src): regressions, determinism, ledger, save compatibility (all fixtures + the player save), crew legality and alarms (crewcheck), and whether the balance is enjoyable but not too easy (bots + --player).' },
  { key: 'player', focus: 'UI and player experience of round 3 on iPad/iPhone/Mac (vite dev on a free port, the player save): Crew Planning vs Utilisation after 30/60 days, first weeks of a new MLA game (time to first job), maintenance programme value as shown; wording plain and short, explanations behind "?".' },
]
const reviews = await parallel(REVIEWS.map((r) => () => agent(COMMON + `
## Your job: review branch v025c. READ ONLY: own worktree \`git -C /home/user/Game worktree add /home/user/wt/r3-${r.key} origin/v025c\` + cp -al node_modules. Budget 35 minutes; finish by 12:50 UTC.
Integrator's report:
${integrated}
Focus: ${r.focus}
Only real, verified defects; most severe first; empty list is fine.`, { label: `review:${r.key}`, phase: 'Review', schema: FIND, model: 'opus', effort: 'high' })))
const findings = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: REVIEWS[i].key })))

phase('Fix')
const final = await agent(COMMON + `
## Your job: fix and sign off v025c (worktree /home/user/wt/v025c). STATE /home/user/work/v025/STATE-r3-fix.txt. HARD STOP 13:20 UTC: by then everything is pushed and FINAL3.md written, even if some findings stay open.
Integrator's report:
${integrated}
Findings (verify; fix blockers and majors first, with tests; skip what cannot be done safely in time and say why):
${JSON.stringify(findings, null, 1)}
Final checks: tsc; FULL vitest; bots 1 & 2 365 --wide --inv, 1 365 --routes --inv --base=MLA (0 errors); 2 365 --det identical; invariants on a copy of the save 30 d; vite build. Update What's New v0.25 if needed.
Write /home/user/work/v025/FINAL3.md: round-3 changes the player will see, findings fixed/not, checks table, and a clear VERDICT line: "v025c READY" if every check passed, else "v025c NOT READY: <why> — release v025b instead". Push v025c. Return FINAL3.md's content.`, { label: 'fix', phase: 'Fix', model: 'opus', effort: 'high' })
return { built, integrated, findings, final }
