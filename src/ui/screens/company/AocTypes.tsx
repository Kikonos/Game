// v0.17 Company › Ladder › Types on our AOC (UPDATE-0.17.md §H, §N.1; lane `market-ui`): chips for the families held,
// a variation in progress with its bar and the missing pilots, the family riding on Widebody operations, Add a type…

import { ClipboardCheck, Plus } from 'lucide-react';
import { BAL } from '../../../engine/core/balance';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { aocView } from '../../../engine/leasing';
import { lockOf } from '../../../engine/scenario';
import { Bar } from '../../components/ui';
import { store } from '../../store';

export function AocTypes({ g }: { g: GameState }) {
  if (!BAL.v017.on || !g.company.aocFamilies) return null;
  const v = aocView(g);
  const lock = lockOf(g, 'fleet');
  return (
    <div className="card sc-pad aoc-types mt-12">
      <div className="row gap-8">
        <ClipboardCheck className="sc-ico accent" aria-hidden />
        <b className="grow">Types on our AOC</b>
        {!lock && <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'aoc' })}><Plus /> Add a type…</button>}
      </div>
      <div className="aoc-chips">
        {v.families.map((f) => <span key={f} className="chip mk-chip good">{f}</span>)}
        {v.withWidebody && <span className="chip mk-chip warn" data-tip="The first widebody family joins at the grant of Widebody operations">{v.withWidebody}: with Widebody operations</span>}
      </div>
      {v.variations.map((x) => {
        const span = Math.max(1, x.done - x.filed);
        const pct = Math.min(1, Math.max(0, (g.now - x.filed) / span));
        return (
          <div key={x.family} className="aoc-var">
            <div className="row gap-8 small"><b className="grow">{x.family} variation</b><span className="muted">due {fmtDay(x.done)}</span></div>
            <Bar value={pct} tone={x.waiting && g.now >= x.done ? 'warn' : 'auto'} size="thin" title={`${Math.round(pct * 100)} %`} />
            {x.waiting && <span className="small warn">{x.waiting}{g.now >= x.done ? ': the grant waits for them' : ''}</span>}
          </div>
        );
      })}
      <span className="tiny dim">A new type family needs an AOC variation: about 90 days for a narrowbody, 120 for a widebody, and rated pilots before the grant.</span>
    </div>
  );
}
