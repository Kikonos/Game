# BLOCK HOURS v0.17 "Aircraft market": design

Plan of record for v0.17. It is written for three lanes that build in parallel from a shared skeleton (step 0, §Q). Build it on the `acmi` commit that has v0.16.3 (distress finance, Market hub under Contracts) and v0.16.4 (crew rotations) merged, not before.

The ground rules of DESIGN.md, BUILD-PLAN.md and UPDATE-0.16.md hold:
- Engine RNG only: `chance`, `int`, `range` and `weightedPick` on market side streams (`side(g, key)` in `ops/market.ts`), so new rolls never shift the rest of the game.
- Ids via `nextId`. Money only through `post`, `accrue`, `cashOnly` and `invoice`, each with a proper `LedgerCat`.
- `SAVE_VERSION` stays 1. New fields are optional and get `??=` defaults in each module's `load`. `init` sets the same defaults, so a new game and a reloaded one serialise alike.
- The four player saves (s0228, s0329, s1027, s1118) and the recent s0429 and s0501 load and keep working. Nothing already signed changes.
- Every new problem is a four-line card (what · why · does it hurt · what you can do). Every chime has its message. Wording is plain and short. Times are UTC with local time alongside. Nothing flickers.

Sources: the research files `/home/user/work/v017/research-supply.md` (rates, supply, lead times) and `/home/user/work/v017/research-terms.md` (lease process, credit, reserves, regulation). Each cites its sources by URL. Numbers marked *est.* below are estimates from those files.

## The player's words and the goal

On 5 Nov the player, a former ACMI flight attendant who values realism with real companies, said the aircraft market is "a little bit too slow" but wants to keep the challenge. Above all, it must not be possible to lease every widebody they want.

The real market gives both:
- Airlines do not wait for a lessor to call. They send a request for proposals (RFP) and get answers within 1–3 weeks.
- Narrowbodies are easing in 2026: mid-life rents are down 11–13 % and more aircraft are on offer.
- Widebodies are a lessors' market:
  - lessees extend 80–87 % of their leases;
  - there are more A330 requests than aircraft;
  - lessors cap how much they place with one small airline;
  - the A330neo is the only new passenger widebody available before 2032.

**Design goal:** planned well, the aircraft you want arrives in 2½–4 months. Today you wait about 5 months for the type to come up at all, then 1–3 months more for delivery. Widebodies stay gated by five things: supply, our credit, each lessor's cap, our CAMO's capacity and the approvals.

| # | Feature | Lane | One line |
|---|---|---|---|
| A | Market tightness | `supply` | Each type has a tightness from 0 to 1. It moves monthly with the cycle, the season and world events, and drives availability, rent, lead times and extension rents. |
| B | Lessors | `supply` (data), `deals` (rules) | Twelve real lessors, each with its tier, the ages and families it leases, the lowest credit it accepts and how many aircraft it will place with us. |
| C | Credit check | `deals` | A lessor rating from A to D, built from AOC years, fleet, cash cover, profit, distress, stars, IOSA and reliability. It sets the deposit, who will deal with us and the caps. |
| D | Requests for proposals | `deals` | We ask for a type, age, term, start date and count. Each lessor answers within days to weeks with proposals or a stated no. |
| E | Real terms | `supply` | Rent built like a lease rate (term, credit, tightness), deposit months by grade, maintenance reserves by age with minimum hours, return conditions by age, extension rent from tightness. |
| F | Letter of intent to lease | `deals` | Signing a letter of intent pays a holding deposit. The lessor's credit check follows: approved, more security asked, or declined. Then the lease is signed. |
| G | Transition and CAMO | `deals` | Records review, transition check, registration, paint and an acceptance flight. Our CAMO handles 1–4 transitions at a time, and contract tech reps add a slot. |
| H | AOC variation | `deals` | A new type family needs a variation (90–120 days at EASA) and rated crews. The first widebody family comes with the Widebody operations approval. |
| I | Short-term aircraft | `supply` | 3–9-month subleases from airlines in their quiet season, at a premium and quick to start. |
| J | Lessor calls, new builds, failure batches | `supply` | The existing random offers become lessor calls: more narrowbody, fewer widebody, and the same credit rules. New-build lead times become realistic. An airline failure releases a batch of 3–6 aircraft below market rent. |
| K | Finance and ladder links | `deals` | Deposits by letter of credit on the v0.16 credit line, lessor caps on sale and leaseback, the v0.16.3 distress items in the rating, and prestige stars and fleet age. |
| L | UI and bot | `market-ui` | Fleet › Market gets Offers · Requests · In progress, an "Ask lessors" dialog, a letter-of-intent dialog, Types on our AOC under Company › Ladder, and a bot that plans its fleet. |

---

## 1. Today against v0.17 (the numbers this design aims at)

Today `BAL.market7` makes 1 offer a month on average, weighted by `1 − scarcity`. A new game sees the A320 family in about 39 % of offers and the A320ceo itself in about 19 % (0.8 of a total weight of about 4.3). With the widebody gate held, about 46 % of offers are widebodies.

| What the player wants | Today | v0.17, planned well | v0.17, in a hurry |
|---|---|---|---|
| Another A320ceo (a type we fly), start-up rating C | Wait for one to come up: an A320ceo about every 5 months, any A320-family type about every 2½ months, each open for 7–21 days. Then 30–90 days to handover. | Ask 4–6 months ahead. Three mid-life lessors answer within 5–14 days: 1–2 proposals expected, at least one about 9 times in 10. From letter of intent to service in 7–10 weeks, on the date asked for. | Ask for "as soon as possible": only stored aircraft are offered, at half the chance. About 9–12 weeks. |
| The same at rating B (year 2) | The same | Nine lessors look: almost always 2–4 proposals | — |
| First A330-200 (Widebody operations filed, a job in hand), rating B | The guaranteed post-filing lease, else about 0.46 widebody offers a month | Ask 6 months ahead: at least one proposal about 5 times in 6, or about half the time without work in hand. In service 3–6 months later. | About half that chance |
| 777-300ER, rating B | A random offer once the ladder allows | About 1 in 2 per request with work in hand, 1 in 4 without. At most one from each lessor. | — |
| A new A350-900 | A rare new-build slot with a 180–420-day lead | Rating A only; lessors are fully placed until 2030, so the first handover is 2030 or later | Declined: "fully placed until 2030" |
| As many widebodies as cash allows | Sign every widebody offer: about 5 a year | Capped by rating: at most 2 widebodies in all at C, 4 at B, 8 at A. Each lessor places 1 widebody at B and 2 at A. The CAMO takes 1–4 transitions at a time, and each widebody needs 14–22 pilots. | — |

---

## A. Market tightness (lane `supply`; `engine/leasing/tightness.ts`)

### A.1 The number

`tight[typeId]` runs from 0 (aircraft are easy to find) to 1 (none to be had). It is stored per type in `g.leasing.tight` and read through `tightNow(g, typeId)`, which adds the season and today's supply shocks.

| Effect | How tightness enters |
|---|---|
| A lessor has an aircraft for our request (§D.3) | × (1 − tightNow) |
| Lessor calls (§J) | weight × (1 − tightNow) (it replaces `1 − scarcity`) |
| Rent (§E.1) | × (1 + 0.25 × (tightNow − 0.5)), so −12 % to +12 % |
| Extension rent (§E.6) | 1 + 0.12 × (tightNow − 0.5), clamped to 0.95–1.06 |
| Time until a used aircraft comes free (§D.4) | × (1 + 0.6 × (tightNow − 0.5)) |
| Word shown to the player | Easy below 0.3 · Normal 0.3–0.5 · Tight 0.5–0.7 · Very tight 0.7–0.85 · Almost none above 0.85 |

`AcmiType.scarcity` stays in the data and keeps its meaning elsewhere. The market no longer reads it.

### A.2 Base values (the game starts on 1 March 2027; research as of November 2026)

| Type | Base | Why (research) |
|---|---|---|
| A320ceo, 737-800 | 0.45 | Mid-life rents down 11–13 % since July 2025, and more aircraft on the secondary market (IBA, July 2026). Spirit's 114 A320-family aircraft came back to the market. |
| 737-900ER | 0.40 | Unloved; a few with Lion Air and United |
| A321ceo | 0.55 | Demand as freighter-conversion feedstock keeps old ones dear |
| A321neo | 0.85 | The firmest narrowbody; slots for new ones are placed to 2028 |
| A320neo (request only, §D.1) | 0.90 | GTF groundings: about 350 parked through 2026 |
| 757-200 | 0.55 | Few left in passenger service; they go to conversion |
| 757-300 | 0.80 | A handful left (Condor, Icelandair, Delta) |
| 767-300ER | 0.55 | Passenger aircraft are going to freighter conversion |
| A330-200 | 0.70 | Half-life base value up 120 %; "more lease requests than they have assets available" |
| A330-300 | 0.72 | IBA calls it "the great valuation comeback" |
| A330-900neo | 0.90 | The only new passenger widebody before 2032; rents forecast up more than 15 % |
| A340-300 / -600 | 0.35 / 0.45 | Four-engine fuel burn: lessors are glad to place one |
| A340-200 / -500 | 0.80 / 0.75 | Very few left |
| 777-200ER | 0.60 | Old but working; ACMI hours up 35 % in Q2 2026 |
| 777-300ER | 0.82 | 777X delays keep them in service, and they extend above appraisers' marks |
| 787-8 / -9 / -10 | 0.85 / 0.90 / 0.92 | Few come free; the six Norse 787-9s back from IndiGo were rare |
| A350-900 / -1000 / ULR | 0.93 / 0.95 / 0.98 | Hardly any on the secondary market |
| A380 | 0.65 | Parked examples exist, but few lessors will place one |
| 747-400 / 747-8 | 0.88 / 0.95 | Fewer than 80 passenger 747-400s are left; old ones go to conversion |
| 747-100/-200/-300 | 0.99 | Museum pieces |
| 777-9 / 777-8 | 0.995 | New builds only (§J.2) |

### A.3 Movement

Monthly, inside `refreshMarket`, after the v0.8 cycle step, each type moves:

`tight += (target − tight) × 0.2 + gaussian × 0.02`, clamped to 0.05–0.99.

`target = base + phase offset + one-off drift`. The phase offsets are boom +0.08, steady 0, soft −0.05 and slump −0.10. The one-off drift is the narrowbody easing of 2026–27: −0.01 a month on A320ceo, 737-800 and A321ceo for the first 12 months, down to a floor of base − 0.08.

**Season**, added at read time by UTC month (January to December):
- narrowbody: +0.02, +0.06, +0.06, +0.06, +0.04, 0, −0.02, −0.04, −0.06, −0.06, −0.04, 0. Everyone wants summer lift from February to May, and aircraft come free after the summer.
- widebody: 0, +0.02, +0.02, +0.02, +0.03, +0.03, 0, 0, −0.02, −0.02, −0.02, 0.

**Supply shocks** (`g.leasing.shocks`), added by world events through one-line hooks in `ops/world.ts` and `commercial/crises.ts`:

| Event (existing kind) | Supply shock |
|---|---|
| `airlineFailure` (Air Moldova, TAROM, a rival), or the bankruptcy of an airline client (crises.ts) | −0.15 on the failed airline's families for 120 days, plus a failure batch (§J.3) |
| `engineCrisis` (`engineGtf`) | +0.10 on A320neo and A321neo, +0.05 on A320ceo, 737-800 and A321ceo, for 180 days |
| `recession` | −0.10 on every type for the event's length |
| `airspace` closures, `war` near the Gulf | +0.04 on widebodies for the event's length (longer block times need more lift) |
| Hajj in the window (`hajjShock`) | +0.05 on widebodies for its weeks |
| New template `delay777x` (once, 2027–2028, data/worldEvents.ts) | +0.05 on 777-300ER and 777-200ER for 365 days: "Boeing pushes 777-9 deliveries back again; airlines keep their 777-300ERs" |

The existing demand shocks (`addShock`, the ACMI demand index) stay as they are. An airline failure lifts ACMI demand and aircraft supply at the same time, as Spirit's did.

### A.4 Outlook

`marketOutlook` gets `supply: { typeId, word, trend }[]`. It lists the three tightest and the two easiest types we can fly or are one rung from flying, with an arrow against last month (`prevTight`). Wording: "A330s very tight ↑ · A320ceo normal ↓".

---

## B. Lessors (data `src/data/lessors.ts`, lane `supply`; rules in `deals`)

Real lessors with what they really lease, as far as the research supports it.

| Id | Name | Tier | Ages | Families | Lowest grade, narrow / wide | Aircraft placed with us at A / B / C / D (widebodies of those in brackets) | Appetite, narrow / wide |
|---|---|---|---|---|---|---|---|
| `aercap` | AerCap | top | new, young, mid | A320, B737, A330/340, B777, B787, A350 | B / B | 5 (2) / 3 (1) / 0 / 0 | 0.90 / 0.60 |
| `smbc` | SMBC Aviation Capital | top | new, young, mid | A320, B737 | B / – | 4 / 2 / 0 / 0 | 0.90 / – |
| `avolon` | Avolon | top | new, young, mid | A320, B737, A330/340, B787, A350 | B / B | 4 (2) / 2 (1) / 0 / 0 | 0.85 / 0.50 |
| `alc` | Air Lease Corporation | top | new, young, mid | A320, B737, A330/340, B777, B787, A350 | B / B | 4 (2) / 2 (1) / 0 / 0 | 0.85 / 0.50 |
| `boc` | BOC Aviation | top | new, young, mid | A320, B737, A330/340, B777, B787, A350 | B / B | 3 (2) / 2 (1) / 0 / 0 | 0.80 / 0.45 |
| `cdb` | CDB Aviation | top | young, mid | A320, B737, A330/340, B787 | B / B | 3 (1) / 2 (1) / 0 / 0 | 0.70 / 0.35 |
| `acg` | Aviation Capital Group | mid | young, mid | A320, B737, B787 | C / B | 4 (1) / 3 (1) / 1 (0) / 0 | 0.80 / 0.30 |
| `aircastle` | Aircastle | mid-life | mid, old | A320, B737, A330/340, B777 | C / C | 4 (2) / 3 (1) / 2 (1) / 0 | 0.75 / 0.45 |
| `carlyle` | Carlyle Aviation Partners | mid-life | mid, old | A320, B737, B757/767, A330/340, B777 | C / C | 4 (2) / 3 (1) / 2 (1) / 1 (0) | 0.75 / 0.45 |
| `vallair` | Vallair | end of life | old | A320, B737 | D / – | 3 / 3 / 3 / 1 | 0.80 / – |
| `doric` | Doric | asset manager | young, mid, old | B777, B787, A350, A380 | B / B | 2 (2) / 1 (1) / 0 / 0 | – / 0.40 |
| `exop` | The previous operator, direct (from `EX_OPERATORS`) | airline | old | B747, A340, B757/767, A380, A330/340 | C / C | 2 (2) / 2 (2) / 1 (1) / 0, per airline | 0.50 / 0.30 |

- **Names.** The research notes that Air Lease Corporation now trades as Sumisho Air Lease. The game keeps the name the player's leases already carry, and the card's tooltip says "now Sumisho Air Lease".
- **Legacy names.** Existing leases carry lessor names, not ids. `lessorIdOf(name)` maps the current `LESSORS` strings ('AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group'). A '(used sale)' seller is not a lessor and is not counted.
- **Sites.** Narrowbodies are handed over at the existing `LESSOR_SITES`. Old aircraft and failure batches go to storage sites. The lane adds Teruel (TEV) and Pinal Airpark, Marana (MZJ) to airports.ts, after checking each with real coordinates and runways.
- **Appetite** is the chance that a lessor holding the family has an aircraft for a request at tightness 0, before the other factors (§D.3).

Why caps: AerCap has about 300 customers and no lessee above 10 % of its revenue. Air Lease's average customer is 1.1 % of book value. Past securitisations capped one lessee at 10–15 %. So one lessor will place only a few aircraft with a small carrier, and fewer still with a weak one (research-terms §3).

---

## C. Credit check (lane `deals`; `engine/leasing/credit.ts`)

### C.1 Score

The score starts at 40 and is clamped to 0–100. It is recomputed daily and cached in `g.leasing.credit` with its parts, so the UI can show why.

| Part | Points |
|---|---|
| Months on the AOC (`aocSince`) | under 12: 0 · 12–24: +8 · 24–36: +14 · 36 or more: +20 |
| Aircraft on the AOC (not delivering) | 1–2: 0 · 3–5: +6 · 6–10: +10 · 11 or more: +14 |
| Cash cover: (cash + undrawn credit line) ÷ next month's bill (`monthEndBill`) | cash below zero: −25 · under 1: 0 · 1–2: +8 · 2–4: +14 · over 4: +18 |
| Profit over the last 6 closed months (approval fees added back) | loss: −8 · profit: +6 · margin 8 % or more: +10 · fewer than 3 statements: 0 |
| Distress (v0.16.3 `distress(g)`) | rent deferral running −10 · creditor payment plan −5 · investor board seated −5 · covenant breach −8 · line frozen −12 · restructuring (PER) running or its label standing: the grade is capped at D |
| Our stars (`playerStars`) | 1★ 0 · 2★ +4 · 3★ +8 · 4–5★ +12 |
| IOSA held | +6 (a small plus: lessors do not ask for IOSA, but it shows an audited airline; IOSA is really a client gate) |
| Reliability | 80 or more: +4 · 60 or less: −4 |
| Leases handed back properly (returns completed, from `stats`) | +2 each, at most +6 |

| Grade | Score | Words on screen |
|---|---|---|
| A | 75 or more | "Strong: lessors compete for us" |
| B | 55–74 | "Sound" |
| C | 35–54 | "Start-up or thin: mid-life and older aircraft, 3 months' deposit" |
| D | below 35 | "Weak: only end-of-life lessors, big deposits" |

Worked examples:
- A new game with 2 aircraft and 2–4 months of cover: 40 + 14 = 54, so C (the start-up band, which matches GlobalX's 3 months' deposit from Vallair).
- About a year in with 4 aircraft, profitable, 2★: 40 + 8 + 6 + 8 + 6 + 4 = 72, so B.
- Year 3, 3★, IOSA, 8 aircraft: A.
- s0501 (cash −$2.6M, 14 months, 7 aircraft): 40 + 8 + 10 − 25 − 8 + 4 = 29, so D. That is realistic: only Vallair-type lessors, with 7 months' deposit.

### C.2 What the grade sets

| | A | B | C | D |
|---|---|---|---|---|
| Deposit (months of rent) | 1 | 2 | 3 | 5 (score 25–34), 7 (below 25) |
| Rent | −3 % | 0 | +5 % | +10 % |
| Letter of credit instead of cash (§K.1) | every lessor | mid-life and end-of-life lessors | no | no |
| Up-front reserves deposit | – | – | – | 3 months of minimum-hours reserves |
| Widebodies in all (on the AOC, delivering and in deals) | 8 | 4 | 2 (aged 15 years or more only) | 0 |
| Tier-4 types (787, A350, 777-8) and new widebody builds | yes | no | no | no |
| Chance factor on a lessor having an aircraft | × 1.1 | × 1.0 | × 0.9 | × 0.8 |

### C.3 Exposure

A lessor's exposure counts every aircraft we lease from it:
- dry leases in, including leasebacks;
- aircraft still delivering or in transition;
- deals at letter of intent, credit check or approval.

At its cap the lessor answers "We already have three of yours: that's our limit for now". Old saves may already be over a cap: nothing is taken back, the lessor just places no more. A rent-deferral default or a repossession blocks that lessor for 24 months, using v0.16.3's `distress.lessorBlock` (lane `deals` sets the 24 months when it records the block).

---

## D. Requests for proposals (lane `deals`; `engine/leasing/rfp.ts`)

### D.1 Asking

Fleet › Market › **Ask lessors…** opens the request dialog:

| Field | Choices |
|---|---|
| Type | Any type whose ladder gate is held or pending, or one rung away, shown greyed with "Needs Widebody operations first". A320neo is request-only (BAL `rfpOnly`; its sprite is the A320ceo's for now). Each type shows its tightness word. |
| Age | New build · Young (up to 8 years) · Mid-life (8–16) · Old (16+) |
| Lease | 12 · 24 · 36 · 60 · 96 · 144 months. A new build needs 96 or more. The dialog says what each age usually gets: new 96–144, young 60–120, mid 24–96, old 12–48. |
| From | As soon as possible, or a month (the next 24 months; new builds the next 60). "Flexible by a month" is on by default. |
| How many | 1 · 2 · 3 |

Limits:
- At most 3 requests open (2 while we are a Newcomer).
- A lessor that said "no aircraft" for a type will not look again for 30 days. The dialog says "Avolon looked on 4 Mar: again from 3 Apr".
- A scenario with a fixed fleet locks the dialog, as it locks the market today.

The request goes to every lessor that leases that family and age. Lessors that will not deal with us are listed with the reason before we send: "Goes to 7 lessors · 3 won't consider us yet (rating C)".

### D.2 Answer timing

Each lessor answers on its own day:
- narrowbody 5–14 days;
- widebody 10–24 days;
- new build 14–28 days;
- × 0.7 at grade A.

`replyBy` is the last of those days. One message when the last lessor has answered: "A330-200 request: 2 proposals (AerCap, Carlyle) · 4 had nothing · 1 won't consider us (rating)". It uses cue `offerNew` when there is at least one proposal; otherwise it is quiet. Proposals show on the Offers tab as soon as each arrives.

### D.3 Each lessor's answer (on the side stream `rfp:<id>:<lessorId>`)

Checked in order:
1. **Blocked** (v0.16.3 lessorBlock): "We're still owed rent from last time."
2. **Credit**: our grade is below the lessor's lowest for this body ("We need a stronger balance sheet: rating B or better"). A tier-4 type or a new widebody build below A gets the same answer.
3. **Exposure**: at the lessor's cap, or at our grade's widebody total (§C.3).
4. **Placed**: a new build before the type's earliest year (§J.2): "Our A350 deliveries are placed until 2030".
5. **Aircraft**: the chance of having one is

`p = appetite × (1 − tightNow) × window × work × gradeFactor`, clamped to 0–0.95, where:
   - `window`, the time from now to "From": as soon as possible (under 45 days) × 0.5, because only stored aircraft can go; 45–120 days × 0.9; 120–365 days × 1.15, because aircraft coming off lease can be matched to the date (this is how planning well pays); over 365 days × 1.0.
   - `work` (widebodies only): × 1.4 with a signed contract or a won tender that needs a widebody between the handover and 60 days after it; × 0.6 with none in hand. Lessors want to see the business plan.
   - A second aircraft from the same lessor needs `p × 0.5`, a third `p × 0.25`, each within the cap.
6. If the roll misses: 30 % of misses answer "**Later**": nothing for that month, but one from 90–180 days later, as a proposal labelled "later than you asked". The rest answer "No aircraft that fits".

### D.4 What a proposal is

A proposal is an `AircraftOffer` with `source: 'proposal'`, `rfpId` and `lessorId`. It is valid 10 days (narrowbody), 7 days (widebody) or 14 days (new build).

Its airframe is rolled as `makeOffer` rolls one: built year inside the age band and the type's production years, variant, cabin, rest, and ex-operator or storage site.

It has `freeAt`, the day the aircraft is free:
- Stored (narrowbody 45 %, widebody 30 % of proposals; every "as soon as possible" proposal): today.
- Otherwise still flying with its current airline: "From" ± 30 days. With no date asked, 60–240 days (narrowbody) or 90–270 days (widebody), × the tightness factor of §A.1. The card says "With Vueling until 20 May".

Transition starts at `max(freeAt, lease signed, CAMO slot)` (§G).

Proposals do not count towards the lessor-call cap of 6 open (§J.1).

---

## E. Real terms (lane `supply`; `engine/leasing/terms.ts`, `quoteTerms(g, draft)`)

One function prices every lease offer: lessor calls, proposals, batches, short-term and new builds. Legacy offers already open in a save keep their terms.

### E.1 Rent, built like a lease rate

Lessors price as a lease rate factor on their appraised value. The game's used-aircraft values (`valueUsed`, sale quotes, v0.16 loans and leaseback) sit below appraisers' half-life values for narrowbodies: a 12-year-old A320ceo is $14M in the game against $20–24M appraised. So a percentage shown against them would mislead.

The rent therefore starts from the type's reference rent at that age. That is `rentForAge`, already calibrated to IBA rents, with its floor kept. On it go the factors lessors apply to the lease rate:

`rent = floorRent(t, rentForAge(t, age) × term × credit × tightness × segIndex × noise × source)`, rounded to $1K, where:
- term: 12 months or less +18 % · 13–24 +10 % · 25–48 +4 % · 49–96 0 · over 96 −3 %. Short leases cost more; the research estimates +10–25 % for 12 months or less.
- credit: A −3 % · B 0 · C +5 % · D +10 %.
- tightness: × (1 + 0.25 × (tightNow − 0.5)).
- noise: 0.95–1.08 (was 0.9–1.15: the factors now carry most of the spread).
- source: failure batch −8 % to −15 % · short-term +15 % to +30 % · new build uses `rentNew` (× 1.0–1.06) in place of the age curve.

The proposal and the dialog show **Why this rent** in one line: "Mid-life A320ceo $220K · 36 months +4 % · normal market −1 % · start-up rating +5 %". New builds also show the lease rate against the list value. For new aircraft the research figures are solid: A350 new about 0.73 % of $168.5M.

Reference rent changes in `src/data/acmiTypes.ts` (research-supply §2). Signed leases keep their rent:

| Type | Field | Now | v0.17 | Why |
|---|---|---|---|---|
| A320ceo | rentMonth | 225K | 220K | IBA July 2026: $220K for a 12-year-old |
| 737-800 | rentMonth | 230K | 228K | IBA July 2026: $228K |
| A330-300 | rentMonth | 330K | 355K | $351K in Oct 2024, forecast $372K for Jan 2026 |
| 777-300ER | rentMonth | 450K | 485K | $470K forecast for Jan 2026; "$500K+" in 2025 |
| 777-200ER | rentMonth | 280K | 260K | The research range is $150–300K; 280K was at its top |
| A321neo | rentNew | 470K | 485K | IBA forecast $487K for Jan 2026 |
| A350-900 | rentNew | 1.14M | 1.20M | About $1.23M in 2026 (Acumen value × lease rate factor) |

The lane checks every other reader of `rentMonth` (dry lease out quotes, start setups, v0.14 sale and insurance code) and says in its STATE what moved.

### E.2 Deposit

Deposit months come from the grade (§C.2), plus 1 for a new build. A failure batch takes 1 less, with a minimum of 1. Short-term: 1 month (2 at D). The v0.12.1 post-filing widebody lessor keeps its 1 month ("a lessor keen to place").

The deposit is paid in two parts, as IATA describes:
- a **holding deposit** of 1 month's rent at the letter of intent, which takes the aircraft off the market;
- the rest when the lease is signed.

It is refunded at return, as today. Instead of cash the deposit can be a letter of credit (§K.1).

### E.3 Maintenance reserves

The share of `maintBH` by age at signing: new 0.32 · young 0.38 · mid 0.44 · old (16–20 years) 0.55 · over 20 years 0.65, with ±5 % noise. The engine model stays as it is: reserves are the lessor's part of the maintenance cost (`legCostEstimate`), so an old aircraft shows reserves near its rent on the statement, as GlobalX's did (reserves 93 % of base rent).

New:
- **Minimum hours**: 80 FH a month for a narrowbody and 150 for a widebody (*est.*; the Vallair–GlobalX letter of intent has 80 FH and 40 cycles). They are billed whether flown or not, from the handover, pro rata for part months. At each month end the unflown minimum × the rate is posted as `reserves`. The dry lease out lessee's hours count as flown. The message says "Reserves on 45 unflown hours: $18K".
- **Escalation**: +3 % on each lease anniversary (the Vallair letter of intent has +3 % a year).
- **Grade D**: an up-front reserves deposit of 3 months of minimum-hours reserves, refunded at return.

Only leases signed in v0.17 carry `minFH` and `reservesEsc`. Old leases do not change.

### E.4 Term by age

Lessors offer terms within the age band: new 96–144 months · young 60–120 · mid 24–96 · old 12–48. A request outside the band gets the nearest term in it, and the card says so ("You asked 12 months; AerCap's shortest on a young A320 is 60"). End-of-life lessors (Vallair, Carlyle, Aircastle on old aircraft) accept 12 months, at the +18 % term factor.

### E.5 Return conditions by age

These are the existing `returnQuote` lines, with the half-life share stored on the lease as `halfLifeShare`:
- new and young aircraft: 0.6 (towards full-life);
- mid-life: 0.5 (as today);
- old: 0.25 ("as is, with the engines' green time"), with the return check cost × 0.6.

Short-term leases return to the airline's base with a 1-day return inspection ($15K narrowbody, $30K widebody) and no half-life charge.

### E.6 Extension rent

The fixed 0.97 (12 months) and 0.92 (36 months) of `BAL.leaseReturn.extend` give way, for decisions offered after v0.17, to:
- 12 months: `clamp(1 + 0.12 × (tightNow − 0.5), 0.95, 1.06)`;
- 36 months: 0.04 less.

In 2025–26 extensions renewed at or above the old rent. A tight A330 extends at about +2 %, an easing A320ceo at about −0.5 %. An extension already agreed keeps its rent.

---

## F. From letter of intent to lease (lane `deals`; `engine/leasing/deals.ts`)

Every lease offer (lessor call, proposal, batch, new build) follows the same path. A purchase skips the lessor's credit check. Legacy open offers in old saves sign as they did.

| Step | What happens | Time |
|---|---|---|
| 1. Sign the letter of intent | The holding deposit is paid (`cashOnly`). The offer leaves the market list and is kept as a snapshot in a `LeaseDeal`. The deal's options are chosen here: sign the lease automatically when approved (on by default), deposit as a letter of credit, and paint. | now |
| 2. Credit check and lease agreement | Narrowbody 10–20 days, widebody 14–30, new build 21–35; × 0.6 at grade A | the lessor's committee |
| 3a. Approved | Our grade at the committee is the same as at the proposal or better. At grade C, 15 % of approvals still ask one more month's deposit. | |
| 3b. More security | Our grade fell by one, or the 15 % at C. The lessor asks 2 more months' deposit, or a letter of credit when our grade allows one. A decision card gives 7 days: pay, letter of credit, or walk away. Walking away here refunds the holding deposit. | 7 days |
| 3c. Declined | Our grade fell by two or more, or a restructuring started. The holding deposit comes back, and the lessor looks again after 30 days. | |
| 4. Sign the lease | The rest of the deposit (or the letter of credit) and the transition cost (§G.3) are paid. The aircraft is created as `delivering`, with its transition plan and the handover at its end. | |
| Walk away after approval, or let the 7-day signing window lapse | The lessor keeps the holding deposit. | |

- **Automatic signing.** With automatic signing on and enough cash, step 4 happens on approval. Without the cash, a decision card asks ("Approved: $462K due to sign"). Its default at expiry is to sign if the cash is there, else to walk away.
- **Purchases.** A purchase call ("for sale") signs at once, as today: the price is paid and the aircraft enters transition. The dialog offers "Borrow 60 % against it once delivered". This uses v0.16 `loanQuote`; if `takeLoan` refuses a delivering aircraft, it is offered at the handover.
- **Refactor.** `acquireAircraft` is split in step 0 into `signOffer(g, offer, opts)`, which builds the aircraft, and the legacy entry point. That way the lease signing and the legacy path share one builder.

The forfeit is posted as `rent` with the label "Holding deposit forfeited (Avolon)", so it is on the statement as a lease cost.

---

## G. Transition and CAMO capacity (lane `deals`; `engine/leasing/induction.ts`)

### G.1 The plan (rolled at lease signing on the stream `ind:<aircraftId>`)

| Step | Narrowbody | Widebody | Notes |
|---|---|---|---|
| Records review | 21–35 days | 28–56 days | × 1.4 for an aircraft over 16 years; × 1.3 for a failure-batch aircraft (repossessed, records messy); short-term 3–7 days. Records are "more often than not the sole cause" of delays. |
| Transition check (bridging or C-check at the site) | 7–12 days | 10–18 days | Findings add 5–10 days (narrowbody) or 7–14 days (widebody). Their chance is 30 % (narrowbody), 35 % (widebody), 45 % over 16 years, 0 for new builds. |
| Registration, airworthiness review, insurance | 7–12 days | 7–12 days | Runs alongside the check |
| Paint in our colours (optional) | 7 days | 12 days | `BAL.paint.full` costs ($150–250K narrowbody, $300–500K widebody). Without it: white, with our titles and our registration. |
| Acceptance flight | 1 day | 1 day | "As is, where is": after it, the aircraft is ours to fix |

The records review starts at the slot; the check starts at half of it; paint follows the check.

`ready = slot + max(records, records ÷ 2 + check + paint) + 1`

Typical results:
- narrowbody: about 31 days, or 37 with findings;
- widebody: about 48 days.

So from letter of intent to service it takes 7–10 weeks (narrowbody) and 9–14 weeks (widebody), plus any wait for `freeAt`. Lufthansa Technik's "about 3 months" for a lease-in is the centre of that.

New builds have no records review or check: a 5-day factory acceptance before the slot date. The existing delivery ferry is planned from `ready` (`planDeliveryFerry` with the handover set to `ready`). Findings post a message, and an amber card if work is assigned (§N.4).

### G.2 CAMO capacity

Transitions at the same time:
- 1 + floor(aircraft on the AOC ÷ 5), at most 4;
- a widebody counts as 2, or the whole capacity when that is 1;
- short-term aircraft count as 1.

A transition that does not fit starts when a slot is free, and the handover moves later. The dialog says "Our CAMO is busy until 14 Mar: the transition starts then".

**Contract tech reps**: +1 slot for one transition and −20 % on its records review, for $40K (narrowbody) or $75K (widebody), chosen in the letter-of-intent dialog or on the deal row. No Team hire is needed: Team and crew files belong to other work in progress.

### G.3 Transition cost (new `LedgerCat` `transition`, a cost)

The transition cost covers technical representatives, fleet-standard modifications, registration and the CAMO's work. It is posted at lease signing: $90K for a narrowbody and $180K for a widebody, × 1.5 for the first aircraft of a family new to the AOC. Tech reps and paint come on top (paint stays on `paint`).

---

## H. New type: AOC variation and crew ratings (lane `deals`; `engine/leasing/aoc.ts`)

- **Families on the AOC.** `company.aocFamilies` is a list of `RatingFamily`.
  - New game: the start setup's families.
  - Load: every family in the fleet (delivering, stored and leased out included), plus the families of variations already granted.
  - Types in one family need no variation: A320ceo, A321ceo, A321neo and A320neo are all `A320`. This matches EASA cabin crew treating the A318–A321 as variants.
- **Variation**, from Company › Ladder › Types on our AOC › **Add a type…**, or offered in the letter-of-intent dialog:
  - Cost (`approvals`): $80K for a narrowbody family, $150K for a widebody family. It pays for OM-B, the MEL, the training programmes and the maintenance programme.
  - Time: 90 days (narrowbody) or 120 days (widebody) on an EASA registry. ARO.GEN.310 asks a formal application at least 90 days ahead. A UK registry (G-) takes 45 or 60 days (at least 30 working days); other registries 60 or 90.
  - It is granted at its due date once 2 captains and 2 first officers are rated on the family. Until then it waits, checked daily, with the line "Waiting for 2 rated captains".
- **The first widebody family** comes with Widebody operations: that approval already puts "a widebody type on the operations specification". The family of the first widebody signed while it is held or pending joins the AOC at the grant. A second widebody family needs a variation.
- **The gate.** Revenue legs on a family not yet on the AOC are refused at departure, the way `approvalGate.ts` refuses legs for missing approvals: "Not on our AOC yet: the 737 variation is due 10 Jun". Delivery ferries, positioning without passengers and training flights may fly. Feasibility counts the variation's due date like a pending approval: "signs now, flies after".
- **Crew.** The existing conversions stay: pilots 42 days at $38K narrowbody or $52K widebody, a common-type course of 10 days; cabin crew 8 days and at most 3 families each (ORO.CC.250). The variation card points to them: "Book a 737 conversion: 4 pilots needed before the grant".

---

## I. Short-term aircraft from airlines (lane `supply`; `engine/leasing/spot.ts`)

Real airlines fill 6–18-month gaps with subleases and damp leases. Examples from the research: Cebu Pacific's A320s to flyadeal for its quiet months, and IndiGo with Norse's 787-9s. In the game these are dry subleases of an airline's spare aircraft in its quiet season.

### I.1 Sources (`SPOT_SOURCES` in data/market.ts; airports checked)

| Airline | Family (type) | Base | Free in (UTC months) |
|---|---|---|---|
| TUI fly Deutschland | B737 (737-800) | HAJ (add it) or FRA | Nov–Mar |
| SunExpress | B737 (737-800) | AYT | Nov–Mar |
| Smartwings | B737 (737-800) | PRG | Nov–Mar |
| Enter Air | B737 (737-800) | WAW | Nov–Mar |
| Condor | A320 (A320ceo) | FRA | Nov–Feb |
| Corendon | B737 (737-800) | AMS | Nov–Mar |
| Cebu Pacific | A320 (A320ceo) | MNL | Jul–Sep |
| IndiGo | A320 (A320ceo) | DEL | Jul–Sep |
| Jetstar | A320 (A320ceo) | MEL | May–Aug |
| Aerolíneas Argentinas | B737 (737-800) | AEP | May–Aug |
| Norse Atlantic | B787 (787-9) | OSL | Nov–Mar |
| Air Transat | A330/340 (A330-300) | YUL | May–Sep |
| Air Tahiti Nui | B787 (787-9) | PPT | May–Aug |

### I.2 Terms

- **Term**: 3–9 months, inside the source's window, ending at a fixed return date.
- **Rent**: the type's mid-life rent × 1.15–1.30.
- **Deposit**: 1 month (2 at D). Reserves at the mid rate, with no minimum hours.
- **Handover and return** at the airline's base. The 1-day return inspection follows (§E.5). A late return is charged at 2 × the daily rent ("TUI needs it back for its summer").
- **Requirements**: the family must already be on our AOC (no variation for a few months), rated pilots, and a CAMO slot. Transition is records 3–7 days plus registration in parallel, with no check or paint: 7–14 days in all. No lessor credit check: the airline asks only for the deposit. Grade D doubles it.

### I.3 How they come

- **Calls**: narrowbody 0.7 a month and widebody 0.12 a month, from sources inside their window. At most 2 short-term offers open, each open 5–10 days (spare aircraft go fast). Cue `offerNew`.
- **Asking**: Fleet › Market › **Short-term…** asks the airlines with a family in their window. They answer in 3–10 days with 0–2 offers: each source in its window has a 35 % chance (narrowbody) or 15 % (widebody), × (1 − tightNow + 0.3).

---

## J. Lessor calls, new builds and failure batches (lane `supply`; `engine/leasing/calls.ts`, `batches.ts`, hooks in `ops/market.ts`)

### J.1 Lessor calls (the existing random offers)

These are aircraft a lessor has now: stored, or coming off lease soon. They are the lucky finds, often at a good rent. The daily roll in `dailyMarket` becomes two rolls on the same side stream:
- narrowbody: 1.6 a month;
- widebody: 0.35 a month, only when a widebody gate is held or pending. One rung away, a widebody teaser can still come (weight × 0.3), with at most 1 teaser open.

Within each, types are weighted by `1 − tightNow` (it replaces `1 − scarcity`). The lessor is drawn from those whose families, ages and lowest grade fit us and that have room under their cap. If none fits, no call that day: lessors don't call airlines they won't lease to.

Each call prices through `quoteTerms` (grade deposit, reserves by age, minimum hours, return conditions) and is signed through the letter-of-intent path (§F).

| | Today | v0.17 |
|---|---|---|
| Calls a month | 1.0 (about 0.54 narrowbody, 0.46 widebody with the gate held) | 1.6 narrowbody + 0.35 widebody |
| Open at once | 4 | 6, at most 2 of them widebodies (proposals and short-term offers not counted) |
| Open for | 7–21 days | narrowbody 7–21 days, widebody 5–14 |
| New-build share | 0.10 | 0.05 |

The guaranteed early offers stay: the narrowbody lease in month 1–2, the old widebody in months 4–6 and the post-filing widebody. They are priced through `quoteTerms` at our grade, except that the post-filing lessor keeps its 1 month's deposit. `postOffer`'s pause and message stay. The market screen's intro line changes to "Lessors call when an aircraft comes free; or ask them for the one you want".

### J.2 New builds (realistic leads)

Lessors have placed 98 % of 2026 deliveries, 82 % of 2027 and only 16 % of 2028.

| Type | Earliest handover | Lead from the letter of intent |
|---|---|---|
| A321neo | 18–36 months out | 540–1,080 days |
| A330-900neo | 24–36 months out | 730–1,095 days |
| 787-8 / -9 / -10, A350-900 / -1000 | January 2030 | at least 540 days |
| A350-900ULR, 777-9 | 2031 | at least 540 days |
| 777-8 | 2032 | at least 540 days |

- Grade: B for the A321neo; A for every widebody.
- Terms: 96–144 months, deposit by grade + 1 month.
- Today's 180–420-day lead (`market7.newBuildLead`) is replaced. `NEW_BUILD` and `FACTORIES` stay.

### J.3 Failure batches

- **Trigger**: an `airlineFailure` world event, or the bankruptcy of an airline client (crises.ts), once the last batch is at least 300 days old. A failure inside that gap still adds its supply shock (§A.3).
- **What comes**: 3–6 aircraft of the failed airline's main family.
  - The family comes from `FAILURE_FLEETS` in data/market.ts: Air Moldova A320ceo, TAROM 737-800.
  - A rival: its fleet's commonest type.
  - Otherwise: `AIRLINE_FAMILIES` / `AIRLINE_FAMILIES_V016`, taking that family's mainstream narrowbody.
  - A widebody batch only when that airline flies one, at 15 % of such batches.
- **Each aircraft** is its own offer with a shared `batchId`.
  - Rent 8–15 % under market, deposit 1 month less. Lessors want these placed fast, so a mid-life lessor accepts grade C for them.
  - Of each batch, 30 % are for sale (by the administrator) at 10–20 % under value.
  - Handover at a storage site: LDE, TEV, MZJ or SNN.
  - Ready in 30–120 days: maintenance-slot queues, plus records × 1.3.
  - Open 14–30 days.
- **Caps** still apply, so a C-rated airline can take only a few.
- **Message**: "TAROM's 737-800s are on the market: 4 aircraft, about 12 % under market rent". Cue `offerNew`, and the `marketOffer` pause request.

---

## K. Finance and ladder links (lane `deals`)

### K.1 Letter of credit on the v0.16 credit line (`finance/lc.ts`, new, owned by `deals`)

- **When**: grades A and B (§C.2) with the credit line open and not frozen. The deposit can be a standby letter of credit instead of cash.
- **Cost**: it uses that much of the undrawn limit, and `creditView` shows "Letters of credit $450K". The fee is 1.25 % a year of the amount, accrued daily and posted monthly to `bankFees`.
- **Frozen or not renewed line**: the lessor asks cash within 30 days, on the `leaseConditions` card.
- **At return**: the letter of credit is released.
- **Hooks**: `creditView` and `drawCredit` subtract letters of credit from the undrawn limit. Step 0 gives `finance/index.ts` a one-line hook to `lcInUse(g)`.

### K.2 Sale and leaseback (v0.16 A.4)

- `leasebackQuote` asks `leasebackLessorOk(g, lessorName)`, a step-0 hook.
- The stable pick of lessor must have room under its cap and accept our grade. If not, the next lessor in `BAL.v016.finance.leaseback.lessors` that does is used. If none does, `why` = "No lessor will take it at rating D: Vallair-type lessors don't do leasebacks".
- Carlyle accepts D for leasebacks at the price share − 3 points: a distressed sale.
- The lease rate gets the credit factor of §E.1.
- A leaseback counts towards that lessor's exposure.

### K.3 Loans and the credit line

The cash-cover part of the score counts the undrawn line. A drawn line is not penalised by itself; a covenant breach is (§C.1).

The cash forecast (`treasuryForecastItems` pattern; `leasingForecastItems` from step 0) shows:
- holding deposits and deposits to sign;
- transition costs;
- the first rent at handover;
- short-term return dates.

### K.4 Distress (v0.16.3)

Rent deferrals, payment plans, the investor, covenant trouble and a restructuring enter the score (§C.1). A restructuring caps us at D, and top-tier lessors say "Not while you're in restructuring". A rent deferral with a lessor also lowers that lessor's cap by 1 while it runs. A deferral default blocks that lessor (`lessorBlock`). v0.16.3's lease return and deferral code is read, never edited.

### K.5 The ladder and prestige

- Approvals still gate types (`aircraftGate`): Widebody operations for tier 2; augmented crews and ETOPS 180 for tier 3; ETOPS 240 for tier 4. The type picker shows them.
- Stars and IOSA feed the rating (§C.1).
- Level 3 and 4 clients ask a fleet average age of 22 or 18 years at most (v0.16 B.1). The request and letter-of-intent dialogs warn when an old aircraft would push us over the next level's limit: "Fleet average age would be 19.4: the majors ask 18 or less". Old cheap aircraft trade against the climb.

---

## L. State and load (lane `deals` owns the types; step 0 adds them)

```ts
// core/types.ts — v0.17 block
export type AgeBand = 'new' | 'young' | 'mid' | 'old';
export type CreditGrade = 'A' | 'B' | 'C' | 'D';
export type LessorId = 'aercap' | 'smbc' | 'avolon' | 'alc' | 'boc' | 'cdb' | 'acg' | 'aircastle' | 'carlyle' | 'vallair' | 'doric' | 'exop';
export type OfferSource = 'call' | 'proposal' | 'batch' | 'spot' | 'newBuild';

export interface CreditView { score: number; grade: CreditGrade; parts: { label: string; pts: number }[]; at: Minute }
export interface RfpAnswer {
  lessorId: LessorId | string;   // an airline name for a short-term request
  due: Minute; at?: Minute;
  kind?: 'proposal' | 'later' | 'none' | 'credit' | 'exposure' | 'placed' | 'blocked';
  offerIds?: string[]; text?: string;
}
export interface Rfp {
  id: string; typeId: string; band: AgeBand; months: number; count: 1 | 2 | 3;
  /** Wanted handover; asap: as soon as possible; flex: ± a month. */
  from: Minute; asap: boolean; flex: boolean;
  sent: Minute; replyBy: Minute; answers: RfpAnswer[];
  status: 'open' | 'done' | 'withdrawn';
  /** A short-term request to airlines. */ spot?: true;
}
export type DealStage = 'committee' | 'conditions' | 'approved' | 'declined' | 'signed' | 'walked';
export interface LeaseDeal {
  id: string;
  /** The offer as it was at the letter of intent (it leaves g.market.aircraft). */ offer: AircraftOffer;
  stage: DealStage; loiAt: Minute; holding: number;
  autoSign: boolean; lc: boolean; paint: boolean; techReps: boolean;
  gradeAtOffer: CreditGrade; committeeAt: Minute; gradeAtCommittee?: CreditGrade;
  conditions?: { extraDeposit: number; until: Minute };
  signBy?: Minute; signedAt?: Minute; aircraftId?: string; endedAt?: Minute; why?: string;
}
export interface Induction {
  slot: Minute; records: [Minute, Minute]; check: [Minute, Minute]; reg: [Minute, Minute];
  paint?: [Minute, Minute]; ready: Minute;
  findings?: { days: number; text: string }; techReps?: boolean;
  /** Days waited for a CAMO slot / for the aircraft to come free. */ waitedCamo: number; waitedFree: number;
}
export interface SupplyShock { id: string; families?: RatingFamily[]; typeIds?: string[]; delta: number; until: Minute; text: string; eventId?: string }
export interface AocVariation { family: RatingFamily; filed: Minute; done: Minute; cost: number; granted?: Minute }
export interface Leasing {
  tight: Record<string, number>; prevTight?: Record<string, number>; shocks: SupplyShock[];
  rfps: Rfp[]; deals: LeaseDeal[];
  /** `${lessorId}:${typeId}` → no new look before this day (after a "no aircraft"). */ quiet: Record<string, Minute>;
  lastBatch?: Minute; credit?: CreditView;
  /** Letters of credit out: by aircraft id (or deal id before signing). */ lc: Record<string, number>; lcAccrued: number;
  stats: {
    rfps: number; answers: Record<string, number>; lois: number; signed: number; walked: number; declined: number; conditions: number;
    inductions: number; inductionDays: number; camoWaitDays: number; spot: number; batches: number;
    calls: { narrow: number; wide: number }; minHoursBilled: number; forfeited: number;
  };
}
// AircraftOffer (all optional): source?: OfferSource; lessorId?: LessorId; rfpId?: string; batchId?: string; band?: AgeBand;
//   grade?: CreditGrade; depositMonths?: number; holding?: number; minFH?: number; halfLifeShare?: number; freeAt?: Minute;
//   why?: { label: string; pct: number }[]; transition?: number; validUntil?: Minute;
//   spot?: { airline: string; base: string; returnAt: Minute }
// Ownership 'dryLeaseIn' (all optional): lessorId?; minFH?; reservesEscAt?: Minute; halfLifeShare?; lc?: number; reservesDeposit?: number;
//   spot?: { airline: string; base: string }; grade?: CreditGrade
// Aircraft.induction?: Induction          Company.aocFamilies?: RatingFamily[]; Company.aocVariations?: AocVariation[]
// GameState.leasing?: Leasing
// LedgerCat + 'transition' (COST_CATS)    ProblemKind + 'leaseConditions' | 'leaseSign' | 'inductionDelay' | 'variationNeeded' | 'spotReturn'
// Ref['kind'] + 'rfp' | 'deal'
```

**Load (`loadLeasing`, also called by `init`):**
- `g.leasing ??=` the base tightness for every type, moved once toward today's phase target, and empty lists and stats.
- Missing type keys get their base.
- `company.aocFamilies ??=` the fleet's families (§H).
- `company.aocVariations ??= []`.

Open legacy offers (no `source`) stay signable through the legacy path, with their terms. Existing leases are untouched: no `minFH`, the half-life share at the default 0.5, rent and deposit as signed. Exposure counts them by `lessorIdOf(lessor)`. The rating is computed at once and cached.

**Determinism:** every roll is on `side(g, key)`, with keys `tight:<month>`, `rfp:<id>:<lessor>`, `call:<day>`, `deal:<id>`, `ind:<aircraftId>`, `spot:<day>` and `batch:<eventId>`.

---

## M. Balance constants (`BAL.v017`; each lane tunes only its own sub-block)

```ts
v017: {
  /** Master switch: false gives the v0.16 market exactly (bot --market=v16, for comparisons). */
  on: true,
  supply: { // lane supply
    base: { a320ceo: 0.45, b738: 0.45, b739: 0.40, a321ceo: 0.55, a321neo: 0.85, a320neo: 0.90, b752: 0.55, b753: 0.80,
      b763: 0.55, a332: 0.70, a333: 0.72, a339: 0.90, a342: 0.80, a343: 0.35, a345: 0.75, a346: 0.45,
      b772: 0.60, b77w: 0.82, b788: 0.85, b789: 0.90, b78x: 0.92, a359: 0.93, a35k: 0.95, a35u: 0.98,
      a388: 0.65, b744: 0.88, b748: 0.95, b741: 0.99, b742: 0.99, b743: 0.99, b779: 0.995, b778: 0.995 } as Record<string, number>,
    pull: 0.2, noise: 0.02, clamp: [0.05, 0.99] as [number, number],
    phase: { boom: 0.08, steady: 0, soft: -0.05, slump: -0.10 } as Record<string, number>,
    easing: { types: ['a320ceo', 'b738', 'a321ceo'] as string[], perMonth: -0.01, months: 12, floor: -0.08 },
    seasonNarrow: [0.02, 0.06, 0.06, 0.06, 0.04, 0, -0.02, -0.04, -0.06, -0.06, -0.04, 0] as number[],
    seasonWide: [0, 0.02, 0.02, 0.02, 0.03, 0.03, 0, 0, -0.02, -0.02, -0.02, 0] as number[],
    shock: { failure: [-0.15, 120], gtfNeo: [0.10, 180], gtfCeo: [0.05, 180], delay777x: [0.05, 365], recession: -0.10, airspace: 0.04, hajj: 0.05 },
    words: [[0.3, 'Easy'], [0.5, 'Normal'], [0.7, 'Tight'], [0.85, 'Very tight'], [1.01, 'Almost none']] as [number, string][],
    rfpOnly: ['a320neo'] as string[],
  },
  calls: { // lane supply
    narrowPerMonth: 1.6, widePerMonth: 0.35, maxOpen: 6, maxWide: 2, days: [7, 21] as [number, number], wideDays: [5, 14] as [number, number],
    teaserWeight: 0.3, maxTeasers: 1, newBuildChance: 0.05,
  },
  newBuild: { // lane supply
    lead: { narrow: [540, 1080], a339: [730, 1095], minLead: 540 } as Record<string, number | [number, number]>,
    earliestYear: { b788: 2030, b789: 2030, b78x: 2030, a359: 2030, a35k: 2030, a35u: 2031, b779: 2031, b778: 2032 } as Record<string, number>,
    months: [96, 144] as [number, number], rentX: [1.0, 1.06] as [number, number], grade: { narrow: 'B', wide: 'A' } as Record<string, string>, extraDepositMonths: 1,
  },
  terms: { // lane supply
    term: [[12, 0.18], [24, 0.10], [48, 0.04], [96, 0], [9999, -0.03]] as [number, number][],
    credit: { A: -0.03, B: 0, C: 0.05, D: 0.10 } as Record<string, number>,
    tight: 0.25, noise: [0.95, 1.08] as [number, number],
    batch: [-0.15, -0.08] as [number, number], spot: [0.15, 0.30] as [number, number],
    bands: { young: [0, 8], mid: [8, 16], old: [16, 99] } as Record<string, [number, number]>,
    termsByBand: { new: [96, 144], young: [60, 120], mid: [24, 96], old: [12, 48] } as Record<string, [number, number]>,
    reserveShare: { new: 0.32, young: 0.38, mid: 0.44, old: 0.55, veryOld: 0.65 } as Record<string, number>, veryOldFrom: 20, reserveNoise: 0.05, reserveEsc: 0.03,
    minFH: { narrow: 80, wide: 150 }, reservesDepositMonthsD: 3,
    halfLife: { new: 0.6, young: 0.6, mid: 0.5, old: 0.25 } as Record<string, number>, oldCheckX: 0.6,
    extend: { perTight: 0.12, clamp: [0.95, 1.06] as [number, number], long: -0.04 },
    spotReturn: { inspectCost: [15_000, 30_000] as [number, number], lateX: 2 },
  },
  spot: { // lane supply
    narrowPerMonth: 0.7, widePerMonth: 0.12, maxOpen: 2, days: [5, 10] as [number, number], months: [3, 9] as [number, number],
    askReply: [3, 10] as [number, number], askChance: { narrow: 0.35, wide: 0.15 }, depositMonths: 1, depositMonthsD: 2,
  },
  batch: { // lane supply
    gapDays: 300, size: [3, 6] as [number, number], wideShare: 0.15, buyShare: 0.3, buyDiscount: [0.10, 0.20] as [number, number],
    ready: [30, 120] as [number, number], open: [14, 30] as [number, number], recordsX: 1.3, depositLess: 1, gradeRelief: 1,
  },
  credit: { // lane deals
    base: 40,
    aocMonths: [[12, 8], [24, 14], [36, 20]] as [number, number][],        // at least N months → points
    fleet: [[3, 6], [6, 10], [11, 14]] as [number, number][],
    cover: { negative: -25, bands: [[1, 8], [2, 14], [4, 18]] as [number, number][] }, // months of cover at least → points
    profit: { loss: -8, profit: 6, margin: [0.08, 10] as [number, number], minStatements: 3 },
    distress: { deferral: -10, plan: -5, investor: -5, breach: -8, frozen: -12 },
    stars: { 0: 0, 1: 0, 2: 4, 3: 8, 4: 12, 5: 12 } as Record<number, number>, iosa: 6, reliableHigh: [80, 4] as [number, number], reliableLow: [60, -4] as [number, number],
    returns: { per: 2, max: 6 },
    grades: { A: 75, B: 55, C: 35 } as Record<string, number>,
    deposit: { A: 1, B: 2, C: 3, D: 5, Dlow: 7, DlowBelow: 25 } as Record<string, number>,
    wideTotal: { A: 8, B: 4, C: 2, D: 0 } as Record<string, number>, wideMinAgeC: 15,
    chanceX: { A: 1.1, B: 1.0, C: 0.9, D: 0.8 } as Record<string, number>,
    blockMonths: 24, deferralCapLess: 1,
  },
  rfp: { // lane deals
    maxOpen: 3, maxOpenNewcomer: 2, quietDays: 30, reply: { narrow: [5, 14], wide: [10, 24], newBuild: [14, 28] } as Record<string, [number, number]>, replyXA: 0.7,
    window: [[45, 0.5], [120, 0.9], [365, 1.15], [99999, 1.0]] as [number, number][],
    work: { inHand: 1.4, none: 0.6 }, extra: [0.5, 0.25] as number[], laterShare: 0.3, later: [90, 180] as [number, number],
    valid: { narrow: 10, wide: 7, newBuild: 14 } as Record<string, number>, pMax: 0.95,
    stored: { narrow: 0.45, wide: 0.3 }, freeAt: { narrow: [60, 240], wide: [90, 270] } as Record<string, [number, number]>, freeTight: 0.6, flexDays: 30,
  },
  deal: { // lane deals
    holdingMonths: 1, committee: { narrow: [10, 20], wide: [14, 30], newBuild: [21, 35] } as Record<string, [number, number]>, committeeXA: 0.6,
    condC: 0.15, condMonths: 2, decideDays: 7, signDays: 7, lookAgainDays: 30,
  },
  induction: { // lane deals
    records: { narrow: [21, 35], wide: [28, 56] } as Record<string, [number, number]>, oldX: 1.4, oldFrom: 16, spotRecords: [3, 7] as [number, number],
    check: { narrow: [7, 12], wide: [10, 18] } as Record<string, [number, number]>,
    findings: { narrow: 0.30, wide: 0.35, old: 0.45, days: { narrow: [5, 10], wide: [7, 14] } as Record<string, [number, number]> },
    reg: [7, 12] as [number, number], paint: { narrow: 7, wide: 12 }, acceptance: 1, factory: 5,
    camo: { base: 1, perAircraft: 5, max: 4, wideSlots: 2 },
    techReps: { cost: { narrow: 40_000, wide: 75_000 }, recordsX: 0.8 },
    cost: { narrow: 90_000, wide: 180_000, newFamilyX: 1.5 },
  },
  aoc: { // lane deals
    cost: { narrow: 80_000, wide: 150_000 }, days: { easa: [90, 120], uk: [45, 60], other: [60, 90] } as Record<string, [number, number]>, pilots: { CPT: 2, FO: 2 },
  },
  lc: { fee: 0.0125, grades: { A: 'all', B: 'midEol' } as Record<string, string>, cashDays: 30 }, // lane deals
},
```

`BAL.market7` and `BAL.leaseReturn.extend` stay for legacy offers and old extensions. `rentMonth` and `rentNew` change in the data (§E.1).

---

## N. UI (lane `market-ui`)

### N.1 Where it lives

- **Fleet › Market.** The `Fleet · Market` switch stays. Inside Market:
  - A header line: "Lessor rating **C** · start-up · deposit 3 months · Why?". Why? opens a popover with the score's parts, one line each with its points.
  - Two buttons on the right: **Ask lessors…** (primary) and **Short-term…**.
  - A segmented control: **Offers (n) · Requests (n) · In progress (n)**.
- **Offers**: every open offer of every source, newest first. Filter chips: All · Narrowbody · Widebody · Short-term · Has bunks (the v0.7.3 filter). Two columns on iPad, one on iPhone.
- **Requests**: our requests to lessors and airlines. Each is a card with its answers as chips (AerCap ✓ proposal · Avolon: no aircraft · Carlyle: rating). Withdraw is allowed while open.
- **In progress**: one row per deal and per transition. Stage chips: LOI ✓ · Credit check · Lease · Transition · Ferry. The row has the next date and its action button ("Pay $520K", "Letter of credit", "Walk away", "Add tech reps").
- **Company › Ladder**: a new block **Types on our AOC** with chips for the families held, a variation in progress with its bar and the missing pilots, and **Add a type…**.
- **Finance › The bank**: one line "Lessor rating B (63) · letters of credit $450K of the line".
- **Contracts › Market › Outlook** (v0.16.3 hub), or wherever `marketOutlook` shows: an "Aircraft supply" line (§A.4).
- **Fleet card** while in transition: one line "Transition at Shannon: check · ready 14 Mar (UTC) · 15 Mar local". A short-term aircraft shows "Back to TUI fly 31 Mar".

### N.2 Four-line cards (iPad 1180×820 two columns; iPhone 852×393 landscape one column; nothing wider than the screen)

Offer card, in four lines:
1. Art · "A330-200 · 2009 · 18J/262Y" · badge (Lessor call / Proposal / Batch / Short-term / New build)
2. "$287K/month · 36 months · deposit 2 months ($574K)"
3. "Ready ~12 Mar at Shannon · in service ~16 Mar" (or "With Air Europa until 20 May")
4. Chips (gate, pilots, tightness word, "Open 6 more days") · **Sign LOI…** (**Buy…** for a sale)

The rest lines, the ferry, the deadheads and the return terms move into the dialog, so the card stays four lines. Today's card has seven.

### N.3 Dialogs

- **Ask lessors** (`RfpModal`): five rows (Type · Age · Lease · From · How many), each a segmented control or picker with 44 px targets. Under them:
  - "Goes to 7 lessors · 3 won't consider us yet (rating C) · answers in 1–2 weeks";
  - the fleet-age warning (§K.5);
  - "New type for our AOC: the variation takes 90 days" when it applies.
  - **Send**.
- **Letter of intent** (`LoiModal`, replacing `AcquireModal` for leases; `AcquireModal` stays for purchases and legacy offers). Key–value rows:
  - Rent and Why this rent;
  - Term;
  - Deposit (now and at signing);
  - Reserves ("$560/FH · at least 80 FH a month · +3 % a year");
  - Return ("Shannon · 7-day check · half-life 0.5");
  - Ready (records · check · paint · acceptance, as a small timeline);
  - Our CAMO ("free" / "busy until 14 Mar");
  - AOC;
  - Pilots;
  - Cash after.
  
  Toggles: "Sign the lease when the credit check passes" (on), "Paint in our colours ($210K, +7 days)", "Contract tech reps ($40K, one more slot)", "Deposit as a letter of credit" (when allowed). **Sign letter of intent ($287K now)**.
- **Add a type** (`AocModal`): four lines (what, cost, time, what it needs) and **Apply ($80K)**.
- **Short-term** (`SpotModal`): family, months (3–9), from. "Airlines with spare A320s in that window: Cebu Pacific, IndiGo".

### N.4 Cards and messages (four lines each; `problems/leasing.ts`)

| Kind | Tone, cue | What · why · hurt · what you can do |
|---|---|---|
| `leaseConditions` | amber, `decision` | "Avolon wants more security for the A330-200" · "Our lessor rating fell from B to C since the letter of intent" · "$574K more deposit, or walk away (the $287K holding deposit comes back)" · [Pay $574K] [Letter of credit] [Walk away] |
| `leaseSign` | amber, `decision` | "Approved: sign the A320ceo lease" · "AerCap's credit check passed; automatic signing was off (or cash short)" · "Sign by 18 Mar or the $220K holding deposit is lost" · [Sign ($440K)] [Walk away] |
| `inductionDelay` | amber, `notice` (only with work assigned) | "Records review found gaps on CS-TQB" · "Back-to-birth traces missing for two landing-gear parts" · "Ready 9 days later, 3 Apr; the TUI base from 1 Apr starts without it" · [Add tech reps ($40K, −5 days)] [Sub-charter the first week] |
| `variationNeeded` | amber, `notice` | "The 737-800 needs our AOC varied" · "No 737 on our AOC: the authority takes 90 days" · "Handover 12 May; revenue flights only after the variation (about 10 Jun if filed today)" · [Apply ($80K)] [Book conversions] |
| `spotReturn` | amber, `notice`, 14 days before | "D-ATUB goes back to TUI fly on 31 Mar" · "The short-term lease ends" · "Late costs $15K a day" · [Plan the return ferry] |

Messages without cards:
- request answered;
- credit check approved or declined (declined is informative: "No harm: the holding deposit is back. Lessors look again after 30 days");
- lease signed ("Transition at Shannon from 2 Mar, ready ~3 Apr");
- transition steps (records done, check done) — quiet;
- minimum-hours reserves (monthly, only when more than $0);
- variation granted (cue `ladder`);
- failure batch (cue `offerNew` and pause);
- rating changes a grade ("Lessor rating up to B: two months' deposit now, top lessors will talk to us"; cue `ladder` up, `notice` down).

Every chime has its message. Our own actions are quiet (toast and Inbox).

### N.5 Wording

The industry terms stay, explained once in the glossary (`data/glossary.ts`):
- letter of intent (LOI)
- credit check
- holding deposit
- letter of credit
- maintenance reserves
- minimum hours
- transition
- records review
- CAMO
- AOC variation
- sublease
- lessor rating

Sentences are short. Times are UTC with local time where a time is shown.

---

## O. Bot (lane `market-ui`; `scripts/bot/market.ts`, called once a day from acmi-bot.ts in step 0)

`botMarket(g, t)` turns the existing fleet rules into planned requests:
1. **Narrowbody growth.** This is `narrowGrowth`'s test (committed 75 %, or 60 % from day 150; season timing). When it holds and no narrowbody request or deal is open, send a request:
   - the fleet's main type;
   - mid-life (old at grade D);
   - 36 months (24 for a season need);
   - from the next season start (1 February or 1 June) when that is 90 or more days away, else as soon as possible;
   - one aircraft.

   On the answers, take the lowest rent + reserves at 250 FH a month among those ready by the target + 30 days. Sign the letter of intent with automatic signing. With "more security", pay if cash ≥ the extra + $1M, else walk away. A lessor call that beats the best proposal is taken instead (the old rule).
2. **Widebody.** This is `fleet()`'s test (a job in hand, or the carry rule; the grant timing). Instead of waiting for a call, send a request:
   - the `wideFamily` type (A330-200 or 767-300ER);
   - old or mid-life;
   - 36–60 months;
   - from the grant date − 15 days.

   Sign only with the job, as today (`previewCopy` first).
3. **Short-term**, May–September: when 90 % or more is committed over 60 days and a 60-day+ base or series on offer can't be covered, ask for 4–6 months.
4. **Tech reps** when a transition waits 21 or more days for the CAMO and a job is assigned to the aircraft.
5. **Never** adds a family, except through the widebody path (`--newfam` adds a 737-800 variation in month 8 to test §H).
6. **Flags:**
   - `--market=v16` sets `BAL.v017.on = false`, the base for comparisons;
   - `--greedy` sends, every 30 days, a request for every widebody type the gate allows (as soon as possible and 6 months out), and signs every proposal it can afford (cash ≥ deposit + $500K) with no job. It measures the caps.
7. **Report:**

`v0.17 market: grade by quarter C C B B · rfps 6 (answers P 7 / later 2 / none 14 / rating 5 / cap 1) · lois 5 signed 4 walked 0 declined 1 · transition median 34 d (camo wait 0) · variations 0 · short-term 1 · batches 1 · calls N 19 / W 4 · min-hours $42K`

It also writes `narrowNeedToService`: the days from the first growth need to in service, for each growth aircraft.

---

## P. Acceptance checks

1. `npx tsc --noEmit` is clean. `npx vitest run` is green, with each lane's new tests and the new pure reads in `core/plumbing.test.ts`.
2. Determinism: `bot <seed> --det` passes. A save written and reloaded plays on identically (`saveContinue.test.ts`, with a deal at the credit check and a transition in progress).
3. Step 0 is neutral: `bot 1 120 --wide --inv` gives the same monthly table as the acmi base (v0.16.3 + v0.16.4 merged). `--market=v16` gives that table after the lanes too.
4. **Speed** (seeds 1–5 × 365 `--wide`): the median `narrowNeedToService` is 110 days or less. The same seeds with `--market=v16` are measured and reported, and are expected at 150 days or more. Every seed that wants a third narrowbody gets it within the year.
5. **Challenge** (`--greedy`, seeds 1–5 × 365):
   - widebodies (on the AOC + delivering + in deals) are at most the grade's total (2 at C, 4 at B);
   - no lessor holds more than its cap;
   - at least 55 % of widebody lessor answers are not proposals;
   - no tier-4 type is signed below grade A;
   - 777-300ER requests at B with no work in hand get a proposal at most 35 % of the time (over all greedy requests).
6. **Calls** (seeds 1–5 × 365): narrowbody calls average 1.3–2.0 a month; widebody calls 0.25–0.5 a month once the gate is held; never more than 6 calls open or more than 2 widebodies.
7. **Rating**: a new game is C (score 45–54). The bots reach B in months 12–18 on at least 3 of 5 seeds. s0501 loads as D, and s0329 as C or B.
8. **Transition**: a same-family narrowbody goes from letter of intent to in service in 6–12 weeks (median about 8), a widebody in 9–18 weeks (waits for `freeAt` excluded). Concurrent transitions never exceed the CAMO capacity: a new invariant, `camo-capacity`, in scripts/invariants.ts.
9. **AOC**: revenue legs of a family not on the AOC are refused at departure with the card line. In old saves the fleet's families are on the AOC, with no new card on load. A321ceo, A321neo and A320neo need no variation for an A320 operator.
10. **Short-term**: returned on time, deposit back, no return check. A forced late return is charged 2 × the daily rent.
11. **Batches**: at most 1 in 300 days, 3–6 offers of one family, 8–15 % under the rent quote of the same airframe.
12. **Finance**:
    - a letter of credit lowers the undrawn limit and charges 1.25 % a year;
    - a leaseback goes to the next lessor when the first is at its cap, or refuses with the reason;
    - the forecast shows holding deposits, deposits to sign, transition costs and the first rent;
    - the forfeited holding deposit is on the statement as `rent`.
13. **Saves**: `invariants save` on s0228, s0329, s0429, s0501, s1027 and s1118 for 60 days gives 0 errors. Existing leases keep their rent, deposit and conditions. Exposures count them, nothing is repossessed, and open legacy offers sign as before.
14. **Balance**: seeds 1–5 × 365 are solvent. Cash at day 365 is within ±$750K of the base build. Margins are within 2 points of it (more aircraft sooner can lift both; the balance step says why).
15. **UI** (Playwright, iPad 1180×820 and iPhone 852×393):
    - screens: Fleet › Market Offers, Requests and In progress; the request dialog; the letter-of-intent dialog; a deal row in every stage; Types on our AOC; the Lessor rating line and popover;
    - 0 console errors and no horizontal overflow;
    - offer cards at most four lines.
16. **Wording**: every new card has the four lines, every chime has its message, and UTC with local time is shown where a time is.

### Balance step (branch `v017-balance`, after the merge)

Measured with the bot (§O), seeds 1–5 × 365 `--wide` and `--greedy`, against the base build. Only `BAL.v017` and the bot are tuned. Each iteration's table goes in `/home/user/work/v017/balance/STATE.txt`.

Knobs, in this order:
1. `rfp.window` and appetite values, for speed;
2. `credit.wideTotal` and the lessor caps, for the challenge;
3. `calls.*`, for serendipity;
4. `terms.minFH`, for the cost of parked aircraft.

Prices of work are not touched.

---

## Q. Lanes and file ownership

### Q.1 Step 0 (one agent, before the lanes; a single commit on `v017-step0`, fast-forwarded to acmi)

- **`core/types.ts`**: the v0.17 block (§L), the `LedgerCat` `transition`, the `ProblemKind` and `Ref` additions.
- **`core/balance.ts`**: `BAL.v017` with every number in §M. **`core/ledger.ts`**: `transition` in `COST_CATS`.
- **`src/data/lessors.ts`**: the full table of §B and `lessorIdOf`.
- **`src/engine/leasing/`** with real signatures and neutral bodies (legacy behaviour):
  - `index.ts` (re-exports, `loadLeasing`, `dailyLeasing`, `monthlyLeasing`);
  - `tightness.ts` (`tightNow` returns the type's `scarcity`, so the call weights `1 − tightNow` equal today's);
  - `terms.ts` (`quoteTerms` returns the legacy terms);
  - `credit.ts` (`creditView` real: a pure read that nothing acts on yet);
  - `rfp.ts`, `deals.ts`, `induction.ts` (`inductionPlan` returns the legacy lead), `aoc.ts` (`familyOnAoc` true), `spot.ts`, `batches.ts`, `calls.ts` (`dailyCalls` = today's `dailyMarket` body).
- **`ops/market.ts`**:
  - `acquireAircraft` split into `signOffer` + the legacy wrapper (a pure move);
  - `makeOffer` calls `quoteTerms`;
  - `dailyMarket` calls `dailyCalls` when `BAL.v017.on`;
  - `refreshMarket` calls `monthlyLeasing`.
- **Hooks**:
  - `ops/index.ts` (load and daily);
  - `ops/approvalGate.ts` (`familyOnAoc`);
  - `ops/finance.ts` (`leasingBill` in `monthEndBill`, `leasingForecastItems` in the forecast);
  - `finance/index.ts` (`leasebackLessorOk` in `leasebackQuote`, `lcInUse` in `creditView` and `drawCredit`);
  - `ops/world.ts` and `commercial/crises.ts` (one line each: `onAirlineFailure(g, e)`, `onSupplyEvent(g, e)`);
  - `problems/index.ts` (the new kinds wired to `problems/leasing.ts` stubs).
- **UI slots** (components that render nothing until a lane fills them):
  - `ui/screens/market/{OffersView,RequestsView,DealsView,RatingLine}.tsx`;
  - `ui/modals/{RfpModal,LoiModal,AocModal,SpotModal}.tsx`;
  - `ui/screens/company/AocTypes.tsx` on the Ladder;
  - `ui/screens/finance/LessorRating.tsx` on The bank.
- **Bot**: `scripts/bot/market.ts` (`botMarket` stub) wired in `acmi-bot.ts`, with the `--market=v16` and `--greedy` flags parsed.

Step 0 is accepted on the neutral checks of §P.1–3, and when the six saves load.

### Q.1a Step 0 as built (branch `v017-step0`, fast-forwarded to acmi)

Neutral: `bot 1 120 --wide --inv` prints the base table line for line; only the new report line `v0.17 market: lessor rating C (50)` is added. Names that differ from the text above:

- **`lessorRating(g): LessorRating`** (credit.ts) instead of `creditView` / `CreditView`: engine/finance already exports a `creditView` and a `CreditView` (the bank's credit line). It is real (a pure read nothing acts on); nothing caches it yet (`g.leasing.credit` stays empty until lane `deals` caches it daily).
- **`inductionPlan(g, offer, opts)`** rolls on the stream `ind:<offerId>` (not the aircraft id), so the letter-of-intent dialog shows the same plan before signing. `acquireAircraft` takes its `ready` as the handover (step 0: signing + `leadDays`).
- **`signOffer(g, offer, SignOpts)`** builds the aircraft (cash due now as `pay`, site, handover, fee, registration, `induction`). `acquireAircraft` keeps every legacy check, removes the offer from the list and calls it. The lease signing of a deal calls `signOffer` with the deal's snapshot and `pay` = deposit − holding.
- **`dailyMarket`** calls `dailyCalls` (calls.ts) when `BAL.v017.on`, else `dailyMarketLegacy` (the v0.16 body, kept). `dailyCalls` calls `dailyMarketLegacy` in step 0. `makeOffer`, `postOffer` and `dailyMarketLegacy` are exported for the leasing modules.
- **Supply hooks**: ops/world.ts `startEvent` calls `onSupplyEvent(g, e)` for every world event (an `airlineFailure` reaches `onAirlineFailure` through it: lane `supply` dispatches); commercial/crises.ts calls `onAirlineFailure` for an administration and `onSupplyEvent` for a strike or a grounding.
- **Letters of credit** (`finance/lc.ts` `lcInUse`) lower the undrawn limit in `covenantCheck`, `creditView`, `drawCredit`, the daily commitment fee and the treasury forecast (all five read the same undrawn).
- **Leaseback**: `leasebackQuote` takes its lessor from `leasebackLessorFor(g, stablePick, BAL.v016.finance.leaseback.lessors)` (credit.ts) and shows its `why` when no lessor will.
- **AOC gate**: `gateMisses` (approvalGate.ts) checks `familyOnAoc` for legs that are not ferries, deadheads or operated by others; lane `deals` pushes the miss there (GateMiss needs an AOC kind).
- **Month-end bill**: `MonthEndBill.leasing` (= `leasingBill`: `minHoursBill` from terms.ts + `lcFeeBill` from finance/lc.ts) is part of `total`. The forecast adds `leasingForecastItems` (deals.ts).
- **Problems**: the five kinds go to `problems/leasing.ts`; `leasingProblems(g)` joins `problems()`; the cache key reads `g.leasing.rev` (bump it with `touchLeasing(g)` on every deal or request change).
- **UI**: the store's modals `rfp`, `loi`, `aoc`, `spot` open `RfpModal`, `LoiModal`, `AocModal`, `SpotModal` (game/Modals.tsx). `RatingLine`, `OffersView`, `RequestsView` and `DealsView` are mounted in `MarketView`, `AocTypes` under the Ladder on Company, `LessorRating` in The bank. All render nothing.
- **Bot**: `botMarket(g, { greedy, newfam })` once a day in `policy()`; `--market=v16` sets `BAL.v017.on = false` before the game is made; `botMarketReport(g)` prints the line after the v0.16 report.
- **Extra files**: `leasing/side.ts` (`leasingSide`, the market side-stream formula; shared, step 0 only), `leasing/exotic.ts` (§T; lane `deals`), `leasing/step0.test.ts` (shared: a lane may extend it, never weaken the neutral checks while `--market=v16` must hold).
- **Stub signatures** are listed in each file's header and doc comment; each says "Step 0:" what it returns now.

### Q.1b Lane `deals` as built (branch `v017-deals`)

- **Rating** (credit.ts): `lessorRating` is cached daily in `g.leasing.credit`; a grade change is told once it has held 7 days (`gradeTold`, `gradeSince`), so a month-end dip below zero does not chime. `lessorStance(g, def, typeId, band)` gives each lessor's answer before the aircraft roll (blocked, credit, exposure, with the §T security flag). Blocks: v0.16.3 `lessorBlock` by name, or a deferral default + 24 months (read from the deferral, `distress.ts` untouched). Leaseback: the stable pick, else the next willing lessor, then Carlyle (accepts D); the −3-point price share at D is not applied (finance/index.ts is not ours).
- **Requests** (rfp.ts): lessors that won't consider us are answered at sending (with the reason); a lessor that said "no aircraft" is not asked again for 30 days (left off the list, the dialog says when). Proposals go straight into `g.market.aircraft` (not `postOffer`), `expires` = `validUntil`. The previous operator (`exop`) answers for types with `EX_OPERATORS`, and for the 747 classics as "a storage owner" selling (a `buy` proposal).
- **Deals** (deals.ts): the C 15 % asks one more month; a grade lower asks two. Conditions unanswered for 7 days lapse with the holding deposit back. The paint costs the middle of `BAL.paint.full`; without paint the aircraft comes `white`. The reserves deposit (§T) is part of the refundable `deposit`.
- **Transition** (induction.ts): the plan only for offers with a `source` (legacy offers keep `leadDays`). Findings are rolled in the plan and told when the check starts; the dialog shows `expected` (no findings). Tech reps after signing (`addTechRepsToInduction`) move the handover earlier (a new delivery event; the ferry re-planned). `Induction.cap`/`need` are kept for the `camo-capacity` invariant.
- **AOC** (aoc.ts): `aocMiss` gives the gate's `aoc` miss (`GateMiss.id` is `ApprovalId | 'aoc'`, with `family`). The first widebody family rides on Widebody operations (held or pending) and joins `aocFamilies` at the grant. Exotic families (A380, 747) need 4 + 4 rated pilots. The authority: EASA states 90/120 days, the UK 45/60, others 60/90 (home base's country).
- **Letters of credit** (finance/lc.ts): fee accrued daily, posted to `bankFees` by `monthlyLeasing`; a frozen or not-renewed line → the lessor's cash call in 30 days (the `leaseConditions` card on the aircraft), then the deposit is taken in cash.
- **Month end**: `monthlyLeasing` (inside `refreshMarket`, before the statement closes) posts the letter-of-credit fees and `minHoursBill` (lane `supply`'s pure figure) as `reserves`.
- **Not done here**: contract feasibility does not yet count the variation's due date ("signs now, flies after"); the gate at departure and the ahead-of-time card do.

### Q.1c Lane `market-ui` as built (branch `v017-market-ui`)

The branch merges `v017-supply` and `v017-deals` first (merge commits, no edits to their files), so the UI reads their real APIs.

- **Fleet › Market** (`Market.tsx`): the rating line (`market/RatingLine.tsx`: "Lessor rating B · sound · deposit 2 months", Why? lists the parts with points, Short-term… and Ask lessors… on the right), then Offers · Requests · In progress (counts from `marketCounts`). A deep link opens its tab: `rfp` → Requests, `deal` or a delivering `aircraft` → In progress, `market` → Offers. With `BAL.v017.on` false (or no `g.leasing`) only the offer grid shows.
- **Offers** (`market/OffersView.tsx`): four rows per card (checked in the smoke: every `.mk17-card` has 4 children): art · type · year · cabin · badge (Lessor call / Proposal / Proposal · later / Batch / Short-term / New build / For sale; legacy offers keep "Lease used" / "Buy used") with the lessor (ex-operator, batch airline) under it; the terms with the deposit in months; "Ready ~26 Aug at Shannon · home ~28 Aug · open 7 more days" (or "With Vueling until 20 May · ready ~…"; ready = `loiQuote().ready` for a letter-of-intent offer, else the transition plan, else the legacy handover); chips (gate, pilots, tightness word, Rare, Bunks) and one button (Sign LOI… / Lease… / Buy… / See the ladder). Filters All · Narrowbody · Widebody · Short-term · Has bunks.
- **Requests** (`market/RequestsView.tsx`): one card per request (open first, then the last 60 days): title, "Answers by 25 Jun · 1 of 9 in", answer chips (AerCap ✓ proposal · Avolon: at its limit · Carlyle: rating, the lessor's words in the tooltip), See N proposals, Withdraw.
- **In progress** (`market/DealsView.tsx`): a row per deal (active, and declined or walked in the last 30 days) and per aircraft in transition or on its delivery ferry. Stage chips LOI · Credit check · Lease · Transition · Ferry; actions Pay $X / Letter of credit / Walk away (more security), Sign ($X) / Walk away (approved), Add tech reps / Walk away (committee), Add tech reps (records or findings) on a transition.
- **Dialogs**: `RfpModal` (type list: gate held, pending or one approval away, the request-only A320neo, and every exotic type always; age bands that exist for the type; 12–144 months; from as soon as possible or a month, flexible; 1–3; `rfpPreview` text, each lessor as a chip with its reason, the AOC and fleet-age notes, What it takes); `LoiModal` (the §N.3 rows from `loiQuote`, Why this rent from `whyText`, the transition timeline, the four toggles, registration and name, the no-ferry choice, What it takes); `AocModal` (families not on the AOC, the four lines, Apply, Book conversions); `SpotModal` (families on our AOC that an airline subleases, 3–9 months, from, `spotSources`, Ask). `AcquireModal` opens `LoiModal` for a letter-of-intent offer; for a v0.17 purchase, short-term or batch sale it plans the delivery from the transition's ready day, lists the transition steps and charges the transition and any reserves deposit.
- **What it takes** (`market/WhatItTakes.tsx`, §T): `exoticPath`'s lines with a tick or an open circle, shown in the request dialog, the letter-of-intent dialog and the purchase dialog for every exotic type (and for any type with an open requirement other than cash or the source).
- **Elsewhere**: `company/AocTypes.tsx` (families held, the one riding on Widebody operations, a variation's bar and "Waiting for 2 rated captains", Add a type…); `finance/LessorRating.tsx` ("Lessor rating B (72) · letters of credit $450K of the $1M line"; tap: Fleet › Market); the outlook dialog's Aircraft supply line (`supplyText`); the fleet card's Transition row ("Transition at Shannon: records review · ready 11 Aug (UTC) · 12 Aug local", Details → In progress) and Short-term row ("Back to TUI fly 31 Mar").
- **Card actions**: `store.leasingAction` acts on `dealPay`, `dealLc`, `dealSign`, `dealWalk` (asks first when the holding deposit would be lost), `techReps` and `aocApply` (opens Add a type), then opens the deal row or the aircraft; `runAction` (ProblemCard.tsx) calls it first.
- **screenLogic**: `refTarget` for `rfp` and `deal`; `offerKind` reads the source. **Glossary**: the twelve §N.5 terms (+ `TERM_WORDS`), "Show me" labels for `market` and `ladder`.
- **Bot** (`scripts/bot/market.ts`, §O): as designed, with these choices. acmi-bot.ts `narrowGrowth` stands down while `BAL.v017.on` (one line), and `botMarket` does the growth by request and letter of intent (calls in the same pool, cheapest rent + 250 FH reserves among offers ready by the target + 30 days; while a request is out it waits unless an offer lapses within 2 days; a new request at most every 14 days, mid then old). The widebody path only sends the request (old, 48 months, from the grant − 15 days); `fleet()` still signs with the job in hand and signs a proposal or call at once through `acquireAircraft` (the job needs the aircraft id at once), so a bot widebody skips the credit committee: noted for the balance step. Short-term only from the European sources (FRA, AMS, PRG, WAW, AYT) or our base. Decisions read only the game state; `MARKET_TALLY` keeps the report's grades by quarter and the growth needs.
- **Report** (`scripts/bot/report017.ts`): the §O.7 line plus `rating`, `conditions` and forfeits, and a second line `v0.17 narrowNeedToService: 64 (median 64 d) · wide 0 (deals 0)` with greedy and exotic counts.

### Q.1d Merge as built (branch `v017-merge`, fast-forwarded to acmi)

Merged supply → deals → market-ui (no conflicts; market-ui already held the other two). Integration fixes:
- **Letter of intent is the only door for a lessor's lease.** `acquireAircraft` refuses an offer that `usesLoi` ("This lease starts with a letter of intent") unless `AcquireOpts.direct` is passed. `direct` is for the bot's widebody-with-a-job path in acmi-bot.ts `fleet()` (it needs the aircraft id at once) and dev/tests only; the player's dialogs already routed such offers to `LoiModal`. Open for the balance step: route the bot widebody through the letter of intent.
- **Failure batches, one grade of relief** (§J.3, `BAL.v017.batch.gradeRelief`): deals.ts judges a batch offer's lessor stance at one grade better (`stanceRating`) in the letter-of-intent check and the §T security.
- **§T at D, never impossible**: rfp.ts `sellsOnly` — the previous operator sells an exotic to a D-rated airline through a request (a `buy` proposal at the §T sale price, no lessor credit check or cap), and a 747 classic is a sale from storage at any rating (before, a classic request at D was refused by the lease rule). `exoticPath` at D says "buy one with the cash instead (ask lessors: the airlines retiring them sell)". Test `leasing/exoticPath017.test.ts`: A380 and 747-400 at B (lease, no extra security), A380 at C (Amedeo, +4 months' deposit and 3 months' reserves), A380 at D (sale, bought for cash), 747-200 sale.
- **Why this rent**: the market line is split into the type's supply ("normal supply −1 %") and the demand index ("weak demand −12 %"); the rent is unchanged.
- **Tests**: world-tour seeds 13 and 9 + 13 (seed 3's tour now runs out of legal crew at Sydney: a crew story, not the tour's); saveCompat v0.5.2 60 days checks FTL on what is flown and the next 3 days (at day 60 a duty stretched by a ride home leaves the next positioning, 4 days out, 1:20 short of rest; the roster re-crews it 76 h ahead: an older crew-planner gap, logged for the crew lane); tests that sign a lessor call straight to check terms pass `direct`.
- **What's new**: one 'v0.17 Aircraft market' entry (§R lines, shortened).

### Q.2 The three lanes

| Lane | Owns (edits freely) | Adds | Never touches |
|---|---|---|---|
| `supply` | `src/engine/leasing/{tightness,terms,calls,spot,batches}.ts`, `src/engine/ops/market.ts` (beyond step 0: weights, caps, new-build leads, guaranteed offers through `quoteTerms`, `marketOutlook` supply), `src/engine/ops/leaseReturn.ts` (extension rent, `halfLifeShare`, the short-term return), `src/data/lessors.ts`, `src/data/market.ts` (storage sites, `SPOT_SOURCES`, `FAILURE_FLEETS`), `src/data/acmiTypes.ts` (rents of §E.1 only), `src/data/airports.ts` (TEV, MZJ, HAJ if missing: checked), `src/data/worldEvents.ts` (`delay777x`), the bodies of `onAirlineFailure` and `onSupplyEvent`, `BAL.v017.{supply,calls,newBuild,terms,spot,batch}` | tests `tightness.test.ts`, `terms.test.ts`, `calls.test.ts`, `spot.test.ts`, `batches.test.ts`, `leaseReturn017.test.ts` | `leasing/{credit,rfp,deals,induction,aoc}.ts`, `finance/**`, `ui/**`, `crew/**`, `contracts/**` |
| `deals` | `src/engine/leasing/{credit,rfp,deals,induction,aoc,index}.ts`, `src/engine/finance/lc.ts` (new), `src/engine/problems/leasing.ts`, `src/engine/ops/approvalGate.ts` (family gate), `src/engine/ops/delivery.ts` (handover from `ready` only), `src/engine/ops/company.ts` (`aocView` for the Ladder; nothing else), `scripts/invariants.ts` (`camo-capacity` only), `BAL.v017.{credit,rfp,deal,induction,aoc,lc}` | tests `credit.test.ts`, `rfp.test.ts`, `deals.test.ts`, `induction.test.ts`, `aoc.test.ts`, `lc.test.ts`, `saveCompat017.test.ts` | `leasing/{tightness,terms,calls,spot,batches}.ts`, `ops/market.ts` beyond step 0, `finance/index.ts` and `finance/distress.ts` beyond the step-0 hooks, `ui/**`, `crew/**` |
| `market-ui` | `src/ui/screens/Market.tsx`, `src/ui/screens/market/**`, `src/ui/modals/{RfpModal,LoiModal,AocModal,SpotModal}.tsx`, `src/ui/modals/AcquireModal.tsx` (purchases and legacy only), `src/ui/screens/Fleet.tsx` (the transition line and the tabs), `src/ui/screens/company/AocTypes.tsx`, `src/ui/screens/finance/LessorRating.tsx`, the outlook supply line where `marketOutlook` is shown, `src/ui/store.ts` (leasing actions), `src/ui/screens/screenLogic.ts` (`refTarget` for `rfp` / `deal`, `offerKind` sources), `src/data/glossary.ts` (§N.5), `scripts/bot/market.ts`, `scripts/bot/report017.ts`, CSS for the new classes | tests `marketLogic.test.ts`, Playwright shots in `/home/user/work/v017/shots/` | `src/engine/**` (reads the APIs; asks the engine lanes for changes in their STATE files), `crew/**` |

Added at step 0 (§T, Q.1a):
- `src/engine/leasing/exotic.ts` and `BAL.v017.exotic.{minGrade,securityGrade,securityMonths,reservesDepositMonths,crew}` → lane `deals`; `BAL.v017.exotic.{types,classics,floor,sale,callsPerYear}` and Amedeo's row in `data/lessors.ts` → lane `supply`.
- `src/engine/leasing/side.ts` → step 0 only.

Shared files nobody edits beyond their marked block:
- `core/types.ts`: a lane may add optional fields inside its own `// v0.17 <lane>` block;
- `core/balance.ts`: `BAL.v017.<own sub-blocks>` only;
- `core/ledger.ts`: step 0 only;
- `data/whatsNew.ts`: not edited by lanes; each lane writes its lines under §R here, and the merge assembles the entry;
- `scripts/acmi-bot.ts`: step 0 only;
- `src/engine/problems/index.ts`: step 0 only.

Every new cue reuses the existing ones (`notice`, `decision`, `offerNew`, `ladder`, `delivered`): no `SOUND_OF` edits. No lane edits `src/engine/crew/**` (v0.16.4) or `src/engine/finance/distress.ts` (v0.16.3) beyond reading their exports.

**Order:** step 0 → the three lanes in parallel, each keeping `/home/user/work/v017/<lane>/STATE.txt` and pushing often → merge (`supply`, then `deals`, then `market-ui`; merge, never rebase) → the balance step (§P) → review.

**With two builders:** `supply` and `deals` become one `engine` lane with the union of their files, and `market-ui` stays as it is.

---

## R. What's new (assembled at the merge)

- Supply: "The aircraft market moves like the real one. Each type is easy, normal or tight to find. Narrowbodies are easing, and widebodies are scarce: lessees keep their A330s and 777s, and new 787s and A350s are placed until 2030. Lessors call more often with narrowbodies. When an airline fails, its aircraft come to the market in a batch below market rent. Short-term aircraft come from airlines in their quiet season."
- Deals: "Ask lessors for the aircraft you want: type, age, lease and start. They answer in one to three weeks with a proposal or a plain no. Lessors check our credit (years on the AOC, fleet, cash, debts, who we fly for, IOSA) and set the deposit. Each lessor places only so many aircraft with us. Sign a letter of intent, pass the lessor's credit check, then the aircraft goes through records, a check and paint before the ferry home. Our CAMO handles a few transitions at a time. A new type needs an AOC variation."
- Deals (as built): "Ask lessors for the aircraft you want. They answer in one to three weeks with a proposal or a plain no. Your lessor rating (A to D) sets who will talk to you and the deposit. Sign a letter of intent, pass the lessor's credit check, then the aircraft goes through records, a check and paint before the ferry home; our CAMO handles a few at a time. A new type family needs an AOC variation. An A380 or a 747 is possible: rating B, or C with a big deposit, or buy one."
- UI: "Fleet › Market has Offers, Requests and In progress. Your lessor rating and why are at the top."
- UI (as built): "Fleet › Market: your lessor rating and why at the top, Ask lessors… and Short-term… beside it, then Offers, Requests and In progress. Offer cards are four lines. A deal shows its stage and the next step: pay, sign, walk away or add tech reps. Rare types (A380, 747) show what it takes. Company › Ladder lists the types on our AOC."

---

## S. Realism notes, open questions

Realism notes:
- **Why rent starts from the reference rent, not a percentage of value.** The game's used values are sale values below appraisers' half-life values for narrowbodies. The factors applied are the real ones: term, credit and the market.
- **IOSA.** It is not a lessor condition in any source found. It is a small plus in the rating, and the real gate stays with clients (v0.16 levels 3–4).
- **Country risk** (Cape Town Convention) is real and left out. Most registries in the game are European, and getting each state's status wrong would mislead. A later version can add it per registry.
- **Engine shop visits paid from reserves** are not modelled. Reserves stay the lessor's share of maintenance, as in v0.7.

Open for the player:
1. Should the A320neo be request-only, as designed (GTF groundings make proposals rare), or stay out of the market?
2. Should lessor calls also go through the credit check (as designed: about 2–5 weeks more before the handover), or sign at once as today, with only the grade's deposit?

---

## T. Exotic types: hard, expensive, never impossible (player addition, 6 Nov)

The player wants the cool aircraft to be possible: leasing or buying an A380, a 747-400 or 747-8, or another rare widebody (A340-500/-600, A340-200, the 747 classics). Not realistic-easy, but never impossible. Real precedent:
- End-of-life A380s sit with fund managers and specialist lessors (Doric's funds; Amedeo, the Dublin A380 lessor) and with airlines retiring them. A charter airline wet-leased an ex-Singapore A380 for summer peaks in 2018–2020 (Hi Fly), and a UK start-up bought ex-airline A380s in 2023–24 *(from memory, not verified in the research files)*.
- Fewer than 80 passenger 747-400s are left; Lufthansa is selling two 747-8is and retiring two 747-400s (research-supply.md). Old ones go to freighter conversion or storage.

**Who offers them** (`data/lessors.ts`): Doric (A380, B777, B787, A350; B/B), Amedeo (A380 only; B/B, and it places 1 with a C-rated airline under the security rule below), and the previous operator (`exop`: 747s, A340s, 757/767, A380; leases or sells direct). 747 classics come only from storage, as sales.

**The rule** (`BAL.v017.exotic`; lane `deals`):
- An exotic needs lessor rating **B or better** from any source.
- At **C**, a lessor still deals with **big security**: `securityMonths` (4) more months of deposit and `reservesDepositMonths` (3) months of minimum-hours reserves up front. At **D**, no lease.
- A **purchase** skips the lessor's credit check (§F): with the cash, any grade can buy one. The price is the used value × `sale.priceX` (0.85–1.10); `sale.share` (0.4) of exotic offers are sales.
- Everything else still applies: the type's approvals (Widebody operations; augmented crews and ETOPS 180 for the A380 and 747-8), the AOC variation of a new family (§H, 120 days at EASA), rated crews (`crew`: 4 captains and 4 first officers before the variation is granted, more than a common type), the CAMO slot (a widebody takes 2) and, for a lease, the grade's widebody total (§C.2) and each lessor's cap (a purchase counts against neither).

**Never impossible** (lane `supply` with `deals`): tightness alone must not shut the door (the 747-8's 0.95 gives about 2 % a request). A request that meets every requirement and goes to a source that holds the type gets a proposal with at least `floor.default` (0.12) chance, or `floor.classic` (0.05) for a 747 classic (a sale from storage). Lessor calls of an exotic come about `callsPerYear` (1) a year once the gate allows the type. The bot's `--greedy` run reports exotic requests and their answers.

**What it takes** (`exoticPath(g, typeId)`, exotic.ts; pure): one line per requirement, met or not (grade, or the security at C; approvals; AOC family; rated pilots; who has them). Lane `market-ui` shows it in the request dialog when an exotic is picked ("What it takes"), on an exotic offer card's dialog, and greys nothing out: an exotic type is always listed with its lines, never hidden. Wording: "A380: rating B or better (now C) · at C: 4 more months' deposit and 3 months of reserves up front · Widebody operations, augmented crews and ETOPS 180 · an AOC variation (120 days) · 4 + 4 rated pilots · Doric, Amedeo, airlines retiring them".

**Acceptance** (added to §P):
17. Every exotic type has at least one source in `data/lessors.ts`, and `exoticPath` lists it (step-0 test).
18. With every requirement met at B, `--greedy` requests for the A380 and the 747-400 get at least one proposal within a year on at least 3 of 5 seeds; at C with the security, at least one within a year on 1 of 5; at D, a sale offer can be signed with the cash.
19. An exotic signed at C carries the extra deposit and the reserves deposit on its lease.
