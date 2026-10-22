// Schedule detail sheet (B5): the flight(s) or maintenance near a Gantt tap, or an idle gap.
// Flight: times UTC/local, crew and legality, contract link. Maintenance: reschedule / cancel.

import { CalendarClock, ChevronLeft, Clock, FileSignature, Handshake, Lock, Palette, Search, Trash2, Users, Wrench } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../../engine/core/balance';
import { DAY, fmtDateTime, fmtDuration, fmtTime } from '../../engine/core/time';
import type { Aircraft, Duty, Flight, GameState, MaintenanceEvent, Ref } from '../../engine/core/types';
import { crewName, dutyCrew, dutyLegality, flightCrewStatus, restOf, restPlanForFlight, restSeatsBlocked, restShort, restVerdict } from '../../engine/crew';
import { seatLabel, typeOf } from '../../engine/core/perf';
import { cancelCheck, delayFlight, flightCrewAboard, flightType } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { FlightTypeChip } from '../components/FlightType';
import { ProblemCardView } from '../components/ProblemCard';
import { restSeatWord } from '../components/RestLines';
import { RestTimeline } from '../components/RestTimeline';
import { Term } from '../components/Term';
import { Modal, Stepper } from '../components/ui';
import { money } from '../format';
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
function RestSection({ g, f, ac, d }: { g: GameState; f: Flight; ac: Aircraft; d?: Duty }) {
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
  const v = restVerdict(plan)!;
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
      {!plan.ok && plan.why && <div className="small bad">{plan.why}.</div>}
      {plan.extraCabin > 0 && <div className="small warn">+{plan.extraCabin} cabin crew fly so that everyone gets their rest.</div>}
      {plan.cruise.length > 0 && <RestTimeline g={g} plan={plan} />}
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
  const why = (cs.level === 'illegal' || cs.level === 'tight') && f.dutyId ? dutyLegality(g, f.id).warnings.find((w) => w.code !== 'missing' && w.level !== 'legal')?.text : undefined;
  const rival = f.operatedBy ? g.rivals.find((r) => r.id === f.operatedBy)?.name : undefined;
  const [hold, setHold] = useState(0);
  // Beyond the roster horizon an empty duty is normal, not a problem.
  const later = cs.level === 'missing' && f.std > g.now + BAL.rosterHorizonDays * DAY && !(view?.slots.some((x) => x.crewId));
  const type = flightType(g, f);
  const aboard = flightCrewAboard(g, f);
  const rows: [ReactNode, ReactNode][] = [
    ['Aircraft', rival ? `Sub-chartered to ${rival}` : ac ? `${ac.reg}` : '—'],
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
  if (aboard.riding.length) rows.push(['Riding', aboard.riding.filter((id) => g.crew[id]).map((id) => `${g.crew[id].role} ${crewName(g.crew[id])}`).join(', ')]);
  if (d) rows.push(['Duty', `Day length ${hm(d.fdp)} of ${hm(d.maxFdp + (d.discretion ?? 0))} · ${d.sectors} sector${d.sectors === 1 ? '' : 's'}${d.augment ? ` · ${2 + d.augment} pilots` : ''}${d.ext ? ' · planned extension' : ''}${d.split ? ' · split duty' : ''}`]);
  const live = f.status === 'scheduled' && !!f.aircraftId;
  const canSub = live && !!c && (f.kind === 'revenue' || f.kind === 'techstop');
  const doHold = () => {
    const r = store.act((gg) => delayFlight(gg, f.id, hold * 30, 'Held by operations'));
    if (r.ok) setHold(0);
  };
  // v0.7.1 §4: the four-line card on top (crew shortage, illegal or tight crew, an uncrewed ferry), the banner while the ladder mark stands.
  const card = live && !later && f.kind !== 'deadhead' ? problemAt(g, { kind: 'flight', id: f.id }) : null;
  const short = !!card && (card.subject.kind === 'crewShort' || card.subject.kind === 'crewIllegal' || card.subject.kind === 'ferryUncrewed');
  return (
    <div className="col gap-12">
      {card && (
        <ProblemCardView card={card} g={g} hideActions={short}>
          {short && <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'crewControl', flightId: f.id })}><Users /> Crew Control</button>}
          {short && f.crewAlert && <span className={`cs-banner ${card.severity}`}>CREW SHORTAGE</span>}
        </ProblemCardView>
      )}
      <div className="small muted">{AIRPORT_BY_CODE[f.from]?.city ?? f.from} → {AIRPORT_BY_CODE[f.to]?.city ?? f.to}</div>
      <KV rows={rows} />
      {ac && f.kind !== 'deadhead' && f.status !== 'cancelled' && <RestSection g={g} f={f} ac={ac} d={d} />}
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
          {canSub && <button className="btn" onClick={() => store.openModal({ kind: 'subcharter', contractId: c!.id, flightId: f.id })}><Handshake /> Sub-charter</button>}
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
        ['Aircraft', ac?.reg ?? '—'],
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
        ['Aircraft', ac?.reg ?? '—'],
        ['Where', `${m.at} · ${AIRPORT_BY_CODE[m.at]?.city ?? ''}`],
        ['From', `${fmtDateTime(m.start)} UTC`],
        ['To', `${fmtDateTime(m.end)} UTC (${durLabel(m.end - m.start)})`],
        ['Cost', money(m.cost)],
        ['Status', `${m.status === 'inWork' ? 'In work' : m.status[0].toUpperCase() + m.status.slice(1)}${m.planned ? '' : ' · unplanned'}`],
        ...(m.cause ? [['Cause', m.cause] as [string, string]] : []),
        ...(m.refit ? [['New cabin', m.refit.cabin.label] as [string, string]] : []),
        ...(m.leaseReturn ? [['Lease return', 'the aircraft leaves the fleet at the end'] as [string, string]] : []),
      ]} />
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

function titleOf(g: GameState, r: Ref): string {
  if (r.kind === 'flight') {
    const f = g.flights[r.id];
    return f ? `${f.no} ${f.from} → ${f.to}` : 'Flight';
  }
  const m = g.maintenance[r.id];
  return m ? (m.kind === 'AOG' ? `AOG repair at ${m.at}` : m.kind === 'paint' ? `${paintLabel(g, m)} at ${m.at}` : m.kind === 'refit' || m.kind === 'return' ? maintLabel(m)[0] : `${m.kind}-check at ${m.at}`) : 'Maintenance';
}

export function BlockSheet({ refs, idle }: { refs: Ref[]; idle?: { aircraftId: string; from: number; to: number; at: string } }) {
  const g = useGame();
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
      </Modal>
    );
  }
  const cur = open && live.find((r) => r.id === open.id);
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
    <Modal title={`${live.length} items`} onClose={close}>
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
