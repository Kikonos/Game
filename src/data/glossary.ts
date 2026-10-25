// v0.7.1 plain-language glossary (UPDATE-0.7.1.md §11) and the first-time hints (§10). One table: the UI's <Term>
// renders GLOSSARY[id].term and shows `short` in a popover; the Glossary screen lists every entry with "Show me".

import type { ProblemKind } from '../engine/core/types';

export type TermId =
  | 'fdp' | 'deadhead' | 'positioning' | 'tight' | 'discretion' | 'acmi' | 'wetLease' | 'subcharter' | 'aog' | 'standby' | 'rest' | 'blockHours'
  | 'mgh' | 'ferry' | 'augmented' | 'etops' | 'aCheck' | 'cCheck' | 'perDiem' | 'recovery' | 'privateJet'
  /** v0.7.2 */
  | 'pur' | 'cabinCrew' | 'crewRest' | 'restClass1' | 'restClass3' | 'restSeats' | 'mro' | 'dryLease' | 'asFo' | 'marketValue' | 'earlyReturn'
  /** v0.7.3 */
  | 'restClass2' | 'fcrc' | 'ccrc' | 'ldmcr' | 'recliners' | 'inflightRest' | 'landingPilots' | 'extension' | 'splitDuty' | 'delayedReport'
  | 'homeStandby' | 'wocl' | 'disruptive' | 'tzRest' | 'twoDays'
  /** v0.8 */
  | 'relationLevel' | 'standing' | 'firstRefusal' | 'hajj' | 'arafah' | 'reserves' | 'dampLease' | 'sccm' | 'warRisk' | 'forceMajeure' | 'subcharterIn'
  | 'marketPhase' | 'blueIce' | 'pnr' | 'injunction'
  /** v0.7.4 */
  | 'ySeats' | 'jSeats' | 'crewSet' | 'quickRefit' | 'clientCabin' | 'longestDay'
  /** v0.9 roster planning (UPDATE-0.9.md §R.10) */
  | 'airportStandby' | 'reserve' | 'daysOff' | 'publishedRoster'
  /** v0.9 */
  | 'outOfHours' | 'slipCrew' | 'departmentHead' | 'jumboLoad' | 'fuelAtCost'
  /** v0.10 */
  | 'exitLimit' | 'flightEngineer' | 'newBuildSlot';

export interface GlossaryEntry {
  term: string;
  /** One line, player words. */
  short: string;
  /** Where the term shows up (the Glossary screen's "Show me"): a UI tab and an optional view inside it (crew: 'board' | 'people'; VIEW_LABEL names it). */
  where?: { tab: 'map' | 'contracts' | 'schedule' | 'crew' | 'fleet' | 'finance' | 'company' | 'inbox'; view?: string };
}

/** Player words for a view id (the "Show me" button). */
export const VIEW_LABEL: Record<string, string> = { board: 'Roster board', people: 'People', plan: 'Planning' };

export const GLOSSARY: Record<TermId, GlossaryEntry> = {
  fdp: { term: 'FDP', short: "Flight duty period: the crew's working day, from report to the last on-blocks. There is a legal maximum.", where: { tab: 'crew', view: 'board' } },
  deadhead: { term: 'Deadhead', short: 'Crew travelling as passengers on another airline to get to their flight.', where: { tab: 'map' } },
  positioning: { term: 'Positioning', short: 'Flying our own aircraft empty to where the work is.', where: { tab: 'schedule' } },
  tight: { term: 'Tight', short: 'Legal, but within 30 minutes or 5% of a limit; one delay breaks it.', where: { tab: 'crew', view: 'board' } },
  discretion: { term: 'Discretion', short: "On the day only: after the crew has reported, if something unforeseen happens, the captain may extend the day by up to 2 h (3 h with an augmented crew). Never planned, never in a contract.", where: { tab: 'crew', view: 'board' } },
  acmi: { term: 'ACMI', short: 'We provide Aircraft, Crew, Maintenance and Insurance; the client pays per block hour, fuel and airport fees.', where: { tab: 'contracts' } },
  wetLease: { term: 'Wet lease', short: 'Same as ACMI: our aircraft and crew fly for the client, who pays per block hour.', where: { tab: 'contracts' } },
  subcharter: { term: 'Sub-charter', short: "Paying a rival airline to fly our client's flight; we still bill the client. Clients notice: each leg handed over costs reliability, more when it becomes a habit.", where: { tab: 'contracts' } },
  aog: { term: 'AOG', short: "Aircraft on ground: broken and can't fly until repaired.", where: { tab: 'fleet' } },
  standby: { term: 'Standby', short: 'On call for the day: at home, at the hotel away from base, or at the airport. Called out, the crew report within the response time. Home and hotel standby count 25 % towards the duty limits, airport standby in full.', where: { tab: 'crew', view: 'board' } },
  rest: { term: 'Rest', short: 'The time off a crew member needs before the next duty: 12 h at home, 10 h away.', where: { tab: 'crew', view: 'board' } },
  blockHours: { term: 'Block hours', short: 'Time from pushing back to parking; what clients pay for.', where: { tab: 'finance' } },
  mgh: { term: 'MGH', short: 'Minimum guaranteed hours: the block hours a wet-lease client pays for every month, flown or not.', where: { tab: 'contracts' } },
  ferry: { term: 'Ferry', short: 'An empty flight with no client: to a check, a delivery or a return.', where: { tab: 'schedule' } },
  augmented: { term: 'Augmented', short: 'A third or fourth pilot so each can rest in flight; allows 14–18 h days depending on the rest facility.', where: { tab: 'company' } },
  etops: { term: 'ETOPS', short: 'Permission to fly far from the nearest airport over water (120, 180 or 240 minutes).', where: { tab: 'company' } },
  aCheck: { term: 'A-check', short: 'A light overnight inspection every few hundred flight hours.', where: { tab: 'fleet' } },
  cCheck: { term: 'C-check', short: 'A heavy check in a hangar every couple of years; the aircraft is out for days.', where: { tab: 'fleet' } },
  perDiem: { term: 'Per diem', short: 'Daily allowance paid to crew while away from base.', where: { tab: 'company' } },
  recovery: { term: 'Weekly rest', short: 'At least 36 hours off, with two local nights, every week.', where: { tab: 'crew', view: 'board' } },
  privateJet: { term: 'Private jet', short: 'A business jet chartered to fly our crew to their aircraft in hours; dear, but fast.', where: { tab: 'map' } },
  pur: { term: 'PUR', short: 'Purser: the senior cabin crew member in charge of the cabin (SCCM). One on every flight.', where: { tab: 'crew', view: 'people' } },
  cabinCrew: { term: 'CC', short: 'Cabin crew: the flight attendants, one for every 50 seats at least. They can hold up to three aircraft types.', where: { tab: 'crew', view: 'people' } },
  crewRest: { term: 'Crew rest', short: 'Where crew sleep on long flights: bunks (class 1, pilots and cabin crew always together), curtained business seats or recliners (class 2), curtained economy seats (class 3). Every aircraft has at least the economy seats.', where: { tab: 'fleet' } },
  restClass1: { term: 'Class 1 rest', short: 'Class 1 rest: a bunk or flat bed away from passengers. Allows the longest duty days.', where: { tab: 'fleet' } },
  restClass3: { term: 'Class 3 rest', short: 'Class 3 rest: a seat behind a curtain, not next to passengers. The game counts curtained economy seats (the rule book asks for 40° recline and a leg rest). The shortest rest days.', where: { tab: 'fleet' } },
  restSeats: { term: 'Crew rest seats', short: 'Seats curtained off for resting crew on long days; sold to passengers on every other flight, so they always count in the seat total.', where: { tab: 'fleet' } },
  mro: { term: 'MRO', short: 'Maintenance, repair and overhaul: the hangar company that does heavy checks.', where: { tab: 'fleet' } },
  dryLease: { term: 'Dry lease', short: 'Renting an aircraft without crew; we fly it on our licence and hand it back at the end.', where: { tab: 'fleet' } },
  asFo: { term: 'Captain as FO', short: "A captain sitting in the first officer's seat because no first officer was free. Same pay.", where: { tab: 'crew', view: 'board' } },
  marketValue: { term: 'Market value', short: 'What a buyer pays for an aircraft today: its type, age, hours, cycles and the next heavy check.', where: { tab: 'fleet' } },
  earlyReturn: { term: 'Early return', short: 'Handing a leased aircraft back before the lease ends: the lessor charges a fee to find the next airline.', where: { tab: 'fleet' } },
  // v0.7.3
  restClass2: { term: 'Class 2 rest', short: 'Class 2 rest: a business seat or crew rest recliner that reclines at least 45°, curtained off from passengers.', where: { tab: 'fleet' } },
  fcrc: { term: 'Pilots’ bunks', short: "The pilots' bunk room by the cockpit (flight crew rest compartment): class 1 rest. Always comes with cabin crew bunks. The 767-300ER never has them.", where: { tab: 'fleet' } },
  ccrc: { term: 'Cabin crew bunks', short: "The cabin crew's bunks, hidden above the cabin or below it: class 1 rest. Always comes with the pilots' bunks.", where: { tab: 'fleet' } },
  ldmcr: { term: 'Lower-deck crew rest module', short: 'A bunk module loaded into the aft cargo hold for the cabin crew (A330, A340): class 1 rest.', where: { tab: 'fleet' } },
  recliners: { term: 'Crew rest recliners', short: 'Deep-reclining crew seats with leg rests in place of the last economy rows: class 2 rest without giving up business seats. They sell as seats when nobody rests.', where: { tab: 'fleet' } },
  inflightRest: { term: 'In-flight rest', short: 'Sleep on board: on long days part of the crew rests in turns while the others work.', where: { tab: 'schedule' } },
  landingPilots: { term: 'Landing pilots', short: 'The two pilots who land the last flight: they need 2 hours’ rest in a row, the others 90 minutes.', where: { tab: 'schedule' } },
  extension: { term: 'Planned extension', short: 'A planned extra hour (up to 14 h), at most twice a week per person, with 4 h more rest after.', where: { tab: 'crew', view: 'board' } },
  splitDuty: { term: 'Split duty', short: "A long wait on the ground (3 h or more) adds half of it to the day; a hotel room when it's 6 h or at night.", where: { tab: 'crew', view: 'board' } },
  delayedReport: { term: 'Delayed report', short: 'Crew told to come later before they leave the hotel: under 4 h the day keeps its original limit.', where: { tab: 'crew', view: 'board' } },
  homeStandby: { term: 'Home standby', short: 'On call at home: 25 % counts as duty; called after 6 h, the day is cut by the standby beyond 6 h.', where: { tab: 'crew', view: 'board' } },
  wocl: { term: 'WOCL', short: "02:00–05:59 body-clock time: the hours we're least alert.", where: { tab: 'crew', view: 'board' } },
  disruptive: { term: 'Disruptive duty', short: 'Early starts (05:00–05:59), late finishes (23:00–01:59) and nights (any time 02:00–04:59).', where: { tab: 'crew', view: 'board' } },
  tzRest: { term: 'Time-zone rest', short: 'After a trip 4 or more time zones away: 2–5 local nights at home before the next duty.', where: { tab: 'crew', view: 'board' } },
  twoDays: { term: 'Two-day weekend', short: 'Twice a month the weekly rest is 2 whole local days.', where: { tab: 'crew', view: 'board' } },
  // v0.8
  relationLevel: { term: 'Relationship level', short: 'How well a client knows us: New, Known, Trusted, Partner (or Unhappy). Higher levels pay better, ask us first and forgive a small delay.', where: { tab: 'company', view: 'clients' } },
  standing: { term: 'Standing', short: 'How the market sees our company: a Newcomer gets the short, cheap work; Established and Respected operators get the rest.', where: { tab: 'company' } },
  firstRefusal: { term: 'First refusal', short: 'The client asks us before any rival: the offer stays ours until it expires.', where: { tab: 'contracts' } },
  hajj: { term: 'Hajj', short: 'The yearly pilgrimage to Mecca: weeks of full flights to Jeddah and Medina, then home again; every other leg flies empty.', where: { tab: 'contracts' } },
  arafah: { term: 'Day of Arafah', short: 'The high point of the Hajj; it comes about 11 days earlier every year with the Islamic calendar.', where: { tab: 'contracts' } },
  reserves: { term: 'Maintenance reserves', short: 'Money a lessee pays per flight hour towards the heavy checks its flying uses up.', where: { tab: 'fleet' } },
  dampLease: { term: 'Damp lease', short: 'A wet lease where the client brings some or most of the cabin crew; we always bring the pilots.', where: { tab: 'contracts' } },
  sccm: { term: 'SCCM', short: 'Senior cabin crew member: the purser, in charge of the cabin.', where: { tab: 'crew', view: 'people' } },
  warRisk: { term: 'War-risk cover', short: 'Extra insurance for landing where there is fighting; charged per landing, and insurers can withdraw it at short notice.', where: { tab: 'finance' } },
  forceMajeure: { term: 'Force majeure', short: 'Events nobody controls (war, ash, closed airspace): flights cancelled for them cost no penalty and no reputation.', where: { tab: 'map' } },
  subcharterIn: { term: 'Sub-charter in', short: 'A rival operator hires us to fly its client\'s flights: they pay us, the passengers never learn our name.', where: { tab: 'contracts' } },
  marketPhase: { term: 'Market phase', short: 'Boom, steady, soft or slump: how many airlines want extra aircraft, and at what rates.', where: { tab: 'contracts' } },
  blueIce: { term: 'Blue-ice runway', short: 'A runway of hard glacier ice in Antarctica: no fuel there, so the aircraft carries enough for the way back.', where: { tab: 'contracts' } },
  pnr: { term: 'Point of no return', short: 'The last point where an aircraft can still turn back with the fuel it has.', where: { tab: 'map' } },
  injunction: { term: 'Injunction', short: 'A court order that stops a flight; the client still pays for it.', where: { tab: 'contracts' } },
  // v0.7.4
  ySeats: { term: 'Curtained economy seats', short: "Curtained economy seats: the player's operators used these; the game treats them as class 3 rest. Every aircraft has them. They are blocked only on flights where someone rests, and sold on all others.", where: { tab: 'fleet' } },
  jSeats: { term: 'Curtained business seats', short: 'Business seats curtained off for resting crew: class 2 rest, on any aircraft whose cabin has business seats. Blocked only on flights where someone rests.', where: { tab: 'fleet' } },
  crewSet: { term: 'Crew set', short: 'One full crew for one aircraft: captain, first officer, purser and the cabin crew its seats need (plus a relief pilot on long days). Each aircraft needs about 5 sets to fly every day of the year.', where: { tab: 'crew', view: 'plan' } },
  quickRefit: { term: 'Quick reconfiguration', short: 'Changing the cabin with seats we already hold: move rows, the class divider and curtains, change the pitch. About 48 hours in our hangar.', where: { tab: 'fleet' } },
  longestDay: { term: 'Longest day', short: "The longest day this aircraft can be planned for: 2 pilots, or 3–4 pilots who take turns to rest on board. Captain's discretion is never planned.", where: { tab: 'fleet' } },
  airportStandby: { term: 'Airport standby', short: 'Standby at the airport, ready at once. It counts in full as duty; called after 4 h, the day that follows is cut by the standby beyond 4 h; standby plus flying stays within 16 h.', where: { tab: 'crew', view: 'board' } },
  reserve: { term: 'Reserve', short: 'Rostered availability with at least 10 h notice. It is not duty and not rest, so it never counts as a day off.', where: { tab: 'crew', view: 'board' } },
  daysOff: { term: 'Days off', short: 'At least 7 days a month and 96 a year free of all duty and standby, published in advance (EU Directive 2000/79/EC). We plan 8–10 days off a month in 2–3-day blocks (one block a week is the 36 h rest) and 4 weeks’ leave.', where: { tab: 'crew', view: 'board' } },
  publishedRoster: { term: 'Published roster', short: 'The next 14 days of the roster, as the crew see it. Days off in it are protected.', where: { tab: 'crew', view: 'board' } },
  outOfHours: { term: 'Crew out of hours', short: 'A named pilot or cabin crew member has reached a legal limit: the day length, rest, the 7/14/28-day duty, flying hours, the weekly 36 h rest or the days off. Not the same as a crew shortage, where a seat has nobody at all.', where: { tab: 'crew', view: 'board' } },
  slipCrew: { term: 'Crew change at a fuel stop', short: 'When a flight is too long for one crew even with rest on board, a second crew flies to the fuel stop as passengers, sleeps in a hotel and takes over. The first crew rests there and goes home by airline. It costs tickets and a hotel, and it makes the flight legal.', where: { tab: 'contracts' } },
  departmentHead: { term: 'Department head', short: 'A hire you earn through an achievement. Takes routine work off your desk by your rules, makes the odd mistake, can be switched off, and never makes the big decisions.', where: { tab: 'company', view: 'team' } },
  jumboLoad: { term: 'Jumbo load', short: '420 or more passengers on one aircraft: Hajj, troops, UN rotations, evacuations and big charters. Any cabin with the seats will do; only a 777-300ER, a 747-400 or an A380 takes it in one go.', where: { tab: 'contracts' } },
  fuelAtCost: { term: 'Fuel at cost', short: 'The client pays the fuel actually burnt, billed after flying, on top of the price. Common on government and military charters.', where: { tab: 'contracts' } },
  clientCabin: { term: 'Client cabin', short: 'The client wants a different cabin for their contract. We reconfigure it before the start (about 48 hours) and they pay all or half, and often for putting it back after.', where: { tab: 'contracts' } },
  exitLimit: { term: 'Exit limit', short: 'The most seats an aircraft may carry, set by its emergency exits. An A321neo with overwing exits takes 244, one with four pairs of doors 230.', where: { tab: 'fleet' } },
  flightEngineer: { term: 'Flight engineer', short: 'The third seat in an old cockpit (747-100, -200, -300): runs the engines, fuel and systems. Newer jets fly with two pilots.', where: { tab: 'fleet' } },
  newBuildSlot: { term: 'New-build slot', short: 'A brand-new aircraft from the factory, leased before it is built. Months of waiting and the highest rent.', where: { tab: 'fleet' } },
};

/** Words that the UI wraps in <Term> when they appear in a card's text (lower-case match). */
export const TERM_WORDS: [string, TermId][] = [
  ['FDP', 'fdp'], ['deadhead', 'deadhead'], ['positioning', 'positioning'], ['tight', 'tight'], ['discretion', 'discretion'], ['ACMI', 'acmi'],
  ['wet lease', 'wetLease'], ['sub-charter', 'subcharter'], ['AOG', 'aog'], ['standby', 'standby'], ['rest', 'rest'], ['block hours', 'blockHours'],
  ['MGH', 'mgh'], ['ferry', 'ferry'], ['augmented', 'augmented'], ['ETOPS', 'etops'], ['A-check', 'aCheck'], ['C-check', 'cCheck'], ['per diem', 'perDiem'],
  ['weekly rest', 'recovery'], ['private jet', 'privateJet'],
  ['purser', 'pur'], ['crew rest seats', 'restSeats'], ['crew rest', 'crewRest'], ['class 1 rest', 'restClass1'], ['class 3 rest', 'restClass3'], ['MRO', 'mro'],
  ['dry lease', 'dryLease'], ['market value', 'marketValue'], ['early return', 'earlyReturn'],
  // v0.7.3 (longer phrases first where they overlap)
  ['class 2 rest', 'restClass2'], ['lower-deck crew rest module', 'ldmcr'], ['crew rest recliners', 'recliners'], ['in-flight rest', 'inflightRest'],
  ['landing pilots', 'landingPilots'], ['planned extension', 'extension'], ['split duty', 'splitDuty'], ['delayed report', 'delayedReport'],
  ['home standby', 'homeStandby'], ['WOCL', 'wocl'], ['disruptive', 'disruptive'], ['two-day weekend', 'twoDays'], ["pilots' bunks", 'fcrc'],
  // v0.8
  ['relationship level', 'relationLevel'], ['first refusal', 'firstRefusal'], ['Day of Arafah', 'arafah'], ['Hajj', 'hajj'], ['maintenance reserves', 'reserves'],
  ['damp lease', 'dampLease'], ['SCCM', 'sccm'], ['war-risk cover', 'warRisk'], ['force majeure', 'forceMajeure'], ['sub-charter in', 'subcharterIn'],
  ['market phase', 'marketPhase'], ['blue-ice runway', 'blueIce'], ['point of no return', 'pnr'], ['injunction', 'injunction'], ['standing', 'standing'],
  // v0.7.4
  ['curtained economy seats', 'ySeats'], ['curtained business seats', 'jSeats'], ['crew set', 'crewSet'], ['quick reconfiguration', 'quickRefit'],
  // v0.9
  ['airport standby', 'airportStandby'], ['reserve', 'reserve'], ['days off', 'daysOff'], ['day off', 'daysOff'], ['published roster', 'publishedRoster'],
  ['out of hours', 'outOfHours'], ['crew change', 'slipCrew'], ['department head', 'departmentHead'], ['jumbo load', 'jumboLoad'], ['fuel at cost', 'fuelAtCost'],
];

/** First-time hints: one plain paragraph the first time each kind of problem appears (Settings.hintsSeen). */
export const HINTS: Partial<Record<ProblemKind, { title: string; text: string }>> = {
  crewShort: {
    title: 'A flight without a crew',
    text: 'A flight needs a legal crew: rested, rated on the type and in the right place. When nobody fits, you see this card. The bar shows how late the nearest crew would land; the buttons are the ways out, cheapest and quickest first. Two days before departure the warning is amber; twelve hours before, the game pauses so you can decide.',
  },
  crewIllegal: {
    title: 'A crew that cannot legally fly',
    text: 'Every crew member has limits: a maximum working day, minimum rest, and hours per week, month and year. When the plan breaks one, the flight shows red. The gauges show which limit is the problem; Crew Control lists the fixes.',
  },
  crewTight: {
    title: 'A crew close to a limit',
    text: 'Amber means legal, but within half an hour of a limit. One delay is enough to break it. Nothing to do yet; keep an eye on it.',
  },
  crewSick: {
    title: 'Someone called in sick',
    text: 'A sick crew member comes off their trips; the roster looks for a replacement at once. When nobody fits, the flight turns amber and you decide.',
  },
  aog: {
    title: 'Aircraft on ground',
    text: 'A fault has grounded the aircraft until it is repaired. The timeline shows the repair and the flights it hits. You can wait for the part, fly in a team, swap aircraft, hand the flights to a rival or cancel them.',
  },
  checkDue: {
    title: 'A check is coming up',
    text: 'Aircraft need a light A-check every few hundred flight hours and a heavy C-check every couple of years. The gauge shows how much of the interval is used; book the check before it runs out or the aircraft is grounded.',
  },
  grounded: {
    title: 'Grounded for an overdue check',
    text: 'The check interval ran out, so the aircraft may not carry passengers until the check is done. Book it now; the flights until then are lost.',
  },
  offerFit: {
    title: "An offer you can't fly yet",
    text: 'Every offer is checked against your aircraft and crew: seats, range, cabin, paint, who is free. The card names the one thing in the way and the button that fixes it.',
  },
  counterExpiry: {
    title: 'A counter-offer about to expire',
    text: 'When you counter, the client thinks and comes back. A halfway offer is the price on the table; after the deadline the job goes to a rival.',
  },
  cashLow: {
    title: 'Cash running out',
    text: 'The 30-day forecast adds up everything due in and out. When it dips below zero, salaries are paid late (morale falls) and lessors get nervous. Find work, chase invoices or sell one to a factor.',
  },
  invoiceOverdue: {
    title: 'A late payment',
    text: 'Clients do not always pay on time; governments are the worst. A reminder goes out at 7 days, a formal one at 30. You can wait, sell the invoice for a fee, or threaten to stop flying.',
  },
  lossMonth: {
    title: 'A losing month',
    text: 'Rent, salaries and insurance run whether the aircraft fly or not. A month with too few block hours loses money. The cure is work: contracts for the idle aircraft.',
  },
  deliveryWait: {
    title: 'An aircraft stuck at the seller',
    text: 'A new aircraft is handed over where the seller is. Your pilots fly out on airline tickets and ferry it home. Without rated pilots it waits there, and parking is charged by the day.',
  },
  leaseReturn: {
    title: 'A lease coming to an end',
    text: 'A leased aircraft goes back to its lessor with a return check, its original cabin and a white paint. You can extend the lease instead; decide before the notice date.',
  },
  restSeats: {
    title: 'Seats blocked for crew rest',
    text: 'On a long duty the crew must rest in turns during the flight. An aircraft without bunks curtains off seats for them: business seats when the cabin has them, else economy seats (or crew rest recliners). Those seats cannot be sold on the legs where someone rests; on every other flight they sell as normal.',
  },
  restFacility: {
    title: 'A long day that needs a 4th pilot',
    text: 'How long a crew may work depends on where they can sleep on board: bunks (class 1) allow the longest days, curtained business seats or recliners (class 2) an hour less, curtained economy seats (class 3) two hours less. When the aircraft only has seats, a 4th pilot or another aircraft makes the day legal.',
  },
  restTooShort: {
    title: 'No time to sleep on board',
    text: 'In-flight rest only counts in the cruise: each pilot needs 90 minutes in a row, the two who land 2 hours. On short legs there is no room for that, so the day falls back to the normal limit and the roster needs a fresh crew.',
  },
  cabinRest: {
    title: 'More cabin crew so everyone can rest',
    text: 'On long days every flight attendant needs a set rest on board (longer on seats than in bunks), while half the crew keep working in the cabin. When the cruise is too short for everyone, one or two extra cabin crew fly so the turns fit.',
  },
  captainAsFo: {
    title: 'A captain flying as first officer',
    text: 'When no first officer is free, a captain may sit in the right-hand seat. It is legal and the pay stays the same, but captains do not like doing it more than twice a month. Hiring first officers fixes it.',
  },
  sale: {
    title: 'Selling an aircraft',
    text: 'A buyer pays the market value less the coming heavy check and a broker fee. Every flight booked on the aircraft after the handover must move to another aircraft or a rival first.',
  },
  // v0.8
  clientUnhappy: {
    title: 'An unhappy client',
    text: 'Clients remember cancellations, hand-overs to rivals and late recoveries. An unhappy client calls a third as often and wants 5 % off. Fly their next job on time and say yes to their next request: good months bring it back.',
  },
  lostToRival: {
    title: 'A rival took the job',
    text: 'Other operators quote for the same work. A cheaper or closer rival can sign before you decide; the card says why. "Rivals bidding" on an offer means decide soon. Trusted clients ask us first.',
  },
  airspaceClosed: {
    title: 'Closed airspace',
    text: 'A war, a coup or an ash cloud can close airspace in hours. Flights into it wait; flights over it fly around. Cancelling for it is force majeure: no penalty, no reputation lost.',
  },
  uninsurable: {
    title: 'No war-risk cover',
    text: 'Insurers can withdraw war-risk cover 48 hours before a flight into a war zone. Without it the flight cannot legally operate: wait a day for the insurer, cancel without penalty, or hand it to a rival who has cover.',
  },
  leaseLate: {
    title: 'A lessee returns an aircraft late',
    text: 'Dry-lease clients sometimes keep the aircraft longer. They pay 150 % rent for each extra day, but our own flights planned on it need another aircraft or a rival.',
  },
  leaseDamage: {
    title: 'Damage found at the return inspection',
    text: 'After a dry lease the aircraft is inspected. A hard landing or a tail strike means days in the hangar; the lessee pays most of the repair.',
  },
  dryLeaseInfo: {
    title: 'What a dry lease is',
    text: 'The client rents the aircraft without crew: our pilots deliver it and fetch it back, they fly it with their crews in their colours. We earn rent and reserves; our crews of that type have less work meanwhile.',
  },
};
