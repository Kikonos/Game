// Offer flavour text (B1): causes, crises and phrasing so offers read like the job they are.

export const AOG_CAUSES = [
  'an engine borescope finding', 'a bird strike on the climb-out', 'a cracked windshield', 'a hard-landing inspection',
  'hail damage after a storm', 'an engine change that overran', 'a flap actuator failure', 'a tail-strike inspection',
  'a cargo door damaged by a loader', 'a fuel leak from the wing tank', 'a lightning strike', 'a landing-gear retraction fault',
];

/** Crisis openers; the blurb prefixes the city ("Goma: fighting has closed the airport…"). */
export const CRISES = [
  'fighting has closed the airport to scheduled airlines', 'civil unrest has shut the land borders', 'a coup has grounded the national carrier',
  'an earthquake has stranded tourists and aid workers', 'floods have cut the roads to the capital', 'the last scheduled carrier has suspended flights',
  'an outbreak has closed regular services', 'elections turned violent overnight', 'an ash cloud has just cleared after a week of closures',
];

export const MISSIONS = [
  'for the peacekeeping contingent', 'for the training mission', 'for the stabilisation force', 'for the observer mission',
];

export const ADHOC_GROUPS: { what: string; kinds: ('tourOperator' | 'agency' | 'corporate' | 'music')[]; pax?: [number, number] }[] = [
  { what: 'an incentive group', kinds: ['corporate'] },
  { what: 'a sales conference', kinds: ['corporate'] },
  { what: 'a wedding party', kinds: ['agency'], pax: [110, 160] },
  { what: 'a late-booked package group', kinds: ['tourOperator'], pax: [160, 180] },
  { what: 'a golf tournament group', kinds: ['agency', 'tourOperator'], pax: [100, 150] },
  { what: 'a film crew with their kit', kinds: ['corporate'], pax: [80, 120] },
  { what: 'a university choir on tour', kinds: ['agency'], pax: [90, 140] },
  { what: 'a stag-and-hen weekend group', kinds: ['agency'], pax: [140, 178] },
  { what: 'a trade-fair delegation', kinds: ['corporate'] },
];

/** League games stay in the club's country; cup ties and European nights go abroad. */
export const SPORT_TITLES_HOME = ['League away day in', 'Away match in', 'Derby away in'];
export const SPORT_TITLES_ABROAD = ['European night in', 'Cup tie in', 'Continental away leg in'];

/** Departure-time slots that look like real charter schedules (local minutes). */
export const DEP_SLOTS = [6 * 60 + 40, 7 * 60 + 15, 8 * 60 + 5, 9 * 60 + 30, 10 * 60 + 45, 12 * 60 + 10, 13 * 60 + 35, 15 * 60 + 20, 16 * 60 + 50, 18 * 60 + 25];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Resorts for tour-operator series (narrowbody) and long-haul sun (widebody). */
export const RESORTS_NB = ['TFS', 'LPA', 'FNC', 'SID', 'AYT', 'HER', 'PMI', 'FUE', 'ACE', 'CFU', 'RHO', 'DLM', 'BJV', 'PFO', 'BOJ', 'CHQ', 'KGS', 'MAH', 'OLB', 'BVC'];
export const RESORTS_WB = ['CUN', 'VRA', 'PUJ', 'MBJ'];

/** Season-base client hubs (DESIGN §5.1.2) and long-haul ones for widebody bases. */
export const BASE_HUBS_NB = ['HAM', 'DUS', 'DUB', 'ARN', 'ZAG', 'SPU', 'RIX', 'CMN', 'AMM'];
export const BASE_HUBS_WB = ['AMM', 'GRU', 'JNB', 'YYZ', 'SGN', 'DSS', 'LIM', 'BSB'];

export const CRISIS_AIRPORTS = ['KBL', 'BKO', 'JUB', 'MGQ', 'BGF', 'GOM', 'LAD', 'OXB', 'TMS', 'DIL', 'BEY', 'ADA'];
export const MISSION_AIRPORTS = ['BKO', 'BGF', 'MGQ', 'JUB', 'DJI'];
export const DIASPORA = ['OXB', 'TMS', 'LAD', 'SID', 'RAI', 'BVC'];

/** Pre-season tour cities for clubs (widebody). */
export const TOUR_CITIES = ['JFK', 'MIA', 'YYZ', 'ORD', 'IAD', 'PEK', 'HKG', 'SIN', 'NRT', 'BKK', 'DXB', 'GRU', 'LAX'];
