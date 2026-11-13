// Bulgaria: the researched markets from Sofia (SOF) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is SOF (or another airport in Bulgaria: it then becomes a route base of a game based at SOF). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.
// The fares here are net: what a passenger pays us, off-peak to peak. The engine reads catalogue fares as
// published ones and sells under them (BAL.v019.fares.scale 0.57), so each market carries `fareX: 1.75` (1 / 0.57)
// unless tuned (a balance step: scripts/netcal.ts).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: SOF itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so SOF's is what a route from another base pays there.
 */
export const SOF_STATIONS: Record<string, RouteStation> = {
  // [F] Sofia passed 8 million passengers for the first time in December 2025; run by SOF Connect (a concession).
  // [F] old figures only: EUR 7.27 a departing international passenger in 2021 (EUR 11.66 asked for), about EUR 13
  // of airport taxes on a ticket. Bulgaria has no ticket tax. [E] today's charges, landing, handling.
  SOF: { code: 'SOF', fuelX: 1.0, airport: 1_800, handling: 3_500, paxCharge: 1.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 20 },
  // [F] UK Air Passenger Duty: GBP 15 in economy from April 2026 (short-haul band). [E] Stansted (the row of TLL).
  STN: { code: 'STN', fuelX: 1.0, airport: 2_400, handling: 4_600, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
  // [E] Germany's aviation tax (EUR 13 to 15.50 a passenger to Europe, not re-checked) and Frankfurt's dear
  // passenger and security charges are in the taxes; slots are hard to get at the hours that sell.
  FRA: { code: 'FRA', fuelX: 1.0, airport: 4_200, handling: 5_600, paxCharge: 2.5, overhead: 8_000, cat: 'A', caterer: true, euCargo: true, taxes: 56 },
  // [E] Madrid (Aena): no ticket tax (the row of MAD.ts.txt).
  MAD: { code: 'MAD', fuelX: 1.0, airport: 2_900, handling: 4_800, paxCharge: 1.5, overhead: 8_000, cat: 'A', caterer: true, euCargo: true, taxes: 26 },
  // [F] Italy's municipal surcharge (EUR 6.50 a departing passenger) is in the taxes. [E] Malpensa's charges.
  MXP: { code: 'MXP', fuelX: 1.02, airport: 2_600, handling: 4_600, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 30 },
  // [E] Tel Aviv: dear security and handling; category B for the airspace procedures (the row of VNO).
  TLV: { code: 'TLV', fuelX: 1.05, airport: 3_000, handling: 5_200, paxCharge: 2.0, overhead: 9_000, cat: 'B', caterer: true, euCargo: true, taxes: 32 },
  // [E] Hurghada: a resort airport, cheap landing. No EU cargo security (ACC3): no cargo back to the EU.
  HRG: { code: 'HRG', fuelX: 1.05, airport: 1_800, handling: 3_600, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: true, euCargo: false, taxes: 30 },
  // [F] Antalya: EUR 17 a departing international passenger (the concession's terms). [E] the rest (the row of VNO).
  AYT: { code: 'AYT', fuelX: 1.02, airport: 1_900, handling: 3_400, paxCharge: 1, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 20 },
  // [E] Chicago O'Hare: landing fee by weight plus the international terminal; US taxes and fees (the row of VNO).
  ORD: { code: 'ORD', fuelX: 0.95, airport: 6_500, handling: 6_800, paxCharge: 5.0, overhead: 13_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
};

/** The catalogue from Sofia. */
export const SOF_MARKETS: RouteMarket[] = [
  {
    id: 'SOF-STN', from: 'SOF', to: 'STN', city: 'London', country: 'United Kingdom',
    models: ['own'], model: 'own',
    // [F] London was Sofia's first destination in every month of 2025. [F] 52 flights a week in October 2026 over
    // four London airports. [F] about 259,000 Bulgarians lived in Great Britain in 2020. [E] the passengers.
    odPerYear: 800_000, outShare: 0.5, growth: 0.02,
    season: [0.95, 0.8, 0.9, 1.0, 1.0, 1.05, 1.15, 1.2, 1.05, 0.95, 0.85, 1.1],
    seasonBack: [0.9, 0.8, 0.9, 1.05, 1.0, 1.05, 1.2, 1.15, 1.0, 0.95, 0.85, 1.15],
    segments: { vfr: 0.58, tourism: 0.2, biz: 0.14, students: 0.08 },
    competitors: [
      // [F] flights a week in autumn 2026: Ryanair 16 to 20 (Stansted), Wizz Air 12 (Luton), easyJet 7 (Gatwick),
      // British Airways and Bulgaria Air 5 each (Heathrow).
      { name: 'Ryanair', perWeek: 18, stops: 0, hours: 3.3, fareX: 0.75, seats: 189 },
      { name: 'Wizz Air', perWeek: 12, stops: 0, hours: 3.3, fareX: 0.75, seats: 230 },
      { name: 'easyJet', perWeek: 7, stops: 0, hours: 3.3, fareX: 0.9, seats: 186 },
      { name: 'British Airways', perWeek: 5, stops: 0, hours: 3.3, fareX: 1.4, seats: 180 },
      { name: 'Bulgaria Air', perWeek: 5, stops: 0, hours: 3.3, fareX: 1.25, seats: 143 },
    ],
    // [F] from EUR 39 to 43 one way (Skyscanner, 2026).
    fareY: [50, 160], fareJ: [150, 360], fareX: 1.75,
    cargo: { south: 500, north: 600, mail: 200 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 4, out: 420, back: 550, nights: 0 },
    navPerSector: 2_900, rights: 'open', eu261: 'mid',
    blurb: 'Sofia’s biggest route: Bulgarians in Britain. Five rivals, about 50 flights a week, low fares.',
  },
  {
    id: 'SOF-FRA', from: 'SOF', to: 'FRA', city: 'Frankfurt', country: 'Germany',
    models: ['own'], model: 'own',
    // [F] Germany has the most Bulgarians abroad: 371,000 to 437,000 (2023-24). [F] Frankfurt was in Sofia's top five
    // in September 2025. [E] the passengers who start or end in Frankfurt (half of Lufthansa's change planes there).
    odPerYear: 170_000, outShare: 0.5, growth: 0.01,
    season: [0.9, 0.85, 0.95, 1.0, 1.0, 1.05, 1.15, 1.15, 1.05, 1.0, 0.9, 1.0],
    segments: { vfr: 0.48, biz: 0.32, tourism: 0.14, students: 0.06 },
    competitors: [
      // [F] April 2026: Lufthansa 19 a week, Bulgaria Air 3. [E] Lufthansa's seats for local passengers.
      { name: 'Lufthansa', perWeek: 19, stops: 0, hours: 2.4, fareX: 1.15, seats: 90 },
      { name: 'Bulgaria Air', perWeek: 3, stops: 0, hours: 2.4, fareX: 1.0, seats: 110 },
    ],
    fareY: [90, 260], fareJ: [260, 560], fareX: 1.4, // tuned: Lufthansa's hub route: a newcomer sells under it
    cargo: { south: 600, north: 500, mail: 200 },
    ancillary: 22, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 0, out: 1_050, back: 1_180, nights: 0 },
    navPerSector: 2_100, rights: 'open', eu261: 'mid',
    blurb: 'Bulgarians in Germany and business. Lufthansa flies it 19 a week and holds the fares up.',
  },
  {
    id: 'SOF-MAD', from: 'SOF', to: 'MAD', city: 'Madrid', country: 'Spain',
    models: ['own'], model: 'own',
    // [F] about 122,000 Bulgarians live in Spain (151,000 at the peak, 2009). [F] 13 to 28 flights a week in 2026.
    // [E] the passengers.
    odPerYear: 240_000, outShare: 0.5, growth: 0.02,
    season: [0.85, 0.8, 0.9, 1.0, 1.0, 1.1, 1.25, 1.3, 1.05, 0.95, 0.8, 1.0],
    segments: { vfr: 0.6, tourism: 0.24, biz: 0.1, students: 0.06 },
    competitors: [
      // [F] Wizz Air, Ryanair and Bulgaria Air fly it nonstop. [E] the split, on 15 a week.
      { name: 'Wizz Air', perWeek: 6, stops: 0, hours: 3.6, fareX: 0.75, seats: 230 },
      { name: 'Ryanair', perWeek: 5, stops: 0, hours: 3.6, fareX: 0.75, seats: 189 },
      { name: 'Bulgaria Air', perWeek: 4, stops: 0, hours: 3.6, fareX: 1.2, seats: 143 },
    ],
    // [F] from EUR 52 one way (Skyscanner, 2026).
    fareY: [60, 190], fareJ: [180, 420], fareX: 1.75,
    cargo: { south: 400, north: 400, mail: 100 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 810, back: 1_020, nights: 0 },
    navPerSector: 3_000, rights: 'open', eu261: 'mid',
    blurb: 'Bulgarians in Spain, heavy bags, summer and Christmas peaks. Three rivals, two of them low-cost.',
  },
  {
    id: 'SOF-MXP', from: 'SOF', to: 'MXP', city: 'Milan', country: 'Italy',
    models: ['own'], model: 'own',
    // [F] Milan was in Sofia's top five in March and September 2025; over 56,000 Bulgarians live in Italy.
    // [F] 19 to 22 flights a week to Bergamo; Bulgaria Air flies Malpensa in season. [E] the passengers.
    odPerYear: 340_000, outShare: 0.5, growth: 0.03,
    season: [0.9, 0.85, 0.95, 1.05, 1.0, 1.05, 1.15, 1.15, 1.05, 1.0, 0.85, 1.0],
    segments: { vfr: 0.38, tourism: 0.36, biz: 0.2, students: 0.06 },
    competitors: [
      // [F] Ryanair and Wizz Air use Bergamo. [E] their split. [F] Bulgaria Air: twice a week from March.
      { name: 'Ryanair (Bergamo)', perWeek: 12, stops: 0, hours: 2.1, fareX: 0.7, seats: 189 },
      { name: 'Wizz Air (Bergamo)', perWeek: 9, stops: 0, hours: 2.1, fareX: 0.7, seats: 230 },
      { name: 'Bulgaria Air', perWeek: 1.5, stops: 0, hours: 2.1, fareX: 1.2, seats: 143 },
    ],
    // [F] from EUR 27 one way (Skyscanner, 2026).
    fareY: [45, 150], fareJ: [150, 340], fareX: 1.75,
    cargo: { south: 400, north: 500, mail: 100 },
    ancillary: 22, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 1, out: 390, back: 505, nights: 0 },
    navPerSector: 1_800, rights: 'open', eu261: 'mid',
    blurb: 'Two hours. The low-cost airlines fly Bergamo; Malpensa has only Bulgaria Air, twice a week.',
  },
  {
    id: 'SOF-TLV', from: 'SOF', to: 'TLV', city: 'Tel Aviv', country: 'Israel',
    models: ['own', 'tour'], model: 'own',
    // [F] Tel Aviv was Sofia's second destination in March 2025. [F] 25 to 28 flights a week in 2026, six airlines.
    // [E] the passengers: Israelis on ski, spa and city trips, Bulgarian Jews' families, business.
    odPerYear: 380_000, outShare: 0.5, growth: 0.04,
    season: [1.0, 1.05, 1.0, 1.1, 0.9, 0.95, 1.15, 1.25, 1.05, 1.05, 0.7, 0.8],
    segments: { tourism: 0.6, vfr: 0.18, biz: 0.17, students: 0.05 },
    competitors: [
      // [F] the airlines; Bulgaria Air is daily. [E] the others' split.
      { name: 'Bulgaria Air', perWeek: 7, stops: 0, hours: 2.5, fareX: 1.05, seats: 143 },
      { name: 'Wizz Air', perWeek: 7, stops: 0, hours: 2.5, fareX: 0.75, seats: 230 },
      { name: 'El Al', perWeek: 5, stops: 0, hours: 2.5, fareX: 1.15, seats: 166 },
      { name: 'Israir', perWeek: 4, stops: 0, hours: 2.5, fareX: 0.95, seats: 174 },
      { name: 'Arkia', perWeek: 3, stops: 0, hours: 2.5, fareX: 0.95, seats: 174 },
    ],
    fareY: [80, 230], fareJ: [220, 480], fareX: 1.55, // tuned: five rivals: a newcomer sells under them
    cargo: { south: 400, north: 400, mail: 100 },
    ancillary: 22, bagShare: 0.25,
    timetable: { pattern: 'weekly', day: 3, out: 600, back: 810, nights: 0 },
    // The route closes when the war flares.
    navPerSector: 2_000, risk: { coup: 0.15 }, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Israelis come to ski, to the spas and to the city. Six rivals. Stops when the war flares.',
  },
  {
    id: 'SOF-HRG', from: 'SOF', to: 'HRG', city: 'Hurghada', country: 'Egypt',
    models: ['tour', 'own'], model: 'tour',
    // [F] Bulgaria Air flies the tour operators' charters to Hurghada and Sharm el-Sheikh; Wizz Air starts Hurghada
    // twice a week on 27 October 2026. [E] the passengers.
    odPerYear: 50_000, outShare: 0.5, growth: 0.05,
    // Bulgarians keep the summer for their own coast: Egypt sells from October to April.
    season: [1.2, 1.2, 1.3, 1.3, 0.9, 0.5, 0.4, 0.4, 0.7, 1.5, 1.4, 1.2],
    seasonBack: [1.25, 1.2, 1.3, 1.35, 0.9, 0.5, 0.4, 0.4, 0.65, 1.4, 1.45, 1.2],
    segments: { tourism: 0.98, vfr: 0.01, biz: 0.01 },
    competitors: [
      // [E] frequencies over the year. [F] European Air Charter flew it in 2023.
      { name: 'Bulgaria Air charters', perWeek: 1.5, stops: 0, hours: 2.9, fareX: 1.0, seats: 180 },
      { name: 'Wizz Air', perWeek: 1, stops: 0, hours: 2.9, fareX: 0.8, seats: 230 },
      { name: 'European Air Charter', perWeek: 0.5, stops: 0, hours: 2.9, fareX: 1.0, seats: 180 },
    ],
    fareY: [110, 260], fareJ: [240, 460], fareX: 1.39, // tuned: flown in its season only, when fares sit at the top of the range
    cargo: { south: 100, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 5, out: 360, back: 600, nights: 0 },
    navPerSector: 2_300, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Red Sea package holidays, October to April, under 3 hours. Wizz Air now sells seats too.',
  },
  {
    id: 'SOF-AYT', from: 'SOF', to: 'AYT', city: 'Antalya', country: 'Türkiye',
    models: ['tour', 'own'], model: 'tour',
    // [F] SunExpress and Pegasus fly it, 2 to 7 a week in the season; charters besides. [E] the passengers.
    odPerYear: 70_000, outShare: 0.5, growth: 0.03,
    season: [0.1, 0.1, 0.25, 0.9, 1.6, 1.8, 1.85, 1.8, 1.8, 1.5, 0.2, 0.1],
    seasonBack: [0.1, 0.1, 0.2, 0.8, 1.5, 1.8, 1.85, 1.85, 1.8, 1.6, 0.3, 0.1],
    segments: { tourism: 0.95, vfr: 0.03, biz: 0.02 },
    competitors: [
      // [E] frequencies over the year. [F] Turkish Airlines flies Sofia-Istanbul.
      { name: 'SunExpress', perWeek: 1.5, stops: 0, hours: 1.7, fareX: 1.0, seats: 189 },
      { name: 'Pegasus', perWeek: 1, stops: 0, hours: 1.7, fareX: 0.9, seats: 186 },
      { name: 'Bulgaria Air charters', perWeek: 1.5, stops: 0, hours: 1.7, fareX: 1.0, seats: 180 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 21, stops: 1, hours: 4.5, fareX: 1.15, seats: 15, via: 'IST' },
    ],
    // [F] from USD 69 one way (Skyscanner, 2026).
    fareY: [70, 200], fareJ: [170, 360], fareX: 1.13, // tuned: flown in its season only, when fares sit at the top of the range
    cargo: { south: 100, north: 200, perish: 200 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 1, out: 900, back: 1_080, nights: 0 },
    navPerSector: 1_000, rights: 'open', eu261: 'mid',
    blurb: 'Summer packages, an hour and a half away: two or three rotations a day for one aircraft.',
  },
  {
    id: 'SOF-ORD', from: 'SOF', to: 'ORD', city: 'Chicago', country: 'United States',
    models: ['own', 'tour'], model: 'own',
    // [F] Chicago is the first US city from Bulgaria: almost 17,800 passengers one way a year (New York 16,300), all
    // through a hub. [F] GullivAir holds the US permit and announced New York and Chicago for April 2026; no flight
    // yet. [E] the market once a nonstop brings in the rest of the Midwest.
    odPerYear: 50_000, outShare: 0.5, growth: 0.03,
    season: [0.55, 0.5, 0.65, 0.85, 1.15, 1.5, 1.7, 1.6, 1.15, 0.85, 0.6, 0.9],
    seasonBack: [0.6, 0.5, 0.65, 0.85, 1.15, 1.5, 1.6, 1.7, 1.15, 0.85, 0.6, 0.85],
    segments: { vfr: 0.6, tourism: 0.2, biz: 0.14, students: 0.06 },
    competitors: [
      // [F] the hubs these airlines link to both Sofia and Chicago. [E] seats they give this market.
      { name: 'Lufthansa via Frankfurt', perWeek: 14, stops: 1, hours: 14, fareX: 1.0, seats: 20, via: 'FRA' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 15, fareX: 0.85, seats: 20, via: 'IST' },
      { name: 'Austrian via Vienna', perWeek: 7, stops: 1, hours: 13.5, fareX: 0.95, seats: 15, via: 'VIE' },
      { name: 'LOT via Warsaw', perWeek: 7, stops: 1, hours: 14, fareX: 0.9, seats: 15, via: 'WAW' },
    ],
    fareY: [430, 900], fareJ: [1_500, 2_900], fareX: 1.5, // tuned: long haul: the range reads as published fares
    cargo: { south: 2_000, north: 2_000, mail: 200 },
    ancillary: 30, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 630, back: 1_020, nights: 1 },
    navPerSector: 6_400, rights: 'open', eu261: 'long', rightsHard: 0.2,
    blurb: 'Needs a widebody and US permits. Bulgarians of Chicago: nobody flies Bulgaria to America nonstop.',
  },
];
