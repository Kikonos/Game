// v0.16.3 Finance › Get out of debt: the ways out while cash is below zero (and the commitments they leave), best
// first, each one line of what it gives, what it costs and what follows, with one button. The dialog itself is
// modals/FinanceModals.tsx DistressModal (a generic quote view over engine/finance/distress.ts).

import { ChevronRight, LifeBuoy } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { DAY, fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { debtCommitments, distressOptions, inDebt, type DistressOption } from '../../../engine/finance/distress';
import { Card } from '../../components/ui';
import { store } from '../../store';

function OptionRow({ o }: { o: DistressOption }) {
  const open = () => {
    if (o.id === 'secured') {
      if (store.game?.treasury?.credit) store.navigate('finance', { view: 'bank' });
      else store.openModal({ kind: 'financing', what: 'credit' });
      return;
    }
    if (o.id === 'factor') {
      const t = o.targets?.find((x) => !x.why);
      if (t) store.openModal({ kind: 'financing', what: 'factor', id: t.id });
      return;
    }
    store.openModal({ kind: 'distress', id: o.id });
  };
  return (
    <button className={`dp-opt ${o.why ? 'off' : ''}`} onClick={open} disabled={!!o.why} aria-label={o.title}>
      <span className="col grow" style={{ minWidth: 0, gap: 2 }}>
        <b className="ellipsis">{o.title}</b>
        <span className="small dp-lines">
          <span><span className="dim">Gives </span>{o.gives}</span>
          <span><span className="dim">Costs </span>{o.costs}</span>
          <span><span className="dim">Then </span>{o.consequence}</span>
        </span>
        {o.why && <span className="small warn">{o.why}</span>}
      </span>
      {!o.why && <ChevronRight className="sc-ico-s dim dp-chev" />}
    </button>
  );
}

export function DebtPanel({ g, focus }: { g: GameState; focus: boolean }) {
  const day = Math.floor(g.now / DAY);
  // Options and commitments move with the day and the player's actions, never with the clock's minutes.
  const opts = useMemo(() => distressOptions(g), [g, day, store.editCount, g.company.cash < 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const com = useMemo(() => debtCommitments(g), [g, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus]);
  const debt = inDebt(g);
  if (!debt && !com.length) return null;
  const since = g.finance.negSince ?? null;
  const sub = debt
    ? `cash ${g.company.cash < 0 ? 'below zero' : 'back above zero'}${since !== null ? ` since ${fmtDay(since)}` : ''} · what each way gives, costs and brings, the gentlest first`
    : 'the commitments the way out left';
  return (
    <div ref={ref} id="debt-panel">
      <Card title="Get out of debt" icon={<LifeBuoy />} sub={sub} className="mt-16 fin-debt" bodyClass="dp-body">
        {com.length > 0 && (
          <div className="dp-com">
            <div className="upper dim">Running</div>
            {com.map((c) => <div key={c.id} className={`small dp-com-row ${c.tone}`}>{c.text}</div>)}
          </div>
        )}
        {debt && <div className="dp-list">{opts.map((o) => <OptionRow key={o.id} o={o} />)}</div>}
      </Card>
    </div>
  );
}
