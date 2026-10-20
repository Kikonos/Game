// Schedule detail sheet (B5): the flight(s) or maintenance near a Gantt tap, or an idle gap.
// Flight: times UTC/local, crew and legality, contract link. Maintenance: reschedule / cancel.

import { CalendarClock, ChevronLeft, FileSignature, Search, Trash2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtDateTime, fmtDuration, fmtTime } from '../../engine/core/time';
import type { Flight, GameState, MaintenanceEvent, Ref } from '../../engine/core/types';
import { crewName, flightCrewStatus } from '../../engine/crew';
import { cancelCheck } from '../../engine/ops';
import { Modal } from '../components/ui';
import { money } from '../format';
import { Dot, KV } from '../screens/common';
import { contractColor } from '../screens/palette';
import { durLabel } from '../screens/scheduleLogic';
import { store, useGame } from '../store';

const KIND: Record<Flight['kind'], string> = { revenue: 'Revenue', positioning: 'Positioning (empty)', ferry: 'Ferry', techstop: 'Revenue with fuel stop', deadhead: 'Deadhead' };
const STATUS: Record<Flight['status'], string> = { scheduled: 'Scheduled', enroute: 'En route', done: 'Landed', cancelled: 'Cancelled' };
const LEVEL_TONE = { ok: 'good', tight: 'warn', missing: 'bad', illegal: 'bad' } as const;

const both = (t: number, ap: string) => `${fmtDateTime(t)} UTC · ${fmtTime(t, ap)} ${ap}`;

function FlightDetail({ g, f }: { g: GameState; f: Flight }) {
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const cs = flightCrewStatus(g, f.id);
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const rival = f.operatedBy ? g.rivals.find((r) => r.id === f.operatedBy)?.name : undefined;
  const crew = f.crewIds.map((id) => g.crew[id]).filter(Boolean);
  const rows: [string, string][] = [
    ['Aircraft', rival ? `Sub-chartered to ${rival}` : ac ? `${ac.reg}` : '—'],
    ['Type', KIND[f.kind]],
    ['Status', `${STATUS[f.status]}${f.delay ? ` · ${fmtDuration(f.delay)} late${f.delayReason ? ` (${f.delayReason})` : ''}` : ''}`],
    ['Departs', both(f.atd ?? f.std + f.delay, f.from)],
    ['Arrives', both(f.ata ?? f.eta ?? f.sta + f.delay, f.to)],
    ['Block', fmtDuration(f.block)],
  ];
  if (f.pax) rows.push(['Passengers', String(f.pax)]);
  if (d) rows.push(['Duty', `FDP ${fmtDuration(d.fdp)} of ${fmtDuration(d.maxFdp + (d.discretion ?? 0))} · ${d.sectors} sectors${d.augment ? ` · +${d.augment} pilot${d.augment > 1 ? 's' : ''}` : ''}`]);
  return (
    <div className="col gap-12">
      <div className="small muted">{AIRPORT_BY_CODE[f.from]?.city ?? f.from} → {AIRPORT_BY_CODE[f.to]?.city ?? f.to}</div>
      <KV rows={rows} />
      {f.aircraftId && f.kind !== 'deadhead' && (
        <div className="col gap-8">
          <div className="row gap-8"><Dot tone={LEVEL_TONE[cs.level]} /><b>Crew {cs.level === 'ok' ? 'legal' : cs.level}</b>{cs.missing.length > 0 && <span className="small bad">missing {cs.missing.join(', ')}</span>}</div>
          {crew.length > 0 && (
            <div className="sc-crew-grid">
              {crew.map((m) => (
                <button key={m.id} className="sc-crew-chip" onClick={() => store.navigate('crew', { sel: { kind: 'crew', id: m.id } })}>
                  <span className="mono dim">{m.role}</span><span className="ellipsis">{crewName(m)}</span>
                </button>
              ))}
            </div>
          )}
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

function MaintDetail({ g, m }: { g: GameState; m: MaintenanceEvent }) {
  const ac = g.fleet[m.aircraftId];
  const canEdit = m.status === 'planned' && (m.kind === 'A' || m.kind === 'C');
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
      ]} />
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
  return m ? (m.kind === 'AOG' ? `AOG repair at ${m.at}` : `${m.kind}-check at ${m.at}`) : 'Maintenance';
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
      <Modal title={titleOf(g, cur)} icon={m ? <Wrench className="accent" /> : undefined} onClose={close} footer={live.length > 1 ? <button className="btn btn-ghost" onClick={() => setOpen(null)}><ChevronLeft /> All {live.length}</button> : undefined}>
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
              <span className="muted">{fmtDateTime(t)} UTC{f ? ` · ${KIND[f.kind]}` : ''}</span>
            </button>
          );
        })}
        {!live.length && <div className="muted">Nothing here any more.</div>}
      </div>
    </Modal>
  );
}
