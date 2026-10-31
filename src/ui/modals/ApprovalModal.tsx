// v0.7 one approval on the Ladder (UPDATE-0.7.md §F8.5): what it is, the requirement checklist (✓/✗ with have and
// need), cost and time, what it unlocks (types as art, the work), and Apply (behind a confirm over 25% of cash).
// Pending: started, due, authority findings and what it is waiting for.

import { BadgeCheck, Check, ShieldCheck, Wrench, X } from 'lucide-react';
import { artFor } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { fmtDate } from '../../engine/core/time';
import type { ApprovalId } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { APPROVALS, applyApproval, atRiskLine, approvalBlocker, approvalReqs, etopsMxBlocker, ladder, setUpEtopsMx } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Bar, Modal } from '../components/ui';
import { money } from '../format';
import { isCashReq, reqLabel } from '../screens/Ladder';
import { store, useGame } from '../store';

export function ApprovalModal({ id }: { id: ApprovalId }) {
  const g = useGame();
  const def = APPROVALS.find((a) => a.id === id);
  const close = () => store.closeModal();
  if (!def) return null;
  const node = ladder(g).flatMap((r) => r.nodes).find((n) => n.id === id);
  const co = g.company;
  const held = co.approvals.includes(id);
  const p = co.pendingApprovals.find((x) => x.id === id);
  // Filed: the fee is paid, so the cash line goes.
  const reqs = approvalReqs(g, id).filter((r) => !(p && isCashReq(r)));
  const blocker = held || p ? null : approvalBlocker(g, id);
  const lv = co.livery;
  const doApply = () => {
    if (store.act((gg) => applyApproval(gg, id)).ok) store.openModal({ kind: 'approval', id });
  };
  const apply = () => {
    if (def.cost <= co.cash * 0.25) return doApply();
    store.openModal({
      kind: 'confirm', title: `Apply for ${def.name}?`, confirm: `Apply · ${money(def.cost)}`,
      body: `${money(def.cost)} is ${Math.round((def.cost / Math.max(1, co.cash)) * 100)}% of the cash on hand. The authority takes about ${def.days} days; the fee is not refunded.${def.grantCost ? ` ${money(def.grantCost)} more is due at the grant.` : ''}`,
      onConfirm: doApply,
    });
  };
  // v0.10.2 the ETOPS maintenance programme's own Set up (a one-off; every ETOPS approval uses it).
  const mx = BAL.ladder.etopsMx;
  const doSetUp = () => store.act((gg) => setUpEtopsMx(gg));
  const setUp = () => {
    if (mx.cost <= co.cash * 0.25) return doSetUp();
    store.openModal({
      kind: 'confirm', title: 'Set up the ETOPS maintenance programme?', confirm: `Set up · ${money(mx.cost)}`,
      body: `${money(mx.cost)} is ${Math.round((mx.cost / Math.max(1, co.cash)) * 100)}% of the cash on hand. Ready in about ${mx.days} days; ETOPS 120, 180 and 240 all use it.`,
      onConfirm: () => { doSetUp(); store.openModal({ kind: 'approval', id }); },
    });
  };
  const prog = p ? Math.min(1, Math.max(0, (g.now - p.started) / Math.max(1, p.done - p.started))) : 0;
  return (
    <Modal className="ap-modal" title={def.name} icon={<ShieldCheck className="accent" />} onClose={close} footer={
      <>
        {blocker && <span className="grow small warn">{blocker}</span>}
        <button className="btn" onClick={close}>Close</button>
        {!held && !p && <button className="btn btn-primary" onClick={apply} disabled={!!blocker}>Apply · {money(def.cost)}</button>}
      </>
    }>
      <p className="muted">{def.desc}</p>
      {held && <div className="row gap-8 good small mt-8"><BadgeCheck className="sc-ico-s" />Held since {fmtDate(co.approvalsAt?.[id] ?? g.started)}</div>}
      {p && (
        <div className="ap-pending mt-8">
          <div className="row between small"><b>In progress</b><span className="dim">filed {fmtDate(p.started)} · due {fmtDate(p.done)}</span></div>
          <Bar value={prog} size="thin" />
          {!!p.findings && <div className="small warn">{p.findings} authority finding{p.findings > 1 ? 's' : ''}: +{p.findings * 30} days</div>}
          {p.waiting && <div className="small warn">Stuck: {p.waiting.replace(/^Needs /, 'needs ')}</div>}
          {/* v0.12.1 the signed jobs that can't fly until the grant. */}
          {atRiskLine(g, id) && <div className="small bad">{atRiskLine(g, id)}. Those legs can't fly until it is granted.</div>}
        </div>
      )}
      {!held && (
        <>
          <div className="upper dim mt-12">Requirements</div>
          <div className="ap-reqs">
            {reqs.map((r) => (
              <div key={r.label} className={`ap-req ${r.ok ? 'ok' : 'no'}`}>
                {r.ok ? <Check className="sc-ico-s good" /> : <X className="sc-ico-s bad" />}
                <span className="grow small">{reqLabel(r)}</span>
                {(r.have || r.need) && <span className="small num nowrap">{r.have ?? ''}{r.need && r.have !== r.need ? <span className="dim"> / {r.need}</span> : null}</span>}
                {r.action === 'etopsMx' && <button className="btn btn-sm" onClick={setUp} disabled={!!etopsMxBlocker(g)} title={etopsMxBlocker(g) ?? undefined}><Wrench /> Set up · {money(mx.cost)}</button>}
              </div>
            ))}
          </div>
          {reqs.some((r) => r.label === 'ETOPS maintenance programme') && <div className="small muted mt-8">The ETOPS maintenance programme is a one-off: {money(mx.cost)}, about {mx.days} days. You can apply while it is being set up; the grant waits for it.</div>}
          {id === 'widebody' && <div className="small muted mt-8">Booked conversions count for filing; the grant needs them finished. Time the class to end near your first widebody’s handover: converted pilots fly only the new type.</div>}
          <div className="small muted mt-8">{money(def.cost)} filing fee{def.grantCost ? ` + ${money(def.grantCost)} at the grant` : ''} · about {def.days} days. Granted only with pilots actually rated, no illegal crew duties and the technical reliability met; an illegal crew duty while pending adds 30 days.</div>
        </>
      )}
      {node && (node.unlocksTypes.length > 0 || node.unlocksWork) && (
        <>
          <div className="upper dim mt-12">Unlocks</div>
          {node.unlocksTypes.length > 0 && (
            <div className="ap-types">
              {node.unlocksTypes.map((t) => (
                <div key={t} className="ap-type"><div className="ap-art"><AircraftArt typeId={artFor(t)} livery={lv} code={co.code} name={co.name} detail="simple" /></div><span className="tiny">{typeOf(t)?.short ?? t}</span></div>
              ))}
            </div>
          )}
          {node.unlocksWork && <div className="small muted">{node.unlocksWork}</div>}
        </>
      )}
    </Modal>
  );
}
