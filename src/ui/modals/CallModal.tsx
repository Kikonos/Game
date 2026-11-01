// v0.10.2 an urgent, high-paying offer phones in (store.drainCues → queuePop; the clock is paused). The card shows
// who is calling, what they say and the key terms, and rings (Alerts) while it is open. Accept runs the offer dialog's
// own path (contracts/call.ts answerCall); when something is in the way the card says what and offers the details.
// Closed unanswered, the offer stays in the Inbox until it lapses; its Inbox line opens the call again.
//
// v0.14 (player: "when I get this call I want to select the aircraft and have a mini timeline, like the main contract
// window; elegant and sleek, not big and cluttered") a row of aircraft chips (each with a one-word fit: callFit) and ONE
// strip of the picked aircraft's schedule around the job (the offer dialog's SchedulePortal over callSpan, the job's
// flights as ghosts, the trips in the way outlined red; tap one, or the 'in the way' line, to move or sub-lease it and
// come back to the call). Accept signs on the picked aircraft. The caller waits 30–90 min of game time (the countdown in
// the head); every dialog holds the clock, so the wait only runs once the player is back on the map with time going.

import { Clock, Eye, Menu, PhoneCall, PhoneIncoming, PhoneOff, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { answerCall, callFit, callPlan, callReports, callScript, declineCall, fmtPrice } from '../../engine/contracts';
import { typeOf } from '../../engine/core/perf';
import { fmtDayAt, fmtTime } from '../../engine/core/time';
import { Modal } from '../components/ui';
import { money } from '../format';
import { sound } from '../sound';
import { store, useGame } from '../store';
import { SchedulePortal } from './OfferPortal';
import { callSpan, clashTrips } from './offerPortalLogic';

/** '45 min' / '1 h 05 min'. */
const waitLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m) % 60).padStart(2, '0')} min` : `${Math.max(0, Math.round(m))} min`);

export function CallModal({ offerId, aircraftId }: { offerId: string; aircraftId?: string }) {
  const g = useGame();
  const o = g.offers[offerId];
  const open = !!o && o.status === 'open' && o.expires > g.now;
  const script = useMemo(() => callScript(g, offerId), [g, offerId]);
  const reports = useMemo(() => (open ? callReports(g, offerId) : []), [g, offerId, open, g.now, store.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<string | null>(aircraftId ?? null);
  const [clashOpen, setClashOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // It rings while the card is open (until answered, put away or about 20 s); not again when coming back to it.
  useEffect(() => {
    if (aircraftId) return;
    sound.event('offerCall');
    return () => sound.stopRing();
  }, [offerId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o || !script) return null;
  const first = callPlan(g, offerId, undefined, reports);
  const selId = pick && reports.some((r) => r.aircraftId === pick) ? pick : first.ok ? first.aircraftId : reports[0]?.aircraftId;
  const sel = reports.find((r) => r.aircraftId === selId);
  const plan = open && selId ? callPlan(g, offerId, selId, reports) : null;
  const ac = selId ? g.fleet[selId] : undefined;
  const back = { kind: 'offerCall' as const, offerId, aircraftId: selId };
  const close = () => store.closeModal();
  const details = () => {
    // The cards still waiting come after the offer dialog.
    store.closeModal({ hold: true });
    store.openModal({ kind: 'offer', offerId });
  };
  const accept = () => {
    const r = store.act((gg) => answerCall(gg, offerId, selId));
    if (r.ok) return close();
    setErr(r.error);
  };
  const decline = () => {
    if (store.act((gg) => declineCall(gg, offerId), { toastOk: false }).ok) close();
  };
  const choose = (id: string) => {
    setPick(id);
    setErr(null);
    setClashOpen(false);
  };
  const blocked = err ?? (plan && !plan.ok ? plan.error : null);
  const dep = script.firstDep;
  const left = o.expires - g.now;
  const trips = sel ? clashTrips(g, sel) : [];
  const portal = open && sel && ac && o.product.kind !== 'dry';
  return (
    <Modal className="v10-call v14-call" title="Incoming call" icon={<PhoneIncoming className="accent" />} onClose={close} footer={
      open ? (
        <>
          <button className="btn" onClick={decline}><PhoneOff /> Decline</button>
          <button className="btn" onClick={details}><Eye /> Details</button>
          <button className="btn btn-primary" onClick={accept} disabled={!!blocked || !selId}><PhoneCall /> Accept{ac ? ` · ${ac.reg}` : ''}</button>
        </>
      ) : (
        <button className="btn btn-primary" onClick={close}>OK</button>
      )
    }>
      <div className="v10-call-head">
        <div className={`v10-ring ${open ? 'on' : ''}`} aria-hidden><span /><span /><PhoneIncoming /></div>
        <div className="col grow v14-who">
          <b className="v10-caller ellipsis">{script.caller}</b>
          <span className="small muted ellipsis">{script.person ? `${script.person} · ` : ''}{script.role}</span>
        </div>
        <span className={`v14-wait ${!open ? 'gone' : left <= 30 ? 'bad' : 'warn'}`} title="The caller waits this long (game time) for your answer">
          <Clock />{open ? <><b className="num">{waitLabel(left)}</b><span>to answer</span></> : <b>Too late</b>}
        </span>
      </div>
      <p className="v10-line" title={script.line}>“{script.line}”</p>
      <div className="v14-facts small">
        <span className="ellipsis">{script.route} <i>·</i> {script.seats} seats</span>
        <span className="ellipsis"><i className="v14-join">·</i><b>{fmtDayAt(script.firstFrom, dep)} {fmtTime(dep, script.firstFrom)}</b> local <span className="dim v14-more">({fmtTime(dep)} UTC)</span> <i>·</i> <b>{fmtPrice(o.product)}</b>{o.product.kind === 'wet' ? <span className="dim v14-more"> · about {money(o.estValue)}</span> : null}</span>
      </div>
      {open && reports.length > 0 && (
        <div className="v14-pick" role="radiogroup" aria-label="Aircraft">
          {reports.map((r) => {
            const a = g.fleet[r.aircraftId];
            if (!a) return null;
            const fit = callFit(r);
            const on = r.aircraftId === selId;
            return (
              <button key={r.aircraftId} className={`v14-ac ${on ? 'on' : ''} ${fit.tone}`} role="radio" aria-checked={on} onClick={() => choose(r.aircraftId)}>
                <b className="mono">{a.reg}</b>
                <span className="tiny"><span className="dim">{typeOf(a.typeId).short}</span> · <span className={`v14-fit ${fit.tone}`}>{fit.word}</span></span>
              </button>
            );
          })}
        </div>
      )}
      {portal && (
        <div className="v14-strip">
          <SchedulePortal key={selId} g={g} o={o} aircraftId={selId!} candidates={reports.map((r) => r.aircraftId)} report={sel} open={clashOpen} span={callSpan(o, g.now)} back={back} />
          {trips.length > 0 && !clashOpen && (
            <button className="v14-clash small" onClick={() => setClashOpen(true)}>
              <TriangleAlert /><span className="grow">{trips.length} trip{trips.length > 1 ? 's' : ''} in the way on {ac!.reg}</span><Menu />
            </button>
          )}
        </div>
      )}
      {/* The red 'in the way' line already says why a busy aircraft can't; the note is for anything else. */}
      {open && blocked && (err || !trips.length) && <div className="v10-call-block small warn">{ac ? `${ac.reg} can't take it` : "Can't take it"}: {blocked.replace(/^Busy: /, 'busy with ')}. Pick another aircraft, or see the details.</div>}
      {!open && <div className="small muted mt-8">This offer is no longer open.</div>}
    </Modal>
  );
}
