# v0.25 round 3: v025c sign-off

v025c is pushed to origin at head **6002f6b1**. It was built on the integrator's 9c09995b and has three new commits. Nothing was force-pushed. main, claude/contrail-airline-game, v025 and v025b were not touched, and nothing was released.

| Commit | What |
|---|---|
| dce06b53 | Four fixes: the hours factor now applies only to ACMI bases; a narrowbody capacity lease guarantees 275 BH; the Newcomer card says 40–70 days; the maintenance line shows delays and defects separately; the '?' fits on a short phone. Tests added |
| 9f7ad11e | Crew: when another crew member's re-plan moves a shared ticket out, the move is now checked even if the ticket is part of its duty (the seed 3 MAD recovery error). Test added |
| 6002f6b1 | What's New v0.25: a fix line for the maintenance line |

## What the player sees in round 3
- **Crew › Planning '?':** explains why an aircraft at home keeps 5 crews even when it flies little (days off, leave, standby for short-notice charters). On iPhone 852x393 the box now shows the whole text (236/236 px; before, 220 of 236 px and the text cut off mid-word).
- **Season bases:** narrowbody bases guarantee 250 BH a month (Newcomer 200, bases 40–70 days). The rate per hour follows the guaranteed hours: more hours give a lower rate but more money each month.
- **Capacity leases (Respected perk):** a narrowbody lease now guarantees 275 BH, up from 220. Before, it guaranteed less than any season base and paid 22 % less a month. At 275 BH × 0.92 it now pays about 1 % more a month than a 250 BH base, at a lower rate per hour, which is what a long-term deal should do.
- **AOG cover and wet missions (Hajj, far-route rotations):** these keep their own calibrated rates. The round 3 hours factor had made Hajj up to 40 % dearer and narrowbody AOG cover 7 % cheaper. It now applies only to season bases and capacity leases.
- **Company standing card:** the Newcomer line now reads "Season bases of 40–70 days", the same as What's New.
- **Company › maintenance programme line:** it now reads "At High: AOGs −55 % · delays −50 % · defects −65 % · ≈ +$52K/month". Before, the delay cut was labelled "defects".
- **Maintenance programmes:** Medium and High cost what a real programme costs (High is about $150K a year on a busy A320).
- **What's New v0.25:** the base-hours line adds "and capacity leases 275". There is one new fix line for the maintenance line. All other round 3 lines are unchanged and still accurate. The existing fix line "One pilot's new plan no longer moves the whole set's ticket out days earlier" now also covers the case fixed here.

## Findings

| # | Sev | Finding | Status |
|---|---|---|---|
| 1 | major | Bot 3 365 --wide --inv --base=MAD: 1 FTL recovery error (FO, 174:25 h) | **Fixed** (9f7ad11e). The cause was not quite what the integrator described. The FO's own retick correctly refused the plan, but the **captain's** retick had already moved the shared ticket out (moveHome, roster.ts). Its `shiftOk` guard for the other crew on that ticket found no 'pos' seg, because a ticket out that lands close to the report is merged into its duty's seg, so it passed the move. Now a ticket moved away from its duty is checked as a ride of its own. If that breaks a limit, the captain gets his own ticket, as before. Test: ticketClash.test.ts (it fails without the fix). Seed 3 MAD: 0 errors, recovery gap 167 h |
| 2 | major | Narrowbody capacity lease MGH 220 was below the new 250 base, so it was the worst-paying wet deal | **Fixed** (dce06b53). MGH is now `BAL.mgh.narrow × 1.1` = 275. Widebody stays at 330. Test: missions.test.ts |
| 3 | minor | Newcomer standing card said 30–45 days | **Fixed**. relations.ts STANDING_EFFECTS[0] and the offers.ts comment |
| 4 | minor | Hours factor applied to every wet product (Hajj +10–40 %, AOG cover −7 %) | **Fixed**. Applies only to `seasonBase` and `capacityLease`. Two ratio tests now compare against a base at the reference MGH. New test: AOG cover and Hajj keep their rate whatever their MGH |
| 5 | minor | Same as 3 (player lens) | **Fixed** |
| 6 | minor | Maintenance line labelled the delay cut (−50 %) as "defects" | **Fixed**. Now "delays −50 % · defects −65 %". Checked in the browser on all three sizes |
| 7 | minor | iPhone: Planning '?' cut at 220 px | **Fixed**. On screens under 500 px tall, the help body may use the screen height (the box is already capped to it and scrolls). iPhone now 236/236 |
| 8 | minor | F1: Planning says "Short … Hire to complete" while crew sit idle | **Not fixed (deferred, as in FINAL2)**. It is an engine change to crew sizing and needs its own bot round. It could not be done safely in this round. The '?' text explains it |

Other open items stay as reported: the balance lane's mid-summer gaps, the margin spread, and a module-level cache shared between games.

## Checks (engine at 9f7ad11e; 6002f6b1 adds only What's New text, with whatsNew.test 30/30 and tsc clean)

| Check | Result |
|---|---|
| tsc --noEmit | clean |
| Full vitest --maxWorkers=2 | 378 files, **3087 tests passed**, exit 0 |
| Bot 1 365 --wide --inv | **0 errors**, 21 warnings, 2528 legs. Margin 9.6 %, first contract day 0 |
| Bot 2 365 --wide --inv | **0 errors**, 0 warnings, 2264 legs. Margin 15.6 % |
| Bot 1 365 --routes --inv --base=MLA | **0 errors**, 7 warnings, 2356 legs. Margin −4.3 % (now inside the −5 % gate) |
| Bot 3 365 --wide --inv --base=MAD | **0 errors** (was 1), 2 warnings, 2140 legs. Recovery gap 167 h (PASS). Margin 11.6 % |
| Bot 2 365 --det | identical: two runs, save/load at day 90, save/load at day 200 + 2h17 |
| Invariants on a copy of malteser.json, 30 days | 0 errors, 0 warnings, 482 legs, cash $1.857M (same as v025b) |
| vite build | ok |
| Playwright smoke (vite preview, player save) on iPad 1180x788, iPhone 852x393, Mac 1440x900 | 0 page errors and 0 console errors on all three. 547 game minutes at 4x. Planning '?' 236/236 on all three. Maintenance line correct |

Every bot exits 1 because of gates that already failed on v025b: run time, summer BH, margin bands (seed 2 at 15.6 %), and other "no" targets. The integrator and the balance lane both reported these. None of them is an invariant error.

Logs: /home/user/work/v025/r3fix/ (s1.txt, s2.txt, mla.txt, s3mad.txt, det2.txt, vitest-full.txt, inv30.txt, build.txt, smoke.txt, from0714-b.txt). Screenshots: /home/user/work/v025/shots/r3fix/. Smoke script: /home/user/work/v025/r3fix/pw/smoke.cjs. STATE: /home/user/work/v025/STATE-r3-fix.txt.

VERDICT: v025c READY. Every required check passes (0 invariant errors on all four bots, determinism identical, full vitest green, build and smoke clean). The two majors and the five minors are fixed. Only the deferred F1 (Planning sizing) stays open, as in FINAL2.
