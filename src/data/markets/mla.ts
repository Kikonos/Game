// Malta: the researched markets from Malta (MLA) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is MLA (or another airport in Malta: it then becomes a route base of a game based at MLA). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station another base's file lists too is
// repeated here with the same numbers (the first file's row is the one used).

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: MLA itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so MLA's is what a route from another base pays there.
 */
export const MLA_STATIONS: Record<string, RouteStation> = {
  // [F] MIA tariff: passenger service charge EUR 15.84, PRM EUR 0.40 a departing passenger; night landings +25 %. [E] the rest.
  MLA: { code: 'MLA', fuelX: 1.03, airport: 1_800, handling: 4_000, paxCharge: 0.5, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 24 },
  // [E] UK Air Passenger Duty (short-haul band) and Manchester's passenger charge are passed on.
  MAN: { code: 'MAN', fuelX: 1.0, airport: 2_600, handling: 4_800, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 42 },
  GLA: { code: 'GLA', fuelX: 1.02, airport: 2_000, handling: 4_300, paxCharge: 2.0, overhead: 5_000, cat: 'A', caterer: true, euCargo: true, taxes: 38 },
  // [E] Mitiga: a joint military field, one handler paid in cash, fuel supply unreliable (tanker from Malta). No ACC3: no cargo to the EU.
  MJI: { code: 'MJI', fuelX: 1.2, airport: 2_200, handling: 4_800, paxCharge: 1, overhead: 12_000, cat: 'B', caterer: false, euCargo: false, taxes: 30 },
  BEN: { code: 'BEN', fuelX: 1.2, airport: 2_000, handling: 4_600, paxCharge: 1, overhead: 12_000, cat: 'B', caterer: false, euCargo: false, taxes: 30 },
  // [E] Catania: category B for the Etna ash procedures. [F] Italy's municipal surcharge (EUR 6.50) is in the taxes.
  CTA: { code: 'CTA', fuelX: 1.02, airport: 1_700, handling: 3_800, paxCharge: 1.5, overhead: 4_000, cat: 'B', caterer: true, euCargo: true, taxes: 26 },
  CPH: { code: 'CPH', fuelX: 1.0, airport: 2_400, handling: 4_800, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 30 },
  // [E] Tarbes-Lourdes: built for pilgrim charters (3,000 m, stretcher and wheelchair handling), mountains close by: category B.
  // No caterer: meals for the way back are loaded in Malta. [F] France's ticket solidarity tax is EUR 7.40 within Europe since March 2025.
  LDE: { code: 'LDE', fuelX: 1.05, airport: 1_500, handling: 3_600, paxCharge: 3.0, overhead: 3_000, cat: 'B', caterer: false, euCargo: true, taxes: 35 },
  // [E] JFK: landing fee by weight plus terminal use; US taxes and fees on an international ticket.
  JFK: { code: 'JFK', fuelX: 0.95, airport: 7_500, handling: 7_000, paxCharge: 6.0, overhead: 14_000, cat: 'B', caterer: true, euCargo: true, taxes: 40 },
};

/** The catalogue from Malta. */
export const MLA_MARKETS: RouteMarket[] = [
  {
    id: 'MLA-MAN', from: 'MLA', to: 'MAN', city: 'Manchester', country: 'United Kingdom',
    models: ['tour', 'own'], model: 'tour',
    // [F] the UK is Malta's first market: 20 % of 10.06 million airport passengers in 2025, 841,397 tourists.
    // [E] Manchester's part, from 16-20 flights a week.
    odPerYear: 250_000, outShare: 0.5, growth: 0.04,
    // [F] Malta's airport: 709,000 passengers in December, over a million in August, 560,000 in February.
    season: [0.65, 0.7, 0.85, 1.0, 1.1, 1.15, 1.25, 1.3, 1.2, 1.1, 0.85, 0.85],
    seasonBack: [0.65, 0.7, 0.85, 1.0, 1.1, 1.15, 1.25, 1.3, 1.2, 1.1, 0.85, 0.85],
    segments: { tourism: 0.72, vfr: 0.15, biz: 0.08, students: 0.05 },
    competitors: [
      // [F] Ryanair 6 and Jet2 4 a week (April 2026), 16-20 in all with easyJet.
      { name: 'Ryanair', perWeek: 6, stops: 0, hours: 3.6, fareX: 0.75, seats: 189 },
      { name: 'easyJet', perWeek: 6, stops: 0, hours: 3.6, fareX: 0.85, seats: 186 },
      { name: 'Jet2.com', perWeek: 4, stops: 0, hours: 3.6, fareX: 1.0, seats: 189 },
    ],
    fareY: [75, 200], fareJ: [190, 420],
    cargo: { south: 300, north: 400, mail: 100 },
    ancillary: 20, bagShare: 0.2,
    timetable: { pattern: 'weekly', day: 5, out: 600, back: 815, nights: 0 },
    navPerSector: 3_600, rights: 'open', eu261: 'mid',
    blurb: 'Malta’s biggest market. Ryanair, easyJet and Jet2 fly it: low fares.',
  },
  {
    id: 'MLA-GLA', from: 'MLA', to: 'GLA', city: 'Glasgow', country: 'United Kingdom',
    models: ['tour', 'own'], model: 'tour',
    odPerYear: 70_000, outShare: 0.5, growth: 0.05,
    season: [0.5, 0.55, 0.75, 1.0, 1.2, 1.25, 1.4, 1.45, 1.3, 1.15, 0.75, 0.7],
    seasonBack: [0.5, 0.55, 0.75, 1.0, 1.2, 1.25, 1.4, 1.45, 1.3, 1.15, 0.75, 0.7],
    segments: { tourism: 0.8, vfr: 0.12, biz: 0.05, students: 0.03 },
    competitors: [
      // [F] Ryanair twice a week since April 2025, Jet2 twice a week, easyJet new for summer 2026 ([E] twice a week).
      { name: 'Ryanair', perWeek: 2, stops: 0, hours: 4.0, fareX: 0.75, seats: 189 },
      { name: 'Jet2.com', perWeek: 2, stops: 0, hours: 4.0, fareX: 1.0, seats: 189 },
      { name: 'easyJet', perWeek: 2, stops: 0, hours: 4.0, fareX: 0.85, seats: 186 },
    ],
    fareY: [85, 220], fareJ: [210, 450],
    cargo: { south: 200, north: 300 },
    ancillary: 20, bagShare: 0.2,
    timetable: { pattern: 'weekly', day: 2, out: 600, back: 840, nights: 0 },
    navPerSector: 4_100, rights: 'open', eu261: 'mid',
    blurb: 'Scotland: thin, three airlines at 2 a week each. Summer heavy.',
  },
  {
    id: 'MLA-MJI', from: 'MLA', to: 'MJI', city: 'Tripoli', country: 'Libya',
    models: ['own'], model: 'own',
    // [F] 34,621 Libyan visitors to Malta in 2013; 3,600 Libyan residents in Malta (2017). [E] today's flows, held down by visas.
    odPerYear: 60_000, outShare: 0.5, growth: 0.05,
    segments: { biz: 0.35, vfr: 0.25, tourism: 0.15, gov: 0.12, ngo: 0.08, students: 0.05 },
    competitors: [
      // [F] Medsky Airways BM310/311, 2-3 a week, flown by Malta MedAir (every Libyan airline is on the EU ban list,
      // Reg. (EU) 2026/1317). [F] Libyan Express twice a week from 22 June 2026, a 737-400.
      { name: 'Medsky Airways (Malta MedAir)', perWeek: 3, stops: 0, hours: 1.0, fareX: 1.0, seats: 180 },
      { name: 'Libyan Express', perWeek: 2, stops: 0, hours: 1.0, fareX: 0.95, seats: 150 },
      { name: 'Turkish Airlines via Istanbul', perWeek: 7, stops: 1, hours: 7.5, fareX: 1.1, seats: 15, via: 'IST' },
    ],
    // [F] Skyscanner: Mitiga-Malta from EUR 472 return.
    fareY: [190, 330], fareJ: [420, 650],
    // [E] parts, medicines and courier south; nothing north (no EU cargo security at Mitiga).
    cargo: { south: 1_500, north: 0, mail: 100 },
    ancillary: 28, bagShare: 0.4,
    timetable: { pattern: 'weekly', day: 3, out: 540, back: 690, nights: 0 },
    navPerSector: 600, risk: { coup: 0.1, fx: 0.25 }, rights: 'bilateral', eu261: 'mid', rightsHard: 0.3,
    blurb: '55 minutes. Libyan airlines are banned from the EU, so fares are high. War risk.',
  },
  {
    id: 'MLA-BEN', from: 'MLA', to: 'BEN', city: 'Benghazi', country: 'Libya',
    models: ['partner', 'own'], model: 'partner', partner: { name: 'Medsky Airways', code: 'BM', country: 'LY' },
    // [F] Medsky started Benghazi-Malta weekly (BM330) on Malta MedAir's certificate; it also wet-leases from other
    // operators (Marathon Airlines). [E] the market, with those who go round by Tunis, Istanbul or Cairo.
    odPerYear: 18_000, outShare: 0.5, growth: 0.06,
    segments: { biz: 0.4, vfr: 0.25, gov: 0.1, ngo: 0.1, tourism: 0.1, students: 0.05 },
    competitors: [
      { name: 'Turkish Airlines via Istanbul', perWeek: 4, stops: 1, hours: 8, fareX: 1.0, seats: 12, via: 'IST' },
      { name: 'EgyptAir via Cairo', perWeek: 5, stops: 1, hours: 9, fareX: 0.95, seats: 10, via: 'CAI' },
    ],
    fareY: [200, 340], fareJ: [430, 680],
    cargo: { south: 1_200, north: 0, mail: 50 },
    ancillary: 28, bagShare: 0.4,
    // [F] the first flight left Benina at 09:15 and landed in Malta at 10:45.
    timetable: { pattern: 'weekly', day: 3, out: 420, back: 615, nights: 0 },
    navPerSector: 900, risk: { coup: 0.08, fx: 0.25 }, rights: 'partner', eu261: 'mid',
    blurb: 'Flown for Medsky Airways (Libyan airlines are on the EU ban list). Weekly, no other nonstop.',
  },
  {
    id: 'MLA-CTA', from: 'MLA', to: 'CTA', city: 'Catania', country: 'Italy',
    models: ['own'], model: 'own',
    // [F] Italy: 20 % of Malta's airport passengers, 583,323 tourists in 2025. [E] Catania's part, from about 25 flights a week.
    odPerYear: 240_000, outShare: 0.5, growth: 0.01,
    season: [0.75, 0.75, 0.9, 1.05, 1.05, 1.1, 1.25, 1.35, 1.1, 1.0, 0.8, 0.9],
    seasonBack: [0.75, 0.75, 0.9, 1.05, 1.05, 1.1, 1.25, 1.35, 1.1, 1.0, 0.8, 0.9],
    segments: { vfr: 0.4, tourism: 0.35, biz: 0.2, students: 0.05 },
    competitors: [
      // [F] Ryanair 2-4 departures a day; KM Malta Airlines 7 a week but only July to September
      // ("commercially unviable" in winter): 2 a week over the year. [F] KM: 168 seats a flight.
      { name: 'Ryanair', perWeek: 18, stops: 0, hours: 0.8, fareX: 0.75, seats: 189 },
      { name: 'KM Malta Airlines', perWeek: 2, stops: 0, hours: 0.8, fareX: 1.1, seats: 168 },
    ],
    fareY: [35, 95], fareJ: [90, 200],
    cargo: { south: 300, north: 600, mail: 150, perish: 300 },
    ancillary: 14, bagShare: 0.25,
    timetable: { pattern: 'weekly', day: 4, out: 420, back: 510, nights: 0 },
    navPerSector: 400, rights: 'open', eu261: 'mid',
    blurb: '45 minutes to Sicily. Ryanair 2 to 4 a day at very low fares; KM flies it in summer only.',
  },
  {
    id: 'MLA-CPH', from: 'MLA', to: 'CPH', city: 'Copenhagen', country: 'Denmark',
    models: ['tour', 'own'], model: 'tour',
    // [E] from 8 flights a week [F, February 2026] and the Nordic tour operators' Malta programmes.
    odPerYear: 95_000, outShare: 0.5, growth: 0.05,
    // Nordic sun season: spring and autumn as strong as summer.
    season: [0.6, 0.7, 0.9, 1.1, 1.2, 1.15, 1.3, 1.2, 1.2, 1.25, 0.8, 0.6],
    seasonBack: [0.6, 0.7, 0.9, 1.1, 1.2, 1.15, 1.3, 1.2, 1.2, 1.25, 0.8, 0.6],
    segments: { tourism: 0.8, biz: 0.1, vfr: 0.07, students: 0.03 },
    competitors: [
      // [F] Norwegian and SAS, 8 a week between them ([E] the split). Norwegian adds Billund weekly from June 2026.
      { name: 'Norwegian', perWeek: 4, stops: 0, hours: 3.3, fareX: 0.85, seats: 186 },
      { name: 'SAS', perWeek: 4, stops: 0, hours: 3.3, fareX: 1.05, seats: 180 },
    ],
    fareY: [95, 230], fareJ: [230, 480],
    cargo: { south: 200, north: 300 },
    ancillary: 20, bagShare: 0.2,
    timetable: { pattern: 'weekly', day: 6, out: 540, back: 795, nights: 0 },
    navPerSector: 3_400, rights: 'open', eu261: 'mid',
    blurb: 'Nordic sun seekers, strongest in spring and autumn. Norwegian and SAS, 8 a week.',
  },
  {
    id: 'MLA-LDE', from: 'MLA', to: 'LDE', city: 'Lourdes', country: 'France',
    models: ['tour'], model: 'tour',
    // [F] the Order of Malta's Maltese pilgrimage alone: 364 people at the start of May, on KM charter flights.
    // [F] Air Malta flew Lourdes twice a week in summer 2018. [E] the year's total.
    odPerYear: 9_000, outShare: 0.5, growth: 0.01,
    // Pilgrimage season April to October; May (the Order's pilgrimage), 15 August, 8 December.
    season: [0.1, 0.2, 0.4, 1.2, 2.2, 1.4, 1.5, 1.9, 1.4, 1.1, 0.2, 0.4],
    seasonBack: [0.1, 0.2, 0.4, 1.2, 2.2, 1.4, 1.5, 1.9, 1.4, 1.1, 0.2, 0.4],
    segments: { tourism: 0.95, vfr: 0.05 },
    competitors: [
      // [F] KM Malta Airlines flies the pilgrim charters (KM80 on 5 December 2026, 07:00). [E] the one-stop.
      { name: 'KM Malta Airlines charters', perWeek: 0.25, stops: 0, hours: 2.3, fareX: 1.1, seats: 168 },
      { name: 'Ryanair via London Stansted', perWeek: 3, stops: 1, hours: 9, fareX: 0.8, seats: 10, via: 'STN' },
    ],
    fareY: [130, 190], fareJ: [260, 380],
    cargo: { south: 0, north: 0 },
    ancillary: 8, bagShare: 0.1,
    timetable: { pattern: 'weekly', day: 3, out: 420, back: 600, nights: 0 },
    navPerSector: 2_300, rights: 'open', eu261: 'mid',
    blurb: 'Pilgrim groups, April to October. Sold as a series to the pilgrimage organisers.',
  },
  {
    id: 'MLA-JFK', from: 'MLA', to: 'JFK', city: 'New York', country: 'United States',
    models: ['own', 'tour'], model: 'own',
    // [E] US visitors to Malta and the Maltese community of New York, with connections over JFK.
    odPerYear: 70_000, outShare: 0.5, growth: 0.06,
    season: [0.4, 0.4, 0.6, 0.9, 1.3, 1.5, 1.6, 1.6, 1.5, 1.2, 0.5, 0.5],
    seasonBack: [0.4, 0.4, 0.6, 0.9, 1.3, 1.5, 1.6, 1.6, 1.5, 1.2, 0.5, 0.5],
    segments: { tourism: 0.6, vfr: 0.25, biz: 0.12, students: 0.03 },
    competitors: [
      // [F] Delta: the first US-Malta nonstop, 3 a week on a 767-300ER, 7 June to 23 October 2026 (summer only).
      { name: 'Delta Air Lines', perWeek: 3, stops: 0, hours: 10.2, fareX: 1.05, seats: 211 },
      { name: 'Lufthansa via Frankfurt', perWeek: 14, stops: 1, hours: 14, fareX: 0.9, seats: 20, via: 'FRA' },
      { name: 'Turkish Airlines via Istanbul', perWeek: 14, stops: 1, hours: 15.5, fareX: 0.8, seats: 15, via: 'IST' },
      { name: 'ITA Airways via Rome', perWeek: 7, stops: 1, hours: 13.5, fareX: 0.9, seats: 15, via: 'FCO' },
    ],
    fareY: [420, 850], fareJ: [1_500, 2_900],
    // [E] Maltese pharmaceuticals and electronics out, general cargo back.
    cargo: { south: 2_500, north: 2_000, mail: 200 },
    ancillary: 30, bagShare: 0.2,
    timetable: { pattern: 'weekly', day: 5, out: 690, back: 1_290, nights: 1 },
    navPerSector: 5_500, rights: 'open', eu261: 'long', rightsHard: 0.2,
    blurb: 'Needs a widebody and US permits. Delta flies it 3 a week, in summer only.',
  },
];
