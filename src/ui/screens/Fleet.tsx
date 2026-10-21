// Fleet (B5): aircraft cards (art, ownership, hours, A/C-check bars with Plan check, AOG risk) and the
// scarce aircraft market below (lease / buy with a confirm). DESIGN.md §6.3.

import { CalendarRange, Lock, Palette, Plane, ShoppingCart, Wrench } from 'lucide-react';
import { useEffect } from 'react';
import { artFor } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, fmtDay, yearOf } from '../../engine/core/time';
import type { Aircraft, AircraftOffer, CrewExtra, GameState, LiveryRef } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { crewExtraQuote, setCrewExtra } from '../../engine/crew';
import { MARKET_LIVERY } from '../../data/livery';
import { acquireAircraft, checkStatus, liveryOf, paintStatus, setAircraftLivery } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Empty, Seg, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { KV, ScreenHead, useRenderCount } from './common';
import { limitTone, spanLabel } from './screenLogic';

/** The type's ETOPS capability (what the engine checks) and whether the company holds an approval for it. */
function etopsLabel(g: GameState, ac: Aircraft): string {
  const max = typeOf(ac.typeId).etopsMax;
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

function CheckBar({ label, used, due, hoursLeft, next, onPlan }: { label: string; used: number; due: number; hoursLeft: number; next: string | null; onPlan: () => void }) {
  const tone = limitTone(used);
  return (
    <div className="sc-check-bar">
      <div className="row between small">
        <span><b>{label}</b> <span className="muted">{next ? `booked ${next}` : `due ${fmtDay(due)}`}</span></span>
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
function LiveryRow({ g, ac }: { g: GameState; ac: Aircraft }) {
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
  const set = (v: CrewExtra | null) => store.act((gg) => setCrewExtra(gg, { aircraftId: ac.id }, v), { toastOk: false });
  const extra = x.cabin + x.pilot;
  const what = [x.cabin ? `+${x.cabin} cabin` : '', x.pilot ? 'spare pilot' : ''].filter(Boolean).join(' + ');
  return (
    <div className="sc-ac-crew">
      <div className="row between small">
        <span><span className="upper dim">Crew</span> <span className="muted">Legal minimum {q.minimum.pilots} pilots + {q.minimum.cabin} cabin</span></span>
        {ac.crewExtra ? <button className="btn btn-sm btn-ghost" onClick={() => set(null)}>Reset</button> : <span className="tiny dim">company default</span>}
      </div>
      <div className="row gap-12 wrap">
        <span className="row gap-8"><span className="small">Extra cabin</span><Stepper value={x.cabin} min={0} max={BAL.crewExtra.cabinMax} onChange={(v) => set({ cabin: v, pilot: x.pilot })} /></span>
        <span className="row gap-8"><span className="small">Spare pilot</span><Toggle on={!!x.pilot} onChange={(v) => set({ cabin: x.cabin, pilot: v ? 1 : 0 })} label="Spare pilot" /></span>
      </div>
      <div className="tiny muted">{extra ? `${what} → +${q.extraPeople} people over ${Math.round(q.extraPeople / Math.max(1, extra))} crew sets · ≈ ${money(q.perMonth)}/month · Morale +${q.service > 0 ? ` · Service ${q.service >= 0.4 ? '++' : '+'}` : ''}` : 'Legal minimum only. Extra crew cost salaries and per diems but lift morale and service; a spare on board covers a sick call away from base.'}</div>
    </div>
  );
}

function AircraftCard({ g, ac, sel }: { g: GameState; ac: Aircraft; sel: boolean }) {
  const t = typeOf(ac.typeId);
  const cs = safeCheck(g, ac);
  const [label, tone] = STATUS[ac.status];
  const o = ac.ownership;
  const own: [string, string][] = o.kind === 'owned'
    ? [['Owned', `book value ${money(o.bookValue)}`]]
    : [['Lessor', o.lessor], ['Lease', `to ${fmtDate(o.leaseEnd)} · ${money(o.rentPerMonth)}/month`]];
  const plan = (kind: 'A' | 'C') => store.openModal({ kind: 'check', aircraftId: ac.id, checkKind: kind });
  const lv = liveryOf(g, ac);
  return (
    <div className={`card sc-ac ${sel ? 'selected' : ''}`} data-ac={ac.id}>
      <div className="sc-ac-top">
        <div className="sc-ac-art"><AircraftArt typeId={artFor(ac.typeId)} livery={lv.livery} code={lv.code} name={lv.name} /></div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8">
            <b className="mono sc-ac-reg">{ac.reg}</b>
            <span className={`badge ${tone}`}>{label}</span>
            {cs && cs.risk >= 0.5 && <span className={`badge ${cs.risk >= 0.9 ? 'bad' : 'warn'}`} data-tip="Chance of a technical fault grows with deferred defects and overdue checks">AOG risk</span>}
          </div>
          <div className="small muted ellipsis">{t.name} · {ac.cabin.label} · {yearOf(g.now) - ac.builtYear} years</div>
        </div>
      </div>
      <LiveryRow g={g} ac={ac} />
      <KV rows={[
        ...own,
        ['At', ac.status === 'delivering' ? `arrives ${fmtDate(ac.deliveredAt)}` : ac.at],
        ['Hours / cycles', `${Math.round(ac.hours).toLocaleString('en-US')} / ${Math.round(ac.cycles).toLocaleString('en-US')}`],
        ['ETOPS', etopsLabel(g, ac)],
      ]} />
      <CrewExtraRow g={g} ac={ac} />
      {cs ? (
        <div className="col gap-8">
          <CheckBar label="A-check" used={cs.aUsed} due={cs.aDue} hoursLeft={cs.aHoursLeft} next={cs.nextA} onPlan={() => plan('A')} />
          <CheckBar label="C-check" used={cs.cUsed} due={cs.cDue} hoursLeft={cs.cHoursLeft} next={cs.nextC} onPlan={() => plan('C')} />
          {cs.grounded && <div className="small bad">Past the check tolerance: grounded until the check is done.</div>}
        </div>
      ) : (
        <div className="small muted">Maintenance status unavailable.</div>
      )}
      <div className="row gap-8">
        <button className="btn grow" onClick={() => store.navigate('schedule', { sel: { kind: 'aircraft', id: ac.id } })}><CalendarRange /> Schedule</button>
        <button className="btn grow" onClick={() => store.navigate('map', { sel: { kind: 'aircraft', id: ac.id } })}><Plane /> On map</button>
      </div>
    </div>
  );
}

function acquire(o: AircraftOffer) {
  const t = typeOf(o.typeId);
  const lease = o.kind === 'dryLeaseIn';
  store.openModal({
    kind: 'confirm', title: `${lease ? 'Lease' : 'Buy'} a ${t.name}?`, confirm: lease ? 'Sign the lease' : `Buy for ${money(o.price)}`,
    body: lease
      ? `${o.lessor}, built ${o.builtYear}, ${o.cabin.label}. ${money(o.rentPerMonth)}/month for ${o.leaseMonths} months plus ${money(o.reservesPerFH)}/FH reserves. Deposit ${money(o.deposit)} now. Delivery in ${o.leadDays} days.`
      : `${o.lessor}, built ${o.builtYear}, ${o.cabin.label}. ${money(o.price)} now. Delivery in ${o.leadDays} days.`,
    onConfirm: () => store.act((gg) => acquireAircraft(gg, o.id)),
  });
}

function MarketRow({ g, o }: { g: GameState; o: AircraftOffer }) {
  const t = typeOf(o.typeId);
  const lease = o.kind === 'dryLeaseIn';
  return (
    <div className="sc-list-row">
      <div className="sc-mkt-art"><AircraftArt typeId={artFor(o.typeId)} livery={MARKET_LIVERY} detail="simple" /></div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-8"><b className="ellipsis">{t.name}</b><span className={`badge ${lease ? 'info' : 'gold'}`}>{lease ? 'Dry lease' : 'Buy'}</span></div>
        <div className="small muted ellipsis">{o.lessor} · built {o.builtYear} · {o.cabin.label} · delivery {o.leadDays} d · offer ends in {spanLabel(o.expires - g.now)}</div>
      </div>
      <div className="right nowrap">
        <b className="num">{lease ? `${money(o.rentPerMonth)}/mo` : money(o.price)}</b>
        <div className="tiny dim">{lease ? `${o.leaseMonths} months · deposit ${money(o.deposit)}` : 'outright'}</div>
      </div>
      <button className="btn btn-primary" onClick={() => acquire(o)}><ShoppingCart /> {lease ? 'Lease' : 'Buy'}</button>
    </div>
  );
}

export function FleetScreen() {
  useRenderCount('fleet');
  const g = useGame();
  const nav = store.nav;
  const sel = nav.sel?.kind === 'aircraft' ? nav.sel.id : null;
  const fleet = Object.values(g.fleet);
  const offers = g.market.aircraft.filter((o) => o.expires > g.now);

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

  const monthly = fleet.reduce((s, a) => s + (a.ownership.kind === 'dryLeaseIn' ? a.ownership.rentPerMonth : 0), 0);
  return (
    <div className="screen sc-fleet">
      <ScreenHead title="Fleet" sub={`${fleet.length} aircraft · rent ${money(monthly)}/month`} />
      {!fleet.length ? (
        <Empty icon={<Wrench />} title="No aircraft">Lease one from the market below.</Empty>
      ) : (
        <div className="sc-ac-grid">{fleet.map((ac) => <AircraftCard key={ac.id} g={g} ac={ac} sel={sel === ac.id} />)}</div>
      )}
      <h2 className="sc-h2">Aircraft market</h2>
      <div className="small muted mb-8">Good airframes are scarce. Offers stay open for a few days; delivery takes weeks.</div>
      {offers.length ? (
        <div className="card sc-list">{offers.map((o) => <MarketRow key={o.id} g={g} o={o} />)}</div>
      ) : (
        <div className="card sc-pad muted small">No aircraft on offer right now. Lessors call every few weeks{g.now - g.started < 30 * DAY ? '; the first offer usually comes within two months' : ''}.</div>
      )}
    </div>
  );
}
