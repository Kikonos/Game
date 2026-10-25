// Offer review (B5): terms, schedule and effects on the left; per-aircraft feasibility (traffic lights,
// positioning, crew capacity, contribution) on the right; Decline / Counter / Accept. DESIGN.md §6.3.

import { SchedulePortal } from './OfferPortal';
import { BedDouble, Check, ChevronRight, LineChart, Palette, Scale, Sofa, Swords, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Term } from '../components/Term';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flag } from '../../data/countries';
import { artFor } from '../../data/acmiTypes';
import {
  acceptOffer, askingPrice, cabinQuote, cabinTarget, counterOffer, counterView, declineOffer, deportationCleanHit, feasibilityAll, leadDays, markOfferSeen, offerClientLine, offerCompetition,
  offerRestLine, paintQuote, paintTermsText, termsProduct, type FeasibilityReport,
} from '../../engine/contracts';
import { mixedCrewFlavour, mixedCrewText } from '../../engine/crew';
import { problemFor } from '../../engine/problems';
import { LevelPill } from '../screens/Clients';
import { dryMoney, ourCabin } from '../screens/v08Logic';
import { SeatStrip } from './v08Bits';
import { clientCode, clientLivery, clientTitles, restRefitOptions } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import type { ContractOffer, CrewExtra, GameState } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { extraCabinMax, offerExtra } from '../../engine/crew';
import { cabinCrewSeats, cabinMinimum } from '../../engine/core/perf';
import type { CounterView } from '../../engine/contracts';
import { problemAt } from '../../engine/problems';
import { ProblemCardView, runAction } from '../components/ProblemCard';
import { Modal, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { ArchIcon, Chips, Dot, KV } from '../screens/common';
import { archLabel, counterSteps, expiryLabel, offerCrewLine, pctLabel, reqChips, riskChips, routeSummary, offerDays, v09Chips, type Chip } from '../screens/screenLogic';
import { analystView } from '../../engine/ops';
import { ScreenHint } from '../components/ScreenHint';
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
  // A dry lease bills no block hours (rent and reserves only).
  rows.push(['Estimate', p.kind === 'dry' ? money(o.estValue) : `Billable ≈ ${Math.round(o.estBH)} BH · ${money(o.estValue)}`]);
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
        {cl && <AircraftArt typeId={typeId} livery={clientLivery(cl, t.kind)} code={clientCode(cl)} name={clientTitles(cl)} detail="full" />}
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

/** v0.7.4 client cabin request: the layout they want, the quick reconfiguration before the start, who pays, on/off when optional. */
function CabinTermsCard({ g, o, aircraftId, on, onToggle, fmtP }: { g: GameState; o: ContractOffer; aircraftId: string | null; on: boolean; onToggle: (v: boolean) => void; fmtP: (v: number) => string }) {
  const t = o.cabin!;
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  const target = ac ? cabinTarget(ac.typeId, t.layout) : null;
  const q = ac ? cabinQuote(t, ac.typeId, ac.cabin.layout) : null;
  const ours = q ? q.cost + q.back - q.reimbursed : 0;
  const offPrice = askingPrice({ product: termsProduct(o, { cabin: false }) });
  const words = t.layout === 'two-class' ? 'Business and economy (two-class)' : t.layout === 'all-economy' ? 'All economy' : t.layout;
  return (
    <div className={`sc-paint-card ${t.required ? 'required' : ''}`}>
      <div className="row gap-8 between">
        <span className="row gap-8"><Sofa className="sc-ico-s accent" /><b><Term id="clientCabin">Their cabin</Term> for the contract</b></span>
        <span className={`badge ${t.required ? 'warn' : 'info'}`}>{t.required ? 'Required' : 'Optional'}</span>
      </div>
      <KV rows={[
        ['Cabin', `${words}${target ? ` · ${target.label}` : ''}${ac ? (target && ac.cabin.label === target.label ? ` · ${ac.reg} already has it` : ` · ${ac.reg} is ${ac.cabin.label} now`) : ''}`],
        ['Work', q && q.days ? `Quick reconfiguration · ${q.days * 24} h in our hangar before the start${t.revert ? '; put back after' : ''}` : q ? 'Nothing to change' : `Quick reconfiguration · about ${t.days * 24} h`],
        ['Who pays', `${t.clientShare >= 1 ? 'They pay all of it' : 'They pay half'}${t.revert ? ' (also putting it back)' : ''}${q && q.cost ? ` · ${money(q.cost + q.back)}${ours > 0 ? `, our share ${money(ours)}` : ''}` : ''}`],
      ]} />
      {!t.required && (
        <div className="set-row sc-paint-toggle">
          <div>
            <b>Fit their cabin</b>
            <div className="tiny dim">{on ? `Accept at ${fmtP(askingPrice(o))}.` : `Without it: ${fmtP(offPrice)} (−${Math.round(t.declinePct * 100)}%).`}</div>
          </div>
          <Toggle on={on} onChange={onToggle} label="Fit the client's cabin" />
        </div>
      )}
    </div>
  );
}

/** v0.10 the chosen aircraft's cabin crew minimum and crew seats, in one line (crew beyond the seats take passenger seats). */
function crewSeatsNote(g: GameState, aircraftId: string | null, req: number): string | undefined {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  if (!ac) return undefined;
  const min = cabinMinimum(ac.typeId, ac.cabin.total), seats = cabinCrewSeats(ac.typeId);
  const over = min + req - seats;
  return `${ac.reg}: ${min} cabin crew minimum for ${ac.cabin.total} seats, ${seats} crew seats${over > 0 ? `; ${over} crew in passenger seats` : ''}.`;
}

/** v0.6: extra crew for this contract (default: the aircraft's or the company's) and the client's paid option. */
function ExtraCrewCard({ o, x, onChange, fmtP, asking, max, seatsNote }: { o: ContractOffer; x: CrewExtra; onChange: (x: CrewExtra) => void; fmtP: (v: number) => string; asking: number; max: number; seatsNote?: string }) {
  const req = o.requirements.extraCabin;
  const paid = o.requirements.extraCabinPaid;
  const on = !!paid && x.cabin >= paid.n;
  return (
    <div className={`sc-extra-card ${on ? 'paid' : ''}`}>
      <div className="row between gap-8">
        <span className="col"><b>Extra cabin crew</b><span className="tiny dim">{req ? `The client requires +${req}. ` : ''}Above the legal minimum: more salaries and per diems, better morale and service.{seatsNote ? ` ${seatsNote}` : ''}</span></span>
        <Stepper value={x.cabin} min={req} max={Math.max(req, max, paid && x.cabin >= paid.n ? x.cabin : 0)} onChange={(v) => onChange({ cabin: v, pilot: x.pilot })} format={(v) => `+${v}`} />
      </div>
      <div className="row between gap-8">
        <span className="col"><b className="small">Spare pilot</b><span className="tiny dim">Covers a sick call away from base; no extra duty time.</span></span>
        <Toggle on={!!x.pilot} onChange={(v) => onChange({ cabin: x.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" />
      </div>
      {paid && (
        <div className="row between gap-8 sc-extra-paid">
          <span className="col">
            <b className="small">Fly +{paid.n} cabin crew · client pays +{pctLabel(paid.pct)} (+{o.product.kind === 'wet' ? `${fmtP(Math.round(asking * paid.pct))}` : money(asking * paid.pct)})</b>
            {/* v0.9 §V: off, the bold line, the offer text and its chip already give the rate. */}
            {on && <span className="tiny dim">{`Accept at ${fmtP(asking * (1 + paid.pct))}. The contract keeps at least ${paid.n} extra cabin crew.`}</span>}
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

function AircraftRow({ g, r, on, onPick, billBH, lift = 1, offerId, long, portal }: { g: GameState; r: FeasibilityReport; on: boolean; onPick: () => void; billBH: number; lift?: number; offerId: string; long: boolean; portal?: ReactNode }) {
  const ac = g.fleet[r.aircraftId];
  if (!ac) return null;
  // v0.6: the client-paid extra crew lifts the price (as on the Accept button); the extra crew's cost is already in estCost.
  const revenue = r.estRevenue * lift;
  const margin = r.estMargin + revenue - r.estRevenue;
  const crew = offerCrewLine(r, g.offers[offerId]?.product.kind === 'dry');
  // An aircraft that can't take the job leads with why (e.g. busy on another contract), not a positioning plan.
  const block = r.level === 'no' ? r.checks.find((c) => c.level === 'no') : undefined;
  // v0.7.3 §2.6 item 6: the rest line on every aircraft of a long job (✓ / needs a 4th pilot / needs a refit), and on
  // any job where it is not simply OK.
  const rest = r.checks.find((c) => c.id === 'rest');
  // Round 4 (§V): not repeated in the row head while the open row shows the same check.
  const restShown = rest && rest !== block && !on && (long || rest.level !== 'ok') ? rest : undefined;
  // v0.9 §V a route this type can't fly has no runway or ETOPS verdict ('Runways fine (shortest 9,999 m)', 'No ETOPS needed'): hide them.
  const unflyable = r.checks.some((c) => (c.level === 'no' && (c.id === 'range' || c.id === 'runway')) || (c.id === 'runway' && /\b9,999 m\b/.test(c.label)));
  const openRest = (c: FeasibilityReport['checks'][number]) => store.openModal({ kind: 'refit', aircraftId: r.aircraftId, offerId, section: 'rest', restOption: c.action?.kind === 'restRefit' ? c.action.option : undefined });
  return (
    <div className={`sc-feas ${on ? 'on' : ''} ${r.level}`}>
      <button className="sc-feas-head" onClick={onPick} aria-expanded={on}>
        <Dot tone={LEVEL_TONE[r.level]} />
        <span className="col gap-4 grow">
          <span className="row gap-8"><b className="mono">{ac.reg}</b><span className="small muted">{typeOf(ac.typeId).short} · {ac.cabin.label}</span></span>
          {block ? <span className="small bad ellipsis">{block.label}</span> : <span className="small muted ellipsis">{posLine(r)}</span>}
          {/* Round 4 (§V): a blocked aircraft leads with its blocker; its crew line ('not checked') says nothing more. */}
          {!block && <span className={`small ${crew.tone}`}>{crew.text}</span>}
          {restShown && <span className={`small of-rest ${LEVEL_TONE[restShown.level]}`}><BedDouble />{restShown.label}</span>}
        </span>
        <span className="right">
          <b className={`num ${block ? 'dim' : margin >= 0 ? 'good' : 'bad'}`}>{money(margin)}</b>
          <span className="tiny dim">contribution</span>
        </span>
      </button>
      {portal}
      {on && (
        <div className="sc-feas-checks">
          {r.checks.filter((c) => !(unflyable && c.level === 'ok' && (c.id === 'runway' || (c.id === 'etops' && c.label === 'No ETOPS needed')))).map((c, i) => (
            <div key={`${c.id}-${i}`} className="sc-check">
              <Dot tone={LEVEL_TONE[c.level]} />
              <span className="grow"><span>{SLIP_RE.test(c.label) ? <Term id="slipCrew">{c.label}</Term> : c.label}</span>{c.detail && <span className="small muted"> · {c.detail}</span>}</span>
              {c.action?.kind === 'refit' && <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'refit', aircraftId: r.aircraftId, layout: c.action!.layout, offerId })}>Plan refit…</button>}
              {/* v0.7.3 §2.9: the cheapest crew rest refit that makes the job legal; the seats check offers the section too. */}
              {c.action?.kind === 'restRefit' && <button className="btn btn-sm" onClick={() => openRest(c)}>Plan a refit…</button>}
              {!c.action && c.level !== 'ok' && (c.id === 'restSeats' || c.id === 'rest') && restRefitOptions(g, r.aircraftId).some((x) => x.ok) && <button className="btn btn-sm" onClick={() => openRest(c)}>Crew rest refits…</button>}
            </div>
          ))}
          {r.techStops.length > 0 && <div className="small muted">Fuel stops: {r.techStops.join(', ')}</div>}
          <div className="small muted">Revenue {money(revenue)}{lift > 1 ? ` (incl. client-paid extra crew +${money(revenue - r.estRevenue)})` : ''} · costs {money(r.estCost)} · {Math.round(r.estBH)} BH flown{r.estBH - billBH > 0.5 ? ` (incl. ${Math.round(r.estBH - billBH)} BH positioning and empty legs)` : ''}</div>
          {/* Round 4 (§V): the crew check line above already says the shortage; no footer repeats it. */}
        </div>
      )}
    </div>
  );
}

// ---------- v0.8 blocks (UPDATE-0.8.md §1.8, §2, §3.3, §6.4, §7.2) ----------

/** The client block: level pill, the perks that apply to this offer, the way to the next level; Unhappy: the card. */
function ClientBlock({ g, o }: { g: GameState; o: ContractOffer }) {
  const line = offerClientLine(g, o.id);
  const cl = g.clients[o.clientId];
  if (!line || !cl) return null;
  const card = line.level === 'unhappy' ? problemFor(g, { kind: 'clientUnhappy', ref: { kind: 'client', id: cl.id } }) : null;
  return (
    <div className="v8-box v8-client-block">
      <div className="row gap-8 between">
        <span className="row gap-8" style={{ minWidth: 0 }}><Users className="sc-ico-s accent" /><b className="ellipsis">{cl.name}</b><LevelPill level={line.level} /></span>
        <button className="btn btn-ghost btn-sm" onClick={() => store.openModal({ kind: 'client', clientId: cl.id })}>Client <ChevronRight /></button>
      </div>
      {line.lines.length > 0 && <ul className="v8-lines">{line.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <div className="small dim">{line.progress}</div>
      {card && <ProblemCardView card={card} g={g} hideActions />}
    </div>
  );
}

/** 'Avion Express (Low fares) is also quoting; they usually decide fast.' Never the exact time. */
function CompetitionLine({ g, o }: { g: GameState; o: ContractOffer }) {
  const c = offerCompetition(g, o.id);
  if (!c.text) return null;
  const tone = o.firstRefusal ? 'good' : c.level === 'strong' ? 'warn' : 'muted';
  return (
    <div className={`v8-comp small ${tone}`}>
      <Swords className="sc-ico-s" /><span className="grow">{c.text}</span>
      {c.rivalId && <button className="btn btn-ghost btn-sm" onClick={() => store.openModal({ kind: 'rival', rivalId: c.rivalId! })}>Rival <ChevronRight /></button>}
    </div>
  );
}

/** Deportation: the moral panel (well paid; crews and reputation pay too). No extra confirm. */
function MoralPanel({ o }: { o: ContractOffer }) {
  const hit = deportationCleanHit(o);
  const D = BAL.v08.deport;
  return (
    <div className="v8-panel v8-moral">
      <div className="row gap-8"><Scale className="sc-ico-s warn" /><b>A moral choice</b></div>
      <ul className="v8-lines">
        <li>Well paid: +{Math.round(BAL.premium.deportation * 100)} %.</li>
        <li>Crews dislike it: morale −{Math.abs(D.morale)} for everyone who flies it; crew under {D.refuseBelow} morale refuse.</li>
        <li>The press may notice: clean −{Math.abs(D.cleanPerLeg)} a flight (this one: about −{Math.abs(hit)}).</li>
        <li>Clients who care (sports clubs, corporate and aid clients) will call less while clean is under 60.</li>
      </ul>
    </div>
  );
}

/** Hajj: the two phases (the gap around the Day of Arafah is free) and the empty legs. */
function HajjPanel({ o }: { o: ContractOffer }) {
  const t = o.terms ?? [];
  const legs = o.pattern.kind === 'legs' ? o.pattern.legs : [];
  const empty = legs.filter((l) => !l.pax).length;
  return (
    <div className="v8-panel">
      <b>Hajj airlift</b>
      {t.length >= 2 && <div className="small">In: {fmtDay(t[0][0])} – {fmtDay(t[0][1])} · home: {fmtDay(t[1][0])} – {fmtDay(t[1][1])}. The days around the Day of Arafah are free.</div>}
      <div className="small muted">{empty ? `${empty} of ${legs.length} legs fly empty` : 'Every other leg flies empty'}; the client pays those hours too. Max-seat cabin, no alcohol on board.</div>
    </div>
  );
}

/** Dry lease: ferry out · lease · ferry back (static), the money, their hours on our airframe, and the card. */
function DryPanel({ g, o }: { g: GameState; o: ContractOffer }) {
  const m = dryMoney(o);
  if (!m || !o.dry) return null;
  const card = problemFor(g, { kind: 'dryLeaseInfo', ref: { kind: 'offer', id: o.id } });
  const site = AIRPORT_BY_CODE[o.dry.site]?.city ?? o.dry.site;
  return (
    <div className="v8-panel">
      <b>Dry lease: aircraft only</b>
      <div className="v8-dry-line" role="img" aria-label="Ferry out, lease, ferry back">
        <span className="v8-dry-seg ferry">Ferry out</span>
        <span className="v8-dry-seg lease">{m.months} months at {site}</span>
        <span className="v8-dry-seg ferry">Ferry back</span>
      </div>
      <div className="row between tiny dim"><span>{fmtDay(o.start)}</span><span>{fmtDay(o.end)}</span></div>
      <KV rows={[
        ['Rent', `${money(m.rent / m.months)} × ${m.months} months = ${money(m.rent)}`],
        ['Reserves', `${usd((o.product as { reservesPerFH: number }).reservesPerFH)} per FH × about ${m.fh.toLocaleString('en-US')} FH = ${money(m.reserves)}`],
        ['Deposit', `${money(m.deposit)} in at signing, back at the return less any damage`],
        ...(m.consent ? [['Lessor consent', `${money(m.consent)} at signing (sub-lease)`] as [string, string]] : []),
        ['Their hours', `About ${m.fh.toLocaleString('en-US')} FH on our airframe; line and A-checks are theirs, the C-check stays ours`],
        ...(o.dry.paint ? [['Paint', `In their colours (${o.dry.paint === 'full' ? 'full repaint' : 'decals'}), at their cost`] as [string, string]] : []),
      ]} />
      <div className="small muted">Our pilots fly the delivery and the return ferries (we pay that fuel); no crew from us during the lease.</div>
      {card && <ProblemCardView card={card} g={g} hideActions />}
    </div>
  );
}

/** Mixed crew: one square per cabin seat (ours with roles, theirs grey), the sentence and the flavour. */
function MixedPanel({ g, o }: { g: GameState; o: ContractOffer }) {
  const cc = o.requirements.clientCabin;
  const text = mixedCrewText(g, o.id);
  if (!cc || !text) return null;
  const name = g.clients[o.clientId]?.name ?? 'Client';
  return (
    <div className="v8-panel">
      <b>Mixed cabin crew</b>
      <SeatStrip ours={ourCabin(cc)} theirs={cc.leads ? ['PUR', ...Array.from({ length: cc.n - 1 }, () => 'CC' as const)] : Array.from({ length: cc.n }, () => 'CC' as const)} client={name} />
      <div className="small">{text}</div>
      {mixedCrewFlavour(g, o.id).map((l) => <div key={l} className="small dim">{l}</div>)}
    </div>
  );
}

/** Whether the offer has an archetype panel (its 'mission' line is then in the panel's words). */
const hasPanel = (o: ContractOffer) => o.product.kind === 'dry' || o.archetype === 'deportation' || o.archetype === 'hajj' || !!o.requirements.clientCabin?.n;

/** The archetype panel that applies (a mixed cabin can come on top of a Hajj airlift). */
function ArchPanel({ g, o }: { g: GameState; o: ContractOffer }) {
  if (o.product.kind === 'dry') return <DryPanel g={g} o={o} />;
  if (o.archetype === 'deportation') return <MoralPanel o={o} />;
  const mixed = o.requirements.clientCabin?.n ? <MixedPanel g={g} o={o} /> : null;
  if (o.archetype === 'hajj') return <>{<HajjPanel o={o} />}{mixed}</>;
  return mixed;
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

/** The blurb without the paint and cabin lines (they have their own cards). */
const blurbOf = (o: ContractOffer) => {
  let b = o.blurb;
  if (o.paint) b = b.replace(paintTermsText(o.paint), '');
  // Only the cabin sentence (cabinTermsText: one sentence, no inner full stop); later lines stay.
  if (o.cabin) b = b.replace(/ They want (an all-economy|a two-class|a three-class|a VIP) cabin[^.]*\./, '');
  return b.trim();
};

const SLIP_RE = /^Crew change at /;

/**
 * v0.9 §5.5 the commercial analyst's block (hired and on): score, verdict lines and 'Use $1.24M', which sets the counter
 * to the nearest step at or above the suggestion.
 */
function AnalystBlock({ g, offerId, fmtP, steps, lift, onUse }: { g: GameState; offerId: string; fmtP: (v: number) => string; steps: number[]; lift: number; onUse?: (step: number) => void }) {
  const hour = Math.floor(g.now / 60);
  const av = useMemo(() => analystView(g, offerId), [g, offerId, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!av) return null;
  const k = av.counter !== null ? steps.findIndex((x) => x >= av.counter! - 1) : -1;
  const step = av.counter === null || av.verdict !== 'counter' ? null : (k < 0 ? steps.length : k + 1);
  const tone = av.verdict === 'pass' ? 'bad' : av.verdict === 'take' ? 'good' : av.verdict === 'busy' ? 'off' : 'warn';
  // The verdict names the price the button fills (snapped to a counter step, paid cabin included).
  const use = step !== null ? fmtP(steps[step - 1] * lift) : null;
  const lines = use ? av.lines.map((l, i) => (i ? l : l.replace(/^Counter at [^:]+:/, `Counter at ${use}:`))) : av.lines;
  return (
    <div className="v8-box v9-analyst">
      <div className="row gap-8">
        <LineChart className="sc-ico-s accent" />
        <b className="grow">Analyst · {av.name}</b>
        <span className={`v9-score ${tone}`}>{av.verdict === 'busy' ? '—' : av.score}</span>
      </div>
      {lines.map((l, i) => <span key={i} className={`small ${i ? 'muted' : ''}`}>{l}</span>)}
      {step !== null && onUse && <button className="btn btn-sm v9-use" onClick={() => onUse(step)}>Use {use}</button>}
    </div>
  );
}

export function OfferModal({ offerId }: { offerId: string }) {
  const g = useGame();
  const o = g.offers[offerId];
  const rev = flightsRev(g);
  const [paintOn, setPaintOn] = useState(true);
  const [cabinOn, setCabinOn] = useState(true);
  const [extra, setExtra] = useState<CrewExtra | null>(null);
  const paint = !!o?.paint && paintOn;
  const cabin = !!o?.cabin && (cabinOn || o.cabin.required);
  const reports = useMemo(() => (o ? feasibilityAll(g, o.id, { paint, cabin, crewExtra: extra ?? undefined }) : []), [g, o, rev, g.now, paint, cabin, extra]); // eslint-disable-line react-hooks/exhaustive-deps
  // Paint off on a required offer: only a counter is possible, so its 'paint' row does not block the pick.
  const blocked = (r: FeasibilityReport) => r.checks.some((c) => c.level === 'no' && !(c.id === 'paint' && !paint));
  const best = reports.find((r) => !blocked(r)) ?? reports[0];
  const [pick, setPick] = useState<string | null>(null);
  const [step, setStep] = useState(2);
  // v0.8: opened = seen (a rival win is then announced in the Inbox).
  useEffect(() => {
    if (store.game?.offers[offerId] && !store.game.offers[offerId].seen) store.update((gg) => markOfferSeen(gg, offerId));
  }, [offerId]);
  if (!o) return null;
  const sel = reports.find((r) => r.aircraftId === (pick ?? best?.aircraftId));
  const cl = g.clients[o.clientId];
  const live = o.status === 'open' || o.status === 'countered';
  const countered = o.status === 'countered';
  const cv = counterView(g, o.id);
  const asking = askingPrice((o.paint && !paintOn) || (o.cabin && !cabin) ? { product: termsProduct(o, { paint: paintOn, cabin }) } : o);
  const mustPaint = !!o.paint?.required && !paintOn;
  const steps = counterSteps(asking, o.product.kind === 'wet');
  const price = steps[step - 1] ?? asking;
  const fmtP = (v: number) => (o.product.kind === 'wet' ? `${usd(v)}/BH` : o.product.kind === 'dry' ? `${money(v)}/month` : money(v, 2));
  // v0.6: extra crew for this contract; the client's paid option raises the price when met (applied at signing).
  const crewed = o.product.kind !== 'dry';
  const x = extra ?? offerExtra(g, sel?.aircraftId ?? null, o.requirements);
  const paid = o.requirements.extraCabinPaid;
  const lift = crewed && paid && x.cabin >= paid.n ? 1 + paid.pct : 1;
  const opts = { paint, cabin, crewExtra: crewed ? x : undefined };
  const canCounter = live && !countered && !o.counter && !!sel && !blocked(sel);
  const canAccept = live && !countered && !!sel && !blocked(sel) && !mustPaint;
  // v0.7.1 §13: one plain sentence on what is in the way (crew, aircraft, range, cabin, paint) or a counter about to expire.
  const fit0 = live ? problemAt(g, { kind: 'offer', id: o.id }) : null;
  // The moral / dry / Hajj / mixed panel already says the mission line: no second card when it is all the card says.
  const missionOnly = (c: NonNullable<typeof fit0>) => c.subject.kind === 'offerFit' && c.severity !== 'red' && hasPanel(o) && c.details.length === 1
    && reports.some((r) => r.checks.some((k) => k.id === 'mission' && c.details[0].startsWith(k.label)));
  const fit = fit0 && !missionOnly(fit0) ? fit0 : null;
  // v0.7.3 §2.9: what a long job needs ('Longest day 15:40 · needs 3 pilots + bunks, or 4 pilots + business seats').
  const restLine = offerRestLine(g, o.id);

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
      <ScreenHint id="offer" />
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
          <p className="muted sc-blurb">{blurbOf(o)}</p>
          <Chips chips={[...v09Chips(o), ...reqChips(o.requirements, o.pattern), ...riskChips(o.risk), ...effectChips(o)]} />
          <AnalystBlock g={g} offerId={o.id} fmtP={fmtP} steps={steps} lift={lift} onUse={live && !countered && !o.counter ? setStep : undefined} />
          {live && <CompetitionLine g={g} o={o} />}
          <ArchPanel g={g} o={o} />
          {sel && !hasPanel(o) && (() => {
            const mission = sel.checks.find((c) => c.id === 'mission');
            return mission ? <div className={`small v8-mission ${LEVEL_TONE[mission.level]}`}><Dot tone={LEVEL_TONE[mission.level]} /><span>{mission.label}{mission.detail ? ` · ${mission.detail}` : ''}</span></div> : null;
          })()}
          {fit && <ProblemCardView card={{ ...fit, actions: fit.actions.filter((a) => a.id !== 'review') }} g={g} hideActions={fit.actions.every((a) => a.id === 'review')} onAction={(a) => runAction(g, a)} />}
          {o.paint && <PaintTermsCard g={g} o={o} typeId={sel && g.fleet[sel.aircraftId] ? artFor(g.fleet[sel.aircraftId].typeId, g.fleet[sel.aircraftId].variant) : 'a320ceo'} on={paintOn} onToggle={setPaintOn} fmtP={fmtP} />}
          {o.cabin && <CabinTermsCard g={g} o={o} aircraftId={sel?.aircraftId ?? null} on={cabinOn} onToggle={setCabinOn} fmtP={fmtP} />}
          {crewed && <ExtraCrewCard o={o} x={x} onChange={setExtra} fmtP={fmtP} asking={asking} max={extraCabinMax(g, sel?.aircraftId ?? null, o.requirements.extraCabin)} seatsNote={crewSeatsNote(g, sel?.aircraftId ?? null, o.requirements.extraCabin)} />}
          <div className="upper dim">Terms</div>
          <Terms g={g} o={o} />
          <ClientBlock g={g} o={o} />
          {/* A dry lease has no programme of ours: the dry panel shows ferry out · lease · ferry back. */}
          {o.product.kind !== 'dry' && <>
            <div className="upper dim">Programme</div>
            {restLine && <div className="small of-rest"><BedDouble /><span>{restLine}</span></div>}
            <Programme o={o} />
          </>}
        </div>
        <div className="sc-offer-right col gap-8">
          <div className="upper dim">Choose an aircraft</div>
          {!reports.length && <div className="small muted">No aircraft in the fleet.</div>}
          {reports.length > 0 && o.product.kind !== 'dry' && <div className="tiny dim v91-portal-hint">Under each aircraft, its schedule around this job (shaded). Tap a trip, or hold and drag it onto another aircraft, to move it.</div>}
          {reports.map((r) => (
            <AircraftRow key={r.aircraftId} g={g} r={r} on={sel?.aircraftId === r.aircraftId} onPick={() => setPick(r.aircraftId)} billBH={o.estBH} lift={lift} offerId={o.id} long={!!restLine}
              portal={o.product.kind !== 'dry' ? <SchedulePortal g={g} o={o} aircraftId={r.aircraftId} candidates={reports.map((x) => x.aircraftId)} /> : undefined} />
          ))}
        </div>
      </div>
    </Modal>
  );
}
