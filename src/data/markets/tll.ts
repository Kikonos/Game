// Estonia: the researched markets from Tallinn (TLL) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is TLL (or another airport in Estonia: it then becomes a route base of a game based at TLL). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station another base's file lists too is
// repeated here with the same numbers (the first file's row is the one used).
// The fares here are net: what a passenger pays us, off-peak to peak. The engine reads catalogue fares as
// published ones and sells under them (BAL.v019.fares.scale 0.57), so each market carries `fareX: 1.75` (1 / 0.57)
// unless tuned (a balance step: scripts/netcal.ts).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: TLL itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so TLL's is what a route from another base pays there.
 */
export const TLL_STATIONS: Record<string, RouteStation> = {
  // [F] Tallinn Airport from 1 February 2026 (unchanged from 2025): landing EUR 7.50 a tonne (a 767: about $1,630);
  // passenger EUR 10.50, security EUR 2.87 and PRM EUR 0.48 a departing passenger (the taxes here). Estonia has
  // no ticket tax. [E] terminal navigation, handling.
  TLL: { code: 'TLL', fuelX: 1.0, airport: 2_000, handling: 3_800, paxCharge: 0.8, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 16 },
  // [F] UK Air Passenger Duty: GBP 15 a passenger in economy from April 2026 (short-haul band). [E] Stansted's charges.
  STN: { code: 'STN', fuelX: 1.0, airport: 2_400, handling: 4_600, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
  // [F] Sweden ended its aviation tax on 1 July 2025. [E] Swedavia's charges at Arlanda.
  ARN: { code: 'ARN', fuelX: 1.02, airport: 2_500, handling: 5_000, paxCharge: 2.0, overhead: 6_500, cat: 'A', caterer: true, euCargo: true, taxes: 22 },
  // [E] Oslo: Norway's air passenger tax and Avinor's passenger and security charges; handling is dear.
  OSL: { code: 'OSL', fuelX: 1.03, airport: 2_600, handling: 5_200, paxCharge: 2.0, overhead: 6_500, cat: 'A', caterer: true, euCargo: true, taxes: 24 },
  // [E] Dublin: no ticket tax; the airport's passenger charge is capped by the regulator.
  DUB: { code: 'DUB', fuelX: 1.0, airport: 2_600, handling: 4_800, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 14 },
  // [E] Tenerife South (Aena): no ticket tax.
  TFS: { code: 'TFS', fuelX: 1.04, airport: 1_700, handling: 4_000, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 12 },
  // [E] Antalya: built for charters, cheap and quick to turn.
  AYT: { code: 'AYT', fuelX: 1.02, airport: 1_900, handling: 3_400, paxCharge: 1, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 20 },
  // [E] Hurghada: a resort airport, cheap landing, Egypt's departure tax. No EU cargo security (ACC3).
  HRG: { code: 'HRG', fuelX: 1.05, airport: 1_800, handling: 3_600, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: true, euCargo: false, taxes: 30 },
  // [E] Phuket: one runway between hills and the sea, monsoon weather: category B.
  HKT: { code: 'HKT', fuelX: 1.02, airport: 2_600, handling: 3_600, paxCharge: 1, overhead: 8_000, cat: 'B', caterer: true, euCargo: true, taxes: 28 },
};

/** The catalogue from Tallinn. */
export const TLL_MARKETS: RouteMarket[] = [
  {
    id: 'TLL-STN', from: 'TLL', to: 'STN', city: 'London', country: 'United Kingdom',
    models: ['own'], model: 'own',
    // [F] winter 2025/26 timetable: 13 London flights a week (Stansted 7, Gatwick 3, Luton 3).
    // [E] the passengers, from the seats: British city breaks, Estonians in London, business.
    odPerYear: 200_000, outShare: 0.5, growth: 0.02,
    season: [0.8, 0.8, 0.9, 1.0, 1.05, 1.1, 1.2, 1.2, 1.0, 0.95, 0.85, 1.15],
    seasonBack: [0.85, 0.8, 0.9, 1.0, 1.05, 1.1, 1.15, 1.25, 1.0, 0.95, 0.85, 1.1],
    segments: { tourism: 0.38, vfr: 0.32, biz: 0.24, students: 0.06 },
    competitors: [
      // [F] Ryanair to Stansted every day (FR2224), airBaltic to Gatwick (BT871) and Wizz Air to Luton (W9 5446)
      // 3 a week each, on Tuesdays, Thursdays and Saturdays.
      { name: 'Ryanair', perWeek: 7, stops: 0, hours: 2.9, fareX: 0.75, seats: 189 },
      { name: 'airBaltic', perWeek: 3, stops: 0, hours: 3.0, fareX: 1.05, seats: 148 },
      { name: 'Wizz Air', perWeek: 3, stops: 0, hours: 2.9, fareX: 0.75, seats: 230 },
    ],
    fareY: [60, 180], fareJ: [170, 400], fareX: 1.75,
    cargo: { south: 400, north: 500, mail: 150 },
    ancillary: 22, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 4, out: 450, back: 555, nights: 0 },
    navPerSector: 2_500, rights: 'open', eu261: 'mid',
    blurb: 'London, three rivals to three airports: 13 a week. City breaks, families and business.',
  },
  {
    id: 'TLL-ARN', from: 'TLL', to: 'ARN', city: 'Stockholm', country: 'Sweden',
    models: ['own'], model: 'own',
    // [F] Stockholm is Tallinn's busiest route (ahead of Riga, 304,200 passengers in 2025). [E] the passengers who
    // start or end there, without those changing planes at Arlanda. Swedish banks own Estonia's two biggest banks.
    odPerYear: 200_000, outShare: 0.5, growth: 0.02,
    season: [0.9, 0.95, 1.0, 1.0, 1.05, 1.05, 0.9, 1.0, 1.1, 1.1, 1.05, 0.9],
    seasonBack: [0.9, 0.95, 1.0, 1.0, 1.05, 1.05, 0.9, 1.0, 1.1, 1.1, 1.05, 0.9],
    segments: { biz: 0.5, tourism: 0.25, vfr: 0.2, gov: 0.03, students: 0.02 },
    competitors: [
      // [F] winter 2025/26 timetable: SAS 3 to 4 a day (07:00, 11:00, 15:40, 20:00), Ryanair 4 to 5 a week.
      // [E] SAS's seats left for local passengers (most of its cabin connects at Arlanda).
      { name: 'SAS', perWeek: 24, stops: 0, hours: 1.0, fareX: 1.1, seats: 90 },
      { name: 'Ryanair', perWeek: 4, stops: 0, hours: 1.0, fareX: 0.7, seats: 189 },
    ],
    fareY: [60, 190], fareJ: [170, 380], fareX: 1.35, // tuned: SAS 24 a week: a newcomer sells under it
    cargo: { south: 300, north: 300, mail: 200 },
    ancillary: 14, bagShare: 0.15,
    timetable: { pattern: 'weekly', day: 0, out: 405, back: 430, nights: 0 },
    navPerSector: 600, rights: 'open', eu261: 'mid',
    blurb: 'One hour: business, banks and day trips. SAS flies it 3 to 4 times a day; the ferry takes a night.',
  },
  {
    id: 'TLL-OSL', from: 'TLL', to: 'OSL', city: 'Oslo', country: 'Norway',
    models: ['own'], model: 'own',
    // [F] Norwegian is the only airline: 4 a week in winter 2025/26. [E] the passengers: Estonians working in
    // Norway (building, oil service), business, Norwegian weekenders.
    odPerYear: 75_000, outShare: 0.5, growth: 0.03,
    season: [1.0, 0.85, 0.95, 1.05, 0.95, 1.0, 1.15, 1.05, 0.95, 0.95, 0.9, 1.2],
    seasonBack: [1.1, 0.85, 0.95, 1.0, 0.95, 1.0, 1.05, 1.15, 0.95, 0.95, 0.9, 1.15],
    segments: { vfr: 0.45, biz: 0.28, tourism: 0.25, students: 0.02 },
    competitors: [
      // [F] D8 2011 on Mondays, Wednesdays, Fridays and Sundays.
      { name: 'Norwegian', perWeek: 4, stops: 0, hours: 1.5, fareX: 0.9, seats: 186 },
      { name: 'SAS via Stockholm', perWeek: 21, stops: 1, hours: 3.5, fareX: 1.1, seats: 15, via: 'ARN' },
    ],
    fareY: [60, 170], fareJ: [160, 350], fareX: 1.75,
    cargo: { south: 150, north: 400, perish: 300 },
    ancillary: 20, bagShare: 0.28,
    timetable: { pattern: 'weekly', day: 3, out: 990, back: 1_060, nights: 0 },
    navPerSector: 1_100, rights: 'open', eu261: 'mid',
    blurb: 'Estonians working in Norway and business. Only Norwegian flies it, 4 a week: room on the other days.',
  },
  {
    id: 'TLL-DUB', from: 'TLL', to: 'DUB', city: 'Dublin', country: 'Ireland',
    models: ['own'], model: 'own',
    // [E] the passengers, from 2 flights a week: technology business both ways, Irish weekenders, a small community.
    odPerYear: 36_000, outShare: 0.5, growth: 0.03,
    season: [0.8, 0.8, 0.9, 1.0, 1.1, 1.15, 1.2, 1.2, 1.05, 0.95, 0.85, 1.0],
    seasonBack: [0.8, 0.8, 0.9, 1.0, 1.1, 1.15, 1.2, 1.2, 1.05, 0.95, 0.85, 1.0],
    segments: { tourism: 0.45, vfr: 0.25, biz: 0.25, students: 0.05 },
    competitors: [
      // [F] Ryanair FR5694 on Tuesdays and Saturdays (winter 2025/26), late evening.
      { name: 'Ryanair', perWeek: 2, stops: 0, hours: 3.2, fareX: 0.8, seats: 189 },
      { name: 'airBaltic via Riga', perWeek: 2, stops: 1, hours: 6, fareX: 1.1, seats: 20, via: 'RIX' },
    ],
    fareY: [75, 200], fareJ: [190, 420], fareX: 1.75,
    cargo: { south: 200, north: 200 },
    ancillary: 22, bagShare: 0.25,
    timetable: { pattern: 'weekly', day: 3, out: 600, back: 765, nights: 0 },
    navPerSector: 2_900, rights: 'open', eu261: 'mid',
    blurb: 'Thin: Ryanair twice a week, late at night. Weekenders and technology firms.',
  },
  {
    id: 'TLL-TFS', from: 'TLL', to: 'TFS', city: 'Tenerife', country: 'Spain',
    models: ['tour', 'own'], model: 'tour',
    // [E] Estonia's winter sun. The longest narrowbody sector from Tallinn: 6 h 25 scheduled.
    odPerYear: 28_000, outShare: 0.5, growth: 0.03,
    season: [1.55, 1.6, 1.5, 0.9, 0.3, 0.25, 0.3, 0.3, 0.35, 1.25, 1.75, 1.95],
    seasonBack: [1.75, 1.6, 1.55, 1.0, 0.3, 0.25, 0.3, 0.3, 0.3, 1.1, 1.7, 1.85],
    segments: { tourism: 0.94, vfr: 0.03, biz: 0.03 },
    competitors: [
      // [F] airBaltic BT881: 3 a week in winter (Mondays, Thursdays, Fridays), 2 a week from mid-January to
      // mid-February; 1.5 over the year.
      { name: 'airBaltic', perWeek: 1.5, stops: 0, hours: 6.4, fareX: 1.05, seats: 148 },
    ],
    fareY: [160, 340], fareJ: [340, 640], fareX: 1.75,
    cargo: { south: 150, north: 100 },
    ancillary: 20, bagShare: 0.15,
    // [F] BT881 leaves Tallinn at 07:45 and lands at 12:10; BT882 leaves Tenerife at 13:55 and lands at 22:10.
    timetable: { pattern: 'weekly', day: 5, out: 465, back: 835, nights: 0 },
    // [F] EU261: a flight inside the EU pays the middle band whatever its length.
    navPerSector: 5_900, rights: 'open', eu261: 'mid',
    blurb: 'Winter sun, sold as holidays by a tour operator. Six and a half hours: check the aircraft’s range.',
  },
  {
    id: 'TLL-AYT', from: 'TLL', to: 'AYT', city: 'Antalya', country: 'Türkiye',
    models: ['tour', 'own'], model: 'tour',
    // [F] Antalya is three quarters of Tallinn's charter traffic in summer. [E] the passengers.
    odPerYear: 110_000, outShare: 0.5, growth: 0.03,
    season: [0.25, 0.25, 0.4, 0.9, 1.55, 1.7, 1.75, 1.7, 1.7, 1.4, 0.25, 0.15],
    seasonBack: [0.2, 0.25, 0.35, 0.8, 1.45, 1.7, 1.75, 1.75, 1.75, 1.5, 0.35, 0.15],
    segments: { tourism: 0.96, vfr: 0.02, biz: 0.02 },
    competitors: [
      // [F] Pegasus PC5962 on Tuesdays and Saturdays all winter; SunExpress XQ497 in the shoulder months and holidays
      // ([E] 3 a week over the year). [E] the tour operators' own summer charters.
      { name: 'Pegasus', perWeek: 2, stops: 0, hours: 3.8, fareX: 0.85, seats: 189 },
      { name: 'SunExpress', perWeek: 3, stops: 0, hours: 3.8, fareX: 0.95, seats: 189 },
      { name: 'Novatours charters', perWeek: 3, stops: 0, hours: 3.8, fareX: 1.0, seats: 180 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 10, stops: 1, hours: 7, fareX: 1.15, seats: 12, via: 'IST' },
    ],
    fareY: [100, 250], fareJ: [230, 460], fareX: 1.75,
    cargo: { south: 100, north: 300, perish: 200 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 5, out: 375, back: 670, nights: 0 },
    // The way round Belarus and Ukraine (closed to us) is longer than the straight line.
    navPerSector: 3_300, rights: 'open', eu261: 'mid',
    blurb: 'The summer package route, May to October. Pegasus and SunExpress fly it too.',
  },
  {
    id: 'TLL-HRG', from: 'TLL', to: 'HRG', city: 'Hurghada', country: 'Egypt',
    models: ['tour'], model: 'tour',
    // [F] winter charters from Tallinn go to Hurghada and Sharm el-Sheikh, sold only through travel agencies.
    // [E] the passengers.
    odPerYear: 24_000, outShare: 0.5, growth: 0.04,
    season: [1.6, 1.6, 1.6, 1.1, 0.3, 0.2, 0.2, 0.2, 0.3, 1.4, 1.8, 1.7],
    seasonBack: [1.7, 1.6, 1.6, 1.2, 0.3, 0.2, 0.2, 0.2, 0.3, 1.3, 1.8, 1.6],
    segments: { tourism: 0.98, vfr: 0.01, biz: 0.01 },
    competitors: [
      // [E] one or two charters a week in the season, flown for the tour operators (Novatours, Tez Tour).
      { name: 'Tour operators’ charters', perWeek: 0.8, stops: 0, hours: 5.4, fareX: 1.0, seats: 180 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 7, stops: 1, hours: 9.5, fareX: 1.15, seats: 10, via: 'IST' },
    ],
    fareY: [150, 320], fareJ: [320, 580], fareX: 1.75,
    cargo: { south: 100, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 6, out: 450, back: 840, nights: 0 },
    // Round Belarus and Ukraine (closed to us): about 5.5 hours. Over 3,500 km and outside the EU: the long band.
    navPerSector: 4_400, rights: 'bilateral', eu261: 'long', rightsHard: 0.1,
    blurb: 'Red Sea package holidays, October to April. No scheduled airline: a charter series for a tour operator.',
  },
  {
    id: 'TLL-HKT', from: 'TLL', to: 'HKT', city: 'Phuket', country: 'Thailand',
    models: ['tour'], model: 'tour',
    // [E] no long-haul flight leaves the Baltic states: Estonians bound for Thailand go by ferry or a short flight
    // to Helsinki and on with Finnair, or via Istanbul. The Nordic tour operators fly such series from their capitals.
    odPerYear: 14_000, outShare: 0.5, growth: 0.04,
    season: [2.3, 2.3, 1.9, 0.6, 0.1, 0.1, 0.1, 0.1, 0.1, 0.4, 1.7, 2.3],
    seasonBack: [2.4, 2.3, 2.0, 0.8, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3, 1.5, 2.2],
    segments: { tourism: 0.98, vfr: 0.02 },
    competitors: [
      { name: 'Finnair via Helsinki', perWeek: 7, stops: 1, hours: 14, fareX: 1.0, seats: 20, via: 'HEL' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 10, stops: 1, hours: 16.5, fareX: 0.9, seats: 15, via: 'IST' },
    ],
    fareY: [430, 780], fareJ: [1_300, 2_300], fareX: 1.75,
    cargo: { south: 500, north: 1_500, perish: 800 },
    ancillary: 24, bagShare: 0.15,
    timetable: { pattern: 'weekly', day: 5, out: 1_200, back: 840, nights: 1 },
    // Round Russia by Turkey and the Gulf: about 11 hours.
    navPerSector: 9_000, rights: 'perFlight', eu261: 'long', rightsHard: 0.2,
    blurb: 'Needs a widebody. A winter holiday series nobody flies from the Baltics: today all go via Helsinki.',
  },
];
