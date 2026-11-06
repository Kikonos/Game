// Rotations round (v0.16.4): a log of every crew ticket bought while a game plays, classified against the deployments'
// tours (a tour change, an early trip home, a replacement flown out mid-tour, a stray deployment duty flown as a trip
// from base, a charter trip), with the reason the engine wrote on it (Flight.why). Used by scripts/rotations.ts (a saved
// game played on) and acmi-bot.ts --ticketlog=<file> (a seed).

import { writeFileSync } from 'node:fs';
import { DAY, fmtDateTime, fmtDay, monthKey } from '../src/engine/core/time';
import type { Deployment, Duty, Flight, GameState, MonthKey } from '../src/engine/core/types';
import { setChainSpy } from '../src/engine/crew/duties';
import { setDropSpy } from '../src/engine/crew/roster';
import { crewIx } from '../src/engine/crew/timeline';

export type TicketClass = 'tourChange' | 'midTourHome' | 'midTourOut' | 'strayDutyTrip' | 'charterTrip' | 'crewJet' | 'other';

export interface TicketRow {
  id: string;
  at: Minute;
  std: Minute;
  from: string;
  to: string;
  crew: string[];
  n: number;
  cost: number;
  cls: TicketClass;
  why: string;
  base?: string;
  set?: number;
  /** Days into the tour (home) or days of tour left (out), for a mid-tour ticket. */
  stint?: number;
  /** At the report: flown, still booked, or dropped before it flew (its cost sunk: a re-booking or a change of plan). */
  fate?: 'flown' | 'booked' | 'dropped';
  /** Why crew came off it before it flew (the last reason seen). */
  dropWhy?: string;
}
type Minute = number;

const near = (a: Minute, b: Minute, d = 2 * DAY) => Math.abs(a - b) <= d;

/** Tour boundaries (anchors every R) of a deployment around t. */
function boundaryNear(g: GameState, dep: Deployment, t: Minute): boolean {
  const R = g.company.policies.rotationWeeks * 7 * DAY;
  if (near(t, dep.start, 3 * DAY) || near(t, dep.end, 3 * DAY)) return true;
  for (const a of dep.anchors ?? []) {
    const k = Math.round((t - a) / R);
    if (near(t, a + k * R)) return true;
  }
  for (const pid of dep.pairingIds) {
    const tour = g.pairings[pid]?.tour;
    if (tour && (near(t, tour.from) || near(t, tour.to))) return true;
  }
  return false;
}

function depAt(g: GameState, base: string, t: Minute): Deployment | undefined {
  return Object.values(g.deployments).find((d) => d.base === base && d.start - 3 * DAY <= t && d.end + 3 * DAY >= t);
}

export function classify(g: GameState, f: Flight): TicketRow {
  const ix = crewIx(g);
  const dutyId = ix.ticketDuty.get(f.id);
  const d: Duty | undefined = dutyId ? g.duties[dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  const home = g.company.homeBase;
  const crew = f.crewIds.map((id) => {
    const c = g.crew[id];
    return c ? `${c.role} ${c.last}` : id;
  });
  const row: TicketRow = { id: f.id, at: g.now, std: f.std, from: f.from, to: f.to, crew, n: f.crewIds.length, cost: f.cost ?? 0, cls: 'other', why: f.why ?? '' };
  if (f.charter) row.cls = 'crewJet';
  const outbound = f.sta <= (d?.report ?? Infinity);
  if (p?.tour) {
    const dep = p.deploymentId ? g.deployments[p.deploymentId] : undefined;
    row.base = dep?.base ?? (outbound ? f.to : f.from);
    row.set = p.tour.set;
    if (outbound) {
      if (near(f.sta, p.tour.from, 3 * DAY) || (dep && boundaryNear(g, dep, f.sta))) row.cls = 'tourChange';
      else {
        row.cls = 'midTourOut';
        row.stint = Math.round((p.tour.to - f.sta) / DAY);
      }
    } else {
      if (near(f.std, p.tour.to, 3 * DAY) || (dep && boundaryNear(g, dep, f.std))) row.cls = 'tourChange';
      else {
        row.cls = 'midTourHome';
        row.stint = Math.round((f.std - p.tour.from) / DAY);
      }
    }
    if (f.charter) row.cls = 'crewJet';
    return row;
  }
  if (p && d) {
    // A trip (base → base): a deployment duty no set took, or a charter trip.
    const station = outbound ? f.to : f.from;
    const dep = depAt(g, station, outbound ? f.sta : f.std);
    const c = p.contractId ? g.contracts[p.contractId] : undefined;
    if (dep || c?.pattern.kind === 'base') {
      row.cls = 'strayDutyTrip';
      row.base = station;
    } else row.cls = 'charterTrip';
    if (f.charter) row.cls = 'crewJet';
    return row;
  }
  // Loose ticket (no duty holds it): a crew member sent home (sendHome) from where they are.
  if (f.to === home) {
    const dep = depAt(g, f.from, f.std);
    if (dep) {
      row.base = dep.base;
      row.cls = boundaryNear(g, dep, f.std) ? 'tourChange' : 'midTourHome';
      // The set they were on: the tour pairing at that base holding them.
      for (const id of f.crewIds) {
        for (const q of ix.pairingsOf.get(id) ?? []) if (q.tour && q.deploymentId === dep.id && q.start <= g.now + DAY) {
          row.set = q.tour.set;
          if (row.cls === 'midTourHome') row.stint = Math.round((f.std - q.tour.from) / DAY);
        }
      }
    } else row.cls = 'charterTrip';
  }
  if (f.charter) row.cls = 'crewJet';
  return row;
}

export interface TicketLog {
  observe(g: GameState): void;
  rows: TicketRow[];
  strays: { at: Minute; base: string; duty: string; why: string[] }[];
  report(g: GameState, title: string): string;
  save(file: string): void;
}

export function createTicketLog(startNow?: Minute): TicketLog {
  const seen = new Set<string>();
  const rows: TicketRow[] = [];
  const strays: TicketLog['strays'] = [];
  let first = true;
  setChainSpy((g, dep, d, why) => {
    const f0 = g.flights[d.flightIds[0]];
    strays.push({ at: g.now, base: dep.base, duty: `${f0?.no ?? d.id} ${f0?.from ?? '?'}–${f0?.to ?? '?'} ${fmtDateTime(d.report)}`, why });
  });
  const pending = new Map<string, TicketRow>();
  setDropSpy((_g, f, _crewId, why) => {
    const r = pending.get(f.id);
    if (r) r.dropWhy = why;
  });
  const observe = (g: GameState) => {
    // Fates: a ticket seen flown stays flown (tickets are pruned 2 days after landing); one gone before it left was dropped.
    for (const [id, r] of pending) {
      const f = g.flights[id];
      if (!f) {
        r.fate = 'dropped';
        pending.delete(id);
      } else if (f.status === 'done') {
        r.fate = 'flown';
        r.n = f.crewIds.length;
        pending.delete(id);
      } else if (f.crewIds.length < r.n) {
        r.n = f.crewIds.length;
      }
    }
    for (const f of Object.values(g.flights)) {
      if (f.kind !== 'deadhead') continue;
      if (first) {
        seen.add(f.id);
        continue;
      }
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      if (startNow !== undefined && f.std < startNow) continue;
      const r = classify(g, f);
      rows.push(r);
      pending.set(f.id, r);
    }
    first = false;
  };
  const report = (g: GameState, title: string): string => {
    const out: string[] = [`## ${title}`, ''];
    observe(g);
    for (const r of rows) {
      if (r.fate) continue;
      const f = g.flights[r.id];
      r.fate = !f || f.status === 'cancelled' ? 'dropped' : f.status === 'done' ? 'flown' : 'booked';
    }
    const dropped = rows.filter((r) => r.fate === 'dropped');
    out.push(`Tickets bought: ${rows.length} (${rows.reduce((a, r) => a + r.n, 0)} people); flown or still booked ${rows.length - dropped.length}; dropped before flying ${dropped.length} (${dropped.reduce((a, r) => a + r.n, 0)} people, ${Math.round(dropped.reduce((a, r) => a + r.cost, 0) / 1000)}K sunk). The tables count flown and booked tickets only.`, '');
    const byMonth = new Map<MonthKey, Record<TicketClass, number> & { cost: number; people: number }>();
    const empty = (): Record<TicketClass, number> & { cost: number; people: number } => ({ tourChange: 0, midTourHome: 0, midTourOut: 0, strayDutyTrip: 0, charterTrip: 0, crewJet: 0, other: 0, cost: 0, people: 0 });
    const total = empty();
    for (const r of rows) {
      if (r.fate === 'dropped') continue;
      const k = monthKey(r.std);
      const m = byMonth.get(k) ?? empty();
      m[r.cls] += r.n;
      m.people += r.n;
      m.cost += r.cost;
      total[r.cls] += r.n;
      total.people += r.n;
      total.cost += r.cost;
      byMonth.set(k, m);
    }
    out.push('| month | people ticketed | tour change | mid-tour home | mid-tour out | stray duty trip | charter trip | crew jet | ticket $ |');
    out.push('|---|---|---|---|---|---|---|---|---|');
    for (const [k, m] of [...byMonth].sort()) out.push(`| ${k} | ${m.people} | ${m.tourChange} | ${m.midTourHome} | ${m.midTourOut} | ${m.strayDutyTrip} | ${m.charterTrip} | ${m.crewJet} | ${Math.round(m.cost / 1000)}K |`);
    out.push(`| **all** | ${total.people} | ${total.tourChange} | ${total.midTourHome} | ${total.midTourOut} | ${total.strayDutyTrip} | ${total.charterTrip} | ${total.crewJet} | ${Math.round(total.cost / 1000)}K |`);
    out.push('');
    // Reasons behind mid-tour tickets.
    const why = new Map<string, number>();
    for (const r of rows) {
      if (r.fate === 'dropped' || (r.cls !== 'midTourHome' && r.cls !== 'midTourOut')) continue;
      const k = r.why.replace(/\d+:\d\d/g, 'h:mm').replace(/\b\d+ \w{3}\b/g, 'date').slice(0, 90) || '(no reason recorded)';
      why.set(k, (why.get(k) ?? 0) + r.n);
    }
    out.push('Mid-tour tickets by reason (people):');
    for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) out.push(`- ${n} × ${k}`);
    out.push('');
    const stint = rows.filter((r) => r.fate !== 'dropped' && r.stint !== undefined).map((r) => r.stint!);
    if (stint.length) out.push(`Mid-tour stints: ${stint.length} tickets, median ${stint.sort((a, b) => a - b)[Math.floor(stint.length / 2)]} days, under 7 days: ${stint.filter((x) => x < 7).length}.`, '');
    // Stray duties the sets refused.
    const sw = new Map<string, number>();
    for (const s of strays) for (const w of s.why) sw.set(w.replace(/^set \d+: /, '').replace(/\b[A-Z][a-zà-ü]+ /g, '').slice(0, 60), (sw.get(w.replace(/^set \d+: /, '').replace(/\b[A-Z][a-zà-ü]+ /g, '').slice(0, 60)) ?? 0) + 1);
    const sb = new Map<string, number>();
    for (const x of strays) sb.set(x.base, (sb.get(x.base) ?? 0) + 1);
    out.push(`Deployment duties no set on station took (flown as trips from base): ${strays.length} (${[...sb].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}); set refusals by cause:`);
    for (const [k, n] of [...sw].sort((a, b) => b[1] - a[1]).slice(0, 12)) out.push(`- ${n} × ${k}`);
    for (const x of strays.slice(0, 6)) out.push(`  e.g. ${fmtDateTime(x.at)} ${x.base} ${x.duty}: ${x.why.join('; ')}`);
    out.push('');
    const dw = new Map<string, number>();
    for (const r of dropped) {
      const k = `${r.why.replace(/\d+:\d\d/g, 'h:mm').replace(/ set \d+ at \w+/, '').slice(0, 40) || '(no reason)'} → ${(r.dropWhy ?? '?').replace(/\d+:\d\d/g, 'h:mm').replace(/\b\d+ \w{3}\b/g, 'date').slice(0, 60)}`;
      dw.set(k, (dw.get(k) ?? 0) + r.n);
    }
    out.push('Dropped tickets by what they were bought for → why dropped (people):');
    for (const [k, n] of [...dw].sort((a, b) => b[1] - a[1]).slice(0, 14)) out.push(`- ${n} × ${k}`);
    out.push('');
    out.push('Sample mid-tour tickets:');
    for (const r of rows.filter((x) => x.fate !== 'dropped' && (x.cls === 'midTourHome' || x.cls === 'midTourOut')).slice(0, 40)) out.push(`- ${fmtDateTime(r.std)} ${r.from}–${r.to} ${r.crew.join(', ')} [${r.cls}${r.stint !== undefined ? ` ${r.stint} d` : ''}] ${r.why}`);
    out.push('');
    // Spend by month from the ledger.
    const st = [...g.finance.history, g.finance.current];
    out.push('Ledger by month (deadhead / crew jet / hotels / per diem):');
    for (const s of st.slice(-6)) out.push(`- ${s.month}: ${Math.round(-(s.lines.deadhead ?? 0) / 1000)}K / ${Math.round(-(s.lines.crewJet ?? 0) / 1000)}K / ${Math.round(-(s.lines.hotels ?? 0) / 1000)}K / ${Math.round(-(s.lines.perDiem ?? 0) / 1000)}K`);
    out.push('');
    out.push(`Now ${fmtDay(g.now)}.`);
    return out.join('\n');
  };
  return { observe, rows, strays, report, save: (file) => writeFileSync(file, JSON.stringify({ rows, strays }, null, 1)) };
}
