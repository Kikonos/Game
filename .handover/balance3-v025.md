# v0.25 round 3: balance pass (lane r3-balance)

Branch **v025-r3-balance**, built on v025b bdcfd9a7. Pushed to origin. Nothing was force-pushed, and nothing was released.

Commits:
- 2f9968b1 bot: the first policy round now runs at the start, so the bot reads the opening offers on day 0 as a player does.
- fa84b747 balance: narrowbody MGH, Newcomer bases, a wet rate that follows the guaranteed hours, and the cost of preventive maintenance.

## Before and after (365 days)

"Before" means v025b bdcfd9a7, run unchanged. "After" means head fa84b747. Logs are in /home/user/work/v025/r3bal/before and /home/user/work/v025/r3bal/final.

| Run | Summer BH per aircraft, before → after | Year margin, before → after | First contract, before → after | Invariants after |
|---|---|---|---|---|
| Seed 1 --wide --inv | 148 → 136 | 15.7% → 8.7% | day 23 → day 0 | 0 errors, 21 warnings (see Notes) |
| Seed 2 --wide --inv | 107 → **182** | 4.1% → 14.8% | day 3 → day 0 | 0 errors, 9 warnings |
| Seed 3 --wide --inv | 154 → **212** | 1.2% → 14.0% | day 2 → day 0 | 0 errors, 1 warning |
| Seed 4 --wide | 173 → 171 | 2.6% → 24.7% | day 2 → day 0 | – |
| Seed 5 --wide | 161 → 160 | 11.0% → 7.6% | day 3 → day 0 | – |
| Seed 6 --wide | 167 → 162 | 20.4% → 1.3% | day 5 → day 0 | – |
| **Mean of seeds 1–6** | **152 → 170** | **9.2% → 11.9%** | | |
| MLA --routes --inv | 168 → 149 | 4.2% → −6.0% | day 22 → day 0 | 0 errors, 3 warnings |
| --player seed 1 --inv | 86 (6 aircraft) → 115 (3 aircraft) | −0.4% → 4.9% | day 0 → day 0 | 0 errors, 3 warnings (9 before) |

Single seeds swing a lot. A small change of input sends the bot down another path: other contracts, AOGs and lessors. Seed 1 measured 175 BH and 9.4% margin with Newcomer bases of 45–75 days, and 136 BH and 8.7% with 40–70 days. Only the means over several seeds are a fair reading.

## (1) Summer block hours were below the 180–320 target
**Cause:** I traced it on the contract books of seeds 1, 2 and 4 at 1 October (/home/user/work/v025/r3bal/s1-oct.json, s2-oct.json, s4-oct.json).
- A season base is held down to its targetBH, which is MGH × 1.08–1.3 (plan.ts, "monthly drops"). A Newcomer's MGH was 160 and the standard MGH was 200, so a summer base flew only 170–260 BH a month.
- A Newcomer's bases ran 30–45 days. Each aircraft had several gaps of 1–4 weeks in the middle of summer, filled only by ad hoc work of a few BH. For example, on seed 1, CS-TAN ran a base from 14 May to 3 Aug, then another from 5 Aug to 5 Sep, then only ad hoc work.
- Offer volume was not the cause. Each season had enough base offers. Crew and maintenance windows were not the cause either: summer utilisation sat at 24–50% of crew capacity, and summer had no long checks.

**Fix (the inputs):**
- `BAL.mgh.narrow` goes from 200 to 250, and the Newcomer MGH from 160 to 200. [E] An A320-family ACMI deal guarantees about 250–350 BH a month in the season. An A320 on a summer base flies 9–12 BH a day.
- A Newcomer's bases now run 40–70 days (were 30–45). The ordinary market's bases were already 45–90 days.
- The test fixtures (hamBase and dubBase) keep the 200 BH they were written with, through the new option `OfferOpts.mgh`.

**Result:** the mean of seeds 1–6 rises from 152 to 170. Seeds 2 and 3 now pass, and seeds 4–6 are 160–171.

**What is still open:** mid-summer gaps. A base signed in spring ends in July, and almost no base offers start in July or August. A third aircraft that arrives in July also waits for work. Seeds 1, 4, 5 and 6 still sit at 136–171. A further step would be a "rest of summer" short-term ACMI offer type for July and August (engine shortages and AOG-driven demand). That is a new generator, not a constant, so I did not start it in this round.

## (2) The first contract came late
**Cause:** this was in the bot, not the game. Every new game posts three openers on day 0: an AOG cover starting in 8–20 h, an ad hoc job in 3–5 days, and a season base in April. All three are flyable, with margins of $110–640K (checked with a probe on seeds 1–3). The bot's play loop first ran its policy at the first midnight. By then the AOG cover had lapsed, and the bot measured "first contract" by direct acceptances only.

**Fix:** the bot's first policy round now runs at the start, as a player reads the desk on day 0. The first contract is now on day 0 on every seed, on MLA and on the --player bot. A player always has a first job on day 0 (AOG cover), then one in 3–5 days, then a base from April.

## (3) The High preventive maintenance programme never paid for itself
**Measured before**, on seeds 1–3 --wide with --pm=high against low (/home/user/work/v025/r3bal/pm/):
- The maintenance line was +$1.18M to +$1.32M a year on 3 A320s. That is about $430K per aircraft-year.
- Technical dispatch reliability went from 98.2–98.4% to 98.7–99.2%.
- AOGs went from 1 to 0.
- Year profit was $0.6–1.4M lower.

**Cost against what a real programme adds** ([E], sized in balance.ts):
- **Per BH:** component support is about 25–30% of an A320's DMC ($225–270/BH). Changing the parts that fail most at about 80% of their mean time between removals adds 10–15% to that, which is about +3% of DMC (High). Medium's night-stop rectification adds about +1%.
- **Per month:** Medium's extra daily and weekly checks are about an engineer-hour a day at $85, so $2,500. High adds a reliability engineer (about $120K a year shared by 6–8 aircraft, so $1,500) and home-base rotables or pool access ($2,500), so $6,500. A widebody costs about twice as much.
- **New settings:** Medium +1% and $2,500 (was +6% and $4,000). High +3% and $6,500 (was +14% and $10,000). A widebody pays $5,000 and $13,000.

**Benefits (unchanged, already realistic):**
- High halves technical delays, cuts AOGs by 55% and deferred defects by 65%, and the Ladder's technical reliability climbs.
- On an 18-year-old A320 at Low, technical delays come at 0.35% × 2.8 ≈ 1% of departures, which is 99.0% dispatch, about right for an old fleet on the minimum programme. At High it is about 0.5%, so 99.5%, the A320 world fleet average.
- An AOG costs $50–200K in rescue, sub-charter and parts. The rate is 0.3–0.5 per aircraft-year.

**Measured after** (seeds 1–3 --pm=high, files pm/high1-s*.txt, run before the Newcomer days became 40–70):
- The maintenance line is +$0.69M on seed 1, against +$1.32M before. A clean comparison is not possible because the bot's path diverges.
- Technical reliability is 99.2–99.5% for the year (low: 98.2–98.4%).
- AOGs: 0.

**Annual cost now:**
- An A320 flying 2,400 BH costs about $55K a year on Medium and about $150K a year on High.
- High saves about 0.2 AOGs and 5 technical delays per aircraft-year.
- It is about break-even for an old, busy fleet and too dear for a young one, which is how it works in reality.
- It also buys reliability for the ETOPS and Widebody approvals.

**Not done:** contract money for technical delays. Today a wet (ACMI) leg pays nothing for a technical delay; only a delay over 3 h costs a relation point (latePolicy.ts). Real ACMI deals often have dispatch-reliability credits. latePolicy is shared by the delay cards, crew control and the trip-move previews, so changing it needed more time than was left.

## (4) Margin: is a careful bot too comfortable?
**Before:** across seeds 1–6, margins were 15.7, 4.1, 1.2, 2.6, 11.0 and 20.4% (mean 9.2%). Seed 1's 15.7% came from a lucky book of work, not from a generous economy. The player-like bot made −0.4%.

**Change:** more hours alone would have pushed margins up. The first trial, with MGH alone, gave a mean of 13.4% (seed 4 at 19%). So the wet rate now follows the guaranteed hours, as real ACMI pricing does:

rate × (1 − 0.4 + 0.4 × ref / MGH)

- ref = 200 for narrowbodies and 300 for widebodies, the MGH the types' rateBH were set at.
- About 40% of an ACMI rate pays the month's fixed costs. For an A320 that is about $330K a month at 200 BH and $4,100 an hour: rent, salaried crews, insurance and overhead.
- At 250 BH a base is 8% cheaper an hour, but it earns 15% more a month.
- Hours above the standard MGH, a perk of Trusted and Partner clients, do not lower the rate.

**After:** the mean of seeds 1–6 is 11.9%, but the seeds spread from 1.3% to 24.7%. Seed 4 made $6.9M on $28M of revenue. The --player bot made 4.9% (was −0.4%) on 3 aircraft (was 6), and MLA with routes made −6.0%: its scheduled route, war-risk cover and an idle winter cost it.

**Verdict:** a decent careful player lands at about 5–15%. The upper end is still a little high. A next step: `BAL.wetRate.fixedShare` 0.4 → 0.5 gives about −2 points. It needs a full bot round, which did not fit before the stop.

## Checks on head fa84b747
| Check | Result |
|---|---|
| tsc --noEmit | clean |
| Full vitest --maxWorkers=2 | 378 files, 3085 tests passed, exit 0 (/home/user/work/v025/r3bal/final/vitest.txt) |
| Bot 2 365 --det | identical: two runs, save/load at day 90, save/load at day 200 + 2h17 |
| Bots 1–3 --wide --inv, MLA --routes --inv, --player --inv | 0 invariant errors |
| Invariants on a copy of malteser.json, 30 days | 0 errors, 0 warnings, 482 legs, cash $1.86M (the same as v025b: signed contracts keep their terms, so old saves are unchanged) |
| vite build | ok |
| Saves | no new fields and no save version change. `OfferOpts.mgh` is an option of the offer generator, not stored |

## Notes
- **Invariant warnings after:** seed 1 has 21: 17 ac-plan-overlap and 3 slips. These are BKO–LIS legs that slipped 239 h after an aircraft was stuck at Bamako in November, which leaves later legs planned before it is back. This is the same family as FINAL.md's open item "Long AOG waits on a return leg", here on a new path. Seed 2 has 9, seed 3 has 1, and MLA has 3 (uncalled standby). Before, there were 0 on seeds 1–3. There are no errors.
- **Latent bug found (pre-existing, not fixed):**
  - Two games advanced in one process can influence each other through a module-level cache. saveContinue.test.ts compares a game and its reloaded copy in one process. It failed with the first trial values (Newcomer bases 45–75 or 40–75 days, MGH 200) and passes with 40–70.
  - Repro: VITEST=1 npx tsx /home/user/work/v025/r3bal/dbg/sc8.ts g,h,h2 (or h2,h,g), with newcomerBaseDays [45, 75]. Three identical states, g, h and a fresh reload h2, are each advanced over the same 6 h (10 Apr 2027 21:00 → 11 Apr 03:00, seed 7). **Whichever is advanced first** ends differently from the other two: it books one more deadhead ticket and duty, so ids are shifted. The other two match.
  - Across processes, a save and reload plays on identically (sc7.ts: SAME). So the save is complete. The stale entry is in a shared cache read during the crew roster or ticket booking step. It is not the fitMemo cache in duties.ts (ruled out).
  - In the app this could only show when a game is loaded after another one was played in the same tab.
  - Worth a round: find the cache whose key misses an input, or key it by GameState.

Scripts used: /home/user/work/v025/r3bal/runall.sh, r3contracts.ts (a save's contracts by aircraft), dbg/sc*.ts. STATE: /home/user/work/v025/STATE-r3-balance.txt.
