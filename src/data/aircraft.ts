// Real-world aircraft catalog. Figures are approximations of published data,
// tuned slightly for gameplay (prices are typical market values, not list prices).

export type BodyType = 'turboprop' | 'regional' | 'narrow' | 'wide' | 'jumbo' | 'supersonic';
export type EngineLayout = 'prop' | 'wing2' | 'rear2' | 'wing4';

export interface AircraftType {
  id: string;
  name: string;
  short: string;
  manufacturer: 'Airbus' | 'Boeing' | 'Embraer' | 'ATR' | 'De Havilland' | 'Bombardier' | 'COMAC' | 'Boom';
  family: string;
  body: BodyType;
  /** Typical two-class seat count quoted by the manufacturer. */
  typicalSeats: number;
  /** Certified exit limit. */
  maxSeats: number;
  /** Usable cabin length in inches available for seat rows. */
  cabinLength: number;
  /** Economy seats per row in a standard layout. */
  yAbreast: number;
  /** Economy seats per row in the densest layout. */
  yAbreastMax: number;
  rangeKm: number;
  speedKmh: number;
  /** Cruise fuel burn in kg per km. */
  fuelBurn: number;
  /** Price in USD for a new aircraft (reference value for used-only types). */
  price: number;
  /** Year of entry into service. */
  eis: number;
  /** Year new orders can first be delivered (for upcoming types). */
  availableFrom: number;
  /** Whether new-build aircraft can still be ordered from the manufacturer. */
  inProduction: boolean;
  mtow: number;
  /** Belly cargo capacity in tonnes. */
  cargoT: number;
  turnMin: number;
  /** Maintenance cost per block hour at age 0. */
  maintHour: number;
  /** Flight-deck crew cost per block hour. */
  pilotRate: number;
  lengthM: number;
  spanM: number;
  engines: EngineLayout;
  /** Lead time in months for new orders. */
  leadMonths: number;
  /** Narrowbodies that can fit lie-flat business seats. */
  flatBedNarrow?: boolean;
  generation: 'new' | 'current' | 'legacy';
  /** Minimum airline level to order. */
  minLevel: number;
  fact: string;
}

const M = 1_000_000;

export const AIRCRAFT: AircraftType[] = [
  {
    id: 'atr42', name: 'ATR 42-600', short: 'AT42', manufacturer: 'ATR', family: 'ATR', body: 'turboprop',
    typicalSeats: 48, maxSeats: 50, cabinLength: 375, yAbreast: 4, yAbreastMax: 4, rangeKm: 1326, speedKmh: 556,
    fuelBurn: 0.95, price: 19 * M, eis: 2012, availableFrom: 2012, inProduction: true, mtow: 18.6, cargoT: 0.3,
    turnMin: 25, maintHour: 260, pilotRate: 380, lengthM: 22.7, spanM: 24.6, engines: 'prop', leadMonths: 4,
    generation: 'current', minLevel: 1,
    fact: 'Built for short, rough runways — the STOL-capable 42-600S can land on just 800 metres of tarmac.',
  },
  {
    id: 'atr72', name: 'ATR 72-600', short: 'AT76', manufacturer: 'ATR', family: 'ATR', body: 'turboprop',
    typicalSeats: 70, maxSeats: 78, cabinLength: 565, yAbreast: 4, yAbreastMax: 4, rangeKm: 1528, speedKmh: 510,
    fuelBurn: 1.25, price: 26 * M, eis: 2011, availableFrom: 2011, inProduction: true, mtow: 23, cargoT: 0.5,
    turnMin: 25, maintHour: 300, pilotRate: 400, lengthM: 27.2, spanM: 27.05, engines: 'prop', leadMonths: 4,
    generation: 'current', minLevel: 1,
    fact: 'The best-selling regional turboprop of the century, burning up to 40% less fuel than a similar-sized jet.',
  },
  {
    id: 'q400', name: 'De Havilland Dash 8-400', short: 'DH8D', manufacturer: 'De Havilland', family: 'Dash 8', body: 'turboprop',
    typicalSeats: 78, maxSeats: 90, cabinLength: 640, yAbreast: 4, yAbreastMax: 4, rangeKm: 2040, speedKmh: 667,
    fuelBurn: 1.6, price: 32 * M, eis: 2000, availableFrom: 2000, inProduction: false, mtow: 29.6, cargoT: 0.6,
    turnMin: 25, maintHour: 360, pilotRate: 420, lengthM: 32.8, spanM: 28.4, engines: 'prop', leadMonths: 0,
    generation: 'current', minLevel: 1,
    fact: 'The fastest turboprop airliner flying, cruising at up to 667 km/h — almost jet-like block times.',
  },
  {
    id: 'crj900', name: 'Bombardier CRJ900', short: 'CRJ9', manufacturer: 'Bombardier', family: 'CRJ', body: 'regional',
    typicalSeats: 76, maxSeats: 90, cabinLength: 650, yAbreast: 4, yAbreastMax: 4, rangeKm: 2956, speedKmh: 830,
    fuelBurn: 2.05, price: 48 * M, eis: 2003, availableFrom: 2003, inProduction: false, mtow: 38.3, cargoT: 0.7,
    turnMin: 35, maintHour: 520, pilotRate: 520, lengthM: 36.2, spanM: 24.9, engines: 'rear2', leadMonths: 0,
    generation: 'legacy', minLevel: 1,
    fact: 'Production ended in 2020 when Mitsubishi bought the CRJ line — but over 1,900 CRJs were built.',
  },
  {
    id: 'e175', name: 'Embraer E175', short: 'E175', manufacturer: 'Embraer', family: 'E-Jet', body: 'regional',
    typicalSeats: 76, maxSeats: 88, cabinLength: 650, yAbreast: 4, yAbreastMax: 4, rangeKm: 3700, speedKmh: 829,
    fuelBurn: 1.85, price: 32 * M, eis: 2005, availableFrom: 2005, inProduction: true, mtow: 40.4, cargoT: 0.8,
    turnMin: 35, maintHour: 500, pilotRate: 520, lengthM: 31.7, spanM: 26, engines: 'wing2', leadMonths: 5,
    generation: 'current', minLevel: 1,
    fact: 'The backbone of US regional flying, thanks to pilot “scope clauses” that cap regional jets at 76 seats.',
  },
  {
    id: 'e190e2', name: 'Embraer E190-E2', short: 'E290', manufacturer: 'Embraer', family: 'E-Jet E2', body: 'regional',
    typicalSeats: 104, maxSeats: 114, cabinLength: 830, yAbreast: 4, yAbreastMax: 4, rangeKm: 5300, speedKmh: 833,
    fuelBurn: 1.95, price: 40 * M, eis: 2018, availableFrom: 2018, inProduction: true, mtow: 56.4, cargoT: 1.0,
    turnMin: 35, maintHour: 540, pilotRate: 560, lengthM: 36.2, spanM: 33.7, engines: 'wing2', leadMonths: 6,
    generation: 'new', minLevel: 1,
    fact: 'Geared turbofans and new wings make it up to 17% more efficient than the first-generation E190.',
  },
  {
    id: 'e195e2', name: 'Embraer E195-E2', short: 'E295', manufacturer: 'Embraer', family: 'E-Jet E2', body: 'regional',
    typicalSeats: 132, maxSeats: 146, cabinLength: 1040, yAbreast: 4, yAbreastMax: 4, rangeKm: 4800, speedKmh: 833,
    fuelBurn: 2.15, price: 45 * M, eis: 2019, availableFrom: 2019, inProduction: true, mtow: 62.5, cargoT: 1.2,
    turnMin: 40, maintHour: 580, pilotRate: 580, lengthM: 41.5, spanM: 35.1, engines: 'wing2', leadMonths: 6,
    generation: 'new', minLevel: 1,
    fact: 'Nicknamed the “Profit Hunter” — Embraer painted a tiger shark’s face on the nose of the demonstrator.',
  },
  {
    id: 'a220_100', name: 'Airbus A220-100', short: 'BCS1', manufacturer: 'Airbus', family: 'A220', body: 'narrow',
    typicalSeats: 115, maxSeats: 135, cabinLength: 790, yAbreast: 5, yAbreastMax: 5, rangeKm: 6390, speedKmh: 829,
    fuelBurn: 1.85, price: 36 * M, eis: 2016, availableFrom: 2016, inProduction: true, mtow: 63.1, cargoT: 1.2,
    turnMin: 35, maintHour: 560, pilotRate: 600, lengthM: 35, spanM: 35.1, engines: 'wing2', leadMonths: 7,
    generation: 'new', minLevel: 1,
    fact: 'Born as the Bombardier CSeries. Its 2-3 layout means only one passenger in five gets a middle seat.',
  },
  {
    id: 'a220_300', name: 'Airbus A220-300', short: 'BCS3', manufacturer: 'Airbus', family: 'A220', body: 'narrow',
    typicalSeats: 140, maxSeats: 160, cabinLength: 930, yAbreast: 5, yAbreastMax: 5, rangeKm: 6700, speedKmh: 829,
    fuelBurn: 2.0, price: 42 * M, eis: 2016, availableFrom: 2016, inProduction: true, mtow: 70.9, cargoT: 1.4,
    turnMin: 40, maintHour: 600, pilotRate: 620, lengthM: 38.7, spanM: 35.1, engines: 'wing2', leadMonths: 7,
    generation: 'new', minLevel: 1,
    fact: 'With 18.5-inch seats it offers the widest standard economy seat of any single-aisle jet.',
  },
  {
    id: 'c919', name: 'COMAC C919', short: 'C919', manufacturer: 'COMAC', family: 'C919', body: 'narrow',
    typicalSeats: 158, maxSeats: 192, cabinLength: 900, yAbreast: 6, yAbreastMax: 6, rangeKm: 4075, speedKmh: 834,
    fuelBurn: 2.6, price: 45 * M, eis: 2023, availableFrom: 2023, inProduction: true, mtow: 72.5, cargoT: 1.8,
    turnMin: 45, maintHour: 720, pilotRate: 680, lengthM: 38.9, spanM: 35.8, engines: 'wing2', leadMonths: 9,
    generation: 'current', minLevel: 1,
    fact: 'China’s first home-grown mainline jet, entering service with China Eastern in May 2023.',
  },
  {
    id: 'a319neo', name: 'Airbus A319neo', short: 'A19N', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 140, maxSeats: 160, cabinLength: 780, yAbreast: 6, yAbreastMax: 6, rangeKm: 6950, speedKmh: 828,
    fuelBurn: 2.25, price: 46 * M, eis: 2019, availableFrom: 2019, inProduction: true, mtow: 75.5, cargoT: 1.6,
    turnMin: 40, maintHour: 640, pilotRate: 680, lengthM: 33.8, spanM: 35.8, engines: 'wing2', leadMonths: 8,
    generation: 'new', minLevel: 1,
    fact: 'One of the rarest NEOs — most airlines chose to upsize to the A320neo or A321neo instead.',
  },
  {
    id: 'a320neo', name: 'Airbus A320neo', short: 'A20N', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 165, maxSeats: 194, cabinLength: 900, yAbreast: 6, yAbreastMax: 6, rangeKm: 6300, speedKmh: 833,
    fuelBurn: 2.45, price: 54 * M, eis: 2016, availableFrom: 2016, inProduction: true, mtow: 79, cargoT: 2.0,
    turnMin: 45, maintHour: 680, pilotRate: 700, lengthM: 37.6, spanM: 35.8, engines: 'wing2', leadMonths: 8,
    generation: 'new', minLevel: 1,
    fact: '“neo” stands for New Engine Option. The Sharklet wingtips alone cut fuel burn by up to 4%.',
  },
  {
    id: 'a321neo', name: 'Airbus A321neo', short: 'A21N', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 206, maxSeats: 244, cabinLength: 1150, yAbreast: 6, yAbreastMax: 6, rangeKm: 7400, speedKmh: 833,
    fuelBurn: 2.85, price: 63 * M, eis: 2017, availableFrom: 2017, inProduction: true, mtow: 97, cargoT: 2.6,
    turnMin: 50, maintHour: 740, pilotRate: 730, lengthM: 44.5, spanM: 35.8, engines: 'wing2', leadMonths: 9,
    flatBedNarrow: true, generation: 'new', minLevel: 2,
    fact: 'Airbus’s best seller: the A321neo now outsells the A320neo in new orders.',
  },
  {
    id: 'a321xlr', name: 'Airbus A321XLR', short: 'A21N', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 190, maxSeats: 220, cabinLength: 1150, yAbreast: 6, yAbreastMax: 6, rangeKm: 8700, speedKmh: 833,
    fuelBurn: 2.95, price: 70 * M, eis: 2024, availableFrom: 2024, inProduction: true, mtow: 101, cargoT: 1.6,
    turnMin: 50, maintHour: 760, pilotRate: 760, lengthM: 44.5, spanM: 35.8, engines: 'wing2', leadMonths: 10,
    flatBedNarrow: true, generation: 'new', minLevel: 3,
    fact: 'A permanent rear-centre tank holding 12,900 litres opens transatlantic routes to a single-aisle jet.',
  },
  {
    id: 'b38m', name: 'Boeing 737 MAX 8', short: 'B38M', manufacturer: 'Boeing', family: '737', body: 'narrow',
    typicalSeats: 178, maxSeats: 210, cabinLength: 960, yAbreast: 6, yAbreastMax: 6, rangeKm: 6570, speedKmh: 839,
    fuelBurn: 2.5, price: 55 * M, eis: 2017, availableFrom: 2017, inProduction: true, mtow: 82.2, cargoT: 2.0,
    turnMin: 45, maintHour: 690, pilotRate: 700, lengthM: 39.5, spanM: 35.9, engines: 'wing2', leadMonths: 8,
    generation: 'new', minLevel: 1,
    fact: 'Its split-tip winglets stand 2.95 m tall — higher than a basketball hoop.',
  },
  {
    id: 'b3jm', name: 'Boeing 737 MAX 10', short: 'B3XM', manufacturer: 'Boeing', family: '737', body: 'narrow',
    typicalSeats: 204, maxSeats: 230, cabinLength: 1080, yAbreast: 6, yAbreastMax: 6, rangeKm: 5740, speedKmh: 839,
    fuelBurn: 2.75, price: 60 * M, eis: 2027, availableFrom: 2027, inProduction: true, mtow: 89.8, cargoT: 2.4,
    turnMin: 50, maintHour: 720, pilotRate: 720, lengthM: 43.8, spanM: 35.9, engines: 'wing2', leadMonths: 10,
    generation: 'new', minLevel: 2,
    fact: 'A clever levered main gear lets the longest 737 ever built rotate without striking its tail.',
  },
  {
    id: 'b738', name: 'Boeing 737-800', short: 'B738', manufacturer: 'Boeing', family: '737', body: 'narrow',
    typicalSeats: 162, maxSeats: 189, cabinLength: 930, yAbreast: 6, yAbreastMax: 6, rangeKm: 5400, speedKmh: 842,
    fuelBurn: 2.75, price: 50 * M, eis: 1998, availableFrom: 1998, inProduction: false, mtow: 79, cargoT: 2.0,
    turnMin: 45, maintHour: 720, pilotRate: 700, lengthM: 39.5, spanM: 35.8, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 1,
    fact: 'With almost 5,000 built, the 737-800 is one of the most-produced jetliners in history.',
  },
  {
    id: 'a320ceo', name: 'Airbus A320ceo', short: 'A320', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 160, maxSeats: 180, cabinLength: 900, yAbreast: 6, yAbreastMax: 6, rangeKm: 6100, speedKmh: 833,
    fuelBurn: 2.75, price: 50 * M, eis: 1988, availableFrom: 1988, inProduction: false, mtow: 78, cargoT: 2.0,
    turnMin: 45, maintHour: 720, pilotRate: 700, lengthM: 37.6, spanM: 34.1, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 1,
    fact: 'The first airliner with digital fly-by-wire controls, launching a family of over 18,000 orders.',
  },
  {
    id: 'a321ceo', name: 'Airbus A321ceo', short: 'A321', manufacturer: 'Airbus', family: 'A320neo', body: 'narrow',
    typicalSeats: 190, maxSeats: 220, cabinLength: 1150, yAbreast: 6, yAbreastMax: 6, rangeKm: 5950, speedKmh: 833,
    fuelBurn: 3.15, price: 58 * M, eis: 1994, availableFrom: 1994, inProduction: false, mtow: 93.5, cargoT: 2.6,
    turnMin: 50, maintHour: 780, pilotRate: 730, lengthM: 44.5, spanM: 34.1, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 2,
    fact: 'Pilots of any A320-family jet can fly it with the same type rating — a huge saving for airlines.',
  },
  {
    id: 'b752', name: 'Boeing 757-200', short: 'B752', manufacturer: 'Boeing', family: '757/767', body: 'narrow',
    typicalSeats: 200, maxSeats: 239, cabinLength: 1150, yAbreast: 6, yAbreastMax: 6, rangeKm: 7250, speedKmh: 850,
    fuelBurn: 3.6, price: 65 * M, eis: 1983, availableFrom: 1983, inProduction: false, mtow: 115.7, cargoT: 3.0,
    turnMin: 50, maintHour: 950, pilotRate: 780, lengthM: 47.3, spanM: 38, engines: 'wing2', leadMonths: 0,
    flatBedNarrow: true, generation: 'legacy', minLevel: 2,
    fact: 'A hot-rod of the skies: its huge power-to-weight ratio makes it a legend on short, hot-and-high runways.',
  },
  {
    id: 'b763', name: 'Boeing 767-300ER', short: 'B763', manufacturer: 'Boeing', family: '757/767', body: 'wide',
    typicalSeats: 218, maxSeats: 351, cabinLength: 1280, yAbreast: 7, yAbreastMax: 8, rangeKm: 11070, speedKmh: 851,
    fuelBurn: 4.9, price: 110 * M, eis: 1988, availableFrom: 1988, inProduction: false, mtow: 186.9, cargoT: 12,
    turnMin: 75, maintHour: 1500, pilotRate: 1050, lengthM: 54.9, spanM: 47.6, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 3,
    fact: 'The 2-3-2 layout means just one middle seat per row — a passenger favourite for decades.',
  },
  {
    id: 'a333', name: 'Airbus A330-300', short: 'A333', manufacturer: 'Airbus', family: 'A330', body: 'wide',
    typicalSeats: 277, maxSeats: 440, cabinLength: 1460, yAbreast: 8, yAbreastMax: 9, rangeKm: 11750, speedKmh: 871,
    fuelBurn: 6.0, price: 120 * M, eis: 1994, availableFrom: 1994, inProduction: false, mtow: 242, cargoT: 18,
    turnMin: 85, maintHour: 1700, pilotRate: 1150, lengthM: 63.7, spanM: 60.3, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 3,
    fact: 'Shares its fuselage and cockpit with the four-engined A340 — they were designed side by side.',
  },
  {
    id: 'a339', name: 'Airbus A330-900neo', short: 'A339', manufacturer: 'Airbus', family: 'A330', body: 'wide',
    typicalSeats: 287, maxSeats: 460, cabinLength: 1460, yAbreast: 8, yAbreastMax: 9, rangeKm: 13334, speedKmh: 871,
    fuelBurn: 5.3, price: 125 * M, eis: 2018, availableFrom: 2018, inProduction: true, mtow: 251, cargoT: 18,
    turnMin: 85, maintHour: 1500, pilotRate: 1150, lengthM: 63.7, spanM: 64, engines: 'wing2', leadMonths: 10,
    generation: 'new', minLevel: 3,
    fact: 'Trent 7000 engines and a new 64 m wing cut fuel burn per seat by 25% versus the original A330.',
  },
  {
    id: 'b788', name: 'Boeing 787-8 Dreamliner', short: 'B788', manufacturer: 'Boeing', family: '787', body: 'wide',
    typicalSeats: 248, maxSeats: 359, cabinLength: 1200, yAbreast: 9, yAbreastMax: 9, rangeKm: 13530, speedKmh: 903,
    fuelBurn: 4.8, price: 125 * M, eis: 2011, availableFrom: 2011, inProduction: true, mtow: 228, cargoT: 14,
    turnMin: 80, maintHour: 1350, pilotRate: 1150, lengthM: 56.7, spanM: 60.1, engines: 'wing2', leadMonths: 10,
    generation: 'new', minLevel: 3,
    fact: 'Half of its structure is carbon composite, allowing a more humid cabin and the biggest windows in the sky.',
  },
  {
    id: 'b789', name: 'Boeing 787-9 Dreamliner', short: 'B789', manufacturer: 'Boeing', family: '787', body: 'wide',
    typicalSeats: 296, maxSeats: 406, cabinLength: 1380, yAbreast: 9, yAbreastMax: 9, rangeKm: 14010, speedKmh: 903,
    fuelBurn: 5.4, price: 150 * M, eis: 2014, availableFrom: 2014, inProduction: true, mtow: 254, cargoT: 18,
    turnMin: 85, maintHour: 1450, pilotRate: 1180, lengthM: 62.8, spanM: 60.1, engines: 'wing2', leadMonths: 11,
    generation: 'new', minLevel: 3,
    fact: 'Opened the first-ever nonstop link between Australia and Europe: Perth–London in about 17 hours.',
  },
  {
    id: 'b78x', name: 'Boeing 787-10 Dreamliner', short: 'B78X', manufacturer: 'Boeing', family: '787', body: 'wide',
    typicalSeats: 336, maxSeats: 440, cabinLength: 1600, yAbreast: 9, yAbreastMax: 9, rangeKm: 11730, speedKmh: 903,
    fuelBurn: 5.9, price: 165 * M, eis: 2018, availableFrom: 2018, inProduction: true, mtow: 254, cargoT: 21,
    turnMin: 90, maintHour: 1500, pilotRate: 1180, lengthM: 68.3, spanM: 60.1, engines: 'wing2', leadMonths: 11,
    generation: 'new', minLevel: 4,
    fact: 'The stretch Dreamliner trades range for 40 extra seats — ideal for dense medium-haul trunk routes.',
  },
  {
    id: 'a359', name: 'Airbus A350-900', short: 'A359', manufacturer: 'Airbus', family: 'A350', body: 'wide',
    typicalSeats: 315, maxSeats: 440, cabinLength: 1520, yAbreast: 9, yAbreastMax: 10, rangeKm: 15000, speedKmh: 903,
    fuelBurn: 5.8, price: 160 * M, eis: 2015, availableFrom: 2015, inProduction: true, mtow: 283, cargoT: 20,
    turnMin: 90, maintHour: 1500, pilotRate: 1200, lengthM: 66.8, spanM: 64.75, engines: 'wing2', leadMonths: 11,
    generation: 'new', minLevel: 4,
    fact: 'An ultra-long-range A350-900 flies Singapore–New York, roughly 15,300 km — the world’s longest route.',
  },
  {
    id: 'a35k', name: 'Airbus A350-1000', short: 'A35K', manufacturer: 'Airbus', family: 'A350', body: 'wide',
    typicalSeats: 369, maxSeats: 480, cabinLength: 1790, yAbreast: 9, yAbreastMax: 10, rangeKm: 16100, speedKmh: 903,
    fuelBurn: 6.7, price: 185 * M, eis: 2018, availableFrom: 2018, inProduction: true, mtow: 319, cargoT: 24,
    turnMin: 95, maintHour: 1650, pilotRate: 1220, lengthM: 73.8, spanM: 64.75, engines: 'wing2', leadMonths: 12,
    generation: 'new', minLevel: 5,
    fact: 'Chosen for Qantas’ “Project Sunrise”: nonstop Sydney–London in around 22 hours.',
  },
  {
    id: 'b772', name: 'Boeing 777-200ER', short: 'B772', manufacturer: 'Boeing', family: '777', body: 'wide',
    typicalSeats: 313, maxSeats: 440, cabinLength: 1500, yAbreast: 9, yAbreastMax: 10, rangeKm: 13080, speedKmh: 892,
    fuelBurn: 7.0, price: 150 * M, eis: 1997, availableFrom: 1997, inProduction: false, mtow: 297.6, cargoT: 20,
    turnMin: 90, maintHour: 1900, pilotRate: 1200, lengthM: 63.7, spanM: 60.9, engines: 'wing2', leadMonths: 0,
    generation: 'legacy', minLevel: 4,
    fact: 'The first twin-jet approved to fly 180 minutes from the nearest airport from its very first day in service.',
  },
  {
    id: 'b77w', name: 'Boeing 777-300ER', short: 'B77W', manufacturer: 'Boeing', family: '777', body: 'wide',
    typicalSeats: 396, maxSeats: 550, cabinLength: 1760, yAbreast: 10, yAbreastMax: 10, rangeKm: 13650, speedKmh: 892,
    fuelBurn: 7.9, price: 190 * M, eis: 2004, availableFrom: 2004, inProduction: false, mtow: 351.5, cargoT: 25,
    turnMin: 100, maintHour: 2000, pilotRate: 1250, lengthM: 73.9, spanM: 64.8, engines: 'wing2', leadMonths: 0,
    generation: 'current', minLevel: 5,
    fact: 'Its GE90-115B engines were for years the most powerful jet engines ever certified.',
  },
  {
    id: 'b779', name: 'Boeing 777-9', short: 'B779', manufacturer: 'Boeing', family: '777', body: 'wide',
    typicalSeats: 426, maxSeats: 495, cabinLength: 1930, yAbreast: 10, yAbreastMax: 10, rangeKm: 13500, speedKmh: 905,
    fuelBurn: 7.4, price: 230 * M, eis: 2027, availableFrom: 2027, inProduction: true, mtow: 351.5, cargoT: 26,
    turnMin: 105, maintHour: 1850, pilotRate: 1280, lengthM: 76.7, spanM: 71.8, engines: 'wing2', leadMonths: 14,
    generation: 'new', minLevel: 6,
    fact: 'Folding wingtips: 71.8 m of span in flight, folding up to 64.8 m to fit standard airport gates.',
  },
  {
    id: 'b744', name: 'Boeing 747-400', short: 'B744', manufacturer: 'Boeing', family: '747', body: 'jumbo',
    typicalSeats: 416, maxSeats: 660, cabinLength: 2050, yAbreast: 10, yAbreastMax: 10, rangeKm: 13490, speedKmh: 913,
    fuelBurn: 10.8, price: 250 * M, eis: 1989, availableFrom: 1989, inProduction: false, mtow: 396.9, cargoT: 20,
    turnMin: 110, maintHour: 2900, pilotRate: 1350, lengthM: 70.6, spanM: 64.4, engines: 'wing4', leadMonths: 0,
    generation: 'legacy', minLevel: 5,
    fact: 'The “Queen of the Skies” brought long-haul flying to the masses — and its hump became an icon.',
  },
  {
    id: 'b748', name: 'Boeing 747-8 Intercontinental', short: 'B748', manufacturer: 'Boeing', family: '747', body: 'jumbo',
    typicalSeats: 467, maxSeats: 605, cabinLength: 2150, yAbreast: 10, yAbreastMax: 10, rangeKm: 14320, speedKmh: 917,
    fuelBurn: 10.2, price: 290 * M, eis: 2012, availableFrom: 2012, inProduction: false, mtow: 447.7, cargoT: 24,
    turnMin: 115, maintHour: 2600, pilotRate: 1350, lengthM: 76.3, spanM: 68.4, engines: 'wing4', leadMonths: 0,
    generation: 'current', minLevel: 6,
    fact: 'At 76.3 m it is the longest passenger airliner ever built.',
  },
  {
    id: 'a388', name: 'Airbus A380-800', short: 'A388', manufacturer: 'Airbus', family: 'A380', body: 'jumbo',
    typicalSeats: 525, maxSeats: 853, cabinLength: 2500, yAbreast: 10, yAbreastMax: 11, rangeKm: 15000, speedKmh: 903,
    fuelBurn: 12.5, price: 300 * M, eis: 2007, availableFrom: 2007, inProduction: false, mtow: 575, cargoT: 18,
    turnMin: 130, maintHour: 3300, pilotRate: 1400, lengthM: 72.7, spanM: 79.8, engines: 'wing4', leadMonths: 0,
    generation: 'current', minLevel: 6,
    fact: 'The world’s largest passenger jet. Its wing area is bigger than an NBA basketball court — twice over.',
  },
  {
    id: 'overture', name: 'Boom Overture', short: 'OVTR', manufacturer: 'Boom', family: 'Overture', body: 'supersonic',
    typicalSeats: 64, maxSeats: 80, cabinLength: 640, yAbreast: 4, yAbreastMax: 4, rangeKm: 7870, speedKmh: 1800,
    fuelBurn: 9.5, price: 200 * M, eis: 2030, availableFrom: 2030, inProduction: true, mtow: 77, cargoT: 0.5,
    turnMin: 60, maintHour: 3200, pilotRate: 1300, lengthM: 61, spanM: 32, engines: 'wing4', leadMonths: 18,
    generation: 'new', minLevel: 8,
    fact: 'Mach 1.7 over water: New York to London in about 3½ hours. The return of supersonic travel?',
  },
];

export const AIRCRAFT_BY_ID: Record<string, AircraftType> = Object.fromEntries(AIRCRAFT.map((a) => [a.id, a]));

export function aircraftType(id: string): AircraftType {
  const t = AIRCRAFT_BY_ID[id];
  if (!t) throw new Error(`Unknown aircraft type ${id}`);
  return t;
}

export const BODY_LABEL: Record<BodyType, string> = {
  turboprop: 'Turboprop',
  regional: 'Regional jet',
  narrow: 'Narrowbody',
  wide: 'Widebody',
  jumbo: 'Jumbo',
  supersonic: 'Supersonic',
};

export function isWidebody(t: AircraftType): boolean {
  return t.body === 'wide' || t.body === 'jumbo';
}

/** Minimum airport size required to handle this aircraft. */
export function minAirportSize(t: AircraftType): number {
  if (t.body === 'jumbo' || t.body === 'supersonic') return 4;
  if (t.body === 'wide') return 3;
  return 1;
}
