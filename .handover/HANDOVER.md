# CONTRAIL — handover notes

Read this first when resuming after a usage-limit reset or a context reset.
Checkpoint script: `bash /home/user/wt/notes/.handover/checkpoint.sh` (commits all worktrees, pushes wip/* branches).

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
- 2026-10-19 10:25Z: limits hit twice. The art architect finished the renderer, specs and gallery (big improvement). The iPad foundation is done. The engine rebalance is partly done (committed as WIP). Relaunched all three workflows lean.
