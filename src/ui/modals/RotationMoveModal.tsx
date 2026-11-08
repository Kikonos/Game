// v0.19 moving a whole rotation earlier or later (docs/UPDATE-0.19.md §D.4, §H.5): from a drag on the Schedule or
// the route page. The quote (net-ops quoteMoveRotation, pure) gives the new departure, the passengers' cost by notice,
// the reputation dent and why a move is refused; every sector follows the first, turns kept.

import { CalendarClock, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { rotationOfId } from '../screens/network/live';
import { net } from '../screens/network/netApi';
import { chainOf, routeName } from '../screens/network/networkLogic';
import { Modal, Stepper } from '../components/ui';
import { int, money } from '../format';
import { store, useGame, type ModalSpec } from '../store';

/** '+2 h 15 min later' / '45 min earlier' / '+1 day 3 h later'. */
export function shiftWords(delta: number): string {
  if (!delta) return 'no change';
  const a = Math.abs(delta);
  const d = Math.floor(a / DAY);
  const h = Math.floor((a % DAY) / 60);
  const m = a % 60;
  const parts = [d ? `${d} day${d > 1 ? 's' : ''}` : '', h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ');
  return `${parts} ${delta > 0 ? 'later' : 'earlier'}`;
}

function SectorTimes({ g, rotId, delta }: { g: GameState; rotId: string; delta: number }) {
  const at = rotationOfId(g, rotId);
  if (!at) return null;
  return (
    <div className="tm-legs">
      {at.rot.sectors.map((s, i) => {
        const f = s.flightId ? g.flights[s.flightId] : undefined;
        const std = (f ? f.std : i === 0 ? at.rot.dep : undefined);
        return (
          <div key={i} className="tm-leg">
            <b className="mono">{f?.no ?? ''} {s.from} → {s.to}</b>
            {std !== undefined ? (
              <span className="num small">{fmtDay(std + delta)} {fmtTime(std + delta)} UTC · {fmtTime(std + delta, s.from)} {s.from}{delta ? <span className="dim"> (was {fmtTime(std)})</span> : null}</span>
            ) : <span className="small muted">follows the sector before</span>}
          </div>
        );
      })}
    </div>
  );
}

export function RotationMoveModal({ rotId, delta: d0, back }: { rotId: string; delta: number; back?: ModalSpec }) {
  const g = useGame();
  const [delta, setDelta] = useState(d0);
  const close = () => (back ? store.openModal(back) : store.closeModal());
  const at = rotationOfId(g, rotId);
  const q = useMemo(() => (delta ? net.quoteMove(g, rotId, delta) : null), [g.network?.rev, rotId, delta]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!at) return <Modal title="Move" onClose={close}><p className="muted">This rotation is no longer planned.</p></Modal>;
  const { route, rot } = at;
  const pax = rot.sectors.reduce((a, s) => a + s.bookedJ + s.bookedY, 0);
  const days = Math.max(0, Math.round((rot.dep - g.now) / DAY));
  const go = () => {
    const r = store.act((gg) => (net.move(gg, rotId, delta) ? { ok: true, msg: `${routeName(route)} ${fmtDay(rot.dep)}: moved ${shiftWords(delta)}` } : { ok: false, error: q?.why ?? 'Could not move it' }));
    if (r.ok) close();
  };
  return (
    <Modal className="mm-modal nw-move" title={`Move ${routeName(route)} · ${fmtDay(rot.dep)}`} icon={<CalendarClock className="accent" />} onClose={close} footer={
      <>
        {q && !q.ok && <span className="grow small bad mm-foot-why">{q.why}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={!q || !q.ok}><CalendarClock /> Move {shiftWords(delta).replace(/ (later|earlier)$/, '')}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="small muted">{chainOf(rot)} · the whole rotation moves together, with the same turn times.</div>
        <div className="row gap-8 wrap nw-move-ctl">
          <button className="btn btn-sm" onClick={() => setDelta(delta - DAY)}>−1 day</button>
          <Stepper value={delta} min={-14 * DAY} max={14 * DAY} step={15} onChange={setDelta} format={(v) => (v ? `${v > 0 ? '+' : '−'}${Math.floor(Math.abs(v) / 60)}:${String(Math.abs(v) % 60).padStart(2, '0')}` : '±0')} />
          <button className="btn btn-sm" onClick={() => setDelta(delta + DAY)}>+1 day</button>
        </div>
        <SectorTimes g={g} rotId={rotId} delta={delta} />
        {q && q.ok && (
          <div className="mm-usage good">
            <b>{q.cost > 0 ? `About ${money(q.cost)} for ${int(pax)} booked passenger${pax === 1 ? '' : 's'}` : pax ? 'No cost: plenty of notice' : 'No one booked yet: no cost'}</b>
            <span className="small">{days >= 14 ? 'With 14 days or more of notice a move costs little.' : `${days} days' notice: rebooking costs more close to the day.`}{q.repDelta ? ` Route reputation ${q.repDelta}.` : ''}</span>
          </div>
        )}
        {q && q.ok && (q.notes?.length || q.knock?.length) ? <ul className="tm-notes small">{[...(q.notes ?? []), ...(q.knock ?? [])].map((n) => <li key={n}>{n}</li>)}</ul> : null}
        {q && !q.ok && <div className="tm-verdict blocked"><b><TriangleAlert /> Can't move it there</b><span className="small">{q.why}</span></div>}
        {!delta && <div className="small muted">Use the buttons to move it earlier or later.</div>}
      </div>
    </Modal>
  );
}
