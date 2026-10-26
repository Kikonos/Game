// BLOCK HOURS invariant checker (debug round, 26 Oct 2026): watches a running game and reports anything that should
// never happen, read from the state itself rather than from the engine's own legality marks.
//
//   npx tsx scripts/invariants.ts save <file.json> [days=90] [--step=60]   a save played on (default answers only)
//   npx tsx scripts/invariants.ts seed <n> [days=120] [--base=LIS]          a new game, offers taken like crewAudit.test
//   (the bot runs it too: npx tsx scripts/acmi-bot.ts <seed> 365 --inv)
//
// Library use: const inv = createChecker(); … inv.observe(g) after each step …; inv.finish(g); inv.print().
//
// Checks
// - crew: rest before each duty / ticket / standby (ORO.FTL.235: max(preceding duty, 12 h home / 10 h away), 14 h after
//   an augmented duty or away ≥ 4 h time-zone shift, +4 h after a planned extension; a standby call-out needs no rest
//   between the standby and the duty, CS FTL.1.225), no overlap, FDP within max + discretion (≤ 2 h / 3 h augmented),
//   cumulative duty / block limits (ORO.FTL.210, standby counted 25 % home / 100 % airport), recurrent extended
//   recovery rest at most 168 h apart (ORO.FTL.235(d)), every flight leaving from where the crew are (no teleporting),
//   no flying while sick, on leave, training or joining, pilots ≥ 2 with a captain, cabin crew ≥ the certified
//   minimum on passenger legs, type ratings held;
// - aircraft: flown legs chain by airport and never overlap, one leg en route at a time, maintenance never overlaps
//   a flown leg and starts where the aircraft is, ETOPS within the airframe and the company approval;
// - money: no NaN / Infinity anywhere, statements chain (cash end → next cash start), cash moved only by the ledger
//   (opts.spy: a cash setter that checks its caller);
// - flights and loose ends: no leg overdue and still scheduled, no hold loop (pushed again and again), decisions and
//   timed disruptions resolved, no references to missing flights, duties, pairings, crew or aircraft.

import { readFileSync } from 'node:fs';
import { DAY, fmtDateTime } from '../src/engine/core/time';
import { cabinMinimum, etopsNeeded, typeOf } from '../src/engine/core/perf';
import type { GameState, Minute, Role } from '../src/engine/core/types';
import { offsetAt } from '../src/engine/crew/rules';

const H = 60;

export interface Issue {
  /** Short code, e.g. 'rest', 'teleport'. */
  code: string;
  t: Minute;
  text: string;
}

interface FlightRec {
  id: string;
  no: string;
  kind: string;
  from: string;
  to: string;
  atd: Minute;
  ata: Minute;
  aircraftId: string | null;
  contractId: string | null;
  crewIds: string[];
  riders: string[];
  purpose?: string;
  operatedBy?: string;
  reducedCabin?: number;
  /** Operating crew without the type rating when the leg was first seen flown. */
  unrated?: string[];
}
interface LogRec {
  start: Minute;
  end: Minute;
  aug: boolean;
  ext: boolean;
  block: number;
  sectors: number;
}
interface SbyRec {
  from: Minute;
  to: Minute;
  calledAt?: Minute;
  kind: string;
  at: string;
}
interface CrewHist {
  id: string;
  name: string;
  base: string;
  role: Role;
  log: Map<string, LogRec>;
  sby: Map<number, SbyRec>;
  blocks: Map<string, { from: Minute; to: Minute; why: string }>;
  flights: string[];
  /** First location seen, and when. */
  loc0: string;
  t0: Minute;
}

export interface CheckerOpts {
  /** Install a cash setter that reports any change not made by core/ledger.ts (slow: a stack per change). */
  spy?: boolean;
  /** Days of state between full NaN scans (default 1). */
  scanDays?: number;
}

const ROLE_PILOT = new Set<Role>(['CPT', 'FO', 'CRP']);
const DAY_MS = DAY;

/** ORO.FTL.235 minimum rest (independent of crew/rules.ts minRest, written from the brief). */
export function restNeeded(dutyMin: number, atHome: boolean, aug: boolean, tzH: number, ext: boolean): number {
  let base = atHome ? 12 * H : 10 * H;
  if (aug || (!atHome && tzH >= 4)) base = 14 * H;
  return Math.max(dutyMin, base) + (ext ? 4 * H : 0);
}

/** Local nights (8 h inside 22:00–08:00 local) wholly inside [a, b) at airport tz. */
function localNights(tz: string, a: Minute, b: Minute): number {
  const off = offsetAt(tz, a);
  const la = a + off;
  const lb = b + off;
  let n = 0;
  for (let w = Math.floor(la / DAY) * DAY - DAY + 22 * H; w < lb; w += DAY) if (Math.min(lb, w + 10 * H) - Math.max(la, w) >= 8 * H) n++;
  return n;
}

const tzDiffH = (a: string, b: string, t: Minute) => Math.abs(offsetAt(a, t) - offsetAt(b, t)) / 60;

export function createChecker(opts: CheckerOpts = {}) {
  const errors: Issue[] = [];
  const warns: Issue[] = [];
  const seenKey = new Set<string>();
  const err = (code: string, t: Minute, text: string, key = `${code}|${text}`) => {
    if (seenKey.has(key)) return;
    seenKey.add(key);
    errors.push({ code, t, text });
  };
  const warn = (code: string, t: Minute, text: string, key = `${code}|${text}`) => {
    if (seenKey.has(key)) return;
    seenKey.add(key);
    warns.push({ code, t, text });
  };
  const flights = new Map<string, FlightRec>();
  const crew = new Map<string, CrewHist>();
  const lastStd = new Map<string, { std: Minute; n: number; first: Minute }>();
  const fdpSeen = new Set<string>();
  const regOf = new Map<string, string>();
  const typeOfAc = new Map<string, string>();
  const maint = new Map<string, { aircraftId: string; at: string; start: Minute; end: Minute; status: string; kind: string }>();
  let lastScan = -Infinity;
  let spied = false;
  let steps = 0;
  let firstT: Minute | null = null;
  let lastT: Minute = 0;
  const etopsHeld = (g: GameState) => Math.max(0, ...g.company.approvals.map((a) => (/^etops(\d+)$/.exec(a) ? Number(/^etops(\d+)$/.exec(a)![1]) : 0)));

  function spy(g: GameState) {
    if (spied) return;
    spied = true;
    let cash = g.company.cash;
    Object.defineProperty(g.company, 'cash', {
      enumerable: true, configurable: true,
      get: () => cash,
      set: (v: number) => {
        const st = new Error().stack ?? '';
        if (!/core[\\/]ledger\.ts/.test(st.split('\n')[2] ?? '')) err('cash', g.now, `cash changed outside the ledger: ${st.split('\n').slice(2, 4).join(' / ').trim()}`);
        cash = v;
      },
    });
  }

  function hist(g: GameState, id: string): CrewHist {
    let h = crew.get(id);
    if (!h) {
      const c = g.crew[id];
      h = { id, name: `${c.first} ${c.last} (${c.role})`, base: c.base, role: c.role, log: new Map(), sby: new Map(), blocks: new Map(), flights: [], loc0: c.loc, t0: g.now };
      crew.set(id, h);
    }
    return h;
  }

  function observe(g: GameState): void {
    steps++;
    const lastObs = lastT;
    firstT ??= g.now;
    lastT = g.now;
    if (opts.spy) spy(g);
    for (const ac of Object.values(g.fleet)) {
      regOf.set(ac.id, ac.reg);
      typeOfAc.set(ac.id, ac.typeId);
    }
    // ---- crew snapshots (logs are pruned at 28 days, so they are collected as they appear) ----
    for (const c of Object.values(g.crew)) {
      const h = hist(g, c.id);
      for (const e of c.log) h.log.set(`${e.start}|${e.end}`, { start: e.start, end: e.end, aug: e.augmented, ext: !!e.ext, block: e.block, sectors: e.sectors });
      // Windows dropped before they started never happened (the day planner re-plans ahead).
      const cur = new Set((c.standby ?? []).map((w) => w.from));
      for (const [from] of h.sby) if (from > lastObs && !cur.has(from)) h.sby.delete(from);
      for (const w of c.standby ?? []) {
        const prev = h.sby.get(w.from);
        h.sby.set(w.from, { from: w.from, to: w.to, calledAt: w.calledAt ?? prev?.calledAt, kind: w.kind ?? 'home', at: w.at ?? c.base });
      }
      for (const b of c.blocks ?? []) h.blocks.set(`${b.from}|${b.why}`, { ...b });
      // A running standby is kept where the crew member is (home: base; hotel/airport/reserve: its station).
      const run = c.standby?.find((w) => w.from <= g.now && g.now < w.to && w.calledAt === undefined);
      if (run && c.status !== 'onDuty') {
        const at = run.at ?? c.base;
        if (c.loc !== at) err('sby-where', g.now, `${h.name}: on ${run.kind ?? 'home'} standby at ${at} ${fmtDateTime(run.from)}–${fmtDateTime(run.to)} but is at ${c.loc}`, `sw|${c.id}|${run.from}`);
      }
      for (const k of ['restUntil', 'blockYear', 'morale', 'fatigue', 'salary', 'totalHours'] as const) if (!Number.isFinite(c[k])) err('nan', g.now, `${h.name}: ${k} = ${c[k]}`);
    }
    // ---- flights ----
    const enrouteBy = new Map<string, string>();
    const onBoard = new Map<string, string>();
    for (const f of Object.values(g.flights)) {
      if (f.status === 'enroute') {
        if (f.aircraftId && f.kind !== 'deadhead') {
          const o = enrouteBy.get(f.aircraftId);
          if (o) err('ac-twice', g.now, `${regOf.get(f.aircraftId)} en route on ${o} and ${f.no} at once`);
          enrouteBy.set(f.aircraftId, f.no);
          const ac = g.fleet[f.aircraftId];
          if (ac && ac.flightId !== f.id) warn('ac-flight', g.now, `${ac.reg} flying ${f.no} but its flightId is ${ac.flightId}`, `acf|${f.id}`);
        }
        for (const id of new Set([...f.crewIds, ...(f.riders ?? [])])) {
          const o = onBoard.get(id);
          if (o && g.crew[id]) err('crew-twice', g.now, `${g.crew[id].first} ${g.crew[id].last} aboard ${o} and ${f.no} at once`);
          onBoard.set(id, f.no);
        }
      }
      if (f.status !== 'cancelled' && new Set(f.crewIds).size < f.crewIds.length) err('dup-crew', g.now, `${f.no} ${f.from}–${f.to} ${f.kind} ${fmtDateTime(f.std)} lists a crew member twice (${f.crewIds.filter((x, i) => f.crewIds.indexOf(x) !== i).map((x) => g.crew[x] ? `${g.crew[x].first} ${g.crew[x].last}` : x).join(', ')})`, `dup|${f.id}`);
      if (f.status === 'done' && !flights.has(f.id)) {
        flights.set(f.id, {
          id: f.id, no: f.no, kind: f.kind, from: f.from, to: f.to, atd: f.atd ?? f.std, ata: f.ata ?? f.sta, aircraftId: f.aircraftId, contractId: f.contractId,
          crewIds: [...f.crewIds], riders: [...(f.riders ?? [])], purpose: f.purpose, operatedBy: f.operatedBy, reducedCabin: f.reducedCabin,
          unrated: f.kind !== 'deadhead' && f.aircraftId && g.fleet[f.aircraftId] ? f.crewIds.filter((id) => g.crew[id] && !g.crew[id].ratings.includes(typeOf(g.fleet[f.aircraftId!].typeId).family)) : [],
        });
        for (const id of new Set([...f.crewIds, ...(f.riders ?? [])])) if (g.crew[id] || crew.has(id)) (g.crew[id] ? hist(g, id) : crew.get(id)!).flights.push(f.id);
      }
      if (f.status === 'scheduled') {
        // Overdue: should have left (or been retimed) hours ago.
        // (Tickets stay 'scheduled' until they land: judged by their arrival.)
        const due = f.kind === 'deadhead' ? f.sta : f.std;
        if (due < g.now - 6 * H && !f.closedBy) err('stuck', g.now, `${f.no} ${f.from}–${f.to} (${f.kind}) still scheduled ${Math.round((g.now - due) / 60)} h after its ${f.kind === 'deadhead' ? 'STA' : 'STD'} ${fmtDateTime(due)}`, `stuck|${f.id}`);
        // Hold loop: STD moved again and again inside the last two days before it.
        const l = lastStd.get(f.id);
        if (!l) lastStd.set(f.id, { std: f.std, n: 0, first: f.std });
        else if (l.std !== f.std) {
          if (f.std - g.now < 2 * DAY) l.n++;
          l.std = f.std;
          if (l.n === 8) warn('hold-loop', g.now, `${f.no} ${f.from}–${f.to} retimed ${l.n} times near departure (first STD ${fmtDateTime(l.first)}, now ${fmtDateTime(f.std)})`, `hl|${f.id}`);
          if (f.std - l.first > 2 * DAY && f.kind !== 'deadhead') warn('slip', g.now, `${f.no} ${f.from}–${f.to} slipped ${Math.round((f.std - l.first) / 60)} h (first seen STD ${fmtDateTime(l.first)})`, `slip|${f.id}`);
        }
        if ((f.crewTries ?? 0) >= 6) warn('crew-tries', g.now, `${f.no} ${f.from}–${f.to} held for crew ${f.crewTries} times`, `ct|${f.id}`);
      }
      // References.
      if (f.status !== 'cancelled' && f.status !== 'done' && f.aircraftId && !g.fleet[f.aircraftId]) err('orphan', g.now, `${f.no} on aircraft ${f.aircraftId} that is not in the fleet`, `of|${f.id}`);
      if (f.dutyId && f.status !== 'done' && f.status !== 'cancelled') {
        const d = g.duties[f.dutyId];
        if (!d) err('orphan', g.now, `${f.no} points to duty ${f.dutyId} that does not exist`, `od|${f.id}`);
        else if (!d.flightIds.includes(f.id)) warn('orphan', g.now, `${f.no} points to duty ${f.dutyId}, which does not list it`, `odl|${f.id}`);
      }
      if (f.kind === 'deadhead' && f.status === 'scheduled' && !f.crewIds.length && f.std > g.now) warn('orphan-ticket', g.now, `ticket ${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)} with nobody on it`, `ot|${f.id}`);
    }
    // ---- duties / pairings ----
    for (const d of Object.values(g.duties)) {
      const p = g.pairings[d.pairingId];
      if (!p) err('orphan', g.now, `duty ${d.id} points to missing pairing ${d.pairingId}`, `dp|${d.id}`);
      for (const fid of d.flightIds) if (!g.flights[fid] && !d.done) err('orphan', g.now, `duty ${d.id} lists missing flight ${fid}`, `df|${d.id}|${fid}`);
      for (const fid of d.deadheadIds) if (!g.flights[fid] && !d.done) warn('orphan', g.now, `duty ${d.id} lists missing ticket ${fid}`, `dd|${d.id}|${fid}`);
      if (d.done && !fdpSeen.has(d.id)) {
        fdpSeen.add(d.id);
        const disc = d.discretion ?? 0;
        const crewN = p ? p.slots.filter((s) => s.crewId).length : 0;
        const lastF = d.flightIds.map((id) => g.flights[id]).filter((f) => f && f.status === 'done').pop();
        if (crewN && lastF?.ata !== undefined && d.release < lastF.ata) err('release', d.release, `duty ${d.id} released ${fmtDateTime(d.release)} before ${lastF.no} landed ${fmtDateTime(lastF.ata)}`);
        if (crewN && d.flightIds.some((id) => g.flights[id]?.status === 'done')) {
          if (d.fdp > d.maxFdp + disc + 1) err('fdp', d.release, `duty ${d.id} (${d.flightIds.map((id) => g.flights[id]?.no).join(' ')}) FDP ${hm(d.fdp)} over max ${hm(d.maxFdp)} + discretion ${hm(disc)}`);
          if (disc > (d.augment ? 3 * H : 2 * H)) err('fdp', d.release, `duty ${d.id} discretion ${hm(disc)} over the ${d.augment ? 3 : 2} h allowed`);
          if (d.split && d.maxFdp > 16 * H) err('fdp', d.release, `duty ${d.id} split duty max FDP ${hm(d.maxFdp)} over 16 h`);
          if (!d.augment && !d.split && d.maxFdp > 14 * H) err('fdp', d.release, `duty ${d.id} unaugmented max FDP ${hm(d.maxFdp)} over 14 h`);
          if (d.augment && d.maxFdp > 18 * H) err('fdp', d.release, `duty ${d.id} augmented max FDP ${hm(d.maxFdp)} over 18 h`);
          if (!d.augment && !d.ext && !d.split && d.maxFdp > 13 * H - Math.max(0, d.sectors - 2) * 30 + 1) err('fdp', d.release, `duty ${d.id} max FDP ${hm(d.maxFdp)} over Table 2 for ${d.sectors} sectors`);
          if (d.augment && !g.company.approvals.includes('augmented')) warn('approval', d.release, `duty ${d.id} augmented without the augmented-crew approval`);
        }
      }
    }
    for (const p of Object.values(g.pairings)) {
      if (p.status === 'done' || p.status === 'broken') continue;
      if (!p.dutyIds.length) warn('orphan', g.now, `pairing ${p.id} (${p.status}) has no duties`, `pe|${p.id}`);
      for (const id of p.dutyIds) if (!g.duties[id]) err('orphan', g.now, `pairing ${p.id} lists missing duty ${id}`, `pd|${p.id}|${id}`);
      for (const s of p.slots) if (s.crewId && !g.crew[s.crewId]) err('orphan', g.now, `pairing ${p.id} seat ${s.role} holds crew ${s.crewId} who left`, `pc|${p.id}|${s.crewId}`);
      if (p.aircraftId && !g.fleet[p.aircraftId] && p.dutyIds.some((id) => g.duties[id] && !g.duties[id].done)) err('orphan', g.now, `pairing ${p.id} on aircraft ${p.aircraftId} that is not in the fleet`, `pa|${p.id}`);
    }
    // ---- maintenance ----
    for (const m of Object.values(g.maintenance)) maint.set(m.id, { aircraftId: m.aircraftId, at: m.at, start: m.start, end: m.end, status: m.status, kind: m.kind });
    // ---- decisions, timed events ----
    for (const d of g.decisions) if (d.expires < g.now - 2 * H) err('decision', g.now, `decision "${d.title}" open ${Math.round((g.now - d.expires) / 60)} h past its expiry`, `dec|${d.id}`);
    for (const [id, p] of Object.entries(g.opsx?.pending ?? {})) if (p.t < g.now - 6 * H) err('ops-pending', g.now, `ops event ${id} (${p.kind}) due ${fmtDateTime(p.t)} never ran`, `op|${id}`);
    // ---- money ----
    const hs = g.finance.history;
    for (let i = 1; i < hs.length; i++) if (Math.abs(hs[i].cashStart - hs[i - 1].cashEnd) > 1) err('ledger', g.now, `statement ${hs[i].month} starts at ${hs[i].cashStart} but ${hs[i - 1].month} ended at ${hs[i - 1].cashEnd}`, `lg|${hs[i].month}`);
    if (hs.length && Math.abs(g.finance.current.cashStart - hs[hs.length - 1].cashEnd) > 1) err('ledger', g.now, `current statement starts at ${g.finance.current.cashStart} but ${hs[hs.length - 1].month} ended at ${hs[hs.length - 1].cashEnd}`, `lgc|${g.finance.current.month}`);
    if (!Number.isFinite(g.company.cash)) err('nan', g.now, `cash = ${g.company.cash}`);
    if (g.now - lastScan >= (opts.scanDays ?? 1) * DAY_MS) {
      lastScan = g.now;
      for (const p of badNumbers(g)) err('nan', g.now, `non-finite ${p}`);
    }
  }

  function finish(g: GameState): void {
    observe(g);
    const etops = etopsHeld(g);
    // ---- aircraft: flown legs chain, no overlap, maintenance apart, ETOPS ----
    const byAc = new Map<string, FlightRec[]>();
    for (const f of flights.values()) {
      if (!f.aircraftId || f.kind === 'deadhead' || f.operatedBy) continue;
      (byAc.get(f.aircraftId) ?? byAc.set(f.aircraftId, []).get(f.aircraftId)!).push(f);
      const typeId = typeOfAc.get(f.aircraftId);
      if (typeId) {
        const need = etopsNeeded(typeId, f.from, f.to);
        const ac = g.fleet[f.aircraftId];
        // Empty ferries (delivery, lease, return, sale) fly on a one-off ferry permit, as the game says for deliveries:
        // reported apart. The airframe's own ETOPS figure is not used by the game (company approval and type only).
        const ferry = f.kind === 'ferry' && !!f.purpose;
        if (need > etops) (ferry ? warn : err)(ferry ? 'etops-ferry' : 'etops', f.atd, `${f.no} ${f.from}–${f.to} (${f.kind}${f.purpose ? ` ${f.purpose}` : ''}) needs ETOPS ${need} (company ${etops}, airframe ${ac?.etops ?? '?'})`);
      }
    }
    for (const [acId, fl] of byAc) {
      fl.sort((a, b) => a.atd - b.atd);
      for (let i = 1; i < fl.length; i++) {
        const a = fl[i - 1];
        const b = fl[i];
        if (a.to !== b.from) err('ac-chain', b.atd, `${regOf.get(acId)}: ${a.no} landed ${a.to} ${fmtDateTime(a.ata)}, next ${b.no} left ${b.from} ${fmtDateTime(b.atd)}`);
        if (b.atd < a.ata) err('ac-overlap', b.atd, `${regOf.get(acId)}: ${b.no} left ${fmtDateTime(b.atd)} before ${a.no} landed ${fmtDateTime(a.ata)}`);
      }
      for (const m of maint.values()) {
        if (m.aircraftId !== acId || (m.status !== 'done' && m.status !== 'inWork')) continue;
        for (const f of fl) if (f.atd < m.end && f.ata > m.start) err('ac-maint', f.atd, `${regOf.get(acId)}: ${f.no} ${fmtDateTime(f.atd)}–${fmtDateTime(f.ata)} flew during ${m.kind}-check/maintenance ${fmtDateTime(m.start)}–${fmtDateTime(m.end)}`);
        const before = fl.filter((f) => f.ata <= m.start).pop();
        if (before && before.to !== m.at && m.kind !== 'AOG') err('ac-maint', m.start, `${regOf.get(acId)}: ${m.kind} at ${m.at} from ${fmtDateTime(m.start)} but it last landed at ${before.to}`);
      }
    }
    // ---- crew ----
    const etc = { rest: 0, restChecked: 0, unknown: 0 };
    for (const h of crew.values()) {
      const c = g.crew[h.id];
      const fl = h.flights.map((id) => flights.get(id)!).sort((a, b) => a.atd - b.atd);
      // Teleporting: consecutive legs chain by airport, never overlap (legs flown since the checker started; the
      // first one leaves from where they were then).
      const live = fl.filter((f) => f.ata > h.t0);
      for (let i = 0; i < live.length; i++) {
        const b = live[i];
        const a = live[i - 1];
        if (a && a.to !== b.from) err('teleport', b.atd, `${h.name}: landed ${a.to} on ${a.no} ${fmtDateTime(a.ata)}, then left ${b.from} on ${b.no} ${fmtDateTime(b.atd)}`);
        if (!a && b.from !== h.loc0 && b.atd > h.t0) err('teleport', b.atd, `${h.name}: was at ${h.loc0} ${fmtDateTime(h.t0)}, first leg ${b.no} left ${b.from}`);
        if (a && b.atd < a.ata) err('crew-twice', b.atd, `${h.name}: ${b.no} left ${fmtDateTime(b.atd)} before ${a.no} landed ${fmtDateTime(a.ata)}`);
        // Unavailable windows.
        for (const bl of h.blocks.values()) if (b.atd >= bl.from && b.atd < bl.to && bl.why !== 'joining' && !(bl.why === 'sick' && b.kind === 'deadhead')) err('blocked', b.atd, `${h.name} flew ${b.no} ${fmtDateTime(b.atd)} while ${bl.why} (${fmtDateTime(bl.from)}–${fmtDateTime(bl.to)})`);
        if (b.unrated?.includes(h.id)) {
          const typeId = typeOfAc.get(b.aircraftId ?? '') ?? 'a320ceo';
          err('rating', b.atd, `${h.name} operated ${b.no} on ${typeOf(typeId).short} without the ${typeOf(typeId).family} rating`);
        }
      }
      if (c && live.length) {
        const last = live[live.length - 1];
        if (last.to !== c.loc && last.ata <= g.now) err('teleport', g.now, `${h.name}: last flew ${last.no} to ${last.to} but is at ${c.loc}`, `tl|${h.id}`);
      }
      // Rest. Work items: logged duties and tickets, standby windows (uncalled to their end, called to the call).
      const log = [...h.log.values()].sort((a, b) => a.start - b.start);
      const sby = [...h.sby.values()].sort((a, b) => a.from - b.from);
      // Where the crew rested after work ending at t: the last leg they were on that landed inside it; unknown (null)
      // when no leg of theirs is on record for it (history from before the checker started).
      const restAt = (s: Minute, t: Minute): string | null => {
        let at: string | null = null;
        for (const f of fl) {
          if (f.ata > t + 1) break;
          if (f.ata >= s - 1) at = f.to;
        }
        return at;
      };
      for (let i = 1; i < log.length; i++) {
        const a = log[i - 1];
        const b = log[i];
        if (b.start < a.end - 1) {
          err('crew-overlap', b.start, `${h.name}: duty ${fmtDateTime(b.start)} starts before the previous one ends ${fmtDateTime(a.end)}`);
          continue;
        }
        const at = restAt(a.start, a.end);
        if (!at) {
          etc.unknown++;
          continue;
        }
        const home = at === h.base;
        const tz = home ? 0 : tzDiffH(h.base, at, a.end);
        const need = restNeeded(a.end - a.start, home, a.aug, tz, a.ext);
        // A standby between them: called for b → rest is needed before the standby only.
        const w = sby.find((s) => s.from >= a.end && s.from < b.start + 1);
        let gap = b.start - a.end;
        let what = 'duty';
        if (w) {
          gap = w.from - a.end;
          what = `${w.kind} standby${w.calledAt !== undefined ? ' (called out)' : ''}`;
        }
        etc.restChecked++;
        if (gap < need - 1) {
          etc.rest++;
          const tags = [a.aug ? 'augmented' : '', a.ext ? 'extended' : '', tz >= 4 ? `tz ${tz} h` : '', home ? 'home' : `away at ${at}`].filter(Boolean).join(', ');
          // ORO.FTL.235 sets the minimum rest before an FDP; a ticket (positioning only) after a short rest is duty, not
          // an FDP: reported apart (the rest before the next FDP counts from the end of the ticket).
          (b.sectors === 0 && !w ? warn : err)(b.sectors === 0 && !w ? 'rest-pos' : gap < 10 * H ? 'rest<10h' : 'rest', a.end, `${h.name}: ${hm(gap)} rest after ${hm(a.end - a.start)} duty ending ${fmtDateTime(a.end)} (needs ${hm(need)}; ${tags}) before ${what} ${fmtDateTime(w ? w.from : b.start)}`);
        }
      }
      // Rest after an uncalled standby before the next duty (12 h home / 10 h away; airport: its length; reserve: none).
      for (const w of sby) {
        if (w.calledAt !== undefined || w.kind === 'reserve') continue;
        const nx = log.find((e) => e.start >= w.from);
        if (!nx || nx.start >= w.to + 16 * H) continue;
        if (nx.start < w.to) {
          // Work inside an uncalled window: it should have been a call-out.
          if (nx.start > w.from) warn('sby-uncalled', nx.start, `${h.name}: duty ${fmtDateTime(nx.start)} inside an uncalled ${w.kind} standby ${fmtDateTime(w.from)}–${fmtDateTime(w.to)}`);
          continue;
        }
        const need = Math.max(w.kind === 'airport' ? w.to - w.from : 0, w.at === h.base ? 12 * H : 10 * H);
        if (nx.start - w.to < need - 1) warn('sby-rest', w.to, `${h.name}: ${hm(nx.start - w.to)} after an uncalled ${w.kind} standby ending ${fmtDateTime(w.to)} before work ${fmtDateTime(nx.start)} (engine rule ${hm(need)})`);
      }
      // Cumulative limits over the observed log (lower bound: standby counted by share).
      const items = [
        ...log.map((e) => ({ s: e.start, e: e.end, duty: e.end - e.start, block: e.block })),
        ...sby.map((w) => {
          const end = w.calledAt ?? w.to;
          const share = w.kind === 'airport' ? 1 : w.kind === 'reserve' ? 0 : 0.25;
          return { s: w.from, e: end, duty: Math.max(0, end - w.from) * share, block: 0 };
        }),
      ].sort((a, b) => a.s - b.s);
      const obsFrom = h.t0 + 28 * DAY;
      for (const it of items) {
        if (it.e < h.t0) continue;
        for (const [days, lim, key] of [[7, 60, 'duty7d'], [14, 110, 'duty14d'], [28, 190, 'duty28d']] as const) {
          if (it.e < h.t0 + days * DAY) continue;
          const from = it.e - days * DAY;
          const sum = items.reduce((s, x) => s + Math.max(0, Math.min(it.e, x.e) - Math.max(from, x.s)) * (x.e > x.s ? x.duty / (x.e - x.s) : 0), 0);
          if (sum > lim * H + 1) err('cumulative', it.e, `${h.name}: ${hm(Math.round(sum))} duty in ${days} days to ${fmtDateTime(it.e)} (limit ${lim} h, ${key})`, `cum|${h.id}|${key}`);
        }
        if (it.e >= obsFrom) {
          const from = it.e - 28 * DAY;
          const blk = log.filter((x) => x.end > from && x.end <= it.e).reduce((s, x) => s + x.block, 0);
          if (blk > 100 * H) err('cumulative', it.e, `${h.name}: ${hm(blk)} block in 28 days to ${fmtDateTime(it.e)} (limit 100 h)`, `cumb|${h.id}`);
        }
      }
      // Recurrent extended recovery rest (36 h with 2 local nights) at most 168 h apart.
      const work = items.filter((x) => x.e > x.s).map((x) => [x.s, x.e] as [number, number]);
      // (Training blocks are left out: the game models a course as one block, without its weekends.)
      work.sort((a, b) => a[0] - b[0]);
      let lastErr: Minute | null = null;
      let cur = -Infinity;
      for (const [s, e] of [...work, [g.now + 10 * DAY, g.now + 10 * DAY] as [number, number]]) {
        if (s > cur && cur > -Infinity) {
          const gapEnd = Math.min(s, g.now);
          if (gapEnd - cur >= 36 * H && localNights(h.base, cur, gapEnd) >= 2) {
            if (lastErr !== null && cur - lastErr > 168 * H + 1 && cur > h.t0 + 8 * DAY) err('recovery', cur, `${h.name}: ${hm(cur - lastErr)} between recovery rests (from ${fmtDateTime(lastErr)} to ${fmtDateTime(cur)}; limit 168 h)`);
            lastErr = gapEnd;
          }
        }
        if (s >= g.now) break;
        cur = Math.max(cur, e);
      }
      if (lastErr !== null && g.now - lastErr > 168 * H && cur < g.now && cur > lastErr + 168 * H) {
        // Still working at the end: the gap so far.
        err('recovery', g.now, `${h.name}: no recovery rest since ${fmtDateTime(lastErr)} (${hm(cur - lastErr)} of work span)`);
      }
    }
    // ---- operating crew numbers on flown legs ----
    for (const f of flights.values()) {
      if (f.kind === 'deadhead' || f.operatedBy || !f.aircraftId) continue;
      const roles = f.crewIds.map((id) => g.crew[id]?.role ?? crew.get(id)?.role).filter((r): r is Role => !!r);
      if (roles.length < f.crewIds.length) continue;
      const pilots = roles.filter((r) => ROLE_PILOT.has(r));
      if (pilots.length < 2 || !roles.includes('CPT')) err('crew-min', f.atd, `${f.no} ${f.from}–${f.to} flew with ${pilots.length} pilots${roles.includes('CPT') ? '' : ', no captain'}`);
      const typeId = typeOfAc.get(f.aircraftId);
      const ac = g.fleet[f.aircraftId];
      if (typeId && ac && f.kind === 'revenue') {
        // Mixed crews: the client's own cabin crew fly with ours (requirements.clientCabin).
        const cc = f.contractId ? g.contracts[f.contractId]?.requirements.clientCabin?.n ?? 0 : 0;
        const cabin = roles.length - pilots.length + cc;
        const min = cabinMinimum(typeId, ac.cabin.total) - (f.reducedCabin ?? 0);
        if (cabin < min) err('crew-min', f.atd, `${f.no} ${f.from}–${f.to} flew with ${cabin} cabin crew (minimum ${min} for ${ac.cabin.total} seats)`);
      }
    }
    summary = { restChecked: etc.restChecked, restShort: etc.rest, restUnknown: etc.unknown, flights: flights.size, crew: crew.size, steps, from: firstT ?? 0, to: lastT };
  }

  let summary = { restChecked: 0, restShort: 0, restUnknown: 0, flights: 0, crew: 0, steps: 0, from: 0, to: 0 };

  function print(label = 'invariants', max = 25): void {
    const by = new Map<string, Issue[]>();
    for (const e of errors) (by.get(e.code) ?? by.set(e.code, []).get(e.code)!).push(e);
    console.log(`\n== ${label}: ${errors.length} errors, ${warns.length} warnings (${summary.flights} legs, ${summary.crew} crew, ${summary.restChecked} rests checked (${summary.restUnknown} without legs on record), ${summary.steps} steps, ${fmtDateTime(summary.from)} → ${fmtDateTime(summary.to)})`);
    for (const [code, list] of [...by].sort()) {
      console.log(`  ERROR ${code} × ${list.length}`);
      for (const e of list.slice(0, max)) console.log(`    ${fmtDateTime(e.t)}  ${e.text}`);
    }
    const wb = new Map<string, Issue[]>();
    for (const e of warns) (wb.get(e.code) ?? wb.set(e.code, []).get(e.code)!).push(e);
    for (const [code, list] of [...wb].sort()) {
      console.log(`  warn ${code} × ${list.length}`);
      for (const e of list.slice(0, Math.min(max, 8))) console.log(`    ${fmtDateTime(e.t)}  ${e.text}`);
    }
  }

  /** One crew member's record (name substring), for reading an issue. */
  function dump(name: string): void {
    for (const h of crew.values()) {
      if (!h.name.includes(name)) continue;
      console.log(`--- ${h.name} base ${h.base}, first seen at ${h.loc0} ${fmtDateTime(h.t0)}`);
      const rows: [Minute, string][] = [];
      for (const e of h.log.values()) rows.push([e.start, `LOG  ${fmtDateTime(e.start)} → ${fmtDateTime(e.end)} ${hm(e.end - e.start)}${e.aug ? ' aug' : ''}${e.ext ? ' ext' : ''} sectors ${e.sectors}`]);
      for (const w of h.sby.values()) rows.push([w.from, `SBY  ${fmtDateTime(w.from)} → ${fmtDateTime(w.to)} ${w.kind} at ${w.at}${w.calledAt !== undefined ? ` called ${fmtDateTime(w.calledAt)}` : ''}`]);
      for (const b of h.blocks.values()) rows.push([b.from, `BLK  ${fmtDateTime(b.from)} → ${fmtDateTime(b.to)} ${b.why}`]);
      for (const id of h.flights) {
        const f = flights.get(id)!;
        rows.push([f.atd, `FLT  ${fmtDateTime(f.atd)} → ${fmtDateTime(f.ata)} ${f.no} ${f.from}–${f.to} ${f.kind}${f.riders.includes(h.id) ? ' rider' : ''}`]);
      }
      for (const [, r] of rows.sort((a, b) => a[0] - b[0])) console.log(`  ${r}`);
    }
  }

  return { observe, finish, print, dump, errors, warns, get summary() { return summary; } };
}

function hm(m: number): string {
  const s = m < 0 ? '-' : '';
  m = Math.abs(Math.round(m));
  return `${s}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Paths of non-finite numbers anywhere in the state (NaN, ±Infinity). */
export function badNumbers(o: unknown, path = 'g', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(`${path}=${o}`);
  } else if (Array.isArray(o)) o.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) {
    // Known sentinels: none expected; queue entries are checked like everything else.
    badNumbers(v, `${path}.${k}`, out);
  }
  return out;
}

// ---------- CLI ----------

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const flag = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const { deserialize } = await import('../src/engine/save');
  const { advanceTo } = await import('../src/engine/sim');
  const { createGame } = await import('../src/engine/newGame');
  const { acceptOffer, feasibilityAll } = await import('../src/engine/contracts');
  const { resolveDecision } = await import('../src/engine/ops');
  const mode = args[0];
  let g: GameState;
  let days: number;
  let take = false;
  if (mode === 'save') {
    g = deserialize(readFileSync(args[1], 'utf8'));
    days = Number(args[2] ?? 90);
  } else if (mode === 'seed') {
    g = createGame({ name: 'Debug Air', code: 'DB', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: flag('base') ?? 'LIS', seed: Number(args[1] ?? 1) });
    days = Number(args[2] ?? 120);
    take = true;
  } else {
    console.log('usage: invariants.ts save <file> [days] | seed <n> [days] [--base=LIS]  [--step=60] [--spy]');
    return;
  }
  const step = Number(flag('step') ?? 60);
  const inv = createChecker({ spy: process.argv.includes('--spy') });
  const end = g.now + days * DAY;
  const wall = performance.now();
  let nextPlay = g.now;
  inv.observe(g);
  while (g.now < end && !g.gameOver) {
    if (take && g.now >= nextPlay) {
      nextPlay = g.now + 6 * 60;
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
      const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
      for (const o of open.slice(0, 3)) {
        const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
        if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) break;
      }
    }
    try {
      advanceTo(g, Math.min(end, g.now + step));
    } catch (e) {
      console.log(`EXCEPTION at ${fmtDateTime(g.now)}: ${(e as Error).stack}`);
      break;
    }
    inv.observe(g);
  }
  inv.finish(g);
  console.log(`played to ${fmtDateTime(g.now)}${g.gameOver ? ` (game over: ${g.gameOver.reason})` : ''}, cash ${Math.round(g.company.cash)}, ${Object.keys(g.fleet).length} aircraft, ${Object.keys(g.crew).length} crew, ${((performance.now() - wall) / 1000).toFixed(1)} s`);
  inv.print(mode === 'save' ? `save ${args[1]}` : `seed ${args[1]}`);
  for (const n of (flag('dump') ?? '').split(',').filter(Boolean)) inv.dump(n.replace(/_/g, ' '));
}

if (process.argv[1] && /invariants\.ts$/.test(process.argv[1])) void main();
