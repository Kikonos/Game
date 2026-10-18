import type { AircraftType } from '../data/aircraft';
import { isWidebody } from '../data/aircraft';
import { CLASSES, type CabinClass, productsFor, seatProduct } from '../data/seats';

export interface CabinSection {
  product: string;
  rows: number;
}

/** A cabin layout: at most one section per class. */
export type CabinConfig = Partial<Record<CabinClass, CabinSection>>;

export type Seats = Record<CabinClass, number>;

export const zeroSeats = (): Seats => ({ F: 0, J: 0, W: 0, Y: 0 });

export function sectionSeats(t: AircraftType, s: CabinSection | undefined): number {
  if (!s || s.rows <= 0) return 0;
  return s.rows * seatProduct(s.product).abreast(t);
}

export function sectionLength(t: AircraftType, s: CabinSection | undefined): number {
  if (!s || s.rows <= 0) return 0;
  const p = seatProduct(s.product);
  return s.rows * p.pitch(t) + p.overhead;
}

export function cabinSeats(t: AircraftType, c: CabinConfig): Seats {
  const out = zeroSeats();
  for (const cls of CLASSES) out[cls] = sectionSeats(t, c[cls]);
  return out;
}

export function totalSeats(s: Seats): number {
  return s.F + s.J + s.W + s.Y;
}

export function cabinLengthUsed(t: AircraftType, c: CabinConfig): number {
  return CLASSES.reduce((sum, cls) => sum + sectionLength(t, c[cls]), 0);
}

export interface CabinValidation {
  ok: boolean;
  seats: Seats;
  total: number;
  lengthUsed: number;
  errors: string[];
}

export function validateCabin(t: AircraftType, c: CabinConfig): CabinValidation {
  const seats = cabinSeats(t, c);
  const total = totalSeats(seats);
  const lengthUsed = cabinLengthUsed(t, c);
  const errors: string[] = [];
  for (const cls of CLASSES) {
    const s = c[cls];
    if (!s) continue;
    const p = seatProduct(s.product);
    if (p.cls !== cls) errors.push(`${p.name} cannot be used in this cabin.`);
    if (!p.available(t)) errors.push(`${p.name} seats do not fit the ${t.name}.`);
    if (s.rows < 0 || !Number.isInteger(s.rows)) errors.push('Invalid row count.');
  }
  if (lengthUsed > t.cabinLength) errors.push('Cabin is too long for this fuselage — remove some rows.');
  if (total > t.maxSeats) errors.push(`Exceeds the certified exit limit of ${t.maxSeats} seats.`);
  if (total < 1) errors.push('The aircraft needs at least one seat.');
  return { ok: errors.length === 0, seats, total, lengthUsed, errors };
}

/** Maximum rows a section can have given the rest of the cabin. */
export function maxRowsFor(t: AircraftType, c: CabinConfig, cls: CabinClass, productId: string): number {
  const p = seatProduct(productId);
  const others: CabinConfig = { ...c };
  delete others[cls];
  const freeLength = t.cabinLength - cabinLengthUsed(t, others) - p.overhead;
  const freeSeats = t.maxSeats - totalSeats(cabinSeats(t, others));
  const byLength = Math.floor(freeLength / p.pitch(t));
  const bySeats = Math.floor(freeSeats / p.abreast(t));
  return Math.max(0, Math.min(byLength, bySeats));
}

/** Fill economy with the given product to use the remaining cabin. */
function fillEconomy(t: AircraftType, c: CabinConfig, product: string): CabinConfig {
  const rows = maxRowsFor(t, c, 'Y', product);
  return { ...c, Y: { product, rows } };
}

export interface CabinPreset {
  id: string;
  name: string;
  desc: string;
  config: CabinConfig;
}

function rowsForShare(t: AircraftType, productId: string, share: number): number {
  const p = seatProduct(productId);
  return Math.max(1, Math.round((t.cabinLength * share - p.overhead) / p.pitch(t)));
}

export function cabinPresets(t: AircraftType): CabinPreset[] {
  const presets: CabinPreset[] = [];
  const wide = isWidebody(t);

  if (t.body === 'supersonic') {
    presets.push({
      id: 'sst', name: 'All Premium', desc: 'Large recliners for the jet set — the layout Boom envisions.',
      config: { J: { product: 'j_recliner', rows: maxRowsFor(t, {}, 'J', 'j_recliner') } },
    });
    presets.push({
      id: 'sst_mix', name: 'Flat + Spacious', desc: 'A few lie-flat beds up front, spacious economy behind.',
      config: fillEconomy(t, { J: { product: 'j_flat', rows: 4 } }, 'y_plus'),
    });
    return presets;
  }

  presets.push({ id: 'max', name: 'Max Density', desc: 'Every seat the exits allow. Built for ultra-low-cost carriers.', config: fillEconomy(t, {}, 'y_dense') });
  presets.push({ id: 'ally', name: 'All Economy', desc: 'Single-class layout with standard legroom.', config: fillEconomy(t, {}, 'y_std') });

  if (t.body === 'turboprop') {
    presets.push({ id: 'comfort', name: 'Comfort', desc: 'Extra legroom for a premium regional product.', config: fillEconomy(t, {}, 'y_plus') });
    return presets;
  }

  if (t.body === 'regional') {
    presets.push({
      id: 'dual', name: 'Dual Class', desc: 'US-style regional with a small recliner cabin up front.',
      config: fillEconomy(t, { J: { product: 'j_recliner', rows: 4 } }, 'y_std'),
    });
    return presets;
  }

  if (!wide) {
    presets.push({
      id: 'euro', name: 'European Two-Class', desc: 'Flexible Euro Business with blocked middle seats.',
      config: fillEconomy(t, { J: { product: 'j_euro', rows: 4 } }, 'y_std'),
    });
    presets.push({
      id: 'us', name: 'Domestic First', desc: 'Recliner first class plus standard economy.',
      config: fillEconomy(t, { J: { product: 'j_recliner', rows: 4 } }, 'y_std'),
    });
    if (t.flatBedNarrow) {
      presets.push({
        id: 'flat', name: 'Transatlantic', desc: 'Lie-flat business beds for long, thin routes.',
        config: fillEconomy(t, { J: { product: 'j_flat', rows: 4 }, W: { product: 'w_std', rows: 2 } }, 'y_std'),
      });
    }
    return presets;
  }

  presets.push({
    id: 'two', name: 'Two-Class Long-Haul', desc: 'Lie-flat business and standard economy.',
    config: fillEconomy(t, { J: { product: 'j_flat', rows: rowsForShare(t, 'j_flat', 0.22) } }, 'y_std'),
  });
  presets.push({
    id: 'three', name: 'Three-Class', desc: 'Business, premium economy and economy.',
    config: fillEconomy(
      t,
      {
        J: { product: 'j_flat', rows: rowsForShare(t, 'j_flat', 0.27) },
        W: { product: 'w_std', rows: rowsForShare(t, 'w_std', 0.08) },
      },
      'y_std',
    ),
  });
  if (t.yAbreast >= 9 && t.rangeKm > 11000) {
    presets.push({
      id: 'flagship', name: 'Flagship Four-Class', desc: 'First suites, business suites, premium and economy.',
      config: fillEconomy(
        t,
        {
          F: { product: 'f_suite', rows: t.body === 'jumbo' ? 3 : 2 },
          J: { product: 'j_suite', rows: rowsForShare(t, 'j_suite', 0.27) },
          W: { product: 'w_std', rows: rowsForShare(t, 'w_std', 0.07) },
        },
        'y_std',
      ),
    });
  }
  return presets;
}

export function defaultCabin(t: AircraftType): CabinConfig {
  const presets = cabinPresets(t);
  const pick =
    presets.find((p) => p.id === 'euro') ??
    presets.find((p) => p.id === 'dual') ??
    presets.find((p) => p.id === 'three') ??
    presets.find((p) => p.id === 'ally') ??
    presets[0];
  return pick.config;
}

/** Seat-capacity-weighted comfort per class. */
export function classComfort(c: CabinConfig): Partial<Record<CabinClass, number>> {
  const out: Partial<Record<CabinClass, number>> = {};
  for (const cls of CLASSES) {
    const s = c[cls];
    if (s && s.rows > 0) out[cls] = seatProduct(s.product).comfort;
  }
  return out;
}

/** Installation cost of a full cabin. */
export function cabinInstallCost(t: AircraftType, c: CabinConfig): number {
  let cost = 0;
  for (const cls of CLASSES) {
    const s = c[cls];
    if (!s) continue;
    cost += sectionSeats(t, s) * seatProduct(s.product).seatCost;
  }
  return cost;
}

export function cabinSummary(s: Seats): string {
  return CLASSES.filter((c) => s[c] > 0)
    .map((c) => `${s[c]}${c}`)
    .join(' · ');
}

export function availableProducts(t: AircraftType, cls: CabinClass) {
  return productsFor(t, cls);
}
