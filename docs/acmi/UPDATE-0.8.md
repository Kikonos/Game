# BLOCK HOURS v0.8 "World": design

Plan of record for v0.8, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events in real places with real airlines and governments, Dubai player, iPad landscape 1180×820 / Safari 1180×750, touch only, calm visuals, 1×/2×/4× only). DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only (offer-stream side rolls via `sideRng` / `hashUnit` as in v0.7.2); read APIs pure and added to `core/plumbing.test.ts`; ids via `nextId`;
- money only through `post` / `accrue` / `cashOnly` / `invoice`; flights only through the core helpers (`addFlight`, `retimeFlight`, `cancelFlight`, `removeFlights`, `reassignFlights`, `subcharterFlights`);
- `SAVE_VERSION` stays 1; every new field is optional with a `??=` default in its module's `load`, so v0.5.2 … v0.7.3 saves keep working (a new `save-v073.lz.txt` fixture, §14).

The player's words (22 Oct): *"favours such as an extra leg do nothing today; contracts should start poor and get better as you build relationships."* Agreed list (stages 1–3 done):

| # | Feature | One line |
|---|---|---|
| 0 | Client relationships that matter | Every client has a level (Unhappy · New · Known · Trusted · Partner) built by good flying and favours, lost by cancellations, hand-overs and late recoveries. Levels pay: +3–15 % rates, longer and bigger work, first refusal, faster payment, repeat and exclusive offers, forgiven small delays. A new company starts with poor work (company **standing**: Newcomer → Established → Respected). |
| 9 | More contract types | Hajj airlifts (drifting dates), UN multi-year rotations, VIP & presidential, deportation (moral choice), war-zone evacuation (war-risk insurance), medical airbridges, music tours, Antarctica. |
| 10 | Rivals with personalities | Real ACMI operators with styles and changing fleets; they bid against us (sometimes win, with the reason), we hire them when stuck and they hire us. A Rivals view. |
| 11 | Market cycles | Boom · steady · soft · slump phases, fuel moves, seasons and Hajj, demand shocks; a simple market outlook; offer volume and rates follow. |
| 12 | Invented world events | Coups, strikes, ash, disasters, airline failures, wars and airspace closures in real places; urgent work, risks (closures, reroutes, war-risk cover) and opportunities; inbox + a shaded zone on the map. |
| 13 | Dry lease out | The client leases the aircraft only: we ferry it out and fetch it back; monthly rent + hourly reserves; their hours on our airframe; their paint; late return and damage risk. |
| 14 | Mixed-crew contracts | The client provides N of M cabin crew (never pilots); we fill only our share (at least the purser unless their SCCM leads); lower rate; grey client seats on the roster board. |
| L | Leftovers | Bot signs a widebody on 2–4 of 6 seeds; bot runtime toward 12 s; Gantt says "programme continues" past a base programme's generated days. |
| W | What's new | A v0.8 entry at the top of `src/data/whatsNew.ts`. |

Calm rules hold: nothing flickers, only aircraft move. Closed airspace is a **static** shaded shape, levels change at most once a day (hysteresis), the outlook changes once a month, one inbox message per event. Every new problem gets the v0.7.1 four-line card (WHAT · WHY · DOES IT HURT? · WHAT YOU CAN DO) and glossary terms (§9). Nothing else is added (§15).

---

## 1. Client relationships and company standing (F0)

### 1.1 Data
`Client.relation` (−100…100) stays the single number. New optional fields (ENGINE, `contracts/relations.ts` load):

```ts
export type ClientLevel = 'unhappy' | 'new' | 'known' | 'trusted' | 'partner';
// Client (v0.8)
level?: ClientLevel;                 // stored with hysteresis; load ??= levelFor(g, c)
jobs?: number;                       // contracts completed for them; load ??= count of completed contracts
firstJob?: Minute | null; lastJob?: Minute | null;   // load ??= from contracts
log?: [Minute, number, string][];    // last 8 relation changes: time, delta, plain reason; load ??= []
forgiven?: [MonthKey, number];       // small delays forgiven this month
rivalId?: string;                    // this client is a rival operator (sub-charter in, §3.5)
// Company (v0.8)
standing?: 0 | 1 | 2;                // Newcomer / Established / Respected; load ??= standingFor(g) (old saves get what their record earns)
```

All relation changes go through one writer `bumpClient(g, clientId, delta, why)` (replaces `ops/util.ts bumpRelation`, which becomes a thin wrapper with `why = ''`, so nothing is missed); it clamps, appends to `log` (keeps 8) and never posts a message.

### 1.2 Levels (evaluated daily, stored; hysteresis 10)

| Level | Up when | Down when |
|---|---|---|
| Unhappy | relation < −15 (from any level) | back to Known/New at relation ≥ −5 |
| New | `jobs` = 0 and no active contract | — |
| Known | `jobs` ≥ 1 or an active contract, relation ≥ −15 | → Unhappy below −25 |
| Trusted | relation ≥ 30 and `jobs` ≥ 2 | → Known below 20 |
| Partner | relation ≥ 60 and `jobs` ≥ 4 | → Trusted below 50 |

A level change posts **one** message with a client-voice line (§1.7). Old saves: the level is computed with no message.

### 1.3 What moves the relation (numbers in `BAL.v08.rel`)

| Event | Δ | Where (ENGINE) |
|---|---|---|
| Wet contract month flown with ≥ 90 % legs on time (≤ 15 min) | +4 (≥ 75 %: +1; below: −2) | `contracts/billing.ts` month close |
| Contract completed, ≥ 85 % on time | **+6** (was +5); AOG cover +10; below 85 % −5 | `accept.ts completeContract` |
| Accepted change request (extra rotation / later departure) — a favour | **+4 / +3** (was +2) | `ops/events.ts resolveChange` |
| Signed an urgent offer (< 72 h lead) — short-notice cover | +3 at signing | `accept.ts acceptOffer` |
| Waived a fee (§1.5) | +4 | new resolver `clientFee` |
| Waived late-payment interest | +3 | `latePayment` decision gains option `waive` |
| Declined a change request | −2 (was −3) | `resolveChange` |
| Leg cancelled by us (not force majeure) | −3 (was −2) | `ops/flights.ts` |
| Leg > 3 h late by our fault (tech, crew, AOG; not ATC/weather/client/world event) | −1, max −4 per contract-month; **0 if forgiven** (§1.4) | `ops/flights.ts onFlightArr` |
| Sub-charter hand-over | unchanged (−0.5 a leg, cap −4 per 7 days per client) | `ops/flights.ts subHit` |
| Contract cancelled by us | −30 (unchanged) | `accept.ts` |
| Monthly drift | −1 toward 0 **only** for clients with no flying for them in 120 days (replaces the flat −2 for everyone) | `crew/morale.ts` month line |

Clean reputation now matters to clients (it was stored but unused): an offer's client weight × `1 − cleanSensitivity × max(0, 60 − clean) / 60` (sports, corporate and aid clients turn away first).

### 1.4 What each level brings (`LEVEL_PERKS`, `BAL.v08.perks`)

| Level | Rate | Offers from them | Length / MGH | First refusal | Payment | Small delays forgiven / month | Repeat offer | Exclusive |
|---|---|---|---|---|---|---|---|---|
| Unhappy | −5 % | ×0.3 | — | — | — | 0 | — | — |
| New | 0 | ×1 | — | — | — | 0 | — | — |
| Known | +3 % | ×1.3 | — | — | — | 0 | 30 % | — |
| Trusted | +8 % | ×1.7 | ×1.25 / MGH +10 % | yes | due 3 days sooner, on-time chance +0.10 | 1 | 50 % | — |
| Partner | +15 % | ×2.2 | ×1.5 / MGH +15 % | yes | due 5 days sooner, +0.20 | 3 | 80 % | capacity lease (§2.10) |

- **Rate** replaces the v0.6 loyalty ±5 % (`PriceInput.loyalty` = the level's rate). The offer stores it: `ContractOffer.levelPct` (shown "Trusted client: +8 % rate").
- **Offers from them** multiplies `nearClient` weights (replacing `1 + relation/100`).
- **Length**: base programmes (seasonBase, capacityLease, aogCover days, troop/UN rotations count) × the factor, capped by the idle window.
- **First refusal** (`ContractOffer.firstRefusal`): the offer lasts +48 h, no rival bid is rolled (§3.3) and on expiry it goes to a rival at 30 % (not 70 %). Card chip "First refusal: they asked us first".
- **Payment**: `payment.dueDays` − n at creation; the receivable's on-time roll uses `payReliability + boost` (capped 0.98).
- **Small delays forgiven**: a 15 min – 3 h delay by our fault costs no `perDelay` penalty and no relation for the first n delays in a month (`forgiven`). One quiet line in the arrival message: "Condor let it go (Trusted client)".
- **Repeat offer**: at completion of a contract (or 45 days before the end of a base programme), roll the chance; a hit generates the same archetype for the same client 20–120 days out (`repeatOf`, hook "Repeat business from Condor"), season bases for next year's summer when completed after August.

### 1.5 Favours the player can do (each a normal Decision, pacing via `canAsk`)
- **Extra leg / later departure**: the existing change requests (`extraRotation`, `retimeRequest`), now worth +4 / +3 and showing a chip "Condor: Known → 26/30 to Trusted".
- **Short-notice cover**: urgent offers (existing) show "+3 relation for helping at short notice" in the offer modal.
- **Waive a fee** (new decision kind `clientFee`, weekly chance 3 % per active contract of a Known+ client): the client cancels a rotation within 12 h (their slot / crew / pax problem) or moves a charter by a day. The contract lets us bill a late-change fee ($4–12K narrowbody, $8–25K widebody). Options: **Bill it** (+fee, relation −1) · **Waive it** (relation +4, default when the client is Trusted+). The legs are cancelled as force majeure for MGH (`lostMin`), no reliability effect.
- **Waive late-payment interest**: the existing `latePayment` decision gets `waive` (relation +3; the 3 %/yr interest line is skipped).

### 1.6 Company standing (a new company starts with poor work)
`standingFor(g)` (pure) from `stats.contractsDone`, days since `started`, `reputation`:

| Standing | Reached when | Offers |
|---|---|---|
| **Newcomer** (0) | start | rates −8 %; season bases 30–45 days, MGH 160 NB / 200 WB; 40 % of base programmes get **odd hours** (a first wave 05:00–05:30 and a last wave 23:00–23:45 local); **unloved routes** (ad hoc and AOG-cover destination pools weighted by `6 − size` instead of size); **demanding clients** (`perDelay` ×1.5; clients with `payReliability` < 0.8 weighted ×1.5); no VIP, presidential, UN, capacity lease, Antarctica; deportation offers ×2 (nobody else wants a newcomer) |
| **Established** (1) | ≥ 3 contracts done, ≥ 120 days, reliable ≥ 55 | the v0.7.3 offer flow |
| **Respected** (2) | ≥ 10 contracts done, ≥ 365 days, reliable ≥ 70, clean ≥ 50 | rates +4 %; capacity leases (6–12 months) offered; presidential and Antarctica offered; season bases up to 7 months |

Never back to Newcomer; Respected → Established when reliable < 60 or clean < 40 (one message each way). `ContractOffer.standingPct` stores the bonus/discount for the card ("Newcomer: −8 %").

### 1.7 Inbox texts (one per event; `cat: 'commercial'`, `ref: {kind: 'client', id}`)
- Level up: **"Condor now trusts us"** — "*'Three summers' worth of HAM–PMI without a single lost rotation. We'll call you first next time.'* Condor offers you first refusal, pays 3 days sooner and adds 8 % to its rates." (client voice from `data/clientVoice.ts`, by kind and for ~15 named clients: airlines, ministries, UN, tour operators, clubs, music promoters).
- Level down: **"Condor is unhappy with us"** — "Two cancelled rotations and three hand-overs to rivals in May. They'll call less and want 5 % off." (card `clientUnhappy`).
- Standing: **"We're an established operator now"** — "Three contracts flown and four months on the AOC: brokers send longer programmes at normal rates, at normal hours."
- Fee: **"Eurowings cancels tomorrow's EW7582/83"** — "Their crew shortage, not ours. The contract allows a $9K late-change fee."

### 1.8 UI
- **Offer card** (Contracts → Market): a level chip first in the chip row ("Trusted · +8 %", "New client", "Unhappy · −5 %") and "First refusal" when set. Newcomer offers carry a dim chip "Newcomer −8 %".
- **OfferModal**: a "Client" block under the terms: level pill, the perks that apply to *this* offer as lines ("+8 % rate (included)", "First refusal: no rival will take it before it expires", "1 small delay a month forgiven", "Pays 3 days sooner"), the progress line ("2 jobs, relation 26: Trusted at 30"), and for Unhappy the four-line card.
- **Contracts screen head**: a one-line standing strip ("Newcomer · short, low-margin work for now · 1 more contract and 23 days to Established"), tap → Company › Overview standing card.
- **Company screen** gets a segmented control in the head: **Overview · Clients · Rivals** (`nav.view`, 44 px). Overview = today's content with a new **Standing** card under Reputation (tier ladder of three static steps, what each brings, what is missing); the old "Competitors" card becomes a 1-line link "Rivals: 13 operators · 3 took jobs from us this year ›".
- **Clients view** (1180×820): left list 460 px (filter Seg *Working with us* / *All* / *Unhappy*; rows 56 px: flag, name, kind icon, level pill, thin bar to the next level, right "2 jobs · last Aug"); right detail pane: name, base, kind; a static five-step level strip with the current step filled; "What it brings" lines; "To reach Trusted: one more job and relation 30 (now 26)"; Recent (the `log`, 8 rows "12 Aug +4 Flew the extra HAM–PMI rotation"); active contracts and open offers (tap → contract / offer); for Unhappy the four-line card on top. Tap a row → pane (no modal on landscape); `ClientModal` (`{kind:'client', clientId}`) is used from offers and inbox links.

---

## 2. More contract types (F9)

All builders live in a new `contracts/missions.ts` (ENGINE) registered in `offers.ts BUILDERS` and `weights()`. `Archetype` gains `'medical' | 'musicTour' | 'antarctic'` (the others already exist in the union). Each offer's blurb names the real client and the job in plain words; each archetype adds one feasibility line `id: 'mission'` (ok/warn) that explains its special requirement, so every type has a "what it needs" sentence. Rates are multipliers on the reference type's ACMI rate (RESEARCH §3 table rows cited).

| Archetype | Clients (real; new seeds in `data/naming.ts`) | Product · pay | Pattern | Requirements | Effects · risks |
|---|---|---|---|---|---|
| **hajj** (§2.1) | Garuda Indonesia (CGK), Biman Bangladesh Airlines (DAC), National Hajj Commission of Nigeria (ABV/KAN), Pakistan Ministry of Religious Affairs (ISB), Saudia (JED), flynas (RUH), Royal Air Maroc (CMN), Air Algérie (ALG) | wet, ×1.20 (×1.35 when the return phase reaches June; RESEARCH §4.2), MGH WB 300 / NB 240 | two phases of shuttles, one leg each rotation empty | all-economy, max seats (WB 300+, NB 180+); widebody preferred, narrowbody only ≤ 4,500 km | morale +2; heat; crews slip at JED/MED |
| **unRotation** (§2.2) | UN Department of Peace Operations (DPO) (exists), WFP (exists) | charter per rotation ×1.1, −10 % long term (RESEARCH #11–12) | a rotation every 28–42 days for 12–24 months: troop-contributing country ↔ mission | **IOSA** approval (UN registration needs an audited operator), all-economy, 100 kg baggage (flavour), Established | morale +2, clean +1; pays in arrears 30 days |
| **vip / presidential** (§2.3) | Presidência da República de Angola (LAD), Présidence de la République du Sénégal (DSS), Office of the President of Ghana (ACC), Presidency of Nigeria (ABV), plus v0.7 VIP clients | charter ×1.75 (RESEARCH #23) | 1–3 legs over 2–10 days, abroad night-stops | VIP cabin, no fuel stops, extra cabin crew 3–4, **a spare pilot**, `standards: 'vip'` (delays > 30 min: perDelay ×3, relation −3) | Respected only; clean +1 |
| **deportation** (§2.4) | UK Home Office (STN), Spanish Ministry of the Interior (MAD), German Federal Police (BER), Frontex (exists) | charter ×1.40 (BAL.premium.deportation; RESEARCH #18) | framework of 2–6 flights over 30–90 days, return empty | narrowbody or widebody; escorts ride (40 seats blocked, flavour) | **moral choice**: clean −2 per flown leg with returnees (cap −10 a contract), morale −4 mission for its crews, crew with morale < 45 refuse (roster skips them), 12 % court injunction per flight |
| **evacuation** (§2.5) | home-country foreign ministries (exist), UK FCDO, German Federal Foreign Office | charter ×2.2 + war-risk premium passed through (RESEARCH #15, §4.7) | 2–6 shuttles staging hub ↔ conflict airport, then hub → capital | war-risk cover; ground time ≤ 2 h at the conflict airport (no night stop); lead 12–48 h | morale +6, clean +3; uninsurable 10 % on level 3 (§5.4) |
| **medical** (§2.6) | World Health Organization (WHO, GVA), International SOS (LHR), ECHO (exists) | charter ×1.7 (RESEARCH #22) | 1–4 legs, conflict/disaster area → hospital city | **dangerous goods** approval (medical oxygen); `stretchers` 4–12 (6 seats each); client medical team on board; +1 cabin crew | morale +5, clean +3 |
| **musicTour** (§2.7) | Live Nation, AEG Presents, Wasserman Music (exist) | charter ×1.8 + 2 BH-equivalent per idle day held away (RESEARCH #30) | 5–9 cities over 3–6 weeks, 2–5 days per stop, from and back to the promoter's base | two-class/VIP or 24+ premium seats, extra cabin crew 1–2; decals paint 30 % (`rollPaint` decals, client pays) | morale +3; change requests as v0.6 |
| **antarctic** (§2.8) | White Desert (CPT → Wolf's Fang), DROMLAN / Norwegian Polar Institute (CPT → Troll), Antarctic Logistics & Expeditions (PUQ → Union Glacier) | charter ×2.5 (RESEARCH #31) | 4–8 same-day out-and-backs, Nov–Feb; offered Jun–Sep | widebody (A330/A340/767/777), new **polar** approval, `roundTrip` fuel (range ≥ 2 × sector), 3,000 m blue ice | whiteout returns 12 % a leg; Respected only |
| **humanitarian** (§5) | ECHO, WFP, UNHCR, IFRC-style (exist) | charter ×1.6 | 1–4 relief legs hub → disaster airport | DG for rescue gear when SAR | only from world events; morale +5, clean +3 |
| **capacityLease** (§2.10) | airline clients | wet ×0.92, MGH 220 NB / 280 WB | base pattern 6–12 months | as seasonBase | Partner or Respected |
| **subcharterIn** (§3.5) | rivals (as clients) | wet ×1.1–1.6 | base or legs | rival's end-client standards | relation with the rival |
| **dryLeaseOut** (§6) | airline clients | dry: rent + reserves | ferries only | owned or leased-in (consent fee) | §6 |

Weights (per day, after `offerRate`): hajj only in its tender months (arafah − 180 d … − 60 d) at 0.10 for widebody fleets / 0.04 otherwise; unRotation 0.04; vip 0.05 (0.08 with a VIP cabin, presidential half of those when Respected); deportation 0.04 (×2 Newcomer); evacuation 0.02 plus world events; medical 0.02; musicTour 0.03 (Mar–Oct); antarctic 0.05 in Jun–Sep with a widebody and `polar` held or pending, else 0.01 as a ladder teaser; capacityLease 0.04 (Respected or a Partner airline); dryLeaseOut §6.1.

### 2.1 Hajj (data `data/worldCalendar.ts`, ENGINE)
- **Dates.** `hajjDates(year)` — Day of Arafah = 2025-06-05 (9 Dhu al-Hijjah 1446) + round(k × 354.367 days), the k landing in that year (≈ 11 days earlier each year). Test against the literal table ±1 day: 2026-05-26, 2027-05-15, 2028-05-04, 2029-04-23, 2030-04-12, 2031-04-02, 2032-03-21, 2033-03-11, 2034-02-28, 2035-02-18. **Pre-Hajj phase** = arafah − 32 d … arafah − 4 d (flights in); **post-Hajj phase** = arafah + 4 d … arafah + 34 d (flights home).
- **Pattern** (`legs`): one aircraft; rotations every 2 days in each phase. Pre: origin → JED (70 %) or MED (30 %) full, back next day **empty** (`pax: 0`, labelled "empty"); post: out empty, back full. ACMI pays every block hour (RESEARCH: "one leg of each phase empty"). The ~8 days around Arafah are free (the Gantt shows the gap). Origins: CGK, SUB, KNO, UPG (add if missing), DAC, KAN, ABV, ISB, LHE, KHI, CMN, ALG, DSS, KUL.
- **Product**: wet with MGH pro-rated over the two phase windows only (billing treats the middle gap as outside the term: `pattern` legs + `Contract.terms?: [Minute, Minute][]`; MGH = Σ phase days). **Verify** wet billing over a `legs` pattern (today only base patterns are wet).
- **Blurb**: "Garuda Indonesia: Hajj 1448 airlift CGK–JED/MED for about 300 pilgrims a flight. In: 13 Apr – 11 May; home: 19 May – 18 Jun. Every other leg flies empty, and the client pays those hours too. Max-seat cabin, no alcohol on board, Zamzam water in the hold on the way home."
- **Feasibility `mission` line**: "Hajj: all-economy 300+ seats; every other leg empty; crews based near Jakarta for 9 weeks".
- **Outlook** (§4.4) shows the next three Hajj windows; Hajj overlapping June raises widebody demand +0.08 for those weeks (`shocks`).

### 2.2 UN multi-year rotations
Builder reuses `troopRotation` code with the UN client: rotations every 28–42 days for 12–24 months (10–24 rotations, each TCC → mission → TCC with positioning from base priced in). TCC airports: DAC, KTM, ISB, ADD, KGL, ACC; missions: `MISSION_AIRPORTS` + `MISSION_NAMES` (MINUSCA, MINUSMA, UNMISS, MONUSCO…). Title "UN rotations MINUSCA 2027–28". Requires `iosa` (shown via the existing approvals check), Established. Cancellation scale as charters; UN pays in arrears, `dueDays` 30.

### 2.3 VIP and presidential
`vip` builder gets a `presidential` variant (government clients with `role: 'presidency'`): `requirements.standards = 'vip'`, `requirements.extraPilot = 1` (forces `crewExtra.pilot` on the contract), `noTechStops`, layouts `['vip']`, extra cabin 3–4, ×1.75. Generic VIP stays +35 %. Blurb: "Présidence de la République du Sénégal: a state visit DSS–CDG–BRU for the President's delegation of 64. VIP cabin, no fuel stops, a spare pilot, vetted crew; programme changes are likely." `mission` line: "Presidential: no fuel stops, a spare pilot, any delay over 30 min is noticed".

### 2.4 Deportation (moral choice)
- 2–6 flights over 30–90 days from the ministry's airport to LOS, ACC, TIA, ISB, LHE, DAC, ALG, CMN or KIN (add KIN); return empty. Pax 40–120 + escorts.
- **Moral panel** in the OfferModal (UI): "Well paid: +40 %. · Crews dislike it: morale −4 for everyone who flies it, crew under 45 morale refuse. · The press may notice: clean −2 a flight (this one: about −8). · Clients who care (sports clubs, corporate and aid clients) will call less while clean is under 60." Buttons unchanged; no extra confirm.
- **Injunction**: each flight 12 % at T−2…24 h: "High Court injunction: TOM8212 to Lagos will not fly" — the leg is cancelled, the client still pays it (charter: no refund; no fuel spent), our crew's duty is cancelled; morale unchanged.
- Roster: `crew/roster.ts` candidate filter skips crew with morale < 45 for duties of a deportation contract (reason "Refuses this flight").

### 2.5 War-zone evacuation
Built mostly by world events (§5.3), also by `BAL.evacuationPerDay`. Staging pairs in `data/worldZones.ts` (e.g. Sudan: PZU ↔ JED; Lebanon: BEY ↔ LCA; Libya: TIP ↔ MLA; Niger: NIM ↔ (closed) → ABJ). Price includes the war-risk premium per landing (§5.4) as a pass-through line ("War-risk cover 3 × $45K"). `mission` line: "Evacuation: no night stop at Port Sudan (2 h on the ground at most); war-risk cover can be withdrawn at short notice".

### 2.6 Medical airbridge
`requirements.stretchers` n: seats needed = pax + 6n ≤ cabin; requires `dg`; +1 cabin crew. Blurb: "WHO: an airbridge GOM–NBO for 9 stretcher patients and 60 sitting patients with a medical team of 14. Medical oxygen on board (dangerous goods approval)."

### 2.7 Music tours
Cities picked from a region by size and `biz` (Europe within 2,500 km, Americas, or worldwide on a widebody), 2–5 days apart, the aircraft stays with the tour (crews rotate as the roster plans). Pricing adds `BAL.v08.musicIdleBH` (2) BH-equivalents per day held away to `estBH`. Blurb: "Live Nation: the European leg of a stadium tour, 7 shows in 31 days (LIS, MAD, BCN, MRS, MXP, MUC, AMS). Band, crew and guests, 96 passengers; their logo on the aircraft if you agree."

### 2.8 Antarctica
- Airports (ENGINE, `data/airports.ts` append + `Airport.ice?: true`, region `ANT` "Antarctica"): `WFR` Wolf's Fang (−71.53, 8.82; 3,000 m blue ice; continent AF), `TRL` Troll (−72.01, 2.53; 3,000 m; AF), `UGL` Union Glacier (−79.78, −83.32; 3,000 m; SA). Display codes (no IATA code exists).
- Approval `polar` added to `APPROVALS`: "Blue-ice runway operations: polar survival kit, crew training and round-trip fuel planning." $250K, 90 days, requires `widebody` and `etops180`. Appears in Company › Other approvals (existing UI).
- `requirements.roundTrip`: feasibility's range check uses 2 × the sector ("No fuel at Wolf's Fang: CPT–WFR–CPT is 4,540 nm without refuelling").
- **Whiteout**: each leg to the ice 12 %: at departure the leg becomes a turn-back at the point of no return: flown as CPT–CPT (block = 55 % of the out-and-back), the rotation moves +24 h; charter: we pay that fuel ("Weather is in the price"); the client relation is unaffected. Message: "Whiteout at Wolf's Fang: CS-TQE turned back at the point of no return, 2:40 in. White Desert moves the flight to tomorrow."

### 2.9 Feasibility explanations
`CheckId` gains `'mission' | 'warRisk' | 'airspace' | 'clientCrew' | 'dryLease'`. Each line is one plain sentence (examples above and in §5.4, §6.3, §7.2).

### 2.10 Capacity lease (the exclusive reward)
`seasonBase` code with 180–365 days, ×0.92, MGH 220 NB / 280 WB; offered to Partner airlines or a Respected company. Title "Capacity lease: one A330 for LOT, Jan–Dec".

---

## 3. Rivals with personalities (F10)

### 3.1 Data (ENGINE `contracts/rivals.ts`, `data/naming.ts`)
`Rival.personality` gains `'big'`. Player-facing **style** names: cheap → "Low fares" (aggressive pricing), premium → "Prestige", steady → "Reliable", big → "Big fleet", rescue → "Rescue specialist", military → "Government work". Re-tag the seeds: Avion Express **big**, Smartwings **big**, Air Atlanta Icelandic **big**, Hi Fly **premium**, Privilege Style **premium**, KlasJet **premium**, euroAtlantic **steady**, Wamos **steady**, Global Crossing **steady**, Getjet **cheap**, Heston **cheap**, Airhub **cheap**, Titan **rescue**. (Keep any existing seed's id; only the tag changes.)

```ts
// Rival (v0.8)
status?: 'active' | 'ceased';          // load ??= 'active'
ceasedAt?: Minute;
clientId?: string;                     // its Client record (kind 'operator', rivalId) for sub-charter in; load: created via nextId
load?: number;                         // 0–1 how booked this month; load ??= seasonal value
log?: [Minute, string][];              // last 10: fleet changes, jobs it took, hires both ways; load ??= []
won?: number; hiredThem?: number; hiredUs?: number;   // counters; load ??= 0
fleetYearAgo?: number;                 // aircraft count 12 months ago (the "+2 this year"); load ??= current
```

### 3.2 Fleets and load (monthly, `refreshRivals`)
- Load = season base (Jun–Sep 0.85, Oct–Nov & Apr–May 0.7, Dec–Mar 0.55) + market phase (boom +0.1, slump −0.15) + style (big +0.05, premium −0.05) + noise ±0.05, clamped 0.3–0.98; Hajj weeks +0.1 for widebody operators.
- Fleet change per month: big +1 at 25 %; cheap +1 at 15 % / −1 at 10 %; premium +1 widebody at 10 %; steady ±1 at 8 % each; rescue/military ±1 at 5 %. Types from the rival's existing families (or a mainstream type of its body). Each change logs "Avion Express added an A320 (18 aircraft)"; no inbox message (only the Rivals view), except a rival growing past 25 aircraft or ceasing (§5).

### 3.3 Competing bids (`offers.ts finalize`, new event `rival.bid`)
At creation of every offer without first refusal:
- **Chance a rival bids** = clamp(0.25 + 0.5 × (1.2 − segment index), 0.15, 0.8) (soft markets: more rivals free). Deportation: only cheap/military rivals, ×0.5. Evacuation/repatriation: rescue/military ×1.5.
- **Who**: active rivals whose fleet fits (family, else body) with load < 0.95, weighted by (1 − load) × 1/(1 + dist(rival base, job start airport)/1,500 km) × style fit (cheap 1.3 on adhoc/aogCover/seasonBase/tourSeries; premium 1.5 on vip/sports/musicTour; military 1.5 on troop/UN/deportation/evacuation; rescue 1.5 on aogCover/evacuation/repatriation; big 1.3 on seasonBase/capacityLease/hajj).
- **When**: `at = created + (expires − created) × U(a, b)` by style — cheap [0.3, 0.7], rescue [0.2, 0.5], big [0.4, 0.8], steady [0.5, 0.9], premium/military [0.6, 1.0]. A bid at or after expiry just means the rival takes it at expiry.
- **Why** (stored text, up to two reasons): *cheaper* when `priceFactor` < 0.97 ("quoted about 9 % under the asking rate"); *closer* when the rival's base is 1,000 km nearer the job than our nearest free aircraft ("had an A320 at Vilnius, ours were 2,400 km away"); *sooner* on urgent offers ("could fly tonight").
- At `at` (queue `rival.bid`, versioned by the offer), if the offer is still open or countered-without-reply: `closeOffer(…, 'lost', rival)`, `lostWhy = why`, rival `won++`, log. **Message only when the player opened or countered it** (`ContractOffer.seen`, set by the UI via `markOfferSeen`): "**Avion Express took the Condor AOG cover**" — "They quoted about 9 % under the asking rate and had an A320 at Vilnius. Decide sooner, or keep an aircraft near the work." Card `lostToRival`. Unseen ones go silently to the Missed list with the reason.
- **What the player sees before**: `offerCompetition(g, offerId)` → `{ level: 'none' | 'some' | 'strong', text }` (strong = a bid lands within the first half of the window). Card chip "Rivals bidding" (amber) / "Some interest"; modal line "Avion Express (Low fares) is also quoting; they usually decide fast." Never the exact time.
- Expiry without a bid keeps v0.7 behaviour (lost 70 % / expired) with the rival named via `rivalFor`.

### 3.4 Hiring a rival when stuck (sub-charter out)
`subcharterQuotes(g, flightIds)` returns up to **3** quotes (active rivals with a fitting family, load < 0.9; a fuller rival shows "No aircraft free until 14 Jul"), sorted by cost: price = today's factor × `priceFactor` × level discount (rival as client: Trusted −5 %, Partner −10 %); `quality` 0–1 shown as three dots; the relation hit to *our* client scales by `1.5 − quality` (a Prestige operator embarrasses us less). `subcharter(g, ids, expectCost, rivalId?)` takes the chosen rival (default the cheapest). `hiredThem++`, log on both. Existing callers (Crew Control, AOG decision, bot) keep working with the cheapest.

### 3.5 Rivals hire us (sub-charter in)
Daily chance `BAL.v08.rivals.askPerDay` (0.03 ≈ one a month), only when one of our aircraft has an idle window ≥ 2 days starting within 72 h: a fitting rival (weighted by fleet size and load) has an AOG or an overflow job. Offer archetype `subcharterIn`, client = the rival's client record, urgent; wet ×1.3–1.6 (AOG) or ×1.1–1.2 (overflow 2–4 weeks out); base pattern at the end client's base or the legs it lost. Blurb: "Hi Fly has an A330 AOG in Lisbon and needs cover for Saudia: JED–MED–JED for 5 days, Saudia flight numbers, 'operated by' notices. Hi Fly pays us; the passengers never learn our name." Doing it is a normal contract: relation with the rival rises like any client; `hiredUs++`.

### 3.6 Rivals view (UI, Company › Rivals)
Left list 460 px: flag, name, style chip, "18 aircraft (+2 this year)", a static busy bar ("Busy: summer peak"), ceased ones greyed "Ceased operations 12 Mar". Right pane (`rivalView`): style sentence ("Low fares: undercuts by about 10 % and signs fast; a reliable choice to hire when you're stuck in Europe"), fleet table (type × count), dealings ("Took 3 jobs from us · we hired them twice · they hired us once"), level as a client (if any), last 10 log lines. `RivalModal` (`{kind:'rival', rivalId}`) for inbox/offer links.

---

## 4. Market cycles (F11)

### 4.1 Data (`Market`, ENGINE `ops/market.ts`)
```ts
export type MarketPhase = 'boom' | 'steady' | 'soft' | 'slump';
// Market (v0.8)
cycle?: { phase: MarketPhase; since: Minute; until: Minute; narrowOff: number; wideOff: number };  // load ??= steady, until = now + 9 months
shocks?: { id: string; seg: 'narrow' | 'wide' | 'all'; delta: number; until: Minute; text: string; eventId?: string }[];  // load ??= []
```

### 4.2 Rules (monthly `refreshMarket`)
- **Phase targets** (RESEARCH §4.2 "±10–20 % per cycle phase"): boom 1.15, steady 1.00, soft 0.92, slump 0.82; segment offsets `narrowOff`/`wideOff` rolled ±0.05 at each phase change (narrow and wide can diverge, as in 2026).
- **Durations**: boom 6–12 months, steady 9–18, soft 6–12, slump 6–12. Next phase: steady → boom 35 % / soft 45 % / steady again 20 %; boom → steady 60 % / soft 40 %; soft → slump 35 % / steady 65 %; slump → soft 50 % / steady 50 %. A new game starts steady for at least 9 months.
- **Index** each month: `idx += (target + off − idx) × 0.25 + N(0, 0.02)`, clamped 0.75–1.30 (replaces the ±0.03 walk toward 1). Read sites keep reading `narrowIndex`/`wideIndex`; **shocks** are added by one helper `segIndex(g, seg)` that pricing and offer volume use (`rateMultiplier`, `offerRate`).
- **Offer volume**: `offerRate × demandF`, demandF = (fleet-weighted segment index)² (slump ≈ 0.67, boom ≈ 1.32).
- **Fuel**: the monthly walk stays; events apply jumps directly to `fuelPrice` (war in the Gulf/Red Sea +12–25 %, ash/strikes 0) and the existing mean reversion brings it back. Fuel > $900/t: charter archetypes' weights ×0.85 (tour operators wait). Wet work is unaffected (the client pays fuel); charters, ferries and dry-lease deliveries price at the current fuel.
- **Seasons**: unchanged (`SEASON_F`, ±15 % rates) plus Hajj (§2.1) and the Antarctic season.
- Phase change → one message: "**The ACMI market is softening**" — "Airlines are taking fewer extra aircraft this autumn: fewer offers and rates about 8 % lower for the next 6–12 months. Long contracts signed now keep their rates."

### 4.3 Shocks (from world events, §5)
| Shock | Δ index | Length |
|---|---|---|
| Airline failure (a real airline or a rival ceases) | +0.08 on its body | 60 days, plus 1–3 urgent ACMI offers |
| Engine crisis (GTF-type inspections ground A320neos) | narrow +0.12 | 120–180 days, AOG-cover weight ×2 |
| Recession | sets phase to slump (or soft if already slump) | its phase length |
| Hajj overlapping June | wide +0.08 | the Hajj weeks |
| War in a region | that region's offers: evacuation/repatriation; fuel jump | event length |

### 4.4 Outlook (`marketOutlook(g)`, pure) and UI
`{ phase, phaseText, narrow: {index, trend, text}, wide: {…}, fuel: {price, trend, text}, season: {name, text}, hajj: [next 3 {arafah, pre, post}], antarctic: [from, to], shocks: [{text, until}], offersText }`. Trend = sign of the last month's change (± 0.01 dead band), changes at most monthly.
- **Contracts screen head** (UI): a one-line strip of four compact tiles next to the standing strip: "Narrowbody demand ↑ high" · "Widebody · steady" · "Fuel $780/t ↓" · "Summer peak · Hajj in 46 d". Tap → **OutlookModal** (`{kind:'outlook'}`): the four tiles larger, the phase sentence, a static 12-month calendar (rows Season · Hajj in/home · Antarctic season · active events; today line static, redrawn on day change), shocks list ("Lufthansa pilots' strike: +8 % narrowbody demand until 14 Nov").

---

## 5. Invented world events (F12)

### 5.1 Data
```ts
export type WorldEventKind = 'coup' | 'strike' | 'ash' | 'disaster' | 'airlineFailure' | 'war' | 'airspace' | 'unrest' | 'engineCrisis' | 'recession';
export interface WorldEvent {
  id: string; kind: WorldEventKind; tpl: string;      // template id (data/worldEvents.ts)
  title: string; body: string;
  country: string; at: string;                        // ISO-2 and the focus airport (map pin)
  start: Minute; end: Minute; extended?: boolean;
  zoneId?: string; closed?: boolean;                  // airspace closed while active
  warRisk?: 1 | 2 | 3;                                // war-risk level for the zone's airports
  entity?: string;                                    // the airline / rival / ministry involved (text)
  rivalId?: string;                                   // a rival that ceased
  offerIds: string[]; flightsHit: number; done?: boolean;
}
// GameState (v0.8): world?: { events: WorldEvent[]; lastKind?: Partial<Record<WorldEventKind, Minute>> }   // load ??= { events: [] }
```
- `data/worldZones.ts`: ~20 zones, each `{ id, name, countries: string[], ring: [lon, lat][] (6–12 points, simple outline of the airspace), detourMin, staging?: [string, string][], baseWarRisk?: 1 | 2 | 3 }` — Sudan, South Sudan, Libya, Lebanon/Israel, Syria, Iraq, Iran, Yemen/Red Sea, Niger, Mali, Burkina Faso, Chad, Haiti, Myanmar, Pakistan, Iceland (ash), Sicily (Etna ash), East Java/Bali (ash), Ethiopia, eastern DR Congo. Static baseline war risk: Yemen 3, Syria 3, Sudan 2, Libya 2, Somalia 2 (no closure unless an event).
- `data/worldEvents.ts`: templates per kind with real places and entities (BRIEF: plausible, varied; never accuse a named private individual): e.g. coup "Military takeover in Niamey: Niger's airspace is closed", strike "French air traffic controllers strike (DSNA): 30 % of overflights cut", "Lufthansa pilots strike (Vereinigung Cockpit) for 3 days", "Belgian national strike closes Brussels Airport", ash "Reykjanes eruption: ash closes Keflavík and Icelandic airspace", "Etna ash closes Catania", "Lewotobi ash closes Bali", disaster "7.1 earthquake near Adana", "Hurricane in the Caribbean: Punta Cana closed", "Floods in Sindh", airlineFailure "Air Moldova-style failure" with real names from a list of fragile carriers and the rivals, war "Fighting reaches Khartoum: Sudan closes its airspace", "Israel–Lebanon escalation: insurers re-price Beirut", "Red Sea strikes: carriers avoid Yemeni airspace", airspace "Pakistan closes its airspace to Indian-registered flights", engineCrisis "Pratt & Whitney orders more GTF inspections: 40 A320neos grounded across Wizz Air and IndiGo", recession "Eurozone slips into recession". Missing airports added (PAP, BGW, EBL, KIV, KIN, NJF if used).

### 5.2 Generation (`ops/world.ts`, daily)
- p = `BAL.v08.world.perDay` 0.07 (≈ 2 a month), at most 3 active, same kind ≥ 20 days apart; engineCrisis ≤ 1 a year, recession ≤ 1 per 2 years. Kind weights: strike 0.22, disaster 0.14, war 0.12, airlineFailure 0.10, unrest 0.10, coup 0.08, ash 0.08, airspace 0.08, engineCrisis 0.04, recession 0.04.
- Lengths: strike 1–3 days, ash 1–4, coup 5–14 (closure), war 10–40 (closure 50 %; war risk 2–3 always), unrest 3–10 (war risk 1), disaster 7–21 (no closure; the airport may be closed 1–2 days), airspace 7–30, airline failure: instant (shock 60 days), engine crisis 120–180, recession: its phase.
- **Extension**: closures 30 % once, +2–5 days (one message).
- Never targets our home base country with a closure; an airline failure never picks a client with an active contract with us (keeps it fair and simple).

### 5.3 What events do
- **Work**: within 0–48 h, 1–3 offers tagged `eventId`: coup/war/unrest → evacuation (staging pair) and repatriation (existing builder, our home ministry); disaster → humanitarian and medical; strike at an airline / airline failure / engine crisis → urgent aogCover / seasonBase / capacity for its competitors in the same market (e.g. "Eurowings needs two A320s for 3 days during the Lufthansa pilots' strike"); rival ceasing → its end clients' urgent ACMI work + cheaper hiring: `hireDays` ×0.5 and the rated pool +2 per family for 45 days ("Getjet's crews are looking for work").
- **Market**: shocks (§4.3), fuel jumps.
- **Risks** (§5.4).

### 5.4 Closures, reroutes and war-risk cover (ENGINE `ops/world.ts`, `ops/flights.ts`)
- `crosses(zone, from, to)`: 24 samples on the great circle, point-in-polygon on `ring` (pure).
- At event start and daily while it is active, for scheduled flights with `std` before `end + 1 day`:
  - **Touches** a closed airport (from/to inside the zone): `Flight.closedBy = eventId`; departure readiness fails while closed (held like a crew hold). One decision per contract, kind `airspace`: **Wait** (default: retime the legs to `end + 3 h`, re-retimed on an extension; force majeure: no penalty, no relation or reliability change) · **Cancel these legs** (force majeure: no compensation, the block minutes come off the month's MGH via `lostMin`, no relation change). New helper `cancelForceMajeure(g, flightIds, why)` in `ops/flights.ts`.
  - **Overflies** a closed zone: reroute = `retimeFlight` with block + `zone.detourMin` (20–90 min), `Flight.detour` set once; wet: the client pays the extra hours; charter: we pay the extra fuel (already posted from block at arrival). One message per event: "**Sudanese airspace closed**: 6 of our legs rerouted around it, +40 min each. Port Sudan flights wait for the reopening."
- **War-risk cover** (RESEARCH §4.7): each revenue or positioning leg landing at an airport with war risk L pays per landing narrowbody [$8K, $20K, $45K], widebody ×1.8, ledger cat **`warRisk`** at departure. Wet contracts: re-billed to the client (`otherRevenue`, same amount; RESEARCH §2.2 "passed to the client"). Charter offers built while the risk exists price it in.
- **Uninsurable**: at T−48 h, legs into level 3: 10 % → decision `uninsurable`: **Wait a day** (50 % the insurer comes back; else ask again) · **Cancel** (force majeure) · **Hand to a rival** (rescue/military rivals only, §3.4 quote). Default Cancel. Card `uninsurable`.
- Feasibility: `airspace` (no when a leg's airport is closed through its start, warn with the detour) and `warRisk` (warn: "War-risk cover $45K a landing at Port Sudan; cover can be withdrawn 48 h before").

### 5.5 Inbox (topic `'world'`, `cat: 'ops'` or `'commercial'`, `ref: {kind: 'event', id}`)
One message at start ("**Coup in Niger**" — "Soldiers have taken over in Niamey and closed the airport and Niger's airspace until at least 9 Aug. Europeans are being told to leave: the French and Spanish foreign ministries are asking for evacuation flights from Niamey via Abidjan."), one at an extension, one at reopening only if it closed airspace ("**Niger's airspace has reopened**"). Airline failures, strikes and shocks: one message. No toast storm: these messages never toast; urgent offers they create pause as today (`urgentOffer`).

### 5.6 Map (MAP lane)
- **Zones**: `worldZones(g)` → active zones drawn under the arcs as a static fill (closed: muted red 18 % with a 45° hatch; war risk only: amber outline dashed; ash: grey 22 %); label at zoom ≥ 2 ("Closed · Sudan"). No animation; drawn once per zone list change.
- **Event pins**: `worldEventPins(g)` → one small static glyph per active event at its airport (icon by kind: coup/war shield, strike hand, ash cloud, disaster wave, failure tail-down), 44 px hit. Tap → map panel (`MapPanels` event panel: title, place, until, effects lines, our flights affected (tap → flight), offers it created (tap → offer), "More" → `store.openModal({kind:'worldEvent', eventId})`).
- Leased-out aircraft (§6.5): drawn parked at the lessee's base in the lessee's paint when painted, with a small grey "leased" badge; tap → aircraft panel "Leased to TAAG until 14 Mar".

---

## 6. Dry lease out (F13)

### 6.1 Offers (`missions.ts dryLeaseOut`)
- Only as gap-fit: an owned **or leased-in** aircraft with an idle window ≥ 75 days starting 14–60 days out (Oct–Mar weight 0.07, else 0.03). Clients: airline clients outside our home market (TAAG, Air Sénégal, Royal Air Maroc, Airlink, LATAM, flynas, Fiji Airways, Vietnam Airlines, GOL…) whose family fits.
- Terms (RESEARCH §4.6): 3–9 months (Newcomer 3–4); rent = the type's market rent × segment index × U(0.95, 1.10) (A320ceo/737-800 ≈ $230–250K, A321ceo $260K, 767-300ER $170K, A330-200 $200K, A330-300 $330K, 777-200ER $250K); **reserves** per FH narrow $420, wide $850 (airframe + engines + APU); expected use narrow 230 FH/month, wide 330 FH/month (±15 % monthly); security deposit = 1 month's rent (cash in at signing, back at return less damage, via `cashOnly`). Leased-in aircraft: lessor consent fee $20K NB / $40K WB at signing (`fees` line text "Lessor consent (sub-lease)"). Paint: 50 % of offers want their colours (full 40 % / decals 60 %), lessee pays and paints at its MRO (no time on our side).
- Product `{kind: 'dry', rentPerMonth, reservesPerFH}` (exists). Blurb: "TAAG Angola Airlines wants an A320 dry, without crew, for 5 months from 1 Dec at Luanda: $238K a month plus $420 per flight hour in reserves. Our pilots deliver it and fetch it back; their crews and engineers fly and maintain it in TAAG colours. Line and A-checks are theirs, the C-check stays ours."

### 6.2 Phases (ENGINE `ops/dryLease.ts`; `Contract.dry`)
```ts
dry?: { site: string; fhPerMonth: number; deposit: number; outIds: string[]; backIds: string[];
        leasedAt?: Minute; returnedAt?: Minute; fh: number; late?: number; damage?: { cost: number; days: number; maintId?: string } };
// Flight.purpose gains 'lease'; AircraftStatus 'leasedOut' (exists)
```
1. **Delivery**: a ferry (`purpose: 'lease'`, multi-leg via `planPositioning`) from where the aircraft is to the lessee's base, arriving ≤ 1 day before the start; pilots only (`seatsFor … pilotsOnly`); they deadhead home (the roster plans it as for delivery ferries). We pay the ferry fuel and fees.
2. **Lease** (`lease.out` at arrival): `status = 'leasedOut'`, `at = site`, `paintedFor = contractId` when painted. Rent invoiced on each month's 1st in advance (due 5 days; the lessee's `payReliability`), reserves invoiced monthly in arrears on hours flown, both to new ledger cat **`leaseIncome`**. Daily: hours accrue (`hours`, `cycles` at 1.8 h/cycle NB, 5 h WB, `maint.fhSinceA`, `fhSinceC`); when `fhSinceA` reaches the interval the lessee does the A-check (counter reset, no cost or downtime for us). Our insurance for that airframe stops (the lessee insures); rent and reserves on a leased-in airframe keep running (check `finance.ts` skips: insurance only).
3. **Collect** (`lease.back` at the end + 1 day inspection): our pilots deadhead out; the return ferry home; on arrival a **return inspection** (`line` maintenance, 2 days at base), deposit refunded less damage, `paintedFor` cleared (the lessee's return condition repaints our colours).
- **Feasibility** (`dryLease` check): free for [ferry out … ferry back + 2 days]; the C-check by calendar or FH (projected with `fhPerMonth`) not due before return + 30 days ("C-check due in March, during the lease: book it before" with the CheckModal action); owned or leased-in (lease end after return + 30 days); pilots of the family for both ferries.
- **Risks**: late return 15 % (3–20 days; holdover rent 150 % a day; the ferry moves; if it clashes with our next contract, the card `leaseLate` offers the sub-charter of the clashing legs); damage 8 % at inspection (hard landing / tail scrape / ground damage: 4–12 days AOG-style maintenance, $80–600K; lessee pays 70 %, invoiced, due 45 days; we pay 30 %). Payment risk = the lessee's reliability (late-payment decision as today).

### 6.3 Inbox
- Delivery: "**CS-TQA delivered to TAAG in Luanda**" — "Our pilots fly home tonight via Lisbon on TAAG. Rent $238K a month from today; she comes back on 30 Apr."
- Late: "**TAAG returns CS-TQA 9 days late**" — "Their replacement A320 is late. They pay 150 % rent for each extra day; the ferry home moves to 9 May." (card `leaseLate`)
- Damage: "**Return inspection: CS-TQA has a hard-landing finding**" — "6 days in the hangar, $240K; TAAG pays 70 % under the lease." (card `leaseDamage`)

### 6.4 UI
- Offer card chip "Dry lease · 5 months"; OfferModal dry panel: a static three-segment timeline (ferry out · lease · ferry back), money lines (rent × months, reserves at the expected hours, deposit, consent fee, ferry cost), "Their hours on our airframe: about 1,150 FH; C-check due after the return" and the four-line card `dryLeaseInfo` (WHAT a dry lease is · WHY it pays · DOES IT HURT? our crews of the type have less work · WHAT YOU CAN DO).
- Fleet card: status "Leased out" + "to TAAG until 30 Apr · 412 FH flown by them · next C-check after return".
- Schedule: the row stays visible (today hidden when `leasedOut`) with one block "Dry lease · TAAG Angola Airlines" in the contract colour between the two ferry blocks; BlockSheet shows `dryLeaseView`.
- Finance: the statement shows "Lease income" and "War-risk cover" lines.

---

## 7. Mixed-crew contracts (F14)

### 7.1 Data and rules (ENGINE `crew/clientCrew.ts`, `crew/extraSeats.ts`, `crew/roster.ts`)
```ts
// Requirements (v0.8)
clientCabin?: { n: number; of: number; leads: boolean };   // the client provides n of `of` cabin crew; leads = its SCCM is the senior
```
- **Offers**: wet airline offers (seasonBase, aogCover, capacityLease, hajj): 35 % for clients outside the EU/UK, 10 % EU/UK, 50 % on Hajj. Split: *all but the purser* (n = M − 1) 35 %, *most* (n = M − 2) 25 %, *half* (n = ⌊M/2⌋) 25 %, *all, their SCCM leads* (n = M, damp lease) 15 %. M = the reference type's cabin complement for the requirement (`complement` cabin roles).
- **Price**: the wet rate − `BAL.v08.mixedCrew.perCabinBH` ($75, RESEARCH §4.3) × n per BH (A330, 6 of 8 by Air Sénégal: −$450/BH).
- **Our share**: `seatsFor(…, { clientCabin })` drops n cabin seats, CC first; the PUR seat is dropped only when `leads`. Our company extra-cabin policy is not added on these contracts (the client staffs the cabin). The **rest plan** and cabin legality still count the full complement (the client's crew rest too).
- `clientCrewOf(g, dutyOrPairingId)` → `{ n, leads, label: 'Air Sénégal cabin crew', roles }` (pure).
- Flavour only (no morale rule): offer and sheet lines "Air Sénégal's crew brief in French; our purser runs the cabin in French and English" (language by client country), "Their uniform, our safety procedures: our purser checks their SEP cards at the first briefing".

### 7.2 UI
- Offer chip "Client crew 6 of 8"; OfferModal seat strip: one square per cabin seat, ours in the accent colour with role labels, theirs grey with the client's name; the line "Air Sénégal provides 6 of 8 cabin crew; we fly the purser and one cabin crew. −$450 a block hour." `clientCrew` feasibility line (ok).
- DutyModal / BlockSheet crew list: grey non-interactive rows after our seats ("Air Sénégal crew · CC ×6").
- **Roster board**: a final group "Client cabin crew" with one grey row per mixed-crew contract ("Air Sénégal · 6 per flight"), its duties as grey blocks (`clientCrewRows`), not draggable, no names.

---

## 8. Leftovers (ENGINE bot; UI Gantt)
- **Widebody on 2–4 of 6 seeds** (`scripts/acmi-bot.ts fleet()`): sign when cash ≥ deposit + 2 × `wideMonth` + $300K (was 3× + $500K), the last quarter profitable (approval fees excluded), and either a fitting widebody job (≥ $1M, now including hajj, UN, capacity lease) or `carry` with qProfit ≥ 2 × `wideMonth`. Target: 2–4 of seeds 1–6 sign within 365 days; none goes below the v0.7.3 cash floor.
- **Bot runtime** (32–35 s → target 12 s, hard ≤ 20 s with the new systems): profile with `node --cpu-prof` through `tsx`; expected hot spots: `feasibility` per open offer × aircraft every 6 h step (cache per offer per day: `quick` first, full only for the best two), `idleWindows` per offer creation (memoise per day and fleet revision), full re-roster calls. Report before/after per seed.
- **Gantt "programme continues"** (UI `scheduleLogic.ts`): the trailing idle gap of an aircraft whose last block belongs to a base-pattern contract with `pattern.to > generatedUntil` becomes a faint contract-coloured block "Condor programme continues · flights added daily until 31 Oct" (not "free … nothing booked"); the rest of the gap after `pattern.to` keeps the idle label.

---

## 9. Cards, glossary, voice, what's new (ENGINE data; UI renders as v0.7.1)

**New `ProblemKind`s and their four lines** (`problems/commercial.ts`, `problems/fleet.ts`, new `problems/world.ts`):

| Kind | WHAT | WHY | DOES IT HURT? | WHAT YOU CAN DO |
|---|---|---|---|---|
| `clientUnhappy` | "Condor is unhappy with us" | the top 2–3 `log` reasons in words | "Yes: −5 % on their offers, they call a third as often, no forgiven delays" | "Fly their next job on time and say yes to their next request; it recovers about 4 a month of good flying" |
| `lostToRival` | "Avion Express took the Condor AOG cover" | the stored `lostWhy` | "Not now: we lose the work, nothing else" | "Decide sooner on 'Rivals bidding' offers; keep an aircraft near the work; Trusted clients ask us first" |
| `airspaceClosed` | "Sudanese airspace is closed" | the event text | "N legs held, M rerouted (+40 min each); force majeure: no penalties" | "Wait for the reopening (default) or cancel the legs without penalty" |
| `uninsurable` | "No war-risk cover for PZU on 12 Aug" | "Insurers withdrew cover 48 h before (Sudan, level 3)" | "Yes: the flight cannot legally operate" | "Wait a day · cancel (no penalty) · hand to a rival who has cover" |
| `leaseLate` | "TAAG returns CS-TQA 9 days late" | lessee reason | "Holdover rent pays 150 %; our flights on 5–9 May need her" | "Hand those legs to a rival, or move the trip to another aircraft" |
| `leaseDamage` | "CS-TQA: hard-landing finding" | inspection | "6 days out, $72K is ours (TAAG pays 70 %)" | "Nothing to decide; plan around the 6 days" |
| `dryLeaseInfo` | "What a dry lease is" | "They fly it with their crews; we earn rent and reserves" | "Our A320 crews have less work for 5 months; C-check after return" | "Book the C-check before if it falls inside; accept or let it go" |

**Glossary** (`data/glossary.ts`, `<Term>` phrases): *relationship level*, *standing*, *first refusal*, *Hajj*, *Day of Arafah*, *dry lease*, *maintenance reserves*, *damp lease / client cabin crew*, *SCCM*, *war-risk cover*, *force majeure*, *sub-charter in*, *market phase*, *blue-ice runway*, *point of no return*, *injunction*.

**Voice check**: every text readable by a former cabin crew member, names the client or the flight, says a number once with its unit, ends with what to do.

**What's new** (`src/data/whatsNew.ts`, top entry `v0.8` "World"), player words, features:
1. Clients remember you: New → Known → Trusted → Partner. Trusted clients pay more, ask you first, pay sooner and forgive a small delay; favours like an extra rotation now count.
2. A new airline starts with the work nobody wants: short, cheap, odd hours. Fly it well and better offers come.
3. New work: Hajj airlifts that move 11 days earlier every year, UN rotations for a year or two, presidential flights, deportation flights (well paid, but your crews and reputation pay too), evacuations with war-risk insurance, medical airbridges, music tours and Antarctica on blue ice.
4. Real rivals with their own styles bid for the same jobs, sometimes win (and you're told why), and hire each other — and you.
5. The market moves: booms and slumps, fuel, seasons and Hajj. A simple outlook on the Contracts screen.
6. The world happens: coups, strikes, ash clouds, disasters, airline failures and closed airspace in real places, with urgent work and real risk. Closed airspace is shaded on the map.
7. Dry leases: rent an aircraft to another airline without crew; your pilots deliver it and fetch it back.
8. Mixed crews: the client brings most of the cabin crew, like Getjet's A330 for Air Sénégal; you fly the purser.
Improvements: favours and change requests now say what they do for the relationship; the timeline says when a base programme simply continues instead of 'nothing booked'.

---

## 10. Data model (ENGINE lands first: one additive edit of `core/types.ts`)
All fields optional unless the type is new; load defaults in brackets.
- `ClientLevel`; `Client.level` [levelFor], `jobs` [count], `firstJob`, `lastJob` [from contracts], `log` [[]], `forgiven`, `rivalId`.
- `Company.standing` [standingFor].
- `Rival.personality` += `'big'`; `Rival.status` ['active'], `ceasedAt`, `clientId` [created], `load` [season], `log` [[]], `won`, `hiredThem`, `hiredUs` [0], `fleetYearAgo` [count].
- `Archetype` += `'medical' | 'musicTour' | 'antarctic'`.
- `Requirements.clientCabin`, `roundTrip`, `stretchers`, `extraPilot?: 1`, `standards?: 'vip'`.
- `ContractOffer.rivalBid?: { rivalId; at; factor; why }`, `firstRefusal`, `repeatOf`, `seen`, `levelPct`, `standingPct`, `lostWhy`, `eventId`.
- `Contract.dry` (§6.2), `terms?: [Minute, Minute][]` (Hajj phases for MGH), `eventId`, `repeatRolled`.
- `Flight.purpose` += `'lease'`; `Flight.closedBy`, `detour`.
- `Ref.kind` += `'client' | 'rival' | 'event'`; `Message.topic` += `'world'`.
- `LedgerCat` += `'leaseIncome' | 'warRisk'`.
- `ProblemKind` += `'clientUnhappy' | 'lostToRival' | 'airspaceClosed' | 'uninsurable' | 'leaseLate' | 'leaseDamage' | 'dryLeaseInfo'`.
- `SimEventType` += `'rival.bid' | 'world.start' | 'world.end' | 'lease.out' | 'lease.back'`.
- `MarketPhase`; `Market.cycle` [steady], `shocks` [[]].
- `WorldEventKind`, `WorldEvent`; `GameState.world` [{events: []}].
- `ApprovalId` already has `'polar'`; `APPROVALS` gains it (§2.8).
- `Stats`: `v08?: { lostToRival; subIn; dryLeases; dryMonths; worldEvents; closuresHit; legsRerouted; legsFm; warRiskPaid; injunctions; whiteouts; levelUps; feesWaived }` [zeros].
- `data`: `Airport.ice?`, region `ANT`; `ClientSeed.role` += `'hajj' | 'presidency' | 'interior' | 'health'`; `RivalSeed.personality` += `'big'`.

## 11. Balance (`core/balance.ts`, new block `v08`)
```ts
v08: {
  rel: { wetMonth: [4, 1, -2], done: 6, doneAog: 10, doneBad: -5, extraLeg: 4, retime: 3, urgentSign: 3, waiveFee: 4, waiveInterest: 3, decline: -2, cancelLeg: -3, lateLeg: -1, lateCap: -4, driftIdleDays: 120, drift: 1, clientFeeWeekly: 0.03, fee: { narrow: [4_000, 12_000], wide: [8_000, 25_000] } },
  levels: { unhappy: -15, known: -15, trusted: [30, 2], partner: [60, 4], hysteresis: 10 },
  perks: { /* §1.4 table */ },
  standing: { est: { done: 3, days: 120, reliable: 55 }, resp: { done: 10, days: 365, reliable: 70, clean: 50 }, newcomerRate: -0.08, respectedRate: 0.04, newcomerBaseDays: [30, 45], newcomerMgh: [160, 200], oddHours: 0.4, demandingDelay: 1.5 },
  arch: { hajj: [1.2, 1.35], un: 1.1, unLong: -0.1, presidential: 1.75, deportation: 1.4, evacuation: 2.2, medical: 1.7, music: 1.8, musicIdleBH: 2, antarctic: 2.5, humanitarian: 1.6, capacity: 0.92, subIn: [1.1, 1.6] },
  rivals: { bidBase: 0.25, bidSlope: 0.5, bidMin: 0.15, bidMax: 0.8, askPerDay: 0.03, quotes: 3 },
  market: { target: { boom: 1.15, steady: 1, soft: 0.92, slump: 0.82 }, pull: 0.25, noise: 0.02, clamp: [0.75, 1.3], fuelHigh: 900 },
  world: { perDay: 0.07, maxActive: 3, sameKindDays: 20, warRisk: { narrow: [8_000, 20_000, 45_000], wideMult: 1.8 }, uninsurable: 0.1, injunction: 0.12, whiteout: 0.12, extend: 0.3 },
  dry: { reserves: { narrow: 420, wide: 850 }, fh: { narrow: 230, wide: 330 }, consent: { narrow: 20_000, wide: 40_000 }, late: 0.15, lateDays: [3, 20], holdover: 1.5, damage: 0.08, damageCost: [80_000, 600_000], damageDays: [4, 12], lesseeShare: 0.7 },
  mixedCrew: { perCabinBH: 75, share: { far: 0.35, eu: 0.1, hajj: 0.5 } },
}
```
**Balance intent.** Year 1 is harder (Newcomer rates −8 %, 30–45-day bases) but survivable on every seed; from Established the v0.7.3 economics return; Trusted/Partner clients add about 5–10 % revenue by year 2, so loyalty is worth favours. Rivals take roughly 15–25 % of the offers the bot would want (deciding fast matters). World events ≈ 2 a month; about one a quarter touches our flights. Deportation pays about +40 % but costs ~8 clean a contract and crew morale; evacuations pay best and carry real risk. Dry leasing an idle A320 through the winter earns ~$330K a month against idle fixed costs.

## 12. Interfaces between lanes (final signatures; ENGINE ships stubs first)
```ts
// contracts/relations.ts (pure unless noted)
export type ClientLevel; export const LEVEL_PERKS: Record<ClientLevel, LevelPerks>;
export interface ClientView { id: string; name: string; kind: ClientKind; country: string; base: string; level: ClientLevel; levelName: string; relation: number;
  next: { level: ClientLevel; need: string } | null; perks: string[]; jobs: number; lastJob: Minute | null;
  active: string[]; offers: string[]; log: { t: Minute; delta: number; text: string }[]; unhappy: ProblemRef | null; rivalId?: string }
export function clientView(g: GameState, clientId: string): ClientView | null;
export function clientList(g: GameState, filter: 'working' | 'all' | 'unhappy'): ClientView[];
export function offerClientLine(g: GameState, offerId: string): { level: ClientLevel; chip: string; lines: string[]; progress: string } | null;
export interface Standing { tier: 0 | 1 | 2; name: 'Newcomer' | 'Established' | 'Respected'; text: string; effects: string[]; next: string | null; progress: { label: string; have: number; need: number }[] }
export function standing(g: GameState): Standing;
export function bumpClient(g: GameState, clientId: string, delta: number, why: string): void;      // action-side
// decision kind 'clientFee' (options 'bill' | 'waive') resolves through the existing resolveDecision(g, id, option)
// contracts/rivals.ts
export type RivalStyle = 'cheap' | 'premium' | 'steady' | 'big' | 'rescue' | 'military';
export interface RivalView { id: string; name: string; country: string; base: string; style: RivalStyle; styleName: string; styleText: string;
  fleet: { typeId: string; count: number }[]; fleetCount: number; fleetDelta: number; busy: number; busyText: string;
  won: number; hiredThem: number; hiredUs: number; level: ClientLevel | null; log: { t: Minute; text: string }[]; ceased: Minute | null }
export function rivalList(g: GameState): RivalView[]; export function rivalView(g: GameState, rivalId: string): RivalView | null;
export function offerCompetition(g: GameState, offerId: string): { level: 'none' | 'some' | 'strong'; text: string; rivalId?: string };
export function markOfferSeen(g: GameState, offerId: string): void;                            // action (UI calls on OfferModal open)
// ops/subcharter.ts
export interface SubcharterQuote { /* v0.7.2 fields */ quality: number; available: boolean; why?: string; style: RivalStyle }
export function subcharterQuotes(g: GameState, flightIds: string[]): SubcharterQuote[];          // ≤ 3, cheapest first
export function subcharterQuote(g, flightIds): SubcharterQuote | null;                           // kept = quotes[0]
export function subcharter(g, flightIds, expectCost?: number, rivalId?: string): ActionResult<{ legs: number; cost: number; rivalName: string }>;
// ops/market.ts
export type MarketPhase; export interface MarketOutlook { /* §4.4 */ }
export function marketOutlook(g: GameState): MarketOutlook; export function segIndex(g: GameState, seg: 'narrow' | 'wide'): number;
// data/worldCalendar.ts
export function hajjDates(year: number): { arafah: Minute; pre: [Minute, Minute]; post: [Minute, Minute] };
export function nextHajj(t: Minute, n?: number): ReturnType<typeof hajjDates>[];
export function antarcticSeason(t: Minute): [Minute, Minute];
// ops/world.ts
export interface WorldEventView { id: string; kind: WorldEventKind; title: string; body: string; place: string; at: string; country: string;
  start: Minute; end: Minute; active: boolean; effects: string[]; flights: string[]; offers: string[]; zoneId?: string; icon: string }
export interface ZoneView { id: string; eventId: string; name: string; ring: [number, number][]; style: 'closed' | 'warRisk' | 'ash'; label: string }
export function worldEvents(g: GameState, opts?: { active?: boolean }): WorldEventView[];
export function worldEvent(g: GameState, eventId: string): WorldEventView | null;
export function worldZones(g: GameState): ZoneView[];                                           // stable array identity while unchanged (MAP memo)
export function worldEventPins(g: GameState): { eventId: string; at: string; kind: WorldEventKind; title: string }[];
export function flightZone(g: GameState, flightId: string): { eventId: string; effect: 'held' | 'detour' | 'warRisk'; text: string } | null;
export function devWorldEvent(g: GameState, kind?: WorldEventKind, tpl?: string): string;       // engine/dev.ts; event id
// ops/dryLease.ts
export interface DryLeaseView { contractId: string; aircraftId: string; lessee: string; site: string; phase: 'signed' | 'delivering' | 'leased' | 'returning' | 'done';
  out: [Minute, Minute]; lease: [Minute, Minute]; back: [Minute, Minute]; rent: number; reservesPerFH: number; fhSoFar: number; fhExpected: number;
  income: number; deposit: number; late: number; damage: string | null; cCheck: string }
export function dryLeaseView(g: GameState, contractId: string): DryLeaseView | null;
export function dryLeaseOf(g: GameState, aircraftId: string): DryLeaseView | null;
// crew/clientCrew.ts
export function clientCrewOf(g: GameState, id: string): { n: number; leads: boolean; label: string; roles: Role[] } | null;   // duty or pairing id
export function clientCrewRows(g: GameState, from: Minute, to: Minute): { key: string; label: string; n: number; blocks: CalBlock[] }[];
export function mixedCrewText(g: GameState, offerOrContractId: string): string | null;
// contracts/feasibility.ts: CheckId += 'mission' | 'warRisk' | 'airspace' | 'clientCrew' | 'dryLease';
//   FeasibilityCheck.action += { kind: 'cCheck'; aircraftId: string }
// problems: cards for §9 kinds via the existing problemCard(g, ref)
// dev (engine/dev.ts), each returns the id to open:
export function devHajj(g): string;        // a hajj offer on a widebody fleet; offer id
export function devDryLease(g): string;    // a dry-lease offer for the owned A320; offer id
export function devMixedCrew(g): string;   // an Air Sénégal A330 'all but the purser' signed + rostered; duty id
export function devRivalBid(g): string;    // an open offer with a strong rival bid; offer id
export function devLevel(g, clientId?: string, level?: ClientLevel): string;   // client id
export function devDeportation(g): string; export function devEvacuation(g): string;   // offer ids
```
**UI store additions** (`src/ui/store.ts`, additive): `ModalSpec` += `{kind:'client'; clientId}`, `{kind:'rival'; rivalId}`, `{kind:'outlook'}`, `{kind:'worldEvent'; eventId}`; `subcharter` modal gains `rivalId?`; Company `nav.view` `'overview' | 'clients' | 'rivals'`; Inbox deep links for `client` / `rival` / `event` refs (event → map with `sel: {kind:'event', id}`); `dev.hajj()`, `dev.dryLease()`, `dev.mixedCrew()`, `dev.rivalBid()`, `dev.level(clientId?, level?)`, `dev.world(kind?)`, `dev.deportation()`, `dev.evacuation()`.
**MAP reads** `worldZones`, `worldEventPins`, `worldEvent`, `dryLeaseOf`, `flightZone`; opens `{kind:'worldEvent'}`. **UI reads** everything else above. MAP exports nothing new to UI.

## 13. Bot (`scripts/acmi-bot.ts`, ENGINE)
Pure in g, run after every step as today. New rules:
- **Relationships**: offer sort adds the client's level (Partner/Trusted first at equal value); accept change requests when the default is accept or the client is below Trusted and the A-check has ≥ 30 FH left; `clientFee`: waive when the client is Known+ and the fee < $10K; late-payment interest: waive for Trusted+.
- **Types**: hajj when a widebody with 300+ all-economy seats is free for both phases; UN after IOSA; VIP/presidential by feasibility and margin; **deportation at most one per 365 days and only while clean ≥ 70** (exercise the system); evacuation when war risk ≤ 2 and margin > 0; medical, music tours by feasibility; Antarctica: file `polar` when a widebody and etops180 are held and an antarctic offer appeared, sign when granted; capacity leases for Partners.
- **Rivals**: decide on "strong" competition offers in the same step (no waiting); sub-charter out picks the cheapest available quote with quality ≥ 0.6, else the cheapest; accept `subcharterIn` when feasible with margin > 0.
- **World**: `airspace` → Wait; `uninsurable` → Wait once, then Cancel.
- **Dry lease**: Oct–Mar, an owned narrowbody < 30 % committed over the next 60 days and a fitting `dryLeaseOut` → accept (book the C-check first when the check says so); never the last narrowbody of a family with an active base contract.
- **Mixed crew**: like any wet offer (it needs fewer cabin crew).
- **Fleet**: §8 rule. **Speed**: §8.
- **Printed** (new line): `v0.8: levels U/N/K/T/P a/b/c/d/e · standing Est. day X, Resp. day Y · types HJ/UN/VP/DP/EV/MD/MT/AN/CL/SI/DL n… · lost to rivals N (cheaper/closer/sooner) · sub-charter out N (by rival) in N · events N (closures hit N, legs rerouted N, FM cancels N, war-risk $K) · phases by quarter · fuel min–max · dry leases N (months, $ income) · mixed-crew contracts N · runtime s`.
- **Targets** (seeds 1–6, one at a time, 365 days): every v0.7.3 hard target (margin band, ≤ 0.3 % uncovered, **0 illegal duties**, morale 55–75, resignations 4–20 %, AOG 1–3 per aircraft-year, 0 duties with an impossible rest plan); runtime ≤ 20 s (goal 12 s); Established by day 240 on ≥ 5 seeds; a Trusted client by day 365 on ≥ 4 seeds; a widebody on 2–4 seeds; no seed bankrupt or rescued because of v0.8 systems. Soft: ≥ 1 world event touching our flights on ≥ 3 seeds; ≥ 1 offer lost to a rival with a printed reason on every seed; a dry lease on ≥ 2 seeds.

## 14. Tests and acceptance

**ENGINE tests**
- `contracts/relations.test.ts`: levels incl. hysteresis (Trusted at 30 stays until < 20); every §1.3 row moves `relation` and writes `log`; perks: rate in `priceProduct` (+8 % Trusted vs New, same seed), first refusal (+48 h, no rival bid, 30 % lost on expiry), forgiven delays (first n no penalty), faster due days; repeat offer chances over 500 rolls ±5 %; `standing` thresholds and Newcomer offers (≤ 45-day bases, −8 %, odd-hour waves present in ~40 % ±8 % over 300 base offers).
- `contracts/missions.test.ts`: 200 seeds per new archetype produce valid offers (requirements, pricing band ±10 % of §2 multipliers, feasibility lines); `hajjDates` vs the literal table ±1 day, phases 28/30 days, an empty leg every rotation, MGH over the phases only; antarctic round-trip range (A320 no, A330 ok), `polar` gate; deportation morale filter (crew < 45 skipped) and clean per leg capped −10; presidential spare pilot seat present.
- `contracts/rivals.test.ts`: bid chance vs index (soft > boom), style windows, the reason text (cheaper/closer/sooner), `rival.bid` closes only open/countered offers and is stale-safe, first refusal never bid; `subcharterQuotes` ≤ 3, busy rival unavailable, level discount; monthly fleet changes deterministic per seed.
- `ops/market.test.ts`: phase durations and transitions over 50 years of months; index converges to target ±0.05 within 6 months; shocks add and expire; `marketOutlook` pure.
- `ops/world.test.ts`: `crosses` (LIS–DXB over Iraq zone yes, LIS–JFK no); a closure holds touching flights, reroutes overflights by `detourMin` once, decision Wait retimes to end + 3 h and re-retimes on extension, Cancel is force majeure (no compensation, `lostMin`, no relation/reliability change); war-risk cost per landing and the wet re-bill; uninsurable decision; generation rate over 3 years 1.5–3 a month, never > 3 active, home-country closures never.
- `ops/dryLease.test.ts`: ferry out with pilots only, `leasedOut` at arrival, rent in advance and reserves in arrears (`leaseIncome`), hours and A-counter accrual with lessee A-check reset, C-check feasibility, deposit in/out, late return holdover, damage split 70/30, `paintedFor` set and cleared, insurance stops.
- `crew/clientCrew.test.ts`: seats dropped CC first, PUR only when `leads`; rest plan uses the full complement; roster fills exactly our share; `clientCrewRows`; price −$75 × n.
- `saveCompat.test.ts`: v0.5.2 … v0.7.2 fixtures **and a new `save-v073.lz.txt`** (dumped before any v0.8 engine change with `npx tsx scripts/acmi-bot.ts 3 240 --wide --dump=240,<scratch>/v073.json`, then `LZString.compressToBase64`) load with every §10 default; levels computed without messages; 60 days run with 0 illegal duties; serialise/reload equal.
- `core/plumbing.test.ts` purity: `clientView`, `clientList`, `offerClientLine`, `standing`, `rivalList`, `rivalView`, `offerCompetition`, `subcharterQuotes`, `marketOutlook`, `segIndex`, `worldEvents`, `worldEvent`, `worldZones`, `worldEventPins`, `flightZone`, `dryLeaseView`, `dryLeaseOf`, `clientCrewOf`, `clientCrewRows`, `mixedCrewText`, `hajjDates`.
- Bot seeds 1–6: §13.

**UI acceptance** (`scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch; new shots `company-clients`, `company-client-unhappy`, `company-rivals`, `contracts-head-standing-outlook`, `offer-trusted-first-refusal`, `offer-rivals-bidding`, `offer-hajj`, `offer-deportation-moral`, `offer-dry-lease`, `offer-mixed-crew`, `outlook-modal`, `subcharter-3-quotes`, `roster-board-client-crew`, `duty-client-seats`, `schedule-dry-lease`, `schedule-programme-continues`, `inbox-world-event`, `whats-new-08`):
- Company Overview/Clients/Rivals switch without layout jump; lists scroll inside their pane; nothing overflows at 1180 px; every tappable ≥ 44 px.
- Offer cards show at most 4 chips in one row (level, competition, special, existing); the OfferModal shows the client block and the one archetype panel that applies.
- Nothing animates except aircraft; the outlook and level strips are static; numbers change at most once a clock step.

**MAP acceptance**
- `dev.world('war')` shades the zone (static), shows the pin; tapping the pin opens the event panel; panning at 4× stays smooth (zones drawn once, frame cost < 1 ms with 3 zones and 10 aircraft).
- A leased-out aircraft is drawn parked at the lessee base in the lessee paint with the "leased" badge; its panel says until when.

## 15. Not in v0.8 (keep it simple)
No new crew rules, no CRAF-style mobilisation, no Umrah programmes, no prisoner transfers, no tender scoring, no visa refusals, no reputation per client segment beyond `cleanSensitivity`, no lessee repossession or arbitration, no second AOC, no department heads, no news ticker, no sounds, no new settings or auto-pause reasons, no rival ever operating a flight on the map, no cargo.

## 16. Order of work inside each lane
1. **ENGINE step 0**: dump `save-v073.lz.txt` (before any change); §10 types + §11 BAL + data stubs (`worldZones`, `worldEvents`, `worldCalendar`, seeds); stubs for every §12 export (views return `null`/`[]`, texts `''`, `standing` → Newcomer, `marketOutlook` from today's indices, `subcharterQuotes` = `[subcharterQuote]`); tsc/vitest/build green. UI and MAP start against the stubs.
2. **ENGINE**: relations + standing (§1) → rivals, bids, quotes (§3) → market cycle + outlook (§4) → mixed crew (§7) → missions: hajj, UN, presidential, deportation, evacuation, medical, music, antarctic, capacity (§2) → world events, closures, war risk (§5) → dry lease (§6) → sub-charter in (§3.5) → cards, glossary, voice, whatsNew (§9) → dev helpers → bot (§13, §8 widebody + speed) last; seeds 1–6 and save fixtures.
3. **UI**: store additions → Company Overview/Clients/Rivals + Client/Rival modals → Contracts head strips + chips → OfferModal blocks (client, competition, archetype panels, seat strip, moral, dry) → OutlookModal → SubcharterModal 3 quotes → DutyModal/BlockSheet client seats, airspace chip, dry-lease sheet → RosterBoard client group → Schedule dry-lease row + "programme continues" → Fleet card leased-out → Finance lines → Inbox refs + WorldEventModal → shots.
4. **MAP**: zone layer (no-op on stubs) → event pins + panel → leased-out drawing.
5. Merge order ENGINE → UI → MAP; each merge keeps `npx tsc --noEmit`, `npx vitest run`, `npx vite build` green; the bot runs seeds 1–6 one at a time.

## 17. File ownership

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**` — new `contracts/relations.ts`, `contracts/rivals.ts`, `contracts/missions.ts`, `ops/world.ts`, `ops/dryLease.ts`, `crew/clientCrew.ts`, `problems/world.ts`, their tests, `fixtures/save-v073.lz.txt`; edits in `contracts/{offers,pricing,feasibility,accept,billing,clients,counter}.ts`, `ops/{market,events,flights,subcharter,finance,company,util,index}.ts`, `crew/{extraSeats,roster,morale}.ts`, `engine/dev.ts`. `src/data/**` — new `worldZones.ts`, `worldEvents.ts`, `worldCalendar.ts`, `clientVoice.ts`; `naming.ts` (seeds, rival tags), `airports.ts` (ice runways, missing codes, `ANT`), `regions.ts`, `glossary.ts`, `whatsNew.ts`, `flavor.ts`. `scripts/acmi-bot.ts`. Shared, minimal, additive, first: `core/types.ts` (§10), `core/balance.ts` (§11). | §1–§7 engine, §8 bot, §9 data, saves |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`: `screens/{Company,Contracts,Schedule,scheduleLogic,RosterBoard,rosterBoardLogic,Fleet,Finance,Inbox}.ts(x)`, new `screens/{Clients,Rivals}.tsx`, `modals/{OfferModal,SubcharterModal,DutyModal,BlockSheet,DecisionModal}.tsx`, new `modals/{ClientModal,RivalModal,OutlookModal,WorldEventModal}.tsx`, `store.ts` (additive §12); `src/styles/**` except map styles: new `styles/acmi/v08.css` imported from `styles/acmi/index.css`. Exception as before: `scripts/ipad-shots.cjs` (new shots). | §1.8, §3.6, §4.4, §6.4, §7.2, §8 Gantt, inbox, shots |
| **MAP** | `src/ui/map/**` — new `WorldLayer.tsx`, edits in `OpsMap.tsx`, `MapPanels.tsx` (event panel, leased-out aircraft panel), `LiveLayers.tsx` (leased badge), `mapLogic.ts` (+ test: ring projection, pin placement); `src/styles/acmi/map.css`. | §5.6 |

Interfaces between lanes are §12 only. UI never reads `g.world`, `rival.log` or `client.log` directly (use the views); MAP never computes closures itself (only `worldZones`).
