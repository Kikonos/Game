// v0.6 morale & attrition (UPDATE-0.6.md §F3): target from policies, daily drivers, shocks, sick and resign
// risk, notice periods. Read APIs are pure.

import type { GameState, Minute, MoraleDriver, Policies } from '../core/types';

export interface MoraleDriverView {
  key: MoraleDriver;
  label: string;
  value: number;
}

export interface MoraleView {
  value: number;
  target: number;
  trend14d: number;
  drivers: MoraleDriverView[];
  sickMult: number;
  resignPerMonth: number;
  leaves: Minute | null;
}

export interface MoraleSummary {
  avg: number;
  pilots: number;
  cabin: number;
  trend: number;
  low: number;
  leaving: number;
  target: number;
  drivers: MoraleDriverView[];
}

/** One crew member's morale, its drivers and risks. Pure. (stub) */
export function moraleOf(g: GameState, crewId: string): MoraleView {
  const c = g.crew[crewId];
  return { value: c?.morale ?? 0, target: 65, trend14d: 0, drivers: [], sickMult: 1, resignPerMonth: 0.008, leaves: c?.notice?.leaves ?? null };
}

/** Company-wide morale. Pure. (stub) */
export function moraleSummary(g: GameState): MoraleSummary {
  const cs = Object.values(g.crew);
  const avg = cs.length ? cs.reduce((a, c) => a + c.morale, 0) / cs.length : 0;
  return { avg, pilots: avg, cabin: avg, trend: 0, low: 0, leaving: 0, target: 65, drivers: [] };
}

/** Morale target and monthly cost under a policy patch vs now. Pure. (stub) */
export function policyPreview(_g: GameState, _patch: Partial<Policies>): { target: number; targetNow: number; costPerMonth: number; costNow: number } {
  return { target: 65, targetNow: 65, costPerMonth: 0, costNow: 0 };
}

/** Resign now with the notice period (dev helper; the daily roll calls the same). (stub) */
export function resignNow(_g: GameState, _crewId: string): boolean {
  return false;
}
