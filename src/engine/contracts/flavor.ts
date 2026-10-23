// Offer flavour text (B1): causes, crises and phrasing so offers read like the job they are.

import type { Airport } from '../../data/airports';
import { next, type RngHolder } from '../core/rng';

export const AOG_CAUSES = [
  'an engine borescope finding', 'a bird strike on the climb-out', 'a cracked windshield', 'a hard-landing inspection',
  'hail damage after a storm', 'an engine change that overran', 'a flap actuator failure', 'a tail-strike inspection',
  'a cargo door damaged by a loader', 'a fuel leak from the wing tank', 'a lightning strike', 'a landing-gear retraction fault',
  'a catering truck that hit the forward door', 'a tyre burst on the landing roll', 'a flock of gulls ingested on the take-off roll',
  'a pressurisation fault over the sea', 'a bleed-air leak found at the night stop', 'a jet bridge that dented the fuselage',
];

/** Generic crisis openers for an airport without its own list; the blurb prefixes the city ("Juba: …"). */
export const CRISES = [
  'commercial flights are suspended', 'the government has advised its citizens to leave', 'scheduled seats are sold out for weeks',
  'the land borders are closed', 'fighting has closed the airport to scheduled airlines', 'the last scheduled carrier has suspended flights',
];

/** Crisis openers per crisis airport: events that fit the place (volcanoes at Goma, quakes at Adana, coups where they happen). */
export const CRISES_AT: Record<string, string[]> = {
  KBL: [
    'the authorities have ordered foreign embassies to cut their staff within 72 hours',
    'fighting on the airport road has driven off the last foreign carriers',
    'an earthquake in the east has stranded aid workers and dual nationals',
    'Kam Air has grounded its fleet after a rocket landed near the apron',
  ],
  BKO: [
    'a coup overnight has closed the borders and the airport to scheduled airlines',
    'a fuel blockade by armed groups has emptied the pumps and grounded scheduled flights',
    'the junta has ordered several European embassies to close within a week',
    'the Niger has burst its banks and cut the roads out of the capital',
  ],
  JUB: [
    'fighting has reached the outskirts of the capital',
    'the White Nile floods have cut every road out of the city',
    'the last regional carrier has pulled out after shots were fired near the terminal',
    'a cholera outbreak has closed regular services',
  ],
  MGQ: [
    'a truck bomb at the airport checkpoint has halted commercial flights',
    'clan fighting has closed the road between the airport and the city',
    'the government has suspended all foreign carriers pending a security review',
  ],
  BGF: [
    'armed groups have reached the edge of the capital',
    'a disputed election count has turned violent overnight',
    'the Ubangi has flooded the riverside districts and the airport road',
    'the only scheduled carrier has stopped flying after its aircraft was hit by gunfire on the ground',
  ],
  GOM: [
    'rebel fighting has closed the airport to scheduled airlines',
    'Nyiragongo is erupting and lava is moving towards the city',
    'an ash cloud from Nyiragongo has just cleared after a week of closures',
    'an Ebola outbreak in North Kivu has closed regular services',
  ],
  LAD: [
    'fuel-price riots have spread across the capital and foreign carriers have suspended their flights',
    'a general strike has shut the port and the land borders',
    'flash floods have cut the roads to the airport and the hotels are emptying',
  ],
  OXB: [
    'a coup attempt overnight has closed the borders',
    'soldiers have surrounded the presidential palace and the airport is closed to scheduled airlines',
    'the last scheduled carrier has suspended flights',
    'a disputed election result has brought gunfire to the capital',
  ],
  TMS: [
    'a coup attempt has closed the airport to scheduled airlines',
    'the only scheduled service to Lisbon has been cancelled for a fortnight',
    'torrential rains have washed out the roads and the power grid',
    'a dengue outbreak has closed regular services',
  ],
  DIL: [
    'riots after a disputed vote have closed the airport to scheduled airlines',
    'flash floods have cut the roads to the capital',
    'a strong earthquake in the Banda Sea has stranded tourists and aid workers',
    'the regional carrier has suspended flights after a runway incursion',
  ],
  BEY: [
    'air strikes near the airport have driven off the foreign carriers',
    'the national carrier has flown its fleet out to Cyprus for safety',
    'the embassy has told every citizen to leave while the airport is still open',
    'a huge blast at the port has filled the hospitals and scheduled seats are sold out',
  ],
  ADA: [
    'a strong earthquake in the south-east has stranded tourists and aid workers',
    'wildfires in the hills have closed the roads to the coast',
    'shelling across the Syrian border has closed the land crossings and scheduled seats are sold out',
    'the Seyhan has flooded the roads to the airport',
  ],
};

/** The crisis lines that fit this airport. */
export const crisisLines = (code: string): string[] => CRISES_AT[code] ?? CRISES;

export const MISSIONS = [
  'for the peacekeeping contingent', 'for the training mission', 'for the stabilisation force', 'for the observer mission',
];

export interface AdhocGroup {
  what: string;
  /** Any client of these kinds books it… */
  kinds: ('tourOperator' | 'agency' | 'corporate' | 'music')[];
  /** …plus these named clients (naming-kit names). */
  clients?: string[];
  pax?: [number, number];
  /** false: narrowbody only. */
  wide?: boolean;
  /** Days before the return leg. */
  back?: [number, number];
  /** Leisure resorts or big cities; `dests` pins a fixed list. */
  dest?: 'leisure' | 'city';
  dests?: string[];
}

const CORP = ['Novartis', 'American Express Global Business Travel'];
const LEISURE_AGENCIES = ['Kuoni Group Travel', 'Hotelplan Group'];

export const ADHOC_GROUPS: AdhocGroup[] = [
  { what: 'an incentive group', kinds: ['tourOperator'], clients: [...CORP, ...LEISURE_AGENCIES], dest: 'leisure', back: [3, 5] },
  { what: 'a sales conference', kinds: [], clients: CORP, dest: 'city', back: [2, 4] },
  { what: 'a trade-fair delegation', kinds: [], clients: CORP, dest: 'city', back: [2, 4] },
  { what: 'a wedding party', kinds: ['tourOperator'], clients: LEISURE_AGENCIES, pax: [110, 160], wide: false, dest: 'leisure', back: [3, 6] },
  { what: 'a late-booked package group', kinds: ['tourOperator'], pax: [160, 180], dest: 'leisure', back: [4, 7] },
  { what: 'a golf tournament group', kinds: ['tourOperator'], clients: ['Sportsworld Group Travel', ...LEISURE_AGENCIES], pax: [100, 150], wide: false, dest: 'leisure', back: [3, 6] },
  { what: 'a film crew with their kit', kinds: [], clients: ['BBC Studios'], pax: [80, 120], wide: false, back: [4, 7] },
  { what: 'a drama production unit', kinds: [], clients: ['BBC Studios'], pax: [90, 130], wide: false, dest: 'city', back: [4, 7] },
  { what: 'a university choir on tour', kinds: ['tourOperator'], clients: LEISURE_AGENCIES, pax: [90, 140], wide: false, dest: 'city', back: [4, 7] },
  { what: 'a stag-and-hen weekend group', kinds: [], clients: ['Sportsworld Group Travel'], pax: [100, 150], wide: false, dest: 'leisure', back: [2, 3] },
  { what: "an away-final supporters' group", kinds: [], clients: ['Sportsworld Group Travel'], pax: [140, 180], wide: false, dest: 'city', back: [1, 2] },
  { what: 'a race logistics and paddock team', kinds: [], clients: ['Formula 1'], pax: [120, 170], wide: false, back: [4, 5], dests: ['BCN', 'BUD', 'MXP', 'NCE', 'IST', 'MAD', 'VIE'] },
  { what: 'a festival production team', kinds: [], clients: ['Live Nation', 'AEG Presents'], pax: [90, 140], wide: false, dest: 'leisure', back: [3, 5] },
];

/** Shrine towns are for pilgrims, not parties. */
const NOT_FOR_GROUPS = ['LDE'];

/** Whether an ad hoc group would plausibly fly to this airport. */
export function groupDestOk(group: AdhocGroup, a: Airport): boolean {
  if (group.dests) return group.dests.includes(a.code);
  if (NOT_FOR_GROUPS.includes(a.code)) return false;
  if (group.dest === 'leisure') return a.tour >= 0.7;
  if (group.dest === 'city') return a.size >= 3 && a.biz >= 0.35;
  return true;
}

export interface GroupBlurb { client: string; what: string; pax: number; from: string; to: string; day: string; back: number | null }
const groupBack = (x: GroupBlurb, oneWay: string, ret: string) => (x.back === null ? oneWay : ret.replace('{n}', String(x.back)));
export const ADHOC_BLURBS: ((x: GroupBlurb) => string)[] = [
  (x) => `${x.client} has ${x.what} of ${x.pax} to fly ${x.from}–${x.to} on ${x.day}${groupBack(x, ', one way (we come back empty)', ', back {n} days later')}. All-in price: we buy the fuel and pay the fees.`,
  (x) => `${x.client} is moving ${x.what} of ${x.pax} from ${x.from} to ${x.to} on ${x.day}${groupBack(x, '; one way, we ferry back empty', ', home {n} days later')}. They want one all-in price: fuel, fees and handling on us.`,
  (x) => `Short notice from ${x.client}: ${x.what}, ${x.pax} passengers, ${x.from}–${x.to} on ${x.day}${groupBack(x, ', one way', ', return {n} days later')}. All-in charter; their group leader will want the seat plan by tomorrow.`,
];

export interface DiasporaBlurb { client: string; dest: string; reason: string; day: string; back: number }
export const DIASPORA_BLURBS: ((x: DiasporaBlurb) => string)[] = [
  (x) => `${x.client} has a full load of families flying home to ${x.dest} ${x.reason}, with heavy bags. Out ${x.day}, back ${x.back} days later.`,
  (x) => `${x.client} sold every seat to ${x.dest} ${x.reason} in a weekend: families, gifts and boxes of food. Out ${x.day}, back ${x.back} days later; the bags will weigh out before the seats do.`,
  (x) => `${possessive(x.client)} ${x.dest} charter ${x.reason}: grandparents, children and a hold full of presents. Out ${x.day}, back ${x.back} days later.`,
];

/** Diaspora routes and reasons per agency; DIASPORA is the fallback. */
export const DIASPORA_BY_CLIENT: Record<string, { dests: string[]; reasons: string[] }> = {
  'Viagens Abreu': {
    dests: ['OXB', 'TMS', 'LAD', 'SID', 'RAI', 'BVC'],
    reasons: ['for the summer holidays', 'for Christmas and New Year', 'for the independence-day celebrations', 'for a season of family weddings and baptisms', 'for Carnival'],
  },
  Corendon: {
    dests: ['ADA', 'ESB', 'ADB', 'CMN'],
    reasons: ['for the summer holidays', 'for Eid with their families', 'for the wedding season back home', 'for the autumn school break'],
  },
};
export const DIASPORA_REASONS = ['for the summer holidays', 'for Christmas and New Year', 'for a national holiday'];

/** Pilgrimage shrines: the airport, the place and what the group brings. */
export const SHRINES: { code: string; place: string; note: string }[] = [
  { code: 'LIS', place: 'Fátima', note: 'with wheelchairs and elderly passengers, in time for the candlelight procession' },
  { code: 'LDE', place: 'Lourdes', note: 'with wheelchairs, volunteer nurses and a few stretcher cases' },
  { code: 'SPU', place: 'Medjugorje', note: 'with a coach over the border waiting at the other end' },
];

/** Ship managers' crew changes: the port (served by this airport) and where seafarers fly from. */
export const SHIP_PORTS: { code: string; port: string }[] = [
  { code: 'AMS', port: 'Rotterdam' }, { code: 'ATH', port: 'Piraeus' }, { code: 'BRU', port: 'Antwerp' }, { code: 'HAM', port: 'Hamburg' },
  { code: 'AGP', port: 'Algeciras' }, { code: 'VLC', port: 'Valencia' }, { code: 'GDN', port: 'Gdańsk' }, { code: 'LPA', port: 'Las Palmas' },
  { code: 'LCA', port: 'Limassol' }, { code: 'MLA', port: 'Marsaxlokk' },
];
export const SEAFARER_HUBS = ['SPU', 'OTP', 'VAR', 'GDN', 'RIX', 'ATH', 'MNL', 'BOM'];

export interface TourBlurb { client: string; n: number; wd: string; first: string; last: string; out: string }
export const TOUR_SERIES_BLURBS: ((x: TourBlurb) => string)[] = [
  (x) => `${x.client}: ${x.n} weekly rotations every ${x.wd}, ${x.first}–${x.last}. Out at ${x.out} local, back the same day; no fuel stops. Paid per rotation with a fuel-escalation clause.`,
  (x) => `${x.client} has sold ${x.n} ${x.wd} departures (${x.first}–${x.last}) and needs the aircraft: out at ${x.out} local, straight back with the returning guests. No fuel stops; paid per rotation, fuel escalation above the index.`,
  (x) => `A ${x.wd} rotation for ${possessive(x.client)} brochure: ${x.n} weeks from ${x.first} to ${x.last}, departing ${x.out} local. Their reps meet every flight, so on-time matters more than catering. Paid per rotation with a fuel clause.`,
];

/** League games stay in the club's country; cup ties and European nights go abroad. 'Short' titles only under 700 km. */
export const SPORT_TITLES_HOME = ['League away day in', 'Away match in', 'Short away trip to'];
export const SPORT_TITLES_ABROAD = ['European night in', 'Cup tie in', 'Continental away leg in'];

/** Departure-time slots that look like real charter schedules (local minutes). */
export const DEP_SLOTS = [6 * 60 + 40, 7 * 60 + 15, 8 * 60 + 5, 9 * 60 + 30, 10 * 60 + 45, 12 * 60 + 10, 13 * 60 + 35, 15 * 60 + 20, 16 * 60 + 50, 18 * 60 + 25];

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Resorts for tour-operator series (narrowbody) and long-haul sun (widebody). */
export const RESORTS_NB = ['TFS', 'LPA', 'FNC', 'SID', 'AYT', 'HER', 'PMI', 'FUE', 'ACE', 'CFU', 'RHO', 'DLM', 'BJV', 'PFO', 'BOJ', 'CHQ', 'KGS', 'MAH', 'OLB', 'BVC'];
export const RESORTS_WB = ['CUN', 'VRA', 'PUJ', 'MBJ'];

/** Season-base client hubs (DESIGN §5.1.2) and long-haul ones for widebody bases. */
export const BASE_HUBS_NB = ['HAM', 'DUS', 'DUB', 'ARN', 'ZAG', 'WAW', 'FRA', 'LIS', 'RIX', 'CMN', 'AMM', 'RUH'];
export const BASE_HUBS_WB = ['AMM', 'JED', 'GRU', 'JNB', 'YYZ', 'SGN', 'DSS', 'LIM', 'BSB', 'LAD'];

export const CRISIS_AIRPORTS = ['KBL', 'BKO', 'JUB', 'MGQ', 'BGF', 'GOM', 'LAD', 'OXB', 'TMS', 'DIL', 'BEY', 'ADA'];
export const MISSION_AIRPORTS = ['BKO', 'BGF', 'MGQ', 'JUB', 'DJI'];
export const DIASPORA = ['OXB', 'TMS', 'LAD', 'SID', 'RAI', 'BVC'];

/** Pre-season tour cities for clubs (widebody). */
export const TOUR_CITIES = ['JFK', 'MIA', 'YYZ', 'ORD', 'IAD', 'PEK', 'HKG', 'SIN', 'NRT', 'BKK', 'DXB', 'GRU', 'LAX'];

// ---------- v0.7.2 contract titles with flavour (UPDATE-0.7.2.md F4) ----------
// Titles say what the work is, never the weekday (that lives in the blurb). Each builder returns '' when it does not
// fit the job (season, airport, body); pickTitle draws one that differs from the client's last title.

export type Season = 'winter' | 'ski' | 'easter' | 'summer' | 'autumn' | 'christmas';
export interface TitleCtx {
  /** The client's full name and short trade name ('TUI Deutschland' → 'TUI'). */
  client: string;
  brand: string;
  from: string;
  to: string;
  fromCity: string;
  toCity: string;
  season: Season;
  /** 'June'. */
  month: string;
  /** Rotations, or days for bases. */
  n: number;
  wide?: boolean;
  /** Mission name (troop rotations), event or type short name. */
  event?: string;
  /** v0.7.2 the mission is peacekeeping ('Peacekeeper rotation for …'). */
  pk?: boolean;
  /** Country adjective of the client ('Portuguese'). */
  nation?: string;
  type?: string;
}

/** Short trade names of clients (the rest keep their name). */
export const BRANDS: Record<string, string> = {
  'TUI Deutschland': 'TUI', 'TUI fly Belgium': 'TUI', Jet2holidays: 'Jet2', 'Jet2.com': 'Jet2', 'Corendon Airlines': 'Corendon',
  'Schauinsland-Reisen': 'Schauinsland', 'Sunwing Vacations': 'Sunwing', 'Abercrombie & Kent': 'A&K', 'Viagens Abreu': 'Abreu',
  'UN Department of Peace Operations (DPO)': 'the UN', 'Novatours': 'Novatours', 'Čedok': 'Čedok',
};
export const brandOf = (name: string) => BRANDS[name] ?? name.replace(/^The /, '');

/** Ski airports (winter charters Dec–Mar). */
export const RESORTS_SKI = ['SZG', 'INN', 'GVA', 'TRN', 'CMF', 'GNB'];
const CANARIES = ['TFS', 'LPA', 'FUE', 'ACE'];
const MARKETS = ['SZG', 'INN', 'PRG', 'VIE', 'BUD', 'NUE', 'STR', 'KRK', 'ZRH', 'BSL'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The season of a programme by its first month (ski when Dec–Mar to a ski airport). */
export function seasonOf(startUtc: number, to: string): Season {
  const m = new Date(startUtc * 60_000).getUTCMonth();
  if ((m === 11 || m <= 2) && RESORTS_SKI.includes(to)) return 'ski';
  if (m === 11) return 'christmas';
  if (m === 2 || m === 3) return 'easter';
  if (m >= 4 && m <= 8) return 'summer';
  if (m === 9 || m === 10) return 'autumn';
  return 'winter';
}
export const monthOf = (startUtc: number) => MONTHS[new Date(startUtc * 60_000).getUTCMonth()];

const SEASON_WORD: Record<Season, string> = { winter: 'Winter', ski: 'Ski', easter: 'Easter', summer: 'Summer', autumn: 'Autumn', christmas: 'Christmas' };

/** Missions by airport (real names): who runs them and whether they are peacekeeping. */
export interface Mission { name: string; org: 'UN' | 'EU' | 'AU' | 'NATO'; pk: boolean }
export const MISSION_NAMES: Record<string, Mission> = {
  BGF: { name: 'MINUSCA', org: 'UN', pk: true }, JUB: { name: 'UNMISS', org: 'UN', pk: true }, GOM: { name: 'MONUSCO', org: 'UN', pk: true },
  FIH: { name: 'MONUSCO', org: 'UN', pk: true }, BEY: { name: 'UNIFIL', org: 'UN', pk: true }, LCA: { name: 'UNFICYP', org: 'UN', pk: true },
  SJJ: { name: 'EUFOR Althea', org: 'EU', pk: true }, PRN: { name: 'KFOR', org: 'NATO', pk: true },
  MGQ: { name: 'AUSSOM', org: 'AU', pk: false }, DJI: { name: 'EU Atalanta', org: 'EU', pk: false },
};
/** Tour operators that fly long-haul (widebody programmes); Jet2, Novatours, Čedok and Sunweb stay short-haul. */
export const LONGHAUL_BRANDS = ['TUI', 'Corendon', 'Schauinsland', 'Sunwing', 'Abercrombie & Kent'];
export const longHaulBrand = (name: string) => LONGHAUL_BRANDS.some((b) => brandOf(name).startsWith(b) || name.startsWith(b));
/** "Eurowings'" / "TUI's". */
export const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/**
 * v0.9 (§V.2): a job named with its client once, the client first: 'Corendon · Winter sun to Corfu'. Titles never
 * carry the client (clientless). Pure.
 */
export function jobName(client: string, title: string): string {
  return title.includes(client) || title.includes(brandOf(client)) ? title : `${client} · ${title}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * v0.9 (§V.2): the client's name taken out of an offer title (the client is shown on its own): 'Winter sun to Corfu
 * for Corendon' → 'Winter sun to Corfu', "TUI's summer wet lease, Lisbon" → 'Summer wet lease, Lisbon'. Pure.
 */
export function clientless(title: string, client: string): string {
  let t = title;
  for (const n of [...new Set([client, brandOf(client)])].sort((a, b) => b.length - a.length)) {
    if (!n) continue;
    const e = esc(n);
    t = t.replace(new RegExp(`\\s(?:for|to|with) ${e}(?=$|[ ,:(])`), '');
    t = t.replace(new RegExp(`^(?:${esc(possessive(n))}|${e})\\s+`), '');
  }
  t = t.trim();
  if (t.length < 6 || t === title) return title;
  return t[0].toUpperCase() + t.slice(1);
}

/** 'summer', 'Easter', 'Christmas' (mid-sentence). */
const seasonMid = (s: Season) => (s === 'easter' || s === 'christmas' ? SEASON_WORD[s] : SEASON_WORD[s].toLowerCase());
export const NATIONS: Record<string, string> = {
  PT: 'Portuguese', ES: 'Spanish', LT: 'Lithuanian', MT: 'Maltese', LV: 'Latvian', CZ: 'Czech', BG: 'Bulgarian', EE: 'Estonian', GB: 'British',
  DE: 'German', FR: 'French', IT: 'Italian', PL: 'Polish', NL: 'Dutch', IE: 'Irish', BE: 'Belgian', AT: 'Austrian', SE: 'Swedish', FI: 'Finnish',
};

type TitleFn = (x: TitleCtx) => string;
const when = (ok: (x: TitleCtx) => boolean, t: TitleFn): TitleFn => (x) => (ok(x) ? t(x) : '');

export const TITLES: Partial<Record<string, TitleFn[]>> = {
  tourSeries: [
    when((x) => x.season === 'summer', (x) => `${x.brand} summer programme ${x.fromCity}–${x.toCity}`),
    (x) => `${x.brand} weekend rotation to ${x.toCity}`,
    (x) => `${x.brand} ${x.toCity} flights`,
    when((x) => x.season === 'winter' || x.season === 'autumn' || x.season === 'easter', (x) => `${SEASON_WORD[x.season]} sun to ${x.toCity} for ${x.brand}`),
    when((x) => x.nation === 'British' && x.season !== 'christmas' && x.season !== 'ski', (x) => `Half-term charters ${x.fromCity}–${x.toCity}`),
    when((x) => x.season === 'easter', (x) => `Easter programme to ${x.toCity}`),
    when((x) => x.season === 'autumn', (x) => `Autumn sun: ${x.toCity}`),
    when((x) => x.season === 'ski', (x) => `${x.brand} ski charters ${x.fromCity}–${x.toCity}`),
    when((x) => x.season === 'ski', (x) => `Snow programme to ${x.toCity} for ${x.brand}`),
    when((x) => x.to === 'FAO', (x) => `Golf season to Faro for ${x.brand}`),
    when((x) => CANARIES.includes(x.to) && (x.season === 'winter' || x.season === 'christmas' || x.season === 'autumn'), (x) => `${x.brand} winter sun to the Canaries`),
    when((x) => x.season === 'christmas' && MARKETS.includes(x.to), (x) => `Christmas markets programme ${x.toCity}`),
    when((x) => !!x.wide && longHaulBrand(x.client), (x) => `${x.brand} long-haul sun to ${x.toCity}`),
    (x) => `${x.brand} holiday flights ${x.fromCity}–${x.toCity}`,
    (x) => `${x.brand} ${x.month} departures to ${x.toCity}`,
    when((x) => x.season !== 'ski', (x) => `${x.toCity} beach programme for ${x.brand}`),
    (x) => `${x.brand} brochure flights to ${x.toCity}`,
  ],
  seasonBase: [
    when((x) => x.season === 'summer', (x) => `${x.brand} summer peak at ${x.fromCity}`),
    (x) => `Extra capacity for ${x.brand} at ${x.fromCity}`,
    (x) => `${possessive(x.brand)} ${seasonMid(x.season)} wet lease, ${x.fromCity}`,
    when((x) => x.season === 'summer' || x.season === 'christmas' || x.season === 'easter', (x) => `${x.brand} holiday peak cover`),
    (x) => `Base deployment ${x.fromCity} for ${x.brand}`,
    when((x) => x.n >= 120, (x) => `${x.brand} year-round capacity at ${x.fromCity}`),
    (x) => `${x.fromCity} wet lease for ${x.brand}`,
    (x) => `${x.brand} ${x.month} capacity at ${x.fromCity}`,
    when((x) => !!x.wide, (x) => `${x.brand} long-haul capacity from ${x.fromCity}`),
  ],
  aogCover: [
    (x) => `${x.brand} AOG cover at ${x.fromCity}`,
    (x) => `Rescue capacity for ${x.brand}`,
    (x) => `Stand-in aircraft for ${x.brand}`,
    when((x) => !!x.type, (x) => `${x.brand} needs a${/^[AEIOU8]/.test(x.type!) ? 'n' : ''} ${x.type} at ${x.fromCity}`),
    (x) => `${x.fromCity} AOG cover for ${x.brand}`,
    (x) => `Grounded-jet cover for ${x.brand}`,
    (x) => `${x.brand} schedule cover, ${x.fromCity}`,
    (x) => `Short-notice wet lease for ${x.brand}`,
  ],
  troopRotation: [
    when((x) => !!x.event, (x) => `${x.event} troop rotation`),
    when((x) => !!x.nation, (x) => `${x.nation} contingent rotation to ${x.toCity}`),
    when((x) => !!x.event && !!x.pk, (x) => `Peacekeeper rotation for ${x.event}`),
    when((x) => !!x.event, (x) => `${x.event} contingent swap, ${x.toCity}`),
    (x) => `Troop rotation to ${x.toCity}`,
    (x) => `Roulement flights to ${x.toCity}`,
    when((x) => !!x.nation, (x) => `${x.nation} forces to ${x.toCity}`),
  ],
  unRotation: [
    when((x) => !!x.event && !!x.pk, (x) => `Peacekeeper rotation for ${x.event}`),
    when((x) => !!x.event, (x) => `${x.event} troop rotation`),
    (x) => `UN rotation to ${x.toCity}`,
    when((x) => !!x.event, (x) => `${x.event} contingent swap, ${x.toCity}`),
    (x) => `Blue helmets to ${x.toCity}`,
  ],
  repatriation: [
    (x) => (x.n > 1 ? `Repatriation airlift from ${x.fromCity}` : `Repatriation from ${x.fromCity}`),
    (x) => `Evacuation flight${x.n > 1 ? 's' : ''} from ${x.fromCity}`,
    when((x) => !!x.nation, (x) => `Bringing ${x.nation} citizens home from ${x.fromCity}`),
    (x) => `${x.fromCity} assisted departure${x.n > 1 ? 's' : ''}`,
    (x) => `Consular flight${x.n > 1 ? 's' : ''} from ${x.fromCity}`,
  ],
};

/** Up to `tries` draws avoiding the client's last title, then the month appended ("… (June)"). ≤ 60 chars. */
export function pickTitle(r: RngHolder, fns: TitleFn[] | undefined, x: TitleCtx, last: string | undefined, fallback: string, tries = 4): string {
  const pool = (fns ?? []).map((f) => f(x)).filter((t) => t && t.length <= 60);
  if (!pool.length) pool.push(fallback);
  for (let i = 0; i < tries; i++) {
    const t = pool[Math.floor(next(r) * pool.length)];
    if (t !== last) return t;
  }
  const other = pool.find((t) => t !== last);
  return other ?? `${pool[0]} (${x.month})`;
}
