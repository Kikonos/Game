# v0.25 round 2: sign-off of v025b

Branch **v025b**, head **bdcfd9a7**, is pushed to origin. It is built on the round 2 integration 8a545b73, which came from v025 23c9c10b. Nothing was force-pushed. main, claude/contrail-airline-game and v025 were not touched, and nothing was released.

## What the player sees in round 2
- **AOG rescue:** when an aircraft goes AOG away from base, the game offers a rescue. AOGs now happen at a realistic rate.
- **Curfews** at Adelaide, Gold Coast, Innsbruck and Itami.
- **Crew sizing:** a detachment's crew sets are sized by the duties it flies, and spare sets on station are stood down. Older saves get this on load (new in this round, see F3). Before, it waited for the first game midnight.
- **Detachment rotation:** crew on a detachment go home after the Rotation weeks set under Company. Tours planned by an older build are fixed once on load (new in this round, see F2). Crew are no longer stuck waiting for a ticket home.
- **Passenger letters**, plus **milestones and anniversaries**.
- **Glossary search.**
- **Midnight:** the stall at game midnight and the save freeze are gone.
- **First run** opens on the title screen, and older What's New versions are folded.
- **Interface:** clearer counter-reply wording, route dialog buttons, Leave month chips, the parked ×6 stack, and route lines drawn above parked aircraft.
- **What's New v0.25:**
  - The counter-reply example now goes up, "from $84,000 up to $90,000", the way the game moves.
  - The crew sizing line now reads "Crew Planning sizes a detachment by the duties it flies, so it no longer asks you to hire spare sets that would sit idle on station."

## Findings
| # | Sev | Finding | Status |
|---|---|---|---|
| F3 | minor | On an older save, Planning asked for hires until the first midnight | **Fixed** (6cfb4843). On load, detachments are sized again, once (`g.stats.resizeOnLoad`; new games set the flag in init). The player's save straight after Continue: Planning shows 24 needed, 24 complete, "Complete", and "Round up to 25 sets" as the small button. Before: 26 needed, 23 complete, short 1 CPT, 1 FO and 9 CC, with "Hire to complete 26 sets". Checked in Playwright on iPad, iPhone and Mac. Tests: crewSizing (an older save loads with the grown sets stood down, and a second load changes nothing) and awayOnLoad (Planning on the player's save at load). Over 30 days on the save, this repair alone gives the same cash and the same legs as before. |
| F2 | minor | The away cap only changed new assignments, so tours already rostered were not repaired | **Fixed** (722c4a93). Once on load (`g.stats.awayOnLoad`), a planned tour that starts more than 2 days ahead and keeps someone away past the rotation is tried on a copy first: that crew member is taken off and the roster fills the tour from home. The change is kept only if every seat is filled by someone else. On the player's save, CC Luca Esposito (c14y) comes off the NTE tour pbua, which is then fully crewed. Over 60 days her longest time away is 41.4 days (was 73.6). Crew away more than 42 days: 0 (was 1). Crew away more than 35 days: 20 (was 22). No cancellations. Test: awayOnLoad.test.ts, using the player's save as the new fixture save-v025-c14y. Loading the save twice gives the same state. |
| F4 | minor | The What's New counter example went the wrong way | **Fixed** (c1440625). It now reads "from $84,000 up to $90,000". |
| F1 | major | Planning still asks for hires on the player's save as it plays on (hireHold almost never holds, and homeMin = 5 per aircraft at home) | **Not fixed.** I tried making the hold count idle crew at home who have a trip or two rostered (crew on a detachment tour still excluded), and never hold while a flight of the family is short of crew. On the save, the hold line then showed after 60 days. The player-like bot (`--player`) then held its round-up hires and ran short of crew. Seed 1: red alarms 15 → 47, amber 12 → 52, margin 4.5% → −25.3%, invariant warnings 4 → 15. Seed 2: red alarms 5 → 17. I reverted it (fe967586). In the bot, crew who fly few hours are still needed, because sets are about days available, not hours flown. The other cause, the floor of 5 sets for an aircraft at home with little or no flying, is the setting the bots were tuned on: with 3 or 4 sets, red alarms doubled. Changing it safely needs a bot tuning round, and that did not fit tonight. What is fixed: at load the save now shows "Complete" (F3). What stays open: as the player's home aircraft fly little, Planning can show "Short" with a primary Hire button while Utilisation shows many crew under 15 h. I reworded the What's New line so it claims only the detachment sizing; it no longer says "Planning and Utilisation now agree". |

## Checks (head bdcfd9a7 = all code above)
| Check | Result |
|---|---|
| tsc --noEmit | clean |
| Full vitest --maxWorkers=2 | 378 files, 3085 tests passed, exit 0 |
| Bot 1 365 --wide --inv | 0 errors, 0 warnings, 2595 legs (same as 8a545b73 except run time) |
| Bot 2 365 --wide --inv | 0 errors, 0 warnings, 2115 legs (same as 8a545b73 except run time) |
| Bot 1 365 --routes --inv --base=MLA | 0 errors, 0 warnings, 2678 legs (same as 8a545b73 except run time) |
| Bot 2 365 --det | identical: two runs, save/load at day 90, save/load at day 200 + 2h17 |
| Invariants on a copy of malteser.json, 30 days | 0 errors, 0 warnings, 482 legs, 8 crew alarms |
| vite build | ok |
| Playwright smoke (vite preview) on Mac 1440x900, iPad 1180x788 and iPhone 852x393 | 0 page errors and 0 console errors. About 9 h of game time played at 4x, across midnight. Planning at load shows "Complete" on all three |

Notes:
- **Bot exit code:** the bots exit with 1 only because of gates that already failed on 8a545b73: seed 1 margin 15.7%, summer BH per aircraft under 180, MLA's first contract on day 22, and run time 43–54 s. Invariant errors would give exit 2, and there were none.
- **Lower cash in the invariants run:** cash after the 30-day run is $1.86M, against $2.31M on 8a545b73. The F2 repair takes a different RNG path. About $395K of the gap is payment timing: a $527K invoice from client cl5q falls due on 31 Aug instead of 17 Aug. The statement differs by about −$60K: maintenance draws, and a few block hours. There were no cancellations or sub-charters in either run.
- **New games:** new games set both flags at creation, so F2 and F3 do not change bot runs. The three bot runs above match 8a545b73. I did not run the --player bots again after the revert: the hold code is back to its 8a545b73 version.

Logs: /home/user/work/v025/r2fix/final/ (tsc.txt, vitest-full.txt, bot-s1-wide.txt, bot-s2-wide.txt, bot-s1-routes-mla.txt, det2.txt, inv30.txt, build.txt, smoke.txt). --player comparison: /home/user/work/v025/r2fix/bots/. Screenshots: /home/user/work/v025/shots/r2fix/. STATE: /home/user/work/v025/STATE-r2-fix.txt.

Commits on top of 8a545b73:
- 6cfb4843 F3
- c1440625 F4
- c0550923 F1 attempt
- 722c4a93 F2
- fe967586 revert of the F1 attempt
- bdcfd9a7 What's New crew line

VERDICT: v025b READY (every check passed. F1 stays open: Planning can still ask for crew hires as home flying drops, and fixing that needs a bot tuning round)
