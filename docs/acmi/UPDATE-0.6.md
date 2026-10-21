# BLOCK HOURS v0.6 "Crew": design

This document is the plan of record for v0.6. It is written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" still override everything. RESEARCH.md supplies the numbers, and DESIGN.md and BUILD-PLAN.md keep their ground rules:
- engine RNG only, and pure read APIs;
- ids come from `nextId`;
- money moves only through the ledger helpers, and flights only through the core helpers;
- `SAVE_VERSION` stays 1, with `??=` defaults in `load`, so old saves keep working.

The player agreed to four features plus two carry-overs, and asked for them to be kept simple. Anything not listed here is out of scope (see §8).

| # | Feature | One line |
|---|---|---|
| C1 | Realistic deadhead airlines | Use the LCC based at either end first, then the flag carriers of either country, then hub connections. No implausible routes. |
| C2 | Pacing tune | At least 1 meaningful action per week on every bot seed (aim for about 2). Governments mostly pay late. |
| F1 | Roster board | A crew × day grid. Drag a duty to another crew member with live FTL legality. |
| F2 | Bulk type-rating conversion | Multi-select crew and send them to a conversion. Classes of at most 20 form automatically. "Conversion A330" shows on every roster. |
| F3 | Morale & attrition | Policies and roster life drive morale. Low morale brings sick calls, worse service and resignations with notice. |
| F4 | Extra crew above the legal minimum | Per aircraft or per contract, extra cabin crew (and a spare pilot) cost money and give morale and service. Some clients pay for it. |

Calm rules still hold. Nothing flickers and nothing animates except aircraft and the finger-held drag ghost. Messages stay rare: one per event, never one per crew member.

---

## C1. Realistic deadhead airlines (ENGINE: `ops/commercial.ts`, `data/carriers.ts`)

**Today.** `directCarriers` accepts any carrier that `serves()` a pair. `pickCarrier` gives the hub carriers of either end 60% of departures. The connection search then scores `km − bonuses` and gives the Gulf/IST "super hubs" a 700 km bonus. This produces three known bad picks:
- STN–DUB on Aer Lingus (EI does not use Stansted);
- LDE–LIS on easyJet (small airports pass the `tour ≥ 0.8` exception);
- TFS→OTP via IST (the super-hub bonus wins inside Europe).

**Rules (v0.6)**
1. **Carrier tiers on a nonstop pair**, picked in this order:
   - **Tier A:** low-cost carriers with a base (`hubs`) at the origin or destination that serve the pair.
   - **Tier B:** network or regional carriers of the origin or destination country, or carriers with a hub at either end.
   - **Tier C:** anyone else who serves the pair.

   `pickCarrier` gives Tier A 70% of departures when Tier A is not empty (B gets the other 30%), otherwise B 100%. C is used only when A and B are empty. The hash-based day/bank pick stays, so a ticket always shows the same flights.
2. **LCC-only airports.** Add `LCC_ONLY = ['STN','LTN','CRL','BVA','HHN','BGY','CIA','TSF','NYO','WMI','GRO','REU','EIN','SXF']` in `carriers.ts`. Network and regional carriers never serve these unless the airport is one of their own hubs, so EI is out at STN. The list includes only codes present in `airports.ts`.
3. **Small airports.** A low-cost carrier serves a `size < 3` airport only in one of two cases:
   - from a base in `SUN_SOURCE` to a leisure airport (`tour ≥ 0.6`);
   - the airport is in its new optional `Carrier.extra?: string[]` list.

   The old `tour ≥ 0.8` exception is removed, so LDE–LIS is not easyJet. LDE then connects through a French hub.
4. **Connections.** Hub candidates are tried in tiers, and the first tier with a valid connection wins. Inside a tier, the shortest total km wins, with −400 for the same airline on both legs.
   - **Tier 1:** hubs and LCC bases in the origin or destination country (flag hubs as today, plus `lcc.hubs` in those countries).
   - **Tier 2:** hubs on the same continent as both ends.
   - **Tier 3:** `WORLD_HUBS`. The super-hub bonus applies only here and only when the ends are on different continents.

   So TFS→OTP routes via MAD or BCN, and LIS→KBL still routes via IST/DXB/DOH.
5. **Self-connect.** A connection may combine two LCC legs at an LCC base, which is how crews really travel on low-cost tickets. `CONNECT_MIN` stays at 75 min.

**Tests** (`ops/commercial.test.ts`, extend)
- **Pair table:**
  - STN–DUB, DUB–STN → FR only;
  - LGW–GVA → U2 among the picks over 30 days;
  - BUD–OTP → W6;
  - BCN–PMI → VY appears;
  - ORY–AGP → HV or VY appears;
  - LDE–LIS → never U2, and connects in FR;
  - TFS–OTP → hub in ES (MAD/BCN/AGP…), never IST/DXB/DOH;
  - LIS–KBL → one connection at IST, DXB or DOH;
  - LIS–OPO → TP or FR.
- **Properties over 300 seeded random pairs with both ends in Europe:**
  - no itinerary uses a hub outside `continent === 'EU'`;
  - no network or regional carrier appears at an `LCC_ONLY` airport that is not its hub;
  - no LCC appears at an airport in its `avoid` list;
  - `itinerary` is deterministic (same input → same legs).
- Existing plumbing purity tests still pass.

---

## C2. Pacing tune (ENGINE: `contracts/offers.ts`, `contracts/clients.ts`, `core/balance.ts`, bot)

**Targets.** The bot must reach at least 1.0 meaningful actions per week and at least 80% active weeks on each of seeds 1–6, ideally about 2 per week. Seed 2 is at 1.4 per week today. Governments must pay "mostly late": at least 60% of their invoices late, pooled over seeds 1–6. The game must not get easier: offers per year stay within ±10% of v0.5.2, and margins stay inside the existing −5…+12% target.

**Changes**
1. **Quiet-week floor**, in `dailyOffers`. Spawn one gap-fit offer (`generateOffer` in mode `'gap'`) when all of these hold:
   - no offer created in the last 6 days was gap-fit;
   - a fleet aircraft has an idle window of at least 3 days within the next 45 days;
   - fewer than 4 offers are open.

   Record the time in `stats.lastGapOfferAt?: Minute`.
2. **`BAL.offersPerWeek` from 3.7 to 3.4.** This keeps the yearly count the same; the floor makes it steadier, not bigger.
3. **Government payers** (`clients.ts` `behaviour`):
   - government: `payReliability` from 0.35 to 0.2, `lateDays` from [20, 75] to [25, 90] (RESEARCH §4.3: governments are 30–90 days late);
   - aid agencies: 0.5 to 0.4.
4. **The new systems add real weekly actions:**
   - re-hiring after a resignation (about 0.5–1 a month at 60 crew);
   - booking conversions when a new type is coming;
   - occasional policy changes when morale drops;
   - per-aircraft extra crew when a widebody arrives.

   The bot counts each of these as an action (§9).

---

## F1. Roster board (UI: new screen; ENGINE: batched read APIs + one move action)

### F1.1 What the player sees
In the Crew tab, a header switch reads **People · Roster board** (`nav.view = 'board'`, remembered in `localStorage` key `bh.crewView`).

**Layout at 1180×820** (content area ≈ 960 × 700 after the shell):
- **Toolbar** (52 px):
  - filters: Base ▾, Rank (All · Pilots · Cabin · CPT · FO · CSD · SCC · CC), Type ▾ (rating family), and a search field;
  - **Week | Month** zoom;
  - **Drag moves: Duty | Trip**;
  - **Select** (multi-select mode);
  - **Today**.
- **Sticky day header** (40 px): date and weekday for each day, weekends faintly tinted, and a today line moved by rAF like the Gantt.
- **Sticky left column** (176 px): role badge, "Last, F.", base, a morale dot (green ≥ 60, amber 40–59, red < 40), and a "Leaves 12 Jul" tag for crew on notice.
- **Rows:** 52 px per crew member. Group header rows (28 px) by **base › rank › type**, e.g. "LIS · Captains · A320 (10)".
- **Grid:**
  - Week shows 7 days at about 112 px/day. Month shows 31 days at about 26 px/day.
  - The whole grid is native-scrolled in both directions with momentum. Rows are virtualised: visible rows plus 6 rows of overscan.
  - Blocks are time-proportional, using the v0.5.2 crew-strip colour keys and labels (`crewLogic.ts` `calKey`/`CAL_KEY_LABEL`; layers via `calLayer`).

**Cell text** (only when it fits whole, never truncated with "…"):
- **Week zoom:** a duty shows its flight numbers and route ("NB2341 HAM–PMI–HAM"). Deadhead shows "DH LIS–HAM", positioning "POS", a day off "OFF", then "SICK", "JOIN", "LV", and conversion "Conversion A330".
- **Month zoom:** short codes. A duty shows its first destination code ("PMI"); the others are OFF, SICK, JOIN, POS, DH, LV and CONV.

The legend sits under the grid, built from `calLegend` over the visible rows.

**Taps and gestures**
- Tap a duty → existing `DutyModal` (`{kind: 'duty', id}`).
- Tap a name → the crew card (`store.select({kind: 'crew', id})`, which switches to People).
- Tap any other block → a small detail popover with the block's `detail` text.

**Drag and drop (touch first)**
1. **Long-press 400 ms** on a duty block with the finger moving less than 8 px picks it up. Earlier movement scrolls as normal. On desktop, a mouse-down plus a 6 px move picks it up.
2. **On pickup**, the UI calls `dropTargets(g, dutyId, fromCrewId, scope)` once (scope from the toolbar). Every visible row is then tinted by its target:
   - green (`legal`);
   - amber (`tight`);
   - red (`illegal`);
   - grey hatch (`ineligible`: wrong rating or rank, on a trip under way, or busy with two or more overlapping trips).

   The source row is outlined. Nothing animates except the ghost.
3. **The ghost** is a copy of the block at 1.04× scale with a static shadow. It follows the finger, and a label bubble above it shows the hovered row's verdict:
   - "✓ Legal · ticket $250";
   - "Swap with NB2345 HAM–PMI (both legal)";
   - "✗ Rest 9:10 < 10:00 before NB2341";
   - "✗ Not rated A330";
   - "Late change: morale −2" (§F3, when the report is less than 72 h away).

   Auto-scroll runs while the finger is within 48 px of the top or bottom edge, at up to 600 px/s.
4. **Drop.** Dropping on the source row, outside the grid, or on a grey row cancels quietly.
   - Green or amber → `store.act(g => moveDuty(...))`; the toast is the engine's `msg`.
   - Red → the confirm modal "Assign anyway? It stays flagged red until fixed", then `moveDuty(..., {force: true})`.
5. Moved seats are **locked** (a lock icon on the block) and survive re-plans, as in v0.5.2. Unlock stays in `DutyModal`.

**Select mode.** Each row's name cell gets a 44 px checkbox, and group headers get "select all in group". A bottom action bar (56 px) shows "12 selected · **Convert…** · Clear" (§F2).

**Performance budget** (iPad A16, 120 crew × 31 days):
- `rosterBoard` for 20 visible rows over 31 days in ≤ 8 ms;
- `dropTargets` for 120 crew in ≤ 150 ms (≤ 40 ms on desktop);
- scroll at 60 fps, with no React render on scroll except when the visible row or day window changes (snapped to 4 rows / 2 days);
- re-render at most twice per second while the clock runs (`useRenderCount`).

### F1.2 Engine rules
**Moving a duty**, `moveDuty(g, dutyId, fromCrewId, toCrewId, scope, opts)`:
- **Scope `'trip'`:** the whole pairing still to fly, from the next unflown duty on. This is today's pairing-level change.
- **Scope `'duty'`:** only this duty. The engine first isolates it with `splitPairing` at `d.report` and at the next duty's report. The split parts keep their crew, seats, locks and tour, so other duties keep their people.
- **Target with no overlapping work** in `[report − 12 h, release + minRest]` → `assignCrew(..., {replace: fromCrewId})`.
- **Target with exactly one overlapping pairing (trip scope) or duty (duty scope)** → swap. The target's overlapping work goes to the source crew member, isolated the same way for duty scope. Uses `swapCrew`.
- **Anything else** → refused ("busy").
- **Legality** is checked with the existing `planCrew` / `checkAssignment` machinery: tickets, rest, FDP, cumulative limits, recovery, rating, status and location. Illegal moves are refused without `force`, and kept and flagged red with `force`. Trips under way can't change.
- **Late change.** When the moved duty reports less than `BAL.morale.lateNoticeH` (72 h) from now, both crew members get the late-change morale hit (§F3). The player's own late reshuffles therefore cost a little, as they do in real life.

**`dropTargets` is pure.** It must not split anything: for duty scope it evaluates a transient, unsaved one-duty pairing view. It returns a verdict for every crew member who exists, so the UI can tint every row.

**Standby** stays a reserved colour key with no engine duty in v0.6. The legend hides it while it is unused.

---

## F2. Bulk type-rating conversion (ENGINE: `crew/conversion.ts`; UI: `ConvertModal`)

### F2.1 Courses (RESEARCH §5.2, §5.4)
| Course | Who | Days | Cost per head | Phases shown in the class detail |
|---|---|---|---|---|
| Pilot type conversion | CPT, FO, CRP | **42** | narrowbody target $38,000 · widebody target $52,000 | Ground school d1–12 · Simulator d13–28 · Skill test & base training d29–30 · Line training & line check d31–42 |
| Pilot CCQ (common type) | pilots holding the partner family | **14** | $15,000 | Differences ground d1–4 · Simulator d5–10 · Line check d11–14 |
| Cabin type conversion | CSD, SCC, CC | **8** | $1,800 | Ground & safety d1–5 · Doors, slides, fire & first aid d6–7 · Exam & familiarisation d8 |
| Cabin differences (common type) | cabin holding the partner family | **3** | $600 | Differences course d1–3 |

**Notes on the course table**
- The common-type pairs are **A330/340 ↔ A350** and **B777 ↔ B787** (Airbus CCQ / Boeing common type rating). The A320 family is already one rating, and B757/767 is one family.
- Line training is simplified: it runs inside the class, off the roster, rather than flown on the line with a training captain. This is documented in the class detail ("Line training is flown under supervision; the trainee is not rostered").
- The costs cover course, simulator, instructors and base-training aircraft time. Salaries continue as normal. Everything is charged once at booking to `training`, and nothing is charged per day.

### F2.2 Rules
**Ratings after completion**
- **Pilots** hold one type: the new family replaces the old one. The exception is a common-type pair, where they keep both (mixed-fleet flying).
- **Cabin crew** keep their old types and add the new one, up to 3 (EASA ORO.CC.250; 4 needs an approval, not modelled). A cabin crew member who already holds 3 types gives one up: the player's choice, defaulting to a family with no aircraft in the fleet, otherwise the first-listed rating.
- **Salary** is recomputed with `salaryFor` (a widebody rating pays more), as `onTrainingDone` does today.
- **Pilot bond.** A company-paid pilot conversion sets `bondUntil = end + 24 months` (RESEARCH §5.4 bonding). While bonded, resignation chance × 0.3.
- **Morale +4** on completion ("new type").

**Eligibility.** Each crew member is included or skipped with a reason. They must:
- exist and not be `joining` by the start;
- not already be in or booked on a class;
- not be on notice;
- not already hold the target family;
- (cabin crew) hold at most 3 types after any drop.

Pilots of any rank qualify.

**Dates**
- `start` is a base-local day start, at least 2 days ahead (so rostered work can be re-crewed with notice) and at most 120 days ahead.
- Booking blocks each member from `start` to `end` (`blocks` with `why: 'training'`) and calls `removeCrew(g, id, start − 24 h, end)`. That refills their duties in the window and ticket-homes anyone away before the start day.
- At `start`, the crew `day` handler sets their status to `training` and the class to `running`.

**Classes are formed automatically**
1. Split the selection by **group** (pilot or cabin) and by **course** (full or CCQ; the durations differ).
2. Each group-course pool becomes `ceil(n/20)` classes of balanced size (25 → 13 + 12, not 20 + 5).
   - **Pilot classes** are filled CPT/FO alternately, so the simulator pairs exist. A class of 1 is allowed; it is a single trainee.
   - **Cabin classes** are filled seniors first, round-robin.
3. **Staggering** (one training centre):
   - **pilots:** a pilot class may start no earlier than 14 days after the previous pilot class of any family started. Ground school is shared and the simulator runs in shifts after that.
   - **cabin:** at most 2 cabin classes run at once; a third starts when one ends.

   Classes already booked count. The player picks only the first start date, and the plan shows when each class actually starts and ends.
4. **Naming:** `<label>-P<n>` / `<label>-C<n>` numbered per family over the save (A330-P1, A330-C1, A330-C2…). `familyLabel` maps 'A330/340' → 'A330', 'B757/767' → 'B767', 'B777' → 'B777', and so on.

**Cancelling**
- `cancelConversion(g, classId, crewId?)` cancels a whole class or one member.
- Refund: 100% if more than 14 days before the class starts, 50% from 14 days before, nothing once running. Refunds go through `post(g, 'training', +x)`.
- The `training` blocks and `TrainingItem`s are removed, and the crew go back to the roster on the next re-plan.

**Fleet-short warnings** (pure, in the plan). For each family that loses crew:
- **During the course:** compare "have" by role minus trainees with `staffing` need.
  - Red if have < need × 0.8, for example "A320 captains during the course: 7 of 10 needed".
  - Amber if have < need.
- **After the course:** pilots dropping the old rating ("After the course: A320 first officers 8 of 10").
- **Rostered duties** that lose a crew member ("31 rostered duties lose crew; the auto-roster will re-crew them").
- **Target type not in the fleet:** amber "No A330 in the fleet or on order".
- **Cash:** red if the cost is more than the cash on hand.

**Reuse.** Each member gets a `TrainingItem` (`kind: 'typeRating'` for full courses, `'conversion'` for CCQ, plus `classId`), so the existing `training.done` events, the calendar and `onTrainingDone` keep working. The class goes to `done` when its last item completes. `trainCrew(... 'typeRating' | 'conversion' ...)` now delegates to `startConversion` with one crew member, so single and bulk courses follow the same rules and prices. The old `BAL.typeRating` and `BAL.conversion` are superseded by `BAL.conv`.

### F2.3 UI
**Entry points**
- Crew list **Select** mode, then the bottom bar's "Convert…".
- Roster board Select mode, then "Convert…".
- The crew card's **Train**, which now offers "Type conversion…" (opens the modal for that one person), "Command upgrade" and "SCCM course".

**`ConvertModal`** (`{kind: 'convert', crewIds}`) is a 760 px sheet with two columns.
- **Left column:**
  - **Target type:** chips for families with aircraft in the fleet or on order first; others are greyed with "no aircraft".
  - **First class starts:** day chips for the next 8 weeks, Mondays highlighted, earliest at now + 2 days.
  - **People:** grouped Pilots (n) / Cabin (n). Each person is a removable chip. Skipped people are shown dim with their reason. A cabin crew member at 3 types gets a "drops B737 ▾" picker.
- **Right column:**
  - a mini-timeline of the classes (one bar per class: "A330-P1 · 12 pilots · 3 Jun – 15 Jul");
  - cost lines (pilots n × $52,000; cabin n × $1,800; total);
  - warnings, red first;
  - the primary button **"Book conversion · $702K"**, disabled while `ok` is false.

**Where conversions show**
- On rosters: the crew strip, roster board and duty lists show the block labelled **"Conversion A330"** (`CalBlock.kind 'training'`, `label` set by the engine). Its detail reads "Class A330-P1 · Simulator d13–28 · ends 15 Jul".
- The Crew list status line reads "Conversion A330 · until 15 Jul" (from `crewStatusView`).
- The Crew screen header gets a "Classes" chip ("2 classes running") that opens a small list with a cancel action per class or member, guarded by a confirm with the refund amount.

### F2.4 Inbox
- **On booking** (one message, `crew`, `info`): **"Conversion A330 booked: 3 classes"**. "Pilots A330-P1 (12) 3 Jun – 15 Jul. Cabin A330-C1 (17) and A330-C2 (16) 3 Jun – 11 Jun. $702K charged. Their rostered work in those dates goes back to the auto-roster."
- **On each class completing** (`good`): **"A330-P1 finished: 12 pilots now fly the A330"**. "Their A320 rating is no longer current." Or, for cabin: "20 cabin crew now hold A330 (they keep A320)."
- **On cancel:** "A330-C2 cancelled · $27K refunded".

---

## F3. Morale & attrition (ENGINE: `crew/morale.ts`; UI: crew card, Crew header, Company policies)

### F3.1 Model (RESEARCH §9.2–9.3, rescaled so that daily drift stays calm)
Morale is 0–100 on each crew member (already in the save). It is updated once per game day in the crew `day` handler, plus event shocks.

**1. Pull toward a target**: `m += (T − m) × 0.03` per day (half-life about 23 days). `T = 65 + perDiem + tour`, clamped to 45–80.

| Policy (existing fields) | Target effect | Cost side |
|---|---|---|
| Per diem `perDiemPct` 80–150 | `(pct − 100) × 0.15`, max +6 (80% → −3, 120% → +3) | Per diem × pct, as today |
| Max tour length `rotationWeeks` 4/5/6 | +2 / 0 / −2 | Shorter tours mean more crew changes and deadheads |

**2. Daily drivers** (applied to crew who exist and are not joining):

| Driver key | Rule | Per day |
|---|---|---|
| `hotel` | Resting away on a pairing where we pay the hotel (non-wet). On wet leases the client's hotel counts as 4★ = 0 | 3★ −0.4 · 4★ 0 · 5★ +0.25 |
| `tour` | Away from base longer than 28 days / 42 days | −0.15 / −0.3 |
| `offAway` | A base-local day with no duty spent away from base (days off at the client base) | −0.5 |
| `workload` | Duty hours in the last 28 days over 150 (limit 190) | −0.2 |

**3. Shocks:**

| Driver key | Event | Delta |
|---|---|---|
| `lateChange` | Assigned, unassigned or swapped on a duty reporting within 72 h, by the player or a re-plan. Does not apply to their own sick call | −2 |
| `discretion` | Commander's discretion (exists) | −3 |
| `pay` | Called in on a day off (exists, sick-crew decision) | −4 |
| `mission` | Once per pairing, at its last duty release: the contract's `effects.morale` (repatriation +6, sports and ad hoc +2, troop rotation +2). Future deportation archetypes (v0.7) plug in with −8 | ± |
| `extraCrew` | Each duty flown with at least 1 crew member above the legal minimum in their group (cabin, or pilots for a spare pilot) | +0.25 |
| `career` | Conversion completed | +4 |
| `pay` | Salaries paid while cash is below 0 at month end ("salaries paid late"; RESEARCH lists −25, damped here) | −15 (all crew) |
| `recognition` | A contract completes with on-time ≥ 85% and service ≥ 0 (§F4): the client thanks the crew who flew it | +2 |

**4. Why.** `moraleWhy` holds a decayed 30-day sum per driver key (`× 29/30` daily, plus today's contributions), rounded to 0.1 so it saves small. The UI shows the top 3 for each person and for the company.

**Expected levels**
- Default policies (4★, 100%, 5 weeks): about 65 at home and about 60 on deployments, from the days off at the hotel and the last tour week.
- Stingy (3★, 80%, 6 weeks): about 50, and about 45 deployed.
- Generous (5★, 120%, 4 weeks): about 73, at a cost of roughly +$15–25K a month at 2 aircraft.

### F3.2 What morale changes
- **Sickness:** `p = 0.04/30 × (1 + max(0, 60 − m)/50)` per day. At 60 or above it is as today; at 30 it is ×1.6.
- **Service quality** on each revenue leg, read in `flight.arr` from the operating crew:
  - `moraleTerm = clamp((avgCabinMorale − 60)/30, −1, 1) × 0.5`;
  - `extraTerm = min(0.4, 0.2 × cabin above legal minimum)`;
  - `service = moraleTerm + extraTerm` (−0.5 … +0.9). It is accumulated on `contract.service {sum, n}`.
  - At contract completion, and monthly for wet contracts: `client.relation += round(mean × 6)`, doubled for sports and VIP-like clients, and `reputation.reliable += clamp(mean × 0.5, −1, 1)`. This is small, but it is there.
- **Resignations.** A daily roll per crew member not on notice: `p = BAL.morale.resignPerMonth / 30 × mult × (bonded ? 0.3 : 1)`.
  - `resignPerMonth` = 0.008.
  - `mult` = 0.5 at morale ≥ 70, 1 at 50–69, 2 at 30–49, 3 below 30 (RESEARCH §9.3).
  - Expected: 60 crew at 65 morale → about 0.5 a month (≈ 10%/yr, realistic). At 45 morale → about 1 a month.
- **Notice period:** pilots 60 days, cabin 30 days (RESEARCH §5.4: notice periods are the bottleneck).
  - During notice they keep flying, and morale stops updating.
  - On the leave date, `removeCrew(now, ∞)` runs and the record is **deleted** from `g.crew`. Engine lookups of `g.crew[id]` must tolerate a missing id: logs, done flights and old pairings. The bot and tests check this.
  - `stats.resigned++`.
- **Strikes, retention offers, recurrent training:** not in v0.6.

### F3.3 UI
- **Crew card:**
  - a morale bar (exists) with an arrow for the 14-day trend;
  - a "Why" line with the top 3 drivers ("Days off away −6 · Long tour −3 · Repatriation +4");
  - risk chips "Sick risk ×1.4" / "Resign risk 2%/mo";
  - for crew on notice, a red banner: "Resigned · last day 12 Jul · Hire replacement" (opens `HireModal` with role, family and base preset).
- **Crew list rows:** a 10 px morale dot before the name, and "Leaves 12 Jul" in the status line.
- **Crew screen header chip:** "Morale 63 ▾2", tone by value. Tapping it opens a popover with pilots and cabin averages, counts below 40, people on notice, and the top company drivers.
- **Roster board:** a morale dot in the name column, a "Leaves 12 Jul" tag, and a hatched grey area after the leave date with label "Left".
- **Company → Policies:**
  - Hotel ★, per diem % and tour weeks each gain a one-line effect: "Morale target +3 · ≈ +$9K/month".
  - A summary row: "Crew morale target 65 → 70".
  - This comes from `policyPreview(g, patch)`, which is pure and is called while the player adjusts a control, before commit.

### F3.4 Inbox (one message per event, `crew` category)
- **Resignation** (`warn`, ref crew): **"Ana Costa (FO) resigned"**. "60 days' notice: last day 12 Jul. Morale 34: days off at the HAM hotel, a 7-week tour. Rated first officers take about 45 days to join: hire now to keep 5 sets."
- **Monthly** (with the statement, only when the company average moved 3 or more, or is below 50; `info`/`warn`): **"Crew morale 58 (−4)"**. "Lowest at the HAM deployment: days off at the hotel, long tours. Per diem 100%, hotels 4★, tours 5 weeks."
- **First time the average drops below 50** (`warn`, rearmed above 55): **"Crew morale is low (48)"**. "Expect more sick calls and resignations. Better hotels, per diem or shorter tours lift it."
- **Salaries paid late** (`bad`): **"Salaries paid late"**. "Cash was negative at month end. Morale −15 across the company."

### F3.5 Balance intent
Reasonable play (default policies, tours ≤ 5 weeks, few late changes) gives morale of about 60–68, about 8–12% annual attrition and a sickness rate near today's. Stingy play saves roughly $10–20K a month at 2 aircraft but costs 2× resignations and +20–30% sick calls, which is noticeable within 2–3 months. Nothing drops faster than about 2 points a day, except the late-salary shock.

---

## F4. Extra crew above the legal minimum (ENGINE: `crew/extra.ts` + complement; UI: Fleet, OfferModal, Contracts)

### F4.1 Rules (RESEARCH §5.2: VIP/sports/government min + 2–4, long-haul + 2–3)
- **Setting.** `CrewExtra = { cabin: 0–4; pilot: 0 | 1 }` can be set per aircraft (`Aircraft.crewExtra`) and per contract (`Contract.crewExtra`).
- **Effective extra** for a pairing:
  - `cabin = max(requirements.extraCabin, contract.crewExtra?.cabin ?? aircraft.crewExtra?.cabin ?? policies.extraCabin)`;
  - `pilot = contract.crewExtra?.pilot ?? aircraft.crewExtra?.pilot ?? 0`.

  `policies.extraCabin` stays as the company default; the Company screen relabels it "Default extra cabin crew".
- **Seats:**
  - `pairingRoles` adds the extra cabin seats as CC and the spare pilot as one `CRP` seat (fillable by FO/CRP, existing `canFill`). These seats carry `CrewSlot.above = true`.
  - The spare pilot gives **no** FDP augmentation credit. Augmentation still needs the approval and the in-flight-rest rules.
- **Optional seats:**
  - An empty `above` seat **never** makes a duty illegal or a flight uncovered. `dutyLegality` and `flightCrewStatus` show it amber ("1 extra cabin seat empty"), and the departure crew check ignores it.
  - The auto-roster fills `above` seats after all required seats, with the same candidate rules.
- **On-board spare:** when a required seat on a pairing loses its holder (sickness, `removeCrew`, resignation), the engine first moves an `above` seat holder who `canFill` the role into it. That costs no ticket and no positioning; it is the realistic reason to carry a spare on long trips away. The `above` seat is then left empty.
- **Costs** come from the existing mechanics, with no new ledger line:
  - more people per complement means `staffing` need rises (hire more), salaries rise, and per diem and hotels rise while away;
  - `crewExtraQuote` shows the estimate: extra people needed at 5 sets per aircraft, per diem and hotels per month from the aircraft's last 28 days away, and salaries.
- **Benefits:** morale `extraCrew` +0.25 per duty, and service `extraTerm` (§F3.2).
- **Clients who ask or pay:**
  - **Request (exists):** sports (+2 cabin, `requirements.extraCabin`).
  - **Pay (new, `Requirements.extraCabinPaid = {n, pct}`):** offered with probability 0.4 on ad hoc, tour series and troop rotations with any sector of 6 h block or more, and 0.25 on sports.
    - `n` = 1 on narrowbody, 2 on widebody.
    - `pct` = 0.0075 × n: +0.75% of the charter price, or of the wet rate per BH, for each extra crew member.
    - At accept (`SignOpts.crewExtra`), if the effective cabin extra is at least `n`, the contract's price or rate is multiplied by `1 + pct` and `contract.crewExtra.cabin` is locked at least at `n` for the contract's life (`setCrewExtra` refuses to go lower).
    - The offer card and OfferModal show the chip "Client pays +0.75% per extra cabin crew".
- **Feasibility:** `crewAvailability`/`staffing` include the effective extras, so the planner shows the real crew need.

### F4.2 UI
- **Fleet aircraft card:** a "Crew" row reads "Legal minimum 2 pilots + 4 cabin". Below it are an **Extra cabin** stepper (0–4) and a **Spare pilot** toggle, with the quote line "+2 cabin → +10 people at 5 sets · ≈ $31K/month · Morale + · Service +". Changes call `setCrewExtra({aircraftId}, …)`, and "Reset" sets it back to the company default.
- **OfferModal:** an "Extra cabin crew" stepper for this contract, defaulting to the aircraft or company value. When the offer has `extraCabinPaid`, a toggle "Fly +2 cabin crew · client pays +1.5% (+$3.8K)". The value is passed in `SignOpts.crewExtra`.
- **Contracts → Active row detail:** the same stepper and toggle (`setCrewExtra({contractId}, …)`), locked at the paid minimum.
- **DutyModal / crew seats:** `above` seats are tagged "Extra" and an empty one shows amber, not red.

---

## 5. Data model (ENGINE lands these first, in one edit of `core/types.ts`)

All new fields are optional; `load` defaults are listed in the comments.

```ts
// Crew
export type MoraleDriver = 'policy' | 'hotel' | 'tour' | 'offAway' | 'workload' | 'lateChange' | 'discretion' | 'mission' | 'extraCrew' | 'career' | 'pay' | 'recognition';
export interface CrewMember {
  // …existing
  /** v0.6: resigned; keeps flying until `leaves` (then removed). */
  notice?: { given: Minute; leaves: Minute };
  /** v0.6: decayed 30-day morale contributions by driver (UI "why"). */
  moraleWhy?: Partial<Record<MoraleDriver, number>>;
  /** v0.6: company-paid pilot conversion bond (resignation × 0.3 until then). */
  bondUntil?: Minute;
}
export interface CrewSlot { /* …existing */ /** v0.6: seat above the legal minimum (crew-extra settings): optional, never blocks departure. */ above?: boolean }
export interface CrewExtra { cabin: number; pilot: 0 | 1 }
export interface TrainingItem { /* …existing */ /** v0.6: class this course belongs to. */ classId?: string }
export interface TrainingClass {
  id: string;
  /** 'A330-P1' / 'A330-C2'. */
  no: string;
  family: RatingFamily;
  group: 'pilot' | 'cabin';
  course: 'full' | 'ccq';
  start: Minute;
  end: Minute;
  crewIds: string[];
  costPerHead: number;
  status: 'planned' | 'running' | 'done' | 'cancelled';
  /** Cabin crew at 3 types: the rating each gives up at completion. */
  drop?: Record<string, RatingFamily>;
}
// Fleet / contracts
export interface Aircraft { /* … */ /** v0.6: extra crew above the legal minimum (unset = company default). */ crewExtra?: CrewExtra }
export interface Requirements { /* … */ /** v0.6: client pays pct of price/rate when we fly ≥ n extra cabin crew. */ extraCabinPaid?: { n: number; pct: number } }
export interface Contract { /* … */ crewExtra?: CrewExtra; /** v0.6: service score accumulator (§F3.2). */ service?: { sum: number; n: number } }
// Root
export interface Stats { /* … */ resigned?: number; conversions?: number; /** weekly company morale averages, newest last, max 12. */ moraleWeeks?: number[]; lastGapOfferAt?: Minute; /** low-morale message armed. */ moraleLowWarned?: boolean }
export interface GameState { /* … */ /** v0.6: conversion classes. load: ??= {} */ classes?: Record<string, TrainingClass> }
```

**Load defaults** (crew module `load`):
- `g.classes ??= {}`;
- crew already in `training` from old saves keep their items and have no `classId`;
- nothing else, because the remaining fields are optional and read as `?? default`.

**No new `SimEventType`.** Class starts, resignations and leave dates run in the crew `day` handler (base-local day boundaries are not needed: UTC day ticks are fine for whole-day effects).

## 6. Balance (`core/balance.ts`, new ENGINE blocks)

```ts
// ---------- crew v0.6 (ENGINE) ----------
conv: {
  pilotDays: 42, pilotCost: { narrow: 38_000, wide: 52_000 }, pilotCcqDays: 14, pilotCcqCost: 15_000,
  cabinDays: 8, cabinCost: 1_800, cabinCcqDays: 3, cabinCcqCost: 600,
  classMax: 20, pilotStaggerDays: 14, cabinParallel: 2, leadDays: 2, maxAheadDays: 120,
  refundFull: 14, bondMonths: 24, bondFactor: 0.3,
  ccq: [['A330/340', 'A350'], ['B777', 'B787']] as [string, string][],
},
morale: {
  target: 65, targetClamp: [45, 80] as [number, number], revert: 0.03,
  perDiemPerPct: 0.15, perDiemMax: 6, tour: { 4: 2, 5: 0, 6: -2 } as Record<number, number>,
  hotelDay: { 3: -0.4, 4: 0, 5: 0.25 } as Record<number, number>,
  awayDays: [[28, -0.15], [42, -0.3]] as [number, number][], offAway: -0.5, heavy28dH: 150, heavy: -0.2,
  lateChange: -2, lateNoticeH: 72, extraDuty: 0.25, career: 4, recognition: 2, salaryLate: -15,
  sickSlope: 50, resignPerMonth: 0.008, resignMult: [[70, 0.5], [50, 1], [30, 2], [0, 3]] as [number, number][],
  noticeDays: { pilot: 60, cabin: 30 }, whyDecay: 29 / 30,
  service: { moraleW: 0.5, extraPer: 0.2, extraMax: 0.4, relation: 6, reliable: 0.5 },
},
crewExtra: { cabinMax: 4, paidChanceLong: 0.4, paidChanceSports: 0.25, paidPctPer: 0.0075, longBlockMin: 360 },
```

Changed: `offersPerWeek` 3.4 (commercial block); government and aid payer values live in `clients.ts`.

## 7. Interfaces between lanes (final signatures; ENGINE ships stubs first)

All of these are exported from `src/engine/crew/index.ts`. The read APIs are pure and are added to `core/plumbing.test.ts`.

```ts
// F1 roster board (crew/board.ts)
export type MoveScope = 'duty' | 'trip';
export interface BoardBlock extends CalBlock { pairingId?: string; locked?: boolean; /** a duty the player can drag (not flown, not under way). */ movable: boolean }
export interface BoardRow {
  crewId: string; name: string; role: Role; base: string; families: RatingFamily[];
  morale: number; leaves: Minute | null; status: CrewStatus;
  blocks: BoardBlock[];
}
/** Rows for the given crew over [from, to): one shared index per call (no per-crew flight scans). Pure; cached by crewRev + window. */
export function rosterBoard(g: GameState, from: Minute, to: Minute, crewIds: string[]): BoardRow[];
export interface DropTarget {
  crewId: string;
  level: Legality | 'ineligible';
  kind: 'assign' | 'swap' | 'none';
  /** The target's work that would come back to the source crew member (swap). */
  swapDutyId?: string;
  /** Player-facing one-liner: 'Legal · ticket $250', 'Rest 9:10 < 10:00 before NB2341', 'Not rated A330', 'Busy: 2 trips'. */
  reason: string;
  ticket: number;
  lateChange: boolean;
}
/** Verdict for every crew member (keyed by id) for dragging dutyId off fromCrewId. Pure; ≤ 40 ms desktop at 120 crew. */
export function dropTargets(g: GameState, dutyId: string, fromCrewId: string, scope: MoveScope): Record<string, DropTarget>;
export function moveDuty(g: GameState, dutyId: string, fromCrewId: string, toCrewId: string, scope: MoveScope, opts?: { force?: boolean }): ActionResult<{ level: Legality; swapped: boolean }>;

// F2 conversion (crew/conversion.ts)
export interface ConversionRequest { crewIds: string[]; family: RatingFamily; start: Minute; drop?: Record<string, RatingFamily> }
export interface ConversionClassPlan { no: string; group: 'pilot' | 'cabin'; course: 'full' | 'ccq'; start: Minute; end: Minute; crewIds: string[]; costPerHead: number; cost: number; phases: { label: string; from: Minute; to: Minute }[] }
export interface ConversionPlan {
  ok: boolean;
  classes: ConversionClassPlan[];
  cost: number;
  skipped: { crewId: string; why: string }[];
  warnings: { level: 'warn' | 'bad'; text: string }[];
  dutiesAffected: number;
  /** Per included crew member: ratings after completion (pilots drop the old type unless CCQ; cabin keep ≤ 3). */
  ratingsAfter: Record<string, RatingFamily[]>;
  /** Cabin crew at 3 types: the default rating they give up (player may override via drop). */
  dropDefault: Record<string, RatingFamily>;
  earliest: Minute;
}
export function conversionPlan(g: GameState, r: ConversionRequest): ConversionPlan;               // pure
export function startConversion(g: GameState, r: ConversionRequest): ActionResult<{ classIds: string[] }>;
export function cancelConversion(g: GameState, classId: string, crewId?: string): ActionResult<{ refund: number }>;
export function conversionClasses(g: GameState): TrainingClass[];                                 // pure, planned+running by start
export function classOf(g: GameState, crewId: string): TrainingClass | null;                       // pure
export function familyLabel(f: RatingFamily): string;                                              // 'A330/340' → 'A330'

// F3 morale (crew/morale.ts)
export interface MoraleDriverView { key: MoraleDriver; label: string; value: number }
export interface MoraleView { value: number; target: number; trend14d: number; drivers: MoraleDriverView[]; sickMult: number; resignPerMonth: number; leaves: Minute | null }
export function moraleOf(g: GameState, crewId: string): MoraleView;                                // pure
export interface MoraleSummary { avg: number; pilots: number; cabin: number; trend: number; low: number; leaving: number; target: number; drivers: MoraleDriverView[] }
export function moraleSummary(g: GameState): MoraleSummary;                                        // pure
export function policyPreview(g: GameState, patch: Partial<Policies>): { target: number; targetNow: number; costPerMonth: number; costNow: number }; // pure

// F4 extra crew (crew/extra.ts)
export function crewExtraFor(g: GameState, aircraftId: string, contractId: string | null): CrewExtra & { source: 'client' | 'contract' | 'aircraft' | 'company'; paidMin: number }; // pure
export function crewExtraQuote(g: GameState, aircraftId: string, x: CrewExtra): { minimum: { pilots: number; cabin: number }; extraPeople: number; perMonth: number; morale: 'up' | 'none'; service: number }; // pure
export function setCrewExtra(g: GameState, target: { aircraftId: string } | { contractId: string }, x: CrewExtra | null): ActionResult;

// Changed (additive)
// contracts: SignOpts gains `crewExtra?: CrewExtra` (acceptOffer/counterOffer).
// calendar: CalBlock for a class has kind 'training', label `Conversion ${familyLabel}`, detail with class no. and phase;
//           CrewStatusView gains `leaves?: Minute` and its text reads 'Conversion A330 · until 15 Jul' / 'Leaves 12 Jul'.
// rosterActions: RosterSlotView gains `above: boolean`; DutyLegalityWarning code gains 'extraEmpty' (level 'tight').
// trainCrew(…'typeRating'|'conversion'…) delegates to startConversion([crewId]).
```

**UI store additions** (`src/ui/store.ts`, UI lane, additive):
- `ModalSpec`: `| { kind: 'convert'; crewIds: string[]; family?: RatingFamily }` and `| { kind: 'classes' }`.
- Crew `nav.view`: `'people' | 'board'`.
- `dev` helpers: `dev.morale(n)` sets everyone's morale, and `dev.resign(crewId)`; the ENGINE lane exposes `resignNow(g, crewId)` in `engine/dev.ts`.

**MAP lane**
- `MapPanels.tsx` aircraft panel crew list: tag `above` seats "Extra", and show "Leaves 12 Jul" for crew on notice, using `dutyCrew(...).slots[i].above` and `g.crew[id].notice`.
- No API of its own. Deadhead airline changes reach the map through the unchanged `commercialFlightsAirborne`.

## 8. Not in v0.6 (keep it simple)
The following are not part of v0.6:
- recurrent training and currency expiry;
- department heads;
- expat vs local crews;
- standby duties (the colour key is reserved only);
- strikes;
- retention offers or counter-offers to resigning crew;
- per-contract hotel choice;
- the A320↔A330 cross-crew qualification;
- crew bag and layover vignettes.

## 9. Bot (`scripts/acmi-bot.ts`, ENGINE)
**Policies.** The bot keeps the defaults. If the company average drops below 55 for 2 consecutive weeks, it raises per diem to 110%. If the average is still below 52 four weeks later, it sets hotels to 5★. It reverts to the defaults when the average is above 66. Each change counts as one action.

**Resignations.** On each resignation message, the bot hires 1 replacement of the same role, family and base (one action).

**Conversions.** When an aircraft of a family with no rated crew is acquired, or a family is short by at least 2 sets with delivery or contract start more than 45 days away, the bot books a conversion:
- it takes the surplus from the family with the most `have − need`, pilots and cabin together, with the start at the earliest date;
- it then hires the remainder.

This counts as one action per booking. It must not convert pilots out of a family that would leave it short (it checks `ratingsAfter` against `staffing`).

**Extra crew.** On widebodies the bot sets aircraft `crewExtra = {cabin: 1, pilot: 0}`. It accepts paid extras when `extraCabinPaid` is offered and staffing allows.

**Roster board.** The bot does not drag. Its tests exercise `moveDuty` instead.

**New printed lines:**
- morale avg, min and month-end trend;
- resigned and hired-back counts;
- classes booked and completed;
- extra-crew share of duties;
- government late share.

**New targets:**
- company morale 55–75 at month 12;
- resignations 4–20% of average headcount a year;
- conversions complete with no illegal duty flown;
- ≥ 1.0 actions per week and ≥ 80% active weeks on seeds 1–6 (run one seed at a time);
- governments late ≥ 60% pooled over seeds 1–6 (printed per seed);
- all v0.5.2 targets still pass.

## 10. Tests and acceptance

**ENGINE tests** (next to the code)
- **`crew/board.test.ts`:**
  - `rosterBoard` shows the same blocks as `crewCalendar` for 3 crew;
  - `dropTargets` levels: ineligible for wrong rating or rank, red with a rest reason, green, swap with exactly one overlap, busy with two;
  - `moveDuty` duty scope splits the pairing and the other duties keep their crew, and trip scope moves the rest;
  - locks survive `rerosterFrom`;
  - force-illegal stays flagged;
  - late change −2 on both crew members;
  - purity in plumbing.
- **`crew/conversion.test.ts`:**
  - 12 pilots + 33 cabin → P1 (12), C1 (17), C2 (16);
  - 25 cabin → 13 + 12;
  - 41 pilots → three classes staggered 14 days;
  - a third cabin class waits for one to end;
  - costs posted once to `training` (narrow vs wide target);
  - members blocked and their duties re-crewed; trainees away are ticketed home before the start;
  - completion: pilot A320→A330 drops A320; A330/340 → A350 keeps both; cabin keeps up to 3 and drops per `drop`; salary updates; bond set; +4 morale;
  - cancel refunds 100/50/0%;
  - warnings for a short fleet during and after the course;
  - plan purity;
  - a save/load round trip mid-class;
  - `trainCrew` delegation.
- **`crew/morale.test.ts`:**
  - over 180 days, a fixture at default policies settles at 60–70 and stingy policies settle lower, with the target formula matching the table;
  - every driver fires once with the right sign and size;
  - the mission delta is applied once per pairing;
  - the sickness slope;
  - resignations over 20,000 seeded crew-months match `resignPerMonth × mult` within 15%;
  - bond × 0.3;
  - notice: still rostered before the leave date, removed and deleted after, no crash in `flightCrewStatus`/`crewCalendar`/statements for a deleted id;
  - salary-late shock;
  - weekly history ≤ 12.
- **`crew/extra.test.ts`:**
  - `crewExtraFor` precedence;
  - the complement includes `above` seats (spare pilot as CRP);
  - an empty `above` seat doesn't make a flight uncovered or illegal;
  - a sick required seat is filled from an `above` holder with no ticket;
  - staffing need includes extras;
  - a paid option raises the price only when n is met, and setting below n is refused;
  - the service score moves the client relation.
- **`ops/commercial.test.ts`:** as in C1.
- **`contracts/offers.test.ts`:** the quiet-week floor spawns at most one per 6 days, and yearly offers stay within ±10% over 10 seeds.
- **`clients`:** governments are late in at least 70% of 1,000 invoices.
- **Save compatibility:** a v0.5.2 save (fixture JSON) loads, runs 30 days and serialises with no NaN.

**UI acceptance** (Playwright, `scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch)
- The roster board renders at Week and Month with 120 crew (`dev.fleet(10)` + hires). There is no horizontal page overflow, and scrolling feels smooth (no long tasks over 50 ms while scrolling in the performance trace).
- A long-press drag through CDP `Input.dispatchTouchEvent` tints the rows, the ghost label shows a reason, and the drop moves the duty (toast plus lock icon).
- Red drop → the confirm modal.
- Select 33 crew → ConvertModal shows 3 classes, the cost and warnings. Booking puts "Conversion A330" on the strip, the board and the list.
- The morale chip, popover, crew-card "why", notice banner and policy previews render. The Fleet extra-crew stepper shows the quote, and the OfferModal paid toggle changes the price.
- No console errors. Every tappable element is at least 44 px. Renders are at most 2 per second at 4×.

**MAP acceptance:** the aircraft panel shows "Extra" seats and notice tags, with no console errors.

## 11. File ownership and sequencing

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**` (new `crew/board.ts`, `crew/conversion.ts`, `crew/morale.ts`, `crew/extra.ts` + tests; edits in `crew/{index,calendar,hr,duties,roster,rosterActions,check,costs}.ts`, `ops/{commercial,flights,finance,events}.ts`, `contracts/{offers,clients,accept,pricing}.ts`, `engine/dev.ts`); `src/data/**` (`carriers.ts`); `scripts/acmi-bot.ts`; shared `core/types.ts` (the §5 block, first) and `core/balance.ts` (the §6 blocks + `offersPerWeek`); `core/plumbing.test.ts` additions | C1, C2, the engine side of F1–F4, the bot |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`: `screens/Crew.tsx`, new `screens/RosterBoard.tsx`, new `screens/rosterBoardLogic.ts` (+ `.test.ts`), `screens/{crewLogic,screenLogic,Company,Fleet,Contracts}.ts(x)`, new `modals/ConvertModal.tsx`, new `modals/ClassesModal.tsx`, `modals/{TrainModal,OfferModal,DutyModal,HireModal}.tsx`, `game/Modals.tsx`, `store.ts` (additive: ModalSpec, nav view, dev helpers); `src/styles/**` except map styles (new `styles/acmi/v06.css` imported from `styles/acmi/index.css`); `scripts/ipad-shots.cjs` (append board, convert and morale shots, as an exception to ENGINE owning `scripts/`) | The F1 board, the F2 modal and status displays, the F3 displays and policy previews, the F4 controls |
| **MAP** | `src/ui/map/MapPanels.tsx`, `src/styles/acmi/map.css` | The extra-seat and notice tags in the aircraft panel (small; may finish early) |

**Sequencing**
1. **ENGINE step 0:** land the §5 types, the §6 BAL keys and **stubs** for every §7 export. The stubs return empty or neutral values: `rosterBoard` maps `crewCalendar`, `dropTargets` returns `{}`, and the actions return `{ok: false, error: 'v0.6 stub'}`. Keep tsc green. UI and MAP build against the stubs from then on.
2. **ENGINE**, in this order: extra-crew seats (they touch the complement and departure checks) → conversion → morale → board actions → C1 → C2 tuning plus the bot last, because morale and resignations change the bot's numbers.
3. **UI** builds its screens against the stubs plus dev data and lights up as each engine piece lands. UI logic tests live next to the UI files (UI-owned).
4. **Merge order:** ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green, and the bot is run on seeds 1–6 one at a time.
