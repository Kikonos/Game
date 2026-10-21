# BLOCK HOURS v0.7.1 "Crew Control": design

Plan of record for v0.7.1, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events, Dubai player, iPad landscape, calm visuals, 1×/2×/4× only). RESEARCH.md supplies the numbers. DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only; read APIs pure (added to `core/plumbing.test.ts`); ids via `nextId`;
- money only through the ledger helpers; flights only through the core helpers;
- `SAVE_VERSION` stays 1, `??=` defaults in `load`, so v0.5.2, v0.6 and v0.7 saves keep working.

The player agreed two things (stages 1–3): **crew shortage as a serious situation with a Crew Control panel**, and **plain language everywhere** (the four-line card, the glossary, severity badges, visual aids) for every kind of problem. "Try all 8, refine later." Nothing else is added (§12).

| # | Feature | One line |
|---|---|---|
| 1 | Warning ladder | Amber at ≤ 48 h (message, no pause), red + auto-pause at ≤ 12 h; a CREW SHORTAGE banner on the flight everywhere. |
| 2 | Crew Control panel | Missing seats and nine ranked solutions (auto-fix, deadhead, delay, private jet, call in, discretion, swap, sub-charter, cancel), each with cost, timing, consequences, a preview and one tap to apply. |
| 3 | Bot | Uses Crew Control sensibly; balance in band; old saves load. |
| 4–11 | Plain language for crew | The four-line card, reach timeline bar, gauges, mini-map, one reason per person, `<Term>` glossary, "does it hurt?" badges, colour legends. |
| 12–19 | Plain language everywhere | The same card for maintenance, contracts, money and aircraft; the Inbox "Problems only" filter and Explain; a Glossary screen; a WHY? button on every red/amber dot; first-time hints. |

Calm rules still hold: nothing flickers, nothing animates except aircraft (and the v0.6 drag ghost). One message per event.

---

## 1. The shared idea: one `ProblemCard` for every problem

Everything player-facing in this update is built from **one engine read API** that turns a subject (a flight, a crew member, an aircraft, a check, an offer, a contract, an invoice, "cash") into the same four-line card. The UI renders that card with one component in every place (Crew Control panel, flight sheet, duty modal, Inbox message, Fleet card, offer dialog, Finance). The engine never writes prose twice: the card's `what`/`why` lines **are** the Inbox message body.

```ts
// src/engine/problems/index.ts (ENGINE). Pure.
export type ProblemKind =
  | 'crewShort' | 'crewIllegal' | 'crewTight' | 'crewReach' | 'crewRest' | 'crewFdp' | 'crewSick' | 'crewResigned'
  | 'aog' | 'checkDue' | 'checkOverdue' | 'checkClash' | 'checkNoSlot' | 'grounded'
  | 'offerFit' | 'counterExpiry' | 'changeRequest' | 'penalty' | 'contractCancelled'
  | 'cashLow' | 'invoiceOverdue' | 'lossMonth' | 'leaseDue' | 'goalMiss'
  | 'deliveryWait' | 'ferryUncrewed' | 'refit' | 'leaseReturn';

/** What the card is about: the entity, as a message Ref plus the kind. */
export interface ProblemRef { kind: ProblemKind; ref: Ref }          // Ref = { kind: 'flight' | 'aircraft' | …, id }

export interface Hurt {
  money: number;        // $ at stake if nothing is done (penalties, compensation, lost revenue, cost)
  pax: number;          // passengers affected
  delayMin: number;     // expected lateness
  legs: number;         // revenue legs affected
  level: 'none' | 'low' | 'high';   // none: no money, no pax; low: < $10K and < 100 pax; high: otherwise
  text: string;         // 'Not much: empty flight, ~3 h late, no penalty' / 'Yes: 180 passengers, $42K penalty'
  badges: string[];     // ['no cost'] / ['$12K', '180 pax', '2 h late']
}

export interface ProblemAction {
  id: string;           // 'crewControl' | 'adjustCrew' | 'planCheck' | 'subcharter' | 'hire' | 'findWork' | 'factor' | 'refit' | …
  label: string;        // button text
  /** Where the button goes: a modal spec the UI understands, or a tab. */
  open: { modal: 'crewControl' | 'duty' | 'check' | 'subcharter' | 'hire' | 'offer' | 'refit' | 'lease' | 'decision' | 'sheet'; id: string } | { tab: Tab; view?: string; sel?: Ref };
  primary?: boolean;
}

export interface ProblemCard {
  subject: ProblemRef;
  severity: 'amber' | 'red';
  title: string;                        // 'AWQ816 has no pilots'
  what: string;                         // same as title, full sentence
  why: string;                          // ONE sentence, one main cause, layperson words
  hurt: Hurt;
  actions: ProblemAction[];             // WHAT YOU CAN DO (ranked; the first is primary)
  details: string[];                    // behind the 'Details' tap: every other cause/number, jargon allowed
  /** Visual aids the UI may draw (all optional). */
  visuals: { reach?: ReachSpec; gauges?: GaugeSpec[]; minimap?: MiniMapSpec; timeline?: TimelineSpec };
  /** Glossary terms used in what/why (the UI wraps them in <Term>). */
  terms: TermId[];
  /** Deadline the card is about (departure, due date), for 'time left' chips. */
  by?: Minute;
}

export function problemFor(g: GameState, subject: ProblemRef): ProblemCard | null;   // null = no problem (any more)
/** Every current problem, worst first (Inbox filter, dots, hints, bot). Cached per (crewRev, flightsRev, hour). */
export function problems(g: GameState): ProblemCard[];
/** The problem behind a red/amber dot: the worst problem on this entity (a flight's crew, an aircraft's check…). */
export function problemAt(g: GameState, ref: Ref): ProblemCard | null;
```

**Visual specs** (engine computes, UI/MAP draw; all times UTC minutes, the UI adds local):

```ts
export interface ReachSpec {         // 'can't get there in time' bar
  from: string; to: string;          // crew location → departure airport
  now: Minute; mustLandBy: Minute; report: Minute; departure: Minute; earliestArrival: Minute;
  legs: { no: string; airline: string; from: string; to: string; dep: Minute; arr: Minute; jet?: boolean }[];  // the itinerary tried
  gapMin: number;                    // earliestArrival − mustLandBy (> 0 = red gap)
}
export interface GaugeSpec {         // fuel-gauge bars for limits
  id: 'fdp' | 'rest' | 'duty7d' | 'block28d' | 'blockYear' | 'aCheck' | 'cCheck' | 'cash';
  label: string;                     // 'Day length', 'Rest', '7-day duty', '28-day flying', 'A-check'
  value: number; limit: number;      // minutes, or % (0–100) for checks
  unit: 'hm' | 'pct' | 'usd';
  text: string;                      // '10:45 of 11:00', '7:30 of 10:00 by 06:00', '82% used'
  tone: 'good' | 'warn' | 'bad';
  by?: Minute;                       // when the limit bites (rest ends, check due)
  crewId?: string;
}
export interface MiniMapSpec {       // location / positioning causes
  crew: { id: string; name: string; at: string }[];     // dots
  to: string;                                            // where they are needed
  path: { from: string; to: string; jet?: boolean; no?: string; dep: Minute; arr: Minute }[];  // dashed line(s)
  departure: Minute;
}
export interface TimelineSpec {      // fault → repair → next flight (maintenance), due dates (money)
  from: Minute; to: Minute;
  marks: { t: Minute; label: string; tone?: 'good' | 'warn' | 'bad' }[];
  spans: { from: Minute; to: Minute; label: string; tone: 'good' | 'warn' | 'bad' | 'off' }[];
}
```

**Rules for the four lines (every kind):**
- **WHAT**: subject + plain verb. Flight numbers, registrations, names and cities are allowed; no codes for concepts ("no pilots", never "CPT/FO missing").
- **WHY**: one sentence, one cause (the *root* one, §6), with the two numbers that matter (a time and a place, or a money and a date). Everything else goes to `details`.
- **DOES IT HURT?**: money + passengers + delay, as `Hurt.text`. 'Not much: empty flight, ~3 h late, no penalty' / 'Yes: 180 passengers, $42K penalty' / 'Yes: $1.2M cash short on 31 Mar'.
- **WHAT YOU CAN DO**: 1–3 buttons; the first is the fix the engine would pick.

The same card text is used for the Inbox message (`title` = `what`, `body` = `why` + ' ' + `hurt.text`), so the player reads one story everywhere.

---

## 2. Crew shortage: the warning ladder (ENGINE `crew/roster.ts`, `crew/control.ts`; UI; MAP)

**Definition.** A flight is **crew-short** when it is scheduled on our aircraft, departs after now, and `flightCrewStatus(g, id).level` is `'missing'` or `'illegal'` (the v0.6.3/v0.6.4 live confirmation stays). Beyond the roster horizon (14 days) an empty duty is not a shortage.

**Ladder** (`BAL.crewControl.amberH = 48`, `redH = 12`):

| Stage | When | What happens |
|---|---|---|
| Amber | first seen with `std − now ≤ 48 h` | `f.crewAlert = 'amber'`; one message `tone: 'warn'` per batch (as today's `warnShort`), **no pause**; the flight shows the CREW SHORTAGE banner in amber. |
| Red | still short with `std − now ≤ 12 h` | `f.crewAlert = 'red'`; one message `tone: 'bad'` per flight; `requestPause('crewShortage')` (the existing setting); banner red; top bar pause badge says **Paused · Crew shortage** and opens Crew Control. |
| Gate | at departure (unchanged) | ops' `crewProblem` → re-roster, `crewShortDecision` after `crewWaitMin`. The decision's options now read the same as Crew Control (§3.10) and the decision dialog carries the card. |

- The check runs in the crew module's **hourly settle** (`escalateShortages(g)`: pairings with `requiredEmpty` or `illegalFrom`, flights `std ≤ now + 48 h`) and after every `autoRoster` (where `warnShort` lives). Cheap: only open pairings inside two days.
- `warnShort` changes from "pause at 48 h" to the amber stage; the red stage is new. `Flight.crewAlert` replaces `crewWarned` for new marks; load: `crewWarned && !crewAlert → crewAlert = 'amber'`.
- A fixed shortage clears the banner (`crewAlert` stays so it never re-warns; a *new* shortage on the same flight after a fix re-warns only at red).
- **Sound hook**: red messages carry `topic: 'crewRed'`; the store plays `sound.play('crewShortage')`, a new `SoundName` mapped to the 'alert' pattern until the v0.9 sound set.

**Messages** (one each; `problem` and `hurt` attached, §8):

| Stage | Title (= card WHAT) | Body (= WHY + HURT) |
|---|---|---|
| Amber | "AWQ816 has no pilots" / "AWQ816 has no crew" / "2 flights have no crew" | "Your free pilots are in Lisbon and the earliest they can land in Düsseldorf is 11:40, 3 h after the latest 08:34. Hurts: 180 passengers, $42K penalty. Departs in 41 h." |
| Red | "CREW SHORTAGE: AWQ816 in 11 h" | same why/hurt + "Open Crew Control to fix it." |

---

## 3. Crew Control (ENGINE `crew/control.ts`; UI `modals/CrewControlModal.tsx`)

### 3.1 Read API (pure)

```ts
export type CrewFix = 'autoFix' | 'deadhead' | 'delay' | 'jet' | 'callIn' | 'discretion' | 'swap' | 'subcharter' | 'cancel';

export interface SeatNeed { role: Role; n: number }                       // 1 CPT, 2 CC

export interface FixPreview {
  /** What changes if applied: lines like 'Captain Silva takes the CPT seat (deadhead TP 1342 LIS–DUS, lands 07:10)'. */
  changes: string[];
  /** After the fix: the flight's crew status and what is still missing. */
  after: { level: FlightCrewStatus['level']; missing: SeatNeed[] };
  /** Knock-on: other flights that move or lose crew. */
  ripple: { flightId: string; no: string; text: string; tone: 'warn' | 'bad' }[];
}

export interface CrewSolution {
  id: CrewFix;
  label: string;                 // 'Auto-fix', 'Fly someone in', 'Delay until crew arrives', 'Charter a private jet', 'Call in standby crew', "Commander's discretion", 'Swap crews', 'Sub-charter', 'Cancel'
  desc: string;                  // one plain sentence
  available: boolean;            // false → greyed with `why`
  why?: string;                  // 'Nobody is free today' / 'The duty is not over its limit' / 'Discretion already used'
  cost: number;                  // $ (0 = free)
  newDeparture: Minute | null;   // when the flight would leave (null = unchanged)
  chips: string[];               // ['$26K', 'lands 06:50', 'Morale −3']
  consequences: string[];        // ['2 later legs move 1 h', 'AWQ815 then needs 1 FO']
  /** Ranked order (1 = the engine's pick). */
  rank: number;
  /** Needs a second tap. */
  confirm: boolean;
  preview: FixPreview;
  /** Choices for the fix (candidates, jet classes, swap sources); the first is the default. */
  options?: FixOption[];
}

export interface FixOption {
  id: string;                    // crewId | pairingId | jet class
  label: string;                 // 'Captain J. Silva · LIS' / 'Citation XLS+ · NetJets Europe' / 'AWQ815 DUS–LHR crew'
  sub: string;                   // 'TP 1342 LIS–DUS 05:10→07:10 · legal after' / '$26K · wheels up 03:30, lands 06:20'
  cost: number;
  arrives?: Minute;
  level: Legality | null;        // legality of the person after the trip (candidates)
  reason?: Reason;               // §6 one reason when not legal
}

export interface CrewControlView {
  flightId: string; no: string; from: string; to: string; std: Minute; aircraftId: string; reg: string;
  stage: 'amber' | 'red' | 'gate' | 'ok';
  hoursLeft: number;
  missing: SeatNeed[];           // exactly which seats
  /** Seats held by crew who cannot legally fly (illegal), with their one reason. */
  illegal: { crewId: string; name: string; role: Role; reason: Reason }[];
  card: ProblemCard;             // the four lines + visuals
  solutions: CrewSolution[];     // all nine, ranked
  /** Legs this fix covers (the unit: wave or trip) and their passengers. */
  unit: { flightIds: string[]; pax: number; revenueLegs: number };
}

export function crewControl(g: GameState, flightId: string): CrewControlView | null;
```

### 3.2 Action

```ts
export interface ApplyOpts { optionId?: string; crewIds?: string[]; /** second tap given */ confirmed?: boolean }
export function applyCrewFix(g: GameState, flightId: string, fix: CrewFix, opts?: ApplyOpts): ActionResult<{ changes: string[]; after: CrewControlView | null }>;
```
`applyCrewFix` re-computes the solution on the live state (the preview came from a copy), refuses when `available` turned false or a confirm is needed and not given, applies, then returns the new view (null when the flight is fixed and no problem remains). Each applied fix counts in `stats.crewFixes[fix]` and posts one `info` message ("AWQ816 crewed: Captain Silva flies in on a NetJets Citation XLS+ ($26K)").

### 3.3 Previews without side effects
Previews run the real fix on a **copy of the state** (the `copyOf` pattern from `crew/board.ts`: structured clone of `g`, same RNG value, discarded afterwards), then diff: seats filled, tickets bought, legs moved/cancelled, other flights' crew status before/after. `crewControl` is therefore pure in `g` (the copy is local). Cost: nine copies per call; the modal memoises on `crewRev + flightsRev + hour`, and the Inbox/sheet only ask for the card (`problemFor`), never the previews.

### 3.4 The nine solutions

Ranking: available fixes first, then by `(hurt after fix) + cost + lateness`, with ties in the table order. The engine's pick is `rank 1`; a decision at the gate uses the same ranking as its default.

| Fix | Available when | Engine | Cost / timing / consequences |
|---|---|---|---|
| **a. Auto-fix** | always on a scheduled flight | `rerosterFrom(g, aircraftId, now)` on the copy; preview lists seats filled (names, tickets) and seats still empty. Apply = the same on `g`. | Tickets at airline prices (0 on wet leases). "Changed: 2 seats filled, 1 CC still missing." |
| **b. Fly someone in (deadhead)** | ≥ 1 candidate who is **legal** after a ticket or ride (`dutyCandidates` per missing role; `travel` set; `level !== 'illegal'`) | Options = candidates (one per missing seat, best first), with the itinerary (`outTicket` → `itinerary`) and `arrives`. Apply = `assignCrew(g, flightId, crewId, role)` per chosen seat. | Ticket price per person (`ticketPrice`). Chip 'lands 06:50 (via FRA)'. Consequence: the person's next trip, if it then becomes tight. |
| **c. Delay until crew arrives** | a legal crew can reach the flight later today or tomorrow (`crewReadyAt`, now on `outTicket`, §3.9) | `newDeparture = crewReadyAt`; preview = `planRecovery(copy, ac, from, ready, std)` → moved and cancelled legs; apply = `delayFlight`-style retime with `lateOk` (the player accepted it) then `rerosterFrom`. | Cost = charter `perDelay` when > 3 h (and the compensation of legs recovery drops); chips 'leaves 11:40 (+3 h 06)', '2 later legs move'. Confirm. |
| **d. Charter a private jet** | any time while a legal crew exists somewhere within jet range (candidates as in b but **ignoring the airline reach**: `jetCandidates`) | §4. Options = jet classes that fit the crew count (light ≤ 6, midsize ≤ 8, heavy ≤ 13 seats); apply = `charterJet(g, flightId, crewIds, class)`. | $18–60K typical; wheels up `now + 150 min` (FBO), 'lands 06:20'. Legal after (the jet ride is positioning in the FDP, §4.3). |
| **e. Call in standby / day-off crew** | ≥ 1 crew member **at the departure airport** (or the station) who is off, resting-done or free, legal for the seat, not on another trip | Options = those people; apply = `assignCrew` + overtime pay `BAL.crewControl.callInPay × (salary / 21)` posted to `salaries` + `moraleShock(c, 'pay', −4)`. | '$620 overtime', 'Morale −4'. Chip 'day off' when it eats one. |
| **f. Commander's discretion** | a duty exists, every seat filled, FDP over its limit by ≤ 2 h (3 h augmented), `!d.discretion` (same test as `canDisc` in events.ts) | `applyDiscretion` | Free. 'FDP +1 h 20', 'Morale −3 (each crew member)', 'Fatigue +10'. |
| **g. Swap crews** | another planned pairing of the same family whose crew are legal for this trip's seats (report within ±48 h, not under way, not a tour under way) | Options = source trips ('AWQ815 DUS–LHR crew, reports 09:00'); preview on the copy: `swapCrewSet` moves the needed roles over (`releaseCrew` + `placeCrew`), then `rerosterFrom` the source aircraft and reports what the source flight **then needs** (`flightCrewStatus`). | Free or tickets. Consequence line in red when the source flight becomes short: 'AWQ815 then needs 1 FO (its crew control opens next)'. Confirm. |
| **h. Sub-charter to a rival** | `subcharterQuote(g, rotationOf(flightId))` not null (≥ 6 h to departure, revenue legs) | existing `subcharter(g, ids, quote.cost)` | `quote.cost` vs `quote.revenue` ('we still bill $48K'), rival name. |
| **i. Cancel** | always for revenue legs | new `cancelTrip(g, flightId)` → `cancelLegs(unitOf(...), 'Crew shortage', 3)` | `cancelCost`, 'Reliability −3', pax. Confirm. |

Unavailable fixes stay in the list, greyed, with `why` ("Nobody is free at Düsseldorf today", "No rival flies A320s this week", "Already used on this duty"). The player sees all nine every time ("try all 8, refine later").

### 3.5 Missing seats and the unit
`missing` comes from the pairing's empty required slots (`flightCrewStatus.missing`), grouped by role: "1 CPT, 2 CC" shown as **1 captain, 2 cabin crew** (role labels from `ROLE_LABEL`). The unit is `unitOf(g, ac, f)` (the wave or round trip): `pax` = sum of its revenue legs' `pax` (fallback `cabin.total × 0.85` when a leg has none).

### 3.6 Hurt for a crew shortage
`money` = `cancelCost(unit)` + charter `perDelay` if the fix would be late > 3 h; `pax` as above; `delayMin` = `max(0, crewReadyAt − std)`; `legs` = revenue legs; level per §1. An empty positioning leg: "Not much: empty flight, ~3 h late, no penalty".

### 3.7 The WHY line (root cause)
From the first required empty seat (or the first illegal crew member): the engine looks for the best candidate it refused and names **their** reason, in this order of root causes (§6): busy on another trip → sick/leave/training/joining → not rated → rest → day too long → cumulative hours → no weekly rest → wrong place. The sentence templates:

| Cause | WHY |
|---|---|
| place | "Your free {pilots/cabin crew} are in {Lisbon} and the earliest they can land in {Düsseldorf} is {11:40}, {3 h} after the latest {08:34}." |
| rest | "{Captain Silva} is the only free captain and his rest at {Düsseldorf} ends at {09:10}, after the {07:30} report." |
| fdp | "The crew's day would run {11:45}, over the {11:00} limit, because {the inbound} landed late." |
| busy | "Every rated {first officer} is busy on another trip ({AWQ815} to {London} until {10:30})." |
| sick | "{Ana Costa} called in sick and nobody else rated on the {A320} is free." |
| rating | "Nobody free holds the {A330} rating." |
| hours | "{Captain Silva} is at {98 h} of the {100 h} allowed in 28 days." |
| none | "No {A320} pilots are free at all this week." |

When the shortage comes from an *illegal* seat, WHAT reads "AWQ816's crew can't legally fly it" and WHY names that person's reason.

### 3.8 Visuals on the crew card
- `place` cause → `reach` (ReachSpec from the `outTicket` refusal: `first + blk` as earliest arrival, `report − OUT_CONNECT` as must-land-by) **and** `minimap` (crew dots at their airports, dashed line to the departure, the itinerary legs).
- `rest`, `fdp`, `hours` causes → `gauges` for that person (`crewGauges(g, crewId, dutyId)`: FDP of that duty, rest, 7-day duty, 28-day block, each with the limit and `by`).
- The Crew Control panel shows the visual of the main cause; the duty modal shows all three per person.

### 3.9 `crewReadyAt` on `outTicket` (ENGINE `ops/events.ts`)
For a flight with a duty and pairing: for each candidate origin (`stationOf(f)`, home base, and the airports of the two nearest free legal sets), `outTicket(g, p, d, from, readyAt)`: when `why` is null the crew lands at `plan.sta` and reports `plan.sta + OUT_CONNECT`; when `why` is set the next-day plan (`early = true`) applies. The old `+180` buffer and the 13 h rule go. The earliest over all origins and the local `readyAt` wins; the one-day fallback stays. Flights without a duty keep the old estimate.

### 3.10 The gate decision (`crewShortDecision`)
Keeps its id `'crewShort'` and resolver, but its options are built from `crewControl(g, flightId).solutions` (available ones, ranked, at most 5: the engine's pick, delay, jet, sub-charter, cancel), with the same labels and chips; its body is the card's `what + why + hurt`. The decision dialog adds an **"Open Crew Control"** button (all nine). The resolver maps option ids to `applyCrewFix`.

### 3.11 UI: Crew Control panel (`modals/CrewControlModal.tsx`, `{ kind: 'crewControl'; flightId: string; fix?: CrewFix }`)
Opened from: the amber/red message's **Fix** button, the pause badge, the CREW SHORTAGE banner (map panel, schedule block sheet, Up Next row, Fleet card), the duty modal's header, the flight sheet, and the decision dialog.

Layout at 1180×820 (`Modal size="xwide"`, 1120 × up to 700, body scrolls):
- **Header**: "Crew Control · AWQ816 DUS → LHR" · chip "Departs 08:34 UTC (09:34 DUS) · in 11 h" · stage chip (amber/red).
- **Left column (440 px)**: the `ProblemCard` (four lines; WHAT in 18 px, WHY 15 px, HURT with the badge chips, the visual aid below: reach bar / gauges / mini-map), then **Missing seats** as role tiles ("1 captain", "2 cabin crew") and the illegal-crew rows with their one reason and icon. A **Details** disclosure lists `details`.
- **Right column (640 px)**: nine solution rows (56 px each, `btn`-like, 44 px targets): rank badge, icon, label, cost chip, timing chip, one consequence line; unavailable rows greyed with `why`. Tapping a row expands it in place: the preview (`changes` list, `after` status, `ripple` lines in amber/red), options as chips or a short list (candidates with their one reason and icon, jet classes, source trips), and **Apply** (primary) or **Apply · confirm** (two-step, the second tap within the same expanded row). After a successful apply the modal re-reads `crewControl`; when it returns null it shows "AWQ816 is crewed" with Close.
- Never over a decision dialog: opening Crew Control from the gate decision closes the decision first (the decision stays open in the Inbox).

### 3.12 Banners
`CREW SHORTAGE` (upper-case, 11 px mono, amber or red, static) appears while `crewAlert` is set and the flight is still short:
- **Map**: aircraft panel "Crew for AWQ816" section header gets the banner and a **Crew Control** button; `LegRow` dots get the WHY? hit (§10); **Up Next** rows show a small banner chip; the fleet strip chip of the aircraft turns `bad`/`warn` with line "CREW SHORT 08:34".
- **Schedule**: block gets class `crew-short` (red/amber corner as today plus a label "CREW SHORT" when ≥ 120 px wide); the sheet shows the card.
- **Top bar**: the pause badge reads "Paused · Crew shortage" and opens Crew Control for the newest red flight.
- **Fleet card**: a row "CREW SHORTAGE · AWQ816 in 11 h · Crew Control".

---

## 4. Private jet positioning (ENGINE `data/jets.ts`, `crew/control.ts`, `ops/commercial.ts`; MAP)

### 4.1 Data (`src/data/jets.ts`)
Real charter operators and types (names only, no logos):

| Class | Seats | Range (nm) | Cruise (kt) | Types | Operators |
|---|---|---|---|---|---|
| light | 6 | 1,700 | 400 | Citation CJ3+, Phenom 300E, Citation M2 | GlobeAir, Jetfly, Luxaviation |
| midsize | 8 | 2,100 | 430 | Citation XLS+, Praetor 500, Challenger 350 | NetJets Europe, Air Hamburg, VistaJet |
| heavy | 13 | 4,000 | 470 | Challenger 650, Falcon 2000LXS, Legacy 650E, Global 6000 | VistaJet, Luxaviation, Flexjet |

Operator and type are picked by `hashUnit(flightId + class + day)` (pure quote, stored on apply). Registration: an invented plausible one per operator country (CS-, OE-, D-, 9H-, LX-).

### 4.2 Pricing (`BAL.crewControl.jet`)
Industry charter quotes (2024–25, est.; RESEARCH has no jet table): hourly all-in rates **light $4,500 · midsize $6,000 · heavy $8,500**, the jet's own positioning from a nearby FBO billed as **1.0 h** at the same rate, a **2 h minimum**, plus **$2,500 handling and fees**; a fuel stop (beyond range) adds 45 min and $1,500. Block = `nm / cruise × 60 + 25`. So LIS→DUS (≈ 1,000 nm) on a midsize: 2.8 h + 1.0 h = 3.8 h × $6,000 + $2,500 ≈ **$25K**; LIS→JED on a heavy ≈ **$50K**. An airline ticket costs $250–1,300 per person: the jet only makes sense when hours matter. Posted to the new ledger line `crewJet` ("Crew jet charters"). On wet leases the client does **not** pay for it (our crew problem).

Crew above the class's seats take two jets (cost ×2; the panel says so). Departure `wheelsUp = max(now + BAL.crewControl.jet.fboLeadMin [150], crewReady) ` rounded up to 15 min; arrival `wheelsUp + block`. A jet is offered only when `arrival + OUT_CONNECT ≤ report` for the current departure (else the row says "even a jet lands 40 min late: delay the flight 1 h first", and the **delay + jet** combination is offered as the `jet` option with `newDeparture`).

### 4.3 In the engine
`charterJet(g, flightId, crewIds, cls)` creates **one Flight `kind: 'deadhead'`** per jet with `charter: { cls, model, operator, reg }`, `no: 'PJ'`, `cost`, via `addDeadhead` (the crew index, `onFlightArrCrew`, `ticketDuty` and pruning all work unchanged), attached to the duty's `deadheadIds`, and assigns the crew (`assignCrew` with the ride pre-booked: `placeCrew` skips buying a ticket when a `charter` ticket already covers the person). Timeline: `posSeg` uses check-in `BAL.crewControl.jet.checkInMin` [30] for charter tickets (the FBO), so the ride counts as positioning inside the FDP exactly like an airline ticket (F7) and legality after it is checked by `planCrew` as usual. `commercialItinerary` returns one leg for a charter ticket: `{ airline: operator, iata: 'PJ', no: model, from, to, dep: std, arr: sta, jet: true }` (`CommercialLeg.jet?: boolean` added); `ticketPurpose` text "Private jet for AWQ816 · Citation XLS+ (NetJets Europe)". Rosters (`crewCalendar`): kind `'deadhead'`, label **"Private jet"**, detail "NetJets Europe Citation XLS+ LIS–DUS 03:30–06:20 (chartered for AWQ816)".

### 4.4 On the map (MAP lane)
Exactly like the commercial deadheads (floating label, thin dotted grey path, tap panel), but:
- the icon is a small **business-jet glyph** (`JET_PATH`: swept wings, T-tail, 18 px) in the same grey ink;
- the label is the type ("Citation XLS+"), not a flight number;
- the panel kicker reads **"Private jet · NetJets Europe"**, the Flight section "Operator / Aircraft / Departs / Arrives / Time to landing", "Our crew on board" and the Purpose line ("Chartered for AWQ816 DUS–LHR, $26K");
- Up Next rows show "Private jet · Citation XLS+" with the crew count.
`commercialFlightsBetween` already returns these tickets; `CommercialFlight.leg.jet` tells the layer which glyph to use.

---

## 5. Plain-language visuals (UI components; MAP draws the mini-map)

| Component | File | Props | Notes |
|---|---|---|---|
| `ProblemCardView` | `ui/components/ProblemCard.tsx` | `card: ProblemCard; compact?: boolean; onAction(a)` | The four lines. Compact (Inbox): WHAT + HURT badges + Explain. Full: visuals + Details disclosure + buttons. Wraps `card.terms` with `<Term>`. |
| `ReachBar` | `ui/components/ReachBar.tsx` | `spec: ReachSpec` | Horizontal bar, 100% width, 56 px: ticks for now, must-land-by, report, departure, earliest arrival; the stretch from must-land-by to earliest arrival filled red; labels "11:40 UTC · 12:40 DUS" in two rows (UTC, local) alternating above/below so they never overlap; a legend line "The earliest flight lands 3 h too late". |
| `Gauge` | `ui/components/Gauge.tsx` | `spec: GaugeSpec` | Fuel-gauge look: a 10 px rounded track, fill in green/amber/red (`limitTone`), a needle tick at the value, label left, "10:45 of 11:00" right, `by` as "by 06:00" under it. Static. |
| `MiniMap` | `ui/map/MiniMap.tsx` (MAP) | `spec: MiniMapSpec; width?: number` | 400 × 180 inline SVG from `WorldMap`'s projection fitted to the spec's airports (±8°), land as the existing map paths, crew dots (livery-neutral grey), the departure airport ring, a dashed line per path leg with the flight label and times; jet legs use the jet glyph. No animation. |
| `Timeline` | `ui/components/Timeline.tsx` | `spec: TimelineSpec` | Fault → repair → next flight; money due dates. Same bar style as ReachBar. |
| `Term` | `ui/components/Term.tsx` | `id: TermId; children?` | Dotted underline; tap opens a 280 px popover with the one-line meaning and "Glossary ›"; any tap elsewhere (document `pointerdown` listener) dismisses. One popover at a time (module-level state). |
| `Why` | `ui/components/Why.tsx` | `refs: Ref \| Ref[]; tone` | The dot plus a 44 × 44 hit area; tap opens `{ kind: 'problem', subject }` via `problemAt`. Replaces bare `<Dot>` wherever a red/amber dot stands for a problem (Schedule crew corner, Fleet check bars, Crew list rows, map LegRow, Contracts rows). |
| `ColourLegend` | `ui/components/ColourLegend.tsx` | `items: {swatch, label}[]` | The small "?" button (44 px) that opens a popover listing what red, amber, grey, dotted and solid mean on that screen. Schedule (block colours, crew corner, dotted positioning, stripes), Roster board (duty / rest / off / deadhead / tight / illegal), map crew layer (grey = airline/jet, dotted = empty, solid = operating). |

Reason icons (§6) are lucide icons: place `MapPin`, rest `BedDouble`, fdp `Hourglass`, busy `Plane`, sick `Thermometer`, rating `GraduationCap`, leave `Palmtree`, joining `UserPlus`, training `BookOpen`, hours `Gauge`, recovery `Moon`.

---

## 6. One reason per person (ENGINE `crew/control.ts` → `crew/rosterActions.ts`)

```ts
export type ReasonCode = 'place' | 'rest' | 'fdp' | 'busy' | 'sick' | 'leave' | 'joining' | 'training' | 'rating' | 'hours' | 'recovery';
export interface Reason { code: ReasonCode; text: string; /** the full list for 'tap the person' */ all: string[] }
export function rootReason(g: GameState, issues: LegalityIssue[], crew: CrewMember, p?: Pairing): Reason | null;
```
Root-cause order: `overlap` → `busy` ("busy on AWQ815 to London until 10:30", from `otherTrip`'s first open duty) · `status` → sick/leave/joining/training ("sick until 14 Mar") · `rating` · `rest` ("needs rest until 09:10") · `fdp` ("day would be 11:45 of 11:00") · `duty7d/duty14d/duty28d/block28d/blockYear` → `hours` ("98 of 100 flying hours in 28 days") · `recovery` ("no weekly rest for 8 days") · `location` → `place` ("in Lisbon, can land 11:40 at the earliest"). A `location` issue whose person is also `overlap`/`status` is never the root (a pilot on another trip is "busy", not "at LIS"). `DutyCandidate` gains `reason?: Reason`; the duty modal's candidate rows and Adjust crew show `reason.text` with the icon, "Tap for the full list" expands `reason.all`.

---

## 7. Gauges in the duty modal and crew card (ENGINE `crewGauges`; UI)
```ts
export function crewGauges(g: GameState, crewId: string, dutyId?: string): GaugeSpec[];   // pure
```
FDP of that duty (or the next), rest ("Rest 7:30 of 10:00 by 06:00": rest taken so far vs minimum, `by` = `restUntil`), 7-day duty (of 60 h), 28-day block (of 100 h), year block (of 900 h). Tones from `limitTone` (0.75 / 0.95). The duty modal shows the three that matter per seat (FDP, rest, 28-day) under each name in a 2-row grid; the crew card replaces its `LimitBar`s with `Gauge`s (same numbers, new look).

---

## 8. Messages, Inbox, severity badges (ENGINE `core/messages.ts` users; UI `screens/Inbox.tsx`)

**Data.** `Message` gains `problem?: ProblemRef` and `hurt?: { money: number; pax: number; delayMin: number; level: Hurt['level'] }` (a snapshot for the badge once the problem is gone). Every `warn`/`bad` message posted by the engine from now on sets both where a subject exists (crew: flights, crew members; tech: aircraft, checks; commercial: offers, contracts; finance: receivables, 'cash'; fleet: aircraft). Old messages without them render as today.

**Posting helper** (ENGINE `problems/index.ts`): `postProblem(g, card, opts?: { tone?; cat; topic? })` builds the message from the card (`title = card.what`, `body = card.why + ' ' + card.hurt.text`, `ref = card.subject.ref`, `problem`, `hurt`) so every lane posts the same way. Existing messages are migrated to it in this update: crew shortage (both stages), taken-off-duty, sub-chartered/cancelled for crew, sick call decision, AOG decision, check due/overdue/missed/grounded, permit delay, cancelled legs, offer urgent/expiry, counter halfway/refused, change request decision, cash running out, invoice 7/30 days late, delivery no pilots / waiting, lease return slipped, refit slot missed. (Info/good messages stay as they are.)

**Inbox UI.**
- Filter chip **Problems only** (first after All): messages with `problem` or tone `warn`/`bad`, plus open decisions.
- Each warn/bad row shows a **severity badge** from `hurt` ('no cost' grey · '$12K' · '180 pax' · '2 h late'; at most two) after the title, and a collapsed card: tap the row's **Explain** (44 px) to expand the full `ProblemCardView` in place (live `problemFor`, else the snapshot lines "This has been dealt with" + the old body). The row's main tap still follows the ref.
- Decisions pinned on top gain the badge too (from the decision's card via `problemAt(ref)`).

**Toasts** unchanged (bad only), but a red crew message's toast title is the banner "CREW SHORTAGE · AWQ816".

---

## 9. Every kind of problem (ENGINE `problems/*.ts`)

Each module exposes one `xxxProblems(g): ProblemCard[]` and `problemFor` dispatches by kind. Numbers come from the existing read APIs; no new simulation.

### 9.1 Maintenance (`problems/tech.ts`)
| Kind | Subject | WHAT | WHY (one) | HURT | Actions | Visual |
|---|---|---|---|---|---|---|
| aog | aircraft (AOG in work) | "CS-THB can't fly: a brake fault in Lisbon" | "Repair about 9 h (part by courier); back 16:20." | legs until `m.end` (`windowLegs`): "2 flights, 230 passengers, $38K" | Decide (the AOG decision) · Sub-charter · Schedule | timeline fault → repair → next flight |
| checkDue | aircraft | "CS-THB needs its A-check by 14 Mar" | "82% of the interval is used; no slot is booked." | legs after the due date until grounded: "grounded after 14 Mar: 6 flights" | Plan check · Schedule | gauge 'A-check 82% used' |
| checkOverdue / grounded | aircraft | "CS-THB is grounded: its A-check is overdue" | "The 120-day limit passed on 12 Mar." | legs cancelled/at risk | Plan check | gauge |
| checkClash | check (planned) | "The C-check on 3 Apr clashes with 4 flights" | "Alpha Air's HAM base runs until 10 Apr." | flights lost | Reschedule · Sub-charter | timeline |
| checkNoSlot | aircraft | "No ground slot for CS-THB's A-check before 14 Mar" | "The aircraft flies every night until then." | as checkDue | Plan check (drop a wave) | gauge |

### 9.2 Contracts (`problems/commercial.ts`)
| Kind | Subject | WHAT | WHY | HURT | Actions |
|---|---|---|---|---|---|
| offerFit | offer (open, best report `warn`/`no`) | "You can't fly Saudia's Hajj charter as it stands" | the worst `FeasibilityCheck` in plain words: crew ("you are 3 pilots short from 2 Jun"), aircraft busy ("CS-TQA is on the HAM base until 10 Jun"), range ("the A320 can't reach JED without a fuel stop; the client wants none"), cabin ("needs a VIP cabin; CS-TQA is 180Y"), paint ("no paint-shop slot before the start") | "$1.4M of work" | the check's fix: Hire · Plan refit · Review offer · Counter without paint |
| counterExpiry | offer (countered, reply pending ≤ 12 h or halfway ≤ 24 h) | "Lufthansa's halfway offer expires in 6 h" | "They met us at $4,100/BH; after 18:00 the job goes to a rival." | est. value | Review offer |
| changeRequest | decision | "TUI asks to move TOM716 by 2 h" | "The crew's day would run 11:45 of 11:00: a fresh crew is needed." | fee vs cost | Decide |
| penalty | contract (a penalty posted in the last 24 h) | "$12K compensation paid to TUI" | "TOM716 left 3 h 20 late (crew rest)." | money | Contract |
| contractCancelled | contract | as today's message | | | |

### 9.3 Money (`problems/money.ts`)
| Kind | Subject | WHAT | WHY | HURT | Actions | Visual |
|---|---|---|---|---|---|---|
| cashLow | `{ kind: 'cash', id: 'cash' }` (new `Ref.kind`, §13) | "Cash runs out on 28 Mar" | "The 30-day forecast dips to −$420K: rent and salaries on 31 Mar exceed what comes in." | "Yes: −$420K on 28 Mar; salaries late = morale −15" | Finance · Find work · Sell an invoice | timeline of the forecast crossings |
| invoiceOverdue | receivable | "Government of Chad is 30 days late with $610K" | "Governments pay late; a reminder went out 23 days ago." | money | Decide (late payment) / Finance |
| lossMonth | statement | "February lost $210K" | "The HAM base ended and nothing replaced it: 140 BH flown against 400 of fixed costs." | money | Find work |
| leaseDue | aircraft | "CS-TQB's rent of $205K is due 31 Mar" (only when the forecast dips) | | | Finance |
| goalMiss | goal | not in v0.7.1 (goals never miss; the kind is reserved) | | | |

### 9.4 Aircraft and delivery (`problems/fleet.ts`)
| Kind | Subject | WHAT | WHY | HURT | Actions |
|---|---|---|---|---|---|
| deliveryWait | aircraft | "CS-TQC is stuck at Santiago" | "No A330-rated captain and first officer are free; parking costs $900 a day." | parking so far + rent | Hire · Convert |
| ferryUncrewed | flight (delivery/return/refit ferry ≤ 48 h) | "The delivery ferry has no pilots" | as crew (§3.7) | | Crew Control |
| refit | check (refit missed slot) | "CS-TQA's refit slot at Hamburg was missed" | "The aircraft couldn't reach Hamburg in time." | the job needing the cabin | Refit |
| leaseReturn | aircraft (return in ≤ 30 d) | "CS-TQB goes back to AerCap in 24 days" | "Return check at Shannon 3–12 Mar: cabin back to 18J/282Y ($120K) and a white repaint ($135K)." | money | Lease… |

`Ref.kind` gains `'cash' | 'statement' | 'decision'` (additive; `refTarget` maps cash/statement → Finance, decision → the decision modal).

---

## 10. WHY? buttons, legends, glossary screen, first-time hints (UI)

- **WHY?**: every `Dot` that means a problem becomes `<Why>` (§5): Schedule block corner (the sheet opens with the card on top; the corner itself opens the card modal `{ kind: 'problem', subject }`), Fleet check bars and status dots, Crew list row dots (illegal next duty), Contracts active rows (`problemFlightId`), map `LegRow`. `ProblemModal` (`modals/ProblemModal.tsx`, 640 px) = the full card with its visuals and action buttons.
- **Colour legends**: `ColourLegend` "?" on Schedule (next to the zoom), Roster board (next to the existing legend) and the map crew layer (in the map's layer toggle row, MAP lane).
- **Glossary screen**: `modals/GlossaryModal.tsx` (`{ kind: 'glossary'; term?: TermId }`) from Settings → "Glossary" and from every `Term` popover: a 2-column list of all terms with the one-line meaning and a **Show me** link (`where`: tab/view/modal) that closes the modal and navigates.
- **First-time hints**: `Settings.hintsSeen: ProblemKind[]` (localStorage). When a `warn`/`bad` message with `problem` arrives and its kind is not in `hintsSeen`, the store queues `{ kind: 'problem', subject, hint: true }` the way ladder steps are queued (never over another modal or decision; one at a time). The modal shows a one-paragraph **hint** above the card (`HINTS[kind]`, `data/glossary.ts`) with the same visual, and a **Don't show again** (adds the kind) / **Got it** (shows once more next time). Hints are plain stories: "A flight needs a legal crew: rested, rated and in the right place. When nobody fits, you see this card. The bar shows how late the nearest crew would land…"

---

## 11. Glossary (`src/data/glossary.ts`, ENGINE lane as data; `<Term>` in UI)

```ts
export type TermId = 'fdp' | 'deadhead' | 'positioning' | 'tight' | 'discretion' | 'acmi' | 'wetLease' | 'subcharter' | 'aog' | 'standby' | 'rest' | 'blockHours'
  | 'mgh' | 'ferry' | 'augmented' | 'etops' | 'aCheck' | 'cCheck' | 'perDiem' | 'recovery' | 'privateJet';
export interface GlossaryEntry { term: string; short: string; where?: { tab: Tab; view?: string }; }
export const GLOSSARY: Record<TermId, GlossaryEntry>;
export const HINTS: Partial<Record<ProblemKind, { title: string; text: string }>>;
```
One-liners (player words): **FDP** "Flight duty period: the crew's working day, from report to the last on-blocks. There is a legal maximum." · **Deadhead** "Crew travelling as passengers on another airline to get to their flight." · **Positioning** "Flying our own aircraft empty to where the work is." · **Tight** "Legal, but within 30 minutes or 5% of a limit; one delay breaks it." · **Discretion** "The captain may extend the crew's day by up to 2 hours once; the crew get tired and grumpy." · **ACMI** "We provide Aircraft, Crew, Maintenance and Insurance; the client pays per block hour, fuel and airport fees." · **Wet lease** "Same as ACMI." · **Sub-charter** "Paying a rival airline to fly our client's flight; we still bill the client." · **AOG** "Aircraft on ground: broken and can't fly until repaired." · **Standby** "Crew kept free at a base to cover sickness and surprises." · **Rest** "The time off a crew member needs before the next duty: 12 h at home, 10 h away." · **Block hours** "Time from pushing back to parking; what clients pay for." The glossary is the single table; `<Term id="fdp">` renders `GLOSSARY[id].term` unless children are given.

---

## 12. Not in v0.7.1 (keep it simple)
- No new sounds (hook only); no new auto-pause reasons or settings beyond `hintsSeen`.
- No standby duty type (call-in uses off/free crew at the station); no overtime policy.
- No jet booking for anything but crew positioning; no jet market or prices drifting.
- No AI-written text, no per-client language variants; cards are templates.
- Goal misses, covenants: reserved kinds only.
- No change to FTL rules, roster scoring or pacing.

---

## 13. Data model (ENGINE lands first, one edit of `core/types.ts`)

```ts
// Flights
export interface Flight { /* … */
  /** v0.7.1 crew-shortage ladder stage reached (amber ≤ 48 h, red ≤ 12 h); load: crewWarned → 'amber'. */ crewAlert?: 'amber' | 'red';
  /** v0.7.1 a chartered business jet carrying our crew (kind 'deadhead'). */ charter?: { cls: 'light' | 'midsize' | 'heavy'; model: string; operator: string; reg: string };
}
// Messages
export interface Ref { kind: /* …existing */ | 'cash' | 'statement' | 'decision'; id: string }
export interface Message { /* … */
  topic?: 'market' | 'ladder' | 'crewRed';
  /** v0.7.1 the problem this message is about, and its severity when posted. */
  problem?: ProblemRef; hurt?: { money: number; pax: number; delayMin: number; level: 'none' | 'low' | 'high' };
}
// Ledger
export type LedgerCat = /* … */ | 'crewJet';
// Stats
export interface Stats { /* … */ jets?: number; jetSpend?: number; crewFixes?: Partial<Record<CrewFix, number>>; crewAmber?: number; crewRed?: number }
```
`ProblemRef`, `ProblemKind` and `CrewFix` are declared in `core/types.ts` (string unions) so `Message` can carry them without importing the problems module.

**Load defaults** (crew module `load`): `f.crewAlert ??= f.crewWarned ? 'amber' : undefined`; `stats.crewFixes ??= {}`. Nothing else: every new field is optional and read with `??`.

## 14. Balance (`core/balance.ts`, new ENGINE block)
```ts
// ---------- crew control v0.7.1 (ENGINE; UPDATE-0.7.1.md §14) ----------
crewControl: {
  amberH: 48, redH: 12,
  /** Call-in: overtime as a multiple of a day's pay (salary / 21); morale shock. Swap: morale for crew moved at short notice. */
  callInPay: 1.5, callInMorale: -4, swapMorale: -2,
  /** Cancel from Crew Control: reputation per leg (max 3), as the decisions. */
  cancelRep: 3,
  jet: {
    rate: { light: 4_500, midsize: 6_000, heavy: 8_500 } as Record<string, number>,
    seats: { light: 6, midsize: 8, heavy: 13 } as Record<string, number>,
    rangeNm: { light: 1_700, midsize: 2_100, heavy: 4_000 } as Record<string, number>,
    cruiseKt: { light: 400, midsize: 430, heavy: 470 } as Record<string, number>,
    positioningH: 1.0, minH: 2, fees: 2_500, fuelStopMin: 45, fuelStopFee: 1_500, fboLeadMin: 150, checkInMin: 30, taxiMin: 25,
  },
  /** Hurt levels: 'low' below these. */
  hurtLowUsd: 10_000, hurtLowPax: 100,
},
```
**Balance intent.** Shortages are not more frequent; they are *seen* earlier and fixed cheaper. A year on seeds 1–6 should show 0–6 jet charters ($0–150K, < 1% of revenue), uncovered departures still ≤ 0.3%, illegal duties 0, and the decision count unchanged (Crew Control answers before the gate decision is needed). Call-ins cost ≈ $500–900 each. The amber message replaces today's 48 h pause: fewer pauses, same information.

## 15. Interfaces between lanes (final signatures; ENGINE ships stubs first)
All exported from `src/engine/crew/index.ts` (crew control) and the new `src/engine/problems/index.ts` (re-exported from `src/engine/ops/index.ts` for convenience).

```ts
// ---- crew/control.ts ----
export function crewControl(g: GameState, flightId: string): CrewControlView | null;                      // pure
export function applyCrewFix(g: GameState, flightId: string, fix: CrewFix, opts?: ApplyOpts): ActionResult<{ changes: string[]; after: CrewControlView | null }>;
export function jetQuote(g: GameState, from: string, to: string, crewN: number, ready: Minute, cls?: JetClass): JetQuote;   // pure
export interface JetQuote { cls: JetClass; model: string; operator: string; reg: string; seats: number; jets: number; wheelsUp: Minute; arrives: Minute; block: number; fuelStop: string | null; cost: number; text: string }
export function charterJet(g: GameState, flightId: string, crewIds: string[], cls: JetClass): ActionResult<{ ticketIds: string[]; cost: number }>;
export function cancelTrip(g: GameState, flightId: string): ActionResult<{ legs: number; penalty: number }>;
export function crewGauges(g: GameState, crewId: string, dutyId?: string): GaugeSpec[];                     // pure
export function rootReason(g: GameState, issues: LegalityIssue[], c: CrewMember, p?: Pairing): Reason | null; // pure
export function shortFlights(g: GameState): { flightId: string; stage: 'amber' | 'red'; hoursLeft: number }[]; // pure; soonest first
// rosterActions.ts: DutyCandidate gains `reason?: Reason`; DutyLegalityWarning gains `reason?: Reason`.
// events.ts: crewReadyAt unchanged signature, outTicket inside.
// commercial.ts: CommercialLeg gains `jet?: boolean`; commercialItinerary handles charter tickets.
// calendar.ts: 'Private jet' label/detail for charter tickets.

// ---- problems/index.ts ----
export function problemFor(g: GameState, subject: ProblemRef): ProblemCard | null;
export function problems(g: GameState): ProblemCard[];
export function problemAt(g: GameState, ref: Ref): ProblemCard | null;
export function postProblem(g: GameState, card: ProblemCard, opts: { cat: MessageCat; tone?: 'warn' | 'bad'; topic?: Message['topic'] }): Message;
export function hurtBadges(h: Pick<Hurt, 'money' | 'pax' | 'delayMin' | 'level'>): string[];                // pure; the Inbox badge from a snapshot
export type { ProblemCard, ProblemAction, Hurt, ReachSpec, GaugeSpec, MiniMapSpec, TimelineSpec };

// ---- data/glossary.ts ----
export const GLOSSARY: Record<TermId, GlossaryEntry>; export const HINTS: Partial<Record<ProblemKind, { title: string; text: string }>>;
// ---- data/jets.ts ----
export const JETS: Record<JetClass, { types: string[]; operators: { name: string; country: string; prefix: string }[] }>;

// ---- dev (engine/dev.ts) ----
export function devCrewShortage(g: GameState, opts?: { hours?: number; roles?: Role[] }): string;   // empties seats on the next flight ≤ hours away; returns its id
```

**UI store additions** (`src/ui/store.ts`, additive):
- `ModalSpec`: `| { kind: 'crewControl'; flightId: string; fix?: CrewFix } | { kind: 'problem'; subject: ProblemRef; hint?: boolean } | { kind: 'glossary'; term?: TermId }`.
- `Settings.hintsSeen: string[]` (default `[]`).
- `surfaceMessages`: `topic === 'crewRed'` → `sound.play('crewShortage')` and a bad toast "CREW SHORTAGE · AWQ816"; a `warn`/`bad` message with `problem` whose kind is not in `hintsSeen` → `queueProblem(subject)` (same queue discipline as ladder steps; `hint: true`).
- `sound.ts`: `SoundName` + `'crewShortage'` (plays the 'alert' pattern).
- `dev.crewShortage(hours?)` → `devCrewShortage` and opens Crew Control.
- `PAUSE_LABEL.crewShortage` stays; the badge's `go` opens `{ kind: 'crewControl', flightId: shortFlights(g)[0] }`.

**MAP lane** (reads only): `CommercialFlight.leg.jet` (glyph, label, panel), `shortFlights` / `problemAt` (banner, Up Next chip, fleet-strip tone), `MiniMapSpec` (the component), `crewControl` (panel button opens the modal via the store).

## 16. Bot (`scripts/acmi-bot.ts`, ENGINE)
A pure function of state. Daily, and on the amber/red messages (the policy runs after every step: `shortFlights(g)` is enough):
- For each short flight, soonest first, `crewControl(g, id)`; apply the first **available** fix in this order, with these guards: `autoFix` (always first; stop if `after.level` is ok/tight); `deadhead` (any legal candidate); `callIn`; `swap` (only when the source flight is not itself short afterwards: `preview.ripple` has no `bad`); `jet` when `hoursLeft ≤ 18` and `view.card.hurt.money ≥ jet cost × 1.5`, at most 8 a year; `discretion`; `delay` when `newDeparture − std ≤ lateCap`; `subcharter` when cheaper than cancel; else leave it for the gate decision (which keeps today's defaults).
- Tally: fixes by kind, jets and spend, amber/red counts, uncovered share.
- **Targets** (added to the printed table): `≤ 0.3% uncovered` and `0 illegal` unchanged; new soft lines "crew control: amber N, red N, fixes {autoFix a, deadhead b, jet c…}, jets $X"; new target "jets ≤ 8/year and ≤ 1% of revenue"; "red shortages ≤ 12 per year" (soft, printed). All v0.7 targets still pass; 365 days in < 12 s (previews are only computed for short flights).

## 17. Tests and acceptance

**ENGINE tests**
- `crew/control.test.ts`: fixtures with an empty CPT seat 40 h / 10 h ahead →
  - `crewControl` lists nine solutions, `missing` = `[{CPT,1}]`, the card's WHY matches the §3.7 template for the fixture (place / rest / busy cases);
  - `autoFix` preview equals the result of applying it (same seats, same tickets), and `g` is unchanged by the preview (JSON + RNG equal, 20 calls);
  - `deadhead` lists only legal-after candidates with itineraries; apply assigns and buys the ticket;
  - `jet`: quote math for LIS→DUS midsize (≈ $25K), heavy LIS→JED (fuel stop none, ≈ $50K), two jets for 9 crew; `charterJet` creates a `charter` deadhead, the crew are legal after it (posSeg check-in 30), cost posted to `crewJet`, `commercialItinerary` returns one `jet` leg, `ticketPurpose` names the flight, the calendar shows "Private jet";
  - `callIn` pays overtime and morale −4; `discretion` only when over by ≤ 2 h and unused; `swap` moves the set and reports the source flight's new need; `subcharter`/`cancel` delegate and post;
  - the ladder: amber at 48 h with no pause request, red at 12 h with `crewShortage`, one message each, `crewAlert` saved; a fixed flight stops showing the banner; `crewWarned` saves load as amber;
  - `crewReadyAt` on `outTicket`: equals `plan.sta + OUT_CONNECT + report` for a reachable origin, the next-day plan when not; never earlier than the old estimate's `now + 60`.
- `problems/problems.test.ts`: every kind produces a card with non-empty what/why/hurt.text and ≥ 1 action; `problems(g)` on a 60-day bot save lists AOG, checkDue, cashLow, invoiceOverdue and offerFit when present; `postProblem` sets `problem`/`hurt`; `hurtBadges` formatting table (none → ['no cost'], $12,400 → '$12K', 180 pax, 125 min → '2 h late').
- `crew/rosterActions.test.ts`: `rootReason` priority table (busy beats place; sick beats rest).
- Plumbing purity: `crewControl`, `jetQuote`, `crewGauges`, `shortFlights`, `problemFor`, `problems`, `problemAt`.
- Save compatibility: the v0.5.2, v0.6 and a v0.7 fixture load (`crewAlert` from `crewWarned`), run 60 days, serialise clean; `stats.crewFixes` defaults.
- Bot seeds 1–6 one at a time: all targets pass; jets ≤ 8; printed crew-control line.

**UI acceptance** (Playwright `scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch; new screens `crew-control`, `crew-control-jet`, `problem-modal`, `inbox-problems`, `glossary`, `duty-gauges`, `schedule-why`, `term-popover`, `hint`):
- `dev.crewShortage(10)` pauses the clock with "Paused · Crew shortage"; the badge opens Crew Control with nine rows, a visual aid and Missing seats; applying Auto-fix or a deadhead crews the flight and the modal says so; the jet row shows a price and times and, applied, posts `crewJet` on the statement.
- The flight sheet, duty modal and Inbox message show the same four lines; the Inbox "Problems only" filter and Explain work; badges show.
- Gauges per seat in the duty modal; the reach bar renders without overlapping labels at 1180 px; the mini-map renders inline.
- `<Term>` popovers open and dismiss; the Glossary screen lists every term with a working Show me.
- WHY? on a Schedule corner, a Fleet check bar and a Crew row opens the card. Legends open on Schedule, Roster board and the map.
- First-time hint appears once per kind and never again after "Don't show again".
- No console errors, every tappable element ≥ 44 px, renders ≤ 2/s at 4×, nothing animates.

**MAP acceptance**
- After a jet charter: a jet glyph with the type label flies the dotted grey path; its panel reads "Private jet · NetJets Europe" with times, time to landing and our crew; Up Next shows it. The aircraft panel of a short flight shows the CREW SHORTAGE banner and the Crew Control button; the fleet strip chip reads "CREW SHORT 08:34". The crew-layer legend "?" opens. No console errors, nothing else animates.

## 18. File ownership and sequencing

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**`: new `crew/control.ts` (+ `control.test.ts`), new `problems/{index,crew,tech,commercial,money,fleet}.ts` (+ `problems.test.ts`); edits in `crew/{roster,index,timeline,rosterActions,calendar,check}.ts` (+ tests), `ops/{events,flights,commercial,finance,maintenance,delivery,leaseReturn,cabin,index}.ts`, `contracts/{offers,counter,accept}.ts` (message migration only), `engine/dev.ts`, `core/messages.ts`, `core/plumbing.test.ts`, `saveCompat.test.ts` (+ a v0.7 fixture). `src/data/**`: new `glossary.ts`, `jets.ts`; `whatsNew.ts` (the v0.7.1 entry, `CURRENT`). `scripts/acmi-bot.ts`. Shared, minimal and additive, first: `core/types.ts` (§13), `core/balance.ts` (§14). | §2 ladder, §3 Crew Control, §4 jets (engine), §6 reasons, §7 gauges, §8 postProblem + message migration, §9 every card, §11 glossary data, §16 bot, §13 defaults |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`: new `components/{ProblemCard,ReachBar,Gauge,Timeline,Term,Why,ColourLegend}.tsx`, new `modals/{CrewControlModal,ProblemModal,GlossaryModal}.tsx`; edits in `modals/{DutyModal,BlockSheet,DecisionModal,OfferModal}.tsx`, `screens/{Inbox,Schedule,Crew,Fleet,Contracts,Finance,RosterBoard,scheduleLogic,screenLogic,common}.ts(x)` (+ logic tests), `shell/Shell.tsx`, `game/{Modals,Toasts}.tsx`, `store.ts` (additive: ModalSpec, Settings.hintsSeen, problem queue, dev helper), `sound.ts` (the name). `src/styles/**` except map styles: new `styles/acmi/v071.css` imported from `styles/acmi/index.css`. `scripts/ipad-shots.cjs` (append the §17 screens). | §3.11 panel, §3.12 banners (non-map), §5 components, §8 Inbox, §10 WHY?/legends/glossary/hints, settings |
| **MAP** | `src/ui/map/{LiveLayers.tsx,MapPanels.tsx,mapLogic.ts,mapLogic.test.ts,OpsMap.tsx}`, new `src/ui/map/MiniMap.tsx`, `src/styles/acmi/map.css` | §4.4 jet glyph/label/panel, §3.12 map banners + fleet-strip tone + Up Next chip, the mini-map, the crew-layer legend |

**Sequencing**
1. **ENGINE step 0**: land §13 types, §14 BAL, `data/glossary.ts`, `data/jets.ts`, and **stubs** for every §15 export (`crewControl` returns a view with nine `available: false` rows and a card built from today's `flightCrewStatus` text; `problemFor` returns a card with `why = ''`; actions return `{ ok: false, error: 'v0.7.1 stub' }`; `postProblem` posts a plain message). tsc green. UI and MAP build against the stubs from then on.
2. **ENGINE order**: ladder (§2) → `rootReason` + candidate reasons (§6) → `crewReadyAt` on `outTicket` (§3.9) → Crew Control read + apply without jets (§3) → jets (§4) → gauges (§7) → problems for crew (§9/§3.7) → `postProblem` + message migration (§8) → tech, commercial, money, fleet cards (§9) → dev helper → bot (§16) last; seeds 1–6 and save fixtures.
3. **UI order**: `Term` + glossary modal (small, independent) → `ProblemCard` + `ProblemModal` + `Why` → Inbox (filter, badges, Explain) → Crew Control modal → duty modal gauges/reasons, flight sheet, decision dialog → legends, hints, settings → shots.
4. **MAP**: jet glyph and panel on the stubbed `leg.jet` (use `dev.crewShortage` + a jet once ENGINE lands §4) → `MiniMap` → banners and Up Next chip → legend.
5. **Merge order**: ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green; the bot runs on seeds 1–6 one at a time.

## 19. What's new (`src/data/whatsNew.ts`, top entry, `CURRENT`)
- **version** 'v0.7.1', **name** 'Crew Control'.
- **features**: "Crew shortages are a real situation: an amber warning two days out, a red one with a pause 12 hours before departure, and a CREW SHORTAGE banner on the flight wherever you look." · "Crew Control: exactly which seats are missing and nine ways to fix it, each with its cost, timing and knock-on effects, with a preview and one tap to apply: auto-fix, fly someone in, delay, charter a private jet, call in standby crew, commander's discretion, swap crews, sub-charter or cancel." · "Private jets: charter a business jet from a real operator to position a crew in hours; it flies on the map like any other flight, with its own icon." · "Every problem now tells one plain story: what is wrong, why in one sentence, whether it hurts (money, passengers, delay) and what you can do. Crew, maintenance, contracts, money and aircraft." · "Pictures instead of jargon: a reach bar for 'can't get there in time', fuel-gauge bars for duty limits, a mini-map for who is where." · "Tap any aviation term for its meaning; a Glossary under Settings; a WHY? on every red or amber dot; a one-time hint the first time each kind of problem appears."
- **improvements**: "The Inbox has a 'Problems only' filter and an Explain button on every warning." · "Crew candidates show one reason each (busy, resting, sick, wrong place…) with an icon." · "Crew-short wait estimates use the real airline timetable." · "Colour legends on the Schedule, the Roster board and the map."
