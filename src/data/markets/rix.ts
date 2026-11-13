// Latvia: the researched markets from Riga (RIX) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is RIX (or another airport in Latvia: it then becomes a route base of a game based at RIX). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station another base's file lists too is
// repeated here with the same numbers (the first file's row is the one used).
// The fares here are net: what a passenger pays us, off-peak to peak. The engine reads catalogue fares as
// published ones and sells under them (BAL.v019.fares.scale 0.57), so each market carries `fareX: 1.75` (1 / 0.57)
// unless tuned (a balance step: scripts/netcal.ts).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: RIX itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so RIX's is what a route from another base pays there.
 */
export const RIX_STATIONS: Record<string, RouteStation> = {
  // [F] Riga 2026: passenger service charge EUR 3.39 a departing passenger; an incentive scheme from April 2026
  // (Ryanair: "lower charges"). Latvia has no ticket tax. [E] the security charge in the taxes, landing, handling.
  RIX: { code: 'RIX', fuelX: 1.0, airport: 2_000, handling: 3_700, paxCharge: 0.8, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 14 },
  // [F] UK Air Passenger Duty: GBP 15 a passenger in economy from April 2026 (short-haul band). [E] Gatwick's charges.
  LGW: { code: 'LGW', fuelX: 1.0, airport: 3_000, handling: 5_000, paxCharge: 2.2, overhead: 7_000, cat: 'A', caterer: true, euCargo: true, taxes: 44 },
  // [E] Dublin: no ticket tax; the airport's passenger charge is capped by the regulator.
  DUB: { code: 'DUB', fuelX: 1.0, airport: 2_600, handling: 4_800, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 14 },
  // [E] Oslo: Norway's air passenger tax and Avinor's passenger and security charges; handling is dear.
  OSL: { code: 'OSL', fuelX: 1.03, airport: 2_600, handling: 5_200, paxCharge: 2.0, overhead: 6_500, cat: 'A', caterer: true, euCargo: true, taxes: 24 },
  // [E] Tenerife South (Aena): no ticket tax.
  TFS: { code: 'TFS', fuelX: 1.04, airport: 1_700, handling: 4_000, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 12 },
  // [E] Sharm el-Sheikh: a resort airport, cheap landing, Egypt's departure tax. No EU cargo security (ACC3): no
  // cargo back to the EU. Mountains of Sinai to the north and west: category B.
  SSH: { code: 'SSH', fuelX: 1.05, airport: 1_800, handling: 3_600, paxCharge: 1, overhead: 6_000, cat: 'B', caterer: true, euCargo: false, taxes: 30 },
  // [E] Tbilisi: 495 m up with high ground around: category B.
  TBS: { code: 'TBS', fuelX: 1.08, airport: 1_800, handling: 3_400, paxCharge: 1, overhead: 6_000, cat: 'B', caterer: true, euCargo: true, taxes: 25 },
  // [E] Tashkent: 432 m, a 4,000 m runway; the national airline's own handling company.
  TAS: { code: 'TAS', fuelX: 1.0, airport: 2_400, handling: 3_800, paxCharge: 1, overhead: 8_000, cat: 'A', caterer: true, euCargo: true, taxes: 30 },
  // [E] JFK: landing fee by weight plus terminal use; US taxes and fees on an international ticket.
  JFK: { code: 'JFK', fuelX: 0.95, airport: 7_500, handling: 7_000, paxCharge: 6.0, overhead: 14_000, cat: 'B', caterer: true, euCargo: true, taxes: 40 },
};

/** The catalogue from Riga. */
export const RIX_MARKETS: RouteMarket[] = [
  {
    id: 'RIX-LGW', from: 'RIX', to: 'LGW', city: 'London', country: 'United Kingdom',
    models: ['own'], model: 'own',
    // [F] London is Riga's first destination; the UK is 10.1 % of its 7.1 million passengers (2025).
    // [F] 21 to 24 London flights a week. [E] the passengers, from the seats; about 100,000 Latvians in the UK.
    odPerYear: 480_000, outShare: 0.5, growth: 0.01,
    season: [0.9, 0.8, 0.9, 1.0, 1.0, 1.05, 1.2, 1.2, 1.0, 0.95, 0.85, 1.15],
    seasonBack: [0.95, 0.8, 0.9, 1.0, 1.0, 1.05, 1.15, 1.25, 1.0, 0.95, 0.85, 1.1],
    segments: { vfr: 0.52, tourism: 0.22, biz: 0.2, students: 0.06 },
    competitors: [
      // [F] airBaltic to Gatwick: 10 a week, 7 to 9 in winter (A220-300). [F] Ryanair flies Stansted; [E] 12 a week.
      // [F] British Airways' Heathrow flights ended on 28 March 2026.
      { name: 'airBaltic', perWeek: 9, stops: 0, hours: 2.9, fareX: 1.05, seats: 148 },
      { name: 'Ryanair', perWeek: 12, stops: 0, hours: 2.9, fareX: 0.75, seats: 189 },
    ],
    // [F] airBaltic sells Riga-London from EUR 58 and London-Riga from EUR 75 one way.
    fareY: [60, 180], fareJ: [170, 400], fareX: 1.75,
    cargo: { south: 500, north: 600, mail: 200 },
    ancillary: 24, bagShare: 0.38,
    timetable: { pattern: 'weekly', day: 4, out: 435, back: 540, nights: 0 },
    navPerSector: 2_500, rights: 'open', eu261: 'mid',
    blurb: 'Riga’s biggest route. airBaltic to Gatwick and Ryanair to Stansted, over 20 a week.',
  },
  {
    id: 'RIX-DUB', from: 'RIX', to: 'DUB', city: 'Dublin', country: 'Ireland',
    models: ['own'], model: 'own',
    // [E] about 20,000 Latvians in Ireland. [E] the passengers, from 7 flights a week.
    odPerYear: 110_000, outShare: 0.5, growth: 0.01,
    season: [0.9, 0.75, 0.85, 1.0, 0.95, 1.1, 1.25, 1.25, 0.95, 0.9, 0.85, 1.25],
    seasonBack: [1.0, 0.75, 0.85, 1.0, 0.95, 1.05, 1.2, 1.3, 0.95, 0.9, 0.85, 1.2],
    segments: { vfr: 0.68, tourism: 0.14, biz: 0.12, students: 0.06 },
    competitors: [
      // [F] winter 2025/26: Ryanair 5 a week, airBaltic twice a week.
      { name: 'Ryanair', perWeek: 5, stops: 0, hours: 3.2, fareX: 0.8, seats: 189 },
      { name: 'airBaltic', perWeek: 2, stops: 0, hours: 3.2, fareX: 1.05, seats: 148 },
    ],
    fareY: [70, 200], fareJ: [180, 420], fareX: 1.75,
    cargo: { south: 300, north: 400, mail: 100 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 615, back: 770, nights: 0 },
    navPerSector: 2_800, rights: 'open', eu261: 'mid',
    blurb: 'Latvians in Ireland. Ryanair 5 a week, airBaltic 2. Peaks in summer and at Christmas.',
  },
  {
    id: 'RIX-OSL', from: 'RIX', to: 'OSL', city: 'Oslo', country: 'Norway',
    models: ['own'], model: 'own',
    // [F] Oslo is Riga's third destination (after London and Helsinki); 20 flights a week in May 2026.
    // [E] the passengers, without those who only change planes in Riga (a fifth of the airport's traffic).
    odPerYear: 210_000, outShare: 0.5, growth: 0.02,
    season: [1.0, 0.85, 0.95, 1.05, 0.95, 1.0, 1.15, 1.05, 0.95, 0.95, 0.9, 1.2],
    seasonBack: [1.1, 0.85, 0.95, 1.0, 0.95, 1.0, 1.05, 1.15, 0.95, 0.95, 0.9, 1.15],
    segments: { vfr: 0.5, biz: 0.25, tourism: 0.22, students: 0.03 },
    competitors: [
      // [F] airBaltic: 15 a week from summer 2026 (14 before); Norwegian flies the rest of the 20.
      { name: 'airBaltic', perWeek: 15, stops: 0, hours: 1.6, fareX: 1.0, seats: 148 },
      { name: 'Norwegian', perWeek: 5, stops: 0, hours: 1.6, fareX: 0.9, seats: 186 },
    ],
    fareY: [55, 160], fareJ: [150, 340], fareX: 1.75,
    cargo: { south: 200, north: 500, perish: 400 },
    ancillary: 22, bagShare: 0.32,
    timetable: { pattern: 'weekly', day: 6, out: 1_035, back: 1_110, nights: 0 },
    navPerSector: 1_200, rights: 'open', eu261: 'mid',
    blurb: 'Latvians working in Norway and Norwegian weekenders. airBaltic twice a day: its hub route.',
  },
  {
    id: 'RIX-TFS', from: 'RIX', to: 'TFS', city: 'Tenerife', country: 'Spain',
    models: ['tour', 'own'], model: 'tour',
    // [E] Latvia's winter sun: package holidays from November to April, 6.5 hours in a full narrowbody.
    odPerYear: 40_000, outShare: 0.5, growth: 0.03,
    season: [1.55, 1.6, 1.5, 0.9, 0.3, 0.25, 0.3, 0.3, 0.35, 1.25, 1.75, 1.95],
    seasonBack: [1.75, 1.6, 1.55, 1.0, 0.3, 0.25, 0.3, 0.3, 0.3, 1.1, 1.7, 1.85],
    segments: { tourism: 0.93, vfr: 0.04, biz: 0.03 },
    competitors: [
      // [F] airBaltic flies the Canaries in winter from all three Baltic capitals (3 a week from Vilnius and Tallinn).
      // [E] its Riga frequency, over the year, and the tour operators' own charters.
      { name: 'airBaltic', perWeek: 1.5, stops: 0, hours: 6.5, fareX: 1.05, seats: 148 },
      { name: 'Tez Tour charters', perWeek: 0.5, stops: 0, hours: 6.5, fareX: 1.0, seats: 180 },
    ],
    fareY: [150, 330], fareJ: [330, 620], fareX: 1.75,
    cargo: { south: 200, north: 100 },
    ancillary: 20, bagShare: 0.15,
    timetable: { pattern: 'weekly', day: 5, out: 420, back: 800, nights: 0 },
    // [F] EU261: a flight inside the EU pays the middle band whatever its length.
    navPerSector: 5_700, rights: 'open', eu261: 'mid',
    blurb: 'Winter sun, sold as holidays by a tour operator. Six and a half hours each way.',
  },
  {
    id: 'RIX-SSH', from: 'RIX', to: 'SSH', city: 'Sharm el-Sheikh', country: 'Egypt',
    models: ['tour', 'own'], model: 'tour',
    // [F] airBaltic flew Sharm el-Sheikh and Hurghada 3 a week each in winter 2025/26. [E] the passengers.
    odPerYear: 32_000, outShare: 0.5, growth: 0.04,
    season: [1.6, 1.6, 1.6, 1.1, 0.3, 0.2, 0.2, 0.2, 0.3, 1.4, 1.8, 1.7],
    seasonBack: [1.7, 1.6, 1.6, 1.2, 0.3, 0.2, 0.2, 0.2, 0.3, 1.3, 1.8, 1.6],
    segments: { tourism: 0.97, vfr: 0.02, biz: 0.01 },
    competitors: [
      // 3 a week from late October to April: 1.5 over the year.
      { name: 'airBaltic', perWeek: 1.5, stops: 0, hours: 5.0, fareX: 1.0, seats: 148 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 7, stops: 1, hours: 9, fareX: 1.1, seats: 10, via: 'IST' },
    ],
    fareY: [140, 300], fareJ: [300, 560], fareX: 1.75,
    cargo: { south: 100, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 2, out: 480, back: 840, nights: 0 },
    // Round Belarus and Ukraine (closed to us): about 5 hours.
    navPerSector: 4_000, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Red Sea package holidays, October to April. airBaltic flies it 3 a week in winter.',
  },
  {
    id: 'RIX-TBS', from: 'RIX', to: 'TBS', city: 'Tbilisi', country: 'Georgia',
    models: ['own'], model: 'own',
    // [E] tourism both ways, business, students, Georgians working in Latvia; with those who change planes in Riga.
    odPerYear: 50_000, outShare: 0.5, growth: 0.06,
    season: [0.7, 0.65, 0.8, 1.0, 1.2, 1.2, 1.25, 1.25, 1.3, 1.15, 0.75, 0.75],
    seasonBack: [0.7, 0.65, 0.8, 1.0, 1.15, 1.2, 1.25, 1.3, 1.3, 1.15, 0.75, 0.75],
    segments: { tourism: 0.45, vfr: 0.2, biz: 0.2, gov: 0.08, students: 0.07 },
    competitors: [
      // [F] airBaltic: 2 a week, 1 a week from 11 January to 28 February 2026.
      { name: 'airBaltic', perWeek: 2, stops: 0, hours: 4.2, fareX: 1.05, seats: 148 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 7.5, fareX: 1.0, seats: 15, via: 'IST' },
      { name: 'LOT via Warsaw', perWeek: 7, stops: 1, hours: 6.5, fareX: 1.0, seats: 10, via: 'WAW' },
    ],
    fareY: [140, 300], fareJ: [330, 620], fareX: 1.5, // tuned: our detour round Belarus and Russia is not in the block time
    // [E] Georgian wine and mineral water north.
    cargo: { south: 400, north: 600, mail: 100, perish: 200 },
    ancillary: 22, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 3, out: 1_320, back: 330, nights: 0 },
    // Round by Poland, Romania and Turkey: over 4 hours.
    navPerSector: 3_600, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Thin and growing: airBaltic only twice a week. A night flight, home by breakfast.',
  },
  {
    id: 'RIX-TAS', from: 'RIX', to: 'TAS', city: 'Tashkent', country: 'Uzbekistan',
    models: ['own'], model: 'own',
    // [F] 6 flights a week in 2026: Uzbekistan Airways (A321neo, 5 h 45; airBaltic sells it as BT7745) and FLYONE Asia,
    // new on 6 April 2026. [E] the market: Uzbek workers in Latvia and the Nordic countries, students, and Uzbeks
    // changing planes in Riga for Europe.
    odPerYear: 70_000, outShare: 0.45, growth: 0.08,
    segments: { vfr: 0.6, students: 0.12, biz: 0.12, tourism: 0.12, gov: 0.04 },
    competitors: [
      { name: 'Uzbekistan Airways', perWeek: 3, stops: 0, hours: 5.8, fareX: 1.0, seats: 190 },
      { name: 'FLYONE Asia', perWeek: 3, stops: 0, hours: 5.8, fareX: 0.8, seats: 180 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 10, fareX: 1.05, seats: 15, via: 'IST' },
    ],
    fareY: [230, 420], fareJ: [600, 1_050], fareX: 1.45, // tuned: our detour round Russia is not in the block time
    // [E] textiles and dried fruit north, parts and medicines south.
    cargo: { south: 800, north: 1_200, mail: 100, perish: 300 },
    ancillary: 26, bagShare: 0.45,
    timetable: { pattern: 'weekly', day: 1, out: 1_350, back: 540, nights: 0 },
    // [F] an EU airline may not fly over Russia: we go round by Turkey and the Caspian, about 7 hours and a third
    // more fuel and navigation than the rivals, who fly straight.
    navPerSector: 6_500, risk: { fx: 0.1 }, rights: 'bilateral', eu261: 'long', rightsHard: 0.35,
    blurb: 'Uzbek workers and students. The rivals fly over Russia in under 6 hours; we must go round.',
  },
  {
    id: 'RIX-JFK', from: 'RIX', to: 'JFK', city: 'New York', country: 'United States',
    models: ['own', 'tour'], model: 'own',
    // [E] about 90,000 Americans of Latvian descent, US visitors to the Baltics, business. No airline flies
    // the Baltic states to North America nonstop (airBaltic's A220 cannot).
    odPerYear: 60_000, outShare: 0.5, growth: 0.03,
    season: [0.55, 0.5, 0.65, 0.85, 1.15, 1.5, 1.7, 1.6, 1.15, 0.85, 0.6, 0.9],
    seasonBack: [0.6, 0.5, 0.65, 0.85, 1.15, 1.5, 1.6, 1.7, 1.15, 0.85, 0.6, 0.85],
    segments: { vfr: 0.4, tourism: 0.35, biz: 0.2, students: 0.05 },
    competitors: [
      // [F] the hubs these airlines link to both Riga and New York. [E] seats they give this market.
      { name: 'Finnair via Helsinki', perWeek: 7, stops: 1, hours: 11.5, fareX: 0.95, seats: 25, via: 'HEL' },
      { name: 'Lufthansa via Frankfurt', perWeek: 14, stops: 1, hours: 12.5, fareX: 1.0, seats: 20, via: 'FRA' },
      { name: 'SAS via Copenhagen', perWeek: 7, stops: 1, hours: 12, fareX: 0.95, seats: 15, via: 'CPH' },
      { name: 'LOT via Warsaw', perWeek: 7, stops: 1, hours: 13, fareX: 0.9, seats: 15, via: 'WAW' },
    ],
    fareY: [400, 850], fareJ: [1_450, 2_800], fareX: 1.25, // tuned: long haul: the range reads as published fares
    cargo: { south: 2_000, north: 2_000, mail: 200 },
    ancillary: 30, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 5, out: 690, back: 1_110, nights: 1 },
    navPerSector: 5_600, rights: 'open', eu261: 'long', rightsHard: 0.2,
    blurb: 'Needs a widebody and US permits. Nobody flies the Baltics to America nonstop: all go via a hub.',
  },
];
