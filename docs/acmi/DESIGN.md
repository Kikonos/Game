# CONTRAIL ACMI: technical design (v0.5)

This document turns BRIEF.md (direction) and RESEARCH.md (facts) into an architecture that 4–5 builders can implement in parallel. The skeleton in `src/` already compiles, runs and implements everything marked **(done)**. Everything marked **(B1)…(B5)** is a builder's job; BUILD-PLAN.md lists owned files, signatures, acceptance criteria and tests for each builder.

The source of truth for data shapes is `src/engine/core/types.ts`. This document explains them and does not repeat every field.

---

## 1. Principles

1. **One deterministic simulation.** All game logic lives in `src/engine/`, has no React, DOM or wall-clock dependencies, and draws all randomness from the seeded RNG in the save (`core/rng.ts`, mulberry32 on `g.rng`). The same seed and the same player actions produce the same game. `Math.random` and `Date.now` are banned in the engine. The only exception is the default seed in `createGame`.
2. **Integer minutes, event-driven.** Game time is an integer count of minutes. Nothing ticks per minute. A binary heap of timed events (departures, arrivals, duty starts, check ends, payments, offer expiries, the daily rollover) is drained in time order up to the current frame's target minute.
3. **Plain JSON state.** `GameState` is serialisable as it is. Entities are stored as id-keyed records, which keeps lookups cheap and insertion order deterministic. Runtime indexes, such as flights per aircraft, live in WeakMaps and are rebuilt on demand, so they are never saved.
4. **Modules talk through functions, not shared mutable caches.** Each builder owns a module folder with a public `index.ts`. Cross-module calls go through those exports. Signatures are fixed in the skeleton now, so callers can code against stubs before the implementations exist.
5. **Calm UI.** React re-renders while the clock runs at most once per game hour, plus on player actions, pauses and new messages. Only aircraft positions animate every frame, and they do so imperatively with no React render.

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
| `flights` | `Record<id, Flight>` | B1 creates, B3 executes, B2 attaches crew | All legs of our aircraft, plus `deadhead` tickets (aircraftId `null`). |
| `duties`, `pairings` | records | B2 | |
| `clients`, `offers`, `contracts` | records | B1 | |
| `maintenance` | `Record<id, MaintenanceEvent>` | B3 | |
| `hires`, `training` | arrays | B2 | |
| `messages` (newest first, max 300), `decisions` | arrays | any module posts through `core/messages.ts`; B3 resolves decisions | |
| `finance` | `{ current, history[], receivables[] }` | core primitives, B3 logic | |
| `market` | aircraft offers, fuel price, demand indexes | B3 | |
| `rivals` | `Rival[]` | B1 seeds (names only in v0.5) | Sub-charter later. |
| `goals` | `{id, done}` | B3 | |
| `stats` | lifetime counters | B3 | |
| `queue` | `SimEvent[]` heap | core | |
| `gameOver` | `{t, reason}` or null | B3 | |

### 2.2 Entities (summary of `types.ts`)

**Aircraft.** `reg`, `typeId` (an `ACMI_TYPES` id), `ownership` (`owned {bookValue}` or `dryLeaseIn {lessor, rentPerMonth, reservesPerFH, leaseStart, leaseEnd}`), `builtYear`, airframe `hours`/`cycles`, `maint {fhSinceA, lastA, fhSinceC, lastC, deferred 0–1}`, `cabin {j, w, y, total, label, layout}`, `etops` (airframe capability), `at` (airport it is at or departed from), `flightId` (set between off-blocks and on-blocks), `status` (`available | flying | maintenance | aog | delivering | stored | leasedOut`), `maintId`, `deliveredAt`.

**Client.** A fictional name from `data/naming.ts`, `kind`, country, base airport, payment behaviour (`payReliability`, `lateDays`), `cleanSensitivity` and `relation`.

**ContractOffer.** `archetype`, `clientId`, optional `broker`, `title`/`blurb`, `product`, `requirements`, `pattern`, `start`/`end`, `created`/`expires`, `urgency`, `penalties`, `payment`, `effects {reliable, clean, morale}`, `risk {payment, disruption, politics}`, estimates (`estBH`, `estValue`), hidden `floor` (the counter-offer walk-away multiplier), optional `counter`, `status` and `pin` (map airport).

- `Product` is one of:
  - `wet {ratePerBH, mghPerMonth, excessRate, cycleFee, positioningBillable}`;
  - `charter {price, depositPct, balanceDaysBefore, fuelEscalation}` (we pay fuel, fees and hotels);
  - `dry {rentPerMonth, reservesPerFH}` (later).
- `Requirements` holds `minSeats`/`maxSeats`, `layout`, `body`, `families`, precomputed `longestSectorNm` and `minRunwayM`, `etops`, `approvals`, `extraCabin` and `noTechStops`.
- `SchedulePattern` is one of:
  - `legs` (explicit `LegTemplate {from, to, dep, flightNo, pax}`), used for ad hoc, sports, repatriation, tour series and troop rotations;
  - `base {base, dests[], from, to, targetBH, waves[] (local minutes), prefix}`, used for season bases and AOG cover, where flights roll out daily.

**Contract.** Signed from an offer. It copies the commercial terms, adds `aircraftIds`, `signed`, `status` (`signed → active → completed | cancelled`) and `generatedUntil` (the rolling horizon for `base` patterns), and keeps `use[monthKey] = {blockMin, cycles, shortCycles}` and `billedMonths` for MGH billing. `color` is the Gantt colour index.

**Flight.** One block-to-block leg.
- `no`: the client's flight number on wet leases, our own (`ATW101`) otherwise.
- `kind`, one of:
  - `revenue`;
  - `positioning`: an empty leg tied to a contract, billable on wet leases;
  - `ferry`: non-revenue, e.g. maintenance or delivery;
  - `techstop`: a revenue sector split by a fuel stop, billed like revenue;
  - `deadhead`: a commercial ticket for crew, with `aircraftId` null.
- `std`/`sta` and `block`: scheduled times.
- `crewIds`, `dutyId`.
- `status`: `scheduled → enroute → done`, or `cancelled`.
- `atd`/`ata`: actual times.
- `delay`, `delayReason`.
- `ev`: the event version, bumped whenever times change.
- `cost`: the deadhead ticket price.

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
- A Duty has `report`/`release`, operated `flightIds`, ridden `deadheadIds` (commercial tickets or our own positioning legs), `sectors`, `fdp` vs `maxFdp`, `augment` (0/1/2 extra pilots), `restAt`, `legality` (`legal | tight | illegal`) and `ev`.
- A Pairing groups duties from base back to base (or a deployment) and holds the crew `slots: {role, crewId|null}[]`. The whole complement flies the pairing. Swapping single duties is v0.6.

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
- **Crew:** 60 named crew, rated A320, at base. That is 10 CPT, 10 FO, 4 CSD, 6 SCC and 30 CC, or 10 complete A320 complements (2 pilots + SCCM + 3 CC), about 5 sets per aircraft. Names follow the base's crew mix (`data/names.ts`).
- **Cash:** $3.0M (`BAL.startCash`). Fixed costs are about $0.87M a month (rent $228k, insurance $84k, overhead $280k, salaries with on-costs about $274k), which gives about 3.5 months of runway.
- **Reputation:** reliable 60, clean 70. No approvals.
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
- **Pauses.** After each event the core checks `takePause()`. If a handler called `requestPause(reason)` (`decision | urgentOffer | aog | monthEnd | contractStart | crewShortage`), `advanceTo` returns early with `g.now` equal to that event's time. The store decides from the settings whether that reason really pauses. If it does not, the store simply calls `advanceTo` again.
- **Self-scheduling.** After dispatching a `day` event, the core queues the next one. Modules queue their own events.

### 3.4 Frame loop (done, `ui/store.ts`)
Each `requestAnimationFrame` (dt capped at 100 ms):
1. If the game is paused, a decision is blocking (setting), or a modal is open, do nothing.
2. `exact += dt × minutesPerMs(speed)`, then `target = floor(exact)`.
3. If `target > g.now`, call `advanceTo`. On an honoured pause, set `paused = true`, `pauseReason`, snap `exact = g.now` and play the alert sound.
4. Call `emit()` (React refresh) only when a game hour boundary was crossed, the clock paused, or new messages arrived. Player actions (`store.act`) always emit.
5. The clock label has its own subscription and changes only every `CLOCK_STEP[speed]` game minutes (10/15/30), which keeps it at about 3 Hz or slower.

The map does not use React for motion. It reads `liveMinute()` (`store.exact`, a fractional minute) in its own rAF and interpolates along the great circle between effective off-blocks and on-blocks (`aircraftLive(g, ac, t)` in `core/query.ts`). Positions therefore glide smoothly even though the simulation advances in whole minutes.

### 3.5 Performance budget (iPad A16, 10 aircraft, 300 crew, 2,000 scheduled flights)

| Work | Budget | How |
|---|---|---|
| `advanceTo` per frame | < 0.3 ms typical | 0–2 game minutes per frame; O(log n) heap; handlers touch one entity |
| Map aircraft layer per frame | < 0.5 ms | ≤ 10 glyphs, `setAttribute` only, 30 fps on touch |
| Terminator | < 0.5 ms per update | Recompute the night polygon only every 10 game minutes |
| React refresh (hourly emit) | < 8 ms | At 4× this happens about 1.6 times a second; screens memoise derived data on `flightsRev(g)` and `store.version` |
| Daily rollover (`day`) | < 8 ms | Roster only open slots in the new horizon day; extend base patterns by one day; prune |
| Player actions (accept, auto-roster all) | < 150 ms | Off the animation path, once |

The steady-state target is under 4 ms of JS per frame. The flights-per-aircraft index (`flightsOf`) is rebuilt only after `touchFlights` (every helper in `core/entities.ts` calls it). B2 keeps its own crew → duties index, with the same pattern, in `crew/`.

### 3.6 Pruning
- Done or cancelled flights older than 40 days are deleted daily (B3, after billing).
- Duties and pairings older than 28 days are deleted daily (B2), after their entries are in crew logs.
- Messages are capped at 300 and statements at 60 months.
- Steady state stays under about 3,000 flights, roughly 400 KB of JSON before lz-string.

---

## 4. Module map and ownership

```
src/
  data/                       shared data (architect; builders append rows)
    acmiTypes.ts              ACMI parameters for 17 types (§7.2/7.3) + art look-alikes
    airports.ts               +27 mission/charter airports, runwayM on every airport
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
    game/Modals.tsx (menu, saves, settings), game/Toasts.tsx    architect → B5
    components/*              shared (kept); add new shared components in new files only
  styles/acmi/shell.css (architect→B5), map.css (B4), screens.css (B5)
scripts/acmi-bot.ts           B3 (headless year)
```

| Builder | Owns (writes) | Reads / calls |
|---|---|---|
| **B1 Contracts & commercial** | `engine/contracts/*`, the BAL commercial block, `data/naming.ts` (append) | core, `crew.crewAvailability`, `crew.autoRoster`, `crew.rerosterFrom` |
| **B2 Crew & HR** | `engine/crew/*`, the BAL crew block, `data/names.ts` (append) | core, flights/duties |
| **B3 Ops, maintenance, finance, events** | `engine/ops/*`, the BAL ops block, `scripts/acmi-bot.ts` | core, `contracts.billContractMonth` (if needed), `contracts.generateOffer`, `contracts.planPositioning`, `crew.rerosterFrom` |
| **B4 Map & live view** | `ui/map/*`, `styles/acmi/map.css` | `core/query.ts`, all module read APIs, `store.select`, `store.openModal({kind:'offer'})` |
| **B5 Screens** | `ui/screens/*`, `ui/modals/*`, `ui/shell/Shell.tsx`, `ui/game/*`, `styles/acmi/screens.css`, `styles/acmi/shell.css` | every module's public API |

**Shared-file protocol**
- `core/types.ts`: builders may add optional fields to interfaces in their domain section and must list them in their report. Renames go through the orchestrator.
- `core/balance.ts`: edit only your own block.
- `ui/store.ts`: B5 may add `Nav.view` values and `ModalSpec` kinds.
- Never edit `styles/app.css` or `styles/touch/*`. Add rules to your own `styles/acmi/*.css`.

### 4.1 Cross-module API (fixed signatures; stubs exist)

All mutating actions return `ActionResult<T> = {ok: true, msg?, data?} | {ok: false, error}` and are called from the UI through `store.act(g => fn(g, …))`.

**Core (done)**
```ts
nextId(g, prefix): string
addFlight(g, FlightInit): Flight            // queues flight.dep
retimeFlight(g, f, std, sta): void           // ev++, re-queue
cancelFlight(g, f, reason?): void
removeFlights(g, ids): void
flightsOf(g, aircraftId): Flight[]           // sorted by std, cached
touchFlights(g) / flightsRev(g)
ownFlightNo(g): string
schedule(g, t, type, id?, v?) / pop / peek
post(g, cat, amount) / accrue(g, cat, amount) / cashOnly(g, amount)
invoice(g, {clientId, contractId, desc, amount, cat, dueDays}): Receivable   // rolls payAt, queues 'payment'
pushMessage(g, {tone, cat, title, body, ref?}) / pushDecision(g, {...}) / requestPause(reason)
blockMinutes(typeId, from, to) / planSector(typeId, from, to): SectorPlan / runwayFit / maxSectorNm / etopsNeeded
cabinMinimum(seats) / complement(typeId, seats, {augment, extraCabin}): Role[] / canFill(slot, role) / reportMinutes(typeId)
aircraftLive(g, ac, t): AircraftLive / flightTimes(f) / nextFlight / flightsBetween / currentFlight
advanceTo(g, target): {events, pause, hourChanged}
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
planPositioning(g, aircraftId, to, arriveBy, kind, contractId): Flight | null
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
assignCrew(g, pairingId, slot, crewId) / unassignCrew(g, pairingId, slot): ActionResult
rosterOf(g, crewId, from, to): Duty[]
flightCrewStatus(g, flightId): {level: 'ok'|'tight'|'missing'|'illegal', missing: Role[]}
hireQuote(g, HireRequest) / hireCrew(g, HireRequest): ActionResult<{crewIds}>
trainCrew(g, crewId, kind, family): ActionResult
crewAvailability(g, family, typeId, from, to): {sets, byRole}
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

**UI contract (store, done):** `store.act`, `store.update`, `store.navigate(tab, {sel, view})`, `store.select(ref)`, `store.openModal(spec)`, `store.toast`, `useGame()`, `useClock()`, `liveMinute()`, `store.pauseReason`, `store.dev.demoFlights(days)`.

---

## 5. Algorithms

### 5.1 Contracts and commercial (B1)

#### 5.1.1 Offer arrival
- **Process:** a Poisson process. The next gap is `−ln(U)/λ` days, where `λ = BAL.offersPerWeek/7 × fleetF × seasonF × repF`:
  - `fleetF = 0.7 + 0.15 × fleet size`;
  - `repF = 0.6 + 0.8 × reliable/100`;
  - `seasonF` by month, Jan–Dec: .7 .9 1.1 1.2 1.1 1.0 1.0 .9 .9 .9 .8 .9.
- **Fit to the fleet:** 75% of offers are built to fit something the player can fly (seats within ±5% of a fleet aircraft, range achievable). The other 25% are aspirational widebody or long-haul jobs that show the ladder.
- **Lifecycle:** each offer queues `offer.expire`. Urgent offers call `requestPause('urgentOffer')`. Expired, lost and declined offers stay visible for 14 days in a "missed" list, and the message names a rival from `RIVALS` ("Baltic Wingset took it").

#### 5.1.2 Archetypes (v0.5)

Duration is in days, lead is the time from creation to start, and expiry is the time from creation. Multipliers apply to the reference type's `rateBH`.

| Archetype | Client | Duration | Lead | Expiry | Product | Pattern | Effects | Payment |
|---|---|---|---|---|---|---|---|---|
| seasonBase | airline (HAM, DUS, DUB, ARN, ZAG, SPU, RIX, CMN, AMM) | 30–92 | 14–60 d | 3–7 d | wet ×1.0, MGH 200 NB / 250 WB per month (pro-rata) | base: 4–8 leisure destinations 400–2,200 km from base, 2–3 waves (06:00, 13:30 / 06:30, 11:30, 17:00 local), targetBH = MGH × 1.1 | reliable +2 at completion if on-time ≥ 85% | monthly invoice, due 7 d |
| aogCover | airline | 2–10 | 2–24 h (urgent) | 3–8 h | wet ×1.5 (1.3–2.0), MGH 8 BH/day | base: 2–3 waves | reliable +2, relation +10 | due 7 d |
| adhoc | tour operator, agency, corporate (often via broker, 5%) | 1–7 | 3–30 d | 1–3 d | charter (price §5.1.4) | legs: one-way or round trip (return 2–7 d later) | — | 30% deposit, balance at end, due 7 d |
| sports | club | 2–3 per trip; season variant 3–8 trips over 1–3 months | 7–60 d | 2–4 d | charter ×1.3, extraCabin +2 | legs: out the day before the match, back after the match at 23:00 local | morale +2 | as charter |
| repatriation | MFA of the base country | 1–5 | 24–72 h (urgent) | 4–12 h | charter ×1.5 + urgent premium | legs: 1–6 legs from a crisis airport (KBL, BKO, JUB, MGQ, BGF, GOM, LAD, OXB, TMS, DIL, BEY, ADA) to the capital | clean +2, reliable +1, morale +6 | arrears, due 30 d, governments pay late |
| tourSeries | tour operator (FRA, MAN, LIS, OSL) | 28–84 (weekly) | 30–120 d | 3–7 d | charter per rotation ×1.0 + pass-through | legs: same weekday out and back to a resort (TFS, LPA, FNC, SID, AYT, HER, PMI; CUN/VRA for widebody) | — | deposit + per-rotation invoice due 7 d |
| troopRotation | MoD of the base country | 30–90, 2–4 rotations | 30–90 d | 5–10 d | charter ×1.2, approvals `['dg']` from v0.6 | legs: home → mission airport (BKO, BGF, MGQ, JUB, DJI) with tech stops as needed | morale +2, clean −1 | arrears, due 45 d |

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
9. **positioning:** where the aircraft is just before the programme (the `to` of its last flight before start, else `at`). If that differs from the first departure, plan `posIn` so it lands at least `turnMin` before the first departure and departs at least `turnMin` after the previous commitment. If it cannot depart after `g.now + 60`, the check is `no` ("can't get there in time"). Plan `posOut` back to home base, or to the next commitment's start.
10. **maintenance:** an A-check falling due inside the window is `warn` ("plan an A-check at …"). A C-check due inside the window, or an overdue one, is `no`.
11. **crew:** `crewAvailability(family, typeId, start, end).sets` vs `setsNeeded`:
    - short programmes need `max(1, ceil(peak daily BH/9))` sets;
    - programmes of 14 days or more multiply that by 1.6 (days off);
    - any single duty that needs augmentation requires the `augmented` approval, else `no`;
    - too few sets is `warn` ("hire 2 FO"), never `no`, because the player can hire or deadhead crew.
12. **estimates:**
    - `estRevenue = productValue`;
    - `estCost` (variable only) = maintenance/BH × BH + per diems + hotels (charter only) + deadhead tickets + charter pass-through (fuel, fees, catering) + positioning fuel when not billable;
    - `estMargin = revenue − cost`, labelled "contribution".

`feasibilityAll` sorts by level, then by margin.

#### 5.1.6 Flight generation (on accept)
- **`legs` pattern:** for each template, `planSector` splits it into one or more legs. The first leg departs at the template time and each next leg at the previous arrival + `TECH_STOP_MIN`. The first leg keeps `kind 'revenue'` and the fuel-stop legs are `'techstop'`. Same-aircraft sequences enforce `std ≥ prev.sta + turnMin`. If a client time violates that, shift later and flag it in the blurb. Never shift earlier.
- **`base` pattern:** generate each day from `max(from, now)` to `min(to, now + scheduleHorizonDays)`, then set `generatedUntil`. For each day and each active wave:
  1. pick the destination `dests[(dayIndex × waves.length + w) % dests.length]`;
  2. out-leg STD = wave local time → UTC; the back leg departs at out arrival + `turnMin`;
  3. waves are dropped deterministically so the monthly block hours approach `targetBH`. With `dailyBH(w)` the rotation block of all waves, drop the last wave on days where `hashUnit(contractId + day) < 1 − target/(Σ month)`.
- **Positioning:** add `posIn` and `posOut` (`kind 'positioning'`, billable on wet). If an existing soft positioning leg (scheduled and not started) already covers the gap, re-plan it rather than adding a second one. `relinkPositioning(aircraftId)` keeps exactly one empty leg between consecutive commitments at different airports.
- **Events and side effects:** queue `contract.start`/`contract.end`, invoice the charter deposit, call `crew.autoRoster({aircraftIds})`, and post the message "Signed: …".

#### 5.1.7 Daily extension
`extendBaseSchedules` adds the next day for every active `base` contract, followed by `crew.autoRoster` for the new day (crew's own daily job handles that).

#### 5.1.8 Positioning helper
`planPositioning(g, ac, to, arriveBy, kind, contractId)`:
- finds the aircraft's location and free time before `arriveBy`;
- schedules a leg `from → to` with `sta = arriveBy − turnMin` and `std = sta − block`;
- moves it earlier only if a later commitment forces that;
- returns `null` when it can't fit.

B3 uses it for maintenance ferries (`kind 'ferry'`).

#### 5.1.9 Lifecycle
- `contract.start` → `active`.
- `contract.end` → `completed`:
  - charter balance invoice (`invoice`, due per client terms);
  - final wet bill for the partial month;
  - reputation and relation effects;
  - `stats.contractsDone++`.
- **Cancelling by us** before start costs `value × cancelScale(days before start)`. An active wet contract costs 100% of unflown MGH for the rest of the term. Either way: future flights removed, reliable −5, client relation −30.

#### 5.1.10 Billing
- **Usage:** on `flight.arr`, for flights with a contract and kind `revenue | techstop`, or `positioning` when wet and billable: `use[month].blockMin += ata − atd`, `cycles++`, and `shortCycles++` if the block is under 90 min.
- **`billContractMonth(contract, M)`** for wet contracts:
  1. pro-rate `mgh = mghPerMonth × activeDays/daysInMonth` and set `flown = use[M].blockMin/60`;
  2. `amount = rate × max(mgh, min(flown, mgh)) + excessRate × rate × max(0, flown − mgh) + cycleFee × shortCycles`;
  3. deduct the broker commission;
  4. return the lines and mark the month billed.
- The contracts `month` handler calls it for every wet contract active in the closing month and issues invoices (`invoice`, `cat: 'acmiRevenue'`, due 7 days for commercial clients, 30 for governments).
- v0.5 bills monthly in arrears. Commercial weekly-in-advance invoicing is v0.6.

### 5.2 FTL legality (B2; RESEARCH §5.1, simplified)

**Reference time.** The crew is acclimatised to its base zone. When a trip's time-zone difference to base is 4 h or more and the crew has been in the new zone for 48–72 h, the state is X (base 11:00). Otherwise, use local time at the duty's first departure airport (`localMinuteOfDay`).

**maxFdp(i)**
```
BASE by report time (local, 15-min bands):
  05:00 12:00 · 05:15 12:15 · 05:30 12:30 · 05:45 12:45 · 06:00–13:29 13:00 · 13:30 12:45 · 14:00 12:30
  14:30 12:15 · 15:00 12:00 · 15:30 11:45 · 16:00 11:30 · 16:30 11:15 · 17:00–04:59 11:00
base = acclimatised ? BASE[band] : 11:00
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

**Recovery.** Every 168 h needs a free period of at least 36 h that includes two local nights. Simplification: 36 h free, and the gap must contain two 22:00–06:00 base-local windows. Track `lastRecovery`. A duty is illegal if `report > lastRecovery + 168 h` and no qualifying gap exists before it.

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
- cockpit: 2 pilots, CPT/FO/CRP with one extra pilot, or 2 CPT + 2 FO with two (ULR types always 4);
- cabin: `ceil(seats/50)` + `company.policies.extraCabin` + `requirements.extraCabin`. The SCCM slot is CSD on widebodies and SCC on narrowbodies, plus a widebody No. 2 (SCC) from 8 cabin crew; the rest are CC.

`canFill` lets seniors fly junior positions (CSD → SCC/CC, SCC → CC, FO → CRP).

### 5.3 Pairings and the auto-roster (B2)

**`buildDuties(aircraft, from, to)`.** Walk the aircraft's non-cancelled flights in time order.
1. Start a new duty when the ground gap since the previous on-blocks is at least `minRest + report + post`, or when adding the flight would break `maxFdp` at augment 0 and also at 1/2 (augmented ops need the `augmented` approval and at most 3 sectors).
2. Pick the smallest augment that makes the duty legal.
3. A single sector over the 2-pilot limit without the approval becomes an `illegal` duty. Feasibility should have stopped it already.
4. Group duties into pairings. A pairing starts with the first duty after the crew left base. It ends when a duty releases at the crew's base, at a deployment change, or after 6 consecutive duty days. The crew set then gets at least 2 days off; on deployments those days are spent at the deployment hotel.
5. On wet deployments, a pairing whose rests are all at the client base is a **deployment pairing**. Its crew is positioned once at the start and once at the end by deadhead, and rotates home after `policies.rotationWeeks`.
6. Rebuild only pairings that have no assigned crew. Pairings with crew are kept unless their flights changed (`ev`), in which case they are re-checked.

**`autoRoster(opts)`** is greedy and deterministic. It runs over open pairings in `[from, to)`, sorted by start (default `now → now + rosterHorizonDays`).

1. Fill slots in this order: CPT, FO, CRP, SCCM, No. 2, CC.
2. Candidates are crew that can fill the slot (`canFill`), hold the rating, are not unavailable during the pairing, and are legal for every duty of the pairing appended to their roster (incremental check with deadheads included). Tight duties count only if `policies.allowTight`.
3. Score each candidate:
   - `−deadheadCost(loc → first departure)`, where an existing deployment at that base counts as 0;
   - `−2 × block28d hours` (fairness);
   - `+30` if they flew this aircraft's or contract's previous pairing (crew family);
   - `−50` for overqualification (CSD in a CC slot);
   - `−(70 − morale)/2` if the mission is unpleasant (`effects.morale < 0`);
   - tie-break on crew id.
4. Take the best candidate. If they are elsewhere, add a `deadhead` Flight (commercial ticket):
   - departs at `report − 180 − block` rounded down to the hour and arrives at least 60 min before report;
   - block from `blockMinutes('a320ceo', …)` as a generic airliner;
   - ticket from `BAL.deadheadTicket` by distance;
   - positioning on our own positioning leg is preferred when one exists.
   Add a deadhead home after the pairing if it ends away from base.
5. When a slot can't be filled, its flights go to `uncovered`. Within 48 h of departure: message, plus `requestPause('crewShortage')`.
6. Queue `duty.report`/`duty.release` for each assigned duty (v = duty.ev).

`rerosterFrom(aircraft, t)`:
- rebuilds the duties affected by a retime from `t`;
- keeps crew where the new duty is still legal;
- otherwise frees those slots and fills them again (crew already at the station first, i.e. "standby by location").
- B3 calls it after delays over 60 min, AOG, swaps and sickness.

**Crew handlers**
- `duty.report`: crew go `onDuty`, and `awaySince` is set if it was null.
- `flight.arr`: crew aboard, and deadheaders, move to `f.to`.
- `duty.release`: append to `log` (pruned to 28 days), add to `blockYear` and `totalHours`, set `restUntil = release + minRest`, and set status to `resting`. At base, `awaySince = null`. Update `lastRecovery` when the gap to the next duty is 36 h or more.

### 5.4 HR and crew costs (B2)
- **Hiring:**
  - `hireQuote(role, family, base, count)`: cost = `BAL.hireCost` per person; ready = now + `BAL.hireDays[role]` ±20%. An unrated pilot needs a type rating as well.
  - `hireCrew` creates `joining` members (`makeCrewMember`) and charges `hiring` once. They show in the roster as "joining 12 Apr".
  - `crew.join` sets them `available` at base.
- **Training:**
  - type rating: pilots 35 days, $45k; cabin 7 days, $3k;
  - command upgrade FO→CPT: 42 days, $22k, needs 4,000 h;
  - SCCM course CC→SCC: 4 days.
  - `training.done` adds the rating or role and updates the salary.
- **Daily:**
  - per diem `policies.perDiem` per crew member away (`awaySince ≠ null`) → `perDiem`;
  - hotel nights for crew resting away. Paid by us on charters, positioning and ferries; on wet leases the client pays (RESEARCH §2.2), so there is no cost → `hotels`.
- **Monthly:** salaries × (1 + onCosts) → `salaries`.
- **Sickness:** daily, `p = 0.04/30 × (1 + max(0, 60 − morale)/100)` per crew member. Sick for 2–5 days, removed from pairings, then `rerosterFrom`. If the reroster fails: B3 decision `sickCrew`.

### 5.5 Flight execution (B3; skeleton has on-time version)

**`flight.dep`** (ignored if `ev` is stale):
1. **Aircraft not ready** (not at `from`, flying, maintenance or AOG): retime to `max(ready, std)`, where ready = previous on-blocks + turn, or maintenance end.
2. **Crew incomplete or illegal at departure:**
   - wait up to 2 h for re-rostering (`rerosterFrom`);
   - then decision `crewShort`: delay for a standby crew, cancel, or (if the problem is the FDP) commander's discretion when the overrun is ≤ 2 h.
3. **Random delay** (once per flight, `delayReason` empty):
   - operational (ATC, weather, handling): chance `BAL.delayChance`, minutes exponential with mean 25, capped at 180;
   - technical: `0.006 × ageF`, mean 60 min. Of technical delays, AOG happens with chance `aogChance`.
   - Apply with `retimeFlight`, then ripple to the aircraft's next flights so that `std ≥ prev.sta + turnMin`.
   - Delays over 60 min call `rerosterFrom`. Delays over 3 h on charters cost `penalties.perDelay`.
4. **AOG:**
   - create a MaintenanceEvent `AOG` at `from` lasting 12–72 h (+50% at outstations without our engineers);
   - aircraft status `aog`;
   - `requestPause('aog')`;
   - decision `aog` with the recovery menu (RESEARCH §5.7):
     - wait for the courier part (cheap);
     - fly in an AOG team ($8–15k, −40% time);
     - swap in another of our aircraft (calls B1 `planPositioning` and moves the flights);
     - cancel the affected legs (penalties, reliable −3).
   - Sub-charter is v0.7.
5. **Otherwise depart:**
   - `status = enroute`, `atd = now`;
   - aircraft `flying` with `flightId`;
   - queue `flight.arr` at `atd + block × (1 ± 0.04 wind noise)`, rounded.

**`flight.arr`:**
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
- **A-check:** due at `aCheckFH` FH or 120 days, whichever comes first. Takes `aCheckHours` (fitted into a night, 8–12 h narrowbody) at the home base or any airport with size ≥ 4. Cost `BAL.checkCost.A`.
- **C-check:** due at `cCheckMonths` or 7,500 FH (narrowbody) / 6,000 FH (767). Takes `cCheckDays` (narrowbody 14, widebody 18–28) at the home base. Cost `checkCost.C`.
- **Overdue:** a 10% tolerance is allowed. Beyond that the aircraft is grounded (feasibility `no`; departures cancelled).
- **`planChecks` (daily; auto-plans A-checks when `policies.autoMaintenance`):**
  - when the A-check is 85% used, find the first gap of at least `aCheckHours + 2 h` at an eligible airport before it falls due, and book it (`scheduleCheck`);
  - if the gap is away from base, use `planPositioning(…, 'ferry')` (B1);
  - if no gap exists, warn 7 days ahead.
  - C-checks are never auto-booked. At 90, 60 and 30 days the player gets messages with suggested windows (prefer November–March).
- **`maint.start`:** aircraft `maintenance`. **`maint.end`:** reset counters (`fhSinceA` → 0; a C-check resets both and `deferred` → 0; an A-check sets `deferred × 0.3`), post `checks`, aircraft `available`.
- **AOG chance per departure:** `BAL.aogBase × (1 + age/10) × (1 + 4 × deferred) × (outstation ? 1.5 : 1)`. Recommended `aogBase` is 0.0004: dispatch reliability is about 99.4% and about 8% of technical delays become an AOG over 12 h (RESEARCH §5.7). A 21-year-old aircraft should see about one AOG every 4–6 months.

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
`dailyEvents` and the departure hooks raise events. There should be about one meaningful decision per game week per 5 aircraft, with at most 2 open at once (additional ones queue as messages).

| Event | Trigger | Decision options (default) |
|---|---|---|
| Delay | Departure roll | (message only) |
| Crew short / out of hours | §5.5.2 | Wait for standby crew (delay) · commander's discretion (+2 h, morale −3) · cancel the leg (penalty) |
| Sick crew | §5.4 sickness and reroster failed | Deadhead a replacement ($, hours) · fly with a blocked-seat minimum (narrowbody: offload to 150 seats) · delay |
| AOG | §5.5.4 | Courier part (default) · AOG team · swap aircraft · cancel |
| Late payment | Receivable 30 days overdue | Wait (default) · factor the invoice at −8% now · threaten to suspend the contract (relation −20; the client pays within 7 days at 70%) |
| Urgent evacuation | `contracts.generateOffer(g, 'repatriation')` | (an offer, not a decision; it pauses through `urgentOffer`) |
| Month statement | `month` | (message) |
| Rescue | §5.7 | Accept the investor (default) · refuse (game over at −$2M) |

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
- **Monthly offers:** add `Poisson(0.7)` offers.
- **Type choice:** weighted by `(1 − scarcity)` among types with `tier ≤ maxTier + 1`, where `maxTier` is the highest tier in the fleet.
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
  - labelled speed control `⏸ 1× 2× 4×` (amber pause, pulsing while a decision holds time);
  - cash → Finance;
  - alerts bell (decisions + unread bad/warn) → Inbox;
  - menu.
- **Left rail** (84 px, icon over label): Ops Map, Contracts, Schedule, Crew, Fleet, Finance, Company, Inbox. Count pips: open offers and unread items.
- **No ticker.** The main area is about 1096×686 (Safari).
- **Keyboard:** Space pauses, 1–3 set the speed, Esc opens the menu.
- **Compact tier** (Split View) is not a v0.5 target. It gets a 64 px icon rail and must not break.

### 6.2 Ops Map (B4)
- **Map:** full bleed. Fit to the operating area (home base plus every aircraft and pin; the default view covers Europe and North Africa).
- **Aircraft layer:**
  - a livery-coloured glyph per aircraft, positioned every frame (30 fps on touch) from `aircraftLive(g, ac, liveMinute())`;
  - heading along the great circle;
  - parked aircraft fan out beside their airport dot;
  - the registration label appears at zoom ≥ 2;
  - aircraft in maintenance get a small wrench badge, AOG a red ring.
- **Routes:** for the selected aircraft, the current leg as a solid arc and the next 3 legs as faint arcs. Positioning legs are dashed. No arcs for other aircraft (calm).
- **Day/night terminator:** a night polygon computed from the subsolar point at `liveMinute()`, recomputed every 10 game minutes, fill `rgba(0,0,0,0.28)`, no animation between updates.
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
- **Fleet strip** (bottom left): one chip per aircraft (registration, status dot, next departure). Tap to select and fly to it.
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
  - right: aircraft list from `feasibilityAll`, each row with a traffic light, positioning ("+2h10 positioning from LIS"), crew sets (have/need) and contribution;
  - the selected aircraft expands its check list;
  - footer: Decline, Counter (stepper ±2.5% steps up to +20%), Accept (disabled on `no`).
- **Schedule** (Gantt):
  - rows per aircraft, 56 px, with a sticky left column (registration, type, location);
  - time axis UTC with day separators and a local-time hint for the home base; zoom presets 3 d / 7 d / 28 d (px per hour 24/10/2.5);
  - blocks:
    - flights coloured by contract colour, labelled `no from-to` when wide enough;
    - positioning and ferry legs hatched;
    - maintenance grey striped;
    - deadheads not shown;
    - idle stays blank;
  - a red corner on uncrewed or illegal flights;
  - the today line moves with `useClock`;
  - horizontal native scroll with momentum; render only blocks in the visible range ±12 h (≤ 400 nodes);
  - tap a block → detail sheet (flight times UTC/local, crew list and legality, contract link; or the maintenance event with reschedule and cancel).
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
- Only aircraft glyphs move continuously. The terminator steps every 10 game minutes. No pulsing, shimmering or scrolling text, and no count-up animations.
- Toasts are rare (at most 3 on screen, 4 s): goals, AOG, cancellations, bankruptcy warnings and action errors. Arrivals, departures and routine messages never toast.
- Colours: good, warn and bad tokens only for state. Contract colours come from a fixed 8-colour palette (`--series-*`-style) that B5 defines in `screens.css` and B4 reuses.

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
| Archetypes: season base, AOG cover, ad hoc, sports, repatriation, tour series, troop rotation | Hajj, UN, VIP, deportation, evacuation, humanitarian, Antarctica, music tours, dry lease out, sub-charter (v0.7) |
| Feasibility + aircraft selection, flight generation with positioning and tech stops, billing (MGH), charter deposits/balances, counter-offers | Weekly advance invoicing, tenders, broker relationships (v0.6–0.7) |
| Live map: moving aircraft, terminator, panels, offer pins | Weather, airspace closures (v0.7) |
| Schedule Gantt | Drag-to-reassign (v0.6) |
| Named crew, simplified FTL, auto-roster with augmentation and deadheads, roster view, hiring and training, per diems and hotels | Manual swaps, recurrent training, attrition, mission morale, standby crew, department heads (v0.6) |
| A/C checks, AOG with recovery menu | Engine shop visits, heavy checks, ETOPS downgrades (v0.7) |
| Statements, receivables, late payers, fail-forward rescue | Loans, factoring market, war-risk insurance (v0.7) |
| Inbox with decisions, a handful of events, 7 goals | Achievements, season recaps (v0.8) |
| Scarce aircraft market (lease in / buy used) | Cabin reconfiguration, lease returns with conditions, market cycles (v0.7) |
| Approvals: ETOPS 120/180, augmented, ULR, IOSA, DG | Full approvals tree, second AOC (v0.7+) |

### 7.2 Save format (done)
- **Storage:** `localStorage['contrail-acmi:save:<slot>']`, slots `auto` and `1`–`5`. The value is `'lz1:' + LZString.compressToUTF16(JSON)`. Settings live under `contrail-acmi:settings`. Nothing collides with the airline game's `contrail:` keys.
- **File:** `{format: 'contrail-acmi-save', meta: {company, code, now, date, cash, fleet, savedAt, color}, state: GameState}`. Export and import use the same JSON (`.contrail-acmi.json`).
- **Versioning:** `state.version = SAVE_VERSION` (1). `migrate()` runs `MIGRATIONS[v]` step by step up to the current version and refuses newer saves.
- **Rules for builders:**
  - adding a field means bumping `SAVE_VERSION` in `newGame.ts` and adding a migration that fills a default. Coordinate through the orchestrator; until the first public release, builders may instead default it with `??=` in a migration step;
  - runtime caches are rebuilt in `SimModule.load`.
- **Autosave:** on month change (throttled to 30 s, outside the frame), on pause, on visibility hidden and before unload.

### 7.3 Test plan
- **vitest, per module** (files next to the code: `*.test.ts`):
  - **core (done, 13 tests):** startup scenario, determinism, queue order, month close, flight execution, save round trip, local time and DST, block times, Dili fit, ETOPS, complements.
  - **B1:**
    - every archetype generates valid offers for 200 seeds (dates ordered, airports exist, legs within range or split, turn minima);
    - pricing bands (A320 wet $3,200–4,800/BH; charter price per BH 2–3.5× the ACMI rate);
    - feasibility (seats, range, runway, ETOPS, conflicts, positioning in time);
    - `billContractMonth` (under MGH, over MGH, pro-rated first month, short cycles, broker cut);
    - accept → flights → contract start/end lifecycle.
  - **B2:**
    - `maxFdp` reproduces every cell of RESEARCH §5.1 F1 and F3, with sector penalties and the 9:00 floor;
    - `minRest` cases;
    - cumulative windows (60/7, 110/14, 190/28, 100/28, 900/yr);
    - recovery rule;
    - auto-roster for a 14-day A320 season base with 5 sets produces no illegal duty and covers 100% of flights;
    - augmentation on a 12 h sector;
    - deadheads created for crew away from the first departure;
    - hiring and training timing.
  - **B3:**
    - departure/arrival with delays ripples respect turn minima;
    - AOG creates a decision and blocks departures;
    - A-check auto-planning before it falls due;
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
    - decisions between 0.5 and 3 per week for 2 aircraft;
    - at least 30 offers per year;
    - the first contract signable within the first 7 days.
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
| perDiem | $55/day | §5.3 |
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
| aogBase | 0.0004 per departure | §5.7 |
| delayChance | 12% | est. |
| Per-type parameters | `data/acmiTypes.ts`: seats, range, cruise, turn, crew, rate, fuel, maintenance, rent, value, insurance, check intervals, scarcity | §7.2–7.3 |

---

## 8. Open questions (for the creative director)
1. Wet leases invoice monthly in arrears in v0.5 (simpler cash flow). Should commercial clients pay weekly in advance, as in reality, from v0.6?
2. Should crew hotels on wet leases really be free (paid by the client)? That makes deployments cheap, as in reality, but hides a morale lever until v0.6.
3. Is the 7-archetype v0.5 set the right order? `troopRotation` is the first to cut if time runs short.
4. Southern-hemisphere DST and acclimatisation state D/X are simplified. Is that acceptable for v0.5 FTL?
