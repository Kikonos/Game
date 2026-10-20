## B2 Crew & HR
I finished the B2 Crew & HR section. Most of the engine was already in place from the interrupted attempt, so this session went on speed, the missing tests and checking it in the running app. `npx tsc --noEmit` is clean, all 62 crew tests pass, and `npx vite build` succeeds. The full `npx vitest run` still has 4 failures, all in B1's contracts tests (`offers.test.ts`, `schedule.test.ts`). B1 was editing those files while I worked; I re-ran them with my settle change switched off and they failed the same way.

**What I implemented**
- **Auto-roster speed** (`roster.ts`, `timeline.ts`): a month of flights with 4 aircraft and 120 crew now takes 18–40 ms in vitest under full-suite load (it was 90–170 ms), and about 32 ms on a cold first run outside it. Only the order of work changed:
  - the score that doesn't depend on the slot is computed once per pairing;
  - crew who are busy or still resting at the duty are skipped before the full legality check;
  - a crew member refused for one slot is not checked again for the next;
  - candidates are sorted once per pairing, with numeric tie-breaks.
- **New flights get crew straight away** (`index.ts`, `timeline.ts`): flights added outside an accept (dev demo flights, B3 ferries) used to stay uncrewed until the midnight roster. Crew's settle step now spots scheduled flights within the roster horizon that no duty holds and rosters them (or only plans them if the auto-roster policy is off). Flights it can't place are not retried on every change. I also deleted the leftover debug test `zz_dbg.test.ts`.

**Tests added**
- `crew/hr.test.ts` (13 new tests):
  - hiring: the quoted date is kept, the cost is charged once, crew go from joining to available, bad requests are refused;
  - training: type rating, command upgrade (4,000 h gate), SCCM course, and the trainee's duties are refilled;
  - crew availability: covered vs short, other contracts holding crew, hires counting only from their ready date; staffing at 5 sets per aircraft;
  - costs: per diem, hotels and salaries with on-costs;
  - `checkAssignment`: rating, status and overlap problems;
  - removing a crew member for sickness; the crew-shortage message and pause; the sick-crew decision for B3.
- `roster.test.ts`: the speed test is now best of 4 fresh games with a 50 ms limit, plus a check that every run gives the same roster; new test for flights added outside an accept. The 36 existing FTL tests already cover the edge cases you listed.

**Acceptance criteria:** all are met and each has a test:
- the max FDP tables;
- full, legal coverage with demo flights and 60 crew;
- the HAM–PMI base at 2 and 3 waves;
- duties following a retimed flight;
- augmentation for a 12 h sector;
- deadheads and their costs;
- the 4 h delay reroster;
- 2 hired FOs joining on time.

In the app on port 5602 (1180×750, touch), demo flights got crew without waiting for midnight. After 8 s at 4× there were 28 pairings, no uncrewed flights, crew on duty and resting, and no console errors. A 30-day headless run flew all 240 flights with crew, in 240 ms.

**Requests to other builders**
- **B5:** the Crew screen is still the placeholder. The data it needs (staffing, rolling limits, roster, days off, hiring, training) is ready.
- **B3:** you no longer need to call `autoRoster` after adding ferry flights. The `sickCrew` decision carries `{crewId, flightId}`.

**Known gaps (simplifications from DESIGN)**
- Days off are shown but not enforced beyond the 6-on/2-off blocks and the recovery rule.
- Planned FDP extensions are not used.
- Cabin crew use the pilots' report time.
- The "two local nights" recovery rule is approximated as two 22:00–06:00 windows in base time.

I didn't edit any shared files. My changes are in `/home/user/wt/acmi/src/engine/crew/`: `roster.ts`, `timeline.ts`, `index.ts`, `roster.test.ts` and the new `hr.test.ts`.

## B1 Contracts & commercial
B1 (Contracts & commercial) is complete. tsc, vitest (134 tests) and vite build all pass in /home/user/wt/acmi. The offer review screen isn't built yet (B5's OfferModal is still a stub), so the feasibility wording has not been seen in the app. In the browser the engine ran 30 game days in 46 ms with no console errors.

**What I implemented** (on top of the interrupted attempt in `src/engine/contracts/*`):
- **Offer variety:** clients now match the job (pilgrimage, diaspora and cruise-crew agencies only get their own work). Music tours stay in Europe (no US domestic legs). League away games stay in the club's country and cup ties go abroad. Season-base destination lists have one airport per city. AOG cover starts between 05:00 and 22:00 local. A client never has two open requests of the same kind.
- **Offer flow:** offers fitted to an idle window now respect each job type's lead time and the room left in the window; season length, return days and rotation count shrink to fit. At most two widebody "ladder" offers are open at once. Everyday offers must be flyable without ETOPS on a type we operate. Offer gaps are steadier, the rate is 3.7 per week, and expiry times are a little longer.
- **Feasibility:** the maintenance check now explains itself: C-check inside the job is a no; an A-check is "booked", "fits a maintenance night at HAM", "fits between trips", "due before the job starts" or "due in the middle of the job". Fuel-stop labels name the stop and the sector length.
- **Airports** (my `EXTRA_B1` section): 32 diversion and fuel-stop fields in Central Asia, Iran, the Sahara, the Sahel and the Gulf of Guinea. Without them KBL→LIS and most African jobs needed ETOPS, so the KBL→LIS acceptance test failed.
- **Clients** (`CLIENT_SEEDS_B1`): 7 new ones (marine crewing, choir, group-travel, events and media).

**Tests added:** `offers.test.ts` (22), `feasibility.test.ts` (11), `billing.test.ts` (9), plus my read APIs added to `core/plumbing.test.ts`.

**Acceptance criteria:** all met except offer counts on some seeds.
- Over 10 seeds, 30 days gave 13–26 offers (one seed at 26, over the 25 target) and 65–94% fit the A320s (one seed at 65%, under 70%). The average is 18 offers and 86% fit.
- Every one of those seeds had a season base and an urgent offer within 60 days. About half of offers fit a real idle window.
- The HAM base, KBL repatriation (fuel stop and 2-leg positioning in), DIL runway, billing math, charter money timing and cancel penalty all pass their tests.

**Edits outside my files** (small fixes, please confirm):
- `core/perf.ts` planSector: fuel stops are picked from size ≥ 2 airports first, falling back to small strips. Without this, routes stopped at places like Sabha or Kufra.
- `core/core.test.ts`: the 32-day rollover test now passes an empty pause set; the urgent opening offer (and B3's month-end pause) stopped the clock otherwise.

**Requests to other builders:**
- Architect: add time zones in `data/timezones.ts` for MR, NE, TD, BF, CM, GA, GQ, LR, SL, GN, GM, TG, UZ, TM, TJ and IR. These new airports currently fall back to UTC, which only shows if one is a fuel stop.
- B5: memoise `feasibilityAll` (about 0.4 ms per report). The `hook` field on each offer has a one-line "fits CS-xxx" reason for the offer card.

**Known gaps:**
- The crew check uses a simple 13 h duty cutoff for augmentation, not B2's `maxFdp`.
- Fuel-stop choice ignores ETOPS, so a few routes (JUB, GOM) still need ETOPS 120 on the A320.

## B4 Live map
B4 (Live map) is finished and works in the running app at 1180×750 and 1180×820 with touch. `npx tsc --noEmit`, `npx vitest run` (146 tests) and `npx vite build` all pass. Headless Chromium showed no console errors. Map-layer frame cost with 10 aircraft at 4× averaged 0.23–0.36 ms per frame. The worst single frame was 4.2 ms: it came once, right after the dev fleet and demo flights were added, and steady frames stayed under 1 ms.

**What I implemented**
- **`WorldMap.tsx`**: new props only, and `Title` still works unchanged:
  - `onTap` lets the ops map pick aircraft and pins before airports.
  - `fitFn` means the map re-fits only on first load and on Reset, never when data changes.
  - `focus` pans any selection out from under the panel.
  - `memo` keeps the view when you switch tabs.
  - `underlay` draws layers below the airports.
- **`LiveLayers.tsx`**, the moving parts, in one loop capped at 30 fps on touch, with no React render per frame and frozen while a modal is open:
  - **Aircraft**: livery colour, nose follows the great circle, parked aircraft sit in rows next to the airport and ease between stand and runway.
  - **Aircraft states**: hangar outline and wrench badge in maintenance, red ring for AOG; tap areas are 44 px. Registrations show at 2× the fitted zoom, and are hidden when several aircraft crowd one airport.
  - **Terminator**: the night shading is recomputed from the sun's position as game time moves, so it glides.
  - **Arcs**: for the selected aircraft, the current leg is solid, the next 3 are faint and positioning/ferry legs are dashed, in contract colours.
  - **Offer pins**: amber diamonds with a static ring when urgent and a count when several share an airport.
- **`MapPanels.tsx`**: aircraft, airport and offer panels with the content BUILD-PLAN lists, all wrapped so stub APIs never crash the map.
- **`OpsMap.tsx`**: puts it together, plus the fleet strip (one scrolling row) and the "up next" card.
- **`mapLogic.ts`** holds the pure logic; the hub pulse and selection pop are turned off on this map, and the dead network-map rules are deleted from `touch/map.css`.

**Tests added**: `src/ui/map/mapLogic.test.ts`, 11 tests. They cover the sun position, the terminator and the night side, parked stand spacing, heading and tap picking. One test checks that a plane lands exactly at its destination at arrival and stays there after parking. Others cover selected legs, fleet chips, up next, and offer pins and fit.

**Acceptance criteria**
- **Smooth flight**: steps of at most 4.5 px per frame at 4×.
- **Arrival**: the plane is 0.2 px from the airport dot at its arrival time, then taxis 0 → 24 px to its stand with no snap.
- **Terminator** moves with time.
- **Taps**: aircraft, airport and offer taps open the right panel.
- **Panel reveal**: selecting IST pans it to x = 748, left of the panel at 804.
- **Calm and layout**: only planes and the terminator move, nothing overflows horizontally, and no button is under 40 px.
- Not done: I measured frame cost with an in-app timer (`window.__contrailMap`) in headless Chromium, not in the Chrome performance panel, and nothing was run on an iPad.

**Requests for B5**
- Support `navigate('fleet', {sel: aircraft, view: 'check'})` so "Plan check" opens check planning.
- Have Schedule scroll to `nav.sel` when it is an aircraft.

**Known gaps**
- The maintenance section shows only hours and cycles until B3's real `checkStatus` lands (the stub returns zeros).
- There is no soft twilight band; the terminator is a single 0.28 fill.
- During a pinch, pins and airports resize in 120 ms steps (the existing WorldMap behaviour); aircraft scale smoothly.

Scripts are in `/tmp/claude-0/-home-user-Game/a5d5d912-4f57-50de-a5cc-db854aad1b29/scratchpad/acmi/` (`b4-shots.cjs`, `b4-shots2.cjs`), screenshots in its `b4/` folder.

