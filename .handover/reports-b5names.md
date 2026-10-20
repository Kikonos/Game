# Reports: B5 screens and real-names pass (run wf_6f62dfd6-3bf)

## B5 Screens
B5 is implemented. `npx tsc --noEmit` is clean, `npx vitest run` passes (166 tests, 13 files) and `npx vite build` is green. Most of the code was already in the worktree from the interrupted attempt. This pass restarted the dev server on port 5605, re-ran the smoke script at 1180×750 and 1180×820 with touch, and checked one screenshot.

**Implemented**
- **Contracts:** Market, Active and Missed views. Offer cards show an expiry countdown plus requirement and risk chips. Active rows have an MGH progress bar, a "Show on schedule" button, and a cancel confirm that shows `cancelPenalty`.
- **OfferModal:** terms, schedule list and the `feasibilityAll` traffic lights with expandable checks, plus Accept, Counter and Decline.
- **Schedule:** a Gantt with a row per aircraft and 3d/7d/28d zoom. It has contract colours, positioning hatch, maintenance stripes, idle gaps of 12 h or more, a today line and a Today button. Tapping a row opens `BlockSheet` for the nearest block.
- **Crew:** staffing strip, filterable list with limit bars, per-person 14-day roster, Hire, Train and Check modals.
- **Fleet:** aircraft cards with art, A/C check bars and check planning.
- **Finance:** KPIs, monthly statement, cash forecast chart and receivables.
- **Company:** reputation, approvals, policies and goals.
- **Inbox:** decisions pinned above messages, category filter, mark read and deep links.
- **DecisionModal:** option chips, expiry time and the default option marked.
- **Shell and New Game:** a static pause badge showing the pause reason, and the Settings toggles for every auto-pause option. `Placeholder.tsx` is deleted. New Game polish is covered by the shots, but I only looked at the Schedule screenshot.

**Tests added**
- `src/ui/screens/scheduleLogic.test.ts` (11 tests)
- `src/ui/screens/screenLogic.test.ts` (9 tests)

**Acceptance criteria**
- **No overflow or small tap targets:** every tab was checked at 1180×750 and 1180×820, with empty data and with real data. There was no horizontal overflow and no tappable element under 40×40.
- **Console errors:** none in either run.
- **Re-render rate:** at 4×, each screen re-rendered 10–13 times in 5 s (Schedule, Crew, Contracts, Finance), about twice a second. I saw no flicker, but I only inspected one screenshot, not a recording.
- **Accepting an offer:** accepting from OfferModal created the contract and its flights. The active card appears, and "Show on schedule" puts the blocks in the Gantt in the contract colour.
- **DecisionModal:** it opens by itself, and picking an option closes it.

**Cross-builder requests:** none.

**Known gaps**
- In the data run, the Gantt reported 0 `.gb-flight` blocks and 0 maintenance blocks before the ad hoc accept, so tap-to-open-sheet was not exercised in that run.
- The 7d block count on the accepted contract's row varied between runs (2 at 750, 1 at 820), which fits start times drifting.
- I did not exercise Fleet maintenance planning or the aircraft market with real data beyond the render and overflow checks.

The dev server on 5605 is stopped.

## Real names
Fictional clients, brokers and rivals are now real names. `npx tsc --noEmit` is clean and `npx vitest run` passes (166/166). No test asserted a fictional name, so none changed.

**What changed**
- **Clients** (`src/data/naming.ts`): about 70 real clients replace the fictional ones.
  - Airlines include TAP Air Portugal, Lufthansa, Eurowings, Condor, LOT, SAS, Aer Lingus, airBaltic, Saudia, flynas, Azul, Air Canada, Air Sénégal and TAAG.
  - Governments are the real ministries of foreign affairs and defence per country, the UK Foreign Office and the German Federal Foreign Office.
  - Agencies include UN WFP, UNHCR, IOM, UN DPO, Frontex and ECHO.
  - Tour operators include TUI, Jet2holidays, Sunweb and Corendon.
  - Clubs include Sporting CP, Benfica, Real Madrid, Barcelona, Marseille and Man Utd.
  - Music and corporate clients are now promoters (Live Nation, AEG Presents) and companies. I used promoters rather than named artists to avoid attaching invented tour charters to real people.
  - Marine crewing uses real ship managers and cruise lines (Columbia, Bernhard Schulte, Wallem, Anglo-Eastern, Carnival, MSC, Royal Caribbean).
- **Brokers**: Chapman Freeborn, Air Charter Service, Air Partner, ACC Aviation and others.
- **Rivals**: Hi Fly, euroAtlantic, Wamos Air, Privilege Style, Avion Express, GetJet, Airhub, Air Atlanta Icelandic, Titan Airways, Global Crossing, Heston Airlines, KlasJet and Smartwings. SmartLynx is excluded.
- **Role tags** (`src/data/naming.ts`, `src/engine/contracts/clients.ts`, `src/engine/contracts/offers.ts`): clients now carry an optional `role` (foreign, defence, aid, marine, diaspora, pilgrim). Ministry lookup, specialist agencies and payment behaviour use it instead of matching on name text. Diaspora and pilgrimage offers use the new `isDiaspora` and `isPilgrim` checks.
- **Season-base hubs** (`src/engine/contracts/flavor.ts`): I changed the airline hubs to match the real carriers. Narrowbody drops SPU and adds WAW, FRA, LIS and RUH. Widebody adds JED and LAD.
- **Player company presets** are unchanged and still fictional.

Real company names are used only for neutral simulation outcomes such as late payment or a competing bid.

**Files**
- `/home/user/wt/acmi/src/data/naming.ts`
- `/home/user/wt/acmi/src/engine/contracts/clients.ts`
- `/home/user/wt/acmi/src/engine/contracts/offers.ts`
- `/home/user/wt/acmi/src/engine/contracts/flavor.ts`

`src/data/flavor.ts` still has a fictional "Hanseatic Air" in its airline list. I did not touch it.
