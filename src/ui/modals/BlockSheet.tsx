// Schedule detail sheet (B5): the flight(s) or maintenance near a Gantt tap, or an idle gap.
// Flight: times UTC/local, crew and legality, contract link. Maintenance: reschedule / cancel.

import { ArrowRightLeft, CalendarClock, ChevronLeft, ChevronRight, Clock, FileSignature, Handshake, Lock, Palette, Repeat, Search, Sofa, Trash2, Users, Wrench } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../../engine/core/balance';
import { DAY, fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import type { Aircraft, Duty, Flight, GameState, MaintenanceEvent, Ref } from '../../engine/core/types';
import { clientCrewOf, crewAlertKind, crewName, dutyCrew, slipOfFlight, dutyLegality, flightCrewStatus, restOf, restPlanForFlight, restSeatsBlocked, restShort, restVerdict, ridersText } from '../../engine/crew';
import { seatLabel, typeOf } from '../../engine/core/perf';
import { cabinOptions, cancelCheck, checkStatus, delayFlight, dryLeaseView, flightCrewAboard, flightType, flightZone, refitSlots } from '../../engine/ops';
import { ClientCrewRow } from './v08Bits';
import { gapCheck, type GapOption } from '../../engine/ops/maintMove';
import { problemAt } from '../../engine/problems';
import { tripOf, tripTargets } from '../../engine/ops/tripMove';
import { subleaseTrip } from '../../engine/ops/sublease';
import { usdSigned } from './TripMoveModal';
import { FlightTypeChip } from '../components/FlightType';
import { ProblemCardView } from '../components/ProblemCard';
import { restSeatWord } from '../components/RestLines';
import { RestTimeline } from '../components/RestTimeline';
import { Term } from '../components/Term';
import { Modal, Stepper } from '../components/ui';
import { money, plural } from '../format';
import { Dot, KV } from '../screens/common';
import { contractColor } from '../screens/palette';
import { durLabel, maintLabel, paintLabel } from '../screens/scheduleLogic';
import { store, useGame } from '../store';

const STATUS: Record<Flight['status'], string> = { scheduled: 'Scheduled', enroute: 'En route', done: 'Landed', cancelled: 'Cancelled' };
const LEVEL_TONE = { ok: 'good', tight: 'warn', missing: 'bad', illegal: 'bad' } as const;


const both = (t: number, ap: string) => `${fmtDateTime(t)} UTC · ${fmtTime(t, ap)} ${ap}`;
const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;

/**
 * v0.7.3 §2.6 item 4: the In-flight rest section of a flight on an augmented duty (or one the roster split because
 * the cruise was too short): verdict chip, the facilities, why it fails, the static timeline. A long unaugmented
 * widebody day gets one greyed line instead.
 */
function RestSection({ g, f, ac, d, legal }: { g: GameState; f: Flight; ac: Aircraft; d?: Duty; legal: boolean }) {
  const plan = restPlanForFlight(g, f.id);
  if (!plan) {
    if (!d || typeOf(ac.typeId).body !== 'wide' || d.fdp < 10 * 60) return null;
    return (
      <div className="rt-sec off">
        <span className="upper dim"><Term id="inflightRest">In-flight rest</Term></span>
        <span className="small muted">No in-flight rest needed: {hm(d.fdp)} of {hm(d.maxFdp)}</span>
      </div>
    );
  }
  // The roster split a too-short-cruise day with a fresh crew (slipShort): this duty flies unaugmented and legal.
  const lastId = d && !d.augment && legal && d.fdp <= d.maxFdp && !plan.ok && plan.code === 'tooShort' ? d.flightIds.filter((id) => g.flights[id]?.status !== 'cancelled').at(-1) : undefined;
  const at = lastId ? g.flights[lastId]?.to : undefined;
  const v = at ? { tone: 'info', text: `In-flight rest not possible: the roster split the day at ${AIRPORT_BY_CODE[at]?.city ?? at}` } : restVerdict(plan)!;
  const rest = restOf(g, ac.id);
  const pilots = 2 + plan.augment;
  return (
    <div className="rt-sec">
      <div className="rt-sec-head">
        <span className="upper dim"><Term id="inflightRest">In-flight rest</Term></span>
        <span className={`badge ${v.tone}`}>{v.text}</span>
      </div>
      <div className="small rt-facts">
        <span><b>{pilots} pilots</b> <span className="muted">· rest in {restShort(rest.fc)} · <Term id="landingPilots">landing pilots</Term> 2 h in a row, the others 90 min</span></span>
        <span><b>Cabin crew</b> <span className="muted">· {restShort(rest.cc)}{plan.cabinNeed !== null ? ` · ${hm(plan.cabinNeed)} each (a ${hm(plan.cabinFdp)} day${plan.band ? `, band ${plan.band}` : ''})` : ''} · half stay in the cabin</span></span>
      </div>
      {!plan.ok && plan.why && <div className={`small ${at ? 'muted' : 'bad'}`}>{plan.why}.</div>}
      {plan.extraCabin > 0 && <div className="small warn">+{plan.extraCabin} cabin crew fly so that everyone gets their rest.</div>}
      {plan.cruise.length > 0 && <RestTimeline g={g} plan={plan} />}
    </div>
  );
}

/** v0.7.2.1 'Move trip to…': every other aircraft with its net (+$/−$) or why it can't; a choice opens the confirm. */
function MoveTripList({ g, f }: { g: GameState; f: Flight }) {
  const list = tripTargets(g, f.id);
  if (!list.length) return <div className="small muted">No other aircraft in the fleet.</div>;
  return (
    <div className="col gap-6 tm-list">
      {list.map((q) => {
        const ac = g.fleet[q.targetId];
        return (
          <button key={q.targetId} className={`tm-pick ${q.ok ? '' : 'blocked'}`} disabled={!q.ok} onClick={() => store.openModal({ kind: 'tripMove', flightId: f.id, targetId: q.targetId })}>
            <span className="col tm-pick-ac"><b className="mono">{q.targetReg}</b><span className="tiny muted">{ac ? `${typeOf(ac.typeId).short} · ${ac.cabin.label}` : ''}</span></span>
            {q.ok ? (
              <span className={`tm-pick-net num ${q.verdict === 'gain' ? 'good' : q.verdict === 'loss' ? 'bad' : 'muted'}`}>{q.verdict === 'same' ? 'about the same' : usdSigned(q.net)}</span>
            ) : (
              <span className="tm-pick-why small">{q.reasons[0]}</span>
            )}
            {q.ok && <ChevronRight className="tm-pick-go" />}
          </button>
        );
      })}
    </div>
  );
}

function FlightDetail({ g, f }: { g: GameState; f: Flight }) {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const view = f.aircraftId && f.dutyId ? dutyCrew(g, f.id) : null;
  // The stored duty legality can lag the live per-seat check; show the worse of the two.
  const cs0 = flightCrewStatus(g, f.id);
  const seat = view?.slots.some((x) => x.level === 'illegal') ? 'illegal' : view?.slots.some((x) => x.level === 'tight') ? 'tight' : null;
  const cs = seat === 'illegal' && cs0.level !== 'missing' ? { ...cs0, level: 'illegal' as const } : seat === 'tight' && cs0.level === 'ok' ? { ...cs0, level: 'tight' as const } : cs0;
  // Why (v0.6.3): the first problem of the same check the Adjust crew panel shows (empty seats are listed above).
  const w0 = (cs.level === 'illegal' || cs.level === 'tight') && f.dutyId ? dutyLegality(g, f.id).warnings.find((w) => w.code !== 'missing' && w.level !== 'legal') : undefined;
  // v0.10.1 a crew member who is not at the departure airport reads as where they are ('FO Teresa Martins is in Lisbon, not Antalya').
  const away = w0?.crewId && w0.reason?.code === 'place' ? g.crew[w0.crewId] : undefined;
  const why = away ? `${view?.slots.find((x) => x.crewId === away.id)?.role ?? away.role} ${crewName(away)} is ${w0!.reason!.text}` : w0?.text;
  const rival = f.operatedBy ? g.rivals.find((r) => r.id === f.operatedBy)?.name : undefined;
  const [hold, setHold] = useState(0);
  const [moving, setMoving] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (moving) moveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [moving]);
  // Beyond the roster horizon an empty duty is normal, not a problem.
  const later = cs.level === 'missing' && f.std > g.now + BAL.rosterHorizonDays * DAY && !(view?.slots.some((x) => x.crewId));
  const type = flightType(g, f);
  const aboard = flightCrewAboard(g, f);
  const rows: [ReactNode, ReactNode][] = [
    ['Aircraft', rival ? `Sub-chartered to ${rival}` : ac ? `${ac.reg}${ac.name ? ` · ${ac.name}` : ''}` : '—'],
    ['Type', <span className="row gap-8 sc-ft-row"><FlightTypeChip type={type} />{f.kind === 'techstop' && <span className="small muted">fuel stop</span>}</span>],
    ['Status', `${STATUS[f.status]}${f.delay ? ` · ${fmtDuration(f.delay)} late${f.delayReason ? ` (${f.delayReason})` : ''}` : ''}`],
    ['Departs', both(f.atd ?? f.std + f.delay, f.from)],
    ['Arrives', both(f.ata ?? f.eta ?? f.sta + f.delay, f.to)],
    ['Block', fmtDuration(f.block)],
  ];
  // v0.7.2 §3.4: crew rest seats blocked on this flight (its duty needs in-flight rest); the offload happens at departure.
  const blocked = f.kind !== 'deadhead' && ac ? restSeatsBlocked(g, f.id) : 0;
  const offload = blocked && ac && f.status === 'scheduled' ? Math.max(0, (f.pax ?? 0) - (ac.cabin.total - blocked)) : 0;
  if (f.pax) rows.push(['Passengers', offload ? <span className="warn">{f.pax} booked · {(f.pax ?? 0) - offload} fly ({offload} offloaded at departure)</span> : String(f.pax)]);
  if (blocked && ac) rows.push(['Seats', <span className="warn">{ac.cabin.total} · {ac.cabin.total - blocked} sellable ({blocked} {restSeatWord(restOf(g, ac.id)) ?? 'seats'} blocked for crew rest)</span>]);
  if (type === 'ferry') rows.push(['Crew aboard', 'Pilots only · cabin crew travel separately']);
  else if (type === 'positioning') rows.push(['Crew aboard', 'Full crew · cabin crew needed at the destination']);
  // v0.12.1 our crew riding a passenger flight: how many and the seats still free.
  const riding = ridersText(g, f);
  if (riding) rows.push(['Our crew riding', riding]);
  if (aboard.riding.length) rows.push([riding ? 'Riders' : 'Riding', aboard.riding.filter((id) => g.crew[id]).map((id) => `${g.crew[id].role} ${crewName(g.crew[id])}`).join(', ')]);
  // v0.8: a world event holds, reroutes or charges war-risk cover on this leg (tap: the event).
  const zone = f.status === 'scheduled' ? flightZone(g, f.id) : null;
  if (zone) rows.push(['World event', <button className={`chip sc-chip ${zone.effect === 'held' ? 'bad' : 'warn'}`} onClick={() => store.openModal({ kind: 'worldEvent', eventId: zone.eventId })}>{zone.text}</button>]);
  if (f.warRisk) rows.push(['War-risk cover', `${money(f.warRisk)} for this landing`]);
  if (f.purpose === 'lease' && c?.dry) rows.push(['Dry lease', `${c.dry.outIds.includes(f.id) ? 'Delivery' : 'Return'} ferry · ${g.clients[c.clientId]?.name ?? 'lessee'} at ${c.dry.site}`]);
  if (d) rows.push(['Duty', `Day length ${hm(d.fdp)} of ${hm(d.maxFdp + (d.discretion ?? 0))} · ${d.sectors} sector${d.sectors === 1 ? '' : 's'}${d.augment ? ` · ${2 + d.augment} pilots` : ''}${d.ext ? ' · planned extension' : ''}${d.split ? ' · split duty' : ''}${d.discretion ? ` · commander's discretion +${hm(d.discretion)}` : ''}`]);
  const live = f.status === 'scheduled' && !!f.aircraftId;
  const canSub = live && !!c && (f.kind === 'revenue' || f.kind === 'techstop');
  // v0.12 the trip's sub-lease (another operator flies it for us), or why it can't be handed over.
  const sub = canSub ? subleaseTrip(g, f.id) : null;
  // v0.7.2.1: the trip this leg belongs to (moves whole to another aircraft).
  const trip = live && !!c && f.kind !== 'ferry' && !f.purpose ? tripOf(g, f.id) : null;
  const doHold = () => {
    const r = store.act((gg) => delayFlight(gg, f.id, hold * 30, 'Held by operations'));
    if (r.ok) setHold(0);
  };
  // v0.7.1 §4: the four-line card on top (crew shortage, illegal or tight crew, an uncrewed ferry), the banner while the ladder mark stands.
  const card = live && !later && f.kind !== 'deadhead' ? problemAt(g, { kind: 'flight', id: f.id }) : null;
  const short = !!card && (card.subject.kind === 'crewShort' || card.subject.kind === 'crewIllegal' || card.subject.kind === 'ferryUncrewed' || card.subject.kind === 'crewHours');
  return (
    <div className="col gap-12">
      {card && (
        <ProblemCardView card={card} g={g} hideActions={short}>
          {short && <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'crewControl', flightId: f.id })}><Users /> Crew Control</button>}
          {short && f.crewAlert && <span className={`cs-banner ${card.severity}`}>{crewAlertKind(g, f.id) === 'hours' ? 'CREW OUT OF HOURS' : 'CREW SHORTAGE'}</span>}
        </ProblemCardView>
      )}
      <div className="small muted">{AIRPORT_BY_CODE[f.from]?.city ?? f.from} → {AIRPORT_BY_CODE[f.to]?.city ?? f.to}</div>
      {(() => {
        // v0.9 §W.3: a crew change at a fuel stop on this flight's duty.
        const sv = f.kind !== 'deadhead' ? slipOfFlight(g, f.id) : null;
        return sv ? <div className="small v9-slip"><Repeat className="sc-ico-s accent" /><span><Term id="slipCrew">{sv.text}</Term></span></div> : null;
      })()}
      <KV rows={rows} />
      {ac && f.kind !== 'deadhead' && f.status !== 'cancelled' && <RestSection g={g} f={f} ac={ac} d={d} legal={cs.level !== 'illegal'} />}
      {f.aircraftId && f.kind !== 'deadhead' && (
        <div className="col gap-8">
          {later ? (
            <div className="row gap-8"><Dot tone="off" /><b>Not rostered yet</b><span className="small muted">the auto-roster fills duties {BAL.rosterHorizonDays} days ahead</span></div>
          ) : (
            <div className="row gap-8"><Dot tone={LEVEL_TONE[cs.level]} /><b>Crew {cs.level === 'ok' ? 'legal' : cs.level}</b>{cs.missing.length > 0 && <span className="small bad">missing {cs.missing.join(', ')}</span>}</div>
          )}
          {!later && why && !card && <div className={`small ${cs.level === 'illegal' ? 'bad' : 'warn'}`}>{why}</div>}
          {view && view.slots.some((x) => x.crewId) && (
            <div className="sc-crew-grid">
              {view.slots.filter((x) => x.crewId).map((x) => (
                <button key={x.crewId} className={`sc-crew-chip ${x.level ?? ''}`} onClick={() => store.navigate('crew', { sel: { kind: 'crew', id: x.crewId! } })}>
                  <span className="mono dim">{seatLabel(x.role, g.crew[x.crewId!]?.role ?? x.role)}</span><span className="ellipsis grow">{x.name}</span>
                  {x.locked && <Lock className="sc-ico-s accent" aria-label="set by you" />}
                  {x.level && x.level !== 'legal' && <Dot tone={x.level === 'tight' ? 'warn' : 'bad'} />}
                </button>
              ))}
            </div>
          )}
          {(() => {
            const cc = f.dutyId && (f.kind === 'revenue' || f.kind === 'techstop') ? clientCrewOf(g, f.dutyId) : null;
            return cc ? <ClientCrewRow label={cc.label} roles={cc.roles} /> : null;
          })()}
          {f.status === 'scheduled' && (
            view ? (
              <button className="btn" onClick={() => store.openModal({ kind: 'duty', id: f.id })}><Users /> Adjust crew</button>
            ) : (
              <div className="small muted">No crew rostered yet: duties are planned up to 14 days ahead.</div>
            )
          )}
        </div>
      )}
      {live && (
        <div className="row wrap gap-8 sc-sheet-actions">
          <Stepper value={hold} min={0} max={8} onChange={setHold} format={(v) => (v ? `+${v * 30} min` : 'Hold')} />
          <button className="btn" onClick={doHold} disabled={!hold}><Clock /> Delay</button>
          {canSub && <button className="btn" onClick={() => store.openModal({ kind: 'subcharter', contractId: c!.id, flightId: f.id, ...(sub?.ok ? { flightIds: sub.flightIds } : {}) })} title="Another operator flies it for us; the client still pays us (a sub-charter)"><Handshake /> Sub-lease</button>}
          {trip && <button className={`btn ${moving ? 'active' : ''}`} onClick={() => setMoving(!moving)} disabled={!trip.ok} title={trip.ok ? `Move ${trip.label} to another aircraft` : trip.reason}><ArrowRightLeft /> Move trip to…</button>}
        </div>
      )}
      {live && trip && !trip.ok && <div className="small muted">{trip.reason}.</div>}
      {live && sub && !sub.ok && <div className="small muted">Sub-lease this trip: {sub.reason}.</div>}
      {moving && trip?.ok && (
        <div className="col gap-8" ref={moveRef}>
          <div className="small muted">Move the whole trip <b>{trip.label}</b> ({trip.moved.length} leg{trip.moved.length > 1 ? 's' : ''}) to:</div>
          <MoveTripList g={g} f={f} />
        </div>
      )}
      {c && (
        <button className="btn sc-link" style={{ ['--kc' as string]: contractColor(c.color) }} onClick={() => store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id: c.id } })}>
          <span className="sc-kdot" /><FileSignature /> <span className="ellipsis">{c.title}</span>
        </button>
      )}
    </div>
  );
}

/** Paint-shop visit: client, what is painted, dates, cost and who pays; no Reschedule (tied to the contract). */
function PaintDetail({ g, m }: { g: GameState; m: MaintenanceEvent }) {
  const ac = g.fleet[m.aircraftId];
  const c = m.paint ? g.contracts[m.paint.contractId] : undefined;
  const t = c?.paint;
  const client = c ? g.clients[c.clientId]?.name ?? 'Client' : 'Client';
  const out = m.paint?.phase === 'out';
  const what = out ? (t?.kind === 'decals' ? `Decals off, back to ${g.company.name} colours` : `Repaint in ${g.company.name} colours`) : t?.kind === 'decals' ? `${client} titles and logo on white (decals)` : `Full repaint in ${client} colours`;
  // The client pays its share of the strip only for a contract that ran its course.
  const share = !t ? 0 : out && c?.status !== 'completed' ? (c?.status === 'cancelled' ? 0 : t.clientShare) : t.clientShare;
  const pays = share >= 1 ? `${client} pays all of it` : share > 0 ? `${client} pays ${Math.round(share * 100)}% (${money(m.cost * share)})` : out && c?.status === 'cancelled' ? 'At our cost (we cancelled)' : 'At our cost';
  return (
    <div className="col gap-12">
      <KV rows={[
        ['Aircraft', ac ? `${ac.reg}${ac.name ? ` · ${ac.name}` : ''}` : '—'],
        ['Work', what],
        ['Paint shop', `${m.at} · ${AIRPORT_BY_CODE[m.at]?.city ?? ''}`],
        ['From', `${fmtDateTime(m.start)} UTC`],
        ['To', `${fmtDateTime(m.end)} UTC (${durLabel(m.end - m.start)})`],
        ['Cost', `${money(m.cost)} · ${pays}${out && c?.status === 'active' ? ' when the contract completes' : ''}`],
        ['Status', m.status === 'inWork' ? 'In the paint shop' : m.status[0].toUpperCase() + m.status.slice(1)],
      ]} />
      {c && (
        <button className="btn sc-link" style={{ ['--kc' as string]: contractColor(c.color) }} onClick={() => store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id: c.id } })}>
          <span className="sc-kdot" /><FileSignature /> <span className="ellipsis">{c.title}</span>
        </button>
      )}
      <div className="small muted">Paint is part of the contract: it moves only if the contract is cancelled.</div>
    </div>
  );
}

function MaintDetail({ g, m }: { g: GameState; m: MaintenanceEvent }) {
  if (m.kind === 'paint') return <PaintDetail g={g} m={m} />;
  const ac = g.fleet[m.aircraftId];
  const canEdit = m.status === 'planned' && (m.kind === 'A' || m.kind === 'C');
  const refit = m.kind === 'refit' && m.status === 'planned';
  return (
    <div className="col gap-12">
      <KV rows={[
        ['Aircraft', ac ? `${ac.reg}${ac.name ? ` · ${ac.name}` : ''}` : '—'],
        ['Where', `${m.at} · ${AIRPORT_BY_CODE[m.at]?.city ?? ''}`],
        ['From', `${fmtDateTime(m.start)} UTC`],
        ['To', `${fmtDateTime(m.end)} UTC (${durLabel(m.end - m.start)})`],
        ['Cost', money(m.cost)],
        ['Status', `${m.status === 'inWork' ? 'In work' : m.status[0].toUpperCase() + m.status.slice(1)}${m.planned ? '' : ' · unplanned'}`],
        ...(m.cause ? [['Cause', m.cause] as [string, string]] : []),
        ...(m.refit ? [['New cabin', m.refit.cabin.label] as [string, string]] : []),
        ...(m.leaseReturn ? [['Lease return', 'the aircraft leaves the fleet at the end'] as [string, string]] : []),
      ]} />
      {(refit || canEdit) && <div className="small muted">Tip: on the Schedule, hold this block and slide it along the row to move it.</div>}
      {refit && <button className="btn btn-danger" onClick={() => { const r = store.act((gg) => cancelCheck(gg, m.id)); if (r.ok) store.closeModal(); }}><Trash2 /> Cancel refit</button>}
      {canEdit && (
        <div className="row gap-8">
          <button className="btn" onClick={() => store.openModal({ kind: 'check', aircraftId: m.aircraftId, checkKind: m.kind as 'A' | 'C', replace: m.id })}><CalendarClock /> Reschedule</button>
          <button className="btn btn-danger" onClick={() => { const r = store.act((gg) => cancelCheck(gg, m.id)); if (r.ok) store.closeModal(); }}><Trash2 /> Cancel check</button>
        </div>
      )}
    </div>
  );
}

/**
 * v0.7.2.2 the idle gap's own work: Book C-check, Book A-check, Cabin refit, each pre-filled for this aircraft at this
 * gap. Under each check: the interval usage if done at the gap's start and the next due date (disabled with the reason
 * when the gap is too short or the aircraft can't get there); under the refit: the earliest window in the gap.
 */
function GapActions({ g, idle }: { g: GameState; idle: { aircraftId: string; from: number; to: number; at: string } }) {
  const ac = g.fleet[idle.aircraftId];
  const from = Math.max(idle.from, g.now);
  const at = idle.at || ac.at;
  const st = checkStatus(g, ac);
  const opt = (k: 'A' | 'C') => gapCheck(g, ac.id, k, from, idle.to, at);
  const c = opt('C');
  const a = opt('A');
  const booked = (id: string | null) => (id && g.maintenance[id]?.status === 'planned' ? g.maintenance[id] : undefined);
  const refitBooked = Object.values(g.maintenance).find((m) => m.aircraftId === ac.id && m.kind === 'refit' && (m.status === 'planned' || m.status === 'inWork'));
  const label = cabinOptions(ac.typeId).find((p) => p.label !== ac.cabin.label)?.label;
  const rs = !refitBooked && label ? refitSlots(g, ac.id, label, 1, from) : null;
  const rslot = rs?.slots[0];
  const inGap = !!rslot && rslot.start < idle.to;
  const check = (k: 'A' | 'C', o: GapOption) => {
    const old = booked(k === 'A' ? st.nextA : st.nextC);
    return (
      <button key={k} className={`gap-act ${o.ok ? '' : 'blocked'}`} disabled={!o.ok} onClick={() => o.ok && o.start !== null && o.at && store.openModal({ kind: 'check', aircraftId: ac.id, checkKind: k, suggest: { start: o.start, at: o.at }, after: from, ...(old ? { replace: old.id } : {}) })}>
        <b className="row gap-6"><Wrench /> Book {k}-check</b>
        <span className={`small gap-use ${o.level ?? ''}`}>{o.text}</span>
        <span className="tiny muted">{o.ok ? `${fmtDay(o.start!)} ${fmtTime(o.start!)} at ${o.at}${old ? ` · moves the one booked ${fmtDay(old.start)}` : ''}` : o.why}</span>
      </button>
    );
  };
  return (
    <div className="gap-acts">
      {check('C', c)}
      {check('A', a)}
      <button className="gap-act" onClick={() => store.openModal({ kind: 'refit', aircraftId: ac.id, after: from })}>
        <b className="row gap-6"><Sofa /> Cabin refit</b>
        <span className="small muted">now {ac.cabin.label}</span>
        <span className="tiny muted">{refitBooked ? `Refit booked ${fmtDay(refitBooked.start)}: see it` : inGap ? `Earliest in this gap: ${fmtDay(rslot!.start)} – ${fmtDay(rslot!.end)}` : `${durLabel(idle.to - from)} free here: pick the layout, the planner starts at ${fmtDay(from)}`}</span>
      </button>
    </div>
  );
}

function titleOf(g: GameState, r: Ref): string {
  if (r.kind === 'flight') {
    const f = g.flights[r.id];
    return f ? `${f.no} ${f.from} → ${f.to}` : 'Flight';
  }
  const m = g.maintenance[r.id];
  return m ? (m.kind === 'AOG' ? `AOG repair at ${m.at}` : m.kind === 'paint' ? `${paintLabel(g, m)} at ${m.at}` : m.kind === 'refit' || m.kind === 'return' ? maintLabel(m)[0] : `${m.kind}-check at ${m.at}`) : 'Maintenance';
}

/** v0.8 a dry lease out (the Gantt's lease block): phases, money, the lessee's hours, the C-check line. */
function DryLeaseDetail({ g, contractId }: { g: GameState; contractId: string }) {
  const v = dryLeaseView(g, contractId);
  if (!v) return null;
  const ac = g.fleet[v.aircraftId];
  const PHASE = { signed: 'Signed: delivery ferry ahead', delivering: 'Delivery ferry under way', leased: 'With the lessee', returning: 'Coming back', done: 'Returned' } as const;
  return (
    <div className="col gap-12">
      <div className="small muted">{ac?.reg ?? 'Aircraft'} with {v.lessee} at {AIRPORT_BY_CODE[v.site]?.city ?? v.site} · {PHASE[v.phase]}</div>
      <KV rows={[
        ['Ferry out', `${fmtDay(v.out[0])} – ${fmtDay(v.out[1])} · our pilots, then home by deadhead`],
        ['Lease', `${fmtDay(v.lease[0])} – ${fmtDay(v.lease[1])}${v.late ? ` (${v.late} days late)` : ''}`],
        ['Ferry back', `${fmtDay(v.back[0])} – ${fmtDay(v.back[1])} · return inspection 2 days at base`],
        ['Rent', `${money(v.rent)} a month, in advance`],
        ['Reserves', `$${v.reservesPerFH.toLocaleString('en-US')} per FH, monthly in arrears`],
        ['Their hours', `${v.fhSoFar.toLocaleString('en-US')} FH so far of about ${v.fhExpected.toLocaleString('en-US')}`],
        ['Income so far', money(v.income)],
        ['Deposit', `${money(v.deposit)} held, back at the return`],
        ['C-check', v.cCheck],
        ...(v.damage ? [['Damage', v.damage] as [string, string]] : []),
      ]} />
      <button className="btn sc-link" onClick={() => store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id: contractId } })}><FileSignature /> <span className="ellipsis">Contract</span></button>
    </div>
  );
}

export function BlockSheet({ refs, idle }: { refs: Ref[]; idle?: { aircraftId: string; from: number; to: number; at: string } }) {
  const g = useGame();
  const lease = refs.find((r) => r.kind === 'contract' && g.contracts[r.id]?.dry);
  if (lease) {
    return (
      <Modal title={`Dry lease · ${g.clients[g.contracts[lease.id].clientId]?.name ?? 'lessee'}`} icon={<CalendarClock className="accent" />} onClose={() => store.closeModal()}>
        <DryLeaseDetail g={g} contractId={lease.id} />
      </Modal>
    );
  }
  return <SheetBody g={g} refs={refs} idle={idle} />;
}

function SheetBody({ g, refs, idle }: { g: GameState; refs: Ref[]; idle?: { aircraftId: string; from: number; to: number; at: string } }) {
  const live = refs.filter((r) => (r.kind === 'flight' ? g.flights[r.id] : g.maintenance[r.id]));
  const [open, setOpen] = useState<Ref | null>(live.length === 1 ? live[0] : null);
  const close = () => store.closeModal();
  if (idle && !live.length) {
    const ac = g.fleet[idle.aircraftId];
    return (
      <Modal title={`Idle ${durLabel(idle.to - idle.from)}`} icon={<Search className="accent" />} onClose={close} footer={
        <button className="btn btn-primary" onClick={() => store.navigate('contracts', { view: 'market' })}><Search /> Find work</button>
      }>
        <p className="muted">{ac?.reg} is free at {idle.at || ac?.at} from {fmtDateTime(idle.from)} to {fmtDateTime(idle.to)} UTC. Idle aircraft cost rent and insurance every day; brokers send gap-fit offers for windows like this.</p>
        {ac && <GapActions g={g} idle={idle} />}
      </Modal>
    );
  }
  // One live item left (the others landed or were removed): its sheet, not a list of one.
  const cur = (open && live.find((r) => r.id === open.id)) || (live.length === 1 ? live[0] : undefined);
  if (cur) {
    const f = cur.kind === 'flight' ? g.flights[cur.id] : undefined;
    const m = cur.kind === 'maint' ? g.maintenance[cur.id] : undefined;
    return (
      <Modal title={titleOf(g, cur)} icon={m ? (m.kind === 'paint' ? <Palette className="accent" /> : <Wrench className="accent" />) : undefined} onClose={close} footer={live.length > 1 ? <button className="btn btn-ghost" onClick={() => setOpen(null)}><ChevronLeft /> All {live.length}</button> : undefined}>
        {f && <FlightDetail g={g} f={f} />}
        {m && <MaintDetail g={g} m={m} />}
      </Modal>
    );
  }
  return (
    <Modal title={plural(live.length, 'item')} onClose={close}>
      <div className="col gap-8">
        {live.map((r) => {
          const f = r.kind === 'flight' ? g.flights[r.id] : undefined;
          const m = r.kind === 'maint' ? g.maintenance[r.id] : undefined;
          const t = f ? f.std + f.delay : m!.start;
          const k = f?.contractId ? g.contracts[f.contractId]?.color : undefined;
          return (
            <button key={r.id} className="sc-slot" style={k !== undefined ? { ['--kc' as string]: contractColor(k) } : undefined} onClick={() => setOpen(r)}>
              <b className="row gap-8">{k !== undefined && <span className="sc-kdot" />}{titleOf(g, r)}</b>
              <span className="muted row gap-8">{fmtDateTime(t)} UTC{f && <FlightTypeChip type={flightType(g, f)} />}</span>
            </button>
          );
        })}
        {!live.length && <div className="muted">Nothing here any more.</div>}
      </div>
    </Modal>
  );
}
