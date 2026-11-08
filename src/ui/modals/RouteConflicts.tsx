// v0.19 our scheduled flights on an aircraft an ACMI job wants (docs/UPDATE-0.19.md §H.2): one row per rotation with
// four choices and their real money (swap aircraft · sub-charter · move · cancel), "Same for all", and a one-line
// verdict. The choices travel with the signature (SignOpts.routeChoices); without one the engine takes the cheapest.

import { ArrowRightLeft, CalendarClock, CircleSlash, Handshake, Route as RouteIcon } from 'lucide-react';
import { useMemo } from 'react';
import type { GameState, Minute } from '../../engine/core/types';
import type { RouteChoice } from '../../engine/network/types';
import { money, moneyDelta } from '../format';
import { net } from '../screens/network/netApi';

export const CHOICE_WORD: Record<RouteChoice, string> = { swap: 'Swap aircraft', sub: 'Sub-charter', move: 'Move', cancel: 'Cancel' };
const CHOICE_ICON: Record<RouteChoice, typeof ArrowRightLeft> = { swap: ArrowRightLeft, sub: Handshake, move: CalendarClock, cancel: CircleSlash };
const ORDER: RouteChoice[] = ['swap', 'sub', 'move', 'cancel'];

export interface ConflictRow {
  rotId: string;
  label: string;
  quotes: { choice: RouteChoice; ok: boolean; net: number; why: string }[];
  best: RouteChoice | null;
}

/** The rotations in the way and their quotes, best (cheapest that works: sub-charter, swap, move, cancel) first. */
export function conflictRows(g: GameState, aircraftId: string, from: Minute, to: Minute): ConflictRow[] {
  return net.conflicts(g, aircraftId, from, to).map((c) => {
    const quotes = net.choices(g, c.rotId, { aircraftId, from, to });
    const ok = quotes.filter((q) => q.ok);
    const best = ok.length ? ok.reduce((a, b) => (b.net > a.net ? b : a)).choice : null;
    return { rotId: c.rotId, label: c.label, quotes, best };
  });
}

export function RouteConflicts({ g, aircraftId, from, to, value, onChange, earns }: {
  g: GameState; aircraftId: string; from: Minute; to: Minute;
  value: Record<string, RouteChoice>; onChange: (v: Record<string, RouteChoice>) => void;
  /** What the ACMI job earns (for the verdict line). */
  earns?: number;
}) {
  const rows = useMemo(() => conflictRows(g, aircraftId, from, to), [g.network?.rev, aircraftId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  const chosen = (r: ConflictRow) => value[r.rotId] ?? r.best;
  const netOf = (r: ConflictRow) => r.quotes.find((q) => q.choice === chosen(r))?.net ?? 0;
  const total = rows.reduce((a, r) => a + netOf(r), 0);
  const all = (c: RouteChoice) => {
    const next = { ...value };
    for (const r of rows) if (r.quotes.find((q) => q.choice === c)?.ok) next[r.rotId] = c;
    onChange(next);
  };
  const stuck = rows.filter((r) => !r.quotes.some((q) => q.ok));
  return (
    <div className="nw-conf">
      <div className="row between gap-8">
        <span className="upper dim row gap-6"><RouteIcon className="sc-ico-s" /> Your scheduled flights on this aircraft</span>
        <span className="row gap-4 nw-conf-all">
          <span className="tiny muted">Same for all:</span>
          {ORDER.map((c) => <button key={c} className="btn btn-sm btn-ghost" onClick={() => all(c)}>{CHOICE_WORD[c]}</button>)}
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.rotId} className="nw-conf-row">
          <b className="small ellipsis">{r.label}</b>
          <div className="nw-conf-opts" role="radiogroup" aria-label={r.label}>
            {ORDER.map((c) => {
              const q = r.quotes.find((x) => x.choice === c);
              if (!q) return null;
              const Icon = CHOICE_ICON[c];
              const on = chosen(r) === c;
              return (
                <button key={c} role="radio" aria-checked={on} disabled={!q.ok} className={`nw-conf-opt ${on ? 'on' : ''}`} onClick={() => onChange({ ...value, [r.rotId]: c })} title={q.why}>
                  <span className="row gap-4"><Icon className="sc-ico-s" /><span className="small">{CHOICE_WORD[c]}</span></span>
                  <span className={`tiny num ${q.ok ? (q.net >= 0 ? 'good' : 'muted') : 'dim'}`}>{q.ok ? (q.net ? moneyDelta(q.net) : 'no cost') : 'not possible'}</span>
                </button>
              );
            })}
          </div>
          {(() => {
            const q = r.quotes.find((x) => x.choice === chosen(r));
            return q?.why ? <span className="tiny muted">{q.why}</span> : null;
          })()}
        </div>
      ))}
      {stuck.length > 0 && <div className="small bad">{stuck.length === 1 ? 'One rotation' : `${stuck.length} rotations`} can't be handled: take another aircraft.</div>}
      <div className="small nw-conf-verdict">
        {earns !== undefined ? <>The job earns {money(earns)}; your {rows.length === 1 ? 'rotation' : `${rows.length} rotations`}: {total ? moneyDelta(total) : 'no cost'}. <b className={earns + total >= 0 ? 'good' : 'bad'}>Net {moneyDelta(earns + total)}</b></> : <>Your {rows.length === 1 ? 'rotation' : `${rows.length} rotations`}: <b>{total ? moneyDelta(total) : 'no cost'}</b></>}
      </div>
    </div>
  );
}

/** The call's short version: what the default (cheapest) choices do; the offer dialog (Details) has the chooser. */
export function RouteConflictsLine({ g, aircraftId, from, to }: { g: GameState; aircraftId: string; from: Minute; to: Minute }) {
  const rows = useMemo(() => conflictRows(g, aircraftId, from, to), [g.network?.rev, aircraftId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  const by = new Map<RouteChoice, number>();
  let total = 0;
  for (const r of rows) {
    if (!r.best) continue;
    by.set(r.best, (by.get(r.best) ?? 0) + 1);
    total += r.quotes.find((q) => q.choice === r.best)?.net ?? 0;
  }
  const what = [...by].map(([c, n]) => `${n} ${CHOICE_WORD[c].toLowerCase()}`).join(', ');
  const stuck = rows.some((r) => !r.best);
  return (
    <div className={`small nw-conf-line ${stuck ? 'bad' : 'warn'}`}>
      <RouteIcon className="sc-ico-s" />
      <span>{rows.length === 1 ? '1 of your scheduled rotations' : `${rows.length} of your scheduled rotations`} on this aircraft: {stuck ? "one can't be handled" : `${what} (${total ? moneyDelta(total) : 'no cost'})`}. Details to choose.</span>
    </div>
  );
}
