// v0.8 more contract types (UPDATE-0.8.md §2): Hajj airlifts, UN multi-year rotations, presidential flights,
// deportation (a moral choice), war-zone evacuations, medical airbridges, music tours, Antarctica on blue ice,
// capacity leases (the exclusive reward), rivals hiring us (sub-charter in) and dry leases out. Builders return a
// Draft for offers.ts finalize; dry leases build their own offer (no flying of ours but the ferries).

import { ACMI_TYPES, rentForAge } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { fliesFamily } from '../../data/naming';
import { nextHajj } from '../../data/worldCalendar';
import { WORLD_ZONES } from '../../data/worldZones';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distanceNm } from '../core/geo';
import { cue } from '../core/cues';
import { pushMessage } from '../core/messages';
import { blockMinutes, complement, etopsCap, maxSectorNm, planSector, typeOf, usableRangeNm } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, next, pick, range, weightedPick } from '../core/rng';
import { DAY, fmtDay, fromUTC, toDate, yearOf } from '../core/time';
import type { CabinLayout } from '../../data/acmiTypes';
import type { Aircraft, Archetype, ApprovalId, Client, ContractOffer, GameState, LegTemplate, Minute, Requirements, Rival } from '../core/types';
import { segIndex } from '../ops/market';
import { isDisruptive, LIMITS, nightsIn } from '../crew/rules';
import { dutyNeed } from '../crew/duties';
import { restOf } from '../crew/restPlan';
import { closedAirport, warRiskAt } from '../ops/world';
import { acceptOffer } from './accept';
import { clientPrefix, clientsOf, ensureClient, ministry, roleOf } from './clients';
import * as F from './flavor';
import {
  airportsWithin, atLocal, city, generateOffer, hookFor, idleWindows, inMarket, km, listCities, nearClient, needsWide, newcomerNarrow, perks, pickN, pickStart, seasonBaseDraft, standingOf,
  type Ctx, type Draft, type IdleWindow,
} from './offers';
import { feasibility } from './feasibility';
import { sideRng } from './paintTerms';
import { computeWaves, programmeOf, route } from './plan';
import { defaultSeats } from './pricing';
import { warRiskCost } from './missionChecks';
import { levelOf } from './relations';
import { isActive } from './rivals';

const V = BAL.v08;
const month = (t: Minute) => toDate(t).getUTCMonth();
const anyWide = (g: GameState) => Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide');
const has = (g: GameState, a: ApprovalId) => g.company.approvals.includes(a) || g.company.pendingApprovals.some((p) => p.id === a);
const exists = (c: string) => !!AIRPORT_BY_CODE[c];
const EUROPE = new Set(['PT', 'ES', 'LT', 'LV', 'MT', 'DE', 'IE', 'SE', 'HR', 'FR', 'GB', 'CH', 'NO', 'IT', 'NL', 'BE', 'AT', 'DK', 'FI', 'PL', 'CZ', 'BG', 'EE', 'SK', 'RO', 'GR', 'CY', 'HU', 'SI', 'LU', 'IS']);


// ---------- Hajj (§2.1) ----------

const HAJJ_ORIGINS: Record<string, string[]> = {
  ID: ['CGK', 'SUB', 'KNO', 'UPG'], BD: ['DAC'], NG: ['ABV', 'KAN'], PK: ['ISB', 'LHE', 'KHI'], MA: ['CMN'], DZ: ['ALG'], SN: ['DSS'], MY: ['KUL'],
};
const HAJJ_CLIENTS = new Set(['Saudia', 'flynas', 'Royal Air Maroc']);

/** The Hajj whose tender is open now (Arafah − 180 … − 60 days), if any. Pure. */
export function hajjTender(t: Minute): ReturnType<typeof nextHajj>[number] | null {
  return nextHajj(t, 2).find((h) => t >= h.arafah - 180 * DAY && t <= h.arafah - 60 * DAY) ?? null;
}

function hajj(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  // v0.12 Scenarios: a given season and client (Hajj Airlift signs its airlifts before the start).
  const h = o.hajj ?? hajjTender(g.now);
  if (!h) return null;
  const client = (o.client && g.clients[o.client]) || nearClient({ ...ctx, window: undefined }, clientsOf(g, ['airline', 'government'], (c) => roleOf(c) === 'hajj' || HAJJ_CLIENTS.has(c.name)));
  if (!client) return null;
  // v0.8 fix pack: a Newcomer without a widebody flies its Hajj from origins a narrowbody reaches (North and West Africa).
  const narrowOnly = !ctx.wide && newcomerNarrow(g);
  const pool = (client.country === 'SA' ? Object.values(HAJJ_ORIGINS).flat() : HAJJ_ORIGINS[client.country] ?? [client.base]).filter((c) => exists(c) && (!narrowOnly || km(c, 'JED') <= 4500));
  const origin = o.airport ?? (pool.length ? pick(g, pool) : null);
  if (!origin) return null;
  const wide = ctx.wide || km(origin, 'JED') > 4500;
  // v0.8 fix pack: a max-seat all-economy cabin, every seat filled (the passengers are the seats): 180 on an A320,
  // 300–500 on a widebody (440 an A330-300's, 500 a 747-400's Hajj cabin). v0.8 pre-release: 300 most often (a 767's
  // 309Y and every A330/A340 take it, as the 300-seat ask before), the big cabins the rarer prize.
  const pax = wide ? weightedPick(g, [[300, 0.55], [330, 0.25], [440, 0.12], [500, 0.08]] as const, ([, w]) => w)![0] : 180;
  const legs: LegTemplate[] = [];
  const prefix = clientPrefix(client.name);
  let no = 3000 + int(g, 0, 50) * 10;
  const ref = wide ? 'a333' : 'a320ceo';
  const blk = (a: string, b: string) => blockMinutes(ref, a, b);
  // Real Hajj ACMI flies the aircraft hard (13–16 BH a day): a same-day turn at JED/MED when report + both sectors +
  // the turn fit a 13 h duty (16 h augmented on a widebody); longer sectors night-stop at the holy city and rotate every other day.
  const daily = 60 + blk(origin, 'JED') + blk('JED', origin) + 150 <= (wide ? 16 : 13) * 60;
  for (const [phase, inbound] of [[h.pre, true], [h.post, false]] as const) {
    for (let t = phase[0]; t + DAY <= phase[1]; t += daily ? DAY : 2 * DAY) {
      const holy = chance(g, 0.7) ? 'JED' : 'MED';
      const out = atLocal(origin, t, daily ? 8 * 60 : 10 * 60);
      const block = blk(origin, holy);
      const back = daily ? Math.ceil((out + block + 150) / 5) * 5 : Math.max(atLocal(holy, out + DAY, 14 * 60), out + block + 10 * 60);
      legs.push({ from: origin, to: holy, dep: out, flightNo: `${prefix}${no++}`, pax: inbound ? pax : 0 });
      legs.push({ from: holy, to: origin, dep: back, flightNo: `${prefix}${no++}`, pax: inbound ? 0 : pax });
    }
  }
  const mid = legs.findIndex((l) => l.dep >= h.post[0] - DAY && l.from === origin && (l.pax ?? 0) === 0);
  if (legs.length < 8 || mid < 2) return null;
  const june = month(h.post[1]) >= 5 && month(h.post[0]) <= 6;
  const first = legs[0].dep;
  const last = legs[legs.length - 1];
  // Terms end when the phase's last leg is on blocks (the panel and the blurb read the same days).
  const onBlocks = (l: LegTemplate) => l.dep + blk(l.from, l.to);
  const terms: [Minute, Minute][] = [[first, onBlocks(legs[mid - 1])], [legs[mid].dep, onBlocks(last)]];
  // MGH never above what the programme flies (the client pays for its own idle days, not for ours).
  const days = terms.reduce((s, [a, b]) => s + (b - a), 0) / DAY;
  const planned = (legs.reduce((s, l) => s + blk(l.from, l.to), 0) / 60 / Math.max(1, days)) * 30.44;
  const mgh = Math.max(100, Math.min(wide ? 300 : 240, Math.floor((planned * 0.95) / 10) * 10));
  const tn = (a: Minute, b: Minute) => `${fmtDay(a)} – ${fmtDay(b)}`;
  return {
    archetype: 'hajj', client,
    title: `Hajj ${h.ah} airlift ${origin}–JED/MED`,
    blurb: `About ${pax} pilgrims a flight. In: ${tn(...terms[0])}; home: ${tn(...terms[1])}. ` +
      `${daily ? 'One rotation a day, turning at the holy city' : 'A rotation every other day, night-stopping at the holy city'}; every other leg flies empty, and the client pays those hours too. Max-seat cabin, no alcohol on board, Zamzam water in the hold on the way home.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, layouts: ['all-economy'], extraCabin: 0, approvals: [], body: wide ? 'wide' : 'narrow' },
    start: first, end: last.dep + DAY, expiresIn: range(g, 5, 10) * DAY,
    wet: true, mult: V.arch.hajj[june ? 1 : 0], mghPerMonth: mgh, terms,
    effects: { morale: 2 }, risk: { disruption: 0.2, politics: 0.1, permit: 0.15 }, dueDays: client.kind === 'government' ? 30 : undefined,
    pin: 'JED', hook: hookFor(ctx),
  };
}

// ---------- UN multi-year rotations (§2.2) ----------

const TCC = ['DAC', 'KTM', 'ISB', 'ADD', 'KGL', 'ACC'];

function unRotation(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  if (standingOf(g) < 1) return null;
  const client = (o.client && g.clients[o.client]) || nearClient({ ...ctx, window: undefined }, clientsOf(g, ['government', 'agency'], (c) => /^UN (Department of Peace|World Food)/.test(c.name)));
  if (!client) return null;
  const tcc = o.airport ?? pick(g, TCC.filter(exists));
  const missions = [...new Set([...F.MISSION_AIRPORTS, ...Object.keys(F.MISSION_NAMES).filter((k) => F.MISSION_NAMES[k].org === 'UN')])].filter((c) => exists(c) && c !== tcc && km(c, tcc) > 800);
  if (!missions.length) return null;
  const mission = pick(g, missions);
  const months = int(g, 12, 24);
  const every = int(g, 28, 42);
  const n = Math.max(10, Math.min(24, Math.floor((months * 30.44) / every)));
  const s = o.start ?? pickStart(ctx, 30 * DAY, 90 * DAY, n * every * DAY);
  if (s === null) return null;
  const pax = wide ? int(g, 270, 300) : int(g, 160, 174);
  const legs: LegTemplate[] = [];
  for (let i = 0; i < n; i++) {
    const out = atLocal(tcc, s + i * every * DAY, 8 * 60);
    legs.push({ from: tcc, to: mission, dep: out, flightNo: '', pax });
    legs.push({ from: mission, to: tcc, dep: atLocal(mission, out + DAY, 9 * 60), flightNo: '', pax });
  }
  const last = legs[legs.length - 1];
  const ms = F.MISSION_NAMES[mission]?.name ?? `the mission at ${city(mission)}`;
  const y0 = toDate(legs[0].dep).getUTCFullYear();
  const y1 = toDate(last.dep).getUTCFullYear();
  return {
    archetype: 'unRotation', client,
    title: `UN rotations ${F.MISSION_NAMES[mission]?.name ?? city(mission)} ${y0}–${String(y1).slice(2)}`,
    blurb: `${client.name}: ${n} troop rotations ${city(tcc)}–${city(mission)} for ${ms}, one every ${every} days or so for ${months} months from ${fmtDay(legs[0].dep)}. ` +
      `Contingents of about ${pax} with 100 kg of baggage each; the UN registers only audited operators (IOSA) and pays 30 days after each invoice.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, layouts: ['all-economy'], extraCabin: 0, approvals: ['iosa'] },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: range(g, 7, 14) * DAY,
    effects: { morale: 2, clean: 1 }, risk: { disruption: 0.3, politics: 0.3, permit: 0.3 }, dueDays: 30,
    pin: mission, hook: hookFor(ctx),
  };
}

// ---------- presidential (§2.3; offers.ts vip calls it) ----------

export function presidential(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  if (standingOf(g) < 2) return null;
  const client = nearClient({ ...ctx, window: undefined }, clientsOf(g, ['government'], (c) => roleOf(c) === 'presidency' && exists(c.base)));
  if (!client) return null;
  const home = client.base;
  const wide = ctx.wide;
  const n = int(g, 1, 3);
  const span = Math.max(n + 1, int(g, 2, 10));
  const s = o.start ?? pickStart(ctx, 7 * DAY, 45 * DAY, span * DAY);
  if (s === null) return null;
  const pool = airportsWithin(home, 1500, wide ? 9000 : 4500, (a) => a.size >= 4 && a.biz >= 0.5);
  const dests = pickN(g, pool, n, (a) => a.biz * 3 + a.size).map((a) => a.code);
  if (dests.length < n) return null;
  const pax = int(g, 40, 90);
  const pts = [home, ...dests, home];
  const per = Math.max(1, Math.floor(span / (pts.length - 1)));
  const legs: LegTemplate[] = [];
  for (let i = 0; i < pts.length - 1; i++) legs.push({ from: pts[i], to: pts[i + 1], dep: atLocal(pts[i], s + i * per * DAY, 10 * 60), flightNo: '', pax });
  const last = legs[legs.length - 1];
  return {
    archetype: 'vip', client,
    title: `State visit: ${listCities(dests)}`,
    blurb: `${client.name}: a state visit ${pts.join('–')} for the President's delegation of ${pax}. VIP cabin, no fuel stops, a spare pilot, vetted crew; programme changes are likely.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, layouts: ['vip'] as CabinLayout[], extraCabin: int(g, 3, 4), noTechStops: true, approvals: [], extraPilot: 1, standards: 'vip', ...(wide && needsWide(legs) ? { body: 'wide' as const } : {}) },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: range(g, 3, 7) * DAY,
    mult: V.arch.presidential, effects: { clean: 1, reliable: 1 }, risk: { disruption: 0.3, politics: 0.3, permit: 0.2 }, dueDays: 30,
    hook: hookFor(ctx),
  };
}

// ---------- deportation (§2.4) ----------

const DEPORT_DESTS = ['LOS', 'ACC', 'TIA', 'ISB', 'LHE', 'DAC', 'ALG', 'CMN', 'FIH'];

function deportation(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const client = (o.client && g.clients[o.client]) || nearClient({ ...ctx, window: undefined }, clientsOf(g, ['government', 'agency'], (c) => (roleOf(c) === 'interior' || c.name === 'Frontex') && exists(c.base)));
  if (!client) return null;
  const from = client.base;
  const dests = DEPORT_DESTS.filter((c) => exists(c) && km(from, c) > 1500 && (wide || km(from, c) < 5500));
  const dest = o.airport ?? (dests.length ? pick(g, dests) : null);
  if (!dest) return null;
  const n = int(g, 2, 6);
  const span = int(g, 30, 90);
  const s = o.start ?? pickStart(ctx, 10 * DAY, 45 * DAY, span * DAY);
  if (s === null) return null;
  const pax = wide ? int(g, 80, 160) : int(g, 40, 120);
  const legs: LegTemplate[] = [];
  const step = n > 1 ? Math.floor(span / (n - 1)) : 0;
  // On board: the returnees and about 40 escorts and officials (v0.8 fix pack: they all have a seat).
  const onBoard = pax + 40;
  for (let i = 0; i < n; i++) legs.push({ from, to: dest, dep: atLocal(from, s + i * step * DAY, int(g, 12, 18) * 30), flightNo: '', pax: onBoard });
  const last = legs[legs.length - 1];
  return {
    archetype: 'deportation', client,
    title: `Return flights ${city(from)}–${city(dest)}`,
    blurb: `${client.name}: a framework of ${n} charter flights ${from}–${dest} over the next ${span} days for about ${pax} people being returned, with around 40 escorts and officials on board. ` +
      `One way each time; we come back empty. Well paid; some crews will refuse to fly it, and the press may notice.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: onBoard, extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: range(g, 4, 8) * DAY,
    mult: V.arch.deportation, effects: { morale: V.deport.morale }, risk: { disruption: 0.4, politics: 0.6, permit: 0.2 }, dueDays: 30,
    pin: dest, hook: hookFor(ctx),
  };
}

/** Expected clean hit of a deportation offer (the moral panel): −2 a flight with returnees, capped −10. Pure. */
export function deportationCleanHit(o: Pick<ContractOffer, 'archetype' | 'pattern'>): number {
  if (o.archetype !== 'deportation' || o.pattern.kind !== 'legs') return 0;
  const n = o.pattern.legs.filter((l) => (l.pax ?? 0) > 0).length;
  return Math.max(V.deport.cleanCap, n * V.deport.cleanPerLeg);
}

// ---------- evacuation (§2.5) ----------

function evacuation(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  // A ministry charters what the operator has: a widebody only when we fly one.
  const wide = ctx.wide && (!Object.keys(g.fleet).length || Object.values(g.fleet).some((a) => a.cabin.total >= 250));
  // v0.12.1 never a staging pair another event has closed (an event's own evacuation names its airport).
  const pairs = WORLD_ZONES.flatMap((z) => z.staging ?? []).filter(([a, b]) => exists(a) && exists(b) && (!!o.airport || (!closedAirport(g, a, g.now) && !closedAirport(g, b, g.now))));
  const pair: [string, string] | undefined = o.airport && o.staging ? [o.airport, o.staging] : o.airport ? pairs.find(([a]) => a === o.airport) : pick(g, pairs);
  if (!pair) return null;
  const [x, hub] = pair;
  const foreign = clientsOf(g, ['government'], (c) => roleOf(c) === 'foreign' && exists(c.base));
  // v0.12.1 only a government charters an evacuation.
  const asked = o.client && g.clients[o.client]?.kind === 'government' ? g.clients[o.client] : undefined;
  const client = asked || (chance(g, 0.5) ? ministry(g, 'Foreign Affairs') : nearClient({ ...ctx, window: undefined }, foreign)) || ministry(g, 'Foreign Affairs');
  if (!client) return null;
  const capital = client.base;
  const n = int(g, 2, 6);
  const typeRef = wide ? 'a333' : 'a320ceo';
  const b = blockMinutes(typeRef, hub, x);
  const back = blockMinutes(typeRef, x, hub);
  let t = o.start ?? atLocal(hub, g.now + int(g, 12, 48) * 60, int(g, 12, 32) * 30);
  if (t < g.now + 10 * 60) t += DAY;
  // Never an evacuation no aircraft of ours could reach in time: ferry at cruise (+15 %, a fuel stop per range
  // hop) plus 6 h to find a crew and get going; the client waits up to 3 days for the nearest one.
  // v0.8 fix pack: seats = passengers (each shuttle full). v0.8 pre-release: a widebody shuttle 240–265 (the old 250-seat
  // ask, which a two-class 767-300 takes), not 260–300.
  const pax = wide ? int(g, 240, 265) : int(g, 150, 178);
  const minSeats = pax;
  const fleet = Object.values(g.fleet).filter((a) => a.cabin.total >= minSeats && a.status !== 'leasedOut' && AIRPORT_BY_CODE[a.at]);
  if (Object.keys(g.fleet).length && o.start === undefined) {
    const atlantic = (a: string, b: string) => (AIRPORT_BY_CODE[a].lon < -30) !== (AIRPORT_BY_CODE[b].lon < -30);
    const travel = (a: (typeof fleet)[number]) => {
      const T = typeOf(a.typeId);
      const nm = distanceNm(a.at, hub);
      // An ocean crossing needs ETOPS 180 (type and approval) on a twin that can't make it in one hop.
      // v0.12.1 the usable range (perf.usableRangeNm), as every other range decision.
      const reach = usableRangeNm(a.typeId);
      if (atlantic(a.at, hub) && nm > reach && (T.etopsMax < 180 || !g.company.approvals.includes('etops180'))) return Infinity;
      return (nm / T.cruiseKt) * 60 * 1.15 + Math.floor(nm / reach) * 90 + 6 * 60;
    };
    const soonest = Math.min(Infinity, ...fleet.map(travel));
    if (soonest > 72 * 60) return null;
    if (t < g.now + soonest) t = Math.ceil((g.now + soonest) / 30) * 30;
  }
  const legs: LegTemplate[] = [];
  for (let i = 0; i < n; i++) {
    legs.push({ from: hub, to: x, dep: t, flightNo: '', pax: 0 });
    const dep = t + b + 75;
    legs.push({ from: x, to: hub, dep, flightNo: '', pax });
    t = Math.ceil((dep + back + 60) / 15) * 15;
  }
  // Home to the capital only when the type reaches it non-stop; else the ministry books scheduled flights from the hub.
  const home = capital !== hub && distanceNm(hub, capital) <= maxSectorNm(typeRef, hub, capital);
  if (home) legs.push({ from: hub, to: capital, dep: t + 60, flightNo: '', pax });
  const level = Math.max(2, warRiskAt(g, x));
  const cover = warRiskCost(level, wide) * n;
  const last = legs[legs.length - 1];
  return {
    archetype: 'evacuation', client,
    title: `Evacuation ${city(x)}–${city(hub)}`,
    blurb: `${client.name}: ${n} shuttles ${city(hub)}–${city(x)} to bring out about ${pax * n} citizens, ${home ? `then ${city(hub)}–${city(capital)}` : `who fly home from ${city(hub)} on scheduled flights`}. First departure ${fmtDay(legs[0].dep)}. ` +
      `No night stop at ${city(x)} (2 h on the ground at most); war-risk cover ${n} × $${Math.round(cover / n / 1000)}K is in the price and can be withdrawn at short notice.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats, extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: Math.min(int(g, 4, 10) * 60, Math.max(90, legs[0].dep - g.now - 6 * 60)),
    mult: V.arch.evacuation, passThrough: cover, effects: { morale: 6, clean: 3, reliable: 1 }, risk: { disruption: 0.6, politics: 0.5, permit: 0.4 }, dueDays: 30,
    pin: x, hook: hookFor(ctx), eventId: o.eventId,
  };
}

// ---------- medical airbridge (§2.6) ----------

const HOSPITALS = ['NBO', 'JNB', 'CAI', 'AMM', 'IST', 'GVA', 'FRA', 'LHR', 'DXB', 'ADD', 'CPT', 'BRU', 'MAD'];

function medical(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  const client = (o.client && g.clients[o.client]) || nearClient({ ...ctx, window: undefined }, clientsOf(g, ['agency'], (c) => (roleOf(c) === 'health' || /ECHO/.test(c.name)) && exists(c.base)));
  if (!client) return null;
  const origin = o.airport ?? pick(g, F.CRISIS_AIRPORTS.filter(exists));
  const hs = HOSPITALS.filter((c) => exists(c) && km(origin, c) > 800 && km(origin, c) < (ctx.wide ? 9000 : 5000));
  const hospital = weightedPick(g, hs, (c) => 1 / (1 + km(origin, c) / 1000));
  if (!hospital) return null;
  const n = int(g, 1, 2);
  const stretchers = int(g, 4, 12);
  const sitting = int(g, 30, 80);
  const team = 14;
  const pax = sitting + team;
  let t = o.start ?? atLocal(origin, g.now + int(g, 24, 120) * 60, int(g, 16, 30) * 30);
  if (t < g.now + 12 * 60) t += DAY;
  const legs: LegTemplate[] = [];
  for (let i = 0; i < n; i++) {
    legs.push({ from: origin, to: hospital, dep: t, flightNo: '', pax });
    if (i < n - 1) {
      const b = blockMinutes('a320ceo', origin, hospital);
      legs.push({ from: hospital, to: origin, dep: t + b + 120, flightNo: '', pax: team });
      t = t + 2 * b + 240;
    }
  }
  const last = legs[legs.length - 1];
  return {
    archetype: 'medical', client,
    title: `Medical airbridge ${city(origin)}–${city(hospital)}`,
    blurb: `${client.name}: an airbridge ${origin}–${hospital} for ${stretchers} stretcher patients and ${sitting} sitting patients with a medical team of ${team}. ` +
      `Medical oxygen on board (dangerous goods approval); each stretcher takes six seats; one extra cabin crew member.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax + 6 * stretchers, extraCabin: 1, approvals: ['dg'], stretchers },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: Math.min(int(g, 6, 24) * 60, Math.max(90, legs[0].dep - g.now - 6 * 60)),
    mult: V.arch.medical, effects: { morale: 5, clean: 3 }, risk: { disruption: 0.4, politics: 0.2, permit: 0.3 }, dueDays: 30,
    pin: origin, hook: hookFor(ctx), eventId: o.eventId,
  };
}

// ---------- humanitarian (§5, world events only) ----------

function humanitarian(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  const dest = o.airport;
  if (!dest || !exists(dest)) return null;
  const client = (o.client && g.clients[o.client]) || nearClient({ ...ctx, window: undefined }, clientsOf(g, ['agency', 'government'], (c) => roleOf(c) === 'aid' && exists(c.base)));
  if (!client) return null;
  const hubs = [client.base, 'DXB', 'BRU', 'FCO', 'GVA', 'NBO'].filter((c) => exists(c) && c !== dest && km(c, dest) > 600 && km(c, dest) < (ctx.wide ? 9000 : 5000));
  if (!hubs.length) return null;
  const hub = hubs[0];
  const n = int(g, 1, 3);
  let t = atLocal(hub, g.now + int(g, 12, 48) * 60, int(g, 16, 30) * 30);
  if (t < g.now + 10 * 60) t += DAY;
  const b = blockMinutes('a320ceo', hub, dest);
  const legs: LegTemplate[] = [];
  for (let i = 0; i < n; i++) {
    legs.push({ from: hub, to: dest, dep: t, flightNo: '', pax: int(g, 30, 80) });
    t = Math.ceil((t + 2 * b + 4 * 60) / 15) * 15;
  }
  const last = legs[legs.length - 1];
  const sar = o.variant === 'group';
  return {
    archetype: 'humanitarian', client,
    title: `Relief flights to ${city(dest)}`,
    blurb: `${client.name}: ${n} relief flight${n > 1 ? 's' : ''} ${hub}–${dest} with ${sar ? 'search-and-rescue teams, dogs and their gear' : 'aid workers, tents and medical supplies'}. We come back empty; the client pays after the job.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: Math.max(...legs.map((l) => l.pax ?? 0)), extraCabin: 0, approvals: sar ? ['dg'] : [] },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: Math.min(int(g, 6, 18) * 60, Math.max(90, legs[0].dep - g.now - 6 * 60)),
    mult: V.arch.humanitarian, effects: { morale: 5, clean: 3 }, risk: { disruption: 0.4, politics: 0.2, permit: 0.3 }, dueDays: 45,
    pin: dest, hook: hookFor(ctx), eventId: o.eventId,
  };
}

// ---------- music tours (§2.7) ----------

function musicTour(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const client = nearClient(ctx, clientsOf(g, ['music'], (c) => exists(c.base)));
  if (!client) return null;
  const eu = (a: Airport) => a.continent === 'EU' && a.size >= 3;
  const base = wide ? client.base : AIRPORT_BY_CODE[client.base]?.continent === 'EU' ? client.base : pick(g, ['LHR', 'AMS', 'CDG', 'FRA', 'MAD'].filter(exists));
  const nCities = int(g, 5, 9);
  const pts = [base];
  for (let i = 0; i < nCities; i++) {
    const prev = pts[pts.length - 1];
    const cands = wide
      ? AIRPORTS.filter((a) => a.size >= 4 && !pts.includes(a.code) && a.runwayM >= 2800 && km(prev, a.code) >= 1500 && km(prev, a.code) <= 9000)
      : airportsWithin(prev, 300, 2500, (a) => eu(a) && !pts.includes(a.code) && !pts.some((p) => city(p) === a.city));
    const nx = weightedPick(g, cands, (a) => a.size + a.biz * 2);
    if (!nx) break;
    pts.push(nx.code);
  }
  if (pts.length < 6) return null;
  const stops = pts.length - 1;
  // A day or two between shows: the aircraft stays with the tour (a 48 h gap would send it home between cities).
  const gaps = pts.slice(1).map(() => int(g, 1, 2));
  const total = gaps.reduce((s, x) => s + x, 0) + 1;
  if (total > 42) return null;
  const s = o.start ?? pickStart(ctx, 14 * DAY, 60 * DAY, (total + 1) * DAY);
  if (s === null) return null;
  const pax = int(g, 80, 140);
  const legs: LegTemplate[] = [];
  let t = atLocal(pts[0], s, int(g, 20, 26) * 30);
  for (let i = 0; i < stops; i++) {
    legs.push({ from: pts[i], to: pts[i + 1], dep: t, flightNo: '', pax });
    t = Math.min(atLocal(pts[i + 1], t + gaps[i] * DAY, int(g, 20, 26) * 30), t + 47 * 60);
  }
  legs.push({ from: pts[stops], to: base, dep: t, flightNo: '', pax });
  const days = Math.round((t - legs[0].dep) / DAY);
  const last = legs[legs.length - 1];
  const paint = chance(sideRng(g, `tourpaint:${g.seq}:${g.now}`), 0.3);
  return {
    archetype: 'musicTour', client,
    title: `${wide ? 'World' : 'European'} tour: ${stops} shows`,
    blurb: `${client.name}: the ${wide ? 'world' : 'European'} leg of a stadium tour, ${stops} shows in ${days} days (${pts.slice(1).join(', ')}). Band, crew and guests, ${pax} passengers; ` +
      `the aircraft stays with the tour between shows${paint ? '; their logo on the aircraft if you agree' : ''}.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, layouts: ['two-class', 'three-class', 'vip'], minPremium: wide ? 24 : 12, extraCabin: int(g, 1, 2), approvals: [], ...(wide && needsWide(legs) ? { body: 'wide' as const } : {}) },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: range(g, 4, 8) * DAY,
    mult: V.arch.music, extraBH: V.arch.musicIdleBH * Math.max(0, days - legs.length), effects: { morale: 3 }, risk: { disruption: 0.3, politics: 0, permit: 0.1 },
    ...(paint ? { paint: { kind: 'decals' as const, required: false } } : {}),
    hook: hookFor(ctx),
  };
}

// ---------- Antarctica (§2.8) ----------

const POLAR: Record<string, [string, string]> = {
  'White Desert': ['CPT', 'WFR'], 'Norwegian Polar Institute (DROMLAN)': ['CPT', 'TRL'], 'Antarctic Logistics & Expeditions': ['PUQ', 'UGL'],
};

function antarctic(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  if (standingOf(g) < 1) return null;
  const client = nearClient({ ...ctx, window: undefined }, clientsOf(g, ['tourOperator', 'government', 'agency'], (c) => !!POLAR[c.name]));
  if (!client) return null;
  const [base, ice] = POLAR[client.name];
  if (!exists(base) || !exists(ice)) return null;
  const y = toDate(g.now).getUTCFullYear() + (month(g.now) >= 10 ? 1 : 0);
  const n = int(g, 4, 8);
  const s = o.start ?? fromUTC(y, 11, int(g, 5, 25));
  if (s < g.now + 30 * DAY) return null;
  const pax = int(g, 40, 110);
  const b = blockMinutes('a333', base, ice);
  const legs: LegTemplate[] = [];
  // Flights every day or two: the aircraft stays at the gateway for the run (a gap of 48 h would send it home).
  let day = s;
  for (let i = 0; i < n; i++) {
    const out = atLocal(base, day, 6 * 60);
    day = out + int(g, 1, 1 + (i % 2)) * DAY;
    legs.push({ from: base, to: ice, dep: out, flightNo: '', pax });
    legs.push({ from: ice, to: base, dep: out + b + 150, flightNo: '', pax });
  }
  const last = legs[legs.length - 1];
  const rt = Math.round(2 * distanceNm(base, ice)).toLocaleString('en-US');
  return {
    archetype: 'antarctic', client,
    title: `Antarctic flights to ${city(ice)}`,
    blurb: `${client.name}: ${n} same-day out-and-backs ${city(base)}–${city(ice)} on blue ice from ${fmtDay(legs[0].dep)}, guests and scientists, about ${pax} a flight. ` +
      `No fuel on the ice: ${base}–${ice}–${base} is ${rt} nm without refuelling. A widebody, polar training and kit; whiteouts send flights back to try the next day.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: pax, families: ['A330/340', 'B757/767', 'B777'], extraCabin: 0, approvals: ['polar'], roundTrip: true, noTechStops: true, body: 'wide' },
    start: legs[0].dep, end: last.dep + 8 * 60, expiresIn: range(g, 7, 14) * DAY,
    mult: V.arch.antarctic, effects: { morale: 4, clean: 1 }, risk: { disruption: 0.4, politics: 0, permit: 0.1 },
    pin: ice, hook: hookFor(ctx),
  };
}

// ---------- capacity lease (§2.10) ----------

function capacityLease(ctx: Ctx): Draft | null {
  const { g } = ctx;
  const partners = clientsOf(g, ['airline'], (c) => levelOf(g, c) === 'partner');
  if (standingOf(g) < 2 && !partners.length) return null;
  const client = partners.length && (standingOf(g) < 2 || chance(g, 0.5)) ? nearClient({ ...ctx, window: undefined }, partners) : undefined;
  const days = int(g, 180, 365);
  const d = seasonBaseDraft({ ...ctx, o: { ...ctx.o, client: client?.id ?? ctx.o.client, days } });
  if (!d) return null;
  const wide = ctx.wide;
  const fam = wide ? 'widebody' : d.req.families?.[0] === 'B737' ? '737' : 'A320';
  d.archetype = 'capacityLease';
  d.mult = V.arch.capacity;
  // v0.14 a widebody capacity lease guarantees 330 BH (was 280: under the 300 of any widebody wet lease now).
  d.mghPerMonth = wide ? 330 : 220;
  if (d.pattern.kind === 'base') d.pattern.targetBH = Math.round(d.mghPerMonth * 1.15);
  const mon = (t: Minute) => fmtDay(t).replace(/^\d+ /, '');
  d.title = `Capacity lease: one ${fam} for ${d.client.name}, ${mon(d.start)}–${mon(d.end)}`;
  d.blurb = `${d.client.name} wants one ${fam} on a capacity lease for ${Math.round(days / 30.44)} months from ${fmtDay(d.start)}: ` +
    `their schedule from ${d.pattern.kind === 'base' ? city(d.pattern.base) : 'their hub'}, MGH ${d.mghPerMonth} BH a month at a long-term rate. Only for operators they trust.`;
  return d;
}

// ---------- sub-charter in (§3.5) ----------

/** A rival hires us: AOG cover now, or overflow work in 2–4 weeks, at an end client's base. */
function subcharterIn(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  const rival = g.rivals.find((r) => r.id === o.rival);
  const client = rival?.clientId ? g.clients[rival.clientId] : undefined;
  const end = o.endClient ? g.clients[o.endClient] : undefined;
  if (!rival || !client || !end || !exists(end.base)) return null;
  const w = ctx.window;
  const aog = o.variant !== 'oneway';
  const base = end.base;
  const days = aog ? int(g, 3, 7) : int(g, 14, 28);
  let start = o.start ?? (aog ? Math.max(g.now + int(g, 8, 30) * 60, w?.from ?? 0) : Math.max(g.now + int(g, 14, 28) * DAY, w?.from ?? 0));
  start = Math.ceil(start / 60) * 60;
  if (w && start + days * DAY > w.to) return null;
  const wide = ctx.wide;
  // The end client's own market, never a war zone.
  const pool = wide ? airportsWithin(base, 2500, 7000, (a) => a.size >= 3 && inMarket(end, a)) : airportsWithin(base, 400, 2500, (a) => a.size >= 2 && inMarket(end, a));
  const dests = pickN(g, pool, wide ? 1 : int(g, 2, 3), (a) => a.size + a.tour).map((a) => a.code);
  if (!dests.length) return null;
  const waves = computeWaves(base, dests, wide ? 'a333' : 'a320ceo', wide ? 1 : 2);
  const mghPerMonth = Math.round((wide ? 10 : 8) * 30.44);
  return {
    archetype: 'subcharterIn', client,
    title: aog ? `Cover for ${rival.name}: ${end.name} at ${city(base)}` : `Overflow for ${rival.name}: ${end.name} at ${city(base)}`,
    blurb: aog
      ? `${rival.name} has ${wide ? 'a widebody' : 'an aircraft'} AOG and needs cover for ${end.name}: ${[base, ...dests].join('–')} for ${days} days from ${fmtDay(start)}, ${end.name} flight numbers, 'operated by' notices. ${rival.name} pays us; the passengers never learn our name.`
      : `${rival.name} is full and passes on ${days} days of ${end.name} flying from ${city(base)} (${listCities(dests)}) from ${fmtDay(start)}. ${rival.name} pays us at a fair rate; ${end.name}'s flight numbers.`,
    pattern: { kind: 'base', base, dests, from: start, to: start + days * DAY, targetBH: Math.round(mghPerMonth * 1.08), waves, prefix: clientPrefix(end.name), maintEvery: 7 },
    req: { minSeats: wide ? 250 : 150, extraCabin: 0, approvals: [], ...(wide ? { body: 'wide' as const } : {}) },
    start, end: start + days * DAY, expiresIn: aog ? Math.min(int(g, 3, 8) * 60, Math.max(60, start - g.now - 90)) : range(g, 2, 4) * DAY,
    wet: true, mult: aog ? range(g, 1.3, 1.6) : range(g, 1.1, 1.2), mghPerMonth,
    effects: { reliable: 1 }, risk: { disruption: 0.3, politics: 0, permit: 0 }, hook: hookFor(ctx), pin: base,
  };
}

// ---------- world tours (v0.12.1) ----------

/**
 * A round-the-world tour by private jet as the real operators sell them (Les Voyages de TMR's 'Tour du monde en avion
 * privé', 51st tour 16 Nov – 6 Dec 2026: Paris, Rio, Iguaçu, Easter Island, Papeete, Sydney, Siem Reap, Ha Long Bay,
 * Samarkand, Paris; Abercrombie & Kent's and Kuoni's round-the-world journeys): a gateway, then stops in route
 * order, each a few real choices (the first is the classic). `opt` stops come with that chance. Flown westbound as
 * listed or eastbound in reverse. Every stop takes a widebody (perf.runwayFit) and every leg a twin with ETOPS 180.
 */
export interface TourTpl { client: string; gateway: string; name: string; stops: { at: string[]; opt?: number }[] }

export const WORLD_TOURS: readonly TourTpl[] = [
  {
    client: 'Les Voyages de TMR', gateway: 'CDG', name: 'Tour du monde en avion privé',
    stops: [{ at: ['GIG'] }, { at: ['IGU'] }, { at: ['LIM'], opt: 0.3 }, { at: ['IPC'] }, { at: ['PPT'] }, { at: ['SYD', 'AYQ', 'CNS'] }, { at: ['DPS'], opt: 0.25 }, { at: ['SAI'] }, { at: ['VDO', 'HAN'] }, { at: ['SKD'] }, { at: ['AMM'], opt: 0.25 }],
  },
  {
    client: 'Abercrombie & Kent', gateway: 'LHR', name: 'Around the World by Private Jet',
    stops: [{ at: ['CTG', 'HAV'] }, { at: ['LIM'] }, { at: ['IPC'] }, { at: ['PPT', 'APW', 'TBU'] }, { at: ['CNS', 'AYQ'] }, { at: ['SAI'] }, { at: ['KTM', 'DEL'] }, { at: ['AMM'] }, { at: ['LXR'], opt: 0.3 }],
  },
  {
    client: 'Kuoni Group Travel', gateway: 'ZRH', name: 'Weltreise im Privatjet',
    stops: [{ at: ['SSA', 'GIG'] }, { at: ['FTE'] }, { at: ['IPC'] }, { at: ['PPT'] }, { at: ['NAN', 'VLI', 'TBU'] }, { at: ['AYQ', 'BME'] }, { at: ['DPS'] }, { at: ['MLE', 'GAN'] }, { at: ['MUB'] }],
  },
];

const TOUR_SIGHTS: Record<string, string> = {
  GIG: 'Rio', IGU: 'the Iguaçu Falls', LIM: 'Machu Picchu', IPC: 'Easter Island', PPT: 'Tahiti', SYD: 'Sydney', AYQ: 'Uluru', CNS: 'the Great Barrier Reef',
  DPS: 'Bali', SAI: 'Angkor', VDO: 'Ha Long Bay', HAN: 'Hanoi and Ha Long Bay', SKD: 'Samarkand', AMM: 'Petra', CTG: 'Cartagena', HAV: 'Havana', APW: 'Samoa', TBU: 'Tonga',
  KTM: 'the Himalaya', DEL: 'the Taj Mahal', LXR: 'Luxor', SSA: 'Salvador', FTE: 'Patagonia', NAN: 'Fiji', VLI: 'Vanuatu', BME: 'the Kimberley', MLE: 'the Maldives',
  GAN: 'the Maldives', MUB: 'the Okavango Delta',
};
/** What the guests go to see at a stop ('Easter Island', 'Angkor'); the city otherwise. */
export const tourSight = (code: string) => TOUR_SIGHTS[code] ?? city(code);

/** The stops of a world-tour legs pattern with the nights spent at each (arrival to the next departure, local dates). Pure. */
export function tourStops(legs: readonly LegTemplate[]): { code: string; nights: number }[] {
  const ls = [...legs].sort((a, b) => a.dep - b.dep);
  const out: { code: string; nights: number }[] = [];
  for (let i = 0; i + 1 < ls.length; i++) {
    const at = ls[i].to;
    const arr = ls[i].dep + blockMinutes('a333', ls[i].from, at);
    out.push({ code: at, nights: Math.max(0, Math.round((dayStartLocal(at, ls[i + 1].dep) - dayStartLocal(at, arr)) / DAY)) });
  }
  return out;
}
const dayStartLocal = (code: string, t: Minute) => atLocal(code, t, 0);

/** The world-tour template a stop belongs to, and the other choices for that stop (alternates for a closure). Pure. */
export function tourAlternates(gateway: string, code: string): string[] {
  const out: string[] = [];
  for (const t of WORLD_TOURS) {
    if (t.gateway !== gateway) continue;
    for (const s of t.stops) if (s.at.includes(code)) out.push(...s.at.filter((x) => x !== code));
  }
  return [...new Set(out)];
}

/** A sector the type flies non-stop from that runway. Pure. */
const direct = (typeId: string, a: string, b: string) => {
  const sp = planSector(typeId, a, b);
  return sp.ok && !sp.techStops.length;
};

/** A tour's legs: from the gateway on `start`'s local date at `hours[0]`, then after nights[i] at stop i (local dates). Pure. */
function tourLegs(pts: string[], nights: number[], start: Minute, hours: number[]): { from: string; to: string; dep: Minute }[] {
  const out: { from: string; to: string; dep: Minute }[] = [];
  let t = atLocal(pts[0], start, hours[0]);
  for (let i = 0; i + 1 < pts.length; i++) {
    out.push({ from: pts[i], to: pts[i + 1], dep: t });
    if (i + 1 < pts.length - 1) {
      const arr = t + blockMinutes('a333', pts[i], pts[i + 1]);
      t = atLocal(pts[i + 1], arr + nights[i] * DAY, hours[i + 1]);
      if (t < arr + DAY) t += DAY;
    }
  }
  return out;
}

/**
 * v0.12.1 the stop (index) whose rest must become the crew's recovery for the 168 h to hold (ORO.FTL.235(d): 36 h with
 * 2 local nights by the base clock, 60 h after 4 disruptive duties, as the crew check reads them), with 12 h in hand for
 * delays and the way home; -1 when every stretch of the tour holds one. The crew start it rested (the evening before
 * at the gateway). Pure.
 */
export function tourRecovery(legs: readonly { from: string; to: string; dep: Minute }[], home: string): number {
  const REPORT = 90;
  const POST = 30;
  const KEEP = 12 * 60;
  let anchor = legs[0].dep - REPORT - 14 * 60;
  let disruptive = 0;
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const report = l.dep - REPORT;
    const release = l.dep + blockMinutes('a333', l.from, l.to) + POST;
    if (i > 0) {
      const p = legs[i - 1];
      const before = p.dep + blockMinutes('a333', p.from, p.to) + POST;
      const need = disruptive >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
      if (report - before >= need && nightsIn(home, before, report) >= 2) {
        anchor = report;
        disruptive = 0;
      }
    }
    if (release + KEEP > anchor + LIMITS.recoveryEvery) return Math.max(0, i - 1);
    if (isDisruptive(home, report, release)) disruptive++;
  }
  return -1;
}

/**
 * v0.12.1 a world tour: a tour operator's round-the-world journey by private jet from its gateway, 7–10 stops of 2–3
 * nights each, 18–24 days, offered 3–6 months ahead. One widebody with business seats, one augmented crew and 2–4
 * extra cabin crew for the whole tour; five-star catering; any delay over 30 min is noticed (standards 'vip').
 */
function worldTour(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  const T = BAL.v0121.tour;
  const tpls = WORLD_TOURS.filter((t) => exists(t.gateway) && (!o.client || g.clients[o.client]?.name === t.client) && (!o.airport || t.gateway === o.airport));
  // TMR is the signature client (half the tours); A&K and Kuoni share the rest.
  const tpl = weightedPick(g, tpls, (t) => (t.client === 'Les Voyages de TMR' ? 2 : 1));
  if (!tpl) return null;
  const client = ensureClient(g, tpl.client);
  if (!client) return null;
  // The stops: each one of its choices; optional ones at their chance; 7–10 in all. Every leg direct on an A330-300
  // (the type these tours are sized for): a fuel stop would change the crew there (a slip), never one crew all the way.
  const east = chance(g, 0.5);
  let stops: string[] = [];
  for (let k = 0; k < 6 && !stops.length; k++) {
    let x: string[] = [];
    for (const st of tpl.stops) {
      const at = st.at.filter(exists);
      if (!at.length || (st.opt !== undefined && !chance(g, st.opt))) continue;
      x.push(chance(g, 0.55) ? at[0] : pick(g, at));
    }
    x = x.slice(0, 10);
    if (east) x.reverse();
    const pts = [tpl.gateway, ...x, tpl.gateway];
    if (x.length >= 7 && pts.slice(1).every((b, i) => direct('a333', pts[i], b))) stops = x;
  }
  if (!stops.length) return null;
  // Nights: 2 at each stop, a third where the crew's 36 h recovery (2 local nights by their base clock) is due within
  // the 168 h (ORO.FTL.235(d): tourRecovery), then at random to 16–22 nights in all (an 18–24 day tour).
  const n = stops.length;
  const total = int(g, Math.max(16, 2 * n), Math.min(22, 3 * n));
  const nights = stops.map(() => 2);
  const s = o.start ?? g.now + int(g, T.lead[0], T.lead[1]) * DAY;
  const pax = int(g, T.pax[0], T.pax[1]);
  const pts = [tpl.gateway, ...stops, tpl.gateway];
  const prefix = clientPrefix(client.name);
  const no = 800 + int(g, 0, 9) * 10;
  // Morning departures (09:00–11:30 local); the next leaves after the stop's nights, by local date.
  const hours = pts.map(() => int(g, 18, 23) * 30);
  const build = () => tourLegs(pts, nights, s, hours).map((l, i) => ({ ...l, flightNo: `${prefix}${no + i}`, pax }));
  for (let k = 0; k < n; k++) {
    const due = tourRecovery(build(), g.company.homeBase);
    if (due < 0) break;
    if (nights[due] >= 3) return null;
    nights[due]++;
  }
  for (let k = nights.reduce((x, y) => x + y, 0), tries = 0; k < total && tries < 50; tries++) {
    const i = int(g, 0, n - 1);
    if (nights[i] >= 3) continue;
    nights[i]++;
    k++;
  }
  const legs: LegTemplate[] = build();
  if (tourRecovery(legs, g.company.homeBase) >= 0) return null;
  const last = legs[legs.length - 1];
  const end = last.dep + blockMinutes('a333', last.from, last.to);
  const days = Math.round((end - legs[0].dep) / DAY) + 1;
  if (days < 18 || days > 24) return null;
  const extra = int(g, T.extraCabin[0], T.extraCabin[1]);
  const y = toDate(legs[0].dep).getUTCFullYear();
  const sights = stops.map((c, i) => `${tourSight(c)} (${nights[i]} nights)`);
  return {
    archetype: 'worldTour', client,
    title: `Around the world ${y}: ${n} stops, ${days} days`,
    blurb: `${client.name}: their ${tpl.name}, ${pax} guests, ${east ? 'eastbound' : 'westbound'} from ${city(tpl.gateway)} on ${fmtDay(legs[0].dep)}: ${sights.join(', ')}, then home. ` +
      `One aircraft and one crew for all ${days} days: the same pilots (augmented) and cabin crew all the way round, ${extra} extra cabin crew for the service, hotels at every stop. ` +
      `Business seats wanted (more of them pays more), five-star catering; any delay over 30 minutes is noticed.`,
    pattern: { kind: 'legs', legs, hold: true },
    req: { minSeats: pax, layouts: ['two-class', 'three-class', 'vip'], extraCabin: extra, approvals: [], standards: 'vip', body: 'wide' },
    start: legs[0].dep, end: end + 8 * 60, expiresIn: range(g, T.expires[0], T.expires[1]) * DAY,
    mult: T.mult, extraBH: T.idleBH * days, effects: { reliable: 2, clean: 1, morale: 3 }, risk: { disruption: 0.4, politics: 0.1, permit: 0.3 },
    pin: tpl.gateway, hook: hookFor(ctx),
  };
}

/**
 * v0.12.1 the one crew a world tour flies on an aircraft, all of it for the whole tour: the pilots its longest day needs
 * on that airframe's rest (3 at least: a spare when no leg needs more than two), the cabin crew for its seats with the
 * service extras and any rest relief. Null when the aircraft or offer is unknown. Pure.
 */
export function tourCrew(g: GameState, offerId: string, aircraftId: string): { pilots: number; cabin: number; extra: number } | null {
  const o = g.offers[offerId] ?? Object.values(g.contracts).find((k) => k.offerId === offerId);
  const ac = g.fleet[aircraftId];
  if (!o || !ac || o.pattern.kind !== 'legs') return null;
  const rest = restOf(g, aircraftId);
  let aug: 0 | 1 | 2 = 0;
  let relief = 0;
  for (const c of programmeOf(o, ac.typeId).chains) {
    const n = dutyNeed(g, ac.typeId, rest, c);
    const a: 0 | 1 | 2 = n.mode === 'aug1' ? 1 : n.mode === 'aug2' || n.mode === 'none' ? 2 : 0;
    if (a > aug) aug = a;
    if (a && n.plan?.ok) relief = Math.max(relief, n.plan.extraCabin);
  }
  const roles = complement(ac.typeId, ac.cabin.total, { augment: aug, extraCabin: o.requirements.extraCabin, restCabin: relief });
  return { pilots: Math.max(3, roles.filter((r) => r === 'CPT' || r === 'FO' || r === 'CRP').length), cabin: roles.filter((r) => r === 'PUR' || r === 'CC').length, extra: o.requirements.extraCabin };
}

/**
 * v0.12.1 the company can be offered a world tour: Established or better, with a widebody with business seats that may
 * cross the Pacific (a twin under ETOPS 180, or a four-engined 747 or A340, which needs none). Pure.
 */
export function tourReady(g: GameState): boolean {
  const etops = g.company.approvals.includes('etops180') || g.company.approvals.includes('etops240');
  return standingOf(g) >= 1 && Object.values(g.fleet).some((a) => {
    const t = typeOf(a.typeId);
    return t.body === 'wide' && a.cabin.j > 0 && a.status !== 'leasedOut' && (etops || t.engines === 4);
  });
}

/**
 * v0.12.1 daily: a world tour (about once a year Established, 2–3 times Respected), on its own side stream so a game
 * that never qualifies keeps its offer stream; never two at once (an open offer or a tour not yet flown).
 */
export function dailyWorldTour(g: GameState): ContractOffer | null {
  if (!tourReady(g)) return null;
  const p = BAL.v0121.tour.perDay[standingOf(g)] ?? 0;
  if (!chance(sideRng(g, `tour:${Math.floor(g.now / DAY)}`), p)) return null;
  if (Object.values(g.offers).some((x) => x.archetype === 'worldTour' && (x.status === 'open' || x.status === 'countered'))) return null;
  if (Object.values(g.contracts).some((k) => k.archetype === 'worldTour' && (k.status === 'signed' || k.status === 'active'))) return null;
  return generateOffer(g, 'worldTour', { wide: true, window: false, paint: false, cabin: false });
}

/** A world-tour offer (any qualification; `client`: TMR, A&K or Kuoni by name); the offer id ('' when none). Dev/test helper. */
export function devWorldTour(g: GameState, clientName?: string): string {
  const cl = clientName ? ensureClient(g, clientName) : undefined;
  for (let i = 0; i < 12; i++) {
    const o = generateOffer(g, 'worldTour', { wide: true, window: false, paint: false, cabin: false, ...(cl ? { client: cl.id } : {}) });
    if (o) return o.id;
  }
  return '';
}

// ---------- registry ----------

export const MISSION_BUILDERS: Partial<Record<Archetype, (ctx: Ctx) => Draft | null>> = {
  hajj, unRotation, deportation, evacuation, medical, humanitarian, musicTour, antarctic, capacityLease, subcharterIn, worldTour,
};

/** Per archetype: lead from now to start [min, max] and the room it needs inside a window, in days. */
export const WINDOW_FIT_V08: Partial<Record<Archetype, [number, number, number]>> = {
  hajj: [28, 200, 66], unRotation: [30, 90, 300], deportation: [10, 45, 30], evacuation: [0.5, 2, 3], medical: [1, 5, 2], musicTour: [14, 60, 21],
  antarctic: [40, 200, 30], capacityLease: [14, 60, 180], humanitarian: [0.5, 2, 2],
};

const CHARTER_KINDS = new Set<Archetype>(['adhoc', 'sports', 'tourSeries', 'repatriation', 'troopRotation', 'vip', 'unRotation', 'deportation', 'evacuation', 'medical', 'musicTour', 'antarctic']);

/** Fuel over $900/t: tour operators and charter clients wait (charter archetypes × 0.85). Pure. */
export const fuelFactor = (g: GameState, a: Archetype) => (g.market.fuelPrice > V.market.fuelHigh && CHARTER_KINDS.has(a) ? 0.85 : 1);

/** Weights of the v0.8 archetypes in the offer mix (§2 weights). Pure. */
export function missionWeights(g: GameState): [Archetype, number][] {
  const st = standingOf(g);
  const mo = month(g.now);
  const wide = anyWide(g);
  const partner = Object.values(g.clients).some((c) => c.kind === 'airline' && c.level === 'partner');
  const polar = has(g, 'polar');
  const out: [Archetype, number][] = [
    ['hajj', hajjTender(g.now) ? (wide ? 0.1 : 0.04) : 0],
    ['unRotation', st >= 1 ? 0.04 : 0],
    ['deportation', 0.04 * (st === 0 ? 2 : 1)],
    ['evacuation', 0.02],
    ['medical', 0.02],
    ['musicTour', mo >= 2 && mo <= 9 ? 0.03 : 0],
    ['antarctic', st === 0 ? 0 : st === 2 && mo >= 5 && mo <= 8 && wide && polar ? 0.05 : mo >= 2 && mo <= 9 ? 0.01 : 0],
    ['capacityLease', st === 2 || partner ? 0.04 : 0],
  ];
  return out.map(([a, w]) => [a, w * fuelFactor(g, a)]);
}

// ---------- mixed crew (§7.1) ----------

/** Rolls a mixed-crew clause for a wet airline offer: the client provides n of M cabin crew. Side stream per offer. */
export function rollClientCabin(g: GameState, d: Draft, ref: string, req: Requirements): Requirements['clientCabin'] {
  const a = d.archetype;
  if (!(a === 'seasonBase' || a === 'aogCover' || a === 'capacityLease' || a === 'hajj')) return undefined;
  if (d.client.kind !== 'airline' && a !== 'hajj') return undefined;
  const S = V.mixedCrew.share;
  const p = a === 'hajj' ? S.hajj : EUROPE.has(d.client.country) ? S.eu : S.far;
  const r = sideRng(g, `cc:${g.seq}:${g.now}:${d.client.id}`);
  if (!chance(r, p)) return undefined;
  const seats = Math.max(req.minSeats, defaultSeats(ref));
  const M = complement(ref, seats).filter((x) => x === 'PUR' || x === 'CC').length;
  if (M < 3) return undefined;
  const k = next(r);
  const [n, leads] = k < 0.35 ? [M - 1, false] : k < 0.6 ? [M - 2, false] : k < 0.85 ? [Math.floor(M / 2), false] : [M, true];
  return { n: Math.max(1, n), of: M, leads };
}

/**
 * v0.7.4 × v0.8: a mixed-crew clause on an offer whose client also wants its own cabin is counted on that cabin's
 * seats (M cabin crew for them): their senior leading, they bring all M; otherwise up to the n first rolled, always
 * leaving our purser. Pure.
 */
export function clientCrewOnCabin(ref: string, cc: NonNullable<Requirements['clientCabin']>, seats: number): NonNullable<Requirements['clientCabin']> {
  const M = complement(ref, seats).filter((x) => x === 'PUR' || x === 'CC').length;
  return { n: cc.leads ? M : Math.max(1, Math.min(cc.n, M - 1)), of: M, leads: cc.leads };
}

// ---------- daily: sub-charter in, repeat business ----------

const rivalClient = (g: GameState, r: Rival) => (r.clientId ? g.clients[r.clientId] : undefined);

/** Daily (§3.5): a rival with an AOG or overflow asks us when one of our aircraft has a free window. */
export function dailySubIn(g: GameState): ContractOffer | null {
  if (Object.values(g.offers).some((o) => o.archetype === 'subcharterIn' && (o.status === 'open' || o.status === 'countered'))) return null;
  const r = sideRng(g, `subin:${Math.floor(g.now / DAY)}`);
  if (!chance(r, V.rivals.askPerDay)) return null;
  const aog = chance(r, 0.5);
  const ws = idleWindows(g, aog ? 3 : 14, 60).filter((w) => (aog ? w.from < g.now + 72 * 60 : w.from < g.now + 28 * DAY && w.to > g.now + 28 * DAY));
  if (!ws.length) return null;
  const w = pick(r, ws);
  const ac = g.fleet[w.aircraftId];
  const fam = typeOf(ac.typeId).family;
  const wide = typeOf(ac.typeId).body === 'wide';
  const rivals = g.rivals.filter((x) => isActive(x) && rivalClient(g, x) && x.fleet.some((f) => f.count > 0 && typeOf(f.typeId).family === fam));
  const rival = weightedPick(r, rivals, (x) => x.fleet.reduce((s, f) => s + f.count, 0) * (x.load ?? 0.7));
  if (!rival) return null;
  const ends = clientsOf(g, ['airline'], (c) => exists(c.base) && !c.rivalId);
  const end = weightedPick(r, ends, (c) => 1 / (1 + km(c.base, rival.base) / 1500));
  if (!end) return null;
  return generateOffer(g, 'subcharterIn', { window: w, wide, rival: rival.id, endClient: end.id, variant: aog ? undefined : 'oneway', client: rivalClient(g, rival)!.id });
}

/** Daily: repeat business for base programmes 45 days before they end. */
export function dailyRepeats(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if (c.repeatRolled || c.status !== 'active' || c.pattern.kind !== 'base' || c.end - g.now > 45 * DAY || c.dry) continue;
    rollRepeat(g, c.id);
  }
}

/** The repeat-business roll of a contract: its client's level chance (Known 30 %, Trusted 50 %, Partner 80 %). Pure. */
export function repeatHit(g: GameState, contractId: string): boolean {
  const c = g.contracts[contractId];
  const cl = c ? g.clients[c.clientId] : undefined;
  const p = cl ? perks(g, cl).repeat : 0;
  return p > 0 && chance(sideRng(g, `repeat:${contractId}`), p);
}

/** Work that never comes back as repeat business (v0.12.1 repatriation and medical flights too). */
const ONE_OFF: ReadonlySet<Archetype> = new Set<Archetype>(['subcharterIn', 'dryLeaseOut', 'evacuation', 'humanitarian', 'hajj', 'repatriation', 'medical']);

/** At completion (or 45 days before a base programme ends): the client's level's chance of the same work again. */

export function rollRepeat(g: GameState, contractId: string): ContractOffer | null {
  const c = g.contracts[contractId];
  if (!c || c.repeatRolled || ONE_OFF.has(c.archetype)) return null;
  // v0.12.1 rescue work and a world event's work are one-off, as are a scenario's hand-made jobs.
  if (c.eventId || g.scen?.mem?.[`oneOff:${c.offerId}`]) return null;
  c.repeatRolled = true;
  const cl = g.clients[c.clientId];
  if (!cl || !repeatHit(g, c.id)) return null;
  const wide = typeOf(g.fleet[c.aircraftIds[0]]?.typeId ?? 'a320ceo').body === 'wide';
  // A summer base completed after August comes back for next summer (April); the rest 20–120 days out.
  const y = toDate(g.now).getUTCFullYear();
  const nextSummer = c.archetype === 'seasonBase' && month(g.now) >= 7 ? fromUTC(y + 1, 4, 1) : undefined;
  const start = nextSummer ?? g.now + int(sideRng(g, `rpt:${c.id}`), 20, 120) * DAY;
  const o = generateOffer(g, c.archetype, { client: c.clientId, wide, start, window: false, repeatOf: c.id });
  if (o) {
    o.hook = `Repeat business from ${cl.name}`;
    // Round 4 (§V): the client once (the title); the new title only when it is not the old one (or it plus a month).
    const as = o.title === c.title || o.title.startsWith(`${c.title} (`) ? '' : ` as ${o.title}`;
    pushMessage(g, { tone: 'good', cat: 'commercial', title: `Repeat business from ${cl.name}`, body: `They liked ${c.title} and ask for it again${as} from ${fmtDay(o.start)}.`, ref: { kind: 'offer', id: o.id }, cue: null });
  }
  return o;
}

// ---------- dry lease out (§6.1) ----------

/** Market rent of an airframe (dry), index-adjusted; v0.14 by its age as the market leases one in (rentForAge; was the mid-life rent at any age). */
const rentOf = (g: GameState, ac: Aircraft, r: { rng: number }) => {
  const t = ACMI_TYPES[ac.typeId];
  return Math.round((rentForAge(t, Math.max(0, yearOf(g.now) - ac.builtYear)) * segIndex(g, t.body === 'wide' ? 'wide' : 'narrow') * range(r, 0.95, 1.1)) / 1000) * 1000;
};

/** Airline clients outside our home market (and outside Europe) that could take the aircraft at their base. */
function lessees(g: GameState, typeId: string): Client[] {
  const homeCountry = AIRPORT_BY_CODE[g.company.homeBase]?.country;
  const fam = typeOf(typeId).family;
  return clientsOf(g, ['airline'], (c) => !c.rivalId && c.country !== homeCountry && !EUROPE.has(c.country) && exists(c.base) && fliesFamily(c.name, fam) && !!route(typeId, g.company.homeBase, c.base, etopsCap(g.company.approvals, typeId)));
}

/**
 * A dry-lease offer for an aircraft with a free window of 60+ days starting 14–60 days out (§6.1): 2–9 months
 * (Newcomer 2–4), market rent × index, reserves per flight hour, a month's deposit; a sub-lease consent fee on a
 * leased-in airframe; half the lessees want their colours (they paint at their own MRO). `w`: a specific window.
 */
export function makeDryLeaseOffer(g: GameState, w?: IdleWindow, clientId?: string): ContractOffer | null {
  const D = V.dry;
  const r = sideRng(g, `dry:${g.seq}:${g.now}`);
  const ws = w ? [w] : idleWindows(g, 60, 330).filter((x) => {
    const ac = g.fleet[x.aircraftId];
    return !!ac && !ac.sale && !ac.returning && ac.status !== 'delivering' && Math.max(x.from, g.now + 14 * DAY) <= g.now + 60 * DAY;
  });
  if (!ws.length) return null;
  const win = w ?? pick(r, ws);
  const ac = g.fleet[win.aircraftId];
  if (!ac) return null;
  const t = typeOf(ac.typeId);
  const wide = t.body === 'wide';
  const pool = lessees(g, ac.typeId);
  const client = (clientId && g.clients[clientId]) || weightedPick(r, pool, (c) => 1 + (c.base === 'LAD' || c.base === 'DSS' || c.base === 'CMN' ? 1 : 0));
  if (!client) return null;
  const site = client.base;
  const out = route(ac.typeId, win.at, site, etopsCap(g.company.approvals, ac.typeId));
  const back = route(ac.typeId, site, g.company.homeBase, etopsCap(g.company.approvals, ac.typeId));
  if (!out || !back) return null;
  const start = Math.ceil(Math.max(win.from + out.reduce((s, l) => s + l.block, 0) + 2 * DAY, g.now + 14 * DAY) / DAY) * DAY;
  const maxMonths = Math.floor((win.to - start - back.reduce((s, l) => s + l.block, 0) - 3 * DAY) / (30.44 * DAY));
  const [lo, hi] = standingOf(g) === 0 ? [2, 4] : [2, 9];
  if (maxMonths < lo) return null;
  const months = int(r, lo, Math.min(hi, maxMonths));
  const end = start + Math.round(months * 30.44) * DAY;
  if (ac.ownership.kind === 'dryLeaseIn' && ac.ownership.leaseEnd < end + 30 * DAY) return null;
  const rent = rentOf(g, ac, r);
  const reserves = wide ? D.reserves.wide : D.reserves.narrow;
  const fh = wide ? D.fh.wide : D.fh.narrow;
  const consent = ac.ownership.kind === 'dryLeaseIn' ? (wide ? D.consent.wide : D.consent.narrow) : 0;
  const paint: 'full' | 'decals' | undefined = chance(r, 0.5) ? (chance(r, 0.4) ? 'full' : 'decals') : undefined;
  const o: ContractOffer = {
    id: nextId(g, 'o'), archetype: 'dryLeaseOut', clientId: client.id,
    title: `Dry lease: ${t.short}`,
    blurb: `${client.name} wants ${/^[AEIOU8]/.test(t.short) ? 'an' : 'a'} ${t.short} dry, without crew, for ${months} months from ${fmtDay(start)} at ${city(site)}: ` +
      `$${Math.round(rent / 1000)}K a month plus $${reserves} per flight hour in reserves. Our pilots deliver it and fetch it back; their crews and engineers fly and maintain it` +
      `${paint ? ` in ${client.name} colours` : ''}. Line and A-checks are theirs, the C-check stays ours.${consent ? ` The lessor wants $${consent / 1000}K to consent to the sub-lease.` : ''}`,
    product: { kind: 'dry', rentPerMonth: rent, reservesPerFH: reserves },
    requirements: { minSeats: 0, body: t.body, families: [t.family], longestSectorNm: 0, minRunwayM: 0, etops: 0, approvals: [], extraCabin: 0 },
    pattern: { kind: 'legs', legs: [] },
    start, end, created: g.now, expires: g.now + Math.round(range(r, 5, 10) * DAY), urgency: 'normal',
    penalties: { cancelScale: BAL.cancelScale.map(([a, b]) => [a, b] as [number, number]), perDelay: 0, perCancelledLeg: 0 },
    payment: { basis: 'advance', dueDays: 5, depositPct: 0 },
    effects: {}, risk: { payment: Math.round((1 - client.payReliability) * 100) / 100, disruption: V.dry.late, politics: 0, permit: 0 },
    estBH: 0, estValue: Math.round(rent * months + reserves * fh * months), floor: Math.round(range(r, BAL.counterFloor[0], BAL.counterFloor[1]) * 100) / 100,
    status: 'open', pin: site, hook: `Fits ${ac.reg}: free ${fmtDay(win.from)} – ${fmtDay(win.to)}`, dryFor: ac.id,
    dry: { site, fhPerMonth: fh, deposit: rent, consent, months, ...(paint ? { paint } : {}) },
  };
  g.offers[o.id] = o;
  schedule(g, o.expires, 'offer.expire', o.id);
  cue('offerNew', { title: `New offer: ${o.title}`, body: `${client.name}. Answer by ${fmtDay(o.expires)}.`, tone: 'info', ref: { kind: 'offer', id: o.id } });
  return o;
}

/** Daily (§6.1): a dry-lease request (Oct–Mar 7 %, else 3 % a day) when an aircraft has a long enough free window. */
export function dailyDryLease(g: GameState): ContractOffer | null {
  if (Object.values(g.offers).some((o) => o.archetype === 'dryLeaseOut' && (o.status === 'open' || o.status === 'countered'))) return null;
  const mo = month(g.now);
  const p = mo >= 9 || mo <= 2 ? 0.07 : 0.03;
  if (!chance(sideRng(g, `dryday:${Math.floor(g.now / DAY)}`), p)) return null;
  return makeDryLeaseOffer(g);
}

// ---------- world-event work (§5.3) ----------

/** One offer a world event creates (evacuation, repatriation, relief, medical, ACMI cover), tagged with the event. */
export function eventOffer(g: GameState, kind: 'evacuation' | 'repatriation' | 'humanitarian' | 'medical' | 'aogCover' | 'acmi', at: string, eventId: string, opts: { staging?: string; client?: string; sar?: boolean } = {}): ContractOffer | null {
  const wide = chance(g, anyWide(g) ? 0.5 : 0.1);
  let o: ContractOffer | null = null;
  if (kind === 'evacuation') o = generateOffer(g, 'evacuation', { airport: at, staging: opts.staging, eventId, wide, window: false });
  else if (kind === 'repatriation') o = generateOffer(g, 'repatriation', { airport: at, wide, window: false });
  else if (kind === 'humanitarian') o = generateOffer(g, 'humanitarian', { airport: at, eventId, wide, window: false, variant: opts.sar ? 'group' : undefined });
  else if (kind === 'medical') o = generateOffer(g, 'medical', { airport: at, eventId, wide, window: false });
  else if (kind === 'aogCover') o = generateOffer(g, 'aogCover', { client: opts.client, wide: false, window: false, start: g.now + int(g, 8, 36) * 60 });
  else o = generateOffer(g, 'seasonBase', { client: opts.client, wide: false, window: false, days: int(g, 30, 45), start: g.now + int(g, 4, 10) * DAY });
  if (o) o.eventId = eventId;
  return o;
}

// ---------- dev helpers (UPDATE-0.8.md §12) ----------

/** A Hajj offer (tender window simulated when closed); the offer id ('' when none could be built). Dev/test helper. */
export function devHajj(g: GameState): string {
  const h = nextHajj(g.now, 2).find((x) => x.arafah - 60 * DAY > g.now) ?? nextHajj(g.now, 1)[0];
  const save = g.now;
  g.now = Math.max(g.now, h.arafah - 120 * DAY);
  let o: ContractOffer | null = null;
  for (let i = 0; i < 12 && !o; i++) o = generateOffer(g, 'hajj', { wide: true, window: false });
  g.now = save;
  if (o) {
    o.created = g.now;
    o.expires = Math.max(o.expires, g.now + 7 * DAY);
    schedule(g, o.expires, 'offer.expire', o.id);
  }
  return o?.id ?? '';
}

/** A dry-lease offer for an owned narrowbody (to TAAG when it flies the type); the offer id. Dev/test helper. */
export function devDryLease(g: GameState): string {
  const ac = Object.values(g.fleet).find((a) => typeOf(a.typeId).body === 'narrow' && a.ownership.kind === 'owned') ?? Object.values(g.fleet).find((a) => typeOf(a.typeId).body === 'narrow');
  if (!ac) return '';
  const w = idleWindows(g, 75, 330).find((x) => x.aircraftId === ac.id) ?? { aircraftId: ac.id, from: g.now + 12 * 60, to: g.now + 330 * DAY, at: ac.at, afterContract: null };
  // TAAG when it flies the type (737/777/787), else a lessee that does.
  const taag = Object.values(g.clients).find((c) => c.name === 'TAAG Angola Airlines' && fliesFamily(c.name, typeOf(ac.typeId).family));
  return makeDryLeaseOffer(g, w, taag?.id)?.id ?? '';
}

/** An Air Sénégal season base 'all but the purser' signed and rostered (the first aircraft and start that fit); one of its duties' id ('' when none). Dev/test helper. */
export function devMixedCrew(g: GameState): string {
  const sn = Object.values(g.clients).find((c) => c.name === 'Air Sénégal');
  if (!sn) return '';
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'leasedOut' && !a.sale && !a.returning).sort((a, b) => Number(typeOf(b.typeId).body === 'wide') - Number(typeOf(a.typeId).body === 'wide'));
  for (const days of [3, 10, 21, 45]) {
    for (const ac of fleet) {
      const wide = typeOf(ac.typeId).body === 'wide';
      const o = generateOffer(g, 'seasonBase', { client: sn.id, wide, window: false, start: g.now + days * DAY, days: 30, dests: wide ? ['CDG'] : ['LIS', 'BCN'] });
      if (!o) continue;
      const M = complement(ac.typeId, ac.cabin.total).filter((x) => x === 'PUR' || x === 'CC').length;
      o.requirements.clientCabin = { n: M - 1, of: M, leads: false };
      const res = feasibility(g, o.id, ac.id).level !== 'no' ? acceptOffer(g, o.id, [ac.id]) : null;
      if (!res?.ok) {
        delete g.offers[o.id];
        continue;
      }
      const p = Object.values(g.pairings).find((x) => x.contractId === res.data!.contractId && x.dutyIds.length);
      return p?.dutyIds[0] ?? '';
    }
  }
  return '';
}

/** The first of up to 12 tries that builds an offer of this archetype (dev helpers). */
function tryOffer(g: GameState, a: Archetype, opts: Parameters<typeof generateOffer>[2] = {}): string {
  for (let i = 0; i < 12; i++) {
    const o = generateOffer(g, a, { window: false, wide: i % 3 === 2, ...opts });
    if (o) return o.id;
  }
  return '';
}

/** A deportation offer; the offer id. Dev/test helper. */
export function devDeportation(g: GameState): string {
  return tryOffer(g, 'deportation');
}

/** An evacuation offer; the offer id. Dev/test helper. */
export function devEvacuation(g: GameState): string {
  return tryOffer(g, 'evacuation');
}
