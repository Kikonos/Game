# CONTRAIL ACMI: technical design (v0.5)

This document turns BRIEF.md (direction) and RESEARCH.md (facts) into an architecture that 4–5 builders can implement in parallel. The skeleton in `src/` already compiles, runs and implements everything marked **(done)**. Everything marked **(B1)…(B5)** is a builder's job; BUILD-PLAN.md lists owned files, signatures, acceptance criteria and tests for each builder.

The source of truth for data shapes is `src/engine/core/types.ts`. This document explains them and does not repeat every field.

---

## 1. Principles

1. **One deterministic simulation.** All game logic lives in `src/engine/`, has no React, DOM or wall-clock dependencies, and draws all randomness from the seeded RNG in the save (`core/rng.ts`, mulberry32 on `g.rng`). The same seed and the same player actions produce the same game. `Math.random` and `Date.now` are banned in the engine. The only exception is the default seed in `createGame`.
2. **Integer minutes, event-driven.** Game time is an integer count of minutes. Nothing ticks per minute. A binary heap of timed events (departures, arrivals, duty starts, check ends, payments, offer expiries, the daily rollover) is drained in time order up to the current frame's target minute.
3. **Plain JSON state.** `GameState` is serialisable as it is. Entities are stored as id-keyed records, which keeps lookups cheap and insertion order deterministic. Runtime indexes, such as flights per aircraft, live in WeakMaps and are rebuilt on demand, so they are never saved.
4. **Modules talk through functions, not shared mutable caches.** Each builder owns a module folder with a public `index.ts`. Cross-module calls go through those exports. Signatures are fixed in the skeleton now, so callers can code against stubs before the implementations exist.
5. **Calm UI.** React re-renders while the clock runs at most once per game hour, plus on player actions, pauses and new messages. Only aircraft positions, the terminator and the Gantt today line move every frame, imperatively with no React render.

---

## 2. Game state model

### 2.1 Root (`GameState`)

| Field | Type | Owner | Notes |
|---|---|---|---|
| `version`, `seed`, `rng`, `seq` | numbers | core | `seq` is the id and queue-sequence counter (`nextId`). |
| `now`, `started` | `Minute` | core | Minutes since EPOCH = 1 Jan 2000 00:00 UTC. The default start is 1 Mar 2027 00:00 (`START`). |
| `scenario` | string | core | `'startup'` in v0.5. |
| `company` | `Company` | B3 (policies, approvals), core (cash via ledger) | Name, code, ICAO designator, callsign, livery, home base, registration prefix, **cash**, reputation `{reliable, clean}` 0–100, approvals, pending approvals, policies, departments (placeholder), next own flight number. |
| `fleet` | `Record<id, Aircraft>` | B3 (state), B1 (assignment via flights) | |
| `crew` | `Record<id, CrewMember>` | B2 | |
| `flights` | `Record<id, Flight>` | B1 creates, B3 executes, B2 attaches crew | All legs of our aircraft, plus `deadhead` tickets (one per crew group) and sub-chartered legs (`operatedBy`), both with aircraftId `null`. |
| `duties`, `pairings`, `deployments` | records | B2 | |
| `clients`, `offers`, `contracts` | records | B1 | |
| `maintenance` | `Record<id, MaintenanceEvent>` | B3 | |
| `hires`, `training` | arrays | B2 | |
| `messages` (newest first, max 300), `decisions` | arrays | any module posts through `core/messages.ts`; B3 resolves decisions | |
| `finance` | `{ current, history[], receivables[] }` | core primitives, B3 logic | |
| `market` | aircraft offers, fuel price, demand indexes | B3 | |
| `rivals` | `Rival[]` | B1 seeds | Names for lost offers; sub-charter operator in AOG and crew-short recovery (§5.8). |
| `goals` | `{id, done}` | B3 | |
| `stats` | lifetime counters | B3 | |
| `queue` | `SimEvent[]` heap | core | |
| `gameOver` | `{t, reason}` or null | B3 | |

### 2.2 Entities (summary of `types.ts`)

**Aircraft.** `reg`, `typeId` (an `ACMI_TYPES` id), `ownership` (`owned {bookValue}` or `dryLeaseIn {lessor, rentPerMonth, reservesPerFH, leaseStart, leaseEnd}`), `builtYear`, airframe `hours`/`cycles`, `maint {fhSinceA, lastA, fhSinceC, lastC, deferred 0–1}`, `cabin {j, w, y, total, label, layout}`, `etops` (airframe capability), `at` (airport it is at or departed from), `flightId` (set between off-blocks and on-blocks), `status` (`available | flying | maintenance | aog | delivering | stored | leasedOut`), `maintId`, `deliveredAt`.

**Client.** A fictional name from `data/naming.ts`, `kind`, country, base airport, payment behaviour (`payReliability`, `lateDays`), `cleanSensitivity` and `relation`.

**ContractOffer.** `archetype`, `clientId`, optional `broker`, `title`/`blurb`, `product`, `requirements`, `pattern`, `start`/`end`, `created`/`expires`, `urgency`, `penalties`, `payment`, `effects {reliable, clean, morale}`, `risk {payment, disruption, politics, permit}`, estimates (`estBH`, `estValue`), hidden `floor` (the counter-offer walk-away multiplier), optional `counter`, `status` and `pin` (map airport).

- `Product` is one of:
  - `wet {ratePerBH, mghPerMonth, excessRate, cycleFee, positioningBillable}`;
  - `charter {price, depositPct, balanceDaysBefore, fuelEscalation}` (we pay fuel, fees and hotels);
  - `dry {rentPerMonth, reservesPerFH}` (later).
- `Requirements` holds `minSeats`/`maxSeats`, `layout`, `body`, `families`, precomputed `longestSectorNm` and `minRunwayM`, `etops`, `approvals`, `extraCabin` and `noTechStops`.
- `SchedulePattern` is one of:
  - `legs` (explicit `LegTemplate {from, to, dep, flightNo, pax}`), used for ad hoc, sports, repatriation, tour series and troop rotations;
  - `base {base, dests[], from, to, targetBH, waves[] (local minutes), prefix, maintEvery}`, used for season bases and AOG cover, where flights roll out daily; `maintEvery` reserves a maintenance night every N days (§5.1.6).

**Contract.** Signed from an offer. It copies the commercial terms, adds `aircraftIds`, `signed`, `status` (`signed → active → completed | cancelled`) and `generatedUntil` (the rolling horizon for `base` patterns), and keeps `use[monthKey] = {blockMin, cycles, shortCycles}` and `billedMonths` for MGH billing. `mghPerMonth` is **per aircraft** (billing multiplies by `aircraftIds.length`, the contracted aircraft; a temporary swap does not change it). `balanceAt` is the charter balance invoice date. `color` is the Gantt colour index.

**Flight.** One block-to-block leg.
- `no`: the client's flight number on wet leases, our own (`ATW101`) otherwise.
- `kind`, one of:
  - `revenue`;
  - `positioning`: an empty leg tied to a contract, billable on wet leases;
  - `ferry`: non-revenue, e.g. maintenance or delivery;
  - `techstop`: a revenue sector split by a fuel stop, billed like revenue;
  - `deadhead`: a commercial ticket for a group of crew (`addDeadhead`), with `aircraftId` null.
- `std`/`sta` and `block`: scheduled times.
- `crewIds`, `dutyId`.
- `status`: `scheduled → enroute → done`, or `cancelled`.
- `atd`/`ata`: actual times.
- `delay`, `delayReason`.
- `ev`: the event version, bumped whenever times change.
- `cost`: the deadhead ticket price.
- `eta`: the arrival actually queued at departure (the map interpolates to it).
- `operatedBy`: the rival operating a sub-chartered leg (aircraftId null, still billed to our client).

**CrewMember.** Named (`first`, `last`), with `nationality` and `languages`.
- `role`: `CPT | FO | CRP` (cruise relief pilot) `| CSD` (cabin service director, the widebody SCCM) `| SCC` (senior cabin crew: SCCM on narrowbodies, No. 2 on widebodies) `| CC`.
- `ratings`: rating families; cabin crew may hold at most 3.
- `base`, `loc` (current airport) and `status`.
- `restUntil`.
- `log`: completed duties, pruned to 28 days, with `{start, end, fdp, block, sectors, augmented, disruptive}`.
- `blockYear`: calendar-year block minutes.
- `lastRecovery`: the end of the last 36 h recovery rest.
- `awaySince`: per diem and morale while away.
- `morale`, `fatigue`, `salary`, `hired`, `discretion` (uses this month) and `totalHours`.

**Duty** (one FDP) and **Pairing** (one crew complement's trip).
- A Duty has `report`/`release`, operated `flightIds`, ridden `deadheadIds` (commercial tickets or our own positioning legs), `sectors`, `fdp` vs `maxFdp`, `augment` (0/1/2 extra pilots), `restAt`, `legality` (`legal | tight | illegal`), `ev`, and `flightsEv` (the sum of its flights' `ev` at the last sync, for cheap change detection).
- A Pairing is one crew complement's chain of duties and holds the crew `slots: {role, crewId|null}[]`: either a **trip** from home base back to home base, or a **tour** at a deployment (`deploymentId`). The whole complement flies the pairing. Swapping single duties is v0.6.
- A **Deployment** is one crew station at a client base for a `base`-pattern contract: aircraft, window, `setsOnStation` and its tours (`pairingIds`). Sets rotate in and out every `policies.rotationWeeks` (§5.3).

**HireOrder / TrainingItem.** A hire creates a `joining` crew member at order time with a `ready` date. Training puts a crew member in `training` until `end` and then adds the rating or role.

**MaintenanceEvent.** `kind` (`A | C | AOG | line`), airport, `start`/`end`, `cost`, `status` (`planned → inWork → done`), `planned` (player or auto-planner, vs forced) and `ev`.

**Message / Decision.** A message has a tone, category, title, body, `read` and an optional `ref` to an entity. A decision has a resolver `kind`, `options[]` (label, description, tone and chips such as "−$12K" or "Morale −3"), a `defaultOption` applied at `expires`, a `ref` and a `data` bag.

**Finance.**
- `current: MonthStatement {month, lines: Partial<Record<LedgerCat, number>>, bh, cashStart, cashEnd, closed}`. Revenue lines are positive and cost lines negative.
- `history[]`: up to 60 months.
- `receivables[]`: `{clientId, contractId, desc, amount, issued, due, payAt (hidden), paid, cat}`.

**Market.** `aircraft: AircraftOffer[]` (scarce dry-lease-in or purchase offers with lead times), `fuelPrice` and `narrowIndex`/`wideIndex`.

### 2.3 Startup scenario (done, `engine/newGame.ts`)
- **Fleet:** two A320ceo with 180Y cabins at the chosen base:
  - one owned, built 2006, book value $9.5M, higher deferred-defect level, C-check about 15 months ago;
  - one dry-leased in, built 2013, $228k/month plus $380/FH reserves, lease to Mar 2031.
- **Crew:** 60 named crew, rated A320, at base. That is 10 CPT, 10 FO, 10 SCC and 30 CC, or 10 complete A320 complements (2 pilots + SCCM + 3 CC; the narrowbody SCCM is an SCC), about 5 sets per aircraft. Names follow the base's crew mix (`data/names.ts`).
- **Cash:** $3.0M (`BAL.startCash`). Fixed costs are about $0.87M a month (rent $228k, insurance $84k, overhead $280k, salaries with on-costs about $274k), which gives about 3.5 months of runway.
- **Reputation:** reliable 60, clean 70. No approvals.
- **Maintenance clock:** the owned A320 starts 520 FH and 70 days into its A-check interval (750 FH / 120 days), so its A-check falls due around 20 April, inside the first summer programme. Base patterns reserve maintenance nights for exactly this (§5.1.6).
- **Bases:** LIS (default), VNO, MLA, MAD, RIX. The registration prefix comes from the base country (CS-, LY-, 9H-, EC-, YL-).

---

## 3. Time model

### 3.1 Clock
- `g.now` is an integer number of minutes since EPOCH (UTC). The calendar helpers are in `core/time.ts`: `fromUTC`, `monthKey`, `monthStart`, `dayStart`, `fmtDate`, `fmtTime`, `fmtDuration` and others.
- **Local time:** `localOffset(airport, t)` combines the country's standard offset (`data/timezones.ts`), per-airport overrides (Canaries, Azores, Perth…), longitude bands for the US and Canada, and northern-hemisphere DST rules (EU: last Sunday in March to last Sunday in October; US: second Sunday in March to first Sunday in November). Southern-hemisphere DST is ignored in v0.5. FTL reference times, local nights, wave departure times and panel labels all use it.
- **Speeds:** 1× = 1 game day per 60 s (1 game hour = 2.5 s), 2× = 30 s per day, 4× = 15 s per day, plus pause. `MS_PER_DAY` and `minutesPerMs(speed)` hold the conversion. There is no 10×.

### 3.2 Event queue (done, `core/queue.ts`)
- `schedule(g, t, type, id, v)` pushes `{t, seq, type, id, v}` onto a min-heap ordered by `(t, seq)`. `seq` comes from `++g.seq`, so ties resolve in insertion order and the result is deterministic.
- **Stale events:** entities that can be re-timed (Flight, Duty, MaintenanceEvent) carry `ev`. Rescheduling bumps `ev` and queues a new event. Handlers ignore events whose `v` no longer matches. We never search the heap to delete events.
- **Event types:**
  - `day` (00:00 UTC; the core dispatches `month` first when the day is the 1st);
  - `flight.dep`, `flight.arr`;
  - `duty.report`, `duty.release`;
  - `maint.start`, `maint.end`;
  - `offer.spawn`, `offer.expire`, `offer.reply`;
  - `contract.start`, `contract.end`;
  - `crew.join`, `training.done`;
  - `payment`;
  - `aircraft.delivery`, `lease.end`;
  - `approval.done`;
  - `decision.expire`.

### 3.3 Dispatch (done, `engine/sim.ts`)
`advanceTo(g, target)` pops every event with `t ≤ target`, sets `g.now = ev.t` and calls each module's handler for that type. Modules are `[ops (B3), contracts (B1), crew (B2)]`. Order matters:

- **Most events run ops → contracts → crew.** On `flight.arr`, ops parks the aircraft and books costs, contracts counts billable block time, and crew moves the crew and writes their logs. On `day`, ops runs maintenance planning and random events, contracts extends schedules, and crew rosters the new horizon days.
- **`month` runs crew → contracts → ops.** Crew posts salaries, contracts invoices the closing month, and ops posts fixed costs and closes the statement last. All of these posts land in the closing month because ops swaps `finance.current` at the very end.
- **Pauses.** Handlers and actions call `requestPause(reason)` (`decision | urgentOffer | aog | monthEnd | contractStart | crewShortage`); every reason raised is kept in a set. `advanceTo(g, target, honour)` clears stale requests when it starts and takes the set after each event. If it holds a reason in `honour` (the reasons the store's settings enable), `advanceTo` returns early with `g.now` at that event and the highest-priority reason (`PAUSE_ORDER`: aog, decision, urgentOffer, crewShortage, contractStart, monthEnd). Reasons outside `honour` are dropped, so `monthEnd` can't mask an `aog` raised on the 1st and nothing leaks into a later event. Tests and the bot omit `honour` (every reason stops). `store.act` clears requests before the action and honours the ones it raised (e.g. `crewShortage` after accepting an offer).
- **Settle.** After every event and every player action the core calls each module's `settle(g)` (§4.2). Crew uses it to re-sync duties with flights other modules changed.
- **Self-scheduling.** After dispatching a `day` event, the core queues the next one. Modules queue their own events.

### 3.4 Frame loop (done, `ui/store.ts`)
Each `requestAnimationFrame` (dt capped at 100 ms):
1. If the game is paused, a decision is blocking (setting), or a modal is open, do nothing.
2. `exact += dt × minutesPerMs(speed)`, then `target = floor(exact)`.
3. If `target > g.now`, call `advanceTo(g, target, honoured)`. On a pause, set `paused = true`, `pauseReason`, snap `exact = g.now` and play the alert sound.
4. Call `emit()` (React refresh) only when a game hour boundary was crossed, the clock paused, or new messages arrived. Player actions (`store.act`) always emit.
5. The clock label has its own subscription and changes only every `CLOCK_STEP[speed]` game minutes (10/15/30), which keeps it at about 3 Hz or slower.

The map does not use React for motion. It reads `liveMinute()` (`store.exact`, a fractional minute) in its own rAF and interpolates along the great circle between actual off-blocks and `eta`, the arrival queued at departure (`aircraftLive(g, ac, t)` in `core/query.ts`), so planes never hover at the destination or snap on arrival. Positions therefore glide smoothly even though the simulation advances in whole minutes.

### 3.5 Performance budget (iPad A16, 10 aircraft, 300 crew, 2,000 scheduled flights)

| Work | Budget | How |
|---|---|---|
| `advanceTo` per frame | < 0.3 ms typical | 0–2 game minutes per frame; O(log n) heap; handlers touch one entity |
| Map aircraft layer per frame | < 0.5 ms | ≤ 10 glyphs, `setAttribute` only, 30 fps on touch |
| Terminator | < 0.5 ms per frame | One `geoCircle` path recomputed in the map rAF at ≤ 30 fps, so it glides instead of stepping |
| React refresh (hourly emit) | < 8 ms | At 4× this happens about 1.6 times a second; screens memoise derived data on `flightsRev(g)` and `store.version` |
| Daily rollover (`day`) | < 8 ms | Roster only open slots in the new horizon day; extend base patterns by one day; prune |
| Player actions (accept, auto-roster all) | < 150 ms | Off the animation path, once |

The steady-state target is under 4 ms of JS per frame. The flights-per-aircraft index (`flightsOf`) is rebuilt only after `touchFlights` (every helper in `core/entities.ts` calls it). B2 keeps its own crew → duties index, with the same pattern, in `crew/`.

### 3.6 Pruning and save size
- Done or cancelled flights are deleted daily (B3) once their month is billed and they are 7 days old, so about the last 5 weeks stay for the Gantt and panels. `contract.use`, `stats` and the statements keep the aggregates.
- Duties and pairings older than 28 days are deleted daily (B2), after their entries are in crew logs.
- Deadheads are one Flight per crew group (`addDeadhead`), not per person.
- Messages are capped at 300 and statements at 60 months.
- `serialize` drops stale queue events (`compactQueue`; handlers would ignore them anyway).
- **Budget.** At 10 aircraft on base patterns there are about 1,700 future flights plus recent ones, duties, pairings and 300 crew logs: roughly 1–1.5 MB of JSON after pruning. Target: under 300 KB compressed and under 100 ms per save on the iPad. The bot prints both every month and asserts the size. `saveToSlot` returns false on `QuotaExceededError` (Safari allows about 5 MB per origin, shared with the classic game's saves) and the store toasts once.

---

## 4. Module map and ownership

```
src/
  data/                       shared data (architect; builders append rows)
    acmiTypes.ts              ACMI parameters for 17 types (§7.2/7.3) + art look-alikes
    airports.ts               +27 mission/charter airports, runwayM on every airport; EXTRA_B1 / EXTRA_B3 sections
    timezones.ts              UTC offsets + DST rules
    names.ts                  crew name kit by nationality, crew mix per base
    naming.ts                 company presets, home bases, clients, brokers, rivals
    aircraft.ts, countries.ts, regions.ts, flavor.ts   (kept)
  engine/
    core/                     architect (bug fixes allowed, tell the orchestrator)
      types.ts                ALL state interfaces
      time.ts  queue.ts  entities.ts  query.ts  perf.ts  ledger.ts  messages.ts  pause.ts
      module.ts  balance.ts (BAL: each block owned by a builder)  rng.ts  geo.ts  util.ts
      core.test.ts
    sim.ts  newGame.ts  save.ts  dev.ts                 architect
    contracts/  (B1)  index offers pricing feasibility schedule accept billing clients
    crew/       (B2)  index ftl roster hr costs generate
    ops/        (B3)  index flights maintenance finance events goals market company
  ui/
    store.ts                  architect (B5 may add Nav views / ModalSpec kinds)
    shell/Shell.tsx           architect → B5
    map/WorldMap.tsx, map/OpsMap.tsx, map/* (new)      B4
    screens/*.tsx, modals/*.tsx                        B5
    screens/palette.ts        contract colours (B5 owns; B4 imports)
    game/Modals.tsx (menu, saves, settings), game/Toasts.tsx    architect → B5
    components/*              shared (kept); add new shared components in new files only
  styles/acmi/shell.css (architect→B5), map.css (B4), screens.css (B5)
scripts/acmi-bot.ts           B3 (headless year; `npm run bot`)
```

| Builder | Owns (writes) | Reads / calls |
|---|---|---|
| **B1 Contracts & commercial** | `engine/contracts/*`, the BAL commercial block, `data/naming.ts` (append) | core, `crew.crewAvailability`, `crew.autoRoster`, `crew.rerosterFrom` |
| **B2 Crew & HR** | `engine/crew/*`, the BAL crew block, `data/names.ts` (append) | core, flights/duties |
| **B3 Ops, maintenance, finance, events** | `engine/ops/*`, the BAL ops block, `scripts/acmi-bot.ts` | core (incl. `reassignFlights`, `subcharterFlights`), `contracts.generateOffer`, `contracts.planPositioning`, `crew.applyDiscretion`, `crew.replaceCrew`, `crew.rerosterFrom` |
| **B4 Map & live view** | `ui/map/*`, `styles/acmi/map.css` | `core/query.ts`, all module read APIs, `store.select`, `store.openModal({kind:'offer'})` |
| **B5 Screens** | `ui/screens/*`, `ui/modals/*`, `ui/shell/Shell.tsx`, `ui/game/*`, `styles/acmi/screens.css`, `styles/acmi/shell.css` | every module's public API |

**Shared-file protocol**
- `core/types.ts`: builders may add optional fields to interfaces in their domain section and must list them in their report. Renames go through the orchestrator.
- `core/balance.ts`: edit only your own block.
- `data/airports.ts`: append rows only to your own section (`EXTRA_B1`/`RUNWAY_B1`, `EXTRA_B3`/`RUNWAY_B3`).
- `ui/store.ts`: B5 may add `Nav.view` values, `ModalSpec` kinds and `dev` helpers. `dev.demoFlights(days)`, `dev.offer(archetype)` (live once B1 lands) and `dev.fleet(n)` already exist.
- `ui/screens/palette.ts` exists: B5 owns it, B4 imports it.
- `SAVE_VERSION` stays 1 until the first public release. New fields are defaulted with `??=` in the owning module's `load(g)`; nobody edits `newGame.ts` or `save.ts` for a field.
- Never edit `styles/app.css`. In `styles/touch/*`, the only allowed change is B4 deleting `touch/map.css` rules that served the old network map. Add everything else to your own `styles/acmi/*.css`.

### 4.1 Cross-module API (fixed signatures; stubs exist)

All mutating actions return `ActionResult<T> = {ok: true, msg?, data?} | {ok: false, error}` and are called from the UI through `store.act(g => fn(g, …))`.

**Core (done)**
```ts
nextId(g, prefix): string
addFlight(g, FlightInit): Flight            // aircraft legs; queues flight.dep
addDeadhead(g, {crewIds, from, to, std, sta, cost, contractId?}): Flight  // one per crew group; queues flight.arr only
retimeFlight(g, f, std, sta): void           // ev++, re-queue
cancelFlight(g, f, reason?): void
removeFlights(g, ids): void
reassignFlights(g, ids, aircraftId): void    // AOG swap: index, ev++, re-queue
subcharterFlights(g, ids, rivalId): void     // leg leaves our aircraft (operatedBy), still billed
markFlightsChanged / takeFlightChanges       // every helper above marks; crew's settle drains (§4.2)
flightsOf(g, aircraftId): Flight[]           // sorted by std, cached
touchFlights(g) / flightsRev(g)
ownFlightNo(g): string
schedule(g, t, type, id?, v?) / pop / peek / compactQueue(g)
post(g, cat, amount) / accrue(g, cat, amount) / cashOnly(g, amount)
invoice(g, {clientId, contractId, desc, amount, cat, dueDays, deferred?}): Receivable   // rolls payAt, queues 'payment'
pushMessage(g, {tone, cat, title, body, ref?}) / pushDecision(g, {...})
requestPause(reason) / clearPause() / takePause(honour?)
blockMinutes(typeId, from, to) / planSector(typeId, from, to): SectorPlan / runwayFit / maxSectorNm / etopsNeeded
cabinMinimum(seats) / complement(typeId, seats, {augment, extraCabin}): Role[] / canFill(slot, role) / reportMinutes(typeId)
aircraftLive(g, ac, t): AircraftLive / flightTimes(f) / nextFlight / flightsBetween / currentFlight
advanceTo(g, target, honour?): {events, pause, hourChanged} / settle(g)
createGame(opts) / serialize / deserialize / saveToSlot / loadFromSlot / listSaves
```

**B1 `engine/contracts`**
```ts
generateOffer(g, archetype?): ContractOffer | null
feasibility(g, offerId, aircraftId): FeasibilityReport
feasibilityAll(g, offerId): FeasibilityReport[]           // best first
acceptOffer(g, offerId, aircraftIds): ActionResult<{contractId}>
counterOffer(g, offerId, price, aircraftIds): ActionResult
declineOffer(g, offerId): ActionResult                     // done
cancelContract(g, contractId): ActionResult / cancelPenalty(g, contractId): number
contractProgress(g, contractId): ContractProgress
priceProduct(g, PriceInput): Product / productValue(product, estBH, start, end): number
generateFlights(g, contract): Flight[]
planPositioning(g, aircraftId, to, arriveBy, kind, contractId): Flight[] | null   // 1+ legs (fuel stops)
billContractMonth(g, contract, month): BillingLine[]
leadDays(g, start): number
```

**B2 `engine/crew`**
```ts
maxFdp(FdpInput): number / minRest(RestInput): number / LIMITS
crewWindows(g, crew, t): CrewWindows
checkAssignment(g, crewId, dutyId): LegalityReport / dutyLegality(g, duty): Legality
buildDuties(g, aircraftId, from, to): Duty[]
autoRoster(g, {from?, to?, aircraftIds?}): RosterResult
rerosterFrom(g, aircraftId, t): RosterResult
onFlightsChanged(g, aircraftId, fromT): void            // via crew.settle only (§4.2)
applyDiscretion(g, dutyId): ActionResult                // B3 crewShort decision
replaceCrew(g, pairingId, slot, crewId?): ActionResult<{crewId}>
removeCrew(g, crewId, from, to): RosterResult           // sickness, leave
assignCrew(g, pairingId, slot, crewId) / unassignCrew(g, pairingId, slot): ActionResult
rosterOf(g, crewId, from, to): Duty[]
flightCrewStatus(g, flightId): {level: 'ok'|'tight'|'missing'|'illegal', missing: Role[]}
hireQuote(g, HireRequest) / hireCrew(g, HireRequest): ActionResult<{crewIds}>
trainCrew(g, crewId, kind, family): ActionResult
crewAvailability(g, family, typeId, from, to, programmeBH): Availability   // capacity: need/free/short per role, firstShort
staffing(g): StaffingLine[]
makeCrewMember(g, role, family, base, status?) / crewName(c) / salaryFor(role, family)
```

**B3 `engine/ops`**
```ts
delayFlight(g, flightId, minutes, reason): ActionResult
checkStatus(g, ac): CheckStatus / scheduleCheck(g, aircraftId, kind, start, at): ActionResult<{maintId}> / cancelCheck
aogChance(g, ac, airport): number
resolveDecision(g, decisionId, optionId): ActionResult
monthProfit(statement) / cashForecast(g, days) / newStatement(month, cash)
GOALS: GoalDef[]
APPROVALS: ApprovalDef[] / applyApproval(g, id) / setPolicies(g, patch)
acquireAircraft(g, offerId): ActionResult<{aircraftId}>
```

**UI contract (store, done):** `store.act`, `store.update`, `store.navigate(tab, {sel, view})`, `store.select(ref)`, `store.openModal(spec)`, `store.toast`, `useGame()`, `useClock()`, `liveMinute()`, `store.pauseReason`, `store.dev.demoFlights(days)`, `store.dev.offer(archetype)`, `store.dev.fleet(n)`.

**Purity rule.** Every read or quote API is pure: `feasibility`/`feasibilityAll`, `contractProgress`, `productValue`, `crewAvailability`, `crewWindows`, `rosterOf`, `flightCrewStatus`, `staffing`, `hireQuote`, `checkStatus`, `aogChance`, `cashForecast`. No `g.rng`, no `nextId`, no `addFlight` or other writes. Feasibility plans positioning as `PositioningLeg[]` data, not flights. A quote that needs jitter uses `hashUnit(key + now)`, and the action stores the quoted value (a hire joins on the quoted date). `core/plumbing.test.ts` calls them 100 times and checks that the state JSON, including `g.rng`, is unchanged; builders add their read APIs to it.

### 4.2 Change propagation

Modules never write another module's state.
- **Flights** change only through the core helpers, which mark the aircraft as changed from the earliest affected minute. After the event or action, crew's `settle` calls `onFlightsChanged(g, aircraftId, t)`. It drops cancelled, removed, reassigned and sub-chartered flights from duties (and clears their `crewIds`), recomputes report, release and FDP for duties whose `flightsEv` changed, bumps `duty.ev`, re-queues `duty.report`/`duty.release`, and sends any duty that became illegal or uncovered inside the roster horizon through `rerosterFrom`. B3 never calls B2 after a retime.
- **Crew** changes that B3 decisions need go through B2: `applyDiscretion`, `replaceCrew`, `removeCrew`.
- **Contracts** change through B1 (`cancelContract`, `planPositioning`). An AOG swap is core `reassignFlights` (after `planPositioning` brings the other aircraft in); `contract.aircraftIds` stays the contracted set.

---

## 5. Algorithms

### 5.1 Contracts and commercial (B1)

#### 5.1.1 Offer arrival
- **Opening offers** (`init`): three hand-shaped offers at t = 0, so the first minutes have choices and the map has pins: an AOG cover starting within 24 h (urgent), an ad hoc charter 3–5 days out, and an April season base.
- **Process:** a Poisson process. The next gap is `−ln(U)/λ` days, where `λ = BAL.offersPerWeek/7 × fleetF × seasonF × repF`:
  - `fleetF = 0.7 + 0.15 × fleet size`;
  - `repF = 0.6 + 0.8 × reliable/100`;
  - `seasonF` by month, Jan–Dec: .7 .9 1.1 1.2 1.1 1.0 1.0 .9 .9 .9 .8 .9.
- **Where offers land:**
  - about 50% are **gap-fit**: dates inside an actual idle window of 2 days or more on a fleet aircraft (weekend sports, an ad hoc job between rotations), or follow-on work starting near a deployment's end at the same or a nearby base;
  - about 25% fit the fleet by seats and range on free dates;
  - about 25% are aspirational widebody or long-haul jobs that show the ladder.
- **Lifecycle:** each offer queues `offer.expire`. Non-urgent offers live at least 2 game days (30 s at 4×). Time is held while `OfferModal` is open (modals pause the clock), so reviewing never costs the offer. Urgent offers call `requestPause('urgentOffer')`. Expired, lost and declined offers stay visible for 14 days in a "missed" list, and the message names a rival from `RIVALS` ("Baltic Wingset took it").

#### 5.1.2 Archetypes (v0.5)

Duration is in days, lead is the time from creation to start, and expiry is the time from creation. Multipliers apply to the reference type's `rateBH`.

| Archetype | Client | Duration | Lead | Expiry | Product | Pattern | Effects | Payment |
|---|---|---|---|---|---|---|---|---|
| seasonBase | airline (HAM, DUS, DUB, ARN, ZAG, SPU, RIX, CMN, AMM) | 30–92 | 14–60 d | 3–7 d | wet ×1.0, MGH 200 NB / 250 WB per aircraft-month (pro-rata) | base: 4–8 leisure destinations 400–2,200 km from base, 2–3 waves from 06:00 local spaced by the longest rotation, maintenance night every 7 d (§5.1.6), targetBH = MGH × 1.1 | reliable +2 at completion if on-time ≥ 85% | monthly invoice, due 7 d |
| aogCover | airline | 2–10 | 2–24 h (urgent) | 3–8 h | wet ×1.5 (1.3–2.0), MGH 8 BH/day | base: 2–3 waves, maintenance night every 7 d | reliable +2, relation +10 | due 7 d |
| adhoc | tour operator, agency, corporate (often via broker, 5%) | 1–7 | 3–30 d | 2–4 d | charter (price §5.1.4) | legs: one-way or round trip (return 2–7 d later) | — | 30% deposit at signing, balance 7–14 d before departure, due 7 d |
| sports | club | 2–3 per trip; season variant 3–8 trips over 1–3 months | 7–60 d | 2–5 d | charter ×1.3, extraCabin +2 | legs: out the day before the match, back after the match at 23:00 local | morale +2 | as charter |
| repatriation | MFA of the base country | 1–5 | 24–72 h (urgent) | 4–12 h | charter ×1.5 + urgent premium | legs: 1–6 legs from a crisis airport (KBL, BKO, JUB, MGQ, BGF, GOM, LAD, OXB, TMS, DIL, BEY, ADA) to the capital | clean +2, reliable +1, morale +6 | arrears, due 30 d, governments pay late |
| tourSeries | tour operator (FRA, MAN, LIS, OSL) | 28–84 (weekly) | 30–120 d | 3–7 d | charter per rotation ×1.0 + pass-through | legs: same weekday out and back to a resort (TFS, LPA, FNC, SID, AYT, HER, PMI; CUN/VRA for widebody) | — | deposit + per-rotation invoice due 7 d |
| troopRotation | MoD of the base country | 30–90, 2–4 rotations | 30–90 d | 5–10 d | charter ×1.2, approvals `['dg']` from v0.6 | legs: home → mission airport (BKO, BGF, MGQ, JUB, DJI) with tech stops as needed | morale +2, clean −1 | arrears, due 45 d |

Repatriation and troop rotations carry `risk.permit` 0.3–0.8 (overflight and landing permits, shown as a "permit risk" chip). Permits are filed automatically; the risk only drives the permit-delay event (§5.8).

Client choice, destinations and dates come from the RNG. Pattern times are stored in UTC, converted from the client's local departure times with `localOffset`. Flight numbers:
- wet patterns use the client's prefix (`prefix + 3–4 digits`, deterministic per leg);
- charters use `ownFlightNo`.

#### 5.1.3 Reference type and estimates
- The **reference type** is the cheapest shortlist type that meets `minSeats` and can fly the longest sector (with tech stops unless `noTechStops`).
- **`estBH`:**
  - for `legs`: Σ `blockMinutes`/60 over the planned sectors, plus positioning from and to the client base when that base differs from ours (estimated from our home base);
  - for `base` patterns: targetBH × months.

#### 5.1.4 Pricing (RESEARCH §4)
- `R = ACMI_TYPES[ref].rateBH`.
- `m = 1 + season + lead + type + market`, where:
  - `season`: peak Jun–Sep +0.15; winter Nov–Mar −0.15 (except 15 Dec–6 Jan);
  - `lead`: under 72 h +0.35, under 7 days +0.25;
  - `type`: −0.15 for "unloved" types (A340, 757);
  - `market`: `narrowIndex − 1` or `wideIndex − 1`.
- **wet:** `ratePerBH = roundTo10(R × m × archetypeMult)`; `mgh` from BAL; `excessRate = 0.95`; `cycleFee = 900 / 1,800` for sectors under 90 min; positioning billable.
- **charter:** `price = roundTo1000((acmiHours × R × m × archetypeMult + passThrough) × 1.08)`, where `acmiHours` includes positioning and empty legs and `passThrough = Σlegs (fuelTBH × BH × fuelPrice + airportFees + catering) + crew hotel nights × hotelPerNight + crew per diems`. The result lands at about 2–3.5× the ACMI rate per BH, as RESEARCH says.
- **Broker:** commission 5% is deducted when invoiced.
- **Counter-offers:** `floor ∈ BAL.counterFloor` is rolled at creation. A counter up to `asking × floor` is accepted with `p = 1 − 0.5 × (price/asking − 1)/(floor − 1)`. Anything above is refused. The reply arrives after `counterReplyHours` (`offer.reply`). If that is after expiry, a rival may win it instead (25%).

#### 5.1.5 Feasibility (per aircraft)
Each check returns `ok | warn | no` with a label and a detail. The report level is the worst check.

1. **seats:** `cabin.total ∈ [minSeats, maxSeats]`, else `no`. A layout mismatch is `no` (reconfiguration is v0.7).
2. **family:** must be in `requirements.families` when that is set.
3. **range:** `planSector` for every revenue sector. Direct is `ok`, tech stops are `warn` (`no` when `noTechStops`), impossible is `no` and the label says why (range or runway).
4. **runway:** any `no` fails; `limited` is `warn` ("payload-limited at DIL"). The Dili case comes out right: a 777 is `no`, a 767 is `limited` with stops (tested).
5. **etops:** take the maximum `etopsNeeded` over the sectors. It is `ok` if 0, or if the company holds an approval of at least that level and `type.etopsMax ≥ need`; otherwise `no`, naming the approval needed. Four-engine types bypass ETOPS.
6. **approvals:** `requirements.approvals ⊆ company.approvals`.
7. **lease:** a lease ending before `end` is `no`. An aircraft that is `delivering` after its first positioning departure is `no`.
8. **availability:** any non-cancelled flight or maintenance event in `[posIn.std − turn, lastArr + posOut.block + turn]` is `no`, with the conflicting ids listed.
9. **positioning:** where the aircraft is just before the programme (the `to` of its last flight before start, else `at`). If that differs from the first departure, plan `posIn` (one or more legs via `planSector`: A320 LIS→KBL is 3,661 nm against 2,565 nm usable, so it needs a fuel stop; each leg is an FTL sector and billable on wet) so it lands at least `turnMin` before the first departure and departs at least `turnMin` after the previous commitment. If it cannot depart after `g.now + 60`, the check is `no` ("can't get there in time"). Plan `posOut` back to home base, or to the next commitment's start.
10. **maintenance:** an A-check falling due inside the window is `warn` ("plan an A-check at …"). A C-check due inside the window, or an overdue one, is `no`.
11. **crew:** `crewAvailability(family, typeId, posIn start, posOut end, estBH)` measures **capacity, not idleness**: free crew-days per role over the window after existing pairings, days off and the 100 h/28 d block limit, against the programme's need (RESEARCH §5.3: BH × crew per flight / 80–85 h per person-month, × 1.2 for leave and sickness).
    - a shortfall is `warn` with role, count and the date it bites ("hire 2 FO by 12 May"), never `no`, because the player can hire or deadhead crew;
    - any duty that needs augmentation requires the `augmented` approval, else `no`.
12. **estimates:**
    - `estRevenue = productValue`;
    - `estCost` (variable only) = maintenance/BH × BH + per diems + hotels (charter only) + deadhead tickets + charter pass-through (fuel, fees, catering) + positioning fuel when not billable;
    - `estMargin = revenue − cost`, labelled "contribution".

`feasibilityAll` sorts by level, then by margin.

#### 5.1.6 Flight generation (on accept)
- **`legs` pattern:** for each template, `planSector` splits it into one or more legs. The first leg departs at the template time and each next leg at the previous arrival + `TECH_STOP_MIN`. The first leg keeps `kind 'revenue'` and the fuel-stop legs are `'techstop'`. Same-aircraft sequences enforce `std ≥ prev.sta + turnMin`. If a client time violates that, shift later and flag it in the blurb. Never shift earlier.
- **`base` pattern:** generate each day from `max(from, now)` to `min(to, now + scheduleHorizonDays)`, then set `generatedUntil`.
  1. **Wave times** are computed at offer creation from the route, not fixed: wave 1 departs 06:00 local; each next wave departs at the previous wave's latest return (longest destination: out + `turnMin` + back) + `turnMin`, while it departs by 21:00 local; at most the archetype's 2–3 waves. Longer routes get fewer waves instead of colliding (HAM–PMI: 06:00, about 12:30, 19:00).
  2. Each day and wave picks destination `dests[(dayIndex × waves.length + w) % dests.length]`; out STD = wave local time → UTC; back STD = out arrival + `turnMin`.
  3. **Maintenance nights:** every `maintEvery` days (7) the last wave is not flown (the last two if one still leaves less than `aCheckHours` + 2 h on the ground before the first wave). These are contractual, as in real ACMI deals; MGH still applies.
  4. **Hitting targetBH:** with `F` the month's block hours for the full pattern after maintenance nights, `T` the pro-rated targetBH and `r` the mean rotation block, drop `n = max(0, round((F − T)/r))` rotations: last waves first, spread evenly (day `k` drops one when `floor((k+1)·n/days) > floor(k·n/days)`), never on the first or last day; if `n` exceeds the days, the first wave goes too. Monthly block hours land within one rotation of `T`.
- **Positioning:** add `posIn` and `posOut` legs (`kind 'positioning'`, one or more with fuel stops, billable on wet). If an existing soft positioning leg (scheduled and not started) already covers the gap, re-plan it rather than adding a second one. `relinkPositioning(aircraftId)` keeps exactly one empty leg between consecutive commitments at different airports.
- **Events and side effects:** queue `contract.start`/`contract.end`, invoice the charter deposit, call `crew.autoRoster({aircraftIds})`, and post the message "Signed: …".

#### 5.1.7 Daily extension
`extendBaseSchedules` adds the next day for every active `base` contract. Waves whose rotation would overlap a planned maintenance event (booked at any horizon) are not generated. Crew's own daily job rosters the new day.

#### 5.1.8 Positioning helper
`planPositioning(g, ac, to, arriveBy, kind, contractId)`:
- finds the aircraft's location and free time before `arriveBy`;
- routes `from → to` with `planSector` (fuel stops when out of range) and schedules the legs backwards from `sta = arriveBy − turnMin`, with `TECH_STOP_MIN` on the ground at each stop;
- moves it earlier only if a later commitment forces that;
- returns the legs, or `null` when they can't fit.

B3 uses it for maintenance ferries (`kind 'ferry'`).

#### 5.1.9 Lifecycle
- `contract.start` → `active`.
- **Charter money:** the deposit is invoiced at signing and the balance at `balanceAt = start − balanceDaysBefore` (contracts' daily job; at signing when the lead is shorter). Both are `deferred` invoices: cash arrives before we pay fuel, but revenue is recognised as legs fly (`accrue('charterRevenue', price × leg BH / programme BH)` on `flight.arr`), so statements and goals count flown revenue only.
- `contract.end` is queued at the later of `end` and the last positioning-out arrival; while the contract still has scheduled or airborne flights (a delayed posOut), the handler re-queues itself. Then → `completed`:
  - final wet bill for the partial month, including the posOut leg;
  - reputation and relation effects;
  - `stats.contractsDone++`.
- **Cancelling by us** before start costs `value × cancelScale(days before start)`. An active wet contract costs 100% of unflown MGH for the rest of the term. Either way: future flights removed, reliable −5, client relation −30.

#### 5.1.10 Billing
- **Usage:** on `flight.arr`, for flights with a contract and kind `revenue | techstop` (sub-chartered legs included: the client got its flight), or `positioning` when wet and billable: `use[month].blockMin += ata − atd`, `cycles++`, and `shortCycles++` if the block is under 90 min.
- **`billContractMonth(contract, M)`** for wet contracts:
  1. MGH is per aircraft: `mgh = mghPerMonth × aircraftIds.length × activeDays/daysInMonth`; `flown = use[M].blockMin/60`;
  2. `amount = rate × max(mgh, min(flown, mgh)) + excessRate × rate × max(0, flown − mgh) + cycleFee × shortCycles`;
  3. deduct the broker commission;
  4. return the lines and mark the month billed.
- The contracts `month` handler calls it for every wet contract active in the closing month and issues invoices (`invoice`, `cat: 'acmiRevenue'`, due 7 days for commercial clients, 30 for governments).
- v0.5 bills monthly in arrears. Commercial weekly-in-advance invoicing is v0.6.

### 5.2 FTL legality (B2; RESEARCH §5.1, simplified)

**Reference time and acclimatisation** (EASA CS FTL.1.105, simplified). Crew start acclimatised to their base. With Δ the time-zone difference between base and the duty's departure airport, and `h` the hours since the crew first reported away from base on this trip:

| Δ | h < 48 | 48–72 | 72–96 | 96–120 | ≥ 120 |
|---|---|---|---|---|---|
| < 4 h | B | D | D | D | D |
| 4–6 h | B | X | D | D | D |
| 6–9 h | B | X | X | D | D |
| > 9 h | B | X | X | X | D |

B: report time read in base local time. D: acclimatised to the new zone, local time at the departure airport (`localMinuteOfDay`). X: unknown, no time-of-day credit (11:00). So a LIS crew at DIL uses LIS time on day 1, and a European deployment is D after 48 h.

**maxFdp(i)**
```
BASE by report time (local, 15-min bands):
  05:00 12:00 · 05:15 12:15 · 05:30 12:30 · 05:45 12:45 · 06:00–13:29 13:00 · 13:30 12:45 · 14:00 12:30
  14:30 12:15 · 15:00 12:00 · 15:30 11:45 · 16:00 11:30 · 16:30 11:15 · 17:00–04:59 11:00
base = state X ? 11:00 : BASE[band of the reference time]
fdp  = max(9:00, base − 0:30 × max(0, sectors − 2))
if augment > 0 and sectors ≤ 3:
  fdp = AUG[augment][restClass]    // +1: 14:00/15:00/16:00 (class 3/2/1) · +2: 15:00/16:00/17:00
  if sectors ≤ 2 and longestBlock − 20 > 9:00: fdp += 1:00   (cap 18:00)
```
- **Planned extensions (F2)** are not used by the auto-roster in v0.5.
- **Commander's discretion (F4)** happens only as an event: +2:00 (+3:00 augmented). The crew member's `discretion` count goes up by one, morale −3 and fatigue rise.

**Duty measures**
- `report = first operated std − reportMinutes.report` (60 narrowbody / 90 widebody). Cabin crew report with the pilots in v0.5.
- Positioning (deadhead) before operating moves `report` earlier and counts as FDP but not as a sector.
- `release = last on-blocks + post` (30/45).
- `fdp = last on-blocks − report`. Duty time = release − report, plus any deadhead home after.

**minRest(i)** = `max(dutyMin, atHome ? 12:00 : 10:00)`. It is 14:00 away after an augmented FDP or a time shift of 4 h or more.

**Cumulative limits** (from `log` plus planned duties; `LIMITS`)
- Duty: 60 h in 7 days, 110 h in 14 days, 190 h in 28 days.
- Block: 100 h in 28 days, 900 h in the calendar year (`blockYear`).
- Use rolling sums over sorted intervals: the clipped overlap of each duty with the window.

**Recovery.** Every 168 h needs a free period of at least 36 h that includes two local nights. Simplification: 36 h free, and the gap must contain two 22:00–06:00 base-local windows. It becomes 60 h when the crew flew 4 or more `disruptive` duties (report before 06:00, release after 23:00, or night) since the last recovery. Track `lastRecovery`. A duty is illegal if `report > lastRecovery + 168 h` and no qualifying gap exists before it.

**Days off.** The crew detail shows days off this month against the 7-per-month guideline; v0.5 does not enforce it beyond the 6-on/2-off work blocks (§5.3) and the recovery rule.

**Legality levels**
- `illegal` if any hard limit is exceeded.
- `tight` if FDP is within 30 min of max, or any cumulative total is above 95% of its limit.
- Otherwise `legal`.

`checkAssignment` also checks:
- status (not sick, leave, training or joining during the duty);
- rating;
- location (reachable by deadhead in time);
- no overlap with the crew member's other duties.

**Cabin crew complement.** `complement(typeId, seats, {augment, extraCabin})` (done) gives:
- cockpit: 2 pilots, CPT/FO/CRP with one extra pilot, or 2 CPT + 2 FO with two. ULR types get 4 pilots only on duties that need augment 2;
- cabin: `ceil(seats/50)` + `company.policies.extraCabin` + `requirements.extraCabin`, plus in-flight-rest cabin crew on long augmented FDPs with class 2/3 rest (+1 above 14:30, +2 above 16:00; F3; pass `fdp`). The SCCM slot is CSD on widebodies and SCC on narrowbodies, plus a widebody No. 2 (SCC) from 8 cabin crew; the rest are CC.

`canFill` lets seniors fly junior positions (CSD → SCC/CC, SCC → CC, FO → CRP).

### 5.3 Duties, pairings, deployments and the auto-roster (B2)

**Crew-change stations.** A duty may start or end only where the crew can rest: home base, the contract's deployment base, or a planned night-stop (the aircraft sits on the ground at least `minRest + report + post`). Never mid-rotation at an outstation: HAM–PMI–HAM changes crew at HAM, not PMI.

**`buildDuties(aircraft, from, to)`**
1. Walk the aircraft's non-cancelled flights in time order and cut them into **units** at crew-change stations. A unit is the legs between two visits to such a station: one out-and-back rotation on a base pattern, a whole multi-sector trip on an ad hoc job. Positioning and tech-stop legs belong to their unit.
2. A ground gap of at least `minRest + report + post` always ends a duty.
3. Partition each run of units into duties by dynamic programming, not first-fit: every duty legal at augment 0 (or 1/2 when the company holds `augmented` and the duty has at most 3 sectors); minimise the number of duties, then the augmentation, then maximise the slack (`maxFdp − fdp`) of the tightest duty. A unit too long for any legal duty becomes an `illegal` duty (feasibility should have stopped it).
4. Each duty gets its smallest legal augment and its `flightsEv`.
5. Only pairings without assigned crew are rebuilt; crewed pairings are kept and re-checked when their flights changed (`flightsEv`).

Example (A320 at HAM, 2 waves): a HAM–PMI rotation is 155 + 40 + 155 min. Waves 1 (06:00) and 2 (12:30) together would be a 4-sector duty of about 14:20 against 11:30, so the day becomes two 2-sector duties, both ending at HAM: crew A flies wave 1, crew B wave 2.

**Pairings** (one complement's chain of duties):
- **Trips** (`deploymentId null`) run from home base back to home base: ad hoc, charter series, positioning. A trip ends when a duty releases at base or after 6 consecutive duty days (then at least 2 days off, at the hotel if away).
- **Tours** (`deploymentId` set) are one crew set's stay at a deployment, from its arrival deadhead to its departure deadhead, at most `policies.rotationWeeks`. Inside a tour the set works blocks of at most 6 duty days, each followed by 2 days off at the hotel. The 6-day limit is a work-block rule inside the tour, not the end of the pairing.

**Deployments.** When a `base`-pattern contract is rostered, B2 creates one `Deployment` and its tours:
- `setsOnStation = max(ceil(peak duties per day × 8/6), ceil(block hours per 28 days / 85))`, plus 1 if the chaining below can't cover a day under `minRest` (HAM–PMI: 3 sets at 2 waves, 4 at 3 waves);
- tours are staggered so at most one set changes per day; each change is a deadhead pair (incoming set the day before, outgoing set home after its last duty);
- **chaining:** each day's duties, in report order, go to the on-station set that has been free longest (earliest `restUntil`) and is legal for it (rest, 6-on/2-off, cumulative limits); ties by set index. This deterministic round-robin interleaves early and late waves;
- each tour's people are chosen once for the whole tour, so a crew flies together.

**`autoRoster(opts)`** is greedy and deterministic. It runs over open pairings in `[from, to)`, sorted by start (default `now → now + rosterHorizonDays`; a tour is filled as a whole even when it runs past the horizon).

1. Fill slots in this order: CPT, FO, CRP, SCCM, No. 2, CC.
2. Candidates are crew that can fill the slot (`canFill`), hold the rating, are not unavailable during the pairing, and are legal for every duty of the pairing appended to their roster (incremental check with deadheads included). Tight duties count only if `policies.allowTight`.
3. Score each candidate:
   - `−deadheadCost(loc → first departure)`, where an existing deployment at that base counts as 0;
   - `−2 × block28d hours` (fairness);
   - `+30` if they flew this aircraft's or contract's previous pairing (crew family);
   - `−50` for overqualification (CSD in a CC slot);
   - `−(70 − morale)/2` if the mission is unpleasant (`effects.morale < 0`);
   - tie-break on crew id.
4. Take the best candidate. Crew who must travel get one ticket per group travelling together (`addDeadhead`):
   - departs at `report − 180 − block` rounded down to the hour and arrives at least 60 min before report;
   - block from `blockMinutes('a320ceo', …)` as a generic airliner;
   - ticket from `BAL.deadheadTicket` by distance, posted to `deadhead` at purchase; on wet contracts the client buys crew positioning tickets (RESEARCH §2.2), so there is no cost to us;
   - riding our own positioning leg is preferred when one exists (`Duty.deadheadIds`);
   - deadheads never get random delays in v0.5.
   Add a ticket home when the pairing ends away from base.
5. When a slot can't be filled, its flights go to `uncovered`. Within 48 h of departure: message, plus `requestPause('crewShortage')`.
6. Queue `duty.report`/`duty.release` for each assigned duty (v = duty.ev).

**Changes.** `onFlightsChanged` keeps duties in sync with flights (via settle, §4.2). `rerosterFrom(aircraft, t)` re-plans: it rebuilds duties from `t`, keeps crew where the new duty is still legal, and otherwise frees those slots and fills them again (crew already at the station first, i.e. "standby by location"). `removeCrew` takes a sick crew member out of every slot in a window and refills them; `replaceCrew` refills one slot; `applyDiscretion` raises one duty's limit (+2:00, +3:00 augmented; `discretion++`, morale −3, fatigue up).

**Crew handlers**
- `duty.report`: crew go `onDuty`, and `awaySince` is set if it was null.
- `flight.arr`: crew aboard move to `f.to`; for a deadhead (ops has already marked it done) the group in `f.crewIds` moves.
- `duty.release`: append to `log` (pruned to 28 days), add to `blockYear` and `totalHours`, set `restUntil = release + minRest`, and set status to `resting`. At base, `awaySince = null`. Update `lastRecovery` when the gap to the next duty is 36 h or more.

### 5.4 HR and crew costs (B2)
- **Hiring:**
  - `hireQuote(role, family, base, count)` (pure): cost = `BAL.hireCost` per person; ready = now + `BAL.hireDays[role]` × (0.8–1.2 from `hashUnit(role + base + now)`). `hireCrew` uses the quoted date. An unrated pilot needs a type rating as well.
  - `hireCrew` creates `joining` members (`makeCrewMember`) and charges `hiring` once. They show in the roster as "joining 12 Apr".
  - `crew.join` sets them `available` at base.
- **Training:**
  - type rating: pilots 35 days, $45k; cabin 7 days, $3k;
  - command upgrade FO→CPT: 42 days, $22k, needs 4,000 h;
  - SCCM course CC→SCC: 4 days.
  - `training.done` adds the rating or role and updates the salary.
- **Daily:**
  - per diem `BAL.perDiem[role] × policies.perDiemPct/100` (CPT $108, FO $76, cabin $54; RESEARCH §5.3) per crew member away (`awaySince ≠ null`) → `perDiem`;
  - hotel nights for crew resting away. Paid by us on charters, positioning and ferries; on wet leases the client pays hotels and crew tickets (RESEARCH §2.2), so there is no cost → `hotels`.
- **Monthly:** salaries × (1 + onCosts) → `salaries`.
- **Sickness:** daily, `p = 0.04/30 × (1 + max(0, 60 − morale)/100)` per crew member. Sick for 2–5 days; `removeCrew` for those days. If a slot can't be refilled: B3 decision `sickCrew`.

### 5.5 Flight execution (B3; skeleton has on-time version)

**`flight.dep`** (ignored if `ev` is stale):
1. **Aircraft not ready** (not at `from`, flying, maintenance or AOG): retime to `max(ready, std)`, where ready = previous on-blocks + turn, or maintenance end.
2. **Crew incomplete or illegal at departure:**
   - wait up to 2 h for re-rostering (`rerosterFrom`);
   - then decision `crewShort`: delay for a standby crew (`replaceCrew`), commander's discretion when the FDP overrun is ≤ 2 h (`applyDiscretion`), sub-charter the legs (§5.8), or cancel.
3. **Random delay** (once per flight, `delayReason` empty):
   - operational (ATC, weather, handling): chance `BAL.delayChance`, minutes exponential with mean 25, capped at 180;
   - technical: `0.006 × ageF`, mean 60 min; never becomes an AOG.
   - Apply with `retimeFlight`, then ripple to the aircraft's next flights so that `std ≥ prev.sta + turnMin`. Crew re-sync is automatic (§4.2).
   - Delays over 3 h on charters cost `penalties.perDelay`.
4. **AOG** (its own roll per departure with `aogChance`, §5.6):
   - create a MaintenanceEvent `AOG` at `from` lasting 12–72 h (+50% at outstations without our engineers);
   - aircraft status `aog`;
   - `requestPause('aog')`;
   - decision `aog` with the recovery menu (RESEARCH §5.7):
     - wait for the courier part (cheap);
     - fly in an AOG team ($8–15k, −40% time);
     - swap in another of our aircraft (B1 `planPositioning`, then core `reassignFlights`);
     - sub-charter the affected legs to a rival (§5.8);
     - cancel the affected legs (penalties, reliable −3).
5. **Otherwise depart:**
   - `status = enroute`, `atd = now`;
   - aircraft `flying` with `flightId`;
   - set `eta = atd + round(block × (1 ± 0.04 wind noise))` and queue `flight.arr` at `eta` (the map flies to `eta`).

**`flight.arr`:**
- flights without an aircraft (deadheads, sub-chartered legs): ops only marks them done (`atd = std`, `ata = now`, done in the skeleton); contracts bills sub-chartered legs and crew moves deadheaders;
- `status done`, `ata`; aircraft `available` at `to`;
- hours: FH = block − 20 min, cycles +1;
- `deferred += 0.0005 × ageF` per cycle;
- stats: on time if `ata ≤ sta + 15`; `reliable` moves ±0.05 per leg toward on-time performance.
- **Costs** (`post`):
  - maintenance `maintBH × (1 + 0.025 × max(0, age − 12)) × BH`. For dry-leased aircraft, `reservesPerFH × FH` of it goes to `reserves` and the remainder to `maintenance`;
  - on `charter`, `ferry` and non-billable `positioning` legs only: fuel `fuelTBH × BH × fuelPrice` and airport fees + catering.

**`delayFlight`** is the player-initiated version, e.g. "hold for a delayed VIP".

**`pruneFlights`** runs daily (§3.6).

### 5.6 Maintenance (B3)
- **A-check:** due at `aCheckFH` FH or 120 days, whichever comes first. Takes `aCheckHours` (one night: 8 h on A320/737/A321, 14–24 h on widebodies) at the home base or any airport with size ≥ 4. Cost `BAL.checkCost.A`.
- **C-check:** due at `cCheckMonths` or 7,500 FH (narrowbody) / 6,000 FH (767). Takes `cCheckDays` (narrowbody 14, widebody 18–28) at the home base. Cost `checkCost.C`.
- **Overdue:** a 10% tolerance is allowed. Beyond that the aircraft is grounded (feasibility `no`; departures cancelled).
- **`planChecks` (daily; auto-plans A-checks when `policies.autoMaintenance`):**
  - when the A-check is 85% used, find the first ground gap of at least `aCheckHours` + buffer (1 h at home base, 2 h elsewhere) at an eligible airport before it falls due, and book it (`scheduleCheck`). Base-pattern maintenance nights exist for this;
  - if the gap is away from base, use `planPositioning(…, 'ferry')` (B1);
  - if no gap exists, `scheduleCheck` may cancel specific revenue legs of a wet `base` contract with at least 12 h notice (RESEARCH §4.3: no penalty, MGH unaffected, relation −2); otherwise warn 7 days ahead.
  - C-checks are never auto-booked. At 90, 60 and 30 days the player gets messages with suggested windows (prefer November–March).
- **`maint.start`:** aircraft `maintenance`. **`maint.end`:** reset counters (`fhSinceA` → 0; a C-check resets both and `deferred` → 0; an A-check sets `deferred × 0.3`), post `checks`, aircraft `available`.
- **AOG chance per departure** (one roll, independent of technical delays): `BAL.aogBase × (1 + age/10) × (1 + 4 × deferred) × (outstation ? 1.5 : 1)` with `aogBase = 0.00025`. The owned 21-year-old A320 (deferred 0.12–0.3) on a season base (about 120 departures a month) gets about one AOG every 4–6 months, the 14-year-old leased one about one a year, in line with RESEARCH §5.7 (99.4% dispatch reliability, about 8% of technical delays become a 12 h+ AOG). The bot reports AOGs per aircraft-year (target 1–3 for the startup fleet).

### 5.7 Finance and cost model (B3; primitives done)
- **Money moves only through `core/ledger.ts`:**
  - `post`: statement + cash, for costs and cash revenue;
  - `invoice`: accrues revenue, creates the receivable and queues `payment` at `payAt`. `payAt = due + late`, where late is drawn with `1 − payReliability` from `lateDays`;
  - `cashOnly`: collections, deposits.
- **`payment`:** cash in, `paid = now`. A late payment gets a message ("Ministry of Foreign Affairs of Portugal paid 41 days late").
- **Daily:** overdue reminders at +7 and +30 days. Late interest (3%/yr) is flavour only in v0.5.
- **`month` (ops runs last):**
  - rent for dry-leased aircraft → `rent`;
  - insurance (`insuranceMonth` per aircraft) → `insurance`;
  - overhead (`overheadBase + overheadPerAircraft × fleet`) → `overhead`;
  - pending approvals spend nothing monthly;
  - close `current` with `cashEnd` and `bh`; push to history; open the next month;
  - post the statement message, `requestPause('monthEnd')`, and update `stats.bestMonthProfit`.
- **Solvency (fail forward):**
  - cash below 0 for 30 consecutive days → decision `rescue`: a private-equity injection of $2–4M for "25% of the company" (flavour), with a reputation cost;
  - a second insolvency after a rescue → `gameOver`.
- **Break-even check** (BAL defaults, A320 at $3,800/BH):
  - fixed per leased aircraft ≈ $546k a month (rent $228k + insurance $42k + overhead $80k + half the base overhead $60k + 5 crew sets $136k);
  - variable ≈ $1,100/BH (maintenance $900 including reserves, plus per diems);
  - so break-even ≈ 200 BH a month. An owned aircraft breaks even at about 130 BH.
  - This matches RESEARCH §4.5 (190–210 BH).

### 5.8 Events and decisions (B3)
`dailyEvents` and the departure hooks raise events. Pacing target: at least one meaningful player action per game week from day 1 (an offer worth answering, a decision, a hire, a check to plan), rising to 2–3 a week at 10 aircraft, with at most 2 decisions open at once (additional ones queue as messages).

| Event | Trigger | Decision options (default) |
|---|---|---|
| Delay | Departure roll | (message only) |
| Crew short / out of hours | §5.5.2 | Wait for standby crew (delay) · commander's discretion (+2 h, morale −3) · sub-charter · cancel the leg (penalty) |
| Sick crew | §5.4 sickness and refill failed | Deadhead a replacement (`replaceCrew`; $, hours) · fly with a blocked-seat minimum (narrowbody: offload to 150 seats) · delay |
| AOG | §5.5.4 | Courier part (default) · AOG team · swap aircraft · sub-charter · cancel |
| Client change request | Weekly per active contract (p 0.15) | Add a rotation or move a wave: accept (+revenue; crew and maintenance impact shown) · decline (relation −3) |
| Permit delay | 48 h before the first leg of a job with `risk.permit` (p = permit × 0.3) | (message: first leg retimed 6–24 h; permits are auto-filed, RESEARCH §10.1) |
| Season nudge | 1 Feb, 1 Mar, 1 Sep when an aircraft is idle 14+ days ahead | (message: tender season, link to the market) |
| Late payment | Receivable 30 days overdue | Wait (default) · factor the invoice at −8% now · threaten to suspend the contract (relation −20; the client pays within 7 days at 70%) |
| Urgent evacuation | `contracts.generateOffer(g, 'repatriation')` | (an offer, not a decision; it pauses through `urgentOffer`) |
| Month statement | `month` | (message) |
| Rescue | §5.7 | Accept the investor (default) · refuse (game over at −$2M) |

**Sub-charter** (AOG and crew-short menus; no market in v0.5): a rival from `g.rivals` operates the affected legs at the contract rate × U(1.2, 2.0) per BH (wet) or the pro-rata charter price × the same factor (RESEARCH §4.3, §5.7). Core `subcharterFlights` takes the legs off our aircraft (`operatedBy`); revenue stays ours because billing still counts them, the cost goes to `subcharter`, and `reliable` takes no hit. It is the default only when cheaper than the cancel penalty.

Every resolver is keyed by `decision.kind` in `ops/events.ts`. It applies its effects and removes the decision. Expiry applies `defaultOption`.

### 5.9 Goals (B3)
Goals are checked daily and posted as a `goal` message (a toast) with reliable +1:
- first contract;
- first $1M revenue month;
- 3 aircraft;
- first widebody;
- ETOPS 180;
- first long-haul duty with an augmented crew;
- first ULR sector.

### 5.10 Aircraft market (B3)
- **Monthly offers:** add `Poisson(0.8)` offers, plus two guaranteed: a narrowbody dry-lease-in (A320/737) in month 1–2, and an old 767-300ER or A330-200 by month 4–6.
- **Type choice:** weighted by `(1 − scarcity)` among tier ≤ 2 types from the start (widebodies are rare but possible); tier 3+ (777, A350, ULR) need reliable ≥ 70 and 4+ aircraft. The bot asserts that a widebody is acquirable within 12 months.
- **Lease terms:**
  - rent `rentMonth × U(0.9, 1.15) × index`;
  - 36–96 months;
  - deposit = 2 months of rent;
  - lead time 30–90 days (onto the AOC);
  - offer expires in 14–30 days.
- **Purchase:** narrowbody and old types only, at `valueUsed × U(0.85, 1.1)`.
- **Acquiring:** creates the aircraft in `delivering` status and queues `aircraft.delivery`. A new type needs rated crew before feasibility passes, which B2 training covers.
- **`lease.end`:** the aircraft must be at base and free. Otherwise the lease is extended month by month at +10% (message).

### 5.11 Company: approvals and policies (B3)
- **Approvals:** `applyApproval` charges the cost and creates `pendingApprovals`. When `approval.done` fires, the approval is granted. v0.5 subset:

| Approval | Cost | Time | Prerequisites |
|---|---|---|---|
| ETOPS 120 | $250k | 180 d | needs a twin capable of ETOPS 120 |
| ETOPS 180 | $350k | 365 d | ETOPS 120 |
| Augmented | $300k | 60 d | — |
| ULR | $900k | 270 d | augmented + ETOPS 180 + a ULR-capable type |
| IOSA | $180k | 240 d | 12 months of ops |
| DG | $60k | 60 d | — |

- **Policies** are edited on the Company screen:
  - per diem;
  - hotel tier;
  - extra cabin crew;
  - rotation weeks;
  - auto-roster, auto-maintenance, allow tight and auto-deadhead toggles.

---

## 6. UI plan (iPad landscape 1180×750 Safari / 1180×820 home screen)

### 6.1 Shell (done; B5 polishes)
- **Top bar:**
  - company pill (tail badge, name, ICAO · base) → Company;
  - UTC date and time (steps of 10/15/30 min);
  - labelled speed control `⏸ 1× 2× 4×` (amber pause; a static amber badge with the reason while a decision or auto-pause holds time, no pulsing);
  - cash → Finance;
  - alerts bell (decisions + unread bad/warn) → Inbox;
  - menu.
- **Left rail** (84 px, icon over label): Ops Map, Contracts, Schedule, Crew, Fleet, Finance, Company, Inbox. Count pips: open offers and unread items.
- **Decisions:** when one blocks time, `DecisionModal` opens by itself (done in `game/Modals.tsx`).
- **No ticker.** The main area is about 1096×686 (Safari).
- **Keyboard:** Space pauses, 1–3 set the speed, Esc opens the menu.
- **Compact tier** (Split View) is not a v0.5 target. It gets a 64 px icon rail and must not break.

### 6.2 Ops Map (B4)
- **Map:** full bleed. Fit to the operating area (home base plus every aircraft and pin; the default view covers Europe and North Africa).
- **Aircraft layer:**
  - a livery-coloured glyph per aircraft, positioned every frame (30 fps on touch) from `aircraftLive(g, ac, liveMinute())`, flying to `eta`;
  - heading along the great circle;
  - parked aircraft fan out beside their airport dot;
  - the registration label appears at zoom ≥ 2;
  - aircraft in maintenance get a small wrench badge, AOG a red ring.
- **Routes:** for the selected aircraft, the current leg as a solid arc and the next 3 legs as faint arcs. Positioning legs are dashed. No arcs for other aircraft (calm).
- **Day/night terminator:** a night polygon from the subsolar point at `liveMinute()`, recomputed in the same rAF at ≤ 30 fps so it glides (10-minute steps read as jitter at 4×), fill `rgba(0,0,0,0.28)`.
- **Offer pins:** amber diamonds at `offer.pin` for open offers. Urgent offers get a static ring and no pulse. Tapping a pin opens the offer panel.
- **Side panel** (right, 360 px, `revealPad` keeps the selection visible):
  - Aircraft:
    - art, registration, type, cabin, status;
    - current flight (flight number, from → to, ATD, ETA in UTC and local, a progress bar updated hourly);
    - crew on board (names, roles, legality dot via `flightCrewStatus`);
    - next 4 legs;
    - A/C-check status (`checkStatus`);
    - actions: "Schedule" (→ Schedule tab with this row) and "Plan check".
  - Airport: name, local time, our aircraft there, crew resting there (hotel), offers from there.
  - Offer: client, archetype, dates, product, top-3 feasibility summary, and a "Review offer" button (opens `OfferModal`).
- **Fleet strip** (bottom left): one row of compact chips (registration, status dot, next departure) that scrolls horizontally, so 10 aircraft never cover the map. Tap to select and fly to it.
- **Up next card** (top left, optional): the next 3 departures fleet-wide, updated hourly.

### 6.3 Screens (B5)
- **Contracts:**
  - segmented control Market | Active | Missed;
  - Market is a 2-column card grid sorted by urgency, then value. Each card shows:
    - archetype icon and name, client (with a broker chip);
    - route summary (`LIS ⇄ HAM base`, or `KBL → LIS`);
    - dates and lead time, product (`$3,950/BH · MGH 200` or `$412K charter`), estimated value;
    - requirement chips (seats, ETOPS, runway);
    - risk chips;
    - expiry countdown in game hours, updated hourly.
  - Tap → `OfferModal`.
  - Active rows: client, aircraft, status, MGH progress bar for this month, next flight, problem flag (uncrewed or illegal), and a cancel button with a penalty confirm.
- **OfferModal** (xwide):
  - left: terms, schedule list (first 10 legs + "…"), effects;
  - right: aircraft list from `feasibilityAll`, each row with a traffic light, positioning ("+2h10 positioning from LIS"), crew capacity (shortfall by role and date, from `report.crew`) and contribution;
  - the selected aircraft expands its check list;
  - footer: Decline, Counter (stepper ±2.5% steps up to +20%), Accept (disabled on `no`).
- **Schedule** (Gantt):
  - rows per aircraft, 56 px, with a sticky left column (registration, type, location);
  - time axis UTC with day separators and a local-time hint for the home base; zoom presets 3 d / 7 d / 28 d (px per hour 24/10/2.5);
  - blocks:
    - flights coloured by contract colour, labelled `no from-to` when wide enough;
    - positioning and ferry legs hatched;
    - maintenance grey striped;
    - deadheads not shown; sub-chartered legs outlined with the rival's name;
    - idle gaps of 12 h or more as faint labelled blocks ("idle 2d 4h"), which prompt the player to sell spare time;
    - at 28 d, a day's rotations merge into one "day pill";
  - a red corner on uncrewed or illegal flights;
  - the today line is drawn from `liveMinute()` in a rAF, like the planes, so it glides;
  - horizontal native scroll with momentum; render only blocks in the visible range ±12 h (≤ 400 nodes);
  - **touch:** blocks are mostly narrower than 44 px (a 1 h sector is 10 px at 7 d), so a tap anywhere in a row opens the detail sheet for the nearest block within ±44 px, or a short list when several qualify. The sheet shows flight times UTC/local, crew list and legality, contract link; or the maintenance event with reschedule and cancel.
- **Crew:**
  - top staffing strip (`staffing`: have/need per family and role, shortfall in amber);
  - left: filterable list (role, status, location, rating, search), rows with the name, role badge, location and status, and two bars (duty 28d / 190 h, block 28d / 100 h) coloured by `crewWindows`;
  - right detail: profile (nationality flag, languages, hired, total hours), morale and fatigue, all limit bars, a 14-day roster timeline (`rosterOf`), and actions Train / Hire similar;
  - Hire modal: role, family, base, count stepper, quote (cost and ready date).
- **Fleet:**
  - aircraft cards: art, registration, type, age, ownership line (owned with book value / leased to date at $/month), hours and cycles, cabin, A-check and C-check bars (`checkStatus`) with "Plan check", and an AOG-risk chip;
  - Market section below: scarce offers with terms, lead time and an Acquire confirm.
- **Finance:**
  - KPI row: cash, this month's revenue / costs / profit so far, receivables outstanding, overdue;
  - statement table: lines by category, current month plus the last 5 closed;
  - cash forecast (`LineChart`, 90 days, `cashForecast`);
  - receivables list sorted by due date (amber overdue, government chip).
- **Company:**
  - reputation bars (reliable, clean) with a "what moves this" tooltip;
  - approvals list (state, cost, time, Apply, progress bar);
  - policies form;
  - goals list with progress.
- **Inbox:** open decisions pinned on top (open the `DecisionModal`), then messages with category filters. Tapping a message with `ref` navigates to the entity.
- **New Game** (skeleton exists): presets, name, code, home base cards (5), colours, tail style, livery preview, Start.

### 6.4 Interaction rules
- All touch targets are at least 44 px. Dense table rows are at least 36 px (`--tap-dense`).
- Use the existing `Modal`, `Seg`, `Toggle`, `Bar`, `Stepper`, `Card`, `Kpi`, `Empty` and `Tabs`.
- Modals pause time (store rule). Panels on the map do not.
- Selection lives in `store.nav.sel` (a `Ref`), so the map and other screens can deep-link (`store.navigate('map', {sel})`).

### 6.5 Calm visuals and auto-pause
**Calm visuals**
- Text, numbers and bars change at most once per game hour while running. The clock steps every 10–30 game minutes.
- Only aircraft glyphs, the terminator and the Gantt today line move continuously. No pulsing, shimmering or scrolling text, and no count-up animations.
- Toasts are rare (at most 3 on screen, 4 s): goals, AOG, cancellations, bankruptcy warnings and action errors. Arrivals, departures and routine messages never toast.
- Colours: good, warn and bad tokens only for state. Contract colours come from the fixed 8-colour palette in `ui/screens/palette.ts` (B5 mirrors it as `--k0…--k7` in `screens.css`; B4 imports the list).

**Auto-pause** (Settings, defaults):
- decision ✔ (time is held while one is open);
- urgent offer ✔;
- AOG ✔;
- crew shortage within 48 h ✔;
- month end ✘;
- contract start ✘.

`store.pauseReason` tells the speed control tooltip why the clock stopped.

---

## 7. Scope, saves, tests, balance

### 7.1 v0.5 checklist vs later

| v0.5 (this release) | Later |
|---|---|
| Startup scenario, 5 bases, name/code/livery | Scenarios (Lisbon 2019…), tutorial hints (v0.8) |
| Minutes clock, 1/2/4× + pause, event queue, determinism | — |
| Archetypes: season base, AOG cover, ad hoc, sports, repatriation, tour series, troop rotation | Hajj, UN, VIP, deportation, evacuation, humanitarian, Antarctica, music tours, dry lease out, sub-charter market and sub-charter-in offers (v0.7) |
| Feasibility + aircraft selection, flight generation with positioning and tech stops, billing (MGH), charter deposits/balances, counter-offers | Weekly advance invoicing, tenders, broker relationships (v0.6–0.7) |
| Live map: moving aircraft, terminator, panels, offer pins | Weather, airspace closures (v0.7) |
| Schedule Gantt | Drag-to-reassign (v0.6) |
| Named crew, simplified FTL, auto-roster with augmentation and deadheads, roster view, hiring and training, per diems and hotels | Manual swaps, recurrent training, attrition, mission morale, standby crew, department heads (v0.6) |
| A/C checks, maintenance nights, AOG with recovery menu (incl. sub-charter to a rival) | Engine shop visits, heavy checks, ETOPS downgrades (v0.7) |
| Statements, receivables, late payers, fail-forward rescue | Loans, factoring market, war-risk insurance (v0.7) |
| Inbox with decisions, a handful of events, 7 goals | Achievements, season recaps (v0.8) |
| Scarce aircraft market (lease in / buy used) | Cabin reconfiguration, lease returns with conditions, market cycles (v0.7) |
| Approvals: ETOPS 120/180, augmented, ULR, IOSA, DG | Full approvals tree, second AOC (v0.7+) |

### 7.2 Save format (done)
- **Storage:** `localStorage['contrail-acmi:save:<slot>']`, slots `auto` and `1`–`5`. The value is `'lz1:' + LZString.compressToUTF16(JSON)`. Settings live under `contrail-acmi:settings`. Nothing collides with the airline game's `contrail:` keys.
- **File:** `{format: 'contrail-acmi-save', meta: {company, code, now, date, cash, fleet, savedAt, color}, state: GameState}`. Export and import use the same JSON (`.contrail-acmi.json`).
- **Versioning:** `state.version = SAVE_VERSION` (1). `migrate()` runs `MIGRATIONS[v]` step by step up to the current version and refuses newer saves.
- **Rules for builders:**
  - `SAVE_VERSION` stays 1 until the first public release. A new field gets its default with `??=` in the owning module's `SimModule.load`; migrations start after release;
  - runtime caches are rebuilt in `SimModule.load`;
  - `serialize` drops stale queue events (`compactQueue`).
- **Autosave:** on month change (throttled to 30 s, outside the frame), on pause, on visibility hidden and before unload.

### 7.3 Test plan
- **vitest, per module** (files next to the code: `*.test.ts`):
  - **core (done, 19 tests):** startup scenario, determinism, queue order, month close, flight execution, save round trip, local time and DST, block times, Dili fit, ETOPS, complements; `plumbing.test.ts`: pause reasons, deadhead lifecycle, reassign/sub-charter/change marks, pure read APIs, compact saves.
  - **B1:**
    - every archetype generates valid offers for 200 seeds (dates ordered, airports exist, legs within range or split, turn minima);
    - pricing bands (A320 wet $3,200–4,800/BH; charter price per BH 2–3.5× the ACMI rate);
    - feasibility (seats, range, runway, ETOPS, conflicts, positioning in time);
    - A320 positioning LIS→KBL with one fuel stop (two legs);
    - base patterns: HAM–PMI 2 and 3 waves never collide, maintenance night every 7 days, monthly block hours within 5% of targetBH;
    - `billContractMonth` (under MGH, over MGH, pro-rated first month, short cycles, broker cut, 2 aircraft);
    - accept → flights → contract start/end lifecycle; charter balance at `start − balanceDaysBefore`; deferred revenue recognised per leg; contract end after a delayed posOut.
  - **B2:**
    - `maxFdp` reproduces every cell of RESEARCH §5.1 F1 and F3, with sector penalties and the 9:00 floor;
    - `minRest` cases;
    - cumulative windows (60/7, 110/14, 190/28, 100/28, 900/yr);
    - recovery rule;
    - auto-roster for a 14-day A320 season base with 5 sets produces no illegal duty and covers 100% of flights;
    - HAM–PMI fixture at 2 and 3 waves for 28 days: every duty starts and ends at HAM, 3/4 sets on station, tours rotate after `rotationWeeks`;
    - acclimatisation states (B/X/D table);
    - a retime moves duty report/release through `onFlightsChanged`;
    - `crewAvailability` reports a shortfall by role only when capacity is short;
    - augmentation on a 12 h sector;
    - deadheads created for crew away from the first departure;
    - hiring and training timing.
  - **B3:**
    - departure/arrival with delays ripples respect turn minima;
    - AOG creates a decision and blocks departures;
    - A-check auto-planning before it falls due; with B1: a 90-day HAM base on the owned A320 gets its A-check in a maintenance night with no cancelled revenue legs;
    - sub-charter keeps the legs billed and posts `subcharter`;
    - month end posts rent, insurance, overhead and salaries exactly once and closes the statement;
    - receivables paid late for governments;
    - rescue flow;
    - 90-day determinism: two runs with the same seed and actions → identical JSON.
- **UI:** no unit tests. A Playwright smoke script (like `scratchpad/shots.cjs`) covers New Game → Ops Map → each tab, checking for no console errors and no horizontal overflow at 1180×750 touch.
- **Headless bot** (`scripts/acmi-bot.ts`, B3, run with `npx tsx scripts/acmi-bot.ts [seed] [days]`):
  - plays 365 days with a greedy policy:
    - accept the best `ok` or `warn` feasibility (contribution > 0) for any aircraft idle in the next 21 days;
    - hire to 5 sets per aircraft;
    - always pick decision defaults;
    - auto-roster on;
  - prints a monthly table: cash, BH per aircraft, revenue, costs, profit, offers seen/accepted, AOGs, delays, uncovered flights, illegal duties;
  - asserts targets:
    - summer (Jun–Sep) BH per aircraft 180–320;
    - year net margin −5% to +12%;
    - no illegal duties flown;
    - fewer than 2% of flights uncovered at departure;
    - at least 1 meaningful action (accept or counter, decision, hire, check) per game week for 2 aircraft, and at most 3 decisions a week;
    - at least 30 offers per year;
    - the first contract signable within the first 7 days;
    - a widebody acquirable within 12 months;
    - 1–3 AOGs per aircraft-year;
    - compressed save under 300 KB (printed monthly with save time; also with `dev.fleet(10)`).
  - It runs in under 10 s.

### 7.4 Balance defaults (`core/balance.ts`)

| Key | Default | Source / note |
|---|---|---|
| startCash | $3.0M | About 3.5 months of fixed costs (§2.3) |
| startReputation | reliable 60, clean 70 | |
| crewSetsPerAircraft | 5 | SmartLynx contract |
| scheduleHorizonDays / rosterHorizonDays | 28 / 14 | Rosters published 14 days ahead (F13) |
| offersPerWeek | 4 | Pacing: about 1 decision a week |
| premium (peak/winter/short/urgent/longTerm/oldType/vip/conflict/deportation) | +.15 / −.15 / +.25 / +.35 / −.10 / −.15 / +.35 / +.60 / +.40 | RESEARCH §4.2 |
| mgh narrow / wide | 200 / 250 BH/month | §4.3 |
| excessRate | 0.95 | §4.3 |
| cycleFee | $900 / $1,800 | §4.3 |
| cancelScale | 60 d 15% · 30 d 35% · 14 d 60% · <14 d 100% | §4.3 |
| charterDeposit / balance days | 30% / 7 | §4.3 |
| brokerCommission | 5% | §4.3 |
| counterFloor / reply | 1.04–1.18 × asking / 6–30 h | design |
| salary (NB / WB rating) | CPT 9,400/12,000 · FO 5,300/7,000 · CRP 4,300 · CSD 2,600/3,000 · SCC 2,300/2,600 · CC 1,900/2,100 | §5.5, season-averaged, USD |
| onCosts | 20% | §5.5 |
| perDiem | CPT $108 · FO/CRP $76 · CSD $60 · SCC/CC $54 per day, × `policies.perDiemPct` | RESEARCH §5.3 (€100/€70/€50) |
| maintEvery (base patterns) | 7 days | contractual maintenance night |
| hotelPerNight | 3★ $90 · 4★ $140 · 5★ $230 | est. |
| deadheadTicket | $250 / $600 / $1,300 by distance | §5.3 |
| hireDays | CPT 60 · FO 45 · CRP 45 · CSD/SCC 35 · CC 50 | §5.4 (rated) |
| hireCost | pilot $9k · cabin $2k | est. |
| typeRating | pilot 35 d $45k · cabin 7 d $3k | §5.4 |
| commandUpgrade | 42 d, $22k, 4,000 h | §5.4 |
| fuelPrice | $750/t | §4.4 |
| airportFees / catering per departure (we pay) | NB $3,000 / $600 · WB $8,000 / $2,400 | est. |
| overheadBase / perAircraft | $120k / $80k a month | §4.5 |
| maintAgeFactor | +2.5% per year above 12 | §5.7 |
| checkCost A / C | NB $45k / $1.2M · WB $110k / $3.5M | §5.7 |
| aogBase | 0.00025 per departure (single roll) | §5.7; §5.6 here |
| delayChance | 12% | est. |
| Per-type parameters | `data/acmiTypes.ts`: seats, range, cruise, turn, crew, rate, fuel, maintenance, rent, value, insurance, check intervals, scarcity | §7.2–7.3 |

---

## 8. Open questions (for the creative director)
1. Wet leases invoice monthly in arrears in v0.5 (simpler cash flow). Should commercial clients pay weekly in advance, as in reality, from v0.6?
2. Should crew hotels and positioning tickets on wet leases really be free (client-paid)? That makes deployments cheap, as in reality, but hides a morale lever until v0.6.
3. Is the 7-archetype v0.5 set the right order? `troopRotation` is the first to cut if time runs short.
4. Southern-hemisphere DST is ignored in v0.5 (acclimatisation now follows the EASA B/X/D table). Acceptable?

---

## 9. Design review decisions

The review's high findings are all applied (duty/pairing rules §5.3, maintenance nights §5.1.6/§5.6, multi-leg positioning, cross-module API §4.1–4.2, opening and gap-fit offers §5.1.1). Medium and low findings are applied except where noted:

1. **Crew "layover moments"** are deferred to v0.6, with mission morale and department heads. Without a morale lever they would be noise; the weekly cadence in v0.5 comes from gap-fit offers, client change requests, permit delays and season nudges, which all ask for an action.
2. **Sub-charter** is in v0.5 only as a recovery option in the AOG and crew-short menus. A sub-charter market and sub-charter-in offers stay v0.7.
3. **Wet-programme deadheads** are client-paid (no cost, nothing invoiced) instead of billed to the client: the same cash effect as RESEARCH §2.2 with no extra invoice lines, matching hotels.
4. **Charter deposits** use deferred revenue (recognised per leg flown) rather than excluding them from goals, so statements are right as well as goals.
5. **Days off (7 per month)** are shown, not enforced: the 6-on/2-off work blocks and the 36/60 h recovery rule already bound rosters.
6. **Terminator:** recomputed every frame at ≤ 30 fps (glides) rather than every 2 s, which still jumps 24° at 4×.
7. **Already true in the skeleton:** time is held while `OfferModal` is open (modals pause the clock), and `DecisionModal` opens by itself when a decision blocks time.
8. **Market gating:** tier ≤ 2 from the start with scarcity weighting plus guaranteed offers; tier 3+ is gated by reputation and fleet size, not cash or approvals (approvals already gate those types through feasibility).
9. **Length:** this document stays above the 4,000–7,000-word aim; the extra is algorithm detail builders need.
