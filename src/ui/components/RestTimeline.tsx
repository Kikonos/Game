// v0.7.3 in-flight rest timeline (UPDATE-0.7.3.md §2.6 item 4): the duty's legs from take-off to landing with the
// cruise shaded, v0.18.3 the pilots as pairs ('2 CPT + 2 FO · pairs A/B') with a lane of who is at the controls, then
// one row per pilot turn ('Capt. Silva · lands · 3:20 · bunk   00:49–03:09 UTC') and per cabin
// crew group ('Group A (4) · 2:40 · lower deck', names under it), each a full-width line of words over its bar so
// nothing is cut off and the times read on touch. A static drawing: no motion, no hover, re-rendered only when the
// plan changes (the engine memoises it per duty).

import { memo } from 'react';
import { fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { pilotPairs, restWhere, seatName, seatPair, type PilotPair, type RestPlan, type RestTurn } from '../../engine/crew';

const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;

export interface RestLegBar { id: string; no: string; from: string; to: string; std: number; sta: number; x0: number; x1: number; c0: number; c1: number; /** Crew bug round: nobody rests on this leg. */ noRest: boolean }
export interface RestRow {
  key: string; side: 'pilots' | 'cabin';
  /** 'Capt. Silva' / 'Group A (4)'; len '3:20'; where 'bunk'; when '00:49–03:09 UTC'; names: a cabin group's crew. */
  who: string; len: string; where: string; when: string; names: string[];
  /** One line for screen readers: 'FO Reis · lands · 3:00 · bunk'. */
  text: string; x0: number; x1: number; landing: boolean; title: string;
  /** v0.18.3 a pilot's pair ('A', 'B', 'relief'). */
  pair?: PilotPair;
}
/** v0.18.3 one stretch of the 'At the controls' lane: 'A' / 'B' / 'CPT + FO 2'. */
export interface ControlsBlock { key: string; who: string; pair: PilotPair | null; x0: number; x1: number }

/** 'Capt. Silva' / 'FO Reis' / 'Capt. Melo (as FO)'; the seat ('CPT', 'FO 2') while nobody is rostered. */
function pilotName(g: GameState, t: RestTurn): string {
  return t.seat ? seatName(g, t.seat, t.crewIds[0]) : 'Pilot';
}
const PAIR_WORD: Record<PilotPair, string> = { A: 'pair A', B: 'pair B', relief: 'relief' };

/** Legs (x in % of take-off → landing) and the rows of a plan. Pure. */
export function restLayout(g: GameState, plan: RestPlan): { legs: RestLegBar[]; rows: RestRow[]; t0: number; t1: number; pairs: { line: string; members: string; controls: string; blocks: ControlsBlock[] } | null } | null {
  const fl = plan.cruise.map((c) => g.flights[c.flightId]).filter((f) => !!f);
  if (!fl.length) return null;
  const t0 = fl[0].atd ?? fl[0].std;
  const t1 = Math.max(t0 + 1, ...fl.map((f) => f.ata ?? f.eta ?? f.sta));
  const x = (t: number) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
  const restOn = new Set([...plan.pilots, ...plan.cabin].map((t) => t.flightId));
  const legs: RestLegBar[] = plan.cruise.map((c) => {
    const f = g.flights[c.flightId];
    const std = f ? f.atd ?? f.std : c.from;
    const sta = f ? f.ata ?? f.eta ?? f.sta : c.to;
    return { id: c.flightId, no: f?.no ?? '', from: f?.from ?? '', to: f?.to ?? '', std, sta, x0: x(std), x1: x(sta), c0: x(c.from), c1: x(c.to), noRest: plan.ok && plan.cruise.length > 1 && !restOn.has(c.flightId) };
  });
  const rows: RestRow[] = [];
  for (const [i, t] of plan.pilots.entries()) {
    const who = pilotName(g, t);
    const len = hm(t.end - t.start);
    const where = restWhere(t.where);
    const when = `${fmtTime(t.start)}–${fmtTime(t.end)} UTC`;
    const pair = t.seat ? seatPair(t.seat, plan.augment) : undefined;
    const text = `${pair ? `${PAIR_WORD[pair][0].toUpperCase()}${PAIR_WORD[pair].slice(1)} · ` : ''}${who}${t.landing ? ' · lands' : ''} · ${len} · ${where}`;
    rows.push({ key: `p${i}`, side: 'pilots', who, len, where, when, names: [], text, x0: x(t.start), x1: x(t.end), landing: !!t.landing, title: `${text} · ${when} (at least ${hm(t.need)})`, ...(pair ? { pair } : {}) });
  }
  for (const [i, t] of plan.cabin.entries()) {
    const label = `Group ${String.fromCharCode(65 + (t.group ?? 0))} (${t.n})`;
    const names = t.crewIds.map((id) => g.crew[id]).filter((c) => !!c).map((c) => `${c!.first} ${c!.last}`);
    const len = hm(t.end - t.start);
    const where = restWhere(t.where);
    const when = `${fmtTime(t.start)}–${fmtTime(t.end)} UTC`;
    const text = `${label} · ${len} · ${where}`;
    rows.push({ key: `c${i}`, side: 'cabin', who: label, len, where, when, names, text, x0: x(t.start), x1: x(t.end), landing: false, title: `${text} · ${when}${names.length ? ` · ${names.join(', ')}` : ''}` });
  }
  let pairs = null;
  if (plan.pilots.length) {
    const pv = pilotPairs(g, plan);
    const blocks: ControlsBlock[] = [];
    for (const l of pv.legs) {
      const f = g.flights[l.flightId];
      const c = plan.cruise.find((y) => y.flightId === l.flightId);
      if (!f || !c) continue;
      const std = f.atd ?? f.std;
      const sta = f.ata ?? f.eta ?? f.sta;
      // Take-off and climb, then each cruise stretch, then descent and landing (the landing pair: A).
      const parts = [{ from: std, to: c.from, who: l.takeoff, pair: 'A' as PilotPair | null }, ...l.cruise, { from: c.to, to: sta, who: l.landing, pair: 'A' as PilotPair | null }];
      for (const [k, b] of parts.entries()) {
        const last = blocks[blocks.length - 1];
        if (last && last.who === b.who && (last.key.startsWith(`${l.flightId}-`) || Math.abs(last.x1 - x(b.from)) < 0.01)) last.x1 = Math.max(last.x1, x(b.to));
        else blocks.push({ key: `${l.flightId}-${k}`, who: b.who, pair: b.pair, x0: x(b.from), x1: x(b.to) });
      }
    }
    pairs = { line: pv.line, members: pv.members, controls: pv.controls, blocks };
  }
  return { legs, rows, t0, t1, pairs };
}

/** v0.18.3 'At the controls' lane: A / B stretches on the take-off → landing scale. */
function Controls({ blocks }: { blocks: ControlsBlock[] }) {
  return (
    <div className="rt-row controls">
      <div className="rt-line"><b className="rt-who">At the controls</b></div>
      <div className="rt-lane rt-ctl">
        {blocks.map((b) => (
          <span key={b.key} className={`rt-cb ${b.pair === 'B' ? 'b' : b.pair === 'A' ? 'a' : 'mix'}`} style={{ left: `${b.x0}%`, width: `${Math.max(1, b.x1 - b.x0)}%` }} title={b.pair ? `Pair ${b.pair}` : b.who}>
            {b.x1 - b.x0 > (b.pair ? 4 : 18) ? (b.pair ?? b.who) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

function Row({ r }: { r: RestRow }) {
  // Words on their own line (wrapping, never cut), the bar under them on the shared take-off → landing scale.
  return (
    <div className={`rt-row ${r.side}`} title={r.title}>
      <div className="rt-line">
        {r.pair && <span className={`rt-pair ${r.pair}`}>{r.pair === 'relief' ? 'relief' : r.pair}</span>}
        <b className="rt-who">{r.who}</b>
        {r.landing && <span className="rt-tag">lands</span>}
        <span className="num">{r.len}</span>
        <span className="rt-where">· {r.where}</span>
        <span className="rt-when num">{r.when}</span>
      </div>
      {r.names.length > 0 && <div className="rt-names">{r.names.join(', ')}</div>}
      <div className="rt-lane">
        <span className={`rt-blk ${r.side} ${r.landing ? 'landing' : ''}`} style={{ left: `${r.x0}%`, width: `${Math.max(1, r.x1 - r.x0)}%` }} />
      </div>
    </div>
  );
}

/** The static rest timeline of a plan (pilots by name, cabin crew in groups). */
export const RestTimeline = memo(function RestTimeline({ g, plan }: { g: GameState; plan: RestPlan }) {
  const lay = restLayout(g, plan);
  if (!lay) return null;
  const pilots = lay.rows.filter((r) => r.side === 'pilots');
  const cabin = lay.rows.filter((r) => r.side === 'cabin');
  const first = lay.legs[0];
  const last = lay.legs[lay.legs.length - 1];
  return (
    <div className="rt" role="img" aria-label={[...(lay.pairs ? [lay.pairs.line, lay.pairs.members, lay.pairs.controls] : []), ...lay.rows.map((r) => r.text)].join('; ')}>
      <div className="rt-legs">
        {lay.legs.map((l) => (
          <span key={l.id} className={`rt-leg${l.noRest ? ' norest' : ''}`} title={l.noRest ? `${l.no}: no rest on this leg` : undefined} style={{ left: `${l.x0}%`, width: `${Math.max(1, l.x1 - l.x0)}%` }}>
            <span className="rt-cruise" style={{ left: `${((l.c0 - l.x0) / Math.max(0.01, l.x1 - l.x0)) * 100}%`, width: `${(Math.max(0, l.c1 - l.c0) / Math.max(0.01, l.x1 - l.x0)) * 100}%` }} />
            {l.x1 - l.x0 > 28 && <span className="rt-leg-t">{l.no} {l.from}–{l.to}</span>}
          </span>
        ))}
      </div>
      {lay.legs.some((l) => l.x1 - l.x0 <= 28) && <div className="rt-note">{lay.legs.map((l) => `${l.no} ${l.from}–${l.to}${l.noRest ? ' (no rest)' : ''}`).join(' · ')}</div>}
      {pilots.length > 0 && <div className="rt-head">Pilots{lay.pairs && <span className="rt-crew"> · {lay.pairs.line}</span>}</div>}
      {lay.pairs && <div className="rt-pairs">{lay.pairs.members}</div>}
      {lay.pairs && lay.pairs.blocks.length > 0 && <Controls blocks={lay.pairs.blocks} />}
      {pilots.map((r) => <Row key={r.key} r={r} />)}
      {cabin.length > 0 && <div className="rt-head">Cabin crew</div>}
      {cabin.map((r) => <Row key={r.key} r={r} />)}
      <div className="rt-times">
        <span>Take-off {fmtTime(first.std)} UTC · {fmtTime(first.std, first.from)} {first.from}</span>
        <span>Landing {fmtTime(last.sta)} UTC · {fmtTime(last.sta, last.to)} {last.to}</span>
      </div>
    </div>
  );
});
