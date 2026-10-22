// "What's new": one entry per released version, newest first. The Title screen shows the newest entry once per
// version (settings.seenWhatsNew); Settings → What's new reopens it. Plain words for the player, not for us.

export interface WhatsNewEntry {
  /** As shown: 'v0.7.0'. */
  version: string;
  name: string;
  /** New features, player words. */
  features: string[];
  /** Fixes and smaller improvements since the previous entry (hotfixes included). */
  improvements: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
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
