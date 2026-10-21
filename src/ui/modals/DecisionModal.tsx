// Decision dialog (B5): option chips, expiry, the default marked. Opens by itself for the oldest decision
// while decisions hold time (setting) and can be set aside ('Look first': time stays held, the amber
// pause badge brings it back); from the Inbox it opens a given decision and can be closed.

import { AlertTriangle } from 'lucide-react';
import { fmtDateTime } from '../../engine/core/time';
import { leaseView, resolveDecision } from '../../engine/ops';
import { Modal } from '../components/ui';
import { ReturnLines } from './LeaseModal';
import { spanLabel } from '../screens/screenLogic';
import { store, useStore } from '../store';

export function DecisionModal({ decisionId }: { decisionId?: string }) {
  const s = useStore();
  const g = s.game!;
  const d = decisionId ? g.decisions.find((x) => x.id === decisionId) : g.decisions[0];
  if (!d) return null;
  const closable = !!decisionId;
  const pick = (id: string) => {
    store.act((gg) => resolveDecision(gg, d.id, id), { toastOk: false });
    if (closable) store.closeModal();
  };
  const close = closable ? () => store.closeModal() : () => store.deferDecision();
  const def = d.options.find((o) => o.id === d.defaultOption);
  // v0.7: a lease-end decision shows live quotes (rent, return costs) rather than the chips from when it was posted.
  const acId = d.kind === 'leaseEnd' && typeof d.data?.aircraftId === 'string' ? d.data.aircraftId : null;
  const live = acId ? leaseView(g, acId) : null;
  const chipsOf = (o: (typeof d.options)[number]) => (live?.options.find((x) => x.id === o.id)?.chips ?? o.chips)?.filter((c) => !/^Deposit \$0 back$/.test(c));
  return (
    <Modal title={d.title} icon={<AlertTriangle className="warn" />} className="decision sc-decision" onClose={close}>
      <p className="muted">{d.body}</p>
      <div className="col gap-8 mt-12">
        {d.options.map((o) => (
          <button key={o.id} className={`decision-opt sc-opt ${o.tone ?? ''}`} onClick={() => pick(o.id)}>
            <span className="row between gap-8">
              <b>{o.label}</b>
              {o.id === d.defaultOption && <span className="badge">Default</span>}
            </span>
            <span className="small muted">{o.desc}</span>
            {!!chipsOf(o)?.length && (
              <span className="sc-chips">
                {chipsOf(o)!.map((c) => <span key={c} className={`chip sc-chip ${/^[−-]/.test(c) || /−/.test(c) ? 'bad' : /^\+/.test(c) ? 'good' : ''}`}>{c}</span>)}
              </span>
            )}
          </button>
        ))}
      </div>
      {acId && live && <div className="mt-12"><ReturnLines g={g} aircraftId={acId} /></div>}
      <div className="small dim mt-12">
        {fmtDateTime(d.t)} UTC · {def ? `“${def.label}” applies by itself at ${fmtDateTime(d.expires)} UTC (${spanLabel(d.expires - g.now)}).` : ''}
        {!closable && s.settings.autoPause.decision ? ' Time is paused until you decide.' : ''}
      </div>
      {!closable && (
        <div className="row between gap-8 mt-12">
          <span className="tiny dim">Check the map, schedule or crew first; tap the amber Paused badge to come back.</span>
          <button className="btn btn-sm" onClick={close}>Look first</button>
        </div>
      )}
    </Modal>
  );
}
