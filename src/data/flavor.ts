import type { ContinentId } from './regions';

// Fictional rival airlines used for rankings and competitor news.
export const AI_AIRLINES: { name: string; code: string; color: string; continent: ContinentId; paxM: number; fleet: number }[] = [
  { name: 'Aurelia Airways', code: 'AU', color: '#d4a63a', continent: 'EU', paxM: 92, fleet: 410 },
  { name: 'Hanseatic Air', code: 'HN', color: '#2f6bd8', continent: 'EU', paxM: 61, fleet: 280 },
  { name: 'Brightwing', code: 'BW', color: '#ff8a00', continent: 'EU', paxM: 118, fleet: 520 },
  { name: 'Celestia Europe', code: 'CL', color: '#7a5cff', continent: 'EU', paxM: 34, fleet: 170 },
  { name: 'Liberty Pacific', code: 'LP', color: '#d6283c', continent: 'NA', paxM: 165, fleet: 880 },
  { name: 'Northstar Airlines', code: 'NS', color: '#1f4f9c', continent: 'NA', paxM: 142, fleet: 760 },
  { name: 'Sunbelt Air', code: 'SB', color: '#ffb000', continent: 'NA', paxM: 128, fleet: 690 },
  { name: 'Maple Atlantic', code: 'MA', color: '#c01f2f', continent: 'NA', paxM: 44, fleet: 210 },
  { name: 'Andes Sky', code: 'AN', color: '#0f9d76', continent: 'SA', paxM: 58, fleet: 300 },
  { name: 'Amazonia Linhas', code: 'AZ', color: '#2bb34a', continent: 'SA', paxM: 39, fleet: 190 },
  { name: 'Savanna Air', code: 'SV', color: '#c2611f', continent: 'AF', paxM: 14, fleet: 120 },
  { name: 'Sahara Link', code: 'SL', color: '#e2b04a', continent: 'AF', paxM: 9, fleet: 70 },
  { name: 'Falcon Crest Airways', code: 'FC', color: '#8a1538', continent: 'ME', paxM: 54, fleet: 260 },
  { name: 'Oasis Air', code: 'OA', color: '#5c2d91', continent: 'ME', paxM: 38, fleet: 220 },
  { name: 'Lotus Pacific', code: 'LO', color: '#e0457b', continent: 'AS', paxM: 96, fleet: 470 },
  { name: 'Jade Dragon Airlines', code: 'JD', color: '#118a62', continent: 'AS', paxM: 132, fleet: 720 },
  { name: 'Sakura Wings', code: 'SK', color: '#e83b5d', continent: 'AS', paxM: 51, fleet: 250 },
  { name: 'Monsoon Air', code: 'MN', color: '#3a7bd5', continent: 'AS', paxM: 88, fleet: 380 },
  { name: 'Southern Cross Airways', code: 'SC', color: '#c8102e', continent: 'OC', paxM: 47, fleet: 230 },
  { name: 'Kiwi Pacific', code: 'KP', color: '#111111', continent: 'OC', paxM: 17, fleet: 110 },
];

export const LESSORS = ['Skyport Leasing', 'Meridian Aviation Capital', 'Altus Aircraft Finance', 'BlueHorizon Lessors', 'Cirrus Capital', 'Stratos Leasing'];
export const SELLERS = ['a bankrupt carrier', 'a fleet renewal programme', 'a charter operator', 'a leasing company', 'a flag carrier', 'a regional airline', 'an aircraft broker'];

export const LOADING_STEPS = [
  'Loading world map',
  'Filing flight plans',
  'Fuelling aircraft',
  'Briefing cabin crew',
  'Calculating passenger demand',
  'Checking the weather',
  'Clearing for take-off',
];

export const TIPS = [
  'Turboprops shine on routes under 500 km — low fuel burn, quick turnarounds.',
  'Connecting passengers fill your long-haul seats. Feed big routes with short-haul spokes.',
  'Raise fares when load factors hit 95% — spilled passengers are lost revenue.',
  'A common fleet saves money: every extra aircraft family adds training and overhead costs.',
  'Leasing preserves cash; buying builds equity. The best airlines do both.',
  'Check the Event Calendar — the World Cup and Olympics send demand soaring.',
  'Heavy checks restore an aircraft’s condition and reliability. Don’t skip them.',
  'Lie-flat business seats matter on long-haul — on a 45-minute hop, nobody cares.',
  'Reputation grows with comfort, reliability and fair fares. It boosts demand everywhere.',
  'Fuel hedging protects you from price spikes — but you also miss the dips.',
  'A Lounge at your hub makes premium passengers much happier.',
  'High-density cabins carry more people but hurt comfort and reputation.',
  'Watch competitors — very profitable routes attract new entrants.',
  'Fly where the money is: business-heavy cities pay premium fares.',
];

export const AVIATION_FACTS = [
  'At any moment, roughly 10,000 aircraft carrying over a million people are airborne.',
  'The world’s shortest scheduled flight, Westray to Papa Westray in Scotland, lasts about 90 seconds.',
  'Contrails form when hot, humid exhaust meets air colder than −40 °C at cruise altitude.',
  'A Boeing 747 has around six million parts — half of them fasteners.',
  'Jet fuel is about 20–30% of a typical airline’s operating costs.',
  'Airlines measure demand in RPK: revenue passenger kilometres.',
  'An Airbus A380 can hold 320,000 litres of fuel — enough to fill a small swimming pool.',
  'Aircraft are struck by lightning about once a year on average — and fly on safely.',
];
