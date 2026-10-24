// v0.9.1 pop-ups that come to the player wherever they are (store.drainCues → queuePop): a client's answer to our
// counter-offer with the buttons that still apply, and an aircraft handed over (a celebration card, then "Follow the
// delivery flight?"). Queued like ladder steps, never over another dialog.

import { Check, Eye, MapPinned, PartyPopper, Plane, X } from 'lucide-react';
import { ACMI_TYPES, artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { acceptOffer, declineOffer, fmtPrice } from '../../engine/contracts';
import { fmtDay, fmtTime } from '../../engine/core/time';
import type { Flight, GameState } from '../../engine/core/types';
import { liveryOf } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';

/** A client's answer to our counter: Accept at the price on the table and Decline while the offer is open. */
export function CounterReplyModal({ offerId, contractId, title, body }: { offerId?: string; contractId?: string; title: string; body: string }) {
  const g = useGame();
  const o = offerId ? g.offers[offerId] : undefined;
  const k = contractId ? g.contracts[contractId] : undefined;
  const open = !!o && o.status === 'open' && o.expires > g.now;
  const close = () => store.closeModal();
  const accept = () => {
    if (!o) return;
    const ids = o.counter?.aircraftIds ?? [];
    const r = store.act((gg) => acceptOffer(gg, o.id, ids, { paint: o.counter?.paint !== false }));
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
          <button className="btn btn-primary" onClick={accept} disabled={!regs}><Check /> Accept {fmtPrice(o!.product)}</button>
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

/** An aircraft handed over: the aircraft in our livery, registration, type, where from. */
export function DeliveredModal({ aircraftId }: { aircraftId: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
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
    <Modal size="wide" className="v91-pop v91-delivered" title="A new aircraft joins the fleet" icon={<PartyPopper className="gold" />} onClose={next} footer={
      <button className="btn btn-primary" onClick={next}>{ferry.length ? 'Continue' : 'Wonderful'}</button>
    }>
      <div className="v91-dl-art"><AircraftArt typeId={artFor(ac.typeId)} livery={lv.livery} code={lv.code} name={lv.name} /></div>
      <div className="v91-dl-reg mono">{ac.reg}</div>
      <div className="v91-dl-type">{t?.name ?? ac.typeId} · {ac.cabin.label}</div>
      <div className="small muted v91-dl-from">Handed over at {from}{dl ? ` on ${fmtDay(dl.handover)}` : ''} · {how}</div>
      {ferry.length > 0 && (
        <div className="small v91-dl-ferry">Ferry home: {city(ferry[0].from)} → {city(ferry[ferry.length - 1].to)}, leaving {fmtDay(ferry[0].std)} {fmtTime(ferry[0].std, ferry[0].from)} local{ferry.length > 1 ? ` (${ferry.length} legs)` : ''}.</div>
      )}
    </Modal>
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
