// v0.17 (UPDATE-0.17.md §F, §N.3; lane `market-ui`): the letter of intent for a lease. Key–value rows: rent and why
// this rent, term, deposit (now and at signing), reserves, return, ready (records · check · paint · acceptance as a
// small timeline), our CAMO, the AOC, pilots, cash after. Toggles: sign the lease when the credit check passes, paint,
// contract tech reps, deposit as a letter of credit. A rare type shows What it takes (§T). AcquireModal stays for
// purchases, short-term and legacy offers.

import { AlertTriangle, FileSignature } from 'lucide-react';
import { useState } from 'react';
import { artFor } from '../../data/acmiTypes';
import { COUNTRIES } from '../../data/countries';
import { MARKET_LIVERY } from '../../data/livery';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { fmtDay, fmtSpan } from '../../engine/core/time';
import { loiQuote, paintCost, signLoi, type LoiOpts } from '../../engine/leasing';
import { whyText } from '../../engine/leasing/terms';
import { checkRegistration, cleanRegInput, marketView, NAME_MAX, problemFor, regCountry, suggestRegistration, type ProblemAction } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { ProblemCardView, runAction } from '../components/ProblemCard';
import { RestTwoLiner } from '../components/RestLines';
import { Modal, Toggle } from '../components/ui';
import { Term } from '../components/Term';
import { money } from '../format';
import { KV } from '../screens/common';
import { dayIn, GateChip, offerRest } from '../screens/Market';
import { lessorLabel, offerReadyLine, sourceBadge, tName } from '../screens/market/marketLogic';
import { WhatItTakes } from '../screens/market/WhatItTakes';
import { store, useGame } from '../store';
import { SpecsLink } from '../specs/SpecsLink';

export function LoiModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const v = marketView(g).find((x) => x.offer.id === offerId);
  const close = () => store.closeModal();
  const [autoSign, setAuto] = useState(true);
  const [paint, setPaint] = useState(false);
  const [techReps, setReps] = useState(false);
  const [lc, setLc] = useState(false);
  const prefix = g.company.regPrefix;
  const [regIn, setRegIn] = useState(() => suggestRegistration(g, offerId).slice(prefix.length));
  const [acName, setAcName] = useState('');
  const [via, setVia] = useState<'thisSide' | 'ferryCo' | null>(null);
  const q = v ? loiQuote(g, offerId, { autoSign, paint, techReps, lc }) : null;
  if (!v || !q) {
    return (
      <Modal title="Offer gone" icon={<FileSignature className="accent" />} onClose={close} footer={<button className="btn" onClick={close}>Close</button>}>
        <p className="muted">This offer has gone: the lessor placed the aircraft elsewhere.</p>
      </Modal>
    );
  }
  const o = v.offer;
  const t = typeOf(o.typeId);
  const wide = t.body === 'wide';
  const reg = checkRegistration(g, regIn);
  const blk = v.quote.blocked ?? null;
  const way = blk && via === 'thisSide' && !blk.thisSide ? null : blk ? via : null;
  const card = blk ? problemFor(g, { kind: 'noFerry', ref: { kind: 'market', id: o.id } }) : null;
  const pickWay = (a: ProblemAction) => (a.id === 'thisSide' || a.id === 'ferryCo' ? setVia(a.id) : runAction(g, a));
  const useLc = lc && q.lcAllowed;
  const atSign = (useLc ? 0 : q.depositAtSign) + q.reservesDeposit + q.transition + q.techReps + q.paint;
  const ferry = v.quote.legs.length ? v.quote.homeBy - v.quote.handover : 0;
  const blocker = q.why ?? (blk && !way ? 'No legal ferry home: choose how it gets here' : !reg.ok ? `Registration: ${reg.reason}` : null);
  const sign = () => {
    if (!reg.ok) return;
    const opts: LoiOpts = { autoSign, paint, techReps, lc: useLc, reg: reg.reg, name: acName, ...(way ? { delivery: way } : {}) };
    const r = store.act((gg) => signLoi(gg, o.id, opts));
    if (!r.ok) return;
    close();
    store.navigate('fleet', { view: 'market', sel: { kind: 'deal', id: r.data!.dealId } });
  };
  const badge = sourceBadge(o);
  const warns: { tone: 'warn' | 'bad'; text: string }[] = [];
  if (v.gate.pending.length) warns.push({ tone: 'warn', text: v.gate.text });
  if (q.cashAfter - atSign < 0) warns.push({ tone: 'warn', text: `Signing the lease needs ${money(atSign)}; you have ${money(g.company.cash)} after the holding deposit is paid.` });
  if (q.exoticSecurity) warns.push({ tone: 'warn', text: `A rare type at rating ${q.grade}: ${money(q.exoticSecurity)} more deposit and ${money(q.reservesDeposit)} of reserves up front (refunded at return).` });
  const paintDays = BAL.v017.induction.paint[wide ? 'wide' : 'narrow'];
  const repsCost = BAL.v017.induction.techReps.cost[wide ? 'wide' : 'narrow'];
  const regName = COUNTRIES[regCountry(g)]?.name ?? 'national';
  return (
    <Modal className="aq-modal" title={`Letter of intent: ${tName(o.typeId)}`} icon={<FileSignature className="accent" />} onClose={close} footer={
      <>
        {blocker && <span className="grow small warn">{blocker}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={sign} disabled={!!blocker}><FileSignature /> Sign letter of intent ({money(q.holding)} now)</button>
      </>
    }>
      <div className="aq-top">
        <div className="aq-art"><AircraftArt typeId={artFor(o.typeId, o.variant)} livery={MARKET_LIVERY} detail="simple" /></div>
        <div className="col gap-4 grow" style={{ minWidth: 0 }}>
          <div className="row gap-8"><b>{t.name}</b><span className={`badge ${badge.tone}`}>{badge.label}</span></div>
          <div className="small muted" data-tip={lessorLabel(o).tip}>{q.lessor} · built {o.builtYear} · {o.cabin.label}{o.exOperator ? ` · ex-${o.exOperator}` : ''}</div>
          <div className="small muted">{offerReadyLine(g.now, o, q.ready, ferry > 0 ? q.ready + ferry : null)}</div>
          <div className="row gap-8 wrap"><GateChip v={v} /><span className={`chip mk-chip ${v.crew.level === 'ok' ? 'good' : v.crew.level}`}>{v.crew.text}</span><SpecsLink subject={{ kind: 'offer', id: o.id }} /></div>
          <RestTwoLiner g={g} rest={offerRest(v)} typeId={o.typeId} />
        </div>
      </div>
      {card && (
        <div className="mt-12 mb-8 aq-noferry">
          <ProblemCardView card={card} g={g} onAction={pickWay} />
          {way && <div className="small muted mt-8">Chosen: {way === 'ferryCo' ? 'a ferry company flies it to our base' : 'a handover on this side, then our own ferry home'}. <button className="btn btn-ghost btn-sm" onClick={() => setVia(null)}>Change</button></div>}
        </div>
      )}
      <div className="aq-cols">
        <div className="col gap-8" style={{ minWidth: 0 }}>
          <div className="upper dim">Terms</div>
          <KV rows={[
            ['Rent', `${money(o.rentPerMonth)} a month`],
            ['Why this rent', <span key="w" className="small">{whyText(o.why) || q.whyRent}</span>],
            ['Term', `${o.leaseMonths} months`],
            [<Term key="d" id="holdingDeposit" extra={`Walk away after approval: ${q.lessor} keeps it.`}>Deposit</Term>, `${money(q.holding)} now · ${money(q.depositAtSign)} at signing${useLc ? ' (letter of credit)' : ''}`],
            ...(q.reservesDeposit ? [['Reserves up front', `${money(q.reservesDeposit)} at signing, back at return`]] as [string, string][] : []),
            ['Reserves', q.reserves],
            ['Return', v.returnText ?? q.ret],
            [<Term key="c" id="creditCheck">Credit check</Term>, `${q.lessor} answers in ${fmtSpan(q.committeeDays[0], q.committeeDays[1], 'days')} (our rating ${q.grade})`],
            ['Transition', `${money(q.transition)} at signing${q.techReps ? ` + tech reps ${money(q.techReps)}` : ''}${q.paint ? ` + paint ${money(q.paint)}` : ''}`],
            ['Cash after', `${money(q.cashAfter)} now · ${money(q.cashAfter - atSign)} after signing`],
          ]} />
        </div>
        <div className="col gap-8" style={{ minWidth: 0 }}>
          <div className="upper dim">Ready ~{dayIn(g.now, q.ready)} (UTC)</div>
          {q.steps.length > 0 && (
            <div className="lo-steps">
              {q.steps.map((s) => <div key={s.label} className="lo-step"><span>{s.label}</span><span className="num muted">{fmtDay(s.from)} – {fmtDay(s.to)}</span></div>)}
            </div>
          )}
          <KV rows={[
            ['Our CAMO', q.camo],
            ['AOC', q.aoc ?? `${t.family} on our AOC`],
            ['Pilots', q.pilots ?? 'Rated'],
          ]} />
        </div>
      </div>
      <div className="lo-toggles mt-12">
        <div className="row gap-8"><Toggle on={autoSign} onChange={setAuto} label="Sign the lease when the credit check passes" /><span className="small grow">Sign the lease when the credit check passes</span></div>
        <div className="row gap-8"><Toggle on={paint} onChange={setPaint} label="Paint in our colours" /><span className="small grow">Paint in our colours ({money(paintCost(o.typeId))}, +{paintDays} days); else white with our titles</span></div>
        <div className="row gap-8"><Toggle on={techReps} onChange={setReps} label="Contract tech reps" /><span className="small grow">Contract tech reps ({money(repsCost)}, one more CAMO slot, faster records)</span></div>
        {q.lcAllowed
          ? <div className="row gap-8"><Toggle on={lc} onChange={setLc} label="Deposit as a letter of credit" /><span className="small grow">Deposit as a letter of credit (uses the credit line, 1.25 % a year)</span></div>
          : <div className="tiny dim">Letter of credit: {q.lcWhy}</div>}
      </div>
      <div className="aq-reg mt-12">
        <div className="field">
          <label htmlFor="lo-reg-in">Registration</label>
          <div className={`aq-reg-box ${reg.ok ? '' : 'bad'}`}>
            <span className="aq-reg-prefix mono" aria-hidden>{prefix}</span>
            <input id="lo-reg-in" className="input mono" value={regIn} inputMode="text" autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false}
              aria-label={`Registration after ${prefix}`} aria-invalid={!reg.ok} onChange={(e) => setRegIn(cleanRegInput(prefix, e.target.value, regCountry(g)))} />
          </div>
          <span className={`tiny ${reg.ok ? 'dim' : 'bad'}`}>{reg.ok ? `${reg.reg} · on the ${regName} register` : reg.reason}</span>
        </div>
        <div className="field">
          <label htmlFor="lo-name-in">Name <span className="dim">(optional)</span></label>
          <input id="lo-name-in" className="input" value={acName} maxLength={NAME_MAX} placeholder="e.g. Vasco da Gama" autoCorrect="off" autoComplete="off" spellCheck={false} onChange={(e) => setAcName(e.target.value.slice(0, NAME_MAX))} />
          <span className="tiny dim">Painted under the cockpit windows</span>
        </div>
      </div>
      <div className="mt-12"><WhatItTakes g={g} typeId={o.typeId} /></div>
      {warns.length > 0 && (
        <div className="col gap-4 mt-12">
          {warns.map((w, i) => <div key={i} className={`small row gap-8 cv-warn ${w.tone}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>)}
        </div>
      )}
    </Modal>
  );
}
