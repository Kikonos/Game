# BLOCK HOURS: fix plan for Round F (bug hunt), 4 lanes

Base: `7043b0f` plus **Round B** (crew ride our own revenue flights) plus **Round E** (`/home/user/wt/roundE`, `c5c8c10`: Port Sudan stranding, `permitOf`, `openAirports`, `clientMoved` re-basing, `moveForClient`, `strandedAsk`, `feedersOf`, refit pricing). Both are merged into the integration branch first. Step 0 runs on top of that, and then the four lanes fork from it.

This plan was written against 7043b0f and the Round E diff, so line numbers will move. Locate code by function name and check it after the merges, because Round B changes `crew/roster.ts`, `crew/timeline.ts`, `crew/control.ts` and `ops/flights.ts`, and Round E changes `ops/world.ts`, `ops/events.ts`, `ops/flights.ts`, `contracts/schedule.ts`, `crew/control.ts`, `ops/heads.ts` and `ops/cabin.ts`.

---

## 0. Conventions for every fix agent

**Paths used in repros**
```
SP=/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad
HM=$SP/hunt/move   HC=$SP/hunt/crew   HCO=$SP/hunt/comm   HMO=$SP/hunt/money   HE=$SP/hunt/events   HU=$SP/hunt/ui
S1027=$SP/s1027/save.json   S1118=$SP/s1118/save.json
```
- **The repro scripts import a hunt worktree at a fixed path.** They use either `/home/user/wt/hunt-<area>/src/engine/...` or `const W = '/home/user/wt/hunt-move/src/engine'`, so as written they run the old 7043b0f code. To run one against your lane, copy it to `$SP/fix/<lane>/` and rewrite the path: `sed 's#/home/user/wt/hunt-[a-z]*/#/home/user/wt/<your-worktree>/#g' in.ts > $SP/fix/<lane>/in.ts`. Run it from your worktree root. First reproduce on the integration base, then fix, then re-run.
- Comm proofs live in `/home/user/wt/hunt-comm/scripts/comm-proof-*.ts`. Copy them the same way. Bot runs use `npx tsx scripts/acmi-bot.ts <seed> <days> [--wide] [--aug] [--inv] [--msgs]` in the worktree.
- **ID collisions are renamed here.** The hunt areas reused `S-n`, so this plan uses:
  - MOVE-S1 (settleOverlaps), MOVE-S3 (maintenance-node swallow), MOVE-S4 (unclear dry-lease ferry)
  - CREW-S1 (VIP penalty preview)
  - COMM-S1 (unclear series cancel), COMM-S2 (sub-charter broker), COMM-S5 (offers not withdrawn), COMM-S6 (unclear statementTotals)
  - EV-S01 to EV-S06 (the events area's S-01 to S-06)
  - UI-S1 (forecast without variable costs), UI-S7 (time zones)
  - MONEY ids are kept: S-EARLY, S-INSURANCE, S-APREMIUM, S-FORGIVE, S-DEPREC.
- **Rules for every lane:**
  - New state goes in optional fields only, and `SAVE_VERSION` stays as it is. Step 0 adds all such fields.
  - Engine code stays deterministic: any new randomness uses a side stream (`side(g, …)`), never the main stream.
  - Every item lands with a unit test.
  - The lane is green on `tsc`, `vitest` and bot seeds 2, 6 and 9 for 120 days, plus `--inv` on seed 4 `--wide --aug`.
  - **Edit only files your lane owns.** A change needed in another lane's file is a "partner sub-item", listed in and done by that file's owner.
  - Do not write report `.md` files into the repo.

---

## 1. Deduplication (same root cause = one item)

| Merged item | Sources | Shared root |
|---|---|---|
| A1 | EV-04, MOVE-4 | relinkPositioning plans empty legs off a leg that is diverting or has an onward card pending; the hard copies are then swallowed by the gap builder and planned again |
| A2 | MOVE-1, EV-S03 | `resolveOnward` cont() runs a capped `delayChain` with inbound = `lastFlown` (the diverted leg), so the return leg is cancelled and then flown empty |
| A3 | CREW-1, EV-08 | the "Same crew" chip is judged from FDP only; `afterDiversion` fits() fails on another pairing's trail |
| A6 | MOVE-6, MOVE-S3 | the gap builder swallows legs behind an unplanned maintenance node; `recover()` stops at a location break |
| A7 / B12 / C13 / partner B | MOVE-3, EV-05, EV-06, EV-S04 (+ the curfew landing in EV-S02, the 00:45 LHR departure in MOVE-S1) | no planner reads `CURFEWS`. One root, split by file owner, with a shared helper from Step 0 |
| A12 | MOVE-7, EV-13 (diversion-text part) | inspection cause read from a stale `delayReason`; city() used for airport names; plural slips |
| S0-3 (+ partners) | EV-01, MONEY-3, CREW-S1 | `lateLeg` posts the penalty before the `ours` test; previews do not share the VIP/not-ours rule |
| C3 | CREW-7, UI-2 | runFix 'delay' returns cost 0, so the flight's own tickets and buy-back pay show as "tickets for other trips" and the chip reads "free" |
| B3 | MONEY-1, COMM-5 (earnedUnbilled sibling) | `earnedUnbilled` keeps its own copy of the MGH sum |
| B6 | MONEY-6, UI-1, UI-8, UI-S1, MONEY-1 (cashForecast sibling) | cashForecast: refit/return costs counted twice, heads left out, joiners treated differently, variable costs left out, wet revenue ignores terms |
| B7 | S-EARLY, MONEY-4 | the slipped-return branch of `dailyLeases` |
| B9 | COMM-7, COMM-S5 | no closure check on offers, either at creation or when a closure starts |
| B15 | MONEY-7, S-INSURANCE | `shareOfMonth`/`fixedCosts` are not pro-rated |
| B16 | MONEY-8, COMM-S6 (was "unclear", now settled by MONEY-8's repro) | `statementTotals` classifies by sign |

## 2. Covered by Rounds B and E

**No item is fully covered.** These sub-parts are dropped because Round E fixes them. Re-verify each after the merge.

- **EV-01, client-move half, and the MONEY-3 repro (BLU1087, Corendon "+3h late group").** Round E's `moveForClient`/`clientMoved` re-bases `schedStd`, so `delayOf` no longer counts the client's own minutes. `clientFeeFor` now calls `clientMoved`, which covers the BLU978–981 penalties in the `scen-pen.ts fee` repro.
  - Still open: the penalty posted for "Waiting:", ATC and Weather reasons (S0-3), and knock-on reason overwrites (S0-3 `excused`).
- **EV-10, penalty side, and EV-11, stacked penalties.** Covered by the re-basing. The scope bug (EV-10) and the repeated ask (EV-11) stay open.
- **COMM-2, Port Sudan instance (o1tuh on CS-TTL at PZU).** Gone, because PZU is now an `openAirports` entry. The ash-closure repro is not affected by Round E and stays open.
- **COMM-1, client-moved legs.** Correct once COMM-1 switches to `delayOf`, because of the re-basing. This removes the 7043b0f-only "subtract the client's minutes" step from the COMM-1 plan.
- **COMM-3 and MONEY-1, Corendon k1lhc instance.** This is known item (2) (the stranding itself, handled by E). The completion-credit root (COMM-3) and the earned-figure root (MONEY-1) stay open.
- **EV-S02.** Re-check against Round E's `permitOf`, which now also exempts the empty leg out after event work. The fix stays open (D5).
- **Round B.** Nothing is dropped.
  - EV-S01 should let crew on an event-permit contract ride its own flights. Round B provides the riding; C9 must not block those rides.
  - CREW-2, CREW-3 and CREW-4 must count Round B "rides" (crew aboard our own revenue flights) the same way as deadhead tickets wherever `crewIx(g).tickets` / `aboard(f, c.id)` is used.

---

## 3. Step 0: shared scaffolding (serial, before the lanes fork)

One agent, on the integration branch after B and E. Target is about 2–3 h. Step 0 must be green before the lanes fork. Every change here is either behaviour-neutral or a small cross-lane fix that cannot be split.

**S0-1 `src/engine/core/types.ts`: optional fields only.**
- `Flight.excused?: number`: minutes of lateness that are not ours (world waits, CTOT 'client'). Kept separate from `lateOk`, because `lateOk` also holds our own waits.
- `Flight.div.what?: string`: the technical cause text.
- `Flight.div.settled?: boolean`: no onward pending.
- `ContractOffer.counter.cabin?: boolean` and `ContractOffer.counter.crewExtra?: CrewExtra`.
- Pairing slot `buyBack?: { cost: number; month: string; days: number[]; repay: number[] }`: a pending buy-back.
- `CrewMember.payFrom?: Minute`.
- `Aircraft.returning.wasEnd?: Minute`.
- Contract use month `lostFmMin?: number`.

**S0-2 new pure module `src/engine/core/curfew.ts`.**
- Move `inCurfew(code, t, delayed)` and `curfewEnd(code, t)` here from `ops/disrupt.ts`. Re-export them from `disrupt.ts`, and update `src/ui/map/weather.ts` to the new import.
- Add `curfewOk(code, t)`: true when `!inCurfew(code, t, false)`. It is a strict check that applies to both departures and arrivals.
- Add `curfewShift(code, t, dir: 'before'|'after')`: the nearest minute outside the strict curfew.
- `schedule.ts`/`plan.ts` must never import `ops/disrupt`.
- Test: HAM 05:30 local is not ok, HAM 06:00 is ok; FRA 04:15 local is not ok; LHR 04:50 UTC in winter is not ok.

**S0-3 late policy (fixes EV-01 and MONEY-3, gives the base for CREW-S1).** New file `src/engine/ops/latePolicy.ts`, owned by Lane A after the fork:
- Move `delayOf` here and re-export it from `flights.ts`. Move `NOT_OURS` here and export it.
- `isOurDelay(f) = !NOT_OURS.test(f.delayReason ?? '')`.
- `excusedLate(f) = Math.max(0, delayOf(f) - (f.excused ?? 0))`.
- `onTimeLeg(f) = delayOf(f) <= 15`.
- `latePenalty(c, f, lateMin = excusedLate(f)): { money: number; relation: number; ours: boolean }`, with the VIP rule (over 30 min, ×3, relation −3) and the charter rule (over 180 min, `perDelay`). The money is **0 when `!ours`**.

Then rewire `flights.ts lateLeg()` to use it. Today the code does `if (pen) post(...)` before `if (!ours) return`. The new order: compute `late = excusedLate(f)`; return early under the threshold; return when `!ours` (no money, no relation); keep the forgiveness branch as it is (see S-FORGIVE); then post the money and bump the relation.
- Test (flights.test): a charter leg 400 min late with reason "Waiting: X" costs 0. "ATC" and "Weather" cost 0. "Late ground handling" at 200 min costs `perDelay`. A VIP leg 60 min late costs 3×`perDelay` with relation −3. A leg with `excused` 1440 plus 60 min "Late inbound aircraft" costs 0.
- Repro: `$HMO/late.ts` on S1118 (BLU1087, −$2,500). After Round E this case is client-moved, so use `$HE/scen-pen.ts $S1118 puj` / `$HE/scen-puj.ts $S1118 …`, where BLU1117/BLU1118 each cost −6000 for "Waiting: Hurricane…".

**S0-4 extract a pure `legCostEstimate(g, f, ac): { maint, reserves, fuel, fees }` in `flights.ts`** from the arrival cost block ("// Costs." in `onFlightArr`), and use it there. No behaviour change. It is the input for B6/UI-S1.

**S0-5 MONEY-5, fuel at cost (atomic two-sided fix; medium).** Root: `flights.ts` invoices "Fuel re-billed" with `deferred: true`, which means "no accrue now". `billing.ts onFlightArrivedContracts` only accrues the charter price share, so the fuel never reaches the statement. `accept.ts charterPaid()`/`settleCharter()` sum every open receivable of the contract and void the newest first.
- Fix: drop `deferred: true` on the fuel re-bill, and filter `charterPaid`/`settleCharter` (and the cancel refund text) to `r.cat === 'charterRevenue'`.
- Test: a fuelAtCost charter leg arrives and `otherRevenue` rises by the re-bill amount. Completing the contract with an excess leaves the fuel receivable open and unchanged, and the refund equals the charter excess.
- Repro: the hunter's journal `jbotB9365wideaugb744.json` (seed 9 `--wide --aug --b744`) has six deferred re-bills (AWL200 $28,799 … ≈ $107.8K) with no accrue. Regenerate it with the bot.

**S0-6 closure-to-offers hook.** In `world.ts`, add `setClosureOfferHook(fn: (g, e) => void)` and call it in `startEvent` after the closure applies, and wherever a closure is extended (`onWorldEnd` re-extension). In `offers.ts`, add a no-op `export function sweepOffersForClosure(g, e) {}` and register it. Lane B fills in the body (B9).

**Step 0 acceptance:** tsc, vitest, bot seed 2 for 60 days. Commit as "Round F step 0: shared helpers and types".

---

## 4. Lanes and file ownership

| Lane | Theme | Owns (exclusive) |
|---|---|---|
| **A: Ops chain** | diversions, recovery, positioning relink, curfew planners, perf | `ops/flights.ts`, `ops/latePolicy.ts`, `ops/disrupt.ts`, `contracts/schedule.ts`, `contracts/plan.ts`, `crew/duties.ts`, `core/perf.ts`, `core/curfew.ts`, `ops/delivery.ts`, `ops/ramp.ts`, `data/opsData.ts`, `ui/map/weather.ts` and their tests (`flights.test`, `schedule.test`, `relinkLoop.test`, `diversionDuty.test`, `range.test`, `delivery.test`, new `disrupt.test`) |
| **B: Contracts and money** | offers, pricing, billing, completion, cash forecast, leases, fixed costs, maintenance price, statements | `contracts/*` except `plan.ts` and `schedule.ts`; `scenario/*`; `ops/subcharter.ts`, `ops/finance.ts`, `ops/leaseReturn.ts`, `ops/market.ts`, `ops/sale.ts`, `ops/dryLease.ts`, `ops/maintenance.ts`, `ops/maintMove.ts`, `ops/heads.ts`; `core/ledger.ts`; `problems/money.ts`; `ui/screens/screenLogic.ts`, `ui/screens/Finance.tsx`, `ui/shell/cashRate.ts`, `ui/modals/OfferModal.tsx`, `ui/modals/PopModals.tsx`, `ui/modals/CheckModal.tsx` |
| **C: Crew** | roster, tickets, crew control, buy-back, payroll | `crew/*` except `duties.ts`; `engine/dev.ts`; `problems/crew.ts`; `ui/modals/CrewControlModal.tsx` |
| **D: World, decisions, UI** | world events, client change requests, pacing, strip and map, inbox, dates, time zones | `ops/world.ts`, `data/worldEvents.ts`, `data/worldZones.ts`, `ops/events.ts`, `core/messages.ts`, `core/pause.ts`, `core/time.ts`, `data/timezones.ts`, `ops/strip.ts`, `ops/tripMove.ts`, `ops/cabin.ts`, `problems/*` except money/crew, all `ui/**` and `styles/**` not owned above |

`core/types.ts` is closed after Step 0. If a lane needs a new field, it asks the coordinator and the field goes in as an append-only one-line commit.

**Merge order:** A, then C, then B, then D. After each merge run vitest and the bot. At the end: bot seeds 2/3/6/9 for 365 days (one `--wide`, and seed 4 `--wide --aug --inv`), both player saves played 50 days with default answers, and the detectors re-run (section 6).

---

## 5. Lanes and items

### LANE A: Ops chain

Implementation order differs from severity order because of dependencies: **A5, then A1, then A2, then A3**, then the rest by severity. A2 cannot be fixed without A1 and A5, as MOVE-1's own fix experiment showed.

#### A1. Relink plans empty legs off a diverting leg, or one whose onward card is pending, and copies them on every relink
- **IDs:** EV-04, MOVE-4. **Severity:** high.
- **Root cause:**
  - `disrupt.ts divertNow()` sets `f.to = alt` and calls touchFlights while the onward decision is still open. On the next settle, `schedule.ts relinkPositioning()` reads `plan.ts anchorsOf()`: the leg ends at `alt` and the next hard leg leaves `to0`. Relink fills that gap at once with an empty alt to to0 positioning (BLU1670 AMS–AYT 08:28 while BLU1083's passengers wait). `resolveOnward`'s cont() then queues the passenger continuation behind that empty leg.
  - Once the created leg is within `SOFT_AFTER` (60 min) it is hard, so it becomes a flight anchor. Sorted by std it can fall after the next leg (TP2083), and the gap builder swallows it: `if (b.std < cur.sta) { if (b.sta > cur.sta) cur = b; continue; }`. The gap then has `legs = []`, chainBackward fails, and the `chainForward` fallback plans an identical new leg. This repeats every relink (AWL374–377 in one minute, each with its own CREW SHORTAGE).
  - The safety net only compares against removed legs. The same mechanism produced AWL140 RIX–VAR inside the RIX inspection (A2).
- **Files:** `contracts/plan.ts`, `contracts/schedule.ts`, `ops/disrupt.ts`.
- **Fix plan:**
  1. `anchorsOf`: while `f.div && !f.contOf && !f.div.settled`, the leg is bridged. Give its anchor `to: f.div.to0`, with a virtual continuation up to the card's `flyAt + block` (fall back to the eta). Or make `relinkPositioning` return `[]` for that aircraft while an onward is pending.
  2. Set `f.div.settled = true` in `resolveOnward` 'bus' and 'subcharter', and in `onDivertedArrival`'s curfew early return (`f.ops === 'curfew'`). Relink then plans the empty reposition once, after the decision.
  3. Gap builder: do not swallow a hard positioning anchor `b` whose `from` equals the chain's current location. Treat scheduled, not-departed positioning legs leaving the gap's X as pending members of that gap, hard or soft, so the same-route branch of `add()` retimes them instead of creating a copy.
  4. In `add()`: skip planning a leg when an identical scheduled positioning already exists (same from/to, same contract, std within ±turn).
  5. In cont(): before `addFlight`, remove soft positioning legs alt to to0 and soft legs leaving `alt`.
  6. Old saves with a pending card keep today's behaviour (the field is absent).
- **Tests:**
  - (a) A medical diversion to AMS on an AMS–AYT leg, advanced to on-blocks: no positioning leaves AMS. 'flyOn' makes the continuation leave at the card's flyAt ±5 min with the same duty. 'bus' then plans exactly one empty AMS–AYT.
  - (b) An aircraft enroute LIS to LHR (div from LGW, eta T), next leg LGW–LIS at T+20. Relink, advance past SOFT_AFTER, relink 3 more times: at most one LHR–LGW positioning, and none while `f.div` is enroute.
- **Repro:**
  - `npx tsx $HE/trace-cont.ts $S1118 medical alt:AMS hotel BLU1083` and `npx tsx $HE/scen-div.ts $S1118 medical 30 BLU1083` (19 Nov 07:30 'ADD1 BLU1670 positioning AMS-AYT 08:28'; flyOn leaves 12:48 with CREW OUT OF HOURS and −2500 twice; hotel leaves 20 Nov 04:48 against a promised 19:48).
  - `cd $HM && N=6 npx tsx watch.mts s2_d291.json 20 CS-TPJ 1` (output `$HM/verify/m4.txt`: 15:38 AWL374–377 all LHR-LGW 16:36; 15:56 AWL378 LGW–LHR out-and-back).

#### A2. A technical diversion back to the departure airport cancels the rotation's return leg ($15K), the aircraft then flies that sector empty (billed to the client), and the next base legs are sub-chartered
- **IDs:** MOVE-1, EV-S03. **Severity:** high.
- **Root cause:**
  - `disrupt.ts resolveOnward` cont() ripples the next leg with `delayChain(g, next, x.sta + turnOf(ac), 'Technical: diversion', cause === 'technical')`. With own=true, `delayChain0` calls `recover(g, ac, legs, f.from, std, lastFlown(g, ac))`. `lastFlown` is the diverted leg (to = alt), not the continuation x, so the `cont` exemption (`inbound.to === x.from`) is false. The 6 h base cap (`overCap(...) > 0`) then cancels BT4063 VAR–RIX / DE3021 ALC–HAM, even though x takes the aircraft there anyway.
  - Sibling causes: AWL140 RIX–VAR is planned mid-diversion inside the inspection (A1), and `settleOverlaps` pushes by time only (A5). Contract k9y has `positioningBillable: true`, so airBaltic is billed for AWL141/142/143/145.
  - Passing x as `recover()`'s inbound alone does not fix it: recover then stops at the hard AWL140 (`x.from !== loc → break`).
- **Files:** `ops/disrupt.ts`, `ops/flights.ts`, `contracts/schedule.ts`.
- **Fix plan:**
  1. In cont(), replace the delayChain with a recovery seeded from the continuation: `applyHold(g, planRecovery(g, ac, to0, x.sta + turnOf(ac), f.schedStd ?? f.std, x), why, why, 'Recovery: '+why); settleOverlaps(g, ac);`. Keep markTech for technical diversions. planRecovery passes x as the inbound, so the return leg is kept (late, never dropped) and only later units are capped.
  2. Call `relinkPositioning(g, ac.id)` before that recovery, and in `onDivertedArrival` before `lineMx`. A1 already stops relink from planning off an enroute `f.div` leg.
  3. Requires A5.
  4. Positioning created by recovery after our own technical fault must not be billed on a `positioningBillable` wet lease: book it with `contractId: null`, or with a non-billable flag checked in schedule.ts tagging.
  5. Label the technical 'Hotels tonight, fly in the morning' option by its real time ("Off 23:05 UTC" is not morning).
- **Test (disrupt.test):** a base aircraft at RIX with RIX–VAR (diverted back to RIX, technical, 12 h inspection), VAR–RIX, RIX–BUD, BUD–RIX. Resolve divertOnward 'hotel'. Assert:
  - VAR–RIX is still scheduled and departs at or after the continuation's sta + turn;
  - no VAR–RIX or RIX–VAR positioning exists;
  - there is no 'penalties' ledger entry;
  - every leg departs from the previous leg's arrival.
  - Second case: a HAM base wave with the out leg diverted to CDG; the return ALC–HAM is retimed, with no empty ALC–HAM.
- **Repro:**
  - `cd $HM && npx tsx watch.mts s9_d40.json 40 CS-TWD 5` (output `$HM/verify/m1.txt`: 12:09 '1 leg cancelled: BT4063 … $15K'; BT4080 moved to 03:44; AWL141/142/143 VAR–RIX; 'BT4080 sub-chartered … GetJet ($18K)').
  - `npx tsx $HE/scen-div.ts $S1027 technical 5 DE3020` (DE3021 cancelled −15000; BLU1577 ALC–HAM empty, landing 05:36 local inside the HAM ban).

#### A3. "Fly on today: Same crew, within their day" (the default) leaves the onward leg uncrewed, with a red CREW SHORTAGE, and the crew's next trip fails
- **IDs:** CREW-1, EV-08. **Severity:** high.
- **Root cause:**
  - `crew/duties.ts afterDiversion()`: `if (x && fits([...head, x.id, ...tail])) …; else if (!(x && fits([...head, x.id]))) { if (x) x.dutyId = null; fits(head); }`. fits() runs `crewTrailOkHook`, which evaluates `mergeSegs(segsOf(g, c, p.id), own)`. That merge includes the same crew's next pairing (pcrz/ducry DBB424 BHX–FRA, built for the aircraft at the alternate), and it fails with 'At DUB, not BHX', an overlap, and 'At FRA, not DUB', even though duay3 itself is legal (FDP 352/780).
  - EV-08 variant: rest before the next day's report is 10:10, under 12:00.
  - cont() never re-links the stale positioning that leaves the alternate before afterDiversion runs.
  - The chip in `onDivertedArrival` is `sameCrew = fdpLeft !== null && fdpLeft >= ground + block + 30` (FDP only).
  - The fallback fits(head) also fails ('Rest … 10:25 < 12:00') but is accepted silently.
- **Files:** `ops/disrupt.ts`, `crew/duties.ts`. It calls `relinkPositioning` (A) and `rerosterFrom` (an existing crew export; no edit in C).
- **Fix plan:**
  1. In `resolveOnward` 'flyOn' and 'hotel': after cont(at), `relinkPositioning(g, ac.id)` **before** `afterDiversion`, so the crew's next trip starts where the aircraft now is, or is re-planned.
  2. `afterDiversion` fits(): judge only this pairing. Ignore 'location', 'overlap' and 'rest' issues whose dutyId belongs to another pairing on the same aircraft, and queue that pairing with `rerosterFrom`, as onFlightsChanged does. When the duty is legal and only a later duty's rest fails, keep x in this duty and re-roster or delay the later duty.
  3. Export a pure `continuationFits(g, f, blockStart, block)` from duties.ts (syncDuty plus the trail hook on a clone). Use it for the chip and for the default option, so "Same crew, within their day" is only promised when it holds.
- **Test:**
  - Fixture: a crewed duty LIS–LDE (diverted to BHX); the aircraft has a later positioning BHX–FRA and a trip FRA–BOJ–FRA crewed by the same crew's next pairing. Call onDivertedArrival, then resolve flyOn. Expect `onward.dutyId === diverted.dutyId`, a full crew, no crewAlert, and the next trip leaving DUB or re-crewed with no illegal issue. The chip text matches the result.
  - EV-08 variant: next report 11 h after release; the chip no longer says "Same crew", or the later duty is moved.
- **Repro:**
  - `cd /home/user/wt/hunt-crew && npx tsx $HC/divert.ts $HC/seed6-0714a.json` (DBB393 BHX–DUB crew 0, 'CREW SHORTAGE: DBB393 in 3 h'). Issue trace: `npx tsx $HC/verify/v1.ts $HC/seed6-0714a.json`. Consequences: `npx tsx $HC/verify/v1b.ts …`.
  - `npx tsx $HE/onward6b.ts $HE/bot6w.d5feb.json` (TP2103 OPO).

#### A4. "Fly one cabin crew short" applies the reduced-crew rules to the first leg only; the return flies one short with a full load
- **ID:** EV-07. **Severity:** high.
- **Root cause:** `disrupt.ts resolveSickAway` 'minCrew' sets `s.above = true` on the pairing slot, which leaves it empty for every later leg, while `reducedCabin = 1`, the cap of 50 passengers per cabin crew and the offload are set on `f` alone. LH2081 KGS–FRA then flies with 3 cabin crew and full passengers.
- **Files:** `ops/disrupt.ts`, `ops/flights.ts` (onFlightDep/onFlightArr), `crew/duties.ts` if needed.
- **Fix plan:** Option A (preferred, real practice: ORO.CC.205(c), the reduction covers the sector in hand). Store `s.aboveUntil = f.id` and clear `s.above` when f lands, in onFlightArr. The slot is empty again for the next leg, and crew control or the sick-away card handles it. Fix the option text to cite ORO.CC.205(c), not ORO.CC.100.
- **Test:** `devDisruption('sickAway')` on leg 1 of a two-leg pairing, choose minCrew: leg 2's slot is open again and crew control raises or fills it. Invariants: no 'crew-min' error.
- **Repro:** `npx tsx scripts/acmi-bot.ts 4 200 --wide --aug --inv --msgs` (2 Sep 23:50 LH2080 minCrew; 'ERROR crew-min 3 Sep 10:31 LH2081 KGS–FRA flew with 3 cabin crew').

#### A5. settleOverlaps pushes legs by time only, ignoring location
- **ID:** MOVE-S1. **Severity:** medium (a prerequisite for A2).
- **Root cause:** `flights.ts settleOverlaps`: `const ready = prev.sta + turn; if (f.std >= ready) continue; moveFlight(g, f, ready, 'Late inbound aircraft');` with no `prev.to === f.from` check. It chains a continuation behind phantom copies: TP2082 LHR–LGW 18:51 → 21:12 → 18 Dec 00:45, an LHR curfew departure re-crewed on a day off. It stacks identical copies end to end, and it pushes BT4080 RIX–BUD behind a VAR landing.
- **Files:** `ops/flights.ts`.
- **Fix plan:** at a location break (`prev.to !== f.from`), either require room for the positioning relink will insert (`ready = prev.sta + turn + routeBlock(type, prev.to, f.from) + turn`), or stop and leave the break to relink and recover (preferred together with A6). Never push a scheduled positioning that duplicates `prev` (same from/to); leave it for relink to remove.
- **Test:** legs A RIX–VAR 00:39–03:04 and B RIX–BUD 02:20. After settle, B's std is at least `A.sta + turn + block(VAR–RIX) + turn`, or B is untouched. With two identical LHR–LGW positionings and a revenue LHR–LGW, the revenue leg is not pushed behind both.
- **Repro:** add an env-guarded log in settleOverlaps when `prev.to !== f.from`, then `VSO=1 npx tsx scripts/acmi-bot.ts 9 365 --wide` and `2 365 --wide`. Earlier logs: `$HM/verify/b9.txt` and `b2.txt`, decoded with `npx tsx $HM/verify/vso.mjs b9.txt b2.txt`: 12 hits on seed 9, 20 on seed 2, 0 on seed 6 and the saves. Player impact: `$HM/verify/m4.txt` 15:56–16:36.

#### A6. An AOG card promises "4 legs cancelled · −$60K", the resolution cancels nothing, and the trip stays crewed until it is cancelled at the gate. Also: an unplanned maintenance node makes relink swallow legs and plan an empty duplicate
- **IDs:** MOVE-6, MOVE-S3. **Severity:** medium.
- **Root cause:**
  - Gap builder `if (b.std < cur.sta) { if (b.sta > cur.sta) cur = b; continue; }`. A line or AOG maintenance node inserted in front of legs that have not yet been rippled swallows them, so the gap runs from the maintenance airport to the first anchor after the node. It drops the soft AMS–LIS link (MOVE-6) or plans CTA–DUS AWL238 in parallel with EW6101 (MOVE-S3).
  - At resolution, `recover()` stops at the location break (`if (x.from !== loc || (x.std >= ready && !x.delay)) break;`), so cancels = []. The card used an older snapshot (`planHold` at AOG start).
- **Files:** `contracts/schedule.ts`, `ops/flights.ts`. Partner D: the resolveAog message (D15).
- **Fix plan:**
  1. `recover()`: at a location break at a non-soft leg x, do not stop. Assume a positioning: `ready += routeBlock(ac.typeId, loc, x.from) + turn; loc = x.from`, then apply the unit cap as usual, so legs the aircraft cannot reach are cancelled at decision time.
  2. Gap builder: when `cur.kind === 'maint'`, `b.kind === 'flight'` and `b.from === cur.at`, b follows the node. Advance cur to b with an effective std of `max(b.std, cur.sta)`, so the location after the node is `b.to`. Keep the swallow only for truly parallel anchors.
- **Test:**
  - (a) An aircraft at CTA with CTA–DUS 08:20 and DUS–LGW 12:25, then line maintenance at CTA 07:43–11:43 inserted: relink creates nothing.
  - (b) AYT–AMS today, AMS–LIS positioning, a LIS trip tomorrow 08:00; AOG at AYT for 72 h, relink, resolve 'courier': the LIS trip is cancelled at resolution, and the count equals the card's chip.
- **Repro:**
  - `cd $HM/verify && npx tsx aogdec.mts ../s1027_d44.json` (card at 10 Dec 14:00 says '4 legs cancelled · −$60K'; BLU1113 stays scheduled with crew 6; cancelled at 11 Dec 08:00).
  - `cd $HM && N=8 npx tsx watch.mts verify/s9_d303.json 40 CS-TWD 2` (output `verify/m30dec.txt`, 30 Dec 07:44 AWL238).

#### A7. Curfews are ignored by every planner: positioning, base waves, diversion continuations, curfew-diversion repositioning (crewed without rest). Lane A part.
- **IDs:** MOVE-3, EV-05, EV-06 (planner parts). **Severity:** high (EV-05: crew without rest, then a sub-charter).
- **Root cause:**
  - Nothing in `contracts/` reads `CURFEWS`. `chainBackward`/`chainForward`/`gapMoves` plan "as late as possible" into a curfew.
  - `plan.ts computeWaves` (`if (next > 21*60) break;` limits only the wave departure) and `dayRotations` put HAM waves at 05:00 local daily.
  - `resolveOnward` cont()/flyAt and onDivertedArrival's morning are not curfew-checked. After `resolveCurfew` 'divert', relink plans CGN–DUS landing 05:20 local, crewed with 3 h rest.
  - `curfewCard` exempts planned curfew legs: `if (!forcing && (!inCurfew(f.to, eta, true) || inCurfew(f.to, planned, false))) return false;`, and inCurfew models landings only.
- **Files:** `contracts/plan.ts`, `contracts/schedule.ts`, `ops/disrupt.ts` (uses `core/curfew.ts` from S0-2).
- **Fix plan:**
  1. chainBackward: if a leg's std or sta falls inside a strict curfew, step it back so it lands before the curfew starts. chainForward/gapMoves: step forward to curfewEnd, or night-stop. When that misses the next anchor, plan the leg late and let normal recovery delay the next leg.
  2. computeWaves/dayRotations: no wave whose outbound lands in a destination curfew, or whose return lands at a curfew base; the first wave starts no earlier than curfewEnd(base).
  3. cont() and onDivertedArrival flyAt/morning: `max(flyAt, curfewEnd(alt) for departure, curfewEnd(to0) − block)`.
  4. resolveCurfew 'divert': the reposition leaves at `curfewEnd(to0) − block`, with crew rest respected; the divert chip says the first morning wave may be late.
  5. Keep curfewCard's 'planned' exemption only for legacy legs; new planning is clean.
- **Partner sub-items:** B12 (offers: oddWaves, roundTrip/series slots, feasibility warning, heads.ts ferryAircraft/positionPlans) and C13 (deadhead timetable).
- **Test:** `chainBackward('a320ceo','LIS','LHR', e, latest = 07:00 local)` lands at or after 06:00 local. `computeWaves('DUS', ['FAO'], 'a320', 3)` has no return between 23:00 and 06:00 local. dayRotations for a HAM base never departs before 06:00 local. A CGN to DUS reposition after a curfew diversion lands at or after 06:00 local. Detector property test: over 120 bot days on seeds 2/6/9, no positioning lands inside a strict curfew.
- **Repro:**
  - `cd $HM/verify && npx tsx curf.mts ../../../s1027/save.json` (16 arrivals and 7 departures inside curfews).
  - `npx tsx $HE/verify/look9.ts $HE/bot9.d24oct.json EW6023 AWL200` (AWL200 CGN–DUS 05:20 local, 'rest 3:00 < 10:00').
  - `$HM/verify/p1118.txt` (CS-TCS into DUS at 05:50 local weekly).
  - Events detector: `$HE/verify/vlib.ts` in bot runs, `$HE/verify/vdet.ts $S1118 50`.

#### A8. Partner sub-items for the S0-3 late policy, owned by Lane A
- **IDs:** EV-01 siblings, CREW-S1. **Severity:** medium.
- `flights.ts delayCues` (~:343, the 'over an hour late: delay penalty' cue): gate it on `latePenalty(c, f, projectedLate).money > 0` (threshold 180, VIP 30, ours only).
- `disrupt.ts:321` hurt preview: use `latePenalty`.
- Set `f.excused` (cumulative) alongside the existing lateOk writes in the `setClosedWaitHook` closure in `flights.ts`, and in `disrupt.ts resolveCtot` 'client'.
- **Test:** the cue is not raised for a 'Waiting:' reason or for a 90 min non-VIP delay.

#### A9. Partner: tag no new positioning to a finished contract
- **ID:** COMM-9 partner (owner B13). **Severity:** low.
- In `schedule.ts relinkPositioning`, `live()` treats a contract whose revenue legs are all done or cancelled as not live for tagging new positioning (`inId` selection).
- **Test:** positioning created after a contract's last revenue leg has `contractId` null, or the next live contract.

#### A10. Partner: closure check at the destination uses departure time, not ETA
- **ID:** EV-02 partner (owner D1). **Severity:** medium.
- In `flights.ts setClosedWaitHook` (Round E version, using permitOf), test the to-side at `f.std + f.block` (arrival), not `f.std`.
- **Test:** BLU1117 FRA–PUJ departing 07:30 with an ETA after the PUJ reopening is not held.

#### A11. A home-hop positioning chain landing after the next job's departure is kept as valid (CS-TQM shown in Lisbon while its Amsterdam flight leaves, for weeks)
- **ID:** MOVE-2. **Severity:** medium.
- **Root cause:** the late-leg rule in `relinkPositioning` (`if (prev && pg && pg !== gap && pg.b && prev.f.to === f.from && prev.f.to !== pg.b.from && f.std >= prev.f.sta && f.std < pg.b.sta + DAY) gap = pg;`) pulls BLU992 LIS–AMS (27 Nov 02:00) into gap1. Then `chainOk` checks only the route (`legs[last].to === Y`), never arrival against `b.std`, and `chainSane` accepts AMS–LIS–AMS as a hop home.
- **Files:** `contracts/schedule.ts`.
- **Fix plan:**
  - (a) Restrict the rule to a prev that is already late for pg.b: add `&& prev.f.sta + turn > pg.b.std`.
  - (b) Before keeping a gap's legs, also require `legs[last].sta <= latest`, unless no on-time chain exists (gapMoves for X===Y, else chainBackward, returns null). Otherwise replace them, so pending/same-route logic retimes BLU992 and keeps its crew where possible.
  - Keep the fixed point: a second relink is a no-op.
- **Test:** contract A trips AMS–RHO–AMS on day 0 and day 7, hops AMS–LIS on day 0 and LIS–AMS on day 7 at 02:00, then contract B AMS–AYT–AMS signed for day 6. Relink twice. Every consecutive pair has `a.to === b.from` and `b.std >= a.sta + turn`, and the second pass creates nothing.
- **Repro:** `cd $HM && npx tsx win.mts ../../s1027/save.json CS-TQM '20 Nov' '26 Nov' '27 Nov'`, `npx tsx tqm.mts ../../s1027/save.json CS-TQM` ('created []'). Replays: `$HM/verify/p1027.txt` and `p1118.txt`.

#### A12. Diversion texts: stale inspection cause, "Inspection after : done", London vs London, "1 later leg move", hotel label
- **IDs:** MOVE-7, EV-13 (disrupt.ts part). **Severity:** low.
- **Root cause:** `onDivertedArrival` uses ``lineMx(…, `Inspection after ${String(f.delayReason ?? 'a technical diversion').toLowerCase()}`)``. `delayReason` holds the last delay ('Airport congestion', 'Medical diversion', or '', which `??` does not catch). The TECH_CAUSES text `what` lives only in the decision data. `city()` gives 'London' for both LGW and LHR. The ctotCard chip reads `later leg${…} move`.
- **Files:** `ops/disrupt.ts`. Partner D: `world.ts resolveAirspace` plural and the zero case (D17).
- **Fix plan:**
  - Store `f.div.what` in divertNow (from resolveDiversion's `d.data.what`, and on the auto-timeout path).
  - Use `Inspection after ${(f.div.what ?? 'a technical diversion').toLowerCase()}`, and set `f.delayReason = what` for technical diversions.
  - Use `apName(code)`, or "city code" when the city is shared, in diversion titles, chips and bodies.
  - Use `plural()` in the ctot chip.
  - Label the 'hotel' option by its time.
- **Test:** delayReason 'Airport congestion' plus a technical diversion: the new maintenance cause contains the TECH text, not 'congestion'. A weather LGW to LHR card says Gatwick and Heathrow.
- **Repro:** `$HM/verify/m1.txt` ('Inspection after airport congestion'). `npx tsx $HE/scen-div.ts $S1027 technical 5 DE3020` ('Inspection after : done at CDG').

#### A13. CTOT "File a longer route" charges fuel for flying that is never simulated
- **ID:** EV-14. **Severity:** low.
- **Root cause:** `resolveCtot` 'reroute' posts fuel and runs delayChain, but `extraBlock` is never added to `f.sta`.
- **Fix plan:** after delayChain, `retimeFlight(g, f, f.std, f.sta + extraBlock)`, marked like `f.detour` so it is not added twice.
- **Test:** forced ctot card, 'reroute': `sta − std` grows by extraBlock, and the duty's fdp grows by the same.
- **Repro:** code; the hunter's bot logs show 'reroute' as the default for waits over 90 min.

#### A14. Bird strike "Wait for the morning shift" always means tomorrow 06:00 UTC
- **ID:** EV-12. **Severity:** low.
- **Fix plan:** in `rollBirdStrike`, use the next 06:00 local at `at` (localMinuteOfDay), which may be later today. Offer 'wait' only outside the day shift (about 20:00–06:00 local). Show local time plus UTC.
- **Test:** at LPA 11:55 UTC, no 'wait' option, or a ready time today. At 01:00 local, ready is about 07:30 local the same day.
- **Repro:** `npx tsx $HE/scen-bird.ts $S1118 -1` (BLU891, ready 19 Nov 07:30, 20 h).

#### A15. Isolated-aerodrome fuel reserve missing on nonstop sectors (SFJ/UAK/YFB/BDA)
- **ID:** MOVE-9. **Severity:** low.
- **Root cause:** `perf.ts planSector`'s nonstop branch has no ISOLATED deduction, while viaStopsAt and the etopsRoute search do. `maxSectorNm` takes `_to` but ignores it, so delivery.ts (114/141), missions.ts:290 and feasibility skip the reserve too.
- **Fix plan:** put the deduction inside `maxSectorNm`: `rangeFromNm(typeId, from) - (to && ISOLATED.has(to) ? typeOf(typeId).cruiseKt : 0)`. Remove the duplicate deductions in viaStopsAt and etopsRoute. Clear planCache in tests.
- **Test:** `planSector('a320ceo','FCO','SFJ')` (2,507 nm) and `('a320ceo','LIS','SFJ')` (2,189 nm) need a fuel stop; a non-isolated airport at the same distance stays nonstop.
- **Repro:** `cd $HM && npx tsx iso.mts > verify/iso.txt` (3,355 pairs).

#### A16. Virtual base anchor at generatedUntil (local midnight) splits a rotation and creates a phantom twin positioning
- **ID:** MOVE-8. **Severity:** low.
- **Root cause:** `plan.ts anchorsOf`: `std = Math.max(c.generatedUntil, firstDeparture(...) ?? p.from)`. generatedUntil is a local day boundary, but EW6045 returns 16 Dec 02:10, so AWL214 LIS–DUS, a twin of EW6045, is kept.
- **Fix plan:** `std = max(c.generatedUntil, lastGeneratedSta(c, ac) + turn, firstDeparture…)`. Check `dryAnchor` for the same pattern.
- **Test:** a base pattern whose evening wave returns after local midnight; extendContract up to day k; relink creates nothing; no positioning has the same from/to/std as a revenue leg.
- **Repro:** `cd $HM && npx tsx win.mts s9_d261.json CS-TWD '15 Dec'`, `npx tsx tqm.mts s9_d261.json CS-TWD`.

#### A17. Design decision (do only if the designer confirms): "Trusted clients forgive small delays" forgives only big ones
- **ID:** S-FORGIVE. **Severity:** low.
- **Root cause:** forgiveDelay is reached only for delays over 180 min, so a Trusted or Partner client forgives 10–24 h delays. docs/acmi/UPDATE-0.8.md:92 says 15 min – 3 h.
- **Fix plan:** decide a cap, for example 6 h. In `latePolicy`/`lateLeg`, forgive only delays at or under the cap; above it, always pay and take the relation hit. Partner B: the `relations.ts perkLines` text states the cap.
- **Test:** Partner client, 22 h late: penalty posted. 3.5 h: forgiven.
- **Repro:** code reading; BLU886 in late1027.

---

### LANE B: Contracts and money

#### B1. A counter-offer drops the cabin choice and the client-paid extra crew; the stepper shows a higher rate than it sends
- **ID:** COMM-4. **Severity:** high.
- **Root cause:**
  - `accept.ts counterOffer()` keeps only `{ price, at, replyAt, aircraftIds, left }` (+paint). `offers.ts onOfferReply` signs with `acceptOffer(…, { paint, priced: true })`, so `cabinOn` is true and signCrewExtra gets no crewExtra.
  - `counter.ts counterBase()` uses `askingPrice(o)` with the cabin, so a cabin-less counter looks cheaper than it is.
  - `OfferModal.tsx` stepper shows `steps[v-1] * lift`, while counter() sends `price` (lines ~552/569). `PopModals.tsx CounterReplyModal` accepts with `{ paint }` only.
- **Files:** `contracts/accept.ts`, `offers.ts`, `counter.ts`, `ui/modals/OfferModal.tsx`, `PopModals.tsx` (the type fields come from S0-1).
- **Fix plan:**
  - counterOffer computes `cabinOn` as acceptOffer does, passes `{paint, cabin: cabinOn, crewExtra}` to feasibility, and stores cabin and crewExtra on `o.counter`.
  - counterBase uses `askingPrice(termsProduct(o, { paint, cabin: o.counter?.cabin }))`.
  - onOfferReply and CounterReplyModal call `acceptOffer(…, { paint, cabin: k.cabin, crewExtra: k.crewExtra, priced: true })`. signCrewExtra then applies `×(1+pct)`, which matches the stepper's display.
  - Pass the cabin to replyTime/answerBy if a refit slot affects the deadline.
- **Test (counter.test):** counter with `{cabin:false}`, force accept: no cabin and no refit booked. Counter with crewExtra meeting `extraCabinPaid.n`: `extraPaid` true and rate = counter × (1+pct). counterOdds uses the cabin-less asking price.
- **Repro:** `/home/user/wt/hunt-comm/scripts/comm-proof-counter.ts`. Case A: seed 11 o5t, refit booked on CS-TWN. Case B: seed 9 Hamburg wet lease, stepper $4,023, signed $3,946, extraPaid undefined.

#### B2. Hajj terms ignored by the offer-dialog revenue, the cancellation penalty and the paint estValue
- **ID:** COMM-5. **Severity:** high.
- **Root cause:** `pricing.ts productValue(product, estBH, start, end, terms?)` honours terms only when they are passed. These callers leave them out:
  - `feasibility.ts` rep.estRevenue;
  - `accept.ts cancelPenalty()` (`productValue(p, 0, c.start, c.end)` before the start; `mghInMonth(p.mghPerMonth, g.now, c.end, k)` while active, which counts the gap between the phases);
  - `paintTerms.ts rollPaint` estValue.
- **Files:** `contracts/billing.ts`, `accept.ts`, `feasibility.ts`, `paintTerms.ts`. The earnedUnbilled part is in B3.
- **Fix plan:**
  - Add `mghRemaining(c, from)` in billing.ts: the sum over months of mghFor-style MGH restricted to `[max(from, a), min(b, end)]` for each term (or start–end).
  - Use it in cancelPenalty: before the start, × cancelScale × rate; while active, × rate.
  - Pass `o.terms` in feasibility and rollPaint.
- **Test:** Hajj terms [1–28 Apr] and [7 May–5 Jun]. At 135 days, cancelPenalty = rate × Σ mghFor × 0.15. On 30 Apr, only the MGH of 7 May–5 Jun counts. For a fresh Hajj offer with estBH ≤ MGH, feasibility estRevenue = offer.estValue.
- **Repro:** `/home/user/wt/hunt-comm/scripts/comm-proof-hajj.ts` on S1118. k1rvx: penalty $837,142 against $723,162; on 30 Apr $3,050,974 against $2,461,908. o5v: estValue $4,796,840 against feasibility $5,186,299.

#### B3. The wet-lease "earned" figure (Finance 'earned' and 'after month-end costs', the profit/day pill) ignores cancelled hours, the excess rate and Hajj terms
- **IDs:** MONEY-1, COMM-5 (earnedUnbilled). **Severity:** high.
- **Root cause:** `ui/screens/screenLogic.ts earnedUnbilled()` keeps its own MGH copy: `mghInMonth(p.mghPerMonth, c.start, end, k) * n; v = rate * Math.max(flown, mgh)`. The invoice (`billing.ts billContractMonth`) deducts lostMin (`max(min(flown, full), full − lost)`), bills excess hours at `excessRate`, and uses mghFor (terms).
- **Files:** `contracts/billing.ts`, `ui/screens/screenLogic.ts` (cashRate.ts and Finance.tsx only read the value).
- **Fix plan:**
  - Split out a pure `wetMonthLines(c, month, asOf?)`; billContractMonth becomes `wetMonthLines` + `billedMonths.push`.
  - Give mghFor an optional `upTo` that caps end and each term at asOf.
  - Clamp the lost deduction so it never goes below flown.
  - `earnedUnbilled = Σ wetMonthLines(c, k, g.now)`; delete the copy and the mghInMonth import.
- **Test:** wet contracts with (a) lostMin 155.8 h, (b) flown above MGH with excessRate 0.95, (c) Hajj terms, (d) a broker. At the last minute of the month, earnedUnbilled equals the sum of `billContractMonth(structuredClone(c))` lines.
- **Repro:** `$HMO/unbilled.ts` on S1118 at 30 Nov 23:00: k1lhc UI $1,294,829 against the invoice $247,358. On S1027: kzwo $979,390 against $974,760. Outputs: `$HMO/verify/unb1118.txt`, `unb1027a.txt`.

#### B4. Legs that ops retimed count as "on time": contract, wet-month relation, completion, crew recognition, scenario stars, ops strip
- **ID:** COMM-1. **Severity:** high.
- **Root cause:** moveFlight moves `f.std` (it keeps schedStd), so `(f.atd ?? f.std) - f.std <= 15` measures against the moved time. This happens in `billing.ts onFlightArrivedContracts` (legsOnTime, u.onTime), `scenario/index.ts scan()` (t.onTime/t.fOn) and `ops/strip.ts` opsStrip ("On time today").
- **Files:** `contracts/billing.ts`, `scenario/index.ts`. Partner D: `ops/strip.ts` (D9). Consumers: accept.ts completeContract, monthRelation, morale onContractDoneMorale (no change needed).
- **Fix plan:** use the S0-3 `onTimeLeg(f)` in billing (both counters) and scenario scan. Round E's re-basing keeps client moves on time. Optional: for the relation only, excuse `f.excused` minutes.
- **Test:** a leg moved +60 'Fuelling' and flown is not counted on time. A leg moved by the client (clientMoved) and flown on its new time is counted on time. Same for scenario and strip.
- **Repro:** `$HCO/verify/v1.ts` played on S1118 for 45 days: engine 170/174 on time, really 140. Seeds 2/3/6/9 over 365 days, e.g. seed 9 689 against 552. `hunt-bot.ts --scenario=hajjAirlift`: 36 miscounts.

#### B5. Feasibility calls positioning "ok" from an airport that is closed at departure; the job is signed and every leg is cancelled
- **ID:** COMM-2. **Severity:** high.
- **Root cause:** `feasibility()` checks closures only through `missionChecks.v08Lines` for the programme's own airports. posIn, posOut, homeBefore, homeAfter, paint/cabin ferries and the availability line are never checked: `add('positioning','ok', …)`.
- **Files:** `contracts/feasibility.ts`, `missionChecks.ts`. Reads `world.ts closedAirport`/`permitOf`/`closedUntil` (no edit).
- **Fix plan:** for every planned empty leg, call `closedAirport(g, l.from, l.std, permit)` and `closedAirport(g, l.to, l.sta, permit)`, with permit = `o.eventId` or the aircraft's own permit (Round E permitOf logic). If a leg is inside a closure, forward-plan from `closedUntil(e) + 3h` and reuse "Can't get there in time: earliest arrival …", or add `('positioning','no', "<reg> can't leave <city>: <event> until about <day>")`. acceptOffer's firstNo and the bot pick it up. Check tripMove/swap planners for the same pattern and report; tripMove.ts belongs to D.
- **Test:** an ash event closes the station for 6 days. An offer elsewhere departing in 1 day reports 'no', and acceptOffer refuses it. The same offer departing after the reopening reports ok.
- **Repro:** `npx tsx $HCO/verify/posclosed.ts $HCO/verify/ash-d5.json` (o1ci on CS-TGN 'ok Positioning MAN→AYT' inside the Katla closure), `posaccept.ts` (DRQ136 cancelled, completed with 0 flown).

#### B6. The cash forecast (90-day chart, '90-day low', "Cash is running out") is wrong both ways: refits and returns counted twice, heads, joiners and variable flying costs left out, wet revenue ignores terms
- **IDs:** MONEY-6, UI-1, UI-8, UI-S1, MONEY-1 (cashForecast sibling). **Severity:** high.
- **Root cause:** `finance.ts cashForecast()`:
  - adds `-m.cost` at `m.end` for planned and inWork maintenance of every kind. Refits are paid at start in maintenance.ts onMaintStart, and returns (plus earlyFee) in leaseReturn.ts onReturnStart, so inWork ones count twice and planned ones are dated wrongly.
  - Its monthly line uses `salaryBill` (crew only), while monthlyHeads posts heads' pay.
  - `problems/money.ts cashLowCard` counts joiners (`Object.values(g.crew)…c.salary`) and no heads.
  - The return deposit refund is missing.
  - The only per-flight term is the maintenance reserve (no fuel, fees, war risk, hotels or per diems): $777,922 too optimistic over 12 days in S1118.
  - Wet revenue is `rate * mghPerMonth * n * share` (no terms, lost hours, excess or broker).
  - **UI-1 and UI-S1 must ship together:** cash really went to −$157,951 on 1 Dec. Fixing only the double count would remove a true warning.
- **Files:** `ops/finance.ts`, `ops/heads.ts`, `problems/money.ts`, `ui/shell/cashRate.ts`. Reads `legCostEstimate` (S0-4), `mghFor`/`wetMonthLines` (B3) and `salaryBill`.
- **Fix plan:**
  - (a) Refit/return: planned ones at `m.start` (return: +earlyFee at start, +deposit at m.end); skip inWork. A, C and paint stay at m.end; AOG at m.end or excluded, consistently.
  - (b) An engine `monthEndBill(g, monthKey) = fixedCosts + salaryBill (+ crew joining before month end) + headsBill(g)`. `headsBill` is exported from heads.ts and used by monthlyHeads. Use monthEndBill in cashForecast, cashLowCard (why and details) and cashRate.monthEndCosts.
  - (c) Per scheduled flight we pay for (charter all-in, positioning/ferry always; wet: only what ACMI pays): add `legCostEstimate` (S0-4) at std/sta, plus war-risk where it applies, plus an allowance per away crew-night (hotel + per diem) from planned pairings. Keep it pure (no RNG). Fuel-at-cost re-bills are an inflow.
  - (d) Wet revenue: mghFor for future months, wetMonthLines for the open month.
  - (e) The cashLowCard WHY names the largest negative day-delta source instead of always "rent and salaries".
- **Test (finance.test):**
  - A refit inWork: the forecast at m.end+1 equals the one with m.cost = 0.
  - A planned refit 5 days out: the drop is on day 5.
  - A hired head is included in the month drop.
  - forecast month drop = monthEndBill = actual cash change at the month event.
  - Invariant script: on S1118 and seeds 2/6/9 over 30 days, the 7-day-ahead forecast error stays under 10 % of monthly costs, and the forecast is never positive across a real overdraft.
- **Repro:**
  - `npx tsx $HU/verify/v1.ts $S1118` (2 Dec −$795,445; card 'runs out on 2 Dec');
  - `npx tsx $HU/tsx/refit.mts $S1118` (real −$157,951 on 1 Dec; `$HU/verify/refit-s1118.txt`);
  - `npx tsx $HU/verify/fcgap.ts $S1118 12` (gap $777,922);
  - `npx tsx $HMO/refitfc.ts` on S1027 (CS-TCH $40,000 twice);
  - `npx tsx $HU/tsx/fc.ts $S1118` ($2.98M / $2.88M / $2.84M).

#### B7. An early return whose return check slips leaves the aircraft rent-free until the original lease end; a normal slipped return ends with a free hand-back, no costs and no decision
- **IDs:** S-EARLY (high), MONEY-4 (medium). **Severity:** high.
- **Root cause:**
  - `leaseReturn.ts returnEarly()` sets `own.leaseEnd = q.end` and books the return, but schedules no lease.end event at the new date, and the fee is only posted in onReturnStart.
  - When the check is missed (missCheck from maintenance.ts:561 or flights.ts:316 plan.dropChecks), `dailyLeases`' slipped branch deletes `ac.returning` and keeps `noticeGiven = true` and the early leaseEnd. `finance.ts shareOfMonth` then caps rent at that past date, so every later month has 0 rent.
  - At the old lease.end, `market.ts onLeaseEnd()` takes the free path (deposit refunded, aircraft deleted, no returnQuote, no leaseReturn post), against the message's promise "rolls on a month at +10%".
- **Files:** `ops/leaseReturn.ts`, `ops/market.ts`, `ops/finance.ts`.
- **Fix plan:**
  - Store `ac.returning.wasEnd`.
  - On a slip, or in unbook(): restore `own.leaseEnd = wasEnd`, drop the earlyFee, set `noticeGiven = false` so the extend/return decision comes again, and tell the player.
  - onLeaseEnd: a v0.7 lease (one with returnSite/returnQuote) with no booked return is never free-returned. Either roll on a month at +10% (re-schedule lease.end and post leaseEnd), or, if the aircraft is idle at the site, book the return now and let onReturnStart/End post the costs. Pre-v0.7 leases keep the plain path.
  - Defence: shareOfMonth/fixedCosts treat a dryLeaseIn aircraft still in the fleet after leaseEnd as holdover (full month, +10%).
  - Make the message text match.
- **Test:**
  - returnEarly(now+45d), missCheck, advance past end + 1 month: leaseEnd is back to the original, full rent, no fee.
  - A normal booked return with missCheck, advanced past lease.end: either still in the fleet at rent ×1.1 with a leaseEnd decision open, or returned with `leaseReturn = −returnQuote.total`. noticeGiven was reset.
- **Repro:** `npx tsx $HMO/verify/early.ts` (output `verify/early.txt`: CS-TWQ in the fleet 30 May with $0 rent) and `npx tsx $HMO/slip.ts` (CS-TWQ redelivered 15 Apr with $0 leaseReturn).

#### B8. A contract with cancelled legs, even with 0 flown, completes as a success (+6/+10 relation, job counted, reputation, repeat roll)
- **ID:** COMM-3. **Severity:** medium.
- **Root cause:** `accept.ts completeContract()`: `onTime = flown ? legsOnTime / flown : 1` ignores cancellations. R.done, noteJobDone, contractsDone, rep.reliable, hajjDone/homeSafe and rollRepeat run unconditionally.
- **Files:** `contracts/accept.ts`. Partner C: `crew/morale.ts onContractDoneMorale` denominator (C14).
- **Fix plan:**
  - Count flown, sub-chartered, cancelled-by-us (recovery, AOG, no crew) and cancelled by force majeure or the client (`'Cancelled: …'`, `'<client> cancelled'`, 'Court injunction').
  - `onTime = legsOnTime / (flown + cancelledByUs)`.
  - With `flown + sub === 0`: no relation bump, noteJobDone, contractsDone, reliable/clean, hajjDone/homeSafe or rollRepeat; the message says "closed without flying". R.doneAog only when something flew.
- **Test:** an evacuation with all legs cancelled by us, then contract.end: only the per-leg hits apply; jobs, contractsDone and homeSafe are unchanged; no rollRepeat. A series with 12 flown and 2 cancelled by us scores 12/14.
- **Repro:** `$HCO/verify/v1.ts` COMPLETE-CX lines (seed 2 13 Aug 'Evacuation Goma–Kigali' 0 flown +6; seed 9 'Cup tie in Geneva'; seed 3 'Crew change Manila–Limassol'; S1118 k1lhc).

#### B9. Offers made into airports already closed, and open offers never withdrawn or adopted when a closure starts
- **IDs:** COMM-7, COMM-S5. **Severity:** medium.
- **Root cause:** `missions.ts evacuation()` picks staging pairs with no closedAirport check. `offers.ts finalize` never checks closures. Nothing scans open offers on event start or extension (closeOffer is only called from expiry, counter, rivals and accept/decline).
- **Files:** `contracts/offers.ts`, `missions.ts`, `rivals.ts` (the S0-6 hook provides the call site).
- **Fix plan:**
  - finalize (all archetypes): drop a draft when any leg airport has `closedAirport(g, code, leg.dep, d.eventId)` live. For evacuation, repatriation and humanitarian, adopt the closure instead (`d.eventId = e.id`, push into `e.offerIds`).
  - evacuation() filters `pairs`.
  - `sweepOffersForClosure(g, e)`: for open or countered offers whose legs touch the closure during it and whose eventId is not e: adopt mission types into the zone, otherwise `closeOffer(g, o, 'expired')` with an Inbox note "withdrawn: X closed". Rivals skip such offers.
- **Test:** start an event closing OUA, generate 50 evacuation offers: none goes into OUA without `eventId === e.id`. Create an evacuation offer to ADE, then start the Red Sea closure: it is adopted or closed the same minute.
- **Repro:** `hunt-bot` hajjAirlift seed 2704 (o20o Ouagadougou, 12 Apr 12:00); `$HCO/verify/hb-3.txt` (`hunt-bot.ts 3 365`, oa5a 'Evacuation Aden–Dubai' 11 Aug).

#### B10. Repeat business after one-off rescue work: tour operators "ask again" for war-zone repatriations
- **ID:** COMM-8. **Severity:** medium.
- **Root cause:** `missions.ts rollRepeat()` excludes several archetypes but not repatriation or medical. `offers.ts repatriation()` uses `o.client` with a random crisis.
- **Fix plan:** return null for 'repatriation', 'medical', and any contract with `c.eventId` or made by a scenario. Defensive: repatriation() and evacuation() ignore `o.client` unless its kind is 'government'.
- **Test:** a scenario 'Stranded in Lanzarote' for Jet2holidays with repeatHit forced: rollRepeat returns null and no message is posted.
- **Repro:** `hunt-bot.ts 1 --scenario=ashCloud --msgs` (`$HCO/verify/hb-ash.err`: Jet2 'Repatriation from Bissau', Sunweb 'Kabul assisted departures').

#### B11. Offer titles name the wrong month
- **ID:** UI-3. **Severity:** medium.
- **Root cause:** `flavor.ts monthOf`/`seasonOf` use `new Date(startUtc*60_000)` without EPOCH_MS: wrong from March 2028 ("April" for 31 Mar 2028; "December", "christmas" for 30 Nov 2028). `offers.ts titleFor` reads a local-midnight start in UTC (CMN 1 Dec shows "November"). Same in the L1289 dedupe suffix.
- **Files:** `contracts/flavor.ts`, `offers.ts`.
- **Fix plan:** `monthOf(t, airport?) = MONTHS[toDate(airport ? toLocal(airport, t) : t).getUTCMonth()]`, and the same for seasonOf. Pass the base or from airport in titleFor and the dedupe suffix. Grep `src/engine` and `src/ui` for `new Date(… * 60_000)` without EPOCH_MS and fix the hits; a lint test enforces it.
- **Test:** `monthOf(minuteOf(2028,3,31,12)) === 'March'`; 30 Nov 2028 gives 'November' and the season is not christmas; a CMN title starting 1 Dec local says 'December'.
- **Repro:** `npx tsx $HU/verify/v3.ts`; `npx tsx $HU/verify/v3b.ts $S1027`.

#### B12. Partner: curfew-aware offers, feasibility warning and head ferries
- **IDs:** MOVE-3, EV-06, EV-05 sibling; owner A7. **Severity:** medium.
- `offers.ts oddWaves`: add the 23:00–23:45 late rotation only when both its arrivals are outside curfews (`core/curfew.ts`).
- `roundTrip` and series legs (DEP_SLOTS): retime a slot whose arrival or departure falls inside a strict curfew to the nearest legal slot.
- `feasibility.ts`: warn "no night slot at X" on any leg still inside a curfew.
- `heads.ts ferryAircraft`/`positionPlans`: shift arrivals out of curfews.
- **Test:** property test over 3 seeds' offers: no generated leg has std or sta inside a strict curfew. oddWaves at DUS/HAM/FRA never adds the late rotation inside a curfew.
- **Repro:** `$HE/verify/vdet.ts $S1118 50` (BLU1557 STR–DUS 23:55 local; BLU1496 BVC–ZRH 00:50 local).

#### B13. A contract stays active for days after its last revenue leg, held by crew deadheads (and late positioning)
- **ID:** COMM-9. **Severity:** low.
- **Root cause:** `accept.ts onContractEnd()` waits for every scheduled or enroute flight with the contractId, deadheads included (addDeadhead passes the pairing's contractId). Partner A9 handles positioning tagging.
- **Fix plan:** wait only for revenue and techstop legs, and for positioning/ferry legs that are the job's way out (std ≤ last revenue sta + 1 day). Ignore deadheads.
- **Test:** last revenue leg lands at T, with a crew deadhead at T+3 d: completes at T+5 min.
- **Repro:** `$HCO/verify/v1.ts` on S1118 (k14yy completes 113 h late), S1027 (k1dyr 33 h); seeds over 365 days: 48/39/44/56 late.

#### B14. Sub-charter dialog "Still billed to the client" ignores the broker's commission
- **ID:** COMM-S2. **Severity:** low.
- **Fix plan:** `ops/subcharter.ts legRevenue`: multiply both branches by `(1 - brokerCut(c))`.
- **Test:** on a brokered charter, revenue = price × 0.95 × leg share.
- **Repro:** `npx tsx $HCO/verify/sub.ts` on S1118 (k1ewk $213,000 against $202,350).

#### B15. Fixed costs not pro-rated: a sale charges the rest of the month's insurance and overhead, and leased-out insurance is all-or-nothing
- **IDs:** MONEY-7, S-INSURANCE. **Severity:** low.
- **Root cause:** `finance.ts shareOfMonth` cuts only dryLeaseIn at leaseEnd. `fixedCosts` skips `status === 'leasedOut'` at month end.
- **Fix plan:**
  - `shareOfMonth(…, leaveAt?)` and `settleDeparture(g, ac, leaveAt = g.now)`, with `to = min(b, leaveAt ?? …)` for every ownership kind. Callers: sale.ts, leaseReturn onReturnEnd, the index.ts lease.end wrapper.
  - Insurance pro-rated by the days the aircraft was ours in the month: subtract the overlap with `[leasedAt, back)` from the dry-lease contract.
- **Test:** a sale on day 22 of a 31-day month gives insurance ≈ 22/31. Leased out from day 3 gives 2/30; back on day 27 gives 4/30.
- **Repro:** `npx tsx $HMO/sell.ts` (CS-TIH: −$42,000 and −$60,000 in full).

#### B16. Finance statement: Revenue and Costs totals split by sign while the rows are split by category
- **IDs:** MONEY-8, COMM-S6. **Severity:** low.
- **Fix plan:** export `REVENUE_CATS` from `core/ledger.ts`. `statementTotals` sums by category, and screenLogic statementView uses the same list.
- **Test:** `statementTotals({assetSale: −1_040_000, insurance: −42_000, overhead: −60_000})` gives revenue −1,040,000, costs −102,000, profit −1,142,000.
- **Repro:** `npx tsx $HMO/sell.ts` (Asset sales row −$1,040,000 under revenue while the Revenue total shows $0).

#### B17. The +20 % outstation A-check premium applies only to auto-planned checks
- **ID:** S-APREMIUM. **Severity:** low.
- **Fix plan:** apply the premium inside `scheduleCheck` (or `checkCostOf(ac, kind, at)`) for an A check away from the home base. Remove the post-hoc line in `planA`. CheckModal's displayed cost uses the same function. maintMove re-booking keeps the premium.
- **Test:** a scheduleCheck A at an outstation costs ×1.2; moving an auto outstation check keeps it.
- **Repro:** code (maintenance.ts planA, CheckModal ACheckModal, maintMove.ts:176).

#### B18. Credit control and overdue notes: one line per invoice, and the slip rolled per invoice
- **ID:** EV-15. **Severity:** low.
- **Fix plan:** in the `heads.ts` credit chase and `finance.ts dailyFinance` overdue pass, group by client per day ("… reminded X: 6 invoices, $23K"), with one slip roll per client per day.
- **Test:** six overdue receivables of one client give one message and at most one relation hit.
- **Repro:** the hunter's bot-4 `--wide --aug` message log (`$HE/bot4_wide_aug.msgs`, 10 Feb six reminders).

#### B19. Partners and small text fixes in B files
- **IDs:** COMM-6, MONEY-10, UI-12(a)/(f), S-FORGIVE. **Severity:** low.
- (COMM-6 partner, owner D4) `billing.ts billContractMonth`: deduct `lostMin + lostFmMin`; the line reads "less X BH we cancelled" for lostMin and "less Y BH cancelled by force majeure (…)" for lostFmMin.
- (MONEY-10 partner, owner C12) `heads.ts monthlyHeads` and `headsBill` pro-rate by `hired.at`.
- (UI-12(a)) `flavor.ts groupBack` and the ad-hoc blurbs use `plural()`; back==1 reads "the next day".
- (UI-12(f)) `maintenance.ts checkUsedAt` returns calUsed and fhUsed; CheckModal prints "20 % of the calendar interval · 79 / 750 FH".
- (S-FORGIVE partner) `relations.ts perkLines` states the cap, if A17 is decided.
- **Tests:** billing wording test; a text-lint test (no `\b1 days\b`, no `\ba [aeiou]`, no '()').

---

### LANE C: Crew

#### C1. Crew left at outstations for 11–14 days because any future ticket from their airport blocks the trip home
- **ID:** CREW-2. **Severity:** high.
- **Root cause:** `roster.ts sendHome()`: `if (!force && tickets.some(f => f.status==='scheduled' && (f.from === c.loc || f.std <= g.now))) return;`. The out-ticket for a trip 10 days ahead is planned from `timeline.locAt` (where the crew member is now), so it is bought from the outstation, and that ticket then blocks the way home. `sendStrandedHome` calls this daily without force, so stayOn (STAY_MAX 30 h plus the hotel-against-tickets test) is bypassed.
- **Files:** `crew/roster.ts`, `timeline.ts`, `check.ts`.
- **Fix plan:**
  1. A ticket from c.loc blocks sending home only when it leaves within STAY_MAX of ready, or passes stayOn's test (`ceil(gap/DAY) * hotelPerNight < ticketPrice(loc, base) + ticketPrice(base, next.from)`). Otherwise drop that ticket (dropPlanned or retick) and send the crew member home, then `retick(g, pairing, c)` from base.
  2. planCrew/planOut: an out-ticket for a trip more than STAY_MAX ahead with no work in between is planned from `c.base`.
  3. As a result, days off and standby are no longer planned at an outstation. Count Round B rides like tickets.
- **Test:** released at GOM, next pairing at FRA in 12 days: a ticket GOM to LIS within about 24 h, and the out-ticket re-bought LIS to FRA. Next trip in 20 h from GOM: they stay. Scenario: S1027 played 20 days, no crew idle away for more than 4 days without a duty.
- **Repro:** `cd /home/user/wt/hunt-crew && npx tsx $HC/verify/v2.ts $S1027 20`; `npx tsx $HC/verify/v2b.ts $S1027 'Lucía Torres,Joana Mendes' 14` (Lucía at GOM 11.4 d; Joana at MAN 13.5 d).

#### C2. A leg held "Waiting for a rescue crew" keeps its own crew on duty at the gate for 2.5 days and leaves 48 h late, because the duty is never split for a hotel rest
- **ID:** CREW-8. **Severity:** high.
- **Root cause:** `duties.ts splitUnderWay` is called only from `roster.ts onFlightsChanged`, after `if (keep.length === d.flightIds.length && ev === d.flightsEv) continue;`. `syncDuty` (run by the guard and re-roster paths after each delayChain) has already absorbed the ev change, so the split never runs, although its own condition holds. The crew stay `onDuty` with a stale restUntil, and the FDP grows to 3610/660. The 6-hourly re-holds come from `flights.ts crewProblem`.
- **Files:** `crew/roster.ts`, `crew/index.ts` (hourly tick). duties.ts is Lane A's; call the exported splitUnderWay without editing it.
- **Fix plan:**
  1. `onFlightsChanged`: run splitUnderWay for duties under way (`d.report <= g.now`, not done) even when `ev === flightsEv`.
  2. Guard in the hourly crew tick: no one stays `onDuty` past `report + maxFdp + discretion + 60`; release them (log the duty to the last on-blocks and start rest).
  3. Optional, as a follow-up for Lane A after merge: in crewProblem's 'away' branch, retime to `min(rescue, own crew's rest end + report)` via crewReadyAt.
- **Test:** a 4-leg duty whose last leg, at an outstation, is pushed past FDP. After the first 6 h hold, the crew are 'resting' with `restUntil = landing + minRest(away)`, the leg is in its own duty with a fresh report, and no one is onDuty for more than maxFdp + 3 h. Seed check from `seed9-0324.json`: EI4023 leaves before 25 Mar 08:00.
- **Repro:** `npx tsx $HC/fl2.ts $HC/seed9-0324.json flw 'Louis Durand' 80 60`; `npx tsx $HC/verify/v8.ts $HC/seed9-0324.json`; `npx tsx $HC/verify/v8b.ts $HC/seed9-0324.json` (a direct split works at 25 Mar 06:00).

#### C3. Crew Control "Delay until crew arrives" shows "free" or the penalty only, while charging this flight's own tickets and day-off pay as "tickets for other trips"
- **IDs:** CREW-7, UI-2. **Severity:** high.
- **Root cause:** `control.ts runFix` 'delay' returns `cost: 0`. previewOf puts the whole ledger difference in `extra`, which run() words "+$X tickets for other trips". `CrewControlModal.tsx` Row shows `s.cost > 0 ? money : 'free'`. The ranking is correct (score adds extraCost); that sub-claim is refuted.
- **Files:** `crew/control.ts`, `ui/modals/CrewControlModal.tsx`.
- **Fix plan:**
  - In runFix 'delay', snapshot the ticket ids before. After tryDelay, `cost = Σ ticketsBought` for crew newly seated on this pairing, plus buy-back pay. Simplest: when seatChanges are non-empty and the cost is 0, `cost = ledgerDiff`, extra = 0.
  - In solutionsFor, the delay cost is perDelay (via `latePenalty`, see C10) plus that cost.
  - The chip shows `usd(cost + extraCost)` whenever the total is above 0; "free" only when both are 0.
  - Word the ripple by category: tickets, day-off pay, overtime.
  - The "Fly someone in" text says "nobody can get there for the scheduled time" when a later departure works.
- **Test:** the only delay solution needs a ticketed day-off captain: `cost + extraCost` = the ledger delta after `applyCrewFix(confirmed)`; the chip is not "free"; consequences mention day-off pay.
- **Repro:** `npx tsx $HC/cc1.ts $HC/seed6-0714.json DBB393` (extraCost 8095); `npx tsx $HU/verify/v2.ts $S1027 BLU1570` (cost 0, cash −9,780).

#### C4. Duplicate ticket home bought at release, which pushes the leave start back
- **ID:** CREW-3. **Severity:** medium.
- **Root cause:** `roster.ts leaveAway()` skips 'log' segments. The released duty's segment holds the merged ticket home, so it reports "no way home". `recheckAfterRelease` then forces `sendHome(g, c, p, true)`, which skips the "already holds a ticket" guard. leaveAfterTicket moves the leave to the phantom ticket.
- **Fix plan:** leaveAway returns false when a log segment ending after now has `at === c.base`, or when any scheduled deadhead or ride (`aboard(f, c.id) && f.to === c.base && f.sta <= b.from`) exists (crewIx tickets). `sendHome(force)` still skips buying when such a ticket exists; force bypasses only the trip-ahead guard. Apply the same in homeBeforeLeave and sendStrandedHome.
- **Test:** a duty ending HAM 10:55 with ticket HAM–LIS 12:00 merged, leave at 23:00: exactly one ticket, no cost at release, leave still 23:00. Detector v3.ts on S1027 and S1118 reports 0.
- **Repro:** `npx tsx $HC/verify/v3b.ts $S1027 'Mariana Marques' 14632493`; `npx tsx $HC/verify/v3.ts $S1027 50` and `$S1118 45` (`$HC/verify/v3-s1027.txt`, `v3-s1118.txt`: $250–$600 duplicates).

#### C5. After a trip is cancelled while its crew are on duty, they keep its ticket home from a station they never reached
- **ID:** CREW-4. **Severity:** medium.
- **Root cause:** `roster.ts detachDuty()`'s `!rest.length` branch keeps tickets loose. The pairing is deleted, so releaseCrew/dropTickets cannot reach them. f1zcj VRA–LIS remains with 10 crew aboard, all at LIS. There is no money harm (tickets are sunk); the harm is a false roster and timeline.
- **Fix plan:** keep a loose ticket only if it leaves where its crew are or will be (c.loc, or the last flown destination); otherwise unboard each crew member (an empty ticket is removed). releaseCrew also drops scheduled deadheads with `aboard(f, id) && f.from !== c.loc` and no ticketDuty entry before sendHome.
- **Test:** an active pairing on duty at AMS for AMS–VRA, with ticket VRA–LIS. Cancel the leg: no VRA–LIS ticket, and segsOf shows no 'pos from VRA'.
- **Repro:** `npx tsx $HC/tk.ts $HC/s1118-1222.json 30 f15kl f1zcj`; `npx tsx $HC/verify/v4b.ts $HC/s1118-1222.json 14713440`; `npx tsx $HC/segs.ts $HC/s1118-1222.json 14713440 co49`.

#### C6. The crew-shortage card says "In Goma: Lucía Torres is in Lisbon, not Goma", and a rested captain is refused because of a later trip's stale out-ticket
- **ID:** CREW-5. **Severity:** medium (do after C1, which removes this instance's trigger).
- **Root cause:** `reasons.ts rootReason()` takes the location issue's text, which belongs to the later duty du15aw, and presents it as where she is now (issue.dutyId ignored). `control.ts crewShortCard` puts "In Goma:" in front. `check.ts planCrew`/`acceptable` treat a later pairing's unflown out-ticket as a hard block, and retick is only tried for the pairing being planned.
- **Fix plan:** when the location issue's dutyId is not in the evaluated pairing, word it as a later trip ("her ticket to BLU1209 on 9 Nov leaves Goma"), with c.loc for "in X". Classify a location issue caused only by a later pairing's unflown deadhead as fixable (a re-ticket, cost `ticketPrice(newLoc, nextDep)`). After assigning, `retick(g, laterPairing, c)`. dutyCandidates and buyBackFor gain the candidate too.
- **Test:** crew at GOM with a later out-ticket GOM–DUS; a new pairing GOM–NDJ ending NDJ–LIS: accepted with a LIS–DUS re-ticket (cost counted); the reason never says "in Lisbon, not Goma" while loc is GOM.
- **Repro:** `npx tsx $HC/cands.ts $HC/s1027-1028.json BLU1574 CPT`; `npx tsx $HC/plan1.ts $HC/s1027-1028.json p1kv7 c8`.

#### C7. Cards and Crew Control for a leg that is not the trip's first departure judge replacements against the first airport and a past report
- **ID:** CREW-6. **Severity:** medium.
- **Root cause:** `rosterActions.ts dutyCandidates()` evaluates from `openDuties(g,p)[0]`'s first flight. `control.ts ctxOf` uses `dep: f.from`, the 'Report … at' line (~715) pairs `d.report` with `x.dep`, and reachFor uses the duty's first flight.
- **Fix plan:** evaluate the seat from its own duty or leg (use the flight's departure, and a fresh report for a mid-duty replacement, as freshReport does for heldOoh). Take x.dep, the Report line and reachFor from that one source. Never show a "must land by" in the past.
- **Test:** (A) a two-duty pairing NDJ–DUS / DUS–LIS with a free captain at DUS: she fits duty 2, or the reason is about DUS. (B) a held 2nd leg ZRH–LIS of a duty reported at BVC 9 h ago: reasons name ZRH with a future deadline.
- **Repro:** `npx tsx $HC/cands.ts $HC/s1027-1028.json BLU1576 CPT`; `npx tsx $HC/cands.ts $HC/s1118-1231.json BLU1500 CPT`.

#### C8. A day-off buy-back is paid, and the day off moved, when the plan is made, with no undo when the crew member is swapped off or the flight goes
- **ID:** MONEY-2. **Severity:** medium.
- **Root cause:** `roster.ts fillPairing → take()` calls `applyBuyBack` up to 72 h ahead. `buyBack.ts applyBuyBack` at once calls takeOffDays, sets `c.boughtOff` and posts salaries. There is no reversal anywhere. Seed 2: 30 of 58 buy-backs went unused ($16,059).
- **Files:** `crew/buyBack.ts`, `roster.ts`, `dayPlan.ts`, `control.ts` (swaps).
- **Fix plan:**
  - Store a pending `slot.buyBack`, and still move the day off.
  - When the duty is reported for, post the pay, set boughtOff and bump the stats.
  - `undoBuyBack(g, c, slot)` wherever a slot's crewId is cleared or replaced (re-roster, the pairing broken by cancelLegs/removeFlights, Crew Control swaps): restore the original day off, remove the repay day if still free, pay nothing, post a quiet note.
  - Scoring makes a pending buy-back slot sticky.
- **Test:** fill with a buy-back, then cancelLegs: salaries unchanged, the original day back, boughtOff empty. Refill with someone else: same. Report: paid once.
- **Repro:** `npx tsx $HMO/verify/bbv.ts $S1118` (Hugo Martin +$667 for BLU1674, removed the same minute); `bbvs2.txt`, `bbvs6.txt` and `bbvs9.txt` in `$HMO/verify`. Note the refuted example (seed 5 João Teixeira) and do not use it.

#### C9. Crew deadhead tickets fly into and out of airports a world event has closed
- **ID:** EV-S01. **Severity:** medium.
- **Root cause:** ticket choice (`timeline.ts outTicket`/`planOut`, roster/control addDeadhead callers) never calls closedAirport. closureHits skips deadheads, and the gate checks only cover our aircraft.
- **Files:** `crew/timeline.ts` (and roster.ts/control.ts callers). Partner D: applyClosure scans deadheads (D18).
- **Fix plan:** filter deadhead options with `closedAirport(g, from, std)` / `closedAirport(g, to, sta)`. Round B rides on our own event-permit flights stay allowed.
- **Test:** closure at X; the roster needs crew at X during it: no deadhead from or to X inside the closure is bought.
- **Repro:** `npx tsx $HE/verify/dhclosed.ts $S1027 4` (DH LIS–GOM 27 Oct 14:00 during 'Fighting near Goma'); seed 2 BRU strike (vlib.ts); S1118 DH PZU–LIS 16 Nov.

#### C10. Partner: late-policy consumers in crew control
- **IDs:** CREW-S1, EV-01 siblings; base S0-3. **Severity:** medium.
- `control.ts` crew-short card hurt (~586) and solutionsFor 'delay' (~1864) use `latePenalty(c, f, lateMin)` (VIP over 30 min ×3, not-ours = 0) instead of `late > 180 ? perDelay : 0`.
- **Test:** VIP charter, perDelay 3750: 60 min delay costs 11,250; 280 min costs 11,250; a non-VIP 'Weather' delay costs 0. After applying and departing, the ledger moves by the same amount.
- **Repro:** `npx tsx $HC/verify/s1.ts $HC/seed6-0714.json` (DBB393 with `standards = 'vip'` on a copy: chip $3.8K, real −11,250).

#### C11. The crew desk says the replaced crew member "comes off (out of hours)" whatever the reason
- **ID:** UI-10. **Severity:** low.
- **Fix plan:** `heldOoh` returns `{role, crewId, why}`; carry `why` through jetSeats/pickCrew so the text reads "(on leave)", "(sick)", "(not at GOM)" or "(out of hours)". Update outOfHours.test.
- **Test:** crew on leave in a slot, applyCrewFix deadhead: the text says 'comes off (on leave)'.
- **Repro:** `npx tsx $HU/tsx/msgs.mts $S1027 30 'Rita Vieira'`.

#### C12. Salaries are not pro-rated for joiners and leavers
- **ID:** MONEY-10. **Severity:** low.
- **Fix plan:** set `c.payFrom` when status leaves 'joining'. monthlySalaries pays salary × minutes on the payroll / month length. Before `delete g.crew[c.id]` (morale.ts leavers, dev.ts), post the leaver's part-month × (1 + onCosts). salaryBill projects the same. Partner B19: heads.
- **Test:** payFrom on the last day of a 30-day month: salary × 1/30 × 1.25. A leaver on day 15: half a month.
- **Repro:** `npx tsx $HMO/join.ts` (April has the full $11,750).

#### C13. Partner: deadhead timetable lands inside night curfews
- **ID:** EV-S04 (owner A7). **Severity:** low.
- In the timetable and ticket slot choice in `timeline.ts`, drop or shift slots whose arrival is inside the destination's strict curfew (`core/curfew.ts`).
- **Test:** a LIS to FRA search for an evening report never arrives 23:00–05:00 local.
- **Repro:** the events detector `$HE/verify/vlib.ts` (seed 9: 165 deadhead landings in curfews).

#### C14. Partners and small text fixes in C files
- **IDs:** COMM-3, UI-12(a). **Severity:** low.
- (COMM-3 partner, owner B8) `morale.ts onContractDoneMorale` uses `legsOnTime / (flown + cancelledByUs)`, and gives no recognition with 0 flown.
- (UI-12(a)) `problems/crew.ts` "leaves in 1 days" uses `plural()`.

---

### LANE D: World, decisions and UI

#### D1. Airport-closure events hold, and on "Cancel" cancel, legs long after the airport has reopened
- **ID:** EV-02. **Severity:** high.
- **Root cause:** `world.ts closureHits()` gives `closedBy` to any leg touching e.at up to `e.end + 1440`, with no comparison to closedUntil(e) (PUJ: airport closed 1 day, event lasts 9 days). `resolveAirspace` 'cancel' cancels every `closedBy === e.id` leg, while waitLegs moves only legs before `until`. closedAtDeparture tests the destination at departure time.
- **Files:** `ops/world.ts`. Partner A10 (closedWait hook).
- **Fix plan:**
  - With `until = closedUntil(e)`, hold a leg only when `(touch(from) && std < until) || (touch(to) && sta < until)`; this also replaces the loose window for zone closures.
  - 'cancel' filters `std < until + 3h`.
  - Clear closedBy on legs outside the window, so the label and the card's count are right.
  - closedAtDeparture and waitLegs test the to-side at arrival.
  - Build on Round E's permitOf and openDuring.
- **Test:** a 1-day airport closure inside a 9-day event with a weekly programme: only legs before closedUntil get closedBy; 'cancel' leaves next week's legs scheduled; a leg arriving after the reopening is not held.
- **Repro:** `npx tsx $HE/scen-puj.ts $S1118 <minute of 18 Dec 2027 12:00> hurricanePuj` (BLU1118–1120 cancelled after the reopening; check scen-puj.ts arg 3 for the start offset).

#### D2. Airport-closure news and "has reopened" use the event end, not the airport's reopening
- **ID:** EV-03. **Severity:** medium.
- **Root cause:** `startEvent` fills `{until}` with `g.now + days*DAY`, while airportClosedUntil is rolled separately and is shorter. onWorldEnd posts the reopen message only at e.end.
- **Fix plan:** fill the text after building the event, with `until = e.closed ? e.end : (e.airportClosedUntil ?? e.end)`, without moving the RNG rolls. For airport-only events, schedule a 'world.reopen' SimEvent at airportClosedUntil (it posts the message and clears closedBy); onWorldEnd skips the reopen message for those events. Old saves keep today's behaviour. Review the `{until}` templates (strikeBelgium, windMadeira, calimaCanaries, quakeAdana, hurricanePuj, quakeMorocco).
- **Test:** hurricanePuj with airportDays shorter than days: the body contains fmtDay(airportClosedUntil), and the reopen message is posted then.
- **Repro:** the same as D1; seed 2 `$HE/verify/bot2.d6.json` (Brussels 'closed until 8 Mar', reopened 6 Mar).

#### D3. An airspace-closure reroute lengthens the leg but does not move the next leg
- **ID:** MOVE-5. **Severity:** medium.
- **Root cause:** `world.ts applyClosure` calls `retimeFlight(g, f, f.std, f.sta + detour)`, which does no ripple and no settleOverlaps.
- **Fix plan:** collect the rerouted legs per aircraft. For the earliest one: `applyHold(g, planRecovery(g, ac, f.to, f.sta + turnOf(ac), f.std, f), 'Rerouted: <zone>', …)` then `settleOverlaps(g, ac)`. These are existing exports; no flights.ts edit is needed. Apply the detour at generation time to base waves created while the closure is active (run closureHits on new legs from the world side, or the daily pass).
- **Test:** a closure crossing RUH–GYD with detour 50; rotation RUH–GYD 03:00–05:40 and GYD–RUH 06:20. After applyClosure, `GYD–RUH.std >= sta + turn`, and every later leg keeps `a.sta + turn <= b.std`.
- **Repro:** `cd $HM && npx tsx win.mts s4_d328.json CS-TGN '24 Jan' '27 Jan'` (XY3041 06:20 against XY3040 landing 06:30).

#### D4. A client's own late cancellation of a wet rotation comes off our MGH, and the invoice says "we cancelled"
- **ID:** COMM-6. **Severity:** medium.
- **Root cause:** `events.ts clientFeeFor` cancels via `cancelForceMajeure`, which calls noteLostLegs and adds to lostMin. billContractMonth deducts it and says "we cancelled".
- **Files:** `ops/events.ts`, `ops/world.ts`. Partner B19 (billing wording).
- **Fix plan:** add `cancelForceMajeure(g, legs, reason, { client: true })` that skips noteLostLegs. World force majeure records `lostFmMin` (S0-1) instead of lostMin. Update the doc comments.
- **Test:** a wet month 250/300 BH; clientFeeFor cancels 4.3 BH: the bill is still MGH 300 × rate. A world closure: the force-majeure wording.
- **Repro:** `/home/user/wt/hunt-comm/scripts/comm-proof-mgh.ts` ($901,500 against $888,579); `$HCO/verify/v1.ts` seed 6, 30 Apr (Royal Air Maroc AT1000/01).

#### D5. Event work (AOG cover at Brussels) flies at an airport closed by the same strike
- **ID:** EV-S02. **Severity:** medium.
- **Root cause:** the permit exemption (Round E `permitOf`, closureHits, closedWait) applies to every contract with the event's id, including 'aogCover' at the closed airport itself.
- **Fix plan:** exempt only permit work kinds (evacuation, repatriation, humanitarian/relief, medical) by contract archetype, inside permitOf. For cover work of an airport-closure event, the work starts at airportClosedUntil (set in eventOffer/makeWork; missions.ts belongs to B, so do this from world.ts makeWork if possible, otherwise as a partner request to B).
- **Test:** strikeBelgium with its aogCover signed: no leg of it at BRU before airportClosedUntil.
- **Repro:** `npx tsx $HE/verify/bru.ts $HE/verify/bot2.d6.json` (TB4004/TB4005 fly 5 Mar while BRU is closed).

#### D6. Decisions posted over the pacing budget chime, toast "Decision: …" and pause the clock, then are auto-applied
- **ID:** EV-09. **Severity:** medium.
- **Root cause:** `messages.ts pushDecision` always cues, schedules and calls `requestPause('decision')`. `events.ts paceDecisions` splices the decision out later, but the pause and the cue stay.
- **Fix plan:** add `setPaceHook(fn)` in messages.ts, registered by events.ts. When the decision is unpaced, not 'must', and `!canAsk(g)`, autoApply and return before the cue, push, schedule and pause. paceDecisions stays as a fallback that cancels the queued cue and the pause request via a new `dropPause(reason)` in pause.ts (check Round E's `isolatePauses` for reuse).
- **Test:** budget full, crew posts a sickCrew decision: no 'Decision:' cue, `takePause()` is null, one 'Operations chose…' message.
- **Repro:** `npx tsx $HE/pace.ts $HE/bot4.d15feb.json` ({pause:'decision'} with no open decisions).

#### D7. A client's "move one charter by a day" moves every remaining leg of the series
- **ID:** EV-10. **Severity:** medium.
- **Root cause:** `clientFeeFor`: `legs = mine.filter(x => x.std >= f.std)` takes every later leg of the contract.
- **Fix plan:** limit to f's trip: f and the legs after it on the same aircraft until back where f started (unit via flights.ts unitOf, or a local tripLegs). Name the moved legs in the card. Keep Round E's clientMoved per leg.
- **Test:** a weekly two-leg series over 3 weeks: only week 1 moves; weeks 2 and 3 keep `schedStd === std`.
- **Repro:** `npx tsx $HE/scen-pen.ts $S1118 fee` (BLU980/981 of 27 Nov also moved).

#### D8. The "late group" retime request is asked again for the same flight, and the retimes stack
- **ID:** EV-11. **Severity:** medium.
- **Fix plan:** `retimeRequest` leaves out legs that already had a client retime (Round E `f.asked`, or delayReason starting "Client's request"), and legs with an open changeRequest. Pick at random from the event stream among eligible legs 2–10 days out.
- **Test:** changeRequestFor twice with accept after the first: the second names a different flight or none.
- **Repro:** the hunter's S1027 50-day decision logs (`$HE/s1027.decs`: BLU1010 18 Nov and 22 Nov; BLU964 12 and 16 Dec).

#### D9. The top-bar NEXT uses std, not std + delay
- **ID:** UI-4, plus the COMM-1 partner. **Severity:** medium.
- **Fix plan:** `strip.ts opsStripFacts` uses `dep = f.std + f.delay` for the filter, the comparison and the stored value. OpsStrip shows 'NEXT 17:46 (+31)'. (COMM-1 partner) opsStrip's "On time today" uses `onTimeLeg(f)`.
- **Test:** a flight with std = now − 10 and delay 30 is `next` with dep = std + 30, ahead of one with std = now + 60. A moved-and-flown leg is not counted on time.
- **Repro:** `npx tsx $HU/verify/det.ts <save> 45` (sections UI4 and UI4-late; outputs `det-s1027.txt`, `det-s1118.txt`).

#### D10. Crew-alert chips show a time with no day for flights up to 48 h ahead
- **ID:** UI-5. **Severity:** medium.
- **Fix plan:** use problemLogic's `dated(t, now)` in `OpsStrip.tsx` stripItems (value and aria) and in `mapLogic.ts chipInfo` (short form 'Fri 07:20'), including the OUT OF HRS variant.
- **Test:** chipInfo with std = now + 30 h contains the day.
- **Repro:** det.ts section UI5; S1027 at 27 Oct 07:30 ('BLU943 07:20' meaning 29 Oct).

#### D11. Inbox tiles on iPad shrink problem titles to one letter
- **ID:** UI-6. **Severity:** medium.
- **Fix plan:** `Inbox.tsx` ~L243: title on its own line, badges and date below; `b.ellipsis { flex: 1 1 50%; min-width: 8ch }` (v071.css/screens.css). Same for the decision row (~L88) and "Problems only".
- **Test:** Playwright at 1180x820 and 852x393 on S1027: each title shows at least 12 characters, or is at least 40 % of the tile.
- **Repro:** screenshot `$HU/shots/ipad-s1027-inbox-tiles.png`.

#### D12. The world event card says "N of our legs affected" and "None of our flights are affected" together
- **ID:** UI-7. **Severity:** medium.
- **Fix plan:** `effectsOf` uses the past tense ("N of our legs were affected so far"). Pass `flightsHit` in WorldEventView; V08Modals shows "None …" only when it is 0, otherwise "No more of our flights are affected".
- **Test:** flightsHit = 2 with no scheduled flights: no "None of our flights".
- **Repro:** det.ts section UI7.

#### D13. Early-return and other long-horizon dates have no year
- **ID:** UI-9. **Severity:** medium.
- **Fix plan:** add `fmtDayRel(t, now)` in time.ts (adds the year when it differs or the date is more than ~300 days away). Use it in LeaseModal (L29/40/60/66/110), MaintMoveModal and other long-horizon UI dates. The `leaseReturn.ts` L285 message belongs to B; request it as a partner one-liner.
- **Test:** `fmtDayRel(28 Nov 2028, now 18 Nov 2027)` contains '2028'.
- **Repro:** `npx tsx $HU/verify/early.mts $S1118` (CS-TCS '28 Nov' is 2028).

#### D14. Time zones: Egypt has no summer time and Tijuana is fixed at −8
- **ID:** UI-S7. **Severity:** medium.
- **Fix plan:** `data/timezones.ts`: add an 'eg' DstRule (last Friday of April to last Thursday of October, +1 h) for EG; give TIJ the 'us' rule through a per-airport rule override. Review the other entries.
- **Test:** `offsetAt('HRG', 15 Jul 2028) === 180`; `offsetAt('TIJ', 15 Jul 2028) === -420`; January unchanged. Run the FTL/WOCL tests.
- **Repro:** read timezones.ts lines 15 and 40.

#### D15. AOG chips show the repair cost on only two options; resolveAog does not say when the card's chips were wrong
- **IDs:** MONEY-9, MOVE-6 part 3. **Severity:** low.
- **Fix plan:** in `events.ts aogDecision`, state "Repair ~$X in every case" in the body and drop m.cost from the courier and team chips (team shows +teamCost), or add m.cost to every chip. In resolveAog, when the cancels differ from the card's chips, say so in the result message.
- **Test:** every option's money chip includes m.cost, or none does and the body states it.
- **Repro:** code; the A6 repro for the mismatch.

#### D16. Paint-shop block label is white on a white livery
- **ID:** UI-11. **Severity:** low.
- **Fix plan:** `scheduleLogic.ts` computes `--pc-ink` from the fill's luminance (dark when L > 0.5); in CSS `color: var(--pc-ink, var(--on-color))`, also for `.gl-paint`.
- **Test:** #ffffff gives a dark ink, #0b1f4d a light one.
- **Repro:** Schedule › 28 days on S1118, CS-TQM row from 6 Dec (`ipad-s1118-sched28-hi.png`).

#### D17. Small text and layout fixes
- **IDs:** UI-12 (b, c, d, e), EV-13 (world.ts part). **Severity:** low.
- (b) `cabin.ts` ~L386: a/an by first word.
- (c) Do not open MaintMoveModal for paint.
- (d) `tripMove.ts` ~L741: "Crew: 1 off, none on".
- (e) RosterBoard toolbar `flex-wrap` under 900 px.
- (EV-13) `world.ts resolveAirspace`: plural, and no expiry note when 0 legs moved.
- **Test:** a text-lint test; Playwright at 852x393 (toolbar right edge ≤ viewport).

#### D18. Partner sub-items in D files
- **IDs:** EV-01 siblings, EV-S01. **Severity:** medium.
- `tripMove.ts:389` and `events.ts:820` delay hurt use `latePenalty`.
- `world.ts waitLegs`/`waitAtGate`: set `f.excused` (cumulative) next to the lateOk writes.
- (EV-S01 partner, owner C9) `applyClosure` also scans scheduled deadheads in the closure window: remove them (removeFlights) and call `rerosterFrom` for the affected pairings.
- **Test:** hurricanePuj 'wait' gives no penalties on the moved legs (end to end with S0-3); a closure removes crew tickets into the closed airport.

---

## 6. Final verification after all merges

Each check maps to the items it covers.

- Bot seeds 2, 3, 6, 9 for 365 days (`--wide` for 2 and 9), seed 4 `--wide --aug --inv` for 200 days: no `crew-min` invariant error (A4).
- Run the A5 settleOverlaps location log (expect 0 hits), the curfew detector (`$HE/verify/vlib.ts`, `$HM/verify/curf.mts`; no positioning or deadhead in a strict curfew), the plan-break and start-mismatch detectors (A1, A6, A11), the on-time comparison (`$HCO/verify/v1.ts`: engine equals honest, B4), the phantom-ticket detector (`$HC/verify/v3.ts`, C4), the buy-back detector (`$HMO/verify/bbv.ts`, C8) and the forecast error script (B6).
- Both player saves played 50 days with default answers; compare the money lines with the pre-fix runs, and expect fewer red alarms.
- Save compatibility: load S1027, S1118 and the round-E fixture `save-v0121-pzu.lz.txt`.

---

## 7. Unclear items worth a second look, and how to settle them

| ID | Claim | How to settle | Owner if it is a bug |
|---|---|---|---|
| MOVE-S4 | The dry-lease out-ferry origin is taken at start − 3 d, not at the ferry's departure | Shown only on synthetic offers (`cd $HM/verify && npx tsx dry.mts ../../../s1027/save.json`: 21 cases, mostly soft go-home legs). Settle by running the bot with lease-out on (seeds 2/6, 365 d) and a detector comparing `dryPlan.from` with `whereAt(out[0].std − turn)` after relink, for signed dry leases only. Bug if any signed lease's ferry leaves from where the aircraft is not, or the priced ferry cost differs by more than 10 %. | B (`dryLease.ts`) |
| COMM-S1 | Cancelling an active charter series costs 100 % of the unflown value | A design call, documented in the code comment. Check RESEARCH.md for charter-series cancellation terms and ask the designer. If changed: per remaining rotation, `cancelScale(days to its first departure)`. The hunter's S1118 'Autumn sun: Mahón' figures ($856,668 + $257,002) were not reproduced: re-run on a copy before deciding. | B (`accept.ts`) |
| S-HOTEL | Double crew hotel after a diversion or curfew night stop (disrupt posts rooms; dailyCrewCosts also posts at 00:00); also charged on wet contracts | Force a curfew night stop or diversion hotel at an outstation spanning 00:00 UTC (`$HE/scen-gate.ts` or `scen-div.ts` with an evening leg) and count `hotels` ledger posts per crew member for that night, once on a charter and once on a wet contract. Bug if more than one room per crew per night, or any on wet. | A (`disrupt.ts`), with C (`costs.ts`) as partner |
| EV-S05 | Ramp cat 3b/3c fix not held when the aircraft is already in line maintenance after a technical diversion | Force: `scen-div.ts technical`, then call `inspect()` with a seeded 3b on arrival; check that the mx end is at least now + fixMin and the message's ready time is true. Rare (ramp rate × technical-diversion rate). | A (`ramp.ts`) |
| EV-S06 | CTOT cards name Eurocontrol for any departure worldwide | Run a bot seed with a non-ECAC base (Gulf or Asia) and grep for 'Eurocontrol' on non-ECAC departures, or unit-test `delayCard` on RUH–DEL. Text only; cheap to fix either way (raise the card only in ECAC, else neutral 'ATC gave a slot'). | A (`disrupt.ts`) |
| S-misc (UI) | Inbox badge 22 vs Problems 3; '25 of 25 sets' counts joiners; map chip 'MAN 02:35'; pruned-duty modal | Design review only (all look deliberate). Consider '→MAN 02:35' and 'sets incl. N joining'. | D |
| EV-04 tail | Repeated crew alarms (5 in the same minute at 20 Nov 04:35, then hourly 'Departs in 18 h' on a cancelled pair) | After A1 and C merge, re-run `$HE/scen-div.ts $S1118 medical 30 BLU1083` and the BRU branch. If alarms still fire for cancelled legs, open a crew item (control.ts alert dedupe). | C |
| MOVE-2 tail | Crew rostered on BLU992 lose a duty when it self-corrects | The save had crew 0. Re-run A11's fixture with crew rostered on the hop leg and check that the duty is kept or re-rostered with no 'CREW SHORTAGE'. | A, with C as partner |
| CREW-4 tail | S1027 f1qut DH MGQ–LIS 12 Dec ($7,800) with 6 crew aboard while at LIS | Run `$HC/verify/v4b.ts` on S1027 at 11 Dec 08:50 after C5; it should vanish. | C |
| EV-05 money | Sub-charter money (Titan $19K/$33K, reliability −0.6) after the curfew reposition crew shortage | Not re-traced. After A7, re-run `look9.ts` on `$HE/bot9.d24oct.json` and confirm no shortage or sub-charter. | A |
| MOVE-6 tail | Leftover positioning BLU1587 AYT–AMS on 24 Dec from old anchors | After A6, run `$HM/verify/aogdec.mts` and list the positioning legs for CS-TCH: there should be none left over. | A |
| S-DEPREC | Owned aircraft never depreciate | A missing feature, not a bug against the current design. Flag it to the designer; if accepted, add a monthly 'depreciation' line in finance.ts onMonthEnd and reduce bookValue (straight line to a residual), with balance review. | B (only if the designer approves) |
| S-FORGIVE | Forgiveness only applies above 3 h | Needs the designer's rule (see A17). | A, with B as partner |

**Refuted, do not fix:** COMM S-3 (broker cut on wet estRevenue, latent only), COMM S-4 (wet positioning home billed, intended; mis-tagging is B13/A9), S-CONSENT, S-CHARTER147 (BLU921/922 sub-chartered), S-rita, S-delaypen, S-dayoff, the "ranking is wrong" part of UI-2, and the MONEY-2 seed 5 João Teixeira example.