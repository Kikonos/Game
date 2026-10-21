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
- [x] Speed control clearly labelled **1×/2×/4× only** (no 10×; pause allowed), **but the game must not become too easy**: rebalance the economy, competitor reactions, inflation, ageing, XP taper, and slow-to-1× on alerts.
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
- 07:15Z Main session back on Opus 5.5 (Ultracode off). User: use Fable for helper agents where it fits — default future helper agents to model 'fable' (fast, good on well-specified tasks), keep runs lean (1 review before each release).
- 07:10Z Fable trial DONE in ~10 min, all green: brand (chronograph mark, icons, Title/Loading, manifest) + a332/a343/a35u/b77l art, committed 732cb0c on branch brand (pushed). TO DO after v0.5 integrate finishes: `git -C /home/user/wt/acmi merge brand` (keep brand's Logo/Title/Loading/icons/manifest; integrate's everything else), then continue the release. User may switch the main session to Opus High / Ultracode off — the running v0.5 workflow is unaffected.
- 06:55Z Main session switched to Fable 5.1 (user's choice; commit trailer now Fable). v0.5 run wf_6f62dfd6-3bf progressing (B5 + real-names done, B3 running). Fable trial launched in parallel in worktree /home/user/wt/brand (branch brand, off acmi): BLOCK HOURS logo/icons/title + art for a332/a343/a35u/b77l — run wf_da4234a1-85c (script blockhours-brand-art-wf_da4234a1-85c.js). Merge brand into acmi AFTER the v0.5 integrate stage finishes (expect small conflicts in Logo.tsx/Title.tsx/Loading.tsx/index.html/vite.config.ts — keep brand's versions for the mark, integrate's for everything else).
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

### 2026-10-20 07:25Z — handed the v0.5 build to Fable (session model now Fable 5.1, ultracode on)
- Stopped Opus run wf_6f62dfd6-3bf (B3 was ~80% done, tuning via the bot). Its B3 partial work is committed on `acmi` (a32a6ae). B5 + real-names reports extracted to `.handover/reports-b5names.md`.
- Launched **wf_83610710-0e6** (script `.handover/acmi-build3.js`, live copy in scratchpad/acmi/acmi-build3.js; task id wtbrxg8su): Assess → B3 lanes (flights, finance, events) → bot & balance → integrate (engine lane ∥ UI lane → end-to-end) → 6 review lenses → triage → batched refutation → fix lanes (engine/ui/map/content) → release readiness (≤ 2 rounds). All agents Fable. Container has 4 CPUs → 2 agents run concurrently.
- Resume if it dies: `Workflow({scriptPath: "<scratchpad>/acmi/acmi-build3.js", resumeFromRunId: "wf_83610710-0e6"})`. If the scratchpad is gone, restore the script from `.handover/acmi-build3.js` (it hardcodes the scratchpad path — adjust SCRATCH).
- Art agent a981d213055d715af (Fable) still running on `brand`: gear removed, noses/windows per family from the user's reference photos, and NEW: all aircraft art nose-RIGHT (map icons rotate to heading, unchanged). Commit on `brand` when done, then merge into `acmi` before release (keep brand's Logo/Title/Loading/icons/manifest/art).
- Release v0.5 after the workflow reports ready: merge brand → tsc/vitest/build → quick iPad shots + play → `rm -rf play && cp -r dist play` → commit (Fable trailer) → ff claude/contrail-airline-game + main → verify https://kikonos.github.io/Game/ → tell the user.

### 2026-10-20T07:33Z — hourly check-in
- Art fix reviewed and committed on brand (e5c3f17, pushed): nose-right, no gear, family noses/windows. Step 4 done.
- wf_83610710-0e6 running (Assess agent since 07:27). Checkpoint run. Nothing for the user yet.

### 2026-10-20 07:50Z — art redo by tracing (user: "still way off")
- User wants the EXACT profiles (nose + cockpit windows) of the aircraft in their reference photos (scratchpad/brand/userref/: airbus-boeing-comparison.jpg nose-right photos A318…A380; airbus-family.jpg nose-left low-res A350-1000/A380/A330-200/A320neo; concorde-ba-profile.jpg nose-left clean drawing) and Overture replaced by Concorde with exactly that drawing's shape (game livery, not BA's).
- Launched **wf_2d49f509-f34** (task wrm6ct9is, script `.handover/art-trace.js`, live copy scratchpad/brand/art-trace.js) on the brand worktree: 4 trace agents ∥ renderer (traced-profile data contract in src/ui/components/aircraft/traced/) → apply per spec file + Concorde → measure (IoU + sheet) → fix lanes, ≤ 3 rounds → finish (gallery shots in scratchpad/brand/final/). All Fable.
- Resume if it dies: Workflow({scriptPath: "<scratchpad>/brand/art-trace.js", resumeFromRunId: "wf_2d49f509-f34"}). When done: look at scratchpad/brand/final/compare-sheet.png, commit on brand, send the sheet to the user. The brand merge into acmi before release must include this.

### 2026-10-20 07:48Z — usage limit warning
- User: session at 70% usage, limit resets ~11:33Z. Expect both Fable workflows to be killed when the limit hits; work on disk is committed every 30 min (hourly trigger :32 + new checkpoint-only trigger trig_01FKC2Y7QvrmnE3mu4zMHeKH at :02). After the reset the next trigger resumes: wf_83610710-0e6 (acmi-build3.js) and wf_2d49f509-f34 (art-trace.js) with resumeFromRunId — check each journal.jsonl first; agents without a "result" entry re-run from their on-disk partial work.

### 2026-10-20 11:35Z — resumed after the usage limit
- Both Fable runs were killed by the limit ~07:55Z (build: assess + B3:finance cached; art: nothing cached, traced/types.ts + load.ts exist on disk). Resumed at 11:34Z: build task wsizvrnbu (run wf_83610710-0e6), art task wfnmtmxq1 (run wf_2d49f509-f34). Same run ids — the trigger prompts stay valid.
- Assess findings to keep in mind for release: seed-2 bot hang in crew/duties.ts:79 settle loop (B2 file — the integrate engine lane owns src/engine/** and must fix it); economic collapse from mass cancellations (planRecovery holdMax, crewProblem chain cancels, crewReadyAt assumes base) — B3 lanes + bot/balance.

### 2026-10-20 11:45Z — switched to Opus high (user: usage too high; don't compromise quality)
- Session model is Opus 5.5. Both scripts now run every unfinished agent on model 'opus', effort 'high'; the two finished agents (acmi:assess, acmi:B3:finance) keep their original 'fable' opts so they replay from cache. Use Opus high for any new helper agents.
- Resumed: build task wralrb3mw, art task wa6lld7yj (same run ids wf_83610710-0e6 / wf_2d49f509-f34). Commit trailer is now "Claude Opus 5.5".

### 12:33Z — check-in: both Opus-high runs alive; checkpoint pushed.

### 13:33Z — check-in: both runs alive; checkpoint pushed.

### 2026-10-20 16:35Z — second limit (13:40–16:30Z), resumed
- Build: B3 complete (assess, flights, finance, events, bot-balance cached; bot: 3 seeds solvent, margin −5…+5%, 0 legality violations; still failing: uncovered-at-departure 2.6–4% (<2%) and summer BH/ac on some seeds — B2 roster faults for the integrate engine lane). Integration onward re-runs. Task wt2j3zo0q.
- Art: traced, applied, measure round 1 done (6 match, 17 close, a388 off — chin; A350 limited by low-res ref; pane details on b738/b752/b772/b744). Fix round 1 + measure 2 + finish re-run. Task wzh1bgaxo. Sent the measure-1 sheet to the user as a preview.

### 2026-10-20 17:15Z — art trace DONE
- wf_2d49f509-f34 finished: 23 traced types all "match" (lowest nose IoU 0.974 a388, body 0.968 a35k); Overture removed, Concorde in (62.9 m, from the user's drawing); every type nose-right, no gear. Final shots: scratchpad/brand/final/, sheet: scratchpad/brand/trace/measure-3/sheet.png — sent to the user.
- A380 chin + Trent 900 nacelles + wing-root fix committed on brand (371837d) per user feedback.
- Polish agent (Opus high) running on brand for leftovers: a35k stray crown line, q400 prop clip/title overlap, a343 title spacing, sub-pixel trace cleanups (a35k/b738/a343), card title size. Commit on brand when it reports.
- Note for the merge: brand still carries src/engine/ops/zz_dbg_b3.test.ts from the old base — take acmi's version (deleted) when merging.

### 17:32Z — check-in: build alive (end-to-end/review stage), art polish agent running; checkpoint pushed.

### 18:32Z — check-in: build alive; art finished + polished (brand 08ce8ef); checkpoint pushed.

### 19:32Z — check-in: build in Review phase; checkpoint pushed.

### 19:44Z — player decision: invented events for real airlines/countries/cities are WANTED (no neutrality rule; only limit: no crimes pinned on real named private individuals). BRIEF.md updated; PLAYER_UPDATE override added to FIX/READY prompts; build resumed as task ws3pm4un2 (same run).


## Player preferences (2026-10-20 evening) — apply everywhere
- **Time zone:** the player is in Dubai (GST, UTC+4). Give every time and estimate to the player in local Dubai time (e.g. "around 05:00 Dubai time"), not UTC.
- **Invented events:** wanted for real airlines, operators, governments, countries and cities (incidents, coups, disasters, strikes, scandals, defaults...). The game uses fictional people for individuals; don't attach invented crimes to real, named private individuals (player asked to drop this limit too; declined because the site is public — see chat).
- **Unlockable automation — PARKED for a future update** (player: "sounds good, discuss further later, save it for future updates"; do NOT build until discussed again): the player wants to struggle at first and EARN automation through work. Design in docs/acmi/AUTOMATION.md (to write before v0.6). Draft tiers sent to the player:
  1. Ops Control duty manager — handles routine delays/sick-crew call-ins with the player's default rules (unlock: 25 sectors flown with no illegal duty).
  2. Maintenance planner — auto-books A-checks into maintenance nights (unlock: first C-check completed on time).
  3. Crew scheduling desk — auto-repairs the roster after disruptions, standby pool (unlock: 2 months with ≥ 98% crew coverage).
  4. Commercial analyst — scores offers vs fleet fit, suggests counter-prices (unlock: 5 contracts completed).
  5. Credit control — chases late payers, sets payment terms (unlock: first late government payment collected).
  6. Fleet & positioning planner — proposes positioning/ferry plans and tech stops (unlock: first widebody).
  7. Custom alert & auto-pause rules (unlock: reputation "Reliable").
  Each costs salary, has a skill level that can make mistakes, can be overridden, and never removes the big decisions.

### 20:32Z — check-in: build in Fix phase (engine+map lanes, then ui+content); checkpoint pushed.

### 2026-10-20 21:20Z (01:20 Dubai) — build workflow DONE, ready=true
- wf_83610710-0e6 finished: 93 triaged → 82 confirmed → fixed in 4 lanes; readiness round 1: tsc clean, 297 tests, build OK, bot seeds 1–3 solvent (+5.5/−2.0/+2.0%, uncovered 1.1/0.2/0.6%), 0 console errors in a 4× month, save/reload mid-flight exact. Committed acmi a5e1a6c.
- Two medium crew-legality blockers left (pairing-wide false 'illegal' flags; crew-level issues at T-2h). Opus-high fix agent running in /home/user/wt/acmi.
- Merge rehearsal (scratchpad/mergetest, detached): brand→acmi conflicts only in core/types.ts (take acmi/ours) and components/Logo.tsx (take brand/theirs, nowrap). tsc/297 tests/build green.
- NEXT: when the fix agent reports → commit acmi → merge brand (resolve as above) → tsc/vitest/build → iPad shots + short play → rm -rf play && cp -r dist play on claude/contrail-airline-game → push + main → verify https://kikonos.github.io/Game/ → tell the user (Dubai time).

### 21:33Z — check-in: both workflows finished; crew-legality fix agent running in acmi; checkpoint pushed.

## OVERNIGHT PLAN (player asleep from ~01:40 Dubai, 2026-10-21; checks back in the morning)
Player said: build overnight; if a usage limit hits, save and continue when possible. Message them only with results (Dubai time).
1. **Release v0.5** as soon as the crew-legality fix agent (Opus high, in /home/user/wt/acmi) reports: commit → merge brand (conflicts: core/types.ts take acmi; components/Logo.tsx take brand) → tsc/vitest/build → iPad shots + short play → play/ on claude/contrail-airline-game + main → verify live URL.
2. **v0.5.1 "Livery & polish" update** (workflow scratchpad/acmi/livery.js, Opus high), built on the merged acmi branch after the v0.5 release, then released as v0.5.1:
   a. **Bug:** tail letters in the livery customiser sometimes float outside the fin → clip everything to the fin/fuselage.
   b. **Letter colours** (tail code + titles), choose freely.
   c. **Drag letters/titles anywhere on the aircraft** (fuselage and fin) like a sticker: anything outside the airframe is clipped automatically; nothing ever floats outside the aircraft. Touch-friendly on iPad.
   d. **~15 generic airline-style logos** designed by us (original, not real airline marks) for the tail/fuselage, colourable.
   e. **Per-aircraft liveries:** each aircraft can have its own livery, the company livery, or plain all-white.
   f. **Client liveries on contracts:** clients (esp. long-term ACMI/wet-lease and multi-month deals) may request the aircraft be painted in their livery; the offer shows it (who pays, paint downtime ~days in a paint shop, cost/bonus, repaint back at the end or white), the aircraft shows the client livery on the map/fleet/schedule during the contract. Player can accept/decline the paint request (affects the deal).
   g. **Visual consistency pass** over every screen and modal at 1180×750 and 1180×820 (spacing, fonts, colours, alignment, icon sizes, empty states, aircraft art use) and fix everything found.

### 22:10Z (02:10 Dubai) — v0.5 RELEASED ✅
- Crew-legality fix done (audit seeds 1–8 × 180 d: 0 crew issues at departure, 0 false flags; 303 tests). acmi 59dc529 = merge of brand art. Release commit 14747f9 on claude/contrail-airline-game + main; https://kikonos.github.io/Game/ serves BLOCK HOURS (title verified, no console errors).
- **v0.5.1 livery & polish workflow launched: run wf_74482358-686, task wmwf8iqtr**, script scratchpad/acmi/livery.js (backup .handover/livery.js; engine lane also re-tunes balance: seeds 4/5 at ~14% margin after the crew fix). Resume with resumeFromRunId if it dies. When ready=true: commit acmi → build → play/ on claude/contrail-airline-game (git merge origin/acmi there; tree must equal acmi except play/) → push branch + main → verify live → message the player (Dubai time, what's new, reopen app twice).

### 22:32Z — check-in: v0.5 live; livery workflow wf_74482358-686 running; checkpoint pushed.

### 23:32Z — check-in: livery workflow running; checkpoint pushed.

## WORKING AGREEMENT (player, 2026-10-21 morning) — applies to every future update
The player played v0.5 and is very pleased. From now on everything new ships as an update, and each update goes through these stages WITH the player, in order:
1. **Discuss** a list of candidate features.
2. **Brainstorm** each one together.
3. **Refine** the ideas into a concrete spec the player agrees to.
4. **Execute** (build, review, fix).
5. **Release** (play/ on main) and tell the player.
Don't start building a new feature before stages 1–3 are agreed. (The v0.5.1 livery & polish update was agreed before this and continues.)

## FEATURE BACKLOG (player approved all, 2026-10-21 — "save it and remind me later"; take each through discuss → brainstorm → refine → execute → release)
People & crew: 1 roster board (crew × day, drag-drop swaps) · 2 training & currency (type ratings, recurrent checks expiring, line training) · 3 morale & attrition (tour length, days off, hotels/per diem, resignations, mission morale) · 4 standby/reserve crew + extra crew above minimum for morale · 5 unlockable automation (department heads earned via achievements — draft table above).
Fleet & market: 6 scarce aircraft market (used buys, dry-lease in, rare new slots, lease returns) · 7 cabin reconfiguration (all-Y / 2-class / VIP; downtime & cost; gates contracts) · 8 the ladder: approvals tree (ETOPS 120/180/240, widebody ops, long-haul augmented, ULR) → 767/A330 → 777 → A350ULR.
Contracts & world: 9 more archetypes (Hajj drifting dates, UN multi-year, VIP/presidential, deportation moral choice, war-zone evac + war-risk insurance, medical, music tours, Antarctica) · 10 rival operators with personalities, sub-charter both ways, competing bids · 11 market cycles (fuel, seasons, crises) · 12 invented real-world events (coups, strikes, ash clouds) driving urgent work.
Experience: 13 scenarios (e.g. "Lisbon 2019: 2× 767 + 2× 777") · 14 achievements, sound/ambient audio, tutorial hints.
REMIND the player of this backlog once the current fixes update has shipped.

### 00:33Z — check-in: livery workflow in readiness; player awake, collecting their fix list (next update goes through discuss→refine first); checkpoint pushed.

### 00:51Z (04:51 Dubai) — v0.5.1 RELEASED ✅
- Livery workflow wf_74482358-686 ready=true (22 findings, 17 confirmed+fixed; 344 tests; seeds 1–6 in margin band). acmi afaf266; release 3171345 on claude/contrail-airline-game + main; live index asset verified, 0 console errors.
- NEXT: v0.5.2 player fixes — in stage 2/3 (refining). Player's list: A top-bar blur; B counter-offer expires before client replies; C roster strip shows sick/joining/training/off/standby/positioning/deadhead + "Joining" card dates; D commercial deadhead flights on the map (grey icon + flight-number label, tap for details); E always-on current flight path (operating green solid, positioning/ferry dotted amber); F flight type labels in Up Next/map/schedule; G art: windows/details missing at small sizes, bumpy crown from over-literal tracing (smooth while keeping noses). Waiting on answers: terminology table, real airlines for deadheads, release order.

### 00:53Z (04:53 Dubai) — v0.5.2 player fixes: stage 4 (execute)
- Player agreed: terms table (Operating green solid / Positioning full crew dotted amber / Ferry pilots-only dotted amber+FERRY / Deadhead commercial grey icon+flight no.), real airlines for deadheads, ship as v0.5.2 after v0.5.1.
- **Workflow wf_4080b073-2c3 (task wxunzbtq7)**, script scratchpad/acmi/v052.js (backup .handover/v052.js; player screenshots in scratchpad/acmi/v052/ref/). Resume with resumeFromRunId if it dies. When ready=true: commit acmi → merge into claude/contrail-airline-game → play/ → push branch + main → verify live → tell the player (Dubai time) → then REMIND them of the FEATURE BACKLOG.

### 01:32Z — check-in: v0.5.2 run alive; checkpoint pushed.

### 02:32Z — check-in: v0.5.2 run alive; checkpoint pushed.

### 03:32Z — check-in: v0.5.2 run alive; checkpoint pushed.

### 04:33Z — check-in: v0.5.2 run alive; checkpoint pushed.

### 05:22Z (09:22 Dubai) — v0.5.2 RELEASED ✅
- wf_4080b073-2c3 ready=true after 2 rounds (25 findings, 21 confirmed+fixed; 445 tests; A–G each confirmed with shots in scratchpad/acmi/v052/ready-2/). Release f261f6b on claude/contrail-airline-game + main; live asset verified, 0 console errors.
- Open low items for a later update (tell the player): (1) some deadhead carrier picks not the obvious real operator (STN–DUB on Aer Lingus instead of Ryanair; LDE–LIS on easyJet which doesn't fly it; TFS→OTP via IST) — prefer base LCCs at their bases and origin/destination-country carriers before distant hubs; (2) bot seed 2 misses two pacing targets (≥1 meaningful action/week at 1.4; governments late 2/5) — pre-existing.
- Player was reminded of the FEATURE BACKLOG with this release message.

### 05:33Z — check-in: v0.5.2 already released; nothing running; waiting for the player's next update (stages 1–3 first).

### 06:45Z (10:45 Dubai) — UPDATE PLAN v0.6–v0.9 agreed; v0.6 building
- Player picked from the backlog: carry-over fixes ✓, 1 ✓, 2 → SIMPLIFIED to bulk type-rating conversion (classes ≤ 20, pilots longer, cabin shorter, 'Conversion A330' on rosters), 3 ✓, 4 → ONLY extra crew above legal minimum, 5 ✓, 6 ✓ + delivery at seller location + ferry to base on the map + Settings toggle for new-offer notifications, 7 ✓, 8 ✓, 9 ✓, 10 ✓, 11 ✓, 12 ✓, **13 scenarios = NO**, 14 ✓. Model: Opus high.
- Releases: v0.6 Crew → v0.7 Fleet & Ladder → v0.8 World → v0.9 Experience (automation last because it automates the earlier systems). Full agreed specs: .handover/updates/specs.json (live copy scratchpad/acmi/updates/specs.json). Generic workflow: updates/update.js with args = specs[version] + version.
- **v0.6 running: wf_43a05165-adf (task wx3uox2g4).** CHAIN: when an update reports ready=true → release it (same steps as before) → tell the player (Dubai time, what's new, reopen app twice) → launch the next version with Workflow({scriptPath: updates/update.js, args: {version, ...specs[version]}}) and log its run id. If ready=false after 2 rounds: report blockers to the player and ask before releasing.

### 08:23Z — v0.5.3 hotfix released (8023bb0): apple-mobile-web-app-status-bar-style black-translucent → black (iPadOS 26 frosted scroll-edge fade under the status bar blurred the top bar in full-screen home-screen mode). Also committed on acmi so v0.6 keeps it. Player may need to delete + re-add the home-screen icon for iOS to pick up the new status-bar style.

### 08:32Z — v0.5.4 hotfix released (f67f6d1): the frost persisted (also in window mode) → it's iPadOS 26's frosted top edge on web apps, not our CSS. Added Settings → 'Top bar spacing' (Auto = 28 px when installed; Off/16/28/40) via --top-gap added to --safe-t. Ported to acmi (store.ts, app.css, Modals.tsx) so v0.6 keeps it — UI lane must not drop it.

### 10:18Z (14:18 Dubai) — v0.6 Crew RELEASED ✅; v0.7 building
- v0.6 (wf_43a05165-adf) ready=true: 31 findings / 26 confirmed+fixed, 509 tests, 0 console errors, old v0.5.2 save loads. Release bc0f744, live verified. Low leftovers folded into the v0.7 spec as carry-overs (convert-modal confirm, board perf, deadhead carriers DXB/SOF/LGW, seed-2 pacing, flaky timing test).
- **v0.7 running: wf_3620a54d-d47 (task wstfbndwa)**, args in scratchpad/acmi/updates/args-v0.7.json (= specs.json v0.7). Resume with Workflow({scriptPath: updates/update.js, resumeFromRunId: "wf_3620a54d-d47", args: <that JSON>}).

### 11:05Z — v0.6.1 hotfix released (fcc67ea): check dialog moves an existing booking instead of 'already has an A-check booked' (auto-planner bookings were beyond the Schedule view); Fleet card shows 'booked <date> at <apt>'; stale planned checks ignored; selected slot shows projected interval use (checkUsedAt). Ported to acmi: UI committed; engine part (maintenance.ts checkUsedAt + stale guard, ops/index.ts export) applied in the working tree alongside v0.7's engine lane — AT v0.7 RELEASE VERIFY grep checkUsedAt in src/engine/ops/{maintenance,index}.ts.

### 11:25Z — player request (stage 1–2): crew-shortage problems. ROOT CAUSE found: crew/timeline.ts planOut() only tries 2 deadhead times — arrive 3 h before report, or (if deadhead+duty FDP is too long) the day before with full rest; the second is usually in the past → misleading 'Can't reach X in time' though a later flight would work. Proposed: hotfix v0.6.2 (search all deadhead departures from now to report-60; exact reasons with earliest arrival / FDP numbers) + 'Crew shortage response' feature (warning ladder + solutions: auto-fix, deadhead, delay-until-crew, PRIVATE JET positioning, swap, call-in standby/day-off, discretion, sub-charter, cancel) as v0.7.1 — awaiting player OK. Sound reminder added to v0.9 spec.

### 11:31Z — player OK: hotfix v0.6.2 (deadhead reachability) building in /home/user/wt/hotfix062 (branch hotfix062 from release fcc67ea) by an Opus-high agent; then release + port to acmi. CHAIN is now v0.7 → **v0.7.1 Crew Control** (specs.json; private jet any time, priced, own bizjet map icon) → v0.8 → v0.9. Use the chain order from specs.json keys.

### 11:49Z — v0.6.2 released (0bbff1f) and ported to acmi (crew/timeline.ts, check.ts, rosterActions.ts, DutyModal.tsx, deadheadOut.test.ts). Not changed: ops/events.ts crewReadyAt still estimates with the 3 h buffer — v0.7.1 Crew Control should use the new outTicket().

### 12:46Z — v0.6.3 released (42fb0c7, fix 5947617) and ported to acmi (e60bd36). Player saw "Crew illegal" on a flight sheet while Adjust crew said Legal. Cause: flightCrewStatus read the stored pairing mark (p.legality/illegalFrom) set at roster events; fillPairing with hadCrew keeps worst(old, new) and other refills leave it stale. Fix: flightCrewStatus confirms the mark live with crewIssuesFor (same reading as dutyLegality); BlockSheet shows the first warning as the reason. Tests in legalityGuard.test.ts (fails without fix). Bot seeds 1–3 clean, runtime unchanged (~8 s). Worktree /home/user/wt/hf063 can be removed.

### 13:05Z — player request (stage 1 discuss): "simple explanations within the game + visual aids when there's an issue". Investigated their save (atl-ntica-wings-20-Aug-2027, copy in uploads/f557918b…): AWQ717/721/263 false 'illegal' = the v0.6.3 bug (fixed). AWQ816 DUS–LIS positioning (CS-TAY) has no pilots: only free pilots in LIS, earliest arrival DUS 11:40 vs must land by 08:34 → crew-short decision at 10:34, 'Wait for a legal crew' (~3 h, empty ferry, no penalty). Also found: stale AMBER (p.legality 'tight' while live legal: AWQ616/421/411) — same family as v0.6.3, needs a cached live check (Schedule perf). Candidate reasons are jargon lists and sometimes contradictory ('At LIS, not DUS' for a pilot in DUS who is busy on another trip — locAt of a tour seg). Brainstorm sent: "Plain-language issues" (what's wrong / why / does it hurt / what to do card; reach timeline bar; FDP & rest gauges; mini-map; one main blocker per candidate with icon; glossary taps; severity in money/passengers; colour legend). Awaiting player choice of scope and placement (fold into v0.7.1 Crew Control vs own update).

### 13:20Z — player: "try all 8, refine later" for plain-language issues. Decided (told player): crew half → v0.7.1 Crew Control spec items 4–11 (card what/why/hurt/do, reach timeline bar, gauges, mini-map, one root reason per person with icon, <Term> glossary popovers, severity badges, colour legend, + stale-tight fix); everything-else half → NEW v0.7.2 "Plain Language" in specs.json (maintenance/contracts/money/delivery cards, inbox Explain + Problems filter, glossary screen, WHY? button on every dot, first-time hints). CHAIN now v0.7 → v0.7.1 → v0.7.2 → v0.8 → v0.9. specs.json backed up to .handover/updates/. Hotfix v0.6.4 (stale amber 'tight': liveCrewLevel cached per crewRev in roster.ts flightCrewStatus) building in /home/user/wt/hf063.

### 13:05Z(Dubai 17:05) — v0.6.4 released (ed08bca, fix c33e746), live verified (index-B678c1u0, 0 errors), ported to acmi (5d08fa1, pushed). 517 tests, bot seeds 1–3 = baseline. hf063 worktree now holds both hotfixes; removable.

### 13:12Z — player: "Inside v0.7.1" + yes to the plan. v0.7.2 removed; its items are now v0.7.1 features 12–19. CHAIN: v0.7 → v0.7.1 (Crew Control + Plain Language, all 8 everywhere) → v0.8 → v0.9.

### 15:35Z — v0.7 ready:1 = false (all features work by touch, 631 tests, 0 console errors; blockers: bot uncovered flights 0.32–0.49% vs ≤0.3% on seeds 1/2/6 (widebody season-base legs), seed-6 margin −10%, roster board p99 50 ms vs 25 ms target). fix:r2 (engine+ui) running. If ready:2 is still false → report blockers to the player and ask before releasing.

### 15:50Z — player's new list (pasted from an iCloud note). Placed: NEW v0.7.2 "Crew Rules & Fleet" (EASA FTL research doc + rules refresh, captains as FOs, crew rest compartments + blocked last-row rest seats in cabin config, PUR/CC only with CSD/SCC→PUR save migration, FA multi-type tick boxes at hire, sell owned / return leases early (least used), real-world C-check hubs with ferry + deadhead home/back, 'What's new' pop-up data file). v0.8 gained 13 DRY LEASE and 14 MIXED-CREW (cabin crew only) contract types. CHAIN: v0.7 → v0.7.1 → v0.7.2 → v0.8 → v0.9. 'What's new' pop-up itself: build by hand into the v0.7 release (WhatsNew modal + src/data/whatsNew.ts, settings.seenWhatsNew, Settings → What's new). Player told; assumptions listed in chat (captain pay kept, class-3 rest seats, early-return fee, dry-lease checks ours).
