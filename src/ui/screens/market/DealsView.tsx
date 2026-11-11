// v0.17 Fleet › Market › In progress (UPDATE-0.17.md §N.1; lane `market-ui`): one row per lease deal and per aircraft
// in transition or on its delivery ferry. Stage chips (LOI ✓ · Credit check · Lease · Transition · Ferry), the next
// date, and the row's action buttons ("Pay $520K", "Letter of credit", "Sign", "Walk away", "Add tech reps").

import { Banknote, FileCheck2, Plane, Undo2, UserPlus } from 'lucide-react';
import { useEffect } from 'react';
import { artFor } from '../../../data/acmiTypes';
import { MARKET_LIVERY } from '../../../data/livery';
import { BAL } from '../../../engine/core/balance';
import { typeOf } from '../../../engine/core/perf';
import { DAY } from '../../../engine/core/time';
import type { Aircraft, GameState, LeaseDeal, Ref } from '../../../engine/core/types';
import { addTechReps, addTechRepsToInduction, cashToSign, depositDue, inductionStep, lcWhy, meetConditions, rating, signLease } from '../../../engine/leasing';
import { deliveryStatus } from '../../../engine/ops';
import { AircraftArt } from '../../components/AircraftArt';
import { money } from '../../format';
import { store } from '../../store';
import { dealLine, stageChips, tName, transitionLine, type StageChip } from './marketLogic';
import { SpecsLink } from '../../specs/SpecsLink';

function Stages({ chips }: { chips: StageChip[] }) {
  return (
    <div className="mk17-stages" aria-label="Stages">
      {chips.map((c) => <span key={c.key} className={`mk17-stage ${c.state}`}>{c.label}</span>)}
    </div>
  );
}

const repsCost = (typeId: string) => BAL.v017.induction.techReps.cost[typeOf(typeId).body === 'wide' ? 'wide' : 'narrow'];
const ACTIVE = new Set(['committee', 'conditions', 'approved']);

function DealRow({ g, d, sel }: { g: GameState; d: LeaseDeal; sel: boolean }) {
  const o = d.offer;
  const line = dealLine(g.now, d);
  const active = ACTIVE.has(d.stage);
  const who = o.lessor.replace(' (used sale)', '');
  const due = active ? cashToSign(g, d) : 0;
  const lw = d.stage === 'conditions' ? lcWhy(g, o.lessorId, rating(g).grade, depositDue(d)) : null;
  return (
    <div className={`card mk17-deal ${sel ? 'selected' : ''} ${active ? '' : 'ended'}`} data-deal={d.id}>
      <div className="mk-top">
        <div className="mk-art"><AircraftArt typeId={artFor(o.typeId, o.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8 between">
            <b className="ellipsis">{tName(o.typeId)} · {o.builtYear} · {who}</b>
            <span className="small num muted">{money(o.rentPerMonth)}/month</span>
          </div>
          <div className={`small ${line.tone || 'muted'}`}>{line.text}</div>
        </div>
      </div>
      <Stages chips={stageChips(line.at, d.stage === 'declined' || d.stage === 'walked')} />
      {active && (
        <div className="row gap-8 wrap mk17-foot">
          <span className="tiny dim grow">Holding deposit {money(d.holding)} paid · {d.autoSign ? 'signs when approved' : 'you sign when approved'}{d.lc ? ' · deposit by letter of credit' : ''}{d.techReps ? ' · tech reps booked' : ''}</span>
          {d.stage === 'conditions' && d.conditions && <>
            <button className="btn btn-sm btn-primary" onClick={() => store.act((gg) => meetConditions(gg, d.id, 'cash'))}><Banknote /> Pay {money(d.conditions.extraDeposit)}</button>
            {!lw && <button className="btn btn-sm" onClick={() => store.act((gg) => meetConditions(gg, d.id, 'lc'))}>Letter of credit</button>}
          </>}
          {d.stage === 'approved' && <button className="btn btn-sm btn-primary" onClick={() => store.act((gg) => signLease(gg, d.id))} disabled={g.company.cash < due}><FileCheck2 /> Sign ({money(due)})</button>}
          {d.stage === 'committee' && !d.techReps && <button className="btn btn-sm" onClick={() => store.act((gg) => addTechReps(gg, d.id))} data-tip="One more CAMO slot and a faster records review"><UserPlus /> Add tech reps ({money(repsCost(o.typeId))})</button>}
          <SpecsLink subject={{ kind: 'type', typeId: o.typeId, cabin: o.cabin, variant: o.variant }} />
          <button className="btn btn-sm" onClick={() => store.walkAwayAsk(d.id)}><Undo2 /> Walk away</button>
        </div>
      )}
    </div>
  );
}

function TransitionRow({ g, ac, sel }: { g: GameState; ac: Aircraft; sel: boolean }) {
  const ds = deliveryStatus(g, ac.id);
  const i = ac.induction;
  const step = i ? inductionStep(i, g.now) : 'done';
  const inTransition = ac.status === 'delivering' && !!i && step !== 'done';
  const text = inTransition ? transitionLine(ac, step) : ds?.text ?? 'Delivering';
  const canReps = inTransition && !i!.techReps && (step === 'waiting' || step === 'records' || (step === 'check' && !!i!.findings));
  const lessor = ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.lessor : 'Bought';
  return (
    <div className={`card mk17-deal ${sel ? 'selected' : ''}`} data-ac={ac.id}>
      <div className="mk-top">
        <div className="mk-art"><AircraftArt typeId={artFor(ac.typeId, ac.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8 between">
            <b className="ellipsis">{ac.reg} · {tName(ac.typeId)} · {lessor}</b>
            {i?.findings && step !== 'done' && <span className="badge warn" data-tip={i.findings.text}>Findings +{i.findings.days} d</span>}
          </div>
          <div className="small muted">{text}</div>
        </div>
      </div>
      <Stages chips={stageChips(inTransition ? 'transition' : 'ferry')} />
      <div className="row gap-8 wrap mk17-foot">
        <span className="tiny dim grow">{i?.waitedCamo ? `Waited ${i.waitedCamo} days for our CAMO` : ''}</span>
        {canReps && <button className="btn btn-sm" onClick={() => store.act((gg) => addTechRepsToInduction(gg, ac.id))}><UserPlus /> Add tech reps ({money(repsCost(ac.typeId))})</button>}
        <button className="btn btn-sm" onClick={() => store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id } })}><Plane /> {ac.reg}</button>
      </div>
    </div>
  );
}

export function DealsView({ g, sel }: { g: GameState; sel?: Ref | null }) {
  const deals = (g.leasing?.deals ?? []).filter((d) => ACTIVE.has(d.stage) || (d.stage !== 'signed' && (d.endedAt ?? 0) > g.now - 30 * DAY))
    .sort((a, b) => (ACTIVE.has(a.stage) ? 0 : 1) - (ACTIVE.has(b.stage) ? 0 : 1) || b.loiAt - a.loiAt);
  const ferrying = new Set(['ferrying', 'handedOver', 'waiting']);
  const trans = Object.values(g.fleet).filter((a) => a.status === 'delivering' || (!!a.delivery && ferrying.has(deliveryStatus(g, a.id)?.phase ?? '')))
    .sort((a, b) => (a.induction?.ready ?? a.deliveredAt) - (b.induction?.ready ?? b.deliveredAt));
  const selId = sel?.kind === 'deal' || sel?.kind === 'aircraft' ? sel.id : null;
  useEffect(() => {
    if (selId) document.querySelector(`.mk17-deal[data-deal="${selId}"], .mk17-deal[data-ac="${selId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selId]);
  if (!deals.length && !trans.length) {
    return <div className="card sc-pad muted small">Nothing in progress.</div>;
  }
  return (
    <div className="mk-grid">
      {deals.map((d) => <DealRow key={d.id} g={g} d={d} sel={selId === d.id} />)}
      {trans.map((ac) => <TransitionRow key={ac.id} g={g} ac={ac} sel={selId === ac.id} />)}
    </div>
  );
}
