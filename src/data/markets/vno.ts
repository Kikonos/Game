// Lithuania: the researched markets from Vilnius (VNO) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is VNO (or another airport in Lithuania: it then becomes a route base of a game based at VNO). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station another base's file lists too is
// repeated here with the same numbers (the first file's row is the one used).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: VNO itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so VNO's is what a route from another base pays there.
 */
export const VNO_STATIONS: Record<string, RouteStation> = {
  // [F] Lithuanian Airports, from 1 January 2026: landing EUR 8.74 a tonne (a 767: about $1,900), departing passenger
  // EUR 10.21, no parking charge under 3 hours. Lithuania has no ticket tax. [E] terminal navigation, handling.
  VNO: { code: 'VNO', fuelX: 1.0, airport: 2_300, handling: 3_600, paxCharge: 0.8, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 13 },
  // [F] UK Air Passenger Duty: GBP 15 a passenger in economy from April 2026 (short-haul band). [E] Luton's charges.
  // Luton's runway is 2,160 m: fine for a narrowbody, limiting for a widebody.
  LTN: { code: 'LTN', fuelX: 1.0, airport: 2_400, handling: 4_600, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
  // [E] Dublin: no ticket tax; the airport's passenger charge is capped by the regulator.
  DUB: { code: 'DUB', fuelX: 1.0, airport: 2_600, handling: 4_800, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 14 },
  // [E] Oslo: Norway's air passenger tax and Avinor's passenger and security charges; handling is dear.
  OSL: { code: 'OSL', fuelX: 1.03, airport: 2_600, handling: 5_200, paxCharge: 2.0, overhead: 6_500, cat: 'A', caterer: true, euCargo: true, taxes: 24 },
  // [E] Tenerife South (Aena): no ticket tax.
  TFS: { code: 'TFS', fuelX: 1.04, airport: 1_700, handling: 4_000, paxCharge: 1.2, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 12 },
  // [E] Antalya: built for charters, cheap and quick to turn.
  AYT: { code: 'AYT', fuelX: 1.02, airport: 1_900, handling: 3_400, paxCharge: 1, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 20 },
  // [E] Tbilisi: 495 m up with high ground around: category B.
  TBS: { code: 'TBS', fuelX: 1.08, airport: 1_800, handling: 3_400, paxCharge: 1, overhead: 6_000, cat: 'B', caterer: true, euCargo: true, taxes: 25 },
  // [E] Tel Aviv: security procedures of its own (category B, a briefing), dear to turn.
  TLV: { code: 'TLV', fuelX: 1.05, airport: 3_000, handling: 5_200, paxCharge: 2.0, overhead: 9_000, cat: 'B', caterer: true, euCargo: true, taxes: 32 },
  // [E] Chicago O'Hare: landing fee by weight plus terminal use; US taxes and fees on an international ticket.
  ORD: { code: 'ORD', fuelX: 0.95, airport: 6_500, handling: 6_800, paxCharge: 5.0, overhead: 13_000, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
};

/** The catalogue from Vilnius. */
export const VNO_MARKETS: RouteMarket[] = [
  {
    id: 'VNO-LTN', from: 'VNO', to: 'LTN', city: 'London', country: 'United Kingdom',
    models: ['own'], model: 'own',
    // [F] London is Vilnius's first destination (Luton first, Stansted third in February 2025); 35 flights a week.
    // [F] 164,000 people born in Lithuania live in England and Wales (census 2021). [E] the passengers, from the seats.
    odPerYear: 620_000, outShare: 0.5, growth: 0.02,
    // Families: summer and Christmas.
    season: [0.9, 0.8, 0.9, 1.0, 1.0, 1.05, 1.2, 1.2, 1.0, 0.95, 0.85, 1.15],
    seasonBack: [0.95, 0.8, 0.9, 1.0, 1.0, 1.05, 1.15, 1.25, 1.0, 0.95, 0.85, 1.1],
    segments: { vfr: 0.6, tourism: 0.18, biz: 0.15, students: 0.07 },
    competitors: [
      // [F] Ryanair (Stansted and Luton) and Wizz Air (Luton) are the only two since LOT left London City in March 2026.
      // [E] the split of the 35 a week.
      { name: 'Ryanair', perWeek: 21, stops: 0, hours: 2.9, fareX: 0.75, seats: 189 },
      { name: 'Wizz Air', perWeek: 14, stops: 0, hours: 2.9, fareX: 0.75, seats: 230 },
    ],
    // [F] airBaltic sells London-Vilnius (via Riga) from EUR 90 one way. [E] the nonstop fares.
    fareY: [55, 170], fareJ: [150, 380],
    cargo: { south: 500, north: 600, mail: 200 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 4, out: 420, back: 525, nights: 0 },
    navPerSector: 2_500, rights: 'open', eu261: 'mid',
    blurb: 'The biggest route from Vilnius: Lithuanian families in England. Ryanair and Wizz Air, 35 a week.',
  },
  {
    id: 'VNO-DUB', from: 'VNO', to: 'DUB', city: 'Dublin', country: 'Ireland',
    models: ['own'], model: 'own',
    // [F] 36,552 Lithuanians in Ireland (census 2016); Dublin is in Vilnius's top ten. [E] the passengers.
    odPerYear: 95_000, outShare: 0.5, growth: 0.01,
    season: [0.9, 0.75, 0.85, 1.0, 0.95, 1.1, 1.25, 1.25, 0.95, 0.9, 0.85, 1.25],
    seasonBack: [1.0, 0.75, 0.85, 1.0, 0.95, 1.05, 1.2, 1.3, 0.95, 0.9, 0.85, 1.2],
    segments: { vfr: 0.7, tourism: 0.12, biz: 0.12, students: 0.06 },
    competitors: [
      // [F] Ryanair is the only nonstop (3 h 20; also from Kaunas). [E] 5 a week. [F] airBaltic via Riga from EUR 93.
      { name: 'Ryanair', perWeek: 5, stops: 0, hours: 3.3, fareX: 0.8, seats: 189 },
      { name: 'airBaltic via Riga', perWeek: 2, stops: 1, hours: 6, fareX: 1.1, seats: 20, via: 'RIX' },
    ],
    fareY: [70, 200], fareJ: [180, 420],
    cargo: { south: 300, north: 400, mail: 100 },
    ancillary: 24, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 5, out: 600, back: 765, nights: 0 },
    navPerSector: 2_900, rights: 'open', eu261: 'mid',
    blurb: 'Lithuanians in Ireland. Ryanair is the only nonstop. Peaks in summer and at Christmas.',
  },
  {
    id: 'VNO-OSL', from: 'VNO', to: 'OSL', city: 'Oslo', country: 'Norway',
    models: ['own'], model: 'own',
    // [F] Oslo is in Vilnius's top ten; 14 flights a week in May 2026, 23 in October. [E] Lithuanians are one of
    // Norway's largest immigrant groups (about 40,000: building, fish plants, shipyards).
    odPerYear: 260_000, outShare: 0.5, growth: 0.02,
    // Workers on rotation: flat, with Christmas, Easter and the July holiday (fellesferie).
    season: [1.0, 0.85, 0.95, 1.05, 0.95, 1.0, 1.15, 1.05, 0.95, 0.95, 0.9, 1.2],
    seasonBack: [1.1, 0.85, 0.95, 1.0, 0.95, 1.0, 1.05, 1.15, 0.95, 0.95, 0.9, 1.15],
    segments: { vfr: 0.62, biz: 0.2, tourism: 0.15, students: 0.03 },
    competitors: [
      // [F] Norwegian and Ryanair fly it (Ryanair added flights in 2026). [E] the split. [F] from EUR 32 one way.
      { name: 'Norwegian', perWeek: 9, stops: 0, hours: 1.8, fareX: 0.9, seats: 186 },
      { name: 'Ryanair', perWeek: 9, stops: 0, hours: 1.8, fareX: 0.75, seats: 189 },
    ],
    fareY: [50, 150], fareJ: [140, 330],
    cargo: { south: 200, north: 500, perish: 400 },
    ancillary: 22, bagShare: 0.35,
    timetable: { pattern: 'weekly', day: 6, out: 1_020, back: 1_110, nights: 0 },
    navPerSector: 1_500, rights: 'open', eu261: 'mid',
    blurb: 'Lithuanians working in Norway, home every few weeks. Norwegian and Ryanair. Steady all year.',
  },
  {
    id: 'VNO-TFS', from: 'VNO', to: 'TFS', city: 'Tenerife', country: 'Spain',
    models: ['tour', 'own'], model: 'tour',
    // [E] Lithuania's winter sun: package holidays from November to April, 6 hours in a full narrowbody.
    odPerYear: 55_000, outShare: 0.5, growth: 0.04,
    season: [1.55, 1.6, 1.5, 0.9, 0.3, 0.25, 0.3, 0.3, 0.35, 1.25, 1.75, 1.95],
    seasonBack: [1.75, 1.6, 1.55, 1.0, 0.3, 0.25, 0.3, 0.3, 0.3, 1.1, 1.7, 1.85],
    segments: { tourism: 0.93, vfr: 0.04, biz: 0.03 },
    competitors: [
      // [F] airBaltic: 3 a week in winter, scheduled (A220-300). [F] GetJet Airlines flies Tez Tour's charters
      // (Tenerife is one) under a long-term deal from November 2025. [E] the charter frequency, over the year.
      { name: 'airBaltic', perWeek: 1.5, stops: 0, hours: 6.3, fareX: 1.05, seats: 148 },
      { name: 'Tez Tour (GetJet Airlines)', perWeek: 1, stops: 0, hours: 6.3, fareX: 1.0, seats: 180 },
    ],
    fareY: [150, 330], fareJ: [330, 620],
    cargo: { south: 200, north: 100 },
    ancillary: 20, bagShare: 0.15,
    timetable: { pattern: 'weekly', day: 5, out: 420, back: 795, nights: 0 },
    // [F] EU261: a flight inside the EU pays the middle band whatever its length.
    navPerSector: 5_600, rights: 'open', eu261: 'mid',
    blurb: 'Winter sun, sold as holidays by a tour operator. Six hours each way; nearly nothing in summer.',
  },
  {
    id: 'VNO-AYT', from: 'VNO', to: 'AYT', city: 'Antalya', country: 'Türkiye',
    models: ['tour'], model: 'tour',
    // [F] Antalya is the first charter destination from Vilnius; no scheduled airline flies it (summer 2026).
    // [E] the passengers.
    odPerYear: 190_000, outShare: 0.5, growth: 0.03,
    season: [0.1, 0.1, 0.25, 0.9, 1.6, 1.8, 1.85, 1.8, 1.8, 1.5, 0.2, 0.1],
    seasonBack: [0.1, 0.1, 0.2, 0.8, 1.5, 1.8, 1.85, 1.85, 1.8, 1.6, 0.3, 0.1],
    segments: { tourism: 0.97, vfr: 0.02, biz: 0.01 },
    competitors: [
      // [F] Tez Tour's flights are GetJet's; Novaturas is the other big Lithuanian tour operator. [E] frequencies,
      // over the year (daily and more from May to October). [F] Turkish Airlines flies Vilnius-Istanbul.
      { name: 'Tez Tour (GetJet Airlines)', perWeek: 5, stops: 0, hours: 3.4, fareX: 1.0, seats: 180 },
      { name: 'Novaturas charters', perWeek: 4, stops: 0, hours: 3.4, fareX: 1.0, seats: 180 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 6.5, fareX: 1.15, seats: 15, via: 'IST' },
    ],
    fareY: [95, 240], fareJ: [220, 450],
    cargo: { south: 100, north: 300, perish: 200 },
    ancillary: 16, bagShare: 0.12,
    timetable: { pattern: 'weekly', day: 5, out: 360, back: 630, nights: 0 },
    // The way round Belarus and Ukraine (closed to us) is longer than the straight line.
    navPerSector: 2_700, rights: 'open', eu261: 'mid',
    blurb: 'The summer package route, May to October. Charters only: sold as a series to a tour operator.',
  },
  {
    id: 'VNO-TBS', from: 'VNO', to: 'TBS', city: 'Tbilisi', country: 'Georgia',
    models: ['own'], model: 'own',
    // [F] no airline flies Vilnius-Tbilisi (summer 2026); Wizz Air flies to Kutaisi, 230 km and 3.5 hours by road
    // from Tbilisi. [E] the market: tourism both ways, business, students, Georgians working in Lithuania.
    odPerYear: 45_000, outShare: 0.5, growth: 0.06,
    season: [0.7, 0.65, 0.8, 1.0, 1.2, 1.2, 1.25, 1.25, 1.3, 1.15, 0.75, 0.75],
    seasonBack: [0.7, 0.65, 0.8, 1.0, 1.15, 1.2, 1.25, 1.3, 1.3, 1.15, 0.75, 0.75],
    segments: { tourism: 0.45, vfr: 0.2, biz: 0.2, gov: 0.08, students: 0.07 },
    competitors: [
      { name: 'Wizz Air to Kutaisi, then by road', perWeek: 3, stops: 1, hours: 8, fareX: 0.6, seats: 60 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 7, fareX: 1.0, seats: 15, via: 'IST' },
      { name: 'LOT via Warsaw', perWeek: 7, stops: 1, hours: 6, fareX: 1.0, seats: 12, via: 'WAW' },
      // [F] airBaltic Riga-Tbilisi: 2 a week.
      { name: 'airBaltic via Riga', perWeek: 2, stops: 1, hours: 5.5, fareX: 1.05, seats: 20, via: 'RIX' },
    ],
    fareY: [140, 300], fareJ: [330, 620],
    // [E] Georgian wine and mineral water north.
    cargo: { south: 400, north: 600, mail: 100, perish: 200 },
    ancillary: 22, bagShare: 0.3,
    timetable: { pattern: 'weekly', day: 3, out: 1_290, back: 300, nights: 0 },
    // Round by Poland, Romania and Turkey: about 4 hours, not the 3 of the straight line.
    navPerSector: 3_400, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'No nonstop to the capital: Wizz Air only reaches Kutaisi, 3.5 hours away by road. Night flight.',
  },
  {
    id: 'VNO-TLV', from: 'VNO', to: 'TLV', city: 'Tel Aviv', country: 'Israel',
    models: ['own', 'tour'], model: 'own',
    // [F] three airlines and charters in summer 2026. [E] the market: Israeli city breaks and roots travel
    // (Vilnius was the "Jerusalem of the North"), Israeli medical students in Kaunas, technology business.
    odPerYear: 90_000, outShare: 0.4, growth: 0.04,
    season: [0.7, 0.7, 0.85, 1.2, 1.0, 1.1, 1.3, 1.4, 1.2, 1.2, 0.7, 0.65],
    seasonBack: [0.7, 0.7, 0.85, 1.2, 1.0, 1.1, 1.3, 1.4, 1.2, 1.2, 0.7, 0.65],
    segments: { tourism: 0.5, vfr: 0.22, biz: 0.18, students: 0.1 },
    competitors: [
      // [F] Wizz Air, Arkia and Israir (seasonal) fly it. [E] frequencies.
      { name: 'Wizz Air', perWeek: 3, stops: 0, hours: 4.2, fareX: 0.75, seats: 230 },
      { name: 'Arkia', perWeek: 2, stops: 0, hours: 4.2, fareX: 1.0, seats: 174 },
      { name: 'Israir', perWeek: 1, stops: 0, hours: 4.2, fareX: 1.0, seats: 174 },
    ],
    fareY: [110, 280], fareJ: [280, 560],
    cargo: { south: 300, north: 300, mail: 50 },
    ancillary: 22, bagShare: 0.25,
    timetable: { pattern: 'weekly', day: 6, out: 600, back: 930, nights: 0 },
    // [F] airBaltic stopped Tel Aviv for the winter of 2024/25 and came back: the route closes when the war flares.
    navPerSector: 3_500, risk: { coup: 0.15 }, rights: 'bilateral', eu261: 'mid', rightsHard: 0.1,
    blurb: 'Israeli visitors, roots travel and students. Three rivals. Flights stop when the war flares.',
  },
  {
    id: 'VNO-ORD', from: 'VNO', to: 'ORD', city: 'Chicago', country: 'United States',
    models: ['own', 'tour'], model: 'own',
    // [E] Chicago is the capital of Lithuanian America (about 650,000 Americans of Lithuanian descent, the largest
    // community around Chicago). No airline flies Lithuania to North America nonstop.
    odPerYear: 55_000, outShare: 0.5, growth: 0.03,
    season: [0.55, 0.5, 0.65, 0.85, 1.15, 1.5, 1.7, 1.6, 1.15, 0.85, 0.6, 0.9],
    seasonBack: [0.6, 0.5, 0.65, 0.85, 1.15, 1.5, 1.6, 1.7, 1.15, 0.85, 0.6, 0.85],
    segments: { vfr: 0.55, tourism: 0.25, biz: 0.15, students: 0.05 },
    competitors: [
      // [F] the hubs these airlines link to both Vilnius and Chicago. [E] seats they give this market.
      { name: 'LOT via Warsaw', perWeek: 9, stops: 1, hours: 13, fareX: 0.9, seats: 25, via: 'WAW' },
      { name: 'SAS via Copenhagen', perWeek: 7, stops: 1, hours: 13.5, fareX: 0.95, seats: 15, via: 'CPH' },
      { name: 'Lufthansa via Frankfurt', perWeek: 14, stops: 1, hours: 14, fareX: 1.0, seats: 15, via: 'FRA' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 17, fareX: 0.8, seats: 10, via: 'IST' },
    ],
    fareY: [420, 880], fareJ: [1_500, 2_900],
    // [E] lasers and electronics out, e-commerce and general cargo back.
    cargo: { south: 2_000, north: 2_000, mail: 200 },
    ancillary: 30, bagShare: 0.35,
    timetable: { pattern: 'weekly', day: 5, out: 660, back: 1_050, nights: 1 },
    navPerSector: 6_000, rights: 'open', eu261: 'long', rightsHard: 0.2,
    blurb: 'Needs a widebody and US permits. The Lithuanian community of Chicago; today all go via a hub.',
  },
];
