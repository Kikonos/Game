// Dev-only aircraft art gallery (v0.10 raster sprites): /gallery.html?types=a320ceo,b738&livery=redsplit&bg=dark&size=hero
// See src/ui/components/aircraft/README.md for all parameters.
//   ?gallery=compare        every type at one scale (real length; &ppm=<CSS px per metre>)
//   ?gallery=logos[&types=] the 15 logos alone (64/28/14 px), tail badges, and each logo on each type's tail
//   ?gallery=clip[&stickers=0]  magenta stickers at scale 3 in the corners (stickers=0: the plain sprites)
//   ?gallery=editor[&types=] the LiveryEditor sheet with local state (#g-livery-json holds the value)
//   ?gallery=lod            each type in boxes 60…720 px wide (thumbnails, cards, rows)
//   ?gallery=layout         the measured layout over each sprite (fin, fin frame, sticker zone, title band)
//   &logo=<id>|mono &plain=1 &tail=<scheme> &codecolor=#hex &weight=500   override the chosen livery

import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import '../styles/app.css';
import '../styles/screens.css';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ACMI_TYPES_LIST } from '../data/acmiTypes';
import { BODY_PRESETS, bodyPreset, LOGO_IDS, type BodyPresetId, type LogoId } from '../data/livery';
import type { Livery, StickerPlacement, TailStyle } from '../engine/core/types';
import { AircraftArt } from '../ui/components/aircraft/AircraftArt';
import { LOGOS, LogoGlyph } from '../ui/components/aircraft/logos';
import { CLIENT_LIVERIES } from '../data/clientLiveries';
import { recipeLivery } from '../engine/ops/paint';
import { LENGTH_M, layoutOf, metresPerPx, SPRITE_IDS } from '../ui/components/aircraft/sprites';
import { finAt, polyPath, titleBand } from '../ui/components/aircraft/stickers';
import { TailBadge } from '../ui/components/Logo';
import { LiveryEditor } from '../ui/components/livery/LiveryEditor';
import '../styles/acmi/livery.css';

/** Sprite → the type(s) drawn with it. */
const NAMES: Record<string, string> = Object.fromEntries(SPRITE_IDS.map((id) => [id, ACMI_TYPES_LIST.filter((t) => t.art === id || t.id === id).map((t) => t.short).join(' / ') || id]));

const LIVERIES: Record<string, Livery> = {
  blockhours: { primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' },
  redsplit: { primary: '#d6283c', secondary: '#ffffff', tail: 'split' },
  greenstripe: { primary: '#0f9d76', secondary: '#f5c451', tail: 'stripe' },
  navysolid: { primary: '#0b1f4d', secondary: '#3ee6ff', tail: 'solid' },
  used: { primary: '#8792a8', secondary: '#c7cede', tail: 'solid' },
  white: { primary: '#ffffff', secondary: '#c0c7d6', tail: 'solid', plain: true },
  logo: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'solid', logo: { id: 'compass', color: '#f5c451', color2: '#ffffff' } },
  plainlogo: { primary: '#d6283c', secondary: '#1e293b', tail: 'solid', plain: true, logo: { id: 'kite', color: '#d6283c', color2: '#1e293b' } },
  stickers: {
    primary: '#0f9d76', secondary: '#f5c451', tail: 'stripe', code: { color: '#ffffff', weight: 500 }, titles: { color: '#0b1f4d' },
    logo: { id: 'orbit', color: '#f5c451', color2: '#0b1f4d' },
    stickers: [
      { id: 'logo', kind: 'logo', side: 'fin', scale: 1 }, { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 },
      { id: 'code', kind: 'code', side: 'fuselage', x: 0.72, y: 0.55, scale: 1.4, rotation: -8 },
      { id: 'logo2', kind: 'logo', side: 'fuselage', scale: 1 },
    ],
  },
};
const LOGO_SET = new Set<string>([...LOGO_IDS, 'mono']);
const BGS: Record<string, string> = { dark: '#111a2c', blue: '#6f8fc4', light: '#eef2f8' };
const SIZES = ['hero', 'card', 'mini'] as const;
type Size = (typeof SIZES)[number];

const q = new URLSearchParams(location.search);
const list = (k: string) => q.get(k)?.split(',').map((s) => s.trim()).filter(Boolean);
const types = (list('types') ?? SPRITE_IDS).filter((id) => SPRITE_IDS.includes(id) || ACMI_TYPES_LIST.some((t) => t.id === id));
const liveryKey = q.get('livery') ?? 'blockhours';
const livery: Livery = (() => {
  const l: Livery = { ...(LIVERIES[liveryKey] ?? LIVERIES.blockhours) };
  const lg = q.get('logo');
  if (lg && LOGO_SET.has(lg)) l.logo = { id: lg as LogoId | 'mono', color: l.secondary, color2: l.primary, text: 'BH' };
  if (q.get('plain') === '1') l.plain = true;
  const cc = q.get('codecolor'), wt = q.get('weight');
  if (cc || wt) l.code = { ...l.code, color: cc ?? l.code?.color, weight: wt === '500' ? 500 : 700 };
  // v0.11 paint checks: &primary=%23hex &secondary=%23hex, a body preset (&preset=fullColour) or &body=<json>
  const pc = q.get('primary'), sc = q.get('secondary');
  if (pc) l.primary = pc;
  if (sc) l.secondary = sc;
  const pr = q.get('preset');
  if (pr && BODY_PRESETS.some((b) => b.id === pr)) l.body = bodyPreset(pr as BodyPresetId, l);
  const bj = q.get('body');
  if (bj) l.body = JSON.parse(bj) as Livery['body'];
  const lj = q.get('lv');
  if (lj) Object.assign(l, JSON.parse(lj) as Partial<Livery>);
  const tail = q.get('tail');
  if (tail && ['solid', 'split', 'stripe', 'sweep'].includes(tail)) l.tail = tail as TailStyle;
  return l;
})();
const bgs = (list('bg') ?? ['dark', 'blue']).filter((b) => BGS[b]);
const sizes = (list('size') ?? [...SIZES]).filter((s): s is Size => (SIZES as readonly string[]).includes(s));
const code = q.get('code') ?? (liveryKey === 'used' ? undefined : 'BH');
const name = q.get('name') ?? (liveryKey === 'used' ? undefined : 'Block Hours');
const mode = q.get('gallery');

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
  .g-panel[data-bg="blue"] figcaption, .g-panel[data-bg="light"] figcaption { color: rgba(10,20,40,0.8); }
  .g-box { display: flex; align-items: center; justify-content: center; }
  .g-hero .g-box { width: ${Number(q.get('w')) || 720}px; }
  .g-card .g-box { width: 320px; height: 120px; border-radius: 10px; background: rgba(255,255,255,0.03); }
  .g-mini .g-box { width: 92px; height: 36px; }
  .g-mini figcaption { font-size: 9px; }
  .g-cmp { border-radius: 14px; padding: 20px; display: flex; flex-direction: column; gap: 6px; }
  .g-cmp-row { margin: 0; display: flex; align-items: flex-end; gap: 12px; }
  .g-cmp-row figcaption { width: 120px; flex: none; font: 600 11px/1.2 var(--font-mono); color: rgba(232,238,252,0.75); text-align: right; }
`;

function Cell({ id, size }: { id: string; size: Size }) {
  return (
    <figure className="g-cell" data-type={id} data-size={size}>
      <div className="g-box">
        <AircraftArt typeId={id} livery={livery} code={size === 'mini' ? undefined : code} name={size === 'mini' ? undefined : name} reg={size === 'mini' ? undefined : q.get('reg') ?? 'CS-TBL'} detail={size === 'mini' ? 'simple' : 'full'} />
      </div>
      <figcaption>{id} · {NAMES[id] ?? id}</figcaption>
    </figure>
  );
}

/** Every type at one scale (CSS px per metre of the real aircraft), noses lined up on the right. */
function Compare() {
  const longest = Math.max(...types.map((t) => LENGTH_M[t] ?? 40));
  const ppm = Number(q.get('ppm')) || 1000 / longest;
  return (
    <div className="g-cmp" style={{ background: BGS[bgs[0] ?? 'dark'] }}>
      {[...types].sort((a, b) => (LENGTH_M[a] ?? 0) - (LENGTH_M[b] ?? 0)).map((t) => {
        const d = layoutOf(t);
        const right = (d.w - d.nose) * metresPerPx(t) * ppm;
        return (
          <figure className="g-cmp-row" key={t} data-type={t}>
            <figcaption>{t} {LENGTH_M[t]} m</figcaption>
            <div style={{ marginLeft: 'auto', marginRight: 40 - right, lineHeight: 0 }}><AircraftArt typeId={t} livery={livery} code={code} name={name} pxPerM={ppm} /></div>
          </figure>
        );
      })}
    </div>
  );
}

const TONES: [string, string][] = [['#1e4fd8', '#3ee6ff'], ['#d6283c', '#1e293b'], ['#0f9d76', '#f5c451'], ['#7a1f2b', '#e8b04a']];

function LogoSheet() {
  const ids = [...LOGO_IDS];
  const tailTypes = list('types') ?? ['a320ceo', 'b77w'];
  return (
    <div>
      <section className="g-size">
        <h2>logos</h2>
        <div className="g-panel" style={{ background: BGS.dark }}>
          {ids.map((id, i) => {
            const [c1, c2] = TONES[i % TONES.length];
            return (
              <figure className="g-cell" key={id} data-logo={id}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#fff', borderRadius: 8, padding: 6 }}>
                  {[64, 28, 14].map((s) => <svg key={s} width={s} height={s} viewBox="0 0 100 100"><LogoGlyph logo={{ id, color: c1, color2: c2 }} /></svg>)}
                </div>
                <figcaption>{LOGOS[id].name}</figcaption>
              </figure>
            );
          })}
        </div>
      </section>
      <section className="g-size">
        <h2>tail badges</h2>
        <div className="g-panel" style={{ background: BGS.dark, gap: 8 }}>
          {(['solid', 'split', 'stripe', 'sweep'] as const).map((tail) => <TailBadge key={tail} primary="#d6283c" secondary="#ffffff" code="BH" size={44} livery={{ ...livery, tail, plain: undefined, logo: undefined }} />)}
          <TailBadge primary="#fff" secondary="#000" code="BH" size={44} livery={{ ...livery, plain: true, logo: undefined }} />
          {ids.map((id, i) => <TailBadge key={id} primary="#000" secondary="#000" code="BH" size={44} livery={{ primary: TONES[i % 4][0], secondary: TONES[i % 4][1], tail: 'solid', logo: { id, color: '#ffffff', color2: TONES[i % 4][1] } }} />)}
        </div>
      </section>
      {tailTypes.map((t) => (
        <section className="g-size" key={t}>
          <h2>{t} · card and mini</h2>
          <div className="g-panel" style={{ background: BGS.blue }}>
            {ids.map((id, i) => {
              const [c1, c2] = TONES[(i + 1) % TONES.length];
              const lv: Livery = { primary: c1 === '#f5c451' ? '#0b1f4d' : c1, secondary: c2, tail: 'solid', logo: { id, color: c1 === '#f5c451' ? '#f5c451' : '#ffffff', color2: c2 === '#ffffff' ? '#f5c451' : c2 } };
              return (
                <figure className="g-cell" key={id} data-logo={id}>
                  <div className="g-box" style={{ width: 300, height: 104 }}><AircraftArt typeId={t} livery={lv} name="Block Hours" height={100} /></div>
                  <div className="g-box" style={{ width: 92, height: 36 }}><AircraftArt typeId={t} livery={lv} detail="simple" height={34} /></div>
                  <figcaption>{id}</figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const MAGENTA = '#ff00ff';
const CORNERS: StickerPlacement[][] = [
  [
    { id: 'code', kind: 'code', side: 'fin', x: 0, y: 1, scale: 3 }, { id: 'logo', kind: 'logo', side: 'fin', x: 1, y: 0, scale: 3 },
    { id: 'titles', kind: 'titles', side: 'fuselage', x: 0, y: 0, scale: 3 }, { id: 'logo2', kind: 'logo', side: 'fuselage', x: 1, y: 1, scale: 3 },
  ],
  [
    { id: 'code', kind: 'code', side: 'fin', x: 1, y: 1, scale: 3, rotation: 45 }, { id: 'logo', kind: 'logo', side: 'fin', x: 0, y: 0, scale: 3 },
    { id: 'titles', kind: 'titles', side: 'fuselage', x: 1, y: 0, scale: 3, rotation: -45 }, { id: 'logo2', kind: 'logo', side: 'fuselage', x: 0, y: 1, scale: 3 },
  ],
  [
    { id: 'code', kind: 'code', side: 'fuselage', x: 0, y: 0.5, scale: 3 }, { id: 'titles', kind: 'titles', side: 'fin', x: 0.5, y: 1, scale: 3 },
    { id: 'logo', kind: 'logo', side: 'fuselage', x: 0.5, y: 1, scale: 3 }, { id: 'logo2', kind: 'logo', side: 'fin', x: 0.5, y: 0.5, scale: 3 },
  ],
];

/** Magenta stickers pushed to the frame corners at scale 3: no magenta may show off the fin or the fuselage zone. */
function ClipCheck() {
  const on = q.get('stickers') !== '0';
  const base: Livery = { primary: '#ffffff', secondary: '#ffffff', tail: 'solid', plain: true };
  return (
    <div className="g-clip">
      {types.map((t) => (
        <section className="g-size" key={t} data-type={t}>
          <div className="g-panel" style={{ background: '#000000', borderRadius: 0 }}>
            {CORNERS.map((st, i) => {
              const lv: Livery = on
                ? { ...base, code: { color: MAGENTA, text: 'WMQ' }, titles: { color: MAGENTA }, logo: { id: 'spark', color: MAGENTA }, stickers: st }
                : { ...base, stickers: [] };
              return (
                <div key={i} className="g-box" style={{ width: 520, height: 170 }}>
                  <AircraftArt typeId={t} livery={lv} code="WW" name="Block Hours Wide Name" height={166} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

const LOD_W = [60, 90, 120, 150, 220, 320, 480, 720];

function LodSheet() {
  return (
    <div>
      {types.map((t) => (
        <section className="g-size" key={t} data-type={t}>
          <h2>{t}</h2>
          <div className="g-panel" style={{ background: BGS.dark, alignItems: 'end', gap: 12 }}>
            {LOD_W.map((w) => (
              <div key={w} className="g-box" data-w={w} style={{ width: w, height: Math.round(w * 0.36) }}>
                <AircraftArt typeId={t} livery={livery} code={code} name={name} detail={w < 120 ? 'simple' : 'full'} height="100%" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The measured layout over each sprite: fin (red), fin frame (yellow), sticker zone (cyan), title band (magenta). */
function LayoutSheet() {
  return (
    <div>
      {types.map((t) => {
        const d = layoutOf(t), b = titleBand(t), cap = b.size * 0.72;
        const q4 = d.finQuad;
        const a = finAt(q4, 0.5, 0.42);
        return (
          <figure className="g-cell" key={t} data-type={t} style={{ width: 1100, margin: '0 0 16px', position: 'relative' }}>
            <AircraftArt typeId={t} livery={LIVERIES.white} />
            <svg viewBox={`0 0 ${d.w} ${d.h}`} style={{ position: 'absolute', left: 0, top: 0, width: '100%' }}>
              <path d={polyPath(d.fin)} fill="rgba(255,0,0,0.2)" stroke="#f00" />
              <path d={polyPath([q4[0], q4[1], q4[3], q4[2]])} fill="none" stroke="#ff0" />
              <path d={polyPath(d.zone)} fill="rgba(0,255,255,0.12)" stroke="#0ff" />
              <rect x={b.x - b.w} y={b.y - cap / 2} width={b.w} height={cap} fill="none" stroke="#f0f" strokeWidth={2} />
              <circle cx={a[0]} cy={a[1]} r={5} fill="#ff0" />
            </svg>
            <figcaption>{t}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** v0.11 every client livery recipe on a narrowbody and a widebody it would charter (Boeing operators on Boeings). */
const BOEING = /GOL|Jet2|TUI|Corendon|LOT|Air Canada|Royal Air Maroc|Fiji|Biman|Air Algérie|Sunwing|Aegean|flynas/;
function ClientSheet() {
  // 10 per page (`&page=1…`): a page of 20 bitmaps stays well inside the composed-bitmap cache
  const pg = Number(q.get('page')) || 0;
  const names = Object.keys(CLIENT_LIVERIES).filter((n) => !q.get('only') || n.includes(q.get('only')!)).slice(pg ? (pg - 1) * 10 : 0, pg ? pg * 10 : undefined);
  return (
    <div className="g-panel" data-bg="light" style={{ background: BGS.light, flexDirection: 'column' }}>
      {names.map((n) => {
        const r = CLIENT_LIVERIES[n];
        const decals = /^(SL |Sporting|Real|Olympique|Fortuna|Manchester|FC |Ajax|Riga|Floriana|FK |Formula|Novartis|American|BBC|Live|AEG|Wasserman)/.test(n);
        const lv = recipeLivery(r, decals ? 'decals' : 'full');
        const [nb, wb] = BOEING.test(n) ? ['b738', 'b789'] : ['a320ceo', 'a332'];
        return (
          <figure key={n} className="g-cell" data-client={n} style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <figcaption style={{ width: 210, color: '#111a2c' }}><b>{n}</b><br />{decals ? 'decals' : 'full'}{r.approx ? ' · approx.' : ''}</figcaption>
            <div className="g-box" style={{ width: 560 }}><AircraftArt typeId={nb} livery={lv} reg="CS-TBL" /></div>
            <div className="g-box" style={{ width: 640 }}><AircraftArt typeId={wb} livery={lv} reg="CS-TBM" /></div>
          </figure>
        );
      })}
    </div>
  );
}

function EditorDemo() {
  const [lv, setLv] = useState<Livery>(livery);
  return (
    <div style={{ position: 'fixed', inset: 0, padding: 16, background: 'var(--bg)' }}>
      <LiveryEditor value={lv} onChange={setLv} code="BH" name="Block Hours" mode="company" types={list('types')} onApplyAll={() => {}} onSave={() => {}} onCancel={() => {}} />
      <pre id="g-livery-json" style={{ display: 'none' }}>{JSON.stringify(lv)}</pre>
    </div>
  );
}

function Gallery() {
  if (mode === 'editor') return <EditorDemo />;
  return (
    <div className="g-wrap">
      <style>{css}</style>
      <div className="g-head">
        <h1>Aircraft art</h1>
        <span>{types.length} sprites · livery {liveryKey} ({livery.plain ? 'white' : livery.tail})</span>
      </div>
      {mode === 'clients' ? <ClientSheet /> : mode === 'compare' ? <Compare /> : mode === 'logos' ? <LogoSheet /> : mode === 'clip' ? <ClipCheck /> : mode === 'lod' ? <LodSheet /> : mode === 'layout' ? <LayoutSheet /> : (
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
