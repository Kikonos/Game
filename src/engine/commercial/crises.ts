// v0.14 client crises (Update 2 "Commercial"): a strike at a client airline (pilots or cabin crew walk out), an
// airline going into administration, an engine type grounding part of a client's fleet for inspections (PW1100G GTF
// on the A320neo, PW1500G on the A220, Trent 1000 on the 787, Trent 7000 on the A330neo). Each is a world event
// (ops/world.ts: the Inbox news, the map pin, the event dialog) with its own work: urgent AOG cover and short wet
// leases for the hit airline or the airlines nearest it (regional urgent demand). An administration also hits our
// receivables: unpaid invoices are written off ('badDebt') and a claim in the administration pays a share months
// later. Crises start only on the event director's busy days, one at a time, weeks apart (the pace setting).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distance } from '../core/geo';
import { accrue, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { schedule } from '../core/queue';
import { chance, int, pick, range, weightedPick, type RngHolder } from '../core/rng';
import { DAY, fmtDay } from '../core/time';
import type { Client, ContractOffer, GameState, WorldEvent, WorldEventKind } from '../core/types';
import { closeOffer } from '../contracts/accept';
import { generateOffer } from '../contracts/offers';
import { statsV08 } from '../contracts/relations';
import { addShock } from '../ops/market';
import { isLive } from '../ops/world';
import { mkHurt, type ProblemCard } from '../problems/types';
import { busyNow, clientByName, com, comStats, paceOf, sideOf, usdK, withStream } from './state';
import type { Crisis, CrisisKind } from './types';

export const CRISIS = {
  /** Days between two crises by pace, and the chance on each busy day after that. */
  gap: { calm: 70, normal: 40, busy: 25 },
  chance: { calm: 0.05, normal: 0.08, busy: 0.12 },
  /** Not in a new game's first weeks. */
  calmStart: 45,
  weights: { strike: 0.45, grounding: 0.3, bankruptcy: 0.25 } as Record<CrisisKind, number>,
  /** An administration at most this often. */
  bankruptcyGap: 150,
  days: { strike: [4, 10], grounding: [60, 120], bankruptcy: [60, 60] } as Record<CrisisKind, [number, number]>,
  /** Share of the written-off debt the administrator pays back, and when (days). */
  claimPct: [0.1, 0.3] as [number, number],
  claimDays: [90, 150] as [number, number],
};

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const WORLD_KIND: Record<CrisisKind, WorldEventKind> = { strike: 'strike', bankruptcy: 'airlineFailure', grounding: 'engineCrisis' };

/** Unions by country: who walks out (pilots, cabin crew). */
const UNIONS: Record<string, [string, string]> = {
  DE: ['Vereinigung Cockpit', 'UFO'], PT: ['SPAC', 'SNPVAC'], ES: ['SEPLA', 'USO'], IE: ['IALPA', 'Fórsa'], FR: ['SNPL', 'SNPNC'],
  IT: ['ANPAC', 'Filt-CGIL'], GB: ['BALPA', 'Unite'], NL: ['VNV', 'FNV Cabine'], BE: ['BeCA', 'CNE'], SE: ['the Swedish pilots\' union', 'Unionen'],
  DK: ['the Danish pilots\' union', 'CAU'], NO: ['Norsk Flygerforbund', 'Parat'], GR: ['the pilots\' union', 'the cabin crew union'], PL: ['ZZPK', 'the cabin crew union'],
};

/** Engine programmes that ground fleets, and the airlines that fly them (first that exists in the game). */
const ENGINES: { engine: string; why: string; wide: boolean; clients: string[] }[] = [
  { engine: 'PW1100G (GTF)', why: 'Pratt & Whitney recalls more GTF engines for powder-metal disc inspections', wide: false, clients: ['Wizz Air', 'Aegean Airlines', 'flynas', 'flyadeal', 'Saudia', 'Lufthansa'] },
  { engine: 'PW1500G (A220)', why: 'Pratt & Whitney GTF inspections take A220 engines off wing for months', wide: false, clients: ['airBaltic', 'Croatia Airlines'] },
  { engine: 'CFM LEAP-1A', why: 'early LEAP-1A shop visits for fuel-nozzle and turbine blade wear', wide: false, clients: ['easyJet', 'TAP Air Portugal', 'Aer Lingus', 'Eurowings', 'Condor'] },
  { engine: 'Trent 1000', why: 'Rolls-Royce Trent 1000 blade inspections ground part of the 787 fleet', wide: true, clients: ['TUI Airways', 'LATAM Brasil'] },
  { engine: 'Trent 7000', why: 'Trent 7000 durability inspections take A330neos out of service', wide: true, clients: ['TAP Air Portugal', 'Condor'] },
];

/** How likely an airline is to fail (none for the big groups and state-backed flag carriers). */
const FRAGILE: Record<string, number> = {
  airBaltic: 2, 'Croatia Airlines': 1.5, 'Bulgaria Air': 2, 'TAP Air Portugal': 1, 'Air Sénégal': 2, 'TAAG Angola Airlines': 1.5, 'Air Algérie': 0.5,
  'Corendon Airlines': 1, 'Sunclass Airlines': 1.5, Condor: 1.5, 'Royal Jordanian': 1, 'GOL Linhas Aéreas': 1.5, 'Azul Brazilian Airlines': 1, Airlink: 1,
  'Biman Bangladesh Airlines': 1, 'Garuda Indonesia': 1.5, 'SAS Scandinavian Airlines': 1, 'Fiji Airways': 0.5, 'TUI fly Belgium': 0.6, 'Jet2.com': 0.3,
  Lufthansa: 0, Ryanair: 0, easyJet: 0, Saudia: 0, 'Air Canada': 0, 'LATAM Brasil': 0.3, 'Vietnam Airlines': 0.2, 'Wizz Air': 0.3, Eurowings: 0.3,
};

/** A client we work with (a job done, a contract, a relation, money owed): its crisis touches us. Pure. */
export function knowsUs(g: GameState, c: Client): boolean {
  return (c.jobs ?? 0) > 0 || c.relation >= 10 || Object.values(g.contracts).some((k) => k.clientId === c.id && (k.status === 'active' || k.status === 'signed'))
    || g.finance.receivables.some((r) => r.clientId === c.id && r.paid === null);
}

const flying = (g: GameState, c: Client) => Object.values(g.contracts).some((k) => k.clientId === c.id && (k.status === 'active' || k.status === 'signed'));
const openDebt = (g: GameState, c: Client) => g.finance.receivables.filter((r) => r.clientId === c.id && r.paid === null && !r.written).reduce((s, r) => s + r.amount, 0);

/** Airline clients a crisis may hit (never a rival operator, nor one already out). Weighted toward the ones we know and near home. */
function candidates(g: GameState, kind: CrisisKind): { c: Client; w: number; engine?: (typeof ENGINES)[number] }[] {
  const home = g.company.homeBase;
  const near = (c: Client) => (AIRPORT_BY_CODE[home] && distance(c.base, home) < 3000 ? 2 : 1) * (knowsUs(g, c) ? 3 : 1);
  const live = new Set(com(g).crises.filter((x) => g.now < x.end).map((x) => x.clientId));
  const ok = (c: Client | undefined): c is Client => !!c && c.kind === 'airline' && !c.rivalId && c.ceased === undefined && !live.has(c.id) && !!AIRPORT_BY_CODE[c.base];
  if (kind === 'grounding') {
    const out: { c: Client; w: number; engine: (typeof ENGINES)[number] }[] = [];
    for (const e of ENGINES) for (const name of e.clients) {
      const c = Object.values(g.clients).find((x) => x.name === name);
      if (ok(c)) out.push({ c, w: near(c), engine: e });
    }
    return out;
  }
  const all = Object.values(g.clients).filter(ok);
  if (kind === 'strike') return all.filter((c) => UNIONS[c.country]).map((c) => ({ c, w: near(c) }));
  // An administration: never a client we are flying for now; weighted by fragility and by what it owes us.
  return all.filter((c) => !flying(g, c)).map((c) => ({ c, w: (FRAGILE[c.name] ?? 0.3) * near(c) * (openDebt(g, c) > 0 ? 3 : 1) })).filter((x) => x.w > 0);
}

/** Daily: on a busy day, after the pace's gap, maybe a crisis; claims paid out; ended crises closed. */
export function dailyCrises(g: GameState): void {
  const c = com(g);
  for (const x of c.crises) {
    if (x.claim && !x.claim.paid && g.now >= x.claim.payAt) payClaim(g, x);
  }
  if (g.gameOver || g.now - g.started < CRISIS.calmStart * DAY || !busyNow(g)) return;
  if (c.crises.some((x) => g.now < x.end && x.kind !== 'bankruptcy') || c.crises.some((x) => x.kind === 'bankruptcy' && g.now < x.start + 14 * DAY)) return;
  const pace = paceOf(g);
  if (c.lastCrisis !== undefined && g.now - c.lastCrisis < CRISIS.gap[pace] * DAY) return;
  // The world's own cap: at most this many live events.
  if ((g.world?.events ?? []).filter((e) => isLive(g, e)).length >= BAL.v08.world.maxActive) return;
  const r = sideOf(g, `crisis:${Math.floor(g.now / DAY)}`);
  if (!chance(r, CRISIS.chance[pace])) return;
  const lastBk = c.crises.filter((x) => x.kind === 'bankruptcy').reduce((m, x) => Math.max(m, x.start), -Infinity);
  const kinds = (Object.keys(CRISIS.weights) as CrisisKind[]).filter((k) => k !== 'bankruptcy' || g.now - lastBk >= CRISIS.bankruptcyGap * DAY);
  const kind = weightedPick(r, kinds, (k) => CRISIS.weights[k]);
  if (kind) startCrisis(g, kind, undefined, r);
}

/** Starts a crisis of a kind (on a client, or a weighted one): the world event, its news, its work. Null when none fits. */
export function startCrisis(g: GameState, kind: CrisisKind, clientId?: string, r: RngHolder = sideOf(g, `crisis:${kind}:${g.now}:${com(g).crises.length}`)): Crisis | null {
  let cands = candidates(g, kind);
  if (clientId) cands = cands.filter((x) => x.c.id === clientId);
  const hit = weightedPick(r, cands, (x) => x.w);
  if (!hit) return null;
  const cl = hit.c;
  const [d0, d1] = CRISIS.days[kind];
  const days = int(r, d0, d1);
  const end = g.now + days * DAY;
  const x: Crisis = { id: nextId(g, 'cr'), kind, clientId: cl.id, eventId: '', start: g.now, end };
  let title = '';
  let body = '';
  let seg: 'narrow' | 'wide' = 'narrow';
  let delta = 0.04;
  if (kind === 'strike') {
    const cabin = chance(r, 0.4);
    const [p, cc] = UNIONS[cl.country] ?? ['', ''];
    const who = cabin ? 'cabin crew' : 'pilots';
    const union = cabin ? cc : p;
    title = `${cl.name} ${who} strike${union && !union.startsWith('the ') ? ` (${union})` : ''}`;
    body = `${cl.name}'s ${who} walk out until ${fmtDay(end)} over pay and rosters. ${cl.name} is cancelling flights and wants wet-leased aircraft with crews to keep its busiest routes flying.`;
  } else if (kind === 'grounding') {
    const e = hit.engine!;
    x.engine = e.engine;
    x.grounded = int(r, e.wide ? 2 : 4, e.wide ? 6 : 18);
    seg = e.wide ? 'wide' : 'narrow';
    delta = 0.08;
    title = `${cl.name} grounds ${x.grounded} aircraft: ${e.engine} inspections`;
    body = `${e.why[0].toUpperCase()}${e.why.slice(1)}. ${cl.name} has ${x.grounded} ${e.wide ? 'widebodies' : 'aircraft'} on the ground until about ${fmtDay(end)} and needs wet-leased cover now.`;
  } else {
    delta = 0.06;
    cl.ceased = g.now;
    title = `${cl.name} goes into administration`;
    body = `${cl.name} has stopped flying and filed for insolvency. Passengers are stranded; airlines near ${city(cl.base)} want aircraft to take over its routes.`;
  }
  const e: WorldEvent = {
    id: nextId(g, 'we'), kind: WORLD_KIND[kind], tpl: `crisis:${kind}`, title, body, country: cl.country, at: cl.base,
    start: g.now, end, offerIds: [], flightsHit: 0, ev: 0, entity: cl.name, workLeft: [],
  };
  x.eventId = e.id;
  const w = (g.world ??= { events: [] });
  w.events.push(e);
  if (w.events.length > 40) w.events.splice(0, w.events.length - 40);
  (w.lastKind ??= {})[e.kind] = g.now;
  statsV08(g).worldEvents++;
  schedule(g, e.end, 'world.end', e.id, 0);
  addShock(g, { seg, delta, until: kind === 'bankruptcy' ? g.now + 60 * DAY : end, text: title, eventId: e.id });
  const c = com(g);
  c.crises.push(x);
  if (c.crises.length > 30) c.crises.splice(0, c.crises.length - 30);
  c.lastCrisis = g.now;
  comStats(g).crises++;
  if (kind === 'bankruptcy') administration(g, x, cl, r);
  makeWork(g, x, e, cl, seg === 'wide');
  const ours = knowsUs(g, cl) || (x.written ?? 0) > 0;
  pushMessage(g, {
    tone: kind === 'bankruptcy' && x.written ? 'bad' : 'warn', cat: 'commercial', title, body: `${body}${x.written ? ` It owes us ${usdK(x.written)}: written off, and a claim is filed with the administrator.` : ''}`,
    ref: { kind: 'event', id: e.id },
    ...(ours ? { problem: { kind: 'clientCrisis' as const, ref: { kind: 'event' as const, id: e.id } }, cue: x.written ? 'clientCollapse' as const : 'worldEventOurs' as const } : { topic: 'world' as const }),
  });
  return x;
}

/** An administration: open receivables written off (bad debt), a claim filed; its open offers and tenders lapse. */
function administration(g: GameState, x: Crisis, cl: Client, r: RngHolder): void {
  let written = 0;
  for (const rc of g.finance.receivables) {
    if (rc.clientId !== cl.id || rc.paid !== null || rc.written) continue;
    written += rc.amount;
    rc.written = true;
    rc.paid = g.now;
    rc.desc = `${rc.desc} (written off: ${cl.name} in administration)`;
  }
  if (written > 0) {
    accrue(g, 'badDebt', -written);
    const pct = Math.round(range(r, CRISIS.claimPct[0], CRISIS.claimPct[1]) * 100) / 100;
    x.written = written;
    x.claim = { amount: Math.round(written * pct), payAt: g.now + int(r, CRISIS.claimDays[0], CRISIS.claimDays[1]) * DAY, pct };
    comStats(g).written += written;
  }
  for (const o of Object.values(g.offers)) if (o.clientId === cl.id && (o.status === 'open' || o.status === 'countered')) closeOffer(g, o, 'expired');
  for (const t of com(g).tenders) if (t.clientId === cl.id && (t.status === 'open' || t.status === 'closed')) t.status = 'withdrawn';
}

function payClaim(g: GameState, x: Crisis): void {
  const k = x.claim!;
  k.paid = g.now;
  if (k.amount <= 0) return;
  post(g, 'otherRevenue', k.amount);
  const name = g.clients[x.clientId]?.name ?? 'the airline';
  pushMessage(g, { tone: 'good', cat: 'finance', title: `The administrator of ${name} paid our claim`, body: `${usdK(k.amount)}: ${Math.round(k.pct * 100)} % of the ${usdK(x.written ?? 0)} written off.`, cue: 'paymentIn' });
}

/** The crisis's work: urgent cover and short wet leases for the airline (or, after an administration, its neighbours). */
function makeWork(g: GameState, x: Crisis, e: WorldEvent, cl: Client, wide: boolean): void {
  const nearest = Object.values(g.clients)
    .filter((c) => c.kind === 'airline' && c.id !== cl.id && !c.rivalId && c.ceased === undefined && AIRPORT_BY_CODE[c.base])
    .sort((a, b) => distance(a.base, cl.base) - distance(b.base, cl.base) || (a.id < b.id ? -1 : 1)).slice(0, 3);
  const r = sideOf(g, `work:${x.id}`);
  const jobs: (() => ContractOffer | null)[] = [];
  const cover = (client: string, w: boolean) => () => generateOffer(g, 'aogCover', { client, wide: w, window: false, start: g.now + int(r, 10, 36) * 60, paint: false, cabin: false });
  const lease = (client: string, w: boolean) => () => generateOffer(g, 'seasonBase', { client, wide: w, window: false, days: int(r, 30, 45), start: g.now + int(r, 4, 10) * DAY, paint: false, cabin: false });
  if (x.kind === 'strike') {
    jobs.push(cover(cl.id, false));
    if (chance(r, 0.6)) jobs.push(lease(cl.id, false));
  } else if (x.kind === 'grounding') {
    jobs.push(lease(cl.id, wide), cover(cl.id, wide));
  } else {
    jobs.push(() => generateOffer(g, 'repatriation', { airport: cl.base, wide: false, window: false }));
    for (const n of nearest.slice(0, 2)) jobs.push(lease(n.id, false));
  }
  jobs.forEach((make, i) => {
    const o = withStream(g, `cw:${x.id}:${i}`, make);
    if (!o) return;
    o.eventId = e.id;
    e.offerIds.push(o.id);
  });
}

// ---------- views and the card ----------

export const crisisOfEvent = (g: GameState, eventId: string): Crisis | undefined => com(g).crises.find((x) => x.eventId === eventId);

const KIND_WHAT: Record<CrisisKind, string> = { strike: 'Strike', bankruptcy: 'Administration', grounding: 'Engine grounding' };
export const crisisKindName = (k: CrisisKind) => KIND_WHAT[k];

/** The four-line card of a crisis touching us (what / why / does it hurt / what you can do). Pure. */
export function clientCrisisCard(g: GameState, eventId: string): ProblemCard | null {
  const x = crisisOfEvent(g, eventId);
  const e = (g.world?.events ?? []).find((v) => v.id === eventId);
  if (!x || !e || (e.done && !x.claim)) return null;
  const cl = g.clients[x.clientId];
  const name = cl?.name ?? 'A client';
  const offers = e.offerIds.filter((id) => g.offers[id] && (g.offers[id].status === 'open' || g.offers[id].status === 'countered'));
  const what = x.kind === 'strike' ? `${name} is on strike` : x.kind === 'grounding' ? `${name} has ${x.grounded} aircraft grounded` : `${name} has gone into administration`;
  const why = x.kind === 'strike' ? `${e.title.replace(`${name} `, '').replace(/^\w/, (m) => m.toUpperCase())}: they walked out over pay and rosters.`
    : x.kind === 'grounding' ? `${x.engine} inspections keep the engines off wing for months.`
    : 'It ran out of cash and stopped flying.';
  const hurtText = x.written ? `Yes: ${usdK(x.written)} it owed us is written off; the administrator may pay back about ${Math.round((x.claim?.pct ?? 0.2) * 100)} % by ${fmtDay(x.claim?.payAt ?? g.now)}`
    : offers.length ? `No: it means work for us (${offers.length} request${offers.length === 1 ? '' : 's'} open)` : 'No: nothing of ours is affected';
  return {
    subject: { kind: 'clientCrisis', ref: { kind: 'event', id: e.id } }, severity: x.written ? 'red' : 'amber', title: what, what, why,
    hurt: { ...mkHurt({ money: x.written ?? 0 }), level: x.written ? 'high' : 'none', text: hurtText },
    actions: [
      ...(offers.length ? [{ id: 'offers', label: 'See the requests', open: { tab: 'contracts' as const, view: 'market' }, primary: true }] : []),
      { id: 'event', label: 'The news', open: { modal: 'worldEvent' as const, id: e.id }, primary: !offers.length },
    ],
    details: [
      `${KIND_WHAT[x.kind]} from ${fmtDay(x.start)}${x.kind === 'bankruptcy' ? '' : ` to about ${fmtDay(x.end)}`}`,
      ...(x.claim ? [`Claim filed: ${usdK(x.claim.amount)} expected ${fmtDay(x.claim.payAt)}${x.claim.paid ? ' (paid)' : ''}`] : []),
      'Urgent requests pay a premium; they go to whoever answers first.',
    ],
    visuals: {}, terms: [], by: x.kind === 'bankruptcy' ? undefined : x.end,
  };
}

/** Dev: a crisis now ('strike' | 'bankruptcy' | 'grounding'; any client that fits). The event id ('' when none fits). */
export function devCrisis(g: GameState, kind: CrisisKind = 'strike', clientName?: string): string {
  const cl = clientName ? clientByName(g, clientName) : undefined;
  if (kind === 'grounding' && !clientName) {
    // Make sure one GTF operator exists (Wizz Air is a v0.14 issuer added on first use).
    clientByName(g, 'Wizz Air');
  }
  return startCrisis(g, kind, cl?.id, sideOf(g, `dev:${kind}:${g.now}:${pick(sideOf(g, 'x'), [0, 1, 2])}`))?.eventId ?? '';
}

export type { Crisis, CrisisKind };
export const crisisLive = (g: GameState, x: Crisis): boolean => g.now >= x.start && g.now < x.end;
export const crisesOf = (g: GameState): Crisis[] => com(g).crises;

/** Live crises touching us (the Inbox's problem list): a client we work with, or money written off. Pure. */
export function crisisProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const x of g.com?.crises ?? []) {
    const cl = g.clients[x.clientId];
    if (!cl || g.now >= x.end || !(knowsUs(g, cl) || x.written)) continue;
    const card = clientCrisisCard(g, x.eventId);
    if (card) out.push(card);
  }
  return out;
}
