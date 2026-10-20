// Ops Map (B4) side panels (right, 360 px): aircraft, airport and offer. They re-render with the
// hourly emit only (calm): progress bars and countdowns step once per game hour.

import { CalendarRange, FileSearch, Plane, Users, Wrench, X } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { ACMI_TYPES, artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { feasibilityAll } from '../../engine/contracts';
import { flightsOf } from '../../engine/core/entities';
import { currentFlight, flightTimes } from '../../engine/core/query';
import { DAY, fmtDay, fmtDuration, fmtTime, localOffset } from '../../engine/core/time';
import type { Aircraft, CrewMember, Flight, GameState, Ref } from '../../engine/core/types';
import { crewName, dutyCrew, flightCrewStatus } from '../../engine/crew';
import { checkStatus, liveryOf } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { Bar } from '../components/ui';
import { money } from '../format';
import { contractColor } from '../screens/palette';
import { store } from '../store';
import { paintLabel } from '../screens/scheduleLogic';
import { expiryLabel } from '../screens/screenLogic';
import { ARCHETYPE_LABEL, KIND_LABEL, chipInfo, upcomingLegs } from './mapLogic';

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

function crewOf(g: GameState, f: Flight): CrewMember[] {
  let ids = f.crewIds;
  if (!ids.length && f.dutyId) {
    const d = g.duties[f.dutyId];
    const p = d ? g.pairings[d.pairingId] : undefined;
    ids = p ? p.slots.map((s) => s.crewId).filter((x): x is string => !!x) : [];
  }
  return ids.map((id) => g.crew[id]).filter(Boolean).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

function LegRow({ g, f, onTap }: { g: GameState; f: Flight; onTap?: () => void }) {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  const dep = f.std + f.delay;
  const cs = safe(() => flightCrewStatus(g, f.id), { level: 'ok' as const, missing: [] });
  return (
    <button className="op-leg" onClick={onTap} disabled={!onTap}>
      <span className="op-leg-k" style={{ background: c ? contractColor(c.color) : 'var(--text-3)' }} />
      <span className="col" style={{ minWidth: 0, flex: 1 }}>
        <span className="row op-tight"><b className="mono">{f.from}→{f.to}</b><span className="small muted mono">{f.no}</span></span>
        <span className="small muted ellipsis">
          {fmtDay(dep)} {fmtTime(dep)} UTC · {fmtDuration(f.block)}{f.kind !== 'revenue' ? ` · ${KIND_LABEL[f.kind]}` : ''}{f.delay ? ` · +${fmtDuration(f.delay)}` : ''}
        </span>
      </span>
      <Dot tone={LEVEL_TONE[cs.level]} />
    </button>
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
  // The stored duty legality can lag the live per-seat check (DutyModal); show the worse of the two.
  const seatBad = !!crewFlight?.dutyId && cstat0?.level !== 'missing' && !!safe(() => dutyCrew(g, crewFlight.id)?.slots.some((x) => x.level === 'illegal'), false);
  const cstat = cstat0 && seatBad ? { ...cstat0, level: 'illegal' as const } : cstat0;
  const cs = safe(() => checkStatus(g, ac), null);
  const maint = ac.maintId ? g.maintenance[ac.maintId] : undefined;
  const chip = chipInfo(g, ac, t);
  const ap = AIRPORT_BY_CODE[ac.at];
  const lv = liveryOf(g, ac);
  // The ops stub returns zeros; show check data only once it means something.
  const csKnown = !!cs && (cs.aHoursLeft > 0 || cs.cHoursLeft > 0 || !!cs.nextA || !!cs.nextC || cs.risk > 0);

  let now: ReactNode;
  if (cur) {
    const { off, on } = flightTimes(cur);
    const prog = Math.max(0, Math.min(1, (t - off) / Math.max(1, on - off)));
    now = (
      <>
        <div className="row between"><b className="mono op-big">{cur.from} → {cur.to}</b><span className="mono small muted">{cur.no}</span></div>
        <Bar value={prog} size="thin" />
        <div className="op-kv">
          <div><span>Off blocks</span><b className="num">{fmtTime(off)} UTC</b></div>
          <div><span>ETA</span><b className="num">{fmtTime(on)} UTC · {fmtTime(on, cur.to)} local</b></div>
          <div><span>Remaining</span><b className="num">{fmtDuration(Math.max(0, on - t))}</b></div>
          {cur.delay > 0 && <div><span>Delay</span><b className="num warn-t">+{fmtDuration(cur.delay)}{cur.delayReason ? ` · ${cur.delayReason}` : ''}</b></div>}
        </div>
      </>
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
  } else {
    now = <div className="op-note"><Plane /><span>{ac.status === 'aog' ? 'AOG' : 'Parked'} at {ap?.city ?? ac.at} ({ac.at}) · {fmtTime(t, ac.at)} local</span></div>;
  }

  return (
    <Panel title={<span className="mono">{ac.reg}</span>} kicker={`${type?.name ?? ac.typeId} · ${ac.cabin.label}`} onClose={() => store.select(undefined)}>
      <div className="op-art"><AircraftArt typeId={artFor(ac.typeId)} livery={lv.livery} code={lv.code} name={lv.name} /></div>
      {lv.source === 'client' && <div className="small muted op-livery">In {lv.clientName} colours{lv.contractId && g.contracts[lv.contractId] ? ` for ${g.contracts[lv.contractId].title}` : ''}</div>}
      <div className="row wrap op-chips">
        <span className={`chip tone-${chip.tone}`}><Dot tone={chip.tone} />{cur ? 'Airborne' : ac.status === 'available' ? 'Available' : ac.status === 'aog' ? 'AOG' : ac.status === 'maintenance' ? 'Maintenance' : ac.status}</span>
        <span className="chip">{ac.ownership.kind === 'owned' ? 'Owned' : 'Dry-leased in'}</span>
        <span className="chip">{ac.builtYear}</span>
      </div>
      <Section title={cur ? 'Current flight' : 'Now'}>{now}</Section>
      <Section
        title={cur ? 'Crew on board' : crewFlight ? `Crew for ${crewFlight.no}` : 'Crew'}
        aside={cstat && <span className={`small tone-${LEVEL_TONE[cstat.level]}`}><Dot tone={LEVEL_TONE[cstat.level]} />{LEVEL_TEXT[cstat.level]}</span>}
      >
        {crew.length ? (
          <div className="op-crew">
            {crew.map((m) => (
              <div key={m.id} className="op-crew-row"><span className="role">{m.role}</span><span className="ellipsis">{crewName(m)}</span></div>
            ))}
          </div>
        ) : (
          <div className="small muted">{crewFlight ? 'No crew rostered yet.' : 'No flights planned.'}</div>
        )}
        {cstat && cstat.missing.length > 0 && <div className="small tone-bad op-gap">Missing: {cstat.missing.join(', ')}</div>}
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
  const here = Object.values(g.fleet).filter((ac) => (!ac.flightId && ac.at === code) || (ac.flightId && g.flights[ac.flightId]?.to === code));
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
    <Panel title={o.title} kicker={ARCHETYPE_LABEL[o.archetype] ?? o.archetype} onClose={() => store.select(undefined)}>
      <div className="row wrap op-chips">
        {o.urgency !== 'normal' && <span className={`chip tone-${o.urgency === 'urgent' ? 'bad' : 'warn'}`}>{o.urgency === 'urgent' ? 'Urgent' : 'Short notice'}</span>}
        {o.broker && <span className="chip">via {o.broker}</span>}
        {o.status !== 'open' && <span className="chip">{o.status}</span>}
      </div>
      <div className="op-kv">
        <div><span>Client</span><b className="ellipsis">{client?.name ?? '—'}</b></div>
        <div><span>Route</span><b className="mono">{routeSummary(o)}</b></div>
        <div><span>Dates</span><b className="num">{fmtDay(o.start)} – {fmtDay(o.end)}</b></div>
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

/** The panel for the current map selection, or null. */
export function MapPanel({ g, sel }: { g: GameState; sel?: Ref }) {
  if (!sel) return null;
  if (sel.kind === 'aircraft' && g.fleet[sel.id]) return <AircraftPanel g={g} ac={g.fleet[sel.id]} />;
  if (sel.kind === 'airport' && AIRPORT_BY_CODE[sel.id]) return <AirportPanel g={g} code={sel.id} />;
  if (sel.kind === 'offer' && g.offers[sel.id]) return <OfferPanel g={g} id={sel.id} />;
  return null;
}
