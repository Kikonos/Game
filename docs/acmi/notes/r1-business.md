# R1: ACMI business, contracts and economics (research for game design)

Researched October 2026. "(est.)" marks an estimate or extrapolation where no primary figure was found. "[S#]" points to the source list at the end. ACMI providers rarely publish rates. The hard numbers here come from real contracts filed with the SEC, public tenders, listed-company results, valuation firms and broker material.

---

## 1. Lease and charter types: who provides and pays what

| Product | Lessor/operator provides | Customer provides/pays | Whose AOC, flight number and commercial risk |
|---|---|---|---|
| **Wet lease / ACMI** | **A**ircraft, **C**rew (cockpit + cabin), **M**aintenance, **I**nsurance (hull + liability). Usually also crew per diems, crew training, CAMO/OCC. | Fuel, landing/parking, navigation/overflight, ground handling, catering, de-icing, crew hotels (typically 4-star single rooms) + local transport, visas, pax taxes, customs overtime. **Pays per block hour against a monthly minimum (MGH).** | Lessor's AOC. Customer's flight number. Customer sells the seats and carries load-factor and fuel risk. |
| **Damp lease** | Same as ACMI but **cockpit crew only** (ICAO Doc 8335 definition [S10]). | Customer supplies cabin crew (often in its own uniform for brand consistency), plus all the above. | Lessor's AOC. Common when a flag carrier wants "its" cabin product. |
| **CMI (hybrid)** | Crew, Maintenance, Insurance on the customer's own aircraft: the customer dry-leases its aircraft to the operator, which wet-leases it back [S9]. | Aircraft ownership/lease + operating costs. | Operator's AOC. Used when an airline has aircraft but no crews or AOC capacity (e.g. a start-up, or a carrier with a pilot shortage). |
| **Dry lease** | Aircraft only (usually 5–10 years, ≈80% of deals >5 years [S6]). | Everything else: crew, maintenance, insurance, registration on the lessee's AOC. | Lessee's AOC. Monthly rent plus maintenance reserves. |
| **Full charter (ad hoc)** | Everything: aircraft, crew, maintenance, insurance **plus fuel, airport/nav fees, handling, catering, crew hotels, positioning**. | A **price per flight** (or per rotation). Sometimes there is a fuel-escalation clause. | Operator's AOC and flight number. Customer (government, tour operator, sports club, broker) fills the seats. |
| **Series charter** | Full charter repeated (e.g. weekly LIS–Cancún for a tour operator, May–Oct). | Price per rotation, or per seat via the tour operator. | Operator carries the aircraft cost. Tour operator carries seat risk. |
| **Sub-charter / sub-service** | Operator A holds the contract and Operator B flies it (A's AOG, A lacks capacity, or A brokers it for margin). | Customer still pays A. A pays B. | Usually needs customer consent in the contract. Under EU 261 the *operating* carrier owes pax compensation, so contracts push this back via indemnities [S9]. |

**Cost split, from a real ACMI contract (SmartLynx Malta → Global Crossing, A320, 2020)** [S1]. Lessee pays fuel, hydraulic fluids, de-icing, landing/airport charges, nav/overflight, handling, crew catering, 4-star single hotel rooms, crew positioning "if directly related to the flight programme", and customs overtime. Per diem is **included in the rent at USD 50/person/day**. Lessor provides up to **5 crew sets per aircraft** at its own cost. Delivery/redelivery ferry costs are split 50/50. Re-invoiced direct operating costs carry a **1% service fee**, due in 2 days.
**Second real contract (Global Crossing → Estelar, A320/A321, 2021)** [S2]. The rate excludes all ground handling, landing fees, taxes, fuel and catering. The customer supplies fuel and catering through its own vendors and provides 4-star single rooms with meals and transport. Per diem is a separate **USD 2.55 per crew member per hour**, billed monthly in arrears.

> Rule of thumb for the game: **ACMI = the lessor carries aircraft, people, technical and insurance cost; the customer carries everything that scales with the route (fuel, fees, hotels) plus all commercial risk.** In a full charter the operator carries the lot and prices it in.

### What the ACMI hourly rate has to cover (illustrative build-up, est.)
For an A320ceo flying 250 BH/month at €3,750/BH (≈ €940k/month revenue):
- Aircraft lease (mid-life) ≈ $230–250k/month [S12] → ~€900–1,000/BH
- Maintenance reserves + line maintenance + spares ≈ €500–800/BH (est.)
- Cockpit crew (5 sets × 2 pilots) + cabin crew (5 × 4) incl. training and per diems ≈ €800–1,100/BH (est.)
- Insurance ≈ €100–250/BH. Global Crossing spent $6.2M on insurance over 28,820 BH in 2024, ≈ $215/BH [S14].
- Overhead (OCC, CAMO, safety, sales, IOSA, AOC fees) ≈ €300–500/BH (est.)
- **Margin left ≈ 5–15% in a good season and negative if the aircraft sits idle** (see §6).

Global Crossing FY2024 cost ratios (A320 family, US) [S14]: aircraft rent ≈ $2,000/BH, salaries ≈ $2,350/BH, maintenance ≈ $460/BH, insurance ≈ $215/BH.

---

## 2. Pricing

### 2.1 ACMI block-hour rates (customer pays per block hour, chocks-off to chocks-on)
**Hard data points**
| Date | Aircraft | Rate | Terms | Source |
|---|---|---|---|---|
| 2020 (COVID trough) | A320, 180Y, SmartLynx → GlobalX | **USD 2,500/BH**, +3%/yr | MGH 200 BH/month and 1,000 BH per Dec–Apr term, 8 winter seasons to 2028 | [S1] |
| 2021 | A320 / A321 (US Part 121), GlobalX → Estelar | **USD 3,500 / 3,850 per BH** | MGH 120 BH/month for 90 days, then 160 | [S2] |
| 2024–25 | A320 180Y, Apr 2024–Mar 2025 offer | **EUR 3,750/BH** incl. per diems | 12 months | [S16] |
| ~2022 | A330 (1999 build) listing | **USD 5,800/BH** | inclusions unclear | [S7] |
| undated | 737-800 / A320 | USD 4,000–6,000/h | broker-style range | [S7] |
| undated | A330 / 777-300ER | USD 8,000–10,000/h | broker-style range | [S7] |
| undated | E175 | USD 2,500–3,500/h | | [S7] |
| general | all ACMI | ≈ €2,500 (E-Jet) to ≈ €10,000 (widebody) | | [S6] |

**Trend.** Rates rose steadily through 2023–2024, driven by lease, maintenance and crew inflation and by OEM delivery delays. 2024 was a record year: >1 million BH all segments [S5], or >920k passenger BH per ACC Aviation [S17]. 2025 swung: overcapacity in Q1 as airlines delayed summer decisions, a Q2 "reset" with more pricing flexibility and shorter contracts, rates up in July, tapering by Q4. Volume was still +14% YoY to date [S5]. **Q2 2026 crashed for narrowbodies**: global BH −18.9% YoY, narrowbody −34%, A321 −58%, MAX 8 −81%, Europe −25.8%. **Widebody rose +20.2%** (777-200ER +35%, A330-300 +17%, 787-9 +452% from a small base, 777-300ER −34%) [S4]. Cause: Middle East instability, softer bookings, cost pressure [S4].

**Game-ready rate bands (USD per BH, 2024–26 normal market; est. unless shown above)**
| Type | Seats (typ. ACMI config) | ACMI USD/BH |
|---|---|---|
| E190/E195 | 100–120 | 2,500–3,500 |
| A319 / 737-700 | 140–150 | 3,000–3,800 |
| A320ceo / 737-800 | 180–189 | 3,200–4,500 |
| A320neo / 737 MAX 8 | 180–189 | 3,800–5,000 |
| A321ceo | 200–220 | 3,800–4,800 |
| A321neo | 220–240 | 4,500–5,500 |
| 757-200 | 200–235 | 4,500–6,000 |
| 767-300ER | 260–310 | 5,500–7,500 |
| A330-200 / -300 | 270–440 | 6,500–9,000 |
| A340-300 | 270–300 | 5,500–7,500 (cheap to rent but burns fuel, so customers resist) |
| 777-200ER | 290–400 | 8,000–10,500 |
| 777-300ER | 350–450 | 9,000–12,000 |
| 787-9 | 290–330 | 10,000–13,000 |
| A350-900 | 300–350 | 11,000–14,000 |
| 747-400 (pax) | 400–500 | 10,000–14,000 (passenger 747 ACMI is essentially extinct: Air Atlanta retired its last in Oct 2024 [S21]) |
| A380 | 470–600+ | 18,000–25,000 (Hi Fly's ex-SIA aircraft, 471 seats [S19]) |

Modifiers: peak summer +10–25%. Short-notice (<7 days) +15–40%. Winter or off-peak −10–20%. Older or "unloved" types −10–20%. **Long-term (multi-year) −5–15%** in exchange for security (est.).

### 2.2 Minimum guaranteed hours (MGH) and related mechanics
- The lessee pays the MGH **whether the aircraft flies or not** [S3]. Real examples: 120→160 BH/month [S2], 200 BH/month plus 1,000 BH per season [S1], a 7-month tour-operator deal of ≥1,800 BH (≈257/month) [S14], a cargo deal of 200 BH/month per aircraft [S14].
- **Shifting**: up to 35% of a month's MGH movable between months if the season total is met [S1].
- **Excess hours** are billed at the same rate or a slightly lower "excess hourly rate" [S3]. Some contracts require extra hours to be prepaid [S1].
- **Cycle protection** (short sectors wear the aircraft more per hour):
  - Rate is based on an average **3:1 BH-to-cycle ratio**, with a surcharge if the monthly ratio falls below 2.7 [S1].
  - Alternatively, a **USD 900 per cycle** fee on sectors under 1.5 BH [S2].
- **Positioning / de-positioning**: billed at the ACMI rate from the lessor's base until return to base ("ACMI time runs from first move from MIA until final stop at MIA") [S2]. The lessee usually also pays the ferry fuel. Example (est.): Lisbon→Jakarta A330 ferry ≈ 14 BH × $8k = $112k plus ≈ 80 t of fuel.
- **Extra crew and add-ons** [S1]: extra cabin crew USD 75/person/BH. Flying spanner (travelling engineer) USD 65/BH plus USD 70/day. Cabin-crew trainer USD 200/day. Extra cockpit sets at cost.
- **Late-notice changes**: the customer can cancel or re-route single flights with ≥12 h notice, but the minimum still applies [S2].

### 2.3 Deposits, payment terms, cancellation
- **Deposits**:
  - ≈ 1 month of MGH rent is common [S7].
  - SmartLynx asked $250k per A320 for a winter season (≈ half a month), in tranches of $100k (31 Jul) + $100k (30 Sep) + $50k (1 Nov), with the first $50k non-refundable [S1].
  - GlobalX asked for a security deposit equal to **7 days of flying** [S2].
- **Payment**:
  - **Weekly in advance** (due 15:00Z seven days before the week's first flight), reconciled within 30 days [S2], or monthly in advance.
  - Late interest of 3%/yr [S1]. USD, net of bank fees.
  - The lessor's leverage: it simply stops flying if it is not paid.
- **Cancellation / early termination of ACMI**: the customer pays **100% of unflown MGH for the rest of the term**, offset by the deposit [S1][S2]. A cancellation within 3 days of signing costs the deposit [S2].
- **Ad hoc charter cancellation scales** (pattern from charter T&Cs [S18]; airliner-charter values est.):

  | Notice | Penalty |
  |---|---|
  | >60 days | 10–25% |
  | 30–60 days | 25–50% |
  | 14–30 days | 50–75% |
  | <7–14 days | 100% |

  Typical payment: deposit 20–50% at booking, **balance before departure (often 7–14 days before; 100% upfront for new or government-unknown clients)**.

### 2.4 Full-charter pricing logic
Price per flight ≈ (ACMI-equivalent hours incl. **positioning and empty legs**) × rate + fuel + landing/nav/handling + catering + crew hotels/per diems + permits + war-risk premium + broker commission + margin.
- **All-in charter rates seen**:
  - A320 ≈ USD 15–28k per flight hour (broker marketing, VIP-ish) [S20].
  - A US college 757 charter: $101k for 5.75 h excluding fuel ≈ $17.6k/h [S20].
  - US ICE 2019: **Omni 777 USD 33,500/h** vs a **767 at USD 17,214.80/h**. One Bangladesh/India/Vietnam removal trip cost $1.8M [S22].
- **Rule of thumb (est.)**: all-in charter ≈ 2–3.5× the ACMI rate per BH. One-way jobs that strand the aircraft far from base price at the top (the empty return leg is billed).
- **Per seat**: a tour operator divides the rotation price by seats and needs ~85–95% load factor. Government evacuation seats are recharged to evacuees at **£300 (UK, Cyprus 2023)** and **≤ $283 (US, Lebanon 2024)** [S23]. Governments eat the empties: Australia's Beirut–Larnaca flights went out with 292 of 660 seats filled [S23].
- **Urgency/risk premiums (est.)**: <72 h notice +20–50%. Conflict zone +30–100% plus war-risk insurance. VIP +20–50%. Deportation "reputation premium" +20–40% (few operators will do it, so Omni's quasi-monopoly let it double the 767 price [S22]).

### 2.5 Insurance and war risk
- Hull/liability policies exclude war by default (**AVN 48B**). Cover is bought back via endorsements, **AVN 52** for third-party/passenger war liability. Insurers can **cancel or re-price on 7 days' notice** when a conflict flares; usually they raise the premium rather than cancel [S24].
- Real consequence: a UK evacuation flight from Israel (Oct 2023) was **cancelled because Titan Airways could not arrange insurance** [S23]. War-risk aviation insurers issued 7-day notices on Israel/Lebanon cover [S24].
- Game: the war-risk premium is a per-flight or per-day cost that spikes with a region's "threat level". With some probability, cover becomes unavailable and the flight cannot legally operate.

### 2.6 Margins
- **Avia Solutions Group** (the world's largest ACMI group), 9M 2024: revenue €2.06bn, EBITDA €406M (**≈20% EBITDA**), net profit €83.3M (**≈4% net**), **221 aircraft (183 pax / 38 freighters), 11 AOCs** [S25].
- **Global Crossing (GlobalX)** FY2024 [S14]:
  - Revenue $223.8M (ACMI $123.1M, +204%; charter $95.5M), 28,820 BH → **≈ $7,770 revenue per BH blended** (charter includes fuel).
  - **Operating margin −0.5% for the year, +5.6% in Q4**. EBITDAR 28%.
  - Utilisation **1,862 BH per aircraft per year (~155/month)**, A320 family, 19 aircraft.
- Game takeaway: **EBITDA is fat but net margin is thin (0–6%)**. Rent and crew are fixed while revenue is seasonal, so one idle month or one AOG wipes out a quarter's profit.

---

## 3. Contract shapes and seasonality

### 3.1 Commercial airline ACMI
| Shape | Typical aircraft | Duration | Lead time | Price vs base | Notes |
|---|---|---|---|---|---|
| **European summer ACMI** (IATA summer season: last Sunday of March to last Saturday of October; peak June–September) | A320/A321/737-800; some A330/767 for long-haul leisure | 3–7 months (often May–October) | Signed in winter (Oct–Mar). 2025–26 trend: customers booking later [S5] | Base; peak weeks +10–25% (est.) | ~60% of ACMI deals are under 6 months (Cirium 2023 survey) [S6]. MGH 150–300 BH/month narrowbody (est.) |
| **Winter deployment** | Same aircraft, sent south/east | 3–6 months (Nov–Apr) | 2–6 months | −10–20% (est.) | Southern hemisphere (Brazil, Argentina, Australia), Caribbean/US winter sun (SmartLynx A320s based at Miami Dec–Apr [S1]), Asia, Africa (Royal Air Maroc, Tunisair, Air Algérie growing [S5]). Avion Express set up Brasil/Philippines AOCs for this. |
| **AOG / disruption cover** | Whatever is free nearby | **Days to weeks** (e.g. a 5-day bird-strike cover [S9]) | Hours to days; deployment ≈ 7–14 days for planned cover [S6] | +15–40% (est.) | Availability is everything. Positioning is billed. |
| **Long-term ACMI** | A320/A321; A330/767/777 for long-haul | 1–5 years (multi-season) | 3–9 months | −5–15% (est.) | EuroAtlantic's 2026 strategy is to move to "multi-season or multi-year" deals [S11]. Wamos flew for Etihad from Rome through 2025 [S26]. |
| **Delivery-delay cover** | Narrowbody/widebody | 6–24 months | months | base | Driven by OEM delays and engine groundings (GTF), with heavy-check turnarounds still ~2× pre-pandemic [S5]. |

### 3.2 Government, military and humanitarian
| Contract | Typical aircraft | Duration | Lead time | Premium (est.) | Special requirements and risks |
|---|---|---|---|---|---|
| **UN peacekeeping troop rotations** [S27] | Widebody 200–275 pax **all-economy**, 100 kg baggage per pax; narrowbody 50–120 pax for short/poor runways | **Up to 5 years**. Dedicated aircraft **2,000–2,200 FH/yr**; non-dedicated ≥300 FH/yr | Tender (UNGM EOI → RFP, months). Standby tasking ≥15 days' notice | Priced as **all-inclusive cost per flight hour + fuel reimbursed, capped at the declared burn rate** | Must own **≥3 aircraft of the type**. Backup aircraft required. Up to 72 h layovers away from base. Satellite flight-following (OOOI). RVSM. Ageing-aircraft programme for >20 yrs. **No worldwide operating restrictions.** Split awards and partnering with other operators allowed. ~50–55k pax movements a year. One-off rotation contracts have not-to-exceed values of ~$0.3–0.6M (2016–17). |
| **National military / NATO troop and VIP lift** | A321 (Hi Fly's A321 leased to the Belgian Army, 2014 [S19]), 767/777/A330 | Weeks to years | Tender | +10–30% | Security-cleared crew and nationality rules, weapons/ammunition (dangerous goods), diplomatic clearances, operations into austere or threat airfields. |
| **US CRAF-style program** [S28] | 767/777/A330 pax, 747F | Annual peacetime contracts; activation in war | Activation within 24–48 h | Rates set **per passenger or per ton-mile** by USTRANSCOM | Commit **≥40% of the CRAF-capable passenger fleet** and keep a **4:1 cockpit-crew ratio** per aircraft. The reward is guaranteed peacetime DoD business ($418M guaranteed in 2005). Omni, National, Atlas, etc. Activation (Stage I: 1991, 2003, Afghanistan 2021) pulls the aircraft off civil work at short notice. |
| **Deportation / return flights** | 767/A321/A320/737/777 | Single flights; framework contracts of years | Days to weeks. Courts can cancel at the last minute (the UK Rwanda flight was halted by the ECHR in June 2022, costing ~£500k [S29]) | +20–100% (few willing operators; the ICE 777 was ~2× the 767 price [S22]) | Escorts and medics on board, segregated seating, restraint protocols, overflight/landing permits. **Reputational risk**: Privilege Style quit UK Rwanda flights after a campaign. Titan and AirTanker ruled themselves out [S29]. The US market runs through broker CSI Aviation (>$1bn of ICE contracts). **GlobalX flew 74% of ICE removal flights** in a year [S22]. Frontex assisted ~56k returns in 2024 (26,794 in H1 + 29,469 in H2) [S30]. |
| **Evacuation / repatriation (war, disaster)** | Anything available, A320–777 | 1–10 days | **24 h**. UK Sudan 2023: 28 flights, 2,341 people, about 6 days, "organised with 24 hours notice" (Titan) [S23] | +30–100% | War-risk insurance availability, crew volunteers, airspace closures, tight slot windows at shuttle airports (Larnaca, Port Sudan). Governments pay for the whole aircraft and recharge seats (~£300/$283). ACS ran 30 evacuation charters plus 20 cargo flights for Lebanon in 2024 [S31]. |
| **Refugee / resettlement / humanitarian (IOM, UNHCR, WFP)** | A320–777; freighters for aid | Single flights to multi-month programmes | Days to weeks | +10–40% | Aid cargo in the hold, NGO passengers, austere airports (N'Djamena, Port Sudan, Haiti) [S31]. Medical teams on board. |
| **Hajj pilgrim wet-leases** | **High-density widebodies**: A330, 747-400, 777, A340, even A380 | **~8–10 weeks** (Garuda 2024: ops from 12 May; Hajj 14–19 June; leases to early July [S32]) | Contracts 3–6 months ahead | +10–25% (est.; peak global widebody demand) | Saudia 2022 used 14 Hajj aircraft incl. 2 SmartLynx A330-300s and 3 Air Atlanta 747-400s. flynas wet-leased 13 widebodies incl. 3 A380s [S33]. Garuda 2024 wet-leased 7 (A330 ×3, A340, 747 ×2, 777) [S32]. **Hajj moves ~11 days earlier each year** (lunar calendar): ≈ late May 2026, mid-May 2027 (est.). Flights run one way full, one way empty. Water (Zamzam) in the hold. |
| **Umrah / Ramadan peak** | Narrow and widebody | Weeks | months | +5–15% (est.) | Also lunar, ~11 days earlier each year. |

### 3.3 VIP, sports, music, medical
| Contract | Aircraft | Duration | Lead time | Premium (est.) | Notes |
|---|---|---|---|---|---|
| **Presidential / state visit** | A320/A321 (ideally a premium cabin), A330/777 for long haul | 2–10 days | Days to weeks | +20–50% | Security vetting, protocol catering, diplomatic clearances, discretion/NDAs, backup aircraft on standby. Hi Fly lists governments among its clients [S19]. |
| **Sports teams** | A320/A321/757; A330 long-haul [S20] | Single trips or season packages | Weeks. Knock-out fixtures give ~3–7 days' notice | +10–30% | Business-class seating preferred. GlobalX: college basketball tournament with 4 dedicated aircraft, min $5M [S14]. |
| **Music tours** | 757/A321, sometimes 767 | 1–6 months | months | +20–40% | GlobalX flew a band's North American tour in 2024 [S14]. Equipment needs cargo space. |
| **Medical / vaccine / pandemic repatriation** | A330/777 (incl. cabin-loaded cargo, "preighters"), narrowbodies | Weeks to months | Days | +20–60% | PPE, crew willingness, quarantine rules on arrival for crews. |

### 3.4 Tour-operator series charter
- TUI expanded its GlobalX deal to a 3rd dedicated aircraft, **min $5M revenue for summer 2025** (≈ $0.8M/month) [S14]. A South American tour operator signed 7 months with ≥1,800 BH guaranteed [S14].
- The tour operator carries the seat risk. The operator carries fuel risk unless there is a fuel-escalation clause. These are typically signed **9–12 months ahead** (est.).

---

## 4. How work is won

- **Availability wins.** Many ACMI deals are short (≈60% under 6 months [S6]). In AOG cover, whoever has a crewed aircraft within flying distance gets the job.
- **Brokers / intermediaries**:
  - **Air Charter Service** (35,000+ flights/yr, 40+ offices; it has a government & humanitarian director [S9][S31]).
  - **Chapman Freeborn** (owned by Avia Solutions Group).
  - **ACC Aviation** (ACMI leasing specialist that publishes market data with ch-aviation [S5]).
  - Air Partner, Hunt & Palmer, CSI Aviation (US government charters).
  - Commission ≈ **3–10% of contract value** (est.). Brokers own the customer relationship, and a failure on your side burns your reputation with the broker.
- **Tenders/RFPs**: UNGM (UN), EU TED (Frontex: 2024 framework for scheduled-flight returns ≈ €200M, scored **70% quality / 30% price** [S30]), USTRANSCOM/AMC, national MoDs. These need registration, fleet depth (the UN asks for ≥3 of the type), safety audits and financial standing.
- **Certifications that open markets**:
  - **IOSA** (Airhub got it in 2022 [S34]).
  - **EASA TCO** for non-EU operators.
  - A **US FAA Foreign Air Carrier Permit** (Airhub secured one to fly for US customers [S34]).
  - A second AOC in Malta (Airhub, SmartLynx Malta, Hi Fly Malta, Avion Express Malta) gives flexible crewing, 9H registry, and easier wet-lease approvals worldwide.
- **EU wet-lease rules** (Reg. 1008/2008 Art. 13):
  - Wet-leasing **from a third-country operator** needs prior approval and is only allowed for exceptional needs (up to 7 months, renewable once, from memory; verify), seasonal capacity needs, or operational difficulties, and only with equivalent safety standards [S10].
  - Intra-EU wet leasing needs only notification (the UK CAA asks for 30 minutes' notice for EASA lessors [S10]).
  - This **protects EU ACMI operators from cheaper non-EU competition**, which is a reason to hold an EU AOC.
- **Reputation drivers**: dispatch reliability, OTP, crew quality and appearance, cabin condition (an old 767 cabin vs a refreshed A330), customer complaints, and incidents. (Hi Fly lost a long-term Saudia lease in 2015 after an A330 in Saudia livery was photographed in Israel [S19].)
- **Sub-chartering in practice**:
  - (a) **Cover your own AOG** by renting another ACMI provider's aircraft. You pay its rate, the customer pays yours, often at a loss, but you avoid the penalty and keep the reputation. GlobalX reports "sub-service" hours in its block hours [S14].
  - (b) **Broker-style arbitrage**: win a job you can't fly and hand it to a partner for a 5–15% spread (est.). The UN explicitly lets bidders partner with other operators [S27].
  - (c) Avia Solutions runs an "**ACMI Sub Charter**" product with standard T&Cs (Ascend) [S35].
  - Risk: the partner's failure is your failure.

---

## 5. Market structure: who's who

| Operator | Country/AOCs | Fleet (latest found) | Notes |
|---|---|---|---|
| **Avia Solutions Group** (Avion Express, Avion Express Malta/Brasil/Philippines, KlasJet, Heston, AirExplore, Ascend Airways, BBN Airlines (Indonesia, Türkiye, Thailand), Chapman Freeborn, …) | LT/MT/BR/PH/TR/TH etc., 11+ AOCs | **221 aircraft, 183 passenger (9M 2024)** [S25]; ordered 40 737 MAX 8 + 40 options (Nov 2024) [S36] | World's largest ACMI group. Avion Express had the most block hours in 2024–25 but fell −57% (Malta) in Q2 2026 [S4]. |
| **SmartLynx** | LV + Malta + Estonia | 57 aircraft (Feb 2025) incl. A320/A321/A321P2F/A330F/737 MAX [S37] | Sold by ASG to a Dutch fund in Oct 2025, then **ceased operations "effective immediately" on 24 Nov 2025** (financial difficulty) [S37]. A cautionary tale. |
| **Getjet Airlines** (Vilnius) | LT | ~5 A320, 1 A321, 5 737-800 (date uncertain); 3 A320s wet-leased to AZAL one winter [S34] | Founded Airhub in Malta in 2019. |
| **Airhub Airlines** | MT (Getjet's sister) | AOC July 2020. Has flown A320, A330-200/-300/-900, A340-300. **Down to 1 A320 by July 2026** [S34] | Shows how quickly an ACMI fleet expands and contracts. |
| **Hi Fly** (Lisbon/Beja) + **Hi Fly Malta** | PT, MT | Peak ~20 (2019: 4 A320 family, 15 A330/A340, 1 A380). By 2025: 1 A330-200 (PT) + A340-300s (MT) [S19] | Ex-SIA A380 (471 seats). First A340 landing on Antarctic blue ice (Wolf's Fang, 2021). A380 GLA–JFK for Global Airlines in May 2025. Clients: BA, Turkish, governments, sports teams [S19]. |
| **euroAtlantic Airways** (Lisbon) | PT | **8 aircraft, average age 20.4 yrs**: 3 767-300ER (one 309Y high-density; two 16J/251Y), 2 777-200ER (30J/24W/239Y), 1 A330-200 (+2 A330s inducting) [S11] | Founded 1993 as Air Zarco. Njord Partners majority owner since 2024. CEO Pauls Calitis (ex-airBaltic) since May 2026. Target ~12 mid-life aircraft in 3 years, A330s replacing 767s, maybe 777-300s. History: 777s for Biman (2009), 767s for Air Canada (2014) [S11][S38]. |
| **Wamos Air** (Madrid) | ES | ~10 (A330s; earlier 747-400s) [S26] | Dropped scheduled flying in 2022 to focus on charter/ACMI. Abra Group bought it in Oct 2024. Flew for Etihad from Rome in 2025. |
| **Privilege Style** (Palma) | ES | Small: 777-200ER / 767-300ER (est.) | VIP/sports/government. Left the UK Rwanda deportation scheme in 2022 under activist pressure [S29]. |
| **Titan Airways** (London Stansted) | UK | Small: A321/A321P2F/A330 (est.) | UK government, evacuations (Sudan 2023 [S23]), VIP, sports. |
| **Air Atlanta Icelandic** (+ Air Atlanta Europe) | IS/MT | Now cargo-focused 747F. **Last passenger 747 retired Oct 2024** [S21] | Hajj since 1988. 747s for Saudia [S21]. |
| **Heston, KlasJet, European Air Charter, Bulgaria Air, BBN Türkiye, Smartwings, airBaltic** | various | — | All appear in Q2 2026 ACMI rankings. **airBaltic was No. 1 by block hours in Q2 2026** (A220 ACMI) [S4]. |
| **Omni Air International** (Tulsa) | US | ~14 (777-200ER, 767-300ER/-200ER) [S39] | CRAF/DoD core business, ICE high-risk removals [S22]. |
| **National Airlines, World Atlantic, Eastern Airlines, Sun Country, Atlas** | US | — | CRAF/charter/ICE. Eastern's 777-200 was wet-leased to Garuda for Hajj 2024 [S32]. |
| **Global Crossing (GlobalX)** (Miami) | US | 19 A320 family (2024) [S14] | ACMI + charter + ICE (74% of removal flights in a year [S22]). Near-zero operating margin. |

**Market size**: ~1 million BH in 2024 (record) [S5]. Europe ≈ 50–54% of hours [S4][S5]. Narrowbodies dominate (A320ceo first, then 737-800). The A330-200/-300 is the top widebody [S5].
**How a small operator grows (pattern)**: 1–3 mid-life narrowbodies on one AOC → add a Malta AOC → add 1–2 mid-life widebodies for Hajj and long-haul ACMI → win a multi-year anchor contract → raise private-equity money (Njord into euroAtlantic, Abra into Wamos) or join a group (SmartLynx into ASG). **Failure mode**: growing fleet and fixed cost into a peak, then a downturn (Q2 2026 narrowbody −34%) leaves aircraft without MGH. Examples: SmartLynx, Airhub, Hi Fly.

---

## 6. Getting aircraft: acquisition for ACMI operators

- **Mid-life operating leases dominate.** ACMI rates can't carry new-aircraft rents at seasonal utilisation. euroAtlantic explicitly targets "midlife aircraft rather than new-builds" [S11]. Its fleet averages 20.4 years.
- **Monthly lease rates, IBA September 2024** [S12]:

  | Aircraft | Monthly rent (USD) | Value (USD) |
  |---|---|---|
  | Mid-life A320ceo / 737-800 | 230–250k | — |
  | New A320neo / MAX 8 | ~400k | ~55M |
  | New A321neo | ~460k | ~64M |
  | 12-yr A330-300 | ~330k | — |
  | 12-yr 777-300ER | ~450k | — |
  | New 787-9 | ~1.05M | — |
  | New A350-900 | ~1.14M | — |

  Estimates for older types (est.):

  | Aircraft | Monthly rent (USD) |
  |---|---|
  | 20+-yr 767-300ER | 120–220k |
  | 20-yr 777-200ER | 200–300k |
  | A340-300 | 80–150k (near scrap value) |
  | 20-yr A330-200 | 150–250k |
  | Ex-SIA A380 | 300–600k (thin market) |

  Maintenance reserves on top ≈ $300–900/FH depending on type (est.).
- **Scarcity 2023–2026**:
  - Airbus/Boeing delivery delays, GTF engine groundings and 777X slipping 6+ years lead airlines to **extend leases and keep old jets**, which lifts mid-life lease rates [S5][S12].
  - Engine and heavy-check turnaround is still ~2× pre-pandemic, with little improvement before 2027 [S5].
  - New widebody slots are booked into the 2030s [S13]. Few "good airworthy" mid-life widebodies are available [S12].
- **Lead times** [S6] (est. for the induction steps):
  - ACMI deployment of an existing fleet aircraft: 7–14 days.
  - Dry lease-in to your AOC: 1–3 months, or 2–6 months if a cabin refit, re-registration, AOC variation and crew type-rating are needed.
  - New order: 6–12 months at best, realistically years.
- **Purchase prices (est.)**: old 767-300ER/A330-200/A340-300 at $5–15M, 777-200ER at $10–20M. That is cheap capex, but engine shop visits ($5–15M per widebody engine, est.) and C-checks dominate. Buying lets you charge a low ACMI rate. Hi Fly bought new A330/A340-500s in 2008–09, and euroAtlantic bought its 777-200ERs outright [S38].
- **New aircraft are rare in ACMI** because the business needs flexible, cheap capacity. Exceptions: Hi Fly's A330neo (leased from ALC, 2019), ASG's 737 MAX order, and airBaltic's A220s placed in ACMI.
- **Counterparty risk**: Hi Fly's A340-500s flew for Arik Air (Nigeria) until Hi Fly **repossessed them in 2015** [S19]. Deposits and prepayment exist for a reason.

---

## 7. GAME PARAMETERS (suggested defaults; tune for fun)

| Parameter | Suggested value / range | Basis |
|---|---|---|
| ACMI rate A320/737-800 | $3,200–4,500/BH (base $3,800) | [S1][S2][S16][S7] |
| ACMI rate A321 | $3,800–4,800/BH | [S2] + est. |
| ACMI rate 767-300ER | $5,500–7,500/BH | est. |
| ACMI rate A330 | $6,500–9,000/BH | [S7] |
| ACMI rate 777-200ER / -300ER | $8,000–10,500 / $9,000–12,000 | [S7] + est. |
| ACMI rate 787-9 / A350 | $10,000–14,000 | est. |
| ACMI rate A380 | $18,000–25,000 | est. |
| Full-charter all-in multiplier | 2.0–3.5× ACMI rate per BH (incl. fuel, fees, positioning) | [S20][S22] |
| MGH narrowbody | 120–300 BH/month (typical 180–220) | [S1][S2][S14] |
| MGH widebody | 200–450 BH/month (UN dedicated ≈ 170–185) | [S27] + est. |
| Realistic utilisation | 1,800–2,200 BH/aircraft/year (150–185/month); peak months 300+ | [S14][S27] |
| Excess-hour rate | 90–100% of base | [S1][S3] |
| Short-cycle penalty | $900 per cycle if sector <1.5 BH, or surcharge if BH:cycle <2.7 | [S1][S2] |
| Positioning | Billed at ACMI rate + customer pays ferry fuel; or split 50/50 on long-term | [S1][S2] |
| Extra cabin crew | $75/person/BH | [S1] |
| Per diem | $50/person/day included in rate, or $2.55/crew/hour billed | [S1][S2] |
| Crew sets per aircraft | 5 narrowbody (cockpit + cabin). Military-style 4:1 cockpit-crew ratio | [S1][S28] |
| Deposit | 7 days of schedule to 1 month of MGH; seasonal tranche deposits | [S1][S2][S7] |
| Payment | Weekly in advance (normal customers); monthly in arrears for AAA governments (est.) | [S2] |
| ACMI early termination | 100% of remaining MGH | [S1][S2] |
| Charter cancellation | >60 d: 10–25%; 30–60 d: 25–50%; 14–30 d: 50–75%; <14 d: 100% | [S18] + est. |
| Summer ACMI contract | 3–7 months, offered Oct–Mar, flown Apr/May–Oct | [S6] + est. |
| Winter deployment | 3–6 months, −10–20% rate | est. |
| AOG cover | 2–30 days, offer expires in hours, +15–40% | [S9] + est. |
| Long-term ACMI | 1–5 years, −5–15% rate, MGH ≥200 | [S11][S27] |
| Hajj wet lease | 8–10 weeks, widebody high-density, +10–25%; date shifts −11 days/year | [S32][S33] |
| UN troop rotation | Up to 5 yrs, all-economy widebody 200–275 seats, 2,000–2,200 FH/yr, ≥3 of type, backup aircraft | [S27] |
| Evacuation | 1–10 days, 24 h notice, +30–100%, chance of war-risk cover refusal | [S23][S24] |
| Deportation | Single/series, +20–100%, reputation −, crew-morale −, chance of court cancellation | [S22][S29] |
| VIP/state | 2–10 days, +20–50%, needs premium cabin, reliability bonus | est. |
| Sports/music tour | Trips to 6 months, +10–40%, needs business seats + cargo | [S14] + est. |
| War-risk insurance | Per-flight premium spike; 7-day cancellation notice; 5–20% chance "uninsurable" in hot zones | [S24] + est. |
| Broker commission | 3–10% | est. |
| Sub-charter spread | 5–15% margin; AOG self-cover often at a loss | [S14][S27] + est. |
| Operator margins | EBITDA ~20%; net 0–6%; idle aircraft = heavy loss | [S14][S25] |
| Lease rent, mid-life A320 | $230–250k/month | [S12] |
| Lease rent, 12-yr A330-300 / 777-300ER | $330k / $450k per month | [S12] |
| Lease rent, new A320neo / A321neo | $400k / $460k per month | [S12] |
| Lease rent, new 787-9 / A350-900 | $1.05M / $1.14M per month | [S12] |
| Lease rent, old 767 / A340 | $120–220k / $80–150k (est.) | est. |
| Time to induct leased aircraft | 1–3 months (2–6 with refit/new type) | [S6] + est. |
| Market cycle | Boom 2023–24 (rates up); volatile 2025; narrowbody bust 2026 (−34%) while widebody +20% | [S4][S5] |

---

## 8. Interesting player decisions this suggests

1. **MGH vs freedom**: lock an aircraft into a 5-year UN or long-term ACMI deal at −10%, or keep it free for 2× urgent evacuations, VIP trips and Hajj?
2. **Quote the price** for a broker RFQ: undercut to win while rates soften (2025 Q2 reset), or hold the line and risk an idle aircraft?
3. **Take the deportation contract?** It pays well and steadily, but costs reputation with activists, crew morale and some airline customers, and a court can cancel it at the last minute.
4. **Fly into the war zone?** A huge evacuation premium, against a war-risk insurance spike or refusal, crew volunteers, hull risk and airspace closures.
5. **Sub-charter a job you can't fly** to a rival for a spread, knowing their delay becomes your reputation hit.
6. **Your aircraft goes AOG mid-contract**: rent a rival's aircraft at a loss, pay the penalty, or ask the customer to accept a delay?
7. **Buy a 20-year-old 767/A340 cheap or lease a mid-life A330**: low rate and low reliability with an engine-shop-visit cliff, against higher rent and a better cabin.
8. **New aircraft?** Best reliability and fuel burn (customers pay fuel, so efficient types win tenders), but $1M+/month rent kills you in a slow month.
9. **Fleet commonality vs flexibility**: an A320-only fleet keeps crewing and spares simple. Adding a widebody unlocks Hajj, UN and long-haul ACMI but requires a new crew pool and type ratings.
10. **Cabin configuration**: 309-seat all-economy (Hajj, troops, UN requires all-economy) vs 2-class (airline ACMI, sports) vs VIP. Reconfiguration costs time and money.
11. **Open a Malta (or other) second AOC**: easier crewing, registry and market access vs certification cost and oversight. Add IOSA, EASA TCO or a US FACP to unlock customers.
12. **Winter strategy**: send aircraft to Brazil, the Caribbean or Asia at a lower rate, park them for heavy checks, or chase Umrah/Hajj (dates move 11 days earlier every year).
13. **Join a CRAF-like government programme**: commit 40% of your fleet for guaranteed peacetime military work, accepting that activation can pull aircraft off profitable commercial deals with 24–48 h notice.
14. **Broker vs direct**: pay 3–10% commission for deal flow, or invest in a sales team to bid tenders (UNGM, Frontex, MoD) that demand fleet depth (≥3 of a type) and backups.
15. **Customer credit risk**: give a start-up airline monthly-in-arrears terms to win the deal, or insist on weekly prepayment and a deposit (and risk losing it)? Repossession scenario (Arik Air).
16. **Accept short-sector flying** (more cycles per BH): price in a cycle fee or a ratio surcharge, or eat the maintenance cost.
17. **Crew sets per aircraft**: 4 sets is cheap but leaves no slack for sickness or FTL limits; 6 sets is safe but costly. Use local or expat crew on long deployments (hotels and per diems vs base costs)?
18. **Growth pace**: add aircraft in the boom (2024) and risk a SmartLynx-style collapse in the bust (2026 narrowbody −34%), or grow "smart and controlled" like euroAtlantic's plan for 12 aircraft in 3 years?
19. **Engine shop visit timing**: run the engine through the summer peak or take it off-wing in winter, when turnarounds take ~2× pre-pandemic times?
20. **Accept a fuel-inclusive full charter** (higher revenue, fuel price risk) or only ACMI (lower revenue, no fuel risk)?
21. **Standby aircraft**: keep one aircraft and crew on standby as a backup (required for UN and VIP) and earn nothing on it, or sell every hour and hope nothing breaks?
22. **Reputation vs revenue**: refuse an embarrassing customer (e.g. one that is politically sensitive in a key airline client's market, like Hi Fly's Saudia/Israel incident).

---

## Sources (short)
- [S1] SmartLynx Malta–GlobalX A320 ACMI agreement (SEC exhibit, 2020): https://www.sec.gov/Archives/edgar/data/1846084/000119312521355341/d140617dex1011.htm
- [S2] GlobalX–Estelar ACMI passenger agreement (2021): https://lawinsider.com/contracts/ir4PziFvxKK
- [S3] Fly2Sky / Tradewind / Boeing glossary on MGH: https://fly2sky.aero/what-is-acmi/ ; https://tradewind.org/NG/Hangars_NG/TA_L_NG/Air_Lease_definition.html
- [S4] ACC Aviation Q2 2026 ACMI analysis (BlueSky News): https://www.blueskynews.aero/issue-850/ACC-Aviation-market-analysis-reveals-Q2-ACMI-downturn-but-continued-widebody-strength.html
- [S5] ACC Aviation 2025 market review (Runway Girl Network): https://runwaygirlnetwork.com/2025/11/acc-aviation-tracks-industry-performance/
- [S6] Marathon Airlines ACMI knowledge hub (Cirium survey, rate ranges, lead times): https://flymarathon.aero/acmi-leasing/
- [S7] Marathon comparison article / AviBroker listing / GlobalPlaneSearch: https://flymarathon.aero/acmi/how-does-acmi-leasing-compare-to-owning-or-dry-leasing-aircraft/ ; https://avibroker.com/leaseavailability.asp ; https://www.globalplanesearch.com/pages/So-Now-You-Have-Decided-to-Lease-an-Aircraft
- [S9] Air Charter Service guide to ACMI: https://aircharterservice.com/group-charter/guide-to-acmi
- [S10] UK CAA, wet and damp leasing; EC 1008/2008 Art. 13: https://www.caa.co.uk/Commercial-industry/Aircraft/Leasing/Wet-and-damp-leasing
- [S11] FlyMag, euroAtlantic shifts to long-term widebody ACMI (June 2026): https://flymag.com/euroatlantic-airways-shifts-toward-long-term-widebody-acmi-as-a330-fleet-grows/
- [S12] IBA aircraft values and lease rates, September 2024: https://www.iba.aero/resources/articles/aircraft-values-lease-rates-september-2024/
- [S13] Widebody shortage overview: https://www.eplaneai.com/news/is-the-world-facing-a-shortage-of-widebody-aircraft
- [S14] Global Crossing Airlines FY2024 results: https://stocktitan.net/news/JETMF/global-crossing-airlines-reports-record-fourth-quarter-revenue-8hj15pxyz8hq.html
- [S16] Flying Lease A320 ACMI offer: https://flyinglease.com/acmi-a320/
- [S17] ACC Aviation 2025 ACMI market insight: https://accaviation.com/2025-acmi-market-insight-and-the-evolving-role-of-intermediaries-in-acmi-leasing/
- [S18] Charter cancellation scale examples: https://tastingaustralia.com.au/media/rrrk1lia/platinum-aircraft-charter-terms-and-conditions.pdf ; https://royalair.com/term-conditions ; https://www.croatiaairlines.com/resources/documents/aircraft-charter-general-terms.pdf.pdf
- [S19] Hi Fly (Wikipedia): https://en.wikipedia.org/wiki/Hi_Fly_(airline)
- [S20] Charter hourly examples (Jettly, Mercury Jets, APSU bid): https://jettly.com/post/rent-airbus ; https://apsu.edu/procurement/vendors/bids/Analysis25020CharterFlightAthletic.pdf
- [S21] Air Atlanta ends passenger 747 (aeroTelegraph); Hajj history (FlightGlobal): https://www.aerotelegraph.com/tags/air-atlanta-icelandic ; https://flightglobal.com/hidden-lift/52134.article
- [S22] Quartz on Omni/ICE rates (2019); House Homeland Security letter to CSI Aviation (2025): https://qz.com/1761804/sole-airline-willing-to-deport-high-risk-immigrants-is-price-gouging-ice/ ; https://democrats-homeland.house.gov/imo/media/doc/2025-05-28-t-weh-letter_to_csi_aviation.pdf
- [S23] Evacuation fares/insurance: LBC (Israel 2023), PolitiFact (Lebanon 2024), Titan Sudan: https://www.lbc.co.uk/news/brits-israel-land-cyprus-raf-charter-flight/ ; https://www.politifact.com/factchecks/2024/oct/09/threads-posts/americans-in-lebanon-and-israel-had-to-pay-for-the ; https://www.titan-airways.com/news/titan-airways-supports-sudan-repatriation/
- [S24] War-risk mechanics (Leiden/McGill paper; Business Insurance): https://www.universiteitleiden.nl/binaries/content/assets/rechtsgeleerdheid/instituut-voor-publiekrecht/lucht--en-ruimterecht/mc-gill-workshop/paper-19.pdf ; https://www.businessinsurance.com/aviation-war-insurers-cancel-some-cover-for-israel-lebanon-marsh-el-al/
- [S25] Avia Solutions Group 9M 2024: https://www.stattimes.com/aviation/avia-solutions-group-revenue-up-25-to-2-billion-for-9m2024-1353835
- [S26] Wamos Air (Wikipedia; The Flight Club): https://en.wikipedia.org/wiki/Wamos_Air
- [S27] UN EOI UNPD24436, long-term troop rotation air transport (May 2026): https://www.ungm.org/Public/Notice/301476
- [S28] AMC CRAF fact sheet; 32 CFR 243: https://www.amc.af.mil/About-Us/Fact-Sheets/Display/Article/144025/civil-reserve-air-fleet.aspx ; https://www.law.cornell.edu/cfr/text/32/243.4
- [S29] Privilege Style / Rwanda flight (Right to Remain; Corporate Watch): https://righttoremain.org.uk/campaign-success-airline-pulls-out-of-rwanda-flight-plan/ ; https://www.corpwatch.org/article/charter-airline-privilege-style-withdraws-contract-deport-asylum-seekers-uk-rwanda-victory
- [S30] Frontex H2 2024 return evaluation (Statewatch) and tender: https://www.statewatch.org/media/5018/frontex-evaluation-report-deportations-2nd-semester-2024.pdf
- [S31] AJOT, air charter industry and humanitarian crises 2024 (ACS): https://www.ajot.com/news/air-charter-industry-steps-up-again-in-2024-responding-to-humanitarian-crises
- [S32] Garuda Hajj 2024 wet leases (Aviacionline): https://www.aviacionline.com/garuda-indonesia-expands-fleet-for-hajj-operations-with-new-wet-leased-aircraft
- [S33] Saudia Hajj charters 2022 (ch-aviation): https://www.ch-aviation.com/news/116732-saudia-outlines-plans-to-deploy-14-aircraft-on-hajj-charters
- [S34] Airhub Airlines (Wikipedia; ch-aviation on Getjet/Airhub): https://en.wikipedia.org/wiki/Airhub_Airlines ; https://ch-aviation.com/news/94683-maltas-airhub-airlines-launches-secures-us-facp
- [S35] Avia Solutions/Ascend ACMI sub-charter T&Cs (PDF; fetch failed, title only): https://dev04.dev.aviasg.com/wp-content/uploads/2024/05/General-Terms-and-Conditions-Ascend-ACMI-Sub-Charter.pdf
- [S36] ch-aviation on SmartLynx/ASG restructuring and the MAX order: https://www.ch-aviation.com/news/159686-avia-solutions-sells-smartlynx-to-consolidate-european-aocs
- [S37] SmartLynx Airlines (Wikipedia): https://en.wikipedia.org/wiki/SmartLynx_Airlines
- [S38] euroAtlantic Airways (Wikipedia; Aviacionline on the 777-200ER purchase): https://en.wikipedia.org/wiki/EuroAtlantic_Airways ; https://aviacionline.com/euroatlantic-airways-adquiere-dos-boeing-777-200er
- [S39] Omni Air International (Wikipedia): https://www.wikipedia.com/wiki/Omni_Air
