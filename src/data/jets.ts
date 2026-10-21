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
    types: ['Citation CJ3+', 'Phenom 300E', 'Citation M2'],
    operators: [
      { name: 'GlobeAir', country: 'AT', prefix: 'OE-' },
      { name: 'Jetfly', country: 'LU', prefix: 'LX-' },
      { name: 'Luxaviation', country: 'LU', prefix: 'LX-' },
    ],
  },
  midsize: {
    types: ['Citation XLS+', 'Praetor 500', 'Challenger 350'],
    operators: [
      { name: 'NetJets Europe', country: 'PT', prefix: 'CS-' },
      { name: 'Air Hamburg', country: 'DE', prefix: 'D-' },
      { name: 'VistaJet', country: 'MT', prefix: '9H-' },
    ],
  },
  heavy: {
    types: ['Challenger 650', 'Falcon 2000LXS', 'Legacy 650E', 'Global 6000'],
    operators: [
      { name: 'VistaJet', country: 'MT', prefix: '9H-' },
      { name: 'Luxaviation', country: 'LU', prefix: 'LX-' },
      { name: 'Flexjet', country: 'MT', prefix: '9H-' },
    ],
  },
};

export const JET_CLASSES: JetClass[] = ['light', 'midsize', 'heavy'];
export const JET_CLASS_LABEL: Record<JetClass, string> = { light: 'Light jet', midsize: 'Midsize jet', heavy: 'Heavy jet' };
