// v0.22.1 a one-off refund for the crew-planning error behind the player's CVE166 (save "Chevron", May 2027): an aircraft
// on a base programme was taken to another job while its own legs were sub-leased; the ferry out went uncrewed again and
// again although the station's sets were idle (a tour held them "busy" for the whole rotation: check.ts otherTrip), and
// each time the new job's first legs were sub-chartered or cancelled. Loading an older save gives that money back, once
// (Stats.planRefund): the sub-charter costs and the compensation, with the reliability and the client's relation they
// cost. Only losses the save itself ties to the error are touched:
// 1. an Inbox alarm for an empty leg that names a station's crew "busy on <flight> on <a day at least two days on>"
//    (the tour hold), at a station where a deployment of ours was on;
// 2. within two days of such an alarm, a hand-over or a cancellation "Waiting for crew" on another job of that
//    deployment's aircraft, or Crew Control's sub-charter of the alarmed empty leg itself.
// The amounts are the messages' own (their exact figure when kept, else the rounded one in the text).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay } from '../core/time';
import type { Contract, GameState, Message, Minute } from '../core/types';
import { bumpReliable } from '../ops/util';
import { bumpClient } from '../contracts/relations';

export interface PlanLoss {
  msgId: string;
  t: Minute;
  kind: 'subcharter' | 'cancel';
  /** The flight the message is about ('CVE161', 'U27080'). */
  no: string;
  money: number;
}

export interface PlanLosses {
  /** The empty legs the alarms were about, in time order ('CVE161', …). */
  legs: string[];
  /** The station whose idle crew were called busy. */
  station: string;
  contracts: Contract[];
  items: PlanLoss[];
  money: number;
  /** Reliability points lost with the hand-overs (positive). */
  reliability: number;
  /** Relation points lost per client (positive). */
  relation: [string, number][];
}

const WINDOW = 2 * DAY;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FLIGHT_NO = /\b([A-Z][A-Z0-9]{1,2}\d{1,4})\b/;

/** '$52K' / '$1.2M' / '$60,573' in a message → dollars (0 when none). */
function usdIn(text: string, re: RegExp): number {
  const m = re.exec(text);
  if (!m) return 0;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * (m[2] === 'M' ? 1e6 : m[2] === 'K' ? 1e3 : 1)) : 0;
}

/** The alarm's "busy on … on 9 May until" day is at least two days after the alarm (a tour's hold, not today's flying). */
function heldDaysOn(m: Message): boolean {
  const re = /is busy on [^;.]*? on (\d{1,2}) ([A-Z][a-z]{2}) until/g;
  const day = Math.floor(m.t / DAY);
  const y = new Date(m.t * 60_000).getUTCFullYear();
  for (let x = re.exec(m.body); x; x = re.exec(m.body)) {
    const mon = MONTHS.indexOf(x[2]);
    if (mon < 0) continue;
    for (const yy of [y, y + 1]) {
      const d = Math.floor(Date.UTC(yy, mon, Number(x[1])) / 86_400_000);
      if (d >= day + 2 && d < day + 60) return true;
    }
  }
  return false;
}

/** What the save itself ties to the crew-planning error (null: nothing). Pure. */
export function planLosses(g: GameState): PlanLosses | null {
  const deps = Object.values(g.deployments);
  // 1. the alarms: an empty leg, a station's crew "busy" on a duty days away, at a station of a deployment then on.
  const alarms: { m: Message; no: string; depId: string }[] = [];
  for (const m of g.messages) {
    if (m.cat !== 'crew' || !/this empty leg was planned/.test(m.body)) continue;
    const st = /\bIn ([^:.]+): /.exec(m.body)?.[1];
    const no = FLIGHT_NO.exec(m.title)?.[1];
    if (!st || !no || !heldDaysOn(m)) continue;
    const dep = deps.find((d) => d.start <= m.t && d.end > m.t && (AIRPORT_BY_CODE[d.base]?.city ?? d.base) === st);
    if (dep) alarms.push({ m, no, depId: dep.id });
  }
  if (!alarms.length) return null;
  alarms.sort((a, b) => a.m.t - b.m.t);
  const from = alarms[0].m.t;
  const to = alarms[alarms.length - 1].m.t + WINDOW;
  const legs = [...new Set(alarms.map((a) => a.no))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const stationDeps = new Set(alarms.map((a) => a.depId));
  // 2. the other jobs of those deployments' aircraft over the window.
  const acs = new Set<string>();
  const own = new Set<string>();
  for (const id of stationDeps) {
    acs.add(g.deployments[id].aircraftId);
    own.add(g.deployments[id].contractId);
  }
  const contracts = Object.values(g.contracts).filter((k) => !own.has(k.id) && k.aircraftIds.some((a) => acs.has(a)) && k.start < to && k.end > from);
  const ks = new Set(contracts.map((k) => k.id));
  const clients = new Set(contracts.map((k) => k.clientId));
  const items: PlanLoss[] = [];
  for (const m of g.messages) {
    if (m.t < from || m.t > to) continue;
    const no = FLIGHT_NO.exec(m.title)?.[1] ?? '';
    const waited = /^Waiting for crew:/.test(m.body) && m.problem?.kind === 'penalty' && m.problem.ref.kind === 'contract' && ks.has(m.problem.ref.id);
    if (/ sub-chartered/.test(m.title) && m.cat === 'crew') {
      // Crew Control's sub-charter of the alarmed empty leg itself, or operations' hand-over while waiting for its crew.
      const fix = /sub-chartered: /.test(m.title) && legs.includes(no) && contracts.length > 0;
      if (!fix && !waited) continue;
      const money = m.hurt?.money || usdIn(m.body, /\(\$([\d.,]+)([KM])?\)/) || usdIn(m.body, /for \$([\d.,]+)([KM])?/);
      if (money > 0) items.push({ msgId: m.id, t: m.t, kind: 'subcharter', no, money });
    } else if (/cancelled/.test(m.title) && waited) {
      const money = m.hurt?.money || usdIn(m.body, /Compensation \$([\d.,]+)([KM])?/);
      if (money > 0) items.push({ msgId: m.id, t: m.t, kind: 'cancel', no, money });
    }
  }
  if (!items.length) return null;
  items.sort((a, b) => a.t - b.t || (a.msgId < b.msgId ? -1 : 1));
  const times = new Set(items.map((i) => i.t));
  let reliability = 0;
  for (const [t, id, v] of g.stats.subCap ?? []) if (times.has(t) && clients.has(id)) reliability -= v;
  const relation: [string, number][] = [];
  for (const id of clients) {
    let d = 0;
    for (const [t, v, why] of g.clients[id]?.log ?? []) if (times.has(t) && v < 0 && /^(Handed flights to |Cancelled )/.test(why)) d -= v;
    if (d > 0) relation.push([id, Math.round(d * 100) / 100]);
  }
  return { legs, station: g.deployments[alarms[0].depId].base, contracts, items, money: items.reduce((s, i) => s + i.money, 0), reliability: Math.round(reliability * 10) / 10, relation };
}

const usd = (v: number): string => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`);

/**
 * Once, on loading an older save: the losses of the crew-planning error are given back (the ledger's own 'refund' line,
 * the reliability and the relation), with one quiet Inbox line. A new game and a save of this version never run it.
 */
export function refundPlanLosses(g: GameState): void {
  if (g.stats.planRefund !== undefined) return;
  g.stats.planRefund = 0;
  const x = planLosses(g);
  if (!x) return;
  g.stats.planRefund = x.money;
  post(g, 'refund', x.money);
  if (x.reliability > 0) {
    bumpReliable(g, x.reliability);
    const times = new Set(x.items.map((i) => i.t));
    const clients = new Set(x.contracts.map((k) => k.clientId));
    // The hand-overs given back no longer count on the week's cap or the year's tally.
    g.stats.subCap = (g.stats.subCap ?? []).filter(([t, id]) => !(times.has(t) && clients.has(id)));
    if (g.stats.subHit !== undefined) g.stats.subHit = Math.round((g.stats.subHit + x.reliability) * 10) / 10;
  }
  for (const [id, d] of x.relation) bumpClient(g, id, d, 'Refund: crew planning error');
  const sub = x.items.filter((i) => i.kind === 'subcharter').reduce((s, i) => s + i.money, 0);
  const pen = x.money - sub;
  const city = AIRPORT_BY_CODE[x.station]?.city ?? x.station;
  const parts = [sub ? `sub-charters ${usd(sub)}` : '', pen ? `compensation ${usd(pen)}` : ''].filter(Boolean).join(' and ');
  const back = [
    x.reliability > 0 ? `reliability +${x.reliability.toFixed(1)}` : '',
    ...x.relation.map(([id, d]) => `${g.clients[id]?.name ?? 'the client'} +${d.toFixed(1)}`),
  ].filter(Boolean).join(', ');
  pushMessage(g, {
    tone: 'good', cat: 'finance', cue: null,
    title: `Refund: crew planning error, ${x.legs[x.legs.length - 1]} (${usd(x.money)})`,
    body: `The game was wrong: the crew at ${city} could have flown the empty leg ${x.legs[0]}${x.legs.length > 1 ? ` (planned again ${x.legs.length - 1} times, up to ${x.legs[x.legs.length - 1]})` : ''}, so the flights handed over or cancelled for want of pilots from ${fmtDay(x.items[0].t)} should not have cost you. Given back: ${parts}${back ? `; ${back}` : ''}. Fixed in this version.`,
  });
}
