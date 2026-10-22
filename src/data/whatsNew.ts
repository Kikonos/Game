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
