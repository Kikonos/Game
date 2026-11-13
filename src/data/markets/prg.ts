// Czechia: the researched markets from Prague (PRG) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is PRG (or another airport in Czechia: it then becomes a route base of a game based at PRG). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: PRG itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so PRG's is what a route from another base pays there.
 */
export const PRG_STATIONS: Record<string, RouteStation> = {
  // [F] Prague Airport price list 30 March 2025 to 28 March 2026: CZK 682 a departing passenger (passed on), PRM
  // CZK 15; landing CZK 20,070 + 99 a tonne over 100 t (a 767-300ER: CZK 28,683; an A320: CZK 15,969); no noise
  // charge by day for a modern type. Czechia has no ticket tax. [E] terminal navigation, parking, handling.
  PRG: { code: 'PRG', fuelX: 1.0, airport: 2_300, handling: 4_400, paxCharge: 1.2, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 32 },
  // [F] Antalya: EUR 17 a departing international passenger (the concession's terms). [E] the rest (the row of VNO).
  AYT: { code: 'AYT', fuelX: 1.02, airport: 1_900, handling: 3_400, paxCharge: 1, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 20 },
  // [E] Hurghada: a resort airport, cheap landing. [F] Egypt's own departure fee is only EGP 100 (2026); the airport's
  // passenger charge is the rest. No EU cargo security (ACC3) [E]: no cargo back to the EU.
  HRG: { code: 'HRG', fuelX: 1.05, airport: 1_800, handling: 3_600, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: true, euCargo: false, taxes: 30 },
  // [E] Marsa Alam is a private airport (built and run by the Kharafi group, not the state; not re-checked): dearer
  // landing, one handler, no caterer to our standard: the meals for the way back are loaded in Prague. No EU cargo.
  RMF: { code: 'RMF', fuelX: 1.08, airport: 2_000, handling: 3_800, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: false, euCargo: false, taxes: 30 },
  // [E] Tenerife South (Aena): no ticket tax (the row of VNO and RIX).
  TFS: { code: 'TFS', fuelX: 1.04, airport: 1_700, handling: 4_000, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 12 },
  // [E] Greece's airport development charge (EUR 12 a departing passenger to an EU country, not re-checked) is in
  // the taxes. Heraklion is run by the state, crowded in summer; crosswinds and hills south: category B.
  HER: { code: 'HER', fuelX: 1.05, airport: 1_500, handling: 3_900, paxCharge: 1.5, overhead: 4_000, cat: 'B', caterer: true, euCargo: true, taxes: 22 },
  // [E] Djerba (OACA, the state's airports office): cheap, quiet outside summer. No cargo to the EU.
  DJE: { code: 'DJE', fuelX: 1.08, airport: 1_500, handling: 3_400, paxCharge: 1, overhead: 6_000, cat: 'A', caterer: true, euCargo: false, taxes: 22 },
  // [E] Tel Aviv: dear security and handling; category B for the airspace procedures (the row of VNO).
  TLV: { code: 'TLV', fuelX: 1.05, airport: 3_000, handling: 5_200, paxCharge: 2.0, overhead: 9_000, cat: 'B', caterer: true, euCargo: true, taxes: 32 },
  // [E] Hanoi Noi Bai: passenger service charge USD 25 and security USD 2 on an international ticket.
  HAN: { code: 'HAN', fuelX: 1.02, airport: 2_800, handling: 3_800, paxCharge: 1.5, overhead: 9_000, cat: 'A', caterer: true, euCargo: true, taxes: 27 },
};

/** The catalogue from Prague. */
export const PRG_MARKETS: RouteMarket[] = [
  {
    id: 'PRG-AYT', from: 'PRG', to: 'AYT', city: 'Antalya', country: 'Türkiye',
    models: ['tour', 'own'], model: 'tour',
    // [F] Antalya was Prague's second city after London in August 2025 (1.89 million passengers at the airport that
    // month). [F] 24 to 33 flights a week in summer 2026. [E] the passengers, from the seats.
    odPerYear: 330_000, outShare: 0.5, growth: 0.03,
    season: [0.15, 0.15, 0.3, 0.8, 1.5, 1.8, 1.9, 1.9, 1.75, 1.4, 0.25, 0.1],
    seasonBack: [0.15, 0.15, 0.25, 0.7, 1.4, 1.8, 1.9, 1.95, 1.8, 1.5, 0.3, 0.1],
    segments: { tourism: 0.95, vfr: 0.03, biz: 0.02 },
    competitors: [
      // [F] summer 2026: Smartwings 17 a week, SunExpress 6 to 7, Pegasus 4, Corendon now and then. Here over the
      // year (few flights from November to March). [F] Turkish Airlines flies Prague-Istanbul.
      { name: 'Smartwings', perWeek: 9, stops: 0, hours: 2.9, fareX: 1.0, seats: 189 },
      { name: 'SunExpress', perWeek: 3.5, stops: 0, hours: 2.9, fareX: 0.95, seats: 189 },
      { name: 'Pegasus', perWeek: 2.5, stops: 0, hours: 2.9, fareX: 0.85, seats: 186 },
      { name: 'Corendon Airlines', perWeek: 2, stops: 0, hours: 2.9, fareX: 0.95, seats: 189 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 21, stops: 1, hours: 6, fareX: 1.2, seats: 15, via: 'IST' },
    ],
    // [F] from USD 85 one way (Skyscanner, summer 2026).
    fareY: [85, 230], fareJ: [200, 420],
    cargo: { south: 100, north: 300, perish: 200 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 5, out: 360, back: 650, nights: 0 },
    navPerSector: 2_700, rights: 'open', eu261: 'mid',
    blurb: 'The Czech summer package route, May to October. Smartwings and three Turkish airlines fly it.',
  },
  {
    id: 'PRG-HRG', from: 'PRG', to: 'HRG', city: 'Hurghada', country: 'Egypt',
    models: ['tour', 'own'], model: 'tour',
    // [F] 12 flights a week in April 2026 (Smartwings, Air Cairo, Eurowings). [F] Egypt leads the Czech agencies'
    // autumn and spring bookings and sells all year. [E] the passengers, from the seats.
    odPerYear: 190_000, outShare: 0.5, growth: 0.04,
    season: [1.0, 1.05, 1.1, 1.05, 0.85, 0.8, 0.95, 0.95, 0.9, 1.25, 1.1, 1.0],
    seasonBack: [1.05, 1.0, 1.1, 1.1, 0.85, 0.8, 0.9, 1.0, 0.9, 1.2, 1.15, 0.95],
    segments: { tourism: 0.97, vfr: 0.02, biz: 0.01 },
    competitors: [
      // [F] the three airlines. [E] how the 12 a week split.
      { name: 'Smartwings', perWeek: 6, stops: 0, hours: 4.1, fareX: 1.0, seats: 189 },
      { name: 'Air Cairo', perWeek: 3, stops: 0, hours: 4.1, fareX: 0.85, seats: 186 },
      { name: 'Eurowings', perWeek: 2, stops: 0, hours: 4.1, fareX: 1.0, seats: 180 },
      { name: 'Egyptair via Cairo', perWeek: 4, stops: 1, hours: 7.5, fareX: 1.1, seats: 15, via: 'CAI' },
    ],
    fareY: [120, 290], fareJ: [270, 520],
    cargo: { south: 100, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 6, out: 420, back: 750, nights: 0 },
    navPerSector: 3_700, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Red Sea package holidays, sold all year. Smartwings, Air Cairo and Eurowings: 12 a week.',
  },
  {
    id: 'PRG-RMF', from: 'PRG', to: 'RMF', city: 'Marsa Alam', country: 'Egypt',
    models: ['tour'], model: 'tour',
    // [F] Smartwings is the only airline, 4 to 7 a week in 2026, leaving Prague at 01:10. [E] the passengers.
    odPerYear: 80_000, outShare: 0.5, growth: 0.05,
    season: [0.9, 0.95, 1.0, 1.05, 0.95, 0.9, 1.05, 1.05, 1.0, 1.25, 1.0, 0.9],
    seasonBack: [0.95, 0.9, 1.0, 1.1, 0.95, 0.9, 1.0, 1.1, 1.0, 1.2, 1.05, 0.85],
    segments: { tourism: 0.99, vfr: 0.01 },
    competitors: [
      { name: 'Smartwings', perWeek: 5, stops: 0, hours: 4.4, fareX: 1.0, seats: 189 },
    ],
    // [F] from EUR 170 one way (Skyscanner, September 2026).
    fareY: [130, 300], fareJ: [280, 540],
    cargo: { south: 100, north: 0 },
    ancillary: 18, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 2, out: 70, back: 420, nights: 0 },
    navPerSector: 3_900, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Divers and resort holidays in the far south of Egypt. Only Smartwings flies it, at night.',
  },
  {
    id: 'PRG-TFS', from: 'PRG', to: 'TFS', city: 'Tenerife', country: 'Spain',
    models: ['tour', 'own'], model: 'tour',
    // [F] Eurowings sells 6 Canary flights a week from Prague in winter 2025/26 (Tenerife on Fridays and Sundays),
    // flown with Smartwings, which sells the same flights. [E] the passengers.
    odPerYear: 70_000, outShare: 0.5, growth: 0.03,
    season: [1.4, 1.45, 1.35, 1.0, 0.6, 0.55, 0.75, 0.8, 0.7, 1.1, 1.1, 1.2],
    seasonBack: [1.45, 1.4, 1.35, 1.05, 0.6, 0.55, 0.7, 0.85, 0.7, 1.05, 1.15, 1.15],
    segments: { tourism: 0.93, vfr: 0.04, biz: 0.03 },
    competitors: [
      // [F] Smartwings and Eurowings fly it nonstop; Ryanair does not. [E] frequencies over the year.
      { name: 'Smartwings', perWeek: 2.5, stops: 0, hours: 5.3, fareX: 1.0, seats: 189 },
      { name: 'Eurowings', perWeek: 1.5, stops: 0, hours: 5.3, fareX: 1.0, seats: 180 },
      { name: 'Iberia via Madrid', perWeek: 14, stops: 1, hours: 8.5, fareX: 1.1, seats: 10, via: 'MAD' },
    ],
    fareY: [140, 320], fareJ: [320, 600],
    cargo: { south: 200, north: 100 },
    ancillary: 20, bagShare: 0.15,
    timetable: { pattern: 'weekly', day: 4, out: 450, back: 770, nights: 0 },
    // [F] EU261: a flight inside the EU pays the middle band whatever its length.
    navPerSector: 4_600, rights: 'open', eu261: 'mid',
    blurb: 'Canary winter sun, over 5 hours in a full narrowbody. Smartwings and Eurowings share the flights.',
  },
  {
    id: 'PRG-HER', from: 'PRG', to: 'HER', city: 'Heraklion', country: 'Greece',
    models: ['tour', 'own'], model: 'tour',
    // [F] Greece leads Čedok's summer bookings; Smartwings flies 20 Greek airports from Czechia in summer 2026.
    // [F] Heraklion: 6 a week in May, 13 in July. [E] the passengers.
    odPerYear: 90_000, outShare: 0.5, growth: 0.03,
    season: [0.05, 0.05, 0.05, 0.4, 1.4, 2.1, 2.35, 2.35, 2.0, 1.15, 0.05, 0.05],
    seasonBack: [0.05, 0.05, 0.05, 0.3, 1.3, 2.05, 2.35, 2.4, 2.1, 1.25, 0.05, 0.05],
    segments: { tourism: 0.96, vfr: 0.02, biz: 0.02 },
    competitors: [
      // [F] Smartwings is the only nonstop airline (Eurowings sells its seats). Over the year: none in winter.
      // [F] Aegean through Athens: 18 a week in August, 5 to 6 hours.
      { name: 'Smartwings', perWeek: 4.5, stops: 0, hours: 2.9, fareX: 1.0, seats: 189 },
      { name: 'Aegean via Athens', perWeek: 9, stops: 1, hours: 5.5, fareX: 1.15, seats: 15, via: 'ATH' },
    ],
    // [F] from USD 117 one way (Expedia, 2026).
    fareY: [90, 240], fareJ: [210, 440],
    cargo: { south: 100, north: 200, perish: 200 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 0, out: 330, back: 615, nights: 0 },
    navPerSector: 2_500, rights: 'open', eu261: 'mid',
    blurb: 'Crete, the Czechs’ favourite Greek island. Summer only: nothing flies from November to March.',
  },
  {
    id: 'PRG-DJE', from: 'PRG', to: 'DJE', city: 'Djerba', country: 'Tunisia',
    models: ['tour'], model: 'tour',
    // [F] Smartwings: 3 a week in June 2026, the only airline. [F] Tunisia is on the Czech agencies' summer list but
    // its sales swing with the news. [E] the passengers.
    odPerYear: 40_000, outShare: 0.5, growth: 0.02,
    season: [0.05, 0.05, 0.1, 0.6, 1.4, 2.0, 2.2, 2.2, 1.9, 1.3, 0.15, 0.05],
    seasonBack: [0.05, 0.05, 0.1, 0.5, 1.3, 1.95, 2.2, 2.25, 2.0, 1.4, 0.15, 0.05],
    segments: { tourism: 0.97, vfr: 0.02, biz: 0.01 },
    competitors: [
      // Over the year: 3 a week from May to October.
      { name: 'Smartwings', perWeek: 1.5, stops: 0, hours: 2.8, fareX: 1.0, seats: 189 },
    ],
    fareY: [95, 240], fareJ: [210, 430],
    cargo: { south: 100, north: 0 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 3, out: 840, back: 1_005, nights: 0 },
    navPerSector: 2_300, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Beach packages, cheaper than Greece. One rival, 3 a week in summer. Sales swing with the news.',
  },
  {
    id: 'PRG-TLV', from: 'PRG', to: 'TLV', city: 'Tel Aviv', country: 'Israel',
    models: ['own', 'tour'], model: 'own',
    // [F] El Al, Smartwings, Israir, Arkia (5 a week) and TUS Airways: 14 to 30 flights a week in 2026.
    // [E] the passengers: Israeli city breaks in Prague, Czech pilgrim groups, business, students of medicine.
    odPerYear: 280_000, outShare: 0.5, growth: 0.04,
    season: [0.7, 0.7, 0.85, 1.2, 1.0, 1.1, 1.3, 1.4, 1.2, 1.2, 0.7, 0.65],
    seasonBack: [0.7, 0.7, 0.85, 1.2, 1.0, 1.1, 1.3, 1.4, 1.2, 1.2, 0.7, 0.65],
    segments: { tourism: 0.62, vfr: 0.12, biz: 0.18, students: 0.08 },
    competitors: [
      // [F] the airlines. [E] the split, on about 19 a week.
      { name: 'El Al', perWeek: 7, stops: 0, hours: 3.7, fareX: 1.15, seats: 166 },
      { name: 'Arkia', perWeek: 5, stops: 0, hours: 3.7, fareX: 0.95, seats: 174 },
      { name: 'Smartwings', perWeek: 4, stops: 0, hours: 3.7, fareX: 1.0, seats: 189 },
      { name: 'Israir', perWeek: 3, stops: 0, hours: 3.7, fareX: 0.95, seats: 174 },
    ],
    fareY: [120, 300], fareJ: [300, 600],
    cargo: { south: 500, north: 500, mail: 100 },
    ancillary: 22, bagShare: 0.25,
    timetable: { pattern: 'weekly', day: 3, out: 540, back: 885, nights: 0 },
    // The route closes when the war flares (airlines left Tel Aviv for months in 2024 and 2025).
    navPerSector: 3_400, risk: { coup: 0.15 }, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Israelis on city breaks and Czech pilgrims. Four rivals, fares hold. Stops when the war flares.',
  },
  {
    id: 'PRG-HAN', from: 'PRG', to: 'HAN', city: 'Hanoi', country: 'Vietnam',
    models: ['own', 'tour'], model: 'own',
    // [F] over 75,000 passengers flew Prague-Hanoi in 2025, all through a hub: Vietnam was Prague's biggest market
    // with no flight of its own. [F] nearly 70,000 Vietnamese citizens live in Czechia.
    odPerYear: 75_000, outShare: 0.5, growth: 0.06,
    // Home for Tet (January, February) and the summer; Czech tourists in winter.
    season: [1.4, 1.2, 0.9, 0.8, 0.8, 1.05, 1.2, 0.9, 0.75, 0.8, 1.0, 1.2],
    seasonBack: [0.9, 1.4, 1.2, 0.9, 0.8, 0.9, 0.95, 1.3, 1.1, 0.8, 0.85, 0.9],
    segments: { vfr: 0.62, tourism: 0.2, biz: 0.12, students: 0.06 },
    competitors: [
      // [F] Vietjet since 10 October 2026: twice a week (Tuesday, Saturday) in an A330, with a fuel stop in Almaty.
      // [E] the hubs' seats for this market.
      { name: 'Vietjet via Almaty', perWeek: 2, stops: 1, hours: 14.5, fareX: 0.8, seats: 300 },
      { name: 'Qatar Airways via Doha', perWeek: 14, stops: 1, hours: 17, fareX: 1.0, seats: 25, via: 'DOH' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 16, fareX: 0.95, seats: 20, via: 'IST' },
      { name: 'Emirates via Dubai', perWeek: 7, stops: 1, hours: 17.5, fareX: 1.05, seats: 20, via: 'DXB' },
    ],
    fareY: [380, 760], fareJ: [1_300, 2_400],
    // [E] Vietnamese food and textiles for the SAPA market in Prague north; machinery and parts south.
    cargo: { south: 1_500, north: 3_000, mail: 100, perish: 500 },
    ancillary: 28, bagShare: 0.45,
    timetable: { pattern: 'weekly', day: 4, out: 780, back: 1_380, nights: 1 },
    // [F] an EU airline may not fly over Russia: we go round by Turkey, the Caspian and India.
    navPerSector: 8_500, rights: 'bilateral', eu261: 'long', rightsHard: 0.3,
    blurb: 'Needs a widebody. 70,000 Vietnamese in Czechia; Vietjet flies twice a week with a fuel stop.',
  },
];
