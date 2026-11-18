export const meta = {
  name: 'v025-round2',
  description: 'BLOCK HOURS v0.25 round 2: deferred items in 4 lanes, then merge, review and fix on v025b (v025 stays the safe candidate)',
  phases: [
    { title: 'Build', detail: '4 lanes from origin/v025' },
    { title: 'Integrate', detail: 'merge into v025b, What is New, full checks' },
    { title: 'Review', detail: 'engine and UI/player reviewers' },
    { title: 'Fix', detail: 'fix findings, final checks, FINAL2.md' },
  ],
}
const COMMON = `
You work on BLOCK HOURS, a realistic browser ACMI/charter airline sim with scheduled routes (Vite 6, React 19, strict TS, vitest; deterministic engine: no Date.now/Math.random in engine, use the game RNG; money only through the ledger; SAVE_VERSION 1 with ??= defaults and onLoad repairs; old saves must load). Branch v025 (origin/v025, head 23c9c10b) is tonight's finished and fully checked v0.25 candidate: see /home/user/work/v025/FINAL.md (its open items), /home/user/work/v025/hunt/TRIAGE.md (deferred items with details) and the hunters' notes /home/user/work/v025/hunt/*.md (repros). This is ROUND 2 on top of it.
The player: working flight attendant; realism (real companies, numbers, procedures), plain short wording, uncluttered UI, explanations only behind "?". iPad 1180x788 touch PWA, iPhone 852x393, Mac 1440x900, Windows. Save: /home/user/work/v025/malteser.json (copy before use).
Tools: bot \`npx tsx scripts/acmi-bot.ts <seed> <days> [--wide --inv --routes --det --base=X]\`; \`npx tsx scripts/invariants.ts save <file> <days>\`; scripts/crewcheck.ts; scripts/zplay.ts; Playwright (require('playwright'), chromium.launch() no options; never playwright install).
Container restarts happen every 25–50 min: keep the STATE file named below, commit WIP after each item, push often, resume from STATE (and from an existing worktree) if present.
4 CPUs shared with one other agent: vitest --maxWorkers=2. Commit messages end with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RF9bn7dpReK5tAwKUQRQ8G
(no model names anywhere). Never force-push. Never touch main, claude/contrail-airline-game or v025. Do not release.
`
const LANES = [
  { key: 'r2-ops', title: 'AOG recovery and ops realism', items: `1. FINAL.md open item: a long AOG at an outstation (tug damage, 3-4 days) leaves the return leg waiting 69-86 h. Past about 24 h of expected repair, plan a rescue: sub-charter the waiting legs (the existing sub-charter machinery) or send one of our own spare aircraft; the player gets a card with the choice and the cost; default to the cheaper realistic option. Include triage 'ops-aog-rescue'.
2. AOG frequency calibration: seed 2 had 3.57 AOGs per aircraft-year (seed 1 0.83). Real-world A320-family unscheduled AOG events that ground an aircraft overnight or longer are well under 1 per aircraft-year for a decent operator (cite or mark [E]); check the draw (and the preventive maintenance programme factors) so the average is realistic and seed variance not extreme; keep High PM meaningful.
3. ops-curfews (triage): only add curfews you can source (AIP/airport rules), cite them in data comments.
Checks: bots seeds 1,2,3 365 --wide --inv and 1 365 --routes --inv --base=MLA (0 errors; report AOGs per aircraft-year and year margin before/after), --det seed 2 identical, invariants on the save 30 d.` },
  { key: 'r2-crew', title: 'Crew sizing and time away', items: `1. crew-oversets (triage, major): Crew Planning says 'short 18, hire' while every crew member flies ~25 h/28 days; sizeSets peak*8/6 plus grow over-size detachments. Size sets on real duty-days per set over 28 days (FTL limits plus days off), use the peak only when peak duties overlap in time, let resizeDeployments trim grown sets, and make Planning and Utilisation agree. Do a bot sizing study across seeds 1-3 and bases MLA/LIS before/after (crew count, hours per crew, red alarms, cancellations) and on the player save.
2. crew-awaychain (triage): cap a crew member's time away from base at the rotation length (rotationWeeks), so detachments rotate realistically.
Checks: crew suite, bots 1,2,3 365 --wide --inv + 1 365 --routes --inv --base=MLA (0 errors), scripts/crewcheck alarms count before/after, --det seed 2 identical, invariants on the save 30 d.` },
  { key: 'r2-ux', title: 'Immersion extras and small UX', items: `In order: 1. ui-onboarding-first-run; 2. ui-route-dialog-actions; 3. ui-counter-reply-wording; 4. ui-leave-month-targets; 5. ui-whatsnew-fold-old; 6. ui-glossary-search; 7. immersion-milestones; 8. immersion-passenger-letters; 9. the parked-stands remainder from FINAL.md if it can be done without 8 px labels (x6 badge at low zoom, route lines under parked aircraft). Details in TRIAGE.md / hunt notes. Playwright shots on all three devices for each UI change into /home/user/work/v025/shots/r2-ux/; look at them.
Checks: tsc, vitest for touched areas, bot 1 365 --wide --inv 0 errors, --det seed 2 identical (engine text changes only must not change the random draws).` },
  { key: 'r2-perf', title: 'Performance and save speed', items: `1. Measure first: sim speed (game days per real second) for seeds 1-2 and the player save, bot runtime (FINAL.md says 55-73 s vs targets 12/20 s while sharing CPUs: check alone what is real and whether v025 regressed vs origin/routes2), load time and Continue time for the save, save size. Write /home/user/work/v025/perf.md.
2. core-i4: faster Continue (skip the re-roster on a fixed-point save) if the measurement shows it matters.
3. core-i1: spread the midnight engine work over 00:00-00:02 to avoid a frame hitch at 4x (needs a determinism-preserving order; update test tolerances only if the results are equivalent).
4. Any other hot spot the profile shows (profile with node --cpu-prof on the bot).
5. core-i2 (saves to IndexedDB, async manual save) ONLY if time is left and it can be done with a safe fallback to the current storage for old saves.
Checks: tsc, full vitest of touched areas, bots 1,2 365 --wide --inv 0 errors, --det seed 2 identical, invariants on the save; report before/after numbers.` },
]
const REPORT = { type: 'object', properties: { branch: { type: 'string' }, head: { type: 'string' }, pushed: { type: 'boolean' },
  done: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, player_sees: { type: 'string' } }, required: ['id', 'player_sees'] } },
  not_done: { type: 'array', items: { type: 'string' } }, checks: { type: 'string' }, notes: { type: 'string' } },
  required: ['branch', 'head', 'pushed', 'done', 'not_done', 'checks'] }

phase('Build')
const lanes = await parallel(LANES.map((l) => () => agent(COMMON + `
## Your lane: ${l.key} — ${l.title}
Setup: \`git -C /home/user/Game fetch -q origin v025 && git -C /home/user/Game worktree add -b v025-${l.key} /home/user/wt/b-${l.key} origin/v025 && cp -al /home/user/Game/node_modules /home/user/wt/b-${l.key}/node_modules\` (if it exists you are resuming). STATE: /home/user/work/v025/STATE-${l.key}.txt. Push to origin v025-${l.key}.
TIME: write \`date -u\` at your first start in STATE. Hard stop: 120 minutes after your first start or 10:15 UTC, whichever is first. Work in order; with 20 minutes left stop starting items and finish checks, push and report. Revert any unfinished item; never leave half-done code. Do not edit src/data/whatsNew.ts.
Items:
${l.items}`, { label: `build:${l.key}`, phase: 'Build', schema: REPORT, model: 'opus', effort: 'high' })))
const built = lanes.map((r, i) => r ? `=== ${LANES[i].key} ===\n${JSON.stringify(r)}` : `=== ${LANES[i].key} === NO RESULT`).join('\n\n')

phase('Integrate')
const integrated = await agent(COMMON + `
## Your job: integrate round 2. STATE /home/user/work/v025/STATE-r2-integrate.txt. Finish by 11:30 UTC.
Lane reports:
${built}
- Create worktree /home/user/wt/v025b on a new branch v025b from origin/v025 (cp -al node_modules). Merge origin/v025-r2-ops, -r2-crew, -r2-ux, -r2-perf (merge commits) — skip a lane whose report says its checks failed or that has no commits, and say so. tsc + that lane's tests after each merge.
- What's New: extend the existing top entry v0.25 (it is not released yet) with short plain lines for what the player will notice from round 2 (≤ 200 chars, no em dash, no semicolon, no internal names); keep whatsNew tests passing.
- Checks: tsc; FULL vitest --maxWorkers=2; bots 1 and 2 365 --wide --inv, 1 365 --routes --inv --base=MLA, 3 365 --wide --inv --base=MAD (0 errors); 2 365 --det identical; invariants on a copy of the save 30 d (0 errors); vite build; Playwright smoke on all three devices (0 console errors).
- Push v025b. Plain report: merges, checks table, what broke.`, { label: 'integrate', phase: 'Integrate', model: 'opus', effort: 'high' })

phase('Review')
const FIND = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, file: { type: 'string' }, summary: { type: 'string' }, scenario: { type: 'string' } },
  required: ['severity', 'file', 'summary', 'scenario'] } } }, required: ['findings'] }
const REVIEWS = [
  { key: 'engine', focus: 'engine changes of round 2 (git diff origin/v025..origin/v025b -- src/engine): regressions, determinism, ledger, save compatibility (all fixtures + the player save), crew legality after the sizing change (crewcheck), AOG rescue money and recovery; re-run the round-2 repros.' },
  { key: 'player', focus: 'UI and player experience of round 2 on iPad/iPhone/Mac (vite dev on a free port, the player save): onboarding, route dialog actions, milestones and passenger letters, crew planning numbers vs utilisation, AOG rescue card, speed of Continue and of 4x play; wording plain and short, explanations behind "?".' },
]
const reviews = await parallel(REVIEWS.map((r) => () => agent(COMMON + `
## Your job: review branch v025b. READ ONLY: own worktree \`git -C /home/user/Game worktree add /home/user/wt/r2-${r.key} origin/v025b\` + cp -al node_modules. Budget 60 minutes; finish by 12:30 UTC.
Integrator's report:
${integrated}
Focus: ${r.focus}
Only real, verified defects; most severe first; empty list is fine.`, { label: `review:${r.key}`, phase: 'Review', schema: FIND, model: 'opus', effort: 'high' })))
const findings = reviews.filter(Boolean).flatMap((r, i) => r.findings.map((f) => ({ ...f, lens: REVIEWS[i].key })))

phase('Fix')
const final = await agent(COMMON + `
## Your job: fix and sign off v025b (worktree /home/user/wt/v025b). STATE /home/user/work/v025/STATE-r2-fix.txt. HARD STOP 13:15 UTC: by then everything is pushed and FINAL2.md written, even if some findings stay open.
Integrator's report:
${integrated}
Findings (verify; fix blockers and majors first, with tests; skip what cannot be done safely in time and say why):
${JSON.stringify(findings, null, 1)}
Final checks: tsc; FULL vitest; bots 1 & 2 365 --wide --inv, 1 365 --routes --inv --base=MLA (0 errors); 2 365 --det identical; invariants on a copy of the save 30 d; vite build. Update What's New v0.25 if needed.
Write /home/user/work/v025/FINAL2.md: round-2 changes the player will see, findings fixed/not, checks table, and a clear VERDICT line: "v025b READY" if every check passed, else "v025b NOT READY: <why> — release v025 instead". Push v025b. Return FINAL2.md's content.`, { label: 'fix', phase: 'Fix', model: 'opus', effort: 'high' })
return { built, integrated, findings, final }
