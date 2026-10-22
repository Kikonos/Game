// v0.8 rival operators with personalities (UPDATE-0.8.md §3): a style each, fleets that change monthly, a load
// (how booked they are), hidden timed bids on our offers (they win with a stated reason), and a client record so a
// rival can hire us (sub-charter in). Views are pure; refresh / bids / load are action-side.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { inHajjPhase } from '../../data/worldCalendar';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distance } from '../core/geo';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, next, pick, weightedPick, type RngHolder } from '../core/rng';
import { fmtDay, monthKey, toDate } from '../core/time';
import { clamp, hash } from '../core/util';
import type { Archetype, ClientLevel, ContractOffer, GameState, Minute, Rival, SimEvent } from '../core/types';
import { closeOffer } from './accept';
import { LEVEL_NAME, levelOf, statsV08 } from './relations';

export type RivalStyle = 'cheap' | 'premium' | 'steady' | 'big' | 'rescue' | 'military';

const V = BAL.v08;

export const STYLE_NAME: Record<RivalStyle, string> = {
  cheap: 'Low fares', premium: 'Prestige', steady: 'Reliable', big: 'Big fleet', rescue: 'Rescue specialist', military: 'Government work',
};
const STYLE_TEXT: Record<RivalStyle, string> = {
  cheap: 'Low fares: undercuts by about 10 % and signs fast',
  premium: 'Prestige: premium cabins and VIP work at premium prices; slow to decide',
  steady: 'Reliable: fair prices and a solid record; decides in its own time',
  big: 'Big fleet: has an aircraft almost anywhere and wins season-long work',
  rescue: 'Rescue specialist: covers AOGs and evacuations at a day\'s notice',
  military: 'Government work: troops, the UN and ministries',
};

/** Real ACMI operators' v0.8 styles (§3.1): keeps every seed's id, only the tag changes. */
export const RIVAL_STYLE: Record<string, RivalStyle> = {
  'Avion Express': 'big', Smartwings: 'big', 'Air Atlanta Icelandic': 'big',
  'Hi Fly': 'premium', 'Privilege Style': 'premium', KlasJet: 'premium',
  'euroAtlantic airways': 'steady', 'Wamos Air': 'steady', 'Global Crossing Airlines': 'steady',
  'GetJet Airlines': 'cheap', 'Heston Airlines': 'cheap', 'Airhub Airlines': 'cheap',
  'Titan Airways': 'rescue',
};

/** A side stream per key (rival rolls never shift the main sequence). */
const side = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:rival:${key}`) | 0 });

export const fleetCount = (r: Rival) => r.fleet.reduce((s, f) => s + f.count, 0);
export const isActive = (r: Rival) => (r.status ?? 'active') === 'active';
export const styleOf = (r: Rival): RivalStyle => r.personality;

/** Busy share by season (§3.2): Jun–Sep 0.85, Oct–Nov and Apr–May 0.7, Dec–Mar 0.55. */
function seasonLoad(t: Minute): number {
  const m = toDate(t).getUTCMonth();
  return m >= 5 && m <= 8 ? 0.85 : m === 9 || m === 10 || m === 3 || m === 4 ? 0.7 : 0.55;
}

/** This month's load: season + market phase + style + noise (side stream), 0.3–0.98. Pure. */
export function loadFor(g: GameState, r: Rival): number {
  const phase = g.market.cycle?.phase ?? 'steady';
  const ph = phase === 'boom' ? 0.1 : phase === 'slump' ? -0.15 : phase === 'soft' ? -0.05 : 0;
  const st = r.personality === 'big' ? 0.05 : r.personality === 'premium' ? -0.05 : 0;
  const noise = (next(side(g, `load:${r.id}:${monthKey(g.now)}`)) - 0.5) * 0.1;
  // Hajj weeks keep widebody operators busy.
  const hajj = inHajjPhase(g.now) && r.fleet.some((f) => f.count > 0 && typeOf(f.typeId).body === 'wide') ? 0.1 : 0;
  return Math.round(clamp(seasonLoad(g.now) + ph + st + noise + hajj, 0.3, 0.98) * 100) / 100;
}

function logRival(g: GameState, r: Rival, text: string): void {
  const log = (r.log ??= []);
  log.push([g.now, text]);
  if (log.length > 10) log.splice(0, log.length - 10);
}

const shortType = (id: string) => typeOf(id).short;
/** 'an A320', 'a 737'. */
export const aOrAn = (w: string) => (/^[AEIOU8]/.test(w) ? 'an' : 'a');

// ---------- views ----------

export interface RivalView {
  id: string; name: string; country: string; base: string; style: RivalStyle; styleName: string; styleText: string;
  fleet: { typeId: string; count: number }[]; fleetCount: number; fleetDelta: number; busy: number; busyText: string;
  won: number; hiredThem: number; hiredUs: number; level: ClientLevel | null; log: { t: Minute; text: string }[]; ceased: Minute | null;
}

function busyText(g: GameState, r: Rival): string {
  if (!isActive(r)) return `Ceased operations ${r.ceasedAt ? fmtDay(r.ceasedAt) : ''}`.trim();
  const l = r.load ?? loadFor(g, r);
  const m = toDate(g.now).getUTCMonth();
  const why = m >= 5 && m <= 8 ? 'summer peak' : m === 11 || m <= 2 ? 'winter' : 'shoulder season';
  return l >= 0.9 ? `Fully booked: ${why}` : l >= 0.75 ? `Busy: ${why}` : l >= 0.6 ? `Some aircraft free: ${why}` : `Looking for work: ${why}`;
}

/** Where a rival is a good one to hire ('in Europe', 'for widebody work'). */
function hireWhere(r: Rival): string {
  const cont = AIRPORT_BY_CODE[r.base]?.continent;
  const wide = r.fleet.some((f) => typeOf(f.typeId).body === 'wide');
  return `${wide ? 'for widebody work' : 'for narrowbody work'}${cont === 'EU' ? ' in Europe' : cont === 'NA' ? ' in the Americas' : ''}`;
}

/** One rival for the Rivals view and RivalModal. Pure. */
export function rivalView(g: GameState, rivalId: string): RivalView | null {
  const r = g.rivals.find((x) => x.id === rivalId);
  if (!r) return null;
  const style = styleOf(r);
  const n = fleetCount(r);
  const cl = r.clientId ? g.clients[r.clientId] : undefined;
  const hireLine = style === 'cheap' || style === 'big' ? `; a cheap choice to hire when you're stuck ${hireWhere(r)}` : style === 'premium' ? `; hiring them embarrasses us least with a client` : `; a fair choice to hire ${hireWhere(r)}`;
  return {
    id: r.id, name: r.name, country: r.country, base: r.base, style, styleName: STYLE_NAME[style], styleText: `${STYLE_TEXT[style]}${isActive(r) ? hireLine : ''}`,
    fleet: r.fleet.filter((f) => f.count > 0).map((f) => ({ ...f })), fleetCount: n, fleetDelta: n - (r.fleetYearAgo ?? n),
    busy: isActive(r) ? r.load ?? loadFor(g, r) : 0, busyText: busyText(g, r),
    won: r.won ?? 0, hiredThem: r.hiredThem ?? 0, hiredUs: r.hiredUs ?? 0,
    level: cl && (cl.jobs || cl.level === 'unhappy') ? levelOf(g, cl) : null,
    log: [...(r.log ?? [])].reverse().map(([t, text]) => ({ t, text })),
    ceased: r.ceasedAt ?? null,
  };
}

/** Every rival, active first, then by fleet size. Pure. */
export function rivalList(g: GameState): RivalView[] {
  return g.rivals.map((r) => rivalView(g, r.id)!).sort((a, b) => Number(!!a.ceased) - Number(!!b.ceased) || b.fleetCount - a.fleetCount || a.name.localeCompare(b.name));
}

/** 'Rivals: 13 operators · 3 took jobs from us this year'. Pure. */
export function rivalSummary(g: GameState): string {
  const active = g.rivals.filter(isActive).length;
  const won = g.rivals.filter((r) => (r.won ?? 0) > 0).length;
  return `Rivals: ${active} operators · ${won} took jobs from us`;
}

// ---------- bids (§3.3) ----------

/** Style fit for an archetype (who goes for which work). */
function styleFit(style: RivalStyle, a: Archetype): number {
  switch (style) {
    case 'cheap': return a === 'adhoc' || a === 'aogCover' || a === 'seasonBase' || a === 'tourSeries' ? 1.3 : 1;
    // A prestige operator doesn't chase high-density or scramble work.
    case 'premium': return a === 'vip' || a === 'sports' || a === 'musicTour' ? 1.5 : a === 'hajj' || a === 'aogCover' || a === 'seasonBase' || a === 'deportation' ? 0.3 : 1;
    case 'military': return a === 'troopRotation' || a === 'unRotation' || a === 'deportation' || a === 'evacuation' ? 1.5 : 1;
    case 'rescue': return a === 'aogCover' || a === 'evacuation' || a === 'repatriation' ? 1.5 : 1;
    case 'big': return a === 'seasonBase' || a === 'capacityLease' || a === 'hajj' ? 1.3 : 1;
    default: return 1;
  }
}

/** Decide-time window by style: share of the offer's life before the rival signs. */
const WINDOW: Record<RivalStyle, [number, number]> = { cheap: [0.3, 0.7], rescue: [0.2, 0.5], big: [0.4, 0.8], steady: [0.5, 0.9], premium: [0.6, 1.0], military: [0.6, 1.0] };

/** Rival fleet fits the job: the same family when the job names one, else the same body. */
export function rivalFits(r: Rival, o: Pick<ContractOffer, 'requirements'>): boolean {
  const req = o.requirements;
  const wide = req.body ? req.body === 'wide' : req.minSeats >= 230;
  return r.fleet.some((f) => f.count > 0 && (req.families?.length ? req.families.includes(typeOf(f.typeId).family) : (typeOf(f.typeId).body === 'wide') === wide));
}

/** Demand-adjusted segment index at the offer's body (shocks included; ops/market.ts segIndex would be circular). */
function segOf(g: GameState, o: ContractOffer): number {
  const wide = o.requirements.body === 'wide';
  let idx = wide ? g.market.wideIndex : g.market.narrowIndex;
  for (const s of g.market.shocks ?? []) if (s.until > g.now && (s.seg === 'all' || s.seg === (wide ? 'wide' : 'narrow'))) idx += s.delta;
  return idx;
}

/** Our nearest aircraft to the job's start (km), ignoring its schedule (the 'closer' reason). */
function ourNearestKm(g: GameState, at: string): number {
  let best = Infinity;
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'leasedOut' && AIRPORT_BY_CODE[ac.at]) best = Math.min(best, distance(ac.at, at));
  return best;
}

/**
 * At offer creation (§3.3): maybe a rival bids. Chance from the segment index (soft markets: more rivals free),
 * a weighted fitting rival (free capacity, near the job, style), a decide time by style and up to two reasons.
 * Stored on the offer and queued as 'rival.bid'. Side stream per offer (the main sequence is unchanged).
 */
export function rollRivalBid(g: GameState, o: ContractOffer): void {
  if (o.firstRefusal || o.archetype === 'subcharterIn' || o.archetype === 'dryLeaseOut') return;
  const R = V.rivals;
  const r = side(g, `bid:${o.id}`);
  let p = clamp(R.bidBase + R.bidSlope * (1.2 - segOf(g, o)), R.bidMin, R.bidMax);
  if (o.archetype === 'deportation') p *= 0.5;
  if (o.archetype === 'evacuation' || o.archetype === 'repatriation') p = Math.min(R.bidMax, p * 1.2);
  if (!chance(r, p)) return;
  const at = o.pin && AIRPORT_BY_CODE[o.pin] ? o.pin : g.company.homeBase;
  const pool = g.rivals.filter((x) => isActive(x) && rivalFits(x, o) && (x.load ?? loadFor(g, x)) < R.bidLoadMax
    && (o.archetype !== 'deportation' || x.personality === 'cheap' || x.personality === 'military'));
  const rival = weightedPick(r, pool, (x) => {
    const free = 1 - (x.load ?? loadFor(g, x));
    const near = AIRPORT_BY_CODE[x.base] ? 1 / (1 + distance(x.base, at) / 1500) : 0.5;
    const resc = (o.archetype === 'evacuation' || o.archetype === 'repatriation') && (x.personality === 'rescue' || x.personality === 'military') ? 1.5 : 1;
    return free * near * styleFit(styleOf(x), o.archetype) * resc;
  });
  if (!rival) return;
  const [a, b] = WINDOW[styleOf(rival)];
  const life = Math.max(30, o.expires - o.created);
  const t = Math.round(o.created + life * (a + next(r) * (b - a)));
  const why: string[] = [];
  if (rival.priceFactor < R.cheaperBelow) why.push(`quoted about ${Math.round((1 - rival.priceFactor) * 100)} % under the asking rate`);
  const theirs = AIRPORT_BY_CODE[rival.base] ? distance(rival.base, at) : Infinity;
  const ours = ourNearestKm(g, at);
  if (ours - theirs >= R.closerKm) {
    const fam = rival.fleet.find((f) => rivalFits({ ...rival, fleet: [f] }, o));
    const what = fam ? `${aOrAn(shortType(fam.typeId))} ${shortType(fam.typeId)}` : 'an aircraft';
    why.push(`had ${what} at ${AIRPORT_BY_CODE[rival.base]?.city ?? rival.base}, ours were ${(Math.round(ours / 100) * 100).toLocaleString('en-US')} km away`);
  }
  // 'Sooner' only when they really were nearer (or none of ours was near); else they simply answered first.
  if (o.urgency === 'urgent' && why.length < 2 && theirs < ours) why.push('could fly tonight');
  if (!why.length) why.push(styleOf(rival) === 'premium' ? 'offered a better cabin' : 'answered first');
  o.rivalBid = { rivalId: rival.id, at: Math.max(o.created + 15, t), factor: rival.priceFactor, why: why.slice(0, 2).join(' and ') };
  if (o.rivalBid.at < o.expires) schedule(g, o.rivalBid.at, 'rival.bid', o.id);
}

/** Kind of reason, for the bot's tally. */
export function whyKind(why: string): 'cheaper' | 'closer' | 'sooner' {
  return why.startsWith('quoted') ? 'cheaper' : why.startsWith('had a') ? 'closer' : 'sooner';
}

/** A rival takes an offer (bid landed or expiry): closes it, counts, logs; a message when the player had looked at it. */
export function rivalTakes(g: GameState, o: ContractOffer, rival: Rival, why: string): void {
  closeOffer(g, o, 'lost', rival.name);
  o.lostWhy = why;
  rival.won = (rival.won ?? 0) + 1;
  const cl = g.clients[o.clientId]?.name ?? 'the client';
  logRival(g, rival, `Took ${cl}'s ${o.title}`);
  const v8 = statsV08(g);
  v8.lostToRival++;
  const lw = (v8.lostWhy ??= { cheaper: 0, closer: 0, sooner: 0 });
  lw[whyKind(why)]++;
  if (o.seen) {
    pushMessage(g, {
      tone: 'info', cat: 'commercial', title: `${rival.name} took the ${cl} ${o.title.replace(/^.+?: /, '')}`.replace(`the ${cl} ${cl}`, `the ${cl}`),
      body: `They ${why}. Decide sooner, or keep an aircraft near the work.`,
      ref: { kind: 'offer', id: o.id }, problem: { kind: 'lostToRival', ref: { kind: 'offer', id: o.id } },
    });
  }
}

/** 'rival.bid': the rival signs if the offer is still open (or countered without a reply yet). Stale-safe. */
export function onRivalBid(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  const b = o?.rivalBid;
  if (!o || !b || g.now < b.at || o.firstRefusal) return;
  if (o.status !== 'open' && !(o.status === 'countered' && !o.counter?.result)) return;
  const rival = g.rivals.find((r) => r.id === b.rivalId);
  if (!rival || !isActive(rival)) return;
  rivalTakes(g, o, rival, b.why);
}

/** What the player sees before (§3.3): none / some / strong, never the exact time. Pure. */
export function offerCompetition(g: GameState, offerId: string): { level: 'none' | 'some' | 'strong'; text: string; rivalId?: string } {
  const o = g.offers[offerId];
  if (!o || (o.status !== 'open' && o.status !== 'countered')) return { level: 'none', text: '' };
  if (o.firstRefusal) return { level: 'none', text: 'First refusal: they asked us first; no rival will take it before it expires.' };
  const b = o.rivalBid;
  if (!b || b.at >= o.expires) return { level: 'none', text: '' };
  const rival = g.rivals.find((r) => r.id === b.rivalId);
  if (!rival) return { level: 'none', text: '' };
  const strong = b.at <= o.created + (o.expires - o.created) / 2;
  const fast = styleOf(rival) === 'cheap' || styleOf(rival) === 'rescue';
  return {
    level: strong ? 'strong' : 'some', rivalId: rival.id,
    text: `${rival.name} (${STYLE_NAME[styleOf(rival)]}) is also quoting; ${fast ? 'they usually decide fast' : strong ? 'they are keen' : 'they take their time'}.`,
  };
}

/** The player opened or countered this offer (a rival win is then announced). Action. */
export function markOfferSeen(g: GameState, offerId: string): void {
  const o = g.offers[offerId];
  if (o) o.seen = true;
}

// ---------- monthly fleets and load (§3.2) ----------

const MAINSTREAM: Record<'narrow' | 'wide', string[]> = { narrow: ['a320ceo', 'b738', 'a321ceo'], wide: ['a332', 'a333', 'b763'] };

/** Monthly: load, fleet changes by style (logged; a rival passing 25 aircraft gets an inbox line). Side stream per rival and month. */
export function refreshRivals(g: GameState): void {
  const k = monthKey(g.now);
  for (const r of g.rivals) {
    if (!isActive(r)) continue;
    r.load = loadFor(g, r);
    const n0 = fleetCount(r);
    const hist = (r.fleetHist ??= []);
    hist.push(n0);
    if (hist.length > 13) hist.splice(0, hist.length - 13);
    r.fleetYearAgo = hist[0];
    const s = side(g, `fleet:${r.id}:${k}`);
    const st = styleOf(r);
    let d = 0;
    let wideOnly = false;
    if (st === 'big') d = chance(s, 0.25) ? 1 : 0;
    else if (st === 'cheap') d = chance(s, 0.15) ? 1 : chance(s, 0.1 / 0.85) ? -1 : 0;
    else if (st === 'premium') { d = chance(s, 0.1) ? 1 : 0; wideOnly = true; }
    else if (st === 'steady') d = chance(s, 0.08) ? 1 : chance(s, 0.08 / 0.92) ? -1 : 0;
    else d = chance(s, 0.05) ? 1 : chance(s, 0.05 / 0.95) ? -1 : 0;
    if (!d) continue;
    if (d > 0) {
      const own = r.fleet.filter((f) => !wideOnly || typeOf(f.typeId).body === 'wide');
      const typeId = own.length ? pick(s, own).typeId : pick(s, MAINSTREAM[wideOnly ? 'wide' : 'narrow']);
      const row = r.fleet.find((f) => f.typeId === typeId);
      if (row) row.count++;
      else r.fleet.push({ typeId, count: 1 });
      logRival(g, r, `Added ${aOrAn(shortType(typeId))} ${shortType(typeId)} (${fleetCount(r)} aircraft)`);
      if (n0 === 25) pushMessage(g, { tone: 'info', cat: 'commercial', title: `${r.name} passes 25 aircraft`, body: `${r.name} keeps growing: ${fleetCount(r)} aircraft now. Expect them on more of the same work.`, ref: { kind: 'rival', id: r.id } });
    } else {
      const rows = r.fleet.filter((f) => f.count > 0);
      if (!rows.length || n0 <= 2) continue;
      const row = pick(s, rows);
      row.count--;
      logRival(g, r, `Returned ${aOrAn(shortType(row.typeId))} ${shortType(row.typeId)} to its lessor (${fleetCount(r)} aircraft)`);
    }
  }
}

/** Load (and new game): styles re-tagged by name, v0.8 fields, a client record per rival (kind 'operator'). */
export function loadRivals(g: GameState): void {
  for (const r of g.rivals) {
    const st = RIVAL_STYLE[r.name];
    if (st && r.personality !== st && !r.won && !r.log?.length) r.personality = st;
    r.status ??= 'active';
    r.log ??= [];
    r.won ??= 0;
    r.hiredThem ??= 0;
    r.hiredUs ??= 0;
    r.load ??= loadFor(g, r);
    r.fleetYearAgo ??= fleetCount(r);
    if (!r.clientId || !g.clients[r.clientId]) {
      const id = nextId(g, 'cl');
      g.clients[id] = {
        id, name: r.name, kind: 'operator', country: r.country, base: r.base, payReliability: 0.88, lateDays: [5, 20], cleanSensitivity: 0.3, relation: 0,
        rivalId: r.id, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new',
      };
      r.clientId = id;
    }
  }
}

/** The rival a client record stands for. Pure. */
export const rivalOfClient = (g: GameState, clientId: string): Rival | undefined => {
  const id = g.clients[clientId]?.rivalId;
  return id ? g.rivals.find((r) => r.id === id) : undefined;
};

/** 'Trusted' etc. for a rival as a client (Rivals view). Pure. */
export const rivalLevelName = (g: GameState, r: Rival): string | null => (r.clientId && g.clients[r.clientId] ? LEVEL_NAME[levelOf(g, g.clients[r.clientId])] : null);

/** Records a hire of a rival by us (sub-charter out). */
export function noteHiredThem(g: GameState, rivalId: string, legs: number, clientName: string): void {
  const r = g.rivals.find((x) => x.id === rivalId);
  if (!r) return;
  r.hiredThem = (r.hiredThem ?? 0) + 1;
  logRival(g, r, `We hired them for ${legs} leg${legs === 1 ? '' : 's'} of ${clientName}`);
  const v8 = statsV08(g);
  const by = (v8.subByRival ??= {});
  by[rivalId] = (by[rivalId] ?? 0) + 1;
}

/** Records a job a rival gave us (sub-charter in signed). */
export function noteHiredUs(g: GameState, rivalId: string, title: string): void {
  const r = g.rivals.find((x) => x.id === rivalId);
  if (!r) return;
  r.hiredUs = (r.hiredUs ?? 0) + 1;
  logRival(g, r, `Hired us: ${title}`);
}

/** A rival ceases operations (world event). */
export function ceaseRival(g: GameState, rivalId: string): void {
  const r = g.rivals.find((x) => x.id === rivalId);
  if (!r || !isActive(r)) return;
  r.status = 'ceased';
  r.ceasedAt = g.now;
  logRival(g, r, 'Ceased operations');
}

