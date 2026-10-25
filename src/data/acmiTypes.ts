// ACMI parameters for the shortlist types (RESEARCH §4.1, §5.2–5.7, §7.2–7.3). All money in USD.
// `catalog` links to src/data/aircraft.ts (specs, facts); `art` is the side-view sprite (v0.10, the player's art in
// public/aircraft/; per-airframe variants in ./variants.ts). v0.10: the 777-200LR is gone (old saves fly it as a 777-200ER).

import { variantOf } from './variants';

export type RatingFamily = 'A320' | 'B737' | 'B757/767' | 'A330/340' | 'B777' | 'B787' | 'A350' | 'A380' | 'B747';
export type CabinLayout = 'all-economy' | 'two-class' | 'three-class' | 'vip';

export interface CabinPreset {
  label: string;
  layout: CabinLayout;
  /** Seats per class: J business, W premium economy, Y economy. */
  j: number;
  w: number;
  y: number;
}

export interface AcmiType {
  id: string;
  name: string;
  short: string;
  /** Pilot type-rating family; cabin crew use the same grouping (v0.5). */
  family: RatingFamily;
  body: 'narrow' | 'wide';
  engines: 2 | 4;
  /** src/data/aircraft.ts id, when the catalog has the type. */
  catalog?: string;
  /** Sprite id (public/aircraft/<art>-*.webp; variants in ./variants.ts may override it). */
  art: string;
  tier: 0 | 1 | 2 | 3 | 4;
  /** Cabin presets; the first is the default ACMI configuration. */
  cabins: CabinPreset[];
  /** Exit-limit (certified maximum) seats. */
  maxSeats: number;
  /** Realistic range at full payload, nautical miles. */
  rangeNm: number;
  cruiseKt: number;
  /** Planned turnaround, minutes. */
  turnMin: number;
  /**
   * Minimum flight crew for an unaugmented duty (4 for ULR types on ULR sectors). v0.10: the 747-100/-200/-300 had a
   * flight engineer as the third crew member; the game flies them with two pilots (a fact line in the catalog only).
   */
  cockpitMin: 2 | 4;
  /** Typical ACMI cabin crew at the default configuration (the legal minimum is cabinMinimum: certified floor and 1 per 50 seats per deck). */
  cabinTypical: number;
  /** v0.10 crew numbers from the type certificate (RESEARCH §15): certified cabin crew floor, crew seats, cockpit observer seats. */
  crew: CrewSpec;
  /** In-flight crew rest as standard (FTL F3): 1 bunks on most airframes; 2 curtained business seats (767: never bunks); 3 curtained economy seats (narrowbodies). */
  restClass: 1 | 2 | 3 | null;
  /** Highest ETOPS the type can be approved for (0 = not ETOPS capable; four-engine types bypass ETOPS). */
  etopsMax: number;
  /** Shortest runway (m) for normal ACMI operations at typical weights. */
  minRunwayM: number;
  /** Default ACMI rate per block hour. */
  rateBH: number;
  /** Fuel burn, tonnes per block hour. */
  fuelTBH: number;
  /** Direct maintenance cost per block hour (mid-life); old airframes cost more (see BAL). */
  maintBH: number;
  /** Monthly dry-lease rent for a mid-life example. */
  rentMonth: number;
  /** Market value of a mid-life example (for owned aircraft and purchases). */
  valueUsed: number;
  /** Monthly rent for a new-build slot (else rentMonth). */
  rentNew?: number;
  /** v0.10 only offered as new-build slots (no used airframes yet: the 777-9 and 777-8). */
  newOnly?: boolean;
  /** Years the type was built (entry into service, end of production) for used offers; v0.10 never offered before firstYear. */
  firstYear?: number;
  lastYear?: number;
  /** Hull + liability insurance per month. */
  insuranceMonth: number;
  /** A-check interval (FH) and duration (h); C-check interval (months) and duration (days). */
  aCheckFH: number;
  aCheckHours: number;
  cCheckMonths: number;
  cCheckDays: number;
  /** Pilots per aircraft for year-round operation (5–6 crew sets narrowbody). */
  pilotsPerAircraft: number;
  /** 0 plentiful … 1 almost never offered. */
  scarcity: number;
  /** Offered on the market in normal play (false = scenario only). */
  available: boolean;
  /** Ultra-long-range capable (needs the ULR approval and 4 pilots on ULR sectors). */
  ulr?: boolean;
  /** v0.7.3 in-flight rest facilities on the market and the refits possible (UPDATE-0.7.3.md §2.1). */
  rest: TypeRest;
  /** v0.7.2 economy seats per row (the crew rest seats block off one row). */
  yAbreast: number;
  /** v0.7.2 pursers per crew (2 on two-deck types: the deputy works the upper deck); default 1. */
  pursers?: 1 | 2;
  /** v0.8 fix pack: AOG risk on top of the airframe's age (old four-engine systems: the 747-400 × 1.3); default 1. */
  aogMult?: number;
  /**
   * v0.8 pre-release: flight hours per cycle in an airframe's earlier airline life (used hours and cycles at handover, the
   * sale model's cycle norm): long-haul types fly few long sectors (a 747-400 about 1 cycle per 8–9 h). Default: the
   * body's norm (BAL.v072.sale fhYear / cyclesYear: narrowbody 2.0 h, widebody 6.4 h).
   */
  hPerCycle?: number;
}

/** Certified minimum cabin crew by installed passenger seats: [seats up to, cabin crew], ascending; a cabin up to the first row's seats takes that row's crew. */
export type CrewFloor = readonly (readonly [number, number])[];

/**
 * v0.10 crew numbers per type (RESEARCH §15). Minimum cabin crew = the greater of the number established at
 * certification for the cabin (EASA TCDS "Minimum Cabin Crew" tables: `floor`) and one per 50 installed seats, per
 * deck (ORO.CC.100(b)); the upper deck of a 747 or A380 counts on its own.
 */
export interface CrewSpec {
  /** Main (or only) deck table; empty = no number established at certification (1 per 50 seats only). */
  floor: CrewFloor;
  /** Two-deck types: upper deck seats = the cabin's share, capped at max (its exit limit), and its own table. */
  upper?: { share: number; max: number; floor: CrewFloor };
  /** Cabin crew seats (jump seats, attendant stations): crew beyond them sit in passenger seats. */
  seats: number;
  /** Cockpit observer seats behind the two pilots (relief and spare pilots beyond them sit in the cabin). */
  observers: number;
  /** Which numbers are estimates (no published figure found): RESEARCH §15 flags them. */
  est?: ('floor' | 'upper' | 'seats' | 'observers' | 'maxSeats')[];
}

/** v0.7.3 per-type crew rest (shares are estimates for the ACMI/charter used market; audit §B2). v0.7.4: bunks come as a pair. */
export interface TypeRest {
  /**
   * v0.7.4 share of airframes with crew bunks: always BOTH a flight crew rest compartment (2 pilot bunks, class 1)
   * and a cabin crew compartment (class 1), one roll per airframe (never one kind without the other).
   */
  bunkShare: number;
  /** The cabin crew compartment's kind and bunks. */
  ccrcKind: 'ccrc' | 'ldmcr';
  ccrcPlaces: number;
  /**
   * Class of the type's business seats as crew rest. v0.7.4: every aircraft rests its crew in curtained seats of
   * its current cabin: business seats (class 2) when the cabin has them, else economy seats (class 3).
   */
  jClass: 2 | 3;
  /** Crew rest recliner refit (class 2 since v0.7.4): economy rows lost, recliners fitted, of them for the pilots; null = not offered. */
  recliners: { rowsLost: number; places: number; fc: number } | null;
  /** The cabin crew bunks are a lower-deck module (A330/A340), fitted with the pilots' bunks. */
  ldmcr: boolean;
  /** Bunk refit (pilots and cabin crew together) with a C-check at an MRO hub; null = not offered (767: never). */
  mro: 'fcrc' | 'overhead' | null;
}

const NO_REST: TypeRest = { bunkShare: 0, ccrcKind: 'ccrc', ccrcPlaces: 0, jClass: 2, recliners: null, ldmcr: false, mro: null };
const TR = (bunkShare: number, ccrcKind: 'ccrc' | 'ldmcr', ccrcPlaces: number, recliners: TypeRest['recliners'], ldmcr: boolean, mro: TypeRest['mro']): TypeRest =>
  ({ bunkShare, ccrcKind, ccrcPlaces, jClass: 2, recliners, ldmcr, mro });
const NARROW_LR: TypeRest = { ...NO_REST, recliners: { rowsLost: 1, places: 3, fc: 1 } };

/** v0.10 crew numbers per type (RESEARCH §15 has every source). */
const CREW: Record<string, CrewSpec> = {
  // EASA TCDS A.064 (A320 family) and IM.A.120 (737): the certified numbers equal 1 per 50 seats.
  a320ceo: { floor: [[150, 3], [195, 4]], seats: 6, observers: 1, est: ['seats', 'observers'] },
  a321ceo: { floor: [[200, 4], [230, 5]], seats: 7, observers: 1, est: ['seats', 'observers'] },
  a321neo: { floor: [[149, 3], [200, 4], [244, 5]], seats: 6, observers: 1, est: ['seats', 'observers'] },
  b738: { floor: [[100, 2], [150, 3], [189, 4]], seats: 5, observers: 1, est: ['seats', 'observers'] },
  b739: { floor: [[100, 2], [150, 3], [200, 4], [220, 5]], seats: 6, observers: 1, est: ['seats', 'observers'] },
  // 757 / 767: no number in the EASA TCDS (IM.A.205 refers to FAA A2NM; IM.A.035): 1 per 50 seats.
  b752: { floor: [], seats: 7, observers: 2, est: ['seats', 'observers'] },
  b753: { floor: [], seats: 8, observers: 2, est: ['seats', 'observers'] },
  b763: { floor: [], seats: 9, observers: 2, est: ['seats', 'observers'] },
  // EASA TCDS A.004 (A330), A.015 (A340), A.151 (A350): 2 per exit pair (8), 9 above 400 seats; +1 per A+ pair.
  a332: { floor: [[400, 8], [406, 9]], seats: 12, observers: 2, est: ['seats'] },
  a333: { floor: [[400, 8], [440, 9]], seats: 12, observers: 2, est: ['seats'] },
  a339: { floor: [[400, 8], [440, 9], [460, 10], [465, 12]], seats: 12, observers: 2, est: ['seats'] },
  a342: { floor: [[400, 8], [420, 9]], seats: 12, observers: 2, est: ['seats'] },
  a343: { floor: [[400, 8], [440, 9]], seats: 12, observers: 2, est: ['seats'] },
  a345: { floor: [[375, 8]], seats: 12, observers: 2, est: ['seats'] },
  a346: { floor: [[400, 8], [440, 9]], seats: 14, observers: 2, est: ['seats'] },
  a359: { floor: [[400, 8], [440, 9]], seats: 12, observers: 2, est: ['seats'] },
  a35u: { floor: [[400, 8], [440, 9]], seats: 12, observers: 2, est: ['seats'] },
  a35k: { floor: [[400, 8], [440, 9], [460, 10], [470, 11], [480, 12]], seats: 14, observers: 2, est: ['seats'] },
  // EASA TCDS A.110: per deck, main 10 (≤ 500) / 11, upper 6 (≤ 300) / 7.
  a388: { floor: [[500, 10], [538, 11]], upper: { share: 0.4, max: 330, floor: [[300, 6], [330, 7]] }, seats: 24, observers: 2, est: ['seats'] },
  // EASA TCDS IM.A.003 (777): -200/-200ER 8 (≤ 400) / 9; -300ER 10 (≤ 500) / 11. The 777X is not certified yet.
  b772: { floor: [[400, 8], [440, 9]], seats: 14, observers: 2, est: ['seats'] },
  b77w: { floor: [[500, 10], [550, 11]], seats: 16, observers: 2, est: ['seats'] },
  b778: { floor: [[400, 8], [440, 9]], seats: 14, observers: 2, est: ['floor', 'seats', 'maxSeats'] },
  b779: { floor: [[500, 10]], seats: 16, observers: 2, est: ['floor', 'seats', 'maxSeats'] },
  // EASA TCDS IM.A.115 (787): by the certified capacity of each exit arrangement.
  b788: { floor: [[300, 6], [350, 7], [381, 8]], seats: 10, observers: 2, est: ['seats'] },
  b789: { floor: [[300, 6], [350, 7], [400, 8], [420, 9]], seats: 12, observers: 2, est: ['seats'] },
  b78x: { floor: [[300, 6], [355, 8], [440, 9]], seats: 12, observers: 2, est: ['seats'] },
  // EASA TCDS IM.A.196 (747): per deck. -400 main 11 (550, five Type A pairs), upper 1 / 2 / 3 (45 / 100 / 110);
  // -8 main 9 (440) / 10 (495). The classics have no number in the TCDS: the -400's, est.
  b744: { floor: [[550, 11]], upper: { share: 0.12, max: 110, floor: [[45, 1], [100, 2], [110, 3]] }, seats: 18, observers: 2, est: ['seats'] },
  b748: { floor: [[440, 9], [495, 10]], upper: { share: 0.12, max: 110, floor: [[45, 1], [100, 2], [110, 3]] }, seats: 20, observers: 2, est: ['seats'] },
  b741: { floor: [[550, 11]], upper: { share: 0.07, max: 45, floor: [[45, 1]] }, seats: 16, observers: 2, est: ['floor', 'upper', 'seats'] },
  b742: { floor: [[550, 11]], upper: { share: 0.07, max: 45, floor: [[45, 1]] }, seats: 16, observers: 2, est: ['floor', 'upper', 'seats'] },
  b743: { floor: [[550, 11]], upper: { share: 0.13, max: 110, floor: [[45, 1], [100, 2], [110, 3]] }, seats: 17, observers: 2, est: ['floor', 'upper', 'seats'] },
};

const c = (label: string, layout: CabinLayout, j: number, w: number, y: number): CabinPreset => ({ label, layout, j, w, y });

export const ACMI_TYPES_LIST: AcmiType[] = ([
  {
    id: 'a320ceo', name: 'Airbus A320ceo', short: 'A320', family: 'A320', body: 'narrow', engines: 2, catalog: 'a320ceo', art: 'a320ceo', tier: 0,
    cabins: [c('180Y', 'all-economy', 0, 0, 180), c('12J/156Y', 'two-class', 12, 0, 156)], maxSeats: 186,
    rangeNm: 2700, cruiseKt: 450, turnMin: 40, cockpitMin: 2, cabinTypical: 4, restClass: 3, etopsMax: 120, minRunwayM: 2000,
    rateBH: 3800, fuelTBH: 2.5, maintBH: 900, rentMonth: 240_000, valueUsed: 14_000_000, insuranceMonth: 42_000,
    aCheckFH: 750, aCheckHours: 8, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.2, available: true, rest: NO_REST, yAbreast: 6,
  },
  {
    id: 'b738', name: 'Boeing 737-800', short: 'B738', family: 'B737', body: 'narrow', engines: 2, catalog: 'b738', art: 'b738', tier: 0,
    cabins: [c('189Y', 'all-economy', 0, 0, 189), c('12J/162Y', 'two-class', 12, 0, 162)], maxSeats: 189,
    rangeNm: 2500, cruiseKt: 450, turnMin: 40, cockpitMin: 2, cabinTypical: 4, restClass: 3, etopsMax: 120, minRunwayM: 2200,
    rateBH: 3700, fuelTBH: 2.5, maintBH: 900, rentMonth: 235_000, valueUsed: 15_000_000, insuranceMonth: 42_000,
    aCheckFH: 700, aCheckHours: 8, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.2, available: true, rest: NO_REST, yAbreast: 6,
  },
  {
    id: 'a321ceo', name: 'Airbus A321ceo', short: 'A321', family: 'A320', body: 'narrow', engines: 2, catalog: 'a321ceo', art: 'a321ceo', tier: 1,
    cabins: [c('220Y', 'all-economy', 0, 0, 220), c('16J/180Y', 'two-class', 16, 0, 180)], maxSeats: 230,
    rangeNm: 2300, cruiseKt: 450, turnMin: 45, cockpitMin: 2, cabinTypical: 5, restClass: 3, etopsMax: 120, minRunwayM: 2300,
    rateBH: 4300, fuelTBH: 2.9, maintBH: 1000, rentMonth: 280_000, valueUsed: 18_000_000, insuranceMonth: 46_000,
    aCheckFH: 750, aCheckHours: 8, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.3, available: true, rest: NO_REST, yAbreast: 6,
  },
  {
    id: 'a321neo', name: 'Airbus A321neo (LR)', short: 'A21N', family: 'A320', body: 'narrow', engines: 2, catalog: 'a321neo', art: 'a321neo', tier: 1,
    cabins: [c('220Y', 'all-economy', 0, 0, 220), c('16J/190Y', 'two-class', 16, 0, 190)], maxSeats: 244,
    rangeNm: 3500, cruiseKt: 450, turnMin: 45, cockpitMin: 2, cabinTypical: 5, restClass: 3, etopsMax: 180, minRunwayM: 2300,
    rateBH: 5000, fuelTBH: 2.5, maintBH: 800, rentMonth: 380_000, valueUsed: 40_000_000, rentNew: 460_000, firstYear: 2017, insuranceMonth: 60_000,
    aCheckFH: 1000, aCheckHours: 10, cCheckMonths: 36, cCheckDays: 12, pilotsPerAircraft: 12, scarcity: 0.8, available: true, rest: NARROW_LR, yAbreast: 6,
  },
  {
    id: 'b752', name: 'Boeing 757-200', short: 'B752', family: 'B757/767', body: 'narrow', engines: 2, catalog: 'b752', art: 'b752', tier: 1,
    cabins: [c('235Y', 'all-economy', 0, 0, 235), c('16J/184Y', 'two-class', 16, 0, 184)], maxSeats: 239,
    rangeNm: 3300, cruiseKt: 460, turnMin: 50, cockpitMin: 2, cabinTypical: 6, restClass: 3, etopsMax: 180, minRunwayM: 2000,
    rateBH: 5200, fuelTBH: 3.3, maintBH: 1500, rentMonth: 140_000, lastYear: 2004, valueUsed: 7_000_000, insuranceMonth: 44_000,
    aCheckFH: 600, aCheckHours: 14, cCheckMonths: 18, cCheckDays: 18, pilotsPerAircraft: 11, scarcity: 0.6, available: true, rest: NARROW_LR, yAbreast: 6,
  },
  {
    id: 'b763', name: 'Boeing 767-300ER', short: 'B763', family: 'B757/767', body: 'wide', engines: 2, catalog: 'b763', art: 'b763', tier: 2,
    cabins: [c('16J/251Y', 'two-class', 16, 0, 251), c('309Y', 'all-economy', 0, 0, 309)], maxSeats: 351,
    rangeNm: 5000, cruiseKt: 460, turnMin: 70, cockpitMin: 2, cabinTypical: 8, restClass: 2, etopsMax: 180, minRunwayM: 2600,
    rateBH: 6400, fuelTBH: 5.3, maintBH: 1700, rentMonth: 170_000, valueUsed: 10_000_000, hPerCycle: 5.0, insuranceMonth: 60_000,
    aCheckFH: 550, aCheckHours: 16, cCheckMonths: 18, cCheckDays: 18, pilotsPerAircraft: 14, scarcity: 0.4, available: true, rest: TR(0, 'ldmcr', 0, { rowsLost: 2, places: 6, fc: 2 }, false, null), yAbreast: 7,
  },
  {
    id: 'a332', name: 'Airbus A330-200', short: 'A332', family: 'A330/340', body: 'wide', engines: 2, catalog: 'a332', art: 'a332', tier: 2,
    cabins: [c('18J/282Y', 'two-class', 18, 0, 282), c('330Y', 'all-economy', 0, 0, 330)], maxSeats: 406,
    rangeNm: 6000, cruiseKt: 470, turnMin: 80, cockpitMin: 2, cabinTypical: 9, restClass: 1, etopsMax: 240, minRunwayM: 2700,
    rateBH: 7200, fuelTBH: 5.8, maintBH: 1550, rentMonth: 200_000, firstYear: 1998, valueUsed: 12_000_000, hPerCycle: 6.5, insuranceMonth: 65_000,
    aCheckFH: 800, aCheckHours: 16, cCheckMonths: 24, cCheckDays: 18, pilotsPerAircraft: 16, scarcity: 0.35, available: true, rest: TR(0.4, 'ldmcr', 7, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    id: 'a333', name: 'Airbus A330-300', short: 'A333', family: 'A330/340', body: 'wide', engines: 2, catalog: 'a333', art: 'a333', tier: 2,
    cabins: [c('24J/326Y', 'two-class', 24, 0, 326), c('440Y', 'all-economy', 0, 0, 440)], maxSeats: 440,
    rangeNm: 5300, cruiseKt: 470, turnMin: 80, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 180, minRunwayM: 2800,
    rateBH: 7800, fuelTBH: 6.0, maintBH: 1550, rentMonth: 330_000, valueUsed: 30_000_000, hPerCycle: 5.5, insuranceMonth: 75_000,
    aCheckFH: 800, aCheckHours: 16, cCheckMonths: 24, cCheckDays: 18, pilotsPerAircraft: 16, scarcity: 0.4, available: true, rest: TR(0.3, 'ldmcr', 7, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    id: 'a343', name: 'Airbus A340-300', short: 'A343', family: 'A330/340', body: 'wide', engines: 4, catalog: 'a343', art: 'a343', tier: 2,
    cabins: [c('30J/270Y', 'two-class', 30, 0, 270), c('335Y', 'all-economy', 0, 0, 335)], maxSeats: 440,
    rangeNm: 6500, cruiseKt: 470, turnMin: 90, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 0, minRunwayM: 3000,
    rateBH: 6000, fuelTBH: 7.0, maintBH: 2200, rentMonth: 100_000, valueUsed: 8_000_000, hPerCycle: 7.5, insuranceMonth: 60_000,
    aCheckFH: 800, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 16, scarcity: 0.5, available: true, rest: TR(0.75, 'ldmcr', 8, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    id: 'b772', name: 'Boeing 777-200ER', short: 'B772', family: 'B777', body: 'wide', engines: 2, catalog: 'b772', art: 'b772', tier: 3,
    cabins: [c('30J/24W/239Y', 'three-class', 30, 24, 239), c('400Y', 'all-economy', 0, 0, 400)], maxSeats: 440,
    rangeNm: 6200, cruiseKt: 485, turnMin: 90, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 330, minRunwayM: 3000,
    rateBH: 9000, fuelTBH: 7.2, maintBH: 2300, rentMonth: 250_000, valueUsed: 15_000_000, hPerCycle: 6.5, insuranceMonth: 85_000,
    aCheckFH: 1000, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 20, scarcity: 0.7, available: true, rest: TR(0.85, 'ccrc', 8, { rowsLost: 2, places: 9, fc: 2 }, false, 'overhead'), yAbreast: 10,
  },
  {
    id: 'b77w', name: 'Boeing 777-300ER', short: 'B77W', family: 'B777', body: 'wide', engines: 2, catalog: 'b77w', art: 'b77w', tier: 3,
    cabins: [c('42J/358Y', 'two-class', 42, 0, 358), c('450Y', 'all-economy', 0, 0, 450)], maxSeats: 550,
    rangeNm: 6500, cruiseKt: 485, turnMin: 100, cockpitMin: 2, cabinTypical: 12, restClass: 1, etopsMax: 330, minRunwayM: 3100,
    rateBH: 10_500, fuelTBH: 8.0, maintBH: 2200, rentMonth: 450_000, firstYear: 2004, valueUsed: 40_000_000, hPerCycle: 7.5, insuranceMonth: 100_000,
    aCheckFH: 1000, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 22, scarcity: 0.6, available: true, rest: TR(0.95, 'ccrc', 10, { rowsLost: 2, places: 9, fc: 2 }, false, 'overhead'), yAbreast: 10,
  },
  {
    id: 'b789', name: 'Boeing 787-9', short: 'B789', family: 'B787', body: 'wide', engines: 2, catalog: 'b789', art: 'b789', tier: 4,
    cabins: [c('28J/262Y', 'two-class', 28, 0, 262), c('330Y', 'all-economy', 0, 0, 330)], maxSeats: 420,
    rangeNm: 6800, cruiseKt: 490, turnMin: 80, cockpitMin: 2, cabinTypical: 9, restClass: 1, etopsMax: 330, minRunwayM: 2900,
    rateBH: 11_500, fuelTBH: 5.6, maintBH: 1400, rentMonth: 750_000, rentNew: 1_050_000, firstYear: 2014, valueUsed: 90_000_000, hPerCycle: 7.0, insuranceMonth: 110_000,
    aCheckFH: 1100, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.9, available: true, rest: TR(0.9, 'ccrc', 6, { rowsLost: 2, places: 8, fc: 2 }, false, 'overhead'), yAbreast: 9,
  },
  {
    id: 'a359', name: 'Airbus A350-900', short: 'A359', family: 'A350', body: 'wide', engines: 2, catalog: 'a359', art: 'a359', tier: 4,
    cabins: [c('32J/288Y', 'two-class', 32, 0, 288), c('369Y', 'all-economy', 0, 0, 369)], maxSeats: 440,
    rangeNm: 7300, cruiseKt: 490, turnMin: 85, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 370, minRunwayM: 2800,
    rateBH: 12_500, fuelTBH: 6.0, maintBH: 1500, rentMonth: 850_000, rentNew: 1_140_000, firstYear: 2015, valueUsed: 110_000_000, hPerCycle: 7.5, insuranceMonth: 120_000,
    aCheckFH: 1200, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.95, available: true, rest: TR(0.9, 'ccrc', 8, { rowsLost: 2, places: 8, fc: 2 }, false, 'overhead'), yAbreast: 9,
  },
  {
    id: 'a35u', name: 'Airbus A350-900ULR', short: 'A35U', family: 'A350', body: 'wide', engines: 2, catalog: 'a35u', art: 'a359ulr', tier: 4,
    cabins: [c('67J/94W', 'two-class', 67, 94, 0), c('42J/24W/187Y', 'three-class', 42, 24, 187)], maxSeats: 440,
    rangeNm: 9000, cruiseKt: 490, turnMin: 85, cockpitMin: 4, cabinTypical: 8, restClass: 1, etopsMax: 370, minRunwayM: 3000,
    rateBH: 14_000, fuelTBH: 6.5, maintBH: 1600, rentMonth: 1_100_000, rentNew: 1_200_000, firstYear: 2018, valueUsed: 120_000_000, hPerCycle: 9.0, insuranceMonth: 125_000,
    aCheckFH: 1200, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 28, scarcity: 0.98, available: true, ulr: true, rest: TR(1, 'ccrc', 8, null, false, null), yAbreast: 9,
  },
  {
    id: 'a388', name: 'Airbus A380-800', short: 'A388', family: 'A380', body: 'wide', engines: 4, catalog: 'a388', art: 'a388', tier: 3,
    cabins: [c('12J/459Y', 'two-class', 12, 0, 459), c('60J/411Y', 'two-class', 60, 0, 411)], maxSeats: 868,
    rangeNm: 7000, cruiseKt: 490, turnMin: 120, cockpitMin: 2, cabinTypical: 17, restClass: 1, etopsMax: 0, minRunwayM: 3300,
    rateBH: 21_000, fuelTBH: 12, maintBH: 4000, rentMonth: 450_000, firstYear: 2007, valueUsed: 30_000_000, hPerCycle: 8.5, insuranceMonth: 140_000,
    aCheckFH: 1000, aCheckHours: 24, cCheckMonths: 24, cCheckDays: 28, pilotsPerAircraft: 20, scarcity: 0.9, available: true, rest: TR(1, 'ccrc', 14, null, false, null), yAbreast: 10, pursers: 2,
  },
  {
    // v0.8 fix pack: on the market again (the player asked for it). The cheap, thirsty, old four-engine widebody that
    // goes anywhere: no ETOPS limits, the Hajj / UN / troop charter favourite (500Y), built until 2009, about 7,000 nm
    // with a full load, AOG-prone with age. Tier 2: Widebody operations is the only rung (four engines need no ETOPS).
    id: 'b744', name: 'Boeing 747-400', short: 'B744', family: 'B747', body: 'wide', engines: 4, catalog: 'b744', art: 'b744', tier: 2,
    cabins: [c('24J/426Y', 'two-class', 24, 0, 426), c('500Y', 'all-economy', 0, 0, 500)], maxSeats: 660,
    rangeNm: 7000, cruiseKt: 490, turnMin: 120, cockpitMin: 2, cabinTypical: 13, restClass: 1, etopsMax: 0, minRunwayM: 3200,
    rateBH: 11_000, fuelTBH: 10.5, maintBH: 3000, rentMonth: 150_000, firstYear: 1989, lastYear: 2009, valueUsed: 8_000_000, hPerCycle: 8.5, insuranceMonth: 90_000,
    aCheckFH: 600, aCheckHours: 24, cCheckMonths: 18, cCheckDays: 28, pilotsPerAircraft: 18, scarcity: 0.55, available: true, aogMult: 1.3, rest: TR(0.9, 'ccrc', 10, { rowsLost: 2, places: 9, fc: 2 }, false, 'overhead'), yAbreast: 10, pursers: 2,
  },
  // ---------- v0.10 new types (the player's sprites; sources in docs/acmi/RESEARCH.md §v0.10) ----------
  {
    // Lion Air, United, Alaska, Delta: the long 737NG, 220 seats with its extra exit pair; a long take-off run.
    id: 'b739', name: 'Boeing 737-900ER', short: 'B739', family: 'B737', body: 'narrow', engines: 2, catalog: 'b739', art: 'b739', tier: 1,
    cabins: [c('215Y', 'all-economy', 0, 0, 215), c('16J/164Y', 'two-class', 16, 0, 164)], maxSeats: 220,
    rangeNm: 2500, cruiseKt: 450, turnMin: 45, cockpitMin: 2, cabinTypical: 5, restClass: 3, etopsMax: 120, minRunwayM: 2500,
    rateBH: 4300, fuelTBH: 2.7, maintBH: 950, rentMonth: 210_000, firstYear: 2007, lastYear: 2019, valueUsed: 15_000_000, insuranceMonth: 43_000,
    aCheckFH: 700, aCheckHours: 8, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.55, available: true, rest: NO_REST, yAbreast: 6,
  },
  {
    // 55 built, 1999–2004: 280 seats on a narrowbody, slow to board (one aisle, 54 m), few left (United, Delta, Icelandair).
    id: 'b753', name: 'Boeing 757-300', short: 'B753', family: 'B757/767', body: 'narrow', engines: 2, catalog: 'b753', art: 'b753', tier: 1,
    cabins: [c('280Y', 'all-economy', 0, 0, 280), c('24J/219Y', 'two-class', 24, 0, 219)], maxSeats: 295,
    rangeNm: 3000, cruiseKt: 460, turnMin: 55, cockpitMin: 2, cabinTypical: 7, restClass: 3, etopsMax: 180, minRunwayM: 2400,
    rateBH: 5600, fuelTBH: 3.8, maintBH: 1700, rentMonth: 120_000, firstYear: 1999, lastYear: 2004, valueUsed: 5_000_000, insuranceMonth: 46_000,
    aCheckFH: 600, aCheckHours: 14, cCheckMonths: 18, cCheckDays: 18, pilotsPerAircraft: 11, scarcity: 0.9, available: true, aogMult: 1.1, rest: NARROW_LR, yAbreast: 6,
  },
  {
    // A330neo (Trent 7000, 64 m wing), in service since 2018: modern, in demand, 460 seats with its extra exits.
    id: 'a339', name: 'Airbus A330-900', short: 'A339', family: 'A330/340', body: 'wide', engines: 2, catalog: 'a339', art: 'a339', tier: 3,
    cabins: [c('28J/260Y', 'two-class', 28, 0, 260), c('440Y', 'all-economy', 0, 0, 440)], maxSeats: 460,
    rangeNm: 6500, cruiseKt: 470, turnMin: 80, cockpitMin: 2, cabinTypical: 9, restClass: 1, etopsMax: 285, minRunwayM: 2700,
    rateBH: 10_000, fuelTBH: 5.4, maintBH: 1300, rentMonth: 700_000, rentNew: 880_000, firstYear: 2018, valueUsed: 85_000_000, hPerCycle: 6.5, insuranceMonth: 105_000,
    aCheckFH: 1000, aCheckHours: 14, cCheckMonths: 24, cCheckDays: 16, pilotsPerAircraft: 16, scarcity: 0.8, available: true, rest: TR(0.6, 'ldmcr', 7, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    // 28 built 1993–1998, the long-range short A340: by 2027 almost all VIP or government jets. Rare, cheap, thirsty.
    id: 'a342', name: 'Airbus A340-200', short: 'A342', family: 'A330/340', body: 'wide', engines: 4, catalog: 'a342', art: 'a342', tier: 2,
    cabins: [c('30J/231Y', 'two-class', 30, 0, 231), c('300Y', 'all-economy', 0, 0, 300)], maxSeats: 420,
    rangeNm: 6700, cruiseKt: 470, turnMin: 85, cockpitMin: 2, cabinTypical: 8, restClass: 1, etopsMax: 0, minRunwayM: 3000,
    rateBH: 5600, fuelTBH: 6.6, maintBH: 2500, rentMonth: 70_000, firstYear: 1993, lastYear: 1998, valueUsed: 3_500_000, hPerCycle: 8.0, insuranceMonth: 50_000,
    aCheckFH: 800, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 16, scarcity: 0.97, available: true, aogMult: 1.4, rest: TR(0.5, 'ldmcr', 6, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    // The ultra-long-range A340 (Singapore–Newark nonstop, 2004–2013), 34 built: none left in airline service.
    id: 'a345', name: 'Airbus A340-500', short: 'A345', family: 'A330/340', body: 'wide', engines: 4, catalog: 'a345', art: 'a345', tier: 3,
    cabins: [c('36J/277Y', 'two-class', 36, 0, 277), c('64J/117W', 'two-class', 64, 117, 0)], maxSeats: 375,
    rangeNm: 8500, cruiseKt: 475, turnMin: 90, cockpitMin: 4, cabinTypical: 9, restClass: 1, etopsMax: 0, minRunwayM: 3200,
    rateBH: 9500, fuelTBH: 8.4, maintBH: 2900, rentMonth: 110_000, firstYear: 2002, lastYear: 2012, valueUsed: 5_000_000, hPerCycle: 10, insuranceMonth: 75_000,
    aCheckFH: 800, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 28, scarcity: 0.98, available: true, ulr: true, aogMult: 1.4, rest: TR(1, 'ldmcr', 8, null, true, null), yAbreast: 8,
  },
  {
    // 75 m, the longest A340 (97 built, 2002–2011): 380 seats on four engines; Lufthansa and Iberia retired theirs.
    id: 'a346', name: 'Airbus A340-600', short: 'A346', family: 'A330/340', body: 'wide', engines: 4, catalog: 'a346', art: 'a346', tier: 2,
    cabins: [c('32J/320Y', 'two-class', 32, 0, 320), c('420Y', 'all-economy', 0, 0, 420)], maxSeats: 440,
    rangeNm: 7000, cruiseKt: 475, turnMin: 100, cockpitMin: 2, cabinTypical: 12, restClass: 1, etopsMax: 0, minRunwayM: 3100,
    rateBH: 8000, fuelTBH: 8.6, maintBH: 2900, rentMonth: 90_000, firstYear: 2002, lastYear: 2011, valueUsed: 4_000_000, hPerCycle: 8.0, insuranceMonth: 70_000,
    aCheckFH: 800, aCheckHours: 20, cCheckMonths: 24, cCheckDays: 24, pilotsPerAircraft: 18, scarcity: 0.93, available: true, aogMult: 1.35, rest: TR(0.8, 'ldmcr', 8, { rowsLost: 2, places: 7, fc: 2 }, true, 'fcrc'), yAbreast: 8,
  },
  {
    // Qatar, Cathay, BA, Etihad: the big A350 (since 2018), very few in lessor hands.
    id: 'a35k', name: 'Airbus A350-1000', short: 'A35K', family: 'A350', body: 'wide', engines: 2, catalog: 'a35k', art: 'a35k', tier: 4,
    cabins: [c('40J/330Y', 'two-class', 40, 0, 330), c('36J/24W/290Y', 'three-class', 36, 24, 290)], maxSeats: 480,
    rangeNm: 7400, cruiseKt: 490, turnMin: 95, cockpitMin: 2, cabinTypical: 12, restClass: 1, etopsMax: 370, minRunwayM: 3000,
    rateBH: 14_000, fuelTBH: 7.0, maintBH: 1650, rentMonth: 1_000_000, rentNew: 1_300_000, firstYear: 2018, valueUsed: 140_000_000, hPerCycle: 8.0, insuranceMonth: 135_000,
    aCheckFH: 1200, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.97, available: true, rest: TR(0.95, 'ccrc', 10, { rowsLost: 2, places: 9, fc: 2 }, false, 'overhead'), yAbreast: 9,
  },
  {
    // The first Dreamliner (2011): 248 seats two-class, long range, in demand with lessors.
    id: 'b788', name: 'Boeing 787-8', short: 'B788', family: 'B787', body: 'wide', engines: 2, catalog: 'b788', art: 'b788', tier: 4,
    cabins: [c('24J/224Y', 'two-class', 24, 0, 224), c('330Y', 'all-economy', 0, 0, 330)], maxSeats: 381,
    rangeNm: 6200, cruiseKt: 490, turnMin: 75, cockpitMin: 2, cabinTypical: 8, restClass: 1, etopsMax: 330, minRunwayM: 2700,
    rateBH: 10_000, fuelTBH: 5.0, maintBH: 1300, rentMonth: 560_000, rentNew: 850_000, firstYear: 2011, valueUsed: 62_000_000, hPerCycle: 6.5, insuranceMonth: 95_000,
    aCheckFH: 1100, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.85, available: true, rest: TR(0.85, 'ccrc', 6, { rowsLost: 2, places: 8, fc: 2 }, false, 'overhead'), yAbreast: 9,
  },
  {
    // The stretch Dreamliner (2018), built only in Charleston: more seats, shorter range, medium-long trunk routes.
    id: 'b78x', name: 'Boeing 787-10', short: 'B78X', family: 'B787', body: 'wide', engines: 2, catalog: 'b78x', art: 'b78x', tier: 4,
    cabins: [c('32J/302Y', 'two-class', 32, 0, 302), c('400Y', 'all-economy', 0, 0, 400)], maxSeats: 440,
    rangeNm: 5600, cruiseKt: 490, turnMin: 85, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 330, minRunwayM: 2900,
    rateBH: 12_200, fuelTBH: 6.0, maintBH: 1500, rentMonth: 820_000, rentNew: 1_080_000, firstYear: 2018, valueUsed: 100_000_000, hPerCycle: 6.0, insuranceMonth: 115_000,
    aCheckFH: 1100, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.93, available: true, rest: TR(0.9, 'ccrc', 8, { rowsLost: 2, places: 8, fc: 2 }, false, 'overhead'), yAbreast: 9,
  },
  {
    // The 747-8 Intercontinental (2012–2017 passenger deliveries; Lufthansa, Korean, Air China): the last Queen.
    id: 'b748', name: 'Boeing 747-8', short: 'B748', family: 'B747', body: 'wide', engines: 4, catalog: 'b748', art: 'b748', tier: 3,
    cabins: [c('36J/24W/340Y', 'three-class', 36, 24, 340), c('24J/476Y', 'two-class', 24, 0, 476)], maxSeats: 605,
    rangeNm: 7300, cruiseKt: 495, turnMin: 120, cockpitMin: 2, cabinTypical: 16, restClass: 1, etopsMax: 0, minRunwayM: 3300,
    rateBH: 14_500, fuelTBH: 10.2, maintBH: 2900, rentMonth: 420_000, firstYear: 2012, lastYear: 2017, valueUsed: 45_000_000, hPerCycle: 9.0, insuranceMonth: 120_000,
    aCheckFH: 1000, aCheckHours: 24, cCheckMonths: 24, cCheckDays: 28, pilotsPerAircraft: 20, scarcity: 0.96, available: true, aogMult: 1.15, rest: TR(1, 'ccrc', 12, null, false, null), yAbreast: 10, pursers: 2,
  },
  {
    // 777X: first deliveries only around 2027 (Lufthansa first): new-build slots only, almost never offered.
    id: 'b779', name: 'Boeing 777-9', short: 'B779', family: 'B777', body: 'wide', engines: 2, catalog: 'b779', art: 'b779', tier: 3,
    cabins: [c('42J/24W/360Y', 'three-class', 42, 24, 360), c('48J/400Y', 'two-class', 48, 0, 400)], maxSeats: 495,
    rangeNm: 6900, cruiseKt: 490, turnMin: 105, cockpitMin: 2, cabinTypical: 14, restClass: 1, etopsMax: 330, minRunwayM: 3200,
    rateBH: 17_000, fuelTBH: 7.9, maintBH: 1800, rentMonth: 1_450_000, rentNew: 1_550_000, newOnly: true, firstYear: 2027, valueUsed: 195_000_000, hPerCycle: 8.0, insuranceMonth: 160_000,
    aCheckFH: 1200, aCheckHours: 16, cCheckMonths: 36, cCheckDays: 18, pilotsPerAircraft: 22, scarcity: 0.995, available: true, rest: TR(1, 'ccrc', 12, null, false, null), yAbreast: 10,
  },
  {
    // The ultra-long-range 777X: not in service before about 2030, so it never shows up before then.
    id: 'b778', name: 'Boeing 777-8', short: 'B778', family: 'B777', body: 'wide', engines: 2, catalog: 'b778', art: 'b778', tier: 4,
    cabins: [c('42J/28W/280Y', 'three-class', 42, 28, 280), c('60J/40W/150Y', 'three-class', 60, 40, 150)], maxSeats: 440,
    rangeNm: 8400, cruiseKt: 490, turnMin: 95, cockpitMin: 4, cabinTypical: 12, restClass: 1, etopsMax: 330, minRunwayM: 3200,
    rateBH: 15_500, fuelTBH: 7.3, maintBH: 1700, rentMonth: 1_350_000, rentNew: 1_450_000, newOnly: true, firstYear: 2030, valueUsed: 175_000_000, hPerCycle: 9.0, insuranceMonth: 150_000,
    aCheckFH: 1200, aCheckHours: 16, cCheckMonths: 36, cCheckDays: 18, pilotsPerAircraft: 28, scarcity: 0.99, available: true, ulr: true, rest: TR(1, 'ccrc', 10, null, false, null), yAbreast: 10,
  },
  // 747 classics (1970–1991): JT9D-era engines at Chapter 3 at best (night bans and noise fees at many airports), very
  // thirsty, AOG-prone, very cheap, very rare. v0.10: on the market, flown by two pilots (the real ones had a flight
  // engineer as well: a fact line only, the player's choice).
  {
    id: 'b741', name: 'Boeing 747-100', short: 'B741', family: 'B747', body: 'wide', engines: 4, catalog: 'b741', art: 'b741', tier: 2,
    cabins: [c('32J/360Y', 'two-class', 32, 0, 360), c('480Y', 'all-economy', 0, 0, 480)], maxSeats: 550,
    rangeNm: 4300, cruiseKt: 480, turnMin: 120, cockpitMin: 2, cabinTypical: 13, restClass: 2, etopsMax: 0, minRunwayM: 3300,
    rateBH: 7000, fuelTBH: 13.0, maintBH: 4800, rentMonth: 40_000, firstYear: 1970, lastYear: 1986, valueUsed: 1_200_000, hPerCycle: 6.5, insuranceMonth: 70_000,
    aCheckFH: 450, aCheckHours: 30, cCheckMonths: 15, cCheckDays: 35, pilotsPerAircraft: 18, scarcity: 0.995, available: true, aogMult: 2.0, rest: TR(0.2, 'ccrc', 6, { rowsLost: 2, places: 9, fc: 2 }, false, null), yAbreast: 10, pursers: 2,
  },
  {
    id: 'b742', name: 'Boeing 747-200', short: 'B742', family: 'B747', body: 'wide', engines: 4, catalog: 'b742', art: 'b742', tier: 2,
    cabins: [c('32J/360Y', 'two-class', 32, 0, 360), c('480Y', 'all-economy', 0, 0, 480)], maxSeats: 550,
    rangeNm: 5500, cruiseKt: 480, turnMin: 120, cockpitMin: 2, cabinTypical: 13, restClass: 2, etopsMax: 0, minRunwayM: 3300,
    rateBH: 7500, fuelTBH: 12.8, maintBH: 4500, rentMonth: 45_000, firstYear: 1971, lastYear: 1991, valueUsed: 1_500_000, hPerCycle: 7.0, insuranceMonth: 70_000,
    aCheckFH: 450, aCheckHours: 30, cCheckMonths: 15, cCheckDays: 35, pilotsPerAircraft: 18, scarcity: 0.995, available: true, aogMult: 1.9, rest: TR(0.25, 'ccrc', 6, { rowsLost: 2, places: 9, fc: 2 }, false, null), yAbreast: 10, pursers: 2,
  },
  {
    id: 'b743', name: 'Boeing 747-300', short: 'B743', family: 'B747', body: 'wide', engines: 4, catalog: 'b743', art: 'b743', tier: 2,
    cabins: [c('32J/400Y', 'two-class', 32, 0, 400), c('520Y', 'all-economy', 0, 0, 520)], maxSeats: 660,
    rangeNm: 5600, cruiseKt: 485, turnMin: 120, cockpitMin: 2, cabinTypical: 14, restClass: 2, etopsMax: 0, minRunwayM: 3300,
    rateBH: 8000, fuelTBH: 12.5, maintBH: 4300, rentMonth: 50_000, firstYear: 1983, lastYear: 1990, valueUsed: 1_800_000, hPerCycle: 7.0, insuranceMonth: 70_000,
    aCheckFH: 450, aCheckHours: 30, cCheckMonths: 15, cCheckDays: 35, pilotsPerAircraft: 18, scarcity: 0.995, available: true, aogMult: 1.8, rest: TR(0.25, 'ccrc', 6, { rowsLost: 2, places: 9, fc: 2 }, false, null), yAbreast: 10, pursers: 2,
  },
] as Omit<AcmiType, 'crew'>[]).map((t) => ({ ...t, crew: CREW[t.id] }));

export const ACMI_TYPES: Record<string, AcmiType> = Object.fromEntries(ACMI_TYPES_LIST.map((t) => [t.id, t]));

export function acmiType(id: string): AcmiType {
  const t = ACMI_TYPES[id];
  if (!t) throw new Error(`Unknown ACMI type ${id}`);
  return t;
}

/** Sprite for a type id and an airframe's variant (falls back to the id itself, then the renderer's default). */
export function artFor(typeId: string, variant?: string): string {
  return variantOf(typeId, variant)?.sprite ?? ACMI_TYPES[typeId]?.art ?? typeId;
}
