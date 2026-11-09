# BLOCK HOURS v0.19 "Scheduled routes": design

Plan of record for v0.19. Three lanes build it in parallel from a shared skeleton (step 0, §S). Lanes branch from `v019-step0` (see §T for the base rule).

Ground rules (as in UPDATE-0.16.md and UPDATE-0.17.md):
- Engine RNG only. Network rolls use their own side stream (`netSide(g, key)` in `engine/network/side.ts`), so new rolls never shift the rest of the game.
- Ids via `nextId`. Money only through `post`, `accrue`, `cashOnly` and `invoice`, each with a proper `LedgerCat` (§N.3).
- `SAVE_VERSION` stays 1. New fields are optional; `loadNetwork` gives `??=` defaults; `init` sets the same defaults, so a new game and a reloaded one serialise alike. Old saves (`/home/user/work/bugs1108/out/current.blockhours.json`, `/home/user/work/saves/s0612.json`, the fixtures) load and play exactly as before: no route exists until the player starts one.
- Every new problem is a four-line card (what · why · does it hurt · what you can do). Plain, short words. Times in UTC with local time alongside. Nothing flickers.
- The game's focus stays ACMI. Routes are **background income**: they run themselves once launched, and the player sees them only through launch decisions, the monthly route result, a few cards, and the choices that appear when ACMI work wants the aircraft.

Sources: `/home/user/work/v019/research-econ.md` (58 sources: fares, markets, costs, worked P&L) and `/home/user/work/v019/research-regops.md` (regulation, slots, EU261, sales, swaps). [F] = sourced fact there, [E] = estimate, [D] = design choice. Money in USD (the game's currency), at $1 ≈ €0.86.

---

## 0. The player's words and the goal

The player flew for Euro Atlantic (YU). YU flew three "scheduled" routes for stable side income with 767s standing in Lisbon:
- LIS–OXB–LIS (Bissau) under its own brand;
- LIS–TMS–LIS (São Tomé);
- LIS–DIL (Dili) with a fuel stop in Dubai.

When ACMI or ad-hoc work paid more, YU subleased its own flights. Often a client leased the aircraft that flew those rotations, so the duty moved to another aircraft. Passengers were upset when the usual 16-business-seat 767 (CS-TSU/TSV) became the all-economy one (CS-TST, 309 Y).

The player wants this feature in the background, but polished and realistic, and asked for these on 8 Nov 2026:
1. Cargo and extras are real income. That covers belly cargo, including the day-old chicks YU carried to São Tomé on every flight (live animals under IATA LAR), mail, perishables and NGO supplies, plus excess bags, seat selection and onboard sales. Cargo trades against passengers and fuel.
2. Launching a route is a long, staged process in a wizard. Each stage has a cost, a duration and possible setbacks.
3. The real frequencies are the defaults: weekly for OXB and TMS, monthly for DIL. The player has full control of frequency, days, times and shifts, plus drag-to-move on the Schedule board. Moving or cancelling our own flights costs a small penalty. Sub-chartering our own flights costs no penalty, only the price.
4. Per-sector passengers by class, load factor, cargo kg, and revenue, cost and profit per sector and per route, with trends.

**Design goals (balance §M):**
- A well-run route earns a modest, steady margin of about 2–8 % after aircraft and crew time. It is risky in its first months.
- Averaged over the year, a route earns less per block hour than ACMI.
- Its sweet spot is an aircraft that would otherwise stand in Lisbon: a weekly Bissau rotation then adds about $40–70k a week.

| # | Feature | Lane | One line |
|---|---|---|---|
| A | Route models | `net-engine` | Own brand (OXB), flown for a partner brand (TMS for STP Airways), or a charter series sold by our own tour operator (DIL). Each has different risk, revenue and permits. |
| B | Route catalogue | `net-engine` (data) | Real O&D markets from Lisbon (and Porto) with size, season, segments, competitors, fares, stations, runways, time zones and fuel stops. |
| C | Launch process | `net-engine` | An 11-stage launch: study → business case → rights and permits → slots → brand/partner → distribution → schedule filing and on-sale → marketing → station contracts → crew familiarisation → inaugural. Each stage has a cost, a duration and setbacks; it takes 3–9 months. |
| D | Timetable | `net-engine` (rules), `net-ops` (flights) | Any frequency, days and times, by IATA season. Single flights or a whole series can be moved, aircraft assigned per rotation, and sectors dragged on the board. |
| E | Demand and sales | `net-engine` | O&D market by month, segments (diaspora/VFR, government, NGO/business, tourism, students), competitors, elasticity, a booking curve, nested fare buckets (simple revenue management), no-shows. |
| F | Revenue | `net-engine` | Passengers by class, belly cargo (general, mail, perishables, live animals, NGO supplies), ancillaries (excess bags, seats, onboard sales). Payload is limited by range and runway. |
| G | Costs | `net-ops` (per leg), `net-engine` (monthly) | Fuel by station price, airport and passenger charges, handling, catering by class, passenger services, navigation, distribution, marketing, station overhead, crew, maintenance, insurance. |
| H | Operations | `net-ops` | Route flights are ordinary flights on our schedule and roster. When ACMI work wants the aircraft, the player chooses: swap, sub-charter, move or cancel. This section also covers disruptions, downgrades, re-protection and care. |
| I | Reputation | `net-engine` | Per route, 0–100: on-time, cancellations, product consistency, baggage, recovery. It drives future bookings. |
| J | Route P&L | `net-engine` (numbers), `net-ui` (views) | Per sector, per rotation, per route and per month, with trends and a comparison against ACMI. |
| K | Network area | `net-ui` | Contracts › Network: the list, the route page, the launch wizard, timetable editing, conflict choices and flight-sheet figures. It stays secondary to ACMI. |
| L | Bot | `net-ops` | `--routes` launches OXB on an idle 767 or A330 and handles conflicts by the cheapest choice; balance reports. |

---

## A. Three route models

Euro Atlantic's three routes were three different businesses [F, regops §1]. The game keeps all three, because each one teaches a different trade-off.

| | Own brand (scheduled) | For a partner (white label) | Charter series (own tour operator) |
|---|---|---|---|
| Real example | LIS–OXB as YU351/352, under the 1975 Portugal–Guinea-Bissau bilateral; YU and TAP designated in 2014 | LIS–TMS as STP Airways 8F508/509 (YU owns 38 %). STP is on the EU Air Safety List, so an EU operator flies it | LIS–DXB–DIL 2020–22, sold by YU's tour operator Sonhando at €1,980 one-way |
| Who sells the seats | We do: our code, website, agents, GDS, BSP | The partner does: its code, its shop | Our tour operator (packages and seat-only), group and government blocks |
| Our income | Tickets + cargo + ancillaries, all ours | A fixed fee per block hour from the partner, plus a share of ticket revenue above a load threshold | Tickets and blocks; groups pay deposits |
| Our risk | Full load and fare risk; EU261 on every flight | Low: the fee covers most costs; the partner carries the load risk; complaints go to the partner's name | Medium-high: few departures, a heavy directional imbalance, depends on anchor groups |
| Permits | Designation + foreign operator permit + LIS slot series | The partner's rights; our permit as operator; LIS slots under our operator code | Per-flight permits (no Portugal–Timor-Leste air services agreement found); the tech stop under the ICAO Transit Agreement (2nd freedom, no traffic at DXB) |
| Frequency | Weekly (2× in peak if demand) | Weekly | Monthly, or a dated series |
| Cancel the series | Slots lost if under 80 % flown | Partner relation hit | Group deposits refunded; the tour operator's insurance (Package Travel Directive) |

**Partner terms** (TMS, default):
- The partner pays `fee = 0.62 × rateBH(type) × block hours` per rotation, plus 50 % of the ticket revenue above 70 % load. For a 767 the fee is about $3.6k per BH.
- We pay fuel, airport charges, handling and catering, as on a charter.
- The partner pays distribution, marketing and passenger compensation, except for downgrades and cancellations we cause.
- A partner is a real client record (STP Airways, ST, airline, prestige 1) with relation and stars like any client. Sub-chartering a partner rotation follows the partner rule in §H.4.

**Tour-operator terms** (DIL):
- 60 % of seats are sold as blocks months ahead to anchor groups (teachers' programmes, ministries, the Church, NGOs) at a negotiated fare, with a 25 % deposit.
- The rest are sold seat-only through the tour operator, which keeps an 8 % margin.
- No slot history builds at foreign airports.

Our own brand uses our company's flight-number prefix (the existing ownFlightNo prefix). The tour operator is "<Company> Holidays". Every route can choose any model where the catalogue allows it (§B, `models`).

---

## B. Route catalogue (`src/data/routes.ts`, lane `net-engine`)

Each market lists its origin, destination, fuel stops, real O&D size, season, segments, competitors and fares. Values come from the research where marked [F]; the rest are [E] for the balance lane to tune.

### B.1 The three Euro Atlantic routes

| | LIS–OXB Bissau | LIS–TMS São Tomé | LIS–DXB–DIL Dili |
|---|---|---|---|
| Airports | LIS Humberto Delgado (UTC+0/+1, Level 3 coordinated, 38 movements/h) · OXB Osvaldo Vieira (UTC+0, runway 3,200 m) | LIS · TMS São Tomé Intl (UTC+0, runway 2,220 × 45 m) | LIS · DXB (UTC+4, tech stop, Level 3) · DIL Presidente Nicolau Lobato (UTC+9, runway 1,850 m; extension to 2,500/3,000 m due 2028) |
| Default model | Own brand | For a partner (STP Airways, code 8F) | Tour-operator charter |
| Default timetable [F] | Weekly, Friday: out LIS 06:40 → OXB; back OXB 13:30 → LIS 18:30 | Weekly, Saturday [E]: out LIS 10:00 → TMS, back TMS 18:30 → LIS next morning | Monthly (first Friday) [E]: LIS → DXB (tech) → DIL, two nights in DIL, back DIL → KUL (fuel) → DXB (fuel) → LIS |
| Sector block, 767 (game `blockMinutes`) | 4 h 15 each way | 5 h 45 each way | LIS–DXB 7 h 35, DXB–DIL 10 h 20; DIL–KUL 4 h 05, KUL–DXB 7 h 45, DXB–LIS ~7 h 50 |
| Why the stops | — | — | DIL's 1,850 m runway limits take-off weight: from DIL the 767 can't carry DXB fuel (game `rangeFromNm`: 2,970 nm), so it stops in KUL. DIL fuel costs ~35 % more than KUL [F] |
| O&D market (both ways, pax/year) | ~50,000 at OXB in total, demand > supply [F]; Lisbon's share ~55 % [E] → 27,500 | ~45,000 [E] (TAP 5/wk A321neo + STP 1/wk are the only links to Europe [F]) | ~6,000 Europe–Timor-Leste [E] (DIL ~200k/yr, mostly to Asia and Australia; ~50k Timorese abroad, up to 20k in the UK [F]) |
| Segments (share of demand) [E] | VFR/diaspora 62 %, government 10 %, NGO/business 14 %, students 8 %, tourism 6 % | VFR 55 %, government 12 %, business/oil 15 %, tourism 10 %, students 8 % | Teachers/cooperation 35 %, government/Church 20 %, VFR/diaspora (via the UK) 35 %, NGO 10 % |
| Directional balance | Even (peaks differ by direction) | Even | Out 1.0 : back 0.3 [F: 188 out, 36 back, Mar 2021] |
| Competitors [F] | TAP 3/wk (Tue/Thu/Sat), RAM via CMN, Air Senegal and Turkish via DSS, ASKY via LFW, Air Côte d'Ivoire via ABJ | TAP 5/wk A321LRneo (some via ACC, ~8 h); TAAG via LAD; ASKY via LFW | Connections via SIN, DPS, KUL, DRW (2–3 stops, ~$1,300 one-way) |
| Net fares, one way, excluding taxes: Y off-peak → peak / J [F → E] | $300 → $720 / $930 → $1,750 | $350 → $650 / $1,160 → $1,980 (J ≈ 2.8× Y [F]) | $1,750 → $2,300 / $4,050 → $5,200 (YU: €1,980 gross [F]) |
| Cargo (per rotation) | South 3–5 t general + 0.3 t mail; **north 0**: OXB has no EU cargo certification, so YU "never sold the belly" [F] | South 2–4 t, plus **day-old chicks on every flight** (live animals: 0.4–1.0 t [E]); north 0.5–1 t (fish, cocoa) [E] | Out ~3 t medicines and donations [F, 2021]; back ~0.5 t (coffee) [E] |
| Ancillary per pax [E] | $25 (excess bags dominate: €115 a bag [F]) | $22 | $15 (allowance doubled in the fare: YU's selling point [F]) |
| Political risk | Coup Nov 2025 [F]: OXB closures; the government may reassign its rights | The STP government can refuse to extend (2019 [F]) | No agreement: per-flight permits; teacher contracts can be lost (2021 [F]) |

### B.2 More Lusophone and VFR markets (realistic, in the catalogue)

| Market | Notes | Default |
|---|---|---|
| LIS–RAI Praia | Cabo Verde diaspora (Portugal's largest African community); TAP flies daily, Cabo Verde Airlines too; ~4 h 10. RAI runway 2,100 m (`limited` for a 767). Hard competition, good volumes | Own brand, 2/wk, narrowbody or 767 |
| LIS–SID Sal / LIS–BVC Boa Vista | Leisure; sold through tour operators; winter sun | Charter series |
| LIS–LAD Luanda | Large and high-yield, but TAAG and TAP fly daily. Real risk: kwanza repatriation, with ticket money that can't leave Angola for months [E]; `fxRisk` 0.3 | Own brand, weekly |
| LIS–MPM Maputo | Diaspora and business; TAP 3/wk [E]; 10 h 15 nonstop on a 767 | Own brand, weekly |
| LIS–REC Recife / LIS–FOR Fortaleza | The Brazilian community in Portugal (the largest foreign group); TAP serves both; ~8 h. Strong July and Christmas peaks | Own brand, weekly, seasonal |
| OPO–RAI / OPO–OXB | Northern diaspora; smaller markets, no TAP nonstop [E] | Own brand, seasonal |
| LIS–CCS Caracas | Madeiran and Portuguese diaspora. **Not available:** Venezuela revoked the operating permits of TAP, Iberia and other foreign carriers in Nov 2025 after they suspended flights [E: verify]. Listed greyed out with the reason. A world event may reopen it | — |

Each market row (`RouteMarket`) holds the fields in §R.1. The catalogue is data only; no market is open until the player starts its study.

---

## C. The launch process (lane `net-engine`; `engine/network/launch.ts`)

Starting a route is a project with eleven stages. Several stages run in parallel once the business case is approved, so a well-planned launch takes **4–6 months**. A rushed one takes about 10–12 weeks, at more cost and with a weak first month; one hit by setbacks takes 9 months or more. Nothing is instant.

Each stage has a state (`todo`, `running`, `done`, `delayed`, `failed`), a cost booked when it starts (or monthly), a duration rolled on `netSide`, and setbacks rolled once when it starts. Stages that need the player (business case, brand, timetable, fares, marketing level) wait for an answer. A card reminds the player after 7 days. The wizard shows the stage chain as a vertical timeline with expected dates. Setbacks appear as four-line cards.

| # | Stage | Starts | Duration | Cost (USD) | Possible setbacks |
|---|---|---|---|---|---|
| 1 | **Market study** (consultant: O&D data, MIDT, diaspora associations, competitor schedules, government/NGO interviews) | Player picks a depth: desk 2 wk $15k, ±35 % · full 5 wk $60k, ±15 % · full + survey 7 wk $90k, ±10 % | 2–7 weeks | $15–90k (`marketing`) | none; the uncertainty is the risk |
| 2 | **Business case** | After 1 | the player's decision (the game pauses on the card if the clock runs) | 0 | — |
| 3 | **Traffic rights and permits**: ANAC designation (own brand, under the bilateral), the destination's foreign operator permit, a tech-stop permit (UAE GCAA), per-flight permits (charter) | After 2 | designation 4–8 wk; foreign permit 6–12 wk; GCAA seasonal 1–2 wk; per flight 2–4 wk before each | $2k + $3–8k + $1.5k; per flight $1.5k (`routeSetup`) | Delayed +3–8 weeks (25 %); more documents asked (15 %, +$4k, +2 weeks); refused (2 %, world events raise it: a coup at the destination) |
| 4 | **Slots** at LIS (Level 3; DXB too for a tech stop) | After 2 | Next slot conference for a later season (June for winter, November for summer), or an ad hoc request for this season: an answer in 1–3 weeks | 0 (coordination) | Time offered is 1–3 h from the time asked: 12 % at LIS [F], 35 % for 06:00–10:00 and 17:00–21:00 [E]. The player accepts it or asks again (another 1–3 weeks) |
| 5 | **Brand and partner**: own code (an IATA designator if the company has none: $6,700 [F], 4 weeks), or partner terms (2–6 weeks to negotiate), or the tour-operator set-up (licence and insolvency bond: 6 weeks, $25k) | After 2 | 2–6 weeks | as listed (`routeSetup`) | Partner asks for a better fee (20 %: +4 % fee share) |
| 6 | **Distribution**: GDS participation (Amadeus/Sabre/Travelport), BSP Portugal + destination, website booking engine, call centre, ethnic travel agents | After 5 (own brand / tour operator only) | 6–10 weeks (BSP is the longest) | $35k once, then $3k/month (`distribution`); reused by later routes (half cost) | BSP needs a bank guarantee: $50k held for 12 months (cash, refunded) |
| 7 | **Schedule filing and on-sale**: timetable, type and cabin, fares; filed with the schedule aggregator; sales open | After 3 + 4 (+6) | Sales open the day it is filed. First flight ideally 6–11 months later; at least 8 weeks [F, D] | 0 | Under 12 weeks of sales: the first 4 weeks lose demand (§E.5 ramp) |
| 8 | **Marketing launch campaign** (diaspora radio and press, community associations and churches, agent incentives and familiarisation trips, digital, launch fares) | After 7 | 6–12 weeks before the first flight | Low $50k · Normal $100k · High $150k (`marketing`) | A rival reacts (30 % on an own-brand route): TAP adds a frequency or cuts fares for 3–6 months (§E.3) |
| 9 | **Station contracts** at each outstation and stop: ground handling, catering (often loaded in Lisbon for the return: double catering), into-plane fuel, a station manager or GSA | After 2 | 3–8 weeks | Station set-up $25k each outstation, $8k a tech stop (`routeSetup`); then overhead monthly (§G.10) | No local caterer meets the standard (40 % at OXB/TMS/DIL): double catering from LIS at +30 % weight and cost; fuel supplier only on cash terms |
| 10 | **Crew route familiarisation**: airport categories (EU ORO.FC.105): OXB, TMS and RAI are B, DIL is C [E]: each captain needs a briefing (B) or an observation flight or simulator session (C) before operating | After 7, before the first flight | Category B: 1 day per captain; Category C: 2 days (in the training list) | B $800, C $3,500 per captain (`training`) | Captains not qualified by the first flight → only qualified captains can be rostered on it (crew/rules check) |
| 11 | **Inaugural flight**: water salute at the outstation, press, VIPs | First rotation | — | $5k (`marketing`) | The first flight's on-time result counts double for route reputation |

**Business case (stage 2).** The study (stage 1) produces a demand estimate with a range (P10/P50/P90) for each season, the competitors, and the anchor customers it found. The business case shows the first 12 months, at P10/P50/P90, for the timetable and fares the player has drafted:
- passengers per sector and load factor;
- revenue and costs;
- route result and margin;
- break-even load factor;
- weeks to pay back the launch cost.

It also shows what the planned aircraft would have earned on ACMI in those hours (§J.3). The player chooses **Go** (stages 3–6 and 9 start in parallel), **Change the plan** (timetable, aircraft, fares, model), or **Shelve** (the study stays valid for 12 months).

**Launch pace and abandonment.** The player can stop a launch at any time: money spent stays spent, and the slots and permits lapse. A launch cannot start for a market already running or launching, or for one greyed out in the catalogue.

**Study accuracy.** The study draws a hidden "true" market factor `truth ~ N(1, σ)`, with σ 0.18 for the desk study and 0.10 for the full one, plus a season shape error. Its estimate shows `truth × (1 + N(0, accuracy))`. So a cheap study can be wrong, and the first months reveal the truth. The truth is stored on the route (`market.truth`) and never shown.

---

## D. Timetable and flights (rules `net-engine`, flights `net-ops`)

### D.1 Timetable

A route's timetable is a list of **series** (`RouteSeries`, §R.2). Each series has:
- a pattern: days of the week (a bitmask), every N weeks (1 = weekly, 2 = fortnightly), or monthly (the nth weekday of the month);
- local departure times for the out and back sectors;
- the sector chain: out sectors (with fuel stops) and back sectors;
- a minimum ground time at each stop: the type's `turnMin`; a tech stop takes 60 minutes on a 767 and 75 on a widebody with more seats;
- the night-stop length at the destination: 0 for a same-day turn, or a number of nights;
- the aircraft type, cabin layout and the planned aircraft (§D.3);
- the dates the series runs (normally one IATA season: summer is the last Sunday of March → the last Saturday of October; winter is the rest [F]).

Defaults come from the catalogue (§B.1): OXB weekly on Friday as a day turn, TMS weekly on Saturday with an overnight return, DIL monthly with two nights in DIL. The player can add a second series (a Wednesday frequency in peak months), change days or times, or set a one-off extra rotation (a Christmas extra).

Every change is checked before it is saved:
- legal turns at each stop;
- runway and range per sector (`planSector`, `runwayFit`, `rangeFromNm`);
- curfews (`core/curfew.ts`);
- the LIS slot: within ±60 min of the held slot is free; a bigger move asks for a new slot (§C stage 4, with an answer within 1–3 weeks for the next season, or 1–5 days ad hoc for this one);
- the crew FTL estimate of the duty (`restPlanForFlight`). A DIL day of LIS–DXB–DIL is ~19 h, so it needs an augmented crew or a crew slip in DXB [F]. The planner says which.

### D.2 Rotations and flights

A **rotation** is one dated departure of a series: out and back, with every sector. Rotations exist in the route state from the day the season is filed, up to 11 months ahead. Their flights are created as real `Flight`s on the planned aircraft `BAL.v019.ops.materialiseDays` (default 120) before departure. From then on they show on the Schedule board, block the aircraft for ACMI offers, and get crewed like any other flight.

Flights belong to a **route contract**: one `Contract` per route and IATA season, with:
- `archetype: 'scheduled'`;
- `product: { kind: 'charter', price: 0, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false }`;
- `sched: { routeId, season }`;
- penalties all zero;
- `clientId`: our own sales record for the own brand and the tour operator, or the partner.

So these work unchanged:
- trip moves (`tripOf`, `moveTrip`);
- sub-charter (`subcharterQuotes`, `subcharter`, `subleaseTrip`);
- crew planning and the roster;
- positioning (`relinkPositioning`);
- the flight sheet;
- maintenance clashes.

A DIL rotation uses the `legs` pattern with `hold: true` (aircraft and crew stay with it through the night-stops). Flight numbers come from the route (`YU351`-style: our company prefix + route number, odd out, even back; partner flights carry the partner's code, e.g. `8F508`).

Every route flight carries `Flight.sched` (§R.3): route id, rotation id, sector index, seats by class, passengers by class booked and flown, cargo kg, and the sector's revenue and cost once flown.

The **own sales record** is a `Client` with `own: true` (id from `g.network.ownClientId`). Client lists, offer generation, relations, stars and the client crises skip `own` clients (lane `net-ops` adds the guard where `Object.values(g.clients)` is used for those).

### D.3 Aircraft per rotation

A series names a type and cabin layout ("767-300ER 16J/251Y"), not a specific tail. When rotations are materialised, the engine picks the planned aircraft:
1. the series' preferred tail when it is free;
2. else the least-used free aircraft of that type and layout;
3. else of that type in another layout (a downgrade or upgrade, §H.3);
4. else the rotation is flagged "No aircraft": a red card 10 days out offers the conflict choices (§H.2).

The player can pin a tail, or change the aircraft of any rotation from the route page or by dragging on the Schedule board.

### D.4 Moving flights (player control)

- **One rotation, earlier or later**: the route page's rotation row (±15 min steps, or pick a date and time), or by dragging any sector of it on the Schedule board along its aircraft's row. **Dragging one sector moves the whole rotation.** The following sectors (the return leg, the fuel-stop legs) move with it, keeping turn times and legality. The drag uses the same long-press and live-quote pattern as check planning (`ops/maintMove.ts`, `MaintMoveModal`): while dragging, the quote shows the new times (UTC and local), the knock-on to other flights on that aircraft (`retimeKnockOn`-style, on a copy), the crew effect, the slot effect and the passenger cost (§H.5). Release, then confirm.
- **A whole series** (all rotations from a date): the timetable editor; the same quote, summed.
- **Cancel one rotation, or all rotations of a series from a date**: §H.5 costs.
- **Change the aircraft** of a rotation: the trip-move quote (`quoteTripMove`) plus the product effect (§H.3).

Moves are refused when they break a hard rule: a curfew, a runway, the aircraft's other flights that can't move, or a maintenance check. The quote says why in one line.

### D.5 Slots and the 80 % rule [F]

Each own-brand series holds a LIS slot series (and a DXB one for the tech stop). At season end, a series flown below 80 % loses its historic precedence. Cancelled rotations count as not flown; sub-chartered ones count as flown, because they operated under our code. The next season's request is then an ad hoc request (§C stage 4) with a 50 % chance of a time 1–3 h away. The route page shows "Slots: 23 of 31 flown (74 %): at risk".

---

## E. Demand and sales (`engine/network/demand.ts`, `sales.ts`; lane `net-engine`)

### E.1 Market size

For each market and direction, monthly demand is

`D(month, dir) = annual O&D × share(dir) × season[month] / 12 × truth × growth × events`

- `season`: the VFR index [F/E, research §2.4]: Jan 0.80 · Feb 0.60 · Mar 0.70 · Apr 0.85 · May 0.70 · Jun 0.85 · Jul 1.15 · Aug 1.20 · Sep 0.90 · Oct 0.70 · Nov 0.80 · Dec 1.30. The direction shifts it: southbound peaks mid-December and July; northbound peaks early January and late August/September (students). Each market may override (DIL: teachers out in January and September, back in July and December).
- `growth`: +3 %/year [E].
- `events`: world events (§I.4).

### E.2 Our share

Our flights win a share of each day's demand by a simple logit:

`U(ours) = −β_fare × fare/ref + β_nonstop × nonstop + β_freq × ln(our weekly freq) + β_rep × (rep − 60)/40 + β_bags × bagsBetter + β_mkt × awareness`

The competitors' utilities come from their frequency, fare, stops and the duration penalty from the catalogue.

Share = e^U / Σ e^U, and it applies only on the days we fly. Demand on other days goes partly to us: VFR travellers move up to ±3 days to a cheaper or nonstop flight (VFR 50 %, government 20 %, business 10 %).

Default weights [E]: β_fare 2.0 (elasticity about −1.2 for VFR, −0.6 for government/business, by segment), β_nonstop 0.6, β_freq 0.35, β_rep 0.5, β_bags 0.3, β_mkt 0.4.

- `awareness`: 0–1. It rises with the launch campaign and the ongoing marketing level, and fades without it (half-life 120 days).

### E.3 Competitors react

On an own-brand launch, a rival may react (§C stage 8): 30 % [E] that TAP adds a weekly frequency or cuts its fares 15 % for 3–6 months. Monthly, competitor fares drift ±5 %. World events can stop a competitor (TAP suspended Bissau in Dec 2013 [F]) and lift our share for months.

### E.4 Booking curve and fares (simple revenue management)

- **On sale** from the season filing (up to 331 days ahead [F]).
- **Booking curve** [F/D, regops §7]: share of final bookings by days out for a VFR long-thin route: >180 d 8 %, 180–90 d 15 %, 90–60 d 15 %, 60–30 d 22 %, 30–14 d 17 %, 14–4 d 13 %, 3–0 d 10 %. Holiday peaks shift 15 points earlier; government books late (half inside 14 days). Bookings arrive daily (Poisson on `netSide`) for every rotation on sale.
- **Fare buckets**: economy has three nested buckets (Saver 0.75 × base, Classic 1.0 × base, Flex 1.5 × base) and business one (J base). The cheapest open bucket sells.
  - The engine closes Saver once the booked load factor runs above the curve's expected load for that day out by 5 points, and closes Classic above 15 points.
  - It reopens Saver when bookings fall behind the curve with less than 21 days to go.
  - The player never manages buckets. The player sets a **fare level** per route (Low −12 % · Market · High +12 %) and can run a **sale** (−25 % Saver for 10 days, $5k of marketing, a booking burst), at most once a month.
- **Base fare** = the catalogue's off-peak → peak curve by month (the peak multiple is 1.5–2.4× the off-peak floor [F]), × the fare level.
- **No-shows**: 5 % on long-haul international [F, anecdotal]; tickets are mostly non-refundable, so no-shows keep their fare. Overbooking is off by default; "Overbook 3 %" can be switched on per route. Each denied passenger costs the EU261 amount and a reroute (§H.5).
- **Groups and blocks**: government, NGO and teachers' blocks of 10–60 seats are offered as cards 30–150 days out (accept at a fare −10 %, 25 % deposit, release unsold seats 21 days out). DIL's anchor blocks are what make it pay.

### E.5 Launch ramp and reputation lag

- **Ramp**: the first 8 weeks of a new route run at 70 % → 100 % of the share (people don't know the flight yet), and at less if sales opened under 12 weeks before.
- **Reputation lag**: reputation enters the share with a 30-day moving average.
- **Truth**: the hidden `truth` factor from the study (§C).

---

## F. Revenue (`engine/network/revenue.ts`)

All revenue is recognised when the sector flies, and cash arrives at sale. When a ticket is sold, its net price moves cash in (`cashOnly`) and is held on the route as **unearned** (`route.unearned`). On departure of the sector, `accrue('ticketRevenue', …)` books it and the unearned balance falls. A refund pays cash back (`cashOnly(−)`) and reduces unearned. This is how airlines really get a cash float from advance sales. The Finance view shows "Tickets sold, not yet flown: $X" under the cash line (UI lane).

| Line | Rule | LedgerCat |
|---|---|---|
| **Passenger tickets** | Σ over buckets of seats sold × fare, by class. Taxes and airport passenger charges (≈ €38 per departing LIS passenger [F], AED 50 at DXB only when passengers disembark [F]) are collected for the airport and paid on: they don't touch revenue or costs. They show on the sector card as "taxes passed on". | `ticketRevenue` |
| **Partner fee** (partner model) | The fee per block hour, invoiced monthly to the partner (`invoice`, 30 days), plus the revenue share | `ticketRevenue` (the partner's name on the receivable) |
| **Cargo** | §F.1 | `cargoRevenue` |
| **Ancillaries** | Excess bags: on VFR routes 35 % of passengers pay one extra bag at $95–130 [F: €115]. Seat selection: 8 % at $15. Onboard sales: $2.50 a passenger. Booked at departure. | `ancillaryRevenue` |
| **Group deposits** | Cash at signing (cashOnly), revenue when flown | — |

### F.1 Cargo, mail and live animals

Each sector has a cargo demand by type: general, mail, perishables, NGO and government supplies, and live animals (AVI). Each has a rate and a handling cost [E]:
- general: $1.9/kg south, $1.2/kg north;
- mail: $3.0/kg;
- perishables: $2.4/kg, with a temperature-controlled ULD;
- NGO supplies: $1.6/kg;
- **live animals: $3.6/kg**. These are day-old chicks to TMS on every flight. They must be loaded last and unloaded first, under IATA Live Animals Regulations, with a ventilated, temperature-controlled hold. The hold must be heated: on a 767 that means the bulk or aft hold only, at most 1.2 t.

Cargo demand per rotation comes from the catalogue (§B.1) × season (Christmas +30 % southbound) × a weekly noise of ±25 %.

The **payload limit** (§F.2) decides how much flies:
1. passengers with their bags (95 kg each) come first;
2. then mail;
3. then AVI (it can't wait);
4. then perishables, NGO supplies and general cargo, by rate.

Cargo left behind waits one rotation, or is lost.

**Station rules from the research:**
- OXB has no EU cargo certification [F]. Northbound cargo from OXB is 0 until a world event or a paid certification ($60k, 6 months, `routeSetup`) changes it.
- Any cargo bound for the EU needs ACC3 security validation of the outstation. That certification is the same project.

Cargo handling costs $0.25/kg at each end (`handling`).

### F.2 Payload, range and runway

`payloadMax(type, sector)` = structural payload (767-300ER: 40 t [E]) reduced by:
- range: a sector at the range limit leaves ~70 % of payload;
- the take-off runway when `runwayFit` is `limited`: payload × (available ÷ required)^1.5.

From DIL (1,850 m against 2,600 m) the 767 lifts about 60 % of payload, roughly 24 t, and the KUL stop is what makes even that possible. That matches the real 188 passengers out and 36 back. The limit applies per sector; on a fuel-stop chain, the tightest sector limits the through passengers.

**Tankering**: carry return fuel from a cheap station. It saves the price gap but burns 3.5 % of the extra fuel per block hour [E] and eats payload. A per-route switch "Tanker fuel from Lisbon" is off by default; the sector card shows the saving or loss of the last flight.

---

## G. Costs: every line (per sector in `ops/flights.ts` via `net-ops`; monthly in `network/index.ts`)

Today a charter leg pays `fuel`, plus `airportFees` with the flat `BAL.airportFees[wide] + BAL.catering[wide]` (`legCostEstimate`). For route flights (`f.sched`), `legCostEstimate` calls `routeLegCost(g, f, ac)` (`network/costs.ts`, pure) instead of the flat fees. The result is the same shape plus the new lines, so the cash forecast reads it too. Every number comes from `BAL.v019.cost` and the station table `ROUTE_STATIONS` (`data/routes.ts`).

| # | Line | Rule [source] | 767 example (OXB sector) | LedgerCat |
|---|---|---|---|---|
| G.1 | **Fuel** | `fuelTBH × BH × g.market.fuelPrice × stationFactor(uplift station)`. LIS 1.00, African stations 1.17 [F: Africa +17 %], DIL 1.35 × KUL [F], DXB 1.00, KUL 0.98. Tankering per §F.2 | 5.3 × 4.25 × $750 = $16.9k (OXB→LIS uplifted at OXB × 1.17) | `fuel` |
| G.2 | **Airport charges** (landing, parking, lighting, terminal control) | Per station: LIS landing by MTOW band ≈ $1,990 for a 767 [F: €1,713] + terminal control $200 [F]. OXB/TMS $2.3–3.5k [E]. DXB tech stop $2.5k [E]. DIL incl. two nights' parking $3.5k [E]. Scaled by MTOW for other types (`√(MTOW/187 t)`) | $2.2k at LIS, $2.9k at OXB | `airportFees` |
| G.3 | **Airline-borne passenger charges** (PRM, CUPPS/CUSS, slot charge, baggage system: the parts not passed on in taxes) | LIS ≈ $2.2 per departing passenger [F: €0.86 + 0.22 + 0.85 + bags]; others $1 [E] | $0.4k | `airportFees` |
| G.4 | **Ground handling** (ramp, passenger and baggage, load control, GSE) | LIS $4.5k per widebody turn [E]; OXB/TMS $5.2k [F: West African $4,150–5,260]; DIL $4.6k; DXB/KUL tech stop $2.4k; narrowbody × 0.5. Plus cargo handling $0.25/kg | $4.5k + $5.2k per rotation | `handling` |
| G.5 | **Catering by class** | Per passenger per sector: Y $10 (≤5 h), $16 (5–9 h), $28 (>9 h: two meals); J $45 / $60 / $115 [F: Y $4–10.50, J $25–33 a meal, plus equipment]; crew meals $18 each. **Double catering**: the return is loaded at LIS where no local caterer meets the standard (+30 % on the return) | ~$3.2k a sector | `catering` |
| G.6 | **Passenger services** (PSS and DCS per boarded passenger, PRM assistance, lost-bag handling, call centre, passenger liability insurance top-up, J lounge at LIS) | $3 PSS + $3 services + $1.5 insurance per passenger [F/E]; J lounge $30 per J passenger from LIS | ~$1.9k | `paxServices` |
| G.7 | **Navigation** (en-route) | Rate × km/100 × √(MTOW/50) [F: EUROCONTROL formula], with a blended rate per market from the catalogue: LIS–OXB $3.2k a sector, LIS–TMS $4.2k, the DIL round trip $34k total [F/E] | $3.2k | `navCharges` |
| G.8 | **Distribution** | Own brand: GDS $13 a segment on 55 % agency bookings [F: $11–16], card fees 1.8 % on direct sales, agent commission 0.5 % [F], PSS hosting already in G.6 → ~6–7 % of ticket revenue [F/E]. Tour operator: its margin 8 % + card fees. Partner: none (the partner pays). Plus the fixed $3k a month (§C stage 6) | ~6.5 % of tickets | `distribution` |
| G.9 | **Marketing** | Study, launch campaign, inaugural (§C); ongoing per route: Low $3k · Normal $8k · High $15k a month [F: €5–15k]; sales $5k each | — | `marketing` |
| G.10 | **Station overhead** (station manager or GSA, local sales office, permits renewal, rent) | $10k a month per outstation [F: €8–15k], $2k a tech stop, $12k per DIL operation for the per-flight permit team | $10k a month | `routeSetup` |
| G.11 | **Crew** | No new line. Salaries are already monthly. Per diems, hotels and positioning come from the crew module for the real duties (an OXB day turn has none; a TMS night-stop has a hotel; DIL two nights plus a DXB slip). Familiarisation goes to `training` (§C stage 10) | — | existing |
| G.12 | **Maintenance** | No new line: `maint` per BH and reserves as for any leg | $7.2k a sector | existing |
| G.13 | **Insurance** | Hull and liability monthly as today. G.6 adds the per-passenger top-up. War-risk cover per landing applies where world events flag the zone | — | existing |
| G.14 | **Passenger compensation and care** | §H.5 (EU261 on the day, small planned-change costs, downgrade refunds, re-protection tickets, hotels and meals) | — | `paxComp` |
| G.15 | **Launch costs** | §C stages 3, 5, 9; certification projects | — | `routeSetup` |

**Aircraft and crew time** (for the route P&L only, no ledger entry, since rent and salaries are already booked monthly):
- the aircraft's rent + insurance + reserves pro rata to the block hours it flew that month;
- the crew's salaries for the BH flown at the family's average BH per person.

**Rough 767 OXB rotation at $750/t, 75 % Y and 55 % J** (target shape for the balance lane, not hard-coded):

| | Amount |
|---|---|
| Revenue | ~$150k (tickets $128k + cargo $9k + ancillaries $11k + mail $1k) |
| Direct costs | ~$105k: fuel $36k, airport + handling + pax charges $19k, catering $6k, pax services $3.5k, navigation $6.4k, distribution $8.5k, maintenance $14.5k, marketing + station overhead $5k, comp provision $3k, plus crew per diems |
| Contribution | ~$45k, about $5.0k per BH |
| Aircraft and crew time at cost | ~$22k |
| Route result | ~$23k |

In the peak this is the shape; across the year (off-peak load factors of 55–65 % and lower fares) the route lands at the §M targets.

---

## H. Operations: route flights next to ACMI (lane `net-ops`)

### H.1 Same schedule, same roster

Route flights are normal flights, as described in §D.2:
- The roster crews them from the home base like any trip.
- Crew Control fixes shortages on them.
- Delays and recovery treat them like charter legs, but with the passenger rules of §H.5 instead of contract penalties.
- The latePolicy penalty is 0 because the penalties are 0.
- Positioning, curfews, diversions, world closures (force majeure) and tech delays all apply unchanged.

**Crew route qualification**: a captain without the airport familiarisation (§C stage 10) can't be rostered on that rotation. This is a crew rule hook (`crew/rules.ts` `routeQualified`), and the crew list shows "OXB · TMS · DIL" quals.

**Crewing plan per route default** [E]:
- OXB: day turn of ~10 h 30, 2 pilots, no hotel.
- TMS: 5 h 45 each way with a night-stop, so a single crew with a hotel; or a 13 h day turn on an augmented crew (3 pilots).
- DIL: LIS–DXB with one crew, slip in DXB, a DXB–DIL crew with a night-stop in DIL; back DIL–KUL–DXB with an augmented crew, then a DXB–LIS crew. The planner picks the cheapest legal pattern from the existing machinery (it decides slips and augmentation already).

### H.2 When ACMI work wants the aircraft: four choices

When the player signs an offer, accepts a call, or moves a trip, and the aircraft holds route rotations in that window, the offer's feasibility shows them as **route conflicts**, not blockers. One row per rotation is listed under "Your scheduled flights on this aircraft". Each row has four choices, each with its real money effect:

| Choice | What happens | Cost shown |
|---|---|---|
| **Swap aircraft** | The rotation moves to another of our free aircraft (trip move): its ferries, crew and times, via `quoteTripMove` | The trip-move net + the product effect (§H.3): "16 business passengers downgraded: refund 50 % ($7.6k) + goodwill vouchers ($1.6k)" |
| **Sub-charter** | Another operator flies it with its aircraft and crew under our flight number ("operated by Hi Fly"). The passengers are told the operating carrier [F: Reg. 2111/2005 Art. 11] | The rival's price only. **No reputation, relation or satisfaction penalty** (the player's rule). The route keeps its ticket revenue; we no longer pay fuel, fees, handling or catering on those sectors (the operator does); distribution, marketing and station overhead stay ours. A rotation flown by a smaller cabin than sold still triggers §H.3 (the quote picks a matching cabin first) |
| **Move** | The rotation leaves earlier or later (a date or time picker) so it fits around the new work | §H.5 small move cost |
| **Cancel** | The rotation is cancelled; passengers are re-protected or refunded | §H.5 small cancel cost; the slot 80 % count |

The dialog shows a one-line verdict: "Taking the ACMI job earns $412k; moving your 3 Bissau rotations to CS-TST costs $24k (business class lost on 2). Net +$388k." A **Same choice for all** button applies one choice to every listed rotation. The bot and the default pick the cheapest: sub-charter if one is available and cheaper than the swap net, else swap, else move, else cancel.

Engine API (`network/conflicts.ts`, pure quotes plus apply):
- `routeConflicts(g, aircraftId, from, to)` lists the rotations in a window;
- `rotationChoices(g, rotationId, opts)` returns the four quotes;
- `resolveRotation(g, rotationId, choice, expect)` applies one.

The offer accept path (`acceptOffer`) gains an optional `routeChoices?: Record<rotationId, Choice>` in `SignOpts`. Without it, accepting an offer that overlaps rotations applies the default choices.

### H.3 Product consistency: business class lost, or seats short

At **departure** of each route sector, the actual aircraft's cabin is compared with what was sold. This works however the swap happened: a player swap, an AOG swap, a trip move, Crew Control or recovery.

- **Business seats lost** (J sold > J installed):
  - each downgraded passenger gets the EU261 Art. 10 refund of 30 % / 50 % / 75 % of that flight's fare by distance [F: OXB 50 %, TMS and DIL 75 %], booked to `paxComp`;
  - plus goodwill (default on): a $100 voucher (a future discount, booked as 0.6 × $100 of `paxComp` at issue), the front rows and priority;
  - route reputation −2 per sector, and −1 more if under 14 days' notice;
  - J demand on that route −15 % for 60 days (business travellers remember);
  - a passenger complaint message in the inbox.
  - If the player chose the swap ≥14 days before departure, passengers were told early: the reputation hit halves and 30 % of J passengers take a free date change instead (no refund).
- **Fewer seats than booked** (Y booked > Y installed, e.g. to a smaller type): offload the excess. Volunteers come first: 60 % take a $250 voucher. The rest are involuntarily denied boarding, which costs EU261 €400/€600 + re-protection (§H.5) and reputation −1 per 10 passengers.
- **More seats** (an upgrade to a bigger type): no penalty. The extra seats sell in the last days at Classic fares.

### H.4 Sub-charter of our own flights

Sub-charter as in §H.2. No penalty, only the price: `subHit` returns zero for `sched` contracts. For a **partner** route, the partner is still told of the operating carrier, but its relation is not hit (the player's rule; a partner fees clause pays the same).

Prices come from `subcharterQuotes`, quoted from the rival's rate × BH as today:
- a short-notice premium: +20 % within 14 days, +40 % within 3 days [F: research §6.1];
- the research benchmark of $8–14k/BH for a widebody wet-lease in;
- the real case: the USC A340-300 flying LIS–OXB in Sep 2026 [F].

### H.5 Moving and cancelling our own flights, and the day of operation

The player will move and cancel rotations often, so a **planned** change made before the day costs little. It scales with how close the departure is (`BAL.v019.pax.change`).

| Notice before departure | Move (per passenger booked) | Cancel (per passenger booked) | Demand dent |
|---|---|---|---|
| ≥ 14 days | $3 rebooking cost | refunds (cash back from unearned) + $3 | none |
| 7–13 days | $8 | refunds + $12 | route reputation −0.5 |
| 2–6 days | $20 | refunds + $35, re-protection on another carrier for 30 % of passengers at $350 | −1 |
| < 48 h | $40 | refunds + $60, re-protection for 50 % at $450 | −2 |

**On the day** (operational), the real rules apply, because the player doesn't choose these:
- a delay of 3 h+ at arrival, or a cancellation within 24 h for a cause of ours (technical, crew), pays EU261 [F]: €400 (OXB) or €600 (TMS, DIL), halved when re-protection arrives within 3 h or 4 h;
- care: meals from 2 h, 3 h or 4 h by distance; a hotel and transfers for an overnight delay ($180 each);
- world closures and weather are extraordinary circumstances: no compensation, but care is still due [F].

All of it goes to `paxComp`. The existing disruption pipeline (`ops/disrupt.ts`, recovery in `ops/flights.ts`) calls `routeDisruptionCost(g, f, kind, minutes)` for `f.sched` flights instead of contract penalties.

This is a deliberate simplification at the player's request. Real EU261 treats a planned move of more than 1–2 h inside 14 days as a cancellation with full compensation [F, research §6.3]. The research numbers stay in `BAL.v019.pax.eu261` for the on-the-day cases, and the glossary entry explains the difference in one line.

**Re-protection** when a rotation is cancelled is automatic:
- first our own next rotation if it is within 7 days and has seats;
- then the competitor (TAP for OXB/TMS) at the catalogue's walk-up fare;
- the rest are refunded.

The rotation card shows how many passengers took each.

---

## I. Route reputation (`network/reputation.ts`)

Each route has a reputation from 0 to 100. It starts at 60, or at the company's `reliable` if that is lower. It moves after each sector and fades toward 60 (half-life 180 days).

| Event | Change |
|---|---|
| Sector on time (≤ 15 min) | +0.3 |
| Late 15 min – 3 h | −0.5 |
| Late 3 h + | −2 |
| Cancelled on the day | −4 |
| Planned move or cancel | §H.5 |
| Business class lost | §H.3 |
| Denied boarding | −1 per 10 passengers |
| Baggage incident (random, more on full flights and Christmas: 1.5 % of full flights [E, the biggest real complaint driver]) | −1 |
| Sub-charter | 0 (player's rule) |
| Re-protection handled within 2 h, compensation paid promptly | +0.5 |
| Same aircraft and cabin as advertised for 8 rotations in a row (product consistency) | +1 |

Reputation feeds the share (§E.2, 30-day average). It is shown as words: Poor < 40 · Mixed 40–55 · Good 55–75 · Very good > 75. World events (§I.4) may shift demand.

**I.4 World events touching routes** (existing `ops/world.ts` kinds, plus three new ones in the catalogue, lane `net-engine`):
- a coup or unrest at the destination: closure (force majeure) and demand × 0.6 for 60 days;
- a competitor suspends: our share up for 3–6 months;
- a government block contract offered (teachers, troops' families, election observers) or lost;
- a fuel spike (the existing fuel market);
- the OXB cargo certification granted;
- DIL's runway extension opens (2028): heavier take-offs and nonstop DXB possible.

Each event is a four-line card on the route.

---

## J. Route P&L and statistics (`network/pnl.ts`, lane `net-engine`)

### J.1 Per sector (on arrival)

For each sector, `SectorLoad` records:
- seats and passengers by class (booked, flown, no-shows, denied);
- load factor by class and in total;
- cargo kg by type, and the payload used against the limit;
- revenue (tickets, cargo, ancillaries), direct costs by line (§G) and the sector result;
- on-time.

`Flight.pax` is set to the passengers flown (so existing views keep working).

The **flight sheet** of a route flight shows a compact block (UI lane):

> **YU351 LIS–OXB** · 767-300ER CS-TSU 16J/251Y
> J 9/16 · Y 214/251 · LF 85 % · cargo 3.8 t (chicks 0.6 t) · mail 0.3 t
> Revenue $78.4k · costs $52.1k · **result +$26.3k**

The figures are booked so far before departure and flown after it.

### J.2 Per rotation, per route, per month

`route.pnl[month]` sums revenue by line, direct costs by line, the aircraft and crew time (§G), the result, BH, sectors, passengers, seats, load factor, cargo kg, on-time, cancellations, swaps, sub-charters, downgrades and launch spend.

The **route page** shows:
- the last 12 months as a small bar chart (result per month, launch costs apart);
- trend arrows on LF, yield, result and reputation (month against the same month last year, or the last 3 against the 3 before);
- the next 8 rotations with booked load per sector by class, and the open bucket (Saver/Classic/Flex);
- the last 8 flown with the result per sector.

### J.3 The comparison with ACMI (always shown, one line)

"Last 3 months: $3.9k per block hour after direct costs. A 767 on ACMI earns ~$4.1k (rate $5,800 less maintenance)." It uses the planned type's `rateBH` × the current market rate multiplier, less maintenance per BH. When the aircraft was idle in the hours around the rotation, the line instead reads "This aircraft had no other work these days: the route added $41k."

### J.4 Company-level

The Finance statement shows the new lines (rows appear only when non-zero, `statementView`). The Network list sums all routes. `g.stats` gains no new fields; the network keeps its own `stats` (§R).

---

## K. The Network area (lane `net-ui`)

It is secondary to ACMI. It sits under **Contracts › Network**, a new tab after Active, with a count of routes operating. The Contracts › Active list shows one compact line per route contract ("Scheduled · LIS–OXB · summer 2027"), which opens the route page. The route contracts don't appear among ACMI contracts in counts and filters.

- **Network list**: one row per route showing:
  - status chip (Study · Launching (stage x of 11) · On sale · Operating · Suspended);
  - model (Own brand · For STP Airways · Holidays charter);
  - timetable in words ("Weekly, Fri"), next departure, booked LF of the next rotation;
  - last 3 months' result with a trend arrow, and reputation word.

  Below the rows sit an **Open a new route** button and the catalogue (greyed markets with their one-line reason).
- **Route page** (a sheet on iPad, full screen on iPhone): header (route, model, brand, aircraft type and cabin), then four segments:
  - **Overview**: KPIs and the 12-month chart (§J.2), the ACMI comparison line, open cards;
  - **Timetable**: series editor (days chips, times in local and UTC, night-stop, type and cabin, tail pin), the rotation list with move, cancel, aircraft and sub-charter actions, slot status;
  - **Sales**: fare level, sale button, overbooking switch, marketing level, the booking curve against expected for the next rotations, groups offered;
  - **Costs**: per-line breakdown for the last rotation and the month, station contracts, tankering switch.
- **Launch wizard** (from Open a new route): a vertical stage timeline (§C) with each stage's cost, expected dates and state. One decision at a time on a card (study depth; business case Go/Change/Shelve with the P10/P50/P90 table; brand/partner; timetable; fares; marketing level). It can be closed and reopened; the stages run in game time.
- **Schedule board**: route flights carry the route colour and a small "scheduled" glyph. Long-press and drag a sector moves the whole rotation (§D.4) with the live quote. Dragging to another aircraft's row is the existing trip move with the product line added.
- **Offer dialog and the call**: the route conflicts block (§H.2) under feasibility.
- **Flight sheet**: §J.1 block; the actions Move rotation, Swap aircraft, Sub-charter, Cancel rotation.
- **Inbox and cards**: four-line cards for launch setbacks, a rotation with no aircraft, business class lost, a weak booking pace 21 days out ("YU351 14 Nov: 38 % booked, usually 60 % by now: run a sale?"), a rival's reaction, and world events. Their messages are under a new `network` topic in Company messages.
- **Map**: route lines in a dashed accent colour when any route operates (lowest priority layer; the existing map layers own the files, so the UI lane adds only a `routes` overlay).
- **Glossary**: Scheduled route, Load factor, Yield, Fare buckets, EU261 (on the day vs planned changes), Downgrade refund, Slot series (80 %), Fifth freedom, Tankering, AVI / live animals.
- **What's new v0.19** entry (short, player words).

Layout rules: iPad 1180×820 and iPhone 852×393; no horizontal scroll; tap targets ≥ 44 px; light and dark themes; no new fonts.

---

## L. Bot (`scripts/bot/network.ts`; lane `net-ops`)

The flag is `--routes` (off by default, so base comparisons stay identical). With it:
- From day 60, when a widebody (767, A330 or A340) stood ≥ 30 days in LIS in the last 60 with nothing booked for the next 60, launch LIS–OXB with the full study and Normal marketing.
- Go only if the business case P50 is > 0.
- Timetable default; fare level Market.
- Conflicts: the cheapest choice by net (§H.2).
- A second route (TMS for a partner) once OXB has had 3 positive months.
- Never DIL unless `--routes=dil`.

The report adds a **Network** block:
- per route: months operating, rotations flown, cancelled, swapped and sub-chartered; average LF by class; yield; revenue, direct costs, contribution per BH against the ACMI net per BH; result and margin; launch spend and payback; reputation.
- an idle-aircraft line: BH the route flew on aircraft otherwise idle.
- balance check lines with ok/no against §M.

Determinism: `--det` with `--routes` must stay identical, and save and load at day 90 identical.

---

## M. Balance targets (the balance step tunes `BAL.v019` to these)

| Target | Value |
|---|---|
| Route margin after aircraft and crew time, 12 months after the ramp, own brand OXB (767, fuel $750–900) | **2–8 %** average; best month 15–25 %, worst −10 to −20 % |
| TMS for a partner | 3–6 %, steadier: monthly spread less than half of OXB's |
| DIL charter series, open sale | −5 to +3 %; with ≥ 60 % anchor blocks, 2–6 % |
| Contribution per BH (before aircraft and crew), year average | **≤ the type's ACMI net per BH** (`rateBH × rate multiplier − maintBH`). Peak months (Dec, Jul–Aug) may exceed it by up to 40 % |
| Weekly OXB rotation on an aircraft that would stand idle | +$35–70k per rotation (contribution) |
| Launch spend (own brand, Normal) | $250–400k including the study, campaign, station set-up and distribution |
| Launch time (decision to first flight) | 16–26 weeks planned well; 10–12 weeks at least |
| First 3 months | Margin −20 % to +2 % (ramp, awareness, launch marketing): risky |
| Payback of the launch spend | 12–24 months |
| Load factor | OXB: 85–95 % at Christmas and Jul–Aug, 55–65 % Feb–May and Oct–Nov [F/E]; year about 72 % |
| A good aircraft swap decision | ACMI jobs taken over rotations net + about 80 % of the time when the ACMI job is ≥ 4 weeks |
| Bot with `--routes` (seeds 1–3, 365 d) | Company margin within ±2 points of the same seed without routes (routes are background); no seed insolvent because of a route; 0 invariant errors |
| Runtime | ≤ +5 % over the same seed without routes; with no route open, identical work |

The main levers are `demand.scale` (market sizes), `fares` (base per market), `share` weights, `cost.overhead` and `ops.materialiseDays`. Prices of ACMI work don't change.

---

## N. Ledger and finance

### N.1 New categories (step 0 adds them)

| Category | Kind | Label (Finance) |
|---|---|---|
| `ticketRevenue` | revenue | Passenger tickets |
| `cargoRevenue` | revenue | Cargo and mail |
| `ancillaryRevenue` | revenue | Bags, seats and onboard |
| `handling` | cost | Ground handling |
| `catering` | cost | Catering |
| `paxServices` | cost | Passenger services |
| `navCharges` | cost | Navigation charges |
| `distribution` | cost | Distribution (GDS, BSP, cards) |
| `marketing` | cost | Marketing and research |
| `paxComp` | cost | Passenger compensation |
| `routeSetup` | cost | Route set-up and stations |

`REVENUE_CATS` and `COST_CATS` list them. `LEDGER_LABEL` holds the labels. The money problem card's `COST_WORD` gets short words where useful.

### N.2 Cash timing

- Ticket cash arrives at sale (`cashOnly`) and is held as `route.unearned`.
- Revenue is accrued at departure.
- A refund is negative `cashOnly` from unearned.
- Group deposits behave the same way.
- Partner fees are invoiced monthly (`invoice`, 30 days).
- The BSP guarantee is a cash hold (`cashOnly` out, and back after 12 months).
- The finance forecast (`ops/finance.ts` forecast items) adds route lines through a `networkForecastItems(g, days)` hook: rotations' expected sales cash, costs per sector and monthly overheads.

### N.3 Money rules

Every amount is rounded. Nothing posts when no route exists. A closed route stops its overheads at the end of the month it closes.

---

## P. Acceptance checks

Engine (vitest, each lane its own tests):
1. A new game and an old save (current, s0612, the fixtures) load with `g.network` defaulted, and the bot without `--routes` is identical to the base (seeds 1–3 365 --wide --inv, --det).
2. Launch OXB: the stages run in order with the parallel set after Go. Total time for the default plan is 16–26 weeks, and each stage's cost is booked to its category. A setback delays and the card appears. Shelve keeps the study for 12 months.
3. The timetable creates rotations for the season; flights exist only inside `materialiseDays`; turn, curfew, runway and range are checked; DIL returns via KUL and DXB, and a DIL sector's payload is limited.
4. Sales: bookings follow the curve within ±15 % on 200 seeded runs. Buckets close when ahead and reopen when behind. Unearned cash goes up at sale and down at departure, and revenue is accrued at departure.
5. Costs per sector equal `routeLegCost` and appear in their categories; `legCostEstimate` for non-route flights is unchanged.
6. The conflict quote lists the rotations. Each choice applies:
   - swap moves the flights;
   - sub-charter puts `operatedBy` on the flights, with no reputation or relation change and only the rival cost;
   - move retimes the whole rotation, with turns kept;
   - cancel refunds and re-protects with the §H.5 cost.
7. A downgrade (16J → 0J) at departure refunds 50 % (OXB) or 75 % (TMS) of the J fare per passenger, and the route reputation and J demand fall. A swap made ≥ 14 days out halves the reputation hit.
8. On-the-day delay ≥ 3 h pays EU261 by distance; a world closure pays care only.
9. Drag one sector of a rotation on the board: the rotation moves together, and the quote and the result are the same.
10. Slot 80 %: cancelling 7 of 31 rotations marks the slot at risk; sub-charters count as flown.
11. The route P&L sums equal the ledger lines for the route's flights; the month's result per route is shown.
12. Bot `--routes`: launches OXB on an idle widebody, flies a year, reports the Network block, `--det` identical, 0 invariant errors; the §M targets are reported ok or no.

UI (Playwright on iPad 1180×820 and iPhone 852×393, light and dark, 0 console errors):
- Network list and route page;
- the launch wizard through to on sale;
- the timetable editor;
- the conflict block in an offer;
- drag a rotation;
- the flight sheet block;
- Finance rows.

---

## R. State shape (step 0 creates these in `engine/network/types.ts`; `core/types.ts` re-exports them)

### R.1 Data (`src/data/routes.ts`)
```ts
interface RouteStation { code: string; fuelX: number; airport: number; handling: number; paxCharge: number; overhead: number; cat: 'A' | 'B' | 'C'; caterer: boolean; euCargo: boolean }
interface RouteMarket {
  id: string;                    // 'LIS-OXB'
  from: string; to: string;      // catalogue endpoints
  via?: string[]; viaBack?: string[];   // fuel stops (DIL: ['DXB'], ['KUL', 'DXB'])
  models: RouteModel[]; model: RouteModel; partner?: { name: string; code: string; country: string };
  odPerYear: number; outShare: number; growth: number;
  season?: number[];             // 12 values; absent = BAL.v019.demand.season
  segments: Partial<Record<Segment, number>>;
  competitors: { name: string; perWeek: number; stops: number; hours: number; fareX: number }[];
  fareY: [number, number]; fareJ: [number, number];    // one way net, off-peak → peak (USD)
  cargo: { south: number; north: number; avi?: number; mail?: number };   // kg per rotation
  ancillary: number;             // USD per passenger
  timetable: { pattern: 'weekly' | 'monthly'; day: number; out: number; back: number; nights: number };
  navPerSector: number;          // USD, 767 reference
  closed?: string;               // greyed out: the reason (Caracas)
  risk?: { coup?: number; fx?: number };
}
type Segment = 'vfr' | 'gov' | 'ngo' | 'biz' | 'students' | 'tourism' | 'teachers';
```

### R.2 State (`g.network`, `NetworkState`)
```ts
type RouteModel = 'own' | 'partner' | 'tour';
type RouteStatus = 'study' | 'case' | 'launching' | 'onSale' | 'operating' | 'suspended' | 'closed';
type LaunchStageId = 'study' | 'case' | 'rights' | 'slots' | 'brand' | 'distribution' | 'filing' | 'marketing' | 'stations' | 'familiarisation' | 'inaugural';
interface LaunchStage { id: LaunchStageId; state: 'todo' | 'running' | 'waiting' | 'done' | 'delayed' | 'failed'; start?: Minute; due?: Minute; cost: number; setback?: string }
interface RouteStudy { depth: 'desk' | 'full' | 'survey'; start: Minute; done?: Minute; est?: { p10: number; p50: number; p90: number }; truth: number; validUntil?: Minute }
interface RouteSeries { id: string; days: number; every: number; monthly?: { nth: number; weekday: number }; out: number; back: number; nights: number; typeId: string; layout: CabinLayout; tail?: string; from: Minute; to: Minute }
interface SectorLoad { from: string; to: string; flightId?: string; capJ: number; capY: number; bookedJ: number; bookedY: number; flownJ?: number; flownY?: number; denied?: number; cargoKg: number; aviKg?: number; mailKg?: number; rev?: number; cost?: number; onTime?: boolean }
interface Rotation { id: string; routeId: string; seriesId: string; dep: Minute; status: 'planned' | 'flights' | 'flown' | 'cancelled'; sectors: SectorLoad[]; aircraftId?: string | null; operatedBy?: string; buckets?: { saver: boolean; classic: boolean }; moved?: number; notice?: Minute }
interface RoutePnl { rev: number; tickets: number; cargo: number; ancillary: number; direct: number; acTime: number; result: number; pax: number; seats: number; bh: number; sectors: number; onTime: number; cargoKg: number; launch: number }
interface Route {
  id: string; marketId: string; model: RouteModel; partnerId?: string; flightNo: number; status: RouteStatus; opened: Minute;
  stages: LaunchStage[]; study?: RouteStudy; series: RouteSeries[]; rotations: Rotation[];
  fares: { level: 'low' | 'market' | 'high'; saleUntil?: Minute; overbook?: boolean };
  marketing: 'low' | 'normal' | 'high'; awareness: number; reputation: number; unearned: number;
  slots?: { held: number; flown: number; season: string }; tanker?: boolean;
  pnl: Record<MonthKey, RoutePnl>; contractIds: string[]; firstFlight?: Minute; closed?: Minute;
}
interface NetworkState {
  routes: Record<string, Route>;
  ownClientId?: string;          // our own sales record (Client.own)
  distribution?: Minute;          // GDS/BSP set up (later routes pay half)
  bspHold?: { amount: number; until: Minute };
  stats: { launched: number; rotations: number; pax: number; swaps: number; subs: number; moves: number; cancels: number; downgrades: number };
  rev?: number;                   // UI cache key
}
```

### R.3 Additions to existing types (all optional)
- `GameState.network?: NetworkState` (`loadNetwork`: `??=` empty routes, zero stats).
- `Flight.sched?: { routeId: string; rotId: string; idx: number }`.
- `Contract.sched?: { routeId: string; season: string }`.
- `Client.own?: true`.
- `Archetype` gains `'scheduled'`; `ARCH_LABEL.scheduled = 'Scheduled route'`.
- `LedgerCat` gains the 11 categories of §N.1.
- `SignOpts.routeChoices?: Record<string, RouteChoice>` (`RouteChoice = 'swap' | 'sub' | 'move' | 'cancel'`; lane `net-ops` adds it to `contracts/accept.ts`).

---

## S. Step 0: the shared skeleton (this branch)

Behaviour is unchanged: no route exists in any game until the player opens one, and every hook returns at once with no routes.

- `docs/UPDATE-0.19.md` (this file).
- `src/engine/network/types.ts`: the types of §R.
- `src/engine/network/index.ts`:
  - `networkModule` (SimModule, registered after `commercialModule` in `sim.ts`), with `init`/`load` = `loadNetwork`;
  - handlers `day` → `dailyNetwork`, `month` → `monthlyNetwork`, `flight.dep` → `onRouteDep`, `flight.arr` → `onRouteArr`;
  - `touchNetwork`, `routesOn(g)`.
- Stubs with real signatures and neutral bodies, one file per lane topic:
  - `side.ts` (`netSide`, final);
  - `launch.ts` (`startStudy`, `decideCase`, `stepLaunch`, `launchPlan`);
  - `timetable.ts` (`seriesRotations`, `materialise`, `moveRotation`, `quoteMoveRotation`, `cancelRotation`, `setSeries`);
  - `demand.ts` (`marketDemand`, `ourShare`);
  - `sales.ts` (`dailySales`, `openBucket`);
  - `revenue.ts` (`sectorRevenue`, `payloadMax`);
  - `costs.ts` (`routeLegCost`, `routeDisruptionCost`, `monthlyRouteCosts`);
  - `conflicts.ts` (`routeConflicts`, `rotationChoices`, `resolveRotation`);
  - `reputation.ts` (`bumpRoute`, `fadeReputation`);
  - `pnl.ts` (`routePnl`, `sectorView`, `acmiCompare`).
- `src/data/routes.ts`: `ROUTE_MARKETS` (the three EA routes and the §B.2 list) and `ROUTE_STATIONS` with the §G values.
- `BAL.v019` in `core/balance.ts` (all §C–§I numbers; `on: true`; `ops.materialiseDays: 120`).
- `core/types.ts`: the optional fields of §R.3, the archetype, the 11 ledger categories. `core/ledger.ts`: the lists. `ui/screens/screenLogic.ts`: `LEDGER_LABEL` and `ARCH_LABEL` entries.
- `src/engine/network/network.test.ts`:
  - load and init defaults;
  - an old save loads with an empty network;
  - every hook is a no-op without routes;
  - the catalogue is consistent: airports exist, stops are in range, and DIL's back chain is legal for a 767.

Checks run on step 0: `tsc` 0 errors; full vitest green; `bot 1 120 --wide --inv` identical to the `acmi` base at the same commit (same table, same balance lines).

---

## T. Lanes, file ownership and base

**Base:** lanes branch from **`v019-step0`**, which sits on `acmi` 0253be6. When v0.18.3 is merged into `acmi` (`/home/user/work/v0183/READY` exists), step 0 merges `origin/acmi` and fast-forwards `acmi`; lanes then merge `acmi` before their final checks. **Don't edit any v0.18.3 file** (list in §T.4) until READY exists. Merge, don't rebase pushed history.

### T.1 Lane `net-engine`: market, launch, sales, money (engine only)

Owns:
- `src/engine/network/{launch,demand,sales,revenue,reputation,pnl,types}.ts` and their tests;
- `src/data/routes.ts`;
- `BAL.v019.{launch,demand,sales,fares,cargo,rep}`;
- the network problem cards in a new `src/engine/problems/network.ts`, registered by a one-line import in `problems/index.ts`;
- glossary entries in a new `src/data/glossaryNetwork.ts`, merged by a one-line spread in `glossary.ts` after READY.

Provides:
- the launch state machine with setbacks;
- the study and the business case (P10/P50/P90 projection, the pure `businessCase(g, draft)`);
- daily sales and buckets;
- revenue at departure;
- payload;
- reputation;
- the P&L and `acmiCompare`;
- world-event route effects (hooks called from `ops/world.ts` by `net-ops`).

### T.2 Lane `net-ops`: flights, costs, conflicts, bot (engine integration)

Owns:
- `src/engine/network/{index,timetable,costs,conflicts,side}.ts` and tests;
- `BAL.v019.{ops,cost,pax}`;
- and the small hooks in existing engine files:
  - `ops/flights.ts` (`legCostEstimate` → `routeLegCost`; on-the-day EU261 in recovery and cancel);
  - `ops/disrupt.ts` (`routeDisruptionCost`);
  - `ops/subcharter.ts` and `ops/flights.ts` `subHit` (zero for `sched`);
  - `ops/tripMove.ts` (product line in the quote);
  - `contracts/accept.ts` (`routeChoices`, own-client guards);
  - `contracts/feasibility.ts` and `contracts/blockers.ts` (route conflicts listed as choices, not blockers);
  - `contracts/schedule.ts` (route contracts' legs, `hold`);
  - `contracts/relations.ts`, `contracts/clients.ts`, `commercial/*` (skip `own` clients);
  - `crew/rules.ts` (`routeQualified`);
  - `ops/finance.ts` (`networkForecastItems`);
  - `ops/world.ts` (route event hooks);
  - `scripts/acmi-bot.ts` (`--routes`) and the new `scripts/bot/network.ts`;
  - `scripts/invariants.ts` (route checks: rotation sectors chained, turns legal, unearned ≥ 0).

  Edit `crew/*`, `contracts/missions.ts`, `ops/tripMove.ts`, `ops/disrupt.ts`, `ops/events.ts` and `scripts/*` only after READY. These are v0.18.3 files: keep hooks to one or two lines.

### T.3 Lane `net-ui`: the Network area

Owns:
- new `src/ui/screens/network/*` (List, RoutePage, LaunchWizard, TimetableEditor, SalesPanel, CostsPanel, `networkLogic.ts` + tests);
- `src/ui/modals/RouteConflicts.tsx` and `RotationMoveModal.tsx`;
- `src/styles/acmi/v019.css`, imported from `src/ui/screens/network/index.tsx`, not from `index.css`, which v0.18.3 also edits;
- hooks after READY:
  - `ui/screens/Contracts.tsx` (Network tab, compact Active line);
  - `ui/modals/OfferModal.tsx` / `offer/*` (conflict block);
  - `ui/modals/BlockSheet.tsx` (sector figures, actions);
  - `ui/screens/Schedule.tsx` + `scheduleLogic.ts` (route glyph, drag a rotation);
  - `ui/store.ts` (modal specs, actions);
  - `ui/game/Modals.tsx`;
  - `ui/map/*` (`routes` overlay);
  - `ui/screens/finance/*` (unearned cash line);
  - `data/whatsNew.ts` (v0.19 entry above v0.18.3);
- Playwright shots under `/home/user/work/v019/shots/`.

The UI lane may stub engine calls against the step-0 signatures until the engine lanes land.

### T.4 Files v0.18.3 changes (hands off until READY)

- `scripts/acmi-bot.ts`, `scripts/invariants.ts`, `scripts/ipad-shots.cjs`;
- `src/data/glossary.ts`, `src/data/whatsNew.ts`;
- `src/engine/contracts/missions.ts`;
- `src/engine/core/{balance,perf,types}.ts` (step 0 adds only non-adjacent blocks);
- `src/engine/crew/*` (control, conversion, convertAdvice, duties, extraSeats, forecast, generate, hr, index, leave, migrate, morale, outOfHours, restPlan, roster, rosterActions, sets, utilisation);
- `src/engine/ops/{disrupt,events,tripMove}.ts`, `src/engine/problems/crew.ts`;
- `src/styles/acmi/index.css`, `src/styles/acmi/v0183.css`;
- `src/ui/components/{RankMark,RestTimeline,problemLogic}.ts(x)`, `src/ui/game/Modals.tsx`;
- `src/ui/map/{MapPanels,OpsMap,mapLogic}.ts(x)`;
- `src/ui/modals/{BlockSheet,ConvertModal,DutyModal,HireModal,PersonSheet,RoundUpModal,personLogic}.ts(x)`;
- `src/ui/screens/{CrewLeave,CrewPlan,CrewUtil,RosterBoard,crewPlanLogic,rosterBoardLogic,screenLogic}.ts(x)`, `src/ui/store.ts`.

### T.5 Order and merge

`net-engine` and `net-ops` start together. `net-ops` needs `routeLegCost`'s inputs and the rotation shape from step 0, not `net-engine`'s bodies.

The merge order is `net-engine` → `net-ops` → `net-ui`. Then the balance step (bot `--routes` seeds 1–3, the §M table), then the review. No release without the player's go.
