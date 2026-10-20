# R2: Operations, Crew and Regulation for an ACMI simulator

Research for an ACMI / wet-lease / charter airline simulator in which the player is CEO, head of HR, crew planner and maintenance controller.

**Confidence tags:**
- **[S]** comes from a cited source. Regulation text is quoted or closely paraphrased.
- **[K]** is well-established industry or regulatory knowledge that wasn't re-fetched this session. It is reliable but should be verified before being quoted as law.
- **[E]** is an estimate or designer assumption: a plausible range for gameplay, not a fact.

Last researched: Oct 2026.

---

## 0. Ten things that make it feel real

1. **Operational control stays with the ACMI lessor.** The aircraft flies on the lessor's AOC under the lessor's crew, maintenance and insurance, but carries the client's flight number, uses the client's slots and sells the client's tickets. The client pays per block hour (BH) and covers fuel, airport, navigation and handling charges. [K]
2. **Duty hours are the binding constraint, not aircraft.** EASA FTL caps a 2-pilot day at 13:00 FDP at best and as little as 9:00. Long-haul needs 3–4 pilots and a bunk to stretch to 16–18 h. [S]
3. **Rest away from base is 10 h or the length of the previous duty, whichever is longer.** After a long-haul FDP with in-flight rest, or a ≥4 h time-zone shift, it rises to 14 h. This decides whether a "there-and-back" is legal or forces a slip crew and a hotel. [S]
4. **Every crew member needs 36 h off, including 2 local nights, at least every 168 h,** plus 7 days off per calendar month. Crews on a client base for 4–6 weeks still need these. [S]
5. **Third-country wet lease into the EU is "exceptional".** It needs prior approval and is capped at 7 months, renewable once ("7+7"). EU AOCs (Malta, Lithuania, Latvia, Portugal) are therefore valuable. [S]
6. **ETOPS approval unlocks oceans for twins.** Without it a 767 or 777 must stay within 60 min of an adequate airport. 120 → 180 min typically needs about 12 months of in-service experience. [S]
7. **Seasonality runs everything.** Summer (Apr–Oct) is high season with ACMI to European carriers, and pilot pay runs about 40–60 % higher than in winter. Winter is for heavy checks, Hajj, southern-hemisphere work and training. [S/E]
8. **AOG away from home is a crisis.** Engineers, parts and sometimes a rescue aircraft or a sub-charter from a competitor must be flown in, at the lessor's cost. [K/E]
9. **Crew morale is fragile.** Long rotations, winter pay cuts, agency contracts and unpaid salaries drive crews out. SmartLynx collapsed in Nov 2025 with two months of salaries unpaid. [S]
10. **Recurrent training eats capacity.** Each pilot has two simulator checks a year, plus an annual line check and an annual emergency-equipment course. A new type costs $35–65 k per pilot and 4–6 weeks before line training even starts. [S]

---

## 1. Regulation of wet leasing, charter and the AOC

### 1.1 Contract forms (definitions the game should use)

| Form | Whose AOC and flight number | Lessor provides | Lessee pays | Typical duration |
|---|---|---|---|---|
| **ACMI / wet lease** | Lessor's AOC, lessee's flight number and slots | Aircraft, all crew, maintenance, hull and liability insurance | Fixed rate per BH (with a minimum guaranteed BH/month), fuel, landing/nav/handling, de-icing, catering; often crew hotels and transport | Ad hoc (days), seasonal (1–7 months), multi-year |
| **Damp lease** | Lessor's AOC | Aircraft and cockpit crew (sometimes the senior cabin crew member, SCCM) | As above; lessee supplies cabin crew trained on lessor procedures | Seasonal [K] |
| **Dry lease** | Lessee's AOC | Aircraft only (lessee's CAMO, crew and insurance) | Monthly rent plus maintenance reserves per FH/FC | 3–12 years [K] |
| **Full (ad hoc) charter** | Operator's own flight number | Everything, sold as a whole-aircraft price | All-in price per flight/rotation; the charterer may pay fuel separately | One trip to a full season |
| **Sub-charter / sub-lease** | A third operator performs the flight | Substitute aircraft and crew | The original operator pays the subcontractor and keeps or loses the margin | Usually days, during AOG or crew shortage |

- **Passengers must be told who actually operates the flight.** EU Reg. 2111/2005, Chapter III, gives passengers the right to know the identity of the operating carrier, including on a substitution. [K]
- **Gameplay hook:** a sub-charter keeps the client happy but costs margin and reputation if the subcontractor is weak.

### 1.2 EU legal framework

**Operating licence (Reg. 1008/2008)**
- The carrier must be majority EU-owned and controlled. [K]
- It must have at least one aircraft at its disposal through ownership or a dry lease. Its fleet cannot consist only of wet-leased-in aircraft. [K]
- It must hold insurance per Reg. 785/2004 and pass a financial-fitness test, which the regulator can re-check. [K]

**Art. 13: leasing**
- Every wet-lease agreement involving an EU carrier, and every dry lease-in, requires prior approval under the applicable safety law. [S]

**Wet lease-in of third-country-registered aircraft (Art. 13(3)(b))** is approved only if safety standards are equivalent and one of these applies: [S] [K for exact wording]
- **Exceptional needs:** up to 7 months, renewable once for up to 7 more ("7+7").
- **Seasonal capacity** that cannot reasonably be met by EU-registered aircraft: renewable.
- **Operational difficulties:** strictly limited to the time needed.

**Amendment by Reg. (EU) 2019/2**
- The 7-month limits can be waived by an international agreement. This was made for the EU–US context.
- The Commission has been reviewing Reg. 1008/2008's wet-lease provisions since 2018, with no adopted revision found. Treat this as a possible future rule-change event in the game. [S]

**Air Ops rules (ORO.AOC.110)** [S]
- A lease must be approved by the operator's authority. No lease from operators on the EU Air Safety List.
- **Wet lease-in from a third-country operator:** the lessee must show the lessor holds an ICAO Annex 6 AOC, has equivalent airworthiness and operations standards, and that the aircraft has a standard Annex 8 CofA.
- **Wet lease-out:** prior notification to the operator's own authority. The AOC's area of operation must cover the deployment.

**UK after Brexit (CAA practice)** [S]
- A UK carrier wet-leasing in an EU aircraft needs CAA lease approval under ARO.OPS.110 plus a foreign-aircraft permit (ANO 2016 Art. 250).
- A third-country lessor needs licence validations for its pilots and, where applicable, Part-TCO-style authorisation.
- Wet lease-out of a UK aircraft only requires notification.

**Third-country operators flying into the EU** need an EASA **Part-TCO** safety authorisation plus each state's operating permit. [K]
- Lead time to obtain: **3–6 months** for a new TCO. [E]

**Flying to the USA**
- A foreign carrier needs a DOT foreign air carrier permit or exemption and FAA **Part 129** operations specifications. Each charter may also need DOT authority. [K]
- Lead time: **1–3 months** for initial authority; days to weeks per charter. [E]

**Why ACMI operators cluster in Malta, Lithuania, Latvia and Portugal** [S/K]
- An EU AOC gives full intra-EU market access and makes wet leases to EU airlines routine. Third-country lessors are capped by 7+7.
- Groups hold several AOCs to spread risk and access markets:
  - Hi Fly: Portugal and Malta.
  - SmartLynx: Latvia, Estonia and Malta.
  - Getjet: Lithuania, with group airline Airhub in Malta.
  - Avion Express: Lithuania.
- **Game mechanic:** "Open a second AOC" costs **€1–3 M and 6–12 months**. [E] It unlocks a jurisdiction (cheaper crew social costs, other bilateral rights, a Brexit-style hedge).

### 1.3 AOC scope and operations specifications

The **OpsSpecs** attached to the AOC list:
- aircraft types and registrations
- area of operation
- special approvals: ETOPS, RVSM, PBN/RNP AR, low-visibility ops (CAT II/IIIA/B), NAT HLA (North Atlantic), dangerous goods (SPA.DG), EFB. [K]

| Change | What it involves | Typical time [E] | Cost [E] |
|---|---|---|---|
| Add an aircraft of a type already on the AOC | Registration, CofA/ARC, insurance, AMP update, acceptance flight | 2–6 weeks | €50–150 k |
| Add a new type | OM-B, MEL, training programme, approved TRI/TRE, CAMO and Part-145 scope, possibly proving flights | 4–9 months | €0.5–2 M plus type ratings |
| Add dangerous goods approval | Procedures and training | 1–3 months | low |
| Add ETOPS 120/180 | See §1.4 | 3–12+ months | medium |
| Add a new country or area (e.g. Africa, Asia) | Area of operation, route qualification, foreign permits | 1–3 months | low–medium |

### 1.4 ETOPS / EDTO

**What needs approval**
- Under EASA (CAT.OP.MPA.140), twins with ≥20 seats or MTOM ≥45.36 t may not fly beyond **60 min** (one-engine-inoperative speed, still air) from an adequate aerodrome without an ETOPS approval (SPA.ETOPS). [K]
- Smaller twins may go to 120 min, and up to 180 min with approval. [S]
- The FAA requires ETOPS for 3- and 4-engine passenger aircraft beyond **180 min** (since 2007). EASA has no ETOPS rule for 3–4 engines. A340/747/A380 are therefore the "go anywhere" choice. [K]

| ETOPS level | What it enables (Europe-based operator) | Typical prerequisites |
|---|---|---|
| 60 min (none) | European, Mediterranean and North-Africa charters; Atlantic only via the Greenland/Iceland "blue spruce" routes | — |
| 120 min (138 with the 15 % extension) | Most North Atlantic tracks; Lisbon/Madrid–Caribbean; Europe–Canary/Cape Verde; Lisbon–Brazil with suitable alternates | ETOPS-approved aircraft and engine, ETOPS maintenance programme and trained crews. Historically **about 12 months** of in-service experience on type, or "accelerated ETOPS" with a validation programme. [S/K] |
| 180 min (207 with +15 % in the FAA North Pacific) | Mid-Atlantic and South Atlantic direct, Indian Ocean (Europe–Mauritius/Maldives), North Pacific | Usually 12 months at 120 min first (CAAS example). [S] |
| Beyond 180 (240/330; A350 certified to 370) | South Pacific, polar, Southern Ocean | Type certification (777, 787, A350; A330 first beyond-180 approval in 2009) [S]; extensive operator experience; only big operators bother. |

**Operational strings attached** [K]
- ETOPS-qualified licensed engineer sign-off ("pre-departure service check").
- No dual maintenance on both engines or systems at the same visit.
- Stricter MEL.
- Critical-fuel scenario, which adds fuel and reduces payload.
- En-route alternate weather minima.
- Cargo-fire suppression time ≥ the diversion time plus 15 min.

**Gameplay:** an ETOPS defect (e.g. an APU or IDG fault) can force a "non-ETOPS" downgrade, meaning a reroute, a fuel stop or a swap of aircraft.

### 1.5 Long-haul and ultra-long-range (ULR)

**Definition**
- A ULR flight is a non-stop flight of **≥16 h flight time** covering **≥8,000 nm**. [S PRISM/FSF] Some regulators use FDP >18 h. [K]

**Requirements** [S]
- 4-pilot crew, often with ≥2 captains.
- Class 1 crew rest compartments.
- An approved **FRMS** (fatigue risk management system).
- Special training on sleep and alertness.
- Two in-flight rest periods per pilot.
- Long rest at destination: 48 h or more is common. [E]
- Under FAA Part 117, anything beyond Table C needs an approved FRMS. Delta's JFK–Bombay at 16.5 h with 4 pilots was approved on FSF guidance. [S]

**EASA ceilings**
- The prescriptive maximum is **17 h FDP** (2 extra pilots plus Class 1 bunks).
- It rises to **18 h** if the duty contains one sector of more than 9 h continuous flight time and at most 2 sectors. [S]
- Beyond that needs an individual flight-time-specification scheme approved through derogation, with FRM. [K]

**Aircraft able to fly ULR:** A350-900ULR (9,700 nm), 777-200LR (8,555 nm), 787-9 (7,565 nm; e.g. Perth–London about 17 h).

**Game unlock (late game):** ULR contracts require all of the following:
- the right aircraft
- an FRMS approval (**6–12 months** [E])
- a 4-pilot complement
- Class 1 bunks fitted
- extra cabin crew rest seats

### 1.6 Overflight, landing permits and diplomatic clearances

**Commercial non-scheduled (charter)**
- Each landing state usually needs a non-scheduled landing permit. Some overflight states need permits too.
- Indicative lead times from a permit agency (verify per AIP) [S]:
  - Saudi Arabia: overflight 72 h, landing 96 h.
  - Iran overflight: ≥48 h, longer for unfriendly registry states.
  - Egypt: same day to 72 h.
- Many states need **2–10 working days** for a landing permit; China, Russia and India are at the long end, with traffic-rights questions. [E]
- Charters into the US need DOT authority (§1.2).

**State and military flights (diplomatic clearance, "DIC")**
- These go through Ministries of Foreign Affairs or Defence. Typical minimum is **3 working days**:
  - Iceland: 3 working days.
  - Slovakia: 3 working days, by email only. Humanitarian and VIP flights are handled at weekends.
  - Luxembourg: 3 working days; late requests only in exceptional cases.
  - The EU multinational technical arrangement for military transport: **2 working days** (pax and cargo, no DG). [S]
- Many states want 5–15 working days plus passenger and weapons/DG declarations. [E]
- A civil-registered ACMI aircraft becomes a "state aircraft" (Chicago Convention Art. 3) only when used in military, customs or police service. A government charter (e.g. repatriation) is usually still a civil flight needing commercial permits; a troop or presidential flight may need DIC. [K]

**Game parameters**
- Each foreign country on a route adds a permit task with a lead time.
- A rush job inside the lead time has a chance of refusal or delay.
- Conflict zones: EASA Conflict Zone Information Bulletins (CZIBs) trigger war-risk insurance surcharges and crew-consent checks. [K]

### 1.7 Slots and curfews

- **IATA Worldwide Airport Slot Guidelines (WASG)** [K]:
  - Level 1: no coordination.
  - Level 2: schedules facilitated.
  - Level 3: coordinated; a slot is mandatory (e.g. LHR, LGW, AMS, FRA, CDG, LIS, BCN, PMI in summer).
- **Seasons** [K]:
  - IATA Summer runs from the last Sunday of March to the last Saturday of October.
  - Winter covers the rest.
  - Historic rights need 80 % use ("use-it-or-lose-it").
- **ACMI relevance:** a wet-leased aircraft flies on the client's slots and flight numbers. Airlines wet-lease specifically to **protect slots** when their own aircraft are grounded (e.g. Pratt & Whitney GTF inspections) or crews are short. This is a key demand driver. [S]
- **Ad hoc charters** request ad hoc slots from the coordinator (days ahead) and may get bad times or none at saturated airports. [E]
- **Night curfews and quotas** (e.g. Frankfurt 23–05, many EU airports) cut the usable day. [K]

### 1.8 Mission-specific operational requirements (flavour)

| Mission | Ops and regulatory notes |
|---|---|
| Military troop or cargo charter | DIC; weapons/ammunition carriage needs a DG approval and state permission; military security vetting of crew; war-risk insurance; possibly operating from military bases with limited ground support. [K/E] |
| Deportation / removal (e.g. Frontex-coordinated) | Escorts on board; seating and cabin restraint procedures; crew briefings; a commander may refuse disruptive passengers; reputational and crew-morale cost. [K/E] |
| Refugee or evacuation (conflict, disaster) | Very short notice; unknown passenger documents; overloaded airports; extra cabin crew; possible extended FDP with commander's discretion; humanitarian clearances often fast-tracked. [S/E] |
| Presidential / state | Security vetting; DIC; a VIP cabin configuration or block-off seating; extra service crew; strict on-time requirement. |
| VIP / sports team | Extra crew (service ratio of 1 per 10–20 pax) [E]; catering upgrades; often widebody with a premium cabin. |
| Medical / medevac / repatriation | Stretcher kits (up to 6–9 seats per stretcher [E]); medical team carried as non-crew; infectious-disease protocols (COVID-era repatriation). |
| Hajj / Umrah | Saudi permits; seasonal surge; high-density widebodies, 6–8 weeks of intense flying. EuroAtlantic flew Hajj for flynas. [S] |

---

## 2. Flight time limitations: EASA ORO.FTL (Reg. 83/2014), with FAA Part 117 for comparison

Source for all EASA numbers below is the Reg. 83/2014 text as reproduced in the EurECCA FTL booklet [S].

### 2.1 Definitions to implement

| Term | Definition |
|---|---|
| **FDP** (flight duty period) | From report time to engines-off after the last sector flown as operating crew. Post-flight duties count as duty but not FDP. |
| **Duty** | Any work: FDP, post-flight, training, positioning, airport standby, office work. |
| **Sector** | Off-block to on-block. |
| **WOCL** (window of circadian low) | 02:00–05:59 in the time zone the crew is acclimatised to. |
| **Local night** | 8 h between 22:00 and 08:00 local. |
| **Night duty** | Duty touching 02:00–04:59. |
| **Early start** | Duty starting 05:00–05:59 (early type) or 05:00–06:59 (late type). |
| **Late finish** | Duty ending 23:00–01:59 (early type) or 00:00–01:59 (late type). |
| **Acclimatisation** | The crew stays acclimatised to the departure time zone ("B") for 47:59 h after reporting. After that, see the table below. |
| **Home base** | Where the crew normally starts and ends duty and the operator does not pay accommodation. **ACMI crews on a client base are "away from home base"** unless the operator re-assigns home base, which triggers its own extra rest rules. |
| **Operating crew** | A crew member remains operating crew during in-flight rest. In-flight rest counts as FDP and as duty. |

**Acclimatisation (table 1)**

| Time difference (h) | <48 h | 48–71:59 | 72–95:59 | 96–119:59 | ≥120 |
|---|---|---|---|---|---|
| <4 | B | D | D | D | D |
| ≤6 | B | X | D | D | D |
| ≤9 | B | X | X | D | D |
| ≤12 | B | X | X | X | D |

B = acclimatised to departure time; D = acclimatised to the new location; X = unknown state of acclimatisation.

### 2.2 Basic maximum daily FDP: acclimatised crew (Table 2), 2-pilot crew

| FDP start (reference time) | 1–2 sectors | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 06:00–13:29 | 13:00 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 |
| 13:30–13:59 | 12:45 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 |
| 14:00–14:29 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 |
| 14:30–14:59 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 | 09:00 |
| 15:00–15:29 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 | 09:00 |
| 15:30–15:59 | 11:45 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 | 09:00 | 09:00 |
| 16:00–16:29 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 | 09:00 | 09:00 |
| 16:30–16:59 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 | 09:00 | 09:00 | 09:00 |
| 17:00–04:59 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 | 09:00 | 09:00 | 09:00 |
| 05:00–05:14 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 | 09:00 |
| 05:15–05:29 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 | 09:00 |
| 05:30–05:44 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 |
| 05:45–05:59 | 12:45 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 09:45 | 09:15 | 09:00 |

**Formula form:** `max = base(startBand) − 0:30 × max(0, sectors − 2)`, floor 9:00.
- base = 13:00 for 06:00–13:29, falling 15 min per half hour to 11:00 at 17:00–04:59.
- Early morning: 12:00 at 05:00, plus 15 min per 15-min step up to 12:45.

**Unknown acclimatisation**

| Sectors | 1–2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| Table 3 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 | 09:00 | 09:00 |
| Table 4 (operator has FRM) | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 09:30 | 09:00 |

**Cabin crew**
- Cabin crew may report up to **1 h earlier** than pilots (for briefing).
- Their maximum FDP is computed from the pilots' report time, but their FDP counts from their own report time.

**Consecutive night duties:** maximum **4 sectors** per duty. FDP over 10 h at night must be fatigue-managed (CS FTL.1.205(a)).

### 2.3 Planned extension without in-flight rest (Table 5)

**Conditions**
- **+1 h maximum, at most 2 times in any 7 consecutive days.**
- Either pre- and post-flight rest each +2 h, or post-flight rest +4 h.
- Sector limits depend on WOCL encroachment:
  - ≤5 sectors if no WOCL encroachment.
  - ≤4 sectors if the WOCL is encroached by ≤2 h.
  - ≤2 sectors if the WOCL is encroached by more than 2 h.
- Cannot be combined with in-flight rest or split duty.

**Resulting maximum FDP**

| Start | 1–2 sectors | 3 | 4 | 5 |
|---|---|---|---|---|
| 06:00–06:14 | not allowed | – | – | – |
| 06:15–06:29 | 13:15 | 12:45 | 12:15 | 11:45 |
| 06:30–06:44 | 13:30 | 13:00 | 12:30 | 12:00 |
| 06:45–06:59 | 13:45 | 13:15 | 12:45 | 12:15 |
| 07:00–13:29 | **14:00** | 13:30 | 13:00 | 12:30 |
| 13:30–13:59 | 13:45 | 13:15 | 12:45 | n/a |
| 14:00–14:29 | 13:30 | 13:00 | 12:30 | n/a |
| 14:30–14:59 | 13:15 | 12:45 | 12:15 | n/a |
| 15:00–15:29 | 13:00 | 12:30 | 12:00 | n/a |
| 15:30–15:59 | 12:45 | n/a | n/a | n/a |
| 16:00–16:29 | 12:30 | n/a | n/a | n/a |
| 16:30–16:59 | 12:15 | n/a | n/a | n/a |
| 17:00–17:29 | 12:00 | n/a | n/a | n/a |
| 17:30–17:59 | 11:45 | n/a | n/a | n/a |
| 18:00–18:29 | 11:30 | n/a | n/a | n/a |
| 18:30–18:59 | 11:15 | n/a | n/a | n/a |
| 19:00–05:59 | not allowed | – | – | – |

### 2.4 Augmented crews and in-flight rest (CS FTL.1.205(c))

**Rest facility classes**

| Class | Description |
|---|---|
| **Class 1** | A bunk or flat/near-flat surface (≥80° recline), separate from the cockpit and cabin, with light and noise control. This is a crew-rest compartment ("CRC" / bunk). |
| **Class 2** | A cabin seat reclining ≥45°, ≥55" pitch, ≥20" width, with leg and foot support, curtained off from passengers. Typically a business-class seat blocked for crew. |
| **Class 3** | A seat reclining ≥40° with leg and foot support, curtained, not next to passengers. Typically a premium-economy or cockpit jump-seat-type rest seat. |

**Maximum FDP with in-flight rest (flight crew)**

| Augmentation | Class 3 | Class 2 | Class 1 |
|---|---|---|---|
| +1 pilot (3-pilot "heavy" crew) | 14:00 | 15:00 | **16:00** |
| +2 pilots (4-pilot "double" crew) | 15:00 | 16:00 | **17:00** |

**Conditions**
- Add **+1 h** if the FDP has **1 sector with more than 9 h continuous flight time and at most 2 sectors.** The absolute maximum is therefore **18:00**.
- FDP limited to **3 sectors**.
- Minimum in-flight rest is **90 min continuous per crew member**, and **2 h continuous** for the pilots at the controls for landing.
- All time in the rest facility counts as FDP.
- **Rest at destination ≥ max(preceding duty, 14 h).**
- A crew member may not position on the same flight and then join its operating crew.
- These limits apply irrespective of WOCL. [S EASA FAQ]

**Minimum in-flight rest for cabin crew, by rest facility class**

| Max extended FDP | Class 1 | Class 2 | Class 3 |
|---|---|---|---|
| ≤14:30 | 1:30 | 1:30 | 1:30 |
| 14:31–15:00 | 1:45 | 2:00 | 2:20 |
| 15:01–15:30 | 2:00 | 2:20 | 2:40 |
| 15:31–16:00 | 2:15 | 2:40 | 3:00 |
| 16:01–16:30 | 2:35 | 3:00 | not allowed |
| 16:31–17:00 | 3:00 | 3:25 | not allowed |
| 17:01–17:30 | 3:25 | not allowed | not allowed |
| 17:31–18:00 | 3:50 | not allowed | not allowed |

**Consequence:** a long FDP needs extra cabin crew so that service continues while others rest. Typically add 1–3 cabin crew on flights over 12 h. [E]

### 2.5 Split duty, commander's discretion, delayed reporting

**Split duty**
- A ground break of **≥3 h** (excluding 30 min minimum for post/pre-flight and travel) **extends the FDP by 50 % of the break**.
- Suitable accommodation (a hotel room) is required if the break is ≥6 h or encroaches the WOCL. Otherwise, break time beyond 6 h or inside the WOCL does not count toward the extension.
- Not after reduced rest, and not combined with in-flight rest.
- **Use:** "out-and-back with a hotel day room", e.g. a Canaries charter with a 4 h wait.

**Commander's discretion** (unforeseen events, at or after report)
- Max FDP may be increased by up to **+2 h** (**+3 h** if augmented).
- On the final sector the flight may continue to destination or alternate if exceeded after take-off.
- Following rest may be reduced, but **never below 10 h**.
- Must be reported to the operator. If it exceeds 1 h, the operator reports to the authority within **28 days**.
- Non-punitive. It should be avoided at home base, where standby crews exist.
- **Game:** a "discretion used" counter feeds crew fatigue and morale and adds regulator scrutiny.

**Delayed reporting** (crew notified while still in their accommodation)
- Delay under 4 h: max FDP is based on the original report time; the FDP counts from the delayed report time.
- Delay of 4 h or more: max FDP is the more limiting of the original and delayed times.
- Delay of 10 h or more, with no further disturbance: counts as rest.
- A second change: the FDP starts 1 h after the second notification, or at the original delayed time if earlier.

**Robust rosters**
- If actual FDPs exceed the maximum on **more than 33 %** of duties in a schedule during a season, the operator must change that schedule (ORO.FTL.110(j)).
- **Rosters are to be published 14 days in advance** (AMC1 ORO.FTL.110).

### 2.6 Cumulative limits (ORO.FTL.210)

| Limit | Value |
|---|---|
| Duty | **60 h / any 7 consecutive days**; **110 h / 14 days**; **190 h / 28 days** (spread evenly) |
| Flight time (block) | **100 h / 28 consecutive days**; **900 h / calendar year**; **1,000 h / 12 consecutive calendar months** |
| Post-flight duty | Counts as duty. The operator sets the minimum: typically 15–30 min narrowbody, 30–45 min widebody. [E] |

**Days off (Directive 2000/79/EC, the aviation working-time agreement)** [K]
- ≥ **7 days free of all duty and standby per calendar month**, and ≥ **96 per calendar year**.
- Maximum **2,000 working hours/year**, of which ≤ 900 block hours.
- ≥ **4 weeks of paid annual leave**.
- A "single day free of duty" = 1 day + 2 local nights.

### 2.7 Positioning, standby and reserve

**Positioning** (deadheading)
- **All positioning counts as duty.**
- Positioning after report and before operating counts as **FDP** but **not as a sector**.
- Positioning home after the last sector counts as duty but not FDP.
- **Game:** positioning a crew to a client base by scheduled airline uses duty hours and costs tickets.

**Airport standby**
- Counts in full as duty.
- If an FDP is assigned, the FDP counts from its start, but the **max FDP is reduced by standby time over 4 h**.
- **Standby + FDP ≤ 16 h.**
- If no FDP is assigned, normal rest follows.
- Accommodation must be provided.

**Other standby** (home or hotel)
- Maximum **16 h**. Standby plus FDP must not exceed **18 h awake**.
- **25 % of the standby time counts as duty** toward the cumulative limits.
- If called within the first **6 h**, the max FDP counts from report. If called later, the max FDP is reduced by the standby time beyond 6 h. The threshold is **8 h** if the FDP uses in-flight rest or split duty.
- Standby time between 23:00 and 07:00 doesn't count toward the reduction until the crew member is contacted.

**Reserve** (assignment notified ≥10 h in advance)
- Does not count as duty.
- Each reserve day must contain an **8 h protected no-contact window**.
- The operator sets the maximum number of consecutive reserve days within the extended-recovery-rest rule.

### 2.8 Rest (ORO.FTL.235, CS FTL.1.235)

**Minimum rest**

| Situation | Minimum rest |
|---|---|
| Home base | **max(preceding duty, 12 h)** |
| Away from base | **max(preceding duty, 10 h)**, including an 8 h sleep opportunity. If hotel travel is over 30 min, rest increases by 2 × the excess. |
| Home base with suitable (operator-paid) accommodation ("back-to-back") | Away rule applies |
| Away, after an FDP with ≥4 h time difference | **max(preceding duty, 14 h)** |
| Away, after an augmented / in-flight-rest FDP | **max(preceding duty, 14 h)** |

**Reduced rest** (only under FRM)
- Floors remain **12 h at home and 10 h away**. In practice this removes the "as long as the preceding duty" part.
- The next rest is extended by the shortfall, and the next FDP is reduced by the shortfall.
- **Maximum 2 reduced rests between two extended recovery rests.**

**Recurrent extended recovery rest (ERRP)**
- **≥36 h, including 2 local nights**.
- **No more than 168 h** between the end of one ERRP and the start of the next.
- Twice per month it must be **2 local days**.

**Disruptive schedules**
- A transition from a late finish or night duty to an early start at home base requires rest that includes **1 local night**.
- **4 or more** disruptive duties (night, early or late) between two ERRPs extend the second ERRP to **60 h**.

**Time-zone recovery at home base** (rotations with ≥4 h time difference): minimum **local nights** of rest.

| Max time difference | Rotation <48 h | 48–71:59 | 72–95:59 | ≥96 h |
|---|---|---|---|---|
| ≤6 h | 2 | 2 | 3 | 3 |
| ≤9 h | 2 | 3 | 3 | 4 |
| ≤12 h | 2 | 3 | 4 | 5 |

- Alternating eastward and westward rotations need **≥3 local nights** at home between them.
- **Nutrition:** a meal opportunity is required if the FDP is over 6 h.
- **Records** must be kept for 24 months.

### 2.9 FAA Part 117 (US pilots only; FAA cabin crew follow Part 121 Subpart T) [S Cornell]

**Table B: unaugmented FDP (h)**

| Start (acclimated) | 1 seg | 2 | 3 | 4 | 5 | 6 | 7+ |
|---|---|---|---|---|---|---|---|
| 0000–0359 | 9 | 9 | 9 | 9 | 9 | 9 | 9 |
| 0400–0459 | 10 | 10 | 10 | 10 | 9 | 9 | 9 |
| 0500–0559 | 12 | 12 | 12 | 12 | 11.5 | 11 | 10.5 |
| 0600–0659 | 13 | 13 | 12 | 12 | 11.5 | 11 | 10.5 |
| 0700–1159 | 14 | 14 | 13 | 13 | 12.5 | 12 | 11.5 |
| 1200–1259 | 13 | 13 | 13 | 13 | 12.5 | 12 | 11.5 |
| 1300–1659 | 12 | 12 | 12 | 12 | 11.5 | 11 | 10.5 |
| 1700–2159 | 12 | 12 | 11 | 11 | 10 | 9 | 9 |
| 2200–2259 | 11 | 11 | 10 | 10 | 9 | 9 | 9 |
| 2300–2359 | 10 | 10 | 10 | 9 | 9 | 9 | 9 |

**Table C: augmented FDP (h), shown as 3 pilots / 4 pilots**

| Start | Class 1 | Class 2 | Class 3 |
|---|---|---|---|
| 0000–0559 | 15 / 17 | 14 / 15.5 | 13 / 13.5 |
| 0600–0659 | 16 / 18.5 | 15 / 16.5 | 14 / 14.5 |
| 0700–1259 | 17 / **19** | 16.5 / 18 | 15 / 15.5 |
| 1300–1659 | 16 / 18.5 | 15 / 16.5 | 14 / 14.5 |
| 1700–2359 | 15 / 17 | 14 / 15.5 | 13 / 13.5 |

**Other Part 117 rules**
- If not acclimated, deduct 30 min.
- **Flight time limits** [K]:
  - Unaugmented: 8 h (FDP start 2000–0459) or 9 h (0500–1959).
  - Augmented: 13 h (3 pilots) and 17 h (4 pilots).
- **Cumulative** [K]:
  - FDP: 60 h / 168 h and 190 h / 672 h.
  - Flight time: 100 h / 672 h and 1,000 h / 365 days.
- **Rest** [S]:
  - **10 h** before an FDP, including **8 h uninterrupted sleep opportunity**.
  - **30 consecutive hours free in any 168 h.**
  - A crew is acclimated to a new "theater" after 36 h rest.
  - Returning home after more than 168 h away and crossing more than 60° of longitude requires **56 h with 3 physiological nights**.
  - A deadhead longer than the Table B FDP needs rest equal to the deadhead.
- **Extensions:** the PIC and carrier may extend up to 2 h for unforeseen circumstances. An extension over 30 min is allowed only once before 30 h rest. [K]

### 2.10 Simplified legality checker (pseudo-code)

```
function maxFDP(duty):
    if duty.acclim == 'X':
        base = TABLE3[min(sectors,8)]     # TABLE4 if operator has FRM
    else:
        base = TABLE2[band(duty.reportRefTime)][min(sectors,10)]
    if duty.augmentedPilots >= 1 and sectors <= 3:
        aug = {1:{C1:16,C2:15,C3:14}, 2:{C1:17,C2:16,C3:15}}[min(extra,2)][restClass]
        if sectors <= 2 and longestSectorFlightTime > 9h: aug += 1
        base = max(base, aug)
    elif duty.splitBreak >= 3h:
        base += 0.5 * usableBreak         # usable: ≤6h and outside WOCL, unless hotel provided
    elif duty.plannedExtension and extCount7d < 2 and sectorsOK(WOCL):
        base = TABLE5[band][sectors]      # +1h; add +4h to post rest
    if duty.standby == 'airport': base -= max(0, standbyTime - 4h); assert standbyTime + FDP <= 16h
    if duty.standby == 'home':    base -= max(0, standbyTime - (6h or 8h))
    return base                           # commander's discretion: +2h (+3h augmented), event only

function minRestAfter(duty):
    r = max(duty.length, atHomeBase ? 12h : 10h)
    if (away and timeDiff >= 4h) or duty.augmented: r = max(duty.length, 14h)
    if duty.usedPlannedExtension: r += 4h            # simplified
    if lateOrNight -> earlyStart at home: r must include 1 local night
    return r

rolling checks: duty7d<=60, duty14d<=110, duty28d<=190, block28d<=100, blockYear<=900, block12m<=1000
ERRP: >=36h incl. 2 local nights; gap between ERRPs <=168h; 60h if >=4 disruptive duties since last ERRP
days off: >=7 per calendar month, >=96 per year; annual leave >=20 working days
```

---

## 3. Crew composition and staffing

### 3.1 Flight deck

**Minimum crew** [K]
- **2 pilots** (Captain/commander plus First Officer) for all multi-pilot jets.
- **3-pilot "heavy" crew:** Captain + FO + a relief pilot (Senior FO / cruise relief pilot, or a second captain).
- **4-pilot "double" crew:** 2 Captains + 2 FOs, or Captain + SFO + 2 FOs.
- ULR usually uses 2 captains + 2 FOs. [S]

**Ranks for the game**

| Rank | Description |
|---|---|
| Captain (CPT / PIC) | ATPL holder in command |
| Training Captain | Line Training Captain (LTC), Type Rating Instructor (TRI) or Type Rating Examiner (TRE) |
| Senior First Officer (SFO) | Can act as cruise relief for the captain [K] |
| First Officer (FO) | Second-in-command pilot |
| Second Officer / Cruise Relief Co-Pilot (SO/CRCP) | Relieves in cruise above FL200 only; no take-offs or landings [K] |

**Flight Engineer:** only on classic types (L-1011, 747-200, DC-10). EuroAtlantic flew the last European passenger L-1011 until March 2010. [S]

**Captain hiring bar at a widebody ACMI:** e.g. Hi Fly asks for ≥5,000 h total and ≥1,000 h PIC on type. [S]

### 3.2 Cabin crew

**Regulatory minimum (EASA ORO.CC.100)** [S]
- The greatest of:
  - the certification evacuation-demo number for that layout, or
  - **1 per 50 (or fraction of 50) passenger seats installed on the same deck**.
- At least 1 for more than 19 seats.
- FAA: 1 per 50 seats.
- A **senior cabin crew member (SCCM)** is required whenever there is more than 1 cabin crew. [K]
- Cabin crew may operate **at most 3 types** (4 with approval if similar). [K]

| Aircraft (typical charter seats) | Legal min (≈ceil(seats/50)) | Typical ACMI/charter complement [E] | Typical scheduled long-haul complement [S/E] |
|---|---|---|---|
| A320 (180Y) | 4 | 4 | 4–5 |
| A321 (220Y) | 5 | 5 | 5–6 |
| 737-800 (189Y) | 4 | 4 | 4–5 |
| 757-200 (235Y) | 5 | 5–6 | 6 |
| 767-300ER (269–300) | 6 | 7–8 | 8–10 |
| A330-200 (300–330) | 7 | 8–9 | 9–11 |
| A330-300 (380–440 high density) | 8–9 | 9–10 | 10–12 |
| A340-300/-600 (300–380) | 7–8 | 9–11 | 11–14 |
| 777-200ER (300–400) | 7–8 | 9–11 | **10–12**; US carrier 777-200: 11–12 international, 11 when duty >18 h [S] |
| 777-300ER (400–450) | 9 | 11–13 | 12–16 |
| 787-9 (290–300) | 6 | 8–9 | 9–11 |
| A350-900 (300–350) | 7 | 9–10 | 10–12 |
| A380 (Hi Fly 2018–20, 471 seats) | 10+ (2 decks) | 16–18 | 20–24 |

**Roles**

| Role | Description |
|---|---|
| **CSD / Chief Purser / Cabin Manager** | Widebody cabin chief; the SCCM |
| **Purser / Senior** | Leads a zone or premium cabin on widebody; is the SCCM on narrowbody |
| **Cabin crew / Flight attendant** | Door and galley positions (e.g. "L1 galley", "R2 door") |
| **Supernumerary language / "local" flight attendant** | Often supplied by the client, e.g. Arabic, Hindi or Mandarin speakers on ACMI for Middle-East or Asian airlines. [E] |

**Service upgrade:** VIP, government or sports charters often fly minimum + 2–4 crew.

### 3.3 Crew per aircraft (staffing ratios)

| Operation | Pilots per aircraft | Cabin crew per aircraft | Notes |
|---|---|---|---|
| Narrowbody, year-round high utilisation | **10–12** (5–6 crew sets) [S] | 20–30 [E] | A321XLR long thin routes need up to 18 pilots. [S] |
| Narrowbody, summer ACMI (450–500 BH/month) | 10–12 in summer; 4–6 retained in winter [E] | 20–25 summer | Seasonal contracts and winter pay cuts. [S] |
| Widebody medium-haul (2-pilot, 8–10 h sectors) | 12–16 [E] | 45–60 | |
| Widebody long-haul with augmentation | **16–26** [S Air India: 787 ≈ 16, 777 ≈ 26] | 55–80 [E] | |
| ULR (4-pilot every flight) | 24–30 [E] | 70–90 | |

**Sizing formula for the game** [E]
```
pilotsNeeded = ceil( Σ(BH_month × pilotsPerFlight) / productiveBHperPilot ) × (1 + reserveFactor)
productiveBHperPilot ≈ 75–85 BH/month (hard cap 100 per 28 days; 900 per year ≈ 75/month average)
reserveFactor ≈ 0.15–0.25 (sickness 3–5 %, training 3–4 %, leave 8 %, standby)
cabinCrewNeeded = same formula with cabin complement and ≈ 80–90 BH/month per cabin crew member
```
**The 900 h/year cap is the binding annual constraint:** a crew member flying 100 h every month would hit it by September. Summer-heavy ACMI rosters must bank winter downtime.

### 3.4 How ACMI crews live (deployments)

**Base model**
- Crew deploy to the client's base (e.g. a Lithuanian crew in Brussels, Saint Petersburg, Saudi Arabia, Montreal or Recife).
- They live in hotels or serviced apartments for a "rotation".
- Typical patterns [E]:
  - **4–6 weeks on / 2 weeks off**
  - 3 on / 1–2 off
  - SmartLynx's 2025 contract was described as "**30/15**". [S]
- Some operators hire **local contractors** at the client base. Many Baltic ACMI crews are **agency or contractor staff** rather than employees, which became an issue in the SmartLynx insolvency. [S]
- SmartLynx's 2025 bases included RIX, TLL, BRU, TXL, MLA, AMS, LEJ and SAW, plus India; most 2025 bases were expected to be outside Europe. [S]

**Hotels**
- Single rooms are standard, often written into the crew agreement. The company books them. [S]
- The ACMI contract specifies who pays crew hotels and transport (HOTAC). This is commonly the lessee for crews based away from the lessor's base, a frequent source of friction and last-minute rebookings. [S]

**Per diems**
- Pilots: **€70–100/day**. SmartLynx paid €100 CPT and €70 FO. [S]
- Cabin crew: **€40–70/day**. [E]
- Paid per day away. Many crew value per diems as roughly tax-free income. [K]

**Positioning**
- Crews travel to the deployment and swap out by scheduled airline (deadheading). This counts as duty and costs €150–1,500 per crew member per trip. [E]

**Example widebody deployments (EuroAtlantic)** [S]
- LOT 777 operated by CS-TSW until Sep 2025.
- Azul Orlando–Belo Horizonte with CS-TSU (Nov 2025).
- Warsaw–Toronto LO45/46, 6× weekly, on a 777-200 from Jun 2026.
- These mean crews positioned to Warsaw or Brazil for multi-week blocks.

---

## 4. Training and HR

### 4.1 Pilots

| Item | Time | Cost | Source |
|---|---|---|---|
| Type rating A320 | 4–6 weeks | $35–50 k | [S rotatepilot] |
| Type rating 737 NG/MAX | 3–5 weeks | $38–55 k | [S] |
| Type rating 777 / 787 / A350 | 4–6 weeks (EASA 777 ≈ 40 days incl. 20 days ground + 9 sim days) | $45–65 k (up to $70 k; €50 k+) | [S sim.aero, aviationcv] |
| Type rating A330 | 4–6 weeks | €15–32 k (course only, base training excluded) | [S aviationcv] |
| Base training (6 landings on aircraft) or ZFTT | 1 day | €5–20 k aircraft time | [E] |
| Line training (LIFUS) plus line check | Narrowbody 20–40 sectors (3–6 weeks); widebody 6–12 sectors (3–6 weeks) | Salary of trainee and training captain | [E] |
| Operator conversion course, already type-rated | 2–4 weeks + LIFUS | €5–15 k | [E] |
| Differences / common rating (777↔787, A330↔A350 cross-crew) | 1–2 weeks | €5–15 k | [K/E] |
| Command upgrade (FO → CPT) | 4–8 weeks (sims + line training) | €15–30 k | [E] |

**Recurrent training and checks (ORO.FC.230)** [S]
- **Operator proficiency check (OPC):** every **6 months**.
- **Licence proficiency check (LPC):** annual type-rating revalidation, usually combined with one OPC. [K]
- **Line check:** every **12 months**.
- **Emergency and safety equipment training:** every **12 months**, some items every 3 years.
- Plus annual CRM, dangerous goods every 24 months, and recency of 3 take-offs/landings in 90 days. [K]
- **Cost per pilot:** ≈ **6–10 days/year** off the roster. [E]
- **Simulator rental:** €400–700 per hour. [E]

**Medicals and age** [K]
- EASA Class 1 medical is valid 12 months.
- CAT pilots must stop flying at age **65**. Age 60–64 is allowed only in multi-pilot crews.

**Bonding** [E]
- A company-paid type rating is typically bonded 2–4 years, €20–50 k, pro-rata.
- **Game:** low bonding means faster attrition after training.

### 4.2 Cabin crew [K/E]

- **Initial cabin crew attestation (EASA Part-CC):** 4–8 weeks; costs €2–5 k per trainee.
- **Operator conversion plus aircraft-type training:** 5–10 days per type.
- **SCCM / purser course:** 3–5 days, plus ≥1 year line experience.
- **Recurrent:** annual ground and emergency drills of 1–3 days. Some practical drills every 3 years. Refresher after more than 6 months off flying.
- **Medical:** aero-medical assessment at least every 60 months (MED.C.005). [K]

### 4.3 Recruitment and the labour market

**Lead times** [E]
- Type-rated captain: 1–3 months, notice periods being the bottleneck.
- Non-rated FO: 3–5 months including the type rating.
- Cabin crew: 6–10 weeks including the initial course.
- Licensed engineer B1: 1–3 months.

**Shortage context, 2022–2025** [S]
- Post-COVID rehiring left a shortage of experienced captains. Recruiters advertised "A320 Captains urgently needed" for Avion Express.
- Pratt & Whitney GTF engine removals (~3,000 engines over 3 years) grounded hundreds of A320neo-family jets. Lufthansa planned to **wet-lease 40–50 aircraft** in summer 2024, and IndiGo kept large ACMI fleets.
- European ACMI demand peaked in 2022–2024. Europe is the largest ACMI market (Cirium).
- ACMI providers argue they can recruit from a wider international pool. [S Avia Solutions, self-interested]

**Failure case: SmartLynx (Latvia)** [S]
- Pilots were owed two months' salary.
- Restructuring protection began in late Oct 2025, and **all three AOCs were suspended**.
- Operations ceased **24 Nov 2025**, followed by insolvency and fraud investigations.

### 4.4 Salaries (gross, EU ACMI)

**Narrowbody captain**
- **Summer €8–10 k/month; winter €6–8 k.** Annual about €100–120 k.
- Avion Express: summer €10 k base + €20/BH; winter €6 k + €45/BH; about €110–117 k/year. [S recruiter ad]
- SmartLynx: €8,235–9,455/month summer guarantee; €7,930 winter (top scale, 2024). [S]
- Getjet (estimate): ~€10 k summer / €4.5 k winter; €55–120 k/year. [S blog estimate]

**Narrowbody FO**
- **Summer €5–6 k; winter €3.5–5 k.** Annual about €45–70 k.
- Avion Express: about €60–67 k/year. [S]
- SmartLynx: €5,185–6,100 summer; €4,117–5,032 winter. [S]
- Getjet: about €6 k summer / €3.5 k winter. [S]

**Daily-rate contractors (SmartLynx 2023)** [S]
- CPT €185–310/day; FO €100–200/day.
- 80 BH/month guaranteed in summer, 30 in winter.

**Widebody captain**
- **€10–15 k/month**, about 15–30 % above narrowbody. [E]
- Thin data. EuroAtlantic historically paid low: FO about €1.6–2 k net in the early 2010s, per forum reports. [S weak]

**Widebody FO:** €6–8 k. [E]

**Cabin crew (ACMI, Baltic/Maltese/Portuguese AOCs)** [E, no source found]
- Basic **€900–1,800/month**, plus sector or BH pay, plus per diems.
- Season total **€2–3.5 k/month**.
- Purser/CSD gets +20–40 %.
- Winter often on reduced pay or unpaid leave.

**Crew planner / crewing officer (Vilnius):** €2.2–2.7 k/month gross. [S]

**Employer on-costs:** +10–35 % depending on country and contract model. Contractor models are cheapest but carry the most legal and morale risk. [E]

### 4.5 Morale model (cause → effect) [E, based on industry patterns]

| Driver | Positive | Negative |
|---|---|---|
| Rotation length | ≤4 weeks away | >6 weeks away: −morale; resignation risk ↑ |
| Roster stability | Published 14 days ahead and kept | Late changes, frequent discretion use |
| Days off | Off-days respected; ERRPs at home | Off-days spent in a hotel at the client base |
| Accommodation | 4★ single rooms near the airport | Long transfers, shared rooms (illegal under many agreements) |
| Pay | Summer bonus, BH pay, winter guarantee | Winter pay cut (−40–60 %), late salaries (catastrophic) |
| Contract | Direct employment, pension | Agency or self-employed, no pension or staff travel (SmartLynx: none) [S] |
| Career | Upgrade within 3–5 years; widebody transition | Stagnant fleet |
| Mission type | Humanitarian or evacuation (pride), VIP | Deportations; war-risk zones (consent needed) |

**Suggested game mechanic:** monthly attrition = base 1 %/month × morale multiplier (0.5–3×). Hiring pipeline as in §4.3.

---

## 5. Maintenance

### 5.1 Structure

**Line maintenance**
- Transit or walk-around check at each turnaround (15–45 min, part of the turn).
- **Daily check** every 24–48 h (767 about 10 MH).
- **Weekly check**, at most 8 days apart. [S 767 guide]
- Done by Part-66 **B1** (mechanical) and **B2** (avionics) licensed engineers, who sign the certificate of release to service (CRS).

**Base maintenance:** A-checks (in a hangar, overnight), C-checks or base checks, heavy/structural checks, modifications, cabin refurbishment. Done by a Part-145 organisation with Category C certifying staff. [K]

**CAMO** (continuing airworthiness management organisation) plans everything against the approved maintenance programme (AMP), derived from the manufacturer's maintenance planning document (MPD). [K]

### 5.2 Check intervals and durations

| Type | A-check | C / base check | Heavy / structural | Notes |
|---|---|---|---|---|
| A320 family | **750 FH / 750 FC / 4 months** (3–4 per year) [S] | **7,500 FH / 5,000 FC / 24 months**; many tasks now 36 months [S] | 6 and 12-year checks [K] | A-check is an overnight, 8–12 h shift. [E] |
| 737NG/MAX | ~600–1,000 FH [E] | ~24 months / 7,500 FH [E] | 6/12-year [E] | |
| 767-300ER | MPD 500–600 FH, actual about 400–500 FH; 300–500 MH, about $46 k [S] | System tasks 6,000 FH / 18 months; structural 3,000 FC / 18 months. Four-check cycle; the 4th (heavy) at 24,000 FH / 72 months, done in practice every ~5 years [S] | Every 4th C; routine MH 1,650 (light C) to 6,700–8,000 (heavy C); base cycle total 23–33 k MH [S] | The user's EuroAtlantic type |
| A330 | ~800 FH (MPD revisions raised it from 600) [S] | 24 months / 10,000–12,000 FH [S] | 6/12-year [K] | |
| 777 | No fixed letter checks (usage-parameter programme); operators group tasks [S] | Base checks typically every **18–24 months** [S] | Heavier check every 4th base check or about every 8 years [S] | |
| 787 / A350 | ~1,000–1,200 FH / 120–200 days [E] | **36 months** [E/K] | 12-year [K] | Lower MH per check |

**Downtime per check (game values)**

| Check | Narrowbody | Widebody |
|---|---|---|
| A-check | 1 night (8–12 h) [E] | 1–2 nights (12–24 h) [E] |
| C-check | 7–14 days | 2–3 weeks; 1–4 weeks and up to 6,000 MH [S] |
| Heavy / structural (6/12-year) | 3–5 weeks | 4–8 weeks; generic 2–6 weeks [S]. Add 2–4 weeks if corrosion or a cabin refit is found. |

**Seasonal planning:** ACMI operators push C and heavy checks into **Nov–Mar**, when lessee demand is low. A summer check means lost ACMI revenue. [K]

### 5.3 Engines

**Shop-visit intervals**
- Older data: narrowbody **7,000–12,000 EFH** between removals. Life-limited parts (LLPs) force replacement every 2nd–4th visit. [S, 2002]
- Modern CFM56/LEAP first runs: **15,000–25,000 EFH**. [E]
- Widebody (CF6, PW4000, GE90, Trent): **15,000–30,000 EFH**. [E]

**Costs**
- Widebody performance-restoration shop visit: **$3–5 M** excluding LLPs. A full widebody LLP stack is **$8–12 M**. Materials are 60–70 % of the cost. [S]
- A CFM56-5B full overhaul can exceed **$10 M**. [S]
- LEAP and GTF costs have risen about twice as fast as CFM56/V2500 since 2019. [S]

**Spare engines** [E]
- On-wing engine change: 1–2 days if a spare is available.
- Spare engine lease: $2–6 k/day narrowbody; $8–20 k/day widebody.

### 5.4 Cost per block hour (game values) [E unless marked]

**767 data points** [S]
- Line and ramp checks about **$75/FH**.
- A-checks about **$110–115/FH**.

**Total direct maintenance cost (airframe, engines, components)**
- Narrowbody about **$700–1,100/BH**.
- Older widebody (767, 777-200ER, A340) about **$1,500–2,800/BH**.
- New widebody about **$1,200–2,000/BH**.
- Aging and older engines push costs up.

**Maintenance reserves (paid to the lessor when dry-leased)**
- Airframe heavy check: $60–150/FH.
- Engines: $150–400/EFH each.
- APU: $30–80/APU hour.
- Landing gear: $15–40/FC.

### 5.5 AOG (aircraft on ground)

**Technical dispatch reliability**
- **99.5–99.8 %** for modern types, 98.5–99.3 % for ageing widebodies. [E]
- In other words, about 1 in 200–500 departures is delayed more than 15 min for technical reasons.
- Of those, about 5–10 % become an AOG of more than 12 h. [E]

**Common causes:**
- Bird strike or FOD (engine inspection)
- Tyre or brake failure
- Hydraulic leak
- Bleed or pack failure
- IDG or generator failure
- APU failure (an ETOPS issue)
- Lightning strike inspection
- Ground damage (catering truck, jet bridge, tug)
- Avionics or computer faults
- Cracks found on inspection

**Recovery options (cost and time grow down the list)**

| Option | Time | Cost |
|---|---|---|
| Local engineer and on-site fly-away kit | 1–4 h | — |
| Part from a pool provider (AJW, Lufthansa Technik, AFI KLM E&M), on-board courier or air freight | 12–48 h | Part cost plus $2–15 k logistics |
| "Flying spanners": an AOG team (2–4 engineers) flown in | 12–36 h | — |
| Rescue aircraft from the operator's own spare or reserve fleet | 4–24 h | Positioning |
| Sub-charter from another ACMI or charter operator at market rate | 6–48 h | Often 1.2–2× the contract rate |

[E for all times and costs above]

**Contract economics** [K/E]
- In ACMI, **the lessor bears AOG cost**. The lessee pays only for BH flown.
- Contracts specify replacement obligations and penalties: e.g. replacement within 24–48 h, or credit or penalty per cancelled sector.
- Persistent unreliability ends renewals.

### 5.6 Engineers and deployed maintenance [K/E]

**Licences** (EASA Part-66)

| Category | Scope |
|---|---|
| **A** | Mechanic: minor tasks, limited certification |
| **B1** | Mechanical and electrical; signs the release to service for line work |
| **B2** | Avionics |
| **C** | Base maintenance certification |

**Typical deployed ACMI set-up**
- **1–2 B1 plus 0–1 B2 engineers per aircraft per outstation**, on 2–4-week rotations.
- A **fly-away kit**: wheels, brakes, a few line-replaceable units (LRUs), consumables; worth €100–500 k.
- Alternatively, contract line maintenance from a local Part-145 at the client hub, which may be the client itself: €150–400 per turnaround or €20–60 k/month per aircraft.

**Scheduled checks during a deployment**
- A-checks: the aircraft ferries home for 1 night on a quiet day, or a local Part-145 does the check.
- C-checks: avoided during the contract, or the operator supplies a substitute aircraft.

**Staffing:** engineers per aircraft overall (line + base + CAMO) about **8–15 per aircraft** for a small operator that does its own line maintenance and outsources base checks. [E]

**Engineer pay:** B1 in the Baltics/Portugal €3–6 k/month; contract B1 €300–500/day plus per diem. [E]

---

## 6. Aircraft performance basics for scheduling

**Rule of thumb for block time** [K/E]
- **Block time ≈ great-circle distance / cruise TAS + 0.4–0.5 h** (taxi, climb and descent allowance).
- Wind effect is ±5–15 %. Westbound across the North Atlantic is typically +45–75 min versus eastbound.

**Average block speed by sector length:** about 330 kt (1 h sector), 410 kt (3 h), 440–460 kt (6 h), 470–490 kt (10 h+). [E]

**Turnaround times** [S]

| Source | Narrowbody | Widebody |
|---|---|---|
| EUROCONTROL standard inputs (heavy vs medium) | Median ~45 min (P10–P90: 25–80) | Median ~90 min (P10–P90: 60–150) |
| OAG (US airlines, planned) | 52–68 min | — |
| Industry rules of thumb | Charter 40–50 min; quick turn 25–35 min | 70–90 min; quick turn ~50–60 min |

- Long-haul with full catering and a crew change: 90–150 min. [E]
- Technical (fuel-only) stop: 45–75 min. [E]

| Type | Charter seats | Cruise | Nominal range [K] | Realistic range, full charter payload [E] | Min turn (charter) [E] | Cabin crew min | ETOPS / notes |
|---|---|---|---|---|---|---|---|
| A320ceo | 174–186 | M0.78 (~450 kt) | 3,300 nm | ~2,600–2,900 nm (5–6 h) | 30–45 min | 4 | ETOPS 120/180 possible; rarely needed |
| A321ceo / neo / LR / XLR | 200–240 | M0.78 | 3,200 / 3,500 / 4,000 / 4,700 nm | ceo ~2,300 nm; LR ~3,500 nm (Lisbon–US East Coast) | 35–50 min | 5 | LR/XLR: Atlantic with ETOPS |
| 737-800 / MAX 8 | 189 | M0.785 | 2,935 / 3,550 nm | ~2,500 / 3,000 nm | 30–45 min | 4 | |
| 757-200 | 220–235 | M0.80 | 3,900 nm | ~3,300 nm (transatlantic in summer) | 45–60 min | 5 | EuroAtlantic flew them 2007–11 [S] |
| 767-300ER | 260–300 | M0.80 (~460 kt) | 5,980 nm | ~4,800–5,300 nm (Lisbon–Salvador OK; Lisbon–Dili needs stops) | 60–75 min | 6 | ETOPS 120–180 standard; the classic ACMI widebody |
| A330-200 | 290–330 | M0.82 | 7,250 nm | ~6,000 nm | 60–90 min | 7 | ETOPS 180–240 |
| A330-300 | 330–440 | M0.82 | 6,350 nm (later 242 t versions more) | ~5,000–5,500 nm | 70–90 min | 8–9 | ETOPS 180; ACMI and Hajj workhorse (Wamos ~13 A330s) [S] |
| A340-300 | 280–340 | M0.82 | ~7,300 nm | ~6,500 nm | 75–90 min | 6–7 | 4 engines: no ETOPS needed. Hi Fly A340 landed in Antarctica in 2021. [K] Fuel-hungry. |
| A340-600 | 320–380 | M0.83 | ~7,800 nm | ~6,800 nm | 80–100 min | 7–8 | 4 engines; cheap to buy, expensive to run |
| 777-200ER | 300–400 | M0.84 (~485 kt) | 7,065 nm | ~6,000–6,500 nm | 75–100 min | 7–8 | ETOPS 180–207 (330 possible) |
| 777-200LR | 300–320 | M0.84 | 8,555 nm | ~7,500 nm | 75–100 min | 7 | ULR-capable |
| 777-300ER | 380–450 | M0.84 | 7,370 nm | ~6,500 nm | 90–120 min | 9 | ETOPS 180–330 |
| 787-9 | 280–300 | M0.85 | 7,565 nm | ~6,800 nm | 75–90 min | 6 | ETOPS 330 certified; ULR (Perth–London) |
| A350-900 / -900ULR | 300–350 / 170 (ULR) | M0.85 | 8,100 / 9,700 nm | ~7,300 / ~9,000 nm | 75–100 min | 7 | ETOPS 370 certified; ULR |

**ETOPS relevance by region (Europe-based operator)**

| Region / route | Requirement |
|---|---|
| Mediterranean, Europe, North Africa, Middle East | None |
| North Atlantic (NAT HLA) | ETOPS 120–180 for twins, or northern routing via Iceland/Greenland within 60 min with a performance penalty |
| South Atlantic (Lisbon/Madrid–Brazil, Caribbean–Africa) | 120–180 |
| Indian Ocean (Maldives, Mauritius, Seychelles from the Gulf or Europe) | 180 |
| Pacific, Hawaii, South Pacific | 180–207+ |
| Southern Ocean / Antarctica | Beyond 180, or 4 engines |

---

## 7. GAME PARAMETERS (implementation-ready)

```yaml
# ---------------- FTL (EASA ORO.FTL, simplified) ----------------
ftl:
  basic_fdp_table: see §2.2      # hours by report band (acclimatised ref time) x sectors (1-2..10)
  unknown_acclim_fdp: [11.0, 11.0, 10.5, 10.0, 9.5, 9.0, 9.0, 9.0]   # index = sectors (1..8)
  sector_penalty_h: 0.5           # per sector above 2
  min_fdp_h: 9.0
  planned_extension: {plus_h: 1.0, max_per_7d: 2, extra_post_rest_h: 4, max_sectors_no_wocl: 5, max_sectors_wocl_le2h: 4, max_sectors_wocl_gt2h: 2}
  augmented_max_fdp_h:            # extra pilots -> rest facility class
    1: {class1: 16, class2: 15, class3: 14}
    2: {class1: 17, class2: 16, class3: 15}
  augmented_bonus_long_sector_h: 1   # if 1 sector > 9h flight time and <= 2 sectors
  augmented_max_sectors: 3
  augmented_min_inflight_rest_h: {each: 1.5, landing_pilots: 2.0}
  split_duty: {min_break_h: 3, extension_ratio: 0.5, hotel_required_if_break_ge_h: 6}
  commander_discretion_h: {normal: 2, augmented: 3, min_rest_after_h: 10}
  cabin_crew_early_report_max_h: 1
  standby:
    airport: {counts_as_duty: 1.0, fdp_reduction_after_h: 4, max_standby_plus_fdp_h: 16}
    home:    {max_h: 16, counts_as_duty: 0.25, fdp_reduction_after_h: 6, fdp_reduction_after_h_augmented: 8, max_awake_h: 18}
  reserve: {notice_h: 10, protected_sleep_h: 8, counts_as_duty: 0}
  positioning: {counts_as_duty: true, counts_as_fdp_if_before_operating: true, counts_as_sector: false}
  rest:
    home_min_h: 12                # or preceding duty if longer
    away_min_h: 10                # or preceding duty if longer; incl. 8h sleep
    after_augmented_or_tz4_h: 14  # or preceding duty if longer
    reduced_rest_max_between_errp: 2
  errp: {min_h: 36, local_nights: 2, max_gap_h: 168, disruptive_threshold: 4, extended_h: 60, two_local_days_per_month: 2}
  cumulative:
    duty: {d7: 60, d14: 110, d28: 190}
    block: {d28: 100, calendar_year: 900, rolling_12m: 1000}
  days_off: {per_calendar_month: 7, per_year: 96, annual_leave_weeks: 4, max_work_h_year: 2000}
  roster_publish_days_ahead: 14
  report_before_std_min: {narrowbody: 60, widebody: 90}      # [E]
  post_flight_min: {narrowbody: 30, widebody: 45}            # [E] duty, not FDP
  tz_home_local_nights: {le6: [2,2,3,3], le9: [2,3,3,4], le12: [2,3,4,5]}   # by rotation length <48,<72,<96,>=96h

# ---------------- crew ----------------
crew:
  cockpit_min: 2
  augmentation: {heavy: 3, double: 4, ulr: 4}
  cabin_min_rule: "max(ceil(seats/50), cert_min); >=1 if seats>19; SCCM if >1"
  cabin_typical_extra: {charter: 0-1, acmi_scheduled: 1-2, long_haul_gt12h: 2-3, vip: 2-4}
  productive_bh_per_month: {pilot: 80, cabin: 85}           # [E] hard cap 100/28d, 900/yr
  reserve_factor: 0.20                                       # sickness+training+leave+standby [E]
  pilots_per_aircraft: {narrowbody: 10-12, widebody_2pilot: 12-16, widebody_augmented: 16-26, ulr: 24-30}
  cabin_per_aircraft: {narrowbody: 20-30, widebody: 45-80}
  rotation_pattern_days: {on: 28-42, off: 14}               # ACMI deployment [E]; SmartLynx "30/15" [S]
  per_diem_eur_day: {captain: 100, fo: 70, cabin: 50, engineer: 60}
  positioning_cost_eur: {europe: 150-400, intercontinental: 600-1500}
  sickness_rate: 0.04                                        # [E]
  monthly_attrition_base: 0.01                               # x morale multiplier 0.5-3 [E]

# ---------------- training ----------------
training:
  type_rating: {a320: {weeks: 5, usd: 42000}, b737: {weeks: 4, usd: 45000}, widebody: {weeks: 6, usd: 55000}, a330: {weeks: 5, eur: 30000}}
  line_training_weeks: {narrowbody: 4, widebody: 4}
  command_upgrade: {weeks: 6, eur: 20000, req_total_h: 3000-5000, req_pic_on_type_h: 500-1000}
  differences_ccq_weeks: 1-2
  recurrent: {opc_months: 6, lpc_months: 12, line_check_months: 12, sep_months: 12, dg_months: 24, days_lost_per_year: 8}
  cabin: {initial_weeks: 6, initial_eur: 3500, type_conversion_days: 7, sccm_course_days: 4, recurrent_days_per_year: 2, max_types: 3}
  recruit_lead_weeks: {rated_captain: 6-12, nonrated_fo: 12-20, cabin: 6-10, b1_engineer: 4-12}
  bond: {years: 3, eur: 30000}
  sim_hour_eur: 550
  medical: {class1_validity_months: 12, cabin_crew_assessment_months: 60, pilot_max_age_cat: 65}

# ---------------- salaries (gross €/month) ----------------
salary:
  captain_nb: {summer: 9000, winter: 7000}     # Avion/SmartLynx data
  fo_nb: {summer: 5500, winter: 4300}
  captain_wb: {summer: 12000, winter: 10000}   # [E] +20-30%
  fo_wb: {summer: 7000, winter: 5800}          # [E]
  so_cruise_relief: 4000                       # [E]
  purser_csd: {summer: 2800, winter: 1600}     # [E] incl. sector pay
  cabin_crew: {summer: 2200, winter: 1200}     # [E]
  b1_engineer: 4500                            # [E]
  crew_planner: 2500                           # [S Vilnius ad]
  bh_pay_eur: {captain: 20-45, fo: 10-25}      # Avion ad
  employer_oncost: 0.10-0.35                   # by AOC country/contract model [E]

# ---------------- maintenance ----------------
maintenance:
  daily_check_h: 24-48
  weekly_check_max_days: 8
  a_check: {a320: {fh: 750, fc: 750, months: 4, down_h: 10}, b767: {fh: 500, down_h: 16, cost_usd: 46000}, a330: {fh: 800, down_h: 16}, b777: {fh: 1000, down_h: 18}, b787_a350: {fh: 1200, down_h: 18}}  # 777/787/A350 [E]
  c_check: {a320: {fh: 7500, fc: 5000, months: 24, down_days: 10}, b767: {fh: 6000, months: 18, down_days: 18}, a330: {fh: 10000, months: 24, down_days: 18}, b777: {months: 24, down_days: 21}, b787_a350: {months: 36, down_days: 14}}
  heavy_check: {nb: {years: 6, down_days: 28}, wb: {years: 6, down_days: 42}}   # 767: every 4th C ~ 5-6 yrs
  engine_shop_visit: {nb: {efh: 15000, usd: 4000000}, wb: {efh: 20000, usd: 5000000}, llp_stack_wb_usd: 10000000}
  dmc_usd_per_bh: {nb_new: 700, nb_old: 1100, wb_new: 1400, wb_old: 2500}       # [E]
  dispatch_reliability: {new: 0.997, mid: 0.994, old_wb: 0.988}                 # [E]
  aog_given_tech_delay: 0.08                                                    # [E] >12h
  aog_recovery_h: {local_fix: [1,4], part_flown_in: [12,48], aog_team: [12,36], rescue_aircraft: [4,24], subcharter: [6,48]}
  engineers_per_deployed_aircraft: {b1: 1-2, b2: 0-1, rotation_weeks: 3}
  fly_away_kit_eur: 100000-500000
  heavy_checks_season: [Nov, Dec, Jan, Feb, Mar]

# ---------------- ops / scheduling ----------------
ops:
  turnaround_min: {a320: 40, a321: 45, b737: 40, b757: 50, b767: 70, a330: 80, a340: 90, b777: 90, b787: 80, a350: 85, a380: 120}
  quick_turn_min: {narrowbody: 30, widebody: 55}
  tech_stop_min: 60
  block_time_h: "dist_nm / cruise_tas + 0.45"
  cruise_tas_kt: {a320: 450, b737: 450, b757: 460, b767: 460, a330: 470, a340: 470, b777: 485, b787: 490, a350: 490}
  wind_factor: {natlantic_westbound: 1.10, natlantic_eastbound: 0.92}
  etops_required_beyond_min: 60
  etops_levels: [120, 180, 207, 240, 330]
  etops_upgrade_months: {to_120: 6, to_180_after_120: 12}       # [S/E]
  ulr: {flight_h: 16, pilots: 4, needs: [frms_approval, class1_bunks], frms_approval_months: 6-12}
  permits_lead_days: {schengen_charter: 0-2, landing_permit_typical: 2-10, saudi_landing: 4, us_charter_new: 30-90, dip_clearance_min_working_days: 3, dip_clearance_typical: 5-15, eu_military_technical_arrangement: 2}
  wet_lease_third_country_limit_months: {exceptional: 7, renewals: 1}
  new_aircraft_onto_aoc_weeks: 2-6
  new_type_onto_aoc_months: 4-9
  new_aoc_months: 6-12
  slot_seasons: {summer: "last Sun Mar - last Sat Oct", winter: "rest"}
  slot_use_it_or_lose_it: 0.80
```

---

## 8. Sources (short)

**FTL**
- Reg. 83/2014 text in the EurECCA FTL booklet: https://www.ufo-online.aero/images/rundumsfliegen/flugsicherheit/pdf/eurecca_ftl_booklet.pdf
- EASA FAQ on in-flight rest: https://www.easa.europa.eu/en/faq/47620
- FAA Part 117 Table B: https://www.law.cornell.edu/cfr/text/14/appendix-Table_B_to_part_117
- FAA Part 117 Table C: https://www.law.cornell.edu/cfr/text/14/appendix-Table_C_to_part_117
- 14 CFR 117.25: https://www.law.cornell.edu/cfr/text/14/117.25

**Wet lease**
- EP report A8-0150/2018: https://www.europarl.europa.eu/doceo/document/A-8-2018-0150_EN.html
- Reg. 2019/2: https://eur-lex.europa.eu/eli/reg/2019/2/oj
- UK CAA wet and damp leasing: https://www.caa.co.uk/commercial-industry/aircraft/leasing/wet-and-damp-leasing
- UK CAA regulatory library (login required): ORO.AOC.110

**Cabin crew minimum:** EASA Easy Access Rules ORO.CC.100: https://www.easa.europa.eu/document-library/easy-access-rules/online-publications/easy-access-rules-air-operations?page=29

**ETOPS**
- EASA AMC 20-6 (EASA Easy Access Rules, AMC-20)
- CAAS AC 98-8-1: https://www.caas.gov.sg/docs/default-source/pdf/ac-98-8-1(rev-0)-extended-diversion-time-operations-(edto).pdf
- ICAO EDTO module

**ULR**
- PRISM brief: https://safetymaterials.argus.aero/wp-content/uploads/2023/07/PRISM-RESEARCH-BRIEF-Ultra-Long-Flights.pdf
- CAAS AC 121-11-2: https://www.caas.gov.sg/docs/default-source/pdf/ac121-11-2(rev-0)-fatigue-risk-management-for-ulr-operations.pdf

**Diplomatic clearances**
- Iceland: https://government.is/ministries/ministry-for-foreign-affairs/protocol/diplomatic-clearance
- Slovakia: https://mzv.sk/en/web/en/ministry/diplomatic-guide/diplomatic-clearance-for-overflights-and-landings
- Luxembourg: https://defense.gouvernement.lu/en/demarches/autorisations-survol.html
- EU technical arrangement: https://likumi.lv/ta/en/starptautiskie-ligumi/id/1245
- Permits agency (indicative): https://lfs.aero/capabilities/permits

**Crew ratios**
- Bloomberg via TBS: https://www.tbsnews.net/node/306100
- Gulf News on Air India: https://gulfnews.com/business/aviation/air-india-to-hire-over-80-junior-pilots-for-wide-body-boeing-planes-1.2015755

**777 cabin crew**
- APFA: https://apfa.org/2017/10/23/10-23-17-laa-staffing-changes-on-ipd-flights-on-the-787-9-and-777-200
- FlyerTalk: https://www.flyertalk.com/forum/20958496-post2.html

**Pay**
- Avion Express ad: https://pilotsdb.brookfieldav.com/showjob/00723/ICAO---A320-Captains-Urgently-Needed-for-Avion-Express
- SmartLynx: https://www.pilotjobsnetwork.com/jobs/SmartLynx_Airlines
- Getjet (blog estimate): https://readyfortakeoffbook.com/blogs/pilot-conditions/getjet-airlines
- Crewing officer ad: https://www.cvbankas.lt/crewing-officer-vilniuje/1-14126040
- Hi Fly requirements: https://www.flightdeckfriend.com/job/hi-fly-non-rated-first-officers-a330-a340-rated-captains/

**SmartLynx collapse**
- Wikipedia: https://en.wikipedia.org/wiki/SmartLynx_Airlines
- CargoForwarder: https://cargoforwarder.eu/2025/12/14/insolvent-carrier-smartlynx-faces-corruption-charges
- Eurofound: https://apps.eurofound.europa.eu/restructuring-events/detail/203833

**Demand**
- AJOT on the GTF engine issue: https://www.ajot.com/news/rtxas-engine-flaw-proves-to-be-a-boon-to-short-term-jet-rental-firms
- Cirium on ACMI utilisation: https://cirium.com/thoughtcloud/ascend-consultancy-a-deep-dive-into-acmi-utilization-by-airlines

**Type ratings**
- RotatePilot: https://rotatepilot.com/blog/how-much-does-type-rating-cost-2026
- Sim.aero B777: https://www.sim.aero/training/type-rating/boeing-b777
- AviationCV: https://blog.aviationcv.com/top-10-faqs-about-the-type-rating-course-answered/

**Recurrent checks:** ORO.FC.230 (UK CAA regulatory library)

**Maintenance**
- Aircraft Commerce A320: https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/A320%20FAMILY/ISSUE%2044-A320%20MTCE.pdf
- Aircraft Commerce 767: https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/767%20FAMILY/ISSUE%2046-767%20MTCE.pdf
- Aircraft Commerce A330: https://aircraft-commerce.com/wp-content/uploads/aircraft-commerce-docs/Aircraft%20guides/A330-200-300/ISSUE57_A330_MTCE.pdf
- Wikipedia, aircraft maintenance checks: https://en.wikipedia.org/wiki/Aircraft_maintenance_checks

**Engines**
- Air Cargo Week on engine maintenance cost: https://aircargoweek.com/the-true-cost-of-engine-maintenance/
- Airways Magazine on engine bills: https://airwaysmag.com/new-post/airline-engine-bills-rise-groundings-ease

**Turnarounds**
- EUROCONTROL standard inputs: https://ansperformance.eu/economics/cba/standard-inputs/latest/chapters/turnaround_time.html
- OAG: https://www.oag.com/blog/science-aircraft-turnarounds

**EuroAtlantic:** https://en.wikipedia.org/wiki/EuroAtlantic_Airways
