// v0.24 the signed contract, read back (Contracts › Active › a contract's sheet button): who, what, the terms it was
// signed on and how it stands. Read-only; the actions stay on the contract's card.

import { CalendarRange, ChevronRight } from 'lucide-react';
import { flag } from '../../data/countries';
import { clientStars } from '../../engine/contracts/prestige';
import { shapeOf } from '../../engine/contracts/shape';
import type { GameState } from '../../engine/core/types';
import { ClientStars } from '../components/ClientStars';
import { DurationStrip } from '../components/DurationStrip';
import { ShapeTags } from '../components/ShapeTags';
import { Modal } from '../components/ui';
import { ArchIcon, Chips, KV } from '../screens/common';
import { archLabel, offerDays, reqChips, routeSummary } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { contractSheet } from './contractSheetLogic';
import { effectChips, Programme } from './OfferModal';

const STATUS: Record<string, string> = { signed: 'Signed', active: 'Flying', completed: 'Completed', cancelled: 'Cancelled' };

export function ContractModal({ contractId }: { contractId: string }) {
  const g: GameState = useGame();
  const c = g.contracts[contractId];
  if (!c) return null;
  const cl = g.clients[c.clientId];
  const sheet = contractSheet(g, c);
  const regs = c.aircraftIds.map((id) => g.fleet[id]?.reg ?? '?').join(' + ');
  const days = offerDays(c);
  const close = () => store.closeModal();
  return (
    <Modal size="wide" className="v24-contract" icon={<ArchIcon a={c.archetype} />} title={c.title} onClose={close} footer={
      <div className="row gap-8 v24-contract-foot">
        <button className="btn" onClick={() => { close(); store.navigate('schedule', { sel: { kind: 'aircraft', id: c.aircraftIds[0] }, view: String(Math.max(g.now, c.start)) }); }}><CalendarRange /> Schedule</button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={close}>Close</button>
      </div>
    }>
      <div className="col gap-12">
        <div className="row gap-8 wrap">
          <span className="upper dim">{archLabel(c)}</span>
          <span className={`badge ${c.status === 'active' ? 'good' : c.status === 'cancelled' ? 'bad' : ''}`}>{STATUS[c.status]}</span>
          <span className="small muted mono">{regs}</span>
        </div>
        <div className="row gap-8 wrap between">
          <span className="row gap-8"><b>{cl ? `${flag(cl.country)} ${cl.name}` : 'Client'}</b>{cl && <ClientStars n={clientStars(cl)} size={12} />}{c.broker && <span className="chip sc-chip sc-broker">via {c.broker}</span>}</span>
          {cl && !cl.own && <button className="btn btn-ghost btn-sm" onClick={() => store.openModal({ kind: 'client', clientId: cl.id })}>Client <ChevronRight /></button>}
        </div>
        <div className="of-shape-head">{routeSummary(c.pattern) && <span className="small muted mono">{routeSummary(c.pattern)}</span>}<ShapeTags s={shapeOf(c, (id) => g.fleet[id]?.typeId)} /></div>
        <DurationStrip now={g.now} first={days[0]} last={c.pattern.kind === 'base' ? days[1] : Math.max(c.start, c.end - 1)} className="of-dur" />
        <Chips chips={[...reqChips(c.requirements, c.pattern, { shape: true }), ...effectChips(c)]} />
        <div className="upper dim">How it stands</div>
        <KV rows={sheet.status} />
        <div className="upper dim">Terms</div>
        <KV rows={sheet.terms} />
        {c.product.kind !== 'dry' && <>
          <div className="upper dim">Programme</div>
          <Programme o={c} />
        </>}
      </div>
    </Modal>
  );
}
