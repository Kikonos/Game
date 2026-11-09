// v0.17 short-term aircraft from airlines (UPDATE-0.17.md §I; lane `supply`): dry subleases of an airline's spare
// aircraft in its quiet season (Cebu Pacific's A320s to flyadeal, Norse's 787-9s to IndiGo). 3–9 months inside the
// airline's window, ending on a fixed return date, at the type's mid-life rent × 1.15–1.30, one month's deposit (two at
// D), reserves at the mid rate with no minimum hours; handed over and returned at the airline's base after a 1-day
// inspection. No lessor credit check, but the family must be on our AOC already. They come as calls (narrowbody 0.7 a
// month, widebody 0.12, at most 2 open, each open 5–10 days) or by asking the airlines in their window
// (Fleet › Market › Short-term…): they answer in 3–10 days with 0–2 offers.

import { type RatingFamily } from '../../data/acmiTypes';
import { SPOT_SOURCES, type SpotSource } from '../../data/market';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { typeOf } from '../core/perf';
import { chance, int, pick, type RngHolder } from '../core/rng';
import { DAY, fmtDay, toDate, fmtSpan } from '../core/time';
import type { ActionResult, AircraftOffer, GameState, Minute, Rfp } from '../core/types';
import { aircraftGate } from '../ops/company';
import { bandsFor, makeOffer, postOffer, shortName } from '../ops/market';
import { lockOf } from '../scenario/rules';
import { familyOnAoc } from './aoc';
import { leasingSide } from './side';
import { gradeNow } from './terms';
import { tightNow } from './tightness';

const P = () => BAL.v017.spot;
const MONTH = 30.44 * DAY;

export interface SpotDraft { family: RatingFamily; months: number; from: Minute }

/** Whole months from `t` to the end of the source's quiet window (0 when `t` is outside it). Pure. */
export function windowMonthsLeft(src: SpotSource, t: Minute): number {
  const d = toDate(t);
  let mo = d.getUTCMonth();
  if (!src.months.includes(mo)) return 0;
  // Months still to run after this one, plus what is left of this one.
  let n = 0;
  for (let i = 1; i <= 12 && src.months.includes((mo + i) % 12); i++) n++;
  mo = d.getUTCDate();
  return n + (1 - (mo - 1) / 30);
}

/** Sources with a spare aircraft of a family free at `t` for at least `months` (3 at the least). Pure. */
export function sourcesFor(family: RatingFamily | null, t: Minute, months = P().months[0]): SpotSource[] {
  return SPOT_SOURCES.filter((s) => AIRPORT_BY_CODE[s.base] && (family === null || typeOf(s.typeId).family === family) && windowMonthsLeft(s, t) >= months);
}

/** Airlines with a spare aircraft of the family in that window (the dialog's line). Pure. */
export function spotSources(g: GameState, d: SpotDraft): string[] {
  void g;
  return sourcesFor(d.family, d.from, Math.max(P().months[0], Math.min(P().months[1], d.months))).map((s) => s.airline);
}

/** Why a short-term aircraft of this family can't be had now (null: it can). Pure. */
function spotBlock(g: GameState, family: RatingFamily, typeId: string): string | null {
  if (!BAL.v017.on) return 'Short-term aircraft are not on the market';
  const lk = lockOf(g, 'fleet');
  if (lk) return lk;
  if (!(g.company.aocFamilies ?? []).includes(family) || !familyOnAoc(g, family)) return `No ${family} on our AOC: short-term aircraft need a family we already fly`;
  const gate = aircraftGate(g, typeId);
  if (!gate.ok) return gate.text;
  return null;
}

/** One short-term offer from a source, `months` long from a handover 7–14 days after signing. */
function spotOffer(g: GameState, src: SpotSource, months: number, r: RngHolder, rfpId?: string): AircraftOffer {
  const t = typeOf(src.typeId);
  const lead: [number, number] = [7, 14];
  const handover = g.now + Math.round((lead[0] + lead[1]) / 2) * DAY;
  const returnAt = handover + Math.round(months * MONTH);
  const bands = bandsFor(g, t).filter((b) => b === 'young' || b === 'mid');
  return makeOffer(g, t, {
    source: 'spot', months, band: bands.length ? pick(r, bands) : 'mid', grade: gradeNow(g).grade, lead, days: P().days,
    spot: { airline: src.airline, base: src.base, returnAt }, ...(rfpId ? { rfpId } : {}),
  });
}

/** Short-term offers open now. Pure. */
const openSpot = (g: GameState) => g.market.aircraft.filter((o) => o.source === 'spot' && o.expires > g.now);

/** Asks the airlines with that family in their quiet window (§I.3). They answer in 3–10 days with 0–2 offers. */
export function askSpot(g: GameState, d: SpotDraft): ActionResult<{ rfpId: string }> {
  const L = g.leasing;
  if (!L) return { ok: false, error: 'Short-term aircraft are not on the market' };
  const months = Math.round(d.months);
  if (months < P().months[0] || months > P().months[1]) return { ok: false, error: `Short-term leases run ${fmtSpan(P().months[0], P().months[1], 'months')}` };
  const from = Math.max(d.from, g.now);
  const srcs = sourcesFor(d.family, from, months);
  if (!srcs.length) {
    const any = SPOT_SOURCES.filter((s) => typeOf(s.typeId).family === d.family);
    return { ok: false, error: any.length ? `No airline has a spare ${d.family} for ${months} months from ${fmtDay(from)}` : `No airline subleases a ${d.family} short-term` };
  }
  const block = spotBlock(g, d.family, srcs[0].typeId);
  if (block) return { ok: false, error: block };
  if (L.rfps.some((x) => x.spot && x.status === 'open')) return { ok: false, error: 'A short-term request is already out' };
  const r = leasingSide(g, `spotAsk:${g.now}`);
  const id = nextId(g, 'rfp');
  const answers = srcs.map((s) => ({ lessorId: s.airline, due: g.now + int(r, P().askReply[0], P().askReply[1]) * DAY }));
  const rfp: Rfp = {
    id, typeId: srcs[0].typeId, band: 'mid', months, count: 1, from, asap: from <= g.now + 14 * DAY, flex: true,
    sent: g.now, replyBy: Math.max(...answers.map((a) => a.due)), answers, status: 'open', spot: true,
  };
  L.rfps.push(rfp);
  L.stats.rfps++;
  L.rev = (L.rev ?? 0) + 1;
  return { ok: true, msg: `Asked ${srcs.length} airline${srcs.length > 1 ? 's' : ''}: answers by ${fmtDay(rfp.replyBy)}`, data: { rfpId: id } };
}

/** Daily: short-term calls (sources in their window, families on our AOC) and the answers to our short-term requests. */
export function dailySpot(g: GameState): void {
  const L = g.leasing;
  if (!L || !BAL.v017.on) return;
  const r = leasingSide(g, `spot:${Math.floor(g.now / DAY)}`);
  // Calls: narrowbody 0.7 a month, widebody 0.12, at most 2 open.
  for (const body of ['narrow', 'wide'] as const) {
    if (!chance(r, (body === 'wide' ? P().widePerMonth : P().narrowPerMonth) / 30.44)) continue;
    if (openSpot(g).length >= P().maxOpen) continue;
    const srcs = sourcesFor(null, g.now + 14 * DAY).filter((s) => typeOf(s.typeId).body === body && !spotBlock(g, typeOf(s.typeId).family, s.typeId));
    if (!srcs.length) continue;
    const src = pick(r, srcs);
    const left = Math.floor(windowMonthsLeft(src, g.now + 14 * DAY));
    const months = int(r, P().months[0], Math.max(P().months[0], Math.min(P().months[1], left)));
    postOffer(g, spotOffer(g, src, months, r));
    L.stats.spot++;
  }
  // Answers to short-term requests.
  for (const q of L.rfps) {
    if (!q.spot || q.status !== 'open') continue;
    for (const a of q.answers) {
      if (a.at !== undefined || a.due > g.now) continue;
      a.at = g.now;
      const src = SPOT_SOURCES.find((s) => s.airline === a.lessorId);
      const rr = leasingSide(g, `spot:${q.id}:${a.lessorId}`);
      const made = q.answers.reduce((n, x) => n + (x.offerIds?.length ?? 0), 0);
      const t = src ? typeOf(src.typeId) : null;
      const p = t ? (t.body === 'wide' ? P().askChance.wide : P().askChance.narrow) * (1 - tightNow(g, t.id) + 0.3) : 0;
      if (src && t && made < 2 && windowMonthsLeft(src, q.from) >= q.months && !spotBlock(g, t.family, t.id) && chance(rr, p)) {
        const o = spotOffer(g, src, q.months, rr, q.id);
        postOffer(g, o, { quiet: true });
        a.kind = 'proposal';
        a.offerIds = [o.id];
        L.stats.spot++;
      } else {
        a.kind = 'none';
        a.text = 'No spare aircraft for those months';
      }
      L.rev = (L.rev ?? 0) + 1;
    }
    if (q.answers.every((a) => a.at !== undefined)) {
      q.status = 'done';
      const yes = q.answers.filter((a) => a.kind === 'proposal');
      const no = q.answers.length - yes.length;
      const fam = shortName(typeOf(q.typeId));
      pushMessage(g, {
        tone: yes.length ? 'good' : 'info', cat: 'company', topic: 'market', ...(yes.length ? { cue: 'offerNew' as const } : {}),
        title: `Short-term ${fam}: ${yes.length ? `${yes.length} offer${yes.length > 1 ? 's' : ''}` : 'no offers'}`,
        body: `${yes.length ? `${yes.map((a) => a.lessorId).join(', ')} can sublease one for ${q.months} months. ` : ''}${no ? `${no} had none spare.` : ''}`.trim(),
        ...(yes.length && yes[0].offerIds?.[0] ? { ref: { kind: 'market' as const, id: yes[0].offerIds[0] } } : {}),
      });
      if (yes.length) requestPause('marketOffer');
    }
  }
}
