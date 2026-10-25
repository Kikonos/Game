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
