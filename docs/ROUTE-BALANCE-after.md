# BLOCK HOURS r3-bal: route economics after the balance pass (before → after)

Branch `r3-bal` (from routes2 e041a9e). Same method and scripts as bal-before.md (`scripts/balmeasure.ts`,
`scripts/balrun.ts`, the bots). All money USD. [E] estimate. The case is the engine's business case at the study's
recommended plan, first 12 months from the first flight, P50 — it now includes the launch ramp, so it is a *first-year*
figure; a mature year is better by roughly the ramp months.

## 1. What changed and why (each a wrong input, not a multiplier)

| # | change | where | why (real-world basis) | effect |
|---|---|---|---|---|
| 1 | **Payload**: A320ceo 18 → 20 t, A321ceo 21 → 25 t, A320neo 19 → 20 t, A321neo 22 → 25 t, 737-800 19 → 21 t, 737-900 20 → 21 t | balEngine `cargo.payloadType` | MZFW less a typical OEW (Airbus/Boeing ACAP) [E] | an A320 180Y could sell 153 seats, an A321 220Y 178; now all of them |
| 2 | **Passenger mass by market**: 84 kg + a 16 kg bag, two bags for the VFR share (was 108 kg everywhere) | `model.paxKgOf`, used by the case, sales, cargo room | EASA standard adult mass with hand baggage; one checked bag in Europe, VFR travellers two [E] | holiday markets 100 kg, diaspora markets ~110 kg (Lisbon's calibration unchanged) |
| 3 | **Slow-bookings card** compares with the seats the flight can sell, never above full | `sales.dailySales` | a full flight was told "81 % booked, usually 149 %" and urged to run a sale | no more false cards / fare cuts on full flights |
| 4 | **The study tries 4 a week and daily** (when one aircraft's rotations fit: ≤ 16 h a day on average) | `launch.searchPlan`, `study.freqs`, `study.maxDayH` | busy markets were planned at 1–3 a week at 98–100 % full | the recommended plan finds the frequency where loads settle at 80–95 % |
| 5 | **En-route charges by MTOW**: √(MTOW ÷ 186.9 t) against the 767-300ER (was √(seats ÷ 290)) | `costs.navX` | Eurocontrol bills rate × km/100 × √(MTOW/50) (CRCO circular 2025/01) | A321 −20 %, A320 −19 %, 767 −9 % on nav |
| 6 | **Cargo is a week's flow shared by our departures** (week's total × flights^0.3) | `model.cargoDepX`, case and `revenue.cargoFor` | a market's cargo does not multiply with frequency; a daily plan earned seven weeks of it | MLA–Istanbul daily: cargo $3.4 M → $1.0 M a year |
| 7 | **Crew paid for 62 BH a month** (was 75) | `pnl.crewBH` (route view and the case's ACMI comparison only; salaries in the ledger unchanged) | EASA FTL 900 BH/yr, 100 in 28 days; leave, training and reserve leave 700–800 a year [E] | narrowbody crew $390 → $472 a BH |
| 8 | **Launch ramp for new routes**: half the travellers at first, all after 20 weeks (was 70 % → 100 % in 8 weeks); the case expects the same ramp and the late-sales dent | `demand.ramp2`, `Route.ramp2` (set on Go), `sales.rampOf`, `launch.caseRamp` | new routes take a season to be known; with the old ramp every route was full by month 3 | 3–4 losing months, payback about a year after Go |
| 9 | **Planner ideas**: try 4 a week and daily too; judged on a known route's year (no ramp), 5 % threshold kept | `advice` | the ideas and the study should search the same plans | Malta's list: Istanbul daily, Milan 4/wk, Izmir, Paris, Belgrade |
| – | Tried and **kept off**: the frequency-share cap (QSI) on catalogue markets (`demand.freqCap.all`, a switch) | | Lisbon's widebody routes against TAP daily (Recife, Luanda) fell to −20 %; the catalogue's LCC-crowded markets already lose | — |
| – | Tried and **kept**: `demand.scale` 1.4 (at 1.0 the Lisbon diaspora widebody markets all lose 20–60 %) | | | — |

**Saves:** SAVE_VERSION unchanged. A route flying already keeps the old ramp (`ramp2` is set only on a new Go). The
payload, passenger mass, cargo share, nav and crew-hours changes apply to every sale and sector from the moment the
save loads (no booking is taken away: a cap that rises only lets more seats sell; cargo and costs are per sector at
arrival). ACMI is untouched (`--wide` bots identical).

## 2. Business case across the 68 researched markets

Before (routes2):

Two-class:
- A320: 54 markets, median margin 4%, 32 positive, 21 in 5–15 %, 3 above 20 %; result per BH over all 142 USD; median result per BH 405, of the paying ones 842; ACMI after aircraft and crew 1125 a BH (when there is work).
- A321: 52 markets, median margin 6%, 32 positive, 25 in 5–15 %, 1 above 20 %; result per BH over all 357 USD; median result per BH 543, of the paying ones 1249; ACMI after aircraft and crew 1260 a BH (when there is work).
- B763: 33 markets, median margin 6%, 25 positive, 19 in 5–15 %, 0 above 20 %; result per BH over all 562 USD; median result per BH 765, of the paying ones 876; ACMI after aircraft and crew 1715 a BH (when there is work).
- A332: 33 markets, median margin 8%, 26 positive, 17 in 5–15 %, 0 above 20 %; result per BH over all 857 USD; median result per BH 1040, of the paying ones 1345; ACMI after aircraft and crew 1601 a BH (when there is work).

All-economy:
- A320: 54 markets, median margin -2%, 23 positive, 12 in 5–15 %, 3 above 20 %; result per BH over all -371 USD; median result per BH -262, of the paying ones 574; ACMI after aircraft and crew 1125 a BH (when there is work).
- A321: 52 markets, median margin 0%, 25 positive, 15 in 5–15 %, 1 above 20 %; result per BH over all -365 USD; median result per BH 0, of the paying ones 886; ACMI after aircraft and crew 1227 a BH (when there is work).
- B763: 33 markets, median margin 1%, 19 positive, 10 in 5–15 %, 0 above 20 %; result per BH over all -33 USD; median result per BH 110, of the paying ones 922; ACMI after aircraft and crew 1681 a BH (when there is work).
- A332: 33 markets, median margin 1%, 19 positive, 10 in 5–15 %, 1 above 20 %; result per BH over all 12 USD; median result per BH 111, of the paying ones 1314; ACMI after aircraft and crew 1601 a BH (when there is work).

After (r3-bal):

Two-class:
- A320: 54 markets, median margin 7%, 36 positive, 22 in 5–15 %, 1 above 20 %; result per BH over all 461 USD; median result per BH 659, of the paying ones 1129; ACMI after aircraft and crew 1043 a BH (when there is work).
- A321: 52 markets, median margin 8%, 37 positive, 17 in 5–15 %, 3 above 20 %; result per BH over all 720 USD; median result per BH 781, of the paying ones 1353; ACMI after aircraft and crew 1178 a BH (when there is work).
- B763: 33 markets, median margin -1%, 15 positive, 4 in 5–15 %, 0 above 20 %; result per BH over all -221 USD; median result per BH -129, of the paying ones 479; ACMI after aircraft and crew 1599 a BH (when there is work).
- A332: 33 markets, median margin 1%, 17 positive, 10 in 5–15 %, 0 above 20 %; result per BH over all -86 USD; median result per BH 76, of the paying ones 805; ACMI after aircraft and crew 1471 a BH (when there is work).

All-economy:
- A320: 54 markets, median margin 3%, 30 positive, 13 in 5–15 %, 1 above 20 %; result per BH over all 107 USD; median result per BH 333, of the paying ones 967; ACMI after aircraft and crew 1043 a BH (when there is work).
- A321: 52 markets, median margin 6%, 34 positive, 17 in 5–15 %, 8 above 20 %; result per BH over all 458 USD; median result per BH 732, of the paying ones 1220; ACMI after aircraft and crew 1138 a BH (when there is work).
- B763: 33 markets, median margin -7%, 11 positive, 6 in 5–15 %, 0 above 20 %; result per BH over all -848 USD; median result per BH -853, of the paying ones 812; ACMI after aircraft and crew 1558 a BH (when there is work).
- A332: 33 markets, median margin -6%, 11 positive, 4 in 5–15 %, 0 above 20 %; result per BH over all -939 USD; median result per BH -695, of the paying ones 534; ACMI after aircraft and crew 1471 a BH (when there is work).

Reading it:
- **Narrowbodies** (the player's A320/A321): median first-year margin A320 4 → 7 %, A321 6 → 8 % (two-class); all-economy
  A320 −2 → 3 %, A321 0 → 6 %. About a third of markets lose, a third sit in 5–15 %, a few are rich (seasonal holiday
  series to Antalya, Heraklion, Djerba, Sharm in season: 15–25 %; Tripoli: 32 %, a war-risk market). Loads 75–100 %
  instead of a flat 77–91 %.
- **Poor choices stay poor**: LCC-crowded Sofia–Stansted −18/−23 %, Sofia–Madrid, Madrid–Bucharest, Vilnius/Riga–Dublin
  negative; a widebody on Glasgow −40 %; Catania (a 187 km hop) negative.
- **Long-haul** is harder: 767/A330 first-year median −1/1 % (two-class), 15–17 of 33 pay; the right widebody on the
  right market pays (Malta–JFK A330 11 %, Riga–JFK 6 %, Prague–Hanoi 10 %, Havana), the wrong one loses heavily.
- **Routes against ACMI per block hour** (after aircraft and crew): median route A321 $781 (two-class) / $732
  (all-economy), the paying half $1,220–1,350, against ACMI $1,140–1,180 when there is ACMI work. Comparable or a bit
  lower on average, more upside, more risk — as asked. Widebodies: routes clearly below ACMI.

## 3. The player's save (Malteser, MLA, A321 220Y 9H-EYO), a route launched as a player does it

Go on 31 Aug 2027 (study 35 days), first flight 26 Jan 2028. Months from the first flight; results after aircraft and
crew time; launch spend ($282–303K, paid Aug–Dec 2027) is in the cumulative column.

**The planner's top idea, Malta–Istanbul (holiday series):**

| | plan | case P50 first year | sim |
|---|---|---|---|
| before | 3 a week | +$565K, 7.3 %, Marginal, payback 23 months | months 1–11: −41, −76, −12, +31, +109, +150, +197, +167, +85, +5, −103 K (LF 58–77 %, capped) |
| after | daily | +$1.46 M, 8.3 %, Worth it, payback 9 months | months 1–11: −150, −550, −403, −60, +237, +374, +527, +587, +349, +106, −248 K (LF 31 → 95 %) |

After: sum of months 1–11 +$0.77 M on $14.0 M (5.5 %; case 8.3 %); the cumulative line incl. launch crosses zero in
month 8 (August), 12 months after the Go. Summer 17–29 %, November −26 %.

**Malta–Manchester (catalogue, LCC-crowded):**

| | plan | case | sim, months 1–12 |
|---|---|---|---|
| before (dev launch, 1/wk) | 1 a week | −4 % (two-class) | −38, −15, −5, −24 K (77 %) |
| after (player's path) | 1 a week | +$176K, 4.9 %, Marginal, payback 75 months | −33, −69, −33, +11, +25, +51, +61, +76, +65, −94, −29, −41 K (84 → 95 %) |

Year −$10K on $3.1 M (−0.3 %; case +4.9 %): still a weak route, as it should be; not paid back after a year.

**Malta–Copenhagen (catalogue, the best of Malta's own markets):**

| | plan | case | sim, months 1–12 |
|---|---|---|---|
| after | 1 a week | +$648K, 16.2 %, Worth it, payback 20 months | −38, −79, +16, +75, +98, +106, +115, +91, +110, +101, +7, −52 K (51 → 96 %) |

Year +$550K on $3.5 M (15.6 %; case 16.2 %). Cumulative incl. launch positive in month 7 (July), 11 months after Go.

Case against actual: Copenhagen within a point, Istanbul 3 points under (the ramp months lose more than the case
expects), Manchester 5 points under (a bad October). The direction and the verdicts hold.

Harness note: the Istanbul run's December (−$3.47 M) is six rotations cancelled on the day when the other A321 was
grounded for an overdue C-check in the unplayed save and ops recovery took 9H-EYO; refunds plus EU261 on 220 seats a
sector. Not an economics effect (see open items).

## 4. Bots

- ACMI only, seeds 1 and 2, 365 days `--wide --inv`: **identical** to routes2 (every money line; only the save size
  differs by 1 KB). 0 invariant errors.
- Routes `--routes --inv` 365 days: LIS 0 errors (5 warnings), MLA 0 (7), SOF 0 (1), RIX 0 (5).
  LIS–OXB A320 (4 months): −66, −42, +101, +78 K, 6.8 % (before −35, −11, +164, +76 K, 15.3 %: the longer ramp).
  RIX–SSH A320 180Y (4 months): −33, +20, +43, +51 K, LF 91 %, 7.9 % (before −27, −17, −5, −22 K, LF 80 %, −8 %).
- `--det` seed 2: two runs identical; save/load at day 90 and day 200 identical.
- The player's save with a route on sale (lifesave), `invariants.ts save … 30`: 0 errors, 0 warnings.

## 5. Tests updated

- `markets.test.ts`: the best plan now tried at 1, 2, 3, 4 a week and daily (as the study); load factor bound ≤ 100 %
  (the real payload lets a busy market's flight fill); Tripoli may reach 35 % (32 % first year), others ≤ 30 %.
- `stopover.test.ts`: Luanda/Recife on an A330 "pays" > 3 % (was > 6 %: the first year now carries the ramp and crew
  at 62 BH a month).
- `bases.test.ts`: the ETOPS approval still recomputes the list (key changes; same list as a game holding the
  approvals), but the 767's New York no longer makes the top five against the A320's daily ideas.

## 6. Open items

1. **A C-check booked over route rotations** (ops lane): when the planner books an overdue check and ops recovery moves
   the route's aircraft to cover ACMI legs, the route's rotations are cancelled on the day with full EU261 instead of
   being offered to the conflicts module (swap / sub-charter / move). In an unplayed save this cost −$1.1 to −3.5 M in
   one month. Worth a card well ahead or an automatic sub-charter quote.
2. Seasonal holiday series in season and Tripoli are the rich end (15–33 %). Left as the game's "upside": seasonal
   plans rest the station off season, Tripoli carries coup and currency risk.
3. The case's ramp is a little kinder than the sim's in months 2–3 (awareness starts lower in the sim than the case's
   campaign level): first-year case margins run 1–5 points above the sim on new routes.
4. Widebody routes' first year is thin (median about 0 %); a mature year is about 5 points better.

## Appendix: per-market before → after

### Business case, two-class: before → after

| market | type | f a week | LF | $/pax | RASK ¢ | CASK ¢ | margin | result a year |
|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 | 1.0 → 1.0 | 88% → 83% | 259 → 263 | 8.6 → 8.5 | 6.8 → 6.8 | 20% → 20% | 934k → 892k |
| LIS-OXB | A321 | 1.0 → 1.0 | 82% → 76% | 260 → 266 | 8.2 → 8.0 | 6.5 → 6.5 | 20% → 19% | 1016k → 926k |
| LIS-OXB | B763 | 1.0 → 1.0 | 68% → 60% | 265 → 269 | 7.0 → 6.4 | 6.7 → 6.6 | 4% → -3% | 268k → -165k |
| LIS-OXB | A332 | 1.0 → 1.0 | 61% → 54% | 265 → 269 | 6.3 → 5.8 | 6.2 → 6.2 | 1% → -7% | 62k → -396k |
| LIS-TMS | A320 | 1.0 → 1.0 | 69% → 71% | 0 → 0 | 6.5 → 6.1 | 5.2 → 5.3 | 19% → 13% | 993k → 635k |
| LIS-TMS | B763 | 1.0 → 1.0 | 73% → 65% | 0 → 0 | 5.9 → 5.5 | 5.4 → 5.4 | 8% → 2% | 604k → 128k |
| LIS-TMS | A332 | 1.0 → 1.0 | 66% → 59% | 0 → 0 | 5.3 → 5.0 | 5.1 → 5.1 | 5% → -1% | 349k → -107k |
| LIS-DIL | B763 | 0.3 → 0.3 | 38% → 34% | 2075 → 2089 | 6.1 → 5.5 | 5.7 → 5.6 | 7% → -2% | 417k → -94k |
| LIS-RAI | A320 | 1.0 → 1.0 | 91% → 98% | 191 → 189 | 6.9 → 7.4 | 6.5 → 6.6 | 5% → 10% | 179k → 388k |
| LIS-RAI | A321 | 1.0 → 1.0 | 84% → 93% | 199 → 195 | 6.6 → 7.3 | 6.2 → 6.4 | 5% → 12% | 210k → 553k |
| LIS-RAI | B763 | 1.0 → 1.0 | 95% → 87% | 185 → 189 | 7.0 → 6.5 | 6.7 → 6.6 | 4% → -1% | 258k → -56k |
| LIS-RAI | A332 | 1.0 → 1.0 | 91% → 83% | 187 → 191 | 6.7 → 6.2 | 6.3 → 6.2 | 6% → 0% | 409k → -1k |
| LIS-SID | A320 | 1.0 → 1.0 | 91% → 96% | 188 → 187 | 6.9 → 7.2 | 6.7 → 6.8 | 3% → 6% | 98k → 214k |
| LIS-SID | A321 | 1.0 → 1.0 | 91% → 91% | 187 → 188 | 6.8 → 6.8 | 6.5 → 6.4 | 5% → 6% | 200k → 227k |
| LIS-SID | B763 | 1.0 → 1.0 | 92% → 82% | 186 → 188 | 6.9 → 6.1 | 6.8 → 6.7 | 0% → -9% | 26k → -422k |
| LIS-SID | A332 | 1.0 → 1.0 | 87% → 77% | 186 → 189 | 6.5 → 5.8 | 6.4 → 6.3 | 1% → -8% | 83k → -419k |
| LIS-BVC | A320 | 1.0 → 1.0 | 84% → 76% | 231 → 234 | 7.4 → 6.9 | 6.7 → 6.6 | 10% → 4% | 371k → 153k |
| LIS-BVC | A321 | 1.0 → 1.0 | 75% → 69% | 232 → 236 | 6.6 → 6.3 | 6.3 → 6.2 | 5% → 1% | 194k → 40k |
| LIS-BVC | B763 | 1.0 → 1.0 | 59% → 52% | 234 → 237 | 5.2 → 4.7 | 6.4 → 6.3 | -21% → -33% | -888k → -1233k |
| LIS-BVC | A332 | 1.0 → 1.0 | 52% → 46% | 234 → 237 | 4.7 → 4.2 | 5.9 → 5.9 | -27% → -39% | -1102k → -1465k |
| LIS-LAD | B763 | 2.0 → 2.0 | 99% → 91% | 300 → 307 | 6.1 → 5.6 | 5.7 → 5.6 | 7% → 0% | 1381k → 17k |
| LIS-LAD | A332 | 2.0 → 2.0 | 98% → 89% | 302 → 310 | 6.0 → 5.4 | 5.4 → 5.3 | 10% → 2% | 2071k → 359k |
| LIS-MPM | B763 | 1.0 → 1.0 | 69% → 62% | 521 → 534 | 4.7 → 4.3 | 5.1 → 5.1 | -10% → -19% | -1094k → -1862k |
| LIS-MPM | A332 | 1.0 → 1.0 | 63% → 56% | 533 → 544 | 4.3 → 4.0 | 4.8 → 4.8 | -11% → -21% | -1275k → -2170k |
| LIS-REC | B763 | 1.0 → 1.0 | 100% → 92% | 302 → 305 | 5.9 → 5.5 | 5.4 → 5.4 | 7% → 2% | 713k → 156k |
| LIS-REC | A332 | 1.0 → 1.0 | 98% → 89% | 302 → 307 | 5.8 → 5.3 | 5.2 → 5.1 | 10% → 3% | 1103k → 339k |
| LIS-FOR | B763 | 1.0 → 1.0 | 97% → 87% | 295 → 299 | 5.8 → 5.3 | 5.5 → 5.4 | 5% → -2% | 476k → -184k |
| LIS-FOR | A332 | 1.0 → 1.0 | 93% → 83% | 296 → 301 | 5.5 → 5.1 | 5.2 → 5.1 | 7% → -1% | 678k → -77k |
| OPO-RAI | A320 | 0.3 → 0.3 | 91% → 94% | 222 → 219 | 7.1 → 7.4 | 7.6 → 7.3 | -6% → 1% | -64k → 19k |
| OPO-RAI | A321 | 0.3 → 0.3 | 80% → 85% | 231 → 222 | 6.4 → 6.7 | 7.0 → 6.8 | -9% → -1% | -100k → -18k |
| OPO-RAI | B763 | 0.3 → 0.3 | 96% → 81% | 214 → 218 | 7.1 → 6.3 | 7.2 → 6.9 | -1% → -10% | -21k → -185k |
| OPO-RAI | A332 | 0.3 → 0.3 | 92% → 76% | 215 → 220 | 6.9 → 5.9 | 6.8 → 6.5 | 1% → -10% | 23k → -189k |
| OPO-OXB | A320 | 0.3 → 0.3 | 90% → 91% | 260 → 266 | 8.1 → 8.2 | 7.5 → 7.8 | 7% → 5% | 115k → 62k |
| OPO-OXB | A321 | 0.3 → 0.3 | 85% → 88% | 260 → 265 | 7.7 → 7.9 | 7.1 → 7.3 | 8% → 7% | 135k → 92k |
| OPO-OXB | B763 | 0.3 → 0.3 | 72% → 77% | 266 → 266 | 6.6 → 6.9 | 7.0 → 7.3 | -6% → -5% | -122k → -78k |
| OPO-OXB | A332 | 0.3 → 0.3 | 65% → 72% | 267 → 268 | 6.0 → 6.5 | 6.5 → 6.8 | -9% → -5% | -180k → -84k |
| VNO-LTN | A320 | 1.0 → 1.0 | 91% → 99% | 103 → 102 | 7.1 → 7.7 | 8.4 → 8.5 | -18% → -11% | -376k → -245k |
| VNO-LTN | A321 | 1.0 → 1.0 | 87% → 98% | 106 → 104 | 6.9 → 7.7 | 8.0 → 8.2 | -16% → -7% | -394k → -179k |
| VNO-DUB | A320 | 1.0 → 1.0 | 91% → 98% | 122 → 121 | 6.7 → 7.2 | 7.7 → 7.8 | -14% → -8% | -344k → -208k |
| VNO-DUB | A321 | 1.0 → 1.0 | 91% → 99% | 125 → 123 | 6.8 → 7.2 | 7.4 → 7.5 | -10% → -3% | -275k → -100k |
| VNO-OSL | A320 | 1.0 → 2.0 | 91% → 99% | 86 → 85 | 9.9 → 10.4 | 11.5 → 11.1 | -17% → -7% | -299k → -251k |
| VNO-OSL | A321 | 1.0 → 2.0 | 91% → 98% | 87 → 86 | 9.9 → 10.4 | 11.1 → 10.7 | -11% → -2% | -243k → -110k |
| VNO-TFS | A320 | 1.0 s → 1.0 s | 71% → 86% | 295 → 289 | 5.1 → 6.0 | 5.8 → 6.0 | -14% → 1% | -323k → 14k |
| VNO-TFS | A321 | 1.0 s → 1.0 s | 67% → 85% | 299 → 291 | 4.9 → 6.0 | 5.6 → 5.8 | -16% → 3% | -401k → 97k |
| VNO-TFS | B763 | 1.0 s → 1.0 s | 99% → 92% | 285 → 287 | 6.8 → 6.4 | 6.2 → 6.2 | 9% → 3% | 417k → 157k |
| VNO-TFS | A332 | 1.0 s → 1.0 s | 97% → 89% | 285 → 287 | 6.7 → 6.2 | 5.9 → 5.9 | 12% → 6% | 649k → 306k |
| VNO-AYT | A320 | 1.0 s → 1.0 s | 91% → 100% | 172 → 171 | 8.7 → 9.5 | 7.9 → 8.1 | 9% → 15% | 161k → 293k |
| VNO-AYT | A321 | 1.0 s → 1.0 s | 91% → 100% | 174 → 172 | 8.8 → 9.5 | 7.7 → 7.8 | 12% → 18% | 256k → 413k |
| VNO-TBS | A320 | 1.0 → 1.0 | 91% → 95% | 163 → 164 | 8.6 → 9.0 | 8.0 → 7.9 | 8% → 12% | 238k → 371k |
| VNO-TBS | A321 | 1.0 → 1.0 | 90% → 91% | 167 → 168 | 8.6 → 8.8 | 7.7 → 7.6 | 11% → 13% | 390k → 489k |
| VNO-TLV | A320 | 1.0 → 1.0 | 91% → 95% | 171 → 171 | 6.8 → 7.1 | 7.0 → 7.0 | -3% → 2% | -80k → 55k |
| VNO-TLV | A321 | 1.0 → 1.0 | 89% → 91% | 175 → 174 | 6.8 → 6.9 | 6.7 → 6.7 | 0% → 3% | 15k → 117k |
| VNO-TLV | B763 | 1.0 → 1.0 | 88% → 80% | 174 → 175 | 6.6 → 6.1 | 7.0 → 6.9 | -6% → -14% | -281k → -609k |
| VNO-TLV | A332 | 1.0 → 1.0 | 82% → 74% | 176 → 177 | 6.3 → 5.7 | 6.6 → 6.5 | -6% → -16% | -289k → -729k |
| VNO-ORD | B763 | 1.0 → 1.0 | 83% → 77% | 473 → 477 | 5.7 → 5.4 | 5.3 → 5.2 | 7% → 2% | 895k → 235k |
| VNO-ORD | A332 | 1.0 → 1.0 | 79% → 72% | 478 → 483 | 5.5 → 5.1 | 5.0 → 5.0 | 9% → 2% | 1114k → 288k |
| MLA-MAN | A320 | 1.0 → 1.0 | 91% → 100% | 149 → 148 | 6.8 → 7.3 | 7.3 → 7.4 | -8% → -1% | -229k → -21k |
| MLA-MAN | A321 | 1.0 → 1.0 | 91% → 100% | 151 → 149 | 6.8 → 7.4 | 7.1 → 7.1 | -4% → 3% | -140k → 108k |
| MLA-GLA | A320 | 1.0 → 1.0 | 85% → 84% | 164 → 165 | 6.0 → 6.0 | 6.8 → 6.7 | -13% → -12% | -362k → -338k |
| MLA-GLA | A321 | 1.0 → 1.0 | 80% → 77% | 165 → 167 | 5.7 → 5.5 | 6.5 → 6.3 | -14% → -15% | -422k → -446k |
| MLA-GLA | B763 | 1.0 → 1.0 | 73% → 64% | 170 → 170 | 5.3 → 4.7 | 6.7 → 6.5 | -26% → -40% | -1004k → -1373k |
| MLA-GLA | A332 | 1.0 → 1.0 | 67% → 58% | 171 → 170 | 4.9 → 4.3 | 6.2 → 6.1 | -27% → -44% | -1105k → -1536k |
| MLA-MJI | A320 | 1.0 → 1.0 | 90% → 88% | 127 → 128 | 42.9 → 42.6 | 29.2 → 29.1 | 32% → 32% | 828k → 822k |
| MLA-MJI | A321 | 1.0 → 1.0 | 87% → 83% | 130 → 132 | 42.1 → 40.7 | 27.6 → 27.1 | 34% → 33% | 1023k → 961k |
| MLA-BEN | A320 | 1.0 → 1.0 | 76% → 71% | 0 → 0 | 13.0 → 13.8 | 12.9 → 12.6 | 1% → 8% | 17k → 135k |
| MLA-BEN | A321 | 1.0 → 1.0 | 70% → 63% | 0 → 0 | 11.3 → 11.9 | 12.1 → 11.8 | -7% → 0% | -112k → 5k |
| MLA-CTA | A320 | 3.0 → 2.0 | 91% → 99% | 55 → 54 | 37.3 → 38.5 | 39.6 → 41.4 | -6% → -8% | -226k → -192k |
| MLA-CTA | A321 | 3.0 → 2.0 | 91% → 98% | 56 → 55 | 37.2 → 38.3 | 38.2 → 39.7 | -3% → -4% | -124k → -111k |
| MLA-CPH | A320 | 1.0 → 1.0 | 91% → 99% | 180 → 178 | 8.4 → 9.0 | 7.7 → 7.8 | 8% → 14% | 259k → 482k |
| MLA-CPH | A321 | 1.0 → 1.0 | 91% → 97% | 181 → 180 | 8.4 → 8.9 | 7.5 → 7.5 | 11% → 16% | 427k → 653k |
| MLA-LDE | A320 | 0.3 s → 0.3 s | 91% → 97% | 173 → 172 | 10.6 → 11.1 | 11.2 → 11.2 | -6% → -1% | -24k → -4k |
| MLA-LDE | A321 | 0.3 s → 0.3 s | 91% → 94% | 172 → 171 | 10.5 → 10.7 | 10.5 → 10.5 | 0% → 2% | -1k → 11k |
| MLA-JFK | B763 | 1.0 s → 1.0 s | 92% → 84% | 451 → 461 | 6.2 → 5.8 | 5.5 → 5.4 | 11% → 6% | 972k → 511k |
| MLA-JFK | A332 | 1.0 s → 1.0 s | 90% → 82% | 454 → 462 | 6.1 → 5.6 | 5.1 → 5.0 | 16% → 11% | 1538k → 933k |
| MAD-LPA | A320 | 3.0 → 7.0 | 91% → 100% | 117 → 116 | 7.8 → 7.8 | 7.9 → 7.8 | -2% → 1% | -131k → 115k |
| MAD-LPA | A321 | 3.0 → 7.0 | 91% → 100% | 120 → 118 | 7.8 → 7.9 | 7.7 → 7.6 | 2% → 4% | 152k → 846k |
| MAD-IBZ | A320 | 2.0 s → 4.0 s | 91% → 100% | 93 → 91 | 22.8 → 24.3 | 20.2 → 20.1 | 11% → 17% | 244k → 786k |
| MAD-IBZ | A321 | 2.0 s → 4.0 s | 91% → 99% | 94 → 93 | 22.9 → 24.4 | 19.4 → 19.3 | 15% → 21% | 381k → 1100k |
| MAD-TNG | A320 | 3.0 → 3.0 | 91% → 92% | 83 → 84 | 17.9 → 17.5 | 16.3 → 16.1 | 9% → 8% | 481k → 422k |
| MAD-TNG | A321 | 3.0 → 3.0 | 89% → 86% | 84 → 85 | 17.6 → 16.7 | 15.6 → 15.2 | 11% → 9% | 687k → 527k |
| MAD-OTP | A320 | 1.0 → 1.0 | 91% → 99% | 107 → 106 | 5.1 → 5.5 | 7.0 → 7.1 | -37% → -29% | -817k → -678k |
| MAD-OTP | A321 | 1.0 → 1.0 | 91% → 100% | 109 → 108 | 5.2 → 5.6 | 6.8 → 6.8 | -32% → -23% | -826k → -633k |
| MAD-SSG | A320 | 1.0 → 1.0 | 77% → 84% | 0 → 0 | 6.9 → 6.8 | 5.5 → 5.5 | 21% → 19% | 1108k → 958k |
| MAD-SSG | A321 | 1.0 → 1.0 | 73% → 82% | 0 → 0 | 6.1 → 6.2 | 5.3 → 5.3 | 13% → 14% | 687k → 740k |
| MAD-SSG | B763 | 1.0 → 1.0 | 88% → 79% | 0 → 0 | 6.8 → 6.2 | 5.7 → 5.7 | 16% → 9% | 1277k → 670k |
| MAD-SSG | A332 | 1.0 → 1.0 | 83% → 74% | 0 → 0 | 6.1 → 5.6 | 5.4 → 5.4 | 11% → 5% | 913k → 383k |
| MAD-VVI | A332 | 1.0 → 1.0 | 100% → 96% | 406 → 408 | 5.1 → 4.9 | 4.9 → 4.9 | 5% → 1% | 664k → 153k |
| MAD-HAV | B763 | 3.0 → 2.0 | 99% → 97% | 419 → 421 | 6.0 → 5.8 | 5.6 → 5.6 | 6% → 2% | 2478k → 620k |
| MAD-HAV | A332 | 3.0 → 2.0 | 98% → 95% | 420 → 422 | 5.9 → 5.7 | 5.3 → 5.3 | 10% → 6% | 4383k → 1706k |
| RIX-LGW | A320 | 3.0 → 4.0 | 91% → 100% | 110 → 109 | 7.7 → 8.0 | 8.1 → 8.1 | -6% → -1% | -436k → -137k |
| RIX-LGW | A321 | 3.0 → 4.0 | 91% → 99% | 112 → 111 | 7.7 → 8.0 | 7.9 → 7.9 | -3% → 2% | -226k → 226k |
| RIX-DUB | A320 | 1.0 → 1.0 | 91% → 98% | 122 → 121 | 7.1 → 7.5 | 7.9 → 8.0 | -12% → -6% | -280k → -148k |
| RIX-DUB | A321 | 1.0 → 1.0 | 91% → 98% | 124 → 123 | 7.1 → 7.6 | 7.6 → 7.7 | -7% → -1% | -202k → -34k |
| RIX-OSL | A320 | 2.0 → 3.0 | 91% → 96% | 92 → 91 | 13.2 → 13.4 | 12.7 → 12.5 | 4% → 7% | 145k → 423k |
| RIX-OSL | A321 | 2.0 → 3.0 | 91% → 93% | 94 → 93 | 13.2 → 13.2 | 12.2 → 11.9 | 8% → 9% | 337k → 633k |
| RIX-TFS | A320 | 1.0 s → 1.0 s | 71% → 83% | 294 → 289 | 5.0 → 5.8 | 5.8 → 5.9 | -16% → -2% | -356k → -57k |
| RIX-TFS | A321 | 1.0 s → 1.0 s | 66% → 81% | 296 → 291 | 4.7 → 5.7 | 5.6 → 5.7 | -18% → 0% | -460k → -8k |
| RIX-TFS | B763 | 1.0 s → 1.0 s | 95% → 87% | 285 → 288 | 6.5 → 6.0 | 6.2 → 6.1 | 6% → -1% | 264k → -55k |
| RIX-TFS | A332 | 1.0 s → 1.0 s | 93% → 84% | 285 → 288 | 6.4 → 5.8 | 5.8 → 5.8 | 9% → 2% | 474k → 74k |
| RIX-SSH | A320 | 1.0 s → 1.0 s | 91% → 96% | 243 → 242 | 7.3 → 7.6 | 6.5 → 6.5 | 11% → 15% | 255k → 373k |
| RIX-SSH | A321 | 1.0 s → 1.0 s | 91% → 91% | 241 → 241 | 7.2 → 7.2 | 6.3 → 6.2 | 13% → 14% | 354k → 391k |
| RIX-SSH | B763 | 1.0 s → 1.0 s | 95% → 86% | 238 → 239 | 7.4 → 6.8 | 6.6 → 6.4 | 12% → 5% | 463k → 167k |
| RIX-SSH | A332 | 1.0 s → 1.0 s | 93% → 84% | 238 → 239 | 7.3 → 6.6 | 6.2 → 6.1 | 15% → 7% | 631k → 270k |
| RIX-TBS | A320 | 1.0 → 1.0 | 91% → 96% | 175 → 175 | 8.2 → 8.7 | 7.5 → 7.5 | 9% → 13% | 292k → 454k |
| RIX-TBS | A321 | 1.0 → 1.0 | 91% → 93% | 178 → 178 | 8.3 → 8.6 | 7.3 → 7.2 | 12% → 16% | 472k → 615k |
| RIX-TAS | A320 | 1.0 → 1.0 | 90% → 88% | 236 → 236 | 6.8 → 6.7 | 6.5 → 6.3 | 5% → 5% | 224k → 229k |
| RIX-TAS | A321 | 1.0 → 1.0 | 87% → 84% | 237 → 239 | 6.6 → 6.4 | 6.2 → 6.1 | 6% → 5% | 287k → 233k |
| RIX-TAS | B763 | 1.0 → 1.0 | 78% → 70% | 237 → 239 | 5.9 → 5.3 | 6.3 → 6.2 | -8% → -17% | -454k → -901k |
| RIX-TAS | A332 | 1.0 → 1.0 | 72% → 64% | 238 → 241 | 5.4 → 4.9 | 5.9 → 5.8 | -9% → -19% | -543k → -1038k |
| RIX-JFK | B763 | 1.0 → 1.0 | 88% → 82% | 419 → 424 | 6.1 → 5.8 | 5.5 → 5.5 | 9% → 5% | 1074k → 535k |
| RIX-JFK | A332 | 1.0 → 1.0 | 84% → 78% | 425 → 430 | 5.8 → 5.5 | 5.2 → 5.2 | 11% → 6% | 1405k → 722k |
| PRG-AYT | A320 | 1.0 s → 1.0 s | 91% → 100% | 172 → 171 | 8.9 → 9.7 | 8.2 → 8.3 | 8% → 14% | 142k → 275k |
| PRG-AYT | A321 | 1.0 s → 1.0 s | 91% → 100% | 174 → 173 | 9.0 → 9.7 | 8.0 → 8.0 | 11% → 17% | 235k → 394k |
| PRG-HRG | A320 | 1.0 → 1.0 | 91% → 99% | 201 → 199 | 6.6 → 7.1 | 6.6 → 6.6 | 0% → 7% | 11k → 265k |
| PRG-HRG | A321 | 1.0 → 1.0 | 91% → 99% | 203 → 200 | 6.6 → 7.1 | 6.4 → 6.4 | 4% → 10% | 147k → 426k |
| PRG-HRG | B763 | 1.0 → 1.0 | 100% → 99% | 197 → 196 | 7.1 → 7.0 | 6.7 → 6.7 | 5% → 4% | 275k → 212k |
| PRG-HRG | A332 | 1.0 → 1.0 | 99% → 98% | 196 → 195 | 7.0 → 6.9 | 6.4 → 6.4 | 9% → 7% | 583k → 442k |
| PRG-RMF | A320 | 1.0 → 1.0 | 91% → 99% | 185 → 183 | 5.7 → 6.2 | 6.4 → 6.5 | -12% → -5% | -391k → -166k |
| PRG-RMF | A321 | 1.0 → 1.0 | 91% → 98% | 185 → 183 | 5.7 → 6.1 | 6.2 → 6.2 | -9% → -2% | -334k → -90k |
| PRG-RMF | B763 | 1.0 → 1.0 | 99% → 98% | 181 → 180 | 6.1 → 6.0 | 6.6 → 6.6 | -8% → -10% | -448k → -544k |
| PRG-RMF | A332 | 1.0 → 1.0 | 99% → 96% | 180 → 179 | 6.0 → 5.9 | 6.3 → 6.3 | -4% → -7% | -225k → -392k |
| PRG-TFS | A320 | 1.0 → 1.0 | 91% → 94% | 235 → 237 | 6.5 → 6.8 | 6.3 → 6.3 | 4% → 8% | 171k → 343k |
| PRG-TFS | A321 | 1.0 → 1.0 | 90% → 91% | 234 → 238 | 6.5 → 6.6 | 6.1 → 6.0 | 6% → 9% | 295k → 420k |
| PRG-TFS | B763 | 1.0 → 1.0 | 90% → 80% | 237 → 240 | 6.5 → 5.9 | 6.3 → 6.2 | 2% → -6% | 151k → -329k |
| PRG-TFS | A332 | 1.0 → 1.0 | 85% → 76% | 239 → 241 | 6.2 → 5.6 | 6.0 → 5.9 | 4% → -5% | 272k → -314k |
| PRG-HER | A320 | 1.0 s → 1.0 s | 91% → 100% | 172 → 171 | 9.3 → 10.2 | 8.3 → 8.5 | 11% → 17% | 161k → 275k |
| PRG-HER | A321 | 1.0 s → 1.0 s | 91% → 100% | 174 → 173 | 9.4 → 10.2 | 8.1 → 8.2 | 14% → 20% | 248k → 386k |
| PRG-DJE | A320 | 1.0 s → 1.0 s | 91% → 100% | 174 → 173 | 9.5 → 10.3 | 8.4 → 8.5 | 12% → 17% | 176k → 285k |
| PRG-DJE | A321 | 1.0 s → 1.0 s | 91% → 99% | 175 → 174 | 9.5 → 10.3 | 8.1 → 8.2 | 15% → 20% | 265k → 389k |
| PRG-TLV | A320 | 2.0 → 3.0 | 91% → 97% | 184 → 183 | 7.4 → 7.7 | 6.9 → 6.8 | 6% → 11% | 431k → 1192k |
| PRG-TLV | A321 | 2.0 → 3.0 | 91% → 93% | 188 → 186 | 7.4 → 7.5 | 6.7 → 6.5 | 10% → 12% | 778k → 1485k |
| PRG-TLV | B763 | 2.0 → 3.0 | 97% → 78% | 182 → 190 | 7.6 → 6.3 | 7.2 → 6.8 | 6% → -8% | 675k → -1064k |
| PRG-TLV | A332 | 2.0 → 3.0 | 93% → 73% | 185 → 192 | 7.4 → 6.0 | 6.7 → 6.4 | 9% → -7% | 1086k → -1068k |
| PRG-HAN | B763 | 1.0 → 1.0 | 100% → 94% | 441 → 443 | 5.8 → 5.5 | 5.3 → 5.2 | 9% → 5% | 1167k → 621k |
| PRG-HAN | A332 | 1.0 → 1.0 | 100% → 94% | 441 → 443 | 5.8 → 5.5 | 5.0 → 5.0 | 13% → 9% | 1996k → 1215k |
| SOF-STN | A320 | 1.0 → 1.0 | 91% → 100% | 97 → 96 | 5.8 → 6.3 | 7.7 → 7.8 | -31% → -23% | -641k → -506k |
| SOF-STN | A321 | 1.0 → 1.0 | 91% → 100% | 99 → 98 | 5.9 → 6.4 | 7.4 → 7.5 | -26% → -18% | -633k → -465k |
| SOF-FRA | A320 | 2.0 → 3.0 | 91% → 96% | 129 → 128 | 10.4 → 10.5 | 9.6 → 9.4 | 8% → 11% | 390k → 854k |
| SOF-FRA | A321 | 2.0 → 3.0 | 91% → 93% | 131 → 131 | 10.4 → 10.4 | 9.2 → 9.0 | 11% → 13% | 664k → 1179k |
| SOF-MAD | A320 | 1.0 → 1.0 | 91% → 99% | 104 → 103 | 5.4 → 5.8 | 7.3 → 7.4 | -34% → -26% | -734k → -601k |
| SOF-MAD | A321 | 1.0 → 1.0 | 91% → 100% | 106 → 104 | 5.5 → 5.9 | 7.0 → 7.1 | -29% → -21% | -726k → -558k |
| SOF-MXP | A320 | 1.0 → 2.0 | 91% → 99% | 91 → 90 | 8.9 → 9.4 | 10.2 → 9.8 | -14% → -5% | -274k → -185k |
| SOF-MXP | A321 | 1.0 → 2.0 | 91% → 98% | 93 → 92 | 9.0 → 9.4 | 9.8 → 9.5 | -10% → -1% | -214k → -44k |
| SOF-TLV | A320 | 2.0 → 3.0 | 91% → 97% | 131 → 129 | 9.2 → 9.6 | 8.6 → 8.5 | 7% → 11% | 328k → 851k |
| SOF-TLV | A321 | 2.0 → 3.0 | 91% → 93% | 133 → 131 | 9.3 → 9.3 | 8.4 → 8.2 | 10% → 12% | 595k → 1064k |
| SOF-HRG | A320 | 1.0 s → 1.0 s | 90% → 88% | 172 → 173 | 8.7 → 8.6 | 7.7 → 7.6 | 12% → 11% | 269k → 248k |
| SOF-HRG | A321 | 1.0 s → 1.0 s | 88% → 82% | 172 → 173 | 8.5 → 8.0 | 7.4 → 7.2 | 14% → 10% | 356k → 247k |
| SOF-AYT | A320 | 1.0 s → 1.0 s | 91% → 95% | 119 → 120 | 14.1 → 14.7 | 12.2 → 12.3 | 13% → 17% | 171k → 222k |
| SOF-AYT | A321 | 1.0 s → 1.0 s | 90% → 93% | 119 → 120 | 13.9 → 14.4 | 11.6 → 11.7 | 16% → 19% | 244k → 289k |
| SOF-ORD | B763 | 1.0 → 1.0 | 77% → 71% | 540 → 545 | 5.4 → 5.0 | 5.1 → 5.0 | 7% → 0% | 862k → -6k |
| SOF-ORD | A332 | 1.0 → 1.0 | 73% → 67% | 546 → 550 | 5.2 → 4.8 | 4.8 → 4.8 | 8% → 1% | 1127k → 84k |
| TLL-STN | A320 | 1.0 → 1.0 | 91% → 100% | 110 → 109 | 7.3 → 7.9 | 8.4 → 8.5 | -15% → -8% | -335k → -189k |
| TLL-STN | A321 | 1.0 → 1.0 | 91% → 100% | 112 → 111 | 7.3 → 7.9 | 8.1 → 8.2 | -11% → -4% | -273k → -98k |
| TLL-ARN | A320 | 3.0 → 3.0 | 91% → 92% | 87 → 87 | 24.8 → 24.3 | 22.2 → 22.1 | 10% → 9% | 532k → 465k |
| TLL-ARN | A321 | 3.0 → 3.0 | 91% → 87% | 89 → 90 | 24.9 → 23.6 | 21.4 → 20.9 | 14% → 11% | 826k → 627k |
| TLL-OSL | A320 | 1.0 → 1.0 | 91% → 99% | 98 → 97 | 14.4 → 15.6 | 14.1 → 14.4 | 3% → 8% | 50k → 161k |
| TLL-OSL | A321 | 1.0 → 1.0 | 91% → 98% | 100 → 99 | 14.5 → 15.6 | 13.5 → 13.8 | 7% → 12% | 163k → 287k |
| TLL-DUB | A320 | 1.0 → 1.0 | 91% → 89% | 125 → 126 | 6.8 → 6.7 | 7.7 → 7.6 | -14% → -14% | -330k → -320k |
| TLL-DUB | A321 | 1.0 → 1.0 | 86% → 82% | 129 → 130 | 6.6 → 6.3 | 7.4 → 7.2 | -12% → -14% | -313k → -371k |
| TLL-TFS | A320 | 1.0 s → 1.0 s | 65% → 77% | 306 → 301 | 4.6 → 5.3 | 5.7 → 5.8 | -23% → -9% | -501k → -217k |
| TLL-TFS | B763 | 1.0 s → 1.0 s | 94% → 85% | 295 → 298 | 6.4 → 5.9 | 6.1 → 6.0 | 5% → -2% | 257k → -88k |
| TLL-TFS | A332 | 1.0 s → 1.0 s | 91% → 82% | 295 → 298 | 6.2 → 5.7 | 5.8 → 5.7 | 7% → -1% | 389k → -29k |
| TLL-AYT | A320 | 1.0 s → 1.0 s | 91% → 98% | 200 → 200 | 8.0 → 8.5 | 7.2 → 7.2 | 10% → 15% | 201k → 334k |
| TLL-AYT | A321 | 1.0 s → 1.0 s | 91% → 96% | 202 → 202 | 8.0 → 8.4 | 7.0 → 7.0 | 13% → 17% | 306k → 433k |
| TLL-AYT | B763 | 1.0 s → 1.0 s | 98% → 93% | 198 → 200 | 8.4 → 8.1 | 7.3 → 7.2 | 13% → 11% | 459k → 360k |
| TLL-AYT | A332 | 1.0 s → 1.0 s | 96% → 92% | 199 → 200 | 8.3 → 8.0 | 6.9 → 6.9 | 17% → 14% | 644k → 520k |
| TLL-HRG | A320 | 1.0 s → 1.0 s | 91% → 91% | 259 → 260 | 7.0 → 7.0 | 6.4 → 6.4 | 8% → 9% | 207k → 231k |
| TLL-HRG | A321 | 1.0 s → 1.0 s | 90% → 87% | 258 → 259 | 6.9 → 6.7 | 6.2 → 6.1 | 10% → 8% | 292k → 241k |
| TLL-HRG | B763 | 1.0 s → 1.0 s | 91% → 82% | 256 → 258 | 6.9 → 6.3 | 6.3 → 6.1 | 10% → 2% | 384k → 76k |
| TLL-HRG | A332 | 1.0 s → 1.0 s | 87% → 79% | 257 → 258 | 6.6 → 6.0 | 5.9 → 5.8 | 11% → 3% | 466k → 138k |
| TLL-HKT | B763 | 0.2 s → 0.2 s | 96% → 92% | 604 → 608 | 7.4 → 7.1 | 6.5 → 6.5 | 12% → 8% | 229k → 158k |
| TLL-HKT | A332 | 0.2 s → 0.2 s | 95% → 91% | 606 → 609 | 7.3 → 7.0 | 6.2 → 6.1 | 15% → 12% | 337k → 254k |

### Cost per block hour, two-class: before → after (USD)

| market | type | fuel | crew | maint | aircraft | nav | landing+pax | handling | catering+services | distribution | overheads | disruption | total | revenue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 | 1956 | 390 → 472 | 900 | 980 | 591 → 477 | 384 → 381 | 560 | 791 → 742 | 624 → 595 | 559 | 255 → 251 | 8112 → 8054 | 10184 → 10033 |
| LIS-OXB | A321 | 2269 | 390 → 472 | 1000 | 1200 | 658 → 522 | 426 → 422 | 560 | 851 → 782 | 679 → 635 | 559 | 283 → 275 | 9057 → 8953 | 11311 → 11006 |
| LIS-OXB | B763 | 4146 | 553 → 669 | 1700 | 840 | 828 → 753 | 728 → 721 | 1141 | 961 → 859 | 789 → 711 | 570 | 337 → 308 | 12870 → 12695 | 13476 → 12323 |
| LIS-OXB | A332 | 4537 | 620 → 750 | 1550 | 1120 | 909 → 874 | 794 → 787 | 1164 | 987 → 882 | 811 → 731 | 582 | 346 → 317 | 13701 → 13575 | 13844 → 12662 |
| LIS-TMS | A320 | 1964 | 484 → 585 | 900 | 980 | 568 → 459 | 249 → 250 | 380 | 623 → 631 | 0 | 185 | 0 | 6423 → 6450 | 7950 → 7427 |
| LIS-TMS | B763 | 4164 | 685 → 827 | 1700 | 840 | 804 → 730 | 494 → 489 | 781 | 1016 → 908 | 0 | 190 | 0 | 10878 → 10834 | 11833 → 11036 |
| LIS-TMS | A332 | 4557 | 751 → 908 | 1550 | 1120 | 877 → 843 | 536 → 530 | 792 | 1053 → 941 | 0 | 192 | 0 | 11636 → 11642 | 12196 → 11470 |
| LIS-DIL | B763 | 3949 | 768 → 910 | 1700 | 840 | 545 → 495 | 368 → 367 | 426 | 439 → 396 | 1191 → 1083 | 941 | 310 → 282 | 11547 → 11460 | 12386 → 11271 |
| LIS-RAI | A320 | 1911 | 390 → 472 | 900 | 980 | 452 → 365 | 361 → 366 | 524 | 797 → 849 | 554 → 595 | 543 | 203 → 218 | 7731 → 7852 | 8135 → 8731 |
| LIS-RAI | A321 | 2216 | 390 → 472 | 1000 | 1200 | 503 → 399 | 400 → 406 | 524 | 897 → 963 | 612 → 669 | 543 | 228 → 252 | 8648 → 8833 | 9123 → 10084 |
| LIS-RAI | B763 | 4051 | 553 → 669 | 1700 | 840 | 634 → 576 | 705 → 697 | 1068 | 1301 → 1198 | 926 → 856 | 554 | 336 → 315 | 12860 → 12716 | 13455 → 12587 |
| LIS-RAI | A332 | 4433 | 620 → 750 | 1550 | 1120 | 695 → 669 | 774 → 763 | 1090 | 1437 → 1305 | 1022 → 933 | 565 | 371 → 343 | 13875 → 13719 | 14838 → 13717 |
| LIS-SID | A320 | 1911 | 390 → 472 | 900 | 980 | 460 → 371 | 377 → 380 | 544 | 832 → 852 | 705 → 734 | 519 | 203 → 211 | 7877 → 7930 | 8111 → 8445 |
| LIS-SID | A321 | 2216 | 390 → 472 | 1000 | 1200 | 512 → 407 | 422 | 544 | 958 → 939 | 815 → 818 | 519 | 234 | 8866 → 8826 | 9348 → 9371 |
| LIS-SID | B763 | 4051 | 553 → 669 | 1700 | 840 | 646 → 587 | 733 → 721 | 1111 | 1292 → 1146 | 1145 → 1025 | 530 | 326 → 292 | 12983 → 12729 | 13047 → 11692 |
| LIS-SID | A332 | 4433 | 620 → 750 | 1550 | 1120 | 710 → 683 | 804 → 791 | 1135 | 1390 → 1230 | 1245 → 1112 | 542 | 354 → 317 | 13960 → 13720 | 14168 → 12670 |
| LIS-BVC | A320 | 1938 | 390 → 472 | 900 | 980 | 451 → 364 | 350 → 345 | 533 | 765 → 698 | 781 → 721 | 509 | 218 → 201 | 7845 → 7691 | 8718 → 8051 |
| LIS-BVC | A321 | 2248 | 390 → 472 | 1000 | 1200 | 502 → 398 | 386 → 381 | 533 | 790 → 733 | 814 → 770 | 509 | 227 → 215 | 8629 → 8489 | 9085 → 8583 |
| LIS-BVC | B763 | 4108 | 553 → 669 | 1700 | 840 | 633 → 575 | 654 → 647 | 1088 | 857 → 765 | 898 → 809 | 519 | 250 → 225 | 12130 → 11977 | 9994 → 9012 |
| LIS-BVC | A332 | 4495 | 620 → 750 | 1550 | 1120 | 695 → 668 | 713 → 706 | 1111 | 875 → 781 | 917 → 826 | 530 | 255 → 230 | 12913 → 12801 | 10207 → 9204 |
| LIS-LAD | B763 | 4023 | 661 → 777 | 1700 | 840 | 798 → 726 | 471 → 466 | 666 | 968 → 901 | 703 → 657 | 190 | 311 → 285 | 11566 → 11374 | 12442 → 11385 |
| LIS-LAD | A332 | 4403 | 755 → 885 | 1550 | 1120 | 869 → 835 | 514 → 507 | 673 | 1084 → 996 | 788 → 727 | 192 | 346 → 314 | 12530 → 12348 | 13858 → 12579 |
| LIS-MPM | B763 | 4124 | 628 → 744 | 1700 | 840 | 730 → 663 | 294 → 291 | 437 | 762 → 691 | 501 → 457 | 233 | 241 → 221 | 10593 → 10506 | 9625 → 8859 |
| LIS-MPM | A332 | 4514 | 715 → 845 | 1550 | 1120 | 805 → 774 | 322 → 319 | 447 | 812 → 733 | 532 → 483 | 239 | 257 → 235 | 11421 → 11367 | 10266 → 9403 |
| LIS-REC | B763 | 3965 | 659 → 775 | 1700 | 840 | 485 → 441 | 406 → 401 | 577 | 953 → 878 | 696 → 647 | 299 | 298 → 279 | 11042 → 10965 | 11931 → 11160 |
| LIS-REC | A332 | 4340 | 753 → 883 | 1550 | 1120 | 532 → 512 | 446 → 440 | 587 | 1071 → 969 | 785 → 717 | 304 | 335 → 308 | 11989 → 11894 | 13388 → 12323 |
| LIS-FOR | B763 | 3966 | 663 → 780 | 1700 | 840 | 492 → 447 | 413 → 407 | 600 | 960 → 864 | 692 → 629 | 311 | 292 → 268 | 11065 → 10946 | 11682 → 10708 |
| LIS-FOR | A332 | 4339 | 759 → 889 | 1550 | 1120 | 540 → 519 | 454 → 447 | 614 | 1053 → 945 | 763 → 692 | 318 | 322 → 294 | 11974 → 11868 | 12873 → 11766 |
| OPO-RAI | A320 | 1911 | 390 → 472 | 900 | 980 | 454 → 359 | 313 → 309 | 469 → 460 | 739 → 746 | 559 → 574 | 2014 → 1510 | 212 → 216 | 9017 → 8536 | 8478 → 8655 |
| OPO-RAI | A321 | 2216 | 390 → 472 | 1000 | 1200 | 505 → 394 | 344 → 340 | 469 → 460 | 790 → 791 | 586 → 609 | 2014 → 1510 | 224 → 230 | 9818 → 9324 | 8979 → 9209 |
| OPO-RAI | B763 | 4051 | 553 → 669 | 1700 | 840 | 636 → 567 | 611 → 587 | 956 → 937 | 1201 → 1008 | 933 → 800 | 2051 → 1538 | 344 → 298 | 13954 → 13115 | 13775 → 11931 |
| OPO-RAI | A332 | 4433 | 620 → 750 | 1550 | 1120 | 697 → 657 | 670 → 641 | 974 → 955 | 1318 → 1077 | 1028 → 859 | 2090 → 1567 | 379 → 320 | 14959 → 14053 | 15161 → 12816 |
| OPO-OXB | A320 | 1956 | 390 → 472 | 900 | 980 | 572 → 471 | 330 → 338 | 494 → 504 | 727 → 750 | 594 → 611 | 1558 → 2077 | 239 → 247 | 8846 → 9390 | 9557 → 9900 |
| OPO-OXB | A321 | 2269 | 390 → 472 | 1000 | 1200 | 636 → 515 | 367 → 376 | 494 → 504 | 797 → 829 | 658 → 684 | 1558 → 2077 | 265 → 276 | 9749 → 10287 | 10581 → 11044 |
| OPO-OXB | B763 | 4146 | 553 → 669 | 1700 | 840 | 800 → 742 | 627 → 644 | 1006 → 1025 | 923 → 991 | 786 → 839 | 1586 → 2115 | 316 → 337 | 13419 → 14135 | 12648 → 13484 |
| OPO-OXB | A332 | 4537 | 620 → 750 | 1550 | 1120 | 877 → 860 | 683 → 703 | 1024 → 1044 | 953 → 1048 | 814 → 894 | 1615 → 2154 | 328 → 360 | 14261 → 15109 | 13110 → 14390 |
| VNO-LTN | A320 | 1793 | 390 → 472 | 900 | 980 | 707 → 570 | 574 → 582 | 769 | 1270 → 1368 | 665 → 723 | 736 | 194 → 208 | 9098 → 9221 | 7742 → 8337 |
| VNO-LTN | A321 | 2079 | 390 → 472 | 1000 | 1200 | 786 → 624 | 639 → 651 | 769 | 1463 → 1614 | 746 → 841 | 736 | 218 → 243 | 10145 → 10349 | 8727 → 9703 |
| VNO-DUB | A320 | 1793 | 390 → 472 | 900 | 980 | 715 → 576 | 515 → 520 | 681 | 1098 → 1168 | 617 → 662 | 636 | 188 → 200 | 8576 → 8653 | 7504 → 8003 |
| VNO-DUB | A321 | 2079 | 390 → 472 | 1000 | 1200 | 795 → 631 | 576 → 583 | 681 | 1311 → 1379 | 723 → 779 | 636 | 220 → 236 | 9676 → 9741 | 8817 → 9428 |
| VNO-OSL | A320 | 1819 | 390 → 472 | 900 | 980 | 655 → 529 | 866 → 876 | 1200 | 1847 → 1977 | 904 → 977 | 1101 → 551 | 237 → 249 | 11050 → 10621 | 9484 → 9963 |
| VNO-OSL | A321 | 2110 | 390 → 472 | 1000 | 1200 | 729 → 579 | 969 → 980 | 1200 | 2204 → 2327 | 1059 → 1139 | 1101 → 551 | 278 → 291 | 12391 → 11941 | 11114 → 11651 |
| VNO-TFS | A320 | 1826 | 485 → 585 | 900 | 980 | 682 → 550 | 200 → 204 | 307 | 587 → 672 | 567 → 666 | 375 | 156 → 183 | 7090 → 7272 | 6220 → 7309 |
| VNO-TFS | A321 | 2118 | 485 → 585 | 1000 | 1200 | 759 → 603 | 222 → 228 | 307 | 660 → 784 | 627 → 772 | 375 | 172 → 212 | 7952 → 8209 | 6874 → 8470 |
| VNO-TFS | B763 | 3872 | 685 → 827 | 1700 | 840 | 962 → 874 | 406 → 403 | 626 | 1201 → 1113 | 1224 → 1147 | 383 | 335 → 314 | 12269 → 12134 | 13414 → 12566 |
| VNO-TFS | A332 | 4238 | 751 → 908 | 1550 | 1120 | 1063 → 1022 | 447 → 444 | 640 | 1353 → 1245 | 1385 → 1287 | 391 | 379 → 352 | 13355 → 13232 | 15177 → 14091 |
| VNO-AYT | A320 | 1810 | 390 → 472 | 900 | 980 | 713 → 575 | 434 → 438 | 577 | 1129 → 1218 | 860 → 936 | 766 | 244 → 265 | 8871 → 9006 | 9756 → 10617 |
| VNO-AYT | A321 | 2100 | 390 → 472 | 1000 | 1200 | 793 → 630 | 484 → 490 | 577 | 1346 → 1435 | 1010 → 1098 | 766 | 286 → 310 | 10024 → 10147 | 11428 → 12418 |
| VNO-TBS | A320 | 1868 | 390 → 472 | 900 | 980 | 934 → 753 | 417 → 419 | 568 | 1098 → 1135 | 704 → 735 | 636 | 240 → 249 | 8840 → 8821 | 9581 → 9978 |
| VNO-TBS | A321 | 2167 | 390 → 472 | 1000 | 1200 | 1038 → 825 | 466 → 467 | 568 | 1303 → 1301 | 821 → 834 | 636 | 280 → 285 | 9974 → 9859 | 11192 → 11382 |
| VNO-TLV | A320 | 1837 | 390 → 472 | 900 | 980 | 747 → 603 | 453 → 456 | 587 | 901 → 931 | 592 → 619 | 615 | 201 → 210 | 8247 → 8254 | 8041 → 8396 |
| VNO-TLV | A321 | 2131 | 390 → 472 | 1000 | 1200 | 831 → 660 | 505 → 507 | 587 | 1042 → 1046 | 681 → 697 | 615 | 232 → 237 | 9260 → 9198 | 9298 → 9497 |
| VNO-TLV | B763 | 3895 | 553 → 669 | 1700 | 840 | 1050 → 955 | 885 → 877 | 1200 | 1361 → 1243 | 935 → 854 | 629 | 317 → 290 | 13413 → 13201 | 12676 → 11604 |
| VNO-TLV | A332 | 4263 | 620 → 750 | 1550 | 1120 | 1129 → 1086 | 949 → 940 | 1200 | 1441 → 1295 | 994 → 892 | 629 | 338 → 304 | 14282 → 14078 | 13524 → 12168 |
| VNO-ORD | B763 | 3710 | 637 → 753 | 1700 | 840 | 639 → 581 | 560 → 555 | 531 | 959 → 890 | 622 → 581 | 283 | 294 → 276 | 10883 → 10809 | 11762 → 11039 |
| VNO-ORD | A332 | 4060 | 725 → 855 | 1550 | 1120 | 698 → 672 | 612 → 606 | 540 | 1040 → 959 | 680 → 631 | 288 | 321 → 299 | 11745 → 11690 | 12858 → 11978 |
| MLA-MAN | A320 | 1821 | 390 → 472 | 900 | 980 | 805 → 649 | 417 → 422 | 644 | 991 → 1070 | 654 → 711 | 574 | 195 → 211 | 8428 → 8513 | 7784 → 8453 |
| MLA-MAN | A321 | 2112 | 390 → 472 | 1000 | 1200 | 895 → 711 | 467 → 473 | 644 | 1183 → 1263 | 771 → 836 | 574 | 228 → 247 | 9522 → 9591 | 9126 → 9893 |
| MLA-GLA | A320 | 1838 | 390 → 472 | 900 | 980 | 821 → 662 | 324 | 541 | 786 → 764 | 597 → 594 | 482 | 174 → 173 | 7866 → 7762 | 6957 → 6914 |
| MLA-GLA | A321 | 2132 | 390 → 472 | 1000 | 1200 | 913 → 725 | 360 → 358 | 541 | 853 → 809 | 663 → 643 | 482 | 193 → 187 | 8759 → 8581 | 7701 → 7461 |
| MLA-GLA | B763 | 3896 | 553 → 669 | 1700 | 840 | 1152 → 1047 | 622 → 614 | 1107 | 1055 → 926 | 865 → 760 | 492 | 250 → 220 | 12566 → 12305 | 9991 → 8785 |
| MLA-GLA | A332 | 4264 | 620 → 750 | 1550 | 1120 | 1266 → 1217 | 682 → 673 | 1132 | 1108 → 966 | 916 → 797 | 503 | 264 → 230 | 13458 → 13237 | 10560 → 9209 |
| MLA-MJI | A320 | 1999 | 390 → 472 | 900 | 980 | 481 → 388 | 1347 → 1344 | 2400 | 4000 → 3938 | 2083 → 2050 | 2895 | 681 → 678 | 18564 → 18480 | 27254 → 27106 |
| MLA-MJI | A321 | 2318 | 390 → 472 | 1000 | 1200 | 534 → 424 | 1500 → 1493 | 2400 | 4665 → 4457 | 2375 → 2276 | 2895 | 781 → 755 | 20495 → 20127 | 31224 → 30208 |
| MLA-BEN | A320 | 1999 | 390 → 472 | 900 | 980 | 541 → 436 | 871 → 866 | 1613 | 2414 → 2262 | 0 | 1038 | 0 | 10980 → 10800 | 11103 → 11776 |
| MLA-BEN | A321 | 2318 | 390 → 472 | 1000 | 1200 | 601 → 477 | 965 → 958 | 1613 | 2696 → 2465 | 0 | 1038 | 0 | 12056 → 11776 | 11252 → 11814 |
| MLA-CTA | A320 | 1837 | 390 → 472 | 900 | 980 | 320 → 258 | 1512 → 1529 | 2600 | 4514 → 4837 | 1941 → 2102 | 769 → 1154 | 391 → 403 | 16605 → 17350 | 15638 → 16122 |
| MLA-CTA | A321 | 2131 | 390 → 472 | 1000 | 1200 | 356 → 283 | 1692 → 1710 | 2600 | 5379 → 5680 | 2268 → 2437 | 769 → 1154 | 454 → 467 | 18689 → 19411 | 18159 → 18699 |
| MLA-CPH | A320 | 1819 | 390 → 472 | 900 | 980 | 838 → 676 | 421 → 426 | 677 | 1042 → 1113 | 829 → 894 | 604 | 239 → 257 | 8777 → 8856 | 9543 → 10281 |
| MLA-CPH | A321 | 2110 | 390 → 472 | 1000 | 1200 | 932 → 740 | 471 → 476 | 677 | 1229 → 1282 | 973 → 1034 | 604 | 279 → 297 | 9904 → 9929 | 11167 → 11860 |
| MLA-LDE | A320 | 1864 | 390 → 472 | 900 | 980 | 833 → 672 | 539 → 547 | 859 | 1523 → 1581 | 1115 → 1174 | 3405 | 298 → 313 | 12590 → 12658 | 11903 → 12533 |
| MLA-LDE | A321 | 2162 | 390 → 472 | 1000 | 1200 | 926 → 735 | 606 → 610 | 859 | 1745 → 1751 | 1289 → 1316 | 3405 | 344 → 351 | 13803 → 13748 | 13764 → 14060 |
| MLA-JFK | B763 | 3771 | 638 → 754 | 1700 | 840 | 601 → 546 | 620 → 613 | 577 | 1077 → 989 | 679 → 633 | 360 | 319 → 299 | 11287 → 11188 | 12743 → 11953 |
| MLA-JFK | A332 | 4127 | 728 → 858 | 1550 | 1120 | 663 → 637 | 687 → 679 | 592 | 1009 → 919 | 772 → 713 | 369 | 361 → 336 | 12085 → 12008 | 14451 → 13443 |
| MAD-LPA | A320 | 1828 | 390 → 472 | 900 | 980 | 631 → 509 | 561 → 569 | 825 | 1270 → 1375 | 700 → 765 | 231 → 99 | 216 → 218 | 8801 → 8642 | 8643 → 8701 |
| MAD-LPA | A321 | 2121 | 390 → 472 | 1000 | 1200 | 701 → 557 | 628 → 637 | 825 | 1515 → 1633 | 821 → 899 | 231 → 99 | 254 → 256 | 9984 → 9802 | 10167 → 10238 |
| MAD-IBZ | A320 | 1837 | 390 → 472 | 900 | 980 | 446 → 357 | 1440 → 1447 | 2112 → 2094 | 3125 → 3369 | 1573 → 1718 | 1061 → 531 | 407 → 430 | 14411 → 14206 | 16266 → 17195 |
| MAD-IBZ | A321 | 2131 | 390 → 472 | 1000 | 1200 | 496 → 391 | 1612 → 1619 | 2112 → 2094 | 3730 → 3961 | 1842 → 2003 | 1061 → 531 | 477 → 504 | 16189 → 15979 | 19087 → 20164 |
| MAD-TNG | A320 | 1864 | 390 → 472 | 900 | 980 | 481 → 388 | 1221 → 1222 | 1757 | 3149 → 3121 | 1409 → 1418 | 560 | 365 → 357 | 13291 → 13139 | 14613 → 14299 |
| MAD-TNG | A321 | 2162 | 390 → 472 | 1000 | 1200 | 534 → 424 | 1363 → 1356 | 1757 | 3605 → 3421 | 1617 → 1563 | 560 | 418 → 396 | 14822 → 14413 | 16709 → 15859 |
| MAD-OTP | A320 | 1811 | 390 → 472 | 900 | 980 | 820 → 662 | 432 → 437 | 572 | 945 → 1013 | 502 → 543 | 515 | 148 → 158 | 8096 → 8143 | 5903 → 6323 |
| MAD-OTP | A321 | 2101 | 390 → 472 | 1000 | 1200 | 912 → 725 | 483 → 491 | 572 | 1128 → 1213 | 589 → 644 | 515 | 173 → 188 | 9144 → 9201 | 6929 → 7501 |
| MAD-SSG | A320 | 1972 | 497 → 579 | 900 | 980 | 590 → 476 | 321 → 323 | 429 | 733 → 784 | 0 | 218 | 0 | 6696 → 6730 | 8523 → 8309 |
| MAD-SSG | A321 | 2287 | 497 → 579 | 1000 | 1200 | 656 → 521 | 357 → 361 | 429 | 836 → 916 | 0 | 218 | 0 | 7539 → 7596 | 8672 → 8816 |
| MAD-SSG | B763 | 4180 | 698 → 814 | 1700 | 840 | 835 → 759 | 644 → 639 | 882 | 1296 → 1180 | 0 | 224 | 0 | 11438 → 11356 | 13605 → 12493 |
| MAD-SSG | A332 | 4574 | 801 → 931 | 1550 | 1120 | 911 → 876 | 702 → 696 | 896 | 1394 → 1267 | 0 | 227 | 0 | 12317 → 12279 | 13890 → 12939 |
| MAD-VVI | A332 | 4393 | 779 → 923 | 1550 | 1120 | 536 → 516 | 329 → 328 | 409 | 1126 → 1081 | 658 → 635 | 215 | 303 → 293 | 11559 → 11604 | 12127 → 11735 |
| MAD-HAV | B763 | 3986 | 699 → 828 | 1700 | 840 | 494 → 449 | 483 → 482 | 598 | 1200 → 1168 | 737 → 719 | 93 → 139 | 301 → 289 | 11266 → 11282 | 12031 → 11569 |
| MAD-HAV | A332 | 4359 | 720 → 850 | 1550 | 1120 | 544 → 523 | 533 → 532 | 612 | 1357 → 1315 | 836 → 811 | 95 → 142 | 340 → 326 | 12207 → 12227 | 13594 → 13037 |
| RIX-LGW | A320 | 1793 | 390 → 472 | 900 | 980 | 728 → 587 | 621 → 630 | 829 | 1290 → 1397 | 694 → 758 | 264 → 198 | 207 → 217 | 8818 → 8806 | 8286 → 8681 |
| RIX-LGW | A321 | 2079 | 390 → 472 | 1000 | 1200 | 810 → 643 | 695 → 705 | 829 | 1539 → 1642 | 813 → 882 | 264 → 198 | 243 → 254 | 9986 → 9951 | 9709 → 10158 |
| RIX-DUB | A320 | 1793 | 390 → 472 | 900 | 980 | 727 → 587 | 508 → 514 | 718 | 1144 → 1213 | 643 → 688 | 663 | 196 → 208 | 8730 → 8802 | 7821 → 8321 |
| RIX-DUB | A321 | 2079 | 390 → 472 | 1000 | 1200 | 809 → 642 | 569 → 576 | 718 | 1365 → 1430 | 753 → 809 | 663 | 230 → 245 | 9844 → 9902 | 9187 → 9792 |
| RIX-OSL | A320 | 1819 | 390 → 472 | 900 | 980 | 641 → 517 | 1002 → 1010 | 1483 | 2257 → 2356 | 1133 → 1192 | 673 → 449 | 306 → 312 | 11768 → 11574 | 12232 → 12477 |
| RIX-OSL | A321 | 2110 | 390 → 472 | 1000 | 1200 | 712 → 566 | 1122 → 1126 | 1483 | 2694 → 2713 | 1327 → 1355 | 673 → 449 | 358 → 357 | 13254 → 12916 | 14335 → 14269 |
| RIX-TFS | A320 | 1826 | 484 → 585 | 900 | 980 | 695 → 560 | 185 → 189 | 309 | 574 → 645 | 556 → 643 | 373 | 153 → 176 | 7061 → 7210 | 6109 → 7057 |
| RIX-TFS | A321 | 2119 | 484 → 585 | 1000 | 1200 | 772 → 613 | 206 → 211 | 309 | 632 → 740 | 608 → 738 | 373 | 167 → 202 | 7896 → 8114 | 6666 → 8094 |
| RIX-TFS | B763 | 3872 | 685 → 827 | 1700 | 840 | 967 → 879 | 372 → 369 | 626 | 1134 → 1035 | 1169 → 1075 | 378 | 320 → 294 | 12097 → 11928 | 12811 → 11779 |
| RIX-TFS | A332 | 4237 | 751 → 908 | 1550 | 1120 | 1067 → 1026 | 413 → 408 | 644 | 1273 → 1154 | 1322 → 1206 | 389 | 362 → 330 | 13164 → 13008 | 14486 → 13213 |
| RIX-SSH | A320 | 1837 | 390 → 472 | 900 | 980 | 679 → 548 | 255 → 257 | 387 | 707 → 733 | 781 → 821 | 526 | 214 → 226 | 7676 → 7704 | 8578 → 9021 |
| RIX-SSH | A321 | 2131 | 390 → 472 | 1000 | 1200 | 755 → 600 | 285 | 387 | 806 → 798 | 901 → 906 | 526 | 247 → 249 | 8649 → 8573 | 9899 → 9955 |
| RIX-SSH | B763 | 3895 | 553 → 669 | 1700 | 840 | 950 → 863 | 500 → 496 | 788 | 1119 → 1013 | 1294 → 1176 | 536 | 356 → 323 | 12561 → 12329 | 14225 → 12928 |
| RIX-SSH | A332 | 4263 | 620 → 750 | 1550 | 1120 | 1040 → 1000 | 549 → 544 | 802 | 1243 → 1119 | 1448 → 1309 | 546 | 398 → 360 | 13612 → 13394 | 15922 → 14382 |
| RIX-TBS | A320 | 1868 | 390 → 472 | 900 | 980 | 910 → 734 | 361 → 363 | 532 | 1016 → 1059 | 675 → 709 | 588 | 235 → 247 | 8553 → 8550 | 9395 → 9861 |
| RIX-TBS | A321 | 2167 | 390 → 472 | 1000 | 1200 | 1012 → 804 | 403 → 405 | 532 | 1212 → 1229 | 792 → 816 | 588 | 276 → 284 | 9671 → 9595 | 11033 → 11370 |
| RIX-TAS | A320 | 1793 | 390 → 472 | 900 | 980 | 1077 → 869 | 269 | 369 | 753 → 730 | 516 → 505 | 431 | 206 → 202 | 7801 → 7637 | 8225 → 8070 |
| RIX-TAS | A321 | 2079 | 390 → 472 | 1000 | 1200 | 1198 → 951 | 300 → 299 | 369 | 853 → 806 | 586 → 562 | 431 | 233 → 224 | 8757 → 8511 | 9300 → 8951 |
| RIX-TAS | B763 | 3800 | 553 → 669 | 1700 | 840 | 1505 → 1368 | 522 → 518 | 750 | 1030 → 918 | 724 → 650 | 438 | 285 → 257 | 12268 → 12029 | 11395 → 10297 |
| RIX-TAS | A332 | 4159 | 620 → 750 | 1550 | 1120 | 1678 → 1614 | 574 → 570 | 769 | 1093 → 978 | 771 → 694 | 450 | 303 → 275 | 13211 → 13051 | 12140 → 11004 |
| RIX-JFK | B763 | 3710 | 646 → 762 | 1700 | 840 | 660 → 600 | 682 → 676 | 606 | 938 → 878 | 670 → 632 | 327 | 309 → 293 | 11207 → 11143 | 12376 → 11726 |
| RIX-JFK | A332 | 4060 | 737 → 867 | 1550 | 1120 | 729 → 702 | 751 → 744 | 620 | 1032 → 960 | 742 → 695 | 334 | 343 → 323 | 12141 → 12098 | 13707 → 12902 |
| PRG-AYT | A320 | 1811 | 390 → 472 | 900 | 980 | 755 → 609 | 444 → 449 | 643 | 1129 → 1216 | 861 → 937 | 766 | 244 → 266 | 8994 → 9118 | 9772 → 10628 |
| PRG-AYT | A321 | 2101 | 390 → 472 | 1000 | 1200 | 839 → 667 | 496 → 502 | 643 | 1345 → 1433 | 1012 → 1100 | 766 | 286 → 311 | 10151 → 10265 | 11439 → 12431 |
| PRG-HRG | A320 | 1840 | 390 → 472 | 900 | 980 | 726 → 585 | 304 → 308 | 462 | 781 → 833 | 695 → 751 | 453 | 194 → 210 | 7730 → 7798 | 7756 → 8386 |
| PRG-HRG | A321 | 2134 | 390 → 472 | 1000 | 1200 | 807 → 641 | 340 → 344 | 462 | 925 → 966 | 816 → 873 | 453 | 227 → 244 | 8759 → 8794 | 9085 → 9740 |
| PRG-HRG | B763 | 3901 | 553 → 669 | 1700 | 840 | 1018 → 925 | 600 → 599 | 941 | 1316 → 1286 | 1211 → 1195 | 462 | 338 → 333 | 12885 → 12857 | 13508 → 13336 |
| PRG-HRG | A332 | 4269 | 620 → 750 | 1550 | 1120 | 1118 → 1075 | 661 → 660 | 960 | 1489 → 1447 | 1377 → 1348 | 471 | 384 → 376 | 14025 → 14031 | 15369 → 15052 |
| PRG-RMF | A320 | 1868 | 390 → 472 | 900 | 980 | 721 → 581 | 300 → 303 | 447 | 806 → 854 | 605 → 651 | 428 | 170 → 183 | 7621 → 7673 | 6800 → 7324 |
| PRG-RMF | A321 | 2167 | 390 → 472 | 1000 | 1200 | 802 → 637 | 335 → 339 | 447 | 939 → 978 | 705 → 752 | 428 | 198 → 211 | 8616 → 8635 | 7914 → 8447 |
| PRG-RMF | B763 | 3961 | 553 → 669 | 1700 | 840 | 1010 → 918 | 590 → 589 | 911 | 1333 → 1293 | 1042 → 1019 | 436 | 293 → 287 | 12675 → 12629 | 11717 → 11467 |
| PRG-RMF | A332 | 4334 | 620 → 750 | 1550 | 1120 | 1107 → 1065 | 650 → 648 | 928 | 1499 → 1447 | 1181 → 1147 | 444 | 332 → 323 | 13772 → 13762 | 13282 → 12909 |
| PRG-TFS | A320 | 1827 | 390 → 472 | 900 | 980 | 702 → 566 | 261 → 262 | 420 | 758 → 770 | 704 → 734 | 369 | 196 → 204 | 7521 → 7519 | 7849 → 8178 |
| PRG-TFS | A321 | 2119 | 390 → 472 | 1000 | 1200 | 780 → 620 | 292 | 420 | 870 → 859 | 813 → 829 | 369 | 227 → 231 | 8494 → 8426 | 9062 → 9233 |
| PRG-TFS | B763 | 3872 | 553 → 669 | 1700 | 840 | 979 → 890 | 506 → 500 | 854 | 1151 → 1032 | 1133 → 1028 | 375 | 315 → 285 | 12294 → 12062 | 12590 → 11419 |
| PRG-TFS | A332 | 4237 | 620 → 750 | 1550 | 1120 | 1071 → 1030 | 553 → 546 | 869 | 1244 → 1111 | 1242 → 1118 | 382 | 345 → 310 | 13248 → 13039 | 13789 → 12414 |
| PRG-HER | A320 | 1837 | 390 → 472 | 900 | 980 | 707 → 570 | 449 → 456 | 732 | 1195 → 1294 | 911 → 994 | 814 | 258 → 281 | 9217 → 9375 | 10310 → 11242 |
| PRG-HER | A321 | 2131 | 390 → 472 | 1000 | 1200 | 786 → 624 | 503 → 511 | 732 | 1426 → 1534 | 1071 → 1169 | 814 | 302 → 330 | 10400 → 10563 | 12081 → 13185 |
| PRG-DJE | A320 | 1864 | 390 → 472 | 900 | 980 | 670 → 540 | 449 → 454 | 709 | 1231 → 1319 | 949 → 1030 | 965 | 265 → 288 | 9381 → 9532 | 10613 → 11527 |
| PRG-DJE | A321 | 2162 | 390 → 472 | 1000 | 1200 | 745 → 592 | 502 → 508 | 709 | 1452 → 1536 | 1111 → 1200 | 965 | 310 → 335 | 10555 → 10688 | 12405 → 13408 |
| PRG-TLV | A320 | 1840 | 390 → 472 | 900 | 980 | 760 → 613 | 456 → 461 | 633 | 893 → 938 | 609 → 647 | 304 → 203 | 215 → 224 | 8053 → 7943 | 8600 → 8950 |
| PRG-TLV | A321 | 2134 | 390 → 472 | 1000 | 1200 | 845 → 671 | 511 → 513 | 633 | 1066 → 1063 | 715 → 731 | 304 → 203 | 253 → 254 | 9123 → 8908 | 10109 → 10163 |
| PRG-TLV | B763 | 3899 | 553 → 669 | 1700 | 840 | 1044 → 949 | 888 → 866 | 1280 | 1461 → 1198 | 1031 → 851 | 308 → 205 | 358 → 297 | 13435 → 12789 | 14300 → 11880 |
| PRG-TLV | A332 | 4267 | 620 → 750 | 1550 | 1120 | 1149 → 1105 | 977 → 951 | 1309 | 1619 → 1288 | 1147 → 920 | 315 → 210 | 399 → 322 | 14547 → 13827 | 15971 → 12893 |
| PRG-HAN | B763 | 3840 | 629 → 745 | 1700 | 840 | 920 → 836 | 294 → 293 | 381 | 1045 → 989 | 647 → 615 | 215 | 299 → 285 | 10907 → 10841 | 11951 → 11396 |
| PRG-HAN | A332 | 4203 | 716 → 846 | 1550 | 1120 | 1014 → 975 | 325 → 322 | 389 | 1201 → 1124 | 744 → 701 | 219 | 344 → 325 | 11946 → 11895 | 13766 → 13003 |
| SOF-STN | A320 | 1792 | 390 → 472 | 900 | 980 | 733 → 592 | 462 → 470 | 666 | 1113 → 1205 | 570 → 623 | 645 | 162 → 176 | 8522 → 8628 | 6495 → 7027 |
| SOF-STN | A321 | 2079 | 390 → 472 | 1000 | 1200 | 816 → 648 | 518 → 527 | 666 | 1329 → 1432 | 668 → 732 | 645 | 190 → 206 | 9608 → 9714 | 7605 → 8243 |
| SOF-FRA | A320 | 1793 | 390 → 472 | 900 | 980 | 747 → 603 | 866 → 873 | 1011 | 1505 → 1571 | 863 → 906 | 487 → 325 | 270 → 275 | 9957 → 9774 | 10789 → 10990 |
| SOF-FRA | A321 | 2079 | 390 → 472 | 1000 | 1200 | 831 → 660 | 970 → 973 | 1011 | 1796 → 1820 | 1012 → 1036 | 487 → 325 | 316 | 11238 → 10959 | 12657 → 12638 |
| SOF-MAD | A320 | 1793 | 390 → 472 | 900 | 980 | 686 → 554 | 453 → 458 | 623 | 1016 → 1093 | 534 → 580 | 658 | 153 → 165 | 8253 → 8342 | 6136 → 6608 |
| SOF-MAD | A321 | 2079 | 390 → 472 | 1000 | 1200 | 763 → 606 | 506 → 513 | 623 | 1212 → 1296 | 626 → 683 | 658 | 180 → 195 | 9306 → 9391 | 7210 → 7781 |
| SOF-MXP | A320 | 1810 | 390 → 472 | 900 | 980 | 721 → 581 | 731 → 741 | 1013 | 1693 → 1816 | 847 → 917 | 981 → 490 | 228 → 240 | 10418 → 10037 | 9101 → 9592 |
| SOF-MXP | A321 | 2100 | 390 → 472 | 1000 | 1200 | 802 → 637 | 819 → 830 | 1013 | 2021 → 2129 | 992 → 1064 | 981 → 490 | 267 → 280 | 11709 → 11291 | 10682 → 11184 |
| SOF-TLV | A320 | 1837 | 390 → 472 | 900 | 980 | 663 → 535 | 652 → 658 | 900 | 1401 → 1473 | 809 → 858 | 477 → 318 | 250 → 259 | 9352 → 9233 | 10005 → 10362 |
| SOF-TLV | A321 | 2131 | 390 → 472 | 1000 | 1200 | 737 → 585 | 730 → 733 | 900 | 1672 → 1671 | 948 → 968 | 477 → 318 | 294 → 293 | 10573 → 10314 | 11756 → 11725 |
| SOF-HRG | A320 | 1837 | 390 → 472 | 900 | 980 | 632 → 509 | 398 → 397 | 609 | 1066 → 1036 | 873 → 857 | 752 | 247 → 242 | 8692 → 8598 | 9874 → 9686 |
| SOF-HRG | A321 | 2131 | 390 → 472 | 1000 | 1200 | 702 → 558 | 444 → 440 | 609 | 1202 → 1116 | 998 → 935 | 752 | 282 → 264 | 9719 → 9485 | 11285 → 10572 |
| SOF-AYT | A320 | 1810 | 390 → 472 | 900 | 980 | 500 → 404 | 743 → 748 | 1078 | 2112 → 2167 | 1126 → 1184 | 1452 | 333 → 349 | 11529 → 11646 | 13307 → 13959 |
| SOF-AYT | A321 | 2100 | 390 → 472 | 1000 | 1200 | 556 → 442 | 831 → 834 | 1078 | 2456 → 2447 | 1308 → 1350 | 1452 | 385 → 397 | 12862 → 12877 | 15401 → 15882 |
| SOF-ORD | B763 | 3711 | 629 → 745 | 1700 | 840 | 617 → 561 | 480 → 475 | 477 | 808 → 739 | 581 → 534 | 257 | 281 → 260 | 10479 → 10397 | 11247 → 10392 |
| SOF-ORD | A332 | 4060 | 716 → 846 | 1550 | 1120 | 678 → 652 | 526 → 521 | 487 | 880 → 800 | 638 → 584 | 262 | 309 → 284 | 11325 → 11264 | 12349 → 11340 |
| TLL-STN | A320 | 1793 | 390 → 472 | 900 | 980 | 707 → 570 | 534 → 542 | 775 | 1250 → 1354 | 672 → 735 | 724 | 196 → 212 | 9018 → 9153 | 7830 → 8481 |
| TLL-STN | A321 | 2079 | 390 → 472 | 1000 | 1200 | 786 → 624 | 598 → 607 | 775 | 1492 → 1603 | 788 → 860 | 724 | 230 → 249 | 10160 → 10290 | 9192 → 9941 |
| TLL-ARN | A320 | 1810 | 390 → 472 | 900 | 980 | 481 → 388 | 1476 → 1478 | 2200 | 3386 → 3421 | 1670 → 1686 | 673 | 407 → 400 | 14572 → 14500 | 16276 → 15991 |
| TLL-ARN | A321 | 2100 | 390 → 472 | 1000 | 1200 | 534 → 424 | 1651 → 1642 | 2200 | 4036 → 3907 | 1952 → 1881 | 673 | 477 → 451 | 16414 → 16042 | 19061 → 18051 |
| TLL-OSL | A320 | 1819 | 390 → 472 | 900 | 980 | 622 → 502 | 1061 → 1075 | 1588 | 2390 → 2572 | 1227 → 1334 | 1425 | 331 → 357 | 12884 → 13174 | 13224 → 14266 |
| TLL-OSL | A321 | 2110 | 390 → 472 | 1000 | 1200 | 691 → 549 | 1188 → 1203 | 1588 | 2852 → 3032 | 1437 → 1551 | 1425 | 388 → 416 | 14422 → 14696 | 15526 → 16646 |
| TLL-DUB | A320 | 1793 | 390 → 472 | 900 | 980 | 733 → 592 | 501 → 500 | 717 | 1125 → 1106 | 637 → 630 | 654 | 190 → 188 | 8652 → 8564 | 7593 → 7538 |
| TLL-DUB | A321 | 2079 | 390 → 472 | 1000 | 1200 | 816 → 648 | 557 → 553 | 717 | 1286 → 1215 | 718 → 684 | 654 | 217 → 207 | 9667 → 9462 | 8664 → 8273 |
| TLL-TFS | A320 | 1826 | 484 → 585 | 900 | 980 | 692 → 558 | 177 → 180 | 301 | 516 → 579 | 514 → 593 | 358 | 141 → 162 | 6912 → 7043 | 5624 → 6486 |
| TLL-TFS | B763 | 3872 | 684 → 827 | 1700 | 840 | 975 → 886 | 362 → 358 | 617 | 1084 → 985 | 1161 → 1062 | 368 | 317 → 290 | 12013 → 11836 | 12692 → 11603 |
| TLL-TFS | A332 | 4237 | 751 → 907 | 1550 | 1120 | 1062 → 1022 | 395 → 391 | 625 | 1186 → 1073 | 1282 → 1166 | 373 | 350 → 318 | 12966 → 12815 | 14006 → 12738 |
| TLL-AYT | A320 | 1810 | 390 → 472 | 900 | 980 | 713 → 575 | 332 → 335 | 486 | 915 → 969 | 819 → 880 | 627 | 229 → 246 | 8260 → 8336 | 9165 → 9840 |
| TLL-AYT | A321 | 2100 | 390 → 472 | 1000 | 1200 | 793 → 630 | 371 → 374 | 486 | 1085 → 1113 | 961 → 1013 | 627 | 268 → 282 | 9340 → 9354 | 10717 → 11299 |
| TLL-AYT | B763 | 3838 | 553 → 669 | 1700 | 840 | 1002 → 911 | 657 → 654 | 994 | 1524 → 1446 | 1415 → 1363 | 642 | 394 → 379 | 13630 → 13505 | 15743 → 15161 |
| TLL-AYT | A332 | 4200 | 620 → 750 | 1550 | 1120 | 1103 → 1061 | 725 → 722 | 1017 | 1723 → 1631 | 1608 → 1549 | 657 | 447 → 430 | 14847 → 14761 | 17877 → 17210 |
| TLL-HRG | A320 | 1837 | 390 → 472 | 900 | 980 | 686 → 553 | 234 | 360 | 829 → 822 | 765 → 767 | 483 | 209 → 210 | 7691 → 7635 | 8364 → 8384 |
| TLL-HRG | A321 | 2131 | 390 → 472 | 1000 | 1200 | 762 → 605 | 261 → 260 | 360 | 943 → 902 | 879 → 850 | 483 | 240 → 232 | 8671 → 8514 | 9617 → 9296 |
| TLL-HRG | B763 | 3895 | 553 → 669 | 1700 | 840 | 974 → 885 | 464 → 460 | 744 | 982 → 889 | 1239 → 1124 | 500 | 339 → 307 | 12259 → 12042 | 13548 → 12295 |
| TLL-HRG | A332 | 4263 | 620 → 750 | 1550 | 1120 | 1065 → 1024 | 508 → 504 | 757 | 1066 → 971 | 1354 → 1237 | 508 | 370 → 338 | 13212 → 13052 | 14802 → 13524 |
| TLL-HKT | B763 | 3840 | 630 → 746 | 1700 | 840 | 982 → 893 | 258 → 257 | 346 | 1003 → 947 | 1422 → 1360 | 2054 | 383 → 366 | 13523 → 13414 | 15307 → 14646 |
| TLL-HKT | A332 | 4203 | 716 → 846 | 1550 | 1120 | 1074 → 1033 | 284 → 282 | 352 | 1132 → 1072 | 1610 → 1543 | 2095 | 433 → 415 | 14636 → 14578 | 17308 → 16594 |

### Business case, all-economy: before → after

| market | type | f a week | LF | $/pax | RASK ¢ | CASK ¢ | margin | result a year |
|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 | 1.0 → 1.0 | 81% → 76% | 226 → 232 | 7.1 → 7.0 | 6.2 → 6.2 | 12% → 12% | 497k → 477k |
| LIS-OXB | A321 | 1.0 → 1.0 | 72% → 68% | 229 → 238 | 6.5 → 6.5 | 5.7 → 5.7 | 12% → 12% | 528k → 550k |
| LIS-OXB | B763 | 1.0 → 1.0 | 57% → 51% | 237 → 241 | 5.4 → 4.9 | 5.7 → 5.6 | -6% → -14% | -298k → -680k |
| LIS-OXB | A332 | 1.0 → 1.0 | 53% → 48% | 237 → 241 | 5.1 → 4.6 | 5.5 → 5.5 | -10% → -19% | -507k → -911k |
| LIS-TMS | A320 | 1.0 → 1.0 | 64% → 66% | 0 → 0 | 6.0 → 5.6 | 4.8 → 4.8 | 21% → 13% | 1075k → 629k |
| LIS-TMS | B763 | 1.0 → 1.0 | 60% → 54% | 0 → 0 | 5.0 → 4.6 | 4.6 → 4.6 | 7% → 1% | 514k → 47k |
| LIS-TMS | A332 | 1.0 → 1.0 | 57% → 51% | 0 → 0 | 4.8 → 4.5 | 4.5 → 4.6 | 5% → -2% | 345k → -110k |
| LIS-DIL | B763 | 0.3 → 0.3 | 31% → 28% | 1881 → 1898 | 4.6 → 4.2 | 4.8 → 4.8 | -5% → -14% | -259k → -703k |
| LIS-RAI | A320 | 1.0 → 1.0 | 85% → 91% | 160 → 160 | 5.5 → 6.0 | 5.9 → 6.0 | -7% → -1% | -227k → -20k |
| LIS-RAI | A321 | 1.0 → 1.0 | 75% → 85% | 160 → 161 | 4.9 → 5.6 | 5.4 → 5.5 | -10% → 1% | -346k → 37k |
| LIS-RAI | B763 | 1.0 → 1.0 | 86% → 78% | 161 → 164 | 5.6 → 5.2 | 5.7 → 5.6 | -2% → -9% | -86k → -444k |
| LIS-RAI | A332 | 1.0 → 1.0 | 85% → 76% | 162 → 165 | 5.5 → 5.0 | 5.6 → 5.5 | -2% → -10% | -95k → -504k |
| LIS-SID | A320 | 1.0 → 1.0 | 85% → 93% | 168 → 171 | 5.8 → 6.5 | 6.1 → 6.2 | -4% → 4% | -124k → 138k |
| LIS-SID | A321 | 1.0 → 1.0 | 81% → 88% | 168 → 172 | 5.5 → 6.2 | 5.6 → 5.7 | -2% → 7% | -57k → 263k |
| LIS-SID | B763 | 1.0 → 1.0 | 84% → 75% | 175 → 177 | 5.9 → 5.3 | 5.9 → 5.8 | 1% → -8% | 45k → -403k |
| LIS-SID | A332 | 1.0 → 1.0 | 81% → 72% | 175 → 178 | 5.7 → 5.1 | 5.7 → 5.6 | -1% → -10% | -31k → -495k |
| LIS-BVC | A320 | 1.0 → 1.0 | 77% → 73% | 217 → 223 | 6.5 → 6.3 | 6.1 → 6.1 | 6% → 4% | 203k → 124k |
| LIS-BVC | A321 | 1.0 → 1.0 | 66% → 62% | 219 → 225 | 5.5 → 5.3 | 5.5 → 5.5 | 0% → -3% | 3k → -93k |
| LIS-BVC | B763 | 1.0 → 1.0 | 49% → 44% | 222 → 225 | 4.2 → 3.8 | 5.4 → 5.4 | -29% → -42% | -1121k → -1446k |
| LIS-BVC | A332 | 1.0 → 1.0 | 46% → 41% | 222 → 225 | 3.9 → 3.6 | 5.3 → 5.3 | -34% → -48% | -1321k → -1661k |
| LIS-LAD | B763 | 2.0 → 2.0 | 95% → 85% | 252 → 256 | 5.0 → 4.4 | 4.9 → 4.8 | 2% → -8% | 400k → -1346k |
| LIS-LAD | A332 | 2.0 → 2.0 | 93% → 83% | 253 → 257 | 4.9 → 4.3 | 4.9 → 4.8 | 1% → -10% | 121k → -1779k |
| LIS-MPM | B763 | 1.0 → 1.0 | 56% → 50% | 413 → 419 | 3.1 → 2.8 | 4.3 → 4.3 | -39% → -52% | -3267k → -3949k |
| LIS-MPM | A332 | 1.0 → 1.0 | 53% → 48% | 414 → 419 | 2.9 → 2.7 | 4.2 → 4.2 | -44% → -58% | -3695k → -4438k |
| LIS-REC | B763 | 1.0 → 1.0 | 97% → 87% | 255 → 259 | 4.9 → 4.5 | 4.7 → 4.7 | 4% → -4% | 339k → -330k |
| LIS-REC | A332 | 1.0 → 1.0 | 95% → 85% | 256 → 261 | 4.8 → 4.4 | 4.6 → 4.6 | 3% → -5% | 294k → -436k |
| LIS-FOR | B763 | 1.0 → 1.0 | 89% → 80% | 252 → 257 | 4.6 → 4.2 | 4.7 → 4.7 | -2% → -10% | -142k → -778k |
| LIS-FOR | A332 | 1.0 → 1.0 | 86% → 77% | 254 → 258 | 4.5 → 4.1 | 4.6 → 4.6 | -3% → -12% | -251k → -931k |
| OPO-RAI | A320 | 0.3 → 0.3 | 85% → 88% | 187 → 189 | 5.7 → 6.0 | 6.9 → 6.7 | -20% → -10% | -178k → -120k |
| OPO-RAI | A321 | 0.3 → 0.3 | 71% → 77% | 188 → 190 | 4.8 → 5.3 | 6.1 → 6.0 | -28% → -12% | -249k → -158k |
| OPO-RAI | B763 | 0.3 → 0.3 | 88% → 72% | 189 → 195 | 5.8 → 5.0 | 6.2 → 5.9 | -6% → -18% | -96k → -306k |
| OPO-RAI | A332 | 0.3 → 0.3 | 86% → 69% | 190 → 196 | 5.7 → 4.9 | 6.1 → 5.8 | -6% → -19% | -91k → -342k |
| OPO-OXB | A320 | 0.3 → 0.3 | 83% → 85% | 234 → 237 | 6.9 → 6.9 | 6.9 → 7.2 | 0% → -3% | -2k → -37k |
| OPO-OXB | A321 | 0.3 → 0.3 | 75% → 82% | 237 → 239 | 6.3 → 6.7 | 6.2 → 6.5 | 0% → 3% | 5k → 35k |
| OPO-OXB | B763 | 0.3 → 0.3 | 62% → 69% | 247 → 248 | 5.3 → 5.8 | 6.0 → 6.3 | -13% → -7% | -249k → -116k |
| OPO-OXB | A332 | 0.3 → 0.3 | 58% → 66% | 247 → 250 | 5.0 → 5.6 | 5.9 → 6.1 | -18% → -9% | -328k → -151k |
| VNO-LTN | A320 | 1.0 → 1.0 | 85% → 93% | 89 → 89 | 6.0 → 6.5 | 7.6 → 7.7 | -27% → -18% | -516k → -385k |
| VNO-LTN | A321 | 1.0 → 1.0 | 77% → 91% | 89 → 89 | 5.4 → 6.3 | 6.9 → 7.1 | -28% → -13% | -589k → -322k |
| VNO-DUB | A320 | 1.0 → 1.0 | 85% → 91% | 107 → 108 | 5.7 → 6.1 | 7.0 → 7.0 | -23% → -16% | -503k → -368k |
| VNO-DUB | A321 | 1.0 → 1.0 | 81% → 92% | 107 → 108 | 5.4 → 6.1 | 6.4 → 6.6 | -20% → -8% | -499k → -220k |
| VNO-OSL | A320 | 1.0 → 2.0 | 85% → 92% | 74 → 74 | 8.3 → 8.7 | 10.4 → 9.9 | -25% → -14% | -407k → -475k |
| VNO-OSL | A321 | 1.0 → 2.0 | 81% → 91% | 74 → 74 | 7.8 → 8.7 | 9.5 → 9.3 | -21% → -7% | -395k → -287k |
| VNO-TFS | A320 | 1.0 s → 1.0 s | 67% → 80% | 268 → 268 | 4.4 → 5.3 | 5.3 → 5.5 | -21% → -4% | -452k → -105k |
| VNO-TFS | A321 | 1.0 s → 1.0 s | 60% → 75% | 269 → 269 | 3.9 → 5.0 | 4.9 → 5.1 | -25% → -2% | -575k → -69k |
| VNO-TFS | B763 | 1.0 s → 1.0 s | 97% → 89% | 270 → 273 | 6.4 → 5.9 | 5.5 → 5.4 | 14% → 9% | 760k → 417k |
| VNO-TFS | A332 | 1.0 s → 1.0 s | 96% → 88% | 271 → 273 | 6.3 → 5.8 | 5.4 → 5.3 | 15% → 9% | 848k → 446k |
| VNO-AYT | A320 | 1.0 s → 1.0 s | 85% → 100% | 159 → 159 | 7.6 → 8.9 | 7.2 → 7.4 | 6% → 17% | 95k → 329k |
| VNO-AYT | A321 | 1.0 s → 1.0 s | 81% → 100% | 159 → 159 | 7.2 → 8.9 | 6.6 → 6.9 | 8% → 22% | 162k → 524k |
| VNO-TBS | A320 | 1.0 → 1.0 | 85% → 91% | 144 → 146 | 7.3 → 7.9 | 7.2 → 7.3 | 1% → 8% | 17k → 238k |
| VNO-TBS | A321 | 1.0 → 1.0 | 79% → 83% | 145 → 150 | 6.8 → 7.3 | 6.6 → 6.6 | 2% → 9% | 64k → 294k |
| VNO-TLV | A320 | 1.0 → 1.0 | 85% → 91% | 151 → 153 | 5.7 → 6.2 | 6.4 → 6.4 | -11% → -4% | -320k → -108k |
| VNO-TLV | A321 | 1.0 → 1.0 | 78% → 86% | 153 → 155 | 5.3 → 5.9 | 5.8 → 5.9 | -10% → 0% | -319k → 3k |
| VNO-TLV | B763 | 1.0 → 1.0 | 79% → 70% | 160 → 160 | 5.5 → 4.9 | 6.0 → 5.9 | -9% → -20% | -406k → -826k |
| VNO-TLV | A332 | 1.0 → 1.0 | 75% → 66% | 160 → 160 | 5.3 → 4.7 | 5.9 → 5.8 | -12% → -25% | -562k → -1039k |
| VNO-ORD | B763 | 1.0 → 1.0 | 74% → 68% | 400 → 404 | 4.3 → 4.0 | 4.5 → 4.5 | -3% → -11% | -363k → -1051k |
| VNO-ORD | A332 | 1.0 → 1.0 | 73% → 66% | 404 → 407 | 4.4 → 4.0 | 4.4 → 4.4 | -2% → -11% | -230k → -1093k |
| MLA-MAN | A320 | 1.0 → 1.0 | 85% → 99% | 135 → 135 | 5.8 → 6.8 | 6.6 → 6.8 | -14% → 0% | -361k → -15k |
| MLA-MAN | A321 | 1.0 → 1.0 | 81% → 99% | 135 → 135 | 5.5 → 6.7 | 6.1 → 6.3 | -11% → 6% | -329k → 213k |
| MLA-GLA | A320 | 1.0 → 1.0 | 79% → 80% | 153 → 157 | 5.2 → 5.5 | 6.2 → 6.2 | -19% → -13% | -482k → -352k |
| MLA-GLA | A321 | 1.0 → 1.0 | 70% → 72% | 155 → 160 | 4.7 → 5.0 | 5.7 → 5.6 | -20% → -14% | -561k → -412k |
| MLA-GLA | B763 | 1.0 → 1.0 | 63% → 55% | 162 → 162 | 4.4 → 3.8 | 5.7 → 5.6 | -30% → -46% | -1112k → -1493k |
| MLA-GLA | A332 | 1.0 → 1.0 | 59% → 52% | 162 → 162 | 4.1 → 3.6 | 5.6 → 5.5 | -34% → -52% | -1288k → -1695k |
| MLA-MJI | A320 | 1.0 → 1.0 | 84% → 82% | 112 → 115 | 36.3 → 36.6 | 25.9 → 25.8 | 29% → 29% | 679k → 696k |
| MLA-MJI | A321 | 1.0 → 1.0 | 76% → 74% | 113 → 116 | 33.0 → 32.9 | 23.0 → 22.9 | 30% → 31% | 790k → 800k |
| MLA-BEN | A320 | 1.0 → 1.0 | 68% → 63% | 0 → 0 | 11.4 → 12.4 | 11.4 → 11.2 | 1% → 10% | 9k → 152k |
| MLA-BEN | A321 | 1.0 → 1.0 | 58% → 52% | 0 → 0 | 9.4 → 9.9 | 10.1 → 9.9 | -7% → 0% | -109k → 1k |
| MLA-CTA | A320 | 3.0 → 2.0 | 85% → 94% | 48 → 48 | 31.7 → 33.4 | 35.0 → 36.9 | -10% → -11% | -344k → -248k |
| MLA-CTA | A321 | 3.0 → 2.0 | 81% → 94% | 48 → 48 | 29.7 → 33.2 | 32.0 → 34.5 | -8% → -4% | -289k → -115k |
| MLA-CPH | A320 | 1.0 → 1.0 | 85% → 98% | 163 → 164 | 7.2 → 8.3 | 7.0 → 7.1 | 3% → 14% | 93k → 481k |
| MLA-CPH | A321 | 1.0 → 1.0 | 81% → 96% | 163 → 165 | 6.8 → 8.1 | 6.4 → 6.6 | 6% → 18% | 203k → 746k |
| MLA-LDE | A320 | 0.3 s → 0.3 s | 85% → 97% | 162 → 163 | 9.3 → 10.6 | 10.2 → 10.5 | -10% → 2% | -39k → 8k |
| MLA-LDE | A321 | 0.3 s → 0.3 s | 81% → 95% | 162 → 163 | 8.8 → 10.4 | 9.2 → 9.5 | -4% → 9% | -18k → 48k |
| MLA-JFK | B763 | 1.0 s → 1.0 s | 89% → 81% | 380 → 387 | 5.1 → 4.7 | 4.7 → 4.7 | 8% → 1% | 615k → 69k |
| MLA-JFK | A332 | 1.0 s → 1.0 s | 88% → 79% | 381 → 388 | 5.1 → 4.6 | 4.6 → 4.5 | 10% → 2% | 854k → 185k |
| MAD-LPA | A320 | 3.0 → 7.0 | 85% → 96% | 101 → 101 | 6.5 → 6.7 | 7.1 → 7.1 | -10% → -6% | -659k → -871k |
| MAD-LPA | A321 | 3.0 → 7.0 | 81% → 98% | 101 → 101 | 6.1 → 6.8 | 6.6 → 6.7 | -8% → 2% | -579k → 314k |
| MAD-IBZ | A320 | 2.0 s → 4.0 s | 85% → 99% | 81 → 81 | 19.2 → 21.9 | 18.0 → 18.3 | 6% → 17% | 122k → 726k |
| MAD-IBZ | A321 | 2.0 s → 4.0 s | 81% → 97% | 81 → 82 | 18.1 → 21.6 | 16.4 → 17.0 | 10% → 21% | 214k → 1118k |
| MAD-TNG | A320 | 3.0 → 3.0 | 85% → 85% | 73 → 74 | 15.1 → 14.8 | 14.5 → 14.3 | 4% → 3% | 209k → 162k |
| MAD-TNG | A321 | 3.0 → 3.0 | 79% → 78% | 73 → 76 | 14.1 → 13.8 | 13.2 → 13.0 | 6% → 6% | 337k → 318k |
| MAD-OTP | A320 | 1.0 → 1.0 | 85% → 92% | 92 → 92 | 4.3 → 4.6 | 6.4 → 6.4 | -50% → -40% | -982k → -843k |
| MAD-OTP | A321 | 1.0 → 1.0 | 81% → 95% | 92 → 92 | 4.0 → 4.7 | 5.9 → 6.0 | -47% → -29% | -1058k → -765k |
| MAD-SSG | A320 | 1.0 → 1.0 | 72% → 77% | 0 → 0 | 6.2 → 6.1 | 5.0 → 5.0 | 20% → 17% | 1002k → 847k |
| MAD-SSG | A321 | 1.0 → 1.0 | 65% → 72% | 0 → 0 | 5.3 → 5.2 | 4.6 → 4.6 | 13% → 10% | 648k → 508k |
| MAD-SSG | B763 | 1.0 → 1.0 | 78% → 69% | 0 → 0 | 5.6 → 5.2 | 4.9 → 4.8 | 13% → 7% | 986k → 479k |
| MAD-SSG | A332 | 1.0 → 1.0 | 75% → 66% | 0 → 0 | 5.3 → 5.0 | 4.8 → 4.8 | 10% → 4% | 791k → 289k |
| MAD-VVI | A332 | 1.0 → 1.0 | 100% → 94% | 332 → 335 | 4.2 → 4.0 | 4.4 → 4.4 | -3% → -9% | -412k → -1078k |
| MAD-HAV | B763 | 3.0 → 2.0 | 96% → 93% | 349 → 350 | 4.8 → 4.7 | 4.8 → 4.9 | 0% → -4% | 37k → -836k |
| MAD-HAV | A332 | 3.0 → 2.0 | 93% → 92% | 351 → 351 | 4.8 → 4.6 | 4.7 → 4.8 | 1% → -3% | 350k → -620k |
| RIX-LGW | A320 | 3.0 → 4.0 | 85% → 94% | 96 → 96 | 6.4 → 6.8 | 7.4 → 7.3 | -15% → -9% | -904k → -735k |
| RIX-LGW | A321 | 3.0 → 4.0 | 81% → 95% | 96 → 96 | 6.0 → 6.8 | 6.8 → 6.9 | -12% → -1% | -877k → -127k |
| RIX-DUB | A320 | 1.0 → 1.0 | 85% → 91% | 107 → 108 | 6.0 → 6.4 | 7.2 → 7.2 | -20% → -13% | -439k → -308k |
| RIX-DUB | A321 | 1.0 → 1.0 | 81% → 92% | 107 → 108 | 5.6 → 6.4 | 6.6 → 6.7 | -17% → -5% | -424k → -140k |
| RIX-OSL | A320 | 2.0 → 3.0 | 85% → 89% | 80 → 80 | 11.1 → 11.3 | 11.3 → 11.1 | -2% → 2% | -82k → 82k |
| RIX-OSL | A321 | 2.0 → 3.0 | 81% → 86% | 80 → 81 | 10.5 → 10.9 | 10.4 → 10.3 | 1% → 6% | 25k → 353k |
| RIX-TFS | A320 | 1.0 s → 1.0 s | 66% → 77% | 269 → 270 | 4.3 → 5.1 | 5.3 → 5.4 | -23% → -7% | -479k → -174k |
| RIX-TFS | A321 | 1.0 s → 1.0 s | 59% → 72% | 268 → 271 | 3.8 → 4.7 | 4.9 → 5.0 | -27% → -6% | -618k → -166k |
| RIX-TFS | B763 | 1.0 s → 1.0 s | 92% → 83% | 273 → 275 | 6.1 → 5.5 | 5.4 → 5.3 | 11% → 4% | 565k → 175k |
| RIX-TFS | A332 | 1.0 s → 1.0 s | 90% → 82% | 273 → 275 | 6.0 → 5.4 | 5.3 → 5.2 | 11% → 4% | 603k → 192k |
| RIX-SSH | A320 | 1.0 s → 1.0 s | 85% → 94% | 228 → 229 | 6.4 → 7.1 | 5.9 → 6.0 | 7% → 15% | 163k → 391k |
| RIX-SSH | A321 | 1.0 s → 1.0 s | 81% → 90% | 228 → 230 | 6.1 → 6.8 | 5.5 → 5.6 | 9% → 18% | 251k → 536k |
| RIX-SSH | B763 | 1.0 s → 1.0 s | 93% → 84% | 230 → 231 | 7.0 → 6.4 | 5.8 → 5.6 | 18% → 11% | 763k → 432k |
| RIX-SSH | A332 | 1.0 s → 1.0 s | 91% → 82% | 230 → 231 | 6.8 → 6.2 | 5.7 → 5.6 | 17% → 11% | 779k → 433k |
| RIX-TBS | A320 | 1.0 → 1.0 | 85% → 93% | 155 → 156 | 6.9 → 7.6 | 6.8 → 6.9 | 2% → 10% | 51k → 321k |
| RIX-TBS | A321 | 1.0 → 1.0 | 80% → 86% | 155 → 159 | 6.5 → 7.2 | 6.3 → 6.3 | 4% → 12% | 128k → 440k |
| RIX-TAS | A320 | 1.0 → 1.0 | 84% → 81% | 203 → 206 | 5.6 → 5.5 | 5.9 → 5.8 | -5% → -5% | -209k → -190k |
| RIX-TAS | A321 | 1.0 → 1.0 | 77% → 75% | 204 → 209 | 5.1 → 5.1 | 5.4 → 5.3 | -6% → -4% | -248k → -160k |
| RIX-TAS | B763 | 1.0 → 1.0 | 67% → 60% | 211 → 213 | 4.6 → 4.1 | 5.4 → 5.3 | -18% → -27% | -946k → -1331k |
| RIX-TAS | A332 | 1.0 → 1.0 | 64% → 57% | 211 → 213 | 4.3 → 3.9 | 5.2 → 5.2 | -22% → -32% | -1161k → -1590k |
| RIX-JFK | B763 | 1.0 → 1.0 | 80% → 74% | 354 → 357 | 4.7 → 4.4 | 4.7 → 4.7 | 1% → -5% | 107k → -504k |
| RIX-JFK | A332 | 1.0 → 1.0 | 78% → 72% | 356 → 359 | 4.6 → 4.3 | 4.6 → 4.6 | 1% → -6% | 78k → -624k |
| PRG-AYT | A320 | 1.0 s → 1.0 s | 85% → 100% | 160 → 160 | 7.8 → 9.2 | 7.4 → 7.7 | 5% → 16% | 80k → 316k |
| PRG-AYT | A321 | 1.0 s → 1.0 s | 81% → 100% | 160 → 160 | 7.4 → 9.1 | 6.9 → 7.2 | 8% → 21% | 146k → 511k |
| PRG-HRG | A320 | 1.0 → 1.0 | 85% → 100% | 186 → 186 | 5.7 → 6.7 | 6.0 → 6.1 | -4% → 9% | -139k → 340k |
| PRG-HRG | A321 | 1.0 → 1.0 | 81% → 100% | 186 → 186 | 5.4 → 6.7 | 5.5 → 5.7 | -2% → 15% | -62k → 678k |
| PRG-HRG | B763 | 1.0 → 1.0 | 100% → 97% | 186 → 186 | 6.7 → 6.5 | 5.9 → 5.9 | 12% → 10% | 779k → 634k |
| PRG-HRG | A332 | 1.0 → 1.0 | 100% → 96% | 186 → 186 | 6.7 → 6.4 | 5.8 → 5.8 | 13% → 9% | 909k → 636k |
| PRG-RMF | A320 | 1.0 → 1.0 | 85% → 100% | 171 → 171 | 5.0 → 5.8 | 5.8 → 6.0 | -17% → -2% | -524k → -86k |
| PRG-RMF | A321 | 1.0 → 1.0 | 81% → 100% | 171 → 171 | 4.7 → 5.8 | 5.4 → 5.6 | -14% → 4% | -507k → 169k |
| PRG-RMF | B763 | 1.0 → 1.0 | 100% → 97% | 171 → 170 | 5.8 → 5.6 | 5.8 → 5.8 | 1% → -2% | 46k → -133k |
| PRG-RMF | A332 | 1.0 → 1.0 | 100% → 95% | 171 → 171 | 5.8 → 5.5 | 5.7 → 5.7 | 2% → -3% | 125k → -169k |
| PRG-TFS | A320 | 1.0 → 1.0 | 85% → 94% | 218 → 223 | 5.7 → 6.4 | 5.7 → 5.8 | 0% → 10% | 1k → 408k |
| PRG-TFS | A321 | 1.0 → 1.0 | 80% → 87% | 219 → 226 | 5.4 → 6.0 | 5.3 → 5.4 | 2% → 11% | 82k → 525k |
| PRG-TFS | B763 | 1.0 → 1.0 | 84% → 75% | 230 → 232 | 5.9 → 5.3 | 5.5 → 5.4 | 7% → -2% | 443k → -129k |
| PRG-TFS | A332 | 1.0 → 1.0 | 82% → 72% | 231 → 233 | 5.8 → 5.1 | 5.4 → 5.3 | 6% → -3% | 424k → -220k |
| PRG-HER | A320 | 1.0 s → 1.0 s | 85% → 100% | 160 → 160 | 8.2 → 9.6 | 7.5 → 7.8 | 8% → 18% | 108k → 307k |
| PRG-HER | A321 | 1.0 s → 1.0 s | 81% → 100% | 160 → 160 | 7.7 → 9.5 | 6.9 → 7.3 | 10% → 24% | 172k → 481k |
| PRG-DJE | A320 | 1.0 s → 1.0 s | 85% → 100% | 162 → 162 | 8.3 → 9.8 | 7.6 → 7.9 | 9% → 20% | 126k → 328k |
| PRG-DJE | A321 | 1.0 s → 1.0 s | 81% → 100% | 162 → 162 | 7.9 → 9.8 | 7.0 → 7.4 | 12% → 25% | 196k → 509k |
| PRG-TLV | A320 | 2.0 → 3.0 | 85% → 95% | 163 → 164 | 6.2 → 6.8 | 6.3 → 6.2 | -1% → 8% | -86k → 809k |
| PRG-TLV | A321 | 2.0 → 3.0 | 81% → 85% | 163 → 168 | 5.9 → 6.2 | 5.8 → 5.7 | 1% → 8% | 61k → 866k |
| PRG-TLV | B763 | 2.0 → 3.0 | 90% → 69% | 169 → 174 | 6.6 → 5.2 | 6.2 → 5.8 | 7% → -12% | 799k → -1580k |
| PRG-TLV | A332 | 2.0 → 3.0 | 88% → 65% | 170 → 174 | 6.5 → 4.9 | 6.1 → 5.7 | 7% → -16% | 875k → -2088k |
| PRG-HAN | B763 | 1.0 → 1.0 | 86% → 81% | 372 → 374 | 4.3 → 4.1 | 4.5 → 4.4 | -4% → -9% | -494k → -1024k |
| PRG-HAN | A332 | 1.0 → 1.0 | 100% → 91% | 372 → 376 | 5.0 → 4.6 | 4.5 → 4.5 | 8% → 2% | 1179k → 223k |
| SOF-STN | A320 | 1.0 → 1.0 | 85% → 93% | 84 → 84 | 4.9 → 5.3 | 7.0 → 7.0 | -42% → -32% | -777k → -642k |
| SOF-STN | A321 | 1.0 → 1.0 | 81% → 95% | 84 → 84 | 4.6 → 5.4 | 6.4 → 6.6 | -39% → -22% | -825k → -551k |
| SOF-FRA | A320 | 2.0 → 3.0 | 85% → 89% | 112 → 112 | 8.6 → 8.8 | 8.6 → 8.4 | 0% → 4% | 13k → 280k |
| SOF-FRA | A321 | 2.0 → 3.0 | 81% → 86% | 112 → 113 | 8.2 → 8.5 | 7.9 → 7.8 | 3% → 8% | 147k → 644k |
| SOF-MAD | A320 | 1.0 → 1.0 | 85% → 93% | 90 → 90 | 4.5 → 4.9 | 6.6 → 6.7 | -47% → -37% | -887k → -753k |
| SOF-MAD | A321 | 1.0 → 1.0 | 81% → 95% | 90 → 90 | 4.3 → 5.0 | 6.1 → 6.3 | -43% → -26% | -942k → -659k |
| SOF-MXP | A320 | 1.0 → 2.0 | 85% → 95% | 78 → 78 | 7.4 → 8.1 | 9.2 → 8.9 | -24% → -11% | -405k → -388k |
| SOF-MXP | A321 | 1.0 → 2.0 | 81% → 94% | 78 → 78 | 7.0 → 7.9 | 8.4 → 8.3 | -20% → -5% | -395k → -205k |
| SOF-TLV | A320 | 2.0 → 3.0 | 85% → 94% | 114 → 114 | 7.7 → 8.3 | 7.8 → 7.8 | -1% → 7% | -25k → 519k |
| SOF-TLV | A321 | 2.0 → 3.0 | 81% → 88% | 114 → 116 | 7.3 → 7.9 | 7.2 → 7.1 | 2% → 9% | 107k → 769k |
| SOF-HRG | A320 | 1.0 s → 1.0 s | 84% → 86% | 165 → 167 | 7.8 → 8.1 | 7.0 → 7.1 | 10% → 13% | 218k → 296k |
| SOF-HRG | A321 | 1.0 s → 1.0 s | 78% → 81% | 166 → 168 | 7.3 → 7.6 | 6.5 → 6.5 | 12% → 15% | 294k → 392k |
| SOF-AYT | A320 | 1.0 s → 1.0 s | 85% → 95% | 111 → 113 | 12.4 → 14.0 | 10.9 → 11.3 | 12% → 19% | 143k → 260k |
| SOF-AYT | A321 | 1.0 s → 1.0 s | 80% → 93% | 112 → 114 | 11.7 → 13.8 | 10.0 → 10.4 | 15% → 24% | 206k → 393k |
| SOF-ORD | B763 | 1.0 → 1.0 | 65% → 60% | 456 → 459 | 4.0 → 3.6 | 4.3 → 4.3 | -8% → -17% | -899k → -1677k |
| SOF-ORD | A332 | 1.0 → 1.0 | 67% → 60% | 465 → 468 | 4.1 → 3.7 | 4.3 → 4.2 | -3% → -13% | -366k → -1418k |
| TLL-STN | A320 | 1.0 → 1.0 | 85% → 97% | 96 → 95 | 6.0 → 6.9 | 7.6 → 7.7 | -25% → -13% | -490k → -284k |
| TLL-STN | A321 | 1.0 → 1.0 | 81% → 97% | 95 → 96 | 5.7 → 6.9 | 6.9 → 7.2 | -22% → -5% | -490k → -143k |
| TLL-ARN | A320 | 3.0 → 3.0 | 85% → 87% | 77 → 77 | 20.8 → 20.8 | 19.7 → 19.7 | 5% → 5% | 248k → 230k |
| TLL-ARN | A321 | 3.0 → 3.0 | 80% → 77% | 77 → 78 | 19.5 → 18.5 | 18.0 → 17.5 | 8% → 5% | 405k → 266k |
| TLL-OSL | A320 | 1.0 → 1.0 | 85% → 94% | 86 → 86 | 12.1 → 13.4 | 12.6 → 13.0 | -4% → 3% | -68k → 60k |
| TLL-OSL | A321 | 1.0 → 1.0 | 81% → 93% | 86 → 86 | 11.5 → 13.2 | 11.5 → 12.0 | 0% → 10% | 0k → 223k |
| TLL-DUB | A320 | 1.0 → 1.0 | 84% → 83% | 110 → 112 | 5.6 → 5.6 | 7.0 → 6.9 | -24% → -23% | -505k → -476k |
| TLL-DUB | A321 | 1.0 → 1.0 | 75% → 70% | 112 → 113 | 5.1 → 4.8 | 6.3 → 6.2 | -24% → -28% | -568k → -631k |
| TLL-TFS | A320 | 1.0 s → 1.0 s | 61% → 71% | 278 → 279 | 4.0 → 4.6 | 5.2 → 5.3 | -31% → -14% | -626k → -336k |
| TLL-TFS | B763 | 1.0 s → 1.0 s | 90% → 81% | 283 → 285 | 5.9 → 5.4 | 5.3 → 5.2 | 10% → 3% | 518k → 141k |
| TLL-TFS | A332 | 1.0 s → 1.0 s | 88% → 80% | 284 → 286 | 5.8 → 5.3 | 5.2 → 5.2 | 9% → 2% | 508k → 110k |
| TLL-AYT | A320 | 1.0 s → 1.0 s | 85% → 97% | 187 → 188 | 7.0 → 8.0 | 6.5 → 6.7 | 7% → 17% | 126k → 366k |
| TLL-AYT | A321 | 1.0 s → 1.0 s | 81% → 95% | 187 → 190 | 6.6 → 7.9 | 6.0 → 6.2 | 9% → 21% | 201k → 552k |
| TLL-AYT | B763 | 1.0 s → 1.0 s | 96% → 92% | 189 → 191 | 7.9 → 7.6 | 6.4 → 6.3 | 19% → 17% | 717k → 621k |
| TLL-AYT | A332 | 1.0 s → 1.0 s | 95% → 91% | 189 → 191 | 7.8 → 7.6 | 6.3 → 6.2 | 20% → 17% | 798k → 664k |
| TLL-HRG | A320 | 1.0 s → 1.0 s | 85% → 90% | 246 → 248 | 6.2 → 6.7 | 5.9 → 6.0 | 5% → 11% | 132k → 288k |
| TLL-HRG | A321 | 1.0 s → 1.0 s | 80% → 87% | 246 → 249 | 5.9 → 6.4 | 5.5 → 5.5 | 7% → 14% | 201k → 433k |
| TLL-HRG | B763 | 1.0 s → 1.0 s | 84% → 77% | 249 → 250 | 6.2 → 5.7 | 5.4 → 5.4 | 13% → 6% | 534k → 236k |
| TLL-HRG | A332 | 1.0 s → 1.0 s | 79% → 72% | 249 → 250 | 5.9 → 5.4 | 5.3 → 5.3 | 10% → 2% | 410k → 95k |
| TLL-HKT | B763 | 0.2 s → 0.2 s | 83% → 85% | 540 → 548 | 5.7 → 5.9 | 5.5 → 5.6 | 4% → 6% | 64k → 109k |
| TLL-HKT | A332 | 0.2 s → 0.2 s | 94% → 90% | 544 → 549 | 6.5 → 6.3 | 5.6 → 5.6 | 14% → 11% | 306k → 237k |