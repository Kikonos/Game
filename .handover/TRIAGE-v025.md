# v0.25 triage: build plan

Triage started 00:52 UTC and the write-up started 00:56 UTC. The code base is origin/v025 at 5dfccc28 (v0.24.2). Notes are in hunt/triage-notes.md, and the repro outputs are in hunt/triage/.

## How the majors were confirmed

Re-run here, in my own worktree /home/user/wt/h-triage:

| Item | Repro | Result |
|---|---|---|
| crew-ticketoverlap | `invariants.ts save crew/mad-d196.json 2` | ERROR crew-overlap: Davide Romano, duty 13 Sep 09:00 starts before the previous one ends at 09:40. **Confirmed** |
| core-2 | `invariants.ts save core/s9-d379.json 2` | ERROR crew-overlap: Carlos Díaz, duty 14 Mar 2028 17:00 starts before the previous one ends at 17:25. **Confirmed** |
| core-1 | `acmi-bot 11 --from=core/s11-d88.json --on=4 --inv --routes --base=MLA` | ERROR recovery: Rachel Zammit 176:05. Also warn sby-rest: Wójcik 6:00. **Confirmed** |
| ops-wait-before-maint-away | `stuckseed.ts 5 40 SOF` (h-ops) with DUMP=LZ-UFQ | LZ-UFQ at WAW from 10 Mar to 11 Apr, then the ferry WAW-BUD. **Confirmed** |

Confirmed by reading the code (the cause is exactly as the hunter described it):
- comm-broker-pct: OfferModal.tsx:712 hard-codes "(5%)", and feasibility.ts:795 uses the flat BAL.brokerCommission.
- comm-visit-spam: trips.ts gives visitRel 8 on every visit. Nothing reads a last-visit date.
- comm-tour-season: RESORTS_NB (flavor.ts:218) has no season split.
- immersion-lead-client-mismatch: nearClient (offers.ts:320) falls back to g.clients when the client is not in the filtered list.
- immersion-world-iraq-overlap: allowed() (world.ts:282) blocks only the same template id. warIraq and airspaceIraq share zone 'iraq'.
- network-case-wrong-aircraft and network-planner-ideas-cabin: layout 'two-class' is hard-coded (advice.ts:135, launch.ts:716/772), and the search tries only the study's gauges.
- network-case-owned-aircraft-cost: the case costs `aircraftCostBH(g, null)` (launch.ts:318/611), while the P&L costs the actual aircraft (pnl.ts:86).
- network-studybase-drift: studyBase is recomputed on every call (launch.ts:644).
- ui-space-in-dialog: the pause branch in Shell.tsx:283 has no `free` check.
- visual-globe-marks-corner: the useLayoutEffect at Globe.tsx:1202 runs before api.current is set in the mount useEffect (line 1081).
- ui-toast-covers-map-controls: .toasts is fixed bottom-right (app.css:319), the same corner as .map-zoom.
- log date column: .v8-log is 52px (v08.css:60).

Not re-run, because the repro is long and the hunter's dumps and traces are on disk and consistent with the code: crew-guestfix, crew-oversets, ops-crew-ticket-slip, comm-sports-federation, and the iPhone layout majors (Playwright probes).

**Nothing failed to reproduce.**

## Duplicates merged

| Merged item | Sources |
|---|---|
| Log date column (Clients, Rivals and Team Recent) | comm-client-log-overlap, ui-clients-recent-date-overlap, visual-log-date-col |
| Up Next time cut off | network-map-upnext-truncated, visual-upnext-date-cut |
| iPhone roster board | crew-iphoneboard, ui-iphone-roster-board-tiny (crew-iphoneboard also noted that Hire is off screen, which is ui-iphone-crew-hire-offscreen) |
| Wrong season titles | comm-season-titles, immersion-halfterm-summer |
| Merge the 'goes home early' bursts | ui-inbox-merge-bursts, immersion-early-home-spam |
| AOG repair time by fault, plus the MEL | ops-aog-causes, immersion-aog-cause-times |
| Crew tickets that overlap | crew-ticketoverlap, core-2 (the same family of bug in ticket placement, so one lane item with two repro saves) |

## Lanes

The lanes run in pairs, in this order: 1+2, then 3+4, then 5+6. Each lane holds about 2 h of work, ordered so that a lane that runs short drops its tail. Every lane must keep the engine deterministic: new random rolls go only on side streams (hash of seed and key). Saves must stay compatible: new fields get `??=` defaults or onLoad repairs. Every lane ships tests, run as targeted vitest with --maxWorkers=2.

### Lane 1: crew (engine/crew/*, scripts/invariants.ts, fixtures/compatKit)
1. **Crew tickets that overlap or break legality** (crew-ticketoverlap, core-2; major). In roster.ts sendHome (~801), `held` sees only tickets from c.loc. Treat any later ticket, including one out of base, as a deadline: its std − check-in − CONNECT_MIN (75). If the home ticket would land after that deadline, ticket the person to that trip's destination, or drop and re-ticket the trip. Ticket placement in timeline.ts must require the later departure ≥ arrival + 75 + check-in. Verify that invariants on hunt/triage/mad-d196.json and s9-d379.json give 0 errors. Add a unit test.
2. **core-1** (major): a re-timed 'Tour out' ticket breaks the 168 h recovery rule. Run the check from rules.ts:771 (RECOVERY_KEEP) on the moved ticket, and refuse a move that is undone by a ticket home within 48 h. Verify with bot 11 `--from=hunt/triage/s11-d88.json --on=4 --inv`.
3. **ops-crew-ticket-slip** (major): guardDuty (roster.ts ~1887). Add the mirror of earlyHome: when crew are short only of the rest before a positioning ticket out, rebook a later ticket that still makes the report, instead of taking them off. Add a 30-60 min margin over minimum rest when a ticket is planned right after a night duty.
4. **core-6 + core-i3**: fix the invariants false positive on fdp discretion (judge at the last sector's ATD). Add settle() to compatKit.play/playTo. Add the two money checks (route.unearned, and factored paidToUs ≥ 0).
5. **crew-recgap**: call noteRecovery in reserveStoodBy (crew/index.ts ~330).
6. **Merge the 'goes home early' bursts** (roster.ts:383). Post one message per set and minute, with the names in the body and a plain reason ("Over 100 block hours in 28 days"). In buyBack.ts:67, write the day list as "A, B and C" with no repeated year.
7. **core-4**: the onLoad day plan must be idempotent. Plan when any crew member lacks 'off'. Run repairCutStandby after the load settles.
8. **crew-sethome**: on-station strip home date and day count (tours.ts deploymentSets ~205).
9. **crew-guestfix** (major, M): the re-crew of one seat tries a free member of another set as a GUEST for that duty (check.ts otherTrip ~662).
10. **ops-crew-card-wording** (control.ts placeBlock, reasons.ts rootReason 'busy').

### Lane 2: UI shell, phone layouts and map (ui/shell, ui/game, ui/store.ts, styles/*, ui/map/*, crew screens, LiveryModal, ScreenHint, Scenarios)
1. **ui-space-in-dialog** (major, S): Space does nothing to pause while a dialog is open.
2. **ui-toast-covers-map-controls** (major, S): move the toasts clear of the map control column on the map tab (desktop, iPad and iPhone rules).
3. **visual-globe-marks-corner** (major, S): keep the mark list in a ref, and have mount read it. Add a CSS guard so an unplaced mark is hidden.
4. **Log date column** (3 lenses): `.v8-log { grid-template-columns: max-content 34px minmax(0,1fr) }` and the same for .v8-log2.
5. **Up Next time cut off**: show 'Mon 09:00' or '14 Feb 09:00' with no year (OpsMap depLabel).
6. **ui-iphone-crew-hire-offscreen** (major): keep Hire visible on compact width.
7. **iPhone roster board** (major, M): under `(max-height: 500px)`, put the filters behind a button, hide the legend (it already has a '?'), let the head scroll away, and aim for about 6 rows.
8. **visual-livery-iphone** (major, M): one-row footer, the note behind '?', hide the CARD/MINI previews.
9. **ui-hints-compact**: on compact height the hints fold into '?' straight away.
10. **ui-stale-lapse-toast**: drop a toast for an offer that is no longer open.
11. **ui-settings-misfiled-rows** and **ui-subdialog-no-back**.
12. **ui-speed-tooltip-stale-keys** and **ui-scenario-star-total**.
13. **visual-globe-sel-iphone** and **visual-upnext-phone** (Up Next folded by default on phone landscape).
14. **crew-leaveheat** ('3/24', compared with the engine cap), **crew-layoverlist** (date ranges), **crew-setsper** (one decimal, display only).
15. **visual-parked-stands** (M, tail).

### Lane 3: network (engine/network/*, ui/screens/network/*, LaunchWizard, RouteActions, PositionModal search line)
1. **network-case-wrong-aircraft + network-planner-ideas-cabin** (majors): searchPlan tries the owned types first. caseDraft and firstPlan use the cabin of our own aircraft of that type. decideCase warns, or refuses a type we do not have. Add the layouts to ideasKey.
2. **network-case-owned-aircraft-cost** (major): one cost model. The case costs the fleet's own aircraft of the type (the average of aircraftCostBH(g, id)), falling back to list rent when we own none.
3. **network-studybase-drift** (major): store the base on r.study when the study completes, and have businessCaseX, caseAdvice and cabin read it. Add a ??= repair that computes it once on load.
4. **network-pnl-month-aircraft**: the cost is summed per rotation.
5. **network-denied-boarding-silent**: a route note, plus a same-size preference in coverRotations.
6. **network-lifecycle-dialog-wording + network-life-money-split**: say "Ticket money back" apart from "Cost to us", and fix the plurals and 'an A321'.
7. **network-study-peak-text**: peak taken from the market's season index, and the gauge sentence follows the numbers.
8. **network-stage-done-repeats-rival + network-rival-named**.
9. **visual-network-nodata-red**: a muted dash when months is 0.
10. **ops-search-accents**: one fold helper, used by both searches (networkLogic searchAirports and PositionModal).
11. **network-case-month-sampling**: step through calendar months.
12. **network-case-vs-actual** (M): store caseAt at Go, and draw a ghost line plus a 'vs plan' KPI.
13. **network-idea-carries-pitch** and **network-map-card-local** (tail).

### Lane 4: commercial (engine/contracts/offers.ts, flavor.ts, missions.ts, clients.ts, feasibility.ts, tenders.ts, engine/commercial/*, OfferModal, ContractModal, contractSheetLogic, Contracts.tsx, screenLogic.ts)
1. **comm-broker-pct** (major, S): show brokerCut(o) in the chip and in estRevenue, and add a contract-sheet row.
2. **immersion-lead-client-mismatch** (major): adhoc picks its variant from what the client fits. Also **immersion-diaspora-reason-date**: reasons carry their months.
3. **comm-visit-spam** (major): a visit cooldown or diminishing return, one live lead per client and archetype, one tender per client per round, and meetings on working days.
4. **comm-tour-season** (major): split the resorts into year-round and summer-only, both in tourSeries and in the seasonBase leisure pool.
5. **comm-sports-federation** (major): federations fly internationals, and LEAGUE_CITIES sets the domestic pool.
6. **Wrong season titles** (Half-term, Summer peak).
7. **immersion-yes-prefix-inbox** (sales.ts:568, hurtProse) and possessive() at sales.ts:1001.
8. **comm-frontex-relief**, **comm-troop-aussom**, **comm-rival-own-subcharter**.
9. **comm-margin-label** (M): add a 'Profit after lease and crew' line.
10. **comm-cancel-split** (S).
11. **ui-contract-icons-no-tooltip**, then **comm-active-compact** and **comm-short-header** (Contracts.tsx).
12. **comm-payer-profiles**, **comm-maxseats-wording**, **comm-repat-ties** (tail).

### Lane 5: ops planning, world events and money cards (contracts/schedule.ts, plan.ts, ops/maintenance.ts planA only, ops/world.ts, data/worldEvents.ts, ops/position.ts, ops/perf.ts, ops/commercial.ts, data/carriers.ts, problems/money.ts, finance/glance.ts)
1. **ops-wait-before-maint-away** (major): allow the home hop before a maintenance anchor away from home when the gap is at least AWAY_GAP.
2. **immersion-world-iraq-overlap** (major, S): only one live event per zone.
3. **immersion-event-months + immersion-event-repeats**: add months for hurricanePuj, floodsSindh, calima and windMadeira. Add a per-template cooldown with `w.lastTpl ??= {}` and an 'again' text.
4. **ops-acheck-lead**: the planA ferry lead comes from crewFree.
5. **crew-fakeroutes**: add Air Greenland, try a 2-stop routing before any fake nonstop, and keep RAM to its real routes.
6. **core-3** (factored invoices in the cash cards) and **core-5** ('since 1 Apr' wording).
7. **ops-weekly-hop** (M): wait at the outstation or ferry home, decided on cost.
8. **ops-parking**: parking fees through the ledger, and a line on the Position quote.
9. **ops-ferry-stops** and **ops-position-net-cost** (tail).

### Lane 6: immersion and visual polish (ops/disrupt.ts, ops/events.ts, ops/flights.ts, ops/maintenance.ts startAog only, data/opsData.ts, data/flavor.ts, data/names.ts, Hangar.tsx, theme.css, Schedule.tsx, index.html, ui/theme.ts)
1. **ops-sub-instant**: a sub-charter leg waits for the rival's positioning (SUB_LEAD). The delay is ours, and the chips say so.
2. **immersion-crew-on-board-named**: name the purser and captain in the in-flight cards, and add a closing line after a medical.
3. **ui-hangar-floor-bands**: re-measure on image load, and clip the band to the card.
4. **immersion-unruly-passenger** (scoped to M): an en-route card modelled on medicalCard, on a side-stream band, plus a quiet gate offload variant.
5. **AOG repair time by fault, plus the MEL**: a cause table with hours and cost, and APU and bleed faults move to MEL delays.
6. **immersion-weather-not-seasonal**: weather causes carry their months and a minimum latitude.
7. **immersion-change-request-reasons** and **immersion-single-option-medical**.
8. **immersion-text-polish** ('..', '1 days', possessive in events.ts) and **immersion-authority-missing**.
9. **visual-finance-palette** and **visual-ios-statusbar**.
10. **immersion-seasonal-delays-deicing** and **immersion-name-pools**.
11. **visual-hangar-livery-top** and **visual-schedule-sticky-day** (tail).

### Files shared between lanes (merge notes)
- ops/maintenance.ts: lane 5 changes planA (~481) and lane 6 changes startAog (~728). They are different functions, but lanes 5 and 6 run at the same time, so merge them in order.
- PositionModal: lane 3 changes the search filter and lane 5 changes the Cost row. They run in different rounds.
- Crew screens: lane 2 owns the UI only. Lane 1 does not touch ui/.

## Deferred (next round)
- **crew-oversets** (major, but an L-sized balance change): sizeSets peak*8/6 and grow. It needs a sizing study across bot seeds, and Planning must agree with Utilisation. It is too risky to fit into a 2 h lane alongside the crew legality fixes.
- **crew-awaychain** (M, high): do it after oversets, because the two interact.
- **core-i1**: spread the midnight work (M, high perf value). It changes the event order at 00:00 and needs a test tolerance pass.
- core-i2 (saves to IndexedDB, moved off the main thread) and core-i4 (faster Continue).
- ops-aog-rescue (do it after ops-sub-instant), ops-aog MEL dispatch option as a full gameplay feature, and ops-curfews (each entry must be checked against the AIP first).
- network-pick-tail-in-case (lane 3 item 1 fixes the root), comm-tender-mgh.
- immersion-milestones, immersion-passenger-letters.
- ui-route-dialog-actions, ui-whatsnew-fold-old, ui-glossary-search, ui-onboarding-first-run, ui-counter-reply-wording, ui-leave-month-targets.

## Dropped
- core-i5 (the bot's step grid gives different ids): a tooling gap with no player impact. Note it in the bot docs only.
