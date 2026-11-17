# BLOCK HOURS v0.24.1 (routes2 e041a9e): route economics before the balance pass

Lane r3-bal. All money in USD. "Case" = the engine's own business case (`project()`, P50, first 12 months from the first
flight, truth 1) at the study's recommended plan; "sim" = the route actually flown by the engine. [E] marks estimates.

## 1. How it was measured

- `scripts/balmeasure.ts` (MKT=all, LAYOUT=two-class and all-economy): every researched market (68) on A320ceo and
  A321ceo, plus 767-300ER and A330-200 where the first sector is over 2,500 km. Load factor, yield ($ a passenger and
  US¢ per passenger-km), RASK and CASK (US¢ per seat-km, all-in: lease and insurance, crew, overheads), margin, best and
  worst quarter, launch cost; cost per block hour by kind (fuel, crew, maintenance, aircraft, en-route navigation,
  landing and passenger charges, handling, catering and passenger services, distribution, overheads, disruption).
- `scripts/balrun.ts`: the player's save (Malteser, MLA, A320/A321 all-economy), a route launched the way a player does
  it (full study, Go on the case's plan, every stage, slots accepted), flown month by month. The harness tops up cash
  (nobody plays the ACMI side, so the company would otherwise run dry) and, in later runs, answers a rotation with no
  aircraft with the best quote, as a player would.
- Bots: `acmi-bot.ts 1 365 --routes --inv --base=LIS|MLA|SOF|RIX` (0 invariant errors in all four).

## 2. Headline numbers (before)

**Business case, recommended plan, P50** (full tables in the appendix):

| type | cabin | markets | median margin | positive | in 5–15 % | above 20 % | result per BH (all) |
|---|---|---|---|---|---|---|---|
| A320 | 12J/156Y | 54 | 4 % | 32 | 21 | 3 | $142 |
| A321 | 16J/180Y | 52 | 6 % | 32 | 25 | 1 | $357 |
| 767-300ER | 16J/251Y | 33 | 6 % | 25 | 19 | 0 | $562 |
| A330-200 | 18J/282Y | 33 | 8 % | 26 | 17 | 0 | $857 |
| A320 | 180Y | 54 | −2 % | 23 | 12 | 3 | −$371 |
| A321 | 220Y | 52 | 0 % | 25 | 15 | 1 | −$365 |
| 767-300ER | 309Y | 33 | 1 % | 19 | 10 | 0 | −$33 |
| A330-200 | 330Y | 33 | 1 % | 19 | 10 | 1 | $12 |

Every narrowbody load factor sat at 77–91 % in every month, peak and off-peak alike (§4.1): the cap, not demand.

**Player's save, MLA–MAN dev-launched on the A321 220Y (1 a week, the v0.24.1 report):** first month −$38K on $57K
revenue (−68 %: 2 sectors carried a full month's station, marketing and distribution plus the inaugural), then
−$15K, −$5K, −$24K (−6 %, −2 %, −10 %) at 77 % load. Case for the same plan: −4 % (two-class) — the case and the sim agree;
the route was a poor one *and* its seats were capped.

**Player's save, the planner's top idea (MLA–Istanbul, holiday series, A321 220Y, 3 a week):**
- Planner's first guess: +$969K a year, 11 %. Case after the full study: +$565K, 7.3 %, "Marginal", payback 23 months.
- Sim (months from the first flight, 26 Jan 2028): −$41K (6 sectors), −$76K, −$12K, +$31K, +$109K, +$150K, +$197K,
  +$167K, +$85K, +$5K, −$103K (Nov), then December −$1.29M (six rotations stranded by an unattended grounding of the
  other A321: a harness artefact, see §5). Load 77 % every month (the cap). Launch spend $303K; the cumulative line
  crossed zero in month 7 (July).
- The slow-bookings card fired on every flight from July: "81 % booked, usually 149 % by now. A sale can fill it." —
  the flights were full (§4.2).

**Bots (365 days, routes start flying around day 230):** LIS–OXB A320 4 months −35K, −11K, +164K, +76K (15 %); RIX–SSH
A320 −27K, −17K, −5K, −22K (−8 %); MLA–MJI A320 1 month −65K; most other studies shelved (an idle 767 on a narrowbody
market: case negative). Contribution per BH on own-flown rotations 2,381 (OXB) against ACMI net 2,921.

## 3. Real-world yardsticks

| item | real world | engine before | verdict |
|---|---|---|---|
| ULCC all-in CASK | Wizz Air F25 4.33 €¢ (fuel 1.48, ex-fuel 2.85) ≈ 4.7 US¢; RASK 4.33 €¢; LF 91.2 % [1] | — | — |
| Ryanair FY25 | 200 m passengers, average fare €46, ancillary €4.72 bn (≈ €24 a passenger), cost a passenger flat [2] | — | — |
| Leisure airline (Jet2) FY25 | flight-only yield £119.70 a passenger sector (≈ $155), non-ticket £25.56, LF 88.7 % [3] | MLA–MAN yield $149–151, MLA–CPH $180 | in line |
| A320/A321 all-in CASK, 2,000–2,600 km | 4.5–5.5 ¢ ULCC, 6–7 ¢ easyJet/Jet2-type [E from 1–3], 8–12 ¢ legacy short-haul [E] | A320 2c 6.5–7.7 ¢, A321 2c 6.5–7.5 ¢ | leisure-carrier level: plausible for a start-up |
| Fuel burn | A320ceo ≈ 2.4–2.6 t/BH, A321ceo ≈ 2.8–3.0 t/BH [E, Airbus/operator data] | 2.5 / 2.9 t/BH × $717–792/t | in line |
| Maintenance | A320-family mid-life ≈ $800–1,100 a BH all-in [E, IATA MCX ranges] | $900 / $1,000 | in line |
| Lease | mid-life A320ceo ≈ $200–250K a month, A321ceo ≈ $250–320K (2024–26 tight market) [E] | $225K / $280K over 250 BH | in line |
| Crew | EASA FTL: 900 BH a year, 100 BH in 28 days; a short-haul crew member flies ≈ 700–800 BH a year [E] | salaries spread over 75 BH a month | too few hours paid for (route view only) |
| En-route charges | Eurocontrol: rate × (km ÷ 100) × √(MTOW t ÷ 50); 2026 area average €63.57 [4][5]. MLA–MAN A321 (93.5 t): ≈ 23 × 1.37 × €64 ≈ €2,000 + terminal | $3,206 a sector (767 figure × √(seats ÷ 290) = 0.89) | ≈ 40 % high on narrowbodies: seats stood for weight |
| Payload | A320ceo MZFW 62.5–64.3 t − OEW ≈ 42.5 t ≈ 20–21.8 t; A321ceo 73.8–75.6 t − ≈ 48.5 t ≈ 25–27 t [E, Airbus ACAP] | 18 t / 21 t, × 0.92, ÷ 108 kg a passenger | **wrong: A320 capped at 153 passengers, A321 at 178** |
| Passenger mass | EASA standard adult 84 kg incl. hand baggage; checked bag ≈ 15–16 kg (Europe) [E, EASA standard masses] | 108 kg everywhere (a VFR traveller with two full bags) | right for VFR, wrong for holiday markets |
| Load factors | 80–95 % (Wizz 91 %, Jet2 89 %, Ryanair 93–94 %) | 77–91 % flat in every month (the cap) | the cap, not demand |
| Market share | QSI practice: share follows frequency share (S-curve) | 1 a week against 16 low-cost flights a week: 14.7 % of MLA–MAN (494 a departure wanted) | far too high for a newcomer |

Sources: [1] Wizz Air Final Results F25, 5 Jun 2025 (https://s204.q4cdn.com/169340705/files/doc_news/Final-Results-2025.pdf);
[2] Ryanair FY25 results (https://investor.ryanair.com/wp-content/uploads/2025/05/FY25-Ryanair-Results.pdf);
[3] Jet2 plc FY25 final results, 9 Jul 2025 (https://www.investegate.co.uk/announcement/rns/jet2--jet2/final-results/8969858);
[4] CRCO Information Circular 2025/01, route charges system (https://www.eurocontrol.int/sites/default/files/2024-12/circ-2025-01-eurocontrol-route-charges-system.pdf);
[5] Eurocontrol monthly adjusted unit rates (https://www.eurocontrol.int/publication/monthly-adjusted-unit-rates-december-2025).

## 4. Inputs out of line

1. **Payload cap (the big one).** `cargo.payloadType` a320ceo 18 t, a321ceo 21 t (737-800 19 t, A321neo 22 t) × 0.92 ÷
   `paxKg` 108: an A320 180Y could sell 153 seats (85 %), an A321 220Y 178 (81 %), a 12J/156Y A320 91 %. Every narrowbody
   case and flight ran into it: loads flat at 77–91 % all year, all-economy cabins worthless (their extra seats could
   never be sold), the player's high-density fleet structurally penalised.
2. **Slow-bookings card against an impossible "usual"** (sales.ts): expected demand ÷ cabin, not capped at full and not
   against the sellable seats; a payload-capped full flight was told "81 % booked, usually 149 %" every other day and
   pushed to run a sale (cutting fares on a full flight).
3. **A newcomer's share at low frequency.** The logit's frequency weight (0.35) lets one weekly flight take 15 % of a
   trunk market against 16 low-cost flights; custom markets already capped it at 1.6 × the frequency share (v0.19.2),
   catalogue markets did not. This is why the study always recommended 1–3 a week at 91–100 % full.
4. **The study stopped at three a week**, so busy markets were planned at 1–3 a week with demand far above the seats.
5. **En-route charges scaled by seats, not weight** (§3): narrowbodies paid ≈ 25–40 % too much.
6. **Cargo counted per departure**: a market's cargo (a week's flow for its weekly flight) was carried in full by every
   departure, so a daily plan earned seven weeks of cargo (MLA–Istanbul daily: $3.4 M of cargo, 16 % of revenue).
7. **Crew hours**: salaries spread over 75 BH a month per crew member (route view and the case's ACMI comparison only).
8. Checked and found in line: fuel, maintenance, leases, handling, yields against Jet2, launch spend ($250–300K),
   distribution. `demand.scale` 1.4 (a lever over the catalogue's O&D) was tested at 1.0: the LIS diaspora widebody
   markets (OXB, DIL, MPM, BVC) all turn to −20 to −60 %, so it stays.

## 5. Harness notes

- The unplayed save runs out of cash by March 2028 (aircraft rents with no ACMI work): `advanceTo` stops at the game
  over and the route "stalls". The harness adds cash outside the route's books.
- December 2028: the other A321 (9H-XBG) is grounded with nobody to act; ops recovery cancels 9H-EYO's route rotations
  (six round trips, $1.3–1.6 M of refunds and EU261). Not a route-economics effect; the after runs report it apart.

## Appendix A. Business case, two-class
f = flights a week (s: season only). Yield: ticket revenue per passenger ($) and per passenger-km (US¢). RASK/CASK: all revenue / all costs (incl. aircraft lease and insurance, crew, overheads) per seat-km (US¢). Quarters: best / worst quarter margin.

| market | type | model | f | km | LF | $/pax | yield ¢ | RASK ¢ | CASK ¢ | margin | quarters best/worst | result/yr | launch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 12J/156Y | own | 1.0 | 3058 | 88% | 259 | 8.5 | 8.6 | 6.8 | 20% | 31% / 3% | 934k | 274k |
| LIS-OXB | A321 16J/180Y | own | 1.0 | 3058 | 82% | 260 | 8.5 | 8.2 | 6.5 | 20% | 32% / -2% | 1016k | 274k |
| LIS-OXB | B763 16J/251Y | own | 1.0 | 3058 | 68% | 265 | 8.7 | 7.0 | 6.7 | 4% | 22% / -40% | 268k | 271k |
| LIS-OXB | A332 18J/282Y | own | 1.0 | 3058 | 61% | 265 | 8.7 | 6.3 | 6.2 | 1% | 20% / -45% | 62k | 271k |
| LIS-TMS | A320 12J/156Y | partner | 1.0 | 4565 | 69% | 0 | 0.0 | 6.5 | 5.2 | 19% | 19% / 19% | 993k | 143k |
| LIS-TMS | A321 | can’t fly it (range or runway) |||||||||||
| LIS-TMS | B763 16J/251Y | partner | 1.0 | 4565 | 73% | 0 | 0.0 | 5.9 | 5.4 | 8% | 11% / 5% | 604k | 140k |
| LIS-TMS | A332 18J/282Y | partner | 1.0 | 4565 | 66% | 0 | 0.0 | 5.3 | 5.1 | 5% | 6% / 3% | 349k | 140k |
| LIS-DIL | A320 | can’t fly it (range or runway) |||||||||||
| LIS-DIL | A321 | can’t fly it (range or runway) |||||||||||
| LIS-DIL | B763 16J/251Y | tour | 0.3 | 14601 | 38% | 2075 | 15.8 | 6.1 | 5.7 | 7% | 22% / -32% | 417k | 348k |
| LIS-DIL | A332 | can’t fly it (range or runway) |||||||||||
| LIS-RAI | A320 12J/156Y | own | 1.0 | 3001 | 91% | 191 | 6.4 | 6.9 | 6.5 | 5% | 15% / -10% | 179k | 274k |
| LIS-RAI | A321 16J/180Y | own | 1.0 | 3001 | 84% | 199 | 6.6 | 6.6 | 6.2 | 5% | 16% / -9% | 210k | 274k |
| LIS-RAI | B763 16J/251Y | own | 1.0 | 3001 | 95% | 185 | 6.2 | 7.0 | 6.7 | 4% | 16% / -12% | 258k | 271k |
| LIS-RAI | A332 18J/282Y | own | 1.0 | 3001 | 91% | 187 | 6.2 | 6.7 | 6.3 | 6% | 18% / -11% | 409k | 271k |
| LIS-SID | A320 12J/156Y | tour | 1.0 | 2794 | 91% | 188 | 6.7 | 6.9 | 6.7 | 3% | 20% / -10% | 98k | 289k |
| LIS-SID | A321 16J/180Y | tour | 1.0 | 2794 | 91% | 187 | 6.7 | 6.8 | 6.5 | 5% | 22% / -8% | 200k | 289k |
| LIS-SID | B763 16J/251Y | tour | 1.0 | 2794 | 92% | 186 | 6.6 | 6.9 | 6.8 | 0% | 22% / -16% | 26k | 289k |
| LIS-SID | A332 18J/282Y | tour | 1.0 | 2794 | 87% | 186 | 6.7 | 6.5 | 6.4 | 1% | 25% / -18% | 83k | 289k |
| LIS-BVC | A320 12J/156Y | tour | 1.0 | 2852 | 84% | 231 | 8.1 | 7.4 | 6.7 | 10% | 29% / -6% | 371k | 297k |
| LIS-BVC | A321 16J/180Y | tour | 1.0 | 2852 | 75% | 232 | 8.1 | 6.6 | 6.3 | 5% | 28% / -14% | 194k | 297k |
| LIS-BVC | B763 16J/251Y | tour | 1.0 | 2852 | 59% | 234 | 8.2 | 5.2 | 6.4 | -21% | 16% / -56% | -888k | 293k |
| LIS-BVC | A332 18J/282Y | tour | 1.0 | 2852 | 52% | 234 | 8.2 | 4.7 | 5.9 | -27% | 12% / -63% | -1102k | 293k |
| LIS-LAD | A320 | can’t fly it (range or runway) |||||||||||
| LIS-LAD | A321 | can’t fly it (range or runway) |||||||||||
| LIS-LAD | B763 16J/251Y | own | 2.0 | 5780 | 99% | 300 | 5.2 | 6.1 | 5.7 | 7% | 15% / -4% | 1381k | 262k |
| LIS-LAD | A332 18J/282Y | own | 2.0 | 5780 | 98% | 302 | 5.2 | 6.0 | 5.4 | 10% | 18% / -3% | 2071k | 262k |
| LIS-MPM | A320 | can’t fly it (range or runway) |||||||||||
| LIS-MPM | A321 | can’t fly it (range or runway) |||||||||||
| LIS-MPM | B763 16J/251Y | own | 1.0 | 8400 | 69% | 521 | 6.2 | 4.7 | 5.1 | -10% | 8% / -47% | -1094k | 262k |
| LIS-MPM | A332 18J/282Y | own | 1.0 | 8400 | 63% | 533 | 6.3 | 4.3 | 4.8 | -11% | 6% / -48% | -1275k | 262k |
| LIS-REC | A320 | can’t fly it (range or runway) |||||||||||
| LIS-REC | A321 | can’t fly it (range or runway) |||||||||||
| LIS-REC | B763 16J/251Y | own | 1.0 | 5857 | 100% | 302 | 5.2 | 5.9 | 5.4 | 7% | 17% / -6% | 713k | 266k |
| LIS-REC | A332 18J/282Y | own | 1.0 | 5857 | 98% | 302 | 5.2 | 5.8 | 5.2 | 10% | 21% / -5% | 1103k | 266k |
| LIS-FOR | A320 | can’t fly it (range or runway) |||||||||||
| LIS-FOR | A321 | can’t fly it (range or runway) |||||||||||
| LIS-FOR | B763 16J/251Y | own | 1.0 | 5612 | 97% | 295 | 5.3 | 5.8 | 5.5 | 5% | 17% / -15% | 476k | 262k |
| LIS-FOR | A332 18J/282Y | own | 1.0 | 5612 | 93% | 296 | 5.3 | 5.5 | 5.2 | 7% | 20% / -19% | 678k | 262k |
| OPO-RAI | A320 12J/156Y | own | 0.3 | 3257 | 91% | 222 | 6.8 | 7.1 | 7.6 | -6% | 5% / -23% | -64k | 274k |
| OPO-RAI | A321 16J/180Y | own | 0.3 | 3257 | 80% | 231 | 7.1 | 6.4 | 7.0 | -9% | 4% / -28% | -100k | 274k |
| OPO-RAI | B763 16J/251Y | own | 0.3 | 3257 | 96% | 214 | 6.6 | 7.1 | 7.2 | -1% | 11% / -19% | -21k | 271k |
| OPO-RAI | A332 18J/282Y | own | 0.3 | 3257 | 92% | 215 | 6.6 | 6.9 | 6.8 | 1% | 14% / -18% | 23k | 271k |
| OPO-OXB | A320 12J/156Y | own | 0.3 | 3334 | 90% | 260 | 8.0 | 8.1 | 7.5 | 7% | 19% / -12% | 115k | 270k |
| OPO-OXB | A321 16J/180Y | own | 0.3 | 3334 | 85% | 260 | 8.0 | 7.7 | 7.1 | 8% | 21% / -19% | 135k | 270k |
| OPO-OXB | B763 16J/251Y | own | 0.3 | 3334 | 72% | 266 | 8.1 | 6.6 | 7.0 | -6% | 15% / -58% | -122k | 267k |
| OPO-OXB | A332 18J/282Y | own | 0.3 | 3334 | 65% | 267 | 8.2 | 6.0 | 6.5 | -9% | 13% / -65% | -180k | 267k |
| VNO-LTN | A320 12J/156Y | own | 1.0 | 1724 | 91% | 103 | 6.0 | 7.1 | 8.4 | -18% | 6% / -33% | -376k | 266k |
| VNO-LTN | A321 16J/180Y | own | 1.0 | 1724 | 87% | 106 | 6.1 | 6.9 | 8.0 | -16% | 7% / -32% | -394k | 266k |
| VNO-DUB | A320 12J/156Y | own | 1.0 | 2048 | 91% | 122 | 6.0 | 6.7 | 7.7 | -14% | 9% / -33% | -344k | 262k |
| VNO-DUB | A321 16J/180Y | own | 1.0 | 2048 | 91% | 125 | 6.1 | 6.8 | 7.4 | -10% | 13% / -28% | -275k | 262k |
| VNO-OSL | A320 12J/156Y | own | 1.0 | 1047 | 91% | 86 | 8.2 | 9.9 | 11.5 | -17% | -2% / -36% | -299k | 262k |
| VNO-OSL | A321 16J/180Y | own | 1.0 | 1047 | 91% | 87 | 8.3 | 9.9 | 11.1 | -11% | 2% / -30% | -243k | 262k |
| VNO-TFS | A320 12J/156Y | tour | 1.0 s | 4469 | 71% | 295 | 6.7 | 5.1 | 5.8 | -14% | -6% / -24% | -323k | 293k |
| VNO-TFS | A321 16J/180Y | tour | 1.0 s | 4469 | 67% | 299 | 6.8 | 4.9 | 5.6 | -16% | -7% / -27% | -401k | 293k |
| VNO-TFS | B763 16J/251Y | tour | 1.0 s | 4469 | 99% | 285 | 6.4 | 6.8 | 6.2 | 9% | 15% / -2% | 417k | 293k |
| VNO-TFS | A332 18J/282Y | tour | 1.0 s | 4469 | 97% | 285 | 6.4 | 6.7 | 5.9 | 12% | 19% / -1% | 649k | 293k |
| VNO-AYT | A320 12J/156Y | tour | 1.0 s | 2016 | 91% | 172 | 8.6 | 8.7 | 7.9 | 9% | 16% / -3% | 161k | 289k |
| VNO-AYT | A321 16J/180Y | tour | 1.0 s | 2016 | 91% | 174 | 8.7 | 8.8 | 7.7 | 12% | 19% / 1% | 256k | 289k |
| VNO-TBS | A320 12J/156Y | own | 1.0 | 2038 | 91% | 163 | 8.0 | 8.6 | 8.0 | 8% | 23% / -24% | 238k | 272k |
| VNO-TBS | A321 16J/180Y | own | 1.0 | 2038 | 90% | 167 | 8.2 | 8.6 | 7.7 | 11% | 26% / -20% | 390k | 272k |
| VNO-TLV | A320 12J/156Y | own | 1.0 | 2627 | 91% | 171 | 6.5 | 6.8 | 7.0 | -3% | 18% / -47% | -80k | 272k |
| VNO-TLV | A321 16J/180Y | own | 1.0 | 2627 | 89% | 175 | 6.7 | 6.8 | 6.7 | 0% | 21% / -48% | 15k | 272k |
| VNO-TLV | B763 16J/251Y | own | 1.0 | 2627 | 88% | 174 | 6.6 | 6.6 | 7.0 | -6% | 20% / -79% | -281k | 269k |
| VNO-TLV | A332 18J/282Y | own | 1.0 | 2627 | 82% | 176 | 6.7 | 6.3 | 6.6 | -6% | 22% / -87% | -289k | 269k |
| VNO-ORD | A320 | can’t fly it (range or runway) |||||||||||
| VNO-ORD | A321 | can’t fly it (range or runway) |||||||||||
| VNO-ORD | B763 16J/251Y | own | 1.0 | 7552 | 83% | 473 | 6.3 | 5.7 | 5.3 | 7% | 36% / -32% | 895k | 266k |
| VNO-ORD | A332 18J/282Y | own | 1.0 | 7552 | 79% | 478 | 6.3 | 5.5 | 5.0 | 9% | 39% / -37% | 1114k | 266k |
| MLA-MAN | A320 12J/156Y | tour | 1.0 | 2342 | 91% | 149 | 6.4 | 6.8 | 7.3 | -8% | 12% / -50% | -229k | 293k |
| MLA-MAN | A321 16J/180Y | tour | 1.0 | 2342 | 91% | 151 | 6.4 | 6.8 | 7.1 | -4% | 15% / -44% | -140k | 293k |
| MLA-GLA | A320 12J/156Y | tour | 1.0 | 2645 | 85% | 164 | 6.2 | 6.0 | 6.8 | -13% | 13% / -89% | -362k | 289k |
| MLA-GLA | A321 16J/180Y | tour | 1.0 | 2645 | 80% | 165 | 6.3 | 5.7 | 6.5 | -14% | 15% / -108% | -422k | 289k |
| MLA-GLA | B763 16J/251Y | tour | 1.0 | 2645 | 73% | 170 | 6.4 | 5.3 | 6.7 | -26% | 14% / -187% | -1004k | 289k |
| MLA-GLA | A332 18J/282Y | tour | 1.0 | 2645 | 67% | 171 | 6.5 | 4.9 | 6.2 | -27% | 16% / -198% | -1105k | 289k |
| MLA-MJI | A320 12J/156Y | own | 1.0 | 347 | 90% | 127 | 36.5 | 42.9 | 29.2 | 32% | 37% / 26% | 828k | 276k |
| MLA-MJI | A321 16J/180Y | own | 1.0 | 347 | 87% | 130 | 37.3 | 42.1 | 27.6 | 34% | 40% / 26% | 1023k | 276k |
| MLA-BEN | A320 12J/156Y | partner | 1.0 | 678 | 76% | 0 | 0.0 | 13.0 | 12.9 | 1% | 10% / -12% | 17k | 147k |
| MLA-BEN | A321 16J/180Y | partner | 1.0 | 678 | 70% | 0 | 0.0 | 11.3 | 12.1 | -7% | 1% / -16% | -112k | 147k |
| MLA-CTA | A320 12J/156Y | own | 3.0 | 187 | 91% | 55 | 29.3 | 37.3 | 39.6 | -6% | 15% / -36% | -226k | 270k |
| MLA-CTA | A321 16J/180Y | own | 3.0 | 187 | 91% | 56 | 29.8 | 37.2 | 38.2 | -3% | 18% / -32% | -124k | 270k |
| MLA-CPH | A320 12J/156Y | tour | 1.0 | 2202 | 91% | 180 | 8.2 | 8.4 | 7.7 | 8% | 22% / -36% | 259k | 289k |
| MLA-CPH | A321 16J/180Y | tour | 1.0 | 2202 | 91% | 181 | 8.2 | 8.4 | 7.5 | 11% | 25% / -32% | 427k | 289k |
| MLA-LDE | A320 12J/156Y | tour | 0.3 s | 1482 | 91% | 173 | 11.1 | 10.6 | 11.2 | -6% | 1% / -9% | -24k | 297k |
| MLA-LDE | A321 16J/180Y | tour | 0.3 s | 1482 | 91% | 172 | 11.0 | 10.5 | 10.5 | 0% | 5% / -4% | -1k | 297k |
| MLA-JFK | A320 | can’t fly it (range or runway) |||||||||||
| MLA-JFK | A321 | can’t fly it (range or runway) |||||||||||
| MLA-JFK | B763 16J/251Y | own | 1.0 s | 7384 | 92% | 451 | 6.1 | 6.2 | 5.5 | 11% | 24% / -14% | 972k | 271k |
| MLA-JFK | A332 18J/282Y | own | 1.0 s | 7384 | 90% | 454 | 6.1 | 6.1 | 5.1 | 16% | 29% / -12% | 1538k | 271k |
| MAD-LPA | A320 12J/156Y | own | 3.0 | 1765 | 91% | 117 | 6.6 | 7.8 | 7.9 | -2% | 19% / -15% | -131k | 266k |
| MAD-LPA | A321 16J/180Y | own | 3.0 | 1765 | 91% | 120 | 6.8 | 7.8 | 7.7 | 2% | 22% / -11% | 152k | 266k |
| MAD-IBZ | A320 12J/156Y | own | 2.0 s | 458 | 91% | 93 | 20.1 | 22.8 | 20.2 | 11% | 26% / -8% | 244k | 262k |
| MAD-IBZ | A321 16J/180Y | own | 2.0 s | 458 | 91% | 94 | 20.5 | 22.9 | 19.4 | 15% | 29% / -3% | 381k | 262k |
| MAD-TNG | A320 12J/156Y | own | 3.0 | 566 | 91% | 83 | 14.7 | 17.9 | 16.3 | 9% | 26% / -1% | 481k | 262k |
| MAD-TNG | A321 16J/180Y | own | 3.0 | 566 | 89% | 84 | 14.8 | 17.6 | 15.6 | 11% | 28% / -1% | 687k | 262k |
| MAD-OTP | A320 12J/156Y | own | 1.0 | 2458 | 91% | 107 | 4.4 | 5.1 | 7.0 | -37% | -21% / -61% | -817k | 266k |
| MAD-OTP | A321 16J/180Y | own | 1.0 | 2458 | 91% | 109 | 4.4 | 5.2 | 6.8 | -32% | -16% / -55% | -826k | 266k |
| MAD-SSG | A320 12J/156Y | partner | 1.0 | 4264 | 77% | 0 | 0.0 | 6.9 | 5.5 | 21% | 22% / 21% | 1108k | 143k |
| MAD-SSG | A321 16J/180Y | partner | 1.0 | 4264 | 73% | 0 | 0.0 | 6.1 | 5.3 | 13% | 13% / 13% | 687k | 143k |
| MAD-SSG | B763 16J/251Y | partner | 1.0 | 4264 | 88% | 0 | 0.0 | 6.8 | 5.7 | 16% | 23% / 6% | 1277k | 140k |
| MAD-SSG | A332 18J/282Y | partner | 1.0 | 4264 | 83% | 0 | 0.0 | 6.1 | 5.4 | 11% | 20% / 0% | 913k | 140k |
| MAD-VVI | A320 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | A321 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | B763 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | A332 18J/282Y | own | 1.0 | 8917 | 100% | 406 | 4.6 | 5.1 | 4.9 | 5% | 14% / -8% | 664k | 262k |
| MAD-HAV | A320 | can’t fly it (range or runway) |||||||||||
| MAD-HAV | A321 | can’t fly it (range or runway) |||||||||||
| MAD-HAV | B763 16J/251Y | own | 3.0 | 7462 | 99% | 419 | 5.4 | 6.0 | 5.6 | 6% | 17% / -9% | 2478k | 284k |
| MAD-HAV | A332 18J/282Y | own | 3.0 | 7462 | 98% | 420 | 5.4 | 5.9 | 5.3 | 10% | 21% / -7% | 4383k | 284k |
| RIX-LGW | A320 12J/156Y | own | 3.0 | 1692 | 91% | 110 | 6.5 | 7.7 | 8.1 | -6% | 15% / -20% | -436k | 266k |
| RIX-LGW | A321 16J/180Y | own | 3.0 | 1692 | 91% | 112 | 6.6 | 7.7 | 7.9 | -3% | 18% / -16% | -226k | 266k |
| RIX-DUB | A320 12J/156Y | own | 1.0 | 1943 | 91% | 122 | 6.3 | 7.1 | 7.9 | -12% | 11% / -30% | -280k | 262k |
| RIX-DUB | A321 16J/180Y | own | 1.0 | 1943 | 91% | 124 | 6.4 | 7.1 | 7.6 | -7% | 15% / -25% | -202k | 262k |
| RIX-OSL | A320 12J/156Y | own | 2.0 | 829 | 91% | 92 | 11.1 | 13.2 | 12.7 | 4% | 15% / -12% | 145k | 262k |
| RIX-OSL | A321 16J/180Y | own | 2.0 | 829 | 91% | 94 | 11.3 | 13.2 | 12.2 | 8% | 19% / -7% | 337k | 262k |
| RIX-TFS | A320 12J/156Y | tour | 1.0 s | 4507 | 71% | 294 | 6.6 | 5.0 | 5.8 | -16% | -7% / -26% | -356k | 293k |
| RIX-TFS | A321 16J/180Y | tour | 1.0 s | 4507 | 66% | 296 | 6.6 | 4.7 | 5.6 | -18% | -9% / -31% | -460k | 293k |
| RIX-TFS | B763 16J/251Y | tour | 1.0 s | 4507 | 95% | 285 | 6.4 | 6.5 | 6.2 | 6% | 14% / -12% | 264k | 293k |
| RIX-TFS | A332 18J/282Y | tour | 1.0 s | 4507 | 93% | 285 | 6.4 | 6.4 | 5.8 | 9% | 18% / -10% | 474k | 293k |
| RIX-SSH | A320 12J/156Y | tour | 1.0 s | 3322 | 91% | 243 | 7.4 | 7.3 | 6.5 | 11% | 14% / 6% | 255k | 299k |
| RIX-SSH | A321 16J/180Y | tour | 1.0 s | 3322 | 91% | 241 | 7.3 | 7.2 | 6.3 | 13% | 16% / 8% | 354k | 299k |
| RIX-SSH | B763 16J/251Y | tour | 1.0 s | 3322 | 95% | 238 | 7.2 | 7.4 | 6.6 | 12% | 17% / 1% | 463k | 295k |
| RIX-SSH | A332 18J/282Y | tour | 1.0 s | 3322 | 93% | 238 | 7.2 | 7.3 | 6.2 | 15% | 20% / 2% | 631k | 295k |
| RIX-TBS | A320 12J/156Y | own | 1.0 | 2260 | 91% | 175 | 7.7 | 8.2 | 7.5 | 9% | 24% / -22% | 292k | 272k |
| RIX-TBS | A321 16J/180Y | own | 1.0 | 2260 | 91% | 178 | 7.9 | 8.3 | 7.3 | 12% | 27% / -18% | 472k | 272k |
| RIX-TAS | A320 12J/156Y | own | 1.0 | 3641 | 90% | 236 | 6.5 | 6.8 | 6.5 | 5% | 14% / -7% | 224k | 269k |
| RIX-TAS | A321 16J/180Y | own | 1.0 | 3641 | 87% | 237 | 6.5 | 6.6 | 6.2 | 6% | 16% / -12% | 287k | 269k |
| RIX-TAS | B763 16J/251Y | own | 1.0 | 3641 | 78% | 237 | 6.5 | 5.9 | 6.3 | -8% | 11% / -49% | -454k | 269k |
| RIX-TAS | A332 18J/282Y | own | 1.0 | 3641 | 72% | 238 | 6.5 | 5.4 | 5.9 | -9% | 10% / -55% | -543k | 269k |
| RIX-JFK | A320 | can’t fly it (range or runway) |||||||||||
| RIX-JFK | A321 | can’t fly it (range or runway) |||||||||||
| RIX-JFK | B763 16J/251Y | own | 1.0 | 6746 | 88% | 419 | 6.2 | 6.1 | 5.5 | 9% | 35% / -22% | 1074k | 271k |
| RIX-JFK | A332 18J/282Y | own | 1.0 | 6746 | 84% | 425 | 6.3 | 5.8 | 5.2 | 11% | 38% / -24% | 1405k | 271k |
| PRG-AYT | A320 12J/156Y | tour | 1.0 s | 1975 | 91% | 172 | 8.8 | 8.9 | 8.2 | 8% | 17% / -7% | 142k | 293k |
| PRG-AYT | A321 16J/180Y | tour | 1.0 s | 1975 | 91% | 174 | 8.9 | 9.0 | 8.0 | 11% | 19% / -3% | 235k | 293k |
| PRG-HRG | A320 12J/156Y | tour | 1.0 | 3042 | 91% | 201 | 6.6 | 6.6 | 6.6 | 0% | 11% / -18% | 11k | 291k |
| PRG-HRG | A321 16J/180Y | tour | 1.0 | 3042 | 91% | 203 | 6.7 | 6.6 | 6.4 | 4% | 14% / -14% | 147k | 291k |
| PRG-HRG | B763 16J/251Y | tour | 1.0 | 3042 | 100% | 197 | 6.5 | 7.1 | 6.7 | 5% | 15% / -13% | 275k | 291k |
| PRG-HRG | A332 18J/282Y | tour | 1.0 | 3042 | 99% | 196 | 6.5 | 7.0 | 6.4 | 9% | 19% / -8% | 583k | 291k |
| PRG-RMF | A320 12J/156Y | tour | 1.0 | 3238 | 91% | 185 | 5.7 | 5.7 | 6.4 | -12% | 4% / -37% | -391k | 291k |
| PRG-RMF | A321 16J/180Y | tour | 1.0 | 3238 | 91% | 185 | 5.7 | 5.7 | 6.2 | -9% | 7% / -34% | -334k | 291k |
| PRG-RMF | B763 16J/251Y | tour | 1.0 | 3238 | 99% | 181 | 5.6 | 6.1 | 6.6 | -8% | 8% / -33% | -448k | 291k |
| PRG-RMF | A332 18J/282Y | tour | 1.0 | 3238 | 99% | 180 | 5.5 | 6.0 | 6.3 | -4% | 12% / -28% | -225k | 291k |
| PRG-TFS | A320 12J/156Y | tour | 1.0 | 3573 | 91% | 235 | 6.6 | 6.5 | 6.3 | 4% | 22% / -22% | 171k | 293k |
| PRG-TFS | A321 16J/180Y | tour | 1.0 | 3573 | 90% | 234 | 6.6 | 6.5 | 6.1 | 6% | 24% / -21% | 295k | 293k |
| PRG-TFS | B763 16J/251Y | tour | 1.0 | 3573 | 90% | 237 | 6.6 | 6.5 | 6.3 | 2% | 25% / -39% | 151k | 293k |
| PRG-TFS | A332 18J/282Y | tour | 1.0 | 3573 | 85% | 239 | 6.7 | 6.2 | 6.0 | 4% | 28% / -45% | 272k | 293k |
| PRG-HER | A320 12J/156Y | tour | 1.0 s | 1864 | 91% | 172 | 9.2 | 9.3 | 8.3 | 11% | 19% / -5% | 161k | 297k |
| PRG-HER | A321 16J/180Y | tour | 1.0 s | 1864 | 91% | 174 | 9.3 | 9.4 | 8.1 | 14% | 22% / -1% | 248k | 297k |
| PRG-DJE | A320 12J/156Y | tour | 1.0 s | 1827 | 91% | 174 | 9.5 | 9.5 | 8.4 | 12% | 19% / -3% | 176k | 291k |
| PRG-DJE | A321 16J/180Y | tour | 1.0 s | 1827 | 91% | 175 | 9.6 | 9.5 | 8.1 | 15% | 22% / 1% | 265k | 291k |
| PRG-TLV | A320 12J/156Y | own | 2.0 | 2635 | 91% | 184 | 7.0 | 7.4 | 6.9 | 6% | 24% / -32% | 431k | 272k |
| PRG-TLV | A321 16J/180Y | own | 2.0 | 2635 | 91% | 188 | 7.1 | 7.4 | 6.7 | 10% | 27% / -27% | 778k | 272k |
| PRG-TLV | B763 16J/251Y | own | 2.0 | 2635 | 97% | 182 | 6.9 | 7.6 | 7.2 | 6% | 25% / -40% | 675k | 269k |
| PRG-TLV | A332 18J/282Y | own | 2.0 | 2635 | 93% | 185 | 7.0 | 7.4 | 6.7 | 9% | 29% / -44% | 1086k | 269k |
| PRG-HAN | A320 | can’t fly it (range or runway) |||||||||||
| PRG-HAN | A321 | can’t fly it (range or runway) |||||||||||
| PRG-HAN | B763 16J/251Y | own | 1.0 | 8322 | 100% | 441 | 5.3 | 5.8 | 5.3 | 9% | 21% / -2% | 1167k | 268k |
| PRG-HAN | A332 18J/282Y | own | 1.0 | 8322 | 100% | 441 | 5.3 | 5.8 | 5.0 | 13% | 25% / 3% | 1996k | 268k |
| SOF-STN | A320 12J/156Y | own | 1.0 | 2012 | 91% | 97 | 4.8 | 5.8 | 7.7 | -31% | -6% / -46% | -641k | 266k |
| SOF-STN | A321 16J/180Y | own | 1.0 | 2012 | 91% | 99 | 4.9 | 5.9 | 7.4 | -26% | -2% / -41% | -633k | 266k |
| SOF-FRA | A320 12J/156Y | own | 2.0 | 1396 | 91% | 129 | 9.2 | 10.4 | 9.6 | 8% | 27% / -15% | 390k | 262k |
| SOF-FRA | A321 16J/180Y | own | 2.0 | 1396 | 91% | 131 | 9.4 | 10.4 | 9.2 | 11% | 30% / -10% | 664k | 262k |
| SOF-MAD | A320 12J/156Y | own | 1.0 | 2247 | 91% | 104 | 4.6 | 5.4 | 7.3 | -34% | 0% / -66% | -734k | 262k |
| SOF-MAD | A321 16J/180Y | own | 1.0 | 2247 | 91% | 106 | 4.7 | 5.5 | 7.0 | -29% | 4% / -60% | -726k | 262k |
| SOF-MXP | A320 12J/156Y | own | 1.0 | 1214 | 91% | 91 | 7.5 | 8.9 | 10.2 | -14% | 11% / -44% | -274k | 266k |
| SOF-MXP | A321 16J/180Y | own | 1.0 | 1214 | 91% | 93 | 7.6 | 9.0 | 9.8 | -10% | 14% / -38% | -214k | 266k |
| SOF-TLV | A320 12J/156Y | own | 2.0 | 1559 | 91% | 131 | 8.4 | 9.2 | 8.6 | 7% | 18% / -2% | 328k | 272k |
| SOF-TLV | A321 16J/180Y | own | 2.0 | 1559 | 91% | 133 | 8.5 | 9.3 | 8.4 | 10% | 21% / 2% | 595k | 272k |
| SOF-HRG | A320 12J/156Y | tour | 1.0 s | 1965 | 90% | 172 | 8.8 | 8.7 | 7.7 | 12% | 14% / 11% | 269k | 291k |
| SOF-HRG | A321 16J/180Y | tour | 1.0 s | 1965 | 88% | 172 | 8.8 | 8.5 | 7.4 | 14% | 17% / 12% | 356k | 291k |
| SOF-AYT | A320 12J/156Y | tour | 1.0 s | 902 | 91% | 119 | 13.3 | 14.1 | 12.2 | 13% | 21% / 2% | 171k | 289k |
| SOF-AYT | A321 16J/180Y | tour | 1.0 s | 902 | 90% | 119 | 13.4 | 13.9 | 11.6 | 16% | 24% / 4% | 244k | 289k |
| SOF-ORD | A320 | can’t fly it (range or runway) |||||||||||
| SOF-ORD | A321 | can’t fly it (range or runway) |||||||||||
| SOF-ORD | B763 16J/251Y | own | 1.0 | 8365 | 77% | 540 | 6.5 | 5.4 | 5.1 | 7% | 38% / -42% | 862k | 266k |
| SOF-ORD | A332 18J/282Y | own | 1.0 | 8365 | 73% | 546 | 6.5 | 5.2 | 4.8 | 8% | 41% / -48% | 1127k | 266k |
| TLL-STN | A320 12J/156Y | own | 1.0 | 1741 | 91% | 110 | 6.3 | 7.3 | 8.4 | -15% | 10% / -35% | -335k | 266k |
| TLL-STN | A321 16J/180Y | own | 1.0 | 1741 | 91% | 112 | 6.5 | 7.3 | 8.1 | -11% | 14% / -30% | -273k | 266k |
| TLL-ARN | A320 12J/156Y | own | 3.0 | 391 | 91% | 87 | 22.3 | 24.8 | 22.2 | 10% | 31% / -32% | 532k | 262k |
| TLL-ARN | A321 16J/180Y | own | 3.0 | 391 | 91% | 89 | 22.7 | 24.9 | 21.4 | 14% | 34% / -27% | 826k | 262k |
| TLL-OSL | A320 12J/156Y | own | 1.0 | 772 | 91% | 98 | 12.7 | 14.4 | 14.1 | 3% | 14% / -13% | 50k | 262k |
| TLL-OSL | A321 16J/180Y | own | 1.0 | 772 | 91% | 100 | 12.9 | 14.5 | 13.5 | 7% | 18% / -8% | 163k | 262k |
| TLL-DUB | A320 12J/156Y | own | 1.0 | 2004 | 91% | 125 | 6.2 | 6.8 | 7.7 | -14% | 13% / -48% | -330k | 266k |
| TLL-DUB | A321 16J/180Y | own | 1.0 | 2004 | 86% | 129 | 6.4 | 6.6 | 7.4 | -12% | 17% / -49% | -313k | 266k |
| TLL-TFS | A320 12J/156Y | tour | 1.0 s | 4685 | 65% | 306 | 6.6 | 4.6 | 5.7 | -23% | -14% / -35% | -501k | 289k |
| TLL-TFS | A321 | can’t fly it (range or runway) |||||||||||
| TLL-TFS | B763 16J/251Y | tour | 1.0 s | 4685 | 94% | 295 | 6.4 | 6.4 | 6.1 | 5% | 15% / -14% | 257k | 289k |
| TLL-TFS | A332 18J/282Y | tour | 1.0 s | 4685 | 91% | 295 | 6.4 | 6.2 | 5.8 | 7% | 18% / -14% | 389k | 289k |
| TLL-AYT | A320 12J/156Y | tour | 1.0 s | 2540 | 91% | 200 | 8.0 | 8.0 | 7.2 | 10% | 16% / -2% | 201k | 289k |
| TLL-AYT | A321 16J/180Y | tour | 1.0 s | 2540 | 91% | 202 | 8.0 | 8.0 | 7.0 | 13% | 19% / 2% | 306k | 289k |
| TLL-AYT | B763 16J/251Y | tour | 1.0 s | 2540 | 98% | 198 | 7.9 | 8.4 | 7.3 | 13% | 20% / -2% | 459k | 289k |
| TLL-AYT | A332 18J/282Y | tour | 1.0 s | 2540 | 96% | 199 | 7.9 | 8.3 | 6.9 | 17% | 24% / 0% | 644k | 289k |
| TLL-HRG | A320 12J/156Y | tour | 1.0 s | 3650 | 91% | 259 | 7.2 | 7.0 | 6.4 | 8% | 12% / 3% | 207k | 291k |
| TLL-HRG | A321 16J/180Y | tour | 1.0 s | 3650 | 90% | 258 | 7.1 | 6.9 | 6.2 | 10% | 14% / 4% | 292k | 291k |
| TLL-HRG | B763 16J/251Y | tour | 1.0 s | 3650 | 91% | 256 | 7.1 | 6.9 | 6.3 | 10% | 17% / -8% | 384k | 291k |
| TLL-HRG | A332 18J/282Y | tour | 1.0 s | 3650 | 87% | 257 | 7.1 | 6.6 | 5.9 | 11% | 20% / -13% | 466k | 291k |
| TLL-HKT | A320 | can’t fly it (range or runway) |||||||||||
| TLL-HKT | A321 | can’t fly it (range or runway) |||||||||||
| TLL-HKT | B763 16J/251Y | tour | 0.2 s | 8301 | 96% | 604 | 7.3 | 7.4 | 6.5 | 12% | 24% / -2% | 229k | 297k |
| TLL-HKT | A332 18J/282Y | tour | 0.2 s | 8301 | 95% | 606 | 7.3 | 7.3 | 6.2 | 15% | 27% / 0% | 337k | 297k |

### Cost per block hour by kind (USD, same plans)

| market | type | fuel | crew | maint | aircraft | nav | landing+pax | handling | catering+services | distribution | overheads | disruption | total | revenue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 | 1956 | 390 | 900 | 980 | 591 | 384 | 560 | 791 | 624 | 559 | 255 | 8112 | 10184 |
| LIS-OXB | A321 | 2269 | 390 | 1000 | 1200 | 658 | 426 | 560 | 851 | 679 | 559 | 283 | 9057 | 11311 |
| LIS-OXB | B763 | 4146 | 553 | 1700 | 840 | 828 | 728 | 1141 | 961 | 789 | 570 | 337 | 12870 | 13476 |
| LIS-OXB | A332 | 4537 | 620 | 1550 | 1120 | 909 | 794 | 1164 | 987 | 811 | 582 | 346 | 13701 | 13844 |
| LIS-TMS | A320 | 1964 | 484 | 900 | 980 | 568 | 249 | 380 | 623 | 0 | 185 | 0 | 6423 | 7950 |
| LIS-TMS | B763 | 4164 | 685 | 1700 | 840 | 804 | 494 | 781 | 1016 | 0 | 190 | 0 | 10878 | 11833 |
| LIS-TMS | A332 | 4557 | 751 | 1550 | 1120 | 877 | 536 | 792 | 1053 | 0 | 192 | 0 | 11636 | 12196 |
| LIS-DIL | B763 | 3949 | 768 | 1700 | 840 | 545 | 368 | 426 | 439 | 1191 | 941 | 310 | 11547 | 12386 |
| LIS-RAI | A320 | 1911 | 390 | 900 | 980 | 452 | 361 | 524 | 797 | 554 | 543 | 203 | 7731 | 8135 |
| LIS-RAI | A321 | 2216 | 390 | 1000 | 1200 | 503 | 400 | 524 | 897 | 612 | 543 | 228 | 8648 | 9123 |
| LIS-RAI | B763 | 4051 | 553 | 1700 | 840 | 634 | 705 | 1068 | 1301 | 926 | 554 | 336 | 12860 | 13455 |
| LIS-RAI | A332 | 4433 | 620 | 1550 | 1120 | 695 | 774 | 1090 | 1437 | 1022 | 565 | 371 | 13875 | 14838 |
| LIS-SID | A320 | 1911 | 390 | 900 | 980 | 460 | 377 | 544 | 832 | 705 | 519 | 203 | 7877 | 8111 |
| LIS-SID | A321 | 2216 | 390 | 1000 | 1200 | 512 | 422 | 544 | 958 | 815 | 519 | 234 | 8866 | 9348 |
| LIS-SID | B763 | 4051 | 553 | 1700 | 840 | 646 | 733 | 1111 | 1292 | 1145 | 530 | 326 | 12983 | 13047 |
| LIS-SID | A332 | 4433 | 620 | 1550 | 1120 | 710 | 804 | 1135 | 1390 | 1245 | 542 | 354 | 13960 | 14168 |
| LIS-BVC | A320 | 1938 | 390 | 900 | 980 | 451 | 350 | 533 | 765 | 781 | 509 | 218 | 7845 | 8718 |
| LIS-BVC | A321 | 2248 | 390 | 1000 | 1200 | 502 | 386 | 533 | 790 | 814 | 509 | 227 | 8629 | 9085 |
| LIS-BVC | B763 | 4108 | 553 | 1700 | 840 | 633 | 654 | 1088 | 857 | 898 | 519 | 250 | 12130 | 9994 |
| LIS-BVC | A332 | 4495 | 620 | 1550 | 1120 | 695 | 713 | 1111 | 875 | 917 | 530 | 255 | 12913 | 10207 |
| LIS-LAD | B763 | 4023 | 661 | 1700 | 840 | 798 | 471 | 666 | 968 | 703 | 190 | 311 | 11566 | 12442 |
| LIS-LAD | A332 | 4403 | 755 | 1550 | 1120 | 869 | 514 | 673 | 1084 | 788 | 192 | 346 | 12530 | 13858 |
| LIS-MPM | B763 | 4124 | 628 | 1700 | 840 | 730 | 294 | 437 | 762 | 501 | 233 | 241 | 10593 | 9625 |
| LIS-MPM | A332 | 4514 | 715 | 1550 | 1120 | 805 | 322 | 447 | 812 | 532 | 239 | 257 | 11421 | 10266 |
| LIS-REC | B763 | 3965 | 659 | 1700 | 840 | 485 | 406 | 577 | 953 | 696 | 299 | 298 | 11042 | 11931 |
| LIS-REC | A332 | 4340 | 753 | 1550 | 1120 | 532 | 446 | 587 | 1071 | 785 | 304 | 335 | 11989 | 13388 |
| LIS-FOR | B763 | 3966 | 663 | 1700 | 840 | 492 | 413 | 600 | 960 | 692 | 311 | 292 | 11065 | 11682 |
| LIS-FOR | A332 | 4339 | 759 | 1550 | 1120 | 540 | 454 | 614 | 1053 | 763 | 318 | 322 | 11974 | 12873 |
| OPO-RAI | A320 | 1911 | 390 | 900 | 980 | 454 | 313 | 469 | 739 | 559 | 2014 | 212 | 9017 | 8478 |
| OPO-RAI | A321 | 2216 | 390 | 1000 | 1200 | 505 | 344 | 469 | 790 | 586 | 2014 | 224 | 9818 | 8979 |
| OPO-RAI | B763 | 4051 | 553 | 1700 | 840 | 636 | 611 | 956 | 1201 | 933 | 2051 | 344 | 13954 | 13775 |
| OPO-RAI | A332 | 4433 | 620 | 1550 | 1120 | 697 | 670 | 974 | 1318 | 1028 | 2090 | 379 | 14959 | 15161 |
| OPO-OXB | A320 | 1956 | 390 | 900 | 980 | 572 | 330 | 494 | 727 | 594 | 1558 | 239 | 8846 | 9557 |
| OPO-OXB | A321 | 2269 | 390 | 1000 | 1200 | 636 | 367 | 494 | 797 | 658 | 1558 | 265 | 9749 | 10581 |
| OPO-OXB | B763 | 4146 | 553 | 1700 | 840 | 800 | 627 | 1006 | 923 | 786 | 1586 | 316 | 13419 | 12648 |
| OPO-OXB | A332 | 4537 | 620 | 1550 | 1120 | 877 | 683 | 1024 | 953 | 814 | 1615 | 328 | 14261 | 13110 |
| VNO-LTN | A320 | 1793 | 390 | 900 | 980 | 707 | 574 | 769 | 1270 | 665 | 736 | 194 | 9098 | 7742 |
| VNO-LTN | A321 | 2079 | 390 | 1000 | 1200 | 786 | 639 | 769 | 1463 | 746 | 736 | 218 | 10145 | 8727 |
| VNO-DUB | A320 | 1793 | 390 | 900 | 980 | 715 | 515 | 681 | 1098 | 617 | 636 | 188 | 8576 | 7504 |
| VNO-DUB | A321 | 2079 | 390 | 1000 | 1200 | 795 | 576 | 681 | 1311 | 723 | 636 | 220 | 9676 | 8817 |
| VNO-OSL | A320 | 1819 | 390 | 900 | 980 | 655 | 866 | 1200 | 1847 | 904 | 1101 | 237 | 11050 | 9484 |
| VNO-OSL | A321 | 2110 | 390 | 1000 | 1200 | 729 | 969 | 1200 | 2204 | 1059 | 1101 | 278 | 12391 | 11114 |
| VNO-TFS | A320 | 1826 | 485 | 900 | 980 | 682 | 200 | 307 | 587 | 567 | 375 | 156 | 7090 | 6220 |
| VNO-TFS | A321 | 2118 | 485 | 1000 | 1200 | 759 | 222 | 307 | 660 | 627 | 375 | 172 | 7952 | 6874 |
| VNO-TFS | B763 | 3872 | 685 | 1700 | 840 | 962 | 406 | 626 | 1201 | 1224 | 383 | 335 | 12269 | 13414 |
| VNO-TFS | A332 | 4238 | 751 | 1550 | 1120 | 1063 | 447 | 640 | 1353 | 1385 | 391 | 379 | 13355 | 15177 |
| VNO-AYT | A320 | 1810 | 390 | 900 | 980 | 713 | 434 | 577 | 1129 | 860 | 766 | 244 | 8871 | 9756 |
| VNO-AYT | A321 | 2100 | 390 | 1000 | 1200 | 793 | 484 | 577 | 1346 | 1010 | 766 | 286 | 10024 | 11428 |
| VNO-TBS | A320 | 1868 | 390 | 900 | 980 | 934 | 417 | 568 | 1098 | 704 | 636 | 240 | 8840 | 9581 |
| VNO-TBS | A321 | 2167 | 390 | 1000 | 1200 | 1038 | 466 | 568 | 1303 | 821 | 636 | 280 | 9974 | 11192 |
| VNO-TLV | A320 | 1837 | 390 | 900 | 980 | 747 | 453 | 587 | 901 | 592 | 615 | 201 | 8247 | 8041 |
| VNO-TLV | A321 | 2131 | 390 | 1000 | 1200 | 831 | 505 | 587 | 1042 | 681 | 615 | 232 | 9260 | 9298 |
| VNO-TLV | B763 | 3895 | 553 | 1700 | 840 | 1050 | 885 | 1200 | 1361 | 935 | 629 | 317 | 13413 | 12676 |
| VNO-TLV | A332 | 4263 | 620 | 1550 | 1120 | 1129 | 949 | 1200 | 1441 | 994 | 629 | 338 | 14282 | 13524 |
| VNO-ORD | B763 | 3710 | 637 | 1700 | 840 | 639 | 560 | 531 | 959 | 622 | 283 | 294 | 10883 | 11762 |
| VNO-ORD | A332 | 4060 | 725 | 1550 | 1120 | 698 | 612 | 540 | 1040 | 680 | 288 | 321 | 11745 | 12858 |
| MLA-MAN | A320 | 1821 | 390 | 900 | 980 | 805 | 417 | 644 | 991 | 654 | 574 | 195 | 8428 | 7784 |
| MLA-MAN | A321 | 2112 | 390 | 1000 | 1200 | 895 | 467 | 644 | 1183 | 771 | 574 | 228 | 9522 | 9126 |
| MLA-GLA | A320 | 1838 | 390 | 900 | 980 | 821 | 324 | 541 | 786 | 597 | 482 | 174 | 7866 | 6957 |
| MLA-GLA | A321 | 2132 | 390 | 1000 | 1200 | 913 | 360 | 541 | 853 | 663 | 482 | 193 | 8759 | 7701 |
| MLA-GLA | B763 | 3896 | 553 | 1700 | 840 | 1152 | 622 | 1107 | 1055 | 865 | 492 | 250 | 12566 | 9991 |
| MLA-GLA | A332 | 4264 | 620 | 1550 | 1120 | 1266 | 682 | 1132 | 1108 | 916 | 503 | 264 | 13458 | 10560 |
| MLA-MJI | A320 | 1999 | 390 | 900 | 980 | 481 | 1347 | 2400 | 4000 | 2083 | 2895 | 681 | 18564 | 27254 |
| MLA-MJI | A321 | 2318 | 390 | 1000 | 1200 | 534 | 1500 | 2400 | 4665 | 2375 | 2895 | 781 | 20495 | 31224 |
| MLA-BEN | A320 | 1999 | 390 | 900 | 980 | 541 | 871 | 1613 | 2414 | 0 | 1038 | 0 | 10980 | 11103 |
| MLA-BEN | A321 | 2318 | 390 | 1000 | 1200 | 601 | 965 | 1613 | 2696 | 0 | 1038 | 0 | 12056 | 11252 |
| MLA-CTA | A320 | 1837 | 390 | 900 | 980 | 320 | 1512 | 2600 | 4514 | 1941 | 769 | 391 | 16605 | 15638 |
| MLA-CTA | A321 | 2131 | 390 | 1000 | 1200 | 356 | 1692 | 2600 | 5379 | 2268 | 769 | 454 | 18689 | 18159 |
| MLA-CPH | A320 | 1819 | 390 | 900 | 980 | 838 | 421 | 677 | 1042 | 829 | 604 | 239 | 8777 | 9543 |
| MLA-CPH | A321 | 2110 | 390 | 1000 | 1200 | 932 | 471 | 677 | 1229 | 973 | 604 | 279 | 9904 | 11167 |
| MLA-LDE | A320 | 1864 | 390 | 900 | 980 | 833 | 539 | 859 | 1523 | 1115 | 3405 | 298 | 12590 | 11903 |
| MLA-LDE | A321 | 2162 | 390 | 1000 | 1200 | 926 | 606 | 859 | 1745 | 1289 | 3405 | 344 | 13803 | 13764 |
| MLA-JFK | B763 | 3771 | 638 | 1700 | 840 | 601 | 620 | 577 | 1077 | 679 | 360 | 319 | 11287 | 12743 |
| MLA-JFK | A332 | 4127 | 728 | 1550 | 1120 | 663 | 687 | 592 | 1009 | 772 | 369 | 361 | 12085 | 14451 |
| MAD-LPA | A320 | 1828 | 390 | 900 | 980 | 631 | 561 | 825 | 1270 | 700 | 231 | 216 | 8801 | 8643 |
| MAD-LPA | A321 | 2121 | 390 | 1000 | 1200 | 701 | 628 | 825 | 1515 | 821 | 231 | 254 | 9984 | 10167 |
| MAD-IBZ | A320 | 1837 | 390 | 900 | 980 | 446 | 1440 | 2112 | 3125 | 1573 | 1061 | 407 | 14411 | 16266 |
| MAD-IBZ | A321 | 2131 | 390 | 1000 | 1200 | 496 | 1612 | 2112 | 3730 | 1842 | 1061 | 477 | 16189 | 19087 |
| MAD-TNG | A320 | 1864 | 390 | 900 | 980 | 481 | 1221 | 1757 | 3149 | 1409 | 560 | 365 | 13291 | 14613 |
| MAD-TNG | A321 | 2162 | 390 | 1000 | 1200 | 534 | 1363 | 1757 | 3605 | 1617 | 560 | 418 | 14822 | 16709 |
| MAD-OTP | A320 | 1811 | 390 | 900 | 980 | 820 | 432 | 572 | 945 | 502 | 515 | 148 | 8096 | 5903 |
| MAD-OTP | A321 | 2101 | 390 | 1000 | 1200 | 912 | 483 | 572 | 1128 | 589 | 515 | 173 | 9144 | 6929 |
| MAD-SSG | A320 | 1972 | 497 | 900 | 980 | 590 | 321 | 429 | 733 | 0 | 218 | 0 | 6696 | 8523 |
| MAD-SSG | A321 | 2287 | 497 | 1000 | 1200 | 656 | 357 | 429 | 836 | 0 | 218 | 0 | 7539 | 8672 |
| MAD-SSG | B763 | 4180 | 698 | 1700 | 840 | 835 | 644 | 882 | 1296 | 0 | 224 | 0 | 11438 | 13605 |
| MAD-SSG | A332 | 4574 | 801 | 1550 | 1120 | 911 | 702 | 896 | 1394 | 0 | 227 | 0 | 12317 | 13890 |
| MAD-VVI | A332 | 4393 | 779 | 1550 | 1120 | 536 | 329 | 409 | 1126 | 658 | 215 | 303 | 11559 | 12127 |
| MAD-HAV | B763 | 3986 | 699 | 1700 | 840 | 494 | 483 | 598 | 1200 | 737 | 93 | 301 | 11266 | 12031 |
| MAD-HAV | A332 | 4359 | 720 | 1550 | 1120 | 544 | 533 | 612 | 1357 | 836 | 95 | 340 | 12207 | 13594 |
| RIX-LGW | A320 | 1793 | 390 | 900 | 980 | 728 | 621 | 829 | 1290 | 694 | 264 | 207 | 8818 | 8286 |
| RIX-LGW | A321 | 2079 | 390 | 1000 | 1200 | 810 | 695 | 829 | 1539 | 813 | 264 | 243 | 9986 | 9709 |
| RIX-DUB | A320 | 1793 | 390 | 900 | 980 | 727 | 508 | 718 | 1144 | 643 | 663 | 196 | 8730 | 7821 |
| RIX-DUB | A321 | 2079 | 390 | 1000 | 1200 | 809 | 569 | 718 | 1365 | 753 | 663 | 230 | 9844 | 9187 |
| RIX-OSL | A320 | 1819 | 390 | 900 | 980 | 641 | 1002 | 1483 | 2257 | 1133 | 673 | 306 | 11768 | 12232 |
| RIX-OSL | A321 | 2110 | 390 | 1000 | 1200 | 712 | 1122 | 1483 | 2694 | 1327 | 673 | 358 | 13254 | 14335 |
| RIX-TFS | A320 | 1826 | 484 | 900 | 980 | 695 | 185 | 309 | 574 | 556 | 373 | 153 | 7061 | 6109 |
| RIX-TFS | A321 | 2119 | 484 | 1000 | 1200 | 772 | 206 | 309 | 632 | 608 | 373 | 167 | 7896 | 6666 |
| RIX-TFS | B763 | 3872 | 685 | 1700 | 840 | 967 | 372 | 626 | 1134 | 1169 | 378 | 320 | 12097 | 12811 |
| RIX-TFS | A332 | 4237 | 751 | 1550 | 1120 | 1067 | 413 | 644 | 1273 | 1322 | 389 | 362 | 13164 | 14486 |
| RIX-SSH | A320 | 1837 | 390 | 900 | 980 | 679 | 255 | 387 | 707 | 781 | 526 | 214 | 7676 | 8578 |
| RIX-SSH | A321 | 2131 | 390 | 1000 | 1200 | 755 | 285 | 387 | 806 | 901 | 526 | 247 | 8649 | 9899 |
| RIX-SSH | B763 | 3895 | 553 | 1700 | 840 | 950 | 500 | 788 | 1119 | 1294 | 536 | 356 | 12561 | 14225 |
| RIX-SSH | A332 | 4263 | 620 | 1550 | 1120 | 1040 | 549 | 802 | 1243 | 1448 | 546 | 398 | 13612 | 15922 |
| RIX-TBS | A320 | 1868 | 390 | 900 | 980 | 910 | 361 | 532 | 1016 | 675 | 588 | 235 | 8553 | 9395 |
| RIX-TBS | A321 | 2167 | 390 | 1000 | 1200 | 1012 | 403 | 532 | 1212 | 792 | 588 | 276 | 9671 | 11033 |
| RIX-TAS | A320 | 1793 | 390 | 900 | 980 | 1077 | 269 | 369 | 753 | 516 | 431 | 206 | 7801 | 8225 |
| RIX-TAS | A321 | 2079 | 390 | 1000 | 1200 | 1198 | 300 | 369 | 853 | 586 | 431 | 233 | 8757 | 9300 |
| RIX-TAS | B763 | 3800 | 553 | 1700 | 840 | 1505 | 522 | 750 | 1030 | 724 | 438 | 285 | 12268 | 11395 |
| RIX-TAS | A332 | 4159 | 620 | 1550 | 1120 | 1678 | 574 | 769 | 1093 | 771 | 450 | 303 | 13211 | 12140 |
| RIX-JFK | B763 | 3710 | 646 | 1700 | 840 | 660 | 682 | 606 | 938 | 670 | 327 | 309 | 11207 | 12376 |
| RIX-JFK | A332 | 4060 | 737 | 1550 | 1120 | 729 | 751 | 620 | 1032 | 742 | 334 | 343 | 12141 | 13707 |
| PRG-AYT | A320 | 1811 | 390 | 900 | 980 | 755 | 444 | 643 | 1129 | 861 | 766 | 244 | 8994 | 9772 |
| PRG-AYT | A321 | 2101 | 390 | 1000 | 1200 | 839 | 496 | 643 | 1345 | 1012 | 766 | 286 | 10151 | 11439 |
| PRG-HRG | A320 | 1840 | 390 | 900 | 980 | 726 | 304 | 462 | 781 | 695 | 453 | 194 | 7730 | 7756 |
| PRG-HRG | A321 | 2134 | 390 | 1000 | 1200 | 807 | 340 | 462 | 925 | 816 | 453 | 227 | 8759 | 9085 |
| PRG-HRG | B763 | 3901 | 553 | 1700 | 840 | 1018 | 600 | 941 | 1316 | 1211 | 462 | 338 | 12885 | 13508 |
| PRG-HRG | A332 | 4269 | 620 | 1550 | 1120 | 1118 | 661 | 960 | 1489 | 1377 | 471 | 384 | 14025 | 15369 |
| PRG-RMF | A320 | 1868 | 390 | 900 | 980 | 721 | 300 | 447 | 806 | 605 | 428 | 170 | 7621 | 6800 |
| PRG-RMF | A321 | 2167 | 390 | 1000 | 1200 | 802 | 335 | 447 | 939 | 705 | 428 | 198 | 8616 | 7914 |
| PRG-RMF | B763 | 3961 | 553 | 1700 | 840 | 1010 | 590 | 911 | 1333 | 1042 | 436 | 293 | 12675 | 11717 |
| PRG-RMF | A332 | 4334 | 620 | 1550 | 1120 | 1107 | 650 | 928 | 1499 | 1181 | 444 | 332 | 13772 | 13282 |
| PRG-TFS | A320 | 1827 | 390 | 900 | 980 | 702 | 261 | 420 | 758 | 704 | 369 | 196 | 7521 | 7849 |
| PRG-TFS | A321 | 2119 | 390 | 1000 | 1200 | 780 | 292 | 420 | 870 | 813 | 369 | 227 | 8494 | 9062 |
| PRG-TFS | B763 | 3872 | 553 | 1700 | 840 | 979 | 506 | 854 | 1151 | 1133 | 375 | 315 | 12294 | 12590 |
| PRG-TFS | A332 | 4237 | 620 | 1550 | 1120 | 1071 | 553 | 869 | 1244 | 1242 | 382 | 345 | 13248 | 13789 |
| PRG-HER | A320 | 1837 | 390 | 900 | 980 | 707 | 449 | 732 | 1195 | 911 | 814 | 258 | 9217 | 10310 |
| PRG-HER | A321 | 2131 | 390 | 1000 | 1200 | 786 | 503 | 732 | 1426 | 1071 | 814 | 302 | 10400 | 12081 |
| PRG-DJE | A320 | 1864 | 390 | 900 | 980 | 670 | 449 | 709 | 1231 | 949 | 965 | 265 | 9381 | 10613 |
| PRG-DJE | A321 | 2162 | 390 | 1000 | 1200 | 745 | 502 | 709 | 1452 | 1111 | 965 | 310 | 10555 | 12405 |
| PRG-TLV | A320 | 1840 | 390 | 900 | 980 | 760 | 456 | 633 | 893 | 609 | 304 | 215 | 8053 | 8600 |
| PRG-TLV | A321 | 2134 | 390 | 1000 | 1200 | 845 | 511 | 633 | 1066 | 715 | 304 | 253 | 9123 | 10109 |
| PRG-TLV | B763 | 3899 | 553 | 1700 | 840 | 1044 | 888 | 1280 | 1461 | 1031 | 308 | 358 | 13435 | 14300 |
| PRG-TLV | A332 | 4267 | 620 | 1550 | 1120 | 1149 | 977 | 1309 | 1619 | 1147 | 315 | 399 | 14547 | 15971 |
| PRG-HAN | B763 | 3840 | 629 | 1700 | 840 | 920 | 294 | 381 | 1045 | 647 | 215 | 299 | 10907 | 11951 |
| PRG-HAN | A332 | 4203 | 716 | 1550 | 1120 | 1014 | 325 | 389 | 1201 | 744 | 219 | 344 | 11946 | 13766 |
| SOF-STN | A320 | 1792 | 390 | 900 | 980 | 733 | 462 | 666 | 1113 | 570 | 645 | 162 | 8522 | 6495 |
| SOF-STN | A321 | 2079 | 390 | 1000 | 1200 | 816 | 518 | 666 | 1329 | 668 | 645 | 190 | 9608 | 7605 |
| SOF-FRA | A320 | 1793 | 390 | 900 | 980 | 747 | 866 | 1011 | 1505 | 863 | 487 | 270 | 9957 | 10789 |
| SOF-FRA | A321 | 2079 | 390 | 1000 | 1200 | 831 | 970 | 1011 | 1796 | 1012 | 487 | 316 | 11238 | 12657 |
| SOF-MAD | A320 | 1793 | 390 | 900 | 980 | 686 | 453 | 623 | 1016 | 534 | 658 | 153 | 8253 | 6136 |
| SOF-MAD | A321 | 2079 | 390 | 1000 | 1200 | 763 | 506 | 623 | 1212 | 626 | 658 | 180 | 9306 | 7210 |
| SOF-MXP | A320 | 1810 | 390 | 900 | 980 | 721 | 731 | 1013 | 1693 | 847 | 981 | 228 | 10418 | 9101 |
| SOF-MXP | A321 | 2100 | 390 | 1000 | 1200 | 802 | 819 | 1013 | 2021 | 992 | 981 | 267 | 11709 | 10682 |
| SOF-TLV | A320 | 1837 | 390 | 900 | 980 | 663 | 652 | 900 | 1401 | 809 | 477 | 250 | 9352 | 10005 |
| SOF-TLV | A321 | 2131 | 390 | 1000 | 1200 | 737 | 730 | 900 | 1672 | 948 | 477 | 294 | 10573 | 11756 |
| SOF-HRG | A320 | 1837 | 390 | 900 | 980 | 632 | 398 | 609 | 1066 | 873 | 752 | 247 | 8692 | 9874 |
| SOF-HRG | A321 | 2131 | 390 | 1000 | 1200 | 702 | 444 | 609 | 1202 | 998 | 752 | 282 | 9719 | 11285 |
| SOF-AYT | A320 | 1810 | 390 | 900 | 980 | 500 | 743 | 1078 | 2112 | 1126 | 1452 | 333 | 11529 | 13307 |
| SOF-AYT | A321 | 2100 | 390 | 1000 | 1200 | 556 | 831 | 1078 | 2456 | 1308 | 1452 | 385 | 12862 | 15401 |
| SOF-ORD | B763 | 3711 | 629 | 1700 | 840 | 617 | 480 | 477 | 808 | 581 | 257 | 281 | 10479 | 11247 |
| SOF-ORD | A332 | 4060 | 716 | 1550 | 1120 | 678 | 526 | 487 | 880 | 638 | 262 | 309 | 11325 | 12349 |
| TLL-STN | A320 | 1793 | 390 | 900 | 980 | 707 | 534 | 775 | 1250 | 672 | 724 | 196 | 9018 | 7830 |
| TLL-STN | A321 | 2079 | 390 | 1000 | 1200 | 786 | 598 | 775 | 1492 | 788 | 724 | 230 | 10160 | 9192 |
| TLL-ARN | A320 | 1810 | 390 | 900 | 980 | 481 | 1476 | 2200 | 3386 | 1670 | 673 | 407 | 14572 | 16276 |
| TLL-ARN | A321 | 2100 | 390 | 1000 | 1200 | 534 | 1651 | 2200 | 4036 | 1952 | 673 | 477 | 16414 | 19061 |
| TLL-OSL | A320 | 1819 | 390 | 900 | 980 | 622 | 1061 | 1588 | 2390 | 1227 | 1425 | 331 | 12884 | 13224 |
| TLL-OSL | A321 | 2110 | 390 | 1000 | 1200 | 691 | 1188 | 1588 | 2852 | 1437 | 1425 | 388 | 14422 | 15526 |
| TLL-DUB | A320 | 1793 | 390 | 900 | 980 | 733 | 501 | 717 | 1125 | 637 | 654 | 190 | 8652 | 7593 |
| TLL-DUB | A321 | 2079 | 390 | 1000 | 1200 | 816 | 557 | 717 | 1286 | 718 | 654 | 217 | 9667 | 8664 |
| TLL-TFS | A320 | 1826 | 484 | 900 | 980 | 692 | 177 | 301 | 516 | 514 | 358 | 141 | 6912 | 5624 |
| TLL-TFS | B763 | 3872 | 684 | 1700 | 840 | 975 | 362 | 617 | 1084 | 1161 | 368 | 317 | 12013 | 12692 |
| TLL-TFS | A332 | 4237 | 751 | 1550 | 1120 | 1062 | 395 | 625 | 1186 | 1282 | 373 | 350 | 12966 | 14006 |
| TLL-AYT | A320 | 1810 | 390 | 900 | 980 | 713 | 332 | 486 | 915 | 819 | 627 | 229 | 8260 | 9165 |
| TLL-AYT | A321 | 2100 | 390 | 1000 | 1200 | 793 | 371 | 486 | 1085 | 961 | 627 | 268 | 9340 | 10717 |
| TLL-AYT | B763 | 3838 | 553 | 1700 | 840 | 1002 | 657 | 994 | 1524 | 1415 | 642 | 394 | 13630 | 15743 |
| TLL-AYT | A332 | 4200 | 620 | 1550 | 1120 | 1103 | 725 | 1017 | 1723 | 1608 | 657 | 447 | 14847 | 17877 |
| TLL-HRG | A320 | 1837 | 390 | 900 | 980 | 686 | 234 | 360 | 829 | 765 | 483 | 209 | 7691 | 8364 |
| TLL-HRG | A321 | 2131 | 390 | 1000 | 1200 | 762 | 261 | 360 | 943 | 879 | 483 | 240 | 8671 | 9617 |
| TLL-HRG | B763 | 3895 | 553 | 1700 | 840 | 974 | 464 | 744 | 982 | 1239 | 500 | 339 | 12259 | 13548 |
| TLL-HRG | A332 | 4263 | 620 | 1550 | 1120 | 1065 | 508 | 757 | 1066 | 1354 | 508 | 370 | 13212 | 14802 |
| TLL-HKT | B763 | 3840 | 630 | 1700 | 840 | 982 | 258 | 346 | 1003 | 1422 | 2054 | 383 | 13523 | 15307 |
| TLL-HKT | A332 | 4203 | 716 | 1550 | 1120 | 1074 | 284 | 352 | 1132 | 1610 | 2095 | 433 | 14636 | 17308 |

### Summary

- A320: 54 markets, median margin 4%, 32 positive, 21 in 5–15 %, 3 above 20 %; result per BH over all 142 USD; median result per BH 405, of the paying ones 842; ACMI after aircraft and crew 1125 a BH (when there is work).
- A321: 52 markets, median margin 6%, 32 positive, 25 in 5–15 %, 1 above 20 %; result per BH over all 357 USD; median result per BH 543, of the paying ones 1249; ACMI after aircraft and crew 1260 a BH (when there is work).
- B763: 33 markets, median margin 6%, 25 positive, 19 in 5–15 %, 0 above 20 %; result per BH over all 562 USD; median result per BH 765, of the paying ones 876; ACMI after aircraft and crew 1715 a BH (when there is work).
- A332: 33 markets, median margin 8%, 26 positive, 17 in 5–15 %, 0 above 20 %; result per BH over all 857 USD; median result per BH 1040, of the paying ones 1345; ACMI after aircraft and crew 1601 a BH (when there is work).

## Appendix B. Business case, all-economy
f = flights a week (s: season only). Yield: ticket revenue per passenger ($) and per passenger-km (US¢). RASK/CASK: all revenue / all costs (incl. aircraft lease and insurance, crew, overheads) per seat-km (US¢). Quarters: best / worst quarter margin.

| market | type | model | f | km | LF | $/pax | yield ¢ | RASK ¢ | CASK ¢ | margin | quarters best/worst | result/yr | launch |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 180Y | own | 1.0 | 3058 | 81% | 226 | 7.4 | 7.1 | 6.2 | 12% | 23% / -7% | 497k | 274k |
| LIS-OXB | A321 220Y | own | 1.0 | 3058 | 72% | 229 | 7.5 | 6.5 | 5.7 | 12% | 25% / -13% | 528k | 274k |
| LIS-OXB | B763 309Y | own | 1.0 | 3058 | 57% | 237 | 7.8 | 5.4 | 5.7 | -6% | 14% / -56% | -298k | 271k |
| LIS-OXB | A332 330Y | own | 1.0 | 3058 | 53% | 237 | 7.8 | 5.1 | 5.5 | -10% | 11% / -62% | -507k | 271k |
| LIS-TMS | A320 180Y | partner | 1.0 | 4565 | 64% | 0 | 0.0 | 6.0 | 4.8 | 21% | 21% / 21% | 1075k | 143k |
| LIS-TMS | A321 | can’t fly it (range or runway) |||||||||||
| LIS-TMS | B763 309Y | partner | 1.0 | 4565 | 60% | 0 | 0.0 | 5.0 | 4.6 | 7% | 8% / 6% | 514k | 140k |
| LIS-TMS | A332 330Y | partner | 1.0 | 4565 | 57% | 0 | 0.0 | 4.8 | 4.5 | 5% | 6% / 4% | 345k | 140k |
| LIS-DIL | A320 | can’t fly it (range or runway) |||||||||||
| LIS-DIL | A321 | can’t fly it (range or runway) |||||||||||
| LIS-DIL | B763 309Y | tour | 0.3 | 14601 | 31% | 1881 | 14.3 | 4.6 | 4.8 | -5% | 13% / -51% | -259k | 348k |
| LIS-DIL | A332 | can’t fly it (range or runway) |||||||||||
| LIS-RAI | A320 180Y | own | 1.0 | 3001 | 85% | 160 | 5.3 | 5.5 | 5.9 | -7% | 5% / -25% | -227k | 274k |
| LIS-RAI | A321 220Y | own | 1.0 | 3001 | 75% | 160 | 5.3 | 4.9 | 5.4 | -10% | 3% / -28% | -346k | 274k |
| LIS-RAI | B763 309Y | own | 1.0 | 3001 | 86% | 161 | 5.4 | 5.6 | 5.7 | -2% | 13% / -25% | -86k | 271k |
| LIS-RAI | A332 330Y | own | 1.0 | 3001 | 85% | 162 | 5.4 | 5.5 | 5.6 | -2% | 14% / -27% | -95k | 271k |
| LIS-SID | A320 180Y | tour | 1.0 | 2794 | 85% | 168 | 6.0 | 5.8 | 6.1 | -4% | 15% / -19% | -124k | 289k |
| LIS-SID | A321 220Y | tour | 1.0 | 2794 | 81% | 168 | 6.0 | 5.5 | 5.6 | -2% | 17% / -16% | -57k | 289k |
| LIS-SID | B763 309Y | tour | 1.0 | 2794 | 84% | 175 | 6.2 | 5.9 | 5.9 | 1% | 26% / -22% | 45k | 289k |
| LIS-SID | A332 330Y | tour | 1.0 | 2794 | 81% | 175 | 6.3 | 5.7 | 5.7 | -1% | 27% / -27% | -31k | 289k |
| LIS-BVC | A320 180Y | tour | 1.0 | 2852 | 77% | 217 | 7.6 | 6.5 | 6.1 | 6% | 27% / -11% | 203k | 297k |
| LIS-BVC | A321 220Y | tour | 1.0 | 2852 | 66% | 219 | 7.7 | 5.5 | 5.5 | 0% | 25% / -22% | 3k | 297k |
| LIS-BVC | B763 309Y | tour | 1.0 | 2852 | 49% | 222 | 7.8 | 4.2 | 5.4 | -29% | 11% / -67% | -1121k | 293k |
| LIS-BVC | A332 330Y | tour | 1.0 | 2852 | 46% | 222 | 7.8 | 3.9 | 5.3 | -34% | 8% / -74% | -1321k | 293k |
| LIS-LAD | A320 | can’t fly it (range or runway) |||||||||||
| LIS-LAD | A321 | can’t fly it (range or runway) |||||||||||
| LIS-LAD | B763 309Y | own | 2.0 | 5780 | 95% | 252 | 4.4 | 5.0 | 4.9 | 2% | 13% / -17% | 400k | 262k |
| LIS-LAD | A332 330Y | own | 2.0 | 5780 | 93% | 253 | 4.4 | 4.9 | 4.9 | 1% | 13% / -22% | 121k | 262k |
| LIS-MPM | A320 | can’t fly it (range or runway) |||||||||||
| LIS-MPM | A321 | can’t fly it (range or runway) |||||||||||
| LIS-MPM | B763 309Y | own | 1.0 | 8400 | 56% | 413 | 4.9 | 3.1 | 4.3 | -39% | -13% / -101% | -3267k | 262k |
| LIS-MPM | A332 330Y | own | 1.0 | 8400 | 53% | 414 | 4.9 | 2.9 | 4.2 | -44% | -17% / -108% | -3695k | 262k |
| LIS-REC | A320 | can’t fly it (range or runway) |||||||||||
| LIS-REC | A321 | can’t fly it (range or runway) |||||||||||
| LIS-REC | B763 309Y | own | 1.0 | 5857 | 97% | 255 | 4.4 | 4.9 | 4.7 | 4% | 15% / -17% | 339k | 266k |
| LIS-REC | A332 330Y | own | 1.0 | 5857 | 95% | 256 | 4.4 | 4.8 | 4.6 | 3% | 16% / -22% | 294k | 266k |
| LIS-FOR | A320 | can’t fly it (range or runway) |||||||||||
| LIS-FOR | A321 | can’t fly it (range or runway) |||||||||||
| LIS-FOR | B763 309Y | own | 1.0 | 5612 | 89% | 252 | 4.5 | 4.6 | 4.7 | -2% | 14% / -34% | -142k | 262k |
| LIS-FOR | A332 330Y | own | 1.0 | 5612 | 86% | 254 | 4.5 | 4.5 | 4.6 | -3% | 14% / -39% | -251k | 262k |
| OPO-RAI | A320 180Y | own | 0.3 | 3257 | 85% | 187 | 5.8 | 5.7 | 6.9 | -20% | -7% / -40% | -178k | 274k |
| OPO-RAI | A321 220Y | own | 0.3 | 3257 | 71% | 188 | 5.8 | 4.8 | 6.1 | -28% | -12% / -49% | -249k | 274k |
| OPO-RAI | B763 309Y | own | 0.3 | 3257 | 88% | 189 | 5.8 | 5.8 | 6.2 | -6% | 8% / -27% | -96k | 271k |
| OPO-RAI | A332 330Y | own | 0.3 | 3257 | 86% | 190 | 5.8 | 5.7 | 6.1 | -6% | 9% / -30% | -91k | 271k |
| OPO-OXB | A320 180Y | own | 0.3 | 3334 | 83% | 234 | 7.2 | 6.9 | 6.9 | 0% | 12% / -20% | -2k | 270k |
| OPO-OXB | A321 220Y | own | 0.3 | 3334 | 75% | 237 | 7.2 | 6.3 | 6.2 | 0% | 15% / -29% | 5k | 270k |
| OPO-OXB | B763 309Y | own | 0.3 | 3334 | 62% | 247 | 7.5 | 5.3 | 6.0 | -13% | 9% / -73% | -249k | 267k |
| OPO-OXB | A332 330Y | own | 0.3 | 3334 | 58% | 247 | 7.5 | 5.0 | 5.9 | -18% | 6% / -79% | -328k | 267k |
| VNO-LTN | A320 180Y | own | 1.0 | 1724 | 85% | 89 | 5.2 | 6.0 | 7.6 | -27% | -1% / -44% | -516k | 266k |
| VNO-LTN | A321 220Y | own | 1.0 | 1724 | 77% | 89 | 5.2 | 5.4 | 6.9 | -28% | -2% / -45% | -589k | 266k |
| VNO-DUB | A320 180Y | own | 1.0 | 2048 | 85% | 107 | 5.2 | 5.7 | 7.0 | -23% | 2% / -44% | -503k | 262k |
| VNO-DUB | A321 220Y | own | 1.0 | 2048 | 81% | 107 | 5.2 | 5.4 | 6.4 | -20% | 5% / -40% | -499k | 262k |
| VNO-OSL | A320 180Y | own | 1.0 | 1047 | 85% | 74 | 7.1 | 8.3 | 10.4 | -25% | -10% / -46% | -407k | 262k |
| VNO-OSL | A321 220Y | own | 1.0 | 1047 | 81% | 74 | 7.1 | 7.8 | 9.5 | -21% | -6% / -41% | -395k | 262k |
| VNO-TFS | A320 180Y | tour | 1.0 s | 4469 | 67% | 268 | 6.1 | 4.4 | 5.3 | -21% | -13% / -32% | -452k | 293k |
| VNO-TFS | A321 220Y | tour | 1.0 s | 4469 | 60% | 269 | 6.1 | 3.9 | 4.9 | -25% | -16% / -36% | -575k | 293k |
| VNO-TFS | B763 309Y | tour | 1.0 s | 4469 | 97% | 270 | 6.1 | 6.4 | 5.5 | 14% | 21% / 1% | 760k | 293k |
| VNO-TFS | A332 330Y | tour | 1.0 s | 4469 | 96% | 271 | 6.1 | 6.3 | 5.4 | 15% | 22% / 1% | 848k | 293k |
| VNO-AYT | A320 180Y | tour | 1.0 s | 2016 | 85% | 159 | 8.0 | 7.6 | 7.2 | 6% | 13% / -7% | 95k | 289k |
| VNO-AYT | A321 220Y | tour | 1.0 s | 2016 | 81% | 159 | 8.0 | 7.2 | 6.6 | 8% | 15% / -4% | 162k | 289k |
| VNO-TBS | A320 180Y | own | 1.0 | 2038 | 85% | 144 | 7.1 | 7.3 | 7.2 | 1% | 17% / -34% | 17k | 272k |
| VNO-TBS | A321 220Y | own | 1.0 | 2038 | 79% | 145 | 7.1 | 6.8 | 6.6 | 2% | 19% / -35% | 64k | 272k |
| VNO-TLV | A320 180Y | own | 1.0 | 2627 | 85% | 151 | 5.8 | 5.7 | 6.4 | -11% | 11% / -63% | -320k | 272k |
| VNO-TLV | A321 220Y | own | 1.0 | 2627 | 78% | 153 | 5.8 | 5.3 | 5.8 | -10% | 14% / -67% | -319k | 272k |
| VNO-TLV | B763 309Y | own | 1.0 | 2627 | 79% | 160 | 6.1 | 5.5 | 6.0 | -9% | 21% / -104% | -406k | 269k |
| VNO-TLV | A332 330Y | own | 1.0 | 2627 | 75% | 160 | 6.1 | 5.3 | 5.9 | -12% | 20% / -115% | -562k | 269k |
| VNO-ORD | A320 | can’t fly it (range or runway) |||||||||||
| VNO-ORD | A321 | can’t fly it (range or runway) |||||||||||
| VNO-ORD | B763 309Y | own | 1.0 | 7552 | 74% | 400 | 5.3 | 4.3 | 4.5 | -3% | 32% / -59% | -363k | 266k |
| VNO-ORD | A332 330Y | own | 1.0 | 7552 | 73% | 404 | 5.4 | 4.4 | 4.4 | -2% | 35% / -65% | -230k | 266k |
| MLA-MAN | A320 180Y | tour | 1.0 | 2342 | 85% | 135 | 5.8 | 5.8 | 6.6 | -14% | 7% / -59% | -361k | 293k |
| MLA-MAN | A321 220Y | tour | 1.0 | 2342 | 81% | 135 | 5.8 | 5.5 | 6.1 | -11% | 10% / -55% | -329k | 293k |
| MLA-GLA | A320 180Y | tour | 1.0 | 2645 | 79% | 153 | 5.8 | 5.2 | 6.2 | -19% | 9% / -101% | -482k | 289k |
| MLA-GLA | A321 220Y | tour | 1.0 | 2645 | 70% | 155 | 5.9 | 4.7 | 5.7 | -20% | 11% / -122% | -561k | 289k |
| MLA-GLA | B763 309Y | tour | 1.0 | 2645 | 63% | 162 | 6.1 | 4.4 | 5.7 | -30% | 15% / -207% | -1112k | 289k |
| MLA-GLA | A332 330Y | tour | 1.0 | 2645 | 59% | 162 | 6.1 | 4.1 | 5.6 | -34% | 12% / -218% | -1288k | 289k |
| MLA-MJI | A320 180Y | own | 1.0 | 347 | 84% | 112 | 32.4 | 36.3 | 25.9 | 29% | 34% / 21% | 679k | 276k |
| MLA-MJI | A321 220Y | own | 1.0 | 347 | 76% | 113 | 32.6 | 33.0 | 23.0 | 30% | 37% / 18% | 790k | 276k |
| MLA-BEN | A320 180Y | partner | 1.0 | 678 | 68% | 0 | 0.0 | 11.4 | 11.4 | 1% | 6% / -5% | 9k | 147k |
| MLA-BEN | A321 220Y | partner | 1.0 | 678 | 58% | 0 | 0.0 | 9.4 | 10.1 | -7% | -6% / -10% | -109k | 147k |
| MLA-CTA | A320 180Y | own | 3.0 | 187 | 85% | 48 | 25.7 | 31.7 | 35.0 | -10% | 12% / -41% | -344k | 270k |
| MLA-CTA | A321 220Y | own | 3.0 | 187 | 81% | 48 | 25.7 | 29.7 | 32.0 | -8% | 14% / -38% | -289k | 270k |
| MLA-CPH | A320 180Y | tour | 1.0 | 2202 | 85% | 163 | 7.4 | 7.2 | 7.0 | 3% | 18% / -44% | 93k | 289k |
| MLA-CPH | A321 220Y | tour | 1.0 | 2202 | 81% | 163 | 7.4 | 6.8 | 6.4 | 6% | 20% / -40% | 203k | 289k |
| MLA-LDE | A320 180Y | tour | 0.3 s | 1482 | 85% | 162 | 10.4 | 9.3 | 10.2 | -10% | -3% / -13% | -39k | 297k |
| MLA-LDE | A321 220Y | tour | 0.3 s | 1482 | 81% | 162 | 10.4 | 8.8 | 9.2 | -4% | 2% / -7% | -18k | 297k |
| MLA-JFK | A320 | can’t fly it (range or runway) |||||||||||
| MLA-JFK | A321 | can’t fly it (range or runway) |||||||||||
| MLA-JFK | B763 309Y | own | 1.0 s | 7384 | 89% | 380 | 5.1 | 5.1 | 4.7 | 8% | 23% / -26% | 615k | 271k |
| MLA-JFK | A332 330Y | own | 1.0 s | 7384 | 88% | 381 | 5.1 | 5.1 | 4.6 | 10% | 25% / -25% | 854k | 271k |
| MAD-LPA | A320 180Y | own | 3.0 | 1765 | 85% | 101 | 5.7 | 6.5 | 7.1 | -10% | 13% / -25% | -659k | 266k |
| MAD-LPA | A321 220Y | own | 3.0 | 1765 | 81% | 101 | 5.7 | 6.1 | 6.6 | -8% | 15% / -22% | -579k | 266k |
| MAD-IBZ | A320 180Y | own | 2.0 s | 458 | 85% | 81 | 17.6 | 19.2 | 18.0 | 6% | 22% / -14% | 122k | 262k |
| MAD-IBZ | A321 220Y | own | 2.0 s | 458 | 81% | 81 | 17.6 | 18.1 | 16.4 | 10% | 25% / -10% | 214k | 262k |
| MAD-TNG | A320 180Y | own | 3.0 | 566 | 85% | 73 | 12.9 | 15.1 | 14.5 | 4% | 22% / -7% | 209k | 262k |
| MAD-TNG | A321 220Y | own | 3.0 | 566 | 79% | 73 | 13.0 | 14.1 | 13.2 | 6% | 25% / -7% | 337k | 262k |
| MAD-OTP | A320 180Y | own | 1.0 | 2458 | 85% | 92 | 3.7 | 4.3 | 6.4 | -50% | -32% / -77% | -982k | 266k |
| MAD-OTP | A321 220Y | own | 1.0 | 2458 | 81% | 92 | 3.7 | 4.0 | 5.9 | -47% | -29% / -74% | -1058k | 266k |
| MAD-SSG | A320 180Y | partner | 1.0 | 4264 | 72% | 0 | 0.0 | 6.2 | 5.0 | 20% | 20% / 20% | 1002k | 143k |
| MAD-SSG | A321 220Y | partner | 1.0 | 4264 | 65% | 0 | 0.0 | 5.3 | 4.6 | 13% | 13% / 13% | 648k | 143k |
| MAD-SSG | B763 309Y | partner | 1.0 | 4264 | 78% | 0 | 0.0 | 5.6 | 4.9 | 13% | 21% / 3% | 986k | 140k |
| MAD-SSG | A332 330Y | partner | 1.0 | 4264 | 75% | 0 | 0.0 | 5.3 | 4.8 | 10% | 18% / 1% | 791k | 140k |
| MAD-VVI | A320 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | A321 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | B763 | can’t fly it (range or runway) |||||||||||
| MAD-VVI | A332 330Y | own | 1.0 | 8917 | 100% | 332 | 3.7 | 4.2 | 4.4 | -3% | 7% / -18% | -412k | 262k |
| MAD-HAV | A320 | can’t fly it (range or runway) |||||||||||
| MAD-HAV | A321 | can’t fly it (range or runway) |||||||||||
| MAD-HAV | B763 309Y | own | 3.0 | 7462 | 96% | 349 | 4.5 | 4.8 | 4.8 | 0% | 13% / -23% | 37k | 284k |
| MAD-HAV | A332 330Y | own | 3.0 | 7462 | 93% | 351 | 4.5 | 4.8 | 4.7 | 1% | 15% / -26% | 350k | 284k |
| RIX-LGW | A320 180Y | own | 3.0 | 1692 | 85% | 96 | 5.6 | 6.4 | 7.4 | -15% | 8% / -30% | -904k | 266k |
| RIX-LGW | A321 220Y | own | 3.0 | 1692 | 81% | 96 | 5.6 | 6.0 | 6.8 | -12% | 10% / -27% | -877k | 266k |
| RIX-DUB | A320 180Y | own | 1.0 | 1943 | 85% | 107 | 5.5 | 6.0 | 7.2 | -20% | 5% / -40% | -439k | 262k |
| RIX-DUB | A321 220Y | own | 1.0 | 1943 | 81% | 107 | 5.5 | 5.6 | 6.6 | -17% | 7% / -36% | -424k | 262k |
| RIX-OSL | A320 180Y | own | 2.0 | 829 | 85% | 80 | 9.7 | 11.1 | 11.3 | -2% | 10% / -19% | -82k | 262k |
| RIX-OSL | A321 220Y | own | 2.0 | 829 | 81% | 80 | 9.7 | 10.5 | 10.4 | 1% | 13% / -16% | 25k | 262k |
| RIX-TFS | A320 180Y | tour | 1.0 s | 4507 | 66% | 269 | 6.0 | 4.3 | 5.3 | -23% | -14% / -34% | -479k | 293k |
| RIX-TFS | A321 220Y | tour | 1.0 s | 4507 | 59% | 268 | 6.0 | 3.8 | 4.9 | -27% | -18% / -38% | -618k | 293k |
| RIX-TFS | B763 309Y | tour | 1.0 s | 4507 | 92% | 273 | 6.1 | 6.1 | 5.4 | 11% | 21% / -8% | 565k | 293k |
| RIX-TFS | A332 330Y | tour | 1.0 s | 4507 | 90% | 273 | 6.1 | 6.0 | 5.3 | 11% | 22% / -12% | 603k | 293k |
| RIX-SSH | A320 180Y | tour | 1.0 s | 3322 | 85% | 228 | 6.9 | 6.4 | 5.9 | 7% | 11% / 3% | 163k | 299k |
| RIX-SSH | A321 220Y | tour | 1.0 s | 3322 | 81% | 228 | 6.9 | 6.1 | 5.5 | 9% | 13% / 5% | 251k | 299k |
| RIX-SSH | B763 309Y | tour | 1.0 s | 3322 | 93% | 230 | 7.0 | 7.0 | 5.8 | 18% | 24% / 2% | 763k | 295k |
| RIX-SSH | A332 330Y | tour | 1.0 s | 3322 | 91% | 230 | 7.0 | 6.8 | 5.7 | 17% | 25% / -2% | 779k | 295k |
| RIX-TBS | A320 180Y | own | 1.0 | 2260 | 85% | 155 | 6.8 | 6.9 | 6.8 | 2% | 18% / -33% | 51k | 272k |
| RIX-TBS | A321 220Y | own | 1.0 | 2260 | 80% | 155 | 6.9 | 6.5 | 6.3 | 4% | 20% / -31% | 128k | 272k |
| RIX-TAS | A320 180Y | own | 1.0 | 3641 | 84% | 203 | 5.6 | 5.6 | 5.9 | -5% | 4% / -19% | -209k | 269k |
| RIX-TAS | A321 220Y | own | 1.0 | 3641 | 77% | 204 | 5.6 | 5.1 | 5.4 | -6% | 6% / -26% | -248k | 269k |
| RIX-TAS | B763 309Y | own | 1.0 | 3641 | 67% | 211 | 5.8 | 4.6 | 5.4 | -18% | 2% / -70% | -946k | 269k |
| RIX-TAS | A332 330Y | own | 1.0 | 3641 | 64% | 211 | 5.8 | 4.3 | 5.2 | -22% | -1% / -76% | -1161k | 269k |
| RIX-JFK | A320 | can’t fly it (range or runway) |||||||||||
| RIX-JFK | A321 | can’t fly it (range or runway) |||||||||||
| RIX-JFK | B763 309Y | own | 1.0 | 6746 | 80% | 354 | 5.2 | 4.7 | 4.7 | 1% | 33% / -47% | 107k | 271k |
| RIX-JFK | A332 330Y | own | 1.0 | 6746 | 78% | 356 | 5.3 | 4.6 | 4.6 | 1% | 34% / -52% | 78k | 271k |
| PRG-AYT | A320 180Y | tour | 1.0 s | 1975 | 85% | 160 | 8.2 | 7.8 | 7.4 | 5% | 14% / -11% | 80k | 293k |
| PRG-AYT | A321 220Y | tour | 1.0 s | 1975 | 81% | 160 | 8.2 | 7.4 | 6.9 | 8% | 16% / -8% | 146k | 293k |
| PRG-HRG | A320 180Y | tour | 1.0 | 3042 | 85% | 186 | 6.1 | 5.7 | 6.0 | -4% | 7% / -24% | -139k | 291k |
| PRG-HRG | A321 220Y | tour | 1.0 | 3042 | 81% | 186 | 6.1 | 5.4 | 5.5 | -2% | 10% / -21% | -62k | 291k |
| PRG-HRG | B763 309Y | tour | 1.0 | 3042 | 100% | 186 | 6.1 | 6.7 | 5.9 | 12% | 22% / -4% | 779k | 291k |
| PRG-HRG | A332 330Y | tour | 1.0 | 3042 | 100% | 186 | 6.1 | 6.7 | 5.8 | 13% | 22% / -3% | 909k | 291k |
| PRG-RMF | A320 180Y | tour | 1.0 | 3238 | 85% | 171 | 5.3 | 5.0 | 5.8 | -17% | 0% / -45% | -524k | 291k |
| PRG-RMF | A321 220Y | tour | 1.0 | 3238 | 81% | 171 | 5.3 | 4.7 | 5.4 | -14% | 2% / -41% | -507k | 291k |
| PRG-RMF | B763 309Y | tour | 1.0 | 3238 | 100% | 171 | 5.3 | 5.8 | 5.8 | 1% | 15% / -22% | 46k | 291k |
| PRG-RMF | A332 330Y | tour | 1.0 | 3238 | 100% | 171 | 5.3 | 5.8 | 5.7 | 2% | 16% / -21% | 125k | 291k |
| PRG-TFS | A320 180Y | tour | 1.0 | 3573 | 85% | 218 | 6.1 | 5.7 | 5.7 | 0% | 19% / -27% | 1k | 293k |
| PRG-TFS | A321 220Y | tour | 1.0 | 3573 | 80% | 219 | 6.1 | 5.4 | 5.3 | 2% | 20% / -27% | 82k | 293k |
| PRG-TFS | B763 309Y | tour | 1.0 | 3573 | 84% | 230 | 6.4 | 5.9 | 5.5 | 7% | 30% / -46% | 443k | 293k |
| PRG-TFS | A332 330Y | tour | 1.0 | 3573 | 82% | 231 | 6.5 | 5.8 | 5.4 | 6% | 31% / -52% | 424k | 293k |
| PRG-HER | A320 180Y | tour | 1.0 s | 1864 | 85% | 160 | 8.6 | 8.2 | 7.5 | 8% | 17% / -9% | 108k | 297k |
| PRG-HER | A321 220Y | tour | 1.0 s | 1864 | 81% | 160 | 8.6 | 7.7 | 6.9 | 10% | 19% / -6% | 172k | 297k |
| PRG-DJE | A320 180Y | tour | 1.0 s | 1827 | 85% | 162 | 8.9 | 8.3 | 7.6 | 9% | 17% / -7% | 126k | 291k |
| PRG-DJE | A321 220Y | tour | 1.0 s | 1827 | 81% | 162 | 8.9 | 7.9 | 7.0 | 12% | 20% / -3% | 196k | 291k |
| PRG-TLV | A320 180Y | own | 2.0 | 2635 | 85% | 163 | 6.2 | 6.2 | 6.3 | -1% | 18% / -45% | -86k | 272k |
| PRG-TLV | A321 220Y | own | 2.0 | 2635 | 81% | 163 | 6.2 | 5.9 | 5.8 | 1% | 20% / -42% | 61k | 272k |
| PRG-TLV | B763 309Y | own | 2.0 | 2635 | 90% | 169 | 6.4 | 6.6 | 6.2 | 7% | 29% / -58% | 799k | 269k |
| PRG-TLV | A332 330Y | own | 2.0 | 2635 | 88% | 170 | 6.5 | 6.5 | 6.1 | 7% | 30% / -64% | 875k | 269k |
| PRG-HAN | A320 | can’t fly it (range or runway) |||||||||||
| PRG-HAN | A321 | can’t fly it (range or runway) |||||||||||
| PRG-HAN | B763 309Y | own | 1.0 | 8322 | 86% | 372 | 4.5 | 4.3 | 4.5 | -4% | 10% / -17% | -494k | 268k |
| PRG-HAN | A332 330Y | own | 1.0 | 8322 | 100% | 372 | 4.5 | 5.0 | 4.5 | 8% | 21% / -3% | 1179k | 268k |
| SOF-STN | A320 180Y | own | 1.0 | 2012 | 85% | 84 | 4.2 | 4.9 | 7.0 | -42% | -15% / -59% | -777k | 266k |
| SOF-STN | A321 220Y | own | 1.0 | 2012 | 81% | 84 | 4.2 | 4.6 | 6.4 | -39% | -12% / -55% | -825k | 266k |
| SOF-FRA | A320 180Y | own | 2.0 | 1396 | 85% | 112 | 8.0 | 8.6 | 8.6 | 0% | 22% / -25% | 13k | 262k |
| SOF-FRA | A321 220Y | own | 2.0 | 1396 | 81% | 112 | 8.0 | 8.2 | 7.9 | 3% | 24% / -22% | 147k | 262k |
| SOF-MAD | A320 180Y | own | 1.0 | 2247 | 85% | 90 | 4.0 | 4.5 | 6.6 | -47% | -8% / -83% | -887k | 262k |
| SOF-MAD | A321 220Y | own | 1.0 | 2247 | 81% | 90 | 4.0 | 4.3 | 6.1 | -43% | -5% / -78% | -942k | 262k |
| SOF-MXP | A320 180Y | own | 1.0 | 1214 | 85% | 78 | 6.4 | 7.4 | 9.2 | -24% | 4% / -57% | -405k | 266k |
| SOF-MXP | A321 220Y | own | 1.0 | 1214 | 81% | 78 | 6.4 | 7.0 | 8.4 | -20% | 7% / -53% | -395k | 266k |
| SOF-TLV | A320 180Y | own | 2.0 | 1559 | 85% | 114 | 7.3 | 7.7 | 7.8 | -1% | 12% / -10% | -25k | 272k |
| SOF-TLV | A321 220Y | own | 2.0 | 1559 | 81% | 114 | 7.3 | 7.3 | 7.2 | 2% | 15% / -7% | 107k | 272k |
| SOF-HRG | A320 180Y | tour | 1.0 s | 1965 | 84% | 165 | 8.4 | 7.8 | 7.0 | 10% | 13% / 9% | 218k | 291k |
| SOF-HRG | A321 220Y | tour | 1.0 s | 1965 | 78% | 166 | 8.4 | 7.3 | 6.5 | 12% | 15% / 10% | 294k | 291k |
| SOF-AYT | A320 180Y | tour | 1.0 s | 902 | 85% | 111 | 12.5 | 12.4 | 10.9 | 12% | 19% / 0% | 143k | 289k |
| SOF-AYT | A321 220Y | tour | 1.0 s | 902 | 80% | 112 | 12.5 | 11.7 | 10.0 | 15% | 22% / 2% | 206k | 289k |
| SOF-ORD | A320 | can’t fly it (range or runway) |||||||||||
| SOF-ORD | A321 | can’t fly it (range or runway) |||||||||||
| SOF-ORD | B763 309Y | own | 1.0 | 8365 | 65% | 456 | 5.4 | 4.0 | 4.3 | -8% | 29% / -70% | -899k | 266k |
| SOF-ORD | A332 330Y | own | 1.0 | 8365 | 67% | 465 | 5.6 | 4.1 | 4.3 | -3% | 38% / -76% | -366k | 266k |
| TLL-STN | A320 180Y | own | 1.0 | 1741 | 85% | 96 | 5.5 | 6.0 | 7.6 | -25% | 3% / -47% | -490k | 266k |
| TLL-STN | A321 220Y | own | 1.0 | 1741 | 81% | 95 | 5.5 | 5.7 | 6.9 | -22% | 6% / -43% | -490k | 266k |
| TLL-ARN | A320 180Y | own | 3.0 | 391 | 85% | 77 | 19.6 | 20.8 | 19.7 | 5% | 28% / -41% | 248k | 262k |
| TLL-ARN | A321 220Y | own | 3.0 | 391 | 80% | 77 | 19.6 | 19.5 | 18.0 | 8% | 30% / -37% | 405k | 262k |
| TLL-OSL | A320 180Y | own | 1.0 | 772 | 85% | 86 | 11.1 | 12.1 | 12.6 | -4% | 9% / -21% | -68k | 262k |
| TLL-OSL | A321 220Y | own | 1.0 | 772 | 81% | 86 | 11.1 | 11.5 | 11.5 | 0% | 12% / -17% | 0k | 262k |
| TLL-DUB | A320 180Y | own | 1.0 | 2004 | 84% | 110 | 5.5 | 5.6 | 7.0 | -24% | 7% / -64% | -505k | 266k |
| TLL-DUB | A321 220Y | own | 1.0 | 2004 | 75% | 112 | 5.6 | 5.1 | 6.3 | -24% | 9% / -69% | -568k | 266k |
| TLL-TFS | A320 180Y | tour | 1.0 s | 4685 | 61% | 278 | 6.0 | 4.0 | 5.2 | -31% | -22% / -42% | -626k | 289k |
| TLL-TFS | A321 | can’t fly it (range or runway) |||||||||||
| TLL-TFS | B763 309Y | tour | 1.0 s | 4685 | 90% | 283 | 6.1 | 5.9 | 5.3 | 10% | 21% / -14% | 518k | 289k |
| TLL-TFS | A332 330Y | tour | 1.0 s | 4685 | 88% | 284 | 6.1 | 5.8 | 5.2 | 9% | 22% / -19% | 508k | 289k |
| TLL-AYT | A320 180Y | tour | 1.0 s | 2540 | 85% | 187 | 7.4 | 7.0 | 6.5 | 7% | 13% / -5% | 126k | 289k |
| TLL-AYT | A321 220Y | tour | 1.0 s | 2540 | 81% | 187 | 7.4 | 6.6 | 6.0 | 9% | 16% / -2% | 201k | 289k |
| TLL-AYT | B763 309Y | tour | 1.0 s | 2540 | 96% | 189 | 7.5 | 7.9 | 6.4 | 19% | 26% / 2% | 717k | 289k |
| TLL-AYT | A332 330Y | tour | 1.0 s | 2540 | 95% | 189 | 7.5 | 7.8 | 6.3 | 20% | 27% / 2% | 798k | 289k |
| TLL-HRG | A320 180Y | tour | 1.0 s | 3650 | 85% | 246 | 6.8 | 6.2 | 5.9 | 5% | 9% / 1% | 132k | 291k |
| TLL-HRG | A321 220Y | tour | 1.0 s | 3650 | 80% | 246 | 6.8 | 5.9 | 5.5 | 7% | 11% / 1% | 201k | 291k |
| TLL-HRG | B763 309Y | tour | 1.0 s | 3650 | 84% | 249 | 6.9 | 6.2 | 5.4 | 13% | 22% / -13% | 534k | 291k |
| TLL-HRG | A332 330Y | tour | 1.0 s | 3650 | 79% | 249 | 6.9 | 5.9 | 5.3 | 10% | 19% / -17% | 410k | 291k |
| TLL-HKT | A320 | can’t fly it (range or runway) |||||||||||
| TLL-HKT | A321 | can’t fly it (range or runway) |||||||||||
| TLL-HKT | B763 309Y | tour | 0.2 s | 8301 | 83% | 540 | 6.5 | 5.7 | 5.5 | 4% | 17% / -11% | 64k | 297k |
| TLL-HKT | A332 330Y | tour | 0.2 s | 8301 | 94% | 544 | 6.5 | 6.5 | 5.6 | 14% | 26% / -2% | 306k | 297k |

### Cost per block hour by kind (USD, same plans)

| market | type | fuel | crew | maint | aircraft | nav | landing+pax | handling | catering+services | distribution | overheads | disruption | total | revenue |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LIS-OXB | A320 | 1956 | 390 | 900 | 980 | 591 | 384 | 560 | 669 | 569 | 559 | 225 | 7915 | 9017 |
| LIS-OXB | A321 | 2269 | 423 | 1000 | 1200 | 658 | 425 | 560 | 721 | 619 | 559 | 251 | 8876 | 10047 |
| LIS-OXB | B763 | 4146 | 587 | 1700 | 840 | 828 | 726 | 1141 | 816 | 716 | 570 | 299 | 12647 | 11972 |
| LIS-OXB | A332 | 4537 | 620 | 1550 | 1120 | 909 | 792 | 1164 | 837 | 734 | 582 | 307 | 13433 | 12262 |
| LIS-TMS | A320 | 1964 | 484 | 900 | 980 | 568 | 249 | 380 | 497 | 0 | 185 | 0 | 6297 | 7950 |
| LIS-TMS | B763 | 4164 | 718 | 1700 | 840 | 804 | 492 | 781 | 818 | 0 | 190 | 0 | 10712 | 11525 |
| LIS-TMS | A332 | 4557 | 751 | 1550 | 1120 | 877 | 533 | 792 | 833 | 0 | 192 | 0 | 11414 | 11966 |
| LIS-DIL | B763 | 3949 | 811 | 1700 | 840 | 545 | 368 | 426 | 356 | 1035 | 941 | 270 | 11311 | 10791 |
| LIS-RAI | A320 | 1911 | 390 | 900 | 980 | 452 | 361 | 524 | 655 | 505 | 543 | 175 | 7512 | 6999 |
| LIS-RAI | A321 | 2216 | 423 | 1000 | 1200 | 503 | 400 | 524 | 709 | 546 | 543 | 190 | 8390 | 7607 |
| LIS-RAI | B763 | 4051 | 587 | 1700 | 840 | 634 | 710 | 1068 | 1160 | 903 | 554 | 313 | 12713 | 12515 |
| LIS-RAI | A332 | 4433 | 620 | 1550 | 1120 | 695 | 776 | 1090 | 1237 | 965 | 565 | 334 | 13584 | 13360 |
| LIS-SID | A320 | 1911 | 390 | 900 | 980 | 460 | 377 | 544 | 696 | 630 | 519 | 184 | 7647 | 7349 |
| LIS-SID | A321 | 2216 | 423 | 1000 | 1200 | 512 | 422 | 544 | 810 | 733 | 519 | 213 | 8649 | 8512 |
| LIS-SID | B763 | 4051 | 587 | 1700 | 840 | 646 | 738 | 1111 | 1204 | 1137 | 530 | 326 | 12927 | 13037 |
| LIS-SID | A332 | 4433 | 620 | 1550 | 1120 | 710 | 806 | 1135 | 1260 | 1196 | 542 | 342 | 13771 | 13693 |
| LIS-BVC | A320 | 1938 | 390 | 900 | 980 | 451 | 350 | 533 | 678 | 728 | 509 | 204 | 7691 | 8168 |
| LIS-BVC | A321 | 2248 | 423 | 1000 | 1200 | 502 | 385 | 533 | 701 | 759 | 509 | 213 | 8502 | 8510 |
| LIS-BVC | B763 | 4108 | 587 | 1700 | 840 | 633 | 652 | 1088 | 757 | 829 | 519 | 232 | 11976 | 9282 |
| LIS-BVC | A332 | 4495 | 620 | 1550 | 1120 | 695 | 712 | 1111 | 773 | 847 | 530 | 237 | 12722 | 9479 |
| LIS-LAD | B763 | 4023 | 707 | 1700 | 840 | 798 | 478 | 666 | 934 | 699 | 190 | 295 | 11564 | 11818 |
| LIS-LAD | A332 | 4403 | 755 | 1550 | 1120 | 869 | 517 | 673 | 982 | 736 | 192 | 311 | 12343 | 12421 |
| LIS-MPM | B763 | 4124 | 671 | 1700 | 840 | 730 | 293 | 437 | 579 | 399 | 233 | 185 | 10295 | 7406 |
| LIS-MPM | A332 | 4514 | 715 | 1550 | 1120 | 805 | 320 | 447 | 599 | 414 | 239 | 192 | 11023 | 7679 |
| LIS-REC | B763 | 3965 | 705 | 1700 | 840 | 485 | 414 | 577 | 933 | 703 | 299 | 287 | 11072 | 11494 |
| LIS-REC | A332 | 4340 | 753 | 1550 | 1120 | 532 | 451 | 587 | 991 | 748 | 304 | 305 | 11847 | 12220 |
| LIS-FOR | B763 | 3966 | 710 | 1700 | 840 | 492 | 417 | 600 | 894 | 668 | 311 | 271 | 11004 | 10820 |
| LIS-FOR | A332 | 4339 | 759 | 1550 | 1120 | 540 | 456 | 614 | 941 | 706 | 318 | 286 | 11769 | 11437 |
| OPO-RAI | A320 | 1911 | 390 | 900 | 980 | 454 | 313 | 469 | 608 | 509 | 2014 | 183 | 8807 | 7315 |
| OPO-RAI | A321 | 2216 | 423 | 1000 | 1200 | 505 | 344 | 469 | 625 | 522 | 2014 | 187 | 9585 | 7499 |
| OPO-RAI | B763 | 4051 | 587 | 1700 | 840 | 636 | 616 | 956 | 1093 | 922 | 2051 | 326 | 13857 | 13034 |
| OPO-RAI | A332 | 4433 | 620 | 1550 | 1120 | 697 | 673 | 974 | 1167 | 987 | 2090 | 349 | 14740 | 13951 |
| OPO-OXB | A320 | 1956 | 390 | 900 | 980 | 572 | 330 | 494 | 638 | 555 | 1558 | 217 | 8698 | 8683 |
| OPO-OXB | A321 | 2269 | 423 | 1000 | 1200 | 636 | 367 | 494 | 704 | 616 | 1558 | 241 | 9622 | 9651 |
| OPO-OXB | B763 | 4146 | 587 | 1700 | 840 | 800 | 626 | 1006 | 827 | 743 | 1586 | 293 | 13289 | 11724 |
| OPO-OXB | A332 | 4537 | 620 | 1550 | 1120 | 877 | 682 | 1024 | 844 | 758 | 1615 | 299 | 14066 | 11962 |
| VNO-LTN | A320 | 1793 | 390 | 900 | 980 | 707 | 574 | 769 | 1045 | 631 | 736 | 174 | 8819 | 6960 |
| VNO-LTN | A321 | 2079 | 423 | 1000 | 1200 | 786 | 639 | 769 | 1163 | 701 | 736 | 192 | 9808 | 7684 |
| VNO-DUB | A320 | 1793 | 390 | 900 | 980 | 715 | 515 | 681 | 903 | 585 | 636 | 169 | 8331 | 6762 |
| VNO-DUB | A321 | 2079 | 423 | 1000 | 1200 | 795 | 576 | 681 | 1051 | 680 | 636 | 196 | 9382 | 7828 |
| VNO-OSL | A320 | 1819 | 390 | 900 | 980 | 655 | 866 | 1200 | 1519 | 863 | 1101 | 213 | 10657 | 8522 |
| VNO-OSL | A321 | 2110 | 423 | 1000 | 1200 | 729 | 969 | 1200 | 1768 | 1004 | 1101 | 246 | 11900 | 9831 |
| VNO-TFS | A320 | 1826 | 485 | 900 | 980 | 682 | 200 | 307 | 475 | 515 | 375 | 142 | 6914 | 5699 |
| VNO-TFS | A321 | 2118 | 518 | 1000 | 1200 | 759 | 222 | 307 | 520 | 563 | 375 | 155 | 7765 | 6217 |
| VNO-TFS | B763 | 3872 | 718 | 1700 | 840 | 962 | 412 | 626 | 1201 | 1321 | 383 | 363 | 12433 | 14522 |
| VNO-TFS | A332 | 4238 | 751 | 1550 | 1120 | 1063 | 452 | 640 | 1302 | 1433 | 391 | 394 | 13370 | 15750 |
| VNO-AYT | A320 | 1810 | 390 | 900 | 980 | 713 | 434 | 577 | 929 | 797 | 766 | 228 | 8593 | 9117 |
| VNO-AYT | A321 | 2100 | 423 | 1000 | 1200 | 793 | 484 | 577 | 1080 | 927 | 766 | 264 | 9687 | 10579 |
| VNO-TBS | A320 | 1868 | 390 | 900 | 980 | 934 | 417 | 568 | 903 | 664 | 636 | 216 | 8581 | 8633 |
| VNO-TBS | A321 | 2167 | 423 | 1000 | 1200 | 1038 | 465 | 568 | 1030 | 759 | 636 | 246 | 9638 | 9839 |
| VNO-TLV | A320 | 1837 | 390 | 900 | 980 | 747 | 453 | 587 | 740 | 556 | 615 | 180 | 8030 | 7208 |
| VNO-TLV | A321 | 2131 | 423 | 1000 | 1200 | 831 | 505 | 587 | 837 | 631 | 615 | 205 | 9010 | 8193 |
| VNO-TLV | B763 | 3895 | 587 | 1700 | 840 | 1050 | 888 | 1200 | 1201 | 930 | 629 | 305 | 13275 | 12209 |
| VNO-TLV | A332 | 4263 | 620 | 1550 | 1120 | 1129 | 950 | 1200 | 1229 | 953 | 629 | 313 | 14008 | 12534 |
| VNO-ORD | B763 | 3710 | 680 | 1700 | 840 | 639 | 562 | 531 | 841 | 568 | 283 | 259 | 10701 | 10345 |
| VNO-ORD | A332 | 4060 | 725 | 1550 | 1120 | 698 | 614 | 540 | 905 | 615 | 288 | 282 | 11507 | 11278 |
| MLA-MAN | A320 | 1821 | 390 | 900 | 980 | 805 | 417 | 644 | 815 | 593 | 574 | 179 | 8176 | 7159 |
| MLA-MAN | A321 | 2112 | 423 | 1000 | 1200 | 895 | 467 | 644 | 949 | 689 | 574 | 207 | 9218 | 8293 |
| MLA-GLA | A320 | 1838 | 390 | 900 | 980 | 821 | 324 | 541 | 673 | 552 | 482 | 162 | 7696 | 6488 |
| MLA-GLA | A321 | 2132 | 423 | 1000 | 1200 | 913 | 360 | 541 | 738 | 616 | 482 | 180 | 8617 | 7209 |
| MLA-GLA | B763 | 3896 | 587 | 1700 | 840 | 1152 | 622 | 1107 | 943 | 826 | 492 | 240 | 12438 | 9587 |
| MLA-GLA | A332 | 4264 | 620 | 1550 | 1120 | 1266 | 680 | 1132 | 970 | 849 | 503 | 246 | 13234 | 9856 |
| MLA-MJI | A320 | 1999 | 390 | 900 | 980 | 481 | 1346 | 2400 | 3254 | 1968 | 2895 | 619 | 17640 | 24759 |
| MLA-MJI | A321 | 2318 | 423 | 1000 | 1200 | 534 | 1496 | 2400 | 3601 | 2184 | 2895 | 687 | 19175 | 27466 |
| MLA-BEN | A320 | 1999 | 390 | 900 | 980 | 541 | 868 | 1613 | 1831 | 0 | 1038 | 0 | 10394 | 10461 |
| MLA-BEN | A321 | 2318 | 423 | 1000 | 1200 | 601 | 960 | 1613 | 1907 | 0 | 1038 | 0 | 11296 | 10513 |
| MLA-CTA | A320 | 1837 | 390 | 900 | 980 | 320 | 1512 | 2600 | 3714 | 1881 | 769 | 356 | 15710 | 14238 |
| MLA-CTA | A321 | 2131 | 423 | 1000 | 1200 | 356 | 1692 | 2600 | 4321 | 2188 | 769 | 408 | 17539 | 16305 |
| MLA-CPH | A320 | 1819 | 390 | 900 | 980 | 838 | 421 | 677 | 857 | 754 | 604 | 219 | 8498 | 8774 |
| MLA-CPH | A321 | 2110 | 423 | 1000 | 1200 | 932 | 471 | 677 | 997 | 877 | 604 | 255 | 9585 | 10185 |
| MLA-LDE | A320 | 1864 | 390 | 900 | 980 | 833 | 539 | 859 | 1299 | 1043 | 3405 | 279 | 12276 | 11172 |
| MLA-LDE | A321 | 2162 | 423 | 1000 | 1200 | 926 | 606 | 859 | 1512 | 1214 | 3405 | 325 | 13508 | 12998 |
| MLA-JFK | B763 | 3771 | 682 | 1700 | 840 | 601 | 630 | 577 | 1033 | 673 | 360 | 305 | 11277 | 12199 |
| MLA-JFK | A332 | 4127 | 728 | 1550 | 1120 | 663 | 695 | 592 | 936 | 734 | 369 | 332 | 11952 | 13266 |
| MAD-LPA | A320 | 1828 | 390 | 900 | 980 | 631 | 561 | 825 | 1045 | 660 | 231 | 193 | 8513 | 7722 |
| MAD-LPA | A321 | 2121 | 423 | 1000 | 1200 | 701 | 628 | 825 | 1215 | 768 | 231 | 223 | 9634 | 8938 |
| MAD-IBZ | A320 | 1837 | 390 | 900 | 980 | 446 | 1440 | 2112 | 2571 | 1504 | 1061 | 367 | 13749 | 14674 |
| MAD-IBZ | A321 | 2131 | 423 | 1000 | 1200 | 496 | 1612 | 2112 | 2992 | 1750 | 1061 | 424 | 15340 | 16964 |
| MAD-TNG | A320 | 1864 | 390 | 900 | 980 | 481 | 1221 | 1757 | 2594 | 1347 | 560 | 330 | 12639 | 13213 |
| MAD-TNG | A321 | 2162 | 423 | 1000 | 1200 | 534 | 1362 | 1757 | 2948 | 1535 | 560 | 375 | 14071 | 14997 |
| MAD-OTP | A320 | 1811 | 390 | 900 | 980 | 820 | 432 | 572 | 777 | 474 | 515 | 131 | 7884 | 5249 |
| MAD-OTP | A321 | 2101 | 423 | 1000 | 1200 | 912 | 483 | 572 | 904 | 551 | 515 | 151 | 8895 | 6056 |
| MAD-SSG | A320 | 1972 | 497 | 900 | 980 | 590 | 321 | 429 | 598 | 0 | 218 | 0 | 6561 | 8212 |
| MAD-SSG | A321 | 2287 | 547 | 1000 | 1200 | 656 | 357 | 429 | 656 | 0 | 218 | 0 | 7409 | 8478 |
| MAD-SSG | B763 | 4180 | 748 | 1700 | 840 | 835 | 645 | 882 | 1132 | 0 | 224 | 0 | 11325 | 12998 |
| MAD-SSG | A332 | 4574 | 801 | 1550 | 1120 | 911 | 701 | 896 | 1175 | 0 | 227 | 0 | 12097 | 13458 |
| MAD-VVI | A332 | 4393 | 779 | 1550 | 1120 | 536 | 333 | 409 | 1059 | 629 | 215 | 277 | 11442 | 11090 |
| MAD-HAV | B763 | 3986 | 742 | 1700 | 840 | 494 | 486 | 598 | 1159 | 733 | 93 | 281 | 11228 | 11240 |
| MAD-HAV | A332 | 4359 | 720 | 1550 | 1120 | 544 | 535 | 612 | 1236 | 784 | 95 | 303 | 11998 | 12109 |
| RIX-LGW | A320 | 1793 | 390 | 900 | 980 | 728 | 621 | 829 | 1061 | 657 | 264 | 186 | 8532 | 7428 |
| RIX-LGW | A321 | 2079 | 423 | 1000 | 1200 | 810 | 695 | 829 | 1235 | 764 | 264 | 214 | 9637 | 8566 |
| RIX-DUB | A320 | 1793 | 390 | 900 | 980 | 727 | 508 | 718 | 942 | 609 | 663 | 176 | 8474 | 7048 |
| RIX-DUB | A321 | 2079 | 423 | 1000 | 1200 | 809 | 569 | 718 | 1096 | 709 | 663 | 204 | 9538 | 8158 |
| RIX-OSL | A320 | 1819 | 390 | 900 | 980 | 641 | 1002 | 1483 | 1857 | 1081 | 673 | 276 | 11286 | 11024 |
| RIX-OSL | A321 | 2110 | 423 | 1000 | 1200 | 712 | 1122 | 1483 | 2161 | 1258 | 673 | 318 | 12644 | 12724 |
| RIX-TFS | A320 | 1826 | 484 | 900 | 980 | 695 | 185 | 309 | 468 | 508 | 373 | 140 | 6894 | 5614 |
| RIX-TFS | A321 | 2119 | 518 | 1000 | 1200 | 772 | 206 | 309 | 509 | 550 | 373 | 152 | 7734 | 6081 |
| RIX-TFS | B763 | 3872 | 718 | 1700 | 840 | 967 | 377 | 626 | 1131 | 1253 | 378 | 344 | 12240 | 13771 |
| RIX-TFS | A332 | 4237 | 751 | 1550 | 1120 | 1067 | 416 | 644 | 1215 | 1349 | 389 | 371 | 13145 | 14826 |
| RIX-SSH | A320 | 1837 | 390 | 900 | 980 | 679 | 255 | 387 | 597 | 732 | 526 | 202 | 7505 | 8079 |
| RIX-SSH | A321 | 2131 | 423 | 1000 | 1200 | 755 | 285 | 387 | 695 | 851 | 526 | 235 | 8509 | 9395 |
| RIX-SSH | B763 | 3895 | 587 | 1700 | 840 | 950 | 507 | 788 | 1131 | 1407 | 536 | 388 | 12757 | 15501 |
| RIX-SSH | A332 | 4263 | 620 | 1550 | 1120 | 1040 | 553 | 802 | 1203 | 1497 | 546 | 412 | 13638 | 16493 |
| RIX-TBS | A320 | 1868 | 390 | 900 | 980 | 910 | 361 | 532 | 836 | 634 | 588 | 211 | 8309 | 8455 |
| RIX-TBS | A321 | 2167 | 423 | 1000 | 1200 | 1012 | 403 | 532 | 967 | 734 | 588 | 243 | 9368 | 9738 |
| RIX-TAS | A320 | 1793 | 390 | 900 | 980 | 1077 | 269 | 369 | 631 | 472 | 431 | 180 | 7610 | 7215 |
| RIX-TAS | A321 | 2079 | 423 | 1000 | 1200 | 1198 | 300 | 369 | 712 | 532 | 431 | 202 | 8564 | 8096 |
| RIX-TAS | B763 | 3800 | 587 | 1700 | 840 | 1505 | 521 | 750 | 890 | 675 | 438 | 257 | 12084 | 10265 |
| RIX-TAS | A332 | 4159 | 620 | 1550 | 1120 | 1678 | 573 | 769 | 923 | 699 | 450 | 266 | 12930 | 10641 |
| RIX-JFK | B763 | 3710 | 690 | 1700 | 840 | 660 | 687 | 606 | 843 | 628 | 327 | 280 | 11091 | 11208 |
| RIX-JFK | A332 | 4060 | 737 | 1550 | 1120 | 729 | 753 | 620 | 899 | 672 | 334 | 300 | 11898 | 11985 |
| PRG-AYT | A320 | 1811 | 390 | 900 | 980 | 755 | 444 | 643 | 929 | 801 | 766 | 229 | 8718 | 9155 |
| PRG-AYT | A321 | 2101 | 423 | 1000 | 1200 | 839 | 496 | 643 | 1080 | 932 | 766 | 266 | 9819 | 10623 |
| PRG-HRG | A320 | 1840 | 390 | 900 | 980 | 726 | 304 | 462 | 643 | 643 | 453 | 180 | 7525 | 7217 |
| PRG-HRG | A321 | 2134 | 423 | 1000 | 1200 | 807 | 340 | 462 | 748 | 748 | 453 | 210 | 8530 | 8392 |
| PRG-HRG | B763 | 3901 | 587 | 1700 | 840 | 1018 | 611 | 941 | 1315 | 1323 | 462 | 371 | 13073 | 14836 |
| PRG-HRG | A332 | 4269 | 620 | 1550 | 1120 | 1118 | 669 | 960 | 1434 | 1441 | 471 | 404 | 14062 | 16160 |
| PRG-RMF | A320 | 1868 | 390 | 900 | 980 | 721 | 300 | 447 | 661 | 558 | 428 | 158 | 7417 | 6318 |
| PRG-RMF | A321 | 2167 | 423 | 1000 | 1200 | 802 | 335 | 447 | 770 | 649 | 428 | 184 | 8410 | 7346 |
| PRG-RMF | B763 | 3961 | 587 | 1700 | 840 | 1010 | 601 | 911 | 1351 | 1148 | 436 | 324 | 12873 | 12972 |
| PRG-RMF | A332 | 4334 | 620 | 1550 | 1120 | 1107 | 658 | 928 | 1471 | 1249 | 444 | 353 | 13841 | 14113 |
| PRG-TFS | A320 | 1827 | 390 | 900 | 980 | 702 | 261 | 420 | 649 | 655 | 369 | 184 | 7351 | 7352 |
| PRG-TFS | A321 | 2119 | 423 | 1000 | 1200 | 780 | 292 | 420 | 748 | 758 | 369 | 212 | 8336 | 8493 |
| PRG-TFS | B763 | 3872 | 587 | 1700 | 840 | 979 | 511 | 854 | 1113 | 1188 | 375 | 331 | 12365 | 13232 |
| PRG-TFS | A332 | 4237 | 620 | 1550 | 1120 | 1071 | 556 | 869 | 1176 | 1262 | 382 | 351 | 13211 | 14054 |
| PRG-HER | A320 | 1837 | 390 | 900 | 980 | 707 | 449 | 732 | 983 | 847 | 814 | 241 | 8925 | 9655 |
| PRG-HER | A321 | 2131 | 423 | 1000 | 1200 | 786 | 503 | 732 | 1144 | 985 | 814 | 280 | 10043 | 11208 |
| PRG-DJE | A320 | 1864 | 390 | 900 | 980 | 670 | 449 | 709 | 1013 | 885 | 965 | 249 | 9083 | 9963 |
| PRG-DJE | A321 | 2162 | 423 | 1000 | 1200 | 745 | 502 | 709 | 1179 | 1030 | 965 | 290 | 10214 | 11585 |
| PRG-TLV | A320 | 1840 | 390 | 900 | 980 | 760 | 456 | 633 | 735 | 572 | 304 | 193 | 7835 | 7726 |
| PRG-TLV | A321 | 2134 | 423 | 1000 | 1200 | 845 | 511 | 633 | 855 | 665 | 304 | 224 | 8866 | 8944 |
| PRG-TLV | B763 | 3899 | 587 | 1700 | 840 | 1044 | 896 | 1280 | 1343 | 1070 | 308 | 361 | 13401 | 14425 |
| PRG-TLV | A332 | 4267 | 620 | 1550 | 1120 | 1149 | 982 | 1309 | 1436 | 1148 | 315 | 388 | 14360 | 15507 |
| PRG-HAN | B763 | 3840 | 672 | 1700 | 840 | 920 | 294 | 381 | 893 | 574 | 215 | 256 | 10681 | 10238 |
| PRG-HAN | A332 | 4203 | 716 | 1550 | 1120 | 1014 | 328 | 389 | 1126 | 723 | 219 | 323 | 11832 | 12907 |
| SOF-STN | A320 | 1792 | 390 | 900 | 980 | 733 | 462 | 666 | 916 | 541 | 645 | 146 | 8279 | 5822 |
| SOF-STN | A321 | 2079 | 423 | 1000 | 1200 | 816 | 518 | 666 | 1066 | 630 | 645 | 168 | 9317 | 6708 |
| SOF-FRA | A320 | 1793 | 390 | 900 | 980 | 747 | 866 | 1011 | 1238 | 813 | 487 | 241 | 9612 | 9640 |
| SOF-FRA | A321 | 2079 | 423 | 1000 | 1200 | 831 | 970 | 1011 | 1440 | 946 | 487 | 278 | 10811 | 11126 |
| SOF-MAD | A320 | 1793 | 390 | 900 | 980 | 686 | 453 | 623 | 836 | 505 | 658 | 137 | 8027 | 5468 |
| SOF-MAD | A321 | 2079 | 423 | 1000 | 1200 | 763 | 506 | 623 | 972 | 588 | 658 | 158 | 9038 | 6320 |
| SOF-MXP | A320 | 1810 | 390 | 900 | 980 | 721 | 731 | 1013 | 1393 | 804 | 981 | 203 | 10050 | 8102 |
| SOF-MXP | A321 | 2100 | 423 | 1000 | 1200 | 802 | 819 | 1013 | 1621 | 935 | 981 | 234 | 11252 | 9351 |
| SOF-TLV | A320 | 1837 | 390 | 900 | 980 | 663 | 652 | 900 | 1153 | 765 | 477 | 225 | 9034 | 8985 |
| SOF-TLV | A321 | 2131 | 423 | 1000 | 1200 | 737 | 730 | 900 | 1341 | 890 | 477 | 260 | 10183 | 10396 |
| SOF-HRG | A320 | 1837 | 390 | 900 | 980 | 632 | 398 | 609 | 939 | 834 | 752 | 237 | 8515 | 9475 |
| SOF-HRG | A321 | 2131 | 423 | 1000 | 1200 | 702 | 444 | 609 | 1072 | 957 | 752 | 272 | 9571 | 10865 |
| SOF-AYT | A320 | 1810 | 390 | 900 | 980 | 500 | 743 | 1078 | 1759 | 1054 | 1452 | 314 | 11086 | 12571 |
| SOF-AYT | A321 | 2100 | 423 | 1000 | 1200 | 556 | 831 | 1078 | 2031 | 1220 | 1452 | 362 | 12359 | 14500 |
| SOF-ORD | B763 | 3711 | 671 | 1700 | 840 | 617 | 479 | 477 | 678 | 502 | 257 | 237 | 10267 | 9465 |
| SOF-ORD | A332 | 4060 | 716 | 1550 | 1120 | 678 | 527 | 487 | 759 | 571 | 262 | 269 | 11098 | 10766 |
| TLL-STN | A320 | 1793 | 390 | 900 | 980 | 707 | 534 | 775 | 1028 | 636 | 724 | 175 | 8740 | 6999 |
| TLL-STN | A321 | 2079 | 423 | 1000 | 1200 | 786 | 598 | 775 | 1197 | 740 | 724 | 202 | 9823 | 8083 |
| TLL-ARN | A320 | 1810 | 390 | 900 | 980 | 481 | 1476 | 2200 | 2786 | 1600 | 673 | 366 | 13862 | 14657 |
| TLL-ARN | A321 | 2100 | 423 | 1000 | 1200 | 534 | 1649 | 2200 | 3204 | 1840 | 673 | 419 | 15443 | 16741 |
| TLL-OSL | A320 | 1819 | 390 | 900 | 980 | 622 | 1061 | 1588 | 1966 | 1170 | 1425 | 298 | 12371 | 11908 |
| TLL-OSL | A321 | 2110 | 423 | 1000 | 1200 | 691 | 1188 | 1588 | 2288 | 1362 | 1425 | 344 | 13771 | 13771 |
| TLL-DUB | A320 | 1793 | 390 | 900 | 980 | 733 | 500 | 717 | 915 | 597 | 654 | 169 | 8381 | 6761 |
| TLL-DUB | A321 | 2079 | 423 | 1000 | 1200 | 816 | 555 | 717 | 1002 | 659 | 654 | 188 | 9326 | 7505 |
| TLL-TFS | A320 | 1826 | 484 | 900 | 980 | 692 | 177 | 301 | 417 | 467 | 358 | 129 | 6754 | 5145 |
| TLL-TFS | B763 | 3872 | 718 | 1700 | 840 | 975 | 366 | 617 | 1071 | 1232 | 368 | 337 | 12128 | 13495 |
| TLL-TFS | A332 | 4237 | 751 | 1550 | 1120 | 1062 | 398 | 625 | 1134 | 1306 | 373 | 358 | 12947 | 14306 |
| TLL-AYT | A320 | 1810 | 390 | 900 | 980 | 713 | 332 | 486 | 760 | 764 | 627 | 215 | 8035 | 8603 |
| TLL-AYT | A321 | 2100 | 423 | 1000 | 1200 | 793 | 371 | 486 | 884 | 889 | 627 | 250 | 9082 | 9986 |
| TLL-AYT | B763 | 3838 | 587 | 1700 | 840 | 1002 | 666 | 994 | 1495 | 1531 | 642 | 427 | 13792 | 17090 |
| TLL-AYT | A332 | 4200 | 620 | 1550 | 1120 | 1103 | 732 | 1017 | 1625 | 1667 | 657 | 465 | 14831 | 18591 |
| TLL-HRG | A320 | 1837 | 390 | 900 | 980 | 686 | 234 | 360 | 729 | 726 | 483 | 199 | 7543 | 7971 |
| TLL-HRG | A321 | 2131 | 423 | 1000 | 1200 | 762 | 261 | 360 | 840 | 839 | 483 | 230 | 8551 | 9202 |
| TLL-HRG | B763 | 3895 | 587 | 1700 | 840 | 974 | 467 | 744 | 957 | 1289 | 500 | 353 | 12335 | 14126 |
| TLL-HRG | A332 | 4263 | 620 | 1550 | 1120 | 1065 | 508 | 757 | 981 | 1322 | 508 | 362 | 13087 | 14485 |
| TLL-HKT | B763 | 3840 | 672 | 1700 | 840 | 982 | 258 | 346 | 865 | 1268 | 2054 | 343 | 13234 | 13732 |
| TLL-HKT | A332 | 4203 | 716 | 1550 | 1120 | 1074 | 286 | 352 | 1064 | 1570 | 2095 | 424 | 14519 | 16948 |

### Summary

- A320: 54 markets, median margin -2%, 23 positive, 12 in 5–15 %, 3 above 20 %; result per BH over all -371 USD; median result per BH -262, of the paying ones 574; ACMI after aircraft and crew 1125 a BH (when there is work).
- A321: 52 markets, median margin 0%, 25 positive, 15 in 5–15 %, 1 above 20 %; result per BH over all -365 USD; median result per BH 0, of the paying ones 886; ACMI after aircraft and crew 1227 a BH (when there is work).
- B763: 33 markets, median margin 1%, 19 positive, 10 in 5–15 %, 0 above 20 %; result per BH over all -33 USD; median result per BH 110, of the paying ones 922; ACMI after aircraft and crew 1681 a BH (when there is work).
- A332: 33 markets, median margin 1%, 19 positive, 10 in 5–15 %, 1 above 20 %; result per BH over all 12 USD; median result per BH 111, of the paying ones 1314; ACMI after aircraft and crew 1601 a BH (when there is work).
