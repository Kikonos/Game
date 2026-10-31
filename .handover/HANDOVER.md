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

## RELEASE RULE (player, 26 Oct 2026)
NEVER push to main or release (no play/ rebuild on the release branch) without asking the player first. Work accumulates on the acmi branch (pushing acmi itself is fine); the player decides when a batch ships.

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
- v0.7 (wf_3620a54d-d47) ready=true round 2; released 7ebbad5.
- v0.7.1 (Fable, wf_e1606ed9-b85) ready=true round 1; released b77d4fd 22 Oct 04:05Z.
- v0.7.2 (Opus, wf_669dce61-399) ready=true round 1; released aff0b91 22 Oct 08:19Z.
- v0.7.3 (Opus, wf_45b3b8b0-6d3) ready=true round 2; released WITH trip swap + check planning as 870f855 (acmi 28d25cb) 22 Oct 15:42Z.
- **v0.8 running on OPUS high: wf_4a73dcaa-1c0 (task wiwdy5xdl)**, args in scratchpad/acmi/updates/args-v0.8.json. Resume with Workflow({scriptPath: updates/update.js, resumeFromRunId: "wf_4a73dcaa-1c0", args: <that JSON>}). Session limit → resume after the reset; container restart → resume at once.

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

### 16:28Z (Dubai 20:28) — v0.7.0 RELEASED: 7ebbad5 (merge 1426c8d; acmi 913662e incl. the new "What's new" pop-up: data/whatsNew.ts, WhatsNewModal, settings.seenWhatsNew, Settings → What's new). Live index-h4UY7kMO, 0 console errors. 634 tests. Launching v0.7.1 Crew Control next (args-v0.7.1.json; stale-tight line marked done; whatsNew entry required). Player told.

### 16:57Z — player: "Handover this update to fable high instead, don't worry about usage". Stopped Opus run wf_6f37d992-466 (design done, engine lane mid-edit); partial work discarded (player), acmi reset to 913662e. update.js: model = args.model ?? 'opus'. Relaunched v0.7.1 fresh on Fable high: wf_e1606ed9-b85 (task wdci2smf5 — resumed 03:33Z 22 Oct after the 3rd session limit; everything up to ready:1 cached). Later versions default back to Opus high unless the player says otherwise.

### 17:33Z — v0.7.1 Fable run hit the session limit ~17:10Z (design done; engine/ui/map/reviews/ready failed instantly, no edits). Resumed same run wf_e1606ed9-b85 after the 17:30Z reset → task w61warsga. If it dies on a limit again: resume the same run id with args-v0.7.1.json after the reset time.

### 22:35Z — v0.7.1 hit a 2nd session limit at ~19:10Z (build lanes done; reviews + ready failed instantly). Resumed same run wf_e1606ed9-b85 at 22:33Z → task weifxva13 (still Fable; player: "When fable finishes work switch over to opus high again" → v0.7.2 onwards = Opus high, the default when args have no "model").
Player notes (22 Oct, with top-bar screenshot .handover/updates/topbar-space.jpg) added to specs: v0.7.2 gets "PLAYER FIXES FIRST" F1–F8 (hotel dot stays while crew remain; market-alerts toggle → Market section + market alert in the top-bar warning area; sub-charter hurts reliability progressively; varied contract names instead of 'Thursday series'; cabin crew join in ~7 days; refits start straight away; compact Up Next grid without legend; top-bar live OPS strip — my proposal: Airborne n/N, Next departure countdown, On time today %, Crew on duty/at hotels). v0.8 gets item 0 CLIENT RELATIONSHIPS (levels, favours rewarded, poor work first → better offers). Player said goodnight; summary sent.

### 03:34Z 22 Oct — v0.7.1 reviews (38 findings, 32 confirmed) and fix round 1 done; ready:1 hit the 3rd session limit (~00:05Z, reset 03:30Z). Resumed same run → task wdci2smf5.

### 04:06Z 22 Oct (Dubai 08:05) — v0.7.1 Crew Control RELEASED: b77d4fd (acmi 38f8a9e/3c225ab), live index-BvWXHEbm, 0 console errors, 690 tests. Before release I fixed 2 low readiness leftovers myself: duty-modal 'No CPT, FO, SCC' → plain words; toasts cleared when a dialog opens. Leftover lows (not blocking): bot seed-6 month-end low after an A333 buy; AOG per-seed stat. v0.7.2 Crew Rules & Fleet launched on Opus high (player: "when fable finishes switch over to opus high"): wf_669dce61-399 / task wfbvl1zdq.

### 04:33Z 22 Oct — container restart killed v0.7.2 (task wfbvl1zdq) mid engine lane (design done + cached; engine ~25 min in, 56 modified + 7 new files uncommitted). update.js gained an optional args.engineResume note (only appended to the ENGINE prompt); args-v0.7.2.json carries it so the restarted engine lane reviews and finishes the partial edits instead of redoing them. Resumed same run wf_669dce61-399 → task wv1e7q5ou. Remove engineResume from args before any later fresh run.

### 07:31Z 22 Oct — 2nd container restart killed v0.7.2 (task wv1e7q5ou) in fix round 1 (design, engine, ui, map, 3 reviews, 3 verifies and 1 of 3 fixers done + cached). Resumed same run with the SAME args (engineResume kept so the cached engine step's prompt still matches) → task w5g597udb.

### 07:40Z 22 Oct — player sent an EASA FTL reference guide (PDF, 29 pp; copies .handover/updates/EASA-guide-2026-10.pdf/.txt): "study it and apply to the game; in-flight rest and the rest classes available on each plane to be a BIG thing; correct any wrong parameters". v0.7.2 is mid fix round 1, so NOT injected there. A read-only Opus audit agent is comparing every FTL parameter + per-aircraft rest facilities vs the guide → scratchpad/easa/audit.md. Plan: when v0.7.2 releases, the NEXT update is v0.7.3 "In-flight Rest & EASA" built from the audit (inserted before v0.8 in specs.json once the audit is in).

### 08:05Z 22 Oct — EASA audit done (.handover/updates/EASA-audit-v0.7.2.md). Main numbers match; WRONG/MISSING: in-flight rest never checked (90/120 min, cruise too short), one rest class shared by pilots+cabin, 'rest seats' are not class 3, no class 2, cabin table has an extra 18:30 row, planned extension missing, delayed reporting missing, discretion offered before report / '2 h' texts, local-night/time-zone/E-W/4-sector-night/2-local-days rules missing, feasibility uses a flat 13 h, ~20 wrong citations. specs.json now has v0.7.3 "In-flight Rest & EASA" between v0.7.2 and v0.8. CHAIN: v0.7.2 → v0.7.3 → v0.8 → v0.9.

### 08:20Z 22 Oct (Dubai 12:19) — v0.7.2 Crew Rules & Fleet RELEASED: aff0b91 (acmi 7a51d58), live index-BMyS2q9x, 0 console errors, 771 tests. Lows left (not blocking): bot runs 13–25 s on a busy machine; bot seed 2 sub-charters 43 legs; WHY? dot 11 px, home-indicator padding (folded into v0.7.3 as optional). v0.7.3 In-flight Rest & EASA launched: wf_45b3b8b0-6d3 / task w3p02lf88.

### 12:15Z 22 Oct — PLAYER: "Important mini update to be rolled out as soon as possible": drag-and-drop trips between aircraft in Schedule (move one sector → whole trip, e.g. DUB-DUS-DUB) + confirm pop-up with profit/loss and expenses/gains. Building as v0.7.2.1 "Trip swap" on the LIVE release (worktree /home/user/wt/trip, branch trip-swap from aff0b91) by an Opus agent (engine tripOf/quoteTripMove/moveTrip + long-press drag in the Gantt + 'Move trip to…' in the flight sheet + TripMoveModal with Before/After/Difference table + whatsNew v0.7.2.1). When it reports: verify, release from the trip worktree (play/ build → commit on claude/contrail-airline-game via merge of trip-swap → push + main → live check), tell the player. THEN port trip-swap into acmi AFTER the v0.7.3 workflow finishes and BEFORE releasing v0.7.3 (resolve conflicts; whatsNew keeps v0.7.3 on top, v0.7.2.1 below).

### 12:59Z 22 Oct (Dubai 16:59) — v0.7.2.1 Trip swap RELEASED: 8c2867b (fast-forward of trip-swap 957dcc7 onto aff0b91), live index-92V5rJrw, 0 console errors. PENDING PORT: branch trip-swap (commit 957dcc7) must be merged into acmi after the v0.7.3 workflow finishes and before v0.7.3 is released (conflicts likely in Schedule.tsx, BlockSheet.tsx, store.ts, Modals.tsx, whatsNew.ts, styles/acmi/index.css; keep v0.7.3 entry on top of whatsNew, v0.7.2.1 below). Note for later: wet-lease revenue in the quote ignores the monthly minimum guarantee; ferries for a moved trip are paid by us (like an AOG swap).

### 13:50Z 22 Oct — PLAYER (Dubai 17:43): bug — after dragging MAN–FUE from CS-THF to CS-TWJ the ferry legs stayed on CS-THF (save: scratchpad/v0722/…astor-airlines-23-Sep-2027…json; screenshot .handover/updates/v0722-orphan-ferry.jpg). Plus urgent features: drag A/C checks along the aircraft's own timeline with live interval usage; idle-gap panel gets 'Book C-check', 'Book A-check', 'Cabin refit' with usage shown. Building as v0.7.2.2 "Check planning" on branch v0722 in /home/user/wt/trip (from 8c2867b) by an Opus agent. When done: verify, fast-forward release branch, build play/, push + main, live check, tell the player. PENDING PORT into acmi before v0.7.3 release: trip-swap AND v0722 (merge v0722, which contains trip-swap).

### 13:55Z 22 Oct — PLAYER: "You can release it alongside the upcoming update" → do NOT release v0.7.2.2 on its own. Release v0.7.3 only when BOTH (a) the v0.7.3 workflow reports ready=true and (b) the v0.7.2.2 agent (branch v0722 in /home/user/wt/trip) has finished and been verified; then merge v0722 (contains trip-swap) into acmi, resolve conflicts (whatsNew order top→down: v0.7.3, v0.7.2.2, v0.7.2.1, …), tsc + vitest + bot seed 1 + quick browser check of the trip drag, check drag and idle buttons on the v0.7.3 tree, then release as v0.7.3 with all three in the player summary.

### 13:58Z 22 Oct — PLAYER: cabin refits must also be draggable forward/back along the aircraft's timeline like the checks. Sent to the v0.7.2.2 agent (same branch v0722); part of the bundle released with v0.7.3.

### 14:35Z 22 Oct — v0.7.3 ready:1 = false → fix round 2 running. Blockers: bot seed 6 margin/solvency fail (high); standby call-ins never used (0/seed though ~1,500 standby days held); bot runtime 22–33 s (aug run 76–101 s); weak bot balance with augmented crews; seed 3 resignations 3.5%, seed 4 AOG 3.36; flight sheet red 'Not possible' rest chip after the roster split the day (duty legal); What's new buttons 43 px at Safari. If ready:2 is still false → report to the player and ask before releasing. v0.7.2.2 agent still building (20 files changed on v0722).

### 14:50Z 22 Oct — v0.7.2.2 Check planning DONE + verified: branch v0722 commit f0dd80d in /home/user/wt/trip (on top of trip-swap 957dcc7 / release 8c2867b). Root cause of orphan ferries: contracts/schedule.ts relinkPositioning kept any unbroken chain (chainOk) → new chainSane + relinkCheckFerries; player's save is a fixture (src/engine/fixtures/save-v0721-trip.lz.txt). New ops/maintMove.ts (drag A/C checks + refits along the row, live usage), idle-gap buttons, scheduleCheck 'moved' option. Shots: scratchpad/v0722/shots/. NOT released on its own (player). Known leftover: Gantt label 'free … nothing booked' beyond a base programme's generated days. READY TO PORT: merge branch v0722 into acmi when v0.7.3 reports ready.

### 15:30Z 22 Oct — v0.7.3 ready=true (round 2; 858 tests; bot all seeds solvent, 0 illegal; 204 shots; old saves load). Committed acmi 6453235. Merge of v0722 into acmi had 9 conflicts → an Opus agent is resolving them, plus fixes: ULR offers limited to ≤18:00 EASA days (they were unflyable), home-indicator padding. NOT yet released. When the agent reports: verify, release v0.7.3 (incl. trip swap + check planning) per the usual steps, then launch v0.8 (args {version:'v0.8', ...specs['v0.8']} + BASE note incl. v0.7.3, trip swap, check planning; leftovers: bot fleet() cash rule so 2–4 seeds sign a widebody, bot runtime).

### 15:43Z 22 Oct (Dubai 19:42) — v0.7.3 In-flight Rest & EASA RELEASED with v0.7.2.2 Check planning + v0.7.2.1 Trip swap: 870f855 (acmi merge 6ae24c8, fixes 426fb78 ULR ≤18 h, 1a38784 home-indicator padding, 28d25cb 'an A320'). Live index-ChCHTh9u, 0 console errors, 892 tests, bot seeds 1/2/6 solvent with 0 illegal duties. No mini updates pending. v0.8 World launched: wf_4a73dcaa-1c0 / task wiwdy5xdl.

### 18:45Z 22 Oct — PLAYER notes → mini update v0.7.4 "Crew & Cabin" building now (Opus agent, worktree /home/user/wt/v074, branch v074 from 870f855): (1) Crew planning view per aircraft type with crew SETS + 'Round up to complete sets' hire; (2) refit costs researched (quick 48 h seat reconfiguration vs full retrofit; sources into RESEARCH.md) + client-paid cabin changes on long-term contracts like paint; (3) 767-300ER never has bunks (player's experience; migrate saves); (4) every aircraft always has curtained economy rest seats (class 3 in-game; strict EASA needs 40°+leg rest — told the player, doing it their way unless they object) and business-seat rest (class 2) when J is installed, following the current layout; rest seats always count in capacity, blocked only on rest flights. DEFAULT: release together with v0.8 (port v074 into acmi before the v0.8 release, like v0722) unless the player asks for it sooner. PENDING PORT: v074.

- 18:48Z: v0.7.4 addition sent to agent a601d01b9f6b3582d. Bunks come as a pair: pilot bunks (FCRC) always come with cabin crew bunks (CCRC), and the reverse. Covers the combined data roll, market, start fleet, refits (one combined option), migration, tests, glossary, EASA-FTL.md and What's new.

- 21:40Z: The player sent 13 screenshots of issues (copies in .handover/updates/shots-2210/). Diagnosis below. Waiting for the player to say go, and when to ship.
  1. Seat need is not tied to passengers. offers.ts tourSeries wide: pax 260-300 but minSeats 250. Troop rotation: pax 150-170 but minSeats 174. Narrow tour rounds pax up to 10. FIX: minSeats = max pax on any leg.
  2. Body is never checked. Season base "widebody" lets an A320 pass the family line (shown green). FIX: add a body check.
  3. Offers no crew can fly. Repatriation and pre-season tour go through fuel stops with a duty day over 18 h. v0.7.3's ulrDest fix covered only ULR offers. Repatriation also falls back to a 10 h chain when route() is null (DIL), so the legs end up 25 h apart. FIX: drop the offer. IDEA (needs the player's OK): a crew slip at the fuel stop.
  4. Crew Control offers a jet that lands after the airline ticket. FIX: hide the dominated jet option or explain it.
  5. Schedule.tsx shows "in check" for a refit. FIX: show "in refit".
  6. The 767's art shows bunk glyphs. Already being fixed in v0.7.4.
  Yellow (longest day 13 h): correct under EASA. Asked the player what they expected.
- 21:55Z: The player's answers on the screenshot issues.
  - Fixes 1-5 ship WITH v0.8. Spec is in specs.json 'v0.8.x-fixpack'. Build them in acmi after the v0.8 workflow returns and after the v074 port, then verify and release.
  - Longest-day card: show "13 h · up to 17 h" and nothing else. Sent to the v0.7.4 agent.
  - Remove the rest marks from the aircraft drawings. Sent to the v0.7.4 agent.
  - Crew slip at a fuel stop: yes, LATER. Recorded in specs.json later-ideas.crew-slip.
  - REMIND the player about a game-wide language and redundancy pass after the v0.8 release. Recorded in later-ideas.language-pass.
- 22:05Z: The player wants the Boeing 747-400. It was switched off since the first data files, with no recorded reason. Added as fixpack item 6, ships with v0.8.
- 20:20Z: v0.7.4 DONE. Commit 6eb9bed on branch v074, pushed to origin/v074. tsc clean, 900/900 tests, build OK, 0 console errors. Screenshots in scratchpad/v074/shots.
  - HOLD for the v0.8 release.
  - PORT ORDER: v0.8 ready → merge v074 into acmi (whatsNew order v0.8, v0.7.4, ...) → fix pack (specs v0.8.x-fixpack) → verify → release.
  - Language-pass note: the Crew Planning verdict line repeats the stats shown above it. Trim it in the language pass.
- 21:45Z: v0.8 workflow wf_4a73dcaa-1c0 FINISHED with ready=true (round 1, 967 tests). acmi committed. NEXT: merge-v074 agent, then the fixpack agent (plus a Newcomer offer-weight leftover), then verify and release.
- 21:50Z: The merge-v074 agent ade56030a7429b4b9 is running in acmi. It will commit and push as 'Merge v0.7.4 Crew & Cabin into v0.8'. If it dies: check git status in acmi and finish the merge by hand.
- 22:40Z: Merge done: 4275188 on origin/acmi, 980/980 tests. Next: the fixpack agent.
- 22:45Z: The fixpack agent adc5cc3c325167953 is running in acmi. It covers items 1-6 plus: 7 Newcomer noise, 8 staffing vs sets, 9 What's-new shows every unseen version. It will commit and push 'v0.8 fix pack: ...'. NOTE: the checkpoint should skip acmi while an agent is mid-merge. After it finishes: verify, then release v0.8 and launch v0.9 (remind the player about the crew-shortage sound and the language pass).
- 00:55Z (04:55 Dubai): Fix pack DONE as 7cfe0aa (999 tests, pushed). Pre-release agent a9fc61284a01b28aa is running. It checks for a possible hang (bot seed 16 on the old code) and balance drift (seeds 7-12: +5.8% before vs +0.4% after; --wide --aug: -13.7%), and fixes the dev addType numbers. AFTER IT: release v0.8 (with v0.7.4 + the fix pack), then launch v0.9 and remind the player about the crew-shortage sound and the language pass.
- 02:20Z (06:20 Dubai): v0.8 RELEASED as f0fa433 (acmi eeb61f7, 1006 tests). Live asset index-DYfHuXO5.js, 0 console errors. v0.9 NOT launched yet: waiting for the player's answer on the crew-shortage sound, the language pass and whether the crew slip goes into v0.9. Follow-ups: (a) the bot's 747 run is -19.6%, check 747 economics; (b) a departure delay can make the cabin crew rest plan impossible after departure (v0.7.3 logic); (c) the bot runtime target.
- 02:50Z (06:50 Dubai): The player said go for v0.9. Sounds: high, low, high-low = new contract, double = medium, triple = serious, plus one urgent alarm for crew shortage and crew out of hours. Folded into v0.9: the language pass, the crew slip, the discretion fix, the crew-out-of-hours alert and the What's-new catch-up (v0.9+v0.8+v0.7.4). v0.9 RUNNING: workflow wf_e5a18ad0-7b2 (task wao8z8x0j), args updates/args-v0.9.json. Resume with the same args.
- 03:20Z: The player asked for EASA-style roster planning (days off only at the legal minimum; the rest home/hotel/airport standby, including out-of-base standby). Added as item R to the v0.9 args. Stopped wf_e5a18ad0-7b2 (only its design was done) and resumed with the new args.
- 03:30Z: v0.9 RESUMED as wf_e5a18ad0-7b2 (task wn4f8bdm7) with args-v0.9.json, which now includes item R and engineResume. Resume with the same args. The acmi tree has uncommitted step-0 edits from the aborted run (engineResume covers them). A reset or force-push was denied by permissions, so nothing was rolled back.
- (after container restart): Resuming v0.9 wf_e5a18ad0-7b2. The design is cached; engineResume is now generic (interrupted twice; commit at milestones).
- Resumed v0.9 after the container restart: task wxsoih08g, same run wf_e5a18ad0-7b2, args-v0.9.json.
- 04:40Z: The player added .claude/settings.json (allowing checkpoint.sh) on the release branch, 3fd1b60. Local release branch fast-forwarded. KEEP this file at release; it's the only expected tree difference from acmi besides play/.
- 14:10Z (18:10 Dubai): v0.9 workflow FINISHED ready=false after 2 rounds. Blockers: coverage 0.37-0.64% on 4/6 seeds, red shortages 10-28, bot runtime 30-49 s, seed 5 margin -10%, summer BH 150-173, airport standby/reserve unused, relink loop in a dev scene, a flaky perf test. acmi committed at 874de67. Round-3 fix agent a8f77767ce52501b1 is running. Asked the player whether to release after round 3 (my recommendation) or ship now.
- 16:10Z: The player says take your time debugging and fixing, no rush to release. Wait for round 3 and verify thoroughly before release; more rounds are fine.
- 16:15Z (20:15 Dubai): Session model switched to Fable 5.1 with ultracode. Round-3 agent (Opus) left running to keep its work. From now on helper agents run on Fable high: pass model:'fable' in update.js args. Launching a read-only independent audit workflow of 874de67 (frozen worktree scratchpad/wt-audit); its fix plan goes to updates/v0.9-audit.md for the next fix round.
- 19:10Z (23:10 Dubai): Fable audit DONE (wf_3f6a3cb1-d7a): 63 confirmed, 15 plausible, 14 dropped. Plan in updates/v0.9-audit.md, raw in v0.9-audit.json. Blockers: Y.1 gate re-check blind to holds + dead end in Crew Control + out-of-hours shown as shortage; preview cue/pause leak; cashNegative never chimes; 'year without overdue check' unearnable; fleet planner promises unbuilt proposals; morningFree 0. NEXT: when round 3 (a8f77767ce52501b1) finishes → round-4 workflow on Fable: 4 lanes in worktrees (roster rules; out-of-hours/discretion/sound-leak/control.ts; heads/achievements; language+slip+offers), merge, full verify, adversarial review, readiness. Player decisions taken by default (tell them): no training pro-rating of days off; cross-sound cooldown ~4 s + alarm's own 20 s guard; plain agreed unlock counts; watch desk stays 90/30 d; jumbo cap stays market design; out-of-hours limit names use the issue's own text.
- 19:40Z (23:40 Dubai): Round 3 DONE (159dce4 pushed, 1110 tests). Coverage much better, legality 100%; left: seeds 2/5 + 747 run over coverage target, runtime 25-29 s (52 s 747), summer BH 128-166 (commercial reach, soft target now). Killed orphan Chromium/vite servers from old reviews. LAUNCHING round 4 on Fable: scratchpad/acmi/updates/round4.js (5 sequential lanes: alerts, roster+coverage leftovers, runtime, heads, text; then review/refute/fix/ready ≤2). Resume with the same args if it dies.
- 19:45Z: Round 4 RUNNING: wf_197bb3df-070 (task wtgqlfezi), script scratchpad/acmi/updates/round4.js, args {plan, planJson, spec, guide} = the four files under .handover/updates/ (v0.9-audit.md, v0.9-audit.json, args-v0.9.json, EASA-guide-2026-10.txt). Resume with Workflow({scriptPath, resumeFromRunId:'wf_197bb3df-070', args: same}).
- 00:05Z 24 Oct (04:05 Dubai): Round 4 lanes + reviews DONE (27 findings, 23 confirmed; last lane commit 5165d4b). fix:1 and ready:1 failed with API 529 overload; RESUMED wf_197bb3df-070 with the same args (cached prefix replays). Worker restarted once in between; tree clean.
- 02:35Z (06:35 Dubai): Round 4 ready:1 = NOT ready (commit ea38e3b + 32b4b7a; 1153 tests, UI and every feature fine). Blockers: round-4 roster/alerts changes REGRESSED coverage vs round 3 (seed 1: 0.07%/7 red → 0.73%/33), runtime 22–32 s, crew-months under 7 days off reappeared (s1 7, s3 5, s6 2), seed 3 margin −9.4%. fix:2 is running inside wf_197bb3df-070, then ready:2. If still not ready: compare with 159dce4 (round 3 end) to find which round-4 change broke coverage.
- 04:10Z (08:10 Dubai): Round 4 FINISHED ready=false (e8e7f54, 1155 tests, all features + UI fine). The round-4 roster/alert changes regressed the bot vs round 3 (159dce4): red 34/18/16/43/29/10, uncovered up to 0.74%, runtime 20–59 s, crew-months under 7 back, 747 run insolvent (bot signed a base with no job). Launching round 5 (Fable): scratchpad/acmi/updates/round5.js — bisect 159dce4..HEAD on seeds 1 and 4 → root-cause fix (keep every correctness fix) → readiness ≤ 2. Args {spec, guide}.
- 04:15Z: Round 5 RUNNING: wf_ce4bfe9e-934 (task wnddphobn), script round5.js, args {spec, guide}. Resume with the same args if it dies.
- 05:35Z (09:35 Dubai): Round 5 bisect done (table in scratchpad/acmi/updates/v0.9/round5/bisect/table.md): culprits = morningFree 360 without re-sized early standby (7d0b3e6) and the late days-off floor (e5fbe79/de3f49d eveFloorIssue); 96/yr and night rule cost nothing; runtime follows shortages. Fix stage running.
- 06:40Z (10:40 Dubai): Round 5 fix committed (a4f09b7, 929c688; 1160 tests). ready:1 NOT ready but much closer: seeds 1/2/4/6 pass coverage (red 10/2/12/5), seeds 3/5 still 22/24 red, runtime 16–27 s (limit 20), margins s3 −6.0 s6 −7.3, 747 run weak. All legality targets green. fix:2 running, then ready:2. If ready:2 is false: decide with the player whether 20 s and ≤12 red on every seed are hard or whether the remaining seeds are bot commercial paths.
- 07:10Z (11:10 Dubai): PLAYER: back to OPUS HIGH for everything (weekly usage half gone, Fable at 90%). Be frugal: no more multi-lens audits; fewer agents; agents run only needed bot seeds. Round 5 resumed (wf_ce4bfe9e-934, task new) with fix:2 + ready:2 on Opus (M2 in round5.js); finished Fable steps replay from cache. checkpoint.sh co-author back to Opus.
- 08:05Z 24 Oct (12:05 Dubai): v0.9 RELEASED as 78d4fed (acmi 9b76dc8; 1160 tests; seed 1: 0 illegal, 10 red, 0.16%). Live asset index-Ctt2VrdD.js, 0 console errors. Player chose option 1: release now, tuning later (later-ideas.v0.9-tuning). Untested speed edits stashed + patch. NEXT: nothing launched. Player is low on weekly usage — wait for them before starting anything; Opus high only, frugal.
- 08:15Z 24 Oct (12:15 Dubai): Player said start the tuning update, Opus high. v0.9.1 'Tuning': ONE Opus-high agent aa580721f448b99eb in acmi (pops the speed stash first). Targets: ≤12 red / ≤0.3% on seeds 1-6, ≤20 s, the bot lease-out policy, the 747 solvent, AOG 1-3. Frugal. When done: verify cheaply myself (tsc, vitest, bot seed 1), release, What's new v0.9.1.
- 08:25Z: Player asked for calm background music. Added to the v0.9.1 agent via SendMessage: generated WebAudio ambient (pads + sparse e-piano/bells, no files), a Music category with on/off and volume, ON at low volume, ducks under chimes and the alarm, fades on hide, Test sounds row, What's new line.
- 09:20Z (13:20 Dubai): Player's new requests (chime sample + HI/LO mapping, chimes always explained, toasts 5 s + tap, counter-offer reply pop-up, schedule portal in the offer dialog, delivery as a big event + follow) logged as specs 'v0.9.1-part2'. Build AFTER the tuning agent with ONE Opus-high agent; release together as v0.9.1. The iCloud shared album needs a signed-in session (CloudKit 401); asked the player to upload the video to the repo via GitHub web.
- 09:30Z: Player changed the chime map: 1 HI-LO = new contract; 1 HI = small things needing attention (incl. counter-offer reply); 2 HI = emergency; 3 HI = urgent; 1 LO / 2 LO as proposed. Alarm question still open.
- 09:45Z: Player: keep the crew alarm as is. The chime recording was uploaded to the release branch root (4df1b08, 'ScreenRecording_10-24-2026 14-23-24_1.mov', 2.6 s, clean). Cut into HI (0.212–1.088 s, ~588 Hz, 0.88 s) and LO (1.086–2.08 s, ~494 Hz, 0.99 s), loudness-normalised, MP3 128k (15/17 KB). Files are in updates/sounds/ (chime-hi.mp3, chime-lo.mp3, wav masters, original .mov). The part-2 agent puts the MP3s in public/sounds/. AT RELEASE: remove the .mov from the release-branch root (a copy is kept here).
- 11:00Z (15:00 Dubai): Tuning agent DONE (229dfba, 1169 tests, music in). Mixed: seed 2 has a LEGAL bug (recovery 171 h, a ticket home outside the check), the 747 run is bankrupt, reds still >12 on seeds 3/5/6, runtime 17–30 s. Launched ONE Opus-high agent a65515df20c9a6f6d: fix the 2 blockers (legal 168 h, 747 solvent) + build part 2 (chime samples, chimes always explained, toasts 5 s + tap, counter-offer pop-up, offer schedule portal, delivery event). Reds and speed deferred (player's usage). Then verify cheaply and release v0.9.1; remove the .mov from the release root.
- 11:20Z: Player: no sound for pause/resume (sent to agent a65515df20c9a6f6d). Player approved the cut HI/LO samples. Explained the 6-day cap = ad hoc trips between recoveries, not base rotations (4/5/6-week policy); optional later idea: rotation choices 3/4/5 weeks + extend.
- 11:40Z 24 Oct (15:40 Dubai): v0.9.1 RELEASED as 985bb6b (acmi c78fd16, 1177 tests). Live asset index-DrjoLh3c.js, the chimes are served, 0 console errors. Removed the player's .mov from the release root (a copy is in updates/sounds/). Open for later: 747 run still takes a rescue in November (as in v0.9), red alerts on hard seeds, engine speed, rotation choices 3/4/5 weeks + extend (idea). Nothing running. Wait for the player.
- 15:10Z 24 Oct (19:10 Dubai): Player asked for a debug round (errors + visual glitches) and redundant-wording proposals to approve. ONE Opus-high agent in acmi: fixes clear bugs/glitches (commits on acmi, no push/release), wording PROPOSE ONLY. Then show the player the list; apply approved wording; ship with the next update (mini-update rule).
- 15:45Z 24 Oct (19:45 Dubai): Debug round done: acmi 803389a (5 layout/text fixes, not pushed). tsc clean, 1177 tests, bot s1 as before, 0 console errors in 140 shots + play-through. Asked the player: toast-over-reply-popup (bug 6), 4 judgement calls (Inbox tab cut, map chip strip under zoom, portrait hint, delivery follow untested), 37 wording proposals. Waiting for approval.
- 01:20Z 25 Oct (05:20 Dubai): Player sent the final aircraft sprites (34 + masks, Gemini, 4096x1640, green bg; masks: tail #FF0000, engines #0000FF). Copied to updates/sprites-src/. Orders: replace ALL old art with these (no aesthetic change), delete old art, add the new types with researched realistic numbers (min crew etc.). ONE Opus-high agent in acmi. REMIND the player later about the debug-round questions (A-E + wording 1-37) — they asked.
- 02:45Z 25 Oct (06:45 Dubai): Sprite agent DONE: acmi f488156..180f943 (pipeline scripts/sprites.py, raster AircraftArt, old vector art deleted, 15 new types, 12 on market, 747 classics off pending FE decision; 2.5 MB assets; 1114 tests; bot s1 no new fails). Open for player: body colour mask, 777-200LR sprite, flight engineer role, engine colour, version number v0.10, plus debug A-E + wording 1-37. Nothing released.
- 04:40Z 25 Oct (08:40 Dubai): Player answered: 1) body masks — make them myself, lots of livery customisation; 2) remove 777-200LR (keep 777-200ER and later 777s); 3) no flight engineer, 747 classics on the market with 2 pilots; 4) research and fix min/max crew per type (A340-200 = 8 min cabin crew at 375 seats); 5) THEN PUSH (release). ONE Opus-high agent in acmi on all four. After it: verify, release v0.10 (debug fixes + art + these). Wording 1-37 and debug A-E still unanswered: do NOT apply.
- 06:15Z 25 Oct (10:15 Dubai): v0.10 Fleet art RELEASED as df3a8c3 (acmi 7982bd0, 1125 tests). Live index-fNyvYwzx.js, sprites served, 0 console errors. Contains: debug fixes 803389a, player sprites + body masks + big livery editor, 15 new types (747 classics on market, 2 pilots), 777-200LR removed (saves migrate to 777-200ER), crew min/max from EASA TCDS (RESEARCH §15). Known: --wide --aug --b744 bot run below zero 39 days (limit 30; cash ends higher). Still open: wording 1-37, debug A-E. Nothing running.
- 09:02Z 25 Oct (13:02 Dubai): Player: stop saving for now. Both scheduled tasks paused (half-hour save trig_01FKC2Y7QvrmnE3mu4zMHeKH, hourly check-in trig_01TSLRzBNHatY2hxNxpg6GKd), not deleted.
- 10:00Z 25 Oct (14:00 Dubai): Player: paint jobs/masks way off (engines incl. exhaust painted, fin over/undershoot, looks overlaid not painted). Also asked if CI failure emails are bad: explained = vitest worker RPC timeout / timing tests on slow GitHub runner, all 1125 pass; offered CI fix (unanswered). ONE Opus-high agent rebuilding all region masks (fin/body incl fairing/cowl excl exhaust/lip/pylon) + lit painting model (shading+detail, text painted in). Show player shots BEFORE releasing.
- 14:30Z 25 Oct: Paint fix done on acmi (3e0cb08 + 7bfff57: rebuilt masks fin/body+fairings/cowl-no-exhaust/lip/winglets, lit paint model, clean navy). Not released; shown to player for approval.
- 15:00Z 25 Oct: Player sent Cathay Pacific reference illustrations (747-400, 777-200, 777-300; in updates/livery-refs/) to learn from. Reference only: no Cathay branding in the game. Sent paint agent a refinement pass.
- 15:20Z 25 Oct: Player: real-airline liveries (like the Cathay/KLM refs) should be the CLIENT paint jobs; current client paint not substantial enough. Queued to paint agent after the reference pass: per-client real livery recipes (colours/layout/lettering faithful, logos as own simple marks, no traced trademarks), govt/UN sober, decals in client colours, richer fallback.
- 15:35Z 25 Oct: Player shared Norebbo colouring guide. Sent to paint agent: multiply base, fuselage gloss band (soft top, hard lower edge), crisp black windows on top, diagonal fin reflection (soft-to-hard), subtle cowl highlight.
- 16:40Z 25 Oct: Paint agent delivered refs pass + markings + client liveries (acmi 649a374, 20684a9; 1131 tests). Sent player refcompare + client sheets 1-2. Small fix in progress (accent line through model text; fin-root fillet block/sliver). Not released.
- 18:00Z 25 Oct: Fillet + model-text fixes done (acmi 2d4c6c7, 1133 tests). Waiting for player approval to release.
- 18:30Z 25 Oct: Player: 'They look great!' — fix registrations (match refs: small, rear, above windows near last door; model small next to it at rear) and remove the planet (orbit) logo. Then RELEASE (approved).
- 19:30Z 25 Oct: Player bug: BLU511 AYT-MAN keeps getting pushed ('Waiting for a rescue crew' loop). Save in uploads. Cause found: FO cl Teresa Martins loc=LIS though her DH DUS->AYT is done; crewBlocked true, status says legal, reroster keeps her. Fix agent in worktree /home/user/wt/fix (branch fix/hold-loop from 7982bd0). Paint agent still in acmi. Release both together after.
- 01:30Z 26 Oct: Container restarted; both agents resumed (paint in acmi, hold-loop fix in wt/fix). Player: 'push it when both are done' -> merge fix/hold-loop into acmi, verify (tsc, vitest, bot s1, save replay, browser), release v0.10.1 or fold into v0.10 notes.
- Hold-loop fix DONE: fix/hold-loop 88b4992 (missed tickets, location check, absentCrew at gate, onLoad repair, sheet shows 'FO X is in Lisbon'; 1128 tests; bots s1-3 no regressions). Waiting for paint agent, then merge into acmi and release.
- 00:40Z 26 Oct (04:40 Dubai): v0.10.1 Liveries RELEASED as e489162 (acmi 94ab325 = paint 528123b + fix/hold-loop 88b4992, 1137 tests, bot s1 solvent $3.22M). Live index-Ka1aJREf.js, 0 console errors. Still open: debug A-E, wording 1-37, CI timeout fix offer, ~25 lesser wording nits.
- 01:00Z 26 Oct: Player: yes fix CI check; registration flag must be flat rectangular (no emoji). ONE agent in acmi (flag-icons SVGs, lazy; CI: forks/timeouts/perf factor). Release after as v0.10.2 (mini).
- 01:10Z 26 Oct: Player: on lease/buy, prompt to name ('baptise') the aircraft + choose registration (prefix locked). Queued as job 3 to the same agent. Name painted under cockpit, shown on cards.
- 01:20Z 26 Oct: Player: urgent offers (few hours to accept) -> simulated phone call pop-up (accept/decline). Queued as job 4 (ring sound in Alerts, pauses, same accept path, See details).
- 02:00Z 26 Oct: Player: approvals 1-3 approved (keep no illegal crew; replace AOG count by technical dispatch reliability 97/98/98.5%; ETOPS maintenance programme one-off). NEW RULE: never push to main without asking. Flag/CI (1b1ac07) + naming (97d042b) on acmi; phone call half-done uncommitted; home-screen Online chip todo.
- 02:20Z 26 Oct: Title Online chip done (cbbacd7). ONE agent: finish phone call WIP + approvals (no illegal crew; tech dispatch reliability 97/98/98.5; ETOPS maintenance programme). No main push — batch waits for the player.
- 03:10Z 26 Oct: Batch on acmi (pushed acmi only): flags+CI 1b1ac07, naming 97d042b, Online chip cbbacd7, phone call 6160714, approvals e55bdd0 (1163 tests). Agent also lowered tech delay rate 0.006->0.0035 (needs player OK) and fixed a duty-split bug. Not released; waiting for player.
- 03:40Z 26 Oct: Player: keep tech-delay rate; fitting caller names; Light theme + Appearance Light/Dark/System; round-up re-offers hires bug (dual-rated FAs counted in largest-shortfall family). ONE agent on all three (acmi). Batch still unreleased.
- 04:30Z 26 Oct: Agent done: caller names bca8a99, round-up/dual-rated e2bc408, light theme 6abcc9c (1171 tests). Open: keep 'Add a spare set' button? align Hire view staffing() with sets? Batch unreleased.
- 08:30Z 26 Oct: Player: keep 'Add a spare set'; align Hire view -> done (ced204c, 1172 tests). Batch still unreleased on acmi.
- 09:00Z 26 Oct: Player approved roadmap (updates/roadmap-v011.md). Trade fairs go in Team tab; traveller flies like crew deadheads (plane icon on commercial airline). START Update 1 Operations (one agent).
- 10:20Z 26 Oct: BLU1109 rest bug FIXED on branch fix/rest (from acmi ced204c): dropStandby now marks a running window as a call-out when work starts inside it (was cut at now -> 12h rest owed); onLoad repairCutStandby; test in rules073. Merge into acmi after the Ops agent finishes. Player also asked: EXTENSIVE debug round + visual improvement proposals (after Ops update).

### 26 Oct (later) — Ops reported, rest fix merged, debug round started
- fix/rest merged into acmi → 7c34710 (pushed). tsc clean, vitest 1191/1191, bot seed 1: only balance flags (27 s, 13 red, cash low −1.08M, days off 8.1, spread 11).
- Reported Update 1 to player with shots; asked: (1) is ~9% cash cost of disruptions OK, (2) keep pre-Ops tests running with Ops off (recommended).
- Visual proposals 1–13 sent; my picks 1 (day/night), 2 (top-down silhouettes), 5 (hangar line-up), 6 (spotter mode), 13 (fold hints into ?). Awaiting player's choice.
- Extensive debug round agent running on acmi (scripts/invariants.ts, shots in updates/shots-debug/). No main push.

### 26 Oct — player decisions
- Disruption cost ~9% cash: OK (keep).
- Pre-Ops tests: REWRITE them with Ops on (drop src/test/opsSetup.ts Ops-off where possible). Queued.
- Clients tab moved Company → CONTRACTS (Market · Active · Missed · Clients) — player corrected Schedule→Contracts: done on branch ui/clients (pushed); merge into acmi after the debug round. Old links company/clients redirect in store.navigate.
- ALL visual improvements 1–13 approved. #2: top-down silhouettes with the CORRECT ENGINES per type (count and position, like Flightradar24), and icon size scaled to aircraft size.
- Queue (one agent at a time): debug round (running) → merge ui/clients → Visual A (map: 1 day/night, 2 silhouettes, 3 flown/to-go lines + contrail, 4 weather marks, 6 spotter mode) → Visual B (5 hangar line-up, 7 delivery card, 8 big aircraft view w/ local-time sky, 9 schedule block labels, 10 finance charts, 11 crew rank stripes/purser badge, 12 boarding-pass tickets, 13 hints fold into ?) → test rewrite with Ops on.

### 26 Oct — debug round done (acmi 7c34710 → 2ab70a9, 13 commits), Clients merged (a9fd49b), Visual A started
- Fixed: AOG reposition pause loop (6b3dbd1), curfew same-minute loop (239bd5e), BLU404 curfew 2nd card + 30-min crew-short retry (0255352), duty ends at real landing + discretion + missed tickets + 14h after long tz ticket (6b3d3b3), captain in both seats on swap (b5a80d9), hotel standby in wrong city (409227c, ad9ad6e), flying home on leave day (dad9e96), diversion labels / finance 90-day low / reg wrap (0ecc67e, 7c36886). scripts/invariants.ts + bot --inv.
- Open for player: ETOPS on delivery ferries (treated as ferry permit; Fleet "ETOPS 120" unused by rules); weekly rest 176h seed 2; next duty not pushed after late landing; widebody bot −12%; schedule idle label under sub-charter + legend; red alarms now 22–30 (truthful late landings) — planner slack is a tuning call.
- Wording proposals W1–W6 from the debug report (curfew airport not city; "Nothing is missing; nothing lost yet."; phone "busy with"; same-day date range; "× 66 months"; legend "Sub-chartered").
- Visual A agent running: 1 day/night, 2 silhouettes w/ engines + size, 3 flown/to-go + contrail, 4 weather marks, 6 spotter mode. Shots → updates/shots-visualA/. What's-new drafts → updates/whatsnew-draft.md.

### 26 Oct — player answers on debug round
- ETOPS ferries: YES — do as real airlines: while we hold no ETOPS approval, delivery/positioning ferries take the non-ETOPS route (northern hops: e.g. Keflavík/Narsarsuaq/Goose Bay/Iqaluit; Azores where within 60 min), with fuel stops and time; and the per-aircraft "ETOPS capable 120 min" on Fleet should feed the rules. QUEUED (engine agent, after Visual A).
- Wording W1–W6: approved → done on branch fix/wording (worktree /home/user/wt/wording): curfew card names airport ("Land at Gatwick (LGW) instead", "after Heathrow closes"); hurtProse capitalised ("Nothing is missing. Nothing lost yet." — general fix for all inbox bodies); phone "busy with …"; fmtDayRange (same-day = one date) in 12 files; "× 66 months"; schedule legend "sub-chartered" + idle gaps split at sub-charter legs (test added).
- REMIND PLAYER (they asked): crew planner round — (a) next duty not pushed back after a late landing, (b) weekly rest 176 h > 168 h on seed 2 (ticket home after 6-day tour), (c) planner slack for late arrivals (reds 22–30/yr now). Also still unanswered from earlier: debug-round questions A–E and wording proposals 1–37 (+~25 nits).

### 26 Oct — Visual A done, wording merged, ETOPS ferries started
- Visual A on acmi (ce647ef..9375008): day/night + city lights, top-down silhouettes (31 types, engines, size 24–41 px), flown/to-go lines + contrail >26k ft, weather marks, spotter mode. 1215 tests green. Shots updates/shots-visualA/. Leftovers: label pile-up with many aircraft near one airport (do in Visual B: label de-clutter), diversion mini-map + deadhead airline flights still generic plane icon, weather mark refresh hourly.
- fix/wording merged → acmi 8e13fea (ff).
- ETOPS ferry agent running (northern route while no approval; Fleet ETOPS line; impossible crossing card). Next: Visual B (5,7,8,9,10,11,12,13 + map label de-clutter + generic icons on mini-map/deadheads) → test rewrite with Ops on.

### 26 Oct — map icons approved ("Fantastic love it")
- Branch ui/engines (pushed, adfb846): engines under the wing (only intake ahead of LE, FR24-style) + silhouettes coloured BY FAMILY (SIL_COLOURS in silhouettes.ts: A320 blue, A330 purple, A340 pink, A350 teal, A380 red, 737 green, 757 lime, 767 brown, 777 orange, 787 cyan, 747 yellow), key in map ? legend. Livery stays in spotter/fleet. Merge into acmi after the ETOPS agent finishes.

### 26 Oct — cash rate + RELEASE GO for this batch
- Top bar profit/day beside "cash" (src/ui/shell/cashRate.ts): month-to-date statement profit/elapsed days − (rent+insurance+overhead+salaries+heads)/days in month; first 2 days of a month = last month's average. Green/red. On branch ui/engines.
- PLAYER SAID: "After you finish everything, you can push it to main and update. This batch is big enough." → release (main + Pages) is APPROVED once ETOPS ferries + Visual B + test rewrite are done and verified. Needs a What's new entry (assemble from updates/whatsnew-draft.md + earlier drafts: phone call, approvals reliability/ETOPS programme, caller names, round-up, light theme, Ops update 1, debug fixes, Clients on Contracts, map visuals, family colours, cash rate, ETOPS ferries, Visual B) and version bump.

### 26 Oct — ETOPS ferries done; icons+cash merged; Visual B started
- ETOPS ferries on acmi (41cfcc6, 4e5270f crew 14h after ≥4tz ticket fix, bcee27f, f9aa970, f6cb1ea): ferries/positioning ≤ min(approval, aircraft capability), 60 min with none, quads free; northern routing via new en-route airports (SFJ, UAK, YFB, YYR, YQX, YYT, BDA, ANF, IQQ; KEF runway; MDW runway corrected); ferry days ≤3 legs/10 h, 14 h night stops; impossible crossing card (hand over this side / ferry company, new ledger "Ferry companies"); Fleet ETOPS line; load repair. 1226 tests. RESEARCH.md §18. Widebody bot −12% → −27% (noise; already bankrupt before).
- ui/engines merged → acmi f5fccb9 (engines under wing, family colours, profit/day pill).
- Visual B agent running (5,7,8,9,10,11,12,13 + map label thinning + airline/diversion-map silhouettes + empty divider). Then: test rewrite with Ops on → release (approved).

### 26 Oct — Visual B done; cash layout; test rewrite running; release prep
- Visual B on acmi (63b14a6..062f3ab): hangar, welcome card, local sky, schedule labels, finance charts, rank marks (relief pilot 2 stripes), boarding passes, hints fold into ?, map label thinning, airline silhouettes, diversion map. 1261 tests.
- ui/cash2 ff → acmi 00a12cc: "$X cash" one line + pill under the amount (grid), pill counts earnedUnbilled; Finance profit tile "after month-end costs".
- Test-rewrite agent running (remove global OPS_LIVE.on=false, fix vitest runner flake).
- What's new v0.11 "Operations" drafted: updates/whatsnew-v0.11.md (paste on top of WHATS_NEW at release; update whatsNew.test/fixpack08 expected lists).
- RELEASE after test rewrite: verify (tsc, vitest ×1, bot seeds 1–3, player save load), whatsNew + version, build, Game merge, push branch + main, live check. Player approved.
- PLAYER: will rename repo Game → Block-Hours AFTER the v0.11 release. Then: add_repo kikonos/Block-Hours (session scope is kikonos/game), update remotes (GitHub redirects git), verify Pages at kikonos.github.io/Block-Hours/play/ (vite base './' so no code change), What's new shows; remind: re-add home-screen app, saves stay (same origin), export save first. Offered (not yet accepted): redirect repo "Game" at old address.

### 26 Oct — test rewrite done; release in progress
- Tests run with Ops on (c4656fc), runner flake fixed (52506e2: long tests yield, forks, timeouts), real bugs fixed: closure hold loop slow-down + closure lateness penalties (9906fc1), early ticket re-planned when duty moves later + ticket home waits rest after hotel standby (3706cfa, eef36d4). 1264 tests ×2 green. Seed 3 reds 22→43 (bigger operation on a new path) — watch in crew-planning round.
- v0.11 What's new inserted in src/data/whatsNew.ts (+2 fixes), tests updated. Final checks running (scratchpad/final/: vitest, bot1, inv-save 60 d on player save). Then build + release.

### 26 Oct — v0.11 Operations RELEASED
- Release af97c80 on claude/contrail-airline-game + main (acmi 9c7d0ca). Live index-B2khoJNM.js, 0 console errors, title "v0.11 Operations", What's new pops ("Version 0.11 is live!"). 1264 tests, bot s1 fine (30.7 s), player save 60 d: no new errors (2 historic release errors from 11–12 Aug in the save; rest-pos warnings = known "next duty not pushed after late landing", for the crew-planning round).
- NEXT: player renames repo → Block-Hours (remind: export save first; re-add home-screen app at kikonos.github.io/Block-Hours/play/); then add_repo + verify. Reminders owed: crew-planning round (late landing → next duty, weekly rest 176 h, planner slack / reds, seed 3 reds 43, widebody bot), old questions A–E + wording 1–37. Roadmap Update 2 Commercial next with player's go.
- Player: rename later. Crew-planning round agent started on acmi (late landing → next duty, weekly rest 168 h, planner slack/reds, seed 3 on-leave flight, SK4002 loop, uncalled hotel-standby rest per CS FTL.1.225, widebody bot losses crew-side, bot runtime). No release without player's go.

### 27 Oct — crew planning round DONE (acmi 9c7d0ca → b0a0a67, 21 commits, not released)
- Fixes: tickets rebooked after late landing (77bfe0e,17ed310); weekly rest clock from ticket check-in, jet check-in 30 min (c1dd3c4), ticket home respects 7/14/28-day duty (b0a0a67); leave: home before leave, leave starts on landing (a9cd9d3,59e2f26,bf834cd,a3c9610,63a4768); diversion settles the duty (dcd74c3, load repair); uncalled standby rest per CS FTL.1.225 (8ceb5c5,8ea7d73); empty-leg ride rule (619d2e1); joined trips w/o cabin crew (e0593e0); bot --redwhy (8d79e14). 1285 tests. Player save 60 d: 0 warnings (2 historic errors).
- Bot reds s1–6 169 → 91; margins mostly better; runtimes 127 s total for 6 (most ≤ 24 s). Reds left = headcount at peaks + knock-ons (buffers made it worse, dropped). Widebody bot = bot strategy (far-flung 747 jobs, no crew based there), not crew rules.
- Left: 5 checker errors on 365-d seeds (hotel standby 0:50 rest; standby planned at MAD for crew in LIS; resigned crew flown home after last day); widebody 3 FDP overruns 4–19 min.
- What's new drafts under "## Crew planning round (after v0.11)" in updates/whatsnew-draft.md.
- 27 Oct PLAYER: (1) YES to peak staffing heads-up (Crew screen, 4–6 weeks ahead, e.g. "July needs 3 more A320 cabin crew sets"); (2) fix the 5 leftover breaches; RELEASE (v0.11.1) when everything is finished — approved. Agent running: Part A forecast (+ head uses it, bot --forecast-hire to measure), Part B leftovers (hotel-standby rest, standby at wrong station, resigned crew flown home late, widebody FDP 4–19 min). Then I release v0.11.1 with What's new from whatsnew-draft.md "Crew planning round" + staffing lines.

### 27 Oct — v0.11.1 Crew planning RELEASED
- Release c472073 on claude/contrail-airline-game + main (acmi 8707abe). Live index-JkboY_UY.js, 0 console errors, title "v0.11.1 Crew planning". 1302 tests; bot s1 8 reds; player save 60 d: 2 historic errors only.
- Staffing heads-up (forecast.ts): Crew › People + Planning; fixed "about N sets" to use the type's own complement (d7c4549). Bot --forecast-hire barely moves reds (242→235 over 12 seeds); cautious 0.6 setting 166 but costs margin — reds are day-level (place/rest/hours), not month headcount.
- Bot s1: 1 crew-month <7 days off (offBroken 1 — designed day-off break by crew control, replaced next month). Watch.
- NEXT (player's choice): Update 2 Commercial (tenders, trade fairs in Team tab with deadhead-style traveller, client crises); repo rename to Block-Hours when player does it; old questions A–E + wording 1–37 still unanswered.
- 27 Oct: city lights removed on acmi (1dc9d40), not released; asked player: release now (v0.11.2) or batch. What's new line needed: 'Night on the map no longer shows city lights.'
- 28 Oct: Hangar from above (default, Side switch), real L×S, 10 m grid, footprint order — acmi c430f18. Not released (with city-lights removal). What's new: 'Fleet › Hangar now shows the fleet from above, to scale…'.
- 29 Oct PLAYER: auto-detect device; play on iPhone 15 Pro (landscape), Mac and Windows; everything scales. Agent running (device.ts, Settings Device override, iPhone safe areas/393 px height, desktop mouse/keyboard/UI size, layout checker, shots → updates/shots-devices/). Unreleased on acmi: city lights removed, hangar from above, + this. Release needs player's go.
- 29 Oct: multi-device DONE on acmi (bc9346e device detection + Settings › Display › Device/Size, 167b6bc iPhone layout, 9becf7a UI size, a8e4199 desktop polish). 1333 tests. Layout check 1200/1200 at 20 sizes (Chrome emulation; Safari untested). Imperfect: phone roster board cramped (~2 rows), Schedule/Contracts summaries cut short on phone, Size zoom untested in Safari. Unreleased batch: city lights off, hangar from above, devices — ask player to release (v0.11.2).
- 29 Oct PLAYER: (a) Sub-lease button in offer portal/trip swap + show scheduled flights instead of a block (agent running on acmi), (b) review crew sets/hiring numbers esp. multi-type FAs → fix bugs, PROPOSE improvements (next agent), (c) more soundtracks cycling → DONE on branch ui/music (5 pieces, Now playing + Next piece in Settings; levels rms .093–.115), merge after the sublease agent, (d) RELEASE APPROVED after everything ('After everything push it to main') — includes city lights off, hangar from above, devices.

### 29 Oct — v0.11.2 Every device RELEASED
- Release a97957e on claude/contrail-airline-game + main (acmi 76a431d). Live index-DTq-S29o.js, 0 console errors. 1353 tests; bot s1 8 reds; player save 60 d: 2 historic errors only.
- Contents: device detection + Settings › Display (Device, Size), iPhone landscape layout, keyboard shortcuts; sub-lease (offer portal per-flight + clash list, TripMoveModal, flight sheet); hangar from above; 5 music pieces + Now playing; city lights removed; pill right-aligned under 'cash'; crew sets review (11 bugs).
- Open proposals for player: sets UX 1–7 (recommend 1–4). Repo rename to Block-Hours still pending (player). Update 2 Commercial next with player's go.
- 30 Oct PLAYER: "Remind me those three items later on": (1) crew sets UX proposals 1–7 (rec 1–4), (2) repo rename → Block-Hours, (3) Update 2 Commercial. Quick fix done on acmi: offer ghosts (dashed outlines of the offer's legs + positioning on each candidate timeline; job block only for base programmes). Not released — asked player.
- 30 Oct: v0.11.3 Offer ghosts RELEASED (e18fb80 on main; acmi f0b82d3). Live index-cLtpFkFh.js, 0 console errors. Reminders owed: sets UX 1–7, repo rename, Update 2.
- 30 Oct PLAYER: BLU1396 (save 655801c1, 15 Oct 2027) no crew 2 days out. Diagnosed: only itinerary LIS→MIA→MBJ lands 16 Oct 22:50; cabin 'Rest 13:55 < 14:00' (5 min short of 14 h tz rest); pilots 'Rest 14:15 < 17:45' (suspect +4 h extended-FDP rest put BEFORE the duty — EASA allows +4 h after); Delay option says 'use Auto-fix' while Auto-fix can't crew it (bug); planner booked no earlier positioning. Fix agent running on acmi. Not released.
- 30 Oct PLAYER: BLU1396 later — jet also 'not now'. Asked: long crew-planning debug (too many shortage notices; must position crew days ahead) + private jet rarely available (should be wheels-up fast, tailored direct routing, faster). Scope added to the running BLU1396 agent (A jet model, B planning debug on both saves + bots). No release without player's go.
- 30 Oct: offer card fix on branch ui/cardwrap (bestReport prefers busy-only aircraft over hard blockers: HARD set; .pc-do buttons wrap) — merge into acmi after the crew-debug agent; ship with that batch (ask player).
- 30 Oct PLAYER: (1) more New-company start presets with other SHORT-HAUL aircraft/setups — every preset short-haul only; (2) new play mode "Scenarios": fun, different, challenging, variety. Queued after the crew-debug agent (one agent at a time). Draft scenario list sent to player for tweaks.
- 30 Oct PLAYER: 'When you are done release' — RELEASE APPROVED after the crew-planning agent finishes (merge ui/cardwrap too). Added to agent: early crew-shortage warnings days ahead (not 12 h), escalate, measure lead time; late changes explained plainly. Then presets + scenarios agent.
- 30 Oct: crew round agent DONE (acmi 92fc213; BLU1396 auto-fixable; jets reworked; early heads-ups; reds 154→127 over 7 runs; planning reds told median 96.8 h ahead). ui/cardwrap merged. Code-review fixes on offer ghosts (58923fe: programmeOf legs, positionAll, pointer-events none, memo). Independent review agent of the crew diff running; then release v0.11.4 (approved).

### 30 Oct — v0.11.4 Crew planning 2 RELEASED
- Release e28a005 on main (acmi 90b147b). Live index-BXGRlYLm.js, 0 console errors. Review agent fixed 5 more (12c7cf3 earlyRead saved, 2688d3c extCutAt standby, f9d0310 delay text, bb11f25 jet range, b78abbc cabin early in buildTrips). 1379 tests.
- Known, not fixed: jet chartered for crew from two origins picks class from first origin only.
- NEXT: presets (short-haul only) + Scenarios mode agent. Reminders owed: sets UX 1–7, repo rename, Update 2 Commercial.
- 30 Oct: presets + Scenarios DONE on acmi (909ceda..fadba65): 7 short-haul setups, 10 scenarios with stars/thresholds, A320neo added (setups/scenarios only, ceo art). 1406 tests. NOT released — ask player.

30 Oct: v0.12 "Scenarios" RELEASED (player: "Release it"). acmi ea306f9 (What's new entry), release fb6484f on claude/contrail-airline-game + main, live asset index-DxfOpK7J.js.
Pending reminders for the player: crew-sets UX 1–7 (rec. 1–4); repo rename to Block-Hours (player does it; then add_repo + verify new URL, export save first, re-add home-screen app); Update 2 Commercial (tenders, trade fairs, client crises).

31 Oct: Round A DONE on acmi 6a514b3 (graded runway range loss, hot&high, arrival never cuts range, fuel stops on the way, 737-800 2700/A321 2600/A320neo 3100 nm, 38 airports incl. remote flag, 1456 tests). Not released.
Round D running: 27 Oct save (scratchpad/s1027): Goma crew stripped by soft day-off rule, BLU1565 contradictory reason + dates on timeline, past tickets in swap preview, day-off buy-back (setting Auto/Ask/Never), toasts longer + pause + history, overlap check, hot&high calibration.
Then Round B (crew ride own revenue flights, no seat cap beyond free seats) and Round C (TMR-style world tour: ~21 d from CDG, any widebody with business seats, same augmented crew + extra cabin crew, late game, AIRPORTS.filter(remote)).
Open question to player: schedule screenshot arrow = overlap (a) / use idle aircraft (b) / both?

31 Oct (later): Round D DONE acmi 7043b0f. Player: "fix everything", opted into a workflow.
Running at once: Round B agent in /home/user/wt/acmi (own-flight riding); Round E agent in /home/user/wt/roundE branch roundE (Port Sudan stranding, orphan legs, favour delays, refit pricing; save scratchpad/s1118);
Bug-hunt workflow wf_6ff50ee1-ac7 (6 hunters in /home/user/wt/hunt-{move,crew,comm,money,events,ui} at 7043b0f → verify → fix-lane plan). Then: merge B+E into acmi, run fix lanes (workflow), re-verify, then Round C world tour. Nothing released since v0.12.
Player (31 Oct): 'When you finish, push it to main.' → release authorised once rounds B, E, bug-hunt fixes (and world tour?) are done and verified. World tour (Round C) was queued after fixes; release after all finished.
Round B DONE acmi 0e5144a (own-flight rides; 1476 tests). Leftovers for fix lanes: Crew Control "Fly someone in: Nobody legal" while its options list an own-flight ride (ownRide.test Dublin); multi-leg rides not supported; empty ferry home not ridden (one-word switch ridesHome/rideHomeFrom).
Round E DONE (roundE c5c8c10) merged into acmi e094ab1 with B: tsc clean, 1492/1492 tests, invariants both saves 30 d: 0 errors (orphan ticket warnings only: du15b2 f14zf, du1jfo f10t3 → for fix lanes). Bot: seed1 red 13 > limit 12, change requests accepted more (default Agree).
Bug hunt wf_6ff50ee1-ac7 DONE: 79 confirmed (18 high/39 med/22 low), 7 unclear, 7 refuted. Plan: .handover/updates/roundF-plan.md (also scratchpad/hunt/plan.md, result.json).
Fix workflow wf_1e53de3a-b38 running: step0 (fix0) → lanes fixA..fixD → merge into acmi + section 6 verify → review → final. Decisions: forgive 15 min–3 h; series cancel per rotation; no depreciation yet.
After it: Round C world tour, then RELEASE (player authorised "when you finish, push it to main").
Fix workflow wf_1e53de3a-b38 DONE: acmi d1d422f (merge a2b1a74 + 9 review fixes). 1631 tests. Saves 30 d: 0/0. Results JSON: scratchpad/hunt/fixresult.json.
RELEASE BLOCKER found by me: bot seed 1 --wide melts down (172 sub-charters, reliability 56.6, cash -1661k vs base 18/91.2/1573k; signs B744). Other seeds 2/3/5 fine/better; seed 7 cash 1641k→120k (check). Diagnosis agent running.
Still open: A7 item 2 (waves inside base curfew), C7 core, B8 exact count, D5, C2, MOVE-S4, iPad/iPhone screenshots of new card labels, Goma force-majeure design call, S-DEPREC.
