// v0.9.1 pop-ups that come to the player wherever they are (store.drainCues → queuePop): a client's answer to our
// counter-offer with the buttons that still apply, and an aircraft handed over (a celebration card, then "Follow the
// delivery flight?"). Queued like ladder steps, never over another dialog.

import { Check, Eye, MapPinned, PartyPopper, Plane, X } from 'lucide-react';
import { useEffect } from 'react';
import { ACMI_TYPES, artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { acceptOffer, counterLift, declineOffer, fmtPrice, setPrice } from '../../engine/contracts';
import { fmtDay, fmtTime } from '../../engine/core/time';
import type { ContractOffer, Flight, GameState, Product } from '../../engine/core/types';
import { liveryOf } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { SkyArt } from '../components/SkyArt';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';

/** A client's answer to our counter: Accept at the price on the table and Decline while the offer is open. */
/** v0.12.1 the price as signed: the client-paid extra crew we countered with lifts it. */
function liftedProduct(o: ContractOffer): Product {
  const p = structuredClone(o.product);
  const lift = counterLift(o);
  if (lift !== 1) setPrice({ product: p }, (p.kind === 'wet' ? p.ratePerBH : p.kind === 'charter' ? p.price : p.rentPerMonth) * lift);
  return p;
}

export function CounterReplyModal({ offerId, contractId, title, body }: { offerId?: string; contractId?: string; title: string; body: string }) {
  const g = useGame();
  const o = offerId ? g.offers[offerId] : undefined;
  const k = contractId ? g.contracts[contractId] : undefined;
  const open = !!o && o.status === 'open' && o.expires > g.now;
  const close = () => store.closeModal();
  const accept = () => {
    if (!o) return;
    const ids = o.counter?.aircraftIds ?? [];
    // v0.12.1 as countered: paint, cabin and extra crew (the price on the table is final).
    const k = o.counter;
    const r = store.act((gg) => acceptOffer(gg, o.id, ids, { paint: k?.paint !== false, cabin: k?.cabin, crewExtra: k?.crewExtra, priced: k?.result === 'halfway' }));
    if (r.ok) close();
  };
  const decline = () => {
    if (!o) return;
    if (store.act((gg) => declineOffer(gg, o.id), { toastOk: false }).ok) close();
  };
  const look = () => {
    close();
    if (open && o) store.openModal({ kind: 'offer', offerId: o.id });
    else if (k) store.navigate('contracts', { sel: { kind: 'contract', id: k.id } });
  };
  const regs = (o?.counter?.aircraftIds ?? []).map((id) => g.fleet[id]?.reg).filter(Boolean).join(', ');
  return (
    <Modal className="v91-pop v91-counter" title="The client answered" icon={<Plane />} onClose={close} footer={
      open ? (
        <>
          <button className="btn" onClick={decline}><X /> Decline</button>
          <button className="btn" onClick={look}><Eye /> Open the offer</button>
          <button className="btn btn-primary" onClick={accept} disabled={!regs}><Check /> Accept {fmtPrice(liftedProduct(o!))}</button>
        </>
      ) : (
        <>
          {k && <button className="btn" onClick={look}><Eye /> View contract</button>}
          <button className="btn btn-primary" onClick={close}>OK</button>
        </>
      )
    }>
      <div className="v91-reply">
        <b>{title}</b>
        <p>{body}</p>
        {open && regs && <p className="small muted">On {regs}, as countered. One counter per offer: accept this price or let it go.</p>}
        {open && o && <p className="small muted">Answer by {fmtDay(o.expires)} {fmtTime(o.expires)} UTC.</p>}
      </div>
    </Modal>
  );
}

/** The ferry legs home of a delivery still to fly (or flying), first first. */
export function deliveryFerry(g: GameState, aircraftId: string): Flight[] {
  return Object.values(g.flights)
    .filter((f) => f.aircraftId === aircraftId && f.purpose === 'delivery' && (f.status === 'scheduled' || f.status === 'enroute'))
    .sort((a, b) => a.std - b.std);
}

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/**
 * An aircraft handed over: the aircraft in our livery, registration, type, where from. v0.12 a full-screen welcome card:
 * the aircraft big against the sky of the handover site's local time, its name and registration, 'Welcome to the fleet'.
 * Skippable (✕, Escape); its chime rings as it opens (store.flushLadder) and time holds while it shows (a modal).
 */
export function DeliveredModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const skip = () => store.closeModal();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      skip();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
  if (!ac) return null;
  const t = ACMI_TYPES[ac.typeId];
  const lv = liveryOf(g, ac);
  const dl = ac.delivery;
  const from = dl?.where ?? (dl ? city(dl.site) : city(g.company.homeBase));
  const ferry = deliveryFerry(g, ac.id);
  const next = () => {
    store.closeModal();
    if (ferry.length) store.openModal({ kind: 'followDelivery', aircraftId: ac.id });
  };
  const how = ac.ownership.kind === 'dryLeaseIn' ? `Leased from ${ac.ownership.lessor}` : 'Ours';
  return (
    <div className="v12-welcome" role="dialog" aria-modal="true" aria-label="A new aircraft joins the fleet">
      <button className="btn btn-ghost btn-icon v12-welcome-skip" onClick={skip} aria-label="Skip"><X /></button>
      <div className="v12-welcome-card">
        <div className="v12-welcome-kicker"><PartyPopper className="gold" aria-hidden /> Welcome to the fleet</div>
        <h1 className="v12-welcome-name">{ac.name ?? ac.reg}</h1>
        <SkyArt g={g} ac={ac} className="v12-welcome-sky">
          <AircraftArt typeId={artFor(ac.typeId, ac.variant)} livery={lv.livery} code={lv.code} name={lv.name} reg={ac.reg} acName={ac.name} />
        </SkyArt>
        <div className="v12-welcome-id">
          <b className="mono v91-dl-reg">{ac.reg}</b>
          <span className="v91-dl-type">{t?.name ?? ac.typeId} · {ac.cabin.label}</span>
        </div>
        <div className="small muted v91-dl-from">Handed over at {from}{dl ? ` on ${fmtDay(dl.handover)}` : ''} · {how}</div>
        {ferry.length > 0 && (
          <div className="small v91-dl-ferry">Ferry home: {city(ferry[0].from)} → {city(ferry[ferry.length - 1].to)}, leaving {fmtDay(ferry[0].std)} {fmtTime(ferry[0].std, ferry[0].from)} local{ferry.length > 1 ? ` (${ferry.length} legs)` : ''}.</div>
        )}
        <div className="v12-welcome-foot">
          <button className="btn btn-primary" onClick={next} autoFocus>{ferry.length ? 'Continue' : 'Wonderful'}</button>
        </div>
      </div>
    </div>
  );
}

/** 'Follow the delivery flight?': Yes opens the map on the aircraft (its ferry is its next flight). */
export function FollowDeliveryModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const ferry = deliveryFerry(g, aircraftId);
  const close = () => store.closeModal();
  const follow = () => {
    // The map first: the cards still waiting come once time runs again.
    store.closeModal({ hold: true });
    store.navigate('map', { sel: { kind: 'aircraft', id: aircraftId } });
  };
  if (!ac) return null;
  return (
    <Modal className="v91-pop v91-follow" title="Follow the delivery flight?" icon={<MapPinned />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>No, thanks</button>
        <button className="btn btn-primary" onClick={follow}><MapPinned /> Yes, show me</button>
      </>
    }>
      <p>{ac.reg} {ferry.length ? `flies home from ${city(ferry[0].from)} on ${fmtDay(ferry[0].std)}` : 'is on its way home'}. The map follows it from the handover to {city(g.company.homeBase)}.</p>
    </Modal>
  );
}
