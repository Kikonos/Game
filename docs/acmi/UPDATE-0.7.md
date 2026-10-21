# BLOCK HOURS v0.7 "Fleet & Ladder": design

This is the plan of record for v0.7, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" still override everything (real names, invented events allowed, iPad landscape, calm visuals, 1×/2×/4× only). RESEARCH.md supplies the numbers. DESIGN.md and BUILD-PLAN.md keep their ground rules:
- engine RNG only, and pure read APIs (added to `core/plumbing.test.ts`);
- ids come from `nextId`;
- money moves only through the ledger helpers, and flights only through the core helpers;
- `SAVE_VERSION` stays 1, with `??=` defaults in `load`, so v0.5.2 and v0.6 saves keep working.

The player agreed to three features plus five carry-overs, and asked for them to be kept simple. Anything not listed here is out of scope (§9).

| # | Feature | One line |
|---|---|---|
| C1 | Conversion confirm | A red "fleet short of legal crew" warning turns **Book** into a two-step confirm. |
| C2 | Roster board at 4× | Rows are cached per crew member and refreshed at most once a second while the clock runs. |
| C3 | Deadhead carriers | Per-airline reach and destination lists, plus a 42-pair test table (DXB–LIS is Emirates, not TAP). |
| C4 | Pacing | Seed 2 reaches at least 42 of 52 active weeks: the quiet-week floor is loosened slightly. |
| C5 | Flaky timing tests | Best-of-N timing with wider budgets in `board.test.ts` and `roster.test.ts`. |
| F6 | Scarce aircraft market | Used sales, dry leases from real lessors, rare new-build slots and lease returns. Aircraft are handed over at a real airport, and their pilots deadhead out on real airlines and ferry them home. Optional market alerts. |
| F7 | Cabin reconfiguration | All-economy, two-class or VIP. A refit takes days to weeks at an MRO station, and the layout decides which work the aircraft can bid for. |
| F8 | The Ladder | ETOPS 120 → 180 → 240, widebody operations, augmented long haul and ULR (FRMS). Each needs time, money, rated crew and a clean record, and gates aircraft types and work. A ladder on the Company screen, and goals for each step. |

Calm rules still hold. Nothing flickers and nothing animates except aircraft (and the v0.6 drag ghost). Messages stay rare: one per event.

---

## C1. Bulk conversion confirm (UI: `modals/ConvertModal.tsx`)
- When `plan.warnings` contains any `level: 'bad'` line (fleet short during or after the course, or cost above cash), the primary button reads **"Review & book · $702K"**. The first tap opens the shared confirm modal:
  - title "Book anyway?";
  - body: the red lines verbatim, then "Flights in these weeks may go uncrewed.";
  - buttons **Go back** (default, primary) and **Book anyway** (danger).
- Only the second tap calls `startConversion`. Without red warnings the button books at once, as today.
- **Test** (`ui/screens/screenLogic.test.ts`): `needsConfirm(plan)` is true exactly when a `bad` warning exists.

## C2. Roster board performance at 4× (ENGINE `crew/board.ts`; UI `screens/RosterBoard.tsx`)
**Engine**
- `rosterBoard` keeps a per-crew row cache: `Map<crewId, {key, row}>` with `key = crewRev(crewId) + from + to + hourBucket(g.now)`.
- `crewRev` is the crew member's duty and pairing revision. It already exists for the crew → duties index; add one if not.
- An unchanged crew member returns the **same `BoardRow` object** (identity), so `memo(Row)` skips it.

**UI**
- The board reads the clock through `useThrottledNow(1000)`, which gives the game minute at most once per real second while running and immediately on pause.
- The rows `useMemo` drops `g.now` from its deps and uses the throttled value.
- The today line keeps its own rAF.

**Acceptance:** 120 crew, Month zoom, 4×, Chrome with a 4× CPU throttle. Over 60 s: p99 frame ≤ 25 ms, no long task over 50 ms, and at most 1 board render per second (`useRenderCount`).

## C3. Deadhead carriers (ENGINE `data/carriers.ts`, `ops/commercial.ts`)
**Known bad picks**
- DXB–LIS on TAP: TAP does not serve DXB; Emirates does.
- LIS–SOF and HAM–BOJ via SOF on Bulgaria Air.
- LGW–GVA on SWISS: SWISS flies LHR and LCY; easyJet flies LGW–GVA.

**Rules**
1. **`Carrier.dests?: string[]` (new).** A closed network: the only airports flown from its hubs. When set, `serves()` is true only for hub ↔ dest (and `routes`). Fill it for the small flag and regional carriers:
   - FB Bulgaria Air: LHR CDG FRA MUC AMS BRU MAD BCN FCO MXP ATH VIE ZRH TLV BER LCA BOJ VAR;
   - RO TAROM, KM Malta, JU Air Serbia, ZB Air Albania, LG Luxair, QS Smartwings, CY Cyprus Airways;
   - S4 Azores, VR Cabo Verde, TU Tunisair, AH Air Algérie.

   Use their real current networks, keeping only codes present in `airports.ts`.
2. **`reach` (exists) for the network carriers whose long haul is selective.**
   - TP: Europe + `LINKS.PT` + MA SN IL GN CI ST GW (no Gulf, no Asia);
   - also IB, AZ, LO, OS, SN, AY, EI, A3, SK and LX.

   Medium and long haul to a country outside `home ∪ reach` is refused.
3. **`avoid` additions:**
   - LX: LGW, STN, LTN;
   - BA: STN, LTN;
   - EI: LGW;
   - LH: LGW, STN.
4. **Market fixes:**
   - FZ markets + BG RO PL CZ;
   - EW markets + BG CY;
   - U2 hubs + LTN, SXF if present.
5. **The Gulf super-hubs stay preferred.** For a pair with one end at DXB, DOH or AUH, the home carrier (EK, QR, EY) or FZ takes 100% of departures when it serves the pair.

**Test table** (`ops/commercial.test.ts`)
- Each row is checked over 30 days × 8 banks. "Any of" means every pick is in the set and at least one appears; "never" means no leg uses it.
- A row may be corrected only with a comment that cites the airline's real network.

| # | Pair | Any of | Never |
|---|---|---|---|
| 1 | DXB–LIS | EK | TP |
| 2 | LIS–DXB | EK | TP |
| 3 | DOH–LIS | QR | TP |
| 4 | AUH–LIS | EY, or a connection | TP |
| 5 | LIS–SOF | FR or W6 nonstop, or a connection at an EU hub | FB |
| 6 | SOF–LIS | same as 5 | FB |
| 7 | HAM–BOJ | EW nonstop, or a connection at MUC, FRA or VIE | FB, via SOF |
| 8 | LGW–GVA | U2 (BA allowed) | LX |
| 9 | LHR–GVA | BA, LX | U2, FR |
| 10 | LTN–GVA | U2 | LX, BA |
| 11 | MAN–GVA | U2 | LX |
| 12 | STN–DUB | FR | EI |
| 13 | LIS–OPO | TP, FR | |
| 14 | LIS–FRA | TP, LH | |
| 15 | LIS–MAD | TP, IB, UX | |
| 16 | LIS–LAD | TP, DT | |
| 17 | LIS–GRU | TP, LA | |
| 18 | LIS–JFK | TP, DL, UA, AA | |
| 19 | LIS–KBL | one connection at IST, DXB or DOH | |
| 20 | LIS–SIN | one connection at IST, DXB or DOH | TP on a leg east of IST |
| 21 | VNO–RIX | BT | |
| 22 | RIX–LIS | BT or FR, else a connection | |
| 23 | BUD–OTP | W6 | |
| 24 | BCN–PMI | VY (FR, UX allowed) | |
| 25 | ORY–AGP | HV, VY | |
| 26 | AMS–LIS | KL, TP, HV | |
| 27 | LIS–CMN | AT, TP | FR |
| 28 | LIS–SID | TP, VR | |
| 29 | IST–LIS | TK, TP | |
| 30 | TLV–LIS | TP, LY | |
| 31 | DXB–HAM | EK | LH |
| 32 | DXB–SOF | FZ | FB, TP |
| 33 | MAD–DXB | EK | IB |
| 34 | CDG–DXB | EK, AF | |
| 35 | SNN–LHR | EI | |
| 36 | TLS–LIS | TP, U2 | |
| 37 | HAM–LIS | TP, EW | |
| 38 | LIS–SCL | one connection at GRU or MAD | |
| 39 | LIS–CHS | one connection at a US or EU hub | |
| 40 | LDE–LIS | a connection in FR | U2 |
| 41 | LIS–BOJ | a connection | FB on the leg from LIS |
| 42 | FRA–SOF | LH, FB | |

The v0.6 property tests (300 random EU pairs) still pass. Add one property: no regional carrier with `dests` ever appears outside them.

## C4. Pacing (ENGINE `contracts/offers.ts`)
**Quiet-week floor:**
- the gap since the last gap-fit offer goes from 6 to **5 days**;
- the minimum idle window goes from 3 to **2 days**;
- the open-offer cap goes from < 4 to **< 5**.

**Targets**
- Seeds 1–6, one at a time: at least 42/52 active weeks and at least 1.0 actions a week.
- Offers per year stay within ±10% of v0.6.

The new systems also add real weekly actions (§F6–F8 bot).

## C5. Flaky timing tests (ENGINE)
- **`board.test.ts` "dropTargets stays fast":** warm up once, then take the best of 5 runs with a budget of < 400 ms.
- **`roster.test.ts`:** keep best-of-6, with the budget widened from 50 to **120 ms**. The 50 ms figure stays in the console log as information.
- **No other test** may assert wall-clock time.

---

## F6. Scarce aircraft market

### F6.1 What changes (RESEARCH §4.6, §7.1, §7.3)
| | v0.6 | v0.7 |
|---|---|---|
| Arrival | Monthly batch, Poisson(0.8) | Daily roll, mean **1.0 a month**, at most **4 open**. Offers spread over the month. |
| Life | 14–30 days | **7–21 days** ("open for days") |
| Kinds | Used dry lease; used sale (NB and old WB) | + **new-build lease** slots (rare) |
| Types | Tier ≤ 2, or tier 3+ at reliability 70 and 4+ aircraft | Gated by the Ladder (§F8.3). The next locked rung is shown as a teaser. |
| Handover | Home base | **At a real airport** (lessor site, factory or previous operator's hub), then a **delivery ferry** home |
| Lease end | Return at base, or +10%/month | Return conditions, a return ferry and a return check with costs, or an extension (§F6.6) |

### F6.2 Offer generation (`ops/market.ts`)
**Spawning.** The daily roll fires with `p = BAL.market7.perMonth / 30.44`, skipped when 4 offers are already open. Each offer is built as follows.

**1. Type.** A weighted pick over `available` types:
- unlocked types (their gate is held or pending): weight `(1 − scarcity)`;
- **teaser** types (exactly one approval missing): weight `(1 − scarcity) × 0.3`;
- everything else is not offered.

**2. Kind.**
- **New-build lease** (`newBuild: true`): only for `NEW_BUILD = ['a321neo','b789','a359','a35u']`, with a 0.10 chance.
  - Built year = delivery year; rent `rentMonth × U(1.0, 1.1) × index`;
  - **lead 180–420 days**; lease 96–144 months; deposit 3 months.
- **Used sale:** narrowbody or old type (b763, a332, a343, b752), chance 0.3; price as today.
- **Used dry lease:** otherwise. Terms as today, lead NB 30–90 / WB 30–60 days.

**3. Seller and site** (new `data/market.ts`; every code must exist in `airports.ts` and be reachable by `ticketBlock`):
- `LESSOR_SITES` (storage, redelivery and MRO, all with airline service):
  - SNN Shannon (lessor redelivery);
  - LDE Tarbes (Tarmac Aerosave);
  - TLS Toulouse (Tarmac Aerosave Francazal);
  - MLA Malta (Lufthansa Technik Malta);
  - VNO Vilnius (FL Technics);
  - HAM Hamburg (Lufthansa Technik);
  - MAD Madrid (Iberia Maintenance).
- `EX_OPERATORS: Record<typeId, {airline, hub}[]>`, real former operators, for example:
  - b763: Condor FRA, LATAM SCL, Air Canada YUL, ANA NRT;
  - a332: Air Europa MAD, TAP LIS, Turkish IST;
  - a333: Garuda CGK, Malaysia KUL, Cathay HKG;
  - a320ceo: Vueling BCN, IndiGo DEL, Lufthansa FRA;
  - b738: Turkish IST, Norwegian OSL;
  - a343: Lufthansa MUC, SWISS ZRH, South African JNB;
  - b772: Singapore SIN, Kenya NBO;
  - b77w: Emirates DXB, Air France CDG;
  - a388: Emirates DXB, Singapore SIN, Malaysia KUL;
  - b77l: Air India BOM.
- `FACTORIES`: A320 family HAM or TLS; A350 TLS; 787 CHS.
- **Rules:**
  - new-build → factory;
  - used → a lessor site with chance 0.5, else an ex-operator hub;
  - the **return site** of a lease is a lessor site (random; it equals the delivery site when that is a lessor site).
- **Text:**
  - `where`: "ex-LATAM, Santiago (SCL)", "Tarmac Aerosave, Tarbes (LDE)" or "Airbus, Toulouse (TLS)";
  - `lessor`: as today, from the real lessor list.

**4. Guaranteed offers**
- The narrowbody lease in month 1–2 stays as it is.
- The old 767 or A330 lease in month 4–6 stays as it is; if the gate is still closed, it shows as a teaser.
- **New:** within 45 days of *filing* Widebody operations, if no unlocked widebody offer is open, one old b763/a332 lease is posted (`market.gotWideFiled`).

**5. Alerts.** Every new offer posts one message:
- `cat: 'company'`, `tone: 'info'`, **`topic: 'market'`**, `ref: {kind: 'market', id: offerId}` (a new `Ref` kind; the UI routes it to the Fleet Market view).
- It also calls `requestPause('marketOffer')` (a new `PauseReason`; the UI decides whether to honour it, §F6.7).

### F6.3 Signing (`acquireAircraft`, extended)
**Refusals, in this order:**
1. Gate closed: "Needs Widebody operations: apply under Company → Ladder".
2. Cash below the deposit or price.
3. Offer expired.

**On signing**, the aircraft is created with:
- `status: 'delivering'`, `at: site`, `deliveredAt: handover = now + leadDays`;
- `delivery = {site, where, handover, ferryIds}`;
- `ownership.returnSite` and `ownership.deliveredLayout` (dry lease), `newBuild`.

The delivery ferry is planned at once (§F6.4), so the Schedule shows it and feasibility knows when the aircraft reaches home.

**Message** (`good`, ref aircraft): **"A330-200 signed: CS-TQC"**. "Leased from AerCap at $205K/month for 60 months. Handover at Santiago (ex-LATAM) on 12 Jan; ferry home 13–14 Jan via Recife. Our pilots deadhead out on airline flights before that. No A330-rated pilots yet: book a conversion before 1 Jan."

### F6.4 Delivery ferry (new `ops/delivery.ts`)
**`planDeliveryFerry(g, acId)`** builds the chain `site → homeBase` with the existing fuel-stop router (`route(typeId, a, b)`, as used by offers):
- **First departure:** `handover + BAL.delivery.acceptH` (36 h: acceptance inspection, records, test flight), rounded up to 08:00 local at the site.
- **Days.** Legs are grouped into ferry days of at most 3 sectors and at most 10:00 of block plus turns, with a fuel-stop turn of 60 min. That keeps a 2-pilot FDP legal in every acclimatisation state (RESEARCH §5.1).
- **Night stops.** Consecutive days are joined by a **14 h night stop** at the stop airport (hotel, 10 h minimum rest away).
- **Legs:** each leg is `addFlight({kind: 'ferry', purpose: 'delivery', contractId: null, no: ownFlightNo(g)})`.
- **ETOPS.** Delivery and return ferries fly on a ferry permit: no ETOPS check, documented in the panel text ("Ferry permit: 60-min routing").
- **No ferry** when site = home base.

**Crew.** There is no new crew code: the auto-roster crews ferries as pilots-only empty duties (v0.5.2).
- Pilots rated on the family are picked as usual. Crew away from the first departure get deadhead tickets in time, so they fly real airline flights from wherever they are to the site.
- After the ferry they rest and are home. Their rosters show **DH → rest → ferry (→ night stop → ferry) → home**.
- Costs come from the existing mechanics:
  - tickets posted to `deadhead` at purchase;
  - hotels and per diem (non-wet);
  - ferry fuel, fees and catering at departure (`flights.ts` already charges ferries).

**Handover** (`aircraft.delivery`, existing event, `onDelivery`):
- status `available`, `at = site`; the aircraft appears on the map there;
- `stats.deliveries++`;
- message (`info`): **"CS-TQC handed over at Santiago"**. "Ferry home tomorrow 08:00 local: SCL–REC–LIS, 2 legs, 15 h 40 block. Captain Silva and FO Costa arrived on LA 8071 last night."

**No crew** (new, in `flights.ts` crew-short handling, `purpose === 'delivery'` only). A delivery ferry is **never cancelled**:
- **48 h before** departure, if it is still uncrewed: message once (`warn`, ref crew): **"Delivery ferry CS-TQC has no rated pilots"**. "No A330-rated captain and first officer are free on 13 Jan. The aircraft waits at Santiago until they are (parking $900/day). Hire rated pilots or book a conversion."
- **At departure** without crew: retime the whole chain +24 h (`retimeFlight`) and set `delivery.waitingSince`. Post parking `BAL.delivery.parkPerDay` [NB 400, WB 900] daily to `airportFees`, retrying daily.
- The first successful departure clears `waitingSince` and adds the waited days to `stats.deliveryWaitDays`.

**Home.** On the last leg's arrival, set `delivery.arrived = now` and post the message **"CS-TQC is home"**: "Delivered to Lisbon after 2 days of ferry flying ($96K fuel and fees, crew costs $7K)". The `delivery` field stays for history and the badge clears.

**Quote (pure).** `deliveryQuote(g, typeId, site, handover)`:
- legs with times;
- ferry days;
- fuel at `market.fuelPrice`, fees;
- crew estimate: 2 pilots × (`ticketBlock` ticket price + hotel nights + per diem days);
- the outbound deadhead itinerary from home base (`itinerary(home, site, …)`) for display;
- total.

### F6.5 Feasibility with delivering aircraft (ENGINE `contracts/feasibility.ts`)
- The `lease` check uses **home-by** (the delivery ferry's last `sta`, or `deliveredAt` when there is no ferry): "Home 14 Jan after the delivery ferry".
- Positioning is computed from the aircraft's timeline (the ferry legs are on it), so an aircraft at the site could also position straight to a job from there.

### F6.6 Lease returns (new `ops/leaseReturn.ts`; RESEARCH §4.6 reserves, §5.7 checks)
**Notice.** At `leaseEnd − 120 days` (in the ops `day` handler; once, `ownership.noticeGiven`), post a decision `kind: 'leaseEnd'` with expiry 14 days:

| Option | Effect |
|---|---|
| **Extend 12 months** (default) | `leaseEnd += 12 mo`, rent × 0.97 × current index adjustment |
| Extend 36 months | `leaseEnd += 36 mo`, rent × 0.92 × index |
| **Return to AerCap at Shannon** | Books the return (below). Chips: "≈ $640K return costs", "Deposit $410K back" |

The default is the safe one: never lose an aircraft by not looking. The same options stay available any time from the Fleet card through `chooseLease`.

**Return booking** (`bookLeaseReturn`):
- a **return check** `MaintenanceEvent {kind: 'return', leaseReturn: true}` at `returnSite`, lasting `BAL.leaseReturn.checkDays` [NB 7, WB 14] and ending at `leaseEnd`;
- a **return ferry** before it (`planPositioning(…, 'ferry')`, `purpose: 'return'`);
- `ac.returning = {site, maintId, ferryIds, quote}`;
- flights clashing with the ferry or check are refused ("Clashes with 6 flights from 2 Mar: move them first");
- feasibility's `lease` check treats the aircraft as gone from the ferry's departure.

**Return costs** (`returnQuote`, pure; posted at the check's start, cat `leaseReturn`):

| Line | Rule |
|---|---|
| Return check | NB $180K · WB $450K |
| Half-life compensation | `max(0, usedC − 0.5) × C-check cost × 0.5`. `usedC` is the share of the C-check interval used since `lastC`; × 0.5 because reserves already paid half. |
| Cabin reinstatement | When `cabin.layout ≠ deliveredLayout`: the refit cost back to it (§F7.2) |
| Repaint | When the livery is not white: strip and white repaint, `BAL.paint.full.cost` mid value × 0.9 |
| Deposit | Refunded at the end (shown as a credit) |

**At the end of the check:**
- refund the deposit (`cashOnly`);
- delete the aircraft (as today);
- `stats.leaseReturns++`;
- message (`info`): **"CS-TQB returned to AerCap"** — "Redelivered at Shannon after a 7-day return check. Return costs $412K (check $180K, half-life $112K, cabin back to 180Y $120K). Deposit $460K refunded. The ferry crew deadheads home tonight."
- The ferry pilots get their ticket home from the existing end-of-pairing logic.

**Holdover.** A busy aircraft at `leaseEnd` with no return booked rolls on as today (+10% a month, message).

### F6.7 UI (Fleet screen, Settings, Inbox)
**Fleet header switch:** **Fleet · Market (3)** (`nav.view = 'market'`; the count shows open offers; a dot marks offers newer than the last visit, kept in `localStorage` `bh.marketSeen`).

**Market view** (content ≈ 960 px wide): offer cards in **2 columns** (472 px, about 236 px tall), newest first. Each card has:
- **Row 1:** small `AircraftArt` (120 px) · "A330-200 · 2009 · 18J/282Y" · a kind chip: **Lease used** / **Buy used** / **New-build lease** (accent).
- **Row 2:** "AerCap · ex-LATAM · handover at Santiago (SCL) 🇨🇱" (flag via the existing helper).
- **Row 3, terms:** "$205K/month · 60 months · deposit $410K" or "Price $11.4M", plus "Reserves $680/FH".
- **Row 4, delivery:**
  - "Handover 12 Jan · home ~14 Jan";
  - "Ferry SCL–REC–LIS · 2 legs · ≈ $96K";
  - "Pilots deadhead out: LA 8070 LIS–GRU · LA 3456 GRU–SCL" (first itinerary from `deliveryQuote`).
- **Row 5, chips:**
  - gate: green "Approved", amber "Widebody ops pending (due 3 Jun): signs now, flies after", or red-locked "Needs Widebody operations";
  - crew: green "14 A330 pilots", amber "No A330 pilots: convert or hire (42 days)";
  - expiry: "Open 9 more days" (updates daily, no countdown ticking).
- **Buttons** (44 px): **Lease…** / **Buy…** opens `AcquireModal`; locked cards show **See the ladder** instead.

**`AcquireModal`** (`{kind: 'acquire', offerId}`, 640 px):
- terms;
- the delivery plan as a mini timeline: sign → handover at site → ferry legs → home;
- the cost table (deposit or price now; rent from handover; ferry estimate);
- return conditions ("Return at Shannon in a 7-day check; cabin back to 18J/282Y; repaint white");
- warnings (gate pending, crew, cash after signing);
- primary **"Sign lease · $410K deposit"**.

**Aircraft card additions**
- **Delivering:** "Handover at Santiago 12 Jan → ferry 13–14 Jan → Lisbon". Delivery crew names once rostered, from `deliveryStatus`. Amber "Waiting at Santiago since 13 Jan: no rated pilots (parking $900/day)".
- **Lease row:** "AerCap until 12 Mar 2029 · return at Shannon · ≈ $640K". Within 180 days, a button **"Extend or return…"** opens `LeaseModal` (`{kind: 'lease', aircraftId}`, the same options as the decision with live quotes). When returning: "Return ferry 2 Mar · return check SNN 3–12 Mar".

**Settings** (Menu → Settings, new section "Aircraft market"):
- **"Market alerts"** toggle (`settings.marketAlerts`, default **on**): new offers appear in the Inbox with a quiet info toast ("A330-200 for lease · AerCap, Santiago").
- **"Pause on new market offers"** toggle (`settings.autoPause.marketOffer`, default **off**, disabled while alerts are off).

**Store behaviour**
- With alerts off, `topic: 'market'` messages are hidden from the Inbox list, the unread badge and toasts (they stay in the save).
- The pause is honoured only when both toggles are on.
- Toasts for market messages use tone `info`. They are the only info-tone toasts; this is an exception to the "bad or goal only" rule.

**Inbox:** a "Market" filter chip; tapping a market message opens the Fleet Market view scrolled to the card (or "This offer has gone" if expired).

**Schedule:**
- delivery and return ferries are ordinary ferry blocks with the label "Delivery" or "Return";
- before handover a delivering row shows a grey band "Delivering · handover SCL 12 Jan";
- the return check is a maintenance block "Lease return SNN".

### F6.8 Inbox texts (one per event)
| Event | Tone | Title | Body |
|---|---|---|---|
| New offer | info, topic market | "Market: A330-200 for lease" | "AerCap offers an ex-LATAM A330-200 (2009, 18J/282Y), handed over at Santiago. $205K/month for 60 months, deposit $410K. Handover about 6 weeks after signing. Open until 14 Nov." Locked: "…Needs Widebody operations first." |
| Signed | good | §F6.3 | |
| No pilots 48 h | warn | §F6.4 | |
| Handover | info | §F6.4 | |
| Home | good | "CS-TQC is home" | §F6.4 |
| Lease notice | decision | "Lease of CS-TQB ends 12 Mar" | "AerCap offers 12 months at $226K (−3%) or 36 months at $214K (−8%). Returning costs about $640K at Shannon (check, half-life, cabin) and frees $460K deposit." |
| Returned | info | §F6.6 | |

### F6.9 Balance intent
- About 12 offers a year, 4 at most open. About 1 in 3 is a widebody once the gate is open, and 1 in 10 is new-build.
- A first widebody is realistically **signed in month 5–8** and **home in month 6–10** for a player who files Widebody operations by month 4 (§F8).
- Delivery ferries cost NB $15–60K and WB $40–150K (fuel 2.5–7 t/BH × $750/t plus fees and crew), about 2–5% of a year's rent: felt, not punishing.
- Return costs land at $0.3–1.2M: an incentive to extend good aircraft and to keep refits in mind on leased ones.

---

## F7. Cabin reconfiguration (new `ops/cabin.ts`; RESEARCH §7.4)

### F7.1 Layouts
`cabinOptions(typeId)` (pure) gives the type's presets (all-economy, two-class, three-class where listed) **plus a VIP preset**:
- **Narrowbody VIP:** `j = maxSeats > 200 ? 28 : 24`, `y = round(allEconomyY × 0.5 / 6) × 6`. A320 "24J/90Y", A321 "28J/110Y".
- **Widebody VIP:** `j = clamp(round(maxSeats × 0.09 / 2) × 2, 30, 48)`, `y = round(allEconomyY × 0.45 / 6) × 6`. A330-200 "36J/150Y", 777-200ER "40J/180Y".
- `layout: 'vip'`, label as shown.

The cabin crew minimum follows the seats (`cabinMinimum`), so a VIP A320 still needs 3, plus the client's extra cabin crew.

### F7.2 Refit rules
| Target layout | Narrowbody | Widebody |
|---|---|---|
| All-economy (max seats) | 5 days · $120K | 14 days · $600K |
| Two-class | 7 days · $250K | 21 days · $1.6M |
| Three-class | (n/a) | 28 days · $2.2M |
| VIP | 21 days · $1.2M | 35 days · $3.0M |

These sit within RESEARCH's 2–6 weeks and $0.5–3M for widebodies. Narrowbody two-class is convertible euro-business, hence days.

**Stations.** Refits are done only at an **MRO station** that can take the body (`MRO_STATIONS` in `data/market.ts`, all real):

| Station | Shop | Bodies |
|---|---|---|
| LIS | TAP Maintenance & Engineering | NB WB |
| MAD | Iberia Maintenance | NB WB |
| HAM | Lufthansa Technik | NB WB |
| MLA | Lufthansa Technik Malta | NB WB |
| VNO | FL Technics | NB |
| SNN | Atlantic Aviation Group | NB |
| IST | Turkish Technic | NB WB |
| AUH | Etihad Engineering | NB WB |
| AMM | Joramco | NB WB |
| SIN | ST Engineering | NB WB |

Codes missing from `airports.ts` are skipped.

**Booking.** `bookRefit(g, acId, label, station, start)` with `start ≥ now + 7 days` (hangar slot lead):
- delegates to `scheduleCheck(g, acId, 'refit', start, station, {refit: {cabin, days, cost}})`. Same clash rules as checks, and a ferry is booked automatically when the aircraft is elsewhere (`purpose: 'refit'`).
- **Leased aircraft** may be refitted ("lessor consent": no cost); the reinstatement shows in the lease return quote.
- Same layout and label → refused ("Already 180Y").

**Execution:**
- at `maint.start`, post the cost to the new ledger cat **`refit`** ("Cabin refits");
- at `maint.end`, set `ac.cabin = refit.cabin`, `stats.refits++`, then `rerosterFrom(g, acId, now)` so future duties get the new complement;
- the aircraft stays at the station (positioning to the next job starts there, as after paint).

**Message** (`good`, ref aircraft): **"CS-TQA refitted: 24J/90Y VIP"** — "Out of the Lufthansa Technik hangar at Hamburg after 21 days ($1.2M). Cabin crew minimum 3 (was 4). It can now bid for VIP and state work; Hajj, troop and pilgrim charters need more seats."

**Cancel:** the existing `cancelCheck`. Free until the start; no cancelling once in work.

### F7.3 What the layout decides (ENGINE `contracts/offers.ts`, `feasibility.ts`)
New `Requirements.layouts?: CabinLayout[]` (accepted layouts; supersedes `layout` when set) and `minPremium?: number` (J + W seats).

| Work | Requirement | Note |
|---|---|---|
| Season base NB | layouts all-economy, two-class (as today in practice) | |
| Season base WB | two-class, three-class | |
| Sports | 55%: two-class, three-class or VIP, `minPremium` NB 12 / WB 20, price +10%; 45%: any | "VIP/sports want premium cabins" |
| **VIP** (new builder, §F7.4) | VIP; corporate: VIP, two-class or three-class with `minPremium` 24 | +35% (`BAL.premium.vip`) |
| Troop rotation | `minSeats` NB **174** / WB **300**; UN variant all-economy | "max seats": a two-class aircraft fails on seats |
| Ad hoc pilgrimage | all-economy, `minSeats` NB **180** / WB **300** | Hajj and Umrah-style |
| Everything else | unchanged | |

**Feasibility `layout` check** (existing id):
- `no` → "Needs a VIP cabin; CS-TQA is 180Y".
- The tip is the cheapest refit from `refitQuote` at the best station: "Refit to 24J/90Y at Lisbon: 21 days, $1.2M".
- New optional `FeasibilityCheck.action = {kind: 'refit', layout}` lets the OfferModal offer **"Plan refit…"**.
- The `seats` and `minPremium` checks use the current cabin (a planned refit that ends before the first departure counts: "after the refit 1 Jun").

### F7.4 VIP offers (minimal new builder, `archetype: 'vip'`)
**Clients:** a government (head-of-state or ministerial delegation), a corporate client or a music act. Real names from `clients.ts`.

**Pattern:** 1–3 round trips over 2–10 days, 60–140 pax:
- narrowbody within 3,000 km;
- widebody long haul only in "aspire" mode or when a widebody is unlocked.

`extraCabin` 2–4; payment as government or corporate today; `effects {clean: 1, reliable: 1}`.

**Weight** 0.04, × 2 when the fleet has a VIP-layout aircraft.

**Prestige long haul.** When ETOPS 240 is held or pending, 30% of widebody VIP and sports offers become nonstop ULR trips (sector ≥ 16 h flight time or ≥ 7,000 nm, `noTechStops`, `approvals: ['ulr']`, price × 1.25). These are the ULR rung's reward.

### F7.5 UI
**Fleet aircraft card, Cabin row:**
- "Cabin **180Y** all-economy · crew minimum 4 cabin";
- a button **Refit…** opens `RefitModal`;
- a planned or running refit shows "Refit to 24J/90Y at Hamburg 3–24 Jun" with a cancel (planned only, confirm).

**`RefitModal`** (`{kind: 'refit', aircraftId, layout?}`, 720 px, two columns):
- **Left column:**
  - layout chips from `cabinOptions`, each with seats ("24J/90Y · 114 seats");
  - station chips sorted by ferry block ("Lisbon · here", "Hamburg · ferry 3 h 05"; NB-only stations hidden for widebodies);
  - start-day chips for the next 8 weeks (earliest now + 7 d; days that clash are greyed with the reason).
- **Right column:**
  - summary: days, cost, seats 180 → 114, cabin crew minimum 4 → 3;
  - "Opens: VIP, premium sports. Closes: troop rotations (174+), pilgrimage (180+)";
  - for leased aircraft, "Reinstated at lease return ≈ $120K";
  - conflicts;
  - primary **"Book refit · $1.2M"**.

**Schedule:**
- refit block = maintenance stripes with the label "Refit → 24J/90Y";
- the row header shows the cabin label under the registration ("CS-TQA · A320 · 180Y").

**OfferModal and offer cards:**
- requirement chips: "VIP cabin", "Premium 20+", "Max seats 300+";
- the `layout` feasibility line gets **Plan refit…** (opens `RefitModal` with the layout preset).

### F7.6 Balance intent
- A VIP narrowbody earns about +35% on fewer, shorter jobs. Two-class opens premium sports at +10%, and all-economy keeps troop, pilgrim and Hajj-style work.
- With 2–6 aircraft, choosing one VIP or premium aircraft is a real trade-off, not a default.
- A refit pays back in roughly 3–6 months of the work it opens.

---

## F8. The Ladder (ENGINE `ops/company.ts`, `ops/goals.ts`; RESEARCH §6 G2, G5–G9, §6 tiers)

### F8.1 Rungs and nodes
| Rung | Node (`ApprovalId`) | Cost | Time | Needs (approvals) | Other requirements | Unlocks |
|---|---|---|---|---|---|---|
| 0 | Narrowbody charter & ACMI (start) | | | | | A320, 737, A321, A321neo, 757 |
| 1 | **ETOPS 120** `etops120` | $250K | 120 d | | An ETOPS-capable twin in the fleet · 4 CPT + 4 FO current on it · reliability ≥ 60 · clean 90 d | Over-water work up to 120 min (Azores, Cape Verde, thin N Atlantic on A321LR) |
| 1 | **Widebody operations** `widebody` (new) | $600K | 120 d | | ≥ 90 days of operations · 4 CPT + 4 FO rated on **or booked to convert to** one widebody family · reliability ≥ 62 · clean 90 d | Signing 767-300ER, A330-200/-300, A340-300 (tier 2) |
| 2 | **ETOPS 180** `etops180` | $350K | 150 d | ETOPS 120 held ≥ 120 d | A 180-capable twin in the fleet or delivering · 4+4 pilots rated on it · reliability ≥ 65 · clean 180 d | South Atlantic direct, Indian Ocean |
| 2 | **Long-haul augmented crews** `augmented` | $300K | 90 d | Widebody operations | A widebody with crew rest in the fleet or delivering · 6 CPT + 6 FO rated on a widebody family · reliability ≥ 65 | Duties over 13 h with 3–4 pilots. With ETOPS 180: **777-200ER/-300ER, A380** (tier 3) |
| 3 | **ETOPS 240** `etops240` | $500K | 180 d | ETOPS 180 held ≥ 180 d · augmented | ≥ 2 aircraft of a 240-capable type in the fleet (A330-200, 777) · 6+6 pilots rated on it · reliability ≥ 70 · clean 180 d | **787-9, A350-900, A350-900ULR, 777-200LR** (tier 4); prestige long haul |
| 4 | **Ultra-long-range (FRMS)** `ulr` | $900K | 180 d | ETOPS 240 · augmented | ≥ 20 augmented duties flown · a ULR-capable aircraft in the fleet or delivering · 8 CPT + 8 FO rated on it · reliability ≥ 75 · clean 365 d | Sectors over 16 h with 4 pilots; ULR prestige work |

IOSA and DG stay as **Other approvals** (unchanged) below the ladder.

**Earliest realistic path:**
- widebody signed in months 4–6, flying in months 6–9;
- 777 by about months 14–20;
- A350 or 787 by about months 24–30;
- ULR by about year 3.

This compresses RESEARCH's T2–T4 (years 2–5) because a game year is about 6 h at 1×.

### F8.2 Rules
- **Crew counts** (`ratedPilots(g, families, {booked})`):
  - CPT and FO not on notice who hold the family;
  - `booked` adds members of planned or running conversion classes to it (allowed only to *file* Widebody operations).
  - **Granting always needs crew who are actually rated.**
- **Clean record** (`cleanRecord(g, days)`):
  - no `illegalCrew` incident in the window;
  - AOG incidents ≤ max(1, aircraft on the AOC × 0.5);
  - incidents are logged in `stats.incidents` (`[t, kind]`, pruned after 365 days) where `stats.illegalCrewFlown` and `stats.aogs` are incremented today.
- **Filing** (`applyApproval`, extended): every requirement must pass, then `post('approvals', −cost)` and a `PendingApproval` as today. The `approvalBlocker` text names the **first** failing requirement.
- **Findings.** An `illegalCrew` incident while an application is pending adds **30 days** to `done` (re-queued; `findings++`, max 2; the third finding is ignored). Message (`warn`): **"ETOPS 180: authority finding"** — "A duty flew over its FDP on 3 Feb. The authority adds 30 days: now due 14 Jul."
- **Grant** (`approval.done`):
  - re-check the rated-crew and clean-record requirements. On failure, set `pending.waiting` to the text, re-check in the ops `day` handler, and post one message: **"Widebody operations waits for rated pilots"** — "The authority is ready but needs 4 rated captains (2 now). The A330-P1 class finishes on 21 May."
  - on success: `approvals.push`, `approvalsAt[id] = now`, a message and the goal (§F8.4).
- **Type gate** (`aircraftGate(g, typeId)`, pure): tier 2 needs `widebody`; tier 3 needs `widebody + augmented + etops180`; tier 4 needs `etops240 + augmented`. Each counts when it is **held or pending**. Text: "Needs Widebody operations", or "Widebody operations pending (due 3 Jun): you can sign; it flies revenue after approval".
- **Flying before the grant.** Feasibility adds the missing gate approvals to the `approvals` check for that aircraft ("Widebody operations pending, due 3 Jun"). Ferries (delivery, refit, checks) are allowed.
- **Contracts.** The existing `etops`, `crew` (augmented) and `approvals` checks plus aspirational offers already show the ladder. ULR prestige offers (§F7.4) need `ulr`.

### F8.3 Market link
`eligibleTypes` uses `aircraftGate` (§F6.2): unlocked types are normal, the next rung is a 0.3-weight teaser, and the rest are hidden. The old reliability-70 / 4-aircraft rule is removed.

### F8.4 Goals (`ops/goals.ts`)
The seven goals stay. Add these (keep `GOALS` order = the ladder order):

| id | Title | Desc | Progress |
|---|---|---|---|
| `etops120` | ETOPS 120 | Earn ETOPS 120 approval. | `approvalProgress` |
| `widebodyOps` | Widebody operator | Earn Widebody operations approval. | `approvalProgress` |
| `etops240` | ETOPS 240 | Earn ETOPS 240 approval. | `approvalProgress` |
| `first777` | Triple Seven | Operate a 777. | 1 when a 777 is on the AOC, 0.5 delivering |
| `ulrApproved` | FRMS approved | Earn ultra-long-range approval. | `approvalProgress` |

**Ladder goals** (the approval goals plus `firstWidebody`, `first777` and `firstUlr`) post their goal message with **`topic: 'ladder'`**, `ref: {kind: 'aircraft', id}` where an aircraft is involved. The body names what opened ("You can now sign 767-300ERs, A330s and A340s.") and the next step ("Next: ETOPS 180 and long-haul crews.").

### F8.5 UI (Company screen)
**Layout at 1180×820:**
- A full-width **Ladder** card at the top of Company (about 960 × 360).
- **Five columns**, rungs 0 → 4 left to right (about 180 px each, 12 px gaps).
- Each column has a header ("Rung 2 · Long haul") and 1–2 **node cards** (172 × 128).
- Static SVG connectors join each node to its prerequisites (1.5 px, `--line`); held paths use `--good`. Nothing animates.

**Node card:**
- name;
- a status chip: **Held since 3 Mar** (good) / **In progress · due 3 Jun** with a thin progress bar (updated daily) / **Ready to apply** (accent) / **Locked**;
- the first unmet requirement in one line ("4 A330 captains rated · 2 now");
- `$600K · 120 days`;
- unlock chips ("B763 · A332 · A333 · A343").

Tap a node → **`ApprovalModal`** (`{kind: 'approval', id}`, 640 px):
- description;
- the requirement checklist from `approvalReqs` (✓/✗ rows with have/need, e.g. "Clean record: 90 days · ✓ last incident 4 months ago", "Reliability 63 / 65 ✗");
- cost and time;
- "Unlocks" with small `AircraftArt` of each type and the work line;
- **Apply · $600K**, behind a confirm when the cost is over 25% of cash; disabled with the blocker text otherwise.
- Pending: started, due, findings, waiting text.

**Below the ladder:** Other approvals (IOSA, DG; unchanged rows), then Reputation, Policies and Goals (Goals list ladder goals in order with progress).

**Celebration:** when a new `topic: 'ladder'` goal message arrives, the store opens **`LadderStepModal`** (`{kind: 'ladderStep', messageId}`, 520 px, static):
- an Award icon, the title, the body;
- the unlocked types as `AircraftArt` (up to 3);
- **See the ladder** (→ Company) and **Close**.

It opens at most once per message (seen ids in the store; not saved), never over another modal: it is queued until modals close. The usual goal toast is suppressed for these.

---

## 5. Data model (ENGINE lands these first, in one edit of `core/types.ts`)

```ts
// Company
export type ApprovalId = /* …existing */ | 'widebody';
export interface PendingApproval { /* … */ /** v0.7: authority findings (+30 d each, max 2). */ findings?: number; /** v0.7: due but waiting for this requirement (re-checked daily). */ waiting?: string }
export interface Company { /* … */ /** v0.7: when each approval was granted. load: ??= {}, held ones ← g.started. */ approvalsAt?: Partial<Record<ApprovalId, Minute>> }

// Fleet
export type MaintKind = 'A' | 'C' | 'AOG' | 'line' | 'paint' | 'refit' | 'return';
export interface MaintenanceEvent { /* … */ /** v0.7 cabin refit: the cabin fitted at the end. */ refit?: { cabin: Cabin }; /** v0.7 lease return check: the aircraft leaves the fleet at the end. */ leaseReturn?: boolean }
export type Ownership =
  | { kind: 'owned'; bookValue: number; /** v0.7 */ newBuild?: boolean }
  | { kind: 'dryLeaseIn'; /* …existing */ /** v0.7: redelivery airport (load ??= homeBase); cabin at delivery (load ??= current); new-build; 120-day notice given. */
      returnSite?: string; deliveredLayout?: CabinLayout; newBuild?: boolean; noticeGiven?: boolean };
export interface DeliveryInfo {
  site: string;
  /** 'ex-LATAM, Santiago (SCL)' / 'Tarmac Aerosave, Tarbes (LDE)'. */
  where: string;
  handover: Minute;
  ferryIds: string[];
  /** Ferry held for crew since (parking charged daily). */
  waitingSince?: Minute;
  arrived?: Minute;
}
export interface Aircraft { /* … */
  /** v0.7: handover abroad and the delivery ferry (unset on v0.6 deliveries: handover at base, no ferry). */ delivery?: DeliveryInfo;
  /** v0.7: lease return booked (ferry + return check). */ returning?: { site: string; maintId: string; ferryIds: string[]; quote: number };
}
// Flights
export interface Flight { /* … */ /** v0.7: why an empty ferry flies (labels, map, ticket purpose). */ purpose?: 'delivery' | 'return' | 'refit' }
// Market
export interface AircraftOffer { /* … */ /** v0.7: handover airport (load ??= homeBase), its text, ex-operator, new-build slot. */ site?: string; where?: string; exOperator?: string; newBuild?: boolean; created?: Minute }
export interface Market { /* … */ /** v0.7: the post-filing widebody offer was made. */ gotWideFiled?: boolean }
// Contracts
export interface Requirements { /* … */ /** v0.7: accepted cabin layouts (supersedes `layout`); premium seats J+W. */ layouts?: CabinLayout[]; minPremium?: number }
// Messages
export interface Ref { kind: /* …existing */ | 'market'; id: string } // v0.7: an aircraft market offer
export interface Message { /* … */ /** v0.7: market alerts (UI may hide them) and ladder steps (celebration). */ topic?: 'market' | 'ladder' }
// Ledger
export type LedgerCat = /* … */ | 'refit' | 'leaseReturn';
// Stats
export interface Stats { /* … */ incidents?: [Minute, 'illegalCrew' | 'aog'][]; deliveries?: number; deliveryWaitDays?: number; refits?: number; leaseReturns?: number; leaseExtensions?: number; findings?: number }
```

**`core/pause.ts`:** `PauseReason` gains `'marketOffer'`, last in `PAUSE_ORDER`.

**Load defaults** (ops module `load`):
- `company.approvalsAt ??= {}`, and every held approval without a date gets `g.started`;
- market offers: `site ??= homeBase`;
- dry leases: `returnSite ??= homeBase`, `deliveredLayout ??= ac.cabin.layout`;
- `stats.incidents ??= []`;
- aircraft already `delivering` without `delivery` keep the v0.6 path (handover at home base, no ferry).

**No new `SimEventType`.** Market spawns, lease notices, waits and approval re-checks run in the ops `day` handler. Refits and returns use `maint.start`/`maint.end`; handover uses `aircraft.delivery`.

## 6. Balance (`core/balance.ts`, new ENGINE block)
```ts
// ---------- fleet & ladder v0.7 (ENGINE) ----------
market7: { perMonth: 1.0, maxOpen: 4, offerDays: [7, 21] as [number, number], teaserWeight: 0.3, newBuildChance: 0.1,
  newBuildLead: [180, 420] as [number, number], newBuildMonths: [96, 144] as [number, number], newBuildRent: [1.0, 1.1] as [number, number],
  newBuildDepositMonths: 3, lessorSiteShare: 0.5, wideAfterFilingDays: 45 },
delivery: { acceptH: 36, dayBlockMax: 600, daySectorsMax: 3, fuelStopTurn: 60, nightStop: 14 * 60, parkPerDay: [400, 900] as [number, number], warnH: 48 },
leaseReturn: { noticeDays: 120, decisionDays: 14, checkDays: [7, 14] as [number, number], checkCost: [180_000, 450_000] as [number, number],
  halfLifeShare: 0.5, repaintFactor: 0.9, extend: { 12: 0.97, 36: 0.92 } as Record<number, number> },
refit: { leadDays: 7, nb: { 'all-economy': [5, 120_000], 'two-class': [7, 250_000], vip: [21, 1_200_000] } as Record<string, [number, number]>,
  wb: { 'all-economy': [14, 600_000], 'two-class': [21, 1_600_000], 'three-class': [28, 2_200_000], vip: [35, 3_000_000] } as Record<string, [number, number]> },
ladder: { findingDays: 30, maxFindings: 2, aogPerAircraft: 0.5, incidentKeepDays: 365 },
```
**Changed:** the quiet-floor constants (§C4) move into `BAL` as `quietFloor: { days: 5, idleDays: 2, maxOpen: 5 }`. The old `marketPerMonth`, `marketOfferDays` and `wideMarketWeight` are superseded and kept only so they compile.

## 7. Interfaces between lanes (final signatures; ENGINE ships stubs first)
All of these are exported from `src/engine/ops/index.ts` unless noted. The read APIs are pure and are added to `core/plumbing.test.ts`.

```ts
// ---- F6 market & delivery (ops/market.ts, ops/delivery.ts, ops/leaseReturn.ts) ----
export interface AircraftGate { ok: boolean; /** pending approvals count as ok (flies revenue after the grant). */ pending: ApprovalId[]; missing: ApprovalId[]; text: string }
export function aircraftGate(g: GameState, typeId: string): AircraftGate;
export interface DeliveryLeg { from: string; to: string; std: Minute; sta: Minute; block: number; nightStopAfter: boolean }
export interface DeliveryQuote {
  site: string; where: string; handover: Minute; homeBy: Minute; legs: DeliveryLeg[]; days: number;
  fuel: number; fees: number; crew: number; total: number;
  /** Planned airline itinerary for the delivery pilots from home base (display only). */
  deadhead: CommercialLeg[];
  text: string; // 'SCL–REC–LIS · 2 legs · 1 night stop · ≈ $96K'
}
export function deliveryQuote(g: GameState, typeId: string, site: string, handover: Minute): DeliveryQuote;
export interface MarketOfferView {
  offer: AircraftOffer; typeId: string; gate: AircraftGate; quote: DeliveryQuote;
  crew: { level: 'ok' | 'warn' | 'bad'; rated: number; text: string };
  /** Days until it lapses (whole days, for 'Open 9 more days'). */ daysLeft: number;
  returnText: string | null; // 'Return at Shannon · 7-day check · cabin back to 18J/282Y'
}
export function marketView(g: GameState): MarketOfferView[];              // open offers, newest first
export function acquireAircraft(g: GameState, offerId: string): ActionResult<{ aircraftId: string }>; // extended
export interface DeliveryStatus {
  phase: 'preparing' | 'handedOver' | 'ferrying' | 'waiting' | 'home';
  site: string; where: string; handover: Minute; homeBy: Minute | null;
  ferryIds: string[]; pilotIds: string[]; ticketIds: string[]; waitingSince: Minute | null; text: string;
}
export function deliveryStatus(g: GameState, aircraftId: string): DeliveryStatus | null;
export interface ReturnQuote { site: string; lines: { label: string; amount: number }[]; total: number; deposit: number; checkDays: number; ferry: DeliveryLeg[] }
export function returnQuote(g: GameState, aircraftId: string): ReturnQuote | null;
export type LeaseChoice = 'extend12' | 'extend36' | 'return';
export interface LeaseView {
  lessor: string; ends: Minute; daysLeft: number; rent: number; returnSite: string;
  options: { id: LeaseChoice; label: string; rent?: number; cost?: number; chips: string[] }[];
  returning: Aircraft['returning'] | null; decisionId: string | null;
}
export function leaseView(g: GameState, aircraftId: string): LeaseView | null;
export function chooseLease(g: GameState, aircraftId: string, choice: LeaseChoice): ActionResult;  // also the 'leaseEnd' decision resolver
/** Why our crew ride this airline ticket (map panel, roster detail). */
export function ticketPurpose(g: GameState, ticketId: string): { kind: 'delivery' | 'return' | 'refit' | 'duty' | 'home'; aircraftId?: string; text: string };

// ---- F7 cabin (ops/cabin.ts) ----
export function cabinOptions(typeId: string): CabinPreset[];               // type presets + VIP
export function refitStations(g: GameState, aircraftId: string): { code: string; name: string; ferryBlock: number }[];
export interface RefitQuote {
  ok: boolean; why: string | null; cabin: Cabin; days: number; cost: number; start: Minute; end: Minute;
  station: string; ferryIn: DeliveryLeg[]; seatsFrom: number; seatsTo: number; cabinMinFrom: number; cabinMinTo: number;
  opens: string[]; closes: string[]; reinstateAtReturn: number | null; clashes: string[];
}
export function refitQuote(g: GameState, aircraftId: string, label: string, station: string, start: Minute): RefitQuote;
export function bookRefit(g: GameState, aircraftId: string, label: string, station: string, start: Minute): ActionResult<{ maintId: string }>;
// cancel: existing cancelCheck(g, maintId)

// ---- F8 ladder (ops/company.ts) ----
export interface ApprovalReq { label: string; ok: boolean; have?: string; need?: string }
export type NodeState = 'held' | 'pending' | 'ready' | 'locked';
export interface LadderNode {
  id: ApprovalId; name: string; desc: string; state: NodeState; cost: number; days: number;
  requires: ApprovalId[]; reqs: ApprovalReq[]; blocker: string | null;
  heldSince: Minute | null; pending: (PendingApproval & { progress: number }) | null;
  unlocksTypes: string[]; unlocksWork: string;
}
export interface LadderRung { index: number; title: string; nodes: LadderNode[] }
export function ladder(g: GameState): LadderRung[];                        // rungs 0–4; rung 0 has no nodes (unlocksTypes only)
export function approvalReqs(g: GameState, id: ApprovalId): ApprovalReq[];
// existing, extended: APPROVALS (+ widebody, etops240 defs), approvalBlocker, applyApproval, onApprovalDone

// ---- contracts (additive) ----
// FeasibilityCheck gains `action?: { kind: 'refit'; layout: CabinLayout }`.
// Requirements.layouts / minPremium as §5; OfferModal chips read them.

// ---- crew (C2) ----
// rosterBoard: same signature; unchanged rows keep object identity (cache by crewRev + window + hour bucket).

// ---- dev (engine/dev.ts) ----
export function devMarketOffer(g: GameState, typeId?: string, opts?: { kind?: 'dryLeaseIn' | 'buy'; newBuild?: boolean; site?: string }): string; // offer id
export function devGrantApproval(g: GameState, id: ApprovalId): void;
```

**UI store additions** (`src/ui/store.ts`, UI lane, additive):
- `ModalSpec`:
  - `| { kind: 'acquire'; offerId: string }`
  - `| { kind: 'refit'; aircraftId: string; layout?: CabinLayout }`
  - `| { kind: 'lease'; aircraftId: string }`
  - `| { kind: 'approval'; id: ApprovalId }`
  - `| { kind: 'ladderStep'; messageId: string }`
- `Settings.marketAlerts: boolean` (default true); `autoPause.marketOffer` (default false). Honour `marketOffer` only when `marketAlerts` is on.
- Toast rule: `topic: 'market'` → info toast when alerts are on; `topic: 'ladder'` → `LadderStepModal` instead of a toast.
- Fleet `nav.view`: `'fleet' | 'market'`.
- `useThrottledNow(ms)` hook (C2).
- `dev.marketOffer(typeId?)` → `devMarketOffer` and opens the Market; `dev.grant(id)` → `devGrantApproval`.

**MAP lane** (reads only):
- `AircraftLayer`:
  - aircraft with `status === 'delivering'` are not drawn;
  - after handover they are drawn at `ac.at` like any parked aircraft, with a static **"DELIVERY"** tag until `delivery.arrived` (from `deliveryStatus().phase` in `handedOver | waiting | ferrying`).
- **Ferry paths** use the existing ferry style. The selected aircraft's arcs include the whole remaining delivery chain (night stops included), dashed.
- **Delivery pilots' airline legs** are the existing commercial deadheads (grey icon, flight-number label, dotted grey path, tap panel). The tap panel adds a "Purpose" line from `ticketPurpose` ("Delivery crew for CS-TQC · ferry SCL–LIS 13 Jan"). Connections stay separate legs as today.
- **Aircraft panel:**
  - delivery block: "Handed over at Santiago · ferry home 13 Jan 08:00 local · 2 legs via REC · pilots Silva, Costa (on LA 8071, lands 21:40)", or "Waiting for rated pilots since 13 Jan";
  - refit block: "Cabin shop at Hamburg: refit to 24J/90Y, back 24 Jun";
  - return block: "Lease return check at Shannon until 12 Mar";
  - airborne ferry: "Delivery ferry · leg 1 of 2 · fuel ≈ $41K".
- **Airport panel:** an "Aircraft awaiting delivery here" line.
- **`mapLogic.chipInfo`:** 'delivering' → "Handover SCL 12 Jan"; handed-over → "Delivery ferry 13 Jan"; refit → "Refit HAM".
- **Map styles:** `.op-delivery-tag` (static), in `map.css`.

## 8. Bot (`scripts/acmi-bot.ts`, ENGINE)
A pure function of state, as before; every item below counts as one action.

- **Ladder:**
  - **Widebody operations:** files it when `approvalBlocker` is null, operations ≥ 90 days and cash ≥ cost + $1.5M + 2 months of fixed costs. It first books a conversion of 4 CPT + 4 FO (A330 or B767, whichever has the cheaper open lease, else B767) from the narrowbody surplus, or hires rated pilots when the surplus is short.
  - **ETOPS 120:** filed from month 4 when affordable.
  - **Augmented:** filed once a widebody is held and a widebody job over 13 h has been seen.
  - **ETOPS 180 and 240:** filed when ready and cash ≥ cost + $2M.
  - **ULR:** never (out of a year's reach; logged as "next").
- **Market:**
  - the existing widebody rule, now requiring `aircraftGate(...).ok`;
  - a second narrowbody lease when fleet utilisation over 60 days is ≥ 75% and cash ≥ deposit + $1M;
  - **never** buys new-build.
  - It reads market messages (alerts on) but doesn't depend on them.
- **Delivery:** no action needed. When `deliveryStatus().phase === 'waiting'`, the bot hires 2 rated pilots (once).
- **Refit:** at most once per 180 days. When an open sports-premium or VIP offer worth ≥ $1.2M has every check `ok` except `layout`, and the cheapest refit ends before its start with the cost < 40% of the offer value, the bot books it and then accepts the offer after the refit if it is still open.
- **Lease end:** decides the decision within its life: extend 12 if the aircraft's 90-day utilisation is ≥ 50% or a contract runs past `leaseEnd − 30 d`; else return.

**New printed lines:**
- approvals filed and granted (day), findings, waits;
- market offers seen per month, teasers, signings;
- deliveries: ferry legs, days, waits, deadhead tickets for delivery crews, ferry cost;
- refits;
- lease returns and extensions with costs.

**Targets:**
- Widebody operations filed by day 200 and a widebody signed by day 365 on at least 4 of seeds 1–6 (printed per seed). This replaces "widebody acquirable within 12 months".
- Every delivery ferry flies with zero illegal duties. No aircraft waits more than 30 days at a site.
- At least one delivery per seed shows delivery pilots on airline deadheads (count of `ticketPurpose(...).kind === 'delivery'` > 0 when the site is not home).
- At least 1.0 actions a week and at least 42/52 active weeks on seeds 1–6, one at a time.
- Offers per year within ±10% of v0.6.
- All v0.6 targets still pass, and 365 days run in under 10 s.

## 9. Not in v0.7 (keep it simple)
- Aircraft sales by the player.
- Sub-charter market personalities.
- Hajj as its own archetype with drifting dates.
- UN multi-year, deportation, war-risk, Antarctica.
- Market cycles beyond today's index drift.
- Second AOC, government vetting, defence and US authorisations.
- Per-type new-type approvals (one Widebody operations covers all widebody families).
- Station capacity for refits, and refit slot bidding.
- Engine shop visits at lease return.
- Contracted (non-company) ferry crews.

## 10. Tests and acceptance
**ENGINE tests** (next to the code)
- **`ops/market.test.ts`:**
  - spawning averages 0.8–1.2 a month over 50 seeds × 2 years, ≤ 4 open, life 7–21 days;
  - teasers only one rung away, never two;
  - new-build only for `NEW_BUILD` types with lead 180–420 days;
  - every site exists and has a non-empty `ticketBlock` from LIS;
  - signing is refused when the gate is closed and allowed when it is pending;
  - signing plans the ferry chain;
  - market messages carry `topic: 'market'` and a `marketOffer` pause request.
- **`ops/delivery.test.ts`:**
  - SCL→LIS on a b763 gives ≥ 2 legs; CGK→LIS on an a320ceo gives multiple days with 14 h night stops; every ferry day is ≤ 10 h of block plus turns and ≤ 3 sectors;
  - a 21-day run from signing crews the ferry with 2 rated pilots, books their deadheads (airline legs present, `ticketPurpose` 'delivery'), shows DH and ferry on their calendars, flies with zero illegal duties and arrives home;
  - with no rated pilots it is never cancelled: daily retime, parking posted, one 48 h warning;
  - handover message, then home message;
  - fuel and fees are charged on the ferry legs.
- **`ops/leaseReturn.test.ts`:**
  - the notice decision at −120 days; default extend 12 (rent × 0.97);
  - return books the ferry and check ending at `leaseEnd`;
  - quote lines (half-life math, cabin reinstatement after a refit, repaint when not white);
  - the deposit is refunded and the aircraft deleted at check end;
  - a busy holdover rolls on as before.
- **`ops/cabin.test.ts`:**
  - `cabinOptions` VIP presets for A320, A321, A332 and B772 match §F7.1;
  - refit at a NB-only station is refused for a widebody;
  - a booked refit ferries in, posts `refit` once, changes the cabin at the end and re-rosters future duties to the new complement;
  - cancelling before the start refunds and removes the ferry;
  - feasibility `layout` returns `action: refit` with the quote tip;
  - a troop rotation fails `seats` on a two-class aircraft.
- **`ops/company.test.ts` (ladder):**
  - every node's requirements (rated vs booked, clean record windows, held-for days);
  - a finding adds 30 days (max 2);
  - grant waits for rated crew, then grants;
  - `aircraftGate` per tier;
  - `ladder()` states;
  - goals fire once with `topic: 'ladder'`.
- **`contracts/offers.test.ts`:** VIP builder validity over 200 seeds; sports premium share 0.45–0.65; troop and pilgrimage `minSeats`; ULR prestige only with `etops240` held or pending.
- **`ops/commercial.test.ts`:** the C3 table and properties.
- **C5 timing tests** as specified.
- **Plumbing purity:** `marketView`, `deliveryQuote`, `deliveryStatus`, `returnQuote`, `leaseView`, `ticketPurpose`, `cabinOptions`, `refitStations`, `refitQuote`, `ladder`, `approvalReqs`, `aircraftGate`.
- **Save compatibility:** the v0.5.2 fixture and a v0.6 save (made with a `delivering` aircraft and a dry lease) load, run 60 days with no NaN, and keep their delivery at base.

**UI acceptance** (Playwright, `scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch via `page.touchscreen.tap`)
- Fleet → Market shows 2-column cards with gate, crew, ferry and deadhead lines. `AcquireModal` signs a lease. The card shows the delivery timeline, and the Schedule shows the delivery ferry.
- `RefitModal` books a VIP refit; the Fleet card, Schedule block and OfferModal "Plan refit…" work.
- `LeaseModal` and the decision show live quotes.
- The Company Ladder renders 5 rungs with no horizontal overflow. `ApprovalModal` applies; `dev.grant('widebody')` opens `LadderStepModal` once.
- Settings toggles hide and show market messages; with pause on, a `dev.marketOffer()` pauses the clock.
- C1 confirm appears only with red warnings; the C2 render budget holds.
- No console errors. Every tappable element is at least 44 px. Renders are at most 2 per second at 4× (the board at most 1).

**MAP acceptance**
- After `dev.marketOffer('a332', {site: 'SCL'})`, sign it and run to the handover. The aircraft appears parked at SCL with a DELIVERY tag. The delivery pilots' airline legs fly with labels before the handover, and their panel shows the purpose. The ferry flies SCL→REC→LIS with its path; the panel shows leg x of n and the fuel estimate; the tag clears at home.
- Nothing else animates. No console errors.

## 11. File ownership and sequencing
| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**`:<br>• new `ops/delivery.ts`, `ops/leaseReturn.ts`, `ops/cabin.ts` and their tests;<br>• edits in `ops/{market,company,goals,flights,maintenance,commercial,events,index}.ts`, `contracts/{offers,feasibility,accept}.ts`, `crew/board.ts` (+ `board.test.ts`, `roster.test.ts`), `engine/dev.ts`, `core/pause.ts`, `core/plumbing.test.ts`.<br>`src/data/**`: `carriers.ts`, new `data/market.ts` (LESSOR_SITES, EX_OPERATORS, FACTORIES, NEW_BUILD, MRO_STATIONS), `airports.ts` only if a needed code is missing.<br>`scripts/acmi-bot.ts`.<br>Shared, minimal and additive: `core/types.ts` (§5 block, first) and `core/balance.ts` (§6 block). | C3, C4, C5, the engine side of C2, F6–F8 engine, the bot |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`:<br>• `screens/{Fleet,Company,Schedule,Contracts,Inbox,RosterBoard,scheduleLogic,screenLogic}.ts(x)` (+ logic tests);<br>• new `modals/{AcquireModal,RefitModal,LeaseModal,ApprovalModal,LadderStepModal}.tsx`;<br>• `modals/{ConvertModal,OfferModal,DecisionModal}.tsx`;<br>• `game/{Modals,Toasts}.tsx`;<br>• `store.ts` (additive: ModalSpec, Settings, nav view, `useThrottledNow`, dev helpers).<br>`src/styles/**` except map styles (new `styles/acmi/v07.css`, imported from `styles/acmi/index.css`).<br>`scripts/ipad-shots.cjs` (append Market, Refit, Ladder and Lease shots; an exception to ENGINE owning `scripts/`). | C1, the UI side of C2, F6–F8 screens, modals, settings and the ledger labels for `refit` and `leaseReturn` |
| **MAP** | `src/ui/map/{LiveLayers.tsx,MapPanels.tsx,mapLogic.ts,mapLogic.test.ts,OpsMap.tsx}`, `src/styles/acmi/map.css` | The delivery tag, ferry chain arcs, deadhead purpose line, panel blocks and chip texts (§7 MAP) |

**Sequencing**
1. **ENGINE step 0:** land §5 types, §6 BAL, `'marketOffer'` and **stubs** for every §7 export. Stub return values:
   - `marketView` maps `g.market.aircraft` with `gate.ok = true` and an empty quote;
   - `ladder()` lists `APPROVALS` as nodes;
   - `cabinOptions` returns `typeOf(id).cabins`;
   - the `*Quote` functions return `ok: false` with the reason "v0.7 stub";
   - actions return `{ok: false, error: 'v0.7 stub'}`.

   Keep tsc green. UI and MAP build against the stubs from then on.
2. **ENGINE order:**
   1. C5;
   2. C3;
   3. C2 cache;
   4. ladder (types, gate, requirements, findings, goals);
   5. market and delivery (sites, ferry planning, waiting, quotes, `ticketPurpose`);
   6. cabin (refit through `scheduleCheck`, requirements, VIP builder);
   7. lease returns;
   8. C4 tuning plus the bot last, because the ladder and market change the bot's numbers.
3. **UI:**
   1. C1 and C2 first (small, independent);
   2. the Market view and AcquireModal;
   3. Ladder and ApprovalModal;
   4. Refit and Lease;
   5. Settings and Inbox.

   Each part lights up as the engine piece lands.
4. **MAP:** builds on `deliveryStatus` and `ticketPurpose` stubs, and verifies with `dev.marketOffer` once delivery lands.
5. **Merge order:** ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green, and the bot is run on seeds 1–6 one at a time.
