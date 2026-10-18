import type { AircraftType } from './aircraft';
import { isWidebody } from './aircraft';

export type CabinClass = 'F' | 'J' | 'W' | 'Y';
export const CLASSES: CabinClass[] = ['F', 'J', 'W', 'Y'];

export const CLASS_NAME: Record<CabinClass, string> = {
  F: 'First',
  J: 'Business',
  W: 'Premium Economy',
  Y: 'Economy',
};

// Validated as a colour-blind-safe categorical set on the dark UI surface (order Y, W, J, F).
export const CLASS_COLOR: Record<CabinClass, string> = {
  F: '#c98500',
  J: '#9085e9',
  W: '#199e70',
  Y: '#3987e5',
};

export interface SeatProduct {
  id: string;
  cls: CabinClass;
  name: string;
  desc: string;
  /** Passenger comfort score 0–100. */
  comfort: number;
  /** Installation cost per seat in USD. */
  seatCost: number;
  /** Extra cabin length (inches) used by galleys/lavatories for this section. */
  overhead: number;
  available: (t: AircraftType) => boolean;
  abreast: (t: AircraftType) => number;
  pitch: (t: AircraftType) => number;
}

const wide = isWidebody;
const notProp = (t: AircraftType) => t.body !== 'turboprop';

export const SEAT_PRODUCTS: SeatProduct[] = [
  {
    id: 'y_dense', cls: 'Y', name: 'High-Density', desc: 'Slimline seats at 28" pitch. Maximum seats, minimum legroom.',
    comfort: 28, seatCost: 1500, overhead: 0,
    available: () => true,
    abreast: (t) => t.yAbreastMax,
    pitch: () => 28,
  },
  {
    id: 'y_std', cls: 'Y', name: 'Standard', desc: 'Industry-standard economy: 30" short-haul, 31" on widebodies.',
    comfort: 50, seatCost: 2500, overhead: 0,
    available: () => true,
    abreast: (t) => t.yAbreast,
    pitch: (t) => (wide(t) ? 31 : 30),
  },
  {
    id: 'y_plus', cls: 'Y', name: 'Spacious', desc: 'Generous 33" pitch economy with adjustable headrests.',
    comfort: 64, seatCost: 3500, overhead: 0,
    available: () => true,
    abreast: (t) => t.yAbreast,
    pitch: () => 33,
  },
  {
    id: 'w_std', cls: 'W', name: 'Premium Economy', desc: 'Wider recliner seats, 38" pitch, upgraded meals and priority boarding.',
    comfort: 74, seatCost: 15000, overhead: 10,
    available: (t) => notProp(t) && t.body !== 'regional' && t.body !== 'supersonic',
    abreast: (t) => (wide(t) ? Math.max(6, t.yAbreast - 2) : Math.max(4, t.yAbreast - 2)),
    pitch: (t) => (wide(t) ? 38 : 36),
  },
  {
    id: 'j_euro', cls: 'J', name: 'Euro Business', desc: 'Economy seats with the middle seat blocked. Flexible and cheap.',
    comfort: 52, seatCost: 3000, overhead: 0,
    available: (t) => !wide(t) && t.yAbreast >= 5 && t.body !== 'supersonic',
    abreast: (t) => t.yAbreast - 2,
    pitch: () => 31,
  },
  {
    id: 'j_recliner', cls: 'J', name: 'Recliner', desc: 'Large leather recliners — the classic domestic first / regional business seat.',
    comfort: 64, seatCost: 25000, overhead: 25,
    available: (t) => notProp(t),
    abreast: (t) => (wide(t) ? Math.max(6, t.yAbreast - 2) : t.yAbreast >= 5 || t.body === 'supersonic' ? 4 : 3),
    pitch: (t) => (wide(t) ? 42 : 38),
  },
  {
    id: 'j_angled', cls: 'J', name: 'Angled Lie-Flat', desc: 'Older-style 2-2-2 angled flat seat. Cheaper, but no direct aisle access.',
    comfort: 74, seatCost: 60000, overhead: 25,
    available: (t) => wide(t),
    abreast: () => 6,
    pitch: () => 60,
  },
  {
    id: 'j_flat', cls: 'J', name: 'Lie-Flat', desc: 'Fully flat beds with direct aisle access (1-2-1 on widebodies, 2-2 on narrowbodies).',
    comfort: 86, seatCost: 120000, overhead: 30,
    available: (t) => wide(t) || !!t.flatBedNarrow || t.body === 'supersonic',
    abreast: () => 4,
    pitch: (t) => (wide(t) ? 48 : 60),
  },
  {
    id: 'j_suite', cls: 'J', name: 'Business Suite', desc: 'Closing-door private suites. The gold standard of modern business class.',
    comfort: 95, seatCost: 220000, overhead: 30,
    available: (t) => wide(t),
    abreast: () => 4,
    pitch: () => 54,
  },
  {
    id: 'f_first', cls: 'F', name: 'First Class', desc: 'Spacious 1-2-1 open first-class seats with fine dining.',
    comfort: 92, seatCost: 350000, overhead: 40,
    available: (t) => wide(t),
    abreast: () => 4,
    pitch: () => 78,
  },
  {
    id: 'f_suite', cls: 'F', name: 'First Suite', desc: 'Enclosed 1-1-1 suites with a separate bed. Ultimate luxury.',
    comfort: 100, seatCost: 600000, overhead: 50,
    available: (t) => wide(t) && t.yAbreast >= 9,
    abreast: () => 3,
    pitch: () => 84,
  },
];

export const SEAT_PRODUCT_BY_ID: Record<string, SeatProduct> = Object.fromEntries(SEAT_PRODUCTS.map((p) => [p.id, p]));

export function seatProduct(id: string): SeatProduct {
  const p = SEAT_PRODUCT_BY_ID[id];
  if (!p) throw new Error(`Unknown seat product ${id}`);
  return p;
}

export function productsFor(t: AircraftType, cls: CabinClass): SeatProduct[] {
  return SEAT_PRODUCTS.filter((p) => p.cls === cls && p.available(t));
}

/** Seat grouping across aisles, used for drawing seat maps. */
export function seatGroups(abreast: number, widebody: boolean): number[] {
  switch (abreast) {
    case 2: return [1, 1];
    case 3: return widebody ? [1, 1, 1] : [1, 2];
    case 4: return widebody ? [1, 2, 1] : [2, 2];
    case 5: return [2, 3];
    case 6: return widebody ? [2, 2, 2] : [3, 3];
    case 7: return [2, 3, 2];
    case 8: return [2, 4, 2];
    case 9: return [3, 3, 3];
    case 10: return [3, 4, 3];
    case 11: return [3, 5, 3];
    default: return [abreast];
  }
}
