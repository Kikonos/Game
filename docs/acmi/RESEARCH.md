# ACMI Airline Simulator: Research Reference

Synthesised in October 2026 from three research passes: business and economics, operations/crew/regulation, and real-world flavour. It is written for game designers turning the browser airline game into an ACMI / wet-lease / dry-lease / charter simulator in which the player is CEO, head of HR, crew planner and scheduler of a small operator.

**Conventions**
- **(est.)** marks an estimate, extrapolation or designer assumption, not a figure from a primary source. Treat it as tunable.
- **Game default** columns are suggested starting values for balancing. They are not facts.
- Unmarked figures come from the sources in §12: regulation text, contracts filed with the SEC, UN tenders, company results and aviation press.
- Real operators appear as history and inspiration only. Ship the game with the fictional names in §11.
- Currency is USD unless shown in €. **BH** = block hour (off-blocks to on-blocks). **MGH** = minimum guaranteed hours. **FDP** = flight duty period. **AOC** = air operator certificate.

**Contents**
1. Executive summary
2. Business model and money flows
3. Contract archetypes
4. Pricing and economics
5. Operations parameters
6. Regulation and approvals as progression gates
7. Aircraft for an ACMI game
8. Events and problems catalogue
9. The flight attendant's perspective and morale
10. Design hooks and pacing
11. Fictional naming kit
12. Sources

---

## 1. Executive summary

**What an ACMI operator is.** An ACMI operator rents out a complete working airliner: **A**ircraft, **C**rew, **M**aintenance and **I**nsurance. The client, usually another airline and more and more often a government, pays a fixed rate per block hour against a monthly minimum. The client also pays everything that scales with the route: fuel, airport and navigation fees, ground handling, catering and usually crew hotels. The flight runs on the ACMI operator's AOC, so safety, crew legality and maintenance stay its job. It usually carries the client's flight number, sells no tickets, and works to the client's service standard, often in the client's colours or with its stickers by the door.

Around that core sit four related products:
- **Damp lease:** cockpit crew only.
- **Dry lease:** aircraft only.
- **Full charter:** the operator sells the whole aircraft for a price per flight that includes fuel.
- **Sub-charter:** one operator flies another operator's contract.

**The market in numbers**
- **Volume:** about 1 million ACMI block hours in 2024, a record. Europe accounts for roughly half the hours, and about 60% of deals run for less than six months.
- **Fleet mix:** narrowbodies dominate (A320ceo first, then 737-800). The A330 is the leading widebody.
- **Cycles:** the market swings hard. In Q2 2026 narrowbody ACMI hours fell 34% year on year (A321 −58%, MAX 8 −81%) while widebody hours rose 20%.
- **Margins:** profits are thin.
  - Avia Solutions Group (221 aircraft, 11 AOCs) made about 20% EBITDA but only about 4% net.
  - GlobalX ran a −0.5% operating margin in 2024.
  - SmartLynx (57 aircraft in February 2025) stopped flying "effective immediately" on 24 November 2025, owing its pilots two months' salary.

**Why this is a great game premise**
1. **Every job is a logistics puzzle with three hidden clocks.** They are permits (72 hours to 14 working days), crew duty limits (13 h basic FDP, falling to 9 h) and aircraft fit (range, runway, ETOPS). The real euroAtlantic 777 that "does not land in Dili", so a 767 with a tech stop went instead, is a better puzzle than any invented one.
2. **The economics create tension without artificial difficulty.** Aircraft rent and crew pay are fixed while revenue is seasonal. One idle month or one AOG wipes out a quarter's profit. Break-even sits near the roughly 200 BH per month that real contracts guarantee (§4.5).
3. **Seasonality gives the game a heartbeat and chapters.** Summer brings wet-lease bases; winter brings heavy checks and southern-hemisphere work. Hajj moves about 11 days earlier every year, so it is now colliding with the European summer peak.
4. **The work has moral weight, with real consequences.** Deportation, prisoner and some military work pays well and steadily but costs crew morale and public reputation, while evacuation and refugee flights pay partly in pride. Reputation has two axes: **reliable** and **clean**.
5. **It is a people game.** Crews live abroad for weeks in client cities, and hotels, per diems, rosters and mission types drive their morale and attrition. The user's own flight-attendant career is the emotional centre of the game (§9).
6. **Growth follows a natural progression ladder.** Two or three mid-life A320s lead to a first 767, then ETOPS, then Hajj and UN work, then 777s and long haul, then a second AOC, state VIP frameworks and ultra-long-range flying.
7. **Every crisis is a contract, and readiness earns the multiplier.** A crewed, legal aircraft that can go now gets the top rates; Titan sells standby aircraft that are "airborne within 60 minutes". Sub-chartering to and from rivals is a core loop, not an edge case.

---

## 2. Business model and money flows

### 2.1 Products

| Product | Operator provides | Customer pays | Whose AOC / flight number / commercial risk | Pricing basis | Typical duration | Role in the game |
|---|---|---|---|---|---|---|
| **ACMI / wet lease** | Aircraft, cockpit and cabin crew, maintenance, hull and liability insurance. Usually also crew per diems, training and OCC/CAMO. | Fuel, landing/parking, navigation, handling, de-icing, catering; crew hotels (4★ single rooms) and local transport; visas, passenger taxes, customs overtime | Operator's AOC. Client's flight number and slots. Client sells seats and carries load-factor and fuel risk. | $/BH against a monthly MGH | Days (AOG cover), a season (3–7 months), or multi-year | Core product |
| **Damp lease** | As ACMI but **cockpit crew only** (sometimes the senior cabin crew member) | As ACMI plus its own cabin crew, trained on the operator's procedures | Operator's AOC | $/BH, lower than ACMI | Seasonal | Flag carriers that want "their" cabin product |
| **CMI** | Crew, maintenance and insurance on the **client's** aircraft (dry-leased to the operator, then wet-leased back) | Aircraft ownership plus operating costs | Operator's AOC | $/BH | Months to years | Start-ups or carriers short of pilots or AOC capacity |
| **Dry lease (in or out)** | Aircraft only | Monthly rent plus maintenance reserves per FH/FC. Lessee supplies crew, maintenance and insurance. | Lessee's AOC | $/month | 3–12 years (about 80% of deals are over 5 years) | How the player acquires aircraft; late game: lease out surplus |
| **Full (ad hoc) charter** | Everything, **including fuel, fees, handling, catering, crew hotels and positioning** | One price per flight or rotation, sometimes with a fuel-escalation clause | Operator's AOC and flight number. Customer fills the seats. | Price per flight | One trip to a few weeks | Governments, sport, VIP, NGOs |
| **Series charter** | Full charter repeated (e.g. weekly LIS–CUN, May–Oct) | Price per rotation | Operator carries aircraft cost; tour operator carries seat risk | Per rotation, often with a minimum-revenue guarantee | A season | Tour operators, diaspora agencies |
| **Sub-charter / sub-service** | Operator B flies operator A's contract | Customer still pays A; A pays B | Needs customer consent. Under EU 261 the *operating* carrier owes passenger compensation, so contracts push it back through indemnities. Passengers must be told who operates the flight (Reg. 2111/2005). | A's rate vs B's rate | Hours to a season | AOG cover, overflow, brokering a spread |

**Rule of thumb.** In ACMI, the operator carries the cost of aircraft, people, technical work and insurance. The customer carries everything that scales with the route plus all commercial risk. In a full charter the operator carries all of it and prices it in.

### 2.2 Who pays what

Based on two real ACMI contracts (SmartLynx Malta → GlobalX, 2020; GlobalX → Estelar, 2021) plus industry practice.

| Cost item | ACMI / wet | Full charter | Dry lease (you lease in) |
|---|---|---|---|
| Aircraft rent / ownership | Operator | Operator | **You** pay lessor rent + reserves |
| Cockpit and cabin salaries, training | Operator (up to 5 crew sets per aircraft in the SmartLynx deal) | Operator | You |
| Crew per diems | Operator: included in the rate ($50/person/day) or billed ($2.55/crew/hour) | Operator | You |
| Crew hotels and local transport | **Client** (4★ single rooms with meals and transport) | Operator | You |
| Crew positioning by scheduled flight | Client if "directly related to the flight programme"; otherwise operator | Operator | You |
| Extra cabin crew on request | Client, $75/person/BH | Priced in | — |
| Line/base maintenance, AOG recovery | **Operator** (AOG is the operator's loss) | Operator | You |
| Hull and liability insurance | Operator (GlobalX: about $215/BH) | Operator | You |
| War-risk premium spikes | Usually passed to the client by negotiation (est.) | Priced in | You |
| Fuel, de-icing, hydraulic fluids | **Client** | Operator (or pass-through clause) | You |
| Landing, parking, navigation, handling, catering | Client | Operator | You |
| Permits and slots | Client's slots; operator's OCC files, client pays costs (est.) | Operator | You |
| Positioning / ferry flights | Billed at the ACMI rate from base until return, and the client pays ferry fuel; long-term deals may split delivery/redelivery 50/50 | Priced in, including empty legs | You |
| Passenger compensation (EU 261) | Operating carrier is liable, so the contract indemnity decides | Operator | You |
| Seat sales and load factor | Client | Customer (government, tour operator, club) | You |
| Re-invoiced direct costs | +1% service fee, due in 2 days (SmartLynx contract) | — | — |

### 2.3 How the money moves

**Money in**
- Block hours × rate, but never less than the MGH. Hours above the MGH are billed at the base rate or a slightly lower "excess hours" rate.
- Cycle fees on short sectors, positioning hours, and add-ons (extra cabin crew, a travelling engineer, trainers).
- Deposits: from 7 days of flying up to one month of MGH, often paid in tranches.
- Full-charter prices per flight, typically 20–50% at booking and the balance 7–14 days before departure.

**Money out**
- **Fixed monthly costs:** aircraft rent, crew salaries, insurance and overhead (OCC, CAMO, safety, sales, audits).
- **Variable costs:** maintenance per flight hour, block-hour pay, per diems and positioning tickets.
- **Lumpy costs:** C-checks, engine shop visits ($3–5M plus parts) and type ratings ($35–65k per pilot).

**Cash timing is a mechanic in itself.**
- Commercial clients pay **weekly in advance**, due seven days before the week's first flight; the operator's leverage is that it can stop flying.
- Governments pay in arrears and late (est.). After the 2020 repatriation flights, Germany sent 54,000 bills to returnees and 7,000 went unpaid.
- Start-up airlines are the riskiest clients. Hi Fly repossessed its A340-500s from Arik Air in 2015, and Mexicana was sued for $841M over an ACMI deal after missing a $5.5M deposit.

### 2.4 Sub-chartering (core loop)

Three uses:
- **(a) Cover your own AOG.** You rent a rival's aircraft at its rate while the customer still pays yours, often at a loss, but you avoid the penalty and keep your reputation.
- **(b) Broker arbitrage.** You win a job you cannot fly and hand it to a partner for a 5–15% spread (est.). The UN explicitly lets bidders partner with other operators.
- **(c) Sell your idle aircraft** to rivals at ×1.1–1.8 when they break down.

Real anchors:
- Titan's business was built on short-notice sub-charter.
- In 2022 Airhub took over Air Sénégal's ACMI contract (with an A330-900) from Hi Fly Malta.
- GlobalX reports "sub-service" hours alongside its own block hours.

The risk is that a partner's failure becomes your failure.

### 2.5 How work is won

- **Availability wins.** Most deals are short. In AOG cover, whoever has a crewed aircraft within reach gets the job. Planned deployment of an existing aircraft takes 7–14 days.
- **Brokers** own many customer relationships. Air Charter Service runs 35,000+ flights a year from 40+ offices; Chapman Freeborn, ACC Aviation, Air Partner and Hunt & Palmer are others. CSI Aviation handles US government charters.
  - Commission is 3–10% (est.).
  - Failing a broker's job hurts your reputation with that broker.
- **Tenders** need registration, fleet depth, audits and financial standing:
  - UNGM for the UN.
  - EU TED for Frontex: a 2024 framework for returns on scheduled flights worth about €200M, scored 70% on quality and 30% on price.
  - Defence ministries and USTRANSCOM.
- **Certifications open markets:** IOSA, EASA Part-TCO, FAA Part 129 with a DOT foreign air carrier permit, and a second EU AOC (§6).
- **Reputation drivers:** dispatch reliability, on-time performance, crew quality and language, cabin condition, complaints and incidents. Hi Fly lost a long-term Saudia lease in 2015 after an A330 in Saudia colours was photographed in Israel.

---

## 3. Contract archetypes

**Pay key.** ×N is a multiplier on the aircraft type's base ACMI rate (§4.1) for all hours flown, including positioning. For full charters the operator then adds pass-through costs (fuel, fees, hotels) plus margin, so the all-in price lands at about **2–3.5× the ACMI rate per BH**. Multipliers are designer estimates (est.) anchored on the hard data in §4. Lead time is the notice given before the first flight.

| # | Archetype | Client | Route example | Aircraft | Duration | Lead time | Pay basis and level | Requirements | Risks |
|---|---|---|---|---|---|---|---|---|---|
| **Airline ACMI** |
| 1 | **Summer wet-lease base** | European LCC or leisure airline | Based at HAM: HAM–PMI/AYT/HER (GetJet: 6 aircraft at HAM for Eurowings) | A320 / 737-800 / A321 | 5–7 months (Apr/May–Oct) | Signed Oct–Mar (3–9 months); trend is later booking | ACMI ×1.0; MGH 180–300 BH/month; peak use 300–450 | Client service flow or uniform, IOSA, crews housed at the base, client-language PAs | Cancellation penalties; language complaints; late-season softening |
| 2 | **Long-term capacity lease** | Flag carrier facing delivery delays or engine groundings | WAW–JFK, WAW–YYZ (euroAtlantic 777 for LOT) | 767 / 777 / A330 | 1–5 years | 2–9 months | ACMI ×0.85–0.95; MGH ≥200 | Business cabin, ETOPS 120–180, IOSA | Early termination (contract says 100% of remaining MGH, but the client may not pay); maintenance strain |
| 3 | **AOG / disruption rescue** | Airline whose aircraft broke | LIS–GRU tonight | Whatever is free nearby | 1–30 days | **1–6 hours** to days | ACMI ×1.3–2.0 plus positioning | Standby aircraft and a rested reserve crew | You may not have a legal crew |
| 4 | **Winter-sun lease** | Canadian or Nordic leisure airline | YYZ–PUJ/CUN/VRA | 737 / A321 | Nov–Apr | 2–6 months | ACMI ×0.8–0.9 | Canadian approval (20% cap on wet-leased capacity); crew only on direct international flights | Regulator rejection; de-icing delays |
| 5 | **Southern / emerging-market deployment** | South American or African airline | GRU–JNB (Hi Fly for SAA, 2025–26); MCO–CNF (euroAtlantic for Azul) | A330 / 767 | 3–4 months | 1–3 months | ACMI ×1.0–1.05 | ETOPS; Portuguese or Spanish speakers | Late payment; currency risk |
| **Leisure and community** |
| 6 | **Tour-operator series charter** | Tour operator | Weekly MAN–SID, LIS–CUN | A321 / 757 / 737 / A330 | Season | 9–12 months | Charter per rotation (≈ ×1.0 + fuel pass-through); minimum revenue guarantee (TUI: $5M per summer for a 3rd aircraft) | Fuel-escalation clause | Tour-operator insolvency (Thomas Cook) |
| 7 | **Diaspora charter** | Community travel agency | LIS–OXB (Bissau), LIS–TMS, LIS–LAD | 767 / A330 | Christmas and summer peaks | 1–2 months | Charter ×1.0 | Large baggage and hold allowances | Agency default; overweight bags |
| 8 | **Pilgrimage (non-Hajj)** | Religious tour operator | → Fátima (LIS), Lourdes (LDE), Najaf (Arba'een) | A320 / 737 / 767 | Event weeks | 1–3 months | Charter ×1.1 | Elderly passengers, wheelchairs | Weather; saturated airports |
| **Religious mass movement** |
| 9 | **Hajj wet lease** | Asian or African national carrier, or a Hajj authority | CGK/KNO/DAC/KAN–JED/MED | High-density A330 / 777 / A340 / A380 | 8–10 weeks in two phases | 3–6 months (tender) | ACMI ×1.1–1.4 (est.); higher in years Hajj overlaps the European peak | Halal catering, no alcohol, Miqat PA, Zamzam rules, crew based abroad, 45 °C ramp ops | One leg of each phase empty; dates move 11 days earlier each year |
| 10 | **Umrah / Ramadan programme** | Agency consortium | ALG/CMN/IST–JED | A330 / 767 / A321 | 1–3 months | 1–2 months | ACMI ×1.05–1.15 | Religious service standards | Agency payment default |
| **Government, military and humanitarian** |
| 11 | **UN rotation (per trip)** | UN-type mission office | DAC/KTM/ADD–EBB/JUB/BKO | A330 / 767 / 737 | 2–6 days | 4–12 weeks (tender) | All-inclusive $/FH, fuel reimbursed up to declared burn; not-to-exceed cap of $0.3–0.6M per rotation | UN registration, safety audit, insurance minimums, all-economy, 100 kg baggage per passenger | Audit failure; delays from troop-contributing countries |
| 12 | **UN long-term dedicated aircraft** | UN | Based at Entebbe | Widebody 200–275 seats all-economy, or narrowbody 50–120 for short/poor runways | Up to 5 years; 2,000–2,200 FH/yr | Months (EOI → RFP) | $/FH with monthly MGH and a lower excess rate, ≈ ×0.9–1.0 | **≥3 aircraft of the type**, backup aircraft, satellite flight following, RVSM, ageing-aircraft programme over 20 years | Capacity locked; split awards; no worldwide operating restrictions allowed |
| 13 | **Military troop rotation** | Defence ministry | Home → Kuwait via Shannon/Leipzig | 767 / 777 / A330 | 1 year, 2–4 flights a month | 1–3 months | ×1.1–1.3 | Security-vetted crew, DG approval for weapons, diplomatic clearance, war-risk cover, defence audit | Austere bases; airspace closures |
| 14 | **Military reserve enrolment (CRAF-like)** | Allied air mobility command | Peacetime work; activation e.g. DOH/RMS → IAD | 777 / 767 / A330 | Annual, plus 2–4-week call-ups | **24–48 h** on activation (mandatory) | Fixed rates per passenger or ton-mile; guaranteed peacetime business ($418M guaranteed in 2005) | Commit ≥40% of capable fleet; keep a 4:1 cockpit crew ratio per aircraft | Activation pulls aircraft off commercial contracts |
| 15 | **Conflict evacuation (second leg from staging hub)** | Government or coalition | LCA / JED / DJI → capitals | A320–777 | 1–10 days | **24 h** (UK Sudan 2023: 28 flights, 2,341 people) | Charter ×2–3 (premium +30–100%); government recharges seats at about £300 / $283 | War-risk cover, manifest checks, standby at the hub | Uninsurable flights (one UK charter out of Israel cancelled in 2023); unknown passenger counts |
| 16 | **Repatriation wave** | Foreign ministry or aviation regulator | DIL–(tech stop)–LIS; LAD–IAH | 767 / 777 / A330 | 1–14 days, many legs | 24–72 h | Charter ×1.5 | Ad hoc permits changing daily, humanitarian cargo on the outbound leg, quarantine | Permits revoked; slow payment |
| 17 | **Refugee resettlement block** | Immigration ministry with an IOM-like agency | WAW→YWG/YUL/YHZ; ISB→YHZ (313 Afghans, 2024) | 767 / 777 / A330 | 3–10 flights over weeks | 2–4 weeks | Charter ×1.1–1.4 | Families, infants, pets, interpreters, medical cases | Late eligibility paperwork; empty seats. Large crew-morale gain |
| 18 | **Return / deportation framework** | Interior ministry or border agency | STN/MAD → LOS/KIN/TIA | A320 / 737 / 767 / 777 | 6–24 months, 2–6 flights a month | Weeks; single flights 3–7 days | Charter ×1.3–2.0 (US 2019: 777 at $33,500/h vs 767 at $17,215/h) | Escorts, restraints, monitors, military-airfield ops | Last-minute injunction (UK–Rwanda, June 2022); activists; crew refusals; reputation; concentration risk |
| 19 | **Prisoner transfer** | Justice ministry | Domestic or international | A320 / 737 | Single flights | Days | Charter ×1.4 | Armed guards, segregation, secrecy | Security incident; reputation |
| 20 | **Disaster relief: SAR team** | Civil protection agency | MAD–ADA (Türkiye quake) | A330 / 767 / 737 | 1–2 flights | **Hours** | Charter ×2.5 | DG approval (rescue gear), dogs | No handling equipment on arrival; parking |
| 21 | **Humanitarian aid / preighter** | NGO or UN agency | DXB–ADA; BRU–LOS | Widebody with cargo in the cabin | 1–10 flights, up to 3 months | 1–14 days | Charter ×1.5–1.8 | Cabin-cargo approval; cold chain for vaccines | Spoilage claims; donor payment lag |
| 22 | **Medical evacuation airbridge** | Health ministry / WHO-like body | Conflict zone → hospital cities | A330 with stretcher kits | Weeks | Days | Charter ×1.7 | Stretchers (6–9 seats each, est.), medical team, oxygen | Patient deaths; insurance |
| **State, VIP, sport, entertainment** |
| 23 | **Head-of-state visit** | Presidential office | ACC–IAD; CGK–FCO–LHR | VIP narrowbody or widebody with VIP section | 2–10 days | 1–3 weeks | Charter ×1.5–2.0 | Diplomatic clearance, armed security team, bespoke catering, **no fuel stops** (optics), backup aircraft | Daily programme changes; national embarrassment if late |
| 24 | **Government VIP framework** | Government | Ad hoc worldwide (Titan's UK government A321neo G-GBNI) | Dedicated VIP A321neo | Multi-year retainer + per trip | 24–72 h per trip | Retainer + ×1.5 per trip | Vetted crew, special callsign, aircraft on standby | Election cancels it |
| 25 | **Corporate / VIP group** | Corporate event agency | LHR–NCE; FRA–DXB | A321 / 737 | 1–4 days | 1–3 weeks | Charter ×1.6 | Premium catering, branded cabin | Last-minute passenger changes |
| 26 | **Football club season** | Top-division club | LIS → European away cities | A320 / A321 | Season, 30–40 flights | 1–3 months | Charter ×1.3 | Branded headrests, nutritionist menu, post-match departures | Curfews; extra time; FDP limits |
| 27 | **Cup draw, knockout away** | Club | OPO–IST next week | A321 / 757 | 2 days | 3–10 days | Charter ×1.6 | Rush permits; fan charter add-on | Short notice |
| 28 | **Fan charter to a final** | Supporters' club or tour operator | 4–8 aircraft to the final city, same day | A320 / 737 / A330 | 1–2 days | 1–3 weeks | Charter ×1.8 | Slot coordination at a saturated airport, quick turns | Slot loss; unruly passengers; return after midnight |
| 29 | **National team tournament** | Football federation | LIS–DOH | A330 / 777 | 1–6 weeks, based on site | 1–3 months | ×1.4 | Aircraft and crew on standby at the team base; team livery | Early elimination ends it early |
| 30 | **Rock world tour** | Band management | 50 stops in 35 countries (Iron Maiden's 747, 2016) | 747 / 767 / 757 / A321 | 3–5 months | 3–6 months | ×1.8 | Custom livery, freight plus band, a huge permit workload | AOG mid-tour (10 days in Santiago) |
| **Special and B2B** |
| 31 | **Antarctic season** | Polar camp or research institute | CPT–Wolf's Fang / Troll (blue ice, about 3,000 m) | A340 / 767 / A330 | 4–8 flights, Nov–Feb | 3–6 months | ×2.5 | Blue-ice approval, round-trip fuel, point-of-no-return planning, polar kit, crew training | Whiteout; no alternate airport |
| 32 | **Ultra-long-range one-off** | Cruise line | MVD–MEL nonstop (Hi Fly A340, 2020) | A340 / A330 / 777 | 1–3 flights | 2–7 days | ×1.8 | Long range, augmented crew | Port closures; quarantine |
| 33 | **Sub-charter in (you supply a rival)** | Another ACMI operator | Whatever it lost | Any | Days to a season | Hours to weeks | ×1.1–1.5 (rescue up to ×1.8) | Match the end client's brand; "operated by" notice | Rival later undercuts you; the end client never learns your name |
| 34 | **Sub-charter out (you buy capacity)** | You, buying from a rival | Your own contract | Any | Any | Hours | Costs 1.1–2.0× your income for those hours | Customer consent; you stay liable | Margin loss; partner quality |

Optional extras: election logistics (ballots plus staff, ×1.4), film production (NDA, ×1.3), motorsport logistics (freighter plus staff A320, ×1.2).

---

## 4. Pricing and economics

### 4.1 ACMI block-hour rates by type

**Hard data points**
- A320 at **$2,500/BH** (SmartLynx → GlobalX, 2020 COVID trough, +3% a year; MGH 200 BH/month).
- A320 at **$3,500/BH** and A321 at **$3,850/BH** (GlobalX → Estelar, 2021; MGH 120 rising to 160).
- A320 (180Y) at **€3,750/BH** including per diems (offer for April 2024 to March 2025).
- A330 (1999 build) at **$5,800/BH**.
- Broker ranges: 737-800/A320 $4–6k/h; A330/777-300ER $8–10k/h; E175 $2.5–3.5k/h.
- Industry span: about €2,500 (E-Jet) to about €10,000 (widebody).

| Type | Typical ACMI seats | ACMI $/BH, 2024–26 normal market | **Game default** | Note |
|---|---|---|---|---|
| E190 / E195 | 100–120 | 2,500–3,500 | 3,000 | |
| A319 / 737-700 | 140–150 | 3,000–3,800 (est.) | 3,400 | |
| A320ceo / 737-800 | 180–189 | 3,200–4,500 | **3,800** | Sourced |
| A320neo / 737 MAX 8 | 180–189 | 3,800–5,000 (est.) | 4,400 | |
| A321ceo | 200–220 | 3,800–4,800 | 4,300 | |
| A321neo / LR | 220–240 | 4,500–5,500 (est.) | 5,000 | |
| 757-200 | 200–235 | 4,500–6,000 (est.) | 5,200 | |
| 767-300ER | 260–310 | 5,500–7,500 (est.) | **6,400** | |
| A330-200 / -300 | 270–440 | 6,500–9,000 | 7,200 / 7,800 | |
| A340-300 | 270–300 | 5,500–7,500 (est.) | 6,000 | Customers resist its fuel burn |
| 777-200ER | 290–400 | 8,000–10,500 (est.) | **9,000** | |
| 777-300ER | 350–450 | 9,000–12,000 | 10,500 | |
| 787-9 | 290–330 | 10,000–13,000 (est.) | 11,500 | |
| A350-900 | 300–350 | 11,000–14,000 (est.) | 12,500 | |
| 747-400 (historic) | 400–500 | 10,000–14,000 (est.) | 11,000 | Passenger 747 ACMI ended 2022–24 |
| A380 | 470–600+ | 18,000–25,000 (est.) | 21,000 | Hi Fly's ex-SIA aircraft had 471 seats |

### 4.2 Rate modifiers and premiums

| Modifier | Real range | **Game default** |
|---|---|---|
| Peak summer (Jun–Sep) | +10–25% (est.) | +15% |
| Winter / off-peak | −10–20% (est.) | −15% |
| Short notice (<7 days) | +15–40% (est.) | +25% |
| Very short notice (<72 h) | +20–50% (est.) | +35% |
| Long-term (multi-year) | −5–15% (est.) | −10% |
| Old or "unloved" type | −10–20% (est.) | −15% |
| Hajj window (widebody) | +10–25% (est.) | +20%; +35% when Hajj overlaps June |
| Conflict zone | +30–100% plus war-risk cover (est.) | +60% |
| VIP / state | +20–50% (est.) | +35% |
| Deportation "reputation premium" | +20–100%; Omni's near-monopoly let it charge about 2× the 767 rate | +40%, scaled up as fewer rivals accept |
| Market cycle index | 2023–24 boom (rates up); Q2 2025 reset; Q2 2026 narrowbody hours −34%, widebody +20% | Rates track demand: ±10–20% per cycle phase (est.) |

### 4.3 Contract mechanics

| Term | Real-world value | **Game default** |
|---|---|---|
| MGH, narrowbody | 120–300 BH/month (typically 180–220); 200/month plus 1,000 per Dec–Apr season; ≥1,800 BH over 7 months | 200 |
| MGH, widebody | 200–450 BH/month (est.); UN dedicated ≈ 170–185/month | 250 |
| Shifting MGH between months | Up to 35% if the season total is met | 30% |
| Excess-hour rate | 90–100% of base; some contracts require extra hours to be prepaid | 95% |
| Short-cycle protection | $900 per cycle on sectors under 1.5 BH, **or** a surcharge if BH:cycle falls below 2.7 (rate assumes 3:1) | $900/cycle narrowbody; $1,800 widebody (est.) |
| Positioning | ACMI clock runs from first move at base to final stop at base; client pays ferry fuel. Long-term deals may split delivery/redelivery 50/50 | Billed 100% |
| Extra cabin crew | $75 per person per BH | $75 |
| Travelling engineer ("flying spanner") | $65/BH + $70/day | Same |
| Cabin-crew trainer | $200/day | Same |
| Per diem | Included in the rate at $50/person/day, or billed at $2.55/crew/hour | Included |
| Crew sets included | Up to 5 per narrowbody (SmartLynx) | 5 |
| Deposit | From 7 days of flying to 1 month of MGH; SmartLynx asked $250k per A320 per winter in three tranches, the first $50k non-refundable | 2 weeks of MGH |
| Payment | Weekly in advance (commercial); monthly in arrears for governments (est.) | Weekly in advance; governments 30–90 days late (est.) |
| Late interest | 3%/yr | 3% |
| Single-flight cancel or re-route | Allowed with ≥12 h notice, but the MGH still applies | Same |
| ACMI early termination | **100% of unflown MGH for the rest of the term**, offset by the deposit; cancelling within 3 days of signing forfeits the deposit | Same |
| Ad hoc charter cancellation | >60 days 10–25%; 30–60 days 25–50%; 14–30 days 50–75%; <14 days 100% (est. for airliners) | 15 / 35 / 60 / 100% |
| Charter payment | 20–50% at booking; balance 7–14 days before departure; 100% up front for new clients | 30% + balance at 7 days |
| Broker commission | 3–10% (est.) | 5% |
| Sub-charter spread | 5–15% (est.) | 10% |

### 4.4 Full-charter pricing

**Price per flight** ≈ (ACMI-equivalent hours **including positioning and empty legs**) × rate + fuel + landing/navigation/handling + catering + crew hotels and per diems + permits + war-risk premium + broker commission + margin.

**All-in examples**
- A320: about $15–28k per flight hour (broker marketing, VIP-ish).
- US college charter on a 757: $101k for 5.75 h excluding fuel, about $17.6k/h.
- US deportation flights (ICE, 2019): 777 at $33,500/h and 767 at $17,215/h. One Bangladesh/India/Vietnam trip cost $1.8M.

**Per seat**
- A tour operator needs about 85–95% load factor to break even.
- Governments recharge evacuees about £300 (UK, Cyprus 2023) or up to $283 (US, Lebanon 2024) and absorb the empty seats. Australia's Beirut–Larnaca flights left with 292 of 660 seats filled.

**Ferry example (est.):** an A330 ferry from Lisbon to Jakarta is about 14 BH × $8k = $112k plus about 80 t of fuel.

**Fuel (est., not from the research files):** default jet fuel price $750/t with ±30% volatility. Burn per type is in §7.3.

### 4.5 Cost per block hour and break-even

**A320ceo at €3,750/BH.** Revenue at 250 BH/month is about €940k/month.

| Cost line | € per BH at 250 BH/month | Basis | At 155 BH/month (GlobalX actual utilisation) |
|---|---|---|---|
| Aircraft rent (mid-life, $230–250k/month) | 900–1,000 | IBA | ~1,530 |
| Maintenance reserves, line maintenance, spares | 500–800 (est.) | | ~650 (variable) |
| Crew: 5 cockpit sets + 5 cabin sets, training and per diems | 800–1,100 (est.) | | ~1,530 |
| Insurance | 100–250 (GlobalX: $215/BH) | Sourced | ~280 |
| Overhead (OCC, CAMO, safety, sales, IOSA, AOC fees) | 300–500 (est.) | | ~645 |
| **Total** | **≈ 2,600–3,650** | | **≈ 4,640** |
| **Margin at €3,750** | **5–15% in a good season** | | **Loss of about 24%** |

GlobalX's 2024 actuals (A320 family, US) were rent ≈ $2,000/BH, salaries ≈ $2,350/BH, maintenance ≈ $460/BH and insurance ≈ $215/BH.

**Game insight: break-even sits at about 190–210 BH/month for a narrowbody.** That is why contracts guarantee about 200.

**Widebody example: 767-300ER at $6,400/BH (all est.)**

| Cost line | At 250 BH/month | At 150 BH/month |
|---|---|---|
| Rent ($170k/month) | $680/BH | $1,130/BH |
| Maintenance (old widebody) | $2,000/BH | $2,000/BH |
| Crew (about 14 pilots + 50 cabin crew, with on-costs) | $1,360/BH | $2,270/BH |
| Insurance (mostly a fixed annual premium) | $300/BH | $500/BH |
| Overhead | $500/BH | $830/BH |
| **Total / margin** | **$4,840/BH, about 24% margin** | **$6,730/BH, a loss** |

Break-even is about 160 BH/month. Old widebodies combine cheap rent with expensive maintenance and an engine-shop-visit cliff (§5.7).

### 4.6 Acquiring aircraft

| Aircraft | Monthly rent | Value / purchase |
|---|---|---|
| Mid-life A320ceo / 737-800 | $230–250k (IBA Sept 2024) | — |
| New A320neo / MAX 8 | ~$400k | ~$55M |
| New A321neo | ~$460k | ~$64M |
| 12-year A330-300 | ~$330k | — |
| 12-year 777-300ER | ~$450k | — |
| New 787-9 / A350-900 | ~$1.05M / ~$1.14M | — |
| 20+-year 767-300ER | $120–220k (est.) | $5–15M (est.) |
| 20-year 777-200ER | $200–300k (est.) | $10–20M (est.) |
| 20-year A330-200 | $150–250k (est.) | $5–15M (est.) |
| A340-300 | $80–150k, near scrap value (est.) | $5–15M (est.) |
| Ex-SIA A380 | $300–600k, thin market (est.) | — |

**Maintenance reserves on dry leases (est.)**
- Airframe: $60–150/FH.
- Engines: $150–400 per engine flight hour.
- APU: $30–80 per APU hour.
- Landing gear: $15–40/FC.

**Lead times**
- Deploying an aircraft already in your fleet to a new contract: 7–14 days.
- Dry-leasing an aircraft onto your AOC: 1–3 months, or 2–6 months if a cabin refit, re-registration or new type is involved (est.).
- New order: years. Widebody slots are booked into the 2030s.

**Scarcity, 2023–26.** OEM delays, the GTF engine groundings and the 777X slipping 6+ years made airlines keep old jets, lifting mid-life rents. Engine and heavy-check turnaround times are still about twice pre-pandemic and are not expected to improve before 2027.

**ACMI flies mid-life aircraft.** euroAtlantic's fleet averages 20.4 years and it targets mid-life aircraft rather than new builds. The exceptions are Hi Fly's A330neo (2019), ASG's 737 MAX order and airBaltic's A220s.

### 4.7 Insurance and war risk

- Hull and liability policies exclude war by default (**AVN 48B**). Cover is bought back by endorsement (**AVN 52** for third-party and passenger war liability).
- Insurers can cancel or re-price on **7 days' notice** when a conflict flares, and they did so for Israel and Lebanon in 2023–24.
- A UK evacuation flight out of Israel (October 2023) was cancelled because Titan could not get insurance.
- **Game default:** a per-region threat level drives a war-risk premium per flight. In "hot" regions there is a 5–20% chance a flight is uninsurable and cannot legally operate (est.).

### 4.8 Benchmarks

| Company | Figures |
|---|---|
| Avia Solutions Group, 9M 2024 | Revenue €2.06bn; EBITDA €406M (≈20%); net €83.3M (≈4%); 221 aircraft |
| GlobalX, FY2024 | Revenue $223.8M (ACMI $123.1M, charter $95.5M); 28,820 BH; ≈$7,770 revenue per BH blended (charter includes fuel); operating margin −0.5% (Q4 +5.6%); 1,862 BH per aircraft per year (~155/month) |
| GlobalX, 2025 | Revenue $246M; net loss $3.05M |
| GetJet, 2025 | Revenue €165M from about 15–17 narrowbodies; peak about 5,000 BH in July |

**Game defaults (est.):** target net margin 0–6%; utilisation 1,800–2,200 BH per aircraft per year, with peak months above 300.

---

## 5. Operations parameters

### 5.1 Flight time limitations: simplified EASA rule set (implement as written)

> v0.7.3: several citations and the cabin rest table here were corrected; EASA-FTL.md is the reference.

> v0.7.2: the rules are restated by article in docs/acmi/EASA-FTL.md, the reference for crew rules from now on. v0.7.2: CSD/SCC merged into PUR (the game's cabin ranks are PUR and CC).

Source: Reg. (EU) 83/2014 (ORO.FTL / CS FTL.1). Times are h:mm. The "reference time" is local time where the crew is acclimatised. Use 15-minute resolution. Show each duty as **legal / tight / illegal**.

**F1. Basic maximum FDP (2 pilots, acclimatised).** `maxFDP = base(report time) − 0:30 × max(0, sectors − 2)`, with a floor of 9:00. This exactly reproduces Table 2.

| Report time | 05:00 | 05:15 | 05:30 | 05:45 | 06:00–13:29 | 13:30 | 14:00 | 14:30 | 15:00 | 15:30 | 16:00 | 16:30 | 17:00–04:59 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Base (1–2 sectors) | 12:00 | 12:15 | 12:30 | 12:45 | **13:00** | 12:45 | 12:30 | 12:15 | 12:00 | 11:45 | 11:30 | 11:15 | **11:00** |

- **Unknown acclimatisation (state X):** base 11:00 (12:00 if the operator has an approved FRM), same sector penalty, floor 9:00.
- **Acclimatisation:**
  - A crew stays acclimatised to the departure zone ("B") for 48 h.
  - After a shift of ≥4 h, the state is X from 48 h until D (acclimatised to the new location). D is reached at 72 h for ≤6 h shifts, 96 h for ≤9 h and 120 h for ≤12 h.
  - Shifts under 4 h are D from 48 h.
- **Cabin crew** may report up to 1 h before pilots. Their limit is computed from the pilots' report time.
- **Consecutive night duties:** at most 4 sectors per duty.

**F2. Planned extension (no in-flight rest).**
- +1:00, at most **2 times in any 7 consecutive days**. Not allowed for reports between 19:00 and 06:14.
- Following rest is extended: either +2 h before and +2 h after, or +4 h after.
- Sector limits depend on WOCL (02:00–05:59) encroachment: ≤5 sectors with none, ≤4 if it encroaches ≤2 h, ≤2 if it encroaches more than 2 h.

| Report | 06:15 | 06:30 | 06:45 | 07:00–13:29 | 13:30 | 14:00 | 14:30 | 15:00 | 15:30 | 16:00 | 16:30 | 17:00 | 17:30 | 18:00 | 18:30–18:59 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Max FDP, 1–2 sectors | 13:15 | 13:30 | 13:45 | **14:00** | 13:45 | 13:30 | 13:15 | 13:00 | 12:45 | 12:30 | 12:15 | 12:00 | 11:45 | 11:30 | 11:15 |
| Max sectors allowed | 5 | 5 | 5 | 5 | 4 | 4 | 4 | 4 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |

Each sector above 2 costs −0:30.

**F3. Augmented crew (in-flight rest).** At most 3 sectors. Add **+1:00** if the duty has at most 2 sectors and one of them exceeds 9 h of flight time, giving an absolute maximum of **18:00**.

| Extra pilots | Class 3 rest seat | Class 2 rest seat | Class 1 bunk |
|---|---|---|---|
| +1 (3 pilots) | 14:00 | 15:00 | **16:00** |
| +2 (4 pilots) | 15:00 | 16:00 | **17:00** |

- **Rest facility classes:**
  - Class 1: bunk or flat bed, separated from cockpit and cabin.
  - Class 2: seat reclining ≥45° with ≥55" pitch, curtained off.
  - Class 3: seat reclining ≥40° with leg rest, curtained off.
- Minimum in-flight rest is 1:30 per pilot and **2:00 for the landing pilots**.
- **Cabin crew minimum in-flight rest by extended FDP** (Class 1 / 2 / 3):

  | Extended FDP | Class 1 | Class 2 | Class 3 |
  |---|---|---|---|
  | ≤14:30 | 1:30 | 1:30 | 1:30 |
  | ≤15:00 | 1:45 | 2:00 | 2:20 |
  | ≤15:30 | 2:00 | 2:20 | 2:40 |
  | ≤16:00 | 2:15 | 2:40 | 3:00 |
  | ≤16:30 | 2:35 | 3:00 | not allowed |
  | ≤17:00 | 3:00 | 3:25 | not allowed |
  | ≤17:30 | 3:25 | not allowed | not allowed |
  | ≤18:00 | 3:50 | not allowed | not allowed |

  So long flights need 1–3 extra cabin crew (est.).

**F4. Commander's discretion (an event, never planned).**
- Up to +2:00 (**+3:00 if augmented**).
- The following rest can be reduced but never below **10 h**.
- Discretion over 1 h must be reported to the authority within 28 days.
- Game: each use adds +1 to the crew member's discretion counter and costs fatigue.

**F5. Split duty.** A ground break of ≥3 h (net of 30 min) extends the FDP by **50% of the break**. A hotel room is required if the break is ≥6 h or touches the WOCL. Cannot be combined with in-flight rest.

**F6. Standby and reserve.**
- **Airport standby:** counts 100% as duty. Max FDP is reduced by standby time beyond 4 h, and **standby + FDP must not exceed 16 h**.
- **Home or hotel standby:** at most 16 h; 25% counts as duty. Max FDP is reduced by standby time beyond 6 h (8 h if augmented or split), and the crew member may not be awake more than 18 h.
- **Reserve:** notified ≥10 h ahead, with an 8 h protected no-contact window. Does not count as duty.

**F7. Positioning (deadheading).**
- Always counts as duty.
- Positioning **before** operating counts as FDP but **not as a sector**.
- Positioning home after the last sector counts as duty, not FDP.

**F8. Minimum rest.**

| Situation | Minimum rest |
|---|---|
| At home base | max(previous duty, **12 h**) |
| Away from base | max(previous duty, **10 h**), including 8 h sleep opportunity; +2× any hotel transfer beyond 30 min |
| Away after an augmented FDP, or after a time shift ≥4 h | max(previous duty, **14 h**) |
| After a planned extension | +4 h (F2) |
| Late or night duty followed by an early start at home | Rest must include 1 local night |

**F9. Extended recovery rest (ERRP).**
- At least **36 h including 2 local nights**, and **no more than 168 h** between the end of one ERRP and the start of the next.
- Twice a month it must be 2 local days.
- **4 or more disruptive duties** (early, late or night) between two ERRPs extend the next ERRP to **60 h**.

**F10. Cumulative limits.**
- **Duty:** 60 h in any 7 days, 110 h in 14 days, 190 h in 28 days.
- **Block time:** **100 h in 28 days**, **900 h per calendar year**, 1,000 h in 12 months.
- The 900 h annual cap is the binding constraint: a crew member flying 100 h a month hits it by September, so summer-heavy rosters must bank winter downtime.

**F11. Days off.**
- At least **7 days free of all duty per calendar month** and 96 per year.
- 4 weeks of paid leave per year.
- At most 2,000 working hours per year.

**F12. Time-zone recovery at home base** (rotations with ≥4 h difference), in local nights:

| Max time difference | Rotation <48 h | 48–71 h | 72–95 h | ≥96 h |
|---|---|---|---|---|
| ≤6 h | 2 | 2 | 3 | 3 |
| ≤9 h | 2 | 3 | 3 | 4 |
| ≤12 h | 2 | 3 | 4 | 5 |

Alternating eastbound and westbound rotations need ≥3 local nights between them.

**F13. Roster governance.**
- Rosters are published **14 days ahead**.
- If more than **33%** of a schedule's duties exceed their planned FDP in a season, the operator must change the schedule. In the game this is a regulator event.
- A meal opportunity is required on any FDP over 6 h.

**F14. US AOC alternative (FAA Part 117, pilots only).**
- Unaugmented FDP: 9–14 h by start time and segments.
- Augmented FDP: up to **19 h** (4 pilots, Class 1, 07:00–12:59 start).
- Rest: 10 h including 8 h of sleep, and 30 h free in any 168 h.
- Cumulative: FDP 60 h/168 h and 190 h/672 h; flight time 100 h/672 h and 1,000 h/365 days.

```
maxFDP(duty):
  base = (acclim=='X') ? 11:00 : BASE[reportBand]
  base = max(9:00, base - 0:30*max(0, sectors-2))
  if augmented and sectors<=3: base = AUG[extraPilots][restClass] (+1:00 if sectors<=2 and longestFT>9h)
  elif splitBreak>=3h: base += 0.5*usableBreak
  elif plannedExt and ext7d<2 and reportBand in 06:15–18:59: base = EXT[reportBand] - 0:30*max(0,sectors-2)
  if airportStandby: base -= max(0, standby-4h); assert standby+FDP <= 16h
  if homeStandby:    base -= max(0, standby-6h)   # 8h if augmented/split
  return base        # discretion +2h (+3h aug) only via event
minRest(duty) = max(duty.len, home?12h:10h); 14h if augmented or tz>=4h; +4h if extended
rolling: duty 60/7d, 110/14d, 190/28d; block 100/28d, 900/yr, 1000/12m; ERRP 36h+2 nights ≤168h apart
```

### 5.2 Crew complements by type

**Cabin crew minimum (EASA ORO.CC.100).** The greater of `ceil(installed seats / 50)` (per deck) and the certification evacuation-demo number, with at least 1 above 19 seats. v0.10: the game now uses the certified numbers of each type (§15); the table below is the v0.1 research, kept for the typical crews. A senior cabin crew member (SCCM) is required whenever there is more than one cabin crew. A cabin crew member may hold **at most 3 types** (4 with approval).

**Cockpit crew.** 2 pilots minimum. A "heavy" crew has 3 (Captain + FO + relief SFO/second officer); a "double" or ULR crew has 4 (usually 2 captains + 2 FOs). A cruise-relief second officer may fly in cruise only, above FL200.

| Aircraft (charter seats) | Cabin legal minimum | ACMI/charter typical (est.) | Scheduled long-haul typical |
|---|---|---|---|
| A320 / 737-800 (180–189) | 4 | 4 | 4–5 |
| A321 (220) | 5 | 5 | 5–6 |
| 757-200 (235) | 5 | 5–6 | 6 |
| 767-300ER (269–300) | 6 | 7–8 | 8–10 |
| A330-200 (300–330) | 7 | 8–9 | 9–11 |
| A330-300 (380–440) | 8–9 | 9–10 | 10–12 |
| A340-300 (300–340) | 7 | 9–11 | 11–14 |
| 777-200ER (300–400) | 7–8 | 9–11 | 10–12 (US carrier: 11–12 international) |
| 777-300ER (400–450) | 9 | 11–13 | 12–16 |
| 787-9 (290–300) | 6 | 8–9 | 9–11 |
| A350-900 (300–350) | 7 | 9–10 | 10–12 |
| A380 (471, two decks) | 10+ | 16–18 | 20–24 |

**Service add-ons (est.):** VIP, government and sports flights carry minimum + 2–4; flights over 12 h carry +2–3; client-supplied language FAs fly as supernumeraries.

### 5.3 Crew per aircraft and sizing

| Operation | Pilots per aircraft | Cabin crew per aircraft |
|---|---|---|
| Narrowbody, year-round | **10–12** (5–6 crew sets) | 20–30 (est.) |
| Narrowbody, summer-only ACMI | 10–12 in summer; 4–6 kept in winter (est.) | 20–25 |
| Widebody medium haul, 2 pilots | 12–16 (est.) | 45–60 (est.) |
| Widebody long haul, augmented | **16–26** (Air India: 787 ≈ 16, 777 ≈ 26) | 55–80 (est.) |
| Ultra-long-range | 24–30 (est.) | 70–90 (est.) |
| Military reserve (CRAF-like) | 4:1 cockpit crew ratio required | — |

**Sizing formula (est.)**

```
pilots = ceil( Σ(BH_month × pilotsPerFlight) / 80 ) × 1.20
cabin  = ceil( Σ(BH_month × cabinPerFlight)  / 85 ) × 1.20
```

- 80 and 85 BH/month are productive hours per pilot and per cabin crew member (hard caps: 100 per 28 days, 900 per year).
- The 1.20 reserve factor covers sickness (3–5%), training (3–4%), leave (about 8%) and standby.

**Deployments**
- Rotations are typically **4–6 weeks on and 2 weeks off** (est.). SmartLynx's 2025 pattern was described as "30/15".
- Per diems: captains €100/day and FOs €70 (SmartLynx); cabin crew €40–90 (est., default €50); engineers €60 (est.).
- Positioning by scheduled flight costs €150–400 in Europe and €600–1,500 intercontinental (est.).

### 5.4 Training

| Item | Duration | Cost |
|---|---|---|
| Type rating A320 / 737 | 4–6 / 3–5 weeks | $35–50k / $38–55k |
| Type rating 777 / 787 / A350 | 4–6 weeks (EASA 777 ≈ 40 days: 20 ground + 9 simulator) | $45–65k (up to $70k) |
| Type rating A330 | 4–6 weeks | €15–32k (course only) |
| Base training (6 landings) | 1 day | €5–20k aircraft time (est.) |
| Line training plus line check | Narrowbody 20–40 sectors; widebody 6–12 sectors; 3–6 weeks (est.) | Salaries of trainee and trainer |
| Operator conversion (already type-rated) | 2–4 weeks plus line training (est.) | €5–15k (est.) |
| Differences / cross-crew (777↔787, A330↔A350) | 1–2 weeks (est.) | €5–15k (est.) |
| Command upgrade FO→CPT | 4–8 weeks (est.); needs about 3,000–5,000 h total and 500–1,000 h on type (est.) | €15–30k (est.) |
| Pilot recurrent | OPC every 6 months; LPC and line check every 12 months; safety equipment every 12 months; DG every 24 months; 3 landings in 90 days; about 6–10 roster days a year | Simulator €400–700/h (est.) |
| Cabin initial attestation | 4–8 weeks (est.) | €2–5k (est.) |
| Cabin type / operator conversion | 5–10 days (est.) | — |
| SCCM / purser course | 3–5 days plus ≥1 year line experience (est.) | — |
| Cabin recurrent | 1–3 days a year (est.) | — |

**Recruitment lead times (est.):** rated captain 1–3 months (notice periods are the bottleneck); non-rated FO 3–5 months; cabin crew 6–10 weeks; B1 engineer 1–3 months.

**Bonding (est.):** a company-paid type rating is bonded for 2–4 years at €20–50k pro rata. Low bonds mean faster attrition after training.

**Medicals and age:** pilot Class 1 medical every 12 months; pilots stop at 65 for commercial air transport; cabin crew medical every 60 months.

**Real hiring bar:** Hi Fly asks widebody captains for ≥5,000 h total and ≥1,000 h PIC on type.

### 5.5 Salaries (gross, EU ACMI)

| Role | Summer €/month | Winter €/month | **Game default (S / W)** | Basis |
|---|---|---|---|---|
| Captain, narrowbody | 8–10k | 6–8k | 9,000 / 7,000 | Avion Express ad: €10k + €20/BH summer, €6k + €45/BH winter, €110–117k a year. SmartLynx: €8,235–9,455 summer, €7,930 winter |
| FO, narrowbody | 5–6k | 3.5–5k | 5,500 / 4,300 | SmartLynx €5,185–6,100 / €4,117–5,032 |
| Captain, widebody | 10–15k (est.) | — | 12,000 / 10,000 | +15–30% on narrowbody (est.) |
| FO, widebody | 6–8k (est.) | — | 7,000 / 5,800 | est. |
| Cruise-relief second officer | — | — | 4,000 | est. |
| Contract pilots (day rate) | CPT €185–310/day, FO €100–200/day; 80 BH guaranteed in summer, 30 in winter | | | SmartLynx 2023 |
| Purser / CSD | — | — | 2,800 / 1,600 | est.; +20–40% on cabin crew |
| Cabin crew | Basic €900–1,800 + sector/BH pay + per diems = €2–3.5k season total | Reduced pay or unpaid leave | 2,200 / 1,200 | est.; no source found |
| B1 engineer | €3–6k; contractors €300–500/day + per diem | | 4,500 | est. |
| Crew planner (Vilnius) | €2.2–2.7k | | 2,500 | Job ad |

**Employer on-costs:** +10–35% depending on country and contract model (est.). The agency/contractor model is cheapest but carries the highest legal and morale risk; it was exposed in the SmartLynx collapse.

### 5.6 Turnarounds, block time, utilisation

- **Block time** ≈ great-circle distance ÷ cruise TAS + 0:27 (about 0.45 h for taxi, climb and descent).
- **Wind:** North Atlantic westbound ×1.10, eastbound ×0.92 (est.).
- **Average block speed:** about 330 kt on a 1 h sector, 410 kt at 3 h, 450 kt at 6 h, 480 kt at 10 h+ (est.).
- **Cruise TAS (kt):** A320/737 450; 757/767 460; A330/A340 470; 777 485; 787/A350 490.

| Turnaround (min) | A320 | A321 | 737 | 757 | 767 | A330 | A340 | 777 | 787 | A350 | A380 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Game default | 40 | 45 | 40 | 50 | 70 | 80 | 90 | 90 | 80 | 85 | 120 |

- **Quick turn:** narrowbody 25–35, widebody 50–60.
- **EUROCONTROL medians:** about 45 (medium), about 90 (heavy).
- **Tech stop (fuel only):** 45–75 min.
- **Long-haul turn with crew change:** 90–150 min.
- **Crew reporting:** 60 min before departure narrowbody, 90 widebody; post-flight duty 30 / 45 min (est.).

### 5.7 Maintenance

| Type | A-check interval / downtime | C-check interval / downtime | Heavy check |
|---|---|---|---|
| A320 family | 750 FH / 750 FC / 4 months; 1 night (8–12 h) | 7,500 FH / 5,000 FC / 24 months (many tasks 36); 7–14 days | 6- and 12-year checks; 3–5 weeks |
| 737NG/MAX | ~600–1,000 FH (est.) | ~24 months / 7,500 FH (est.) | 6/12-year (est.) |
| 767-300ER | Planned 500–600 FH, actual 400–500; 300–500 MH; about $46k; 16 h | 6,000 FH / 18 months; 2–3 weeks | Every 4th C-check (24,000 FH / 72 months; about every 5 years); 4–8 weeks |
| A330 | ~800 FH; 16 h | 24 months / 10–12k FH; 2–3 weeks | 6/12-year |
| 777 | No letter checks; about 1,000 FH task groups (est.); 18 h | Base check every 18–24 months; about 3 weeks | Every 4th base check, about 8 years |
| 787 / A350 | ~1,000–1,200 FH (est.) | 36 months (est.); about 2 weeks | 12-year |

**Game rules**
- Push C-checks and heavy checks into **November–March**; a summer check means lost ACMI revenue.
- Add 2–4 weeks if corrosion or a cabin refit turns up.
- MRO turnaround runs at about 2× pre-pandemic until 2027.

**Engines**
- **Shop visit intervals:** narrowbody about 15,000 EFH (modern; 7–12k on old data); widebody 15–30k EFH (est.).
- **Costs:** widebody performance restoration $3–5M excluding life-limited parts; a full widebody LLP stack $8–12M; a CFM56-5B full overhaul can exceed $10M. LEAP and GTF costs have risen twice as fast as older engines since 2019.
- **Spare engine lease (est.):** narrowbody $2–6k/day, widebody $8–20k/day. An engine change takes 1–2 days if a spare is on hand.

**Direct maintenance cost per BH (est., game defaults)**
- Narrowbody: $700 new, $1,100 old.
- Widebody: $1,400 new, $2,500 old (range 1,500–2,800).
- 767 data points: line and ramp checks about $75/FH; A-checks about $110–115/FH.

**Reliability and AOG (est.)**
- Technical dispatch reliability: 99.7% new, 99.4% mid-life, 98.8% old widebody.
- About 8% of technical delays become an AOG longer than 12 h.
- Common causes: bird strike or FOD, tyres and brakes, hydraulic leaks, bleed or pack faults, IDG or APU faults (an ETOPS problem), lightning, ground damage, avionics, cracks.

**AOG recovery menu (est.)**

| Option | Time | Cost |
|---|---|---|
| Local fix with fly-away kit | 1–4 h | — |
| Part from a pool, flown in by courier | 12–48 h | Part + $2–15k logistics |
| AOG engineering team (2–4) flown in | 12–36 h | Travel and day rates |
| Rescue aircraft from own fleet | 4–24 h | Positioning |
| Sub-charter a rival | 6–48 h | 1.2–2× the contract rate |

**Staffing (est.)**
- Per deployed aircraft: 1–2 B1 and 0–1 B2 engineers on 2–4-week rotations, plus a fly-away kit worth €100–500k.
- Alternatively, contract line maintenance at the client hub for €150–400 per turn or €20–60k/month.
- Overall: about 8–15 engineering and CAMO staff per aircraft.

---

## 6. Regulation and approvals as progression gates

| Gate | Real-world basis | Unlocks | Suggested requirements (game default) | Time | Cost |
|---|---|---|---|---|---|
| **G0. EU AOC + operating licence** (start) | Reg. 1008/2008: EU-owned and controlled; at least one aircraft owned or dry-leased (fleet cannot be only wet-leased-in); insurance per Reg. 785/2004; financial fitness | Intra-EU wet lease-out (notification only); Europe/Med/North Africa charters | Given at start. Cash below 3 months of fixed costs triggers a financial-fitness review (est.) | — | — |
| **G1. Another aircraft of an existing type** | OpsSpecs update, registration, CofA/ARC, insurance, acceptance flight | Capacity | ≥5 crew sets available for it | 2–6 weeks | €50–150k |
| **G2. New type** | OM-B, MEL, training programme, TRI/TRE, CAMO/Part-145 scope, maybe proving flights | New family (e.g. first widebody) | ≥1 type-rated training captain; 10–16 pilots rated; 3 months of ops history | 4–9 months | €0.5–2M + type ratings |
| **G3. Area of operation** | OpsSpecs area | Africa, Asia, Americas jobs | Route qualification | 1–3 months | Low–medium |
| **G4. Dangerous goods (SPA.DG)** | Procedures and training | Weapons/ammunition, SAR gear, aid cargo, medical oxygen | All crew DG-trained (24-month recurrency) | 1–3 months | Low |
| **G5. ETOPS 120** (138 with the 15% extension) | SPA.ETOPS; twins otherwise stay within 60 min of an adequate airport | North Atlantic, LIS/MAD–Caribbean, Cape Verde, LIS–Brazil with alternates | ETOPS-capable type, ETOPS maintenance programme, ETOPS-qualified engineer sign-off at outstations, dispatch reliability ≥99.5% (est.) | 6 months (historically about 12 months of in-service experience, or an accelerated programme) | Medium |
| **G6. ETOPS 180** (207 North Pacific) | Normally 12 months at 120 first | Direct South Atlantic, Indian Ocean (Maldives/Mauritius), North Pacific | 12 months at 120 without a serious ETOPS event | 12 months | Medium |
| **G7. ETOPS beyond 180 (240/330/370)** | Type-certified (777, 787, A350; A330 since 2009) | South Pacific, polar, Southern Ocean; four-engine A340/A380 bypass this | ≥2 years at 180, ≥3 aircraft of the type (est.) | 12+ months | High |
| **G8. Augmented long-haul ops** | FTL augmented limits; rest facility classes | FDP 16–18 h; 10–14 h sectors | Fit Class 1 bunks or Class 2 seats; 3–4-pilot complements; SFO/cruise-relief rank; cabin rest seats | 1–3 months (est.) | Cabin modification $0.3–1.5M (est.) |
| **G9. Ultra-long-range** | ≥16 h flight time / ≥8,000 nm; FRMS approval; 4 pilots; Class 1 bunks; two in-flight rests each; about 48 h rest at destination (est.) | ULR contracts | ULR-capable type (777-200LR, A350ULR, 787-9); ≥12 months of augmented ops | 6–12 months | High |
| **G10. IOSA** | IATA audit that many airline clients require (Airhub passed in 2022, two years after its AOC) | Flag-carrier and major-airline ACMI | ≥12 months of ops; quality department level 2 (est.) | 6–12 months (est.) | €100–250k (est.) |
| **G11. Second AOC** (e.g. Malta 9H) | Hi Fly (PT+MT), SmartLynx (LV+EE+MT), GetJet (LT) with Airhub (MT) | Cheaper crew social costs, other bilateral rights, registry flexibility, hedge against suspension | ≥2 years of ops; cash | 6–12 months | €1–3M |
| **G12. Third-country authorisations** | EASA Part-TCO for non-EU AOCs; FAA Part 129 plus DOT foreign carrier permit (Airhub got one); Canadian CTA approval (20% cap) | US charters and US clients; Canada winter work; EU access for a non-EU AOC | Per country | TCO 3–6 months; US 1–3 months then days to weeks per charter | Medium |
| **G13. UN vendor + audit** | UNGM registration, UN aviation safety audit, insurance minimums | UN rotations; 5-year dedicated aircraft | **≥3 aircraft of the type**, backup aircraft, satellite flight following, RVSM, ageing-aircraft programme | Tender weeks to months | Audit (est.) |
| **G14. Defence approval** | Omni was the first non-scheduled US carrier approved to carry troops on a 777 (2011) | Troop rotations; CRAF-like enrolment | Security-vetted crew, G4, defence audit; enrolment commits ≥40% of capable fleet at a 4:1 cockpit ratio | 3–6 months (est.) | — |
| **G15. State / VIP framework** | Titan flies the UK government's A321neo | Head-of-state retainer; special callsigns | Reliability ≥99.5%, "clean" reputation, VIP cabin, vetted crew (est.) | Tender | VIP cabin (est.) |
| **G16. Polar / blue-ice** | Hi Fly A340 at Wolf's Fang (2021); Icelandair 767 at Troll | Antarctic season | Long-range widebody or four-engine; special crew training | 3–6 months of preparation | — |
| **G17. Hajj eligibility** | National tenders; Saudi permits | Hajj and Umrah | High-density widebody (≥300 seats Y); Hajj-trained cabin crew; a base abroad for 8–10 weeks | Tender 3–6 months | — |
| **G18. Cabin cargo (preighter)** | Airhub's zero-seat A330 9H-AHQ | Aid and vaccine cargo | Seats removed plus approval | 2–4 weeks (est.) | (est.) |

**EU wet-lease rules (Reg. 1008/2008 Art. 13, ORO.AOC.110)**
- Every wet lease involving an EU carrier needs prior approval under safety law.
- **Intra-EU wet lease-out** needs only notification. The AOC's area of operation must cover the deployment.
- **Wet-leasing in a third-country aircraft** is allowed only for:
  - **exceptional needs**, up to 7 months renewable once ("7+7");
  - **seasonal needs** that EU aircraft can't meet;
  - **operational difficulties**, for strictly the time needed.

  It also requires equivalent safety standards, an ICAO Annex 6 AOC and a standard certificate of airworthiness. No lessor may be on the EU Air Safety List.
- Reg. 2019/2 allows the 7-month limit to be waived by an international agreement. The Commission has been reviewing these rules since 2018, which makes a good possible "rule change" event.
- This protects EU ACMI operators from cheaper non-EU competition, which is why ACMI operators cluster in Malta, Lithuania, Latvia and Portugal.
- **UK after Brexit:** wet-leasing in an EU aircraft needs CAA approval plus a foreign-aircraft permit; wet lease-out needs only notification.
- **Canada:** foreign wet-lease crew are exempt from work permits **only on direct international flights**, not with domestic stops.

**Permit and diplomatic clearance lead times**

| Country / type | Lead time |
|---|---|
| Schengen charter | 0–2 days (est.) |
| Egypt | Same day to 72 h |
| Serbia | 72 h |
| Saudi Arabia | Overflight 72 h, landing 96 h |
| Iran overflight | ≥48 h; longer for unfriendly registries |
| Slovakia, Iceland, Luxembourg (diplomatic clearance) | 3 working days |
| EU military technical arrangement | 2 working days |
| Latvia | 5 working days (7 for military with DG) |
| Thailand (diplomatic) | 14 working days |
| Typical landing permit | 2–10 working days (est.) |
| Typical diplomatic clearance | 5–15 working days (est.) |
| New US charter authority | 30–90 days (est.) |

Permits are valid only for a window of a few hours around the planned time, so a long delay means re-filing. Use the window as the "permit expired" trigger.

**Slots and curfews**
- Level 3 coordinated airports (LHR, LGW, AMS, FRA, CDG, LIS, BCN, PMI in summer) need a slot. Historic slots need 80% use ("use it or lose it").
- Wet-leased aircraft fly on the client's slots. **Protecting slots during groundings is a key demand driver**: Lufthansa planned 40–50 wet-leased aircraft for summer 2024 during the GTF crisis.
- Ad hoc charters may get bad slot times or none.
- Curfews such as Frankfurt 23:00–05:00 cut the usable day.
- IATA summer season runs from the last Sunday of March to the last Saturday of October.

**Suggested progression tiers**

| Tier | Typical game year | What the player is doing |
|---|---|---|
| T0 | Start | 1–3 mid-life A320/737s on an EU AOC. Summer wet-lease base plus ad hoc work. |
| T1 | Year 1–2 | 4–6 narrowbodies, G3/G4, IOSA. First winter deployment. First government charter. |
| T2 | Year 2–3 | First widebody (767 or A330) via G2, ETOPS 120. Hajj, diaspora, sports and evacuation work. |
| T3 | Year 3–5 | ETOPS 180, ≥3 of a widebody type (UN-eligible), defence approval, augmented ops, 777-200ER. |
| T4 | Year 5+ | Second AOC, US/Canada authorisations, state VIP framework, polar, ULR on A350/787, group-level M&A. |

---

## 7. Aircraft for an ACMI game

### 7.1 Who flies what (the real cast)

| Operator (AOC) | Fleet, latest found | Niche | Game archetype |
|---|---|---|---|
| **euroAtlantic Airways** (PT; the user's former airline) | 8 aircraft including those being inducted (2026), average age 20.4 years. 767-300ER **CS-TST/TSU/TSV** (one 309Y high density, two 16J/251Y); 777-200ER **CS-TSW/TSX** (30J/24W/239Y); A330-200 CS-TGD (2025, its first Airbus); further A330s being inducted, including A330-300 CS-TGI. History: Air Zarco (1993), L-1011 (last European passenger TriStar, to 2010), 757s 2007–11, 777s from 2019. "2× 767 + 2× 777" fits about 2019–23. | Lusophone widebody charter and ACMI: LOT (777 WAW–JFK, then WAW–YYZ 6×/week from June 2026), flynas Hajj, Azul, TACV, TUI fly Belgium. 1,110 Portuguese repatriated in 2020. Moving to multi-year deals; target about 12 mid-life aircraft, with A330s replacing 767s. | "Lisbon widebody operator of the Lusophone world" |
| **GetJet** (LT) | About 15–17 737-800/A320/A321; 800 staff; crew of 15 nationalities; €165M revenue in 2025 | About 30 airline clients a year; half the fleet on year-round deals; **6 aircraft at Hamburg for Eurowings** (2026); Canadian winter work (Sunwing 2019–20, Swoop from 2023) | "Baltic narrowbody machine" |
| **Airhub Airlines → GetJet Malta** (MT) | 2022: A320 ×4, A330-300 ×2 (one zero-seat freighter), A330-900, A340-300 ×3. Down to 1 A320 by July 2026 | Took over Air Sénégal's ACMI from Hi Fly Malta; IOSA 2022; FAA foreign carrier permit | Shows how fast a fleet grows and shrinks |
| **Hi Fly** (PT + MT) | Peak about 20 (2019): A320 family, A330/A340, A380 9H-MIP; first A330neo ACMI (2019); has since left the A340 | Showman: A380 (Norwegian, Thomas Cook rescue, Wuhan evacuation), first A340 landing in Antarctica (2021), Montevideo–Melbourne nonstop | "Halo aircraft, record flights" |
| **Wamos Air** (ES) | ~9–10 A330-200/-300 (formerly 747-400) | Dropped scheduled flying in 2022 to do only charter and ACMI; flew for Etihad from Rome | "Pivot to pure ACMI" |
| **Titan Airways** (UK) | A320/A321/A321neo, A321P2F, A330 freighters | Sub-charter "airborne in 60 minutes"; UK state VIP A321neo; Sudan evacuation | "Rescue airline" |
| **Air Atlanta Icelandic** (IS/MT) | 747 freighters; first 777-200ER in 2025; Atlas buying 49% (May 2026) | Hajj since 1988; Saudia since 1993; Iron Maiden's 747 | "Hajj kings" |
| **Omni Air International** (US) | ~14–15 767/777-200ER | Troops (5M+), CRAF Stage I for Kabul with three 777s, ICE | "Troop mover" |
| **GlobalX** (US) | 10 A320, 4 A321, 4 A321P2F | Sport, ICE (more than half of removal flights; one count 74%) | "Concentration risk" |
| **Privilege Style** (ES) | 777-200ER, 767-300ER EC-LZO, A330-200, A321s | VIP and sport; the UK–Rwanda flight grounded by the ECHR minutes before departure | "Controversial contract" |
| **SmartLynx** (LV/EE/MT) | 57 aircraft in February 2025 | Ceased 24 November 2025 | "Cautionary collapse" |

### 7.2 Shortlist: roles and operations (15 types plus one historic)

| Type | Tier / role | ACMI seats | Realistic range at full payload (nm) | Cockpit / cabin minimum / cabin typical | Turn (min) | ETOPS / notes |
|---|---|---|---|---|---|---|
| **A320ceo** | T0 starter workhorse | 174–186 | 2,600–2,900 (5–6 h) | 2 / 4 / 4 | 40 | Rarely needs ETOPS |
| **737-800** | T0 alternative starter | 189 | ~2,500 | 2 / 4 / 4 | 40 | Mixing with A320 costs commonality |
| **A321ceo** | T0–T1 capacity | 200–220 | ~2,300 | 2 / 5 / 5 | 45 | |
| **A321neo / LR** | T1 thin transatlantic | 200–240 | LR ~3,500 (Lisbon–US East Coast) | 2 / 5 / 5 | 45 | ETOPS 120 needed |
| **757-200** | T1 niche: sport, tours, heritage | 200–235 | ~3,300 (transatlantic in summer) | 2 / 5 / 5–6 | 50 | Ageing, scarce; euroAtlantic 2007–11 |
| **767-300ER** | **T2 first widebody** | 260–310 | 4,800–5,300 (LIS–Salvador fine; LIS–Dili needs stops) | 2 / 6 / 7–8 | 70 | ETOPS 120–180; the classic ACMI widebody; better small-airport fit than the 777 |
| **A330-200** | T2 long-thin widebody | 290–330 | ~6,000 | 2 / 7 / 8–9 | 80 | ETOPS 180–240 |
| **A330-300** | T2–T3 Hajj/UN workhorse | 330–440 | 5,000–5,500 | 2 / 8–9 / 9–10 | 80 | ETOPS 180; most liquid ACMI widebody (Wamos flies only A330s) |
| **A340-300** | T2 cheap four-engine, polar | 280–340 | ~6,500 | 2 / 7 / 9–11 | 90 | No ETOPS needed; Antarctic flights; fuel-hungry |
| **777-200ER** | **T3 long-haul flagship** | 300–400 | 6,000–6,500 | 2 / 7–8 / 9–11 | 90 | ETOPS 180–207 (330 possible); barred from some short or weak runways |
| **777-300ER** | T3–T4 high capacity | 380–450 | ~6,500 | 2 / 9 / 11–13 | 90–120 | ETOPS 180–330 |
| **787-9** | T4 modern long haul | 280–300 | ~6,800 | 2 / 6 / 8–9 | 80 | ETOPS 330; ULR-capable (Perth–London ≈ 17 h) |
| **A350-900** | T4 modern long haul | 300–350 | ~7,300 | 2 / 7 / 9–10 | 85 | ETOPS 370 |
| **A350-900ULR / 777-200LR** | T4 ULR endgame | ~170 (ULR) / 300–320 | ~9,000 / ~7,500 | 4 pilots / 4–7 / 6–8 (est.) | 85–90 | Needs FRMS (G9) |
| **A380** | Halo aircraft (T3+) | 471–600 | ~7,000 (est.) | 2 / 10+ / 16–18 | 120 | Four engines; few airports; Hajj (flynas took 3) |
| **747-400** (historic scenario) | Pre-2022 Hajj/tour scenario | 400–500 | ~6,500 (est.) | 2 / 8–10 / 12–14 (est.) | 120 (est.) | Passenger ACMI ended 2022–24 |

### 7.3 Shortlist: economics and scarcity

| Type | ACMI $/BH default | Monthly rent (mid-life unless noted) | Fuel t/BH (est.) | Maintenance $/BH (est.) | Pilots per aircraft | Availability, 2026 |
|---|---|---|---|---|---|---|
| A320ceo | 3,800 | $230–250k | 2.5 | 900 | 10–12 | Plentiful; 2026 narrowbody slump |
| 737-800 | 3,700 | $230–250k | 2.5 | 900 | 10–12 | Plentiful |
| A321ceo | 4,300 | $260–300k (est.) | 2.9 | 1,000 | 10–12 | Good |
| A321neo / LR | 5,000 | $460k new | 2.5 | 800 | 10–14 | Delivery slots years out; GTF groundings; ACMI hours −58% in Q2 2026 |
| 757-200 | 5,200 | $100–180k (est.) | 3.3 | 1,500 | 10–12 | Scarce, ageing |
| 767-300ER | 6,400 | $120–220k (est.); buy $5–15M (est.) | 5.3 | 2,000 | 12–16 | Available but retiring |
| A330-200 | 7,200 | $150–250k at 20 years (est.) | 5.8 | 1,800 | 14–20 | Good |
| A330-300 | 7,800 | $330k at 12 years | 6.0 | 1,800 | 14–20 | Good; demand +17% in Q2 2026 |
| A340-300 | 6,000 | $80–150k (est.) | 7.0 | 2,500 | 14–20 | Cheap; customers resist its fuel bill |
| 777-200ER | 9,000 | $200–300k (est.); buy $10–20M (est.) | 7.2 | 2,300 | 16–26 | In demand (+35% in Q2 2026) |
| 777-300ER | 10,500 | $450k at 12 years | 8.0 | 2,200 | 18–26 | Demand −34% in Q2 2026 |
| 787-9 | 11,500 | $1.05M new; $600–800k mid-life (est.) | 5.6 | 1,400 | 16–24 | Rare in ACMI; slots booked into the 2030s |
| A350-900 | 12,500 | $1.14M new | 6.0 | 1,500 | 16–24 | Very scarce |
| ULR variants | 14,000 (est.) | $1.1M+ (est.) | 6.5 | 1,600 | 24–30 | Extremely scarce |
| A380 | 21,000 | $300–600k (est.) | 12 | 4,000 (est.) | 16–24 | Thin market, prestige |
| 747-400 | 11,000 | Scenario only | 10.5 | 3,000 (est.) | 16–20 | Gone from passenger ACMI |

### 7.4 Fleet-fit rules worth implementing

- **Runway and airport fit:** each aircraft–airport pair is OK, tech-stop needed, or prohibited. The Dili case is the model.
- **Four engines bypass ETOPS**, which is why the A340 went to Antarctica and why old quads survive on niche work.
- **Cabin configuration as a strategic choice:**
  - All-economy (euroAtlantic's 309Y 767) for Hajj, troops and the UN (which requires all-economy).
  - Two-class (16J/251Y) for airline ACMI and sport.
  - VIP section for state work.
  - Reconfiguration takes 2–6 weeks and $0.5–3M (est.).
- **Commonality:** cabin crew may hold at most 3 types, and pilots need type ratings ($35–65k). An A320-only fleet is cheap to crew; adding a widebody means a new crew pool.
- **Cycle protection:** short sectors wear aircraft faster per hour, so price a cycle fee or eat the extra maintenance.

---

## 8. Events and problems catalogue

**Crew and duty time**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 1 | **Crew going illegal** | Delay over 90 min on a multi-sector day; ATC slot | Return leg would exceed max FDP | Commander's discretion (+2 h; fatigue, morale −, counter +1, report if >1 h) · night-stop passengers in hotels (client claims compensation) · position a standby crew if one is in range |
| 2 | **Discretion overuse audit** | More than N discretion uses a month, or >33% of a schedule's duties over planned FDP | Regulator review; forced schedule change | Add crew sets · redesign the schedule · contest it (risk of AOC restriction) |
| 3 | **Sick FA at an outstation** | About 4% a month per crew member; higher on long deployments | Below the 1-per-50 cabin minimum | Block seats to a legal number (offload passengers) · deadhead a replacement (€150–1,500, hours) · delay |
| 4 | **Visa refused** | Crew nationality vs destination | That crew member can't operate | Swap crew · expedite (cost + days) · drop the trip |
| 5 | **Hotel full** | Hajj, big events, peak season | No contracted rooms | Premium hotel (cost) · split crews across hotels (morale −) · airport floor (morale −−−, fatigue) |
| 6 | **Per diem dispute** | Per diem below local costs, or paid late | Morale falls across the deployment | Raise it · provide meals · ignore (resignations at season end) |
| 7 | **Salaries late** | Cash crunch | Morale collapses, resignations, financial-fitness review (SmartLynx) | Emergency equity with conditions (a Njord/Abra-style investor) · return aircraft · delay pay (very risky) |
| 8 | **Union strike threat** | End of season with low morale | Strike in peak season | Raise pay · improve rosters · take the strike (cancellations) |
| 9 | **Crew refuse a mission** | Controversial contract plus low morale or a strong union | Some crew decline | Volunteers with a bonus · force it (morale −−, resignations) · sub-charter |
| 10 | **Language complaint** | Wet lease without client-language crew | Client satisfaction − | Hire language speakers · use client-supplied FAs · accept the hit |
| 11 | **Captain poaching** | Post-COVID captain shortage; rival recruiting | Lose rated captains at short notice | Retention bonus · raise bonds · hire contractors at day rates |

**Technical**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 12 | **AOG at an outstation** | Random, weighted by age, maintenance quality and remoteness | Aircraft stuck 1–10 days | Local fix · part by courier · AOG team · rescue aircraft · sub-charter (1.2–2×) · cancel (penalty, reputation) |
| 13 | **Ground damage** (Ed Force One hit a tug) | Poor handling at an outstation | 7–14 days out | Insurance claim (deductible) · lease a replacement · re-plan |
| 14 | **ETOPS downgrade** | APU/IDG fault before an oceanic sector | Aircraft becomes non-ETOPS | Reroute within 60 min (more BH and fuel) · fuel stop · swap aircraft |
| 15 | **Industry engine crisis** (GTF-type) | World event | Airlines grounded: ACMI demand ↑, spare engines scarce, rents ↑ | Raise rates · lock in long-term deals · sell capacity forward |
| 16 | **Heavy check overrun** | Corrosion found; MRO backlog (≈2× pre-pandemic) | +2–4 weeks downtime | Pay to expedite · sub-charter cover · delay the contract start |
| 17 | **Engine shop-visit cliff** | Engine reaches its EFH limit | $3–5M plus life-limited parts | Overhaul in winter · lease a spare ($8–20k/day widebody) · retire the aircraft |
| 18 | **Cargo shift risk** (Bagram 2013: 7 killed) | Military vehicle cargo with rushed loading | Rare but catastrophic | Invest in loadmaster training and inspection time · rush (risk) |

**Permits, airspace, insurance, environment**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 19 | **Permit late** | Notice shorter than the permit lead time | Cannot depart | Pay an agent's urgent fee · reroute around the country (more BH) · delay the client |
| 20 | **Permit window expired** | Delay past the validity window | Re-request (hours) | Wait · pay an expediter |
| 21 | **Aircraft can't land there** | Runway or aircraft mismatch (Dili) | Plan impossible | Swap type · add a tech stop · decline |
| 22 | **Airspace closure** | War or geopolitical event | Routes blocked; contracts frozen | Reroute (more BH/fuel; who pays?) · suspend · continue nearby with war-risk cover |
| 23 | **War-risk spike or cancellation** | Conflict flares; insurer gives 7 days' notice | Premium ×2–5, or cover withdrawn so the flight cannot operate | Pass to client (they may cancel) · absorb · withdraw |
| 24 | **Grey client** | Client in a sanctioned or sensitive state | High pay; risk to insurance and AOC | Accept · decline · accept via an intermediary (risk) |
| 25 | **Heat payload limit** | Hot airport in summer (JED, KAN) | Payload cut | Night departure · tech stop · offload bags (complaints) |
| 26 | **Curfew** | Extra time or a delay runs past the curfew | Can't leave | Hotel night · divert to a 24 h airport · request dispensation (rare, costly) |
| 27 | **Whiteout at the ice runway** | Antarctic contract | Must turn back before the point of no return | Return to Cape Town (fuel; who pays?) · hold at the point of no return |

**Commercial and market**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 28 | **Rival's AOG: they need you** | A rival breaks down | Offer at ×1.3–1.8, hours to answer | Accept · refuse · accept and court the end client later |
| 29 | **Your AOG: sub-charter out** | Your aircraft AOG mid-contract | Need a replacement | Buy from a rival · cancel (penalty) · take an aircraft off a lower-priority contract |
| 30 | **Renewal undercut** | A rival bids −15% | Renewal at risk | Match · differentiate (newer aircraft, language crews, on-time record) · walk away |
| 31 | **Client goes bust** (Thomas Cook) | Low tour-operator health | Unpaid invoices; crews stranded and evicted from hotels | Pay hotels yourself (morale ++, cash −) · bring crews home · bid on the rescue repatriation (about 140,000 flown home in 2019) |
| 32 | **Government pays late** | Client payment-reliability stat | Receivables age; cash squeeze | Wait · factor the invoice at a discount · threaten to suspend · litigate |
| 33 | **Start-up client defaults** | Weak client finances | Missed deposits | Repossess the aircraft (Hi Fly / Arik 2015) · arbitration · write off |
| 34 | **Market crash** | Cycle index (Q2 2026: narrowbody −34%) | Renewals at lower MGH; idle aircraft | Park the aircraft · redeploy south · cut rates · return leased aircraft (penalty) |
| 35 | **Hajj collides with summer** | Hajj date moves into the June peak | Widebody demand spike | Commit widebodies to Hajj or to summer ACMI |
| 36 | **Competitor collapse** (SmartLynx 2025) | A rival ceases operations | Stranded clients; crews and aircraft available | Hire crews cheaply · take over contracts (as Airhub did Air Sénégal's) · lease their aircraft |

**Government and controversial work**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 37 | **Mobilisation order** | CRAF-like enrolment plus a world crisis | 1–3 aircraft requisitioned for 2–4 weeks at a fixed rate | Comply and sub-charter to cover · pay the penalty and lose enrolment |
| 38 | **Injunction minutes before departure** | Deportation contract with high activist pressure | Flight cancelled with the crew on duty (UK–Rwanda cost about £500k) | Bill per contract terms · handle the press |
| 39 | **Activists / press story** | Deportation or military flight | "Clean" reputation −; airline clients ask questions | PR statement · quit the contract · ignore |
| 40 | **Political optics incident** | Aircraft in a client's livery seen somewhere sensitive (Hi Fly/Saudia 2015) | Client ends a long-term lease | Compensate · screen ad hoc work against key clients' sensitivities |
| 41 | **Election changes the government** | VIP or deportation framework | Contract cancelled or renegotiated | Lobby · accept · pivot |
| 42 | **Manifest dispute at an evacuation point** (Kabul) | Evacuation contract | Authorities refuse some passengers | Wait (standby fees) · depart part-empty · suspend the programme |
| 43 | **VIP changes** | Head-of-state trip | Added sectors, overweight gifts, programme changes | Accept at ×1.5 · augment the crew · refuse · ship the gifts by freighter · add a fuel stop (optics −; Ghana) |

**On board and flavour**

| # | Event | Trigger | Effect | Player choices |
|---|---|---|---|---|
| 44 | **Medical emergency** | Random; higher on Hajj and with elderly passengers | Divert or continue | Divert (cost, FDP) · continue; the crew's medical-training stat sets the outcome |
| 45 | **Unruly passengers** | Fan charters, alcohol | Diversion or police on arrival | Dry flight (fans unhappy) · extra security |
| 46 | **Celebrity pilot request** | Rock tour | The band's singer is a licensed pilot | Allow (needs a type rating; PR ++) · decline |
| 47 | **Client safety audit** | UN, defence or major airline | Pass or fail gates the contract | Invest in the quality department · risk it |
| 48 | **IT outage / hack** (GlobalX 2025) | Random | Rostering system down 1–2 days | Manual rostering (errors) · pay a vendor |
| 49 | **Birth on board / layover moment** | Rare / random on good layovers | Morale +, press +, a postcard ("Crew dinner in Bissau") | None (flavour) |

---

## 9. The flight attendant's perspective and morale

### 9.1 The shape of ACMI cabin-crew life

**Seasonal deployment**
- Crews are sent to the client's base (Hamburg for Eurowings, Toronto for Swoop, Jakarta or Medina for Hajj) for weeks or a whole season, living in a contracted hotel.
- Narrowbody bases run April/May to October, typically 5 on / 2–3 off or 6 on / 3 off, with home rotations every 3–6 weeks (est.).
- Days alternate between two-sector turns (HAM–PMI–HAM) and longer four-sector days.

**Widebody charter (euroAtlantic style)**
- Irregular 3–10-day pairings with layovers tourists never see: Dili, Bissau, Kano, Medina, Manaus.
- Hajj means a month or more based abroad. The work changes week to week: a VIP flight, then a military rotation, then a scheduled-service wet lease.

**Pay (est.)**
- Low base pay (€700–1,500 a month at Eastern European ACMI operators) plus sector or block-hour pay and per diems of about €40–90 a day.
- Winter brings reduced pay or unpaid leave, a known grievance. Late per diems are a classic complaint.

**Mixed crews and brands**
- GetJet flies 15 nationalities with English as the working language, but PAs must be in the client's language, so a client-supplied "language speaker" may fly too.
- Crews wear either their own uniform on a client-branded aircraft or the client's uniform.
- They learn each client's service flow (buy-on-board vs complimentary, trolley order, scripted announcements, grooming rules). Switching clients every few weeks is tiring, but it is great material to show in the game.

**Hotels are the biggest morale lever**
- A city hotel with a pool is good; an airport box with no food after 21:00 and a 40-minute shuttle is bad.
- On long deployments, crews care about laundry, a kitchen, a gym, a safe neighbourhood and Wi-Fi.

**Career ladder**
- Cabin crew → senior → purser / CSD (the SCCM) → cabin instructor.
- The SCCM course is 3–5 days and needs at least a year of line experience. A strong CSD defuses VIP and Hajj complications; a weak one escalates them.

### 9.2 Service by mission type

| Mission | Service style | What crews notice | Morale effect (game default) |
|---|---|---|---|
| VIP / presidential | Client's chef or caterer, china and linen, protocol order of service; the delegation leader sets the timings | Pressure, armed security on board, very long days; prestige and sometimes gifts; hand-picked CSD | +3 pride, −2 fatigue |
| Military / troop rotation | Simple hot meals, plenty of water; weapons stowed by the rules; multi-stop routes via Shannon, Leipzig or Kuwait | Polite, grateful passengers; austere bases. Crews often love these flights | +2 |
| Hajj / Umrah | Halal food, no alcohol, prayer times, **Miqat announcement** for entering Ihram, Zamzam water rules, heavy cabin bags | Elderly first-time flyers who need help; Jeddah heat; long boarding. Emotionally powerful | +3, −2 fatigue |
| Deportation / return | Minimal service; escorts manage returnees; restraints; no metal cutlery; supervised doors and lavatories | Moral distress, risk of violence, worry about evacuating restrained passengers; activists. Some crew refuse | −8 (−2 if crew opted in) |
| Refugees / evacuation / repatriation | Families, babies, pets, almost no luggage, medical cases | Remembered for life; chaotic paperwork; exhausting | +6 |
| Sports teams | Branded headrests, nutritionist menus, quiet cabin, medical kit | Celebrities, phone and photo rules, late post-match departures | +2 |
| Band tours | Party atmosphere, lots of freight | Bucket-list flights | +4 |
| Medical airbridge | Stretchers, medical team on board, cabin cargo | Unusual procedures; little service | +3 |
| Scheduled-service wet lease | Exactly the client's product | Passengers think you are the client; language complaints; repetitive | 0, −1 per week beyond 6 weeks |

### 9.3 Morale drivers (game defaults on a 0–100 scale, starting at 65; all est.)

| Driver | Positive | Negative |
|---|---|---|
| Deployment length | ≤4 weeks: 0 | −2 per week beyond 6 weeks |
| Roster stability | Published ≥14 days ahead and kept: +3/month | Each late change −2; each commander's discretion use −3 |
| Days off | ERRPs at home: 0 | −1 per day off spent at the client base |
| Accommodation | 4★ single room near the airport: +2/month | Long transfer or shared room −5; airport floor −15 |
| Per diem | Paid on time and adequate: 0 | Late −8; below local cost −4/month |
| Salary | Winter guarantee +5; summer bonus +3 | Winter cut −5; **late salary −25** and a resignation wave |
| Contract | Direct employment with pension +5 baseline | Agency or self-employed −5 baseline |
| Trip fairness | Nice trips shared fairly +2 | Same crews always get the bad trips −3 |
| Crew family | Same crew together all season +3 | Split mid-season −2 |
| Recognition | Client thanks or award +2 | Treated as invisible −1 |
| Mission | See §9.2 | War-risk zone −5 unless consent and a bonus |
| Visas / hassle | — | Each visa problem −2 |

**What morale changes (est.)**
- **Monthly attrition** = 1% × a multiplier: 0.5× at morale ≥70, 1× at 50–69, 2× at 30–49, 3× below 30.
- **Sickness rate** = 4% × (1 + (60 − morale)/100) when morale is below 60.
- **Volunteer rate** for controversial or war-risk missions scales with morale.
- **Strike risk** appears below 35 morale in a unionised AOC.
- **Service quality** (client satisfaction) is ±10% across the morale range.

### 9.4 What a former ACMI flight attendant would want to see

1. **Named crew** with nationalities and languages (Portuguese, Spanish, Lithuanian, Arabic, French, Russian, Hindi) that unlock client fit and morale bonuses.
2. A **"crew bag" view** of each rotation: days away, cities, hotel rating, per diem earned, and the next trip home.
3. **Uniform swapping:** the same FA in company uniform, then a client's uniform, then a modest Hajj uniform or a VIP suit.
4. **Layover moments:** "Crew dinner in Bissau", "Pool day in Fortaleza", "Snow in Toronto", "Medina at dawn".
5. **The CSD/purser as a key role** whose skill fixes or escalates complications.
6. **Real announcements:** the Miqat PA, "This flight is operated by…", the language-speaker PA.
7. **On-board incidents:** a medical emergency ("is there a doctor on board?"), an unruly passenger, a birth, a VIP's lost suitcase, Zamzam leaking in the hold.
8. **Seasons as chapters:** the summer base, Hajj, the Caribbean winter, the polar charter.
9. **Visible fatigue:** crew near their limits are flagged before the player accepts a delay.
10. **Pride missions:** repatriation and refugee flights generate stories that lift company morale and reputation.

---

## 10. Design hooks and pacing

### 10.1 Real-world element → game mechanic

| Real-world element | Game mechanic | What makes it fun | Anti-grind safeguard |
|---|---|---|---|
| Block-hour billing with MGH | Revenue = max(MGH, flown) × rate; month-end shortfall meter | Spare hours become a resource to sell | Ad hoc offers fill gaps automatically if the player opts in |
| Seasonality | Calendar with season cards (Summer base, Winter south, Hajj, Heavy-check season) | Each year has an arc; planning a year ahead pays | Season summary screen instead of day-by-day micromanagement |
| Urgency premium | Offers with countdowns and ×1.3–3 multipliers; a "standby" status for aircraft and crew | Keeping one aircraft idle on purpose becomes a bet | Expired offers simply disappear; there is no penalty for ignoring them |
| EASA FTL | Legality checker with traffic lights; crew-hour bars | Delays create real dilemmas (discretion vs hotel vs standby crew) | Auto-roster builds legal rosters; only exceptions reach the player |
| Crew deployments | Bases abroad, hotel choice, per diem policy, rotation length | People-management choices with visible faces | Policy settings (per diem level, hotel tier, rotation length) apply globally |
| Permits | A permit clock per country on each route; permit-agent upgrades | Urgent jobs into slow-permit countries are gambles | Permits auto-file once a job is accepted; the player sees only risk flags |
| Aircraft–airport fit | Planner shows "OK / tech stop / prohibited" | Fleet mix matters (the Dili puzzle) | Clear icons; the planner suggests alternatives |
| Approvals | Tech tree G0–G18 with time and cost | Long-term goals and strategic forks | Progress bars run in the background |
| Maintenance | Check calendar, engine hours, DMC; schedule heavy checks in winter | Timing heavy checks and engine shop visits is a real strategic choice | CAMO head auto-plans; the player approves exceptions |
| AOG | Event with a recovery menu (§5.7) | Short, tense decisions with clear trade-offs | Frequency follows reliability, so investing in quality visibly reduces events |
| Sub-charter | Market of rival operators with price, quality and availability | Arbitrage and rescue plays; rivals have personalities | One-click "find cover" with a price comparison |
| Brokers vs tenders | Deal flow vs sales team; tender scoring (quality/price) | Two different ways to grow | Brokers bring ready-made offers |
| Two reputation axes | "Reliable" and "Clean", per client segment | Moral choices with economic consequences; some clients care, others don't | Show which clients react before the player accepts |
| Client payment reliability | Credit stat, deposits, receivables ageing | Governments pay well but late; start-ups are risky | Payment terms are part of the offer screen |
| Market cycle | Demand index per segment (narrowbody vs widebody) | Boom and bust (2024 record, 2026 slump) | News ticker warns a quarter ahead |
| Hajj drift | Hajj moves 11 days earlier each year | A long-term puzzle: the collision years | Calendar shows the next 5 Hajj windows |
| War-risk insurance | Threat map; premiums; "uninsurable" | Evacuation jackpots with real risk | The risk is clear before the player commits |
| Multiple AOCs | Group structure; moving aircraft between registries | Late-game empire building | Unlocks only at T4 |

### 10.2 Core decisions the game should keep asking

1. **Lock or float:** sign 5 years of UN or long-term ACMI at −10%, or keep aircraft free for evacuations, VIP work and Hajj?
2. **Quote the price:** undercut in a soft market or hold the line and risk an idle aircraft?
3. **Take the deportation contract?** Steady money against "clean" reputation, crew morale and court cancellations.
4. **Fly into the war zone?** A huge premium against insurance, crew consent and airspace risk.
5. **Sub-charter or cancel** when your aircraft breaks?
6. **Buy old or lease mid-life:** a 20-year-old 767/A340 with an engine cliff, or an A330 with higher rent?
7. **Commonality or reach:** stay A320-only, or add a widebody pool for Hajj, the UN and long haul?
8. **Cabin configuration:** 309Y for Hajj and troops, two-class for airline ACMI and sport, or VIP?
9. **Crew sets per aircraft:** 4 is cheap but fragile; 6 is safe but costly. Expat or local crews on long deployments?
10. **Growth pace:** expand in a boom and risk a SmartLynx-style collapse, or grow "smart and controlled"?
11. **Payment terms vs winning the deal:** demand weekly prepayment from a start-up, or bet on credit?
12. **Standby aircraft:** earn nothing on one aircraft to win the rescue jobs, or sell every hour?

### 10.3 Pacing

- **Time:** 1 game day ≈ 20–60 s at normal speed, with auto-pause on decisions; a P&L summary at month end; season recaps (est.).
- **Early game (T0–T1, year 1):**
  - Two or three A320s, one summer wet-lease base plus ad hoc charters.
  - The first "crew going illegal" event teaches FTL. The first winter is a survival test: demand falls, heavy checks come due, and the player decides whether to send aircraft south.
  - The first urgent government job shows what readiness pays.
- **Mid game (T2–T3, years 2–4):** first widebody (767 or A330), ETOPS 120 then 180, Hajj, the UN (needs ≥3 of a type), defence work, IOSA, the first moral dilemmas.
- **Late game (T4, years 5+):** 777/A350, augmented and ULR crews, a state VIP framework, CRAF-like enrolment, a second AOC, taking over a collapsed rival. Then a market crash tests the empire.
- **Event cadence (est.):** about one meaningful decision per in-game week per 5 aircraft. Cap simultaneous crises at 2–3 and include quiet weeks.
- **Fail forward:** bankruptcy is not instant. Restructuring, a private-equity rescue with conditions (as Njord did with euroAtlantic and Abra with Wamos) or selling aircraft keep the player in the game.
- **Delegation keeps the CEO/HR/crewing fantasy without spreadsheet hell.** Hire department heads (Crew Planning Manager, Chief Pilot, Head of Cabin Crew, Technical Director/CAMO, Commercial Director). Their skill sets how well routine work is automated, and the player handles exceptions.
- **Scenario starts (fictional names):**
  - "Lisbon 2019: 2× 767 + 2× 777", the user's own era.
  - "Vilnius 2016: one 737-400".
  - "Malta 2020: a new AOC in a pandemic".
  - "Hajj 2029 collision year".

---

## 11. Fictional naming kit

Check new names against ch-aviation and Wikipedia before shipping. The pattern that works is one evocative word plus a region and a plausible suffix (Airways, Wings, Air Charter, Jetlease). Avoid echoing real brands.

**Player company presets:** Atlântica Wings (PT), Tagus Aero (PT), Lusostar Airways (PT), Amberline Air (LT), Valletta Jetlease (MT).

**Rival ACMI operators:** Baltic Wingset (LT), Gozo Sky Charter (MT), Iberosol Air Charters (ES), Mallorca Prestige Air (ES), Fjord Polar Cargo (IS), Thames Readiness Air (UK), Ozark Military Charter (US), Sunfield Global Air (US), Palmetto Air Lift (US), Danube Wetlease (HU/RO), Carpathia Jet (RO).

**Brokers:** Meridian Air Partners, Northstar Charter Brokers, Halcyon Aviation Solutions, Albatross Air Brokerage, Ironbridge Charter Group, Windrose Air Logistics, Bluewater Group Charter, Polaris Ad-hoc, Cobalt Aviation Advisory.

**Airline clients:** Amazonas Linhas Aéreas (BR), Cerrado Air (BR), Sahelia Airways (West Africa), Kalahari Skyways, Lakeshore Air (CA), TransBaltica, Adriatica, Dalmatia Wings, NordicBlue, Celtic Skyways, Andina Sur, Pacifica Island Air, Mekong Royal Air, Maghreb Crescent Airways, Levant Star.

**Tour operators and agencies:** SunHoliday Reisen, Costa Dourada Tours, AquaVista Holidays, Polar Horizons Expeditions, WhiteSilence Camps.

**Government and agency stand-ins:** "Ministry of Foreign Affairs of [country]" (real countries are fine as generic clients); Allied Air Mobility Command (for US AMC); World Peace Mission Office (for the UN); European Border & Return Agency, EBRA (for Frontex); International Migration Relief Organisation, IMRO (for IOM); Global Health Airbridge Coalition (COVAX-type); [Country] National Hajj Authority; Republic of Novaterra presidential office (fictional microstate).

**Sport, music and VIP:** Sporting Atlântico, Real Ciudad CF, Dynamo Vilnorth, Olympique Littoral, Union Rhein-Ruhr, Crimson Lions (national rugby team), Velocity GP Team, "The Iron Hymn" world tour, "Velvet Thunder" stadium tour.

**ICAO code / callsign examples:** LSA "LUSOSTAR", ATW "ATLANTICA", BWT "WINGSET", VJL "MALTESE", IBS "SOLAIR", TRA "READY". Wet-lease flights usually use the client's flight number; VIP and royal flights get special callsigns.

**Registration prefixes**

| Prefix | Country / note |
|---|---|
| CS- | Portugal (airliners CS-Txx, e.g. CS-TSU) |
| LY- | Lithuania |
| 9H- | Malta (popular second AOC; vanity registrations like 9H-MIP) |
| YL- / ES- | Latvia / Estonia |
| EC- | Spain |
| G- | UK (vanity G-GBNI) |
| TF- | Iceland (TF-AAK) |
| N | USA |
| D-A | Germany |
| EI- | Ireland (lessor-favoured) |
| SP- / LZ- / YR- / SX- / TC- | Poland / Bulgaria / Romania / Greece / Türkiye |
| 4L- / UR- / ER- | Georgia / Ukraine / Moldova |
| A6- / HZ- | UAE / Saudi Arabia |
| PR-, PP-, PS- / C- / ZS- | Brazil / Canada / South Africa |
| D2- / D4- / S9- / J5- / 5N- / 4W- | Angola / Cabo Verde / São Tomé / Guinea-Bissau / Nigeria / Timor-Leste |
| VP-B, VQ-B / T7- / 2- | Bermuda (offshore) / San Marino / Guernsey (VIP jets) |

Let players choose vanity registrations (CS-TUA, 9H-CEO). Re-registering between AOCs takes days to weeks and costs money.

**Aircraft nicknames:** 747 "Queen of the Skies" / "Jumbo"; A380 "Superjumbo" / "the Whale"; 777 "Triple Seven" / "T7"; 767 "the Six-Seven"; 757 "the Flying Pencil"; A340 "the Four-Holer"; A330 "the Three-Three"; A320 family "the Bus"; L-1011 "TriStar". Let players name individual aircraft (like "Ed Force One" or Hi Fly's coral-reef A380).

**Tooltip glossary (short):**

| Term | Meaning |
|---|---|
| ACMI / wet lease | Aircraft, Crew, Maintenance, Insurance, billed per block hour |
| Damp lease | ACMI without cabin crew |
| Dry lease | Aircraft only |
| BH | Block hour (off-blocks to on-blocks) |
| MGH | Minimum guaranteed hours |
| AOG | Aircraft on ground (grounded by a defect) |
| MEL | Minimum Equipment List: what may be broken and still fly |
| FDP / FTL | Flight duty period / flight time limitations |
| Commander's discretion | On-the-day FDP extension of up to +2 h |
| Augmented / heavy crew | Extra pilots plus on-board rest |
| Deadhead / positioning | Crew travelling as passengers; counts as duty |
| Pairing / rotation | Duties from base back to base |
| Nightstop | Rest away from base |
| Standby / reserve | On call; reserve has ≥10 h notice |
| SCCM / CSD / purser | Senior cabin crew member |
| Slot / CTOT | Airport slot / ATC take-off time |
| Permit / dip clearance / PPR | Landing or overflight permission / diplomatic clearance / prior permission required |
| GD / APIS | General declaration / passenger data for authorities |
| Tankering | Carrying extra fuel to avoid buying it at the destination |
| PNR | Point of no return (also passenger name record) |
| ETOPS | Twin-engine extended-range approval |
| C-check | Heavy hangar check |
| AOC / TCO | Air operator certificate / EASA third-country operator authorisation |
| IOSA | IATA operational safety audit |
| CRAF | US Civil Reserve Air Fleet |
| Preighter | Passenger aircraft carrying cargo in the cabin |
| Ihram / Miqat / Zamzam | Pilgrim state and garment / boundary announced on board / holy water carried home |

---

## 12. Sources

Deduplicated from the three research files and grouped by topic. One item (the Ascend sub-charter terms) is cited by title only because the fetch failed. The EU "7+7" third-country wet-lease limit is supported by the European Parliament report and UK CAA pages below, but its exact legal wording was not re-checked. Paywalled or unreachable pages (e.g. some ch-aviation articles) are cited from their headlines.

**Contracts, rates and charter terms**
- SmartLynx Malta–GlobalX A320 ACMI agreement (SEC, 2020): https://www.sec.gov/Archives/edgar/data/1846084/000119312521355341/d140617dex1011.htm
- GlobalX–Estelar ACMI agreement (2021): https://lawinsider.com/contracts/ir4PziFvxKK
- MGH definitions: https://fly2sky.aero/what-is-acmi/ · https://tradewind.org/NG/Hangars_NG/TA_L_NG/Air_Lease_definition.html
- Marathon ACMI hub (Cirium survey, lead times): https://flymarathon.aero/acmi-leasing/ · https://flymarathon.aero/acmi/how-does-acmi-leasing-compare-to-owning-or-dry-leasing-aircraft/
- Rate listings: https://avibroker.com/leaseavailability.asp · https://www.globalplanesearch.com/pages/So-Now-You-Have-Decided-to-Lease-an-Aircraft · https://flyinglease.com/acmi-a320/
- Air Charter Service guide to ACMI: https://aircharterservice.com/group-charter/guide-to-acmi
- Charter cancellation terms: https://tastingaustralia.com.au/media/rrrk1lia/platinum-aircraft-charter-terms-and-conditions.pdf · https://royalair.com/term-conditions · https://www.croatiaairlines.com/resources/documents/aircraft-charter-general-terms.pdf.pdf
- Charter hourly examples: https://jettly.com/post/rent-airbus · https://apsu.edu/procurement/vendors/bids/Analysis25020CharterFlightAthletic.pdf
- Ascend ACMI sub-charter T&Cs (title only): https://dev04.dev.aviasg.com/wp-content/uploads/2024/05/General-Terms-and-Conditions-Ascend-ACMI-Sub-Charter.pdf

**Market, lessors, results**
- ACC Aviation Q2 2026 ACMI analysis: https://www.blueskynews.aero/issue-850/ACC-Aviation-market-analysis-reveals-Q2-ACMI-downturn-but-continued-widebody-strength.html
- ACC Aviation 2025 review / insight: https://runwaygirlnetwork.com/2025/11/acc-aviation-tracks-industry-performance/ · https://accaviation.com/2025-acmi-market-insight-and-the-evolving-role-of-intermediaries-in-acmi-leasing/
- Cirium on ACMI utilisation: https://cirium.com/thoughtcloud/ascend-consultancy-a-deep-dive-into-acmi-utilization-by-airlines
- GTF engine issue and wet-lease demand: https://www.ajot.com/news/rtxas-engine-flaw-proves-to-be-a-boon-to-short-term-jet-rental-firms
- IBA values and lease rates (Sept 2024): https://www.iba.aero/resources/articles/aircraft-values-lease-rates-september-2024/
- Widebody shortage: https://www.eplaneai.com/news/is-the-world-facing-a-shortage-of-widebody-aircraft
- GlobalX FY2024 results: https://stocktitan.net/news/JETMF/global-crossing-airlines-reports-record-fourth-quarter-revenue-8hj15pxyz8hq.html
- Avia Solutions Group 9M 2024: https://www.stattimes.com/aviation/avia-solutions-group-revenue-up-25-to-2-billion-for-9m2024-1353835
- ASG sells SmartLynx / MAX order: https://www.ch-aviation.com/news/159686-avia-solutions-sells-smartlynx-to-consolidate-european-aocs

**Government, military, humanitarian, religious**
- UN EOI UNPD24436 (troop rotation, 2026): https://www.ungm.org/Public/Notice/301476 · UN long-term lease notice: https://www.ungm.org/Public/Notice/31772 · UN contract awards: https://www.un.org/Depts/ptd/contract-awards/hq-Contracts/pdc020117
- CRAF: https://www.amc.af.mil/About-Us/Fact-Sheets/Display/Article/144025/civil-reserve-air-fleet.aspx · https://www.law.cornell.edu/cfr/text/32/243.4 · https://airlinegeeks.com/2021/08/22/us-orders-airlines-to-assist-in-afghanistan-evacuation/ · https://www.businesswire.com/news/home/20210823005385/en/ATSG-to-Support-the-United-States-in-Afghanistan · https://prnewswire.co.uk/news-releases/omni-air-international-inc-receives-dod-carb-approval-to-operate-b777-200er-145338495.html
- ICE rates and contractors: https://qz.com/1761804/sole-airline-willing-to-deport-high-risk-immigrants-is-price-gouging-ice/ · https://democrats-homeland.house.gov/imo/media/doc/2025-05-28-t-weh-letter_to_csi_aviation.pdf · https://www.statista.com/chart/35096/monthly-ice-flights-by-flight-purpose
- UK–Rwanda / Privilege Style: https://righttoremain.org.uk/campaign-success-airline-pulls-out-of-rwanda-flight-plan/ · https://www.corpwatch.org/article/charter-airline-privilege-style-withdraws-contract-deport-asylum-seekers-uk-rwanda-victory · https://corporatewatch.org/?p=8691 · https://www.npr.org/2022/06/15/1105161913/u-k-cancels-first-flight-to-deport-asylum-seekers-to-rwanda · https://www.axios.com/2022/06/14/uk-rwanda-asylum-seekers-flight · https://arc-dev.theglobeandmail.com/world/article-airline-quits-british-plan-to-deport-asylum-seekers-to-rwanda-amid
- Frontex returns: https://www.statewatch.org/media/5018/frontex-evaluation-report-deportations-2nd-semester-2024.pdf · https://www.statewatch.org/media/3898/eu-frontex-scifa-presentation-returns-frontex-ro-20-4-23.pdf · https://www.statewatch.org/analyses/2025/frontex-and-deportations-2006-2024/ · https://www.bolsamania.com/noticias_print/empresas/economia--la-ute-air-europa-aeronoa-y-swiftair-se-adjudica-por-99-millones-los-vuelos-de-deportacion-de-inmigrantes--3306468.html
- Evacuations and seat charges: https://www.lbc.co.uk/news/brits-israel-land-cyprus-raf-charter-flight/ · https://www.politifact.com/factchecks/2024/oct/09/threads-posts/americans-in-lebanon-and-israel-had-to-pay-for-the · https://www.titan-airways.com/news/titan-airways-supports-sudan-repatriation/ · https://arabnews.com/node/2293851 · https://www.diplomatie.gouv.fr/en/country-files/sudan/news/article/sudan-continuing-operations-to-evacuate-nationals-24-april-2023-272759 · https://oldain.ainonline.com/aviation-news/air-transport/2021-09-09/qatar-airways-dispatches-five-evac-flights-kabul
- War-risk insurance: https://www.universiteitleiden.nl/binaries/content/assets/rechtsgeleerdheid/instituut-voor-publiekrecht/lucht--en-ruimterecht/mc-gill-workshop/paper-19.pdf · https://www.businessinsurance.com/aviation-war-insurers-cancel-some-cover-for-israel-lebanon-marsh-el-al/
- Humanitarian charters: https://www.ajot.com/news/air-charter-industry-steps-up-again-in-2024-responding-to-humanitarian-crises · https://www.aircargonews.net/?p=1058296 · https://www.ajot.com/news/chapman-freeborn-delivers-lifesaving-aid-to-turkey-and-syria
- Refugees and repatriation: https://www.canada.ca/en/immigration-refugees-citizenship/news/2022/05/federal-charter-flights-for-ukrainians-who-want-to-come-to-canada.html · https://portail-portal.otc-cta.gc.ca/en/fifth-seventh-freedom-charter-flights-approved-by-agency/434827 · https://reisetopia.de/news/ruckholaktion-funftel-berechnet/
- Hajj: https://www.aviacionline.com/garuda-indonesia-expands-fleet-for-hajj-operations-with-new-wet-leased-aircraft · https://www.ch-aviation.com/news/138176-garuda-indonesia-secures-hajj-2024-acmi-uplift · https://www.ch-aviation.com/news/116732-saudia-outlines-plans-to-deploy-14-aircraft-on-hajj-charters · https://www.ch-aviation.com/news/138240-indias-spicejet-to-wet-lease-in-two-a340s-for-hajj
- Sport and VIP: https://inside.fifa.com/tournaments/mens/worldcup/qatar2022/news/brazil-touchdown-completes-fifa-world-cup-qatar-2022-roll-call · https://www.travelguys.fr/en/2022/11/24/world-cup-2022-in-qatar-which-airlines-did-the-national-teams-fly-to-get-there-and-with-which-special-liveries/ · https://www.thejakartapost.com/news/2020/03/05/chartered-presidential-plane-only-for-long-haul-flights · https://capitalfm.africa/ruto-chartered-boeing-bbj2-south-africa-trip-presidential-jet-grounded/
- Payment disputes and crew stranding: https://www.ch-aviation.com/news/138631-mexicana-sued-for-841mn-for-breach-of-contract · https://www.sanews.gov.za/node/42681 · https://www.theafricanaviationtribune.com/2013/02/tanzania-now-canadas-avmax-aircraft.html · https://m.motoring.co.za/travel/thomas-cook-crew-left-stranded-forced-to-pay-for-own-hotels-33526018 · https://www.cnbc.com/2021/07/28/american-airlines-flight-attendant-union-summer-travel-complaint.html

**Operators**
- euroAtlantic: https://en.wikipedia.org/wiki/EuroAtlantic_Airways · https://flymag.com/euroatlantic-airways-shifts-toward-long-term-widebody-acmi-as-a330-fleet-grows/ · https://aviacionline.com/euroatlantic-airways-adquiere-dos-boeing-777-200er · https://www.ch-aviation.com/news/118542-portugals-euroatlantic-airways-retires-only-b737-800 · https://www.ch-aviation.com/news/109215-portugals-euroatlantic-partners-bahrains-mena-cargo · https://www.dn.pt/pais/quando-em-timor-viram-um-aviao-portugues-foi-um-alivio-um-aconchego-12039115.html · https://www.euroatlantic.pt/wp-content/uploads/2020/04/pt_03_04_2020.pdf · https://www.verangola.net/va/pt/042020/Sociedade/19568/Milhares-de-portugueses-regressam-a-casa-em-voos-que-transportam-ajuda.htm · https://www.verangola.net/va/en/032020/Transports/19091/Covid-19-Portuguese-EuroAtlantic-repatriation-plane-from-Angola-to-USA.htm
- GetJet / Airhub: https://en.wikipedia.org/wiki/GetJet_Airlines · https://www.aerotelegraph.com/with-such-a-capable-team-we-could-integrate-a-space-shuttle-into-our-aoc-and-no-one-would-be-surprised · https://www.traveldailynews.com/aviation/getjet-airlines-reports-165m-euros-revenue-in-2025/ · https://www.aviation24.be/acmi-operators/getjet-airlines/getjet-airlines-secures-long-term-acmi-deal-with-eurowings/amp/ · https://otc-cta.gc.ca/eng/ruling/a-2019-198 · https://immigration.ca/guidance-for-officers-on-assessing-reciprocal-employment-and-entries-via-wet-lease/ · https://en.wikipedia.org/wiki/Airhub_Airlines · https://ch-aviation.com/news/94683-maltas-airhub-airlines-launches-secures-us-facp · https://www.ch-aviation.com/news/115358-maltas-airhub-airlines-seeks-more-used-narrowbodies · https://www.aviation24.be/acmi-operators/airhub-airlines/airhub-aviation-adds-second-airbus-a340-300-eyes-fleet-expansion/
- Hi Fly: https://en.wikipedia.org/wiki/Hi_Fly_(airline) · https://www.adsgroup.org.uk/knowledge/industry-member-news/airbus-delivers-first-a330neo-in-hi-fly-livery/ · https://www.ch-aviation.com/news/165939-hi-fly-exits-a340-operations-after-nearly-20-years · https://thepointsguy.com/news/hifly-a380-wuhan-evacuation/ · https://www.flightradar24.com/blog/flight-tracking-news/special-event/hi-fly-says-bye-bye-to-its-a380-with-love/ · https://www.ch-aviation.com/news/98480-hi-fly-malta-ends-a380-operations · https://samchui.com/2021/11/22/hi-fly-lands-first-airbus-a340-in-antarctica/ · https://www.aviacionline.com/hi-fly-flew-again-to-antarctica-with-an-airbus-a340-300 · https://thepointsguy.com/news/hi-fly-repatriation-longest-flight-a340
- Wamos: https://en.wikipedia.org/wiki/Wamos_Air · https://wamosair.com/about-us/ · https://aviacionline.com/iberojet-wamos
- Privilege Style: https://www.airwaysmag.com/legacy-posts/privilege-style-20-years
- Titan: https://en.wikipedia.org/wiki/Titan_Airways · https://www.ch-aviation.com/news/101940-uks-titan-airways-to-operate-a321neo-for-the-government · https://ukdefencejournal.org.uk/private-firm-take-on-some-vip-transport-duties-from-raf/
- Air Atlanta: https://en.wikipedia.org/wiki/Air_Atlanta_Icelandic · https://www.aerotelegraph.com/tags/air-atlanta-icelandic · https://flightglobal.com/hidden-lift/52134.article · https://australianaviation.com.au/2016/05/iron-maidens-ed-force-one-touches-down-in-brisbane/ · https://www.aircharterservice.com/about-us/news-features/blog/backstage-on-ed-force-one
- Omni: https://en.wikipedia.org/wiki/Omni_Air_International
- National Airlines (Bagram): https://avweb.com/flight-safety/ntsb-loose-cargo-caused-fatal-747-crash/
- GlobalX: https://en.wikipedia.org/wiki/Global_Crossing_Airlines
- SmartLynx: https://en.wikipedia.org/wiki/SmartLynx_Airlines · https://cargoforwarder.eu/2025/12/14/insolvent-carrier-smartlynx-faces-corruption-charges · https://apps.eurofound.europa.eu/restructuring-events/detail/203833
- Icelandair in Antarctica: https://www.geaerospace.com/news/articles/product-technology/cool-operators-icelandair-pilots-land-boeing-passenger-jet-blue-ice · https://avgeekery.com/icelandair-767-in-antarctica/

**Regulation, FTL, ETOPS, permits**
- Reg. 83/2014 FTL text (EurECCA booklet): https://www.ufo-online.aero/images/rundumsfliegen/flugsicherheit/pdf/eurecca_ftl_booklet.pdf
- EASA FAQ, in-flight rest: https://www.easa.europa.eu/en/faq/47620
- EASA Easy Access Rules for Air Operations (ORO.FTL, ORO.CC.100): https://www.easa.europa.eu/en/document-library/easy-access-rules/easy-access-rules-air-operations
- FAA Part 117: https://www.law.cornell.edu/cfr/text/14/appendix-Table_B_to_part_117 · https://www.law.cornell.edu/cfr/text/14/appendix-Table_C_to_part_117 · https://www.law.cornell.edu/cfr/text/14/117.25
- Wet leasing: https://www.caa.co.uk/commercial-industry/aircraft/leasing/wet-and-damp-leasing · https://www.europarl.europa.eu/doceo/document/A-8-2018-0150_EN.html · https://eur-lex.europa.eu/eli/reg/2019/2/oj
- ETOPS / EDTO (CAAS AC 98-8-1): https://www.caas.gov.sg/docs/default-source/pdf/ac-98-8-1(rev-0)-extended-diversion-time-operations-(edto).pdf
- ULR: https://safetymaterials.argus.aero/wp-content/uploads/2023/07/PRISM-RESEARCH-BRIEF-Ultra-Long-Flights.pdf · https://www.caas.gov.sg/docs/default-source/pdf/ac121-11-2(rev-0)-fatigue-risk-management-for-ulr-operations.pdf
- Permits and diplomatic clearances: https://lfs.aero/capabilities/permits · https://image.mfa.go.th/mfa/0/bJrci1Rkbi/Service_Procedure/Dip._Flight_Clearance_Procedure.pdf · https://mzv.sk/en/web/en/ministry/diplomatic-guide/diplomatic-clearance-for-overflights-and-landings · https://government.is/ministries/ministry-for-foreign-affairs/protocol/diplomatic-clearance · https://defense.gouvernement.lu/en/demarches/autorisations-survol.html · https://likumi.lv/ta/en/starptautiskie-ligumi/id/1245

**Crew, pay, training**
- Crew ratios: https://www.tbsnews.net/node/306100 · https://gulfnews.com/business/aviation/air-india-to-hire-over-80-junior-pilots-for-wide-body-boeing-planes-1.2015755
- 777 cabin staffing: https://apfa.org/2017/10/23/10-23-17-laa-staffing-changes-on-ipd-flights-on-the-787-9-and-777-200 · https://www.flyertalk.com/forum/20958496-post2.html
- Pay: https://pilotsdb.brookfieldav.com/showjob/00723/ICAO---A320-Captains-Urgently-Needed-for-Avion-Express · https://www.pilotjobsnetwork.com/jobs/SmartLynx_Airlines · https://readyfortakeoffbook.com/blogs/pilot-conditions/getjet-airlines · https://www.cvbankas.lt/crewing-officer-vilniuje/1-14126040 · https://www.flightdeckfriend.com/job/hi-fly-non-rated-first-officers-a330-a340-rated-captains/
- Type ratings: https://rotatepilot.com/blog/how-much-does-type-rating-cost-2026 · https://www.sim.aero/training/type-rating/boeing-b777 · https://blog.aviationcv.com/top-10-faqs-about-the-type-rating-course-answered/

**Maintenance and operations**
- Aircraft Commerce maintenance guides: https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/A320%20FAMILY/ISSUE%2044-A320%20MTCE.pdf · https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/767%20FAMILY/ISSUE%2046-767%20MTCE.pdf · https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/A330-200-300/ISSUE57_A330_MTCE.pdf
- Maintenance checks overview: https://en.wikipedia.org/wiki/Aircraft_maintenance_checks
- Engine costs: https://aircargoweek.com/the-true-cost-of-engine-maintenance/ · https://airwaysmag.com/new-post/airline-engine-bills-rise-groundings-ease
- Turnarounds: https://ansperformance.eu/economics/cba/standard-inputs/latest/chapters/turnaround_time.html · https://www.oag.com/blog/science-aircraft-turnarounds

---

## 13. Cabin reconfiguration and refit costs (v0.7.4)

Researched October 2026 for the player's report that refits were far too expensive. Airlines and MROs rarely publish per-job prices, so the game's numbers are estimates built from the data points below; they are marked est. in `BAL.refit`.

**What the sources say**
- **Seat prices (2019 industry figures):** economy seats about $3,000–5,000 each; long-haul premium economy $10,000–15,000; standard business seats $60,000–100,000; premium lie-flat and first $150,000–300,000 and up (Alton Aviation Consultancy and Aircraft Interiors International, quoted by The Points Guy).
- **Labour on a narrowbody:** a 737-800 going from a two-class 158-seat cabin to a single-class 189-seat cabin takes "over 500 man-hours", plus new economy seats, windows, passenger service units and the paperwork (IBA). That is a *real* reconfiguration with new parts, not a move of existing seats.
- **Widebody retrofits:** seats are 20–30% of a two-class reconfiguration; monuments (galleys, lavatories, closets) and IFE follow (IBA). Emirates' in-house 777-300ER reseats averaged **23 days** of downtime per aircraft (Aircraft Interiors Expo, Ground Events data). Hawaiian's CEO put its 18-seat lie-flat A330 premium cabin at about **$1 million per aircraft** (seat price undisclosed; one source). Full programmes with new monuments run to many millions per aircraft and weeks of downtime; a heavy retrofit done with a C-check can take months.
- **Quick changes:** ACMI and charter operators switch between high-density and two-class layouts with movable class dividers and convertible seats (Cyprus Airways' charter/ACMI A320s; KlasJet adds a business cabin for ACMI customers "as customers need"). Seat-maker patents describe convertible rows (seven economy seats into six business seats) made exactly to avoid the "at least overnight" out-of-service time of a seat swap. The player (a former euroAtlantic flight attendant on 767/777) remembers a client seat change being done in **48 hours**.

**Game model (`BAL.refit`, `ops/cabin.ts refitTerms`)**

| Job | What it is | Narrowbody | Widebody |
|---|---|---|---|
| Quick reconfiguration (all-economy ↔ two-class, three-class) | seats we hold (convertible business seats, stored rows), moved class divider and curtains, re-pitch, LOPA / weight-and-balance paperwork; ~150–250 man-hours narrow, 400–700 wide | 2 days, $30,000 (all-economy) / $40,000 (two-class) | 2 days, $80,000 / $95,000; three-class 3 days, $140,000 |
| Partial refresh (documented, not a game option) | new covers, carpets, curtains, re-foam, existing seats | ~1 week, $150,000–300,000 | ~1–2 weeks, $0.4–0.8M |
| Full retrofit with new premium seats (the game's VIP cabin) | new business / lie-flat seats ($60–100k each), monuments, wiring, certification | 21 days, $1.6M (24 seats of business) | 28 days, $4.0M (30–48 business seats) |

Was (v0.7–v0.7.3): 5–7 days and $120–250k for a narrowbody layout change, 14–28 days and $0.6–2.2M on a widebody: the price and time of new-seat retrofits for what charter operators do with seats they already hold.

**Crew rest refits (re-checked, unchanged except bunks as a pair):** curtained business and economy seats need no refit any more (they come with the cabin). Crew rest recliners with leg rests $100k narrow / $220k wide (3–4 days); the pilots' rest compartment plus a lower-deck module for the cabin crew (A330/A340) $2.8M with a C-check (+12 days; the A330 FCRC is a C-check job at $1.5–2.5M, the lower-deck module about $1M); overhead compartments for both crews (777/787/A350/747) $2.6M (+14 days). The 767-300ER never has bunks (the player's experience; the game's 767s rest crew in curtained seats).

**Client cabin requests (`BAL.clientCabin`):** long season bases (30% from 120 days, 15% from 60), capacity leases (20%) and long tour series (6%) may ask for a cabin within the layouts the work accepts; half are a condition of the deal; the client pays all (70%) or half (30%) of the quick reconfiguration, and in 70% of requests also of putting it back. An optional request declined costs 2–4% of the rate.

**Sources**
- IBA, "Narrowbody aircraft reconfiguration trends": https://www.iba.aero/news/narrowbody-aircraft-reconfiguration-trends/
- IBA, "Widebody aircraft reconfiguration trends": https://www.iba.aero/news/widebody-aircraft-reconfiguration-trends/
- The Points Guy, "How much do airplane parts cost" (seat prices, Alton Aviation / Aircraft Interiors International, 2019): https://thepointsguy.com/news/how-much-do-airplane-parts-cost-from-4-amenity-kits-to-1000000-first-class-seats
- Aircraft Interiors Expo, "Airlines chase the sweet spot cabin with Boeing 777-300ER retrofits" (Emirates 23-day average downtime): https://www.aircraftinteriorsexpo.com/en-gb/blog/industry-insights/airlines-boeing-777-300er-retrofits.html
- KHON2 (Hawaiian Airlines CEO Mark Dunkerley: the A330 lie-flat retrofit "about $1 million per plane", 18 lie-flat seats, 294 → 278 seats; date not shown, single source): https://digital-release.khon2.com/?p=25910 · rollout context: https://futuretravelexperience.com/2016/05/hawaiian-airlines-welcomes-first-a330-featuring-lie-flat-premium-seating
- Cyprus Airways, Charters & ACMI (curtain-divider layout switches, short-notice mobilisation): https://www.cyprusairways.com/en/charters-acmi
- KlasJet, "Reconfigures ACMI aircraft for business class accommodation": https://klasjet.aero/klasjet-reconfigures-acmi-aircraft-for-business-class-accommodation/
- Boeing convertible seating patent (seven economy → six business per row): https://patents.justia.com/patent/5284379 · convertible seat patent noting seat swaps take the aircraft out of service "at least overnight": https://patents.google.com/patent/US5509722A
- Sofema, EASA CS-25 practical examples for cabin reconfigurations (LOPA / AICD paperwork): https://sassofia.com/wp-content/uploads/2024/11/EASA-CS-25-Practical-Examples-Related-to-Cabin-Re-Configurations.pdf

## 14. New types for the v0.10 art (October 2026)

Game start April 2027. Figures in the game's units (src/data/acmiTypes.ts), calibrated against the existing types
(ACMI rate per block hour, rent per month for a mid-life frame, fuel t per block hour). Exit limits from the type
certificate / manufacturer tables. Crew numbers (minimum and maximum cabin crew, cockpit seats): §15, which replaces
the "1 per 50 seats" rule this section first used.

| Type | Seats (presets / exit limit) | Range full payload | Cockpit | Notes |
|---|---|---|---|---|
| 737-900ER | 215Y, 16J/164Y / 220 (extra exit pair) | 2,500 nm | 2 | 2007–2019; long take-off run; priced at the A321ceo's rate band |
| 757-300 | 280Y, 24J/219Y / 295 | 3,000 nm | 2 | 55 built 1999–2004; slow turns (one aisle, 54 m); rare: never the pricing reference |
| A330-900 | 28J/260Y, 440Y / 460 | 6,500 nm | 2 | EIS 2018, Trent 7000, ETOPS 285; in demand |
| A340-200 | 30J/231Y, 300Y / 375 (8-abreast) | 6,700 nm | 2 | 28 built 1993–1998, mostly VIP/government now |
| A340-500 | 36J/277Y, 64J/117W / 375 | 8,500 nm | 4 on ULR | 2002–2012, SIN–EWR; none in airline service (May 2025) |
| A340-600 | 32J/320Y, 420Y / 440 (8-abreast) | 7,000 nm | 2 | 97 built 2002–2011; ~33 in service 2024 |
| A350-1000 | 40J/330Y, 36J/24W/290Y / 480 | 7,400 nm | 2 | EIS 2018; very few with lessors |
| 787-8 | 24J/224Y, 330Y / 359 | 6,200 nm | 2 | EIS 2011 |
| 787-10 | 32J/302Y, 400Y / 440 | 5,600 nm | 2 | EIS 2018, Charleston only |
| 747-8 | 36J/24W/340Y, 24J/476Y / 605 | 7,300 nm | 2 | passenger deliveries 2012–2017; two pursers |
| 777-9 | 42J/24W/360Y, 48J/400Y / 495 | 6,900 nm | 2 | first delivery expected 2027 (Lufthansa): new-build slots only, scarcity 0.995 |
| 777-8 | 42J/28W/280Y, 60J/40W/150Y / 440 | 8,400 nm | 4 on ULR | first delivery not before 2030: firstYear 2030 |
| 747-100 / -200 / -300 | 32J/360Y, 480Y / 550 (-300: 32J/400Y, 520Y / 660) | 4,300 / 5,500 / 5,600 nm | 2 in the game | 1970–1986 / 1971–1991 / 1983–1990; JT9D-era engines, Chapter 3 at best. Real ones had a flight engineer; here two pilots fly it (v0.10, the player's choice). On the market, very rare |

Airframe variants (src/data/variants.ts): A330-200 Trent 700 vs CF6-80E1 / PW4168; 747-400 PW4056 / CF6-80C2 vs
RB211-524G/H; A321neo Airbus Cabin Flex (door 2 replaced by overwing exits, 244 seats under EASA) vs the first
builds' four door pairs (230, 2017–2019). Rare old types (757-300, A340-200/-500/-600) are never used to size or
price work (pricing.ts RARE): the market prices off mainstream types.

Sources: Airbus A340 specifications and service history (Wikipedia, "Airbus A340", exit limits 375/440/475,
deliveries, Feb 2026 fleet); Boeing 747 (Wikipedia, "Boeing 747": three-person classic cockpit, -200B data); Aircraft
Commerce 747-200/-300 owner's guide (aircraft-commerce.com, -300 production 1983–1990, 81 built); A321neo Cabin Flex
(runwaygirlnetwork.com 2018-03-06 "Flexible door distribution…", samchui.com first ACF delivery 2018; 220 → 240/244);
777X timing (Boeing feature "Lufthansa's first 777-9 takes flight", May 2026; airdatanews.com: certification 2026,
first deliveries 2027; Boeing Q1 2024 report: 777-8 not before 2030); manufacturer type data for ranges and seating.

## 15. Crew numbers per type (v0.10, October 2026)

The player (a former ACMI flight attendant: euroAtlantic 767/777, Getjet/Airhub A320/A330) found the game using only
"one cabin crew per 50 seats": an A340-200 at 375 seats needs 8 cabin crew, not 6. Researched again for every type.

**The rule (what the engine does: `perf.ts cabinMinimum`).**
- EASA Air Ops ORO.CC.100(b): the minimum cabin crew is the greater of (1) the number established during the aircraft
  certification process for the cabin configuration used by the operator, and (2) one cabin crew member for every
  50, or fraction of 50, passenger seats installed **on the same deck**. Quoted in EASA CM-CS-008 Issue 01 (2017).
- After CM-CS-008, EASA amended the type certificate data sheets to state the certified number. A lower number needs
  an EASA-approved change or STC; the game never uses one.
- FAA 14 CFR 121.391: 1 flight attendant for 20–50 seats, 2 for 51–100, then one more per 50 seats or part of 50; if
  the evacuation demonstration used more, that number in the maximum configuration and the excess in smaller ones.
  The EASA tables give the same or more for every type here, so the game uses the EASA numbers.
- Two-deck aircraft (747, A380): each deck is counted on its own. The game puts a share of the seats upstairs
  (747-400 / -8: 12 %, at most 110; 747-100/-200: 7 %, at most 45; 747-300: 13 %, at most 110; A380: 40 %, at most
  330), an estimate of real cabins.
- Where the certified table lists a number for a configuration, the game applies it to every cabin up to that many
  seats ("irrespective of the MOPSC" in the A350 TCDS; the A330/A340/777 tables start at 8 for "400 or fewer"),
  so a 30J/150Y VIP A330 still flies 8 cabin crew.
- **Maximum cabin crew** = the cabin crew seats (jump seats). Optional extra cabin crew (the Extra cabin controls) stop
  there; crew the client requires or pays for beyond them, and the in-flight rest plan's extra crew, sit in
  passenger seats, which are blocked (not sold, offloaded at departure with compensation). Jump-seat counts are not
  published in the TCDS (they are in each aircraft's LOPA): **estimated** from the door/exit pairs (one double seat
  per floor-level exit pair and side on widebodies, plus usual galley seats) and checked against operators' crew
  sizes (A330-300: 12 single seats in a training deck; Emirates flies 22–25 cabin crew on its A380s).
- **Cockpit**: minimum flight crew 2 (pilot and co-pilot) for every type in its TCDS; the 747-100/-200/-300 TCDS
  says three (pilot, co-pilot and flight engineer): in the game two pilots fly it (the player's choice; the catalog
  says "Real ones had a flight engineer; here two pilots fly it."). Observer seats behind the pilots: 1 on the
  A320 and 737 families (a 4th occupant seat is an option), 2 on the 757 and the widebodies (**estimated**, typical
  delivered configurations). Relief and spare pilots beyond them sit in the cabin (blocked seats).

**The table.** Exit limit (before → after where it changed); the certified floor (main deck, and upper deck for the
two-deck types) by installed seats; the minimum for each cabin preset (before → after); cabin crew seats; cockpit.

| Type | Exit limit | Certified cabin crew (installed seats: crew) | Minimum per preset (was → now) | Cabin crew seats | Cockpit | Estimated |
|---|---|---|---|---|---|---|
| A320ceo | 186 | ≤150: 3, ≤195: 4 | 180Y 4; 12J/156Y 4; 24J/90Y 3 | 6 | 2 + 1 obs. | (est.: seats, observers) |
| 737-800 | 189 | ≤100: 2, ≤150: 3, ≤189: 4 | 189Y 4; 12J/162Y 4; 24J/90Y 3 | 5 | 2 + 1 obs. | (est.: seats, observers) |
| A321ceo | 230 | ≤200: 4, ≤230: 5 | 220Y 5; 16J/180Y 4; 28J/110Y 3→4 | 7 | 2 + 1 obs. | (est.: seats, observers) |
| A321neo (LR) | 244 | ≤149: 3, ≤200: 4, ≤244: 5 | 220Y 5; 16J/190Y 5; 28J/110Y 3 | 6 | 2 + 1 obs. | (est.: seats, observers) |
| 757-200 | 239 | — (1 per 50) | 235Y 5; 16J/184Y 4; 28J/120Y 3 | 7 | 2 + 2 obs. | (est.: seats, observers) |
| 767-300ER | 351 | — (1 per 50) | 16J/251Y 6; 309Y 7; 32J/140Y 4 | 9 | 2 + 2 obs. | (est.: seats, observers) |
| A330-200 | 406 | ≤400: 8, ≤406: 9 | 18J/282Y 6→8; 330Y 7→8; 36J/150Y 4→8 | 12 | 2 + 2 obs. | (est.: seats) |
| A330-300 | 440 | ≤400: 8, ≤440: 9 | 24J/326Y 7→8; 440Y 9; 40J/200Y 5→8 | 12 | 2 + 2 obs. | (est.: seats) |
| A340-300 | 375→440 | ≤400: 8, ≤440: 9 | 30J/270Y 6→8; 335Y 7→8; 40J/150Y 4→8 | 12 | 2 + 2 obs. | (est.: seats) |
| 777-200ER | 440 | ≤400: 8, ≤440: 9 | 30J/24W/239Y 6→8; 400Y 8; 40J/180Y 5→8 | 14 | 2 + 2 obs. | (est.: seats) |
| 777-300ER | 550 | ≤500: 10, ≤550: 11 | 42J/358Y 8→10; 450Y 9→10; 48J/200Y 5→10 | 16 | 2 + 2 obs. | (est.: seats) |
| 787-9 | 420 | ≤300: 6, ≤350: 7, ≤400: 8, ≤420: 9 | 28J/262Y 6; 330Y 7; 38J/150Y 4→6 | 12 | 2 + 2 obs. | (est.: seats) |
| A350-900 | 440 | ≤400: 8, ≤440: 9 | 32J/288Y 7→8; 369Y 8; 40J/170Y 5→8 | 12 | 2 + 2 obs. | (est.: seats) |
| A350-900ULR | 440 | ≤400: 8, ≤440: 9 | 67J/94W 4→8; 42J/24W/187Y 6→8; 40J/110Y 3→8 | 12 | 2 (4 on ULR) + 2 obs. | (est.: seats) |
| A380-800 | 853→868 | main ≤500: 10, ≤538: 11; upper ≤300: 6, ≤330: 7 | 12J/459Y 10→16; 60J/411Y 10→16; 48J/210Y 6→16 | 24 | 2 + 2 obs. | (est.: seats) |
| 747-400 | 660 | main ≤550: 11; upper ≤45: 1, ≤100: 2, ≤110: 3 | 24J/426Y 9→13; 500Y 10→13; 48J/230Y 6→12 | 18 | 2 + 2 obs. | (est.: seats) |
| 737-900ER | 220 | ≤100: 2, ≤150: 3, ≤200: 4, ≤220: 5 | 215Y 5; 16J/164Y 4; 28J/110Y 3 | 6 | 2 + 1 obs. | (est.: seats, observers) |
| 757-300 | 295 | — (1 per 50) | 280Y 6; 24J/219Y 5; 28J/140Y 4 | 8 | 2 + 2 obs. | (est.: seats, observers) |
| A330-900 | 460 | ≤400: 8, ≤440: 9, ≤460: 10, ≤465: 12 | 28J/260Y 6→8; 440Y 9; 42J/200Y 5→8 | 12 | 2 + 2 obs. | (est.: seats) |
| A340-200 | 375→420 | ≤400: 8, ≤420: 9 | 30J/231Y 6→8; 300Y 6→8; 38J/140Y 4→8 | 12 | 2 + 2 obs. | (est.: seats) |
| A340-500 | 375 | ≤375: 8 | 36J/277Y 7→8; 64J/117W 4→8; 34J/140Y 4→8 | 12 | 2 (4 on ULR) + 2 obs. | (est.: seats) |
| A340-600 | 440 | ≤400: 8, ≤440: 9 | 32J/320Y 8; 420Y 9; 40J/190Y 5→8 | 14 | 2 + 2 obs. | (est.: seats) |
| A350-1000 | 480 | ≤400: 8, ≤440: 9, ≤460: 10, ≤470: 11, ≤480: 12 | 40J/330Y 8; 36J/24W/290Y 7→8; 44J/170Y 5→8 | 14 | 2 + 2 obs. | (est.: seats) |
| 787-8 | 359→381 | ≤300: 6, ≤350: 7, ≤381: 8 | 24J/224Y 5→6; 330Y 7; 34J/150Y 4→6 | 10 | 2 + 2 obs. | (est.: seats) |
| 787-10 | 440 | ≤300: 6, ≤355: 8, ≤440: 9 | 32J/302Y 7→8; 400Y 8→9; 40J/180Y 5→6 | 12 | 2 + 2 obs. | (est.: seats) |
| 747-8 | 605 | main ≤440: 9, ≤495: 10; upper ≤45: 1, ≤100: 2, ≤110: 3 | 36J/24W/340Y 8→11; 24J/476Y 10→11; 48J/230Y 6→10 | 20 | 2 + 2 obs. | (est.: seats) |
| 777-9 | 495 | ≤500: 10 | 42J/24W/360Y 9→10; 48J/400Y 9→10; 44J/200Y 5→10 | 16 | 2 + 2 obs. | (est.: floor, seats, maxSeats) |
| 777-8 | 440 | ≤400: 8, ≤440: 9 | 42J/28W/280Y 7→8; 60J/40W/150Y 5→8; 40J/160Y 4→8 | 14 | 2 (4 on ULR) + 2 obs. | (est.: floor, seats, maxSeats) |
| 747-100 | 550 | main ≤550: 11; upper ≤45: 1 | 32J/360Y 8→12; 480Y 10→12; 48J/220Y 6→12 | 16 | 2 + 2 obs. | (est.: floor, upper, seats) |
| 747-200 | 550 | main ≤550: 11; upper ≤45: 1 | 32J/360Y 8→12; 480Y 10→12; 48J/220Y 6→12 | 16 | 2 + 2 obs. | (est.: floor, upper, seats) |
| 747-300 | 660 | main ≤550: 11; upper ≤45: 1, ≤100: 2, ≤110: 3 | 32J/400Y 9→13; 520Y 11→13; 48J/230Y 6→12 | 17 | 2 + 2 obs. | (est.: floor, upper, seats) |

**Sources (all read October 2026; the EASA PDFs are the current issues on easa.europa.eu)**
- EASA CM-CS-008 Issue 01, "Determination of the number of cabin crew… for evacuation certification" (quotes
  ORO.CC.100 and explains the TCDS amendment): https://www.easa.europa.eu/sites/default/files/dfu/EASA%20CM-CS-008%20Issue%2001.pdf
- EASA FAQ, "Determination of the minimum required number of cabin crew on an aircraft" (the certified number is in
  the TCDS or STC; lower numbers only with an STC): https://www.easa.europa.eu/en/the-agency/faqs/minimum-required-cabin-crew
- EASA TCDS A.064 Airbus A318/A319/A320/A321 Issue 62 (26 June 2026), §20 tables: A320 MPSC 195 (C* exits) / 180 → 4,
  150 → 3; A321 230 / 220 → 5, 200 → 4, Cabin Flex 244 → 5, 149 → 3: https://www.easa.europa.eu/en/downloads/16507/en
- EASA TCDS IM.A.120 Boeing 737 Issue 29 (16 Dec 2025), §19: 737-800 151–189 → 4, 101–150 → 3, ≤100 → 2 (max 189);
  737-900ER 216–220 → 5, 201–215 → 5, 190–200 → 4 (max 220): https://www.easa.europa.eu/en/downloads/7297/en
- EASA TCDS IM.A.205 Boeing 757 Issue 06 (6 Nov 2024): no cabin crew number, "Refer to FAA TCDS A2NM" for seating:
  https://www.easa.europa.eu/en/downloads/7246/en · 757 exit limits 239 (four door pairs) / 224 (overwing exits) and
  757-300 295 (Wikipedia "Boeing 757", citing Boeing): https://en.wikipedia.org/wiki/Boeing_757
- EASA TCDS IM.A.035 Boeing 767 Issue 11 (4 Feb 2025), 767-300 §30 Exits: A-A-I-A 351, A-III-III-A or A-A-III-A 290;
  no cabin crew number (so 1 per 50): https://www.easa.europa.eu/en/downloads/7454/en
- EASA TCDS A.004 Airbus A330 Issue 69 (19 Dec 2025), §18: A330-200 406 (A-A-A-A) → 9, 400 → 8, 375 (A-A-I-A) → 8;
  A330-300 440 → 9, 400 → 8, 375 → 8; A330-900 "8 (2 per exit pair) irrespective of the MOPSC", 9 above 400 seats
  with four Type A pairs, a third cabin crew member at each Type A+ pair (465 max with four A+ pairs, 460 with two):
  https://www.easa.europa.eu/en/downloads/7518/en
- EASA TCDS A.015 Airbus A340 Issue 28 (15 Jan 2026), §18: A340-200 420 (A-A-A-A, MOD 40161) → 9, 400 → 8, 375 basic
  → 8; A340-300 440 → 9, 400 → 8, 375 → 8; A340-600 440 → 9, 400 → 8; A340-500 375 → 8:
  https://www.easa.europa.eu/en/downloads/19823/en
- EASA TCDS A.151 Airbus A350 Issue 32/33 (2026), §2.4: A350-900 and -1000 "8 … irrespective of the MOPSC", 9 above
  400 seats, a third cabin crew member at each Type A+ pair; A350-1000 up to 480 with four A+ pairs:
  https://www.easa.europa.eu/downloads/17736/en
- EASA TCDS A.110 Airbus A380 Issue 17 (5 Aug 2026), §3.8–3.9: 868 (upper 330, main 538); upper deck 301–330 → 7,
  ≤300 → 6 (+1 at the forward stair above 30 seats ahead of door U1: not modelled), main deck 501–538 → 11, ≤500 → 10:
  https://www.easa.europa.eu/en/downloads/7309/en
- EASA TCDS IM.A.003 Boeing 777 Issue 20.0 (13 May 2026), §23–24: 777-200/-200ER 401–440 → 9, ≤400 → 8 (max 440);
  777-300ER 501–550 → 11, ≤500 → 10 (max 550); 777-200LR as the -200: https://www.easa.europa.eu/en/downloads/7521/en
- EASA TCDS IM.A.115 Boeing 787 Issue 30 (17 Dec 2025), §19–20: 787-8 381 (A,A,A,A) → 8, 350 → 7, 300 → 6;
  787-9 420 → 9, 400 → 8, 355 → 8, 350 → 7, 300 → 6; 787-10 440 → 9, 355 → 8, 300 → 6:
  https://www.easa.europa.eu/en/downloads/7302/en
- EASA TCDS IM.A.196 Boeing 747 Issue 19 (17 Dec 2024): 747-400 §19 main deck 550 (five Type A pairs) → 11, upper deck
  110 → 3, 100 → 2, 45 → 1 (max 660); 747-8 main 495 (C,A,A,A,A) → 10, 440 (C,A,A,A,C) → 9, upper as the -400 (max
  605); 747-100/-200/-300 §17: minimum flight crew three (pilot, co-pilot, flight engineer), "one attendant is required
  at each No. 3 over-wing exit … at least one flight attendant on the upper deck", no certified number; limits 550
  (-100/-200 five Type A pairs; upper deck 45 with SC 25-71-NW-3) and 660 (-300): https://www.easa.europa.eu/en/downloads/7250/en
- FAA 14 CFR 121.391 Flight attendants: https://www.ecfr.gov/current/title-14/chapter-I/subchapter-G/part-121/subpart-K/section-121.391
- Crew sizes in practice (for the seat estimates only): Online Aviation Training, "How many cabin crew does an airline
  need?" (2026: A330-300 eight cabin crew effective minimum, nine at Atlántico; the floor-exit attendance argument):
  https://oat.aero/2026/07/03/how-many-cabin-crew-does-airline-need/ · Airliners.net crew-size threads (777-300ER legal
  minimum 10; 747-400 14–15 in service; A380 16 minimum, 20–24 flown): https://www.airliners.net/forum/viewtopic.php?t=1344749

**Estimated (no published number found)**
- Cabin crew seats of every type (the LOPA, not the TCDS, has them): the values above.
- Cockpit observer seats (1 narrowbody, 2 widebody).
- 777-8 and 777-9: not certified yet (the 777-9 is in its last certification phase, first delivery expected 2027;
  Wikipedia "Boeing 777X", June 2026). Floors taken from the 777-200ER (777-8) and 777-300ER (777-9); exit limits 440
  and 495 as before (estimates).
- 747-100/-200/-300: no certified cabin crew number; the 747-400 tables used for the same five Type A main-deck
  pairs and upper-deck exits.
- The upper-deck share of the seats on the 747s and the A380.

**Changes (before → after)**
- Minimum cabin crew at the default cabin: A330-200 6 → 8, A330-300 7 → 8, A330-900 6 → 8, A340-200 6 → 8, A340-300
  6 → 8, A340-500 7 → 8, A350-900 7 → 8, A350-900ULR 4 → 8, A350-1000 and A340-600 8 (same), 777-200ER 6 → 8, 777-300ER 8 → 10,
  777-8 7 → 8, 777-9 9 → 10, 787-8 5 → 6, 787-10 7 → 8, A380 10 → 16, 747-400 9 → 13, 747-8 8 → 11, 747-100/-200 8 →
  12, 747-300 9 → 13; narrowbodies, the 757s, the 767 and the 787-9 unchanged (their certified numbers equal 1 per 50,
  or none is published). Every preset is listed in the table.
- Exit limits: A340-200 375 → 420 and A340-300 375 → 440 (the four Type A door option, as the game already does for
  the A330s), 787-8 359 → 381, A380 853 → 868.
- New: cabin crew seats and cockpit observer seats per type; the Extra cabin steppers stop at the seats; crew beyond
  them take passenger seats.
- 777-200LR removed (the player's choice); 747-100/-200/-300 on the market with two pilots.

## 16. Registration, model and fleet-number marks (v0.11 livery pass, October 2026)

The player: "the registrations are off in every aircraft". Researched where airlines really put them, then measured
the reference side views (Cathay 747-400/777-200/777-300ER, KLM 777-200, a 737-700 and a 787-8 side view used for
placement only, nose left, mirrored for the game's nose-right art).

**The rules (what is regulated)**
- ICAO Annex 7 §4.3.2: on heavier-than-air aircraft the marks go on both sides of the fuselage between the wings and
  the tail surface, or on the upper halves of the vertical tail surfaces. §4.3.1 (one set under the left wing) and
  §5.2.2 (marks on the fuselage and fin at least 30 cm high) also apply. §4.1: the marks must be painted on, or fixed
  just as permanently, and kept clean and visible. Overview: https://applications.icao.int/postalhistory/annex_7_aircraft_nationality_and_registration_marks.htm
  · New Zealand compliance checklist for Annex 7, Amendment 7 (25 August 2025; quotes §4.1, §4.3.1 and §5.2.2): https://www.aviation.govt.nz/assets/about-us/icao/annex-07-a7.pdf
- FAA 14 CFR 45.25: marks on the vertical tail, or horizontally on both sides of the fuselage between the trailing edge
  of the wing and the leading edge of the horizontal stabiliser. 14 CFR 45.29: at least 12 in (30 cm) high on
  fixed-wing aircraft, with every character the same height, width, thickness and spacing on both sides:
  https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-45/subpart-C/section-45.29
- Europe follows Annex 7 through each state's register (no EASA rule moves the marks). The regulations stop there:
  which part of that span, above or below the windows, is the operator's choice. Explainer:
  https://en.wikipedia.org/wiki/Aircraft_livery

**Practice (what the references and the spotting record show)**
- Airliners carry the registration on the rear fuselage, close to the last door. FlyerTalk, "all airliners have the
  ID painted on the fuselage near the rear door": https://www.flyertalk.com/forum/30597781-post6.html (forum, matches
  every reference).
- **Narrowbodies** (737, A320 family, 757): above the window line, just aft of the last door, in the space between
  the door and the stabiliser. The 737 reference: the registration sits aft of door 2L and above the windows. Its cap
  is 8 px against 6–7 px windows, about 1.2 window heights. The country flag sits by the titles or the registration.
- **Widebodies**: forward of the last door. The 787 reference puts it below the windows, with the model mark
  ("Dreamliner") on the same line just forward of it. On the 787 the dark tail wrap and the raked wing leave little
  clean paint above the windows. The registration's cap is 8 px against 7 px windows, about 1.15 window heights.
  Cathay and KLM's 777s and 747s put it above the windows forward of the last door, with the model mark nearby. Cathay
  sometimes puts it aft of the door; the game uses the forward spot.
- **Fleet numbers**: some airlines repeat a short code at the top of the fin and on the nose-gear door. That is the
  last two or three characters of the registration (Aer Lingus, AeroMexico's "CYM" and "782"), or a fleet number
  (Air Canada's "801"). FlyerTalk: https://www.flyertalk.com/forum/30597683-post5.html · https://www.flyertalk.com/forum/30597781-post6.html
- The ink contrasts with the paint under it: dark on white, white on a dark tail wrap (the 737 reference's white
  registration on the navy wrap).

**What the game does (`stickers.ts extraDecals`; the last door is measured from the art in `sprites.py layout`)**
- Narrowbodies: the registration sits above the windows. Its nose end is 0.7 window heights aft of the last door,
  and it steps up when the paint under it changes colour. The model mark goes on the same line, just forward of the
  last door. The flag
  goes just aft of the registration if that is clear of the stabiliser, otherwise just forward of it. When neither
  fits, there is no flag. The cap is 1.0 window height.
- 787s: the registration goes below the windows, forward of the last door, with the model mark just forward of it on
  the same line, as on the reference.
- Other widebodies: the registration goes above the windows, forward of the last door, with the flag between them.
  The model mark goes on the same baseline, just aft of the last door. The cap is 1.15 window heights.
- Measured from the art (`scripts/sprites.py`): the last passenger door, as two frame lines with a frame edge at the
  top and at the sill (A330-900 and 747-8 set by hand; on the A380 the upper deck's door, where its marks go). Also
  the stabiliser's forward edge, and boxes of unpainted airframe over the tube (wing, winglet, stabiliser). No mark
  sits on the door or on those boxes.
- When a tail wrap leaves no clean spot forward of a widebody's last door, the registration goes aft of the door
  and the model forward of it.
- Every mark looks for one clean colour under itself and takes contrasting ink (the livery's colour when it
  contrasts, otherwise dark on light and white on dark). Weight is regular (500). The model cap is 0.55 of a window
  height.
- Options (Livery editor, Text tab):
  - "On the fin": the registration goes on the lower fin.
  - "Fleet number": the last three characters of the registration at the fin top. Off by default; client recipes
    that use one turn it on.
  - Model mark: "by the registration" (default), "forward" (the old spot under the forward windows) or "none".

**Estimated**
- The 1.0 and 1.15 window-height caps are rounded down from the measured 1.15–1.2, so the marks stay inside the
  paint on the game's small sprites. The real 30 cm minimum is close to one cabin window's height.
- Flag size and gap (one registration cap tall, half a cap apart).
