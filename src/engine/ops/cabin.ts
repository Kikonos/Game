// v0.7 cabin reconfiguration: layouts, refit stations, quotes and booking (UPDATE-0.7.md §F7). STUB.

import { ACMI_TYPES } from '../../data/acmiTypes';
import type { CabinPreset } from '../../data/acmiTypes';
import type { ActionResult, Cabin, GameState, Minute } from '../core/types';
import type { DeliveryLeg } from './delivery';

export interface RefitQuote {
  ok: boolean; why: string | null; cabin: Cabin; days: number; cost: number; start: Minute; end: Minute;
  station: string; ferryIn: DeliveryLeg[]; seatsFrom: number; seatsTo: number; cabinMinFrom: number; cabinMinTo: number;
  opens: string[]; closes: string[]; reinstateAtReturn: number | null; clashes: string[];
}

export function cabinOptions(typeId: string): CabinPreset[] {
  return ACMI_TYPES[typeId]?.cabins ?? [];
}

export function refitStations(_g: GameState, _aircraftId: string): { code: string; name: string; ferryBlock: number }[] {
  return [];
}

export function refitQuote(g: GameState, aircraftId: string, label: string, station: string, start: Minute): RefitQuote {
  const c = g.fleet[aircraftId]?.cabin ?? { j: 0, w: 0, y: 0, total: 0, label, layout: 'all-economy' as const };
  return { ok: false, why: 'v0.7 stub', cabin: c, days: 0, cost: 0, start, end: start, station, ferryIn: [], seatsFrom: c.total, seatsTo: c.total, cabinMinFrom: 0, cabinMinTo: 0, opens: [], closes: [], reinstateAtReturn: null, clashes: [] };
}

export function bookRefit(_g: GameState, _aircraftId: string, _label: string, _station: string, _start: Minute): ActionResult<{ maintId: string }> {
  return { ok: false, error: 'v0.7 stub' };
}
