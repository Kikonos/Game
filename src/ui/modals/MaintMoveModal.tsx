// v0.7.2.2 Check planning: the small confirm after dragging a booked A-check, C-check or cabin refit along its
// aircraft's row in the Schedule. One question, the interval usage then (green / amber / red), the ferries it needs
// and plain notes; everything from quoteMaintMove (previewed on a copy: exactly what the move does).

import { CalendarClock, Plane, TriangleAlert } from 'lucide-react';
import { fmtDayRel, fmtTime } from '../../engine/core/time';
import { maintWord, movableMaint, moveMaint, quoteMaintMove } from '../../engine/ops/maintMove';
import { Modal } from '../components/ui';
import { store, useGame } from '../store';


export function MaintMoveModal({ maintId, start }: { maintId: string; start: number }) {
  const g = useGame();
  const close = () => store.closeModal();
  // v0.12.1 a check moved into next year says so.
  const fmtDay = (t: number) => fmtDayRel(t, g.now);
  const when = (t: number) => `${fmtDay(t)} ${fmtTime(t)}`;
  const m = g.maintenance[maintId];
  const ac = m ? g.fleet[m.aircraftId] : undefined;
  if (!m || !ac) return <Modal title="Move" onClose={close}><p className="muted">This booking is no longer in the schedule.</p></Modal>;
  // v0.12.1 a booking that can't move (client paint) says why and nothing else (no 'same price ()' line).
  const mv = movableMaint(g, maintId);
  if (!mv.ok) return <Modal title={`Move ${maintWord(m)}`} icon={<CalendarClock className="accent" />} onClose={close}><p className="muted">{mv.reason}</p></Modal>;
  const q = quoteMaintMove(g, maintId, start);
  const what = maintWord(m);
  const refit = m.kind === 'refit';
  const title = refit ? `Move ${what} to ${when(q.start)} – ${fmtDay(q.end)}?` : `Move ${what} to ${when(q.start)}?`;
  const go = () => {
    const r = store.act((gg) => moveMaint(gg, maintId, start));
    if (r.ok) close();
  };
  const added = q.legs.filter((l) => l.added);
  return (
    <Modal className="mm-modal" title={title} icon={<CalendarClock className="accent" />} onClose={close} footer={
      <>
        {!q.ok && <span className="grow small bad mm-foot-why">{q.reason}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={go} disabled={!q.ok}><CalendarClock /> Move {what}</button>
      </>
    }>
      <div className="col gap-12">
        <div className="small muted">{ac.reg} · now {when(m.start)} – {fmtDay(m.end)} UTC at {m.at}</div>
        {q.used !== null ? (
          <div className={`mm-usage ${q.level ?? ''}`}>
            <b>Usage then: {Math.round(q.used * 100)}%</b>
            <span className="small">{q.level === 'bad' ? 'overdue by then: not allowed' : q.level === 'warn' ? 'close to the limit' : 'well within the interval'}</span>
          </div>
        ) : (
          <div className="mm-usage good"><b>{ac.reg} out of service {Math.round((q.end - q.start) / 1440)} days</b><span className="small">{m.restFit ? 'same crew rest work, same price' : m.refit?.cabin.label ? `same layout, same price (${m.refit.cabin.label})` : 'same work, same price'}</span></div>
        )}
        {!q.ok && (
          <div className="tm-verdict blocked"><b><TriangleAlert /> Can't move it there</b><span className="small">{q.reason}</span></div>
        )}
        {q.ok && added.length > 0 && (
          <div className="tm-legs">
            {added.map((l) => (
              <div key={`${l.from}${l.std}`} className="tm-leg tm-ferry">
                <span className="tm-tag">FERRY</span>
                <b>{l.from} → {l.to}</b>
                <span className="num">{when(l.std)}–{fmtTime(l.sta)}</span>
              </div>
            ))}
          </div>
        )}
        {q.ok && (
          <ul className="tm-notes small">
            {q.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        {q.ok && !added.length && !q.legs.length && <div className="tiny dim row gap-6"><Plane className="sc-ico-s" /> No flights change.</div>}
      </div>
    </Modal>
  );
}
