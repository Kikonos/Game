// v0.10.2 an urgent, high-paying offer phones in (store.drainCues → queuePop; the clock is paused). The card shows
// who is calling, what they say and the key terms, and rings (Alerts) while it is open. Accept runs the offer dialog's
// own path (contracts/call.ts answerCall); when something is in the way the card says what and offers the details.
// Closed unanswered, the offer stays in the Inbox until it lapses; its Inbox line opens the call again.

import { Eye, PhoneCall, PhoneIncoming, PhoneOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { answerCall, callPlan, callScript, declineCall, fmtPrice } from '../../engine/contracts';
import { typeOf } from '../../engine/core/perf';
import { fmtDay, fmtDayAt, fmtDuration, fmtTime } from '../../engine/core/time';
import { Modal } from '../components/ui';
import { money } from '../format';
import { sound } from '../sound';
import { store, useGame } from '../store';

export function CallModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const o = g.offers[offerId];
  const open = !!o && o.status === 'open' && o.expires > g.now;
  const script = useMemo(() => callScript(g, offerId), [g, offerId]);
  const plan = useMemo(() => (open ? callPlan(g, offerId) : null), [g, offerId, open, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const [err, setErr] = useState<string | null>(null);
  // It rings while the card is open (until answered, put away or about 20 s).
  useEffect(() => {
    sound.event('offerCall');
    return () => sound.stopRing();
  }, [offerId]);
  if (!o || !script) return null;
  const close = () => store.closeModal();
  const details = () => {
    // The cards still waiting come after the offer dialog.
    store.closeModal({ hold: true });
    store.openModal({ kind: 'offer', offerId });
  };
  const accept = () => {
    const r = store.act((gg) => answerCall(gg, offerId));
    if (r.ok) return close();
    setErr(r.error);
  };
  const decline = () => {
    if (store.act((gg) => declineCall(gg, offerId), { toastOk: false }).ok) close();
  };
  const ac = plan?.ok ? g.fleet[plan.aircraftId] : undefined;
  const blocked = err ?? (plan && !plan.ok ? plan.error : null);
  const dep = script.firstDep;
  const left = o.expires - g.now;
  return (
    <Modal className="v10-call" title="Incoming call" icon={<PhoneIncoming className="accent" />} onClose={close} footer={
      open ? (
        <>
          <button className="btn" onClick={decline}><PhoneOff /> Decline</button>
          <button className="btn" onClick={details}><Eye /> See details</button>
          <button className="btn btn-primary" onClick={accept} disabled={!!blocked}><PhoneCall /> Accept</button>
        </>
      ) : (
        <button className="btn btn-primary" onClick={close}>OK</button>
      )
    }>
      <div className="v10-call-head">
        <div className={`v10-ring ${open ? 'on' : ''}`} aria-hidden><span /><span /><PhoneIncoming /></div>
        <div className="col">
          <b className="v10-caller">{script.caller}</b>
          <span className="small muted">{script.person ? `${script.person} · ` : ''}{script.role}</span>
        </div>
      </div>
      <p className="v10-line">“{script.line}”</p>
      <div className="kv v10-terms">
        <span>Route</span><b>{script.route}</b>
        <span>First departure</span><b>{fmtDay(dep)} {fmtTime(dep)} UTC · {fmtDayAt(script.firstFrom, dep)} {fmtTime(dep, script.firstFrom)} local</b>
        <span>Seats</span><b>{script.seats}{ac ? ` · ${ac.reg} (${typeOf(ac.typeId).short})` : ''}</b>
        <span>Price</span><b>{fmtPrice(o.product)}{o.product.kind === 'wet' ? ` · about ${money(o.estValue)}` : ''}</b>
        <span>Answer within</span><b className={left < 120 ? 'warn' : ''}>{open ? fmtDuration(left) : 'too late'}</b>
      </div>
      {open && blocked && <div className="v10-call-block small warn">Can't take it as it stands: {blocked}. See details for the options.</div>}
      {!open && <div className="small muted mt-8">This offer is no longer open.</div>}
    </Modal>
  );
}
