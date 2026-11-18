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
  const [all, setAll] = useState(false);
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
      const w = q.best;
      // v0.25 ticket money paid back is kept apart from what it costs us (flying them, passenger costs, notice).
      const flyCostToUs = Math.max(0, w.flyCost - w.flyRev + w.laterCost - w.laterRefund);
      const refundCostToUs = Math.max(0, q.comp - q.subBack);
      title = `Suspend ${code}?`;
      confirm = refund ? 'Suspend and refund' : 'Suspend';
      go = () => run((gg) => net.suspend(gg, routeId, refund), 'Route suspended');
      body = (
        <>
          <p className="small">Sales stop now.{q.empty ? ` ${flights(q.empty)} with no one booked ${q.empty === 1 ? 'comes' : 'come'} off at no cost.` : ''}</p>
          {q.booked > 0 && (
            <div className="col gap-6">
              <span className="upper dim">Booked: {flights(q.booked)}, {int(q.pax)} passengers</span>
              <Seg<'fly' | 'refund'> value={refund ? 'refund' : 'fly'} onChange={(v) => setRefund(v === 'refund')} options={[
                { value: 'fly', label: `${w.later ? `Fly next ${int(w.fly)}, refund rest` : 'Fly them'} · ${money(flyCostToUs)}` },
                { value: 'refund', label: `Refund all · ${money(refundCostToUs)}` },
              ]} />
              <span className="tiny muted">{refund
                ? `All ${flights(q.booked)} cancelled and refunded.`
                : w.later ? `The next ${flights(w.fly)} fly, the last on ${w.lastFlight ? fmtDay(w.lastFlight) : '—'}; the ${flights(w.later)} after ${w.later === 1 ? 'it is' : 'them are'} refunded.` : `All ${flights(w.fly)} fly, the last on ${w.lastFlight ? fmtDay(w.lastFlight) : '—'}. No refunds.`}</span>
            </div>
          )}
          <div className="nw-pl">
            {q.booked > 0 && <Row k="Ticket money back" v={money(refund ? q.refunds : w.laterRefund)} />}
            {q.booked > 0 && <Row k="Cost to us" v={money(refund ? refundCostToUs : flyCostToUs)} tone="bad" />}
            <Row k="Station and office" v={`${money(q.monthSuspended)} a month`} />
            <Row k="Slots kept until" v={fmtDay(refund || !q.booked ? q.slotsRefund : q.slotsKeep)} tone="warn" />
          </div>
        </>
      );
      break;
    }
    case 'windDown': {
      const w = all ? q.all : q.best;
      const flies = w.fly + q.underWay > 0;
      title = `Wind down ${code}?`;
      confirm = flies ? 'Wind down' : 'Close it';
      go = () => run((gg) => net.windDown(gg, routeId, all), flies ? 'Route closing' : 'Route closed');
      body = (
        <>
          <p className="small">Sales stop now. {w.later ? `The next ${flights(w.fly)} fly; later ones are refunded.` : 'The booked flights fly, with no refunds.'} Then the route closes by itself.</p>
          {q.all.fly > q.best.fly && (
            <Seg<'best' | 'all'> value={all ? 'all' : 'best'} onChange={(v) => setAll(v === 'all')} options={[
              { value: 'best', label: `Cheapest · ${q.best.lastFlight ? fmtDay(q.best.lastFlight) : 'now'}` },
              { value: 'all', label: `All booked · ${q.all.lastFlight ? fmtDay(q.all.lastFlight) : 'now'}` },
            ]} />
          )}
          <div className="nw-pl">
            <Row k="Flights left to fly" v={flights(w.fly + q.underWay)} />
            <Row k="Passengers carried" v={int(w.flyPax)} />
            <Row k="Last flight" v={w.lastFlight ? fmtDay(w.lastFlight) : 'none: closes now'} />
            {w.later > 0 && <Row k="Further ahead, refunded" v={flights(w.later)} />}
            {q.empty > 0 && <Row k="Empty, taken off" v={`${flights(q.empty)} · no cost`} />}
            {w.later > 0 && <Row k="Ticket money back" v={money(w.laterRefund)} />}
            <Row k="Cost to us" v={`about ${money(Math.max(0, w.flyCost - w.flyRev + w.flyOverhead + w.laterCost - w.laterRefund))}`} tone="bad" />
            <div className="nw-pl-row total"><b className="small">Against Close now</b><b className={`num ${w.saved >= 0 ? 'good' : 'bad'}`}>{w.saved >= 0 ? `saves ${money(w.saved)}` : `costs ${money(-w.saved)} more`}</b></div>
          </div>
          {flies && <span className="tiny muted">You can keep the route until the last flight.</span>}
        </>
      );
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
          {q.booked > 0 && q.best.saved > 0 && <span className="tiny muted">Wind down instead saves about {money(q.best.saved)}.</span>}
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
    <Modal title={<span className="row gap-8 nw-life-title">{title}<LifeHelp action={action} /></span>} onClose={close} className="nw-modal nw-life-modal" footer={
      <>
        <button className="btn" onClick={close}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} data-enter disabled={!ok} onClick={go}>{confirm}</button>
      </>
    }>
      <div className="col gap-10">
        {ok ? body : <p className="small muted">{q.why ?? 'Not possible now.'}</p>}
      </div>
    </Modal>
  );
}

function LifeHelp({ action }: { action: Action }) {
  switch (action) {
    case 'suspend': return (
      <Help title="Suspend">
        <p>Sales stop. Flights with no one booked are taken off at no cost. The booked ones either fly, or are cancelled with refunds and the usual passenger costs (cheaper with 14 days' notice or more). Flying them works like a wind down: the ones far ahead that cost more to fly than to refund are refunded.</p>
        <p>The station runs at half cost and there is no marketing. Bookings fade while you are off sale.</p>
        <p>Slots: the airport lets a series miss about a fifth of a season (the 80/20 rule), so you keep them 6 weeks after the last flight. Resume before then, or the route closes by itself.</p>
      </Help>
    );
    case 'windDown': return (
      <Help title="Wind down">
        <p>Stop selling and fly out what is already sold. The booked flights coming up fly with no refunds and no compensation, which is usually much cheaper than closing at once.</p>
        <p>Cheapest: the next 14 days always fly. Flights further ahead often have only a few people booked: where flying one costs more than refunding it, it is cancelled with weeks of notice (tickets back, no compensation). The last flight is the date that costs least.</p>
        <p>All booked: every flight with someone on it flies, however far ahead.</p>
        <p>Filed flights with no one on them are taken off at no cost. The flying cost counts fuel, airport, handling, catering, maintenance and the station until the last flight. Aircraft and crew are paid either way.</p>
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
