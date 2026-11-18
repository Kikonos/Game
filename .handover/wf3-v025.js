export const meta = {
  name: 'v025-integrate',
  description: 'BLOCK HOURS v0.25: merge the 6 lanes, What is New, full checks, 3 independent reviews, fix and sign off',
  phases: [
    { title: 'Integrate', detail: 'merge lanes into v025, What is New v0.25, full checks' },
    { title: 'Review', detail: 'engine, UI/visual, player-experience reviewers' },
    { title: 'Fix', detail: 'fix confirmed findings, final checks, FINAL.md' },
  ],
}
const LANES = ['crew', 'ui', 'network', 'commercial', 'ops-world', 'immersion-visual']
const COMMON = `
You work on BLOCK HOURS, a realistic browser ACMI/charter airline sim with scheduled routes (Vite 6, React 19, strict TS, vitest; deterministic engine; money only through the ledger; SAVE_VERSION 1 with ??= defaults and onLoad repairs; old saves must load). Live = v0.24.2. Tonight's round: 8 hunters found bugs and ideas (/home/user/work/v025/hunt/*.md, TRIAGE.md) and 6 lanes built fixes on branches v025-<lane> (lane STATE files /home/user/work/v025/STATE-<lane>.txt; lane reports in /home/user/work/v025/lanes.json).
The player: working flight attendant; realism, plain short wording, uncluttered UI, explanations only behind "?". iPad 1180x788 touch PWA, iPhone 852x393, Mac 1440x900, Windows. Save: /home/user/work/v025/malteser.json (copy before use).
Tools: bot \`npx tsx scripts/acmi-bot.ts <seed> <days> [--wide --inv --routes --det --base=X]\`; \`npx tsx scripts/invariants.ts save <file> <days>\`; scripts/zplay.ts; scripts/lifesave.ts; Playwright (require('playwright'), chromium.launch() no options; never playwright install).
HARD DEADLINE: everything in this workflow must be finished and pushed by 12:45 UTC. Check \`date -u\`. Container restarts happen: keep a STATE file (named below), commit WIP, push, resume from STATE.
4 CPUs shared with another agent: vitest --maxWorkers=2. Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RF9bn7dpReK5tAwKUQRQ8G
(no model names anywhere). Never force-push. Never touch main or claude/contrail-airline-game. Do not release.
`
phase('Integrate')
const integrated = await agent(COMMON + `
## Your job: integrate. Worktree /home/user/wt/v025 (branch v025). STATE /home/user/work/v025/STATE-integrate.txt. Budget: 2 h.
- git fetch; merge origin/v025-${LANES.join(', origin/v025-')} into v025 one by one (merge commits). After each merge: tsc and the vitest files of that lane's area. Resolve conflicts keeping both lanes' behaviour.
- What's New: add a top entry version 'v0.25', a short name (e.g. 'Big debug round: crew, routes, offers, immersion'), features/improvements/fixes in short plain player lines (each ≤ 200 chars, no em dash, no semicolon, no internal names), drawn from the lane reports: what the player will notice. Update src/data/whatsNew.test.ts and src/engine/fixpack08.test.ts like previous versions did (CURRENT = v0.25; version lists gain 'v0.25' first; WHATS_NEW[n] indexes and WHATS_NEW.slice(a,b) ranges shift by one; add a test for the new entry).
- Checks: tsc; FULL vitest --maxWorkers=2; bots seed 1 and 2 \`365 --wide --inv\`, \`1 365 --routes --inv --base=MLA\`, \`3 365 --wide --inv --base=MAD\` (0 errors); \`2 365 --det\` identical; invariants on a copy of the save 30 days (0 errors); vite build.
- Playwright smoke at iPad/iPhone/Mac on the save: title, map, globe, contracts, network, schedule, crew, fleet, finance, company, inbox, settings/key bindings; 0 console errors; shots to /home/user/work/v025/shots/integrate/.
- Push v025. Return a plain report: merges, conflicts, What's New lines, checks table, anything broken.`,
  { label: 'integrate', phase: 'Integrate', model: 'opus', effort: 'high' })

phase('Review')
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, line: { type: 'number' },
  summary: { type: 'string' }, scenario: { type: 'string' } }, required: ['severity', 'file', 'summary', 'scenario'] } } }, required: ['findings'] }
const REVIEWS = [
  { key: 'engine', focus: 'Engine correctness of tonight’s changes: read \`git diff origin/routes2..origin/v025 -- src/engine\` and judge each change for regressions, determinism, ledger integrity, save compatibility (load every fixture in src/engine/fixtures and the player save), and whether the bug fixes really fix the hunters’ repros (re-run them from hunt/*.md).' },
  { key: 'ui', focus: 'UI and visuals of tonight’s changes on iPad 1180x788, iPhone 852x393, Mac 1440x900, light and dark: run vite dev on a free port, load the save, walk every changed screen (see lane reports), look at screenshots; overlaps, clipping, broken flows, tap targets, wording (plain, short, explanations behind "?"), keyboard shortcuts still working.' },
  { key: 'player', focus: 'Player experience: play the save for 60+ game days with scripts (and a new MLA game for 6 months) and read what the player would see (Inbox, cards, toasts, route and contract results): does it feel more real and alive, are there new annoyances, repeated or wrong texts, unrealistic numbers, money surprises? Compare with live v0.24.2 (origin/routes2) where useful.' },
]
const reviews = await parallel(REVIEWS.map((r) => () => agent(COMMON + `
## Your job: review branch v025 after integration. READ ONLY: use your own worktree \`git -C /home/user/Game worktree add /home/user/wt/r-${r.key} origin/v025\` + \`cp -al /home/user/Game/node_modules /home/user/wt/r-${r.key}/node_modules\`. Budget 75 minutes.
Integrator's report:
${integrated}
Focus: ${r.focus}
Only real, verified defects (reproduced or a concrete path). Most severe first. Empty list is fine.`,
  { label: `review:${r.key}`, phase: 'Review', schema: FIND, model: 'opus', effort: 'high' })))
const findings = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: REVIEWS[i].key })))
log(`${findings.length} findings`)

phase('Fix')
const final = await agent(COMMON + `
## Your job: fix and sign off on branch v025 (worktree /home/user/wt/v025). STATE /home/user/work/v025/STATE-fix.txt. Budget 2 h, and finished by 12:45 UTC at the latest.
Integrator's report:
${integrated}
Findings (verify each; fix real ones with tests, blockers and majors first; say why for any you skip):
${JSON.stringify(findings, null, 1)}
Final checks: tsc; FULL vitest; bots seed 1 & 2 \`365 --wide --inv\`, \`1 365 --routes --inv --base=MLA\` (0 errors); \`2 365 --det\` identical; invariants on a copy of the save 30 days; vite build; update What's New v0.25 if fixes change what the player sees.
Write /home/user/work/v025/FINAL.md: per area what the player will see (short), hunters' bugs fixed vs not, improvements shipped vs deferred, review findings fixed/not, checks table, open items. Push v025. Return FINAL.md's content.`,
  { label: 'fix', phase: 'Fix', model: 'opus', effort: 'high' })
return { integrated, findings, final }
