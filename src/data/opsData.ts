// v0.11 Operations reference data (docs/acmi/RESEARCH.md §17): night curfews at real airports, the EU/ECAC states
// for ramp inspection programmes, ramp-inspection items by category, audit findings and their corrective actions,
// and the money of disruptions. Numbers are mid-range public figures; sources in RESEARCH §16.

/**
 * Night restrictions (local time, minutes after midnight). `from`–`to` no landings; `grace`: delayed flights may
 * still land this many minutes after `from` (ZRH 23:00–23:30, HAM until 24:00). Quota airports (LHR, BRU) are
 * treated as closed to us: our aircraft hold no night quota there.
 */
export interface Curfew { from: number; to: number; grace: number; note: string }
const h = (hh: number, mm = 0) => hh * 60 + mm;
export const CURFEWS: Record<string, Curfew> = {
  LHR: { from: h(23, 30), to: h(6), grace: 0, note: 'Night quota 23:30–06:00; no quota for us' },
  FRA: { from: h(23), to: h(5), grace: 0, note: 'No planned movements 23:00–05:00' },
  ZRH: { from: h(23), to: h(6), grace: 30, note: 'Night ban 23:30–06:00; 23:00–23:30 delayed flights only' },
  GVA: { from: h(0), to: h(6), grace: 30, note: 'No jet movements 00:00–06:00 (delayed until 00:30)' },
  ORY: { from: h(23, 30), to: h(6), grace: 0, note: 'Curfew 23:30–06:00 since 1968' },
  BRU: { from: h(23), to: h(6), grace: 0, note: 'Night slots 23:00–06:00 by quota; none for us' },
  MUC: { from: h(0), to: h(5), grace: 0, note: 'Night restrictions 00:00–05:00' },
  DUS: { from: h(23), to: h(6), grace: 30, note: 'Landings until 23:00, delayed until 23:30' },
  HAM: { from: h(23), to: h(6), grace: 60, note: 'Night ban 23:00–06:00; delayed flights until 24:00' },
  STR: { from: h(23, 30), to: h(6), grace: 0, note: 'Night ban 23:30–06:00' },
  BER: { from: h(0), to: h(5), grace: 0, note: 'Core night 00:00–05:00' },
  LIN: { from: h(23), to: h(7), grace: 0, note: 'Closed 23:00–07:00' },
  NRT: { from: h(0), to: h(6), grace: 0, note: 'Operating hours 06:00–24:00' },
  SYD: { from: h(23), to: h(6), grace: 0, note: 'Curfew 23:00–06:00 (Sydney Airport Curfew Act 1995)' },
};

/** EU member states plus the other EASA/ECAC states running SAFA/SACA ramp inspections (2025). */
export const ECAC = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'NO', 'CH', 'LI', 'GB', 'AL', 'AM', 'AZ', 'BA', 'GE', 'MD', 'MC', 'ME', 'MK', 'RS', 'SM', 'TR', 'UA',
]);
/** EU states plus the EASA associated states (an operator from these is inspected under SACA). */
export const EASA_STATES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'NO', 'CH', 'LI',
]);

/**
 * Ramp inspection items (EASA ramp inspection manual, areas A flight deck, B safety/cabin, C condition, D cargo; the
 * typical findings in each category). Cat 3 lines are the ones that hold the aircraft.
 */
export const RAMP_ITEMS: Record<1 | 2 | 3, string[]> = {
  1: [
    'Cabin crew safety card out of date in one seat pocket',
    'Torch in the cabin crew station not fully charged',
    'Minor smudges on the emergency exit placards',
    'Journey log signed but one entry missing a time',
    'Life jacket demonstration kit incomplete',
    'Fire extinguisher inspection tag faded',
  ],
  2: [
    'A deferred defect past its MEL interval on paper',
    'Crew licence copy on board out of date',
    'Dangerous goods NOTOC not on board for a battery item',
    'Emergency lighting: two floor-path strips not working',
    'Operations manual on board not the current revision',
    'One first-aid kit seal broken',
  ],
  3: [
    'Tyre worn to the limit on the left main gear',
    'Hydraulic leak on the nose gear beyond limits',
    'Missing fasteners on an engine cowl panel',
    'Oxygen bottle for the crew below minimum pressure',
    'Emergency slide pressure out of the green band',
    'Cargo hold fire detection inoperative, not deferred',
  ],
};

/** EASA ramp inspection 2025: 10,683 inspections, 4,754 Cat 1, 3,048 Cat 2 and 2,042 Cat 3 findings (per inspection). */
export const RAMP_MEAN = { cat1: 4754 / 10683, cat2: 3048 / 10683, cat3: 2042 / 10683 };

/** Audit findings: text, the corrective action that closes them (cost, days to complete). Level 1 deadline / Level 2 deadline (days). */
export const AUDIT_DEADLINE = { 1: 21, 2: [30, 90] as [number, number] };
export const AUDIT_TASKS = {
  ftl: { text: 'Crew flew over their flight time limits', task: 'Retrain crew control and the duty planners on FTL', cost: 45_000, days: 14 },
  ramp: { text: 'Ramp inspections found major defects', task: 'Hire a compliance officer for the line stations', cost: 60_000, days: 21 },
  tech: { text: 'Technical dispatch reliability below the standard', task: 'Reliability programme review with the CAMO', cost: 35_000, days: 14 },
  checks: { text: 'An aircraft flew past a maintenance check', task: 'Revise the maintenance planning procedure', cost: 30_000, days: 10 },
  training: { text: 'Training records incomplete for some crew', task: 'Audit and complete the crew training files', cost: 25_000, days: 10 },
  quality: { text: 'Operations manual not kept up to date', task: 'Revise the operations manual (Part A)', cost: 20_000, days: 14 },
} as const;
/** Audit cost (the authority's fee and our time) and the reputation for a clean audit. */
export const AUDIT_FEE = 18_000;

/** Disruption money (USD). Sources RESEARCH §16. */
export const DISRUPT = {
  /** Ground handling at an alternate: [narrow, wide]; ad hoc (no contract) costs this much more. */
  handling: [2_800, 6_500] as [number, number],
  adHocFactor: 1.8,
  /** Passenger care: hotel night and meals per passenger; a meal voucher; a coach (50 seats) per 100 km. */
  hotelPax: 110,
  mealPax: 18,
  coachPer100km: 450,
  /** Crew hotel night per crew member at an alternate (rooms at short notice). */
  crewRoom: 160,
  /** EU261 Art. 7 compensation per passenger (EUR ≈ USD): ≤ 1,500 km, ≤ 3,500 km, beyond. */
  eu261: [270, 430, 650] as [number, number, number],
  /** Extra handling to rush a turn ([narrow, wide]) and the minutes it saves. */
  rushTurn: [1_800, 4_500] as [number, number],
  rushSaves: [15, 25] as [number, number],
  /** Bird strike inspection: our engineer flying in (ticket + day), a local contractor; minutes. */
  birdOwn: { cost: 2_500, min: [300, 480] as [number, number] },
  birdLocal: { cost: 7_500, min: [150, 240] as [number, number] },
  /** Bird strike damage found (share of inspections) and the repair hours. */
  birdDamage: 0.12,
  birdRepairH: [12, 36] as [number, number],
  /** Medical: a paramedic meeting the aircraft; ground time to offload a patient (min). */
  medicalGround: 70,
};

/** In-flight medical events (plain words; the commonest per Peterson et al., NEJM 2013: syncope, respiratory, nausea, cardiac). */
export const MEDICAL_EVENTS = [
  { what: 'A passenger collapsed and is not responding well', severe: true },
  { what: 'A passenger has chest pain; a doctor on board suspects a heart attack', severe: true },
  { what: 'A passenger is having a seizure', severe: false },
  { what: 'A passenger has severe breathing problems', severe: true },
  { what: 'A pregnant passenger has gone into labour', severe: true },
  { what: 'A diabetic passenger is confused and getting worse', severe: false },
];

/** Departure slot (CTOT) causes: Eurocontrol ATFM delay reasons. */
export const CTOT_CAUSES = [
  'ATC capacity in the upper airspace',
  'ATC staffing at the area control centre',
  'Thunderstorms along the route',
  'Low visibility at the destination',
  'Strong winds at the destination',
  'Military airspace activated on the route',
];

/** Weather that closes a destination for a while. */
export const WEATHER_CAUSES = ['Fog below landing minimums', 'Thunderstorms over the airport', 'Crosswind over the limit', 'Snow on the runway being cleared', 'Low cloud and heavy rain'];
/** Technical reasons for a precautionary diversion. */
export const TECH_CAUSES = ['A hydraulic system warning', 'An engine oil pressure warning', 'Smoke smell in the cabin', 'A pressurisation fault', 'A cracked cockpit window'];
/** Turnaround slow-downs. */
export const TURN_CAUSES = ['Cleaning team late', 'Catering truck late', 'Fuel bowser held up', 'Boarding slow: a large group checked in late', 'Baggage loaders short-staffed'];

/** Island airports in the data (by island): no coach to or from another island or the mainland. */
export const ISLAND: Record<string, string> = {
  PMI: 'Mallorca', IBZ: 'Ibiza', MAH: 'Menorca', TFS: 'Tenerife', LPA: 'Gran Canaria', ACE: 'Lanzarote', FUE: 'Fuerteventura', FNC: 'Madeira',
  PDL: 'São Miguel', TER: 'Terceira', MLA: 'Malta', LCA: 'Cyprus', PFO: 'Cyprus', HER: 'Crete', CHQ: 'Crete', RHO: 'Rhodes', KGS: 'Kos', CFU: 'Corfu',
  JTR: 'Santorini', ZTH: 'Zakynthos', OLB: 'Sardinia', CAG: 'Sardinia', PMO: 'Sicily', CTA: 'Sicily', KEF: 'Iceland', DPS: 'Bali', MRU: 'Mauritius',
  SEZ: 'Mahé', MLE: 'Malé', HNL: 'Oahu', OGG: 'Maui', SID: 'Sal', BVC: 'Boa Vista', RAI: 'Santiago (CV)', MBJ: 'Jamaica', NAS: 'New Providence',
  AUA: 'Aruba', SJU: 'Puerto Rico', ZNZ: 'Zanzibar', TNR: 'Madagascar',
};
/** Mainland Europe (open borders by road; Great Britain and Ireland are across the sea). */
export const MAINLAND_EU = new Set(['AT', 'BE', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'CH', 'LI', 'AL', 'BA', 'ME', 'MK', 'RS', 'MD', 'MC', 'SM']);
