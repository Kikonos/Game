// Spain: the researched markets from Madrid (MAD) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is MAD (or another airport in Spain: it then becomes a route base of a game based at MAD). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station another base's file lists too is
// repeated here with the same numbers (the first file's row is the one used).
// The fares here are net: what a passenger pays us, off-peak to peak. The engine reads catalogue fares as
// published ones and sells under them (BAL.v019.fares.scale 0.57), so each market carries `fareX: 1.75` (1 / 0.57)
// unless tuned (a balance step: scripts/netcal.ts).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: MAD itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so MAD's is what a route from another base pays there.
 */
export const MAD_STATIONS: Record<string, RouteStation> = {
  // [F] Aena 2026: landing EUR 9.08-9.74 a tonne at Madrid, network revenue cap EUR 11.03 a passenger (+6.5 % from March 2026).
  MAD: { code: 'MAD', fuelX: 1.0, airport: 2_900, handling: 4_800, paxCharge: 1.5, overhead: 8_000, cat: 'A', caterer: true, euCargo: true, taxes: 26 },
  // [E] Canary and Balearic airports: lower passenger charges on flights to the mainland.
  LPA: { code: 'LPA', fuelX: 1.04, airport: 1_700, handling: 4_000, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 9 },
  IBZ: { code: 'IBZ', fuelX: 1.05, airport: 1_900, handling: 4_300, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 12 },
  // [E] Tangier Ibn Battouta: cheap to turn, no caterer up to the standard (meals for the way back are loaded in Madrid).
  TNG: { code: 'TNG', fuelX: 1.08, airport: 1_500, handling: 3_400, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: false, euCargo: true, taxes: 28 },
  OTP: { code: 'OTP', fuelX: 1.02, airport: 1_800, handling: 3_400, paxCharge: 1.5, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 22 },
  // [E] Malabo: a 3,000 m volcano beside the field (category B), fuel dear, no caterer, no EU cargo security (ACC3).
  SSG: { code: 'SSG', fuelX: 1.2, airport: 3_200, handling: 5_200, paxCharge: 1, overhead: 11_000, cat: 'B', caterer: false, euCargo: false, taxes: 70 },
  // [E] Santa Cruz Viru Viru (373 m, 3,500 m runway).
  VVI: { code: 'VVI', fuelX: 1.12, airport: 2_600, handling: 4_400, paxCharge: 1.5, overhead: 10_000, cat: 'A', caterer: true, euCargo: true, taxes: 65 },
  // [F] 2026: Havana has almost no jet fuel (flights to Europe refuel in Santo Domingo). [E] its price when there is some,
  // and no caterer up to the standard while the shortages last.
  HAV: { code: 'HAV', fuelX: 1.45, airport: 3_200, handling: 5_200, paxCharge: 1, overhead: 12_000, cat: 'A', caterer: false, euCargo: true, taxes: 60 },
  // Santo Domingo as a fuel stop (the way back from Havana).
  SDQ: { code: 'SDQ', fuelX: 1.0, airport: 2_400, handling: 2_400, paxCharge: 0, overhead: 2_000, cat: 'A', caterer: true, euCargo: true, taxes: 0 },
};

/** The catalogue from Madrid. */
export const MAD_MARKETS: RouteMarket[] = [
  {
    id: 'MAD-LPA', from: 'MAD', to: 'LPA', city: 'Las Palmas', country: 'Spain',
    models: ['own', 'tour'], model: 'own',
    // [F] Gran Canaria airport: 15.8 million passengers in 2025; Binter alone put 770,000 seats a year on Canaries-Madrid.
    // [E] the city pair, from about 150 flights a week each way.
    odPerYear: 1_900_000, outShare: 0.5, growth: 0.03,
    season: [0.9, 0.9, 0.95, 1.0, 0.95, 1.0, 1.15, 1.2, 1.0, 0.95, 0.9, 1.1],
    seasonBack: [0.9, 0.9, 0.95, 1.0, 0.95, 1.0, 1.15, 1.2, 1.0, 0.95, 0.9, 1.1],
    segments: { vfr: 0.4, tourism: 0.35, biz: 0.15, gov: 0.05, students: 0.05 },
    competitors: [
      // [F] the four airlines; [E] their frequencies. [F] Binter: 5,800 flights a year on its two Madrid routes (E195-E2).
      { name: 'Iberia Express', perWeek: 56, stops: 0, hours: 2.9, fareX: 1.0, seats: 186 },
      { name: 'Air Europa', perWeek: 42, stops: 0, hours: 2.9, fareX: 1.0, seats: 186 },
      { name: 'Binter', perWeek: 28, stops: 0, hours: 2.9, fareX: 1.05, seats: 132 },
      { name: 'Ryanair', perWeek: 21, stops: 0, hours: 2.9, fareX: 0.75, seats: 189 },
    ],
    // [F] Canary residents pay 25 % of the fare, the state pays the airline the other 75 %: the fare here is the whole of it.
    fareY: [85, 210], fareJ: [220, 480], fareX: 1.75,
    cargo: { south: 2_500, north: 800, mail: 400, perish: 600 },
    ancillary: 16, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 4, out: 900, back: 1_075, nights: 0 },
    navPerSector: 2_100, rights: 'open', eu261: 'mid',
    blurb: 'Huge domestic market: islanders pay a quarter of the fare, the state pays the rest. Four airlines.',
  },
  {
    id: 'MAD-IBZ', from: 'MAD', to: 'IBZ', city: 'Ibiza', country: 'Spain',
    models: ['own', 'tour'], model: 'own',
    // [E] Madrid is one of Ibiza's first routes; about 30 flights a week in April [F], several times that in August.
    odPerYear: 900_000, outShare: 0.5, growth: 0.03,
    season: [0.3, 0.35, 0.5, 0.8, 1.2, 1.6, 2.0, 2.1, 1.5, 0.9, 0.4, 0.35],
    seasonBack: [0.3, 0.35, 0.5, 0.8, 1.2, 1.6, 2.0, 2.1, 1.5, 0.9, 0.4, 0.35],
    segments: { tourism: 0.75, vfr: 0.15, biz: 0.1 },
    competitors: [
      // [F] the airlines; [E] their frequencies, a year's average (far more in July and August).
      { name: 'Iberia Express', perWeek: 28, stops: 0, hours: 1.2, fareX: 1.0, seats: 186 },
      { name: 'Air Europa', perWeek: 14, stops: 0, hours: 1.2, fareX: 1.0, seats: 186 },
      { name: 'Ryanair', perWeek: 14, stops: 0, hours: 1.2, fareX: 0.75, seats: 189 },
      { name: 'Vueling', perWeek: 7, stops: 0, hours: 1.2, fareX: 0.85, seats: 180 },
    ],
    fareY: [55, 210], fareJ: [150, 450], fareX: 1.16, // tuned: flown in its season only, when fares sit at the top of the range
    cargo: { south: 600, north: 100 },
    ancillary: 18, bagShare: 0.2,
    timetable: { pattern: 'weekly', day: 4, out: 1_020, back: 1_145, nights: 0 },
    navPerSector: 600, rights: 'open', eu261: 'mid',
    blurb: 'One hour to the island. Almost all of it between May and September.',
  },
  {
    id: 'MAD-TNG', from: 'MAD', to: 'TNG', city: 'Tangier', country: 'Morocco',
    models: ['own'], model: 'own',
    // [F] Moroccans are Spain's first foreign community (968,999 in 2025; 100,939 in the Madrid region).
    // [E] the city pair, from about 24 flights a week.
    odPerYear: 300_000, outShare: 0.5, growth: 0.05,
    // Out in July and August (the summer return home), back at the end of August and in September.
    season: [0.75, 0.7, 0.85, 1.0, 0.9, 1.05, 1.4, 1.5, 1.0, 0.9, 0.8, 1.15],
    seasonBack: [0.85, 0.7, 0.8, 0.95, 0.9, 0.9, 1.1, 1.45, 1.35, 0.9, 0.8, 1.3],
    segments: { vfr: 0.55, tourism: 0.25, biz: 0.15, students: 0.05 },
    competitors: [
      // [F] Royal Air Maroc: new on 28 March 2026, 3 a week (2 from 7 September). [F] Ryanair, Air Arabia Maroc and Iberia
      // fly it; [E] their frequencies. Iberia's flights are Air Nostrum regional jets.
      { name: 'Ryanair', perWeek: 7, stops: 0, hours: 1.4, fareX: 0.75, seats: 189 },
      { name: 'Air Arabia Maroc', perWeek: 7, stops: 0, hours: 1.4, fareX: 0.8, seats: 174 },
      { name: 'Iberia (Air Nostrum)', perWeek: 7, stops: 0, hours: 1.4, fareX: 1.15, seats: 100 },
      { name: 'Royal Air Maroc', perWeek: 3, stops: 0, hours: 1.4, fareX: 1.05, seats: 160 },
    ],
    // [F] Air Arabia sells Madrid-Tangier from EUR 26, Air Europa (codeshare) from EUR 55.
    fareY: [50, 160], fareJ: [140, 330], fareX: 1.75,
    cargo: { south: 500, north: 300, perish: 200 },
    ancillary: 22, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 480, back: 570, nights: 0 },
    navPerSector: 700, rights: 'open', eu261: 'mid',
    blurb: 'Moroccan families in Madrid. Low-cost rivals; summer and Eid peaks.',
  },
  {
    id: 'MAD-OTP', from: 'MAD', to: 'OTP', city: 'Bucharest', country: 'Romania',
    models: ['own'], model: 'own',
    // [F] Romanians: 609,270 in Spain (2025), 111,309 in the Madrid region (115,911 a year before).
    // [E] the city pair, from 17-28 flights a week [F].
    odPerYear: 430_000, outShare: 0.5, growth: 0.02,
    segments: { vfr: 0.65, biz: 0.15, tourism: 0.15, students: 0.05 },
    competitors: [
      // [F] Wizz Air, Ryanair and TAROM fly it; Iberia starts Bucharest in summer 2026. [E] the split.
      { name: 'Wizz Air', perWeek: 9, stops: 0, hours: 3.8, fareX: 0.75, seats: 239 },
      { name: 'Ryanair', perWeek: 7, stops: 0, hours: 3.8, fareX: 0.75, seats: 189 },
      { name: 'TAROM', perWeek: 6, stops: 0, hours: 3.8, fareX: 1.05, seats: 160 },
      { name: 'Iberia', perWeek: 4, stops: 0, hours: 3.8, fareX: 1.15, seats: 180 },
    ],
    // [F] Skyscanner: Madrid-Bucharest from EUR 86 return in the low season.
    fareY: [65, 190], fareJ: [200, 420], fareX: 1.75,
    cargo: { south: 600, north: 400, mail: 150 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 420, back: 765, nights: 0 },
    navPerSector: 3_500, rights: 'open', eu261: 'mid',
    blurb: 'Romanians are the second community in Madrid. Wizz Air and Ryanair set low fares.',
  },
  {
    id: 'MAD-SSG', from: 'MAD', to: 'SSG', city: 'Malabo', country: 'Equatorial Guinea',
    models: ['partner', 'own'], model: 'partner', partner: { name: 'CEIBA Intercontinental', code: 'C2', country: 'GQ' },
    // [F] Iberia left Malabo in January 2018 (3 a week, not profitable). CEIBA, on the EU ban list like every airline of
    // Equatorial Guinea, has flown Madrid on wet leases since 2012 (White, Privilege Style, Wamos Air); one flight a
    // week in August 2026. [E] the market.
    odPerYear: 45_000, outShare: 0.5, growth: 0.01,
    segments: { vfr: 0.45, gov: 0.2, biz: 0.2, students: 0.1, tourism: 0.05 },
    competitors: [
      // [F] Royal Air Maroc sells Malabo-Madrid from EUR 453-587 return, Air France from EUR 872. [E] frequencies.
      { name: 'Royal Air Maroc via Casablanca', perWeek: 5, stops: 1, hours: 9.5, fareX: 0.8, seats: 25, via: 'CMN' },
      { name: 'Air France via Paris', perWeek: 4, stops: 1, hours: 11, fareX: 1.2, seats: 15, via: 'CDG' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 3, stops: 1, hours: 14, fareX: 0.9, seats: 12, via: 'IST' },
      { name: 'Ethiopian via Addis Ababa', perWeek: 3, stops: 1, hours: 17, fareX: 0.85, seats: 10, via: 'ADD' },
    ],
    fareY: [330, 640], fareJ: [1_100, 1_900], fareX: 1.75,
    // [E] food, parts and parcels south; nothing north (no EU cargo security at Malabo).
    cargo: { south: 3_000, north: 0, mail: 150 },
    ancillary: 26, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 4, out: 600, back: 720, nights: 1 },
    // [F] IATA, April 2025: USD 191 million of airline money blocked in the Central African franc zone.
    navPerSector: 4_300, risk: { coup: 0.03, fx: 0.25 }, rights: 'partner', eu261: 'long',
    blurb: 'Flown for CEIBA (on the EU ban list). Iberia left in 2018: no other nonstop. A narrowbody reaches it.',
  },
  {
    id: 'MAD-VVI', from: 'MAD', to: 'VVI', city: 'Santa Cruz', country: 'Bolivia',
    models: ['own'], model: 'own',
    // [E] from 7 nonstops a week [F, May 2026] and the Bolivian community in Spain. Iberia does not fly Bolivia.
    odPerYear: 190_000, outShare: 0.5, growth: 0.03,
    segments: { vfr: 0.72, biz: 0.1, tourism: 0.1, students: 0.05, gov: 0.03 },
    competitors: [
      // [F] Air Europa and Boliviana de Aviación, 7 a week between them ([E] the split); 11 h 30. [E] the one-stops.
      { name: 'Air Europa', perWeek: 4, stops: 0, hours: 11.5, fareX: 1.0, seats: 296 },
      { name: 'Boliviana de Aviación', perWeek: 3, stops: 0, hours: 11.5, fareX: 0.9, seats: 266 },
      { name: 'LATAM via São Paulo', perWeek: 7, stops: 1, hours: 17, fareX: 0.9, seats: 20, via: 'GRU' },
      { name: 'Avianca via Bogotá', perWeek: 7, stops: 1, hours: 16, fareX: 0.85, seats: 20, via: 'BOG' },
    ],
    // [F] Air Europa: Madrid-Santa Cruz from EUR 731 return.
    fareY: [360, 760], fareJ: [1_500, 2_700], fareX: 1.4, // tuned: long haul: the range reads as published fares
    cargo: { south: 4_000, north: 1_500, mail: 200, perish: 600 },
    ancillary: 28, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 2, out: 720, back: 1_320, nights: 1 },
    // [F] IATA: USD 42 million of airline money was blocked in Bolivia in October 2024 (cleared by April 2025).
    navPerSector: 5_400, risk: { coup: 0.03, fx: 0.15 }, rights: 'bilateral', eu261: 'long',
    blurb: 'Bolivian families in Spain. Only Air Europa and BoA fly it. Needs an A330.',
  },
  {
    id: 'MAD-HAV', from: 'MAD', to: 'HAV', city: 'Havana', country: 'Cuba',
    // [F] 2026: no jet fuel in Havana, so the way back refuels in Santo Domingo (Air Europa and Iberia since February).
    viaBack: ['SDQ'],
    models: ['own', 'tour'], model: 'own',
    // [E] down from the years before: tourism fell, family travel holds.
    odPerYear: 380_000, outShare: 0.5, growth: 0.0,
    segments: { vfr: 0.6, tourism: 0.25, biz: 0.08, gov: 0.05, students: 0.02 },
    competitors: [
      // [F] Air Europa keeps 3 a week (Tuesday, Thursday, Sunday). [F] Iberia stopped on 1 June 2026 (1,152 seats a week
      // each way) and plans to come back in November; [E] at 4 a week. [F] Air China 2 a week (Beijing-Madrid-Havana).
      // [F] World2Fly and Cubana stopped. [F] Iberia sells Havana over Panama with Copa.
      { name: 'Air Europa', perWeek: 3, stops: 0, hours: 10.5, fareX: 1.0, seats: 296 },
      { name: 'Iberia', perWeek: 4, stops: 0, hours: 10.5, fareX: 1.05, seats: 288 },
      { name: 'Air China', perWeek: 2, stops: 0, hours: 10.5, fareX: 0.85, seats: 60 },
      { name: 'Copa Airlines via Panama', perWeek: 14, stops: 1, hours: 15, fareX: 0.9, seats: 25, via: 'PTY' },
    ],
    // [F] June 2026: return fares above EUR 2,000, some days EUR 3,970; Air China from EUR 1,300. [E] a normal year below.
    fareY: [420, 950], fareJ: [1_700, 3_200], fareX: 1.2, // tuned: long haul: the range reads as published fares
    // [E] parcels and supplies south on every flight; little north.
    cargo: { south: 4_500, north: 300, mail: 300, ngo: 300 },
    ancillary: 30, bagShare: 0.45,
    timetable: { pattern: 'weekly', day: 6, out: 720, back: 1_320, nights: 1 },
    navPerSector: 4_600, risk: { coup: 0.03, fx: 0.35 }, rights: 'bilateral', eu261: 'long', rightsHard: 0.15,
    blurb: 'Cuba is short of jet fuel: the way back stops in Santo Domingo. Few rivals left, high fares. Widebody.',
  },
];
