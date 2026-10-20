// Check planning (B5): A- or C-check for one aircraft. Suggests ground gaps at eligible airports
// (ops.groundGaps / checkAirportOk) or a custom slot; books through ops.scheduleCheck. DESIGN.md §6.3.

import { Wrench } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { DAY, HOUR, dayStart, fmtDate, fmtDateTime, fmtDay } from '../../engine/core/time';
import type { ActionResult, GameState } from '../../engine/core/types';
import { cancelCheck, checkAirportOk, checkStatus, groundGaps, scheduleCheck } from '../../engine/ops';
import { Modal, Seg, Stepper } from '../components/ui';
import { KV } from '../screens/common';
import { durLabel } from '../screens/scheduleLogic';
import { store, useGame } from '../store';

type Kind = 'A' | 'C';
interface Slot { start: number; at: string; gap: number }

function suggestions(g: GameState, acId: string, kind: Kind, dur: number): Slot[] {
  const ac = g.fleet[acId];
  if (!ac) return [];
  const until = g.now + (kind === 'A' ? 60 : 240) * DAY;
  const out: Slot[] = [];
  for (const gp of groundGaps(g, ac, g.now + HOUR, until)) {
    if (!checkAirportOk(g, kind, gp.at)) continue;
    const start = Math.ceil((gp.from + 30) / 30) * 30;
    if (start + dur + 60 > gp.to) continue;
    out.push({ start, at: gp.at, gap: gp.to - gp.from });
    if (out.length >= 6) break;
  }
  return out;
}

export function CheckModal({ aircraftId, checkKind, replace }: { aircraftId: string; checkKind?: Kind; replace?: string }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const [kind, setKind] = useState<Kind>(checkKind ?? 'A');
  const [pick, setPick] = useState<number>(0);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState(22);
  const [at, setAt] = useState(g.company.homeBase);
  const rev = flightsRev(g);
  const t = ac ? typeOf(ac.typeId) : null;
  const dur = t ? (kind === 'A' ? t.aCheckHours * HOUR : t.cCheckDays * DAY) : 0;
  const slots = useMemo(() => suggestions(g, aircraftId, kind, dur), [g, aircraftId, kind, dur, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ac || !t) return null;
  const st = checkStatus(g, ac);
  const custom = pick === -1;
  const chosen: Slot | undefined = custom ? { start: dayStart(g.now) + day * DAY + hour * HOUR, at, gap: 0 } : slots[pick];
  const airports = [g.company.homeBase, ac.at].filter((x, i, a) => a.indexOf(x) === i && checkAirportOk(g, kind, x));
  const old = replace ? g.maintenance[replace] : undefined;

  const book = () => {
    if (!chosen) return;
    const res = store.act((gg): ActionResult<{ maintId: string }> => {
      if (old && old.status === 'planned') {
        const c = cancelCheck(gg, old.id);
        if (!c.ok) return c;
        const r = scheduleCheck(gg, ac.id, kind, chosen.start, chosen.at);
        if (!r.ok) scheduleCheck(gg, ac.id, old.kind, old.start, old.at);
        return r;
      }
      return scheduleCheck(gg, ac.id, kind, chosen.start, chosen.at);
    });
    if (res.ok) store.closeModal();
  };

  return (
    <Modal title={`Plan a check: ${ac.reg}`} icon={<Wrench className="accent" />} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className="btn btn-primary" onClick={book} disabled={!chosen}><Wrench /> Book {kind}-check</button>
      </>
    }>
      <div className="col gap-16">
        <div className="row between wrap gap-12">
          <Seg<Kind> value={kind} onChange={(k) => { setKind(k); setPick(0); }} options={[{ value: 'A', label: 'A-check' }, { value: 'C', label: 'C-check' }]} />
          <span className="small muted">{kind === 'A' ? `${t.aCheckHours} h` : `${t.cCheckDays} days`} · {kind === 'A' ? 'home base or a major airport' : 'home base only'}</span>
        </div>
        <KV rows={[
          ['A-check due', `${fmtDate(st.aDue)} · ${Math.max(0, st.aHoursLeft)} FH left (${Math.round(st.aUsed * 100)}% used)`],
          ['C-check due', `${fmtDate(st.cDue)} · ${Math.round(st.cUsed * 100)}% used`],
          ...(old ? [['Replacing', `${old.kind}-check ${fmtDateTime(old.start)} at ${old.at}`] as [string, string]] : []),
        ]} />
        <div className="upper dim">Suggested slots</div>
        <div className="col gap-8">
          {!slots.length && <div className="small muted">No free ground time long enough at an eligible airport. Pick a custom slot: legs in the way must be cleared first.</div>}
          {slots.map((s, i) => (
            <button key={s.start} className={`sc-slot ${pick === i ? 'on' : ''}`} onClick={() => setPick(i)}>
              <b>{fmtDateTime(s.start)} UTC</b>
              <span className="muted">{s.at} · {AIRPORT_BY_CODE[s.at]?.city}</span>
              <span className="dim small">ground time {durLabel(s.gap)}</span>
            </button>
          ))}
          <button className={`sc-slot ${custom ? 'on' : ''}`} onClick={() => setPick(-1)}>
            <b>Custom slot</b>
            <span className="muted">{custom && chosen ? `${fmtDateTime(chosen.start)} UTC at ${chosen.at}` : 'Choose a date, time and airport'}</span>
          </button>
          {custom && (
            <div className="row wrap gap-16 sc-custom">
              <div className="field"><label>Day</label><Stepper value={day} min={0} max={240} onChange={setDay} format={(v) => fmtDay(dayStart(g.now) + v * DAY)} /></div>
              <div className="field"><label>Start (UTC)</label><Stepper value={hour} min={0} max={23} onChange={setHour} format={(v) => `${String(v).padStart(2, '0')}:00`} /></div>
              <div className="field"><label>Airport</label><Seg<string> value={at} onChange={setAt} options={airports.map((a) => ({ value: a, label: a }))} /></div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
