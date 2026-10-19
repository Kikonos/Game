# CONTRAIL ACMI v0.5: build plan

Five builders work in parallel on the skeleton in branch `acmi`. Read DESIGN.md first; the section numbers below point into it. `src/engine/core/types.ts` is the data contract.

## Ground rules (all builders)
- **Files.** Write only the files you own (tables below). Shared files:
  - `core/types.ts`: you may add *optional* fields to your domain section. List them in your report.
  - `core/balance.ts`: edit only your own block.
  - `ui/store.ts`: B5 only, and only to add `Nav.view` values or `ModalSpec` kinds.
  - Everything else in `core/`, `sim.ts`, `newGame.ts` and `save.ts`: architect. Small bug fixes are fine if you say so in your report.
- **Determinism.**
  - Use the engine RNG (`core/rng.ts` on `g`) for all randomness. Never call `Math.random` or `Date.now` in `src/engine`.
  - Create ids with `nextId`.
  - Iterate records with `Object.values`; the order is insertion order.
- **Time and money.**
  - Times are integer minutes (`core/time.ts`).
  - Money moves only through `post`, `accrue`, `cashOnly` and `invoice` (`core/ledger.ts`).
  - Flights are created and changed only through `addFlight`, `retimeFlight`, `cancelFlight` and `removeFlights` (`core/entities.ts`), so the index and queue stay consistent.
- **Events.** Queue them with `schedule(g, t, type, id, v)`. Handlers must ignore stale events (`ev.v !== entity.ev`) and missing entities.
- **Actions.** Player actions return `ActionResult` and must never throw for normal "can't do that" cases.
- **Style.** TypeScript strict, terse comments in the existing style, no new npm dependencies.
- **CSS.** Put rules in your own `src/styles/acmi/*.css`. Use tokens from `app.css` and touch targets of at least 44 px.
- **Before you report**, all of these must pass in `/home/user/wt/acmi`:
  - `npx tsc --noEmit`
  - `npx vitest run`
  - `npx vite build`
- **Dev server:** use only your own port.
- **Demo data.** UI builders get demo data with `__contrail.dev.demoFlights(3)` in the console. B1 adds `__contrail.dev.offer('seasonBase')` once offers exist; B5 owns `store.dev`, B1 asks B5 or the orchestrator.

## Dependency order

```
             ┌──────────── B4 Map (stubs → real data as B1/B3 land)
core (done) ─┼─ B1 Contracts ──┐
             ├─ B2 Crew ───────┼── integration: bot (B3) + screens wired (B5)
             ├─ B3 Ops/Finance ┘
             └──────────── B5 Screens (stubs → real data)
```

- B1, B2 and B3 code against each other's **stubs**. The signatures are final.
  - B1 calls `crewAvailability` and `autoRoster` (B2).
  - B3 calls `rerosterFrom` (B2), and `planPositioning` and `generateOffer` (B1).
  - B2 needs only flights; it can use `demoFlights` or its own fixtures.
- B4 and B5 build on the stub return values and `demoFlights`, then light up when the engine modules merge. Handle empty and stub data gracefully: show empty states, never crash.
- Merge order the orchestrator expects: B2 → B1 → B3 → B4 → B5. Each merge must keep tsc, tests and build green.

---

## B1: Contracts & commercial

**Owns:** `src/engine/contracts/*` (index, offers, pricing, feasibility, schedule, accept, billing, clients, plus new files and `*.test.ts`), the BAL "commercial" block, and appends to `data/naming.ts`.

**Implement** (signatures fixed in the stubs; DESIGN §5.1):

| Function | Notes |
|---|---|
| `contractsModule.init(g)` | Seed clients (done, tune payment behaviour) and rivals from `RIVALS`; queue the first `offer.spawn`. |
| `scheduleNextOffer(g)` | Poisson gap (§5.1.1). |
| `generateOffer(g, archetype?) → ContractOffer \| null` | 7 archetypes (§5.1.2) with fictional clients, patterns in UTC from local times, requirements precomputed (`longestSectorNm`, `minRunwayM`, `etops`), `estBH`, `estValue`, `floor`, `pin`; queues `offer.expire`; urgent → `requestPause('urgentOffer')` + message. |
| `onOfferSpawn / onOfferExpire / onOfferReply / dailyOffers` | Lifecycle, rival names on expiry, 14-day "missed" retention. |
| `priceProduct(g, PriceInput) → Product`, `productValue(...)` | §5.1.4. |
| `feasibility(g, offerId, aircraftId) → FeasibilityReport`, `feasibilityAll` | All 12 checks (§5.1.5) using `core/perf.ts`, `crewAvailability` (B2) and maintenance status from aircraft counters (do not import B3: compute "A/C due inside window" from `ac.maint` and `ACMI_TYPES`). |
| `acceptOffer(g, offerId, aircraftIds) → ActionResult<{contractId}>` | Re-run feasibility (refuse on `no`), create the Contract, `generateFlights`, charter deposit `invoice`, queue start/end, call `autoRoster({aircraftIds})`, message. |
| `counterOffer(g, offerId, price, aircraftIds)` | Stores the counter and chosen aircraft (add an optional field `counter.aircraftIds` in types); queue `offer.reply`. |
| `cancelContract`, `cancelPenalty` | §5.1.9. |
| `generateFlights(g, c) → Flight[]` | `legs` and `base` patterns, tech stops (`planSector`), turn minima, positioning in/out, `relinkPositioning`. |
| `extendBaseSchedules(g)` | Daily rolling horizon (`BAL.scheduleHorizonDays`). |
| `planPositioning(g, aircraftId, to, arriveBy, kind, contractId) → Flight \| null` | Also used by B3. |
| `onFlightArrivedContracts` | Counts `use[month]` (incl. `shortCycles`). |
| `billContractMonth(g, c, month) → BillingLine[]` | §5.1.10. Add a contracts `month` handler that calls it for every wet contract active in the closing month and issues `invoice(...)`. |
| `onContractStart / onContractEnd` | Status, charter balance invoice, effects, stats. |
| `contractProgress(g, id) → ContractProgress` | For cards and panels; uses `flightCrewStatus` (B2) for `problemFlightId`. |

**Acceptance**
- From a new game with the clock at 2× for 30 game days: 12–25 offers appear, at least 70% fit the A320s, and at least 1 season base and 1 urgent offer turn up over 60 days.
- Accepting a season base at HAM on the leased A320 creates:
  - a positioning leg LIS→HAM before the start, billable;
  - 2–3 waves a day of out-and-back legs for the next 28 days, extended daily;
  - a positioning leg back after the end.
  - Turn times are never under `turnMin`.
- A repatriation offer KBL→LIS shows a tech stop on the A320 and positioning out. A 777 is prohibited for DIL.
- Month end: a wet contract that flew 150 BH against a 200 MGH bills 200 × rate. One that flew 260 BH bills 200 × rate + 60 × 0.95 × rate. The first month is pro-rated.
- Cancelling returns the correct penalty and removes the future flights.

**Tests to add** (`contracts/*.test.ts`)
- Generation validity across 200 seeds per archetype.
- Pricing bands.
- Feasibility checks:
  - seats, range, runway, ETOPS;
  - a conflict;
  - positioning in time vs too late.
- Billing math.
- Lifecycle: accept → start → end.

**Dependencies:** B2 `crewAvailability` and `autoRoster` (stubs return 0 sets and an empty result, so treat crew as `warn` until B2 lands).

---

## B2: Crew & HR

**Owns:** `src/engine/crew/*` (index, ftl, roster, hr, costs, generate, plus new files and tests), the BAL "crew & HR" block, and `data/names.ts`.

**Implement** (DESIGN §5.2–5.4):

| Function | Notes |
|---|---|
| `maxFdp(FdpInput)`, `minRest(RestInput)`, `LIMITS` | Exact F1/F3 tables, sector penalty, 9:00 floor, augmented bonus, 18:00 cap. |
| `crewWindows(g, crew, t) → CrewWindows` | Rolling sums from `log` plus planned duties; add a runtime index crewId → duties (WeakMap with revision, like `flightsOf`). |
| `checkAssignment(g, crewId, dutyId) → LegalityReport` | Status, rating, location/deadhead, overlap, rest, FDP, cumulative, recovery. |
| `dutyLegality(g, duty)` | legal / tight / illegal. |
| `buildDuties(g, aircraftId, from, to) → Duty[]` | Duties and pairings (§5.3), augmentation, deployment pairings, keep crewed pairings unless their flights changed. |
| `autoRoster(g, opts) → RosterResult` | Greedy scoring; deadhead `Flight`s (`kind 'deadhead'`, `aircraftId null`, ticket cost posted to `deadhead` when bought); queue `duty.report` / `duty.release`; uncovered within 48 h → message + `requestPause('crewShortage')`. |
| `rerosterFrom(g, aircraftId, t)` | Disruption handling. |
| `assignCrew / unassignCrew` | Manual override; illegal allowed but flagged. |
| `rosterOf(g, crewId, from, to)`, `flightCrewStatus(g, flightId)` | Read APIs for B4/B5. |
| `hireQuote / hireCrew / trainCrew / onCrewJoin / onTrainingDone` | §5.4. |
| `crewAvailability(g, family, typeId, from, to)` | Complete complements free in the window (used by B1). |
| `staffing(g) → StaffingLine[]` | Have vs need (5 sets per aircraft per family). |
| `dailyCrewCosts`, `monthlySalaries` | Per diem and hotels (charter/positioning only), salaries × (1 + onCosts). |
| `onDutyReport / onDutyRelease / onFlightArrCrew` | Status, location, logs, `restUntil`, `awaySince`, `lastRecovery`, `blockYear`, pruning (28 days). |
| Sickness roll | Daily; remove from pairings and reroster. If that fails, post a B3 decision of `kind 'sickCrew'` via `pushDecision` with `data {crewId, flightId}` (B3 implements the resolver). |

**Acceptance**
- `maxFdp` matches every cell of RESEARCH §5.1 F1 and F3.
- With `demoFlights(14)` (or a B1 season base), `autoRoster` covers 100% of flights with the 60 starting crew, with zero illegal duties. Each crew member stays under 60 h duty per 7 days and gets a 36 h recovery each week.
- A 12 h sector produces an augmented duty (CRP slot) when the `augmented` approval is present, and an illegal duty without it.
- Crew away from the first departure get deadheads in time, and the costs are posted.
- Delaying a flight by 4 h triggers `rerosterFrom`, which keeps the duty legal by swapping crew or flags it.
- Hiring 2 FOs shows them as `joining` and then `available` after `hireDays`.

**Tests to add:** FDP tables, rest, cumulative windows, recovery, an auto-roster fixture (14-day season base), augmentation, deadheads, hire/training timing, determinism of the roster.

**Dependencies:** none blocking. Uses flights from core or fixtures.

---

## B3: Operations, maintenance, finance, events, goals, market

**Owns:** `src/engine/ops/*` (index, flights, maintenance, finance, events, goals, market, company, plus tests), the BAL "operations, maintenance, finance" block, and `scripts/acmi-bot.ts` (run with `npx tsx`).

**Implement** (DESIGN §5.5–5.11):

| Function | Notes |
|---|---|
| `onFlightDep` / `onFlightArr` | Full state machine: readiness, random delay (once), technical delay → AOG, ripple, crew check (`rerosterFrom`), costs, stats, reputation drift, `deferred` drift. |
| `delayFlight(g, flightId, minutes, reason)` | Player delay with ripple. |
| `pruneFlights(g)` | Daily: drop flights done more than 40 days ago. |
| `checkStatus(g, ac) → CheckStatus` | A/C due by FH and calendar, next planned, risk. |
| `scheduleCheck / cancelCheck / planChecks / onMaintStart / onMaintEnd / aogChance` | §5.6; maintenance ferries via `planPositioning` (B1). |
| `onMonthEnd` | Rent, insurance, overhead, close and open statements, `bestMonthProfit`, statement message, `requestPause('monthEnd')`. |
| `onPayment / dailyFinance / cashForecast` | Receivables, late payers, solvency → rescue decision → `gameOver`. |
| `dailyEvents`, `resolveDecision`, `onDecisionExpire` | Event table §5.8. Resolvers keyed by `decision.kind`: `crewShort`, `sickCrew`, `aog`, `latePayment`, `rescue`. |
| `GOALS`, `checkGoals` | 7 goals with real progress. |
| `refreshMarket / acquireAircraft / onDelivery / onLeaseEnd` | §5.10. |
| `APPROVALS / applyApproval / onApprovalDone / setPolicies` | §5.11. |
| `scripts/acmi-bot.ts` | Headless year (DESIGN §7.3) with targets and a printed monthly table. |

**Acceptance**
- Delays ripple without breaking turn minima. On-time stats and `reliable` move.
- An AOG pauses the clock (setting on), posts the 4-option decision, and blocks departures until resolved.
- A-checks are auto-booked into idle nights before they fall due. A C-check warns at 90/60/30 days.
- Month end: the statement has every fixed line exactly once. Charter fuel and fees appear only on charter, ferry and non-billable positioning legs.
- Government receivables mostly pay late with a message. The rescue flow triggers after 30 days of negative cash.
- The bot runs 365 days in under 10 s and meets the targets in §7.3. Its output goes in the report.

**Tests to add:** state machine and ripple, AOG blocking, check planning, month-end lines, receivables, rescue, 90-day determinism.

**Dependencies:** B2 `rerosterFrom` (stub OK). B1 `planPositioning` (stub returns null, so book checks only at the current airport until B1 lands). B1 `generateOffer` for urgent evacuation events.

---

## B4: Ops Map & live view

**Owns:** `src/ui/map/*` (WorldMap.tsx, OpsMap.tsx, plus new layer and panel files), `src/styles/acmi/map.css`, and may retire `src/styles/touch/map.css` rules that only served the old network map.

**Implement** (DESIGN §6.2, §6.5):
- **Aircraft layer.** Make the skeleton's `AircraftLayer` production quality:
  - livery colour;
  - registration labels at zoom ≥ 2;
  - parked fan-out;
  - maintenance and AOG badges;
  - tap/hit areas of at least 44 px;
  - 30 fps cap on touch;
  - freeze while a modal is open;
  - no React render per frame.
- **Terminator.** A night polygon from the subsolar point, updated every 10 game minutes (`liveMinute()`).
- **Arcs.** For the selected aircraft: current leg solid, next legs faint, positioning dashed.
- **Offer pins.** For open offers (`g.offers`, status `open`), with a static ring for urgent ones; tap → offer panel.
- **Panels** (right side, 360 px, `revealPad`):
  - Aircraft: current flight with progress, ETA UTC/local, crew on board (via `flightCrewStatus`, crew names), next legs (`nextFlight` / `flightsOf`), check status (`checkStatus`), "Open in Schedule".
  - Airport: our aircraft, crew resting there, offers, local time.
  - Offer: summary and "Review offer" → `store.openModal({kind: 'offer', offerId})`.
- **Fleet strip** (bottom left) and an optional "up next" card.
- **Fit.** Fit to the operating area. Re-fit only on explicit reset, never automatically while the player pans.
- **WorldMap.** Keep it backward compatible (`Title` uses it). The `layers` render prop is the extension point; add more props as needed.

**Acceptance**
- At 1180×750 touch, with `demoFlights(3)` at 4×:
  - planes glide smoothly along great circles and take off and land at their actual times;
  - the parked aircraft are distinct and tappable;
  - the terminator moves in steps.
- No console errors. Frame cost under 1 ms for the map layers in the Chrome performance panel with 10 aircraft (`demoFlights` on a 10-aircraft dev fleet: add `store.dev` helpers through B5 or the orchestrator).
- Selecting an aircraft, airport or offer opens the right panel. The map pans the selection out from under the panel.
- Calm: no element animates except planes and the terminator steps.

**Dependencies:** read-only APIs from B1/B2/B3 (stubs return empty or zero, so show empty states). Works today with `demoFlights`.

---

## B5: Screens, shell, modals

**Owns:**
- `src/ui/screens/*` (Contracts, Schedule, Crew, Fleet, Finance, Company, Inbox, NewGame, Title, Loading; delete Placeholder.tsx when done);
- `src/ui/modals/*` (OfferModal, DecisionModal, plus HireModal, CheckModal, ConfirmCancel, etc.);
- `src/ui/shell/Shell.tsx`, `src/ui/game/Modals.tsx`, `src/ui/game/Toasts.tsx`;
- `src/styles/acmi/screens.css`, `src/styles/acmi/shell.css`;
- `ui/store.ts` additions (Nav views, ModalSpec kinds, `dev` helpers).

**Implement** (DESIGN §6.1, §6.3–6.5):
- **Contracts:** Market / Active / Missed. Offer cards with expiry countdown (hourly), requirement and risk chips. Active rows with MGH bar (`contractProgress`) and cancel confirm (`cancelPenalty`).
- **OfferModal:** terms, schedule list, `feasibilityAll` list with traffic lights and expandable checks, Accept / Counter / Decline.
- **Schedule Gantt:** rows per aircraft, zoom 3d/7d/28d, contract colours (define the 8-colour palette as CSS variables `--k0…--k7` in `screens.css` and export the hex list from a small `ui/screens/palette.ts` for B4), positioning hatch, maintenance stripes, crew-status corner, today line, virtualised blocks, tap → detail sheet.
- **Crew:** staffing strip, filterable list with limit bars (`crewWindows`), detail with a 14-day roster (`rosterOf`), Hire modal (`hireQuote`/`hireCrew`), Train (`trainCrew`).
- **Fleet:** aircraft cards (art via `AircraftArt` with `typeId`; aliases resolve automatically), ownership, hours, A/C bars (`checkStatus`) with a check-planning modal (`scheduleCheck`), plus the aircraft market (`acquireAircraft`).
- **Finance:** KPIs, statement table (`history` plus `current`, using `statementTotals`), cash forecast chart (`cashForecast`, `LineChart`), receivables.
- **Company:** reputation, approvals (`APPROVALS`, `applyApproval`), policies (`setPolicies`), goals (`GOALS`).
- **Inbox:** decisions pinned, messages with category filter, mark read, deep links via `ref`.
- **DecisionModal:** option chips, expiry time, default option marked.
- **Shell polish:**
  - the speed-control tooltip shows `store.pauseReason`;
  - Settings get all `autoPause` toggles;
  - New Game polish.

**Acceptance**
- Every tab renders at 1180×750 and 1180×820 touch with no horizontal overflow and no element under 40×40 that is tappable (run a Playwright smoke script like `scratchpad/shots.cjs`).
- No console errors, with empty data and with real data.
- While running at 4×, screens re-render at most about twice a second: verify with a render counter in dev. Nothing flickers.
- Accepting an offer from OfferModal shows the new flights in the Gantt and the active contract card.

**Dependencies:** every engine API. Build against the stubs plus `demoFlights` first, then wire to real data as B1–B3 merge.

---

## Integration checklist (orchestrator, after all merges)
1. `npx tsc --noEmit && npx vitest run && npx vite build`.
2. `npx tsx scripts/acmi-bot.ts 1 365` meets the targets.
3. iPad shots at 1180×750 and 1180×820: New Game → Ops Map → every tab → OfferModal → DecisionModal.
4. Save, reload and continue: same state, clock and queue.
5. Update `README.md` and the PWA manifest name and description for the ACMI game. Release to `play/`; the classic game stays at `/Game/classic/`.
