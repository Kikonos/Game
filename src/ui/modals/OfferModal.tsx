// Offer review (B5): details, feasibility per aircraft (contracts.feasibilityAll), accept on the
// chosen aircraft, counter or decline. Skeleton shows the basics. DESIGN.md §6.3.

import { declineOffer } from '../../engine/contracts';
import { fmtDate } from '../../engine/core/time';
import { Modal } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

export function OfferModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const o = g.offers[offerId];
  if (!o) return null;
  return (
    <Modal title={o.title} onClose={() => store.closeModal()} footer={
      <button className="btn" onClick={() => { store.act((gg) => declineOffer(gg, o.id)); store.closeModal(); }}>Decline</button>
    }>
      <p className="muted">{o.blurb}</p>
      <div className="small">{fmtDate(o.start)} – {fmtDate(o.end)} · est. {money(o.estValue)}</div>
    </Modal>
  );
}
