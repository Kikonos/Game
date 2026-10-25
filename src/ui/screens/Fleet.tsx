// Fleet (B5): aircraft cards (art, ownership, hours, A/C-check bars with Plan check, AOG risk). v0.7: a
// Fleet · Market switch (the scarce aircraft market, Market.tsx); cards add the delivery, the lease end
// (extend or return) and the cabin with refits. DESIGN.md §6.3, UPDATE-0.7.md §F6.7, §F7.5.

import { BadgeDollarSign, BedDouble, CalendarRange, HelpCircle, Lock, Palette, Plane, Sofa, TimerOff, Undo2, Wrench, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { artFor } from '../../data/acmiTypes';
import { enginesOf, variantOf } from '../../data/variants';
import { MRO_STATIONS } from '../../data/market';
import { cabinCrewSeats, cabinMinimum, typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, yearOf } from '../../engine/core/time';
import type { Aircraft, CrewExtra, GameState, LiveryRef, MaintenanceEvent } from '../../engine/core/types';
import { crewAlertKind, crewExtraQuote, extraCabinMax, restOf, setCrewExtra, shortFlights } from '../../engine/crew';
import { cancelCheck, checkStatus, deliveryStatus, dryLeaseOf, leastUsed, type LeastUsedRow, leaseView, paintStatus, restRefitOptions, setAircraftLivery } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { mapLivery } from '../map/mapLogic';
import { AircraftArt } from '../components/AircraftArt';
import { Why } from '../components/Why';
import { restRows } from '../components/RestLines';
import { Empty, Seg, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { spanLabel } from './screenLogic';
import { store, useGame } from '../store';
import { KV, ScreenHead, useRenderCount } from './common';
import { MarketView } from './Market';
import { capFirst, hangarWord, layoutLabel, limitTone, unseenOffers } from './screenLogic';
import { ScreenHint } from '../components/ScreenHint';

/** The type's ETOPS capability (what the engine checks) and whether the company holds an approval for it. */
function etopsLabel(g: GameState, ac: Aircraft): string {
  const t = typeOf(ac.typeId);
  const max = t.etopsMax;
  // v0.8 fix pack: four engines fly any ocean without ETOPS (the 747-400, A340, A380).
  if (t.engines === 4) return 'not needed (four engines)';
  if (!max) return 'not capable';
  const held = Math.max(0, ...g.company.approvals.map((a) => /^etops(\d+)$/.exec(a)).map((m) => (m ? Number(m[1]) : 0)));
  const usable = Math.min(max, held);
  return usable ? `${usable} min${usable < max ? ` (type capable of ${max})` : ''}` : `capable of ${max} min · needs approval (Company)`;
}

const STATUS: Record<Aircraft['status'], [string, string]> = {
  available: ['On ground', 'good'], flying: ['Flying', 'info'], maintenance: ['In check', 'warn'], aog: ['AOG', 'bad'],
  delivering: ['Delivering', 'accent'], stored: ['Stored', ''], leasedOut: ['Leased out', ''],
};

function safeCheck(g: GameState, ac: Aircraft) {
  try {
    return checkStatus(g, ac);
  } catch {
    return null;
  }
}

function CheckBar({ label, used, due, hoursLeft, next, onPlan, aircraftId }: { label: string; used: number; due: number; hoursLeft: number; next: string | null; onPlan: () => void; aircraftId: string }) {
  const tone = limitTone(used);
  const mx = useGame().maintenance;
  const nm = next ? mx[next] : undefined;
  return (
    <div className="sc-check-bar">
      <div className="row between small">
        <span className="row gap-8"><b>{label}</b> <span className="muted">{nm ? `booked ${fmtDay(nm.start)} at ${nm.at}` : `due ${fmtDay(due)}`}</span>{tone !== 'good' && !nm && <Why refs={{ kind: 'aircraft', id: aircraftId }} tone={tone} label={`${label}: why?`} />}</span>
        <span className="num dim">{Math.max(0, Math.round(hoursLeft))} FH left</span>
      </div>
      <div className="row gap-8">
        <div className={`bar grow ${tone}`}><span style={{ width: `${Math.min(100, used * 100)}%` }} /></div>
        <button className="btn btn-sm" onClick={onPlan}>{next ? 'Change' : 'Plan'}</button>
      </div>
    </div>
  );
}

type RefKind = 'company' | 'white' | 'custom';

/** Livery row: Company · All white · Custom (+ Edit), or why it is locked (client paint on or booked). */
function LiveryRow({ g, ac, out }: { g: GameState; ac: Aircraft; out?: boolean }) {
  const st = paintStatus(g, ac.id);
  const ref = ac.livery ?? 'company';
  const kind: RefKind = typeof ref === 'object' ? 'custom' : ref;
  const edit = () => store.openModal({ kind: 'livery', target: { aircraftId: ac.id } });
  const pick = (k: RefKind) => {
    if (k === kind) return;
    const next: LiveryRef = k === 'custom' ? { custom: structuredClone(g.company.livery) } : k;
    if (store.act((gg) => setAircraftLivery(gg, ac.id, next), { toastOk: false }).ok && k === 'custom') edit();
  };
  if (st.locked) {
    return (
      <div className="sc-ac-livery locked">
        <Lock className="sc-ico-s warn" />
        <span className="small grow">{st.why}</span>
        <button className="btn btn-sm" onClick={edit}><Palette /> View</button>
      </div>
    );
  }
  // Leased out: the lessee's paint rule applies; nothing to switch.
  if (out) return null;
  return (
    <div className="sc-ac-livery">
      <span className="upper dim">Livery</span>
      <Seg<RefKind> value={kind} onChange={pick} options={[{ value: 'company', label: 'Company' }, { value: 'white', label: 'All white' }, { value: 'custom', label: 'Custom' }]} />
      <button className="btn btn-sm" onClick={edit} aria-label={`Edit ${ac.reg} livery`}><Palette /> Edit</button>
    </div>
  );
}

/** v0.6: extra crew above the legal minimum on this aircraft (unset = company default), with the cost quote. */
function CrewExtraRow({ g, ac }: { g: GameState; ac: Aircraft }) {
  const x = ac.crewExtra ?? { cabin: g.company.policies.extraCabin, pilot: 0 as const };
  const q = crewExtraQuote(g, ac.id, x);
  // v0.10 no more optional cabin crew than the crew seats take
  const xMax = extraCabinMax(g, ac.id);
  const set = (v: CrewExtra | null) => store.act((gg) => setCrewExtra(gg, { aircraftId: ac.id }, v), { toastOk: false });
  const extra = x.cabin + x.pilot;
  const what = [x.cabin ? `+${x.cabin} cabin` : '', x.pilot ? 'spare pilot' : ''].filter(Boolean).join(' + ');
  return (
    <div className="sc-ac-crew">
      <div className="row between small">
        <span><span className="upper dim">Crew</span> <span className="muted">Legal minimum {q.minimum.pilots} pilots + {q.minimum.cabin} cabin · {cabinCrewSeats(ac.typeId)} cabin crew seats</span></span>
        {ac.crewExtra ? <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>Reset</button> : <span className="tiny dim">company default</span>}
      </div>
      <div className="row gap-12 wrap">
        <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={Math.min(x.cabin, xMax)} min={0} max={xMax} onChange={(v) => set({ cabin: v, pilot: x.pilot })} /></span>
        <span className="row gap-8"><span className="small">Spare pilot</span><Toggle on={!!x.pilot} onChange={(v) => set({ cabin: x.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" /></span>
      </div>
      <div className="tiny muted">{extra ? `${what} → +${q.extraPeople} people over ${Math.round(q.extraPeople / Math.max(1, extra))} crew sets · ≈ ${money(q.perMonth)}/month · Morale +${q.service > 0 ? ` · Service ${q.service >= 0.4 ? '++' : '+'}` : ''}` : 'Legal minimum only. Extra crew cost salaries and per diems but lift morale and service; a spare on board covers a sick call away from base.'}</div>
    </div>
  );
}

/** v0.7.2 §6.3 'Which one?': the one-line answer on the least used aircraft, with what to do about it. */
function LeastUsedLine({ g, ac, least, onClose }: { g: GameState; ac: Aircraft; least: LeastUsedRow; onClose: () => void }) {
  const lease = ac.ownership.kind === 'dryLeaseIn';
  return (
    <div className="fl-which">
      <div className="col grow" style={{ minWidth: 0 }}>
        <b className="small">The least used: {Math.round(least.bh90)} BH since {fmtDay((Math.floor(g.now / DAY) - least.days + 1) * DAY)} ({least.perDay.toFixed(1)} a day)</b>
        <span className="small muted">{lease ? 'Leased: handing it back early saves rent, for a fee.' : 'Owned: selling it brings cash in; signed work must be moved first.'}</span>
      </div>
      {lease
        ? <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'lease', aircraftId: ac.id, tab: 'early' })}><Undo2 /> Return early…</button>
        : <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'sell', aircraftId: ac.id })}><BadgeDollarSign /> Sell…</button>}
      <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X /></button>
    </div>
  );
}

/** v0.7.3 the crew rest refit a maintenance event fits, in a few words ('lower-deck crew rest module'). */
export const REST_FIT_LABEL: Record<NonNullable<MaintenanceEvent['restFit']>, string> = {
  curtainJ: 'Curtained business seats', recliners: 'Crew rest recliners', removeRecliners: 'Crew rest recliners removed',
  ldmcr: 'Crew bunks (pilots and cabin crew)', fcrc: 'Crew bunks (pilots and cabin crew)', overhead: 'Crew bunks (pilots and cabin crew)',
};

/** v0.8 a dry lease out: 'to TAAG until 30 Apr · 412 FH flown by them · next C-check after return'. */
function DryLeaseRow({ g, acId }: { g: GameState; acId: string }) {
  const v = dryLeaseOf(g, acId);
  if (!v) return null;
  const when = v.phase === 'signed' || v.phase === 'delivering' ? `delivery ${fmtDay(v.out[0])}, back ${fmtDay(v.lease[1])}` : `until ${fmtDay(v.lease[1])} · ${v.fhSoFar.toLocaleString('en-US')} FH flown by them`;
  return (
    <button className="fl-row small v8-fleet-lease" onClick={() => store.openModal({ kind: 'sheet', refs: [{ kind: 'contract', id: v.contractId }] })}>
      <span className="upper dim">Dry lease</span>
      <span className="col grow" style={{ minWidth: 0 }}><span>to {v.lessee} · {when}</span><span className="dim">{v.cCheck}</span></span>
    </button>
  );
}

function AircraftCard({ g, ac, sel, least, onLeastClose }: { g: GameState; ac: Aircraft; sel: boolean; least?: LeastUsedRow; onLeastClose: () => void }) {
  const t = typeOf(ac.typeId);
  const cs = safeCheck(g, ac);
  const [label0, tone] = STATUS[ac.status];
  // v0.8 fix pack: a cabin refit reads 'In refit', not 'In check'.
  const label = ac.status === 'maintenance' ? capFirst(hangarWord(g, ac)) : label0;
  const o = ac.ownership;
  const own: [string, string][] = o.kind === 'owned'
    ? [['Owned', `book value ${money(o.bookValue)}`]]
    : [['Lease', `${money(o.rentPerMonth)}/month`]];
  const ds = deliveryStatus(g, ac.id);
  const plan = (kind: 'A' | 'C') => store.openModal({ kind: 'check', aircraftId: ac.id, checkKind: kind, replace: (kind === 'A' ? cs?.nextA : cs?.nextC) ?? undefined });
  const lv = mapLivery(g, ac);
  // v0.8: leased out dry, the lessee flies, maintains (line and A-checks) and crews it.
  const out = ac.status === 'leasedOut';
  const lessee = out ? dryLeaseOf(g, ac.id)?.lessee ?? 'the lessee' : '';
  // v0.7.1 §3.12 / §10: the crew-shortage row and a WHY? beside a red/amber status (AOG, grounded, stuck delivery).
  const short = shortFlights(g).find((x) => g.flights[x.flightId]?.aircraftId === ac.id);
  const sf = short ? g.flights[short.flightId] : undefined;
  const acProblem = (ac.status === 'aog' || ac.status === 'delivering' || cs?.grounded) ? problemAt(g, { kind: 'aircraft', id: ac.id }) : null;
  return (
    <div className={`card sc-ac ${sel ? 'selected' : ''}`} data-ac={ac.id}>
      <div className="sc-ac-top">
        <div className="sc-ac-art"><AircraftArt typeId={artFor(ac.typeId, ac.variant)} livery={lv.livery} code={lv.code} name={lv.name} /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8">
            <b className="mono sc-ac-reg">{ac.reg}</b>
            <span className="sc-status-why"><span className={`badge ${tone}`}>{label}</span>{acProblem && <Why refs={{ kind: 'aircraft', id: ac.id }} tone={acProblem.severity === 'red' ? 'bad' : 'warn'} className="inline" />}</span>
            {!out && cs && cs.risk >= 0.5 && <span className={`badge ${cs.risk >= 0.9 ? 'bad' : 'warn'}`} data-tip="Chance of a technical fault grows with deferred defects and overdue checks">AOG risk</span>}
          </div>
          <div className="small muted ellipsis">{t.name} · {ac.cabin.label} · {yearOf(g.now) - ac.builtYear} years</div>
        </div>
      </div>
      {least && <LeastUsedLine g={g} ac={ac} least={least} onClose={onLeastClose} />}
      {ds && ds.phase !== 'home' && <div className={`fl-row small ${ds.phase === 'waiting' ? 'warn' : ''}`}><span className="upper dim">Delivery</span><span>{ds.text}</span></div>}
      <DryLeaseRow g={g} acId={ac.id} />
      {sf && short && (
        <div className="fl-row small cs-fleet">
          {crewAlertKind(g, sf.id) === 'hours'
            ? <span className={`cs-banner ${short.stage} row gap-4`}><TimerOff className="sc-ico-s" aria-hidden />CREW OUT OF HOURS</span>
            : <span className={`cs-banner ${short.stage}`}>CREW SHORTAGE</span>}
          <span className="ellipsis"><span className="mono">{sf.no}</span> {sf.from}→{sf.to} in {spanLabel(Math.max(0, sf.std - g.now))}</span>
          <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'crewControl', flightId: sf.id })}>Crew Control</button>
        </div>
      )}
      <LiveryRow g={g} ac={ac} out={out} />
      <LeaseRow g={g} ac={ac} />
      <CabinRow g={g} ac={ac} out={out} />
      <KV rows={[
        ...own,
        ['At', ac.status === 'delivering' ? (ds ? `handover at ${ds.site} ${fmtDay(ds.handover)}` : `arrives ${fmtDate(ac.deliveredAt)}`) : ac.at],
        ['Hours / cycles', `${Math.round(ac.hours).toLocaleString('en-US')} / ${Math.round(ac.cycles).toLocaleString('en-US')}`],
        ['ETOPS', etopsLabel(g, ac)],
        // v0.10 the airframe's engines (and the A321neo's exit layout, which sets its seat limit)
        ['Engines', enginesOf(ac.typeId, ac.variant)],
        ...(variantOf(ac.typeId, ac.variant)?.maxSeats ? [['Exits', `${variantOf(ac.typeId, ac.variant)!.label} · up to ${variantOf(ac.typeId, ac.variant)!.maxSeats} seats`] as [string, string]] : []),
        // v0.7.3 §2.6 item 1: pilots' and cabin crew's rest (every type) and the longest day it allows.
        ...restRows(g, restOf(g, ac.id), ac.typeId),
      ]} />
      {!out && <CrewExtraRow g={g} ac={ac} />}
      {cs ? (
        <div className="col gap-8">
          {out ? <div className="fl-row small"><span className="upper dim nowrap">A-check</span><span className="muted">Line and A-checks by {lessee} during the lease; no crew from us</span></div>
            : <CheckBar label="A-check" used={cs.aUsed} due={cs.aDue} hoursLeft={cs.aHoursLeft} next={cs.nextA} onPlan={() => plan('A')} aircraftId={ac.id} />}
          <CheckBar label="C-check" used={cs.cUsed} due={cs.cDue} hoursLeft={cs.cHoursLeft} next={cs.nextC} onPlan={() => plan('C')} aircraftId={ac.id} />
          {cs.grounded && <div className="small bad">Past the check tolerance: grounded until the check is done.</div>}
        </div>
      ) : (
        <div className="small muted">Maintenance status unavailable.</div>
      )}
      {ac.sale && (
        <div className="fl-row small fl-sale"><span className="upper dim">Sold</span><span className="grow">to {ac.sale.buyer} for {money(ac.sale.price)} · handover {fmtDay(ac.sale.closes)}</span><button className="btn btn-sm" onClick={() => store.openModal({ kind: 'sell', aircraftId: ac.id })}>Sale…</button></div>
      )}
      <div className="row gap-8 fl-actions">
        <button className="btn grow" onClick={() => store.navigate('schedule', { sel: { kind: 'aircraft', id: ac.id } })}><CalendarRange /> Schedule</button>
        <button className="btn grow" onClick={() => store.navigate('map', { sel: { kind: 'aircraft', id: ac.id } })}><Plane /> On map</button>
        {/* v0.7.2 §6: sell what we own; hand a lease back early (90+ days left). */}
        {o.kind === 'owned' && !ac.sale && ac.status !== 'delivering' && <button className="btn grow" onClick={() => store.openModal({ kind: 'sell', aircraftId: ac.id })}><BadgeDollarSign /> Sell…</button>}
        {o.kind === 'dryLeaseIn' && !ac.returning && ac.status !== 'delivering' && o.leaseEnd - g.now >= 90 * DAY && <button className="btn grow" onClick={() => store.openModal({ kind: 'lease', aircraftId: ac.id, tab: 'early' })}><Undo2 /> Return early…</button>}
      </div>
    </div>
  );
}

const station = (code: string) => MRO_STATIONS.find((x) => x.code === code);

/** v0.7: lessor, lease end and return site; within 180 days 'Extend or return…'; a booked return's ferry and check. */
function LeaseRow({ g, ac }: { g: GameState; ac: Aircraft }) {
  const lv = leaseView(g, ac.id);
  if (!lv) return null;
  const ret = lv.options.find((x) => x.id === 'return');
  const m = lv.returning ? g.maintenance[lv.returning.maintId] : undefined;
  const f0 = lv.returning?.ferryIds.map((id) => g.flights[id]).find((f) => f && f.status === 'scheduled');
  const soon = lv.daysLeft <= 180 || !!lv.returning || !!lv.decisionId;
  return (
    <div className="fl-row fl-lease">
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="small"><span className="upper dim">Lease</span> {lv.lessor} until {fmtDate(lv.ends)} · return at {lv.returnSite}{ret?.cost ? ` · ≈ ${money(ret.cost)}` : ''}</span>
        {lv.returning && m && <span className="small warn">{f0 ? `Return ferry ${fmtDay(f0.std)} · ` : ''}return check {lv.returning.site} {fmtDay(m.start)}–{fmtDay(m.end)}</span>}
        {!lv.returning && lv.decisionId && <span className="small warn">The lessor wants an answer: extend or return</span>}
      </div>
      {soon && <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'lease', aircraftId: ac.id })}>{lv.returning ? 'Change…' : 'Extend or return…'}</button>}
    </div>
  );
}

/** v0.7: the cabin (layout, seats, cabin crew minimum), Refit…, and a planned or running refit (cancel while planned). */
function CabinRow({ g, ac, out }: { g: GameState; ac: Aircraft; out?: boolean }) {
  const m = Object.values(g.maintenance).find((x) => x.aircraftId === ac.id && x.kind === 'refit' && (x.status === 'planned' || x.status === 'inWork'));
  const st = m ? station(m.at) : undefined;
  const cancel = () => m && store.openModal({
    kind: 'confirm', title: 'Cancel this refit?', confirm: 'Cancel the refit', danger: true,
    body: `${ac.reg} stays ${ac.cabin.label}. Free before the work starts; its ferry to ${m.at} is removed.`,
    onConfirm: () => store.act((gg) => cancelCheck(gg, m.id)),
  });
  const busy = ac.status === 'delivering' || !!ac.returning;
  const rest = restRefitOptions(g, ac.id).length > 0;
  return (
    <div className="fl-row fl-cabin">
      <div className="col grow" style={{ minWidth: 0 }}>
        <span className="small"><span className="upper dim">Cabin</span> <b>{ac.cabin.label}</b> {layoutLabel(ac.cabin.layout)} · crew minimum {cabinMinimum(ac.typeId, ac.cabin.total)} cabin</span>
        {m?.refit && <span className="small accent">{m.restFit ? `${REST_FIT_LABEL[m.restFit]}${m.restFit === 'removeRecliners' ? '' : ' fitted'}` : m.refit.restSeats !== undefined ? (m.refit.restSeats ? 'Crew rest seats fitted' : 'Crew rest seats removed') : `${m.clientCabin ? 'Client cabin: ' : ''}${m.end - m.start <= 3 * DAY ? 'Quick reconfiguration' : 'Refit'} to ${m.refit.cabin.label}`} at {st?.city ?? m.at} {fmtDay(m.start)}–{fmtDay(m.end)}{m.status === 'inWork' ? ' · in work' : ''}</span>}
      </div>
      {m ? (m.status === 'planned' && <button className="btn btn-sm" onClick={cancel}>Cancel refit</button>)
        : !out && <span className="row gap-8">
          {/* v0.7.3 §2.6 item 1: straight to the refit modal's crew rest section when there is anything to fit. */}
          {rest && <button className="btn btn-sm fl-rest-btn" disabled={busy} onClick={() => store.openModal({ kind: 'refit', aircraftId: ac.id, section: 'rest' })}><BedDouble /> Crew rest…</button>}
          <button className="btn btn-sm" disabled={busy} onClick={() => store.openModal({ kind: 'refit', aircraftId: ac.id })}><Sofa /> Refit…</button>
        </span>}
    </div>
  );
}

type FleetView = 'fleet' | 'market';

export function FleetScreen() {
  useRenderCount('fleet');
  const g = useGame();
  const nav = store.nav;
  const sel = nav.sel?.kind === 'aircraft' ? nav.sel.id : null;
  const fleet = Object.values(g.fleet);
  const offers = g.market.aircraft.filter((o) => o.expires > g.now);
  const view: FleetView = nav.view === 'market' ? 'market' : 'fleet';
  const mkSel = nav.sel?.kind === 'market' ? nav.sel.id : null;
  const fresh = view === 'market' ? 0 : unseenOffers(offers.map((o) => o.id));
  const setView = (v: FleetView) => store.navigate('fleet', { view: v });

  // Deep links: navigate('fleet', {sel, view: 'check'}) opens check planning; a selected card scrolls into view.
  useEffect(() => {
    if (!sel) return;
    document.querySelector(`.sc-ac[data-ac="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
    if (nav.view === 'check' && g.fleet[sel]) {
      store.navigate('fleet', { sel: nav.sel });
      store.openModal({ kind: 'check', aircraftId: sel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, nav.view]);

  // v0.7.2 §6.3 'Which one?': the least used aircraft over 90 days (leases first: they cost rent).
  const [which, setWhich] = useState(false);
  const leased = leastUsed(g, 'leased');
  const least = which ? (leased[0] ?? leastUsed(g, 'any')[0]) : undefined;
  const pickLeast = () => {
    const l = leased[0] ?? leastUsed(g, 'any')[0];
    setWhich(true);
    if (l) store.navigate('fleet', { sel: { kind: 'aircraft', id: l.aircraftId } });
  };
  const monthly = fleet.reduce((s, a) => s + (a.ownership.kind === 'dryLeaseIn' ? a.ownership.rentPerMonth : 0), 0);
  return (
    <div className="screen sc-fleet">
      <ScreenHead title={view === 'market' ? 'Aircraft market' : 'Fleet'} sub={view === 'market' ? `${offers.length} open offer${offers.length === 1 ? '' : 's'} · cash ${money(g.company.cash)}` : `${fleet.length} aircraft · rent ${money(monthly)}/month`}>
        {view === 'fleet' && fleet.length > 1 && <button className="btn" onClick={pickLeast} aria-label="Which one? Show the least used aircraft"><HelpCircle /> Which one?</button>}
        <Seg<FleetView> value={view} onChange={setView} options={[
          { value: 'fleet', label: 'Fleet' },
          { value: 'market', label: <span className="row gap-4">Market ({offers.length}){fresh > 0 && <span className="fl-dot" aria-label={`${fresh} new`} />}</span> },
        ]} />
      </ScreenHead>
      <ScreenHint id="fleet" />
      {view === 'market' ? <MarketView g={g} sel={mkSel} /> : !fleet.length ? (
        <Empty icon={<Wrench />} title="No aircraft">Lease one from the Market.</Empty>
      ) : (
        <div className="sc-ac-grid">{fleet.map((ac) => <AircraftCard key={ac.id} g={g} ac={ac} sel={sel === ac.id} least={least?.aircraftId === ac.id ? least : undefined} onLeastClose={() => setWhich(false)} />)}</div>
      )}
    </div>
  );
}
