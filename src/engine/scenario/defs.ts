// v0.12 Scenarios mode (the player: "make a new playing mode 'scenarios' with fun, different, and challenging
// scenarios. I want variety."). Ten scenarios, each its own company, base, date, fleet, crew, cash, approvals and
// starting contracts, with its own pressure from the game's own machinery: a biased offer stream, scripted offers
// (drafts the game prices), world events (Ash Cloud's closure, Humanitarian Airlift's crises), phone calls (urgent,
// high-paying offers ring) and the usual disruptions. Fixed seed per scenario: the same choices give the same game.
// Goals are scored by scenario/index.ts (one measure with bronze/silver/gold thresholds, conditions, fail floors).

import type { SetupAircraft } from '../../data/setups';
import { TPL_BY_ID } from '../../data/worldEvents';
import { nextHajj } from '../../data/worldCalendar';
import { chance, int, pick } from '../core/rng';
import { DAY, fromUTC } from '../core/time';
import type { ApprovalId, Archetype, GameState, Livery } from '../core/types';
import { closedAirport, startEvent } from '../ops/world';
import { charterOffer, cityOf, clientNamed, fleetIds, localDep, note, offerOf, signFirst } from './kit';

/** What a scenario is scored on (scenario/index.ts METRICS). Every measure: more is better. */
export type MetricId = 'profit' | 'revenue' | 'posRun' | 'fOnTime' | 'fOnPlan' | 'pax' | 'fLegs' | 'rescues' | 'reliability' | 'wideBh' | 'regionBh' | 'fDone';

/** A condition every star needs at the end. */
export type Must =
  | { kind: 'reliability'; min: number }
  | { kind: 'focusLost'; max: number }
  | { kind: 'minLegs'; n: number };

export interface ScenarioDef {
  id: string;
  name: string;
  /** One line for the card. */
  story: string;
  region: string;
  /** The fleet in words: '2× 747-400'. */
  aircraft: string;
  /** The goal in a few words: 'Profit by 30 Sep'. */
  goal: string;
  difficulty: 1 | 2 | 3;
  seed: number;
  /** First day [year, month 1–12, day] and length in days (the results come at 00:00 UTC after the last day). */
  start: [number, number, number];
  days: number;
  company: { name: string; code: string; icao: string; callsign: string; base: string; livery: Livery };
  fleet: SetupAircraft[];
  /** Crew sets per aircraft (5 is a full roster). */
  sets: number;
  cash: number;
  approvals?: ApprovalId[];
  /** Applications filed before the start, granted after `days` (the authority's own checks still apply). */
  pending?: { id: ApprovalId; days: number }[];
  bias?: Partial<Record<Archetype, number>>;
  rate?: number;
  /** Contract kinds whose legs count apart (fLegs, fOnTime, fDone), and the region's countries (regionBh). */
  focus?: Archetype[];
  countries?: string[];
  noRescue?: boolean;
  noSale?: boolean;
  /** Money owed to us at the start: [client name, amount, days until due]. */
  owed?: [string, number, number][];
  metric: MetricId;
  /** Bronze, silver and gold thresholds on the metric. */
  stars: [number, number, number];
  must?: Must[];
  /** Ends early, no stars, when reliability falls below `reliability` % after `afterLegs` legs. */
  floor?: { reliability: number; afterLegs: number };
  /** The welcome note (the goal line follows it). */
  brief: string;
  /** After the game is built: contracts, events. */
  setup?(g: GameState): void;
  /** Steps on a scenario day (day 0 runs at the start). */
  script?: { day: number; run(g: GameState): void }[];
  /** Every scenario day (offer streams). */
  daily?(g: GameState): void;
}

const L = (primary: string, secondary: string, tail: Livery['tail'] = 'sweep'): Livery => ({ primary, secondary, tail });
const A = (typeId: string, owned: boolean, built: number, extra: Partial<SetupAircraft> = {}): SetupAircraft => ({ typeId, owned, built, wear: 'mid', ...extra });
const day0 = (g: GameState) => Math.floor(g.now / DAY) * DAY;
const daysIn = (g: GameState) => Math.floor((g.now - g.started) / DAY);

// ---------- 3 · Cash Crunch / 5 · Ash Cloud / 7 · Cup Final Week / 9 · Southern Winter / 10 · Humanitarian helpers ----------

const RESORTS = ['TFS', 'LPA', 'ACE', 'FUE', 'AGP', 'ALC', 'PMI', 'FAO', 'HER', 'RHO', 'DLM', 'AYT'];
/** Ash Cloud: who wants their stranded travellers moved, where they live, and the open airports nearest home. */
const STRANDED: { client: string; home: string[]; open: string }[] = [
  { client: 'Jet2holidays', home: ['MAN', 'LGW', 'LHR'], open: 'CDG' },
  { client: 'Sunweb', home: ['AMS'], open: 'BRU' },
  { client: 'Corendon', home: ['AMS'], open: 'DUS' },
  { client: 'Joe Walsh Tours', home: ['DUB'], open: 'CDG' },
  { client: 'Novatours', home: ['RIX', 'TLL'], open: 'VNO' },
  { client: 'Schauinsland-Reisen', home: ['HAM'], open: 'DUS' },
];
const isClosed = (g: GameState, code: string) => !!closedAirport(g, code);

/** Cup Final Week: travel firms with fans, where they fly from. */
const FAN_FIRMS: [string, string][] = [
  ['Sportsworld Group Travel', 'LGW'], ['Joe Walsh Tours', 'DUB'], ['Kuoni Group Travel', 'ZRH'], ['Hotelplan Group', 'BSL'], ['Viagens Abreu', 'OPO'],
  ['Sunweb', 'AMS'], ['Schauinsland-Reisen', 'DUS'], ['Čedok', 'PRG'], ['Novatours', 'VNO'], ['TUI Deutschland', 'MUC'], ['Jet2holidays', 'MAN'], ['Corendon', 'EIN'],
];

/** Southern Winter: the South American airlines that wet-lease narrowbodies in the southern summer. */
const SOUTH: [string, string][] = [['GOL Linhas Aéreas', 'BSB'], ['LATAM Brasil', 'GRU'], ['Azul Brazilian Airlines', 'GRU'], ['LATAM Perú', 'LIM']];
const SOUTH_COUNTRIES = ['BR', 'AR', 'CL', 'UY', 'PY', 'PE', 'BO', 'EC', 'CO', 'VE'];

const MISSIONS: Archetype[] = ['evacuation', 'repatriation', 'humanitarian', 'medical'];

export const SCENARIOS: ScenarioDef[] = [
  // ---------- 1 ----------
  {
    id: 'summerSurge', name: 'Summer Surge', difficulty: 1, seed: 2701,
    story: 'An Iberian charter operator with a full summer ahead. Make it pay.',
    region: 'Spain and the Mediterranean', aircraft: '2× A320 + 1× A321', goal: 'Profit by 30 September',
    start: [2027, 5, 1], days: 153,
    company: { name: 'Iberosol Charter', code: 'I9', icao: 'ISQ', callsign: 'SOLAIR', base: 'MAD', livery: L('#ff7a00', '#f5c451') },
    fleet: [A('a320ceo', true, 2008), A('a320ceo', false, 2014, { lessor: 'Avolon' }), A('a321ceo', false, 2012, { lessor: 'AerCap' })],
    sets: 5, cash: 2_500_000,
    bias: { seasonBase: 1.5, adhoc: 1.4, tourSeries: 1.4, sports: 1.2, troopRotation: 0.5, repatriation: 0.7, vip: 0.7 }, rate: 1.35,
    metric: 'profit', stars: [150_000, 800_000, 1_500_000],
    brief: 'Madrid, May. Tour operators want seats to the islands and the coasts, and every airline is short of aircraft. One season base is signed; two aircraft are free. Fill them, keep them flying and bank the summer.',
    setup(g) {
      const [a, b, c] = fleetIds(g);
      // A summer base for an airline that flies the A320 family (Iberia's neighbours first).
      const who = ['TAP Air Portugal', 'Eurowings', 'Condor', 'Aegean Airlines'].map((n) => clientNamed(g, n)).filter((x) => !!x);
      let i = 0;
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, client: who[i++ % who.length], start: g.now + 12 * DAY, days: 120 }, 2), [c, a, b], 8);
    },
  },
  // ---------- 2 ----------
  {
    id: 'aogFirefighter', name: 'AOG Firefighter', difficulty: 2, seed: 2702,
    story: 'Two standby A320s. When an airline’s jet breaks, the phone rings.',
    region: 'Northern and central Europe', aircraft: '2× A320', goal: 'Revenue, with 95 % of legs flown',
    start: [2027, 6, 1], days: 61,
    company: { name: 'Amberline Air', code: 'AB', icao: 'ABL', callsign: 'AMBERLINE', base: 'VNO', livery: L('#c8a000', '#202733', 'stripe') },
    fleet: [A('a320ceo', true, 2009), A('a320ceo', false, 2013, { lessor: 'AerCap' })],
    sets: 5, cash: 2_000_000,
    bias: { aogCover: 3, seasonBase: 0.3, tourSeries: 0.3, troopRotation: 0.3, sports: 0.6 }, rate: 1.1,
    metric: 'revenue', stars: [2_500_000, 4_000_000, 5_200_000],
    must: [{ kind: 'reliability', min: 95 }], floor: { reliability: 85, afterLegs: 20 },
    brief: 'Vilnius, June. Two A320s on standby with crews on call. Airlines across Europe will ring when an aircraft goes technical: be airborne within hours, fly their schedule and hand it back. Every leg we fail counts against us.',
    script: [{ day: 0, run: (g) => { offerOf(g, 'aogCover', { wide: false, start: g.now + 10 * 60 }); } }],
    daily(g) {
      if (chance(g, 0.42)) offerOf(g, 'aogCover', { wide: false }, 2);
    },
  },
  // ---------- 3 ----------
  {
    id: 'cashCrunch', name: 'Cash Crunch', difficulty: 3, seed: 2703,
    story: 'Take over a nearly bankrupt operator: no cash, rent overdue, aircraft idle.',
    region: 'The Balkans and Europe', aircraft: '2× A320 + 1× 737-800', goal: 'Days in a row with cash above zero',
    start: [2027, 3, 15], days: 90,
    company: { name: 'Balkan Wings', code: 'B9', icao: 'BWQ', callsign: 'BALKANWING', base: 'SOF', livery: L('#0f9d76', '#ffffff', 'split') },
    fleet: [A('a320ceo', true, 2004), A('a320ceo', true, 2006), A('b738', false, 2012, { lessor: 'Carlyle Aviation Partners' })],
    sets: 4, cash: -350_000, noRescue: true, noSale: true, owed: [['Bulgaria Air', 620_000, 9], ['Bulgarian Ministry of Defence', 780_000, 21]],
    bias: { aogCover: 1.6, adhoc: 1.4, seasonBase: 1.3, sports: 1.2 }, rate: 1.3,
    metric: 'posRun', stars: [1, 30, 55],
    brief: 'Sofia. The board has handed you the keys: the account is overdrawn, the 737’s rent is a month late and the aircraft have stood idle since January. Bulgaria Air and the Ministry of Defence still owe us for the winter. No investor will rescue us this time, and the bank holds both A320s as security: if cash falls below −$2M the creditors close the company. Pick work that pays fast, chase every invoice and keep cash above zero.',
    script: [{ day: 0, run: (g) => note(g, 'The lessor is waiting', 'Carlyle wants last month’s rent on the 737 with this month’s. Our bank will carry us to −$2M and no further.', 'warn') }],
  },
  // ---------- 4 ----------
  {
    id: 'hajjAirlift', name: 'Hajj Airlift', difficulty: 3, seed: 2704,
    story: 'Two 747-400s fly pilgrims to Jeddah and Medina on a fixed schedule.',
    region: 'North and West Africa, Saudi Arabia', aircraft: '2× 747-400', goal: 'Hajj legs on time',
    start: [2027, 4, 6], days: 75,
    company: { name: 'Anfa Air Charter', code: 'A9', icao: 'AFQ', callsign: 'ANFA', base: 'CMN', livery: L('#0f9d76', '#d6283c') },
    fleet: [A('b744', true, 2002, { cabin: 1 }), A('b744', false, 2004, { cabin: 1, lessor: 'Global Aircraft Leasing' })],
    sets: 6, cash: 3_500_000, approvals: ['widebody', 'augmented'],
    bias: { hajj: 0, seasonBase: 0.5, tourSeries: 0.5 },
    focus: ['hajj'], metric: 'fOnPlan', stars: [75, 88, 96],
    brief: 'Casablanca, April. Both jumbos are signed for the Hajj: Casablanca and Dakar to Jeddah and Medina from 13 April, and the pilgrims home after Eid until mid-June. Long days, augmented crews, hot nights in Jeddah. The schedule is fixed: the pilgrims cannot wait.',
    setup(g) {
      const h = nextHajj(g.now, 1)[0];
      const [a, b] = fleetIds(g);
      const ram = clientNamed(g, 'Royal Air Maroc');
      const sen = clientNamed(g, 'Air Sénégal') ?? clientNamed(g, 'Présidence de la République du Sénégal');
      signFirst(g, () => offerOf(g, 'hajj', { wide: true, airport: 'CMN', client: ram, hajj: h }), [a, b]);
      signFirst(g, () => offerOf(g, 'hajj', { wide: true, airport: 'DSS', client: sen, hajj: h }), [b, a]);
    },
  },
  // ---------- 5 ----------
  {
    id: 'ashCloud', name: 'Ash Cloud', difficulty: 2, seed: 2705,
    story: 'An Icelandic volcano shuts northern Europe’s skies. Save what you can.',
    region: 'Western Europe', aircraft: '3× 737-800', goal: 'Rescue flights flown',
    start: [2027, 4, 10], days: 30,
    company: { name: 'Douro Air', code: 'D9', icao: 'DRQ', callsign: 'DOURO', base: 'OPO', livery: L('#7a3cff', '#f5c451') },
    fleet: [A('b738', true, 2007), A('b738', false, 2012, { lessor: 'SMBC Aviation Capital' }), A('b738', false, 2015, { lessor: 'Avolon' })],
    sets: 5, cash: 2_500_000,
    bias: { repatriation: 1.5, adhoc: 1.3 },
    focus: ['repatriation'], metric: 'rescues', stars: [6, 14, 22],
    brief: 'Porto, April. Two of our 737s are about to start for Jet2 in Manchester and SAS in Stockholm; the third is free. Iceland’s volcanoes have been restless all week.',
    setup(g) {
      const [a, b, c] = fleetIds(g);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, client: clientNamed(g, 'Jet2.com'), airport: 'MAN', start: g.now + 1 * DAY, days: 40 }), [a, b, c]);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, client: clientNamed(g, 'SAS Scandinavian Airlines'), airport: 'ARN', start: g.now + 2 * DAY, days: 40 }), [b, c, a]);
    },
    script: [
      { day: 3, run: (g) => note(g, 'Katla is restless', 'The Icelandic Met Office has raised Katla to orange: earthquakes under the Mýrdalsjökull ice cap. An eruption could put ash over Europe within a day.', 'warn') },
      { day: 4, run: (g) => { startEvent(g, TPL_BY_ID.ashKatla); } },
    ],
    daily(g) {
      const d = daysIn(g);
      if (d < 4) return;
      const shut = isClosed(g, 'LHR');
      // While it is shut: stranded holidaymakers to the open airport nearest home (coaches and ferries from there).
      // Once it opens: the backlog home, for six days.
      const m = (g.scen!.mem ??= {});
      if (shut) m.shut = 1;
      else if (m.shut && m.open === undefined) m.open = d;
      if (!shut && (m.open === undefined || d - m.open > 6)) return;
      const n = shut ? int(g, 1, 2) : int(g, 2, 3);
      for (let i = 0; i < n; i++) {
        const s = pick(g, STRANDED);
        const resort = pick(g, RESORTS);
        const to = shut ? s.open : pick(g, s.home);
        const pax = int(g, 150, 189);
        charterOffer(g, {
          archetype: 'repatriation', client: s.client, expiresH: int(g, 10, 30),
          title: shut ? `Stranded in ${cityOf(resort)}: to ${cityOf(to)}` : `Ash backlog: ${cityOf(resort)}–${cityOf(to)}`,
          blurb: shut
            ? `${s.client} has ${pax} customers stuck in ${cityOf(resort)} with their flights home cancelled. ${cityOf(to)} is open: coaches and ferries take them on from there. One way; we come back empty.`
            : `The skies are open again and ${s.client} still has ${pax} customers waiting in ${cityOf(resort)}. One way home to ${cityOf(to)}.`,
          legs: [[resort, to, localDep(g, resort, int(g, 1, 2), int(g, 14, 40) * 30), pax]],
          mult: shut ? 1.35 : 1.2, effects: { reliable: 1, morale: 3 }, risk: { disruption: 0.4, politics: 0, permit: 0 },
        });
      }
    },
  },
  // ---------- 6 ----------
  {
    id: 'crewCrisis', name: 'Crew Crisis', difficulty: 3, seed: 2706,
    story: 'Half your crews have gone to a rival. Three contracts start next week.',
    region: 'The Baltics and the Nordics', aircraft: '2× A320 + 1× A321', goal: 'Legs flown as planned',
    start: [2027, 5, 20], days: 42,
    company: { name: 'Daugava Wetlease', code: 'DW', icao: 'DGW', callsign: 'DAUGAVA', base: 'RIX', livery: L('#d6283c', '#ffffff', 'solid') },
    fleet: [A('a320ceo', true, 2007), A('a320ceo', false, 2014, { lessor: 'AerCap' }), A('a321ceo', false, 2013, { lessor: 'Avolon' })],
    sets: 2.6, cash: 3_000_000,
    metric: 'reliability', stars: [75, 88, 96], must: [{ kind: 'minLegs', n: 120 }],
    brief: 'Riga, late May. A rival opened a base next door and took half our pilots and cabin crew. The summer is signed: three contracts start within ten days. Hire, train, juggle the roster, sub-charter if you must, and keep the legs flying.',
    setup(g) {
      const [a, b, c] = fleetIds(g);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, start: g.now + 5 * DAY, days: 60 }), [c, a, b]);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, start: g.now + 8 * DAY, days: 60 }), [a, b, c]);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, start: g.now + 10 * DAY, days: 45 }), [b, a, c]);
    },
  },
  // ---------- 7 ----------
  {
    id: 'cupFinal', name: 'Cup Final Week', difficulty: 2, seed: 2707,
    story: 'The cup final is in Madrid. Every fan in Europe wants a seat.',
    region: 'All of Europe to Madrid', aircraft: '2× A321 + 1× A320', goal: 'Charter legs flown',
    start: [2027, 5, 22], days: 11,
    company: { name: 'Vltava Air Charter', code: 'VC', icao: 'VTC', callsign: 'VLTAVA', base: 'PRG', livery: L('#202733', '#ff5d8f', 'stripe') },
    fleet: [A('a321ceo', true, 2010), A('a321ceo', false, 2015, { lessor: 'AerCap' }), A('a320ceo', false, 2013, { lessor: 'Avolon' })],
    sets: 5, cash: 2_000_000,
    bias: { sports: 2, adhoc: 1.5, seasonBase: 0.3, tourSeries: 0.3 },
    focus: ['sports', 'adhoc'], metric: 'fLegs', stars: [6, 12, 18],
    brief: 'Prague. The final is at the Metropolitano on Saturday 29 May. Tour firms all over Europe want fans in Madrid the day before and home on Sunday, and both finalists need a team charter. The requests come in fast and do not wait long.',
    script: [0, 1, 2, 3, 4].map((day) => ({
      day,
      run(g: GameState) {
        const final = fromUTC(2027, 5, 29);
        const todo = FAN_FIRMS.filter((_, i) => i % 5 === day || (day === 4 && i % 5 === 4));
        for (const [firm, from] of todo) {
          const pax = int(g, 160, 220);
          const out = localDep(g, from, Math.round((final - DAY - day0(g)) / DAY), int(g, 14, 34) * 30);
          const back = localDep(g, 'MAD', Math.round((final + DAY - day0(g)) / DAY), int(g, 20, 34) * 30);
          charterOffer(g, {
            archetype: 'adhoc', client: firm, expiresH: int(g, 20, 40),
            title: `Final fans ${cityOf(from)}–Madrid`, blurb: `${firm}: ${pax} fans with match tickets to Madrid on Friday, home on Sunday after the final. Flags, songs and a dry bar on the way out.`,
            legs: [[from, 'MAD', out, pax], [`MAD`, from, back, pax]], mult: 1.25, effects: { morale: 2 },
          });
        }
        if (day === 1) {
          for (const [club, from] of [['Manchester United', 'MAN'], ['SL Benfica', 'LIS']] as const) {
            const out = localDep(g, from, Math.round((final - 2 * DAY - day0(g)) / DAY), 15 * 60);
            const back = localDep(g, 'MAD', Math.round((final - day0(g)) / DAY), 23 * 60 + 30);
            charterOffer(g, {
              archetype: 'sports', client: club, expiresH: 36, extraCabin: 2,
              title: `Team charter ${cityOf(from)}–Madrid`, blurb: `${club} are in the final. Squad, staff and sponsors to Madrid on Thursday, home straight after the match. Two extra cabin crew; no delays, please.`,
              legs: [[from, 'MAD', out, int(g, 110, 140)], ['MAD', from, back, int(g, 110, 140)]], mult: 1.3, effects: { morale: 3, reliable: 1 },
            });
          }
        }
      },
    })),
  },
  // ---------- 8 ----------
  {
    id: 'longHaulDebut', name: 'Long-Haul Debut', difficulty: 2, seed: 2708,
    story: 'Your first widebody is here. Earn the approvals, crew it and fly it.',
    region: 'Europe and across the Atlantic', aircraft: '2× A320 + 1× A330-200', goal: 'Widebody block hours',
    start: [2027, 3, 1], days: 150,
    company: { name: 'Atlântica Wings', code: 'W7', icao: 'AWQ', callsign: 'ATLANTICA', base: 'LIS', livery: L('#0b1f4d', '#f5c451') },
    fleet: [A('a320ceo', true, 2006), A('a320ceo', false, 2013, { lessor: 'AerCap' }), A('a332', false, 2008, { lessor: 'Avolon', noCrew: true })],
    sets: 5, cash: 5_000_000, pending: [{ id: 'etops120', days: 20 }, { id: 'widebody', days: 35 }],
    metric: 'wideBh', stars: [150, 500, 800],
    brief: 'Lisbon, March. The A330-200 is on the ramp and costing rent from today. ETOPS 120 and Widebody operations are filed; the authority grants Widebody operations only with 4 captains and 4 first officers rated on a widebody, and we have the A320 crews only. Hire or convert, find long-haul work and fly it before the end of July.',
  },
  // ---------- 9 ----------
  {
    id: 'southernWinter', name: 'Southern Winter', difficulty: 2, seed: 2709,
    story: 'Europe goes quiet. Brazil and Peru are in high summer. Take the fleet south.',
    region: 'South America', aircraft: '3× 737-800', goal: 'Block hours in South America',
    start: [2027, 11, 1], days: 120,
    company: { name: 'Toompea Aviation', code: 'T9', icao: 'TQA', callsign: 'TOOMPEA', base: 'LIS', livery: L('#00a3c4', '#ffffff', 'split') },
    fleet: [A('b738', true, 2008), A('b738', false, 2013, { lessor: 'SMBC Aviation Capital' }), A('b738', false, 2015, { lessor: 'AerCap' })],
    sets: 5, cash: 3_000_000, approvals: ['etops120'],
    bias: { seasonBase: 0.6, tourSeries: 0.6, troopRotation: 0.5 },
    countries: SOUTH_COUNTRIES, metric: 'regionBh', stars: [500, 1100, 1700],
    brief: 'Lisbon, November. The European winter is thin, and the South American airlines want extra 737s for their summer from December to March. The aircraft fly down via Cape Verde; the crews live in hotels there for weeks. Find the work and keep them busy.',
    setup(g) {
      const [a, b, c] = fleetIds(g);
      signFirst(g, () => offerOf(g, 'seasonBase', { wide: false, client: clientNamed(g, 'GOL Linhas Aéreas'), airport: 'BSB', start: fromUTC(2027, 12, 1), days: 90 }), [a, b, c]);
    },
    daily(g) {
      if (daysIn(g) > 75 || !chance(g, 0.3)) return;
      const [name, base] = pick(g, SOUTH);
      const client = clientNamed(g, name);
      if (chance(g, 0.75)) offerOf(g, 'seasonBase', { wide: false, client, airport: base, start: g.now + int(g, 12, 30) * DAY, days: int(g, 30, 75) }, 2);
      else offerOf(g, 'aogCover', { wide: false, client, airport: base, start: g.now + int(g, 30, 60) * 60, days: int(g, 7, 14) }, 2);
    },
  },
  // ---------- 10 ----------
  {
    id: 'humanitarian', name: 'Humanitarian Airlift', difficulty: 3, seed: 2710,
    story: 'Evacuations, medical airbridges and relief flights, at short notice.',
    region: 'The Mediterranean and Africa', aircraft: '1× 767-300ER + 1× A321', goal: 'Missions completed',
    start: [2027, 6, 10], days: 45,
    company: { name: 'Valletta Jetlease', code: 'V9', icao: 'VJQ', callsign: 'MALTESE', base: 'MLA', livery: L('#ffffff', '#d6283c', 'solid') },
    fleet: [A('b763', false, 2003, { cabin: 1, lessor: 'Aircastle' }), A('a321ceo', true, 2010)],
    sets: 5, cash: 3_000_000, approvals: ['widebody', 'etops120', 'dg'],
    bias: { evacuation: 2, repatriation: 2, medical: 2, seasonBase: 0.4, tourSeries: 0.4 },
    focus: MISSIONS, metric: 'fDone', stars: [2, 4, 6],
    brief: 'Malta, June. Embassies, the UN and the aid agencies keep our number for short-notice work: evacuations under war-risk cover, medical airbridges, relief into places nobody else flies. Permits slip, insurers withdraw, plans change by the hour.',
    script: [
      { day: 1, run: (g) => { startEvent(g, TPL_BY_ID.warLibya); } },
      { day: 5, run: (g) => { offerOf(g, 'medical', { airport: 'ADD', wide: false }); } },
      { day: 9, run: (g) => { offerOf(g, 'humanitarian', { airport: 'PZU', wide: true }); } },
      { day: 14, run: (g) => { startEvent(g, TPL_BY_ID.coupNiger); } },
      { day: 20, run: (g) => { offerOf(g, 'medical', { airport: 'JUB', wide: false }); } },
      { day: 25, run: (g) => { offerOf(g, 'repatriation', { airport: 'BKO' }); } },
      { day: 31, run: (g) => { offerOf(g, 'humanitarian', { airport: 'NDJ', wide: false }); } },
      { day: 36, run: (g) => { offerOf(g, 'evacuation', { airport: 'PAP', staging: 'SDQ' }); } },
    ],
  },
];

export const SCENARIO_BY_ID: Record<string, ScenarioDef> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));
