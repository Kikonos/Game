// ACMI parameters for the shortlist types (RESEARCH §4.1, §5.2–5.7, §7.2–7.3). All money in USD.
// `catalog` links to src/data/aircraft.ts (specs, facts); `art` picks the side-profile drawing
// (types without their own profile borrow a family look-alike until art specs are added).

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
  /** AircraftArt profile id (own profile or a look-alike). */
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
  /** Minimum pilots for an unaugmented duty (4 for ULR types on ULR sectors). */
  cockpitMin: 2 | 4;
  /** Typical ACMI cabin crew at the default configuration (legal minimum is ceil(seats/50)). */
  cabinTypical: number;
  /** In-flight crew rest facility fitted as standard (FTL F3); null = none. */
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
}

const c = (label: string, layout: CabinLayout, j: number, w: number, y: number): CabinPreset => ({ label, layout, j, w, y });

export const ACMI_TYPES_LIST: AcmiType[] = [
  {
    id: 'a320ceo', name: 'Airbus A320ceo', short: 'A320', family: 'A320', body: 'narrow', engines: 2, catalog: 'a320ceo', art: 'a320ceo', tier: 0,
    cabins: [c('180Y', 'all-economy', 0, 0, 180), c('12J/156Y', 'two-class', 12, 0, 156)], maxSeats: 186,
    rangeNm: 2700, cruiseKt: 450, turnMin: 40, cockpitMin: 2, cabinTypical: 4, restClass: null, etopsMax: 120, minRunwayM: 2000,
    rateBH: 3800, fuelTBH: 2.5, maintBH: 900, rentMonth: 240_000, valueUsed: 14_000_000, insuranceMonth: 42_000,
    aCheckFH: 750, aCheckHours: 10, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.2, available: true,
  },
  {
    id: 'b738', name: 'Boeing 737-800', short: 'B738', family: 'B737', body: 'narrow', engines: 2, catalog: 'b738', art: 'b738', tier: 0,
    cabins: [c('189Y', 'all-economy', 0, 0, 189), c('12J/162Y', 'two-class', 12, 0, 162)], maxSeats: 189,
    rangeNm: 2500, cruiseKt: 450, turnMin: 40, cockpitMin: 2, cabinTypical: 4, restClass: null, etopsMax: 120, minRunwayM: 2200,
    rateBH: 3700, fuelTBH: 2.5, maintBH: 900, rentMonth: 235_000, valueUsed: 15_000_000, insuranceMonth: 42_000,
    aCheckFH: 700, aCheckHours: 10, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.2, available: true,
  },
  {
    id: 'a321ceo', name: 'Airbus A321ceo', short: 'A321', family: 'A320', body: 'narrow', engines: 2, catalog: 'a321ceo', art: 'a321ceo', tier: 1,
    cabins: [c('220Y', 'all-economy', 0, 0, 220), c('16J/180Y', 'two-class', 16, 0, 180)], maxSeats: 230,
    rangeNm: 2300, cruiseKt: 450, turnMin: 45, cockpitMin: 2, cabinTypical: 5, restClass: null, etopsMax: 120, minRunwayM: 2300,
    rateBH: 4300, fuelTBH: 2.9, maintBH: 1000, rentMonth: 280_000, valueUsed: 18_000_000, insuranceMonth: 46_000,
    aCheckFH: 750, aCheckHours: 10, cCheckMonths: 24, cCheckDays: 14, pilotsPerAircraft: 11, scarcity: 0.3, available: true,
  },
  {
    id: 'a321neo', name: 'Airbus A321neo (LR)', short: 'A21N', family: 'A320', body: 'narrow', engines: 2, catalog: 'a321neo', art: 'a321neo', tier: 1,
    cabins: [c('220Y', 'all-economy', 0, 0, 220), c('16J/190Y', 'two-class', 16, 0, 190)], maxSeats: 244,
    rangeNm: 3500, cruiseKt: 450, turnMin: 45, cockpitMin: 2, cabinTypical: 5, restClass: null, etopsMax: 180, minRunwayM: 2300,
    rateBH: 5000, fuelTBH: 2.5, maintBH: 800, rentMonth: 460_000, valueUsed: 55_000_000, insuranceMonth: 60_000,
    aCheckFH: 1000, aCheckHours: 10, cCheckMonths: 36, cCheckDays: 12, pilotsPerAircraft: 12, scarcity: 0.8, available: true,
  },
  {
    id: 'b752', name: 'Boeing 757-200', short: 'B752', family: 'B757/767', body: 'narrow', engines: 2, catalog: 'b752', art: 'b752', tier: 1,
    cabins: [c('235Y', 'all-economy', 0, 0, 235), c('16J/184Y', 'two-class', 16, 0, 184)], maxSeats: 239,
    rangeNm: 3300, cruiseKt: 460, turnMin: 50, cockpitMin: 2, cabinTypical: 6, restClass: null, etopsMax: 180, minRunwayM: 2000,
    rateBH: 5200, fuelTBH: 3.3, maintBH: 1500, rentMonth: 140_000, valueUsed: 7_000_000, insuranceMonth: 44_000,
    aCheckFH: 600, aCheckHours: 14, cCheckMonths: 18, cCheckDays: 18, pilotsPerAircraft: 11, scarcity: 0.6, available: true,
  },
  {
    id: 'b763', name: 'Boeing 767-300ER', short: 'B763', family: 'B757/767', body: 'wide', engines: 2, catalog: 'b763', art: 'b763', tier: 2,
    cabins: [c('16J/251Y', 'two-class', 16, 0, 251), c('309Y', 'all-economy', 0, 0, 309)], maxSeats: 351,
    rangeNm: 5000, cruiseKt: 460, turnMin: 70, cockpitMin: 2, cabinTypical: 8, restClass: 2, etopsMax: 180, minRunwayM: 2600,
    rateBH: 6400, fuelTBH: 5.3, maintBH: 2000, rentMonth: 170_000, valueUsed: 10_000_000, insuranceMonth: 60_000,
    aCheckFH: 550, aCheckHours: 16, cCheckMonths: 18, cCheckDays: 18, pilotsPerAircraft: 14, scarcity: 0.4, available: true,
  },
  {
    id: 'a332', name: 'Airbus A330-200', short: 'A332', family: 'A330/340', body: 'wide', engines: 2, art: 'a333', tier: 2,
    cabins: [c('18J/282Y', 'two-class', 18, 0, 282), c('330Y', 'all-economy', 0, 0, 330)], maxSeats: 406,
    rangeNm: 6000, cruiseKt: 470, turnMin: 80, cockpitMin: 2, cabinTypical: 9, restClass: 2, etopsMax: 240, minRunwayM: 2700,
    rateBH: 7200, fuelTBH: 5.8, maintBH: 1800, rentMonth: 200_000, valueUsed: 12_000_000, insuranceMonth: 65_000,
    aCheckFH: 800, aCheckHours: 16, cCheckMonths: 24, cCheckDays: 18, pilotsPerAircraft: 16, scarcity: 0.35, available: true,
  },
  {
    id: 'a333', name: 'Airbus A330-300', short: 'A333', family: 'A330/340', body: 'wide', engines: 2, catalog: 'a333', art: 'a333', tier: 2,
    cabins: [c('24J/326Y', 'two-class', 24, 0, 326), c('440Y', 'all-economy', 0, 0, 440)], maxSeats: 440,
    rangeNm: 5300, cruiseKt: 470, turnMin: 80, cockpitMin: 2, cabinTypical: 10, restClass: 2, etopsMax: 180, minRunwayM: 2800,
    rateBH: 7800, fuelTBH: 6.0, maintBH: 1800, rentMonth: 330_000, valueUsed: 30_000_000, insuranceMonth: 75_000,
    aCheckFH: 800, aCheckHours: 16, cCheckMonths: 24, cCheckDays: 18, pilotsPerAircraft: 16, scarcity: 0.4, available: true,
  },
  {
    id: 'a343', name: 'Airbus A340-300', short: 'A343', family: 'A330/340', body: 'wide', engines: 4, art: 'a333', tier: 2,
    cabins: [c('30J/270Y', 'two-class', 30, 0, 270), c('335Y', 'all-economy', 0, 0, 335)], maxSeats: 375,
    rangeNm: 6500, cruiseKt: 470, turnMin: 90, cockpitMin: 2, cabinTypical: 10, restClass: 2, etopsMax: 0, minRunwayM: 3000,
    rateBH: 6000, fuelTBH: 7.0, maintBH: 2500, rentMonth: 110_000, valueUsed: 8_000_000, insuranceMonth: 60_000,
    aCheckFH: 800, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 16, scarcity: 0.5, available: true,
  },
  {
    id: 'b772', name: 'Boeing 777-200ER', short: 'B772', family: 'B777', body: 'wide', engines: 2, catalog: 'b772', art: 'b772', tier: 3,
    cabins: [c('30J/24W/239Y', 'three-class', 30, 24, 239), c('400Y', 'all-economy', 0, 0, 400)], maxSeats: 440,
    rangeNm: 6200, cruiseKt: 485, turnMin: 90, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 330, minRunwayM: 3000,
    rateBH: 9000, fuelTBH: 7.2, maintBH: 2300, rentMonth: 250_000, valueUsed: 15_000_000, insuranceMonth: 85_000,
    aCheckFH: 1000, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 20, scarcity: 0.7, available: true,
  },
  {
    id: 'b77w', name: 'Boeing 777-300ER', short: 'B77W', family: 'B777', body: 'wide', engines: 2, catalog: 'b77w', art: 'b77w', tier: 3,
    cabins: [c('42J/358Y', 'two-class', 42, 0, 358), c('450Y', 'all-economy', 0, 0, 450)], maxSeats: 550,
    rangeNm: 6500, cruiseKt: 485, turnMin: 100, cockpitMin: 2, cabinTypical: 12, restClass: 1, etopsMax: 330, minRunwayM: 3100,
    rateBH: 10_500, fuelTBH: 8.0, maintBH: 2200, rentMonth: 450_000, valueUsed: 40_000_000, insuranceMonth: 100_000,
    aCheckFH: 1000, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 22, scarcity: 0.6, available: true,
  },
  {
    id: 'b789', name: 'Boeing 787-9', short: 'B789', family: 'B787', body: 'wide', engines: 2, catalog: 'b789', art: 'b789', tier: 4,
    cabins: [c('28J/262Y', 'two-class', 28, 0, 262), c('330Y', 'all-economy', 0, 0, 330)], maxSeats: 420,
    rangeNm: 6800, cruiseKt: 490, turnMin: 80, cockpitMin: 2, cabinTypical: 9, restClass: 1, etopsMax: 330, minRunwayM: 2900,
    rateBH: 11_500, fuelTBH: 5.6, maintBH: 1400, rentMonth: 750_000, valueUsed: 90_000_000, insuranceMonth: 110_000,
    aCheckFH: 1100, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.9, available: true,
  },
  {
    id: 'a359', name: 'Airbus A350-900', short: 'A359', family: 'A350', body: 'wide', engines: 2, catalog: 'a359', art: 'a359', tier: 4,
    cabins: [c('32J/288Y', 'two-class', 32, 0, 288), c('369Y', 'all-economy', 0, 0, 369)], maxSeats: 440,
    rangeNm: 7300, cruiseKt: 490, turnMin: 85, cockpitMin: 2, cabinTypical: 10, restClass: 1, etopsMax: 370, minRunwayM: 2800,
    rateBH: 12_500, fuelTBH: 6.0, maintBH: 1500, rentMonth: 1_000_000, valueUsed: 110_000_000, insuranceMonth: 120_000,
    aCheckFH: 1200, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 20, scarcity: 0.95, available: true,
  },
  {
    id: 'a35u', name: 'Airbus A350-900ULR', short: 'A35U', family: 'A350', body: 'wide', engines: 2, art: 'a359', tier: 4,
    cabins: [c('67J/94W', 'two-class', 67, 94, 0), c('42J/24W/187Y', 'three-class', 42, 24, 187)], maxSeats: 440,
    rangeNm: 9000, cruiseKt: 490, turnMin: 85, cockpitMin: 4, cabinTypical: 8, restClass: 1, etopsMax: 370, minRunwayM: 3000,
    rateBH: 14_000, fuelTBH: 6.5, maintBH: 1600, rentMonth: 1_100_000, valueUsed: 120_000_000, insuranceMonth: 125_000,
    aCheckFH: 1200, aCheckHours: 14, cCheckMonths: 36, cCheckDays: 14, pilotsPerAircraft: 28, scarcity: 0.98, available: true, ulr: true,
  },
  {
    id: 'b77l', name: 'Boeing 777-200LR', short: 'B77L', family: 'B777', body: 'wide', engines: 2, art: 'b772', tier: 4,
    cabins: [c('38J/262Y', 'two-class', 38, 0, 262), c('35J/24W/221Y', 'three-class', 35, 24, 221)], maxSeats: 440,
    rangeNm: 7500, cruiseKt: 485, turnMin: 90, cockpitMin: 4, cabinTypical: 10, restClass: 1, etopsMax: 330, minRunwayM: 3200,
    rateBH: 14_000, fuelTBH: 7.4, maintBH: 2200, rentMonth: 600_000, valueUsed: 35_000_000, insuranceMonth: 100_000,
    aCheckFH: 1000, aCheckHours: 18, cCheckMonths: 24, cCheckDays: 21, pilotsPerAircraft: 26, scarcity: 0.95, available: true, ulr: true,
  },
  {
    id: 'a388', name: 'Airbus A380-800', short: 'A388', family: 'A380', body: 'wide', engines: 4, catalog: 'a388', art: 'a388', tier: 3,
    cabins: [c('12J/459Y', 'two-class', 12, 0, 459), c('60J/411Y', 'two-class', 60, 0, 411)], maxSeats: 853,
    rangeNm: 7000, cruiseKt: 490, turnMin: 120, cockpitMin: 2, cabinTypical: 17, restClass: 1, etopsMax: 0, minRunwayM: 3300,
    rateBH: 21_000, fuelTBH: 12, maintBH: 4000, rentMonth: 450_000, valueUsed: 30_000_000, insuranceMonth: 140_000,
    aCheckFH: 1000, aCheckHours: 24, cCheckMonths: 24, cCheckDays: 28, pilotsPerAircraft: 20, scarcity: 0.9, available: true,
  },
  {
    id: 'b744', name: 'Boeing 747-400', short: 'B744', family: 'B747', body: 'wide', engines: 4, catalog: 'b744', art: 'b744', tier: 3,
    cabins: [c('24J/426Y', 'two-class', 24, 0, 426), c('500Y', 'all-economy', 0, 0, 500)], maxSeats: 660,
    rangeNm: 6500, cruiseKt: 490, turnMin: 120, cockpitMin: 2, cabinTypical: 13, restClass: 1, etopsMax: 0, minRunwayM: 3200,
    rateBH: 11_000, fuelTBH: 10.5, maintBH: 3000, rentMonth: 150_000, valueUsed: 8_000_000, insuranceMonth: 90_000,
    aCheckFH: 600, aCheckHours: 24, cCheckMonths: 18, cCheckDays: 28, pilotsPerAircraft: 18, scarcity: 1, available: false,
  },
];

export const ACMI_TYPES: Record<string, AcmiType> = Object.fromEntries(ACMI_TYPES_LIST.map((t) => [t.id, t]));

export function acmiType(id: string): AcmiType {
  const t = ACMI_TYPES[id];
  if (!t) throw new Error(`Unknown ACMI type ${id}`);
  return t;
}

/** AircraftArt profile for a type id (falls back to the id itself, then the renderer's default). */
export function artFor(typeId: string): string {
  return ACMI_TYPES[typeId]?.art ?? typeId;
}
