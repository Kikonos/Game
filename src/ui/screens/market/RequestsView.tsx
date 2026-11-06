// v0.17 Fleet › Market › Requests (UPDATE-0.17.md §N.1; lane `market-ui`): our requests to lessors and airlines, each a
// card with its answers as chips (AerCap ✓ proposal · Avolon: no aircraft · Carlyle: rating). Withdraw while open.

import { CalendarClock, FileSignature, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import { artFor } from '../../../data/acmiTypes';
import { MARKET_LIVERY } from '../../../data/livery';
import type { GameState, Ref } from '../../../engine/core/types';
import { withdrawRfp } from '../../../engine/leasing';
import { lockOf } from '../../../engine/scenario';
import { AircraftArt } from '../../components/AircraftArt';
import { store } from '../../store';
import { answerChip, rfpsShown, rfpStatus, rfpTitle } from './marketLogic';

export function RequestsView({ g, sel, onOffers }: { g: GameState; sel?: Ref | null; onOffers?: () => void }) {
  const list = rfpsShown(g.now, g.leasing?.rfps ?? []);
  const selId = sel?.kind === 'rfp' ? sel.id : null;
  useEffect(() => {
    if (selId) document.querySelector(`.mk17-rfp[data-rfp="${selId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selId]);
  const lock = lockOf(g, 'fleet');
  if (!list.length) {
    return (
      <div className="card sc-pad muted small row gap-12 mk17-empty">
        <span className="grow">No requests yet. Ask lessors for the aircraft you want: type, age, lease and start. They answer in one to three weeks with a proposal or a plain no. Short-term aircraft come from airlines in their quiet season.</span>
        {!lock && <span className="row gap-8"><button className="btn btn-sm" onClick={() => store.openModal({ kind: 'spot' })}><CalendarClock /> Short-term…</button><button className="btn btn-sm btn-primary" onClick={() => store.openModal({ kind: 'rfp' })}><FileSignature /> Ask lessors…</button></span>}
      </div>
    );
  }
  return (
    <div className="mk-grid">
      {list.map((r) => {
        const props = r.answers.reduce((s, a) => s + (a.offerIds?.filter((id) => g.market.aircraft.some((o) => o.id === id && o.expires > g.now)).length ?? 0), 0);
        return (
          <div key={r.id} className={`card mk17-rfp ${selId === r.id ? 'selected' : ''} ${r.status}`} data-rfp={r.id}>
            <div className="mk-top">
              <div className="mk-art"><AircraftArt typeId={artFor(r.typeId)} livery={MARKET_LIVERY} detail="simple" /></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row gap-8 between">
                  <b className="ellipsis">{rfpTitle(g.now, r)}</b>
                  <span className={`badge ${r.status === 'open' ? 'info' : ''}`}>{r.spot ? 'Airlines' : 'Lessors'}</span>
                </div>
                <div className="small muted">{rfpStatus(g.now, r)}</div>
              </div>
            </div>
            <div className="mk-chips">
              {r.answers.map((a, i) => {
                const c = answerChip(g.now, a, r.typeId);
                return <span key={`${a.lessorId}${i}`} className={`chip mk-chip ${c.tone}`} data-tip={c.tip}>{c.text}</span>;
              })}
            </div>
            {(props > 0 || r.status === 'open') && (
              <div className="row gap-8 mk17-foot">
                <span className="grow" />
                {props > 0 && onOffers && <button className="btn btn-sm" onClick={onOffers}>See {props} proposal{props === 1 ? '' : 's'}</button>}
                {r.status === 'open' && !lock && <button className="btn btn-sm" onClick={() => store.act((gg) => withdrawRfp(gg, r.id))}><Undo2 /> Withdraw</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
