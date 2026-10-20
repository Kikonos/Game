// Sub-charter (B5 + integration): hand a rotation, some days of a base programme or the rest of a charter to a
// rival operator at their price. The client is still billed; reliability takes no hit. Compared with cancelling.

import { Handshake } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { DAY, fmtDateTime, fmtDay } from '../../engine/core/time';
import { Modal, Toggle } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { store, useGame } from '../store';
import type { Flight } from '../../engine/core/types';
import { rotationOf, subcharter, subcharterable, subcharterQuote } from '../../engine/ops';

const MAX_DAYS = 14;

/** Legs grouped by UTC day of departure. */
function legsByDay(legs: Flight[]): { day: number; legs: Flight[] }[] {
  const m = new Map<number, Flight[]>();
  for (const f of legs) {
    const d = Math.floor((f.std + f.delay) / DAY);
    m.set(d, [...(m.get(d) ?? []), f]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([day, l]) => ({ day, legs: l }));
}

export function SubcharterModal({ contractId, flightId }: { contractId: string; flightId?: string }) {
  const g = useGame();
  const c = g.contracts[contractId];
  const rev = flightsRev(g);
  const all = useMemo(() => subcharterable(g, contractId), [g, contractId, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const base = c?.pattern.kind === 'base';
  const days = useMemo(() => legsByDay(all).filter((d) => d.legs.some((x) => x.kind === 'revenue' || x.kind === 'techstop')).slice(0, MAX_DAYS), [all]);
  const f = flightId ? g.flights[flightId] : undefined;
  const rot = useMemo(() => (f && f.status === 'scheduled' ? rotationOf(g, f.id) : []), [g, f, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rot.length || !base ? [] : days.slice(0, 1).map((d) => d.day)));
  const [mode, setMode] = useState<'rotation' | 'days' | 'rest'>(rot.length ? 'rotation' : base ? 'days' : 'rest');
  const close = () => store.closeModal();
  if (!c) return null;
  const legs = mode === 'rotation' ? rot : mode === 'rest' ? all : days.filter((d) => picked.has(d.day)).flatMap((d) => d.legs);
  const q = legs.length ? subcharterQuote(g, legs.map((x) => x.id)) : null;
  const go = () => {
    if (!q) return;
    const r = store.act((gg) => subcharter(gg, q.flightIds, q.cost));
    if (r.ok) close();
  };
  const toggle = (d: number, on: boolean) => {
    const s = new Set(picked);
    if (on) s.add(d);
    else s.delete(d);
    setPicked(s);
  };
  return (
    <Modal title={`Sub-charter: ${c.title}`} icon={<Handshake className="accent" />} onClose={close} footer={
      <>
        <button className="btn" onClick={close}>Keep flying it</button>
        <button className="btn btn-primary" onClick={go} disabled={!q || !q.revenueLegs}>Hand over for {q ? money(q.cost) : '—'}</button>
      </>
    }>
      <div className="col gap-12">
        <p className="muted sc-blurb">A rival operator flies the legs with its own aircraft and crew. {g.clients[c.clientId]?.name ?? 'The client'} is billed by us as usual; we pay the rival. Empty positioning legs in the selection are dropped.</p>
        <div className="row gap-8 wrap">
          {rot.length > 0 && <button className={`chip ${mode === 'rotation' ? 'active' : ''}`} onClick={() => setMode('rotation')}>This rotation ({rot.length} leg{rot.length > 1 ? 's' : ''})</button>}
          {base && <button className={`chip ${mode === 'days' ? 'active' : ''}`} onClick={() => setMode('days')}>Pick days</button>}
          <button className={`chip ${mode === 'rest' ? 'active' : ''}`} onClick={() => setMode('rest')}>Everything still to fly ({all.length})</button>
        </div>
        {mode === 'rotation' && f && (
          <div className="small muted">{rot.map((x) => `${x.no} ${x.from}–${x.to}`).join(' · ')} · from {fmtDateTime(rot[0]?.std ?? f.std)} UTC</div>
        )}
        {mode === 'days' && (
          <div className="col sc-subdays">
            {!days.length && <div className="small muted">No legs left that can still be handed over (at least 6 h before departure).</div>}
            {days.map((d) => (
              <div key={d.day} className="set-row sc-policy">
                <div><b>{fmtDay(d.day * DAY)}</b><div className="small muted">{d.legs.length} leg{d.legs.length > 1 ? 's' : ''} · {d.legs.map((x) => x.to).filter((x, i, a) => a.indexOf(x) === i).slice(0, 4).join(', ')}</div></div>
                <Toggle on={picked.has(d.day)} onChange={(v) => toggle(d.day, v)} label={fmtDay(d.day * DAY)} />
              </div>
            ))}
          </div>
        )}
        {q && q.revenueLegs > 0 ? (
          <KV rows={[
            ['Operator', q.rivalName],
            ['Legs', `${q.revenueLegs} revenue leg${q.revenueLegs > 1 ? 's' : ''} · ${q.bh.toFixed(1)} BH`],
            ['Still billed to the client', money(q.revenue)],
            ['Their price', money(q.cost)],
            ['Cancelling instead', q.cancel ? `${money(q.cancel)} compensation, reliability falls` : 'no compensation, reliability falls'],
          ]} />
        ) : (
          <div className="small muted">Choose legs to hand over.</div>
        )}
      </div>
    </Modal>
  );
}
