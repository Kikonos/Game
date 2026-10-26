// v0.12 Visual B: the hangar line-up (Fleet › Hangar). Every aircraft in its livery side by side at one scale from its
// real length, biggest first, its registration and name under it; a tap opens its card. Rows wrap (one aircraft or
// thirty and more), offscreen rows skip their paint (content-visibility). It renders only when the line-up changes
// (a key of registrations, names, liveries and status), never on a clock tick.

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { ACMI_TYPES } from '../../data/acmiTypes';
import type { Aircraft, GameState, Livery } from '../../engine/core/types';
import { AircraftArt } from '../components/AircraftArt';
import { mapLivery } from '../map/mapLogic';
import { store } from '../store';
import { type HangarItem, hangarOrder, hangarScale } from './hangarLogic';

export interface HangarRow extends HangarItem {
  livery: Livery;
  code?: string;
  titles?: string;
  /** One quiet word on where it is ('LIS', 'Flying', 'Delivering'). */
  where: string;
}

const WHERE: Partial<Record<Aircraft['status'], string>> = { flying: 'Flying', delivering: 'Delivering', leasedOut: 'Leased out', stored: 'Stored', maintenance: 'In the hangar', aog: 'AOG' };

/** The rows and their key (rebuilt with each game render; cheap: the view itself redraws only when the key moves). */
export function hangarRows(g: GameState): { rows: HangarRow[]; key: string } {
  const fleet = Object.values(g.fleet);
  const byId = new Map(fleet.map((a) => [a.id, a]));
  const rows = hangarOrder(fleet).map((it) => {
    const ac = byId.get(it.id)!;
    const lv = mapLivery(g, ac);
    return { ...it, livery: lv.livery, code: lv.code, titles: lv.name, where: WHERE[ac.status] ?? ac.at };
  });
  const key = rows.map((r) => `${r.id}|${r.reg}|${r.name ?? ''}|${r.sprite}|${r.where}|${r.code ?? ''}|${r.titles ?? ''}|${JSON.stringify(r.livery)}`).join('§');
  return { rows, key };
}

export const HangarView = memo(function HangarView({ rows }: { rows: HangarRow[]; k: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => setWidth(Math.round(es[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = hangarScale(width || 1000);
  const open = (id: string) => store.navigate('fleet', { view: 'fleet', sel: { kind: 'aircraft', id } });
  return (
    <div className="hg card" ref={ref} aria-label="Hangar: the fleet to scale">
      <div className="hg-line">
        {rows.map((r) => (
          <button key={r.id} className="hg-item" onClick={() => open(r.id)} aria-label={`${r.reg}${r.name ? ` ${r.name}` : ''}, ${ACMI_TYPES[r.typeId]?.name ?? r.typeId}: open its card`}>
            <span className="hg-art"><AircraftArt typeId={r.sprite} livery={r.livery} code={r.code} name={r.titles} reg={r.reg} acName={r.name} pxPerM={k} /></span>
            <span className="hg-tag">
              <b className="mono">{r.reg}</b>
              {r.name && <span className="hg-name ellipsis">{r.name}</span>}
            </span>
            <span className="tiny muted hg-type">{ACMI_TYPES[r.typeId]?.short ?? r.typeId} · {Math.round(r.lengthM)} m · {r.where}</span>
          </button>
        ))}
      </div>
      <div className="tiny dim hg-foot">To scale: real lengths, {rows.length} aircraft. Tap one for its card.</div>
    </div>
  );
}, (a, b) => a.k === b.k);
