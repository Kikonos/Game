// Decision dialog (B5): the oldest open decision; time is held until the player picks (setting).

import { AlertTriangle } from 'lucide-react';
import { fmtDateTime } from '../../engine/core/time';
import { resolveDecision } from '../../engine/ops';
import { Modal } from '../components/ui';
import { store, useStore } from '../store';

export function DecisionModal() {
  const s = useStore();
  const d = s.game!.decisions[0];
  if (!d) return null;
  return (
    <Modal title={d.title} icon={<AlertTriangle className="warn" />} className="decision">
      <p className="muted">{d.body}</p>
      <div className="col gap-8 mt-16">
        {d.options.map((o) => (
          <button key={o.id} className="decision-opt" onClick={() => store.act((g) => resolveDecision(g, d.id, o.id), { toastOk: false })}>
            <b>{o.label}</b>
            <span className="small muted">{o.desc}</span>
          </button>
        ))}
      </div>
      <div className="tiny dim mt-12">{fmtDateTime(d.t)} UTC · Time is paused until you decide.</div>
    </Modal>
  );
}
