// Offer review (B5): terms, schedule and effects on the left; per-aircraft feasibility (traffic lights,
// positioning, crew capacity, contribution) on the right; Decline / Counter / Accept. DESIGN.md §6.3.

import { Check, Palette, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flag } from '../../data/countries';
import { artFor } from '../../data/acmiTypes';
import { acceptOffer, askingPrice, counterOffer, counterView, declineOffer, feasibilityAll, leadDays, paintQuote, paintTermsText, type FeasibilityReport } from '../../engine/contracts';
import { clientCode, clientTitles } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import type { ContractOffer, CrewExtra, GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { offerExtra } from '../../engine/crew';
import type { CounterView } from '../../engine/contracts';
import { Modal, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { ArchIcon, Chips, Dot, KV } from '../screens/common';
import { archLabel, counterSteps, expiryLabel, pctLabel, reqChips, riskChips, ROLE_LABEL, routeSummary, offerDays, type Chip } from '../screens/screenLogic';
import { store, useGame } from '../store';

const LEVEL_TONE = { ok: 'good', warn: 'warn', no: 'bad' } as const;
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

function effectChips(o: ContractOffer): Chip[] {
  const e = o.effects;
  const out: Chip[] = [];
  const add = (v: number | undefined, label: string) => {
    if (v) out.push({ label: `${label} ${v > 0 ? '+' : '−'}${Math.abs(v)}`, tone: v > 0 ? 'good' : 'bad' });
  };
  add(e.reliable, 'Reliable');
  add(e.clean, 'Clean');
  add(e.morale, 'Crew morale');
  return out;
}

const MONTH_DAYS = 30.44;

function Terms({ g, o }: { g: GameState; o: ContractOffer }) {
  const p = o.product;
  const rows: [string, string][] = [];
  const lead = leadDays(g, o.start);
  const pay = o.payment;
  const days = (o.end - o.start) / DAY;
  if (p.kind === 'wet') {
    // Jobs shorter than a month: the guarantee for the term, as the blurb and the active card state it.
    const mgh = days < 28
      ? `≈ ${Math.round((p.mghPerMonth * days) / MONTH_DAYS)} BH for this job per aircraft (${Math.round(p.mghPerMonth / MONTH_DAYS)} BH a day)`
      : `${p.mghPerMonth} BH / month per aircraft`;
    rows.push(['Rate', `${usd(p.ratePerBH)} per block hour`], ['Minimum guarantee', mgh]);
    rows.push(['Above MGH', `${Math.round(p.excessRate * 100)}% of the rate`], ['Short-cycle fee', usd(p.cycleFee)]);
    rows.push(['Positioning', p.positioningBillable ? 'Billable at the rate' : 'At our cost']);
  } else if (p.kind === 'charter') {
    rows.push(['Price', `${usd(p.price)} all-in`]);
    // Arrears charters (governments) are invoiced after the job: no deposit, no balance.
    if (pay.basis !== 'arrears') {
      if (p.depositPct > 0) rows.push(['Deposit', `${Math.round(p.depositPct * 100)}% on signing`]);
      const n = p.balanceDaysBefore;
      rows.push(['Balance', lead > n ? `${n} days before each trip` : days <= n ? 'At signing' : `At signing for trips in the next ${n} days, then ${n} days before each trip`]);
    }
    rows.push(['Fuel', p.fuelEscalation ? 'Escalation clause' : 'Our risk']);
  } else rows.push(['Rent', `${usd(p.rentPerMonth)} / month`], ['Reserves', `${usd(p.reservesPerFH)} / FH`]);
  const [d0, d1] = offerDays(o);
  rows.push(['Dates', `${fmtDate(d0)} – ${fmtDate(d1)}${o.pattern.kind === 'base' ? ` (${o.pattern.base} local)` : ''}`], ['Lead time', lead <= 0 ? 'Starts now' : `${lead} days`]);
  rows.push(['Estimate', `Billable ≈ ${Math.round(o.estBH)} BH · ${money(o.estValue)}`]);
  const arrears = p.kind === 'charter' ? 'Invoiced after the job' : 'Monthly in arrears';
  rows.push(['Payment', `${pay.basis === 'advance' ? 'In advance' : pay.basis === 'arrears' ? arrears : 'On completion'}, net ${pay.dueDays} days`]);
  rows.push(['If we cancel', o.penalties.cancelScale.map(([d, f]) => `${d} d ${Math.round(f * 100)}%`).join(' · ') || '—']);
  if (o.penalties.perCancelledLeg) rows.push(['Per cancelled leg', usd(o.penalties.perCancelledLeg)]);
  return <KV rows={rows} />;
}

function Programme({ o }: { o: ContractOffer }) {
  const p = o.pattern;
  if (p.kind === 'base') {
    const waves = p.waves.map((w) => `${String(Math.floor(w / 60)).padStart(2, '0')}:${String(w % 60).padStart(2, '0')}`).join(', ');
    return (
      <KV rows={[
        ['Base', `${p.base} · ${AIRPORT_BY_CODE[p.base]?.city ?? ''}`],
        ['Destinations', p.dests.join(', ')],
        ['Daily waves', `${waves} local`],
        ['Programme', `≈ ${Math.round(p.targetBH)} BH / month`],
        ['Maintenance night', `every ${p.maintEvery} days`],
      ]} />
    );
  }
  const legs = [...p.legs].sort((a, b) => a.dep - b.dep);
  return (
    <div className="sc-legs">
      {legs.slice(0, 10).map((l, i) => (
        <div key={i} className="sc-leg">
          <span className="dim">{fmtDay(l.dep)}</span>
          <span className="mono">{l.flightNo}</span>
          <span className="mono">{l.from} → {l.to}</span>
          <span className="num">{fmtTime(l.dep)} UTC <span className="dim">({fmtTime(l.dep, l.from)} local)</span></span>
          <span className="dim right">{l.pax ? `${l.pax} pax` : ''}</span>
        </div>
      ))}
      {legs.length > 10 && <div className="small dim">… {legs.length - 10} more legs</div>}
    </div>
  );
}

/** Client paint request: their livery on our aircraft, the terms, and paint on/off with its price effect. */
function PaintTermsCard({ g, o, typeId, on, onToggle, fmtP }: { g: GameState; o: ContractOffer; typeId: string; on: boolean; onToggle: (v: boolean) => void; fmtP: (v: number) => string }) {
  const t = o.paint!;
  const cl = g.clients[o.clientId];
  const quote = paintQuote(o, true);
  const offPrice = askingPrice(paintQuote(o, false));
  const share = t.clientShare >= 1 ? 'They pay the paint and the repaint after' : t.clientShare > 0 ? `They pay ${Math.round(t.clientShare * 100)}% of the paint and repaint` : `We pay; the rate is ${Math.round((t.bonusPct ?? 0) * 100)}% higher for it`;
  const ours = quote.cost - quote.reimbursed;
  return (
    <div className={`sc-paint-card ${t.required ? 'required' : ''}`}>
      <div className="row gap-8 between">
        <span className="row gap-8"><Palette className="sc-ico-s accent" /><b>Their livery on our aircraft</b></span>
        <span className={`badge ${t.required ? 'warn' : 'info'}`}>{t.required ? 'Required' : 'Optional'}</span>
      </div>
      <div className="sc-paint-art">
        {cl && <AircraftArt typeId={typeId} livery={t.livery} code={clientCode(cl)} name={clientTitles(cl)} detail="full" />}
      </div>
      <KV rows={[
        ['Work', t.kind === 'full' ? `Full repaint · ${t.days} days in a paint shop` : `Decals on white · ${t.days} day${t.days > 1 ? 's' : ''}`],
        ['Per aircraft', `${money(t.cost)} paint + ${money(t.stripCost)} back to ours`],
        ['Who pays', `${share}${ours > 0 ? ` · our share ${money(ours)}` : ''}`],
      ]} />
      <div className="set-row sc-paint-toggle">
        <div>
          <b>Paint it in their colours</b>
          <div className="tiny dim">
            {on ? `Accept at ${fmtP(askingPrice(o))}. It flies the whole contract in their livery.`
              : t.required ? `They require it. A counter without paint: they may walk away, or cut the ${o.product.kind === 'wet' ? 'rate' : 'price'} ${Math.round(t.declinePct * 100)}% more.`
              : `Without it: ${fmtP(offPrice)} (−${Math.round(t.declinePct * 100)}%${t.bonusPct ? ` and no +${Math.round(t.bonusPct * 100)}% paint bonus` : ''}).`}
          </div>
        </div>
        <Toggle on={on} onChange={onToggle} label="Paint in client livery" />
      </div>
    </div>
  );
}

/** v0.6: extra crew for this contract (default: the aircraft's or the company's) and the client's paid option. */
function ExtraCrewCard({ o, x, onChange, fmtP, asking }: { o: ContractOffer; x: CrewExtra; onChange: (x: CrewExtra) => void; fmtP: (v: number) => string; asking: number }) {
  const req = o.requirements.extraCabin;
  const paid = o.requirements.extraCabinPaid;
  const on = !!paid && x.cabin >= paid.n;
  return (
    <div className={`sc-extra-card ${on ? 'paid' : ''}`}>
      <div className="row between gap-8">
        <span className="col"><b>Extra cabin crew</b><span className="tiny dim">{req ? `The client requires +${req}. ` : ''}Above the legal minimum: more salaries and per diems, better morale and service.</span></span>
        <Stepper value={x.cabin} min={req} max={BAL.crewExtra.cabinMax} onChange={(v) => onChange({ cabin: v, pilot: x.pilot })} format={(v) => `+${v}`} />
      </div>
      <div className="row between gap-8">
        <span className="col"><b className="small">Spare pilot</b><span className="tiny dim">Covers a sick call away from base; no extra duty time.</span></span>
        <Toggle on={!!x.pilot} onChange={(v) => onChange({ cabin: x.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" />
      </div>
      {paid && (
        <div className="row between gap-8 sc-extra-paid">
          <span className="col">
            <b className="small">Fly +{paid.n} cabin crew · client pays +{pctLabel(paid.pct)} (+{o.product.kind === 'wet' ? `${fmtP(Math.round(asking * paid.pct))}` : money(asking * paid.pct)})</b>
            <span className="tiny dim">{on ? `Accept at ${fmtP(asking * (1 + paid.pct))}. The contract keeps at least ${paid.n} extra cabin crew.` : `They pay ${pctLabel(paid.pct / paid.n)} more for each extra cabin crew member, from ${paid.n}.`}</span>
          </span>
          <Toggle on={on} onChange={(v) => onChange({ cabin: v ? Math.max(x.cabin, paid.n) : Math.max(req, Math.min(x.cabin, paid.n - 1)), pilot: x.pilot })} label="Client-paid extra cabin crew" />
        </div>
      )}
    </div>
  );
}

function posLine(r: FeasibilityReport): string {
  const legs = r.positionIn;
  if (!legs.length) return 'On site, no positioning';
  const min = legs.reduce((s, l) => s + l.sta - l.std, 0);
  return `+${fmtDuration(min, true)} positioning from ${legs[0].from}${legs.length > 1 ? ` (${legs.length - 1} stop)` : ''}`;
}

function crewLine(r: FeasibilityReport): { text: string; tone: 'good' | 'warn' | 'bad' } {
  const short = Object.entries(r.crew.byRole).filter(([, v]) => v && v.short > 0);
  if (!short.length) return { text: `Crew OK (${r.crew.setsAvailable}/${r.crew.setsNeeded} sets)`, tone: 'good' };
  const list = short.map(([role, v]) => `${v!.short} ${role}`).join(', ');
  return { text: `Short ${list}${r.crew.firstShort ? ` from ${fmtDay(r.crew.firstShort)}` : ''}`, tone: 'warn' };
}

function AircraftRow({ g, r, on, onPick, billBH, lift = 1, offerId }: { g: GameState; r: FeasibilityReport; on: boolean; onPick: () => void; billBH: number; lift?: number; offerId: string }) {
  const ac = g.fleet[r.aircraftId];
  if (!ac) return null;
  // v0.6: the client-paid extra crew lifts the price (as on the Accept button); the extra crew's cost is already in estCost.
  const revenue = r.estRevenue * lift;
  const margin = r.estMargin + revenue - r.estRevenue;
  const crew = crewLine(r);
  // An aircraft that can't take the job leads with why (e.g. busy on another contract), not a positioning plan.
  const block = r.level === 'no' ? r.checks.find((c) => c.level === 'no') : undefined;
  return (
    <div className={`sc-feas ${on ? 'on' : ''} ${r.level}`}>
      <button className="sc-feas-head" onClick={onPick} aria-expanded={on}>
        <Dot tone={LEVEL_TONE[r.level]} />
        <span className="col gap-4 grow">
          <span className="row gap-8"><b className="mono">{ac.reg}</b><span className="small muted">{typeOf(ac.typeId).short} · {ac.cabin.label}</span></span>
          {block ? <span className="small bad ellipsis">{block.label}</span> : <span className="small muted ellipsis">{posLine(r)}</span>}
          <span className={`small ${crew.tone}`}>{crew.text}</span>
        </span>
        <span className="right">
          <b className={`num ${block ? 'dim' : margin >= 0 ? 'good' : 'bad'}`}>{money(margin)}</b>
          <span className="tiny dim">contribution</span>
        </span>
      </button>
      {on && (
        <div className="sc-feas-checks">
          {r.checks.map((c) => (
            <div key={c.id} className="sc-check">
              <Dot tone={LEVEL_TONE[c.level]} />
              <span className="grow"><span>{c.label}</span>{c.detail && <span className="small muted"> · {c.detail}</span>}</span>
              {c.action?.kind === 'refit' && <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'refit', aircraftId: r.aircraftId, layout: c.action!.layout, offerId })}>Plan refit…</button>}
            </div>
          ))}
          {r.techStops.length > 0 && <div className="small muted">Fuel stops: {r.techStops.join(', ')}</div>}
          <div className="small muted">Revenue {money(revenue)}{lift > 1 ? ` (incl. client-paid extra crew +${money(revenue - r.estRevenue)})` : ''} · costs {money(r.estCost)} · {Math.round(r.estBH)} BH flown{r.estBH - billBH > 0.5 ? ` (incl. ${Math.round(r.estBH - billBH)} BH positioning and empty legs)` : ''}</div>
          {Object.entries(r.crew.byRole).some(([, v]) => v && v.short > 0) && (
            <div className="small warn">Hire or move crew: {Object.entries(r.crew.byRole).filter(([, v]) => v && v.short > 0).map(([role, v]) => `${v!.short} × ${ROLE_LABEL[role as keyof typeof ROLE_LABEL].toLowerCase()}`).join(', ')}.</div>
          )}
        </div>
      )}
    </div>
  );
}

/** v0.5.2 counter state in the footer: pending (clock paused, reply time), refused, met halfway or accepted. */
function CounterStatus({ g, o, cv, fmtP }: { g: GameState; o: ContractOffer; cv: CounterView; fmtP: (v: number) => string }) {
  const client = g.clients[o.clientId]?.name ?? 'The client';
  const when = (t: number) => `${fmtDay(t)} ${fmtTime(t)} UTC`;
  const [head, sub, tone] =
    cv.state === 'pending'
      ? [`Counter ${fmtP(cv.price)} sent`, `${client} replies by ${when(cv.replyBy ?? g.now)}. The offer's clock is paused until then.`, 'accent']
      : cv.state === 'halfway'
        ? [`${client} met us halfway: ${fmtP(cv.asking)}`, `We asked ${fmtP(cv.price)}. Accept by ${when(o.expires)} or let it go; no second counter.`, 'warn']
        : cv.state === 'refused'
          ? [`Counter ${fmtP(cv.price)} refused`, `The asking price stands until ${when(o.expires)}.`, 'muted']
          : [`Counter ${fmtP(cv.price)} accepted`, 'The contract is signed.', 'good'];
  return (
    <span className={`col sc-counter-state ${cv.state}`}>
      <b className={`small ${tone}`}>{head}</b>
      <span className="tiny muted">{sub}</span>
    </span>
  );
}

export function OfferModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const o = g.offers[offerId];
  const rev = flightsRev(g);
  const [paintOn, setPaintOn] = useState(true);
  const [extra, setExtra] = useState<CrewExtra | null>(null);
  const paint = !!o?.paint && paintOn;
  const reports = useMemo(() => (o ? feasibilityAll(g, o.id, { paint, crewExtra: extra ?? undefined }) : []), [g, o, rev, g.now, paint, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  // Paint off on a required offer: only a counter is possible, so its 'paint' row does not block the pick.
  const blocked = (r: FeasibilityReport) => r.checks.some((c) => c.level === 'no' && !(c.id === 'paint' && !paint));
  const best = reports.find((r) => !blocked(r)) ?? reports[0];
  const [pick, setPick] = useState<string | null>(null);
  const [step, setStep] = useState(2);
  if (!o) return null;
  const sel = reports.find((r) => r.aircraftId === (pick ?? best?.aircraftId));
  const cl = g.clients[o.clientId];
  const live = o.status === 'open' || o.status === 'countered';
  const countered = o.status === 'countered';
  const cv = counterView(g, o.id);
  const asking = askingPrice(o.paint && !paintOn ? paintQuote(o, false) : o);
  const mustPaint = !!o.paint?.required && !paintOn;
  const steps = counterSteps(asking, o.product.kind === 'wet');
  const price = steps[step - 1] ?? asking;
  const fmtP = (v: number) => (o.product.kind === 'wet' ? `${usd(v)}/BH` : money(v, 2));
  // v0.6: extra crew for this contract; the client's paid option raises the price when met (applied at signing).
  const crewed = o.product.kind !== 'dry';
  const x = extra ?? offerExtra(g, sel?.aircraftId ?? null, o.requirements);
  const paid = o.requirements.extraCabinPaid;
  const lift = crewed && paid && x.cabin >= paid.n ? 1 + paid.pct : 1;
  const opts = { paint, crewExtra: crewed ? x : undefined };
  const canCounter = live && !countered && !o.counter && !!sel && !blocked(sel);
  const canAccept = live && !countered && !!sel && !blocked(sel) && !mustPaint;

  const accept = () => {
    if (!sel) return;
    const res = store.act((gg) => acceptOffer(gg, o.id, [sel.aircraftId], opts));
    if (res.ok) {
      store.closeModal();
      if (store.nav.tab === 'contracts' && res.data) store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id: res.data.contractId } });
    }
  };
  const counter = () => {
    if (!sel) return;
    const res = store.act((gg) => counterOffer(gg, o.id, price, [sel.aircraftId], opts));
    if (res.ok) store.closeModal();
  };
  const decline = () => {
    store.act((gg) => declineOffer(gg, o.id), { toastOk: false });
    store.closeModal();
  };

  return (
    <Modal size="xwide" className="sc-offer-modal" icon={<ArchIcon a={o.archetype} />} title={o.title} onClose={() => store.closeModal()} footer={
      <div className="sc-offer-foot">
        <button className="btn btn-ghost" onClick={decline} disabled={!live}><X /> Decline</button>
        <span className="grow" />
        {cv ? (
          <CounterStatus g={g} o={o} cv={cv} fmtP={fmtP} />
        ) : (
          <span className="row gap-8 sc-counter">
            <Stepper value={step} min={1} max={8} onChange={setStep} format={(v) => <span className="num">{fmtP(steps[v - 1] * lift)} <span className="dim">+{(v * 2.5).toFixed(1)}%</span></span>} />
            <button className="btn" onClick={counter} disabled={!canCounter}>Counter</button>
          </span>
        )}
        <button className="btn btn-primary" onClick={accept} disabled={!canAccept} title={mustPaint ? 'The client requires their livery: counter instead' : undefined}><Check /> Accept {fmtP(asking * lift)}</button>
      </div>
    }>
      <div className="sc-offer-cols">
        <div className="sc-offer-left col gap-12">
          <div className="row gap-8 wrap">
            <span className="upper dim">{archLabel(o)}</span>
            {o.urgency !== 'normal' && <span className={`badge ${o.urgency === 'urgent' ? 'bad' : 'warn'}`}>{o.urgency === 'urgent' ? 'Urgent' : 'Short notice'}</span>}
            {cv?.state === 'pending' ? (
              <span className="small accent">Clock paused · reply by {fmtDay(cv.replyBy ?? g.now)} {fmtTime(cv.replyBy ?? g.now)} UTC</span>
            ) : (
              <span className="small muted">{expiryLabel(g.now, o.expires)}</span>
            )}
          </div>
          <div>
            <b>{cl ? `${flag(cl.country)} ${cl.name}` : 'Client'}</b>
            {o.broker && <span className="chip sc-chip sc-broker">via {o.broker} (5%)</span>}
            <div className="small muted mono">{routeSummary(o.pattern)}</div>
          </div>
          <p className="muted sc-blurb">{o.paint ? o.blurb.replace(paintTermsText(o.paint), '').trim() : o.blurb}</p>
          <Chips chips={[...reqChips(o.requirements), ...riskChips(o.risk), ...effectChips(o)]} />
          {o.paint && <PaintTermsCard g={g} o={o} typeId={artFor(sel ? g.fleet[sel.aircraftId]?.typeId ?? 'a320ceo' : 'a320ceo')} on={paintOn} onToggle={setPaintOn} fmtP={fmtP} />}
          {crewed && <ExtraCrewCard o={o} x={x} onChange={setExtra} fmtP={fmtP} asking={asking} />}
          <div className="upper dim">Terms</div>
          <Terms g={g} o={o} />
          <div className="upper dim">Programme</div>
          <Programme o={o} />
        </div>
        <div className="sc-offer-right col gap-8">
          <div className="upper dim">Choose an aircraft</div>
          {!reports.length && <div className="small muted">No aircraft in the fleet.</div>}
          {reports.map((r) => (
            <AircraftRow key={r.aircraftId} g={g} r={r} on={sel?.aircraftId === r.aircraftId} onPick={() => setPick(r.aircraftId)} billBH={o.estBH} lift={lift} offerId={o.id} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
