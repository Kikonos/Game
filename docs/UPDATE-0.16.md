# BLOCK HOURS v0.16 "Finance & Sales": design

Plan of record for v0.16, written for four lanes that build in parallel from the shared skeleton on `v016-step0`. The ground rules of DESIGN.md and BUILD-PLAN.md hold: engine RNG only (`chance` / `int` / `sideRng` / `hashUnit`), ids via `nextId`, money only through `post` / `accrue` / `cashOnly` / `invoice` with a proper `LedgerCat`, `SAVE_VERSION` stays 1 (new fields optional, `??=` defaults in each module's `load`, `init` sets the same defaults so a new game and a reloaded one serialise alike), the four player saves load and keep working, every new problem is a four-line card (what · why · does it hurt · what you can do), every chime has its notification, plain short wording, UTC with local time alongside, nothing flickers.

The player's words (4 Nov): realistic finance for an ACMI operator; a client prestige ladder so the climb is slower ("established after one year was too fast"); about half the inbound offers, the rest chased through brokers, pitches, a leads pipeline and regional sales staff; an offer filter ("what you tell your sales team and brokers"); as many real airlines and clients as reasonable with liveries and exotic multi-stop routes with crew changes; a Compliance Monitoring Manager as a real hire; "Client pays fuel" / "Fuel ours" on every offer card. One release to main, one What's new entry (v0.16, the v0.15.1 fixes already in it).

| # | Feature | Lane | One line |
|---|---|---|---|
| A | Finance | `finance` | A revolving credit line with covenants, loans secured on owned aircraft, sale and leaseback with real lessors, invoice factoring, the client deposit as a negotiation lever, interest on spare cash. |
| B | Client prestige ladder | `clients` | Every client at a level 1–4; the player's level from visibility earned (weighted by whom they flew for), track record and approvals; offers come at the player's level, one stretch offer a month. |
| E | Clients & routes data | `clients` | ~60 more real airlines, tour operators, governments, agencies and promoters with liveries; exotic multi-stop routes with crew changes; the airports they need. |
| C | Fewer offers, chasing | `sales` | Inbound offers halved; brokers with relationships and commission; pre-season pitches; a leads pipeline; regional sales managers; tenders and fairs matter more. |
| D | Offer filter | `ops` | Contracts › Filter: client types and levels, minimum rate or profit, aircraft families, markets. Hidden offers neither chime nor notify; "N offers hidden by your filter". |
| F | Compliance Monitoring Manager | `ops` | A nominated post hired in Team: salary, fewer ramp and audit findings; the ramp corrective action links to the hire. |
| G | Fuel wording | step 0 | "Client pays fuel" (ACMI) · "Fuel ours, in the price · fuel clause" (full charter) on every offer card. Done in step 0. |

---

## 0. The skeleton (step 0, on this branch)

Step 0 adds everything the lanes share, so no lane edits another lane's files:

- `core/types.ts`: the optional `GameState` fields and the new types (§A.8, §B.6, §C.7, §D.3, §F.3), `LedgerCat` additions, `ProblemKind` and `Ref['kind']` additions.
- `core/ledger.ts`: `REVENUE_CATS` + `interestIncome`; `COST_CATS` + `bankFees`, `commission`.
- `core/balance.ts`: `BAL.v016` with every number below (`finance`, `prestige`, `sales`, `filter`, `compliance` sub-blocks: a lane tunes only its own).
- `data/naming.ts`: `ClientSeed.prestige` on every seed (§B.2).
- Stub modules with the real signatures, returning neutral values (no behaviour change): `engine/finance/index.ts`, `engine/contracts/prestige.ts` (the level assignment, the player's level derivation and the visibility credit at `completeContract` are REAL in step 0; the offer effects and level-ups are neutral), `engine/commercial/sales.ts` (the broker table and `commissionOf` are real; `brokerCut` already reads an offer's `brokerId`), `engine/contracts/filter.ts`, `engine/ops/compliance.ts`, `engine/core/stats016.ts` (`statsV016(g)`, the shared counters), `scripts/bot/finance.ts`, `scripts/bot/sales.ts`. `marketOffers()` already leaves `hidden` offers out of the Market list.
- Imports: a lane module may import `ops/finance.ts` (e.g. `monthEndBill` for the covenants) even though `ops/finance.ts` imports the lane's forecast items: the functions run at call time, so the cycle is harmless in ESM / Vite. Lane modules must not import `offers.ts` (it imports them).
- Hook points wired to the stubs: `offers.ts` (`clientWeight` × `prestigeOfferWeight`, `finalize` asks `offerHidden` before the cue and `markStretch`), `accept.ts completeContract` → `onContractDoneVisibility`, `ops/finance.ts` (`forecastItems` + `treasuryForecastItems`; `monthEndBill` gains `sales` and `compliance`), `ops/index.ts` (load / daily / monthly hooks), `commercial/index.ts` (load / daily), `contracts/index.ts` (load), `acmi-bot.ts` (`botFinance`, `botSales` once a day).
- UI slots (components that render nothing until a lane fills them): `ui/screens/finance/Financing.tsx` on Finance, `ui/screens/contracts/SalesView.tsx` and `FilterView.tsx` as Contracts tabs, `ui/screens/team/SalesStaff.tsx` and `NominatedPosts.tsx` on Team, `ui/modals/offer/DepositPicker.tsx` in the offer dialog, `ui/screens/company/PrestigeCard.tsx` on Company › Overview.
- Fuel wording (G) in `screenLogic.ts fuelLine()` and the offer dialog.

Acceptance of step 0: tsc clean, vitest green, `bot 1 120 --wide --inv` identical to acmi 6d2845a (same monthly table), the four saves load.

---

## A. Finance (lane `finance`)

Real-world shapes for a small European ACMI operator (RESEARCH §4.7, §5.7): a revolving credit facility (RCF) from the house bank, aircraft-secured term loans, sale-and-leaseback with the big operating lessors, receivables financing (factoring / invoice discounting), customer deposits on charters, and a money-market account for the float. No investors, no insurance choices (not in scope).

### A.1 Benchmark rate

One benchmark the bank prices from (think 3-month EURIBOR / SOFR): `benchmarkRate(g)` = 4.00 % a year, moved by the market cycle (ops/market.ts): boom +0.75, steady 0, soft −0.50, slump −1.00 (central banks cut in a slump) → 3.0–4.75 %. Shown on the Finance screen ("Bank rate 4.0 %").

### A.2 Revolving credit line

- Eligibility: two closed monthly statements. The bank sizes the line yearly: **limit** = 1.5 × average monthly revenue of the last 6 closed months (≥ 2) + 10 % of the owned fleet's book value, rounded to $100K, clamped $500K–$20M; a Newcomer (standing 0) is capped at $1.0M.
- **Interest** on the drawn balance: benchmark + margin; margin 4.0 % (Newcomer), 3.0 % (Established), 2.5 % (Respected); +2.0 % after a second covenant breach (A.2 consequences). Accrued daily on the drawn balance, posted at month end as `interest`.
- **Commitment fee** 0.50 % a year on the undrawn part, monthly (`bankFees`). **Arrangement fee** 0.50 % of the limit (min $10K) at opening and at each yearly renewal (`bankFees`).
- Draw in $50K steps up to the undrawn limit; repay any amount any time. Draws and repayments are balance-sheet moves (`cashOnly` + the treasury record); the statement shows only interest and fees. The forecast shows the scheduled repayments (A.2 freeze, A.3 instalments).
- **Covenants**, checked at every month end once the line is open:
  1. Liquidity: cash + undrawn ≥ next month's bill (`monthEndBill(g, k+1).total`).
  2. Leverage: net debt ≤ 3.5 × EBITDA of the last 12 closed months, where EBITDA12 = Σ profit − Σ(`interest` + `capex` + `assetSale`) lines (interest added back, aircraft purchases and sale gains taken out); net debt = drawn + loan balances − max(0, cash). EBITDA12 ≤ 0 with net debt > 0 is a breach.
  Consequences: first breach → the red card `covenantBreach` (what: "The bank's covenant is broken"; why: which one and the numbers; hurt: waiver fee 0.25 % of the limit, posted; what you can do: repay, chase receivables, sell an invoice, find work) and 30 days to cure. A second consecutive month in breach → margin +2.0 %. A third → the line is **frozen**: no draws, the drawn balance repaid in three parts at the next three month ends (cash is swept even if that takes it below zero: the usual solvency flow applies). Cured when both covenants hold at a month end: the margin step-up falls away after three clean months, the freeze lifts at the next renewal.
- **Renewal** yearly on the anniversary: re-sized to the formula; a line frozen at renewal is not renewed (closed; any balance repaid over 90 days as above). Message + a `creditHeadroom` amber card when cash + undrawn < one month's bill.
- Realism notes: covenant waivers and margin ratchets are how banks really react before pulling a line; a frozen RCF with a repayment schedule is the "amend and extend" of a stressed borrower.

### A.3 Loan secured on an owned aircraft

- One loan per owned aircraft. **Loan-to-value 60 %** of today's market value (the sale quote's price basis: type `valueUsed` × `ageFactor` × segment index); minimum $1M. Term 3, 5 or 7 years (capped so the aircraft is ≤ 25 years old at the end). Fixed rate = benchmark + 3.5 % at signing. **Monthly annuity** on the 1st (`interest` for the interest part, `cashOnly` for the principal, recorded in the treasury). Arrangement fee 1.0 % (`bankFees`). **Early repayment fee** 2 % of the balance, 1 % after half the term.
- The aircraft cannot be sold while the loan stands: the sale quote shows "repay $X first" and a "sell and repay" path (the proceeds clear the loan, the rest is ours). A sale-and-leaseback repays the loan from the proceeds first.
- A missed instalment (cash short on the 1st) is still taken (cash goes negative: the usual flow) plus a 1 % late fee; two misses in 12 months → the bank calls the loan: the balance due in 60 days (card). Cards: `loanDue` amber 7 days before the 1st when the forecast shows cash short for it, red inside 48 h.

### A.4 Sale and leaseback

- Any owned aircraft in the fleet (not delivering, not under a sale). Lessors: AerCap, Avolon, SMBC Aviation Capital, Air Lease Corporation, BOC Aviation, Carlyle Aviation Partners (a stable pick per aircraft from a side stream).
- **Price** = market value × 0.97 (Newcomer 0.94), rounded $10K. **Term** 5, 6 or 8 years, capped at age 25 at lease end. **Rent** = price × lease rate factor, LRF = 0.0075 + 0.0004 × max(0, age − 5), clamped 0.75 %–1.10 % a month (real LRFs 0.7–1.0 % for mid-life, higher for old jets). Reserves per FH as the market offers for the type. **Deposit** two months' rent, refundable at return. Return conditions as any dry lease in (half-life, return check, 120-day notice): `Ownership` becomes `dryLeaseIn` with `leaseback: true`.
- Money: the gain or loss against book value → `assetSale`; book value back via `cashOnly` (as ops/sale.ts closes a sale); deposit `cashOnly`; a loan on the aircraft is repaid first (A.3). Rent then runs through `rent` like every lease. The aircraft keeps its registration, name, livery, contracts and crew.
- Why a player does it: cash now (often the whole book value) and off-balance-sheet debt; why not: higher monthly cost over the term and the return conditions.

### A.5 Invoice factoring / discounting

- Eligible receivable: open, not written off, not already factored, ≥ $20K, due within 90 days or overdue by ≤ 30 days. Total factored at once ≤ $5M.
- **With recourse**: the bank advances **95 %** now; fee = 1.0 % + 0.04 % per day to the due date (overdue: 3.0 % + 0.10 % per day overdue), min 1 %, max 8 %; the rest (amount − advance − fee) arrives when the client pays. If the client has not paid 90 days past due we buy the invoice back (the advance is debited, the invoice is ours again; card `factorRecourse` amber from 60 days overdue).
- **Without recourse**: advance 92 %, fee +1.5 % (governments +3.0 %); the bank keeps the risk: if the client never pays, nothing more happens to us.
- Ledger: fee → `bankFees`; the advance and the balance are `cashOnly` (the revenue was accrued at invoicing). `Receivable.factor` records it; `onPayment` pays us the balance only. The existing late-payment decision's "sell the invoice" (8 %) becomes the overdue quote above.

### A.6 Client deposits on charters

- Today every commercial charter asks a flat 30 % deposit (`BAL.charterDeposit`). v0.16: a **norm by client kind** — tour operator 20 %, airline 20 %, sports 30 %, music 40 %, corporate 10 %, agency 20 %; governments and the UN 0 (invoiced in arrears, unchanged); a level 3–4 client's norm is 10 points lower (they pay deposits less readily).
- When accepting or countering a full charter the player chooses 0 / 10 / 20 / 30 / 40 / 50 %. Each 10 points **above** the norm: the client's acceptance chance −6 points (counters) and, on a plain accept, a 25 % chance the client signs at the norm instead ("20 % is what we do"); each 10 points **below** the norm: +4 points and the client's walk-away floor eases 0.5 % (a cheaper deal). The dialog says it in words ("Lower chance they accept: −12 points"). Deposit invoiced at signing as today; the balance per the existing instalments.
- A deposit is real negotiation money: more deposit = less payment risk and earlier cash (the forecast shows it), at the cost of acceptance.

### A.7 Interest on spare cash

Money market: cash above a $250K operating float earns benchmark − 1.0 % (floor 1.5 %), accrued daily, posted at month end as `interestIncome` ("Interest on cash"). Small, honest: $3M spare earns about $7.5K a month.

### A.8 State and API

```ts
// core/types.ts
export interface CreditLine {
  limit: number; drawn: number; margin: number; openedAt: Minute; renewsAt: Minute;
  /** Interest and commitment fee accrued this month (posted at month end). */
  accrued: number; accruedFee: number;
  /** Consecutive month ends in breach; margin step-up on; frozen since (no draws; repayment thirds). */
  breaches: number; stepUp?: boolean; frozen?: Minute | null; repay?: { at: Minute; amount: number }[];
  /** Last covenant check: [liquidity ok, leverage ok, netDebt, ebitda12]. */
  last?: { t: Minute; liquidity: boolean; leverage: boolean; netDebt: number; ebitda12: number };
}
export interface AircraftLoan {
  id: string; aircraftId: string; bank: string; principal: number; balance: number; rate: number; months: number;
  instalment: number; start: Minute; nextDue: Minute; paid: number; missed: Minute[]; calledAt?: Minute;
}
export interface Treasury {
  credit?: CreditLine | null; loans: AircraftLoan[];
  /** Money market: interest accrued this month. */ mmAccrued: number;
  /** Factored invoices outstanding (by receivable id). */ factored: string[];
  stats: { interest: number; fees: number; factored: number; leasebacks: number; loans: number; drawnMax: number };
}
// Receivable.factor?: { advance: number; fee: number; recourse: boolean; at: Minute; settled?: Minute; boughtBack?: Minute }
// Ownership dryLeaseIn: leaseback?: true
// GameState.treasury?: Treasury   load: ??= { loans: [], mmAccrued: 0, factored: [], stats: zeros }
```
API (engine/finance/index.ts; pure reads listed in `core/plumbing.test.ts`): `benchmarkRate`, `creditLimitFor`, `creditView`, `openCreditLine`, `drawCredit`, `repayCredit`, `loanQuote`, `takeLoan`, `repayLoan`, `leasebackQuote`, `sellAndLeaseBack`, `factorQuote`, `factorInvoice`, `depositNorm`, `depositEffect`, `monthlyTreasury` (interest, fees, covenants, instalments, money market), `dailyTreasury` (cards), `treasuryForecastItems`, `loadTreasury`.

UI: Finance gets a **Financing** section (credit line card with a draw/repay stepper and the covenant lines; loans per aircraft; money market line; "Sell invoice" on each receivable row); Fleet › aircraft card gets "Borrow against it" and "Sell and lease back"; the offer dialog gets the Deposit picker. iPhone landscape: each card ≤ 3 rows, steppers 44 px.

### A.9 As built (lane finance)

- Finance › **The bank**: the credit line (status chip Open / In breach / Frozen / Not renewed, drawn of limit bar, the rates, both covenants with today's numbers, the renewal date, Draw / Repay steppers in $50K steps, Close), loans per aircraft (balance, instalment, next due, paid n of m, Repay early with the fee), spare cash and debt (bank rate, money-market rate and what is earning, debt net of cash, EBITDA of the last 12 months). Receivables rows get **Sell** (the bank's dialog: with / without recourse, advance less the fee now, the rest when the client pays). Fleet card: **Borrow against it…**, **Sell and lease back…**, the loan line, the "Leased back from …" line. The offer dialog: **Deposit on signing** 0–50 % with the effect in words; a counter carries the deposit to the reply.
- Factoring cash flow: the bank's fee comes out of the advance (advance − fee lands now; amount − advance when the client pays; a recourse buy-back returns the advance only). EBITDA adds bank fees back as well as interest.
- Cards (four lines): `covenantBreach` (red, cure date, waiver fee, what follows), `loanDue` (amber 7 days ahead when the forecast is short, red inside 48 h or when the loan is called), `creditHeadroom` (amber, once a fortnight), `factorRecourse` (amber from 60 days overdue). Cues: breach and step-up `latePayer`, freeze and loan call `cashNegative`, cards `notice`, renewals and pay-offs `message`; the player's own actions are quiet (toast + Inbox).
- Bot (`scripts/bot/finance.ts`): opens the line as soon as the bank allows, draws against a negative 30-day low, repays above $1.5M + the bill, sells invoices when still short, borrows against the most valuable owned aircraft when short by more than $200K, sells and leases back after ten days below zero.
- Existing saves: `treasury` is created empty on load; s0329 opens a $10.8M line (two years of statements, $0 drawn, EBITDA12 −$1.9M so the leverage covenant holds only while net debt ≤ 0, which is the realistic reading of that game).

**What's new (finance):** "Finance has a bank now: a credit line with covenants, loans on your own aircraft, sale and leaseback with the big lessors, selling invoices to the bank, and interest on spare cash. Ask a deposit on a charter and see what it does to the client's answer. Every bank line is on the statement and in the forecast."


---

## B. Client prestige ladder (lane `clients`)

### B.1 Levels

| Level | Name (player words) | Who | Pay | Penalties | Requirements they check |
|---|---|---|---|---|---|
| 1 | Brochure work | Tour operators, holiday brochures, low-cost carriers, small leisure | −4 % | × 0.8 | none |
| 2 | Charter market | Leisure airlines, sports clubs, promoters, agencies, corporates, ship managers | 0 | × 1.0 | reliable ≥ 55 |
| 3 | National carriers | Flag and network airlines (TAP, Aer Lingus, Royal Air Maroc, Air Caraïbes, French bee…), aid agencies (WFP, UNHCR, IOM, WHO), home-country ministries | +4 % | × 1.3 | reliable ≥ 65, fleet average age ≤ 22, IOSA held (filed is enough for a stretch offer) |
| 4 | Majors and governments | Air France, KLM, Lufthansa, SWISS, British Airways, Virgin Atlantic, Iberia, Qantas, Air Canada, LATAM; big governments, presidencies, defence ministries, UN DPO | +8 % | × 1.6 | IOSA held, reliable ≥ 75, clean ≥ 60, fleet average age ≤ 18 |

Pay is a rate part like `levelPct` / `standingPct` (shown on the offer's client block, "+4 % rate (national carrier)"). Penalties scale `perDelay`; relation hits for our failures × 1 / 1 / 1.3 / 1.5. Company standing (Newcomer / Established / Respected) stays as it is: it is about age and reliability and keeps its rate part; the prestige level is about whom we fly for.

### B.2 Client prestige (data)

`ClientSeed.prestige` on every seed in data/naming.ts (step 0 sets them). Rules for a seed without one (and for clients added by name elsewhere): government → 4 (home-country foreign/defence ministries of PT, ES, LT, MT, LV, CZ, BG, EE → 3); agency with role aid/health → 3; airline → 3 unless listed as low-cost (1) or leisure (2) or major (4); tourOperator → 1; sports, music, corporate, other agencies → 2. Rival operators (`rivalId`) → 2. `Client.prestige` is set at seeding and on load (`??=`), never changed after.

### B.3 Visibility and the player's level

- **Visibility** (never decays): per revenue block hour flown, weighted by the client's level 0.25 / 0.6 / 1.2 / 2.0; per completed contract +10 × (1 / 2 / 4 / 7); a fair attended +15; a tender won +40; a broker's deal counts as normal. Counted in `completeContract` (the contract's `use` block minutes) and by the sales module.
- **Level thresholds** (all must hold; the level never drops):

| To | Visibility | Contracts done | Reliable | Clean | Approvals | Months on the AOC |
|---|---|---|---|---|---|---|
| 2 | 800 | 3 | 60 | – | – | 6 |
| 3 | 3,000 | 12 | 70 | – | IOSA held | 18 |
| 4 | 8,000 | 30 | 78 | 60 | IOSA held | 36 |

A two-A320 startup flying brochure and charter-market work (≈ 400 BH a month at 0.25–0.6) earns 100–240 visibility a month: level 2 after 4–8 months, level 3 around the second summer with 3–4 aircraft, level 4 in year 4 — slower than today's Established-at-120-days / Respected-at-a-year, as asked.

- **Offers** come at the player's level: the client pick weight × 1.0 (same level), 0.5 (one below), 0.25 (two below), 0.10 (three below), **0.10 for one above** (a stretch offer, at most one per 30 days, labelled "Stretch offer: a taste of what's to come", `ContractOffer.stretch`), 0 for two above. A stretch offer carries the client's requirements (IOSA etc.) so feasibility says what is missing. Tenders, calls and leads use the same weights where they pick a client.
- Level-up: a message with a card ("We're flying for national carriers now": what it brings, what the next level needs) and the `ladder` cue; the Company › Overview Prestige card shows the level, the visibility bar and the next level's missing items (plain lines).

### B.4 Existing saves (load, step 0 already does this)

- Every client gets `prestige` by seed name, else by the B.2 rules.
- The player's visibility is derived once from history: completed contracts' block minutes × the client weight + 10 × the contract weight (active contracts count what they have flown). The level = max(the level the thresholds allow, the highest client level with ≥ 2 completed jobs, the highest with ≥ 1 completed job − 1), at least 1. Stored in `company.prestige` with `derived: true`; never lowered afterwards.

### B.5 Lane `clients` also owns E (data)

- New client seeds (`CLIENT_SEEDS_V016`, added by name on load like v0.14): airlines Air France, KLM, Transavia, French bee, Air Caraïbes, Corsair, Aircalin, Air Tahiti Nui, Air Austral, Caribbean Airlines, British Airways, Virgin Atlantic, Iberia, SWISS, Austrian, Brussels Airlines, ITA Airways, Finnair, Icelandair, Norwegian, Air Europa, SunExpress, Smartwings, Neos, World2fly, Wizz Air, easyJet, Ryanair, Vueling, Volotea (Ryanair / Wizz Air / easyJet / SunExpress / Sunclass / TUI Airways / flyadeal exist as tender issuers: give them seeds and prestige); tour operators TUI (TUI Deutschland exists), Jet2holidays (exists), Sunweb (exists), Schauinsland-Reisen (exists), DER Touristik, Coral Travel, Anex Tour; governments and militaries (French Ministry of the Armed Forces, Italian, Dutch, Belgian, Norwegian, Swedish, Danish, Finnish defence ministries, the Australian Department of Defence, the New Zealand Defence Force, Canadian DND), UN/WFP-type agencies (UNICEF, UN OCHA, ICRC, MSF), sports (PSG, Bayern, Juventus, Celtic, national federations), music (CAA Touring, Semmel Concerts, DEAG) — each with country, base, kind, role, prestige; IATA codes in clients.ts; `AIRLINE_FAMILIES` and `AIRLINE_MARKETS` rows; a livery recipe in clientLiveries.ts where the paint model can draw it (approximate marks, never traced art).
- **Exotic routes** (missions.ts, a builder `farRoute(ctx)` producing adhoc / troopRotation / repatriation drafts with `exotic: true`): multi-stop legs patterns with a crew change (`slip`) at the stopover, e.g. the French military Paris–Singapore–Nouméa rotation on a 777-200 (crew change at Singapore), Paris–Réunion–Mayotte, Paris–Pointe-à-Pitre–Fort-de-France, Amsterdam–Curaçao–Bonaire, Lisbon–Praia–São Tomé, Canberra–Nadi–Honiara, Papeete–Nouméa–Wallis. They pay well (archetype multiplier × 1.25) and need the range, ETOPS and in-flight rest the long legs ask for. Only airports in data/airports.ts: add the missing ones with real coordinates and runways (FDF, PTP, CAY, DZA, WLS, HIR, VLI, POM, TBU, APW, SXM, CUR, BON, AUA, POS, BGI, KIN, MBJ, PUJ, ANU, BDA, PLS…; check each before adding).
- New clients' offers use the paint (paintTerms.ts), cabin (CabinTerms) and mixed-crew (v0.8) mechanics as every offer does — no new code, but the builders set the right odds (majors ask for full paint more often; the French military asks for none).

### B.6 State and API

```ts
export type Prestige = 1 | 2 | 3 | 4;
export interface PlayerPrestige { level: Prestige; visibility: number; levelAt: Partial<Record<Prestige, Minute>>; stretchAt?: Minute; derived?: true }
// Client.prestige?: Prestige    ClientSeed.prestige?: Prestige    Company.prestige?: PlayerPrestige
// ContractOffer.stretch?: true   ContractOffer.exotic?: true   Stats.v016.visibilityFrom?: Record<Prestige, number>
```
API (contracts/prestige.ts): `PRESTIGE_NAME`, `seedPrestige(seed | client)`, `clientPrestige(g, c)`, `playerPrestige(g)`, `prestigeLevelFor(g)` (thresholds), `loadPrestige(g)` (assign + derive, never demote), `prestigeOfferWeight(g, c)`, `markStretch(g, draft)`, `addVisibility(g, amount, why)`, `onContractDoneVisibility(g, c)`, `prestigePayPct(level)`, `prestigeRequirements(level)`, `prestigeView(g)`, `dailyPrestige(g)` (level-ups and their message).

---

## C. Fewer offers and chasing work (lane `sales`)

### C.1 Inbound cut in half

`BAL.marketOffers.perWeek` 1.1 / 3.1 / 4.6 → **0.55 / 1.6 / 2.3**; `BAL.quietFloor.days` 8 → 12. Opening offers, tenders, world-event work, calls and repeat business stay. Rebalance prices only if the bots cannot survive (§6 acceptance: seeds 1–3 solvent at 120 and 365 days with the bot chasing work).

### C.2 Brokers

| Broker | Commission | Focus | Where |
|---|---|---|---|
| Air Charter Service | 4.0 % | every kind of work | global |
| Chapman Freeborn | 5.0 % | governments, aid, sports, big groups | global |
| ACC Aviation | 3.5 % | airlines' ACMI: season bases, AOG cover, capacity leases | global |
| Air Partner | 4.5 % | sports, music, corporate | Europe, North America |
| Hunt & Palmer | 3.0 % | sports, groups, tour series | UK, Europe |

- Relationship 0–100 per broker. Registering (a day's visit to their office or a call from Contracts › Sales: $0) → 20. +6 per deal flown with ≥ 90 % on time, −10 per deal we cancel, −1 a month idle (floor 10 once registered).
- Leads a week from a broker on busy days: 0.35 × relation / 100 × fit, where fit is the share of its focus at our level ± 1. A broker's offer carries `broker` (name) and `brokerId`; its commission replaces the flat 5 % (`brokerCut` reads the broker's rate; posted as `commission` at billing so the statement shows it).

### C.3 Leads pipeline

`lead → proposal → negotiation → signed | cold | lost`. A lead names the client, the kind of work, the market, an estimated value and where it came from (broker, pitch, fair, sales manager, visit). Lifetimes: a lead goes **cold after 14 days** without "Send proposal"; a proposal is answered in 2–7 days (busy day): 55 % → an offer on the market tagged `leadId` (negotiation; the normal accept / counter flow, its own expiry), 45 % lost ("went with another operator" / "postponed"). Worked at once: 3 + 3 per sales manager (you and the analyst are one desk). Fair leads (`TripLead`) become pipeline leads. The pipeline view shows the stage, days left and value; a lead about to go cold gets the `leadCold` amber card.

### C.4 Pre-season pitches

Pitch an airline for summer cover in October–February, for winter cover in April–August. Target: an airline client at our level or one above; at most 4 pitches a season per desk; $1,500 (a visit) or free from a fair met there. The reply comes after 14–42 days: 40 % "maybe" → a proposal-stage lead for a season base in that season; 20 % a direct season-base offer 60–120 days before the season; 40 % "no, thank you" (+1 relation for the approach anyway). Realistic: this is how ACMI capacity for next summer is really sold, in the autumn.

### C.5 Regional sales managers

Up to 4, hired in Team › Sales for one market each (data/markets.ts): three candidates (junior / mid / senior: skill 0.6 / 0.75 / 0.9, salary $4,500 / $6,000 / $8,100 a month, `salaries`), join in 14 days, severance one month. Each: leads ≈ 1.5 × skill a month in their market (at our level, 10 % stretch), presence +0.15 a day there, +2 pitches a season, +3 worked leads. Fired: candidates again after 30 days.

### C.6 Tenders and fairs matter more

A fair attended yields 1–3 pipeline leads (skill) and +15 visibility; tender rounds issue +1 RFP at level ≥ 2 and +2 at level ≥ 3; a tender won is +40 visibility and +4 broker relation when it came through one.

### C.7 State and API

```ts
export type BrokerId = 'acs' | 'chapman' | 'acc' | 'airPartner' | 'huntPalmer';
export interface BrokerRel { relation: number; since: Minute; deals: number; lastLead?: Minute; lastDeal?: Minute }
export type LeadStage = 'lead' | 'proposal' | 'negotiation' | 'signed' | 'cold' | 'lost';
export interface Lead { id: string; clientId: string; source: 'broker' | 'pitch' | 'fair' | 'staff' | 'visit' | 'tender'; brokerId?: BrokerId; repId?: string; archetype: Archetype; market: string /* MarketId */; stage: LeadStage; created: Minute; moved: Minute; expires: Minute; value: number; offerId?: string; contractId?: string; why?: string }
export interface Pitch { id: string; clientId: string; season: string; at: Minute; replyAt: Minute; result?: 'maybe' | 'offer' | 'no'; leadId?: string }
export interface SalesRep { id: string; name: string; market: string /* MarketId */; skill: number; salary: number; hired: Minute; joins: Minute; leads: number }
// CommercialState: brokers?: Partial<Record<BrokerId, BrokerRel>>; leads?: Lead[]; pitches?: Pitch[]; reps?: SalesRep[]; repCandidates?: Record<string, HeadCandidate[]>; repFiredAt?: Minute
// (market ids are strings in core/types.ts so it never imports data/markets.ts; cast to MarketId where read.)
// ContractOffer.leadId?: string; ContractOffer.brokerId?: BrokerId; Contract.brokerId?: BrokerId
```
API (commercial/sales.ts): `BROKERS_016`, `brokerView`, `registerBroker`, `leadsView`, `workLead`, `dropLead`, `pitchAirline`, `pitchWindow`, `repCandidates`, `hireSalesRep`, `fireSalesRep`, `salesBill(g, k)`, `dailySales`, `monthlySales`, `loadSales`, `commissionOf(brokerId)`.

UI: Contracts gets a **Sales** tab (brokers with relation bars and Register / Visit; the pipeline as a short list with Send proposal / Drop; pitches with the season window and the replies due); Team gets **Sales managers** rows. Bot: `scripts/bot/sales.ts botSales(g)` registers with two brokers in month 2, works every lead, pitches 2 airlines a season, hires one sales manager for the home market when cash > $3M.

### C.8 As built (lane `sales`)

- `commercial/sales.ts` gets its builders through `setSalesHooks` from `commercial/index.ts` (generateOffer, issueTender, roundAt, the issuers' list): accept.ts and problems/index.ts import sales.ts, so sales.ts imports neither offers.ts nor tenders.ts.
- A lead is priced by a quiet draft of the job (built and dropped at once on a borrowed stream; the stretch slot and the client's last title are given back); the real offer is built when the proposal is answered yes (first refusal, no rival, 5 days at least, `leadId` + `brokerId`). A pitch answered "maybe" is a proposal-stage lead; "yes" is a negotiation-stage lead with its season-base offer 60–120 days before the season.
- Brokers favour where we are known (`presenceWeight`) and clients who know us; in tender season an airline that tenders gets us invited instead (the tender carries `brokerId`, +4 relation on a win). A broker visit ($1,500, +5 relation, monthly) sits beside Register. Deals are credited once from the contract (`Contract.brokerDone`): +6 flown ≥ 90 % on time, +2 flown worse, −10 cancelled; −1 a month idle, floor 10.
- Fair and visit leads go into the pipeline (`TripLead.kind 'lead'`); a fair also earns the prestige ladder's +15 visibility, a tender won +40 (prestige.ts addVisibility).
- Ordinary offers that name a broker (data/naming.ts BROKERS) carry its `brokerId` too, so the broker table's rate replaces the flat 5 %. The commission is still netted off revenue (no separate `commission` statement line yet: finance.ts billing would have to un-net it — open for the merge).
- `Contracts.tsx` whitelists the `sales` / `filter` views (step 0 left them unreachable); `screenLogic.ts refTarget` routes `lead` / `broker` to Contracts › Sales and `rep` / `compliance` to Team.
- F as built: `ops/compliance.ts` (candidates via `commercial/people.ts rollPeople`, hire / fire / bill / factors), one-line hunks in `ramp.ts` (mean × `complianceFactor`, `noteRampSaved`) and `audit.ts` (paperwork roll × `complianceAuditFactor`, Level 2 +30 days, task cost × 0.8, the ramp task "The CMM adds line-station checks" at half the cost). Bot: `--cmm` hires the mid candidate on day 1 (`scripts/bot/sales.ts botCompliance`).

**What's new (sales lane):**
- "About half the work now comes to you; the rest you chase. Contracts › Sales: register with the real brokers (Air Charter Service, Chapman Freeborn, ACC Aviation, Air Partner, Hunt & Palmer), work a leads pipeline (lead → proposal → offer → signed; a lead goes cold after 14 days), pitch airlines before the season, and hire regional sales managers in Team. Fairs bring leads into the pipeline; tenders come more often as you climb."
- "A Compliance Monitoring Manager is a real hire in Team › Nominated posts: fewer ramp and audit findings, longer deadlines, cheaper fixes."


---

## D. Offer filter (lane `ops`)

- Contracts › **Filter**: client kinds off (holiday brochures / tour operators, low-cost, sports, music…), client level (min), minimum rate per block hour (ACMI) and / or minimum profit (charter, the quick feasibility best margin), aircraft families (only these), markets (only these). One switch "Filter on".
- Realistically it is what you tell your sales team and the brokers: it applies when an offer is created (`finalize` → `offerHidden(g, o)`): a hidden offer gets `hidden: true`, **no cue, no message, no toast, no pause**; it still exists (the Market tab shows one row "N offers hidden by your filter · show") and expires as usual. Changing the filter re-evaluates open offers (hidden ↔ shown, without a chime). An urgent evacuation or repatriation always rings (humanitarian). Tenders, leads we worked and repeat business from our clients are never hidden.

### D.3 State and API

```ts
export interface OfferFilter { on: boolean; kindsOff: ClientKind[]; minPrestige?: Prestige; minRatePerBH?: number; minProfit?: number; families?: RatingFamily[]; markets?: string[] /* MarketId */ }
// GameState.filter?: OfferFilter   (absent = no filter)   ContractOffer.hidden?: true   Stats.v016.hidden?: number
```
API (contracts/filter.ts): `offerFilter(g)`, `setOfferFilter(g, patch)`, `offerHidden(g, o)` (pure), `hiddenOffers(g)`, `refilterOffers(g)`, `loadFilter(g)`.

---

## F. Compliance Monitoring Manager (lane `ops`)

- A nominated post under ORO.GEN.200(a)(6) (the compliance monitoring function), hired in Team › **Nominated posts** from the start (it needs no unlock: every AOC has one; until now you covered it yourself). Three candidates (skill 0.6 / 0.75 / 0.9; salary $6,400 / $8,500 / $11,900 a month, `salaries`; joins in 14 days; severance one month; new candidates 30 days after a dismissal).
- Effects while employed: ramp finding mean × (1 − 0.4 × skill) (−24 % to −36 %); the audit's random "found during the document review" finding at 0.5 × (1 − 0.6 × skill); Level 2 deadlines +30 days; corrective actions cost × 0.8. The ramp audit finding keeps its corrective action "Hire a compliance officer for the line stations" when there is no CMM; with one it reads "The CMM adds line-station checks" at half the cost. No CMM = today's game.

### F.3 State and API

```ts
export interface ComplianceState { hired: { name: string; skill: number; salary: number; since: Minute; joins: Minute } | null; candidates?: HeadCandidate[]; firedAt?: Minute; stats: { rampSaved: number } }
// GameState.compliance?: ComplianceState   load: ??= { hired: null, stats: { rampSaved: 0 } }
```
API (ops/compliance.ts): `complianceState`, `complianceCandidates`, `hireComplianceManager`, `fireComplianceManager`, `complianceBill(g, k)`, `complianceFactor(g)` (ramp multiplier, 1 without), `complianceView`, `loadCompliance`, `monthlyCompliance`.

---

## G. Fuel wording (step 0, done)

Every offer card and the offer dialog say who pays the fuel: ACMI / wet "Client pays fuel"; full charter "Fuel ours, in the price · fuel clause" (with `fuelEscalation`) or "Fuel ours, in the price" (without), "Fuel at cost: the client pays the burn" for jumbo loads; dry lease "Lessee pays fuel". The engine rule (ops/flights.ts paysFuel) is unchanged.

---

## 5. Lane file ownership

| Lane | Owns (edits freely) | Adds | Never touches |
|---|---|---|---|
| `finance` | `src/engine/finance/**`, `src/engine/problems/money.ts`, `src/ui/screens/Finance.tsx`, `src/ui/screens/finance/**`, `src/ui/modals/offer/DepositPicker.tsx`, `src/ui/modals/FinanceModals.tsx`, `src/engine/ops/finance.ts` (forecast items, bill), `src/engine/ops/sale.ts` (loan block, sell-and-repay), `src/engine/contracts/counter.ts` + `accept.ts` (deposit lever only), `scripts/bot/finance.ts`, `BAL.v016.finance`, Fleet card buttons via `src/ui/screens/fleet/FinanceButtons.tsx` | tests `src/engine/finance/*.test.ts` | offers.ts, naming.ts, commercial/**, Contracts.tsx, Team.tsx |
| `clients` | `src/engine/contracts/prestige.ts`, `relations.ts` (texts), `src/data/naming.ts`, `src/data/clientLiveries.ts`, `src/data/airports.ts` (additions), `src/engine/contracts/clients.ts`, `src/engine/contracts/missions.ts` (far routes), `src/engine/contracts/flavor.ts` + `src/data/flavor.ts` (titles for the new clients), `src/data/clientVoice.ts`, `src/ui/screens/Clients.tsx`, `src/ui/screens/company/PrestigeCard.tsx`, `src/ui/screens/Ladder.tsx`, `BAL.v016.prestige` | tests `prestige.test.ts`, `farRoutes.test.ts`, `clients016.test.ts` | offers.ts (step 0 hooks only), finance/**, commercial/** |
| `sales` | `src/engine/commercial/**` (sales.ts, trips.ts, tenders.ts, index.ts, types.ts additions), `src/engine/contracts/offers.ts` (pacing, broker / lead options, `brokerCut`), `src/engine/ops/director.ts`, `src/ui/screens/contracts/SalesView.tsx`, `src/ui/screens/team/SalesStaff.tsx`, `src/ui/screens/Tenders.tsx`, `src/ui/screens/Markets.tsx`, `scripts/bot/sales.ts`, `BAL.v016.sales`, `BAL.marketOffers.perWeek`, `BAL.quietFloor` | tests `sales.test.ts`, `leads.test.ts` | finance/**, prestige.ts, naming.ts, filter.ts, compliance.ts |
| `ops` | `src/engine/contracts/filter.ts`, `src/engine/ops/compliance.ts`, `src/engine/ops/ramp.ts`, `src/engine/ops/audit.ts`, `src/data/opsData.ts`, `src/ui/screens/contracts/FilterView.tsx`, `src/ui/screens/team/NominatedPosts.tsx`, `src/ui/screens/Contracts.tsx` (hidden row, tabs), `src/ui/screens/Team.tsx`, `src/ui/screens/Safety.tsx`, `src/ui/store.ts` (filter actions), `BAL.v016.filter`, `BAL.v016.compliance` | tests `filter.test.ts`, `compliance.test.ts` | offers.ts beyond the `offerHidden` hook, finance/**, commercial/** |

Shared files nobody edits beyond its own marked block: `core/types.ts` (a lane may ADD optional fields inside its own `// v0.16 <lane>` block), `core/balance.ts` (`BAL.v016.<lane>` only), `core/ledger.ts` (step 0 only), `data/whatsNew.ts` (NOT edited by lanes: each lane writes its What's new lines at the end of its section in this file under "What's new"; the merge step assembles the v0.16 entry), `scripts/acmi-bot.ts` (step 0 only: lanes edit `scripts/bot/<lane>.ts`), `src/engine/problems/index.ts` (step 0 wires the new kinds to the lane modules' card functions). Every new cue goes through the existing ones (`notice`, `decision`, `offerNew`, `ladder`, `cashNegative`): no `SOUND_OF` edits.

---

## 6. Acceptance checks (every lane, then the merge)

1. `npx tsc --noEmit` clean; `npx vitest run` green (new tests per lane; `core/plumbing.test.ts` lists the new pure reads).
2. Determinism: `bot <seed> --det` passes; a save written and reloaded plays on identically (`saveContinue.test.ts`).
3. Bots: `bot 1|2|3 120 --wide --inv` and `bot 1 365 --inv` finish with 0 invariant errors; cash at day 365 ≥ the v0.15.1 run − $500K (the chasing makes up for the halved inbound); seed 1 `--wide --aug` solvent.
4. Saves: `invariants save /home/user/work/saves/s0329.json 60` (and s0228, s1118, s1027): 0 errors; each loads with every client at a level, the player's level ≥ 2 for s0329 (it has flown for level-3 clients) and never lower on a second load.
5. Finance: a drawn line pays interest and the commitment fee at month end (statement lines); a covenant breach shows the card and the waiver fee; a loan's annuity sums to principal + interest within $1; a sale-and-leaseback leaves the aircraft in the fleet as a lease with rent from the next month and the gain on `assetSale`; a factored invoice pays 95 % now and the balance on collection; the money-market line appears when cash > $250K.
6. Prestige: a new game is level 1; a bot year flying brochure work reaches level 2 in months 4–8 and not level 3 in year 1; stretch offers ≤ 1 per 30 days and labelled; level-3 offers carry IOSA in requirements.
7. Sales: with inbound halved, a bot that registers with two brokers and works its leads signs at least as many contracts a year as the v0.15.1 bot − 25 %; leads go cold at 14 days with the card first; pitches answer in 14–42 days.
8. Filter: with tour operators off, no tourOperator offer chimes or messages; the Market tab counts them; turning the filter off shows them with no chime.
9. Compliance: 50 bot years with and without a CMM: ramp findings per inspection −24…−36 %; the salary appears in `salaries`.
10. UI (Playwright, iPad 1180×820 and iPhone 852×393): Finance › Financing, Contracts › Sales / Filter, Team › Sales managers / Nominated posts, the offer dialog's Deposit row and fuel line, the Prestige card; 0 console errors; no horizontal overflow.
11. Wording: every new card has the four lines; every chime has its message; UTC with local time where a time is shown.

## 7. What's new (assembled at the merge from each lane's lines)

- Finance: "Finance has a bank now: a credit line with covenants, loans on your own aircraft, sale and leaseback with the big lessors, invoice factoring and interest on spare cash. Ask a deposit on a charter and see what it does to the client's answer."
- Clients: "Every client has a level, from brochure work to the majors and governments. Your airline climbs by flying for them: visibility, a clean record and IOSA open the next level. Offers come at your level (Contracts shows it), with one stretch offer a month that shows what is coming. National carriers and the majors ask for IOSA registration before a first job; they pay more and penalise harder. The Prestige card on Company › Overview says what the next level still needs."
- New clients and far routes (lane `clients`, E): "170 more real clients: Air France, KLM, British Airways, Iberia, SWISS, Turkish Airlines, French bee, Air Caraïbes, Corsair, Aircalin, Air Tahiti Nui, Air Austral, Caribbean Airlines, the low-cost and leisure airlines, TUI, DER Touristik, Coral and Anex, defence and foreign ministries from Paris to Canberra, UNICEF, the ICRC and MSF, the big clubs and federations, the promoters and companies — each with its level and its colours. Far routes: overseas rotations with a stop and a crew change on the way (Paris–Singapore–Nouméa, the South Atlantic airbridge via Ascension, the Antilles, Réunion, Curaçao and Bonaire, the Pacific, Papeete via Los Angeles), paid a quarter more. The Caribbean, Tahiti, Mayotte, Wallis, Port Moresby and Turin on the map."
- Sales: "About half the work now comes to you; the rest you chase: brokers, pre-season pitches, a leads pipeline and regional sales managers."
- Filter: "Contracts › Filter: tell your sales team and the brokers what not to bring you: client kinds, a minimum client level, a minimum rate per block hour or profit, only some aircraft families or markets. Hidden offers don't chime or write to you; they wait under one row on the Market tab until they lapse. Humanitarian work, won tenders, worked leads and repeat business always come through."
- Compliance: "A Compliance Monitoring Manager is a real hire in Team: fewer ramp and audit findings."
- Fuel: "Every offer says who pays the fuel."
