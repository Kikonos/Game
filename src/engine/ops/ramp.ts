// v0.11 Operations — ramp inspections (EASA SAFA / SACA, Regulation (EU) 965/2012 ARO.RAMP). An inspector walks the
// aircraft between flights; findings come in three categories (Cat 1 minor, Cat 2 significant, Cat 3 major) and a
// class of action follows (1 information · 2 a letter to the operator and its authority · 3a a restriction · 3b put it
// right before the flight · 3c the aircraft is detained). Older aircraft and a backlog of deferred defects find more.
// Inspections land in busy spells (the director); each one goes into the safety record the yearly audit reads and,
// lightly, into our reliable name. Rolls are on a side stream.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { EASA_STATES, RAMP_ITEMS, RAMP_MEAN } from '../../data/opsData';
import { nextId, touchFlights } from '../core/entities';
import { schedule } from '../core/queue';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { hashUnit } from '../core/util';
import { DAY, fmtDuration, fmtTime, yearOf } from '../core/time';
import type { Aircraft, Flight, GameState, RampCheck, RampProgramme } from '../core/types';
import { OPS_LIVE, optionalFactor } from './director';
import { countOps, lineMx, opsState } from './disrupt';
import { bumpReliable, usd } from './util';

/** Inspections per landing: at an EASA-state airport abroad, at home, elsewhere (the local authority's own checks). */
export const RAMP_RATE = { ecac: 0.004, home: 0.003, local: 0.0015 };
/** An EU operator with a good record finds less than the all-operator average (2025: 0.92 findings per inspection). */
const OPERATOR_F = 0.55;

const roll = (g: GameState, key: string) => hashUnit(`${g.seed}:ramp:${key}`);

/** Poisson draw from a side stream. */
function poisson(g: GameState, key: string, lambda: number): number {
  let k = 0;
  let p = Math.exp(-lambda);
  let s = p;
  const u = roll(g, key);
  while (u > s && k < 6) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
}

/** The programme an inspection at `airport` falls under for our company. Pure. */
export function programmeAt(g: GameState, airport: string): RampProgramme {
  const c = AIRPORT_BY_CODE[airport]?.country ?? '';
  // SAFA/SACA run in the EASA states (the UK CAA, Turkey and the other ECAC states inspect under their own rules).
  if (!EASA_STATES.has(c)) return 'local';
  const home = AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';
  return EASA_STATES.has(home) ? 'SACA' : 'SAFA';
}

/** On blocks: an inspector may be waiting (busy spells; side stream). */
export function rollRamp(g: GameState, f: Flight, ac: Aircraft): RampCheck | null {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt || f.kind === 'deadhead' || !f.aircraftId) return null;
  const prog = programmeAt(g, f.to);
  const p = (f.to === g.company.homeBase ? RAMP_RATE.home : prog === 'local' ? RAMP_RATE.local : RAMP_RATE.ecac) * optionalFactor(g);
  if (!p || roll(g, `${f.id}:${f.std}`) >= p) return null;
  return inspect(g, ac, f.to, prog, `${f.id}:${f.std}`);
}

/** What an inspection of this aircraft would find with this roll key (findings, class of action, time, cost). Pure. */
export function rampFindings(g: GameState, ac: Aircraft, key: string): Pick<RampCheck, 'cats' | 'items' | 'action' | 'fixMin' | 'cost'> {
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  const m = OPERATOR_F * (1 + age / 20) * (1 + 2.5 * ac.maint.deferred);
  const cats: [number, number, number] = [poisson(g, `${key}:1`, RAMP_MEAN.cat1 * m), poisson(g, `${key}:2`, RAMP_MEAN.cat2 * m), poisson(g, `${key}:3`, RAMP_MEAN.cat3 * m * 0.8)];
  const items: [1 | 2 | 3, string][] = [];
  for (const cat of [3, 2, 1] as const) {
    const pool = [...RAMP_ITEMS[cat]];
    for (let i = 0; i < cats[cat - 1] && pool.length; i++) items.push([cat, pool.splice(Math.floor(roll(g, `${key}:i${cat}${i}`) * pool.length), 1)[0]]);
  }
  const detained = cats[2] > 0 && ac.maint.deferred > 0.35 && age >= 15 && roll(g, `${key}:3c`) < 0.35;
  const action: RampCheck['action'] = cats[2] ? (detained ? '3c' : '3b') : cats[1] ? '2' : cats[0] ? '1' : null;
  const fixMin = action === '3c' ? 60 * (8 + Math.round(roll(g, `${key}:fx`) * 14)) : action === '3b' ? 30 * (2 + Math.round(roll(g, `${key}:fx`) * 6)) : 0;
  const cost = Math.round((cats[2] * (2_000 + roll(g, `${key}:c3`) * 8_000) + cats[1] * (500 + roll(g, `${key}:c2`) * 1_500) + (action === '3c' ? 15_000 : 0)) / 100) * 100;
  return { cats, items, action, fixMin, cost };
}

/** An inspection now (dev: forced). */
export function inspect(g: GameState, ac: Aircraft, at: string, prog: RampProgramme = programmeAt(g, at), key = `${ac.id}:${g.now}`): RampCheck {
  const { cats, items, action, fixMin, cost } = rampFindings(g, ac, key);
  const r: RampCheck = { id: nextId(g, 'rc'), t: g.now, at, aircraftId: ac.id, reg: ac.reg, prog, cats, items, action, fixMin, cost };
  const st = opsState(g);
  st.ramp.push(r);
  st.ramp = st.ramp.filter((x) => x.t > g.now - 400 * DAY);
  countOps(g, 'ramp');
  if (cats[0]) countOps(g, 'rampCat1', cats[0]);
  if (cats[1]) countOps(g, 'rampCat2', cats[1]);
  if (cats[2]) countOps(g, 'rampCat3', cats[2]);
  if (action === '3c') countOps(g, 'rampDetained');
  // Fixing before the flight: line maintenance on the spot (the next departure waits for it).
  let ready = g.now + fixMin;
  const inWork = ac.maintId ? g.maintenance[ac.maintId] : undefined;
  if ((action === '3b' || action === '3c') && !ac.flightId && ac.status === 'available') lineMx(g, ac, at, fixMin, cost, action === '3c' ? 'Detained after a ramp inspection (class 3c)' : 'Ramp inspection findings put right (class 3b)', 'maintenance');
  else if ((action === '3b' || action === '3c') && !ac.flightId && inWork?.status === 'inWork' && inWork.at === at) {
    // v0.12.1 already in maintenance here (an inspection after a diversion): the work runs on until the findings are
    // put right too (it ended first and the aircraft flew with them, the message's ready time untrue).
    if (inWork.end < ready) {
      inWork.end = ready;
      inWork.ev++;
      schedule(g, inWork.end, 'maint.end', inWork.id, inWork.ev);
      touchFlights(g);
    }
    ready = inWork.end;
    if (cost) lineCost(g, cost);
  } else if (cost) lineCost(g, cost);
  if (cats[2]) bumpReliable(g, action === '3c' ? -2 : -1);
  else if (cats[1]) bumpReliable(g, -0.3);
  const name = prog === 'local' ? 'Ramp inspection' : `${prog} ramp inspection`;
  const where = AIRPORT_BY_CODE[at]?.city ?? at;
  const n = cats[0] + cats[1] + cats[2];
  if (!n) {
    pushMessage(g, { tone: 'good', cat: 'tech', title: `${name}: ${ac.reg} clean at ${where}`, body: 'The inspector found nothing. It goes on our record.', ref: { kind: 'ramp', id: r.id } });
    return r;
  }
  const worst = cats[2] ? 3 : cats[1] ? 2 : 1;
  pushMessage(g, {
    tone: worst === 3 ? 'bad' : worst === 2 ? 'warn' : 'info', cat: 'tech',
    title: worst === 3 ? `${name}: ${ac.reg} ${action === '3c' ? 'detained' : 'held'} at ${where}` : `${name}: ${n} finding${n > 1 ? 's' : ''} on ${ac.reg}`,
    body: `${items.map(([c, t]) => `Cat ${c}: ${t}`).join('. ')}.${fixMin ? ` Put right before the next flight: about ${fmtDuration(fixMin)}, ready ${fmtTime(ready)} UTC.` : ''}${cost ? ` ${usd(cost)}.` : ''}`,
    ref: { kind: 'ramp', id: r.id }, problem: { kind: 'rampFinding', ref: { kind: 'ramp', id: r.id } },
    hurt: { money: cost, pax: 0, delayMin: fixMin, level: worst === 3 ? 'high' : worst === 2 ? 'low' : 'none' },
    cue: action === '3c' ? 'opsEmergency' : worst >= 2 ? 'notice' : 'message',
  });
  return r;
}

const lineCost = (g: GameState, cost: number) => post(g, 'maintenance', -cost);

/** The last year's inspections: count, findings by category, detentions. Pure. */
export function rampYear(g: GameState): { n: number; cats: [number, number, number]; detained: number; clean: number; list: RampCheck[] } {
  const list = (g.opsx?.ramp ?? []).filter((r) => r.t > g.now - 365 * DAY);
  const cats: [number, number, number] = [0, 0, 0];
  for (const r of list) for (let i = 0; i < 3; i++) cats[i] += r.cats[i];
  return { n: list.length, cats, detained: list.filter((r) => r.action === '3c').length, clean: list.filter((r) => !r.cats[0] && !r.cats[1] && !r.cats[2]).length, list };
}
