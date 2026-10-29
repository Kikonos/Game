// v0.7.1 private jets chartered to position crew (UPDATE-0.7.1.md §4.1): real charter operators and types, names
// only. Prices and performance sit in BAL.crewControl.jet; the quote math in engine/crew/control.ts (jetQuote).

import type { JetClass } from '../engine/core/types';

export interface JetOperator {
  name: string;
  /** ISO country of the AOC (registration prefix below). */
  country: string;
  /** Registration prefix: 'CS-', 'OE-', 'D-', '9H-', 'LX-'. */
  prefix: string;
}

export const JETS: Record<JetClass, { types: string[]; operators: JetOperator[] }> = {
  light: {
    // Jetfly flies Pilatus; a very light Citation M2 would not seat a crew of six with bags.
    types: ['Citation CJ3+', 'Phenom 300E', 'Pilatus PC-24'],
    operators: [
      { name: 'GlobeAir', country: 'AT', prefix: 'OE-' },
      { name: 'Jetfly', country: 'LU', prefix: 'LX-' },
      { name: 'ASL Group', country: 'BE', prefix: 'OO-' },
    ],
  },
  midsize: {
    // Crew-planning round: the super-midsizes charter desks send for a crew of 6–8 (3,000 nm, 460 kt).
    types: ['Praetor 500', 'Challenger 350', 'Citation Longitude'],
    operators: [
      { name: 'NetJets Europe', country: 'PT', prefix: 'CS-' },
      { name: 'Air Hamburg', country: 'DE', prefix: 'D-' },
      { name: 'VistaJet', country: 'MT', prefix: '9H-' },
    ],
  },
  heavy: {
    types: ['Challenger 650', 'Falcon 2000LXS', 'Legacy 650E'],
    operators: [
      { name: 'VistaJet', country: 'MT', prefix: '9H-' },
      { name: 'Luxaviation', country: 'LU', prefix: 'LX-' },
      { name: 'Flexjet', country: 'MT', prefix: '9H-' },
    ],
  },
  long: {
    // Crew-planning round: ultra-long-range jets (6,000+ nm at ~485 kt): an ocean nonstop, no fuel stop.
    types: ['Global 6000', 'Gulfstream G650', 'Falcon 8X'],
    operators: [
      { name: 'VistaJet', country: 'MT', prefix: '9H-' },
      { name: 'TAG Aviation', country: 'MT', prefix: '9H-' },
      { name: 'Luxaviation', country: 'LU', prefix: 'LX-' },
    ],
  },
};

/**
 * Crew-planning round: business-aviation bases a charter jet is sent from (the nearest one positions to the crew).
 * Main airports stand in for the business fields beside them (CDG for Le Bourget, LTN Luton, JFK Teterboro, MIA
 * Opa-locka).
 */
export const JET_BASES: string[] = [
  'LIS', 'MAD', 'BCN', 'NCE', 'CDG', 'LTN', 'GVA', 'ZRH', 'MUC', 'FRA', 'VIE', 'LIN', 'FCO', 'ATH', 'MLA', 'IST', 'TLV',
  'DXB', 'DOH', 'CAI', 'CMN', 'LOS', 'NBO', 'JNB', 'DEL', 'BOM', 'SIN', 'HKG', 'JFK', 'BOS', 'IAD', 'MIA', 'ATL', 'LAX',
  'YYZ', 'MEX', 'CUN', 'SJU', 'PTY', 'GRU',
];

export const JET_CLASSES: JetClass[] = ['light', 'midsize', 'heavy', 'long'];
export const JET_CLASS_LABEL: Record<JetClass, string> = { light: 'Light jet', midsize: 'Midsize jet', heavy: 'Heavy jet', long: 'Long-range jet' };
