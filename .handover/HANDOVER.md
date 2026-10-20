# CREDITS: user (2026-10-20 05:15Z) allows paid usage credits up to 50% (we can't see the meter; user will turn them off). So keep working through plan limits.
# PLAYER DECISIONS 2026-10-20: name BLOCK HOURS; home base choice yes; named crew + adjustable auto-roster; REAL company/government names (neutral, no invented wrongdoing); replace old game (no classic link). Recorded at end of docs/acmi/BRIEF.md.

# ACMI PIVOT (2026-10-19 15:20Z) — PLAN OF RECORD (supersedes the airline-sim plans below)
The user played v0.2 for a few hours and liked it. They want to MORPH the game into an **ACMI / wet-lease / dry-lease (and charter) simulator**. They are a flight attendant who worked at EuroAtlantic Airways (2× B767-300ER + 2× B777-200ER at the time) and at Getjet / Airhub Airlines.
Requirements (from the user):
- Research the ACMI industry BEFORE building.
- Morph the existing game (reuse map, airports, aircraft data and art, iPad touch shell, saves, PWA).
- MUCH slower pace. Speeds 1×/2×/4× only. A sense of waiting for achievements while staying busy with other tasks. No flicker or frantic, grindy feel.
- Big emphasis on the WORLD MAP. Real-time aircraft graphics that follow their routes and departure/landing times.
- Small scale: few aircraft. Cabin configuration and route/contract choice matter.
- Contracts: military, commercial (airline ACMI), refugees, prisoners, presidential, VIP, medical, repatriation (disasters/conflicts). Ad hoc, 1-month, multi-year. Urgent high-paying jobs.
- Schedule, balance and crew each flight/contract against availability and current issues. Sub-lease or sub-charter a contract to another ACMI provider when needed.
- The player is CEO but involved in every department: HR, Crewing, Rostering, Flight scheduling, Crew scheduling.
- Start small with a few aircraft and build towards long haul, then ultra-long haul.
- A scheduling tab for each aircraft showing its current duty (timeline).
- Aircraft market scarce: hard to acquire (new, used or leased). You mostly use what you have.
- Staffing per aircraft: legal minimum crew, plus extra crew for morale/service. Flight attendants, pilots, maintenance staff.
- Goals harder to reach but not grindy; entertaining. iPad A16 landscape, PC-like pacing.
- Open questions for the user are listed in the chat (name, home base, named crew vs pools, real vs fictional clients). Proceed with defaults unless the user answers.
ACMI work happens in worktree /home/user/wt/acmi on branch `acmi` (pushed to origin). Docs: docs/acmi/RESEARCH.md (research, DONE), docs/acmi/BRIEF.md (creative brief, plan of record), docs/acmi/DESIGN.md (technical design, next).
Phases:
- P0 Research workflow (3 researchers + synthesis) → docs/acmi/RESEARCH.md  [DONE 16:05Z, wf_b0382533-2df]
- P1 Game design + architecture doc → docs/acmi/DESIGN.md + BUILD-PLAN.md + compiling skeleton  [RUNNING: workflow acmi-design-wf_9fc3165a-62a.js run wf_9fc3165a-62a; resume with resumeFromRunId if it died]
- P2 build workflow (next; script ready at /home/user/wt/notes/.handover/acmi-build.js — launch with Workflow({scriptPath}) once P1 revise is done; then release v0.5 manually per RELEASE PROCESS, copying the current play/ to classic/ first): 5 parallel builders per BUILD-PLAN.md (B1 contracts, B2 crew/HR, B3 ops/maintenance/finance/events, B4 map live view, B5 screens) → integration agent → adversarial QA (fun/realism, bugs, iPad) → fixes → release v0.5 (copy current play/ to classic/ first so the old game stays at /Game/classic/).
- P2 v0.5 "ACMI foundation": new engine (contracts, flights with real times, aircraft, crew basics + FTL, maintenance, finance), map-centric UI, per-aircraft schedule. Keep the old game at /Game/classic/.
- P3 v0.6 crew/HR depth (rostering, training, morale, hiring lead times), subleasing / sub-charter
- P4 v0.7 market scarcity, cabin configs per contract, AOC approvals (ETOPS/long-haul/ULR/military), events/crises, goals
- P5 polish and balance, then further releases
Old wip/* branches (art, mobile, balance) are frozen. Art and iPad shell work is reused via main (v0.2). The airline-sim balance work is not needed.

# CONTRAIL — handover notes

Read this first when resuming after a usage-limit reset or a context reset.
Checkpoint script: `bash /home/user/wt/notes/.handover/checkpoint.sh` (commits all worktrees, pushes wip/* branches).

## NEW DIRECTIVES (2026-10-19 ~11:00Z) — highest priority
- The user plays ONLY on iPad **landscape** (Safari 1180×750, home-screen app 1180×820). Portrait/split view only need to not break.
- **Ship as updates** like a real game: the live build must always be playable. Release each finished, tested piece as a new version. Never break saves; migrate() must handle old saves.
- Live site: https://kikonos.github.io/Game/ (Pages "Deploy from a branch" serves the repo root of the default branch; root index.html redirects github.io visitors to play/, which holds the committed production build; .nojekyll at the root).

## RELEASE PROCESS (use /home/user/wt/rel on branch rel/next)
1. `cd /home/user/wt/rel && git merge claude/contrail-airline-game`. Then merge the finished track branch(es) (`git merge wip/<x>`) and resolve conflicts.
2. `npx tsc --noEmit && npx vitest run`. Start the dev server (VITE_CACHE_DIR=node_modules/.vite-5401 npx vite --port 5401 --strictPort). Then run:
   - `node scripts/ipad-shots.cjs --url http://localhost:5401/ --out <scratch>/rel/sN --view safari --screens title,newgame-brand,hq,map,routes,route-planner,fleet,market-new,order-modal,finance,settings` and look at the shots;
   - `PW=/opt/node22/lib/node_modules/playwright node <scratch>/e2e-rel.cjs`, a full play-through that saves shots to scratchpad/shots; it must print `ERRORS:` with nothing after it.
3. Bump the version in src/ui/screens/Title.tsx (`v0.N`), `npm run build`, `rm -rf play && cp -r dist play`, then commit "v0.N: <summary>" with the trailers.
4. `cd /home/user/Game && git merge --ff-only rel/next && git push origin claude/contrail-airline-game claude/contrail-airline-game:main`. Wait about 1 minute, then verify with `node <scratch>/pages/check.cjs https://kikonos.github.io/Game/ out.png`.
5. Optionally republish the artifact (build:embed).

## RELEASES
- v0.1 (11:03Z): original game, blank-page fix (play/ + redirect).
- v0.2 (11:25Z): iPad touch layout foundation plus partial screen work, labelled speed control, new aircraft art (Boeing/wide/heavy refined; regional/Airbus architect level), map pinch/drag.
- NEXT v0.3: engine rebalance plus cabin redesign (engine workflow), plus anything finished in art/iPad.
- THEN v0.4: iPad landscape screen polish (review and fix), art regional/Airbus refinement and integration.
- THEN: debugging & improvements round, then v0.5. Ideas: an in-game "What's new" after an update; autosave before the service-worker update reload.

## User requests (all still open unless ticked)
- [ ] Design for **iPad (A16)**, 1180×820 landscape / 820×1180 portrait, touch. (The iPhone was dropped as too small.)
- [ ] Speed control clearly labelled 1×/2×/4×/10×, **but the game must not become too easy**: rebalance the economy, competitor reactions, inflation, ageing, XP taper, and slow-to-1× on alerts.
- [ ] **Aircraft art**: slightly cartoonified real-world side profiles, nose left, in the style of the Airbus marketing art.
- [ ] **Cabin config** must matter. The user said the ATR barely changed seats or comfort. Plan: pitch/abreast choices, seat width, regional business, visible consequences.
- [ ] **Add to home screen** later: PWA via GitHub Pages. `main` has been created. The user should set the default branch to main and set Pages source to GitHub Actions. deploy.yml publishes from the default branch.
- [ ] After all of the above: a **debugging and improvements round**, then publish.
- [x] Create `main` (done; keep it in sync with claude/contrail-airline-game on every finished push).
- [ ] Save progress near usage limits & keep resuming until done — hourly scheduled task trig_01TSLRzBNHatY2hxNxpg6GKd (":32" each hour) runs checkpoint + resume; delete it when finished.

## Worktrees / branches
| track | worktree | branch | owner of |
|---|---|---|---|
| art | /home/user/wt/art | wip/art | src/ui/components/aircraft/*, AircraftArt.tsx re-export, gallery.html, src/dev/gallery.tsx, scripts/art-shots.cjs |
| iPad UI | /home/user/wt/mobile | wip/mobile | Shell, ui.tsx, app.css, src/styles/touch/*, screens (not CabinConfig/SeatMap), useMedia.ts, index.html, ipad-shots.cjs |
| engine | /home/user/wt/balance | wip/balance | src/engine/*, src/data/* (seats, cabin width), store.ts, CabinConfig.tsx, SeatMap.tsx, scripts/*.ts, Modals.tsx (slowOnAlerts toggle only) |
| notes | /home/user/wt/notes | wip/handover | this file |
Main checkout: /home/user/Game on claude/contrail-airline-game (also pushed as main).
node_modules in worktrees are hardlink copies (`cp -al`). Each dev server uses VITE_CACHE_DIR=node_modules/.vite-<port>.

## Workflows (resume with Workflow({scriptPath, resumeFromRunId}))
Script dir: /root/.claude/projects/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/workflows/scripts/
- engine: engine-balance-cabins-wf_a2622997-0eb.js, latest run wf_8375b063-4f4 (stages: rebalance → cabins → verify+fix)
- iPad: ipad-layout-wf_182f21e9-43a.js, run wf_182f21e9-43a (foundation done and cached; screens ×3 → review → fix ×2)
- art: aircraft-art-refine-wf_c35e6b4b-162.js, run wf_c35e6b4b-162 (refine ×2 → integrate)
If an agent fails on a limit, its file edits persist (checkpoint them). Resume the run to rerun the failed agents.

## Remaining plan after the three workflows finish
1. Run checkpoint.sh. Review each track briefly (screenshots: art contact sheets in scratchpad/art/final, iPad shots in scratchpad/mobile).
2. Squash-merge into claude/contrail-airline-game in this order: balance → art → mobile. Resolve conflicts:
   - Modals.tsx: slowOnAlerts toggle plus the iPad restyle.
   - screens.css: cabin-editor and aircraft-art rules plus the touch changes.
   - Market/Fleet: add detail="simple" to the mini art per the art integrator's recommendations.
   Then run tsc, vitest and build.
3. Run the final QA workflow (the "debugging + improvements round"):
   - iPad adversarial QA with play-through, then fixes.
   - Gameplay/balance/cabin sanity check, then fixes.
   - Code review of the merged diff, then fixes.
4. Run `npm run build:embed`. Republish the artifact: https://claude.ai/artifact/QmMdfvHWKJNKKbPXosQ1F9, file_path dist-embed/page.html. The files map lists the assets in dist-embed (hashes change). Omit icon on redeploy.
5. Commit, then push claude/contrail-airline-game and main. Delete the remote wip/* branches and remove the worktrees and the hourly trigger.
6. Final message to the user: what changed; the iPad home-screen steps (default branch → main, Pages source → GitHub Actions, https://kikonos.github.io/Game/); any limitations.

## Log
- 07:xxZ User approved the model mix (main Opus 5.5 + ultracode). acmi-build2.js now sets per-agent model/effort (B3/integrate/reviews/engine-fix: opus high; B5/real-names/ui-fix: sonnet medium). Launched fresh as run wf_6f62dfd6-3bf (resume with resumeFromRunId). Hourly task re-enabled.
- 06:33Z ON HOLD: last resume failed instantly on the WEEKLY limit (resets Oct 21 15:00Z). User upgraded the plan and asked which model/effort to use "before you continue". Recommendation sent: main = Opus 5.5 high; subagents = Opus high for engine/integration/reviews, Sonnet 5.5 medium for screens/data/QA, Haiku low for trivial checks. Waiting for the user's go-ahead; hourly task disabled until then. Next step on go-ahead: resume wf_1adb1115-648 (acmi-build2.js), ideally with per-agent model/effort opts.
- 06:31Z run wf_1adb1115-648 hit limit ~05:50Z (B3/B5/real-names partial, checkpointed); limit reset 06:30Z → resuming it.
- 05:25Z (Oct 20) build run wf_4e46c6a0-e86: B1,B2,B4 DONE (reports .handover/reports-b124.md); B3,B5 partial. CI now only on main/game branch; checkpoints [skip ci]. Launched continuation script acmi-build2.js (copy in .handover/) as run wf_1adb1115-648 (resume with resumeFromRunId).
- 01:33Z (Oct 20) P2 build run wf_4e46c6a0-e86 hit limit at ~22:10Z (reset 01:30Z) with all 5 builders mid-way (~5.9k lines written, checkpointed). Resuming it now.
- 21:01Z P1 DONE (design reviewed+revised, committed 6890c84 on acmi). P2 build workflow RUNNING: scriptPath /tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi/acmi-build.js (backup copy .handover/acmi-build.js; if the scratchpad copy is gone, pass the backup inline via Workflow script), run wf_4e46c6a0-e86 — resume with resumeFromRunId.
- 20:33Z P1 architect DONE (DESIGN.md, BUILD-PLAN.md, skeleton builds/runs); critic+revise failed on limit (reset 20:20Z). Resuming wf_9fc3165a-62a.
- 16:15Z P1 design workflow launched (wf_9fc3165a-62a).
- 16:10Z P0 research done; BRIEF.md written; acmi worktree/branch created. Next: P1 design+skeleton workflow.
- 15:24Z ACMI pivot requested by user. Trigger prompt updated to follow this section. Starting P0 research.
- 11:00Z user: iPad page was blank, landscape only, ship as updates. Fixed via play/ (v0.1), released v0.2. Subagents limited until 15:20Z; workflows to resume then (ipad prompts now landscape-only).
- 11:35Z subagents available again (probe OK). Resumed engine (wf_8375b063-4f4) + art (wf_c35e6b4b-162). iPad screens (wf_182f21e9-43a) to resume after these, then release v0.3 (engine) / v0.4.
- 2026-10-19 10:25Z: limits hit twice. The art architect finished the renderer, specs and gallery (big improvement). The iPad foundation is done. The engine rebalance is partly done (committed as WIP). Relaunched all three workflows lean.
