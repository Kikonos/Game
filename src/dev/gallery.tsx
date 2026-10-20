// Dev-only aircraft art gallery: /gallery.html?types=a320neo,b738&livery=redsplit&bg=dark&size=hero&compare=1
// See src/ui/components/aircraft/README.md for all parameters.
// Traced-profile checks (crops served from /dev-ref/<type>/ by the vite dev-ref plugin):
//   ?gallery=compare&type=a320ceo   art over the reference crop at the crop's own pixel scale, nose aligned
//     &k=3 (crop px per source px; crop.png is the source ×3) &nx=&ny= (nose tip in crop px, auto from mask.png)
//     &op=0.5 &zoom=1 &under=1 (art under the crop) &crop=<id> (borrow another type's crop)
//   ?gallery=sheet[&w=440]          every traced type: crop | art at the same scale | overlay

import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '../styles/app.css';
import '../styles/screens.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACMI_TYPES_LIST } from '../data/acmiTypes';
import { AIRCRAFT } from '../data/aircraft';
import type { Livery } from '../engine/core/types';
import { AircraftArt, artMetrics, artViewBox } from '../ui/components/aircraft/AircraftArt';
import { TRACED } from '../ui/components/aircraft/traced/load';

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
const types = (list('types') ?? Object.keys(NAMES)).filter((id) => NAMES[id] || TRACED.has(id));
const liveryKey = q.get('livery') ?? 'blockhours';
const livery = LIVERIES[liveryKey] ?? LIVERIES.blockhours;
const bgs = (list('bg') ?? Object.keys(BGS)).filter((b) => BGS[b]);
const sizes = (list('size') ?? [...SIZES]).filter((s): s is Size => (SIZES as readonly string[]).includes(s));
const code = q.get('code') ?? (liveryKey === 'used' ? undefined : 'BH');
const name = q.get('name') ?? (liveryKey === 'used' ? undefined : 'Block Hours');
const compare = q.get('compare') === '1';
/** 'compare' = one type over its reference crop, 'sheet' = every traced type next to its crop. */
const mode = q.get('gallery');
const num = (k: string, d: number) => { const v = Number(q.get(k)); return Number.isFinite(v) && q.get(k) !== null ? v : d; };
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
  .g-ref { position: relative; overflow: hidden; background: #6f8fc4; border-radius: 6px; }
  .g-ref img { position: absolute; left: 0; top: 0; display: block; }
  .g-ref-art { position: absolute; line-height: 0; transform: scaleX(-1); }
  .g-ref-cross { position: absolute; width: 0; height: 0; pointer-events: none; }
  .g-ref-cross::before, .g-ref-cross::after { content: ''; position: absolute; background: #ff2d55; }
  .g-ref-cross::before { left: -12px; top: 0; width: 25px; height: 1px; }
  .g-ref-cross::after { left: 0; top: -12px; width: 1px; height: 25px; }
  .g-ref-info { font: 500 12px/1.5 var(--font-mono); color: #93a0bb; margin: 8px 0 18px; white-space: pre-wrap; }
  .g-sheet-row { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
  .g-sheet-row h3 { font: 600 12px/1.2 var(--font-mono); margin: 0 0 6px; color: #e8eefc; }
`;

// ---------- traced-profile reference overlays ----------

interface Crop { W: number; H: number; src: string; nose: [number, number] | null; /** Rightmost aircraft column (tail cone or stabiliser tip). */ aft: number | null; error?: string }

/** Nose tip (leftmost aircraft pixel) and aft-most column of mask.png, else of crop.png by colour distance to the row's edge pixels. */
function findNose(img: HTMLImageElement, binary: boolean): [number, number, number] | null {
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  const set = new Uint8Array(W * H);
  let n = 0;
  if (binary) {
    for (let i = 0; i < W * H; i++) if (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2] > 382) { set[i] = 1; n++; }
    if (n > (W * H) / 2) { for (let i = 0; i < W * H; i++) set[i] = set[i] ? 0 : 1; }
  } else {
    const px = (x: number, y: number) => [d[(y * W + x) * 4], d[(y * W + x) * 4 + 1], d[(y * W + x) * 4 + 2]];
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (let y = 0; y < H; y++) {
      const l = px(1, y), r = px(W - 2, y);
      for (let x = 0; x < W; x++) {
        const v = px(x, y);
        if (dist(v, l) > 48 && dist(v, r) > 48) set[y * W + x] = 1;
      }
    }
  }
  // first / last column with two set pixels whose neighbour column is set too (skips specks)
  const rowsAt = (x: number) => {
    const rows: number[] = [];
    for (let y = 0; y < H; y++) if (set[y * W + x] && (set[y * W + x + 1] || set[y * W + x - 1])) rows.push(y);
    return rows;
  };
  let aft = -1;
  for (let x = W - 2; x > 0 && aft < 0; x--) if (rowsAt(x).length >= 2) aft = x;
  for (let x = 1; x < W - 1; x++) {
    const rows = rowsAt(x);
    if (rows.length >= 2) {
      rows.sort((a, b) => a - b);
      return [x, rows[Math.floor(rows.length / 2)], aft];
    }
  }
  return null;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, err) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => err(new Error(`cannot load ${src}`));
    im.src = src;
  });
}

function useCrop(id: string): Crop | null {
  const [crop, setCrop] = useState<Crop | null>(null);
  useEffect(() => {
    let live = true;
    // &crop=<id> borrows another type's crop folder (e.g. a traced variant sharing a reference)
    const base = `${q.get('ref') ?? '/dev-ref'}/${q.get('crop') ?? id}`;
    (async () => {
      try {
        const im = await load(`${base}/crop.png`);
        let found: [number, number, number] | null = null;
        try { found = findNose(await load(`${base}/mask.png`), true); } catch { /* no mask: segment the crop */ }
        found ??= findNose(im, false);
        if (live) setCrop({ W: im.naturalWidth, H: im.naturalHeight, src: im.src, nose: found && [found[0], found[1]], aft: found && found[2] });
      } catch (e) {
        if (live) setCrop({ W: 0, H: 0, src: '', nose: null, aft: null, error: String(e) });
      }
    })();
    return () => { live = false; };
  }, [id]);
  return crop;
}

/** Art (mirrored to the crop's nose-left frame) at the crop's pixel scale, nose tip on the crop's nose tip. */
function RefOverlay({ id, crop, zoom, opacity, under, showCrop = true, showArt = true }: { id: string; crop: Crop; zoom: number; opacity: number; under?: boolean; showCrop?: boolean; showArt?: boolean }) {
  const m = artMetrics(id);
  const t = m.traced;
  if (!t) return <div className="g-ref-info">{id}: no traced profile</div>;
  // crop.png is the source crop upscaled x3 (contract): the art spans exactly lengthPx x 3 crop pixels
  const k = num('k', 3);
  const ppm = (t.lengthPx * k) / m.length;
  const nose: [number, number] = [num('nx', crop.nose?.[0] ?? 0), num('ny', crop.nose?.[1] ?? crop.H / 2)];
  const { vb, tip } = m;
  const left = nose[0] - (vb.x + vb.w - tip[0]) * ppm;
  const top = nose[1] - (tip[1] - vb.y) * ppm;
  const art = (
    <div className="g-ref-art" style={{ left, top, width: vb.w * ppm, height: vb.h * ppm, opacity: under ? 1 : opacity }}>
      <AircraftArt typeId={id} livery={livery} pxPerM={ppm} />
    </div>
  );
  return (
    <div style={{ width: crop.W * zoom, height: crop.H * zoom, overflow: 'hidden' }}>
      <div className="g-ref" data-type={id} style={{ width: crop.W, height: crop.H, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
        {under && showArt && art}
        {showCrop && <img src={crop.src} width={crop.W} height={crop.H} alt="" style={{ opacity: under && showArt ? opacity : 1 }} />}
        {!under && showArt && art}
        {showCrop && <div className="g-ref-cross" style={{ left: nose[0], top: nose[1] }} />}
      </div>
    </div>
  );
}

function refInfo(id: string, crop: Crop): string {
  const m = artMetrics(id);
  const t = m.traced;
  if (!t) return `${id}: no traced profile`;
  const k = num('k', 3);
  const span = crop.nose && crop.aft !== null ? crop.aft - crop.nose[0] : null;
  const len = t.lengthPx * k;
  return `${id} · ${t.source}\ncrop ${crop.W}×${crop.H}px · lengthPx ${t.lengthPx} × k ${k} = ${len.toFixed(0)}px for ${m.length.toFixed(2)} m (${(len / m.length).toFixed(2)} px/m)`
    + `${span ? ` · mask nose→aft-most span ${span}px (${((span / len - 1) * 100).toFixed(1)}% vs lengthPx; tail cone or stabiliser tip)` : ''}`
    + `\nnose tip ${crop.nose ? `${crop.nose[0]},${crop.nose[1]}px (from mask/crop)` : 'not found'}${q.get('nx') ? ` · override ${q.get('nx')},${q.get('ny')}` : ''}`;
}

function CompareRef({ id }: { id: string }) {
  const crop = useCrop(id);
  if (!crop) return <div className="g-ref-info">loading {id} …</div>;
  if (crop.error) return <div className="g-ref-info">{crop.error} (is dev-ref → trace folder linked and the vite dev-ref plugin running?)</div>;
  return (
    <>
      <div className="g-ref-info">{refInfo(id, crop)}</div>
      <RefOverlay id={id} crop={crop} zoom={num('zoom', 1)} opacity={num('op', 0.5)} under={q.get('under') === '1'} />
    </>
  );
}

function SheetRow({ id, w }: { id: string; w: number }) {
  const crop = useCrop(id);
  if (!crop) return <div className="g-ref-info">loading {id} …</div>;
  if (crop.error) return <div className="g-ref-info">{id}: {crop.error}</div>;
  const zoom = w / crop.W;
  return (
    <div>
      <h3>{refInfo(id, crop).replace(/\n/g, ' · ')}</h3>
      <div className="g-sheet-row" data-type={id}>
        <RefOverlay id={id} crop={crop} zoom={zoom} opacity={1} showArt={false} />
        <RefOverlay id={id} crop={crop} zoom={zoom} opacity={1} showCrop={false} />
        <RefOverlay id={id} crop={crop} zoom={zoom} opacity={num('op', 0.5)} />
      </div>
    </div>
  );
}

function Cell({ id, size }: { id: string; size: Size }) {
  const props = size === 'mini'
    ? { detail: 'simple' as const, height: 36 }
    : size === 'card' ? { height: 110 } : {};
  return (
    <figure className="g-cell" data-type={id} data-size={size}>
      <div className="g-box">
        <AircraftArt typeId={id} livery={livery} code={size === 'mini' ? undefined : code} name={size === 'mini' ? undefined : name} {...props} />
      </div>
      <figcaption>{size === 'mini' ? id : `${id} · ${NAMES[id] ?? 'traced only'}`}</figcaption>
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
      {mode === 'compare' ? (
        (list('type') ?? types.filter((id) => TRACED.has(id))).map((id) => <CompareRef key={id} id={id} />)
      ) : mode === 'sheet' ? (
        [...TRACED.keys()].sort().map((id) => <SheetRow key={id} id={id} w={num('w', 440)} />)
      ) : compare ? (
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
