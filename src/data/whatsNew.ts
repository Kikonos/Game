// "What's new": one entry per released version, newest first. The Title screen shows, once, every entry newer than
// the last one seen (settings.seenWhatsNew; a player skipping a version sees both); Settings → What's new shows them
// all. Plain words for the player, not for us.

export interface WhatsNewEntry {
  /** As shown: 'v0.7.0'. */
  version: string;
  name: string;
  /** New features, player words. */
  features: string[];
  /** Fixes and smaller improvements since the previous entry (hotfixes included). */
  improvements: string[];
  /** v0.8 fix pack: fixes from the players' reports, in a part of their own. */
  fixes?: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: 'v0.23.2',
    name: 'Hotfix: stuck ferries',
    features: [],
    improvements: [
      'An aircraft that is late for a job now ferries there as soon as its crew can fly, and waits there. Before, it left as late as the next flight still standing allowed.',
      'A flight is no longer pushed days late behind a ferry that does not lead to it. It keeps its time; if the aircraft is still away then, it is cancelled.',
    ],
    fixes: [
      'An aircraft on a long ferry could sit at a stop for days while its flights were cancelled one by one (9H-VZH at Quito). Each new plan put the ferry two days later, though its crew were there.',
      'The next day of a ferry now waits for the crew\'s rest. Planned straight on, the crew came off and the aircraft waited for another.',
      'A ferry day no longer lands in a night curfew.',
      '"Flight moved: aircraft not there" named a flight the aircraft could not fly as the one bringing it in.',
      'Once, when you load your game: an aircraft stuck like this gets its ferry planned again to leave as soon as its crew can fly it.',
      'The compensation you paid for flights cancelled while it sat there is given back, with the client\'s trust. One Inbox message says how much.',
      'Flights it still cannot reach are taken off at no charge. Flights pushed late, some to the middle of the night, go back to their own times.',
    ],
  },
  {
    version: 'v0.23.1',
    name: 'Planner step two, stacked work, later report times, tidy bug reports, Network screen',
    features: [
      'Cabin crew already on three types now go into the plan. Each gives one type up when the course ends: by default one with no aircraft, one being phased out, or the one they fly least.',
      'The class\'s people list says which type each gives up ("drops A320"). Tap it to pick another. Their trips on that type after the class go to other crew, tried on a copy of the roster first.',
      'Select people on the Crew screen and tap Plan classes: the planner opens with exactly them.',
      'A long phase-out goes in instalments. Classes more than 120 days ahead show as Next, with the day you can book them. The Inbox tells you when that day comes.',
      'New choice when a crew member is a little out of hours: Log a later report time. The roster shows them checking in later, so a short rest or a long day reads as legal.',
      'Only for a short rest or a long day, by at most an hour, once per duty. It costs crew morale, most for the person it covers. Twice in 28 days and they refuse.',
      'It can come out later: a crew member reports it, or the authority\'s audit finds it. That means a fine and an audit finding.',
      'Fixed bug reports clear themselves. When the game opens after an update, the reports it fixed are deleted. A short note says how many; Bug reports › Cleared says what each fix was.',
      'Every crew alarm in Bug reports now keeps the game at that minute, not only the newest 12. Each keeps just what changed since the one before, so they take little room.',
      'Network has its own screen on the left, between Contracts and Schedule.',
      'Change a route\'s cabin while it flies: Sales › Cabin, business and economy or economy only. First you see seats, passengers, load, ticket revenue a passenger and the profit, a flight, a week or a month.',
      'Going economy only moves people booked in business to economy now, with part of their fare back. Before, it happened on the day, with a voucher too.',
      'A finished market study and a route going on sale now pop up and pause the game. Settings › Pause for network news turns the pause off.',
    ],
    improvements: [
      'The planner works out its proposals faster and the screen stays live while it does. Going back to a choice you had is instant.',
      'Pilots booked to leave a type after one of its aircraft goes no longer make Crew › Planning or the crew desk ask you to hire replacements.',
      'An offer that is short of crew now says when new hires would join: in time for its first short day, or too late.',
      'The hiring hold only holds when crew have nothing on their roster. Crew on tours and trips who fly few hours no longer stop the round-up while flights go short.',
      'Finance: "Where the money went" is now Expenses and "Where the money came from" is Income. Both list the biggest first.',
      'Every "?" opens its box whole on the screen: under it, or above or beside it when there is no room.',
      'The cabin comparison now shows the refunds paid at once, the first 12 months with them, and your cash after.',
      'A rival flying a route flight for you is now paid at hand-over but counted in the month it flies.',
      'Cancel a route flight a rival was to fly and you get its price back, less a fee. The less notice, the bigger the fee.',
    ],
    fixes: [
      'A short delay on a day that began with a flight out could take the whole crew off a legal day. Their flight home now moves to after the longer rest instead.',
      'Crew waiting at a station for their flight out to their tour can fly a trip in between and go back there for it.',
      'A seat emptied halfway through a duty (a sick call) is no longer filled by someone at another airport.',
      'The crew alarm check in Bug reports now counts a flight home still to come from a finished trip, and its rest.',
      'Crew are no longer called busy for a duty of another trip that fits between their flight out and their own first duty.',
      'A seat you gave someone is no longer flagged for a crew plan rule that is only a planning choice.',
      'A short rest before someone\'s next trip is now that trip\'s alarm, not the flight before it.',
      'Before a flight out to work away from base, crew need 10 hours of rest, not 12.',
      'When a late landing leaves a crew a few minutes short of rest before the next day of their trip, that flight now waits for them (up to an hour) instead of the whole crew coming off.',
      'The Crew "?" tip opened off the left edge of the screen, and the Up next "?" was cut off by its panel.',
      'The map could break into squares with question marks after zooming out on an iPad. It now draws any square that fails again, and uses far less memory doing it.',
      'A short delay could move a crew member\'s flight home earlier, into their rest, and take them off a legal flight. The flight home now waits for the rest.',
      'A later report time no longer shortens the rest of the others on that duty.',
      'Log a later report time now shows each person\'s morale cost when one of them is asked again.',
      'Economy only on an aircraft with business seats now uses every seat. No one is bumped at the gate.',
      'Flights a rival flies for you keep their cabin when you change the route\'s. Their passengers get no refund.',
      'Lisbon–Bissau and routes like it: departures still selling business after the timetable went economy only now sell economy only.',
      'The fixed bug reports note now shows once your game is open, not under What\'s New.',
      'Crew alarms from the old version are kept until you export them.',
      'The study pop-up now writes big numbers with commas (1,445).',
    ],
  },
  {
    version: 'v0.23',
    name: 'Crew person by person, and a class planner',
    features: [
      'Every crew member now has their own roster. Whoever is legal, rested and free on the day takes an open seat, even one flight in the middle of another crew set\'s stay, and then goes back to their own flights.',
      'Crew sets still stay together where they can. A set is no longer a lock: a seat stays empty only when nobody at all can legally fly that day.',
      'Plan classes: each type on Crew › Planning has a "Plan classes" button. Pick cabin crew or pilots and a finish date. The game proposes the classes: when each runs and who is in it.',
      'One slider goes from fewer, bigger classes to least roster disruption. You see people trained, duties that go to others, the finish date and the cost. Book it all in one tap.',
      'The planner works around leave and the published roster. It tries the plan on a copy of the roster first, so every flight stays crewed.',
      'Tap a class to see its people. Move someone to another class or take them out.',
      'Phasing out a type: pilots leave the old type only when its aircraft can spare them. The planner paces the classes by aircraft leaving and arriving.',
      'Cabin crew can give up a type rating, which frees one of their three places. One person: Train › Remove a type. Many: Select on the Crew screen, then Remove rating. You see who loses which type, and a warning if it leaves the type short.',
    ],
    improvements: [
      'Far fewer "no crew" alarms, and the ones left are real: about a quarter as many in our test games, and a sixth of the red ones.',
      'Someone helping another set shows "Covering" on that flight. On their own roster it is simply their duty.',
      'Crew waiting at a station for their next job go back there after helping elsewhere, not home to base first.',
      'The crew alarm check behind Bug reports now also reads days off, the weekly rest and rest after time-zone trips.',
      'Aircraft spec sheet: every tile has its figures in the middle of its square. Engine makers and the crew rest class sit under the main line, so no tile towers over the rest.',
      'Booked classes count as crew for their new type, so Crew › Planning and the crew desk no longer ask you to hire the people already in training.',
    ],
    fixes: [
      'XY3120 at Riyadh had no cabin crew while four rested cabin crew sat in Riyadh, and the card said one of them was "in Lisbon". They fly it now and stay in Riyadh.',
      'XY3102 was short of a purser because the seat also covered a flight three days later. Each flight now gets whoever is free for it.',
      'Flights that error left short are crewed when you load your game.',
      'A flight moved to an earlier time could leave without its crew ever reporting, and one of them was then ticketed from the wrong city.',
      'The busy-months forecast counted the days of a class twice, so a big class made a month look shorter of crew than it was.',
    ],
  },
  {
    version: 'v0.22.1',
    name: 'Crew alarms you can check',
    features: [
      'Every crew alarm is now kept, quietly, in Menu › Bug reports under "Crew alarms", with the game as it stood at that minute. Export sends them along, so each one can be checked afterwards: was the alarm right?',
      'A ferry flight with no pilots simply waits. The game moves it to the first time pilots can be there and tells you in the Inbox: no alarm, no pause, no penalty. It is a problem only when the aircraft would miss its next job or a check; the card then names it.',
    ],
    improvements: [
      'Finance: approvals and audits have their own slice, and so have bank fees and interest. War-risk cover sits with the insurance.',
      'Bug reports: your own reports stay on top; the crew alarms are folded into one line under them.',
    ],
    fixes: [
      'Crew staying at a station can fly another flight from there between their own duties and go back after it. Before, the game called them busy for their whole stay and raised "no crew" alarms with crew sitting right there (CVE166 at Jeddah).',
      'A flight that error left without crew is crewed when you load your game.',
      'If that error cost you money in the game you load, you get it back once: sub-charter costs and compensation, with the reliability and the client\'s relation. Look for "Refund: crew planning error" in the Inbox and in Finance.',
      'After annual leave nobody is flown out days early to a tour that has not begun, only to fly home again the same day (Pedro Sousa: Lisbon to New York and back).',
      'A dangerous goods application no longer shows under Office & sales.',
    ],
  },
  {
    version: 'v0.22',
    name: 'Cleaner screens',
    features: [
      'Explanations now sit behind a small "?". Tap it to read, tap anywhere to close. The screens keep the facts, the numbers and the warnings.',
      'Long contracts keep their month letters: the duration strip shows one row a year, January under January.',
    ],
    improvements: [
      'Tidier screens all over: Settings, Schedule, Crew, Company, Contracts, the aircraft market, Fleet, Finance, Inbox and Network lost their long notes.',
      'Words with a glossary entry, such as Deposit, Credit check, Slots or sub-charter, open their meaning on tap.',
      'Contract cards show the whole title, and the Crew screen keeps its head count on one line.',
      'Route launch: the list of stages stays in view while you scroll the plan.',
      'Phone held upright: no button hides under the bug button any more.',
      'On a phone, a "?" note keeps clear of the camera island and the home bar, and opens beside its "?" when it is long.',
    ],
    fixes: [
      'Finance › The bank: below zero the Credit line row now shows the secured line the bank really offers, not the bigger normal one.',
      'The network planner is earned the moment your first study is done, not a day later.',
      'Build your own route: a fuel stop the aircraft does not need is shown as its own choice beside Nonstop and Stopover.',
    ],
  },
  {
    version: 'v0.21',
    name: 'Stopovers and route advice',
    features: [
      'Real stopovers. In Build your own route, a stop can now sell seats: some passengers get off there, others get on, others stay on to the end. Three markets share one aircraft.',
      'Fuel stop only and Stopover are shown side by side, with the year\'s result, the pros and the cons. A long flight that has to land for fuel anyway can be turned into a stopover to see if it pays. There are good combinations and bad ones.',
      'Selling seats between the stop and the far end needs fifth-freedom rights. They are asked for with the permits and are often refused or capped; inside the EU they are free, and a domestic leg in another country can never be sold.',
      'Is it worth it? Every business case now opens with a clear answer (Worth it, Marginal or Not worth it) and the two or three reasons behind it.',
      'New pictures in the business case: where the money goes from revenue down to the result, how full the flights are against the load they need to break even, the margin on a scale from Loss to Strong, and for a stopover who sits on which leg.',
      'Your commercial analyst is back on routes: suggestions on how often to fly, fares, the campaign, the aircraft and the cabin, each with what it earns and an Apply button.',
      'A new hire: the network planner, earned by your first finished market study (Company › Team). The planner narrows a study\'s range, says whether a route is better nonstop, with a fuel stop or with a stopover, and lists routes worth a study in Network.',
      'Network › Studies: every market study in one place, under way, waiting for you, shelved, launched or run out. A market with a study that is still good shows "Show study" and "Valid until" instead of selling you a new one.',
    ],
    improvements: [
      'Small "?" marks answer the questions in the launch dialog on tap: the weak, likely and strong year, what the campaign levels do, what "stays at the destination" means for the aircraft and the crew, where the money goes and whether a margin is normal. Nothing extra stays on screen.',
      '"Nights at …" is now "Stays at …": the aircraft and its crew wait there and fly back together.',
      'Margins checked against real airlines. A strong route with the right size of aircraft keeps about 10 to 20 %; a full flight to Luanda or north-east Brazil now pays a healthy margin; a crowded route or an aircraft too big for it loses money. For a partner the margin is shown on our own fee, not on the fuel and airport costs it repays.',
      'The business case now counts a year\'s bad days (delays, a sub-charter, a rival\'s fare cut), crew hotel nights and a third pilot on a long day, so it promises less and matches what the route then earns.',
      'Long-haul fares on routes you build yourself are more realistic: a far city nobody flies to nonstop is no longer a gold mine.',
    ],
    fixes: [
      'A shelved study can be found again and reopened for free until it runs out: Maputo no longer offers a second paid study.',
      'The load factor of a route with a stop counts passengers on every leg they sit on.',
    ],
  },
  {
    version: 'v0.20.1',
    name: 'Measures, leads & durations',
    features: [
      'Crew › Utilisation has a new card, Measures in place: who is on unpaid leave, furlough or under notice, by rank and aircraft, until when, and how much it saves a month. Tap a row for the names.',
      'Leads and tenders now look different. A tender is a contest: an "Open tender" tag, how many other operators are bidding, when bids close and when the airline decides.',
      'A lead is yours alone: an "Exclusive" tag, who found it (a sales manager, or a broker with its commission), its stage, and the days until it goes cold (amber at 3 or fewer).',
      'Offers and contracts that came from one carry a small "From tender" or "From lead" tag.',
      'See how long a job runs at a glance: the offer and tender dialogs show the months ahead with the job filled in, each year named, and its length in days and in months with the dates.',
      'Explanations sit behind a small "?" you can tap, instead of staying on the screen.',
    ],
    improvements: [
      'Finance › The bank is tidier: one aligned list with a plain line under each name, the number on the right and details on tap.',
      'Unpaid leave is not offered twice to the same crew before it starts, and crew about to go on it no longer count as spare.',
    ],
    fixes: [
      'The offer dialog only suggests a sub-lease when it really makes room for the job. When something else still blocks the aircraft (other work, a lease, an approval), it says so plainly.',
      'The sub-lease dialog warns you before you pay for a hand-over that will not make room on its own.',
    ],
  },
  {
    version: 'v0.20',
    name: 'Finance at a glance',
    features: [
      'Finance now opens with the month in one line: "You made" in green or "You lost" in red, what you earned and spent, and what it would have been without one-off costs like a lease return. Beside it: your cash today and where it is heading.',
      'Pick any of the last six months, or this month so far, with the row of months on top.',
      'Where the money went and where it came from: two rings in plain groups (crew pay, crew travel and hotels, aircraft rent, maintenance, fuel and airports, office and sales, one-offs; ACMI, charters, routes, leases). Tap a slice or a row to see what is in it, what it means and how it compares with the month before.',
      'Each block hour: what one hour of flying earns and what it costs, group by group, so you can see at once if an hour pays for itself.',
      'The three biggest changes on the month before, as small up and down chips.',
      'Tips from your numbers in plain words, for example when crew pay is a large share of what you earn, with a button to the right place (Crew › Utilisation).',
      'The cash line: the last 12 months and the next 90 days on one line, with the zero line, today, and the big one-offs marked. A new chart shows the profit of each month.',
    ],
    improvements: [],
  },
  {
    version: 'v0.19.5',
    name: 'Empty legs',
    features: [],
    improvements: [
      "Saves show your airline's name instead of Slot 1.",
    ],
    fixes: [
      'An empty leg needs pilots only. With no passengers on board there are no cabin crew seats to fill, so an empty leg never shows "Crew missing" for a purser or cabin crew.',
      'An empty leg from away into a charter is flown by its pilots. The cabin crew go straight to where the passengers board, on a ticket, or ride along on the empty leg when they are already there. Before, the whole cabin was flown out to Bangkok two days early to sit in an empty aircraft for 12 hours, and few were free for so many days.',
      'Crew rated on two aircraft types are kept for the type that needs them: an A320 trip takes crew rated on the A320 alone first, so the A330 still has pursers.',
      'Eight days before a flight you can already ask someone to work a day off (in Crew Control), not only in the last 72 hours. A flight short of crew is no longer left with only Cancel or Sub-charter while someone is free apart from a day off.',
      'The range circles on the spec sheets are a globe again, zoomed to the range: the whole range fits inside the circle around the city, with crisp land and no blank band.',
    ],
  },
  {
    version: 'v0.19.4',
    name: 'Widebody tenders',
    features: [
      'Widebody tenders: once you hold Widebody operations and have a widebody (flying, delivering or bought), airlines send widebody requests too. Hajj airlifts from Saudia, flynas, Garuda, Biman, PIA and Air Algérie (the dates follow the Hajj calendar and cannot move), Ramadan Umrah lift, summer long-haul cover for Condor, Air Transat, TUI, Corsair and Air Europa, and winter sun cover for Edelweiss, Air Caraïbes, French bee, Air Tahiti Nui and Aircalin. About one a round, more as your company grows.',
      'Bid a widebody on a widebody request: the aircraft list shows your widebodies with their fit. A narrowbody request still takes a narrowbody.',
      'Offers, leads and tenders follow your fleet: clients see which aircraft you have, so a mixed fleet gets a steady share of widebody work, more when a widebody stands idle or is about to arrive. Seats are asked to fit your aircraft.',
      'A lead keeps the body it was quoted for: the offer that comes from it is for the same kind of aircraft. Every lead, tender and pitch shows a Narrowbody or Widebody tag, and you choose which one to pitch.',
      'Once you fly a widebody and work the charter market (2★), now and then, at most every month or two, a client asks for a double-decker (an A380 or a 747-400). You cannot fly it yet: it is marked "Stretch: out of reach", a taste of what comes next.',
      'ETOPS 180 is fairer: its technical reliability now counts the twins that will fly ETOPS (your 180-capable widebodies), not the whole fleet, with at least 120 of their departures. The approval card shows the record by aircraft and by cause, the last 30 days, when your pace gets there and what would help.',
      'New: the ETOPS reliability programme (Ladder › ETOPS 180). Spares along the ETOPS routes and an engineer on call, paid monthly per twin: fewer defects and AOGs on the twins, and an AOG away from base is fixed as fast as at home. The ETOPS maintenance programme helps the twins too.',
    ],
    improvements: [
      'The ETOPS record starts fresh when you load an older save: the twins need a few months of good flying. Keep their checks on time, swap in a spare aircraft on an AOG, and an old airframe that fails often can leave the ETOPS fleet.',
    ],
  },
  {
    version: 'v0.19.3',
    name: 'Leave from away',
    features: [],
    improvements: [],
    fixes: [
      'Annual leave that starts while crew are away (on a rotation or a tour) no longer takes days of the rotation. They deadhead home on the first day of leave and back out on the last day, to where their next duty starts. The leave keeps its days, the travel is not duty, and the calendar shows it on the leave, like "LEAVE" with "SGN→LIS".',
    ],
  },
  {
    version: 'v0.19.2',
    name: 'Your own routes',
    features: [
      'Contracts › Network › Build your own route: fly from one of your bases to any airport in the game. Search by city, code or country; fuel stops are suggested for the aircraft and you can change them. Then the same launch: study, business case, permits and the rest.',
      'Each new pair gets its own market: family ties, business, holidays, the airlines already flying it, fares, season, cargo and how hard the permits are. Before a study you see a rough guess with a wide range; the study narrows it. Most pairs are thin or crowded; strong ones are where people are tied.',
      'A flat map of the route in the launch, the business case and the route builder: the route, its fuel stops, the aircraft\'s range and the rivals\' one-stop routes.',
    ],
    improvements: [
      'Spec sheets: the "Range from" circles are flat maps now, centred on each city, with the true range boundary.',
      'Durations show one number when both ends match: "5 weeks", not "5-5 weeks".',
    ],
    fixes: [
      'An aircraft going back to its lessor no longer flies to a paint shop after the return. The return check removes the client\'s colours (the client still pays its share), and a repaint booked after a return is cancelled.',
    ],
  },
  {
    version: 'v0.19.1',
    name: 'Emergency swap',
    features: [],
    improvements: [],
    fixes: [
      'When an aircraft is AOG or in an unplanned repair, its trips can move to any aircraft with enough seats: the client\'s cabin, size, family and livery wishes give way, and the move says "Emergency swap". Range, runways, ETOPS, approvals and rated crew still count.',
    ],
  },
  {
    version: 'v0.19',
    name: 'Scheduled routes',
    features: [
      'Contracts › Network: fly your own scheduled routes, as Euro Atlantic did to Bissau, São Tomé and Dili. They run in the background beside your ACMI work and earn a modest margin, best with an aircraft that would otherwise stand idle.',
      'Opening a route takes months: a market study, the business case, permits, slots, brand or partner, ticket sales, a launch campaign, airport contracts and crew briefings, then the first flight. Each step costs money and time, and some go wrong.',
      'The study recommends the days, times and aircraft size. Change them and the business case shows what it does to the numbers.',
      'Passengers by class, load factor, cargo (live animals too) and the money of every flight: on the flight sheet, the route page and the map.',
      'Any timetable: weekly, twice a week, monthly, your days and times. Move one flight or a whole series, or hold a route flight on the Schedule and drag it: the whole rotation moves.',
      'When an ACMI job wants the aircraft, choose for each flight: another aircraft (business passengers who lose their seat are refunded), a sub-charter (no penalty), or move or cancel it (a small cost).',
    ],
    improvements: [
      'Finance shows the ticket cash taken for flights not flown yet.',
      'Calmer screens: cards and sections keep an even gap everywhere (no more boxes touching on Company), long names wrap instead of being cut, and on the iPhone the client details, chart labels and the new-game aircraft fit.',
      'Panning and zooming the map is smooth, also on iPad: the land is drawn once per zoom, in the background, and the map slides as a picture under your finger instead of being drawn again every frame. The 3D globe does less work per frame too.',
    ],
    fixes: [
      'Annual leave starts and ends at home. Crew on a tour fly home after their last flight before the leave, and back out after it if the tour still needs them.',
      'Morale: "Days off" weighs only when a month falls below the legal minimum, and a day off the planner moved shows as "Day off moved". Days off at a hotel away from home no longer lower morale. Back from annual leave, crew are happier for a few months.',
      'A far base\'s spare captain and purser stay on standby at the hotel instead of flying every sector. On a tour\'s short days (no rest on board) two pilots fly and the others stand by. The flight sheet lists the flight crew first and says who stands by.',
      'A delay that broke one flight\'s in-flight rest plan no longer raises "crew out of hours" on the set\'s later flights. The Details list in Crew Control stays inside its card.',
    ],
  },
  {
    version: 'v0.18.3',
    name: 'Pilot pairs',
    features: [
      'Long flights now carry extra captains and first officers, as at Emirates, Euro Atlantic or Hi Fly: 3 pilots are a captain and 2 first officers, 4 are 2 captains and 2 first officers in pairs A and B. A captain may sit as first officer.',
      'The in-flight rest plan shows the pairs and who is at the controls for take-off, each part of the cruise and the landing.',
      'Crew › Utilisation › Convert: train spare crew on a type that needs them. It suggests the type and why, who goes (the least busy first), and dates. Trips in the way go to other crew. You see the cost and the day they are ready.',
    ],
    improvements: [
      'The aircraft strip on the map stops before the map buttons and scrolls sideways (finger, trackpad or mouse wheel). +N shows the rest; with many aircraft, All aircraft lists them by what they are doing.',
      'Crew calendar: travel as a passenger has its own colour and a seat icon (Positioning, not Flying). Every night away from base shows its layover, also after a deadhead and over hotel standby days.',
    ],
    fixes: [
      'Cruise relief pilots are now first officers, with the same ratings and hire date and a first officer\'s pay.',
      'Flight times on a deadhead row are no longer cut off.',
    ],
  },
  {
    version: 'v0.18.2',
    name: 'Crew utilisation',
    features: [
      'Crew › Utilisation: each person\'s block hours this month, in the last 28 days and over 12 months, next to what ACMI crew typically fly (60–85 h a month in season). It shows idle crew by base, type and rank, pilots and cabin crew per aircraft, and what crew beyond the flying cost a month.',
      'For crew you do not need: offer unpaid leave (they ask for it, so morale holds), furlough a share (Finance), or make some redundant with notice (90 days for pilots, 60 for cabin crew) and severance. Their colleagues take it badly.',
    ],
    improvements: [
      'Crew numbers follow the flying. A deployment keeps its sets on station plus one in five (it used to keep at least 5 sets per aircraft). An aircraft at home keeps 5 sets for short-notice charters, and more when it flies more.',
      'Once a programme is under way, a deployment that needs fewer sets stands one down at the end of its last tour. Nobody is sent home early.',
      'A far base keeps one spare captain and purser on station, shared with far bases within 4 hours. Before, every set brought its own.',
      'The crew desk stops hiring a rank while that rank flies under 40 h in 28 days. A card says why, what it would cost, and how to hire anyway.',
    ],
    fixes: [
      'A crew set sent home after its last duty could fly home on a day off and break the weekly rest (more than 168 h between recovery rests). The ticket home now waits for the rest at the hotel.',
      'Leave no longer cuts a rotation short. Crew ask for leave right after a tour; a tour seat goes to someone with leave in the period only when nobody else can take it; and leave approved over a tour not yet begun moves that tour to someone else.',
    ],
  },
  {
    version: 'v0.18.1',
    name: 'Leave & monthly rosters',
    features: [
      'Annual leave works as at an airline: each crew member has a yearly allowance (30 days at a Portuguese base, 4 weeks elsewhere), earned month by month, and asks for it in blocks of one to two weeks, a few months ahead.',
      'Crew › Leave: the requests waiting, your leave policy and each rank\'s allowance. The rules decide (most of a rank away at once, no leave in July and August), or choose By me to approve or decline yourself. A refusal costs a little morale.',
      'The roster comes out on the 15th for the whole next month. Until then the next month reads "Roster out on 15 Dec". Changes after that are late changes, as before.',
      'Tap a trip: between its duties you see the layover (time at the station, and the minimum rest with its reason). A deadhead day shows its boarding passes.',
    ],
    improvements: [
      'Report, check-in, departure and arrival show the station\'s local time first, then UTC.',
      'The Ladder has room to breathe: each approval shows where it stands, what it still needs (with a gauge) and what it opens.',
      'Fleet cards: Schedule, On map and Specs in one row; Sell, Return early, Borrow and Leaseback in another. Cards no longer leave empty space beside a shorter one, and a leased-out aircraft shows how far its lease has run.',
    ],
    fixes: [
      'Past duties keep their flights and flight numbers on the calendar. Duties flown before this version show their sectors and block hours.',
      'The 14-hour rest after a flight across 4 or more time zones is the EASA minimum; the sheet now says why, and shows the real layover next to it.',
      'A deadhead shows check-in, departure and arrival; "five hours before" was the time difference between New York and UTC.',
      'Each duty on a day\'s card lists its flights again.',
    ],
  },
  {
    version: 'v0.18',
    name: 'Rosters, maps & spec sheets',
    features: [
      'Tap anyone to open their own sheet: a month roster in the style of an airline roster app. A trip is one coloured span with the stations; days off at home, standby, rest away, leave, sick and training each have their own icon. Tap a day for its duties: report and release in UTC and local time, block, duty time against the limit, and the rest after. It opens from the people list, the roster board, flight sheets, Crew Control, messages, the map and crew problem cards; Back returns to where you were.',
      'Under the month: block and duty hours, days off against the required number, block over 28 days (100 h) and 12 months (1000 h), morale and why, fatigue, where they are now and their rest.',
      'The roster board is calmer and keeps its detail: softer lines, rounded duties, the route on each duty. Group the rows by base, deployment or rank, and tap a group to fold it. Compact rows fit more people on screen.',
      'Filter offers by aircraft size (narrowbody, widebody) and distance (short-, medium-, long- and ultra-long-haul), in Contracts › Filter or with the chips above the Market. Each card shows a widebody tag and a haul tag; tap the haul tag for the longest leg.',
      'The offer dialog opens with one plain verdict, the most important reason first: not possible, needs work first, flights in the way, or check before signing. The fix is beside it and the other reasons fold under it. When nothing can make the job possible, the button says Not possible.',
      'The flat map wraps east–west without end, so the Pacific is no longer cut at the edge.',
      'The globe now does what the flat map does: offer pins, weather and closures, world events, crew changes, diversions and the Spotter. Routes arc up off the surface, and aircraft are small 3D models that climb, cast a shadow and leave contrails.',
      'Aircraft spec sheets. Tap Specs on a Fleet card, a Market offer, the lease or buy dialogs, Ask lessors, a deal in progress, or an aircraft in an offer: range, cruise, weights, cargo, engines, fuel, ETOPS, runway, noise, seats by class, crew rest, IFE, power and cabin crew, each with a small icon.',
      'Range discs from your base, London, New York, Dubai and Singapore show how far it flies with a full cabin.',
      'Money and terms in one place: rent or price, deposit, reserves, return, the lessor and your rating, the running cost a block hour, and how many of your routes it flies nonstop (runways and ETOPS too).',
      'A seat map for every type: doors, overwing exits, galleys, lavatories, exit rows and crew bunks, each standard cabin as a tab, this aircraft\'s own marked. The 747 and A380 show both decks side by side. Built after real operators\' layouts (Euro Atlantic\'s own sheets for the 767, 777 and A330).',
      'Compare up to three Market offers side by side: tick Compare on the cards.',
    ],
    improvements: [
      'The people list uses the full width, in two columns on the iPad.',
      'Offer problem cards elsewhere also lead with the most important reason.',
      'Zoomed in close on the globe, the view leans towards the horizon (Map tilt setting; off with reduced motion).',
      'The spec sheet holds game time while open; Escape or Close returns to the dialog underneath.',
    ],
  },
  {
    version: 'v0.17.2',
    name: 'Your reports',
    features: [
      'Bug reports now show New, Sent and Fixed. Export sends only the new ones and your save (turn on Include sent to send again). A fixed report says what we did, and goes 7 days after the update, or at once with Delete fixed.',
      'You can change a lease-end choice until the return check starts: return early, move the date, go back to the lease end, or extend. On the aircraft card, in the lease dialog and in the lessor\'s question.',
    ],
    improvements: [
      'Fewer sick calls you have to deal with: most last 1–3 days, the ones the roster covers come in one quiet line a day, and same-day sick calls away from base are rarer.',
    ],
    fixes: [
      'Crew ride our own empty legs home. The crew who flew TRN–GRU now take our empty GRU–LIS straight from the gate instead of an airline ticket the next night.',
      'Crew on a long-term base stay for the whole rotation you set under Company (4, 5 or 6 weeks). Leave that falls inside a rotation moves to just after it. Only a real limit, sickness or leave sends someone home early.',
      'The check dialog says when the aircraft goes back to its lessor, with the year. You can book a C-check that falls due before the return. Near a return it shows the options (book it, fly on, park it, hand it back early) with costs, days lost and what we recommend.',
      'A C-check due at the lease return is charged by the lessor, as it should be.',
    ],
  },
  {
    version: 'v0.17.1',
    name: 'Bug button',
    features: [
      'To report a bug, tap the small bug in the lower left corner. It is on every screen and dialog. It takes a screenshot of what you see and saves the game with it; time stops while you write.',
    ],
    improvements: [
      'The other report buttons are gone (top bar, problem cards, flight sheet, Crew Control, Menu). Menu › Bug reports still lists and exports them, screenshots included.',
      'The corner is kept clear, so the bug never covers a button.',
    ],
  },
  {
    version: 'v0.17',
    name: 'Aircraft market',
    features: [
      'Ask lessors for the aircraft you want: type, age, lease length and start (Fleet › Market › Ask lessors…). Real lessors answer in one to four weeks with a proposal or a no, and say why.',
      'Your lessor rating, A to D, is at the top of Fleet › Market. It comes from your AOC years, fleet, cash, debts, clients and IOSA, and sets who talks to you, the deposit and how many aircraft each lessor places with you. Why? shows each part.',
      'A lease starts with a letter of intent and a holding deposit. The lessor\'s credit committee approves, asks for more security or says no. Then come records, a check and paint before the ferry home: about 6–12 weeks for a narrowbody, longer for a widebody. Our CAMO handles a few transitions at a time; tech reps speed one up.',
      'Real terms: rent from the market, the lease length and your rating; 1–3 months\' deposit (5 or more at rating D); maintenance reserves; minimum hours billed even when parked; return conditions by age.',
      'The market moves like the real one. Each type is easy, normal or tight to find (see the market outlook). Narrowbodies are easing; widebodies are scarce, and new 787s and A350s are placed until 2030. Lessors call with aircraft more often.',
      'When an airline fails, some of its aircraft come to the market below market rent. In their quiet season, airlines lease aircraft out for 3–9 months (Short-term…), back on a fixed date.',
      'A new type family needs an AOC variation (90–120 days) and rated pilots. Company › Ladder lists the types on our AOC.',
      'The A380 and the 747 are possible, from Doric, Amedeo or the airline retiring them. You need rating B, or C with 4 more months\' deposit and 3 months of reserves up front, or you buy one. The dialogs list What it takes.',
    ],
    improvements: [
      'Fleet › Market has three tabs: Offers, Requests and In progress. An offer card is four lines: aircraft, terms, when and where it is ready, and one button.',
      'A deal waiting for you (pay, sign, walk away, add tech reps) has a card with its buttons.',
      'The fleet card shows a transition or a short-term lease with its dates (UTC, local alongside).',
      'The cash forecast shows holding deposits, deposits to sign and transition costs.',
      'Existing leases keep their rent, deposit and conditions.',
    ],
  },
  {
    version: 'v0.16.4',
    name: 'Rotations',
    features: [
      'Crew rotations work like a real ACMI tour: a set stays on station for the whole rotation (4 to 6 weeks, Company › Policies) with its days off at the hotel, and goes home early only when a legal limit leaves no answer on station. A first tour is never cut short, and a set whose deployment ends within a week stays to the end. Someone over a limit for a day or two keeps the tour: another set on station or a trip covers those days. A leg short of rest by a few minutes waits for its crew. Annual leave is planned around the whole rotation.',
      'Crew › People shows the sets on station ("Set 2 at Hamburg: 23 of 35 days · home 7 Jun") and who went home early and why. The Inbox says so when it happens ("Castro goes home early: Rest 11:54 < 12:06").',
      'Airline tickets follow a timetable: each route has named flights at fixed times, crew are booked onto them, and one trip\'s crew on the same departure share one booking. A flight already full is named on the booking ("TP 1478 10:00 full: booked on the next departure"). The same flight no longer shows twice on the map.',
      'Crew alarms check themselves before they ring: the duty is re-measured from the flights as they are now, each named person is judged against the rules, and the roster\'s own fix is tried first. Only a confirmed problem chimes, pauses and shows its card, marked "Checked ✓" with the evidence: who, which limit, the value against the limit, and when. If the check disagrees, nothing rings: the case goes quietly into Menu › Bug reports with a snapshot, for you to export.',
    ],
    improvements: [
      'A ticket that only needs to move is re-timed, not thrown away and bought again; a ticket that still works is kept.',
      'A tour\'s ticket home is booked for after its last duty, so a set on a thin programme no longer flies home mid-rotation and gets replaced the next day.',
      'Every crew ticket says why it was bought: the tour change, why someone goes home early, or whom a replacement replaces.',
      'Tickets in an older save that left at odd minutes move onto the timetable where the crew still connect; flown tickets stay as they were.',
    ],
    fixes: [
      'A crew member on a tour was flown home when the tour grew past their ticket home ("Ticket HAM–LIS clashes with the trip"). The ticket is moved instead.',
      'A deployment\'s return leg months ahead no longer fails every set with "no 36 h recovery in 168 h" and flies as a trip from base.',
      'Sets on early waves now work their days in a row (at most four) and rest together, so 6 on / 2 off holds inside a tour and the sizing no longer asks for twice the sets.',
      'After a crew change was undone, a ticket could drop out of the plan until reload, leaving crew on standby at a station they had already left. Fixed.',
      'An offer for an A320-size aircraft (Luxair\'s season base, cover for a grounded jet, a capacity lease) no longer lets you pick a widebody. Types the client did not ask for are left off the list, with one line saying why.',
      'An offer fitted to an idle aircraft is for an aircraft of that size: no more "Follow-on: CS-TTL is free" on a narrowbody job.',
      'A positioning flight is no longer joined to the work on station when that makes a four-pilot day (HX6001 SHA–HKG carried two extra pilots on every 2-hour day). The positioning flies with its own two pilots.',
      'Standby is part of the job: long standby runs no longer lower morale or cause resignations, and morale lost to them comes back. A resignation names the person and the real reason ("Alba resigned on 10 Jun: salaries paid late. Last day 9 Jul.").',
      'The in-flight rest plan of a two-leg day says it is one duty for the same crew, that every leg counts in their day, and on which leg they rest (BLU2011 CMN–AMS empty, then BLU2003 AMS–MBJ). The leg without rest is shaded on the timeline.',
      'After a job far from base, the aircraft comes home straight away with a crew flown out for it (CS-TQM sat 24 days at Hong Kong). If no way home fits its range and ETOPS limit, a card says so and what the parking costs.',
      'A crew member moved onto a tour is no longer blocked by a finished part of another set\'s tour at the same station, which raised a false CREW SHORTAGE.',
    ],
  },
  {
    version: 'v0.16.3',
    name: 'Ways out of debt',
    features: [
      'Finance › Get out of debt: while cash is below zero, one panel lists every way out, the gentlest first, each with what it gives, what it costs and what follows. The cash card and the investor\'s rescue card link to it.',
      'The bank lends to a struggling airline, on worse terms: below zero you can open a secured credit line sized on 80 % of the invoices due within 90 days and 50 % of the owned aircraft without a loan, at the bank rate plus 7–9 % with a 2 % arrangement fee. The bank holds those aircraft as security (no sale, loan or leaseback until the line is repaid), wants cash plus undrawn credit at 1.5 months\' bills and re-measures the base every month end. At the yearly renewal, with cash above zero and no breach, it becomes a normal line and the security is released. Cash Crunch still has no line.',
      'Ask a lessor to defer two or three months\' rent: repaid afterwards plus 10 %, the lease runs twice those months longer, reliability −1. Refused with a deferral still open, under four months left, or after a repayment taken from an overdrawn account (that lessor says no for a year).',
      'Spread the last two months\' bills with a creditor: Lufthansa Technik, TAP M&E, Swissport, Menzies, World Fuel Services, Air BP and others let half of what you owe them go back over 3–6 months for a 3–6 % fee. Two parts taken from an overdrawn account and they call the rest with a 2 % fee. Refused once more than two months\' bills are deferred.',
      'Bring in an investor now instead of waiting 30 days for the forced rescue: Castlelake, Indigo Partners, Apollo and others pay the overdraft plus a month\'s bills for 5 points less of the company than the rescue would take, and sit on the board: every quarter cash must be above zero and the three-month margin at or above 0 %. Two misses in a row and the board sells an aircraft; three and it replaces you. Four quarters met and the board stands down. Signed below zero it counts as your one rescue.',
      'Cost cuts: furlough a quarter or half of each role for 4 or 8 weeks (the ones with the least work ahead; unpaid, morale −15 for them and −4 for the rest, resignations follow); defer 30 % of crew pay and all of the heads\' pay for one or two months (morale −8 a month, paid back over two); plan the A-checks late for 90 days, inside the 10 % the authority allows, at the price of more technical delays.',
      'Ask a client to pay an invoice early for 2–6 % off (relation −3; about half say no when they barely know you), next to selling the invoice to the bank.',
      'File for restructuring (Portugal\'s PER, or the home country\'s equivalent) when deeply insolvent: six months of court protection, claims frozen and the 30-day insolvency clock stopped, 30 % of the unsecured claims written off. The price: reliability −10, clean −10, every client you fly for −15 (some cancel), a lessor may take an aircraft back, no new credit for a year and a "Restructuring" label on your offers (−5 % rate, no deposits) for a year after. Once only; cash below zero at the end means liquidation.',
      'Sales lives under Contracts › Market now, as Offers · Leads · Tenders. Leads shows the pipeline first with one tap to send a proposal and "goes cold in N days" on each; the brokers, pitches and sales managers are folded under it as the sales desk. Inbox lead messages open the right lead. The old Sales and Tenders tabs are gone (old links still land in the right place).',
    ],
    improvements: [
      'Deferrals, plan fees, early-payment discounts and restructuring write-offs are one statement line, "Deferrals & restructuring"; every repayment is in the cash forecast.',
    ],
  },
  {
    version: 'v0.16.2',
    name: 'Rescue',
    features: [],
    improvements: [
      'The investor\'s rescue is sized to the hole: enough to clear the overdraft and pay the next month-end bills, never less than before. A bigger cheque buys a bigger stake (25 to 49%). The offer and the signed message say how much, for what share, and what cash is afterwards.',
    ],
    fixes: [
      'A rescue that arrived the same minute as the month-end bills left cash where it was (−$2.66M before and after on 1 May). Signing now covers anything that went out since the offer. A save rescued that way gets the fund\'s top-up once on load, so the "insolvent again" clock does not end a game the rescue never cleared.',
    ],
  },
  {
    version: 'v0.16.1',
    name: 'Niamey',
    features: [
      'Report a bug: Menu › Report a bug, the bug button in the header, or the small Report link on a problem card, a flight sheet or Crew Control. Say what happened and what you expected; the game adds the time (UTC and local), the version, the screen and dialog you were in, the flight or crew it is about with its state, the last Inbox lines, your settings and the device, and keeps a snapshot of the whole game at that moment. Menu › Bug reports lists them: open, delete, Copy summary, and Export all writes one file with every report, its snapshot and your current save. Nothing leaves the device until you export. Reports are kept on this device; a note appears once there are many.',
      'Clients show a star rating, 0 to 5, instead of a level number: small brochures and tiny tour operators have none, the big tour operators and low-cost airlines one, the charter market two, national carriers three, the majors four, flagship carriers (Air France, KLM, Lufthansa, British Airways, Qantas) and head-of-state, government and military work five. On offer cards, the offer dialog, Clients and the Prestige card; your own standing shows as stars with what the next band needs; the filter asks for a minimum of stars. The four levels behind them, and what they open, are unchanged.',
      'Offers your filter hides stay off the map and the globe (no pins or counts), the airport and event panels and the Contracts badge. Only the "N offers hidden by your filter" line on the Market tab counts them. Evacuations, tenders, leads and repeat work still show.',
    ],
    improvements: [
      'The flight sheet and the alarms agree: a red crew mark clears as soon as the flight is legal again, and a "Crew out of hours" pause with no flight behind it stops nothing. A game saved while paused for one of those opens unheld.',
      'A passenger flight moved hours behind the next flight in (the aircraft was elsewhere) says so in the Inbox, with the flight it waits for.',
    ],
    fixes: [
      'Evacuation flights from Niamey (a coup closed the airport): the empty flight in to fetch the first load was planned after the airport reopened, a week after the flights it was for, and Crew Control said no crew could be flown in and offered only a private jet. An empty flight into a closed airport now flies under the clearance of the job it is for, is planned before the first flight and its crew fly it; an existing save is re-planned on load. Crew Control says plainly that no airline flies there and that crew ride our own flight in or a jet under the same clearance; a jet lands at a closed airport only with that clearance.',
      'A crew alarm no longer rings for the minute between a flight moving at the gate and the roster re-cutting its duty (BLU2049: "out of hours" on a legal crew, with a pause that stayed).',
    ],
  },
  {
    version: 'v0.16',
    name: 'Finance & Sales',
    features: [
      'Finance has a bank. Finance › The bank: a credit line sized on your fleet and revenue, drawn and repaid any time, with interest on what is drawn, a small fee on the rest and two covenants checked monthly (a breach brings a warning card, then a higher margin or a frozen line). Loans on your own aircraft (about 60 % of value, monthly instalments; the aircraft cannot be sold until repaid). Sale and leaseback with AerCap, Avolon, SMBC Aviation Capital, Air Lease, BOC Aviation and Carlyle: it stays in your fleet, leased. Sell an open invoice to the bank for about 95 % now, with or without recourse. Spare cash earns interest monthly. Every flow is in the ledger, the statements and the cash forecast.',
      'Charters: ask a deposit on signing, 0–50 %. The offer dialog says what it does to the client\'s answer, and a counter carries it.',
      'Every client has a level, 1 to 4: brochure work and low-cost, leisure and sports, national carriers, the majors and governments. You climb by flying for them: visibility (weighted by who you fly for), a clean record and IOSA open the next level; nobody drops a level. Offers come at your level, with one stretch offer a month from a level up. Higher levels pay more, ask more and penalise harder. The Prestige card on Company › Overview says what the next level still needs; the Contracts head shows your level.',
      'About half the work now comes to you. The rest you chase in Contracts › Sales: brokers (Air Charter Service, Chapman Freeborn, ACC Aviation, Air Partner, Hunt & Palmer; 3–5 % on the deals they bring), pre-season pitches to airlines (a "maybe" comes back weeks later), a leads pipeline (lead, proposal, negotiation, signed; a lead left alone goes cold) and regional sales managers hired in Team. Tenders and trade fairs matter more.',
      'Contracts › Filter: what you tell your sales team and the brokers not to bring: client kinds, a minimum client level, a minimum rate per block hour or profit, only some aircraft families or markets. Hidden offers don\'t chime or write to you; the Market tab says how many wait under your filter.',
      '170 more real clients, each with its level and its colours: Air France, KLM, British Airways, Virgin Atlantic, Iberia, SWISS, Turkish Airlines, French bee, Air Caraïbes, Corsair, Aircalin, Air Tahiti Nui, Air Austral, Caribbean Airlines, the low-cost and leisure airlines, TUI, DER Touristik, Coral and Anex, defence and foreign ministries from Paris to Canberra, UNICEF, the ICRC and MSF, the big clubs and federations, promoters and companies.',
      'Far routes: overseas rotations with a stop and a crew change on the way (Paris–Singapore–Nouméa, the South Atlantic airbridge via Ascension, the Antilles, Réunion, Curaçao and Bonaire, the Pacific, Papeete via Los Angeles). They pay a quarter more. New on the map: the Caribbean, French Guiana, Mayotte, Wallis, Port Moresby, Turin and RAF Brize Norton.',
      'A Compliance Monitoring Manager is a real hire in Team (the nominated post): fewer ramp and audit findings.',
      'Every offer says who pays the fuel: "Client pays fuel" on ACMI, "Fuel ours, in the price · fuel clause" on a charter.',
      'New Terminal music on the title and setup screens: a slow departure-lounge piece (soft piano, bass, brushes), with the hum of the hall, a distant jet now and then and a two-note gate chime. No voices.',
    ],
    improvements: [
      'A day that a delay runs over its limit after the crew reported goes on with the relief pilots aboard, or with commander\'s discretion when that covers it: one note in the Inbox, no alarm and no pause for a legal day.',
      'The flight sheet says what the day really allows: "Not needed: 13:15 of 14:00 (0:45 spare)", "3 pilots with class 1 bunks allow 17:00", "the 4 pilots aboard and class 1 bunks allow 18:00". A trip whose later days carry 3 or 4 pilots plans its extended days with in-flight rest instead.',
      'Crew Control judges candidates for a flight held at the gate from its new check-in, not from a report hours past; "Delay" brings a fresh crew when one can take it; refusals say the real reason and name only crew at the departure airport; a standby call counts only once the window has begun.',
      'Empty flights into a job are timed for a crew who can fly them: the ferry crew\'s rest counts in full (14 h across 4+ time zones, +4 h after an extended day). A flight held for crew asks Crew Control for the earliest departure instead of pushing 20 h at a time.',
      'AOG card: the engineering team or a free aircraft is the default when it costs less and drops fewer flights. "Fly it" is not offered for a day the aircraft is booked for maintenance. "Line-check" is now "Inspection" everywhere.',
      'The cash forecast includes charters paid on completion. The offer dialog says the real payment terms and who pays the fuel; the per-aircraft line reads "profit".',
      'Scenarios: Long-Haul Debut gets its ETOPS 120 and widebody approvals; a fixed fleet gets no dry-lease requests; a closed Ladder gets no work that needs approvals; no stale "Urgent" lines at the start; the Goals chip shows three stars only when every condition is met.',
      'Dialogs: the small chips are back to their size (they had grown to 44 px since v0.12); "Look first" on a decision is always in view; a toast moves out of the way of an open decision; the loading screen fits an iPhone in landscape; the Market outlook calendar no longer clips its labels.',
      'Contracts, Inbox, Finance and Crew no longer stutter every game hour with offers open; the map and the globe use less battery.',
    ],
    fixes: [
      'BLU2032 at Heathrow (A330, 4 pilots, bunks): after the APU delay the day read "already too long when they reported" and rang CREW OUT OF HOURS with a pause. The 14:00 extension the crew reported with is kept, the relief pilots carry the day (14:19 of 18:00) and it departs legally. Saves that carry the old state are repaired on load.',
      'A permit delay that moved a leg 19 h no longer shows a 28-hour "day" and a red alarm: the duty is cut in two at once.',
      'The gate no longer waits a day for a ticket from base when its own held crew can re-report in 6 h.',
      'An empty move is no longer timed when nobody can fly it (Kathmandu: the aircraft stood eight days and the client\'s flights were sub-chartered seven times). A chain home that already has its crew keeps its times when the flight before it runs a few minutes late (New York: it was re-timed to leave at landing, lost its crew and stood six days). An empty flight waiting for crew at a far airport no longer waits, every few hours, for a crew member the roster will not seat; the wait counts the 14 h rest a crew flown in across time zones needs.',
      'A curfew night stop moves the aircraft\'s later flights too, instead of drawing the flight over the next one on the Schedule.',
      'Charter balances add up to the dollar, and the completion message says what was refunded for flights not flown.',
      'No more "It has been waiting 0m" on a decision raised at departure, no double space in a client\'s level-up message, and Crew Control no longer repeats a solution\'s description.',
      'Music no longer clicks when a piece starts.',
    ],
  },
  {
    version: 'v0.15',
    name: '3D',
    features: [
      '3D globe: tap the globe button by the Map\'s zoom controls to see your airline on a 3D Earth, lit by the real sun, day and night. Every aircraft flies its real great circle, to scale in its family colour with its tail mark. Drag to spin, pinch to zoom, tap an aircraft or airport for its panel, double tap for home. The map button takes you back to the flat map, which keeps your view.',
      'Aircraft cast a soft shadow on the map: crisp on the stand, drifting further off and softer as they climb, back in as they descend.',
      'Zoom in close and the map leans back gently, with a soft horizon at the top. Taps land exactly where you touch.',
      'The Hangar has depth: in the side view the line-up stands on a hangar floor with soft shadows and faint reflections; from above, a lit concrete floor with a shadow under every aircraft.',
      'A take-off to start: tap the loading screen ("Tap to board") and a twin-jet spools up, rolls past and climbs away. Then Terminal, departure-lounge music, plays through the title, New Game and Scenarios, and fades into the game music when you start flying.',
      'A welcome card for every new airline, with a low chime: what the job is, where offers come from, how time works and where to find help. Scenarios show their brief and goal on it.',
      'Scenarios play as the scenario: each one locks what would sidestep it (no cancelling the Hajj airlift, no fleet deals, tenders or sales trips, only the scenario\'s kind of work on the market). Locked buttons show a lock and the reason.',
      'Every scenario starts inside an established airline: years on the AOC, its standing and approvals, a year of monthly accounts, past jobs and clients, crew seniority and recent flying, and a technical record.',
    ],
    improvements: [
      'When the game stops the clock for a decision, a call, a crew alarm or one of your pause rules, it carries on at the speed you were playing once you\'ve dealt with it. If you paused yourself, it stays paused.',
      'Smoother coastlines and borders on the globe at every zoom.',
      'Settings › Display: 3D globe on or off, the globe turning slowly when you leave it, and Map tilt on or off.',
      'The globe loads only when you open it and works offline. If your device can\'t show it, the flat map stays, with a short note.',
      'Scenario star targets retuned for the new rules.',
    ],
    fixes: [
      'A crew card fixed in Crew Control no longer leaves "Decision waiting" behind.',
      'A crew member no longer stays on hotel standby at an outstation they never reached, or during leave.',
      'The positioning flight into a job leaves early enough when the job\'s ferry home falls in the same crew duty.',
    ],
  },
  {
    version: 'v0.14.1',
    name: 'Fix pack',
    features: [
      'Empty flights into a job are planned around the crew who fly it: if the aircraft is free it flies there the evening before and the crew sleep there; otherwise extra pilots with in-flight rest, or a separate ferry crew while the flight crew travel by airline.',
      'Night curfews are kept on every flight. A flight that would leave or land inside one gets a card (wait for the opening, divert or cancel); an empty flight waits for the morning.',
      'If a screen or window ever fails to draw, the game pauses, saves and tells you calmly instead of going blank.',
    ],
    improvements: [
      'The flight sheet says when a day needs in-flight rest ("3 pilots with bunks allow 17:00") and only says "Not needed" when it really is.',
      'The crew desk only pays for a fix that fully crews the flight; when it can\'t, it says so once and leaves it to you.',
      'The cash forecast sees dry leases, administrators\' payouts and contracts ending mid-month; "Cash runs out" names the right day; the top bar counts one-off costs once.',
      'A month that lost money says which costs grew. Dry leases show what they invoiced. Dates of base programmes and tenders are the local days.',
      'Fairs and clients in your home city need no flights or hotel. Tenders are decided weeks before the job starts. A Newcomer sees about 1–2 offers a week.',
      'Offer cards name the real problem and offer Book A-check when a check is due. Lease extensions start their new rent when the old lease ends, never below the type\'s floor.',
      'The game loads faster. Distances are in nautical miles throughout (the unused units setting is gone).',
    ],
    fixes: [
      'A crewed day made illegal by a client\'s retime is re-planned, not just flagged "Crew illegal" (CS-TTL FRA–AMS before AMS–VRA).',
      'A few minutes\' delay no longer re-makes a crewed empty flight with no crew; a card on an empty flight no longer cancels paid flights two weeks later.',
      'Crew at the gate stay on their flight when only their ticket home is stale; crew in the air are no longer bought a second ticket and taken off.',
      'Replacing a crew member in an added seat no longer crashes; a crew change never stops half-way.',
      'A paid flight that crew ride on is never deleted with their trip.',
      'Duty dialog: no "Legal" on a too-long day; rest shows the real rest; release shows its date.',
      'Handing a lease back with its C-check due now costs the check instead of nothing.',
      'Leads from sales trips expire properly; airlines in administration stop sending work; a won tender can\'t be countered.',
      'An aircraft idle abroad before its check at home flies home straight away.',
      'A world tour short of crew at the start slips or drops only the stops it can\'t reach, instead of being cancelled whole.',
      'Penalty cards open again; ramp and audit messages open the Safety card.',
    ],
  },
  {
    version: 'v0.14',
    name: 'Commercial',
    features: [
      'Tender season: from November to February airlines (Jet2, TUI, Corendon, Condor, easyJet, Wizz, SAS…) ask for next summer\'s capacity, and Gulf and North African carriers do the same for winter in June–August. Bid a rate, guaranteed hours, an aircraft, the crew and the dates in Contracts › Tenders; rivals bid too and the airline decides weeks later.',
      'Market presence: Contracts › Markets shows how well known you are in 13 regions of the world. Most offers come from where you are known; it grows with fairs, client visits, work flown there and happy clients, and fades slowly.',
      'Trade fairs and sales trips on every continent: ITB, Routes Europe, Routes Asia, Routes Americas, FITUR, Arabian Travel Market, AviaDev, Akwaaba, the Singapore and Dubai airshows and more. Send yourself or your analyst; they fly on airline seats like your crew and you can follow them on the map.',
      'Far fewer offers: about 1–2 a week while you earn your name, about 3 once established, 4–5 when respected, none on quiet days. No more look-alikes, and more of them fit your fleet.',
      'Client crises: strikes, engine groundings and airlines going into administration make the news, bring urgent work nearby, and can leave unpaid invoices.',
      'Urgent calls are in the moment: the caller waits 30–90 minutes for an answer. Pick the aircraft on the call and see its schedule around the job in one strip.',
      'Aircraft on the map are drawn to scale, each with its tail mark (TTL). A dry-leased aircraft flies for its lessee, just for show.',
    ],
    improvements: [
      'Balance from real market figures: insurance about a third of before (A320 about $12,500 a month), today\'s lease rents with floors for old aircraft, C-checks priced per type (A320 about $0.7M).',
      'Cabin crew and pursers earn the same on every type; widebody pilots earn more.',
      'Widebody wet leases run 3–6 months with at least 300 guaranteed hours; the widebody approval needs 95 % reliability.',
      'Narrowbody ACMI rates up a little, widebody rates trimmed, a 747 jumbo job is priced at the 747\'s rate.',
      'Offers about to lapse get one note and a chime; short-notice work comes as a call.',
      'Crew: one plain line per fleet, each person\'s home fleet on their card, an "i" on the sets cards, a quieter Round up. Rank stripes and wings redrawn.',
      'Offer card: no Sub-lease buttons on the Busy line; check lines keep their full width.',
    ],
    fixes: [
      'An aircraft stranded far from home (Manila) gets one way back planned for when a crew can reach it, instead of being re-planned every few hours; one card asks about the jobs it can\'t reach.',
      'Crew who have left the company can no longer stay on a trip and fly.',
      'A ticket home moved by a night curfew no longer breaks the weekly rest.',
      'A tender bid checks that the aircraft is free; a won tender whose aircraft is busy can be signed on another.',
    ],
  },
  {
    version: 'v0.13',
    name: 'Around the world',
    features: [
      'World tours: Les Voyages de TMR, Abercrombie & Kent and Kuoni charter a whole widebody for 18–24 days round the world (Rio, Easter Island, Tahiti, Angkor, Samarkand and more). One augmented crew flies it all, with extra cabin crew for the service and hotels at every stop. Late game, about once a year.',
      'Crew ride our own flights: when one of our passenger flights goes where crew need to be, they take a free seat instead of an airline ticket ("Riding EI4003 LIS–DUB · own flight, no ticket").',
      'Buying back a day off: when only a day off stands in the way, the crew member is asked to work it (twice a day\'s pay, a day off later in the month). Company › Policies: Automatically, Ask me or Never.',
      'Far bases (12+ hours or 4+ time zones from home) get their crew stationed there, with a spare captain and purser in every crew, so a sickness is covered on the spot.',
      '38 new airports: Curaçao, Bonaire, Sint Maarten, Paramaribo, Réunion, Aqaba, Siem Reap, Samarkand, Ulaanbaatar, Easter Island, the Falklands, Ascension, Svalbard, Tonga and more. Some short strips take narrowbodies only.',
      'Pop-ups stay longer (crew alarms until you close them), hold while you touch them, and open what they are about. Inbox › Recent pop-ups keeps the last 50.',
    ],
    improvements: [
      'Short runways cost a little range, not half: the A330 flies Montego Bay–Amsterdam nonstop. Landing never limits a flight; high airports count as shorter. Fuel stops lie on the way.',
      'Every aircraft type\'s range checked against real routes: the 737-800 reaches Sal, the A321 the Canaries.',
      'Every base gets the crew its programme needs, counted from its real flights, not two crews from the day you sign.',
      'Long empty flights stop overnight for a crew change instead of being impossible to crew.',
      'Airbus cross crew qualification: A320 and A330 pilots convert in about 10 days and keep both types (cabin crew 3 days). Pilots who lost their A320 rating get it back.',
      'B757/767 crews earn widebody pay while a 767 is in the fleet. Lessors offer the widebody type your pilots fly.',
      'VIP refits are priced by the seats you fit (24 business seats on an A320: $840K, 9 days); the dialog shows the breakdown and the 2-day two-class option.',
      'When a client asks to move flights later, their own flights cost nothing and don\'t count as late; the card shows any other client it would delay.',
      'Delays that are not ours (weather, ATC, closures, the client) cost no compensation. Trusted clients forgive delays of 15 minutes to 3 hours.',
      'Cancelling a charter series charges each remaining rotation by how far away it is.',
      'Base flights are no longer planned inside night curfews; empty legs and crew tickets respect curfews too.',
      'The profit-per-day pill spreads one-off costs over the month.',
      'Crew-shortage cards say who is at the airport and why; timelines show the date when it isn\'t today; overlapping flights on the Schedule sit one above the other.',
    ],
    fixes: [
      'An aircraft left at Port Sudan for a month: an overflight closure no longer closes airports that stay open (Port Sudan, Tel Aviv); a stranded aircraft gets one way home at once; no more back-and-forth empty legs; Ana stops asking every day.',
      'Flights cancelled because a war or closure stops us are force majeure: no compensation, no reliability hit.',
      'A closure that strands an aircraft another job needs gives a card (sub-charter, swap or cancel) instead of quietly dropping the flights.',
      'Evacuations wait up to a day for a legal crew instead of being cancelled.',
      'Pilots already at the airport stay on the flight instead of being sent home; no ticket in the past is ever offered.',
      'A technical diversion back to the departure airport no longer cancels the return flight and flies it empty.',
      '"Fly on, same crew" after a diversion is only offered when that crew can legally fly it.',
      'Crew held at the gate get their real rest; crew no longer wait at an outstation for days for a ticket home; no crew tickets into closed airports.',
      'A job whose empty positioning no crew could fly can no longer be signed (it caused a 747 base to collapse).',
      'An aircraft only flies passengers with the approvals it needs; a late or stuck approval gives a card in advance.',
      'Fuel re-billed to charter clients now shows as revenue; the 90-day cash forecast is much closer to the truth.',
      'Counter-offers keep your cabin choice and the client-paid extra crew; a contract with every flight cancelled no longer counts as a success.',
      'About 60 more fixes from a full bug hunt across operations, crew, contracts, money, events and the screens.',
    ],
  },
  {
    version: 'v0.12',
    name: 'Scenarios',
    features: [
      'Start setups in New Game: seven short-haul starts. Classic pair (two A320s), Boeing shop (two 737-800s), Leisure workhorses (two 220-seat A321s), New tech (one A320neo and more cash), Mixed fleet (an A320 and a 737: two type ratings, two crew pools), Owned veterans (two old A320s you own: no rent, checks due soon) and Shoestring (one A320, a small crew, tight cash). Each card shows the fleet, the crew, the cash and how hard it is.',
      'Scenarios, a new mode on the Title screen: ten challenges, each with its own company, base, date, fleet, crew, cash and contracts. Summer Surge, AOG Firefighter, Cash Crunch, Hajj Airlift, Ash Cloud, Crew Crisis, Cup Final Week, Long-Haul Debut, Southern Winter and Humanitarian Airlift.',
      'Each scenario has one goal with one, two or three stars, an end date and sometimes a condition (fly at least 95 % of the legs as planned). The top bar shows your stars and the days left; tap it, or open Company, for the goals.',
      'At the end a results card shows your stars and the key numbers, with Retry and Back to scenarios. Your best result for each scenario stays on this device.',
    ],
    improvements: [
      'The crew of each setup is sized in sets, as Crew › Planning counts them; rent, value and checks follow the real aircraft and their age.',
      'A scenario game autosaves to its own slot, so it never replaces your normal game\'s autosave.',
      'New Game on an iPhone on its side: the form and the aircraft sit side by side, so the form can be reached. The Title menu fits the screen.',
    ],
  },
  {
    version: 'v0.11.4',
    name: 'Crew planning 2',
    features: [
      'Crew shortages are announced as soon as the roster knows it can\'t crew a trip, up to 10 days ahead, with what you can do: hire, fly someone in, swap crews, sub-lease or move the trip. The 48-hour and 12-hour warnings follow only if it is still short, one notice per trip at each stage.',
      'A shortage from a late change says so first ("Late change: … fell sick on 14 Oct", a leg added at short notice, a delay), so you can tell it from a trip the roster couldn\'t plan.',
      'Private jets work like real crew-positioning jets: wheels up about 2 hours after booking from the nearest business-jet base, straight from wherever the crew are to the aircraft at real jet speeds. A new long-range class (Global 6000, Gulfstream G650, Falcon 8X) crosses an ocean without a fuel stop, and a jet can bring the crew the evening before so they rest there. Crew Control also looks at crew resting close by, not only at base.',
    ],
    improvements: [
      'Trips far away (4 or more time zones, or a long ticket) get their crew there a few hours early with full rest, so one late airline arrival no longer leaves everyone minutes short.',
      'Crew Control\'s Delay offers the short delay that makes a crew legal (e.g. +10 minutes) and never says "use Auto-fix" when Auto-fix can\'t crew the flight.',
      'Offers: the reason and the fixes on the card speak of the same aircraft; long Sub-lease buttons wrap inside the card; each trip in the way ends with a quiet ☰ instead of Move / Sub-lease tags.',
      'The offer\'s ghost flights are now exactly what accepting would book (fuel stops, turn times, empty legs between legs, positioning before, between and after trips) and never get in the way of tapping your own flights.',
    ],
    fixes: [
      'A long day with a planned extension that ends away from base could never be crewed (every pilot "Rest 14:15 < 17:45", e.g. BLU1396 Montego Bay–Amsterdam). The extra rest is now taken the way EASA allows: +4 h after, or +2 h before and +2 h after.',
      'On a widebody the ticket out gives the cabin crew their full rest too (they report 15 minutes before the pilots; before, every flight attendant was 5 minutes short).',
      'Two days with too short a night between them are no longer planned as one trip nobody can fly; a crew member placed on a trip but left in the wrong city gets a new ticket.',
      'A jet that can\'t reach is no longer offered, and a jet with a night\'s rest waits for the rest the crew really need.',
    ],
  },
  {
    version: 'v0.11.3',
    name: 'Offer ghosts',
    features: [
      'A new offer shows its flights on every aircraft\'s timeline before you accept: dashed outlines at the client\'s times (not booked yet), with the empty positioning that aircraft would need as smaller dotted ones. Only a job with no flights yet (a base deployment) stays one shaded block.',
    ],
    improvements: [],
  },
  {
    version: 'v0.11.2',
    name: 'Every device',
    features: [
      'Play on iPhone, iPad, Mac and Windows: the game knows which device you are on (touch or mouse, home-screen app or browser). Settings › Display › Device shows what it found and lets you pick iPhone, iPad or Computer if it guessed wrong.',
      'iPhone on its side: the sections run down the left edge beside a one-line top bar, clear of the Dynamic Island and the home indicator; windows fit the height with their buttons always in reach. Held upright, a calm card asks you to turn the phone (you can still play upright).',
      'Mac and Windows: Space pauses and plays, 1, 2 and 4 pick the speed, Esc closes a window (never while you type; Settings lists the keys). Settings › Display › Size: Smaller, Normal or Larger (Larger by itself on a big screen).',
      'Sub-lease: another operator flies a trip for us and the client still pays us. It sits next to swapping aircraft (in a new offer, the trip move confirm and the flight sheet), with each operator\'s quality, price and what the client notices, or why it can\'t be done.',
      'A new offer shows every flight under each aircraft on its own (only work without flights yet stays one block); flights in the way of the job have a red outline and are listed with Move and Sub-lease, or "Sub-lease all".',
      'Fleet › Hangar from above: every aircraft seen from the top, from its real length and wingspan, at one scale on a 10 m grid (Side keeps the side view).',
      'Music: five calm pieces take turns (Cruise, Night Flight, Golden Hour, Ops Room, Long Haul). Settings › Sound shows what is playing, with Next piece.',
    ],
    improvements: [
      'The map\'s night no longer shows city lights.',
      'The profit per day sits right under the cash, ending under "cash".',
      'Crew sets: every screen counts each person once, in the same fleet: Hire and Planning agree, pilots on two types and relief pilots are counted right, spare pursers fill cabin crew seats ("exact, with 2 PUR"), and the strip says "5 of 5 sets · 4 spare" instead of "9 of 5 sets".',
      'Round up no longer offers sets you don\'t need (spare pursers, or a client bringing some cabin crew), and "Limited by" names the role that really runs out.',
      'The flight sheet\'s Sub-charter button is now called Sub-lease.',
    ],
  },
  {
    version: 'v0.11.1',
    name: 'Crew planning',
    features: [
      'Busy months ahead: the Crew screen warns before a month your signed work needs more crew than you will have, for example "July needs 3 more A320 cabin crew (about 1 set) and 1 captain". It looks three months ahead and counts days off, leave, courses, standby and crew still joining, each person once, as in Planning and Hire.',
      'The warning comes in time to act: about six weeks ahead for cabin crew, and as long ahead as a new pilot takes to join (about 12 weeks for an A320 captain). A serious gap shows as a card with Hire buttons already filled in; a small one is a quiet line. One Inbox note per busy month, never daily, and the crew desk head proposes the same hires.',
    ],
    improvements: [
      'After a diversion the crew fly on with the passengers when their day allows; otherwise they rest at the hotel there and the rest of the trip gets a crew.',
      'A flight that lands a few minutes past the duty limit because of headwinds is recorded as the captain\'s discretion, as EASA allows after take-off on the last flight.',
    ],
    fixes: [
      'Crew who land late always get their full rest: a ticket home or on to the next trip that would cut into it is rebooked for after it.',
      'The weekly 36-hour rest always comes within 7 days: it counts from an early airline ticket out, a private jet check-in is 30 minutes, and a ticket home waits until it fits 60 hours of duty in 7 days (travelling as a passenger is duty).',
      'Annual leave starts at home: crew away from base are flown home first; if they can only land on the first day, the leave starts when they land and keeps all its days.',
      'Crew stuck "on duty" for days after a diversion while the next flight waited for a rescue crew: fixed, and saves are repaired on load.',
      'Rest after a standby that was not called follows the EASA rule (airport standby as long as the standby, hotel or home 12 h at home and 10 h away); a duty that starts as a standby ends counts as a call-out.',
      'A hotel standby is always where the crew member is, with the rest it needs after a flight home.',
      'Crew who resign while away are flown home before they leave the company.',
      'A trip joining two jobs always carries our own cabin crew where the client brings none; crew no longer ride our own empty flight into a day too long for their rest.',
      'A return flight moved ahead of its outbound is planned again, so no crew "fly" from an airport they never reached.',
    ],
  },
  {
    version: 'v0.11',
    name: 'Operations',
    features: [
      'Live operations: weather diversions (pick the alternate on a map), medical emergencies, bird strikes, ATC slots, slow turnarounds, curfews and crew falling sick away from base, each with a card and choices.',
      'Ramp inspections (SACA in Europe, the local authority elsewhere) and a yearly audit by your authority. Findings come with a fix, a cost and a deadline. Company › Safety & audit keeps it all in one place.',
      'Pace setting (Calm, Normal, Busy): quiet spells of a few days between busy ones, so you can watch the planes fly.',
      'Urgent phone calls: a high-paying job that must start within three days rings through. The game pauses; answer, decline or see the details.',
      'Name and register new aircraft when you lease or buy them (the country prefix is fixed, you choose the rest).',
      'A light theme: Settings › Appearance offers Light, Dark or System.',
      'The map: day and night from the real sun, with city lights after dark; every aircraft drawn from above as its real type, engines tucked under the wing like Flightradar24, sized by the real aircraft and coloured by family (A320 blue, 737 green, 777 orange, 747 yellow…; the key is under the map\'s ?); solid lines behind an aircraft, dashed ahead, and a contrail at cruise; a storm, cloud or moon mark on an airport closed by weather, a curfew or an event.',
      'Spotter mode: the binoculars on the Map follow one aircraft in the air, big in its livery against the local sky, with its flight, route, altitude, speed and landing time. Next, or a new one every minute.',
      'Hangar: Fleet › Hangar lines up the whole fleet side by side to scale. Tap one for its card.',
      'Welcome to the fleet: a new aircraft arrives with a full-screen card, big in our colours under the sky where it was handed over.',
      'Ferries follow ETOPS like a real airline: without the approval a twin stays within 60 minutes of an airport, so deliveries from North America come home the northern way (Greenland, Iceland, Ireland), with fuel and night stops. A crossing we may not fly is flagged before you sign, with what real operators do instead.',
      'Finance charts: revenue and costs for the last 12 months, and cash at each month end.',
      'Profit per day under the cash in the top bar, green or red. Rent, insurance, overhead and salaries are spread over the month so it does not jump on the 1st.',
      'Rank marks beside crew names (captain 4 stripes, first officer 3, relief pilot 2, purser gold wings, cabin crew silver wings), and airline tickets shown as boarding passes.',
    ],
    improvements: [
      'Approvals: ETOPS 120, Widebody operations and the other steps now ask for technical dispatch reliability (97–98.5 %) instead of a spotless AOG record, and an ETOPS maintenance programme ($90K, 45 days).',
      'Clients moved to the Contracts screen (Market · Active · Missed · Clients).',
      'Callers have names that fit their country.',
      'Registration flags are flat rectangles.',
      'The home screen says Online in green when you are online.',
      'Hiring: dual-rated cabin crew count once (in the family they were hired for first), so training crew on a second type no longer shrinks your sets; Round up stays at zero after one press.',
      'The Fleet card\'s ETOPS line says what the rules really use ("capable of 120 min · approved 60 min → ferries go the northern way").',
      'Finance › Profit also shows the month after month-end costs.',
      'The Schedule shows the flight number and route inside a block when it fits, and the key explains sub-chartered (outlined) flights.',
      'Screen tips fold into a small ? after the first time.',
      'Map labels fade where many aircraft crowd one airport (the selected one keeps its label); airline flights carrying our crew show the airline\'s own type in grey.',
      'Wording: the curfew card names the airport (Gatwick, not London); a job on one day shows one date; leases say "months".',
    ],
    fixes: [
      'Minimum rest away from base: a standby that was called out could be treated as cut short, showing "rest 0:09 < 12:00". A call-out from standby needs no rest in between; saves are repaired on load.',
      'Crew were released while still in the air after a late landing; duties now end at the real landing, a late landing counts as commander\'s discretion, and crew who land after their ticket home has gone get a new one.',
      'The game could keep pausing straight after Play (an empty flight after an AOG, or a curfew diversion, re-planned again and again).',
      'BLU404-style curfew diversions no longer plan a flight back into the curfew, and a crew-short card is not asked again every 30 minutes.',
      'One captain could end up in both pilot seats after Swap crews.',
      'Hotel standby is always in the city the crew member is in; crew no longer fly home on the first morning of their leave.',
      'Pilots flying out to collect an aircraft across 4+ time zones get their full 14 h rest.',
      'Finance no longer shows a 90-day low above today\'s cash; long aircraft names no longer wrap the registration.',
      'A long airspace closure no longer slows the game to a crawl, and flights waiting it out are not cancelled with compensation.',
      'When a client moves a flight later, the crew\'s airline ticket to it moves too (it could leave them over their duty limit); a ticket home after hotel standby waits for the full rest.',
    ],
  },
  {
    version: 'v0.10.1',
    name: 'Liveries',
    features: [
      'Paint redone: it covers exactly the tail, the body and the engine cowlings. The belly colour runs under the wing, exhausts stay bare metal, and the finish has a gloss band along the body and a reflection on the tail.',
      'New looks: Classic belly and Two-tone, a nose band, a stripe at the tail root and a line where two colours meet.',
      'Every aircraft carries its registration and flag where real ones do (by the last door), with the model name beside it. Options: the registration on the tail, a fleet number at the top of the tail, and logos on the engines or by the nose.',
      'Clients who ask for their paint now get their real livery: their colours, layout and name as on their own aircraft. Governments fly in their national colours, the UN in white with black titles.',
    ],
    improvements: [
      'The planet logo is gone; aircraft that wore it now show the globe.',
    ],
    fixes: [
      'A flight could be pushed back again and again ("Waiting for a rescue crew") when a crew member had missed the ticket to it. Crew who miss a ticket are now re-ticketed or replaced in time; if nobody can go, you get the crew-shortage decision at once. The flight sheet shows where the missing crew member is, and saves are repaired on load.',
    ],
  },
  {
    version: 'v0.10',
    name: 'Fleet art',
    features: [
      'New aircraft art: every type is redrawn, in full detail.',
      'Body colours: paint the fuselage, the belly (choose where it starts and its angle), up to three stripes (along the windows or anywhere, any width, sweeping up the tail if you like) and the nose. The tail keeps its own two colours; the engines get their own colour and an intake ring. Four quick looks to start from: Eurowhite, Classic cheatline, Full colour and Belly band. Windows, doors and panel lines still show through, and the paint, titles and logos follow the aircraft\'s own lighting.',
      'Some aircraft differ from others of their type, as in real life: A330-200s and 747-400s come with different engines, and early A321neos have four pairs of doors instead of the overwing exits. The Fleet card shows the engines.',
      '15 more types on the market: the 737-900ER, 757-300, A330-900, A340-200, A340-500, A340-600, A350-1000, 787-8, 787-10, 747-8 and the 747-100, -200 and -300 (very rare; two pilots fly them here, the real ones had a flight engineer too); the 777-9 as a rare new-build slot only, and the 777-8 from about 2030.',
      'Each new type has its own numbers: seats, range, crew, rest areas, rates, fuel, rent, value, checks and how often it comes up.',
      'Crew numbers corrected for every type, from the type certificates: an A330 or A340 needs 8 cabin crew up to 400 seats and 9 above (not 1 per 50 seats), a 777-300ER 10, an A380 16, a 747-400 13.',
    ],
    improvements: [
      'Each aircraft has a set number of crew seats. Extra cabin crew stop there; crew the client asks for beyond them sit in passenger seats, which are not sold.',
      'The 777-200LR is gone. If you had one, it is now a 777-200ER.',
    ],
  },
  {
    version: 'v0.9.1',
    name: 'Tuning',
    features: [
      'Calm background music (Settings → Sound to change the volume or turn it off).',
      'Real cabin chimes, recorded on board: HI-LO for a new contract offer, one HI when something needs you, two HIs for an emergency, three for an urgent one, one LO for calm news, two LOs for good news. Pause and resume are silent.',
      'Every chime now shows what it is for: a note in the lower right (and in the Inbox). Notes stay 5 seconds; tap one to close it.',
      'When a client answers your counter-offer, the reply pops up wherever you are, with Accept and Decline.',
      'The offer window shows each aircraft’s schedule around the job. Move a trip to another aircraft right there to free one up.',
      'A new aircraft arriving is a moment: a card with it in your colours, then you can follow its delivery flight on the map.',
    ],
    improvements: [
      'Fewer crew alerts: a long trip away from base now changes crews at the station halfway, instead of waiting for one crew that could never legally fly it all.',
      'Clearer warning when a short-notice charter can’t be crewed in time: “No crew can reach Dubai before the 05:00 report”.',
      'Flights out of a closed airport now wait for the reopening before the crew are called in, so the crew rest at the hotel instead of sitting on duty.',
      'An empty aircraft at a quiet station leaves when a crew can get there, not before.',
      'Days off: a crew swap or a re-plan never takes the last days off a month needs, even on its last day.',
      'A little faster simulation.',
      'Crew never fly home past the weekly rest limit, even when their last flight was handed to another airline.',
      'Big full jobs suit an old 747 better: Hajj, troop, UN and full charters take any widebody cabin with the seats, the client pays the fuel it burns, and more of them come when your 747 is free.',
    ],
  },
  {
    version: 'v0.9',
    name: 'Experience',
    features: [
      'Department heads: earn them by flying well, then hire one. An Ops Control duty manager, a maintenance planner, a crew scheduling desk, a commercial analyst, credit control, a fleet planner and a watch desk for your own alerts. Each takes routine work off your desk, makes the odd mistake, and never decides the big things.',
      'Achievements: 24 milestones on the Company screen, with a quiet note when you earn one.',
      'Sound: real cabin chimes. A high chime for news, a low chime for calm moments, the high-low bing-bong for a new contract, double for a problem that needs you soon, triple for a serious one, and one urgent alarm for crew shortage and crew out of hours. Settings has a volume, categories and a test list.',
      'Crew out of hours: its own alert when a pilot or flight attendant reaches a legal limit, naming who, which limit and by how much, with the fixes.',
      'Crew change at a fuel stop: a long one-way flight can now split with a fresh crew flown in to the tech stop, priced into the offer and planned by the roster.',
      'First-time hints on each screen, written for people who know the job.',
      'Roster planning like a real EASA operator: crews get 8–10 days off a month in 2–3-day blocks (one block a week is the 36 h rest) and 4 weeks’ leave, published 14 days ahead and protected. Every other free day is standby: at home, at the hotel on a detachment or night-stop, at the airport at busy bases, or reserve. Crew Control calls standby first.',
    ],
    improvements: [
      'Captain’s discretion is never planned: it only appears after the crew has reported, for something unforeseen, and the longest day says so.',
      'Shorter, plainer texts across the game.',
      'A delay after the crew has reported now re-checks the in-flight rest at departure.',
      'Jumbo loads (420+ seats) for the 747-400 and other 450-seat jets, and charters with fuel billed at cost, so a well-chosen Hajj, troop or UN job pays.',
      'What’s new catches up: the first start after an update also shows the notes of the versions you skipped, once.',
    ],
  },
  {
    version: 'v0.8',
    name: 'World',
    features: [
      'Clients remember you: New → Known → Trusted → Partner. Trusted clients pay more, ask you first, pay sooner and forgive a small delay; favours like an extra rotation now count.',
      'A new airline starts with the work nobody wants: short, cheap, odd hours. Fly it well and better offers come.',
      'New work: Hajj airlifts that move 11 days earlier every year, UN rotations for a year or two, presidential flights, deportation flights (well paid, but your crews and reputation pay too), evacuations with war-risk insurance, medical airbridges, music tours and Antarctica on blue ice.',
      'Real rivals with their own styles bid for the same jobs, sometimes win (and you’re told why), and hire each other — and you.',
      'The market moves: booms and slumps, fuel, seasons and Hajj. A simple outlook on the Contracts screen.',
      'The world happens: coups, strikes, ash clouds, disasters, airline failures and closed airspace in real places, with urgent work and real risk. Closed airspace is shaded on the map.',
      'Dry leases: rent an aircraft to another airline without crew; your pilots deliver it and fetch it back.',
      'Mixed crews: the client brings most of the cabin crew, like Getjet’s A330 for Air Sénégal; you fly the purser.',
    ],
    improvements: [
      'Favours and change requests now say what they do for the relationship.',
      'The timeline says when a base programme simply continues instead of ‘nothing booked’.',
    ],
    fixes: [
      'Seats match passengers: a job for 166 people needs 166 seats, not 170.',
      'A job that wants a widebody says so, and a narrowbody is no longer shown as fit for it.',
      'No more offers with a day longer than any crew may fly.',
      'The private jet is only offered when it gets the crew there sooner than a cheaper option.',
      'An aircraft in a cabin refit shows ‘in refit’, not ‘in check’.',
      'The Boeing 747-400 is back on the market: cheap to lease, thirsty, four engines, no ETOPS limits, 500 seats for Hajj.',
      'No more freeze when an aircraft back from an AOG needs a long empty flight with a fuel stop.',
      'Used aircraft come with their own type’s hours and cycles: a 747-400 logs about one cycle per 8–9 hours.',
    ],
  },
  {
    version: 'v0.7.4',
    name: 'Crew & Cabin',
    features: [
      "Crew planning: a new Planning view on the Crew screen shows, for each aircraft type, how many full crews (crew sets) you need, how many are complete now and with the people joining, and which role is short. One line says it all: 'A320 family: 4 aircraft · 5 sets each = 20 sets needed · you have 18 complete · short 2 CPT, 1 PUR, 2 CC'.",
      'Round up: one button hires exactly the crew that complete your sets (or rounds up to the next full set), with the type ratings, join dates, total cost and the monthly payroll change, and one confirm.',
      'Cabin crew who hold two types are counted once, where they are needed most, and shown as shared.',
      'Cabin changes are now realistic: changing between the normal layouts (all economy, business and economy) is a quick reconfiguration of about 48 hours for tens of thousands of dollars. Only a VIP cabin with new premium seats is the long, expensive job.',
      'Clients may ask for their own cabin on long contracts ("they want a two-class cabin"), done in 48 hours before the start at their expense (all or half, often putting it back after too), shown on the offer like a paint job.',
      'Every aircraft can rest its crew: curtained economy seats on all of them (narrowbodies too), and curtained business seats on any aircraft with a business cabin. They are not lost seats: they are only blocked on flights where someone actually rests. Refit to two-class and business-seat rest comes with it.',
      'The Boeing 767-300ER never has crew bunks any more, as in real life. Bunks always come as a pair: pilots and cabin crew together.',
    ],
    improvements: [
      "Fleet cards show the longest day in short: '13 h · up to 17 h'. Tap 'Longest day' for the details (the extension, who rests where, the approval).",
      'The crew rest marks are gone from the aircraft drawings: the rest is in the text rows.',
      'Crew rest recliners now count as class 2 rest, so they are a real upgrade on an all-economy cabin. Bunk refits fit pilots and cabin crew together.',
      "Old saves: a 767 that showed bunks loses them, with an inbox note, and any long duty that needed them is re-planned. Everything else carries on as it was.",
    ],
  },
  {
    version: 'v0.7.3',
    name: 'In-flight Rest & EASA',
    features: [
      'In-flight rest is now real: every widebody has its own rest for pilots and for cabin crew (bunks, business seats or recliners), and long days only work if everyone can actually sleep on the way.',
      'Tap any long flight to see who rests when, where and for how long: pilots by name, cabin crew in groups, and whether the plan is OK, tight or impossible.',
      "Every aircraft shows its longest possible day: '16 h with 3 pilots · 17 h with 4'. The Market can show only aircraft with bunks.",
      'Crew rest refits: curtain off business seats, fit recliners (also on the A321LR and 757), a lower-deck bunk module on the A330/A340, or a bunk room for the pilots with the next C-check.',
      'Planned extensions (+1 h, twice a week), split duties on long ground waits and home standby crew you can call in without overtime.',
      'The rest rules you know: a local night’s sleep before an early start after a late finish, two-day weekends twice a month, and recovery nights at home after trips across time zones.',
    ],
    improvements: [
      'The EASA rules were checked line by line against the current regulation: the cabin crew rest table ends at 18 h, rest after any augmented day is at least 14 h, and the captain’s discretion is only for surprises on the day.',
      'Contract checks use the real limit for the report time and each aircraft’s rest, and say exactly what a long job needs.',
      'Delays announced before the crew leave the hotel keep the original day limit, as the rules say.',
      'Ultra-long-range offers only go where a crew may legally fly (18 h at most, with 4 pilots and bunks for pilots and cabin crew), and say plainly what they need.',
      'Small fixes: the WHY? dot is easier to read, lists clear the iPad’s home bar.',
    ],
  },
  {
    version: 'v0.7.2.2',
    name: 'Check planning',
    features: [
      "Drag A/C checks and cabin refits along the timeline: on the Schedule, hold a booked A-check, C-check or cabin refit for a moment, then slide it left or right along its aircraft's row. While you drag you see the new date and, for checks, how much of the interval is used by then (green, amber, red; over 100% is not allowed) and whether the slot is free. Let go to confirm.",
      "Book from an idle gap: tap an 'idle …' gap and choose Book C-check, Book A-check or Cabin refit. Each opens with a slot inside that gap, and the check buttons show how much of the interval would be used by then and when it is due, so you can book at the right time.",
    ],
    improvements: [
      "Moving a trip to another aircraft now also removes the first aircraft's ferry flights for it (out to the trip and back), and re-plans its next ferry only if it is really needed.",
    ],
  },
  {
    version: 'v0.7.2.1',
    name: 'Trip swap',
    features: [
      "Move a trip to another aircraft: on the Schedule, hold a flight for a moment, then drag it onto another aircraft's row. The whole trip goes with it (out and back, like DUB–DUS–DUB). The row turns green when that aircraft can take it, red with the reason when it can't.",
      "Before anything moves, a pop-up shows whether you gain or lose money and why: revenue, fuel, maintenance, airport fees, ferry flights, crew tickets and hotels, side by side for both aircraft, plus the crew who change and what the first aircraft is free for.",
      "No dragging needed: tap a flight and choose 'Move trip to…' to see every other aircraft with what the move would earn or cost.",
    ],
    improvements: [],
  },
  {
    version: 'v0.7.2',
    name: 'Crew Rules & Fleet',
    features: [
      'Real EASA flight time rules for pilots and cabin crew, written up from the regulation: duty limits by report time and sectors, in-flight rest by rest facility class, rest, and the yearly limits.',
      "Crew rest per aircraft: some widebodies have bunks, some don't. Without bunks you can curtain off the last economy row as crew rest seats; they still sell when nobody needs to rest.",
      'Pursers and cabin crew: CSD and SCC are now simply PUR, the purser in charge of the cabin: one on every flight (two on the A380 and 747).',
      "Captains can fly as first officers when no first officer is free. They keep their pay, but don't like it more than twice a month.",
      'Hire flight attendants for up to three aircraft types at once; they join in about a week.',
      "Sell owned aircraft and hand leased ones back early. 'Which one?' points at the least used.",
      "C-checks at real maintenance hubs: Sofia, Malta, Miami, Amman, Manila and more. Your pilots ferry the aircraft out, fly home on airline flights and fetch it when it's done.",
      "A live strip in the top bar: warnings first, then aircraft airborne, the next departure, today's on-time and where your crew are.",
    ],
    improvements: [
      'Sub-chartering now costs reliability: clients notice when someone else flies their passengers.',
      'Contracts have real names: TUI summer programmes, Jet2 weekend rotations, ski charters, peacekeeper rotations.',
      'Market alerts live on the Market page; a new offer shows in the top bar.',
      'Cabin refits start as soon as the aircraft is free, at your home base.',
      'Up Next is a compact departures board you can fold away.',
      'The white dot stays on a city while any of your crew are still there.',
    ],
  },
  {
    version: 'v0.7.1',
    name: 'Crew Control',
    features: [
      'Crew shortages are a real situation: an amber warning two days out, a red one with a pause 12 hours before departure, and a CREW SHORTAGE banner on the flight wherever you look.',
      'Crew Control: exactly which seats are missing and nine ways to fix it, each with its cost, timing and knock-on effects, with a preview and one tap to apply: auto-fix, fly someone in, delay, charter a private jet, call in standby crew, commander\'s discretion, swap crews, sub-charter or cancel.',
      'Private jets: charter a business jet from a real operator to position a crew in hours; it flies on the map like any other flight, with its own icon.',
      'Every problem now tells one plain story: what is wrong, why in one sentence, whether it hurts (money, passengers, delay) and what you can do. Crew, maintenance, contracts, money and aircraft.',
      "Pictures instead of jargon: a reach bar for 'can\'t get there in time', fuel-gauge bars for duty limits, a mini-map for who is where.",
      'Tap any aviation term for its meaning; a Glossary under Settings; a WHY? on every red or amber dot; a one-time hint the first time each kind of problem appears.',
    ],
    improvements: [
      "The Inbox has a 'Problems only' filter and an Explain button on every warning.",
      'Crew candidates show one reason each (busy, resting, sick, wrong place…) with an icon.',
      'Crew-short wait estimates use the real airline timetable.',
      'Colour legends on the Schedule, the Roster board and the map.',
    ],
  },
  {
    version: 'v0.7.0',
    name: 'Fleet & Ladder',
    features: [
      'An aircraft market: used aircraft for sale, leases from real lessors and rare new-build slots. Offers are scarce and stay open for days.',
      'Aircraft are handed over where the seller is. Your pilots fly out on real airline flights you can follow on the map, then ferry the aircraft home with fuel stops and night stops.',
      'Optional market alerts: an Inbox message, a quiet toast and auto-pause (Settings).',
      'Cabin refits: all-economy, two-class or VIP. The layout decides which contracts you can bid for.',
      'Lease returns: extend the lease, or return the aircraft at the lessor with its return check and costs.',
      'The Ladder on the Company screen: ETOPS 120, 180 and 240, widebody operations, augmented crews and ultra-long-haul. Each step opens bigger aircraft and better work, with a celebration when granted.',
    ],
    improvements: [
      'A bulk conversion that would leave you short of legal crew now asks "Book anyway?".',
      'A smoother roster board at 4×.',
      'More realistic airlines on deadhead flights.',
      'A flight no longer says "Crew illegal" or shows an amber dot when its crew are fine; the flight sheet says why when they are not.',
      'Crew who can take a later same-day flight are offered for a duty; refusals give the real reason with times.',
      'A booked check can be moved; each date shows how much of the interval will be used by then.',
      'A "Top bar spacing" setting for the frosted strip iPadOS adds to home-screen apps.',
    ],
  },
];

export const CURRENT = WHATS_NEW[0];

/** 'v0.7.2.1' → [0, 7, 2, 1]; null when it isn't a version. */
const parts = (v: string): number[] | null => (/^v?\d+(\.\d+)*$/.test(v) ? v.replace(/^v/, '').split('.').map(Number) : null);
/** a newer than b (missing parts count as 0). */
const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

/**
 * v0.8 fix pack: the entries the update popup shows, newest first: every one newer than the last seen version (a
 * player jumping from v0.7.3 sees v0.8 and v0.7.4); the newest alone when nothing was seen yet; none when up to date. Pure.
 */
export function unseenEntries(seen: string): WhatsNewEntry[] {
  const s = parts(seen);
  if (!s) return [CURRENT];
  return WHATS_NEW.filter((e) => newer(parts(e.version) ?? [0], s));
}

/** The last version before the v0.9 catch-up window (everything newer shows once on the first v0.9 launch). */
const CATCH_UP_AFTER = 'v0.7.3';

/**
 * v0.9 catch-up (UPDATE-0.9.md §X): on the first v0.9 launch every entry newer than v0.7.3 (v0.9, v0.8, v0.7.4), newest
 * first, even if v0.8 was seen (from an older version: everything since it); afterwards unseenEntries. A fresh install
 * ('' seen) gets CURRENT only. Pure.
 */
export function whatsNewToShow(seen: string, catchUpDone: boolean): WhatsNewEntry[] {
  const s = parts(seen);
  if (!s) return [CURRENT];
  if (catchUpDone) return unseenEntries(seen);
  const floor = parts(CATCH_UP_AFTER)!;
  const from = newer(s, floor) ? floor : s;
  return WHATS_NEW.filter((e) => newer(parts(e.version) ?? [0], from));
}
