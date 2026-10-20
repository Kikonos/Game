// Dev-only aircraft art gallery: /gallery.html?types=a320neo,b738&livery=redsplit&bg=dark&size=hero&compare=1
// See src/ui/components/aircraft/README.md for all parameters.

import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '../styles/app.css';
import '../styles/screens.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ACMI_TYPES_LIST } from '../data/acmiTypes';
import { AIRCRAFT } from '../data/aircraft';
import type { Livery } from '../engine/core/types';
import { AircraftArt, artViewBox } from '../ui/components/aircraft/AircraftArt';

// catalogue types plus the ACMI-only ones (a332, a343, a35u, b77l)
const NAMES: Record<string, string> = Object.fromEntries([...AIRCRAFT, ...ACMI_TYPES_LIST].map((t) => [t.id, t.name]));

const LIVERIES: Record<string, Livery> = {
  blockhours: { primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' },
  redsplit: { primary: '#d6283c', secondary: '#ffffff', tail: 'split' },
  greenstripe: { primary: '#0f9d76', secondary: '#f5c451', tail: 'stripe' },
  navysolid: { primary: '#0b1f4d', secondary: '#3ee6ff', tail: 'solid' },
  used: { primary: '#8792a8', secondary: '#c7cede', tail: 'solid' },
};
const BGS: Record<string, string> = { dark: '#111a2c', blue: '#6f8fc4' };
const SIZES = ['hero', 'card', 'mini'] as const;
type Size = (typeof SIZES)[number];

const q = new URLSearchParams(location.search);
const list = (k: string) => q.get(k)?.split(',').map((s) => s.trim()).filter(Boolean);
const types = (list('types') ?? Object.keys(NAMES)).filter((id) => NAMES[id]);
const liveryKey = q.get('livery') ?? 'blockhours';
const livery = LIVERIES[liveryKey] ?? LIVERIES.blockhours;
const bgs = (list('bg') ?? Object.keys(BGS)).filter((b) => BGS[b]);
const sizes = (list('size') ?? [...SIZES]).filter((s): s is Size => (SIZES as readonly string[]).includes(s));
const code = q.get('code') ?? (liveryKey === 'used' ? undefined : 'BH');
const name = q.get('name') ?? (liveryKey === 'used' ? undefined : 'Block Hours');
const compare = q.get('compare') === '1';
/** Fixed compare scale in CSS px per metre (default: widest type fills ~1150px). */
const ppm = Number(q.get('ppm')) || 0;

const css = `
  body { margin: 0; background: #070b14; color: #e8eefc; font-family: var(--font-ui); }
  .g-wrap { padding: 20px 24px 60px; }
  .g-head { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; margin-bottom: 14px; }
  .g-head h1 { font-size: 20px; margin: 0; }
  .g-head span { color: #93a0bb; font-size: 13px; }
  .g-size { margin: 22px 0; }
  .g-size h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.12em; color: #93a0bb; margin: 0 0 8px; }
  .g-panel { border-radius: 14px; padding: 16px; margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 14px; }
  .g-cell { margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .g-cell figcaption { font: 600 11px/1.2 var(--font-mono); color: rgba(232,238,252,0.75); }
  .g-panel[data-bg="blue"] figcaption { color: rgba(10,20,40,0.8); }
  .g-box { display: flex; align-items: center; justify-content: center; }
  .g-hero .g-box { width: 720px; }
  .g-card .g-box { width: 320px; height: 120px; border-radius: 10px; background: rgba(255,255,255,0.03); }
  .g-mini .g-box { width: 92px; height: 36px; }
  .g-mini figcaption { font-size: 9px; }
  .g-cmp { position: relative; border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 6px; width: max-content; min-width: 100%; box-sizing: border-box; }
  .g-cmp-row { margin: 0; display: flex; flex-direction: row; align-items: flex-end; justify-content: flex-start; gap: 0; }
  .g-cmp-row figcaption { width: 90px; margin-right: 12px; flex: none; align-self: center; font: 600 11px/1.2 var(--font-mono); color: rgba(232,238,252,0.75); text-align: right; }
  .g-cmp-art { flex: none; line-height: 0; }
  .g-cmp-nose { position: absolute; top: 12px; bottom: 12px; width: 0; border-left: 1px dashed rgba(232,238,252,0.18); pointer-events: none; }
  .g-cmp[data-bg="blue"] .g-cmp-nose { border-color: rgba(10,20,40,0.25); }
`;

function Cell({ id, size }: { id: string; size: Size }) {
  const props = size === 'mini'
    ? { detail: 'simple' as const, height: 36 }
    : size === 'card' ? { height: 110 } : {};
  return (
    <figure className="g-cell" data-type={id} data-size={size}>
      <div className="g-box">
        <AircraftArt typeId={id} livery={livery} code={size === 'mini' ? undefined : code} name={size === 'mini' ? undefined : name} {...props} />
      </div>
      <figcaption>{size === 'mini' ? id : `${id} · ${NAMES[id]}`}</figcaption>
    </figure>
  );
}

function Compare({ bg }: { bg: string }) {
  // every row shares one scale (px per metre) and ends at the nose tip (x = 0 m, nose right), so
  // lengths, heights and wing positions compare directly; turboprop discs etc. may poke past it
  const boxes = types.map((id) => ({ id, vb: artViewBox(id) }));
  const x0 = Math.min(...boxes.map((b) => b.vb.x));
  const k = ppm || Math.min(16, 1150 / Math.max(...boxes.map((b) => b.vb.x + b.vb.w - x0)));
  const nose = 20 + 90 + 12 + -x0 * k;
  return (
    <div className="g-cmp" data-bg={bg} data-ppm={k} style={{ background: BGS[bg] }}>
      <div className="g-cmp-nose" style={{ left: nose }} />
      {boxes.map(({ id, vb }) => (
        <figure className="g-cmp-row" key={id} data-type={id} data-size="compare">
          <figcaption>{id}</figcaption>
          <div className="g-cmp-art" style={{ marginLeft: (vb.x - x0) * k, width: vb.w * k }}>
            <AircraftArt typeId={id} livery={livery} code={code} name={name} pxPerM={k} />
          </div>
        </figure>
      ))}
    </div>
  );
}

function Gallery() {
  return (
    <div className="g-wrap">
      <style>{css}</style>
      <div className="g-head">
        <h1>Aircraft art</h1>
        <span>{types.length} types · livery {liveryKey} ({livery.tail})</span>
      </div>
      {compare ? (
        bgs.map((bg) => <Compare key={bg} bg={bg} />)
      ) : (
        sizes.map((size) => (
          <section className={`g-size g-${size}`} key={size} data-size={size}>
            <h2>{size}</h2>
            {bgs.map((bg) => (
              <div className="g-panel" key={bg} data-bg={bg} style={{ background: BGS[bg] }}>
                {types.map((id) => <Cell key={id} id={id} size={size} />)}
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
