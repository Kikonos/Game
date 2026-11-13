// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md §B, §G): the researched markets we can open and the stations' costs.
// The data sits in data/markets/, one file a start base (lis.ts holds Lisbon and Porto); this file holds the shapes,
// joins the files and estimates a station nobody researched. Money in USD at $1 ≈ €0.86. Data only: no market is
// open until the player starts its study, and a game lists only the markets from its own bases.

import type { RouteModel, Segment } from '../engine/network/types';
import { AIRPORT_BY_CODE } from './airports';
import { LIS_MARKETS, LIS_STATIONS } from './markets/lis';
import { MAD_MARKETS, MAD_STATIONS } from './markets/mad';
import { MLA_MARKETS, MLA_STATIONS } from './markets/mla';
import { PRG_MARKETS, PRG_STATIONS } from './markets/prg';
import { RIX_MARKETS, RIX_STATIONS } from './markets/rix';
import { SOF_MARKETS, SOF_STATIONS } from './markets/sof';
import { TLL_MARKETS, TLL_STATIONS } from './markets/tll';
import { VNO_MARKETS, VNO_STATIONS } from './markets/vno';

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
  /** A caterer that meets the standard (else the return is loaded at our base: double catering). */
  caterer: boolean;
  /** Cargo security validated for the EU (ACC3): else no cargo north from here. */
  euCargo: boolean;
  /** Taxes and airport passenger charges collected per departing passenger and passed on (shown, not booked). */
  taxes: number;
  /** We pay a business lounge for our passengers leaving from here (the home base always has one). */
  lounge?: true;
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
  /** Realised yield against these published fares (a balance step; absent = 1; BAL.v019.fares.marketX wins). */
  fareX?: number;
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
  /**
   * v0.21 a stopover (tag) route A–B–C (player: "some passengers get off, others get on, others stay on"): the market's
   * own numbers are the A–C through travellers; `ab` and `bc` are the local markets of the two legs. B–C local sales
   * need fifth-freedom rights (odds below), rolled at the launch's rights stage.
   */
  stopover?: RouteStopover;
}

/** v0.21 the stop where we sell seats, its two local markets and the odds of B–C (fifth-freedom) rights. */
export interface RouteStopover {
  at: string;
  ab: RouteMarket;
  bc: RouteMarket;
  /** Chances at the rights stage: full B–C sales, limited (a share of the seats), else none. */
  fifth: { full: number; limited: number; why: string };
}

/**
 * The researched catalogue, one file a start base (data/markets/<base>.ts: `<BASE>_MARKETS`, a list, and
 * `<BASE>_STATIONS`, by code). A market shows in a game only when its origin is one of the player's route bases
 * (engine/network catalogueFor). A station two files list keeps the first file's row.
 */
const BASE_DATA: { markets: RouteMarket[]; stations: Record<string, RouteStation> }[] = [
  { markets: LIS_MARKETS, stations: LIS_STATIONS },
  { markets: VNO_MARKETS, stations: VNO_STATIONS },
  { markets: MLA_MARKETS, stations: MLA_STATIONS },
  { markets: MAD_MARKETS, stations: MAD_STATIONS },
  { markets: RIX_MARKETS, stations: RIX_STATIONS },
  { markets: PRG_MARKETS, stations: PRG_STATIONS },
  { markets: SOF_MARKETS, stations: SOF_STATIONS },
  { markets: TLL_MARKETS, stations: TLL_STATIONS },
];

/** §G the researched stations by code (767 reference); a code listed twice keeps its first row. */
export const ROUTE_STATIONS: Record<string, RouteStation> = {};
for (const b of BASE_DATA) for (const s of Object.values(b.stations)) ROUTE_STATIONS[s.code] ??= s;

/** §B the catalogue: every base's markets, Lisbon's first (their order is the list's order). */
export const ROUTE_MARKETS: RouteMarket[] = BASE_DATA.flatMap((b) => b.markets);


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
