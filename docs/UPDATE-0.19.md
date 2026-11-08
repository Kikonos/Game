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
