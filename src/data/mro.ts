// v0.7.2 C-check hubs (UPDATE-0.7.2.md §7): real heavy-maintenance MROs by rating family. `price` × the C-check
// cost (the hub's price level against a base check). A-checks stay at base / line stations; cabin work at home.

import type { RatingFamily } from './acmiTypes';

export interface CHub {
  code: string;
  /** MRO name ('Lufthansa Technik Sofia'). */
  name: string;
  city: string;
  /** × the C-check cost. */
  price: number;
}

export const C_HUBS: Record<RatingFamily, CHub[]> = {
  A320: [
    { code: 'SOF', name: 'Lufthansa Technik Sofia', city: 'Sofia', price: 0.85 },
    { code: 'MLA', name: 'Lufthansa Technik Malta', city: 'Malta', price: 0.95 },
  ],
  B737: [
    { code: 'BUD', name: 'Aeroplex of Central Europe', city: 'Budapest', price: 0.85 },
    { code: 'SNN', name: 'Atlantic Aviation Group', city: 'Shannon', price: 0.95 },
  ],
  'B757/767': [
    { code: 'MIA', name: 'AAR', city: 'Miami', price: 0.85 },
    { code: 'TLV', name: 'IAI Bedek', city: 'Tel Aviv', price: 0.95 },
  ],
  'A330/340': [
    { code: 'BOD', name: 'Sabena Technics', city: 'Bordeaux', price: 0.9 },
    { code: 'MLA', name: 'Lufthansa Technik Malta', city: 'Malta', price: 0.95 },
  ],
  B777: [
    { code: 'AMM', name: 'Joramco', city: 'Amman', price: 0.8 },
    { code: 'IST', name: 'Turkish Technic', city: 'Istanbul', price: 0.9 },
  ],
  B787: [
    { code: 'IST', name: 'Turkish Technic', city: 'Istanbul', price: 0.9 },
    { code: 'AUH', name: 'Etihad Engineering', city: 'Abu Dhabi', price: 1.0 },
  ],
  A350: [
    { code: 'MNL', name: 'Lufthansa Technik Philippines', city: 'Manila', price: 0.8 },
    { code: 'AUH', name: 'Etihad Engineering', city: 'Abu Dhabi', price: 1.0 },
  ],
  A380: [
    { code: 'MNL', name: 'Lufthansa Technik Philippines', city: 'Manila', price: 0.8 },
    { code: 'AUH', name: 'Etihad Engineering', city: 'Abu Dhabi', price: 1.0 },
  ],
  B747: [{ code: 'IST', name: 'Turkish Technic', city: 'Istanbul', price: 0.9 }],
};

/** The hub record at an airport for a family (undefined: not a hub for it). */
export const cHubAt = (family: RatingFamily, code: string): CHub | undefined => C_HUBS[family].find((h) => h.code === code);
