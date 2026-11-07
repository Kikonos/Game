// v0.18 the offer dialog's verdict (replaces the four-line What / Why / Does it hurt / What you can do card there):
// one headline with the most important reason (contracts/blockers.ts: not possible, needs work first, flights in the
// way, check before signing), the fix that goes with it, and the other reasons folded beneath.

import { AlertTriangle, CalendarClock, ChevronRight, CircleSlash, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { sortChecks, type OfferVerdict } from '../../../engine/contracts/blockers';
import { typeOf } from '../../../engine/core/perf';
import type { GameState } from '../../../engine/core/types';
import { store } from '../../store';

const RANK_WORD: Record<number, string> = { 0: 'Not possible', 1: 'Needs work', 2: 'In the way', 3: 'Check' };

/** The one button that fixes the headline reason, when there is one. */
function fixButton(g: GameState, v: OfferVerdict, offerId: string): ReactNode {
  const head = sortChecks(v.report.checks.filter((c) => c.level !== 'ok'), v.report)[0];
  const ac = g.fleet[v.report.aircraftId];
  if (!head || !ac) return null;
  if (head.action?.kind === 'refit') return <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'refit', aircraftId: ac.id, layout: head.action!.kind === 'refit' ? head.action!.layout : undefined, offerId })}><Wrench /> Plan refit…</button>;
  if (head.action?.kind === 'restRefit') return <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'refit', aircraftId: ac.id, offerId, section: 'rest', restOption: head.action?.kind === 'restRefit' ? head.action.option : undefined })}><Wrench /> Plan a crew rest refit…</button>;
  if (head.id === 'maintenance') return <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'check', aircraftId: ac.id, checkKind: /C-check/.test(head.label) ? 'C' : 'A' })}><CalendarClock /> {/C-check/.test(head.label) ? 'Plan C-check…' : 'Book A-check…'}</button>;
  if (head.id === 'crew' && /^Short of crew/.test(head.label)) return <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'hire', family: typeOf(ac.typeId).family })}>Hire…</button>;
  if ((head.id === 'approvals' || head.id === 'etops') && v.rank === 0) return <button className="btn btn-sm btn-ghost" onClick={() => { store.closeModal(); store.navigate('company', { view: 'ladder' }); }}>Approvals <ChevronRight /></button>;
  return null;
}

/**
 * `busyFix`: the move / sub-lease tools for the trips in the way (shown when the headline is flights in the way).
 * Nothing when the job can be flown as it stands.
 */
export function OfferVerdictBox({ g, v, offerId, busyFix }: { g: GameState; v: OfferVerdict | null; offerId: string; busyFix?: ReactNode }) {
  if (!v || v.rank === 4) return null;
  const reg = g.fleet[v.report.aircraftId]?.reg ?? '';
  const Icon = v.rank === 0 ? CircleSlash : v.rank === 2 ? CalendarClock : AlertTriangle;
  const more = v.more;
  const fix = v.rank === 2 ? busyFix : fixButton(g, v, offerId);
  return (
    <div className={`of-verdict t${v.rank}`} role="status">
      <div className="of-verdict-head"><Icon /><b>{v.headline}</b></div>
      {v.rank === 2 && <div className="small muted">Solvable: move {reg}’s red trips to another aircraft (tap one in its schedule below the aircraft name), or hand them to another operator.</div>}
      {fix && <div className="of-verdict-acts">{fix}</div>}
      {more.length > 0 && (
        <details>
          <summary><ChevronRight />{more.length === 1 ? '1 more reason' : `${more.length} more reasons`}</summary>
          <ul className="of-verdict-more">
            {more.map(({ check, rank }, i) => (
              <li key={`${check.id}-${i}`}><span className={`tier r${rank}`}>{RANK_WORD[rank] ?? ''}</span><span>{check.label}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
