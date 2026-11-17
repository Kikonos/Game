// v0.24.1 a live route's actions (Suspend · Wind down · Close now · Resume) and their confirm dialog, which shows the
// money and what happens before anything is done. Explanations sit behind the "?".

import { CircleSlash, Hourglass, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { fmtDay } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import type { Route } from '../../../engine/network/types';
import { Help } from '../../components/Help';
import { Modal, Seg } from '../../components/ui';
import { int, money } from '../../format';
import { store, useGame, type ModalSpec } from '../../store';
import { net } from './netApi';
import { marketOf, routeCode } from './networkLogic';

type Action = 'suspend' | 'resume' | 'windDown' | 'close';

const WORD: Record<Action, string> = { suspend: 'Suspend', resume: 'Resume', windDown: 'Wind down', close: 'Close now' };

function Ico({ a }: { a: Action }) {
  switch (a) {
    case 'suspend': return <Pause />;
    case 'resume': return <Play />;
    case 'windDown': return <Hourglass />;
    default: return <CircleSlash />;
  }
}

/** The route's action buttons (route page, map card). `back`: where the dialog returns. */
export function RouteActionButtons({ r, back, small }: { r: Route; back?: ModalSpec; small?: boolean }) {
  const acts = net.actions(r);
  if (!acts.length) return null;
  return (
    <div className="row wrap gap-6 nw-life">
      {acts.map((a) => (
        <button key={a} className={`btn ${small ? 'btn-sm' : 'btn-sm'} ${a === 'close' ? 'btn-danger' : a === 'resume' ? 'btn-primary' : ''}`}
          onClick={() => store.openModal({ kind: 'routeAction', routeId: r.id, action: a, back })}>
          <Ico a={a} /> {a === 'resume' && r.closing ? 'Keep the route' : WORD[a]}
        </button>
      ))}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return <div className="nw-pl-row"><span className="small">{k}</span><span className={`num small ${tone ?? ''}`}>{v}</span></div>;
}

const flights = (n: number) => `${int(n)} rotation${n === 1 ? '' : 's'}`;

export function RouteActionModal({ routeId, action, back }: { routeId: string; action: Action; back?: ModalSpec }) {
  const g = useGame();
  const r = g.network?.routes[routeId];
  const [refund, setRefund] = useState(false);
  const close = () => (back ? store.openModal(back) : store.closeModal());
  if (!r) return <Modal title="Route" onClose={close}><p className="muted">This route no longer exists.</p></Modal>;
  const q = net.quoteLife(g, routeId);
  const code = routeCode(marketOf(r));
  const ok = q.ok && net.actions(r).includes(action);
  const run = (fn: (gg: GameState) => string | null, msg: string) => {
    const res = store.act((gg) => { const w = fn(gg); return w ? { ok: false, error: w } : { ok: true, msg }; });
    if (res.ok) close();
  };
  let title = '';
  let body: React.ReactNode = null;
  let confirm = '';
  let go = () => {};
  let danger = false;
  switch (action) {
    case 'suspend': {
      title = `Suspend ${code}?`;
      confirm = refund ? 'Suspend and refund' : 'Suspend';
      go = () => run((gg) => net.suspend(gg, routeId, refund), 'Route suspended');
      body = (
        <>
          <p className="small">Sales stop now. {q.empty ? `${flights(q.empty)} with no one booked come off at no cost.` : ''}</p>
          {q.booked > 0 && (
            <div className="col gap-6">
              <span className="upper dim row gap-6">Booked: {flights(q.booked)}, {int(q.pax)} passengers</span>
              <Seg<'fly' | 'refund'> value={refund ? 'refund' : 'fly'} onChange={(v) => setRefund(v === 'refund')} options={[
                { value: 'fly', label: `Fly them · about ${money(q.flyCost)}` },
                { value: 'refund', label: `Refund · ${money(q.refundCost)}` },
              ]} />
              <span className="tiny muted">{refund ? `Tickets ${money(q.refunds)} back, passenger costs ${money(q.comp)}.` : `Last flight ${q.lastFlight ? fmtDay(q.lastFlight) : '—'}. No refunds.`}</span>
            </div>
          )}
          <div className="nw-pl">
            <Row k="Station and office" v={`${money(q.monthSuspended)} a month`} />
            <Row k="Slots kept until" v={fmtDay(refund || !q.booked ? q.slotsRefund : q.slotsKeep)} tone="warn" />
          </div>
        </>
      );
      break;
    }
    case 'windDown': {
      title = `Wind down ${code}?`;
      confirm = q.booked || q.underWay ? 'Wind down' : 'Close it';
      go = () => run((gg) => net.windDown(gg, routeId), q.booked || q.underWay ? 'Route closing' : 'Route closed');
      body = q.booked || q.underWay ? (
        <>
          <p className="small">Sales stop now. Every booked flight flies, nobody is refunded. The route closes after the last one.</p>
          <div className="nw-pl">
            <Row k="Flights left to fly" v={flights(q.booked + q.underWay)} />
            <Row k="Passengers carried" v={int(q.pax)} />
            <Row k="Last flight" v={q.lastFlight ? fmtDay(q.lastFlight) : '—'} />
            {q.empty > 0 && <Row k="Empty, taken off" v={`${flights(q.empty)} · no cost`} />}
            <Row k="Flying cost" v={`about ${money(q.flyCost + q.flyOverhead)}`} />
            <div className="nw-pl-row total"><b className="small">Against Close now</b><b className={`num ${q.saved >= 0 ? 'good' : 'bad'}`}>{q.saved >= 0 ? `saves ${money(q.saved)}` : `costs ${money(-q.saved)} more`}</b></div>
          </div>
          <span className="tiny muted">You can keep the route until the last flight.</span>
        </>
      ) : <p className="small">No one is booked, so it closes now at no cost.</p>;
      break;
    }
    case 'close': {
      title = `Close ${code} now?`;
      confirm = 'Close the route';
      danger = true;
      go = () => run((gg) => net.closeRoute(gg, routeId), 'Route closed');
      body = (
        <>
          <p className="small">Every flight not yet flown is cancelled and the slots are given up.</p>
          <div className="nw-pl">
            <Row k="Flights cancelled" v={flights(q.booked + q.empty)} />
            <Row k="Passengers refunded" v={int(q.pax)} />
            <Row k="Tickets paid back" v={money(q.refunds)} />
            <Row k="Passenger costs" v={money(q.comp)} />
            {q.subBack > 0 && <Row k="Sub-charter price back" v={money(q.subBack)} tone="good" />}
            <div className="nw-pl-row total"><b className="small">Total</b><b className="num bad">{money(q.refundCost)}</b></div>
          </div>
          {q.underWay > 0 && <span className="tiny muted">{flights(q.underWay)} already under way fly home first.</span>}
          {q.booked > 0 && q.saved > 0 && <span className="tiny muted">Wind down instead saves about {money(q.saved)}.</span>}
        </>
      );
      break;
    }
    case 'resume': {
      title = r.closing ? `Keep ${code}?` : `Resume ${code}?`;
      confirm = r.closing ? 'Keep the route' : 'Resume';
      go = () => run((gg) => net.resume(gg, routeId), 'Back on sale');
      body = (
        <>
          <p className="small">Back on sale today. Bookings build up again over a few weeks.</p>
          <div className="nw-pl">
            <Row k="First new flight" v={q.resumeFirst ? fmtDay(q.resumeFirst) : 'none: the timetable has ended'} tone={q.resumeFirst ? '' : 'warn'} />
            <Row k="Station, sales and marketing" v={`${money(q.monthLive)} a month`} />
          </div>
        </>
      );
      break;
    }
  }
  return (
    <Modal title={title} onClose={close} className="nw-modal nw-life-modal" footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} data-enter disabled={!ok} onClick={go}>{confirm}</button>
      </>
    }>
      <div className="col gap-10">
        <div className="row gap-6 nw-life-head"><span className="small muted grow">{WORD[action]}</span><LifeHelp action={action} /></div>
        {ok ? body : <p className="small muted">{q.why ?? 'Not possible now.'}</p>}
      </div>
    </Modal>
  );
}

function LifeHelp({ action }: { action: Action }) {
  switch (action) {
    case 'suspend': return (
      <Help title="Suspend">
        <p>Sales stop. Flights with no one booked are taken off at no cost. The booked ones either fly, or are cancelled with refunds and the usual passenger costs (cheaper with 14 days' notice or more).</p>
        <p>The station runs at half cost and there is no marketing. Bookings fade while you are off sale.</p>
        <p>Slots: the airport lets a series miss about a fifth of a season (the 80/20 rule), so you keep them 6 weeks after the last flight. Resume before then, or the route closes by itself.</p>
      </Help>
    );
    case 'windDown': return (
      <Help title="Wind down">
        <p>Stop selling and fly out what is already sold. Nobody is refunded and there is no compensation, so it is usually much cheaper than closing at once.</p>
        <p>Filed flights with no one on them are taken off at no cost. The flying cost counts fuel, airport, handling, catering and maintenance until the last flight. Aircraft and crew are paid either way.</p>
        <p>Until the last flight you can keep the route and sell again.</p>
      </Help>
    );
    case 'close': return (
      <Help title="Close now">
        <p>Every flight not yet flown is cancelled. Passengers get their money back, and with under 14 days' notice they are rebooked or compensated too.</p>
        <p>The slots go back to the airport. Flights already in the air finish their trip.</p>
      </Help>
    );
    default: return (
      <Help title="Resume">
        <p>Sales open again today. The timetable is filed again from 14 days out, so there is time to sell the first flights.</p>
        <p>Travellers come back slowly: bookings start at about half the usual level and are back to normal after about 8 weeks.</p>
      </Help>
    );
  }
}
