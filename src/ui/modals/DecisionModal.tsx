// Decision dialog (B5): option chips, expiry, the default marked. Opens by itself for the oldest decision
// while decisions hold time (setting) and can be set aside ('Look first': time stays held, the amber
// pause badge brings it back); from the Inbox it opens a given decision and can be closed.
// v0.7.1: the decision carries its four-line card (crew shortage at the gate, AOG, a change request, a late
// payment) and a crew-short decision adds 'Open Crew Control' (all nine solutions).

import { AlertTriangle, Users } from 'lucide-react';
import { fmtDateTime } from '../../engine/core/time';
import { leaseView, resolveDecision } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { disruptionCard, isDisruption } from '../../engine/problems/ops';
import { DiversionMap, divSpec } from '../map/DiversionMap';
import { decisionBodyTail } from '../components/problemLogic';
import { Modal } from '../components/ui';
import { ProblemCardView } from '../components/ProblemCard';
import { ReturnLines } from './LeaseModal';
import { hurtTone } from './crewControlLogic';
import { spanLabel } from '../screens/screenLogic';
import { store, useStore } from '../store';

/** A chip's colour: money out / reliability lost red, lateness and crew limits amber, gains green. */
function chipTone(c: string): string {
  return hurtTone(c) ?? (/^[−-]/.test(c) || /−/.test(c) ? 'bad' : /\blate\b|out of hours|discretion|curfew|penalty|offloaded|risk/i.test(c) ? 'warn' : /^\+/.test(c) ? 'good' : '');
}

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
  // v0.7.1: the card behind the decision (its flight / aircraft / contract, else the decision itself).
  const flightId = d.kind === 'crewShort' && typeof d.data?.flightId === 'string' ? d.data.flightId : null;
  // v0.11 an operations disruption carries its own four lines (and a map when an airport is to be chosen).
  const card = isDisruption(d) ? disruptionCard(g, d) : (flightId ? problemAt(g, { kind: 'flight', id: flightId }) : null) ?? (d.ref ? problemAt(g, d.ref) : null) ?? problemAt(g, { kind: 'decision', id: d.id });
  const dspec = divSpec(g, d);
  const crewControl = () => {
    // Never over the decision: it is set aside (Inbox / pause badge bring it back) and Crew Control opens.
    if (closable) store.closeModal();
    else store.deferDecision();
    store.openModal({ kind: 'crewControl', flightId: flightId! });
  };
  return (
    <Modal title={d.title} icon={<AlertTriangle className="warn" />} className="decision sc-decision" onClose={close}>
      {(() => { const tail = decisionBodyTail(d.body, card); return tail ? <p className="muted">{tail}</p> : null; })()}
      {card && <ProblemCardView card={card} g={g} hideActions />}
      {dspec && <DiversionMap spec={dspec} onPick={d.kind === 'divertOnward' ? undefined : pick} />}
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
                {chipsOf(o)!.map((c) => <span key={c} className={`chip sc-chip ${chipTone(c)}`}>{c}</span>)}
              </span>
            )}
          </button>
        ))}
        {flightId && g.flights[flightId]?.status === 'scheduled' && (
          <button className="btn" onClick={crewControl}><Users /> Open Crew Control · all nine ways to fix it</button>
        )}
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
