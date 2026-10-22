// v0.7.2 sell an owned aircraft (UPDATE-0.7.2.md §6.1, §6.4): the buyer's price line by line (market value, hours and
// cycles, C-check life, broker), book value and the gain or loss, when it is handed over, and what still flies on
// it (the four-line card: signed work must be moved or sub-chartered first). An agreed sale can be called off free.

import { BadgeDollarSign, Undo2 } from 'lucide-react';
import { fmtDay } from '../../engine/core/time';
import { cancelSale, saleQuote, sellAircraft } from '../../engine/ops';
import { saleCard } from '../../engine/problems';
import { ProblemCardView } from '../components/ProblemCard';
import { Term } from '../components/Term';
import { Modal } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

export function SellModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const close = () => store.closeModal();
  if (!ac) {
    return <Modal title="Sell aircraft" onClose={close}><p className="muted">This aircraft has left the fleet.</p></Modal>;
  }
  const s = ac.sale;
  if (s) {
    const callOff = () => store.openModal({
      kind: 'confirm', title: `Call off the sale of ${ac.reg}?`, confirm: 'Call off the sale', danger: true,
      body: `${s.buyer} walks away at no cost; ${ac.reg} stays in the fleet and can take work again.`,
      onConfirm: () => store.act((gg) => cancelSale(gg, aircraftId)),
    });
    return (
      <Modal title={`Sale of ${ac.reg}`} icon={<BadgeDollarSign className="accent" />} onClose={close} footer={
        <>
          <button className="btn" onClick={close}>Close</button>
          {s.closes > g.now && <button className="btn btn-danger" onClick={callOff}><Undo2 /> Call off the sale</button>}
        </>
      }>
        <div className="col gap-12">
          <div className="sl-price"><span className="muted small">Sold to {s.buyer}</span><b className="num">{money(s.price)}</b></div>
          <div className="small muted">Agreed {fmtDay(s.agreed)} · handed over at {g.company.homeBase} on {fmtDay(s.closes)}{s.ferryIds?.length ? ' · a ferry brings it home first' : ''}. It takes no new work.</div>
        </div>
      </Modal>
    );
  }
  const q = saleQuote(g, aircraftId);
  const card = q.blockers.length ? saleCard(g, aircraftId) : null;
  const sell = () => {
    if (store.act((gg) => sellAircraft(gg, aircraftId, q.price)).ok) close();
  };
  return (
    <Modal title={`Sell ${ac.reg}`} icon={<BadgeDollarSign className="accent" />} onClose={close} footer={
      <>
        <span className="grow small muted">{q.ok ? `Handover ${fmtDay(q.closes)} at ${g.company.homeBase}` : ''}</span>
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={sell} disabled={!q.ok}><BadgeDollarSign /> Sell for {money(q.price)}</button>
      </>
    }>
      <div className="col gap-12">
        {card && <ProblemCardView card={card} g={g} />}
        <div className="sl-price"><span className="muted small">{q.buyer || 'A buyer'} offers</span><b className="num">{money(q.price)}</b></div>
        <div className="ls-lines">
          <div className="upper dim"><Term id="marketValue">Market value</Term></div>
          {q.lines.map((l, i) => <div key={l.label} className="row between small"><span className="muted">{l.label.replace(/^[−-]\s*/, '')}</span><span className="num">{l.amount < 0 ? '−' : i && l.amount > 0 ? '+' : ''}{money(Math.abs(l.amount))}</span></div>)}
          <div className="row between small"><b>Price</b><b className="num">{money(q.price)}</b></div>
          <div className="row between small"><span className="muted">Book value</span><span className="num">{money(q.bookValue)}</span></div>
          <div className={`row between small ${q.gain >= 0 ? 'good' : 'bad'}`}><span>{q.gain >= 0 ? 'Gain over book value' : 'Loss against book value'}</span><span className="num">{q.gain >= 0 ? '+' : '−'}{money(Math.abs(q.gain))}</span></div>
        </div>
        <div className="small dim">The deal closes in {Math.max(1, Math.round((q.closes - g.now) / 1440))} days; cash comes in on handover at {g.company.homeBase}. Until then you can call it off for free.</div>
        {!q.ok && !card && q.why && <div className="small warn">{q.why}</div>}
      </div>
    </Modal>
  );
}
