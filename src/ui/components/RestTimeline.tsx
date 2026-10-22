// v0.7.3 in-flight rest timeline (UPDATE-0.7.3.md §2.6 item 4): the duty's legs from take-off to landing with the
// cruise shaded, then one row per pilot turn ('Capt. Silva · lands · 3:20 · bunk   00:49–03:09 UTC') and per cabin
// crew group ('Group A (4) · 2:40 · lower deck', names under it), each a full-width line of words over its bar so
// nothing is cut off and the times read on touch. A static drawing: no motion, no hover, re-rendered only when the
// plan changes (the engine memoises it per duty).

import { memo } from 'react';
import { fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { restWhere, type RestPlan, type RestTurn } from '../../engine/crew';

const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;
const SEAT_WORD: Record<string, string> = { CPT: 'CPT', FO: 'FO', CRP: 'CRP', CPT2: 'CPT 2', FO2: 'FO 2' };

export interface RestLegBar { id: string; no: string; from: string; to: string; std: number; sta: number; x0: number; x1: number; c0: number; c1: number }
export interface RestRow {
  key: string; side: 'pilots' | 'cabin';
  /** 'Capt. Silva' / 'Group A (4)'; len '3:20'; where 'bunk'; when '00:49–03:09 UTC'; names: a cabin group's crew. */
  who: string; len: string; where: string; when: string; names: string[];
  /** One line for screen readers: 'FO Reis · lands · 3:00 · bunk'. */
  text: string; x0: number; x1: number; landing: boolean; title: string;
}

/** 'Capt. Silva' / 'FO Reis' / 'CRP Costa'; the seat ('CPT', 'FO 2') while nobody is rostered. */
function pilotName(g: GameState, t: RestTurn): string {
  const c = t.crewIds[0] ? g.crew[t.crewIds[0]] : undefined;
  if (!c) return SEAT_WORD[t.seat ?? ''] ?? t.seat ?? 'Pilot';
  return `${t.seat === 'CPT' || t.seat === 'CPT2' ? 'Capt.' : t.seat === 'CRP' ? 'CRP' : 'FO'} ${c.last}`;
}

/** Legs (x in % of take-off → landing) and the rows of a plan. Pure. */
export function restLayout(g: GameState, plan: RestPlan): { legs: RestLegBar[]; rows: RestRow[]; t0: number; t1: number } | null {
  const fl = plan.cruise.map((c) => g.flights[c.flightId]).filter((f) => !!f);
  if (!fl.length) return null;
  const t0 = fl[0].atd ?? fl[0].std;
  const t1 = Math.max(t0 + 1, ...fl.map((f) => f.ata ?? f.eta ?? f.sta));
  const x = (t: number) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
  const legs: RestLegBar[] = plan.cruise.map((c) => {
    const f = g.flights[c.flightId];
    const std = f ? f.atd ?? f.std : c.from;
    const sta = f ? f.ata ?? f.eta ?? f.sta : c.to;
    return { id: c.flightId, no: f?.no ?? '', from: f?.from ?? '', to: f?.to ?? '', std, sta, x0: x(std), x1: x(sta), c0: x(c.from), c1: x(c.to) };
  });
  const rows: RestRow[] = [];
  for (const [i, t] of plan.pilots.entries()) {
    const who = pilotName(g, t);
    const len = hm(t.end - t.start);
    const where = restWhere(t.where);
    const when = `${fmtTime(t.start)}–${fmtTime(t.end)} UTC`;
    const text = `${who}${t.landing ? ' · lands' : ''} · ${len} · ${where}`;
    rows.push({ key: `p${i}`, side: 'pilots', who, len, where, when, names: [], text, x0: x(t.start), x1: x(t.end), landing: !!t.landing, title: `${text} · ${when} (at least ${hm(t.need)})` });
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
  return { legs, rows, t0, t1 };
}

function Row({ r }: { r: RestRow }) {
  // Words on their own line (wrapping, never cut), the bar under them on the shared take-off → landing scale.
  return (
    <div className={`rt-row ${r.side}`} title={r.title}>
      <div className="rt-line">
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
    <div className="rt" role="img" aria-label={lay.rows.map((r) => r.text).join('; ')}>
      <div className="rt-legs">
        {lay.legs.map((l) => (
          <span key={l.id} className="rt-leg" style={{ left: `${l.x0}%`, width: `${Math.max(1, l.x1 - l.x0)}%` }}>
            <span className="rt-cruise" style={{ left: `${((l.c0 - l.x0) / Math.max(0.01, l.x1 - l.x0)) * 100}%`, width: `${(Math.max(0, l.c1 - l.c0) / Math.max(0.01, l.x1 - l.x0)) * 100}%` }} />
            {l.x1 - l.x0 > 28 && <span className="rt-leg-t">{l.no} {l.from}–{l.to}</span>}
          </span>
        ))}
      </div>
      {lay.legs.some((l) => l.x1 - l.x0 <= 28) && <div className="rt-note">{lay.legs.map((l) => `${l.no} ${l.from}–${l.to}`).join(' · ')}</div>}
      {pilots.length > 0 && <div className="rt-head">Pilots</div>}
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
