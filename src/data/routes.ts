// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §B, §G): the markets we can open from Lisbon (and Porto), and the
// stations' costs. Values from /home/user/work/v019/research-econ.md and research-regops.md: [F] sourced, [E] estimate.
// Money in USD at $1 ≈ €0.86. Data only: no market is open until the player starts its study.

import type { RouteModel, Segment } from '../engine/network/types';
import { AIRPORT_BY_CODE } from './airports';

/** §G one station's costs for a 767-300ER turn (other types scale by √(MTOW/187 t)). */
export interface RouteStation {
  code: string;
  /** Fuel price against the world price (into-plane at this station). */
  fuelX: number;
  /** Landing, parking, lighting, terminal control (USD a turn). */
  airport: number;
  /** Ground handling a widebody turn (USD); a narrowbody pays half. */
  handling: number;
  /** Airline-borne charges per departing passenger (PRM, CUPPS, baggage system; not the taxes passed on). */
  paxCharge: number;
  /** Station manager or GSA, office, permits renewal (USD a month; a tech stop less). */
  overhead: number;
  /** EU ORO.FC.105 aerodrome category (B: a briefing, C: an observation flight or simulator). */
  cat: 'A' | 'B' | 'C';
  /** A caterer that meets the standard (else the return is loaded at Lisbon: double catering). */
  caterer: boolean;
  /** Cargo security validated for the EU (ACC3): else no cargo north from here. */
  euCargo: boolean;
  /** Taxes and airport passenger charges collected per departing passenger and passed on (shown, not booked). */
  taxes: number;
}

/** A rival's service on the market (one way a week). */
export interface RouteCompetitor {
  name: string;
  /** Flights a week each way. */
  perWeek: number;
  /** 0 nonstop; 1–2 connections. */
  stops: number;
  /** Door-to-door hours. */
  hours: number;
  /** Its fare against ours at the Market level (1 = the same). */
  fareX: number;
  /** Its seats a flight (capacity cap for the share). */
  seats: number;
  /** v0.19.2 the hub of a one-stop rival (the builder's map draws it faintly). */
  via?: string;
}

export interface RouteMarket {
  /** 'LIS-OXB'. */
  id: string;
  from: string;
  to: string;
  /** City name for the player ("Bissau"). */
  city: string;
  country: string;
  /** Fuel stops out and back (no traffic rights there: second freedom). */
  via?: string[];
  viaBack?: string[];
  models: RouteModel[];
  model: RouteModel;
  partner?: { name: string; code: string; country: string };
  /** Passengers a year, both ways, between the two cities (including flows connecting at our hub) [F/E]. */
  odPerYear: number;
  /** Share of the O&D travelling out (from → to); DIL is out-heavy. */
  outShare: number;
  /** Growth a year. */
  growth: number;
  /** 12 values (Jan..Dec) for the out direction; absent = BAL.v019.demand.season. */
  season?: number[];
  /** The back direction's season (absent = `season` shifted per BAL.v019.demand.backShift). */
  seasonBack?: number[];
  segments: Partial<Record<Segment, number>>;
  competitors: RouteCompetitor[];
  /** Net one-way fare, off-peak → peak (USD, excluding taxes passed on). */
  fareY: [number, number];
  fareJ: [number, number];
  /** Cargo demand per rotation (kg): general south and north, live animals, mail, perishables north, NGO south. */
  cargo: { south: number; north: number; avi?: number; mail?: number; perish?: number; ngo?: number };
  /** Ancillary revenue per passenger (USD): bags, seats, onboard. */
  ancillary: number;
  /** Share of passengers paying an extra bag (VFR routes: high). */
  bagShare: number;
  /** Default timetable [F]: weekly on a day (0 = Monday), or monthly on the first `day`. */
  timetable: { pattern: 'weekly' | 'monthly'; day: number; out: number; back: number; nights: number };
  /** En-route navigation for a 767 one way (USD). */
  navPerSector: number;
  /** Greyed out in the catalogue: the reason. */
  closed?: string;
  /** Political risk (chance a year of a closure), currency repatriation risk (share of ticket cash held). */
  risk?: { coup?: number; fx?: number };
  /** Bilateral or permit regime in words (the launch's rights stage). */
  rights: 'bilateral' | 'partner' | 'perFlight' | 'open';
  /** EU261 band by great-circle km (compensation, downgrade refund). */
  eu261: 'mid' | 'long';
  /** Short reason the player sees in the catalogue. */
  blurb: string;
  /** v0.19.2 a market the player built (engine/network/custom.ts): not researched, so the study's spread is wider. */
  custom?: true;
  /** v0.19.2 how hard the traffic rights are for a newcomer (0 open skies … 0.7 very hard): longer, dearer, riskier. */
  rightsHard?: number;
}

/** §G stations (767 reference). */
export const ROUTE_STATIONS: Record<string, RouteStation> = {
  LIS: { code: 'LIS', fuelX: 1.0, airport: 2_200, handling: 4_500, paxCharge: 2.2, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 44 },
  OPO: { code: 'OPO', fuelX: 1.0, airport: 1_900, handling: 4_200, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
  OXB: { code: 'OXB', fuelX: 1.17, airport: 2_900, handling: 5_200, paxCharge: 1, overhead: 10_000, cat: 'B', caterer: false, euCargo: false, taxes: 62 },
  TMS: { code: 'TMS', fuelX: 1.17, airport: 2_700, handling: 5_000, paxCharge: 1, overhead: 10_000, cat: 'B', caterer: false, euCargo: true, taxes: 55 },
  DIL: { code: 'DIL', fuelX: 1.35, airport: 3_500, handling: 4_600, paxCharge: 1, overhead: 12_000, cat: 'C', caterer: false, euCargo: false, taxes: 30 },
  DXB: { code: 'DXB', fuelX: 1.0, airport: 2_500, handling: 2_400, paxCharge: 0, overhead: 2_000, cat: 'A', caterer: true, euCargo: true, taxes: 0 },
  KUL: { code: 'KUL', fuelX: 0.98, airport: 1_800, handling: 2_400, paxCharge: 0, overhead: 2_000, cat: 'A', caterer: true, euCargo: true, taxes: 0 },
  RAI: { code: 'RAI', fuelX: 1.12, airport: 2_400, handling: 4_400, paxCharge: 1, overhead: 9_000, cat: 'B', caterer: true, euCargo: true, taxes: 48 },
  SID: { code: 'SID', fuelX: 1.12, airport: 2_300, handling: 4_200, paxCharge: 1, overhead: 7_000, cat: 'A', caterer: true, euCargo: true, taxes: 48 },
  BVC: { code: 'BVC', fuelX: 1.15, airport: 2_100, handling: 4_200, paxCharge: 1, overhead: 7_000, cat: 'B', caterer: false, euCargo: true, taxes: 48 },
  LAD: { code: 'LAD', fuelX: 1.10, airport: 3_400, handling: 5_600, paxCharge: 1.5, overhead: 14_000, cat: 'A', caterer: true, euCargo: true, taxes: 70 },
  MPM: { code: 'MPM', fuelX: 1.15, airport: 3_000, handling: 5_000, paxCharge: 1.5, overhead: 11_000, cat: 'A', caterer: true, euCargo: true, taxes: 60 },
  REC: { code: 'REC', fuelX: 1.08, airport: 2_600, handling: 4_400, paxCharge: 1.5, overhead: 9_000, cat: 'A', caterer: true, euCargo: true, taxes: 52 },
  FOR: { code: 'FOR', fuelX: 1.08, airport: 2_500, handling: 4_400, paxCharge: 1.5, overhead: 9_000, cat: 'A', caterer: true, euCargo: true, taxes: 52 },
  CCS: { code: 'CCS', fuelX: 0.9, airport: 3_000, handling: 5_000, paxCharge: 1.5, overhead: 12_000, cat: 'B', caterer: true, euCargo: false, taxes: 80 },
};

/** §B the catalogue. */
export const ROUTE_MARKETS: RouteMarket[] = [
  {
    id: 'LIS-OXB', from: 'LIS', to: 'OXB', city: 'Bissau', country: 'Guinea-Bissau',
    models: ['own', 'tour'], model: 'own',
    // [F] OXB ~50,000 a year in all, demand above supply; Lisbon's flows incl. those connecting at LIS [E].
    odPerYear: 46_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.62, gov: 0.10, ngo: 0.14, students: 0.08, tourism: 0.06 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 3, stops: 0, hours: 4.3, fareX: 1.1, seats: 168 },
      { name: 'Royal Air Maroc via Casablanca', perWeek: 7, stops: 1, hours: 9.5, fareX: 0.8, seats: 25 },
      { name: 'Air Senegal via Dakar', perWeek: 5, stops: 1, hours: 8, fareX: 0.85, seats: 20 },
      { name: 'ASKY via Lomé', perWeek: 4, stops: 1, hours: 12, fareX: 0.8, seats: 15 },
    ],
    fareY: [300, 720], fareJ: [930, 1_750],
    // [F] YU "never sold the belly" north: OXB has no EU cargo security (ACC3).
    cargo: { south: 4_000, north: 0, mail: 300, ngo: 400 },
    ancillary: 25, bagShare: 0.35,
    // [F] YU351/352 Friday: LIS 06:40 → OXB, back OXB 13:30 → LIS 18:30 (local; LIS is UTC+0/+1).
    timetable: { pattern: 'weekly', day: 4, out: 400, back: 810, nights: 0 },
    navPerSector: 3_200, risk: { coup: 0.12 }, rights: 'bilateral', eu261: 'mid',
    blurb: 'Diaspora route, demand above supply. TAP 3 a week. No cargo north.',
  },
  {
    id: 'LIS-TMS', from: 'LIS', to: 'TMS', city: 'São Tomé', country: 'São Tomé and Príncipe',
    models: ['partner', 'own'], model: 'partner', partner: { name: 'STP Airways', code: '8F', country: 'ST' },
    odPerYear: 45_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.55, gov: 0.12, biz: 0.15, tourism: 0.10, students: 0.08 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 5, stops: 0, hours: 6.5, fareX: 1.05, seats: 168 },
      { name: 'TAAG via Luanda', perWeek: 3, stops: 1, hours: 13, fareX: 0.85, seats: 20 },
      { name: 'ASKY via Lomé', perWeek: 3, stops: 1, hours: 12, fareX: 0.85, seats: 12 },
    ],
    fareY: [350, 650], fareJ: [1_160, 1_980],
    // [F] day-old chicks on every flight (IATA LAR live animals); [E] fish and cocoa north.
    cargo: { south: 3_000, north: 700, avi: 700, mail: 200, perish: 400 },
    ancillary: 22, bagShare: 0.33,
    timetable: { pattern: 'weekly', day: 5, out: 600, back: 1_110, nights: 0 },
    navPerSector: 4_200, risk: { coup: 0.04 }, rights: 'partner', eu261: 'long',
    blurb: 'Flown for STP Airways (on the EU ban list). Chicks south on every flight.',
  },
  {
    id: 'LIS-DIL', from: 'LIS', to: 'DIL', city: 'Dili', country: 'Timor-Leste',
    via: ['DXB'], viaBack: ['KUL', 'DXB'],
    models: ['tour', 'own'], model: 'tour',
    // [E] ~6,000 Europe–Timor-Leste a year; [F] 188 out, 36 back (Mar 2021).
    odPerYear: 6_000, outShare: 0.72, growth: 0.02,
    // Teachers out in January and September, back in July and December.
    season: [1.6, 0.6, 0.7, 0.8, 0.6, 0.7, 0.8, 0.9, 1.6, 0.8, 0.8, 1.1],
    seasonBack: [0.8, 0.5, 0.6, 0.8, 0.6, 0.9, 1.7, 0.9, 0.6, 0.6, 0.8, 1.7],
    segments: { teachers: 0.35, gov: 0.20, vfr: 0.35, ngo: 0.10 },
    competitors: [
      { name: 'Emirates + Air Timor via Singapore', perWeek: 7, stops: 2, hours: 26, fareX: 0.75, seats: 6 },
      { name: 'Qatar + Citilink via Bali', perWeek: 7, stops: 2, hours: 27, fareX: 0.7, seats: 6 },
    ],
    fareY: [1_750, 2_300], fareJ: [4_050, 5_200],
    // [F] ~3 t of medicines and donations out (2021); [E] coffee back.
    cargo: { south: 1_000, north: 500, ngo: 2_000, mail: 100 },
    ancillary: 15, bagShare: 0.15,
    timetable: { pattern: 'monthly', day: 4, out: 1_320, back: 1_080, nights: 2 },
    navPerSector: 8_500, risk: { coup: 0.02 }, rights: 'perFlight', eu261: 'long',
    blurb: 'Monthly charter series, via Dubai out and Kuala Lumpur and Dubai back. Needs group blocks.',
  },
  {
    id: 'LIS-RAI', from: 'LIS', to: 'RAI', city: 'Praia', country: 'Cabo Verde',
    models: ['own'], model: 'own',
    odPerYear: 120_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.58, gov: 0.08, biz: 0.14, tourism: 0.12, students: 0.08 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 10, stops: 0, hours: 4.2, fareX: 1.0, seats: 168 },
      { name: 'Cabo Verde Airlines', perWeek: 4, stops: 0, hours: 4.2, fareX: 0.95, seats: 160 },
    ],
    fareY: [210, 520], fareJ: [700, 1_300],
    cargo: { south: 2_500, north: 300, mail: 200, perish: 200 },
    ancillary: 22, bagShare: 0.32,
    timetable: { pattern: 'weekly', day: 3, out: 540, back: 900, nights: 0 },
    navPerSector: 2_400, rights: 'bilateral', eu261: 'mid',
    blurb: 'Big Cabo Verde diaspora, hard competition. Runway limits a 767.',
  },
  {
    id: 'LIS-SID', from: 'LIS', to: 'SID', city: 'Sal', country: 'Cabo Verde',
    models: ['tour'], model: 'tour',
    odPerYear: 40_000, outShare: 0.5, growth: 0.04,
    season: [1.25, 1.2, 1.15, 1.05, 0.7, 0.7, 1.0, 1.15, 0.8, 0.85, 1.0, 1.3],
    segments: { tourism: 0.85, vfr: 0.10, biz: 0.05 },
    competitors: [{ name: 'TAP Air Portugal', perWeek: 4, stops: 0, hours: 3.9, fareX: 1.1, seats: 168 }],
    fareY: [190, 420], fareJ: [600, 950],
    cargo: { south: 800, north: 100 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 6, out: 600, back: 960, nights: 0 },
    navPerSector: 2_300, rights: 'open', eu261: 'mid',
    blurb: 'Winter sun, sold as holidays by our tour operator.',
  },
  {
    id: 'LIS-BVC', from: 'LIS', to: 'BVC', city: 'Boa Vista', country: 'Cabo Verde',
    models: ['tour'], model: 'tour',
    odPerYear: 22_000, outShare: 0.5, growth: 0.04,
    season: [1.25, 1.2, 1.15, 1.05, 0.7, 0.7, 1.0, 1.15, 0.8, 0.85, 1.0, 1.3],
    segments: { tourism: 0.92, vfr: 0.05, biz: 0.03 },
    competitors: [{ name: 'TUI fly via Lisbon', perWeek: 2, stops: 0, hours: 3.9, fareX: 1.0, seats: 120 }],
    fareY: [200, 440], fareJ: [600, 950],
    cargo: { south: 500, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 6, out: 660, back: 1_020, nights: 0 },
    navPerSector: 2_300, rights: 'open', eu261: 'mid',
    blurb: 'Resort island, holidays only. Short runway: narrowbody or a light 767.',
  },
  {
    id: 'LIS-LAD', from: 'LIS', to: 'LAD', city: 'Luanda', country: 'Angola',
    models: ['own'], model: 'own',
    odPerYear: 260_000, outShare: 0.5, growth: 0.02,
    segments: { biz: 0.35, vfr: 0.40, gov: 0.12, students: 0.08, tourism: 0.05 },
    competitors: [
      { name: 'TAAG Angola Airlines', perWeek: 10, stops: 0, hours: 8, fareX: 0.95, seats: 290 },
      { name: 'TAP Air Portugal', perWeek: 10, stops: 0, hours: 8, fareX: 1.05, seats: 260 },
    ],
    fareY: [520, 980], fareJ: [1_900, 3_200],
    cargo: { south: 6_000, north: 800, mail: 300 },
    ancillary: 28, bagShare: 0.35,
    timetable: { pattern: 'weekly', day: 1, out: 1_380, back: 1_380, nights: 1 },
    navPerSector: 5_200, risk: { fx: 0.3 }, rights: 'bilateral', eu261: 'long',
    blurb: 'Large and high-yield, but kwanza cash can be stuck in Angola for months.',
  },
  {
    id: 'LIS-MPM', from: 'LIS', to: 'MPM', city: 'Maputo', country: 'Mozambique',
    models: ['own'], model: 'own',
    odPerYear: 45_000, outShare: 0.5, growth: 0.03,
    segments: { biz: 0.32, vfr: 0.40, gov: 0.10, tourism: 0.10, ngo: 0.08 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 3, stops: 0, hours: 10.3, fareX: 1.05, seats: 260 },
      { name: 'Emirates via Dubai', perWeek: 7, stops: 1, hours: 17, fareX: 0.85, seats: 25 },
      { name: 'Ethiopian via Addis Ababa', perWeek: 7, stops: 1, hours: 16, fareX: 0.8, seats: 20 },
    ],
    fareY: [560, 1_050], fareJ: [2_000, 3_300],
    cargo: { south: 3_500, north: 600, mail: 200, perish: 300 },
    ancillary: 24, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 2, out: 1_320, back: 1_260, nights: 1 },
    navPerSector: 6_800, risk: { coup: 0.02 }, rights: 'bilateral', eu261: 'long',
    blurb: '10 hours nonstop. Diaspora and business. TAP 3 a week.',
  },
  {
    id: 'LIS-REC', from: 'LIS', to: 'REC', city: 'Recife', country: 'Brazil',
    models: ['own', 'tour'], model: 'own',
    odPerYear: 90_000, outShare: 0.5, growth: 0.04,
    segments: { vfr: 0.50, tourism: 0.30, biz: 0.12, students: 0.08 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 7, stops: 0, hours: 7.8, fareX: 1.0, seats: 260 },
      { name: 'Azul via Campinas', perWeek: 7, stops: 1, hours: 13, fareX: 0.85, seats: 15 },
    ],
    fareY: [380, 820], fareJ: [1_400, 2_600],
    cargo: { south: 2_500, north: 1_500, mail: 200, perish: 800 },
    ancillary: 26, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 3, out: 720, back: 1_320, nights: 1 },
    navPerSector: 3_600, rights: 'bilateral', eu261: 'long',
    blurb: 'The Brazilian community in Portugal. Strong July and Christmas peaks.',
  },
  {
    id: 'LIS-FOR', from: 'LIS', to: 'FOR', city: 'Fortaleza', country: 'Brazil',
    models: ['own', 'tour'], model: 'own',
    odPerYear: 70_000, outShare: 0.5, growth: 0.04,
    segments: { vfr: 0.45, tourism: 0.35, biz: 0.12, students: 0.08 },
    competitors: [
      { name: 'TAP Air Portugal', perWeek: 5, stops: 0, hours: 7.5, fareX: 1.0, seats: 260 },
      { name: 'LATAM via São Paulo', perWeek: 7, stops: 1, hours: 14, fareX: 0.85, seats: 12 },
    ],
    fareY: [370, 800], fareJ: [1_350, 2_500],
    cargo: { south: 2_000, north: 1_200, mail: 150, perish: 700 },
    ancillary: 26, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 5, out: 720, back: 1_320, nights: 1 },
    navPerSector: 3_500, rights: 'bilateral', eu261: 'long',
    blurb: 'Diaspora and beach holidays. Seasonal.',
  },
  {
    id: 'OPO-RAI', from: 'OPO', to: 'RAI', city: 'Praia', country: 'Cabo Verde',
    models: ['own'], model: 'own',
    odPerYear: 14_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.70, tourism: 0.15, biz: 0.10, students: 0.05 },
    competitors: [{ name: 'TAP via Lisbon', perWeek: 14, stops: 1, hours: 7.5, fareX: 0.95, seats: 30 }],
    fareY: [240, 560], fareJ: [750, 1_350],
    cargo: { south: 1_200, north: 100, mail: 100 },
    ancillary: 22, bagShare: 0.35,
    timetable: { pattern: 'weekly', day: 5, out: 540, back: 900, nights: 0 },
    navPerSector: 2_600, rights: 'bilateral', eu261: 'mid',
    blurb: 'Northern diaspora, no nonstop today. Small.',
  },
  {
    id: 'OPO-OXB', from: 'OPO', to: 'OXB', city: 'Bissau', country: 'Guinea-Bissau',
    models: ['own'], model: 'own',
    odPerYear: 8_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.75, ngo: 0.12, students: 0.08, gov: 0.05 },
    competitors: [{ name: 'TAP via Lisbon', perWeek: 3, stops: 1, hours: 8, fareX: 1.0, seats: 30 }],
    fareY: [320, 740], fareJ: [950, 1_750],
    cargo: { south: 1_500, north: 0, mail: 100 },
    ancillary: 25, bagShare: 0.35,
    timetable: { pattern: 'weekly', day: 0, out: 420, back: 840, nights: 0 },
    navPerSector: 3_400, risk: { coup: 0.12 }, rights: 'bilateral', eu261: 'mid',
    blurb: 'Northern diaspora, seasonal. Small.',
  },
  {
    id: 'LIS-CCS', from: 'LIS', to: 'CCS', city: 'Caracas', country: 'Venezuela',
    models: ['own'], model: 'own',
    odPerYear: 60_000, outShare: 0.5, growth: 0,
    segments: { vfr: 0.75, biz: 0.15, gov: 0.10 },
    competitors: [],
    fareY: [600, 1_100], fareJ: [2_000, 3_400],
    cargo: { south: 3_000, north: 300 },
    ancillary: 25, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 4, out: 720, back: 1_080, nights: 1 },
    navPerSector: 4_800, risk: { coup: 0.1, fx: 0.4 }, rights: 'bilateral', eu261: 'long',
    closed: 'Venezuela revoked foreign airlines’ permits in Nov 2025.',
    blurb: 'Madeiran and Portuguese diaspora. Closed for now.',
  },
];

export const ROUTE_MARKET_BY_ID: Record<string, RouteMarket> = Object.fromEntries(ROUTE_MARKETS.map((m) => [m.id, m]));

/** The market of an id (throws on a typo: data, not player input). */
export function routeMarket(id: string): RouteMarket {
  const m = ROUTE_MARKET_BY_ID[id];
  if (!m) throw new Error(`unknown route market ${id}`);
  return m;
}

/** A station's costs: the researched table, else (v0.19.2) estimated from the airport's region and size. */
export function routeStation(code: string): RouteStation {
  return ROUTE_STATIONS[code] ?? stationFor(code);
}

const genStations = new Map<string, RouteStation>();
/** v0.19.2 by region [E]: fuel into-plane against the world price, charges and handling a 767 turn (USD). */
const REGION_COST: Record<string, { fuel: number; charges: number; handling: number; pax: number; taxes: number }> = {
  EU: { fuel: 1.0, charges: 1.1, handling: 1.05, pax: 2.2, taxes: 45 },
  NA: { fuel: 0.95, charges: 1.2, handling: 1.2, pax: 2.5, taxes: 40 },
  SA: { fuel: 1.05, charges: 1.0, handling: 0.95, pax: 1.5, taxes: 50 },
  AF: { fuel: 1.15, charges: 1.15, handling: 1.1, pax: 1.0, taxes: 55 },
  ME: { fuel: 0.92, charges: 0.9, handling: 0.85, pax: 0.5, taxes: 30 },
  AS: { fuel: 1.0, charges: 0.9, handling: 0.8, pax: 1.0, taxes: 35 },
  OC: { fuel: 1.08, charges: 1.1, handling: 1.15, pax: 2.0, taxes: 45 },
};

/** v0.19.2 an airport's station costs from its region, size, runway and remoteness (pure, cached). */
export function stationFor(code: string): RouteStation {
  const hit = genStations.get(code);
  if (hit) return hit;
  const a = AIRPORT_BY_CODE[code];
  let st: RouteStation;
  if (!a) st = { code, fuelX: 1.12, airport: 2_600, handling: 4_600, paxCharge: 1, overhead: 9_000, cat: 'B', caterer: false, euCargo: false, taxes: 50 };
  else {
    const R = REGION_COST[a.continent] ?? REGION_COST.AF;
    const remote = !!a.remote || !!a.enroute;
    const r100 = (v: number) => Math.round(v / 100) * 100;
    st = {
      code,
      fuelX: Math.round((R.fuel + (a.size <= 1 ? 0.08 : 0) + (remote ? 0.15 : 0)) * 100) / 100,
      airport: r100((1_400 + 450 * a.size) * R.charges),
      handling: r100((3_000 + 450 * a.size) * R.handling * (remote ? 1.2 : 1)),
      paxCharge: R.pax,
      overhead: r100(6_000 + 1_500 * a.size + (a.continent === 'AF' ? 2_000 : 0) + (remote ? 3_000 : 0)),
      cat: a.runwayM < 2_200 || (a.elevM ?? 0) > 1_500 || remote ? 'C' : a.size >= 3 ? 'A' : 'B',
      caterer: a.size >= 3 || (a.size >= 2 && a.tour >= 0.7),
      euCargo: a.continent === 'EU' || a.size >= 4,
      taxes: R.taxes,
    };
  }
  genStations.set(code, st);
  return st;
}

/** Segment words for the study and the business case. */
export const SEGMENT_LABEL: Record<Segment, string> = {
  vfr: 'Family visits (diaspora)', gov: 'Government', ngo: 'NGOs and aid', biz: 'Business', students: 'Students',
  tourism: 'Tourism', teachers: 'Teachers and cooperation',
};
