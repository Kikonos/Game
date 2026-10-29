# What's new — drafts (not yet in src/data/whatsNew.ts)

## Visual A: the map (Visual improvements, batch 1)

features:
- Day and night on the map: the night side follows the real sun for the date and time, with a soft twilight band. City lights come on after sunset.
- Every aircraft is drawn from above as its real type, in its tail colour: the right engines in the right places, and bigger aircraft bigger. The 747's hump and the A380's double deck show from above.
- Flight lines: solid for the part already flown, dashed for the part still to fly, and a short contrail behind aircraft at cruising height.
- Weather on the map: an airport closed by weather, a curfew or a world event gets a small storm, cloud or moon mark until it reopens. Tap it to see what is going on.
- Spotter mode: tap the binoculars on the Map to follow one aircraft in the air. A panel shows it in its livery with its flight, route, altitude, speed and landing time. It moves on to another aircraft every minute, or tap Next. Nothing changes in the game while you watch.

improvements:
- Contrails and the gliding night follow the Map animations setting and the system's Reduce Motion.

## ETOPS on ferries (engine, after Visual A)

features:
- Ferries and empty legs now follow ETOPS like a real airline: without an ETOPS approval a twin stays within 60 minutes of an airport, so a delivery from Canada or the US comes home the northern way (Kangerlussuaq, Iqaluit, Keflavík, Shannon), with fuel stops and night stops on the map and in the Schedule. With the approval and a capable aircraft it flies direct.
- A crossing we may not fly (a twin across the Pacific without ETOPS 180) is said before you sign, with what real operators do: get the approval first, take the aircraft on this side, or pay a ferry company to bring it home.

improvements:
- The Fleet card's ETOPS line says what is really used, e.g. "capable of 120 min · approved 60 min → ferries go the northern way".
- Pilots flying out to collect an aircraft across 4+ time zones now land with their full 14 h rest (deliveries from North America no longer wait for ever).

## Visual B: fleet, people and money (Visual improvements, batch 2)

features:
- Hangar view: Fleet › Hangar lines up every aircraft side by side to scale, from the real lengths, in its livery with its registration and name. Tap one to open its card.
- Welcome to the fleet: when a new aircraft is handed over, a full-screen card shows it big in our colours, under the sky at the handover airport, with its name, registration, type and where it was delivered. Tap ✕ to skip.
- A local sky behind the aircraft: on the Map panel and in Spotter mode the side view stands against dawn, day, dusk or night at the airport where it is (or where it lands), from the real sun. At night there are a few stars and the aircraft is softly lit.
- Finance charts: revenue and costs for the last 12 months, and the cash at each month end in its own small chart. Tap or hover for the figures.
- Rank marks: gold stripes beside pilots' names (captain 4, first officer 3, relief pilot 2), gold wings for pursers and silver wings for cabin crew.
- Boarding passes: an airline ticket (deadhead) in the Crew screen and on the roster board shows as a small boarding pass with the airline, flight, times, date, seat and passenger name.

improvements:
- Schedule: flight blocks show the flight number and route whenever they fit, on two lines in a narrow block. A label is never cut off.
- Screen tips: after you have seen a screen's tip once, it folds into a small ? button on that screen. Tap ? to read it again.
- Map: where many aircraft crowd one airport, labels that would pile up fade out. The selected aircraft always keeps its label.
- Airline flights carrying our crew are drawn as the airline's own type from above, in grey (a 737 for Ryanair, a widebody on long flights). The diversion card's small map shows our aircraft in its family colour.

fixes:
- Owned aircraft cards no longer show an empty double line under the livery row.

## Crew planning round (after v0.11)

fixes:
- Crew who land late now always get their full rest. Their airline ticket home (or on to the next trip) is rebooked for after the rest, instead of leaving while they are still resting.
- Annual leave starts at home. Crew away from base are flown home before their leave. If a late flight means they can only get home on the first day, the leave starts when they land and keeps all its days.
- After a diversion, the crew fly on with the passengers when their day allows. Otherwise they rest at the hotel there and the rest of the trip gets a crew. No more crew stuck "on duty" for days while the flight waits for a rescue crew.
- The weekly 36-hour rest is counted from when the crew really start work (an early airline ticket out counts), so it can no longer stretch past 7 days.
- A trip that joins two jobs now always carries our own cabin crew on the flights where the client does not bring theirs. (A charter could be crewed with pilots only.)
- Crew no longer ride our own empty flight out to a far-away job when it would land too late for their rest. They take an airline ticket the day before instead.
- Crew on standby who are given a duty starting when their standby ends now count as called out, as the rules say.
- A crew whose duty got shorter overnight are now signed off on time, where they really are.
- A private jet ride now counts from its 30-minute check-in, as it was planned. The weekly rest before it no longer comes up 10 minutes short.
- Crew sent home after a long week away now wait at the hotel until the flight home fits their 60 hours of duty in 7 days. (Travelling as a passenger counts as duty.)

## Peak staffing round (after the crew planning round)

features:
- Busy months ahead: the Crew screen now warns before a month your signed work needs more crew than you will have, for example "July needs 3 more A320 cabin crew (about 1 set) and 1 captain". It looks three months ahead and counts days off, leave, courses, standby and crew still joining. Each person is counted once, as in Planning and the Hire screen.
- The warning comes in time to act: about six weeks ahead for cabin crew, and as long ahead as a new captain or first officer takes to join (about 12 weeks on the A320) for pilots. A serious gap (a whole crew set, any pilot, or too late to hire in time) shows as a card that says what, why, whether it hurts and what you can do, with a Hire button already filled in. A small gap is one quiet line with its own Hire button.
- One Inbox note per busy month and gap, never repeated daily. Tap it to open Crew › Planning.
- The crew desk head proposes hires for a busy month from the same numbers.

fixes:
- Crew sent home from an outstation no longer keep a hotel standby planned there, and a standby after a flight home now waits for the rest the flight needs.
- Crew who resign while away are flown home before they leave the company. If they can only land after their last day, their notice ends when they land.
- A flight that lands a few minutes past the crew's duty limit because of headwinds is now recorded as the captain's discretion, as EASA allows after take-off on the last flight of the day.
- Crew whose leave starts within a few hours at an outstation are flown home first; the leave starts when they land.
- A trip whose return flight is moved ahead of its outbound is planned again, so no crew "fly" from an airport they never reached.

## Every device: iPhone, iPad, Mac and Windows (after the hangar from above)

features:
- The game knows which device you play on: iPhone, iPad, Mac, Windows (or another computer), whether you use touch, a mouse or trackpad, or both, and whether it runs as a home-screen app. Settings › Display › Device shows what it found ("Auto: iPhone") and lets you pick iPhone, iPad or Computer if it guessed wrong.
- iPhone on its side: the sections run down the left edge beside a one-line top bar, clear of the Dynamic Island and the home indicator. Screen titles share a line with their summary, toolbars slide sideways, Up Next shows three rows and the roster board gets the height.
- Holding the iPhone upright shows a calm "Turn your phone sideways" card (you can still play upright).
- Mac and Windows: Space pauses and plays, 1, 2 and 4 pick the speed (never while you type), Esc closes a window. Settings lists the keys.
- Settings › Display › Size: Smaller, Normal or Larger. Auto picks Larger on a big screen such as a 27" monitor; text, buttons, the map and the schedule all grow together, and dragging still lands where you point.

improvements:
- The map's aircraft strip, zoom buttons and side panel stay clear of the home indicator on the iPad home-screen app as well.
- On a narrow schedule the hour labels step aside so the dates never overlap.
- A warning in the top bar that does not fit shortens to its icon instead of being cut off.
- Windows: room is kept for the scrollbar so screens never jump sideways; scrollbars are thin and match light and dark.
- The iPadOS top-bar spacing only applies on the iPad.

## Sub-lease, and the flights in the offer's schedule (player request)

features:
- Sub-lease: another operator flies a trip for us and the client still pays us (in the trade, a sub-charter). It sits next to swapping aircraft: tap a trip under an aircraft in a new offer, in the trip move confirm, or in a flight's sheet. You see up to three operators with their quality, price, what we still bill and how much the client notices, or why it can't be done (less than 6 hours to go, already under way, a ferry or empty leg, no operator free).
- When a new job doesn't fit because the aircraft is busy, "What you can do" offers to sub-lease the trips in the way. Afterwards the offer checks the aircraft again, just as after moving a trip.

improvements:
- The schedule under each aircraft in an offer shows every flight on its own: it is wider and scrolls sideways, and opens on the job. Only work without flights yet (the later days of a base programme, a dry lease) stays one block.
- Flights in the way of the new job have a red outline, and the chosen aircraft lists those trips with Move and Sub-lease, plus "Sub-lease all".
- A trip lifted onto another aircraft scrolls the offer when you hold it near the top or bottom edge, and a swipe on the timeline scrolls it instead of picking a trip up.
- The flight sheet's Sub-charter button is now called Sub-lease and opens on this trip, with the reason when the trip can't be handed over.

## Crew sets review (player request: "weird numbers and sets, especially when flight attendants hold multiple types")

fixes:
- Hire crew now counts everyone the way Crew › Planning does, so both screens show the same numbers for every type.
- Pilots rated on two types (777 and 787, A330 and A350) are counted once, not in both fleets. Before, Hire could say the 787 needed 1 more captain when it needed 3.
- Relief pilots you have hired now count in Hire (with the first officers, whose need includes their seats). Before, a fully crewed augmented fleet could show "FO 5 of 8 needed".
- Spare pursers fill cabin crew seats: the cabin crew row reads "exact, with 2 PUR" instead of "short 2" on a complete family. Round up no longer offers a whole extra set because of two spare pursers.
- A flight attendant on two types is not kept on their home fleet for a seat a spare purser already fills. They count where the other fleet is short.
- With a mixed-crew contract (the client brings some cabin crew), Round up no longer offers sets you don't need (it could say "Round up to 14 sets" with 10 needed and all complete).
- "Limited by" names the role that really runs out, with spare pursers working cabin crew seats.
- The backup lines say when flight attendants hired for one fleet are counted in another because their own fleet has all it needs. Before, they were said to be counted "where they were hired".
- The crew strip shows "5 of 5 sets · 4 spare" instead of "9 of 5 sets" when you have more crew than you need (for example with an aircraft away on a dry lease).
- Hiring a relief pilot shows the first officer and relief pilot numbers instead of "none in the fleet".
- When an offer checks whether you have enough crew, a flight attendant on two types is counted in one fleet only. Before, someone your A320 sets need could also count as free for an A330 job.
- The busy-month heads-up counts each person once (pilots on two types and crew who have handed in their notice included).
