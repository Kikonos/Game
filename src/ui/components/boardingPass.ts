// v0.12 Visual B: a crew member's airline ticket as a boarding pass. Pure: the seat comes from the ids (the same pass
// every time), crew on one ticket sit together in one row, a long leg gets widebody seat letters.

import { distance } from '../../engine/core/geo';

/** FNV-1a 32-bit hash of a string (deterministic, no game RNG touched). */
export function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seat letters across a cabin: a narrowbody 3-3, a widebody 3-4-3 (no I). */
const NARROW = 'ABCDEF';
const WIDE = 'ABCDEFGHJK';
/** Legs longer than this (km) fly widebodies (as the engine's ticket block times assume, commercial.ts LONG_KM). */
export const WIDE_KM = 4_500;

/**
 * The seat of passenger `i` (their place in the ticket's crew list) on leg `legIndex` of ticket `ticketId`: one row per
 * ticket and leg in the back half of economy (staff travel), the crew side by side from the window. e.g. '27A'. Pure.
 */
export function seatFor(ticketId: string, legIndex: number, i: number, wide: boolean): string {
  const letters = wide ? WIDE : NARROW;
  const h = hashId(`${ticketId}:${legIndex}`);
  const first = wide ? 30 : 18;
  const span = wide ? 22 : 14;
  const row = first + (h % span) + Math.floor(i / letters.length);
  // Start at the window most of the time, sometimes across the aisle (C / D side).
  const start = (h >>> 8) % 2 === 0 ? 0 : 3;
  return `${row}${letters[(start + i) % letters.length]}`;
}

/** Whether an airline leg between two airports flies a widebody. */
export const wideLeg = (from: string, to: string): boolean => {
  try {
    return distance(from, to) > WIDE_KM;
  } catch {
    return false;
  }
};

/** 'GOMES/PEDRO': the passenger name as a boarding pass prints it. */
export const passName = (first: string, last: string): string => `${last}/${first}`.toUpperCase();
