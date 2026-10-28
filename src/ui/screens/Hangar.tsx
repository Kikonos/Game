// v0.12 Visual B: the hangar line-up (Fleet › Hangar). Every aircraft in its livery side by side at one scale from its
// real length, biggest first, its registration and name under it; a tap opens its card. Rows wrap (one aircraft or
// thirty and more), offscreen rows skip their paint (content-visibility). It renders only when the line-up changes
// (a key of registrations, names, liveries and status), never on a clock tick.
// v0.12 From above (the default): every aircraft as its top-down silhouette from the real length and span, on a floor
// gridded every 10 m, nose up and tails on one line, so the size difference reads at a glance.

import { memo, useLayoutEffect, useRef, useState } from 'react';
import { ACMI_TYPES } from '../../data/acmiTypes';
import type { Aircraft, GameState, Livery } from '../../engine/core/types';
import { AircraftArt } from '../components/AircraftArt';
import { mapLivery } from '../map/mapLogic';
import { inkOf } from '../map/LiveLayers';
import { silColour, silhouette, silSpec } from '../map/silhouettes';
import { Seg } from '../components/ui';
import { store } from '../store';
import { type HangarItem, hangarOrder, hangarScale, topScale } from './hangarLogic';

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

type HangarLook = 'top' | 'side';
const HANGAR_LOOK_KEY = 'bh.hangarLook';
/** v0.12 the hangar's last look (per device; From above unless Side was picked). */
function readHangarLook(): HangarLook {
  try { return localStorage.getItem(HANGAR_LOOK_KEY) === 'side' ? 'side' : 'top'; } catch { return 'top'; }
}
function writeHangarLook(v: HangarLook) {
  try { if (v === 'side') localStorage.setItem(HANGAR_LOOK_KEY, v); else localStorage.removeItem(HANGAR_LOOK_KEY); } catch { /* not stored */ }
}
/** '37.6', '72.7': one decimal, no trailing zero. */
const fmtM = (m: number) => (Math.round(m * 10) / 10).toString();

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
  const [look, setLookState] = useState<HangarLook>(readHangarLook);
  const setLook = (v: HangarLook) => { writeHangarLook(v); setLookState(v); };
  const open = (id: string) => store.navigate('fleet', { view: 'fleet', sel: { kind: 'aircraft', id } });
  const head = <div className="hg-head"><Seg<HangarLook> value={look} onChange={setLook} options={[{ value: 'top', label: 'From above' }, { value: 'side', label: 'Side' }]} /></div>;
  if (look === 'top') {
    // From above the footprint (length × span) sets the order: an A380 leads, wider than any 747.
    const top = rows.map((r) => ({ r, d: silSpec(r.typeId) })).sort((a, b) => b.d.L * b.d.S - a.d.L * a.d.S || a.r.reg.localeCompare(b.r.reg));
    const kt = topScale((width || 1000) - 32, top.map((x) => x.d.S));
    return (
      <div className="hg card hg-top" ref={ref} aria-label="Hangar: the fleet from above, to scale" style={{ ['--hg-m' as string]: `${(10 * kt).toFixed(2)}px` }}>
        {head}
        <div className="hg-floor">
          {top.map(({ r, d }) => {
            const sil = silhouette(r.typeId, Math.max(d.L, d.S) * kt);
            const ink = inkOf(silColour(r.typeId));
            const w = d.S * kt;
            const h = d.L * kt;
            return (
              <button key={r.id} className="hg-plane" onClick={() => open(r.id)} aria-label={`${r.reg}${r.name ? ` ${r.name}` : ''}, ${ACMI_TYPES[r.typeId]?.name ?? r.typeId}, ${d.L} m long, ${d.S} m span: open its card`}>
                <svg width={w} height={h} viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} aria-hidden>
                  <path d={sil.engines} fill={ink.eng} stroke={ink.edge} strokeWidth={1.2} strokeLinejoin="round" paintOrder="stroke" />
                  <path d={sil.body} fill={ink.fill} stroke={ink.edge} strokeWidth={1.4} strokeLinejoin="round" paintOrder="stroke" />
                  {sil.deck && <path d={sil.deck} fill={ink.deck} />}
                </svg>
                <span className="hg-tag"><b className="mono">{r.reg}</b>{r.name && <span className="hg-name ellipsis">{r.name}</span>}</span>
                <span className="tiny muted hg-type">{ACMI_TYPES[r.typeId]?.short ?? r.typeId} · {fmtM(d.L)} × {fmtM(d.S)} m</span>
              </button>
            );
          })}
        </div>
        <div className="tiny dim hg-foot row gap-8"><span className="hg-bar" aria-hidden />10 m · from above, to scale: real lengths and wingspans, {rows.length} aircraft. Tap one for its card.</div>
      </div>
    );
  }
  const k = hangarScale(width || 1000, rows.map((r) => r.lengthM));
  return (
    <div className="hg card" ref={ref} aria-label="Hangar: the fleet to scale">
      {head}
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
