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
