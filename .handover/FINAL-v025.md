# v0.25 sign-off: branch v025

Branch v025, HEAD 23c9c10b = origin/v025, pushed. Nothing was released. main and claude/contrail-airline-game were not touched, and nothing was force-pushed. The fix lane ran from 04:31 to 05:05 UTC. Its STATE file is /home/user/work/v025/STATE-fix.txt.

Fix commits on top of the integration (88520342):
10c8ed96, 93bc8d34, 143f500f, f0bbabc1, 668e8dec, 0f9cdaff, 7f9cb47c, 546ca9ff, 57602ba6, b34003ac (What's New), 23c9c10b

## What the player will see, by area

- **Crew.** Tickets no longer overlap. There are at least 1 h 15 min from landing to the next check-in. A duty that ends a few minutes late no longer grounds the next crew. Several crew going home early at once make one Inbox note per set, in plain words. *New in this pass:* a crew member who is taken off part of a tour and put back on it gets no note, so a set no longer reads as "sent home" when nobody leaves. Each name appears once. "Ticket DEL–MLA clashes with the trip" now reads "Their flight DEL to MLA no longer fits the trip". Greenland tickets connect in Copenhagen, Reykjavik or Nuuk onto Air Greenland from every airport, Shannon and Cork included.
- **Routes (network).** The business case uses your own aircraft and what they cost you, and it is kept month by month after Go, with plan bars on the result chart. A study's demand is fixed on the day it is done. Denied boarding leaves a note, and the rival that cuts its fares is named. *New in this pass:* saving and loading a game with a partner route no longer changes how the partner pays. The game plays the same after a load.
- **Offers and contracts.** Each broker's own commission is shown, with the profit after lease and crew. Visits, seasons and government payment follow country risk. The contract sheet now holds the crew setting, sub-charter and cancel. *New in this pass:* "Cancel now" reads "Penalty $142K + $142K paid back to the client · $284K in all", which matches the Cancel dialog. The button reads "Cancel contract". The confirm and the sub-charter dialog open over the sheet and close back to it, and the confirm's back-out button reads "Keep it". National teams travel only in their months: international windows for football, February and March for the Six Nations, and tests otherwise. England's teams also fly to Murrayfield, Glasgow and Cardiff.
- **Ops and world.** There is parking away from base, aircraft fly home before a check away, ferries and fuel stops avoid busy hubs, and world events follow the seasons. *New in this pass:* a wait between two legs of the same job, such as an away day or a multi-day trip, pays no parking because it is in the job's price.
- **Immersion and visual.** New cards for a disruptive passenger, crew named on the cards, AOG repair time by fault, weather by season and place, liveries seen from above, and Finance colours.
- **UI.** The iPhone roster board, hints, livery editor, Up Next, the globe pins and the logs date column are fixed. *New in this pass:* Space pauses again while a dialog is open. Before this, a button left focused behind the dialog (the 4x speed button, or the card that opened a sheet) swallowed Space and the game kept running. Space on a button inside the dialog still presses that button.

What's New v0.25 was updated to match: parking between jobs only, crew who stay on the tour get no note, the cancel row wording, Space with a button in a dialog, Greenland from every airport, and football windows and the Six Nations in February and March.

## Hunters' bugs

- **Fixed (all lanes, 70 items):**
  - crew 10/10
  - ui 14/15
  - network 13/13
  - commercial 12/12
  - ops-world 9/9
  - immersion-visual 11/11
  - All 4 confirmed majors (crew ticket overlap, core-1 recovery, core-2, LZ-UFQ wait before maintenance away) re-run clean. Invariants and bots show 0 errors.
- **Not fixed:**
  - visual-parked-stands is partial. Missing: the 0.75 scale (it would shrink the labels to 8 px), the x6 badge, and route lines under parked aircraft.
  - Commercial home missions for LV and BG are missing because the PRN and SJJ airports are not in the data.
- **Deferred by triage:**
  - crew-oversets and crew-awaychain
  - core-i1, core-i2 and core-i4 (midnight spread, IndexedDB saves, faster Continue)
  - ops-aog-rescue and ops-curfews
  - network-pick-tail-in-case
  - comm-tender-mgh
  - immersion milestones and passenger letters
  - six small UX items: ui-route-dialog-actions, ui-whatsnew-fold-old, ui-glossary-search, ui-onboarding-first-run, ui-counter-reply-wording and ui-leave-month-targets

## Improvements

The release ships 8 features, 37 improvements and 10 fixes, as in the What's New list. Deferred improvements are the triage list above, plus the parked-stands remainder.

## Review findings

| # | Sev | Finding | Result |
|---|---|---|---|
| 1 | major | Partner route terms change on load (determinism) | **Fixed** (10c8ed96, 93bc8d34). partnerClient sets `risk`. seedRisk keeps a route partner's (`cn…`) own terms, so old saves with a partner keep 0.85/[5,25]. Tender clients made in play also carry their tier. A test plays 40 days after the first partner invoice, original against a loaded copy: the rng and cash are identical. |
| 2 | minor | Greenland tickets from SNN, ORK, YFB and BOS were invented nonstops | **Fixed** (546ca9ff). With no nonstop to a gateway, the gateway's own airline flies the first leg and Air Greenland the last. SNN–CPH–SFJ is on SK then GL, YFB–GOH–SFJ and BOS–GOH–SFJ are on GL. Tested. |
| 3 | minor | The RFU and the FA never fly to Scotland or Wales | **Fixed** (0f9cdaff). nationOf splits GB into England, Scotland, Wales and Northern Ireland. In rugby, Northern Ireland counts as Ireland. Tested, and the RFU now gets EDI. |
| 4 | major | Space is swallowed by a focused button behind a dialog | **Fixed** (143f500f). The pause key yields only when the focused control is inside the dialog. Unit test, plus Playwright on Mac, iPad and iPhone: the game pauses with 4x focus behind the sheet, and Space on Close presses Close. |
| 5 | major | "deposit back" in the sheet's Cancel now row | **Fixed** (f0bbabc1). The row now reads "Penalty X + Y paid back to the client · Z in all" ("lessee" for a dry lease), the same sums as the dialog. The What's New line is fixed too. Seen in Playwright. |
| 6 | minor | Cancel and sub-charter replace the sheet; bare Cancel label | **Fixed** (668e8dec, 23c9c10b). Both stack over the contract sheet (modalUnder). The label reads "Cancel contract", and the confirm's back-out reads "Keep it" (also for refit, class and rotation cancels). On iPhone the button stays an icon with the aria-label "Cancel contract". Not changed: there is no room for text in the phone footer, and the confirm explains the action. |
| 7 | major | "Go home early" note fires for crew who stay on the tour | **Fixed** (7f9cb47c). Notes are held to the end of the re-roster (holdEarlyHome). Only crew who no longer hold a seat on their set's tour from that point get one. Those who stay lose the stale reason for a ticket home (`homeWhy`). There is one line per person per set and minute, and the reasons for "ticket clash" and "At X, not Y" are in plain words. Tests cover held, released, the duplicate and the wording. On a bot run from the Malteser save over 70 days, only sick notes remain and a doubled name is gone. The run takes a different path after the fix (crew who stay are no longer sent home), so the exact 13 Sep DEL case is covered by the unit test, not replayed. |
| 8 | minor | National team trips ignore the calendar | **Fixed** (0f9cdaff). Drawn dates move to the sport's months or there is no offer. Titles fit the month: Six Nations only in February and March, Nations League in September to November, and Friendly otherwise. Tested. |
| 9 | minor | Parking charged during a job's own wait | **Fixed** (57602ba6). A stand between two legs of the same contract is free. Parking between jobs stays, because it is the operator's own choice, and the What's New line now says "between jobs". Not done: the offer dialog's profit still does not show parking between jobs, because no single offer can know about it. |

## Checks (HEAD b34003ac for engine checks; 23c9c10b changed UI labels only and was re-checked by tsc, vitest on the UI, build and Playwright)

| Check | Result |
|---|---|
| tsc --noEmit | clean |
| Full vitest --maxWorkers=2 | 368 files, 3052 tests pass |
| UI vitest after the last commit (modals, game, network screens) | 13 files, 67 tests pass |
| bot 1 365 --wide --inv | 0 errors, 0 warnings |
| bot 2 365 --wide --inv | 0 errors, 1 warning (slip: XY3003 BGW–RUH 86 h after a tug-damage AOG) |
| bot 1 365 --routes --inv --base=MLA | 0 errors, 1 warning (slip: V73061 CFU–NTE 69 h after a tug-damage AOG) |
| bot 2 365 --det | two runs identical, save/load at day 90 identical, save/load at day 200 + 2h17 identical |
| invariants, copy of malteser.json, 30 days | 0 errors, 0 warnings (481 legs, 160 crew) |
| vite build | ok (PWA, 463 precache entries) |
| Playwright on vite preview: Mac 1440x900, iPad 1180x788, iPhone 852x393 | 0 page errors and 0 console errors on all 3 across map, contracts, network, schedule, crew, fleet, finance, company, inbox and What's New. The Space, cancel-row, stack and Keep it flows all pass. Shots are in /home/user/work/v025/shots/fix/ |

## Open items

- **Long AOG waits on a return leg (new with this round's AOG repair times).** A tug-damage AOG at an outstation can take 3 to 4 days. The recovery rule never drops "the leg that brings the aircraft and its passengers home", so that leg waits 69 to 86 h and the bot logs a slip warning. Seed 2 also had 9 AOGs and 46 cancelled legs, which pushed its year margin to −8.2% (the integration build, same seed, had +6.2% with 1 AOG). This is random-draw variance on top of the longer repairs. Suggest: past about 24 h, offer or force a sub-charter for that return leg. It needs a recovery-logic change, which was too risky for tonight.
- **Balance pass.** Seed 2 summer block hours per aircraft are 130 (target 180–320), MLA 173. Seed 1 has its first contract on day 42 (MLA: day 22). AOGs per aircraft-year are 0.83 on seed 1 and 3.57 on seed 2. Bot runs take 55 to 73 s against the 12 s and 20 s limits, while sharing CPUs.
- The lane remainders and triage deferrals listed above.
- The offer dialog does not show parking between jobs.
