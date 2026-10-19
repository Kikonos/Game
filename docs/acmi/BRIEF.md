# CONTRAIL — ACMI & Charter: design brief (plan of record)

This is the creative director's brief for the ACMI version of the game. RESEARCH.md (same folder) has the industry facts and numbers. DESIGN.md (to be written) turns this brief into the technical design. Where they disagree, this brief wins on direction and RESEARCH.md wins on facts.

## Who it's for
The player is a former ACMI flight attendant (euroAtlantic: 767-300ER/777-200ER; Getjet/Airhub). They want to recognise their world: block hours, MGH, positioning, layovers, crew going out of hours, AOG at an outstation, governments that pay late, Hajj, repatriation flights. They play on an **iPad (A16) in landscape only**: 1180×820 as a home-screen app, ~1180×750 in Safari, touch input.

## Pillars
1. **The map is the game.** The main screen is a calm, full-bleed world map. Every aircraft is drawn where it really is: it moves along its great-circle route in real time between its actual departure and arrival times, is parked at its airport between flights, and sits in a hangar for checks. A day/night terminator slides across the map. Tap an aircraft to see its duty, crew on board, ETA and next legs. Contract offers appear as pins.
2. **Slow, deliberate pace with a heartbeat.** Speeds are 1×, 2× and 4× only, plus pause. Defaults: 1× = 1 game day per 60 s (1 game hour = 2.5 s), 2× = 30 s per day, 4× = 15 s per day. Important decisions auto-pause (setting). Nothing flickers. Numbers update calmly, there's no scrolling ticker, and toasts are rare and quiet. You wait for achievements while you're busy planning, hiring, rostering and negotiating.
3. **Small fleet, big decisions.** You start with 2 aircraft and rarely have more than 6–10. Every aircraft, crew set and contract matters. Aircraft are scarce: the market offers a few aircraft now and then, with long lead times. You mostly sweat the assets you have.
4. **You run every department.** You are the CEO, but you also act as commercial (contracts, quotes, sub-charter), flight scheduling (which aircraft does what), crew scheduling and rostering (who flies, legality), HR (hiring, training, morale) and technical (maintenance planning). Automation helps through policies and department heads (later), so routine work runs itself and exceptions reach you.
5. **Real work, real weight.** Contract types: airline ACMI (season base deployments), AOG cover, ad hoc charters, tour-operator series, sports/music, VIP and presidential, government repatriation and evacuation, humanitarian and refugee airlifts, UN and military troop rotations, medical, deportation and prisoner flights (well paid but they hurt the "clean" reputation and crew morale), and Hajj. Lengths run from ad hoc to 1 month to multi-year. Urgent jobs pay a premium.
6. **A ladder to climb.** Narrowbody start (A320ceo/737-800). Then the first widebody (767-300ER or A330), ETOPS 120 → 180, long haul with augmented crews, 777s, and finally ultra-long-haul (A350-900ULR / 777-200LR) and prestige work. Goals are fewer and bigger, and each one feels earned.

## Core loop
1. **Offers arrive** from brokers and clients over time, with an expiry countdown. Each has a type, client, route/base, dates, aircraft requirements (seats/config, range, ETOPS, runway), crew requirements, product (wet lease per block hour with MGH, full charter at a fixed price, or dry lease out) and payment terms.
2. **Assess & quote.** The planner checks feasibility for each of your aircraft:
   - whether it can get there in time (positioning);
   - range, tech stops and runway fit;
   - approvals (ETOPS etc.);
   - maintenance due inside the window;
   - whether legal crew is available or can be positioned.

   You can accept at the asking price or counter, and rivals may win.
3. **Schedule.** Accepting generates the flights on the chosen aircraft's timeline: positioning legs, revenue legs and returns. Conflicts are shown clearly.
4. **Crew it.** The auto-roster assigns named crew members per duty (pairing), following simplified EASA FTL. It adds augmented crews for long duties and positions crew by deadheading. Each crew member has role, type rating, home base, location, duty and flight-hour bars, rest status and morale. You can review and override; illegal assignments are flagged red.
5. **Fly it.** Watch the flights on the map. Things happen: delays, sick crew, crew running out of hours, AOG, permits, weather, client changes, late payments. Each brings a short, clear decision.
6. **Get paid & grow.** Month-end statements arrive, with block-hour billing against MGH and receivables. You hire, train and lease the next aircraft, and unlock approvals.
7. **If you can't do a job** (AOG, conflict, no crew), **sub-charter** it to a rival ACMI operator at their price and keep the margin or eat the loss. You can also cancel and pay the penalty plus a reputation hit.

## Must-haves for the first ACMI release (v0.5)
- **New game setup:**
  - name, code and livery (reuse the existing brand UI);
  - home base from about 5 European ACMI-style bases (Lisbon default; also Vilnius, Malta, Madrid, Riga);
  - scenario "Startup" (2× A320ceo: one owned and older, one dry-leased in), with starting cash and a small crew already hired to cover 2 aircraft at about 5 crew sets each (fewer is risky).
- **Time model in minutes**, deterministic, event-driven between ticks; speeds 1/2/4×; pause.
- **Contracts**, at least these archetypes, all with fictional clients:
  - airline summer ACMI base deployment (1–3 months, MGH);
  - AOG cover (2–10 days at the client's base);
  - ad hoc charter (one-off or round trip, fixed price, we pay fuel);
  - sports team charter;
  - government repatriation (urgent premium);
  - tour-operator weekly series (weeks);
  - military/UN troop rotation (series, long-term; can come later in v0.5 if time allows).
- **Feasibility check + aircraft selection** when accepting; flight generation including positioning; and contract completion and billing.
- **Real-time map:** moving aircraft, routes, airports, day/night terminator, aircraft panel, offer pins.
- **Schedule tab:**
  - one row per aircraft, scrolling over days and weeks;
  - blocks for flights (coloured by contract), positioning, maintenance and idle time;
  - tap a block to see details;
  - a "today" line.
- **Crew:**
  - named individuals (captains, first officers, pursers/CSD, cabin crew) with type ratings and home base;
  - simplified FTL legality (max FDP by sectors/report time, augmented crews, min rest 12 h at home / 10 h away, cumulative 60h/7d, 190h/28d duty, 100h/28d flight, 900h/yr);
  - auto-roster on contract acceptance plus rolling re-plan;
  - roster view per crew member;
  - hire with a lead time (weeks) and type rating training time and cost;
  - crew per diem and hotel costs while away.
- **Maintenance:**
  - A-check (FH/days interval, ~1 day, at base or a line station) and C-check (months interval, ~3 weeks, must be planned);
  - checks block the aircraft on the schedule;
  - small AOG risk that grows with deferred maintenance.
- **Finance:** block-hour billing (MGH guarantee), charter prices, fuel only on charters/ferries, rent, salaries, per diems, hotels, deadhead tickets, maintenance reserve, insurance, overhead; monthly statement; cash; payment terms (governments pay late).
- **Inbox** with decisions; a few events (delay, sick crew, crew out of hours, AOG, late payment, urgent evacuation offer).
- **A handful of goals**, e.g. first contract, first $1M month, 3 aircraft, first widebody, ETOPS 180, first long-haul with augmented crew, first ULR.
- **Calm, readable UI** for iPad landscape, reusing the existing touch shell, the labelled speed control (only 1×/2×/4× now) and the aircraft art.
- **Saves** under a new key, with versioning and migration.

## Later releases (roadmap)
- **v0.6 — People:**
  - roster board with manual swaps;
  - recurrent training and expiry;
  - morale and attrition (rotation length, days off, per diem and hotel policies);
  - mission morale (evacuation pride vs deportation unease);
  - expat vs local crews;
  - department heads with skill levels;
  - standby crew.
- **v0.7 — Market & ladder:**
  - scarce aircraft market (dry-lease in, buy used, rare new slots), lease returns, cabin reconfiguration (all-Y / 2-class / VIP; weeks and $);
  - approvals tree (ETOPS 120/180/240, widebody ops, long-haul augmented, ULR/FRMS, government vetting, IOSA, second AOC);
  - sub-charter market of rival operators with personalities;
  - more archetypes: Hajj (with its drifting dates), UN multi-year, VIP/presidential, deportation (moral choice), war-zone evacuation with war-risk insurance, medical, music tours, Antarctica;
  - market cycles.
- **v0.8 — Polish:** balance, scenarios ("Lisbon 2019: 2× 767 + 2× 777"), achievements, sound, tutorial hints.

## Non-goals
- No passenger demand or ticket pricing simulation.
- No route networks of our own; the clients own the routes.
- No 10× speed.
- No hundreds of aircraft.

## Reuse from the current codebase
- Airports (add missing charter/mission airports as needed, e.g. KBL, DIL, JED/MED, UN mission airports, plus runway lengths).
- Aircraft catalog and the new aircraft art.
- d3-geo WorldMap (pan/zoom/pinch already built).
- iPad touch shell and tokens, lz-string saves, PWA, release process (play/ on main).
- The old airline game stays playable at `/Game/classic/`.
