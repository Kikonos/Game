// Ops Map (B4) side panels (right, 360 px): aircraft, airport, offer and (v0.5.2) an airline leg our
// crew ride as passengers. They re-render with the hourly emit only (calm): progress bars and
// countdowns step once per game hour. Every leg carries its flight type (Operating / Positioning / Ferry / Deadhead).
// v0.7: delivery, refit and lease-return blocks on the aircraft panel, aircraft awaiting delivery on the airport
// panel, and why our crew ride an airline leg (ticketPurpose) on its panel.

import { CalendarRange, FileSearch, PackageCheck, Plane, Undo2, Users, Wrench, X } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { ACMI_TYPES, artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { MRO_STATIONS } from '../../data/market';
import { BAL } from '../../engine/core/balance';
import { isPilot } from '../../engine/core/perf';
import { feasibilityAll } from '../../engine/contracts';
import { flightsOf } from '../../engine/core/entities';
import { currentFlight, flightTimes } from '../../engine/core/query';
import { DAY, fmtDay, fmtDuration, fmtTime, localOffset } from '../../engine/core/time';
import type { Aircraft, CrewMember, Flight, GameState, MaintenanceEvent, Ref } from '../../engine/core/types';
import { crewName, dutyCrew, flightCrewStatus } from '../../engine/crew';
import { checkStatus, CONNECT_MIN, commercialItinerary, deliveryStatus, FLIGHT_TYPE_HINT, FLIGHT_TYPE_LABEL, flightCrewAboard, type FlightType, flightType, liveryOf, ticketPurpose } from '../../engine/ops';
import { ferryCost } from '../../engine/ops/delivery';
import { AircraftArt } from '../components/AircraftArt';
import { Bar } from '../components/ui';
import { money } from '../format';
import { contractColor } from '../screens/palette';
import { store } from '../store';
import { paintLabel } from '../screens/scheduleLogic';
import { archLabel, expiryLabel, offerDays } from '../screens/screenLogic';
import { awaitingDelivery, chipInfo, commercialById, deliveryTag, parseCommercialId, PURPOSE_LABEL, purposeChain, upcomingLegs } from './mapLogic';

const ROLE_ORDER = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];
const LEVEL_TONE = { ok: 'good', tight: 'warn', missing: 'bad', illegal: 'bad' } as const;
const LEVEL_TEXT = { ok: 'Legal', tight: 'Tight', missing: 'Uncrewed', illegal: 'Illegal' } as const;

/** Never let a module stub or a half-built API take the map down. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const utcOff = (min: number) => `UTC${min >= 0 ? '+' : '−'}${Math.floor(Math.abs(min) / 60)}${Math.abs(min) % 60 ? `:${String(Math.abs(min) % 60).padStart(2, '0')}` : ''}`;

function Panel({ title, kicker, onClose, children }: { title: ReactNode; kicker: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <aside className="ops-panel card" aria-label="Details">
      <header className="op-head">
        <div className="col" style={{ minWidth: 0 }}>
          <span className="upper dim">{kicker}</span>
          <h2 className="ellipsis">{title}</h2>
        </div>
        <button className="op-close btn btn-ghost btn-icon" onClick={onClose} aria-label="Close panel"><X /></button>
      </header>
      <div className="op-body">{children}</div>
    </aside>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="op-sec">
      <div className="op-sec-h"><span className="upper dim">{title}</span>{aside}</div>
      {children}
    </section>
  );
}

const Dot = ({ tone }: { tone: string }) => <span className={`op-dot ${tone}`} aria-hidden />;

/** Line sample per flight type (legend, Up Next, chips): the map's stroke in miniature. */
export const TypeKey = ({ type }: { type: FlightType }) => <span className={`ops-tkey ${type}`} aria-hidden />;

/** Flight-type chip: the map's line sample and label (same words everywhere). */
export const TypeChip = ({ type }: { type: FlightType }) => (
  <span className={`chip op-type ${type}`} title={FLIGHT_TYPE_HINT[type]}><TypeKey type={type} />{FLIGHT_TYPE_LABEL[type]}</span>
);

const byRole = (a: CrewMember, b: CrewMember) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);

function CrewRows({ crew }: { crew: CrewMember[] }) {
  return (
    <div className="op-crew">
      {crew.map((m) => (
        <button key={m.id} className="op-crew-row op-crew-link" onClick={() => store.navigate('crew', { sel: { kind: 'crew', id: m.id } })}>
          <span className="role">{m.role}</span><span className="ellipsis">{crewName(m)}</span>
        </button>
      ))}
    </div>
  );
}

function crewOf(g: GameState, f: Flight): CrewMember[] {
  let ids = f.crewIds;
  if (!ids.length && f.dutyId) {
    const d = g.duties[f.dutyId];
    const p = d ? g.pairings[d.pairingId] : undefined;
    ids = p ? p.slots.map((s) => s.crewId).filter((x): x is string => !!x) : [];
  }
  return ids.map((id) => g.crew[id]).filter(Boolean).sort(byRole);
}

function LegRow({ g, f, onTap }: { g: GameState; f: Flight; onTap?: () => void }) {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  const dep = f.std + f.delay;
  const cs = safe(() => flightCrewStatus(g, f.id), { level: 'ok' as const, missing: [] });
  const type = safe(() => flightType(g, f), 'operating' as FlightType);
  return (
    <button className="op-leg" onClick={onTap} disabled={!onTap}>
      <span className="op-leg-k" style={{ background: c ? contractColor(c.color) : 'var(--text-3)' }} />
      <span className="col" style={{ minWidth: 0, flex: 1 }}>
        <span className="row op-tight"><b className="mono">{f.from}→{f.to}</b><span className="small muted mono">{f.no}</span></span>
        <span className="small muted ellipsis">
          {fmtDay(dep)} {fmtTime(dep)} UTC · {fmtDuration(f.block)}{f.kind === 'techstop' ? ' · fuel stop' : ''}{f.delay ? ` · +${fmtDuration(f.delay)}` : ''}
        </span>
      </span>
      <span className={`op-type-s ${type}`}>{FLIGHT_TYPE_LABEL[type]}</span>
      <Dot tone={LEVEL_TONE[cs.level]} />
    </button>
  );
}

// ---------- v0.7 delivery, refit, lease return ----------

const cityOf = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
/** 'Lufthansa Technik, Hamburg' for a refit shop, else the city. */
const shopOf = (code: string) => {
  const s = MRO_STATIONS.find((x) => x.code === code);
  return s ? `${s.name}, ${s.city}` : cityOf(code);
};
const localDep = (f: Flight) => `${fmtDay(f.std + f.delay)} ${fmtTime(f.std + f.delay, f.from)} local`;

/** "Delivery ferry · leg 1 of 2 · fuel ≈ $41K" for a ferry leg flown for a purpose. */
function purposeLine(g: GameState, f: Flight): string | null {
  if (!f.purpose) return null;
  const chain = purposeChain(g, f);
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const fuel = ac ? safe(() => ferryCost(ac.typeId, [f], g.market.fuelPrice).fuel, 0) : 0;
  const i = chain.findIndex((x) => x.id === f.id);
  return `${PURPOSE_LABEL[f.purpose]} · leg ${i + 1} of ${chain.length}${fuel ? ` · fuel ≈ ${money(fuel)}` : ''}`;
}

/** One row per airline leg the delivery pilots ride (still to land, else the last one), tappable to the leg's panel. */
function PilotLegs({ g, ticketIds }: { g: GameState; ticketIds: string[] }) {
  const t = g.now;
  const rows = new Map<string, { id: string; no: string; from: string; to: string; dep: number; arr: number; n: number }>();
  let last: { id: string; no: string; from: string; to: string; dep: number; arr: number; n: number } | null = null;
  for (const tid of ticketIds) {
    const tk = g.flights[tid];
    if (!tk) continue;
    safe(() => commercialItinerary(g, tk), []).forEach((l, i) => {
      const k = `${l.no}|${l.from}|${l.dep}`;
      const row = rows.get(k) ?? { id: `${tid}:${i}`, no: l.no, from: l.from, to: l.to, dep: l.dep, arr: l.arr, n: 0 };
      row.n += tk.crewIds.length;
      rows.set(k, row);
      if (!last || l.arr > last.arr) last = row;
    });
  }
  const open = [...rows.values()].filter((r) => r.arr > t).sort((a, b) => a.dep - b.dep);
  const show = open.length ? open : last ? [last] : [];
  return (
    <>
      {show.map((r) => {
        const when = t >= r.arr ? `landed ${fmtDay(r.arr)}` : t >= r.dep ? `lands ${fmtTime(r.arr)} UTC` : `${fmtDay(r.dep)} ${fmtTime(r.dep)} UTC`;
        return (
          <button key={r.id} className="op-row op-dh-row" onClick={() => store.select({ kind: 'flight', id: r.id })}>
            <TypeKey type="deadhead" />
            <b className="mono">{r.no}</b>
            <span className="mono small">{r.from}→{r.to}</span>
            <span className={`small when ${t >= r.dep && t < r.arr ? 'tone-air' : 'muted'}`}>{when}</span>
          </button>
        );
      })}
    </>
  );
}

/** Delivery block: handover, the ferry home and the delivery pilots (until the aircraft is home). */
function DeliveryBlock({ g, ac }: { g: GameState; ac: Aircraft }) {
  const ds = safe(() => deliveryStatus(g, ac.id), null);
  if (!ds || ds.phase === 'home') return null;
  const fs = ds.ferryIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f);
  const next = fs.find((f) => f.status === 'scheduled');
  const city = cityOf(ds.site);
  const via = fs.slice(0, -1).map((f) => f.to);
  const legs = fs.length ? `${fs.length} leg${fs.length > 1 ? 's' : ''}${via.length ? ` via ${via.join(', ')}` : ''}` : 'no ferry planned';
  const home = next ? `ferry home ${localDep(next)} · ${legs}` : legs;
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  // Between ferry legs: a fuel-stop turn, or a night stop (hotel) once the gap is longer than a few hours.
  const landed = fs.filter((f) => f.status === 'done').at(-1);
  const stop = landed && next && next.std + next.delay - (landed.ata ?? landed.sta) > 4 * 60 ? 'Night stop' : 'Fuel stop';
  // Pilots are rostered on the normal horizon; only a near ferry without them is a worry.
  const late = !!next && next.std + next.delay - g.now < BAL.delivery.warnH * 60;
  const line = ds.phase === 'preparing' ? `Handover at ${city} ${fmtDay(ds.handover)} · ${home}`
    : ds.phase === 'waiting' ? `Waiting for rated pilots since ${fmtDay(ds.waitingSince ?? g.now)} · parked at ${city}`
    : ds.phase === 'ferrying' ? (cur?.purpose === 'delivery' ? `Delivery ferry ${fs.length ? [fs[0].from, ...fs.map((f) => f.to)].join('–') : ''}` : `${stop} at ${cityOf(ac.at)}${next ? ` · next leg ${localDep(next)}` : ''}`)
    : `Handed over at ${city} · ${home}`;
  const pilots = ds.pilotIds.map((id) => g.crew[id]).filter(Boolean).sort(byRole);
  return (
    <Section title="Delivery">
      <div className={`op-note ${ds.phase === 'waiting' ? 'warn' : 'info'}`}>
        <PackageCheck />
        <span className="col">
          <span>{line}</span>
          {ds.where && ds.phase !== 'ferrying' && <span className="small muted">{ds.where}</span>}
        </span>
      </div>
      {pilots.length ? (
        <div className="small muted">Pilots {pilots.map((m) => `${m.role === 'CPT' ? 'Capt' : m.role} ${m.last}`).join(', ')}</div>
      ) : (
        <div className={`small ${late ? 'tone-warn' : 'muted'}`}>{late ? 'No rated pilots rostered yet.' : 'Delivery pilots are rostered nearer the time.'}</div>
      )}
      {ds.ticketIds.length > 0 && ds.phase !== 'ferrying' && <PilotLegs g={g} ticketIds={ds.ticketIds} />}
    </Section>
  );
}

/** A planned (not yet started) refit or lease-return check of this aircraft. */
function plannedOf(g: GameState, ac: Aircraft, kind: 'refit' | 'return'): MaintenanceEvent | undefined {
  if (kind === 'return') {
    const m = ac.returning ? g.maintenance[ac.returning.maintId] : undefined;
    return m?.status === 'planned' ? m : undefined;
  }
  return Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && m.kind === 'refit' && m.status === 'planned').sort((a, b) => a.start - b.start)[0];
}

/** Planned refit and lease return lines (in-work ones show under Now). */
function PlannedBlocks({ g, ac }: { g: GameState; ac: Aircraft }) {
  const rf = plannedOf(g, ac, 'refit');
  const rt = plannedOf(g, ac, 'return');
  if (!rf && !rt) return null;
  const ferryTo = (m: MaintenanceEvent) => {
    const f = (m.ferryIds ?? ac.returning?.ferryIds ?? []).map((id) => g.flights[id]).find((x) => x?.status === 'scheduled');
    return f ? `ferry ${fmtDay(f.std + f.delay)}, ` : '';
  };
  return (
    <Section title="Planned">
      {rf && (
        <div className="op-note">
          <Wrench />
          <span>Cabin refit to {rf.refit?.cabin.label ?? 'a new layout'} at {shopOf(rf.at)}: {ferryTo(rf)}{fmtDay(rf.start)} – {fmtDay(rf.end)}</span>
        </div>
      )}
      {rt && (
        <div className="op-note">
          <Undo2 />
          <span>Lease return at {cityOf(rt.at)}: {ferryTo(rt)}return check {fmtDay(rt.start)} – {fmtDay(rt.end)}</span>
        </div>
      )}
    </Section>
  );
}

// ---------- aircraft ----------

function AircraftPanel({ g, ac }: { g: GameState; ac: Aircraft }) {
  const t = g.now;
  const type = ACMI_TYPES[ac.typeId];
  const cur = currentFlight(g, ac);
  const legs = upcomingLegs(g, ac.id, cur ? 5 : 4).filter((f) => f.id !== cur?.id).slice(0, 4);
  const crewFlight = cur ?? legs[0];
  const crew = crewFlight ? crewOf(g, crewFlight) : [];
  const cstat0 = crewFlight ? safe(() => flightCrewStatus(g, crewFlight.id), null) : null;
  const dc = crewFlight?.dutyId ? safe(() => dutyCrew(g, crewFlight.id), null) : null;
  // v0.6: seats above the legal minimum (crew-extra settings) are tagged "Extra"; empty ones listed as open.
  const aboveIds = new Set(dc?.slots.filter((x) => x.above && x.crewId).map((x) => x.crewId as string) ?? []);
  const openAbove = dc?.slots.filter((x) => x.above && !x.crewId) ?? [];
  // The stored duty legality can lag the live per-seat check (DutyModal); show the worse of the two.
  const seatBad = !!crewFlight?.dutyId && cstat0?.level !== 'missing' && !!dc?.slots.some((x) => x.level === 'illegal');
  const cstat1 = cstat0 && seatBad ? { ...cstat0, level: 'illegal' as const } : cstat0;
  // An empty leg not rostered yet is flown by pilots only (the uncrewed complement lists the cabin too).
  const pilotsOnly = !!crewFlight && !crewFlight.dutyId && (crewFlight.kind === 'ferry' || crewFlight.kind === 'positioning');
  const cstat = cstat1 && pilotsOnly ? { ...cstat1, missing: cstat1.missing.filter((r) => isPilot(r)) } : cstat1;
  // A delivery / return / refit ferry days away is crewed on the normal roster horizon: not a worry yet.
  const later = pilotsOnly && !!crewFlight?.purpose && crewFlight.std + crewFlight.delay - t > BAL.delivery.warnH * 60;
  const cs = safe(() => checkStatus(g, ac), null);
  const maint = ac.maintId ? g.maintenance[ac.maintId] : undefined;
  const chip = chipInfo(g, ac, t);
  const ap = AIRPORT_BY_CODE[ac.at];
  const lv = liveryOf(g, ac);
  // The ops stub returns zeros; show check data only once it means something.
  const csKnown = !!cs && (cs.aHoursLeft > 0 || cs.cHoursLeft > 0 || !!cs.nextA || !!cs.nextC || cs.risk > 0);

  let now: ReactNode;
  const curType = cur ? safe(() => flightType(g, cur), 'operating' as FlightType) : null;
  const riders = cur ? safe(() => flightCrewAboard(g, cur).riding, [] as string[]).map((id) => g.crew[id]).filter(Boolean).sort(byRole) : [];
  if (cur) {
    const { off, on } = flightTimes(cur);
    const prog = Math.max(0, Math.min(1, (t - off) / Math.max(1, on - off)));
    now = (
      <>
        <div className="row between"><b className="mono op-big">{cur.from} → {cur.to}</b><span className="row op-tight">{curType && <TypeChip type={curType} />}<span className="mono small muted">{cur.no}</span></span></div>
        {cur.purpose ? <div className="small muted">{purposeLine(g, cur)}</div> : curType && curType !== 'operating' && <div className="small muted">{FLIGHT_TYPE_HINT[curType]}</div>}
        <Bar value={prog} size="thin" />
        <div className="op-kv">
          <div><span>Off blocks</span><b className="num">{fmtTime(off)} UTC</b></div>
          <div><span>ETA</span><b className="num">{fmtTime(on)} UTC · {fmtTime(on, cur.to)} local</b></div>
          <div><span>Remaining</span><b className="num">{fmtDuration(Math.max(0, on - t))}</b></div>
          {cur.delay > 0 && <div><span>Delay</span><b className="num warn-t">+{fmtDuration(cur.delay)}{cur.delayReason ? ` · ${cur.delayReason}` : ''}</b></div>}
        </div>
      </>
    );
  } else if (maint && ac.status === 'maintenance' && (maint.kind === 'refit' || maint.kind === 'return')) {
    now = (
      <div className="op-note warn">
        {maint.kind === 'refit' ? <Wrench /> : <Undo2 />}
        <span>
          {maint.kind === 'refit'
            ? `Cabin shop at ${shopOf(maint.at)}: refit to ${maint.refit?.cabin.label ?? 'a new layout'}, back ${fmtDay(maint.end)}`
            : `Lease return check at ${cityOf(maint.at)} until ${fmtDay(maint.end)}`}
        </span>
      </div>
    );
  } else if (maint && (ac.status === 'maintenance' || ac.status === 'aog')) {
    now = (
      <div className={`op-note ${ac.status === 'aog' ? 'bad' : 'warn'}`}>
        <Wrench />
        <span>
          {ac.status === 'aog' ? 'AOG' : maint.kind === 'paint' ? 'In the paint shop' : 'In the hangar'} at {ac.at}: {maint.kind === 'AOG' ? 'repair' : maint.kind === 'paint' ? paintLabel(g, maint) : `${maint.kind}-check`}
          {maint.cause ? ` (${maint.cause})` : ''}, back {fmtDay(maint.end)} {fmtTime(maint.end)} UTC
        </span>
      </div>
    );
  } else if (ac.status === 'delivering') {
    now = <div className="op-note"><PackageCheck /><span>Not handed over yet · {ac.delivery ? `at ${cityOf(ac.delivery.site)} ${fmtDay(ac.delivery.handover)}` : `delivery ${fmtDay(ac.deliveredAt)}`}</span></div>;
  } else {
    now = <div className="op-note"><Plane /><span>{ac.status === 'aog' ? 'AOG' : 'Parked'} at {ap?.city ?? ac.at} ({ac.at}) · {fmtTime(t, ac.at)} local</span></div>;
  }

  return (
    <Panel title={<span className="mono">{ac.reg}</span>} kicker={`${type?.name ?? ac.typeId} · ${ac.cabin.label}`} onClose={() => store.select(undefined)}>
      <div className="op-art"><AircraftArt typeId={artFor(ac.typeId)} livery={lv.livery} code={lv.code} name={lv.name} /></div>
      {lv.source === 'client' && <div className="small muted op-livery">In {lv.clientName} colours{lv.contractId && g.contracts[lv.contractId] ? ` for ${g.contracts[lv.contractId].title}` : ''}</div>}
      <div className="row wrap op-chips">
        <span className={`chip tone-${chip.tone}`}><Dot tone={chip.tone} />{cur ? 'Airborne' : ac.status === 'available' ? 'Available' : ac.status === 'aog' ? 'AOG' : ac.status === 'maintenance' ? 'Maintenance' : ac.status === 'delivering' ? 'Delivering' : ac.status}</span>
        {curType === 'ferry' && !deliveryTag(ac) && <span className="chip op-ferry-tag">FERRY</span>}
        {deliveryTag(ac) && <span className="chip op-dlv-tag">DELIVERY</span>}
        <span className="chip">{ac.ownership.kind === 'owned' ? 'Owned' : 'Dry-leased in'}</span>
        <span className="chip">{ac.builtYear}</span>
      </div>
      <Section title={cur ? 'Current flight' : 'Now'}>{now}</Section>
      <DeliveryBlock g={g} ac={ac} />
      <PlannedBlocks g={g} ac={ac} />
      <Section
        title={cur ? 'Crew on board' : crewFlight ? `Crew for ${crewFlight.no}` : 'Crew'}
        aside={later ? <span className="small muted">Rostered later</span> : cstat && <span className={`small tone-${LEVEL_TONE[cstat.level]}`}><Dot tone={LEVEL_TONE[cstat.level]} />{LEVEL_TEXT[cstat.level]}</span>}
      >
        {crew.length ? (
          <div className="op-crew">
            {crew.map((m) => (
              <div key={m.id} className={`op-crew-row${aboveIds.has(m.id) || m.notice ? ' tagged' : ''}`}>
                <span className="role">{m.role}</span>
                <span className="col op-crew-who">
                  <span className="ellipsis">{crewName(m)}</span>
                  {(aboveIds.has(m.id) || m.notice) && (
                    <span className="op-crew-tags">
                      {aboveIds.has(m.id) && <span className="op-tag extra" title="Seat above the legal minimum">Extra</span>}
                      {m.notice && <span className="op-tag notice" title="Resigned, working the notice period">Leaves {fmtDay(m.notice.leaves - 1)}</span>}
                    </span>
                  )}
                </span>
              </div>
            ))}
            {openAbove.map((x) => (
              <div key={`open-${x.index}`} className="op-crew-row tagged muted">
                <span className="role">{x.role}</span>
                <span className="col op-crew-who"><span className="ellipsis">Open seat</span><span className="op-crew-tags"><span className="op-tag extra">Extra</span></span></span>
              </div>
            ))}
          </div>
        ) : (
          <div className="small muted">{crewFlight ? 'No crew rostered yet.' : 'No flights planned.'}</div>
        )}
        {cstat && !later && cstat.missing.length > 0 && <div className="small tone-bad op-gap">Missing: {cstat.missing.join(', ')}</div>}
        {riders.length > 0 && (
          <>
            <div className="small muted op-gap">Riding as passengers</div>
            <CrewRows crew={riders} />
          </>
        )}
        {crewFlight && crewFlight.dutyId && crewFlight.status === 'scheduled' && (
          <button className="btn op-gap op-crew-btn" onClick={() => store.openModal({ kind: 'duty', id: crewFlight.id })}><Users /> Adjust crew</button>
        )}
      </Section>
      <Section title="Next legs">
        {legs.length ? legs.map((f) => <LegRow key={f.id} g={g} f={f} />) : <div className="small muted">Nothing scheduled. Idle aircraft earn nothing: check the market.</div>}
      </Section>
      <Section title="Maintenance">
        {csKnown && cs ? (
          <div className="op-kv">
            <div><span>A-check</span><b className={`num ${cs.aDue - t < 7 * DAY || cs.aHoursLeft < 50 ? 'warn-t' : ''}`}>{cs.nextA ? 'planned · ' : ''}due {fmtDay(cs.aDue)} · {Math.round(cs.aHoursLeft)} FH</b></div>
            <div><span>C-check</span><b className="num">{cs.nextC ? 'planned · ' : ''}due {fmtDay(cs.cDue)} {new Date(Date.UTC(2000, 0, 1) + cs.cDue * 60000).getUTCFullYear()}</b></div>
            <div><span>AOG risk</span><b className={`num ${cs.risk >= 0.9 ? 'bad-t' : cs.risk >= 0.5 ? 'warn-t' : ''}`}>{cs.risk >= 0.9 ? 'High' : cs.risk >= 0.5 ? 'Elevated' : 'Low'}</b></div>
          </div>
        ) : (
          <div className="small muted">{Math.round(ac.hours).toLocaleString('en-US')} FH · {ac.cycles.toLocaleString('en-US')} cycles</div>
        )}
      </Section>
      <div className="op-actions">
        <button className="btn" onClick={() => store.navigate('schedule', { sel: { kind: 'aircraft', id: ac.id } })}><CalendarRange />Schedule</button>
        <button className="btn" onClick={() => store.navigate('fleet', { sel: { kind: 'aircraft', id: ac.id }, view: 'check' })}><Wrench />Plan check</button>
      </div>
    </Panel>
  );
}

// ---------- airport ----------

function AirportPanel({ g, code }: { g: GameState; code: string }) {
  const a = AIRPORT_BY_CODE[code];
  const t = g.now;
  const waiting = awaitingDelivery(g, code);
  const here = Object.values(g.fleet).filter((ac) => !waiting.includes(ac) && ((!ac.flightId && ac.at === code) || (ac.flightId && g.flights[ac.flightId]?.to === code)));
  const hotel = Object.values(g.crew).filter((m) => m.loc === code && m.base !== code && m.status !== 'onDuty' && m.status !== 'joining');
  const based = code === g.company.homeBase ? Object.values(g.crew).filter((m) => m.loc === code && (m.status === 'available' || m.status === 'off' || m.status === 'resting')).length : 0;
  const offers = Object.values(g.offers).filter((o) => o.status === 'open' && o.pin === code);
  const deps: Flight[] = [];
  for (const id of Object.keys(g.fleet)) for (const f of flightsOf(g, id)) if (f.status === 'scheduled' && f.from === code && f.std + f.delay < t + DAY) deps.push(f);
  deps.sort((x, y) => x.std + x.delay - (y.std + y.delay));
  if (!a) return null;
  return (
    <Panel title={a.name} kicker={`${code} · ${a.city}`} onClose={() => store.select(undefined)}>
      <div className="op-kv">
        <div><span>Local time</span><b className="num">{fmtTime(t, code)} · {utcOff(localOffset(code, t))}</b></div>
        {a.runwayM ? <div><span>Runway</span><b className="num">{a.runwayM.toLocaleString('en-US')} m</b></div> : null}
        {code === g.company.homeBase && <div><span>Home base</span><b>{based} crew at base</b></div>}
      </div>
      <Section title="Our aircraft">
        {here.length ? here.map((ac) => {
          const ci = chipInfo(g, ac, t);
          return (
            <button key={ac.id} className="op-row" onClick={() => store.select({ kind: 'aircraft', id: ac.id })}>
              <Dot tone={ci.tone} /><b className="mono">{ac.reg}</b><span className="small muted ellipsis">{ac.flightId ? `Inbound · ${ci.line}` : ci.line}</span>
            </button>
          );
        }) : <div className="small muted">None here.</div>}
      </Section>
      {waiting.length > 0 && (
        <Section title="Aircraft awaiting delivery here">
          {waiting.map((ac) => {
            const ci = chipInfo(g, ac, t);
            return (
              <button key={ac.id} className="op-row" onClick={() => store.select({ kind: 'aircraft', id: ac.id })}>
                <Dot tone={ci.tone} /><b className="mono">{ac.reg}</b><span className="small muted ellipsis">{ACMI_TYPES[ac.typeId]?.short ?? ac.typeId} · {ci.line}</span>
              </button>
            );
          })}
        </Section>
      )}
      <Section title="Crew in hotel" aside={hotel.length ? <span className="small muted">{hotel.length}</span> : undefined}>
        {hotel.length ? (
          <div className="op-crew">
            {hotel.slice(0, 8).map((m) => <div key={m.id} className="op-crew-row"><span className="role">{m.role}</span><span className="ellipsis">{crewName(m)}</span></div>)}
            {hotel.length > 8 && <div className="small muted">+{hotel.length - 8} more</div>}
          </div>
        ) : <div className="small muted">Nobody on a layover here.</div>}
      </Section>
      {deps.length > 0 && (
        <Section title="Departures, next 24 h">
          {deps.slice(0, 4).map((f) => <LegRow key={f.id} g={g} f={f} onTap={f.aircraftId ? () => store.select({ kind: 'aircraft', id: f.aircraftId! }) : undefined} />)}
        </Section>
      )}
      <Section title="Offers from here">
        {offers.length ? offers.map((o) => (
          <button key={o.id} className="op-row" onClick={() => store.select({ kind: 'offer', id: o.id })}>
            <span className={`op-dia ${o.urgency === 'urgent' ? 'urgent' : ''}`} aria-hidden /><span className="ellipsis">{o.title}</span>
          </button>
        )) : <div className="small muted">No open offers.</div>}
      </Section>
    </Panel>
  );
}

// ---------- offer ----------

function routeSummary(o: GameState['offers'][string]): string {
  const p = o.pattern;
  if (p.kind === 'base') return `${p.base} ⇄ ${p.dests.slice(0, 3).join(', ')}${p.dests.length > 3 ? '…' : ''} base`;
  const legs = p.legs;
  if (!legs.length) return o.pin;
  const first = legs[0];
  const last = legs[legs.length - 1];
  if (legs.length === 1) return `${first.from} → ${first.to}`;
  if (last.to === first.from && legs.length === 2) return `${first.from} ⇄ ${first.to}`;
  return `${first.from} → ${first.to} · ${legs.length} legs`;
}

function OfferPanel({ g, id }: { g: GameState; id: string }) {
  const o = g.offers[id];
  const hourKey = Math.floor(g.now / 60);
  const reports = useMemo(() => (o ? safe(() => feasibilityAll(g, id).slice(0, 3), []) : []), [id, hourKey, store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const client = g.clients[o.clientId];
  const left = o.expires - g.now;
  const product = o.product.kind === 'wet'
    ? `$${o.product.ratePerBH.toLocaleString('en-US')}/BH · MGH ${o.product.mghPerMonth}`
    : o.product.kind === 'charter' ? `${money(o.product.price)} charter` : `${money(o.product.rentPerMonth)}/month dry`;
  return (
    <Panel title={o.title} kicker={archLabel(o)} onClose={() => store.select(undefined)}>
      <div className="row wrap op-chips">
        {o.urgency !== 'normal' && <span className={`chip tone-${o.urgency === 'urgent' ? 'bad' : 'warn'}`}>{o.urgency === 'urgent' ? 'Urgent' : 'Short notice'}</span>}
        {o.broker && <span className="chip">via {o.broker}</span>}
        {o.status !== 'open' && <span className="chip">{o.status}</span>}
      </div>
      <div className="op-kv">
        <div><span>Client</span><b className="ellipsis">{client?.name ?? '—'}</b></div>
        <div><span>Route</span><b className="mono">{routeSummary(o)}</b></div>
        <div><span>Dates</span><b className="num">{offerDays(o).map(fmtDay).join(' – ')}</b></div>
        <div><span>Product</span><b className="num">{product}</b></div>
        <div><span>Est. value</span><b className="num">{money(o.estValue)} · {Math.round(o.estBH)} BH</b></div>
        {o.paint && <div><span>Livery</span><b className={o.paint.required ? 'warn-t' : ''}>Their colours{o.paint.required ? ' · required' : ' · optional'}</b></div>}
        <div><span>Expires</span><b className={`num ${left < 12 * 60 ? 'warn-t' : ''}`}>{expiryLabel(g.now, o.expires)}</b></div>
      </div>
      {o.hook && <div className="small muted op-gap">{o.hook}</div>}
      <Section title="Best aircraft">
        {reports.length ? reports.map((r) => {
          const ac = g.fleet[r.aircraftId];
          const pos = r.positionIn.length ? `+${fmtDuration(r.positionIn.reduce((s, l) => s + l.sta - l.std, 0))} positioning from ${r.positionIn[0].from}` : 'No positioning';
          return (
            <div key={r.aircraftId} className="op-row static">
              <Dot tone={r.level === 'ok' ? 'good' : r.level === 'warn' ? 'warn' : 'bad'} />
              <b className="mono">{ac?.reg ?? r.aircraftId}</b>
              <span className="small muted ellipsis">{r.level === 'no' ? r.checks.find((c) => c.level === 'no')?.label ?? 'Not feasible' : pos}</span>
              <span className={`mono small ${r.estMargin < 0 ? 'bad-t' : ''}`}>{money(r.estMargin)}</span>
            </div>
          );
        }) : <div className="small muted">Feasibility not available.</div>}
      </Section>
      <div className="op-actions">
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'offer', offerId: o.id })}><FileSearch />Review offer</button>
      </div>
    </Panel>
  );
}

// ---------- airline leg (crew deadheading) ----------

/** '16:00 UTC · 17:00 local'. */
const utcLocal = (t: number, code: string) => `${fmtTime(t)} UTC · ${fmtTime(t, code)} local`;

function CommercialPanel({ g, id }: { g: GameState; id: string }) {
  const cf = safe(() => commercialById(g, id), null);
  const ticket = cf ? g.flights[cf.ticketId] : undefined;
  if (!cf || !ticket) return null;
  const leg = cf.leg;
  const legs = safe(() => commercialItinerary(g, ticket), [leg]);
  const ref = { legIndex: cf.legIndex };
  const t = g.now;
  const A = AIRPORT_BY_CODE[leg.from];
  const B = AIRPORT_BY_CODE[leg.to];
  const state = t < leg.dep ? 'before' : t < leg.arr ? 'air' : 'done';
  const prog = Math.max(0, Math.min(1, (t - leg.dep) / Math.max(1, leg.arr - leg.dep)));
  const crew = cf.crewIds.map((c) => g.crew[c]).filter(Boolean).sort(byRole);
  const dest = AIRPORT_BY_CODE[ticket.to];
  const why = safe(() => ticketPurpose(g, ticket.id), null);
  const whyAc = why?.aircraftId ? g.fleet[why.aircraftId] : undefined;
  return (
    <Panel title={<span className="mono">{leg.no}</span>} kicker={`Deadhead · ${leg.airline}`} onClose={() => store.select(undefined)}>
      <div className="row wrap op-chips">
        <TypeChip type="deadhead" />
        <span className={`chip ${state === 'air' ? 'tone-air' : ''}`}>{state === 'air' ? 'Airborne' : state === 'before' ? 'Scheduled' : 'Landed'}</span>
        {legs.length > 1 && <span className="chip">Leg {ref.legIndex + 1} of {legs.length}</span>}
      </div>
      <Section title="Flight">
        <div className="row between"><b className="mono op-big">{leg.from} → {leg.to}</b><span className="small muted ellipsis">{A?.city ?? leg.from} – {B?.city ?? leg.to}</span></div>
        {state === 'air' && <Bar value={prog} size="thin" />}
        <div className="op-kv">
          <div><span>Airline</span><b className="ellipsis">{leg.airline} ({leg.iata})</b></div>
          <div><span>Departs</span><b className="num">{fmtDay(leg.dep)} · {utcLocal(leg.dep, leg.from)}</b></div>
          <div><span>Arrives</span><b className="num">{fmtDay(leg.arr)} · {utcLocal(leg.arr, leg.to)}</b></div>
          {state === 'air' && <div><span>Time to landing</span><b className="num">{fmtDuration(Math.max(0, leg.arr - t))}</b></div>}
          {state === 'before' && <div><span>Departs in</span><b className="num">{fmtDuration(leg.dep - t)}</b></div>}
          {state === 'done' && <div><span>Landed</span><b className="num">{fmtDuration(t - leg.arr)} ago</b></div>}
        </div>
      </Section>
      {legs.length > 1 && (
        <Section title="Connection">
          {legs.map((l, i) => (
            <div key={i} className={`op-row static op-cm-leg ${i === ref.legIndex ? 'on' : ''}`}>
              <TypeKey type="deadhead" />
              <b className="mono">{l.no}</b>
              <span className="mono small ellipsis">{l.from}→{l.to}</span>
              <span className="mono small muted">{fmtTime(l.dep)}–{fmtTime(l.arr)}</span>
            </div>
          ))}
          <div className="small muted">{fmtDuration(Math.max(CONNECT_MIN, legs[1].dep - legs[0].arr))} connection at {legs[0].to}{AIRPORT_BY_CODE[legs[0].to] ? ` (${AIRPORT_BY_CODE[legs[0].to].city})` : ''}</div>
        </Section>
      )}
      <Section title="Our crew on board" aside={<span className="small muted">{crew.length}</span>}>
        {crew.length ? <CrewRows crew={crew} /> : <div className="small muted">Nobody of ours on this ticket any more.</div>}
        <div className="small muted op-gap">Travelling as passengers to {dest?.city ?? ticket.to} ({ticket.to}){legs.length > 1 ? ` via ${legs[0].to}` : ''}.</div>
      </Section>
      {why?.text && (
        <Section title="Purpose">
          {whyAc ? (
            <button className="op-row" onClick={() => store.select({ kind: 'aircraft', id: whyAc.id })}>
              {why.kind === 'delivery' ? <PackageCheck /> : why.kind === 'return' ? <Undo2 /> : why.kind === 'refit' ? <Wrench /> : <Plane />}
              <span className="op-wrap">{why.text}</span>
            </button>
          ) : (
            <div className="op-row static"><Plane /><span className="op-wrap">{why.text}</span></div>
          )}
        </Section>
      )}
    </Panel>
  );
}

/** The panel for the current map selection, or null. */
export function MapPanel({ g, sel }: { g: GameState; sel?: Ref }) {
  if (!sel) return null;
  if (sel.kind === 'flight' && parseCommercialId(sel.id)) return <CommercialPanel g={g} id={sel.id} />;
  if (sel.kind === 'aircraft' && g.fleet[sel.id]) return <AircraftPanel g={g} ac={g.fleet[sel.id]} />;
  if (sel.kind === 'airport' && AIRPORT_BY_CODE[sel.id]) return <AirportPanel g={g} code={sel.id} />;
  if (sel.kind === 'offer' && g.offers[sel.id]) return <OfferPanel g={g} id={sel.id} />;
  return null;
}
