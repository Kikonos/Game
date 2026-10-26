// Livery editor sheet (v0.5.1, LIVERY.md §3): hero stage with draggable
// stickers (tail code, titles, logos) on the left, tool tabs on the right.
// Touch first: one finger drags (clipped to the airframe like a decal), two
// fingers pinch-scale the selected sticker; the mouse does the same. Keeps no
// game state — the host owns `value` and persists it.

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react';
import { ACMI_TYPES_LIST } from '../../../data/acmiTypes';
import { AIRCRAFT } from '../../../data/aircraft';
import { MAX_CODE, MAX_STICKERS, MAX_TITLE } from '../../../data/livery';
import type { Livery, LiveryRef, StickerPlacement, TailStyle } from '../../../engine/core/types';
import { AircraftArt, autoBodyInk, autoFinInk, contrast, stickerGround, stickerInk } from '../aircraft/AircraftArt';
import { defaultStickers, hitBox, placeAt, sideAt, snapTargets, stickerLayout, stickersOf, type StickerBox } from '../aircraft/stickers';
import { BODY_PAINT } from '../aircraft/sprites';
import { BodyPanel, BodyPresets, TailEnginePanel } from './BodyPanels';
import { ColorPicker } from './ColorPicker';
import { LiveryPreview } from './LiveryPreview';
import { LogoPicker } from './LogoPicker';

export interface LiveryEditorProps {
  value: Livery;
  onChange: (l: Livery) => void;
  /** Default texts for previews (company code / name). */
  code: string;
  name: string;
  /** v0.11 a registration for the preview (the aircraft's; else one of the fleet's). */
  reg?: string;
  /** Preview type chips; default ['a320ceo', 'b738', 'b763', 'b77w']. */
  types?: string[];
  mode: 'company' | 'aircraft';
  /** Aircraft mode header: Company · White · Custom; `locked` = why it cannot change (client paint). */
  aircraft?: { ref: LiveryRef; onRef: (r: LiveryRef) => void; locked?: string };
  /** Company mode: "Use on all aircraft". */
  onApplyAll?: () => void;
  /** Footer buttons (omitted when the host has its own). */
  onSave?: () => void;
  onCancel?: () => void;
  /** Footer: "Reset all" goes back to this livery (default: the legacy look of `value`). */
  resetTo?: Livery;
  /** Extra footer content (host status, warnings). */
  footer?: ReactNode;
}

type Tab = 'scheme' | 'colours' | 'body' | 'tail' | 'text' | 'logo' | 'layout';
/** v0.10 with body paint: Body (fuselage) and Tail (fin and engines) replace Colours. */
const TABS: { id: Tab; label: string }[] = BODY_PAINT
  ? [{ id: 'scheme', label: 'Scheme' }, { id: 'body', label: 'Body' }, { id: 'tail', label: 'Tail' }, { id: 'text', label: 'Text' }, { id: 'logo', label: 'Logo' }, { id: 'layout', label: 'Layout' }]
  : [{ id: 'scheme', label: 'Scheme' }, { id: 'colours', label: 'Colours' }, { id: 'text', label: 'Text' }, { id: 'logo', label: 'Logo' }, { id: 'layout', label: 'Layout' }];
const SCHEMES: { id: TailStyle | 'white'; label: string }[] = [
  { id: 'solid', label: 'Solid' }, { id: 'split', label: 'Split' }, { id: 'stripe', label: 'Stripe' }, { id: 'sweep', label: 'Sweep' }, { id: 'white', label: 'White' },
];
const DEFAULT_TYPES = ['a320ceo', 'b738', 'b763', 'b77w'];
const SHORT: Record<string, string> = Object.fromEntries([...AIRCRAFT, ...ACMI_TYPES_LIST].map((t) => [t.id, t.short]));
/** v0.10 chips may be sprite ids (an airframe's variant: 'a332-alt-engines', 'a359ulr'). */
const ART_SHORT: Record<string, string> = Object.fromEntries(ACMI_TYPES_LIST.map((t) => [t.art, t.short]));
const typeLabel = (id: string) => SHORT[id] ?? ART_SHORT[id] ?? SHORT[id.split('-')[0]] ?? id.toUpperCase();
const STICKER_NAME: Record<string, string> = { code: 'Tail code', titles: 'Titles' };
const stickerName = (s: StickerPlacement) => STICKER_NAME[s.kind] ?? (s.side === 'fin' ? 'Logo · fin' : 'Logo · fuselage');

/** Touch targets under this many CSS px get padded hit boxes. */
const TAP = 44;
/** Snap distance in CSS px. */
const SNAP = 8;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const INK = '#16213a';

/** Colours a new logo starts with: colour 1 as v0.5; colour 2 the ink that reads on the fin (not the fin colour itself). */
function logoDefaults(lv: Livery): { color: string; color2: string } {
  const fin = lv.plain ? '#ffffff' : lv.primary;
  const color = lv.plain ? lv.primary : lv.secondary;
  const pool = [...(lv.plain ? [lv.secondary] : []), '#ffffff', INK];
  const color2 = pool.find((c) => contrast(c, fin) >= 2.2 && contrast(c, color) >= 1.5)
    ?? pool.reduce((a, c) => (contrast(c, fin) > contrast(a, fin) ? c : a));
  return { color, color2 };
}

interface Drag { id: string; dx: number; dy: number; pointer: number }
interface Pinch { id: string; d0: number; s0: number }

export function LiveryEditor({ value, onChange, code, name, reg, types, mode, aircraft, onApplyAll, onSave, onCancel, resetTo, footer }: LiveryEditorProps) {
  const typeList = types?.length ? types : DEFAULT_TYPES;
  const [typeId, setTypeId] = useState(typeList[0]);
  const [tab, setTab] = useState<Tab>('scheme');
  const [selected, setSelected] = useState<string | undefined>();
  const [guides, setGuides] = useState<{ x?: number[]; y?: number[] } | undefined>();
  const [logoNote, setLogoNote] = useState<string | undefined>();
  /** The auto fin code was taken off by picking a logo: None puts it back. */
  const codeOff = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  // rAF-throttled onChange: drags compute from the latest pending livery, not the stale prop
  const pending = useRef<Livery | null>(null);
  const frame = useRef(0);
  const latest = () => pending.current ?? value;
  const commit = (l: Livery, now = false) => {
    pending.current = l;
    if (now) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      pending.current = null;
      onChange(l);
      return;
    }
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const p = pending.current;
        pending.current = null;
        if (p) onChange(p);
      });
    }
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { if (!typeList.includes(typeId)) setTypeId(typeList[0]); }, [typeList, typeId]);

  const locked = mode === 'aircraft' && !!aircraft?.locked;
  const editable = !locked && (mode === 'company' || !aircraft || typeof aircraft.ref === 'object');
  const lv = value;
  const stickers = stickersOf(lv);
  const boxes = useMemo(() => stickerLayout(typeId, lv, { code, name }), [typeId, lv, code, name]);
  const sel = stickers.find((s) => s.id === selected);
  const selBox = boxes.find((b) => b.id === selected);

  const update = (patch: Partial<Livery>, now = true) => commit({ ...latest(), ...patch }, now);
  const setStickers = (list: StickerPlacement[], now = true) => commit({ ...latest(), stickers: list.slice(0, MAX_STICKERS) }, now);
  const patchSticker = (id: string, p: Partial<StickerPlacement>, now = true) => {
    const cur = stickersOf(latest());
    setStickers(cur.map((s) => (s.id === id ? { ...s, ...p } : s)), now);
  };

  // ---------- stage pointer handling ----------
  const toView = (cx: number, cy: number): { X: number; Y: number; k: number } | null => {
    const el = svg.current, m = el?.getScreenCTM();
    if (!el || !m) return null;
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { X: p.x, Y: p.y, k: Math.abs(m.a) || 1 };
  };
  const hit = (X: number, Y: number, k: number): StickerBox | undefined => {
    const min = TAP / k;
    const pad = (b: StickerBox) => Math.max(0, (min - Math.min(b.w, b.h)) / 2);
    // 1. the selected sticker keeps its padded box; 2. a box under the finger, smallest first
    // (a short code over the wide titles stays grabbable); 3. padded boxes, nearest centre
    const cur = boxes.find((b) => b.id === selected);
    if (cur && hitBox(cur, X, Y, pad(cur))) return cur;
    const on = boxes.filter((b) => hitBox(b, X, Y));
    if (on.length) return on.reduce((a, b) => (b.w * b.h < a.w * a.h ? b : a));
    const near = boxes.filter((b) => hitBox(b, X, Y, pad(b)));
    return near.length ? near.reduce((a, b) => (Math.hypot(b.cx - X, b.cy - Y) < Math.hypot(a.cx - X, a.cy - Y) ? b : a)) : undefined;
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!editable) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    if (pointers.current.size === 2 && selected) {
      // second finger: pinch the selected sticker
      const [a, b] = [...pointers.current.values()];
      const s = stickersOf(latest()).find((x) => x.id === selected);
      drag.current = null;
      setGuides(undefined);
      if (s) pinch.current = { id: s.id, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: s.scale };
      return;
    }
    if (pointers.current.size > 1) return;
    const v = toView(e.clientX, e.clientY);
    if (!v) return;
    const b = hit(v.X, v.Y, v.k);
    if (!b) { setSelected(undefined); return; }
    setSelected(b.id);
    if (tab === 'scheme' || tab === 'colours' || tab === 'body' || tab === 'tail') setTab('layout');
    drag.current = { id: b.id, dx: v.X - b.cx, dy: v.Y - b.cy, pointer: e.pointerId };
    e.preventDefault();
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      patchSticker(pz.id, { scale: Math.round(clamp((pz.s0 * d) / pz.d0, 0.3, 3) * 100) / 100 }, false);
      return;
    }
    const dg = drag.current;
    if (!dg || dg.pointer !== e.pointerId) return;
    const v = toView(e.clientX, e.clientY);
    const st = stickersOf(latest()).find((s) => s.id === dg.id);
    if (!v || !st) return;
    let X = v.X - dg.dx, Y = v.Y - dg.dy;
    // snap the centre to the side's guide lines within SNAP CSS px
    const side = sideAt(typeId, X, Y) ?? st.side;
    const t = snapTargets(typeId, side);
    const gx = t.x.find((x) => Math.abs(x - X) * v.k < SNAP), gy = t.y.find((y) => Math.abs(y - Y) * v.k < SNAP);
    if (gx !== undefined) X = gx;
    if (gy !== undefined) Y = gy;
    setGuides(gx !== undefined || gy !== undefined ? { x: gx !== undefined ? [gx] : [], y: gy !== undefined ? [gy] : [] } : undefined);
    const next = placeAt(typeId, st, X, Y);
    setStickers(stickersOf(latest()).map((s) => (s.id === st.id ? next : s)), false);
  };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.pointer === e.pointerId || !pointers.current.size) {
      drag.current = null;
      setGuides(undefined);
      if (pending.current) commit(pending.current, true);
    }
  };
  const onWheel = (e: RWheelEvent) => {
    // desktop: trackpad pinch (ctrl + wheel) scales the selected sticker
    if (!editable || !sel || !e.ctrlKey) return;
    patchSticker(sel.id, { scale: Math.round(clamp(sel.scale * Math.exp(-e.deltaY * 0.01), 0.3, 3) * 100) / 100 });
  };

  // ---------- livery actions ----------
  const scheme: TailStyle | 'white' = lv.plain ? 'white' : lv.tail;
  const setScheme = (s: TailStyle | 'white') => update(s === 'white' ? { plain: true } : { tail: s, plain: undefined });
  const ensureList = () => [...stickersOf(latest())];
  const showSticker = (kind: 'code' | 'titles', on: boolean) => {
    const list = ensureList().filter((s) => s.id !== kind);
    if (on) list.push(kind === 'code' ? { id: 'code', kind: 'code', side: 'fin', scale: 1 } : { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 });
    setStickers(list);
    if (!on && selected === kind) setSelected(undefined);
  };
  const addLogo = (side: 'fin' | 'fuselage') => {
    const cur = latest();
    const list = ensureList();
    let n = 1;
    while (list.some((s) => s.id === (n === 1 ? 'logo' : `logo${n}`))) n++;
    const id = n === 1 ? 'logo' : `logo${n}`;
    list.push({ id, kind: 'logo', side, scale: 1 });
    commit({ ...cur, logo: cur.logo ?? { id: 'arc', ...logoDefaults(cur) }, stickers: list.slice(0, MAX_STICKERS) }, true);
    setSelected(id);
  };
  const removeSticker = (id: string) => {
    setStickers(ensureList().filter((s) => s.id !== id));
    if (selected === id) setSelected(undefined);
  };
  const resetSticker = (id: string) => patchSticker(id, { x: undefined, y: undefined, scale: 1, rotation: undefined });
  const setLogo = (logo: Livery['logo']) => {
    const cur = latest();
    let list = [...stickersOf(cur)];
    if (!logo) {
      list = list.filter((s) => s.kind !== 'logo');
      // the code the logo pushed off the fin (or a fin left bare) comes back
      if (!list.some((s) => s.kind === 'code') && (codeOff.current || !list.some((s) => s.side === 'fin'))) {
        list.unshift({ id: 'code', kind: 'code', side: 'fin', scale: 1 });
        setLogoNote('Tail code back on the fin.');
      } else setLogoNote(undefined);
      codeOff.current = false;
    } else if (!list.some((s) => s.kind === 'logo')) {
      // a new tail logo takes the fin; an auto tail code there would sit under it
      const n = list.length;
      list = list.filter((s) => !(s.kind === 'code' && s.side === 'fin' && s.x === undefined));
      if (list.length < n) {
        codeOff.current = true;
        setLogoNote('The logo takes the fin, so the tail code is hidden. Layout › Show brings it back.');
      }
      list.unshift({ id: 'logo', kind: 'logo', side: 'fin', scale: 1 });
    }
    commit({ ...cur, logo, stickers: list.slice(0, MAX_STICKERS) }, true);
  };
  const resetAll = () => {
    const base = resetTo ?? { ...lv, stickers: undefined };
    commit({ ...base, stickers: resetTo?.stickers ?? defaultStickers(base) }, true);
    setSelected(undefined);
  };

  const finInk = autoFinInk(lv), bodyInk = autoBodyInk(lv);
  // Auto swatch and contrast warning follow the paint under the drawn box
  const codeBox = boxes.find((b) => b.kind === 'code'), titleBox = boxes.find((b) => b.kind === 'titles');
  const codeSide = stickers.find((s) => s.kind === 'code')?.side ?? 'fin';
  const titleSide = stickers.find((s) => s.kind === 'titles')?.side ?? 'fuselage';
  const has = (id: string) => stickers.some((s) => s.id === id);
  const refKind = aircraft ? (typeof aircraft.ref === 'object' ? 'custom' : aircraft.ref) : undefined;

  return (
    <div className="lv-editor" data-mode={mode}>
      <div className="lv-stage-col">
        {aircraft && (
          <div className="lv-refbar">
            <div className="lv-seg" role="radiogroup" aria-label="Livery for this aircraft">
              {(['company', 'white', 'custom'] as const).map((r) => (
                <button
                  key={r} type="button" role="radio" aria-checked={refKind === r} className={refKind === r ? 'on' : ''} disabled={locked}
                  onClick={() => aircraft.onRef(r === 'custom' ? { custom: typeof aircraft.ref === 'object' ? aircraft.ref.custom : { ...value, plain: undefined } } : r)}
                >
                  {r === 'company' ? 'Company' : r === 'white' ? 'All white' : 'Custom'}
                </button>
              ))}
            </div>
            {locked && <span className="lv-lock">{aircraft.locked}</span>}
          </div>
        )}
        <div
          className={`lv-stage${editable ? '' : ' readonly'}${selected ? ' has-sel' : ''}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        >
          <AircraftArt typeId={typeId} livery={lv} code={code} name={name} reg={reg} svgRef={svg} selected={editable ? selected : undefined} guides={guides} />
          {editable && !selected && <div className="lv-hint">Drag the tail code, titles or logo · pinch to resize</div>}
        </div>
        <div className="lv-types" role="radiogroup" aria-label="Preview aircraft">
          {typeList.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={t === typeId} className={`lv-chip${t === typeId ? ' on' : ''}`} onClick={() => setTypeId(t)}>{typeLabel(t)}</button>
          ))}
        </div>
        <LiveryPreview livery={lv} code={code} name={name} typeId={typeId} sizes={['card', 'mini']} />
      </div>

      <div className="lv-panel">
        <div className="lv-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} disabled={!editable}>{t.label}</button>
          ))}
        </div>
        <div className="lv-body">
          {!editable ? (
            <p className="lv-note">
              {locked ? aircraft?.locked : refKind === 'white' ? 'Plain white with no titles or tail code.' : 'This aircraft uses the company livery.'}
              {!locked && ' Choose Custom to give it its own colours.'}
            </p>
          ) : tab === 'scheme' ? (
            <>
            {BODY_PAINT && <BodyPresets lv={lv} typeId={typeId} code={code} onBody={(b) => update({ body: b, plain: undefined })} />}
            {BODY_PAINT && <h4 className="lv-subhead">Tail</h4>}
            <div className="lv-schemes">
              {SCHEMES.map((s) => {
                const sample: Livery = s.id === 'white' ? { ...lv, plain: true } : { ...lv, tail: s.id, plain: undefined };
                return (
                  <button key={s.id} type="button" className={`lv-scheme${scheme === s.id ? ' on' : ''}`} onClick={() => setScheme(s.id)} aria-pressed={scheme === s.id}>
                    <AircraftArt typeId={typeId} livery={sample} code={code} detail="simple" height={40} />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </div>
            </>
          ) : tab === 'body' ? (
            <BodyPanel lv={lv} onBody={(b) => update({ body: b, plain: undefined }, false)} />
          ) : tab === 'tail' ? (
            <TailEnginePanel lv={lv} onTail={(p) => update(p)} onBody={(b) => update({ body: b }, false)} />
          ) : tab === 'colours' ? (
            <>
              {/* v0.10 the drawn airframe stays white: the colours go on the tail and the engines (BODY_PAINT in sprites.ts) */}
              <ColorPicker label={BODY_PAINT ? 'Primary' : 'Tail and engines'} value={lv.primary} onChange={(c) => update({ primary: c ?? lv.primary })} />
              <ColorPicker label={BODY_PAINT ? 'Accent' : 'Tail accent'} value={lv.secondary} onChange={(c) => update({ secondary: c ?? lv.secondary })} />
            </>
          ) : tab === 'text' ? (
            <>
              <TextBlock
                title="Tail code" max={MAX_CODE} placeholder={code} text={lv.code?.text} shown={has('code')} onShow={(on) => showSticker('code', on)}
                clean={(v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')}
                onText={(t) => update({ code: { ...lv.code, text: t } })}
                weight={lv.code?.weight ?? 700} onWeight={(w) => update({ code: { ...lv.code, weight: w } })}
              >
                <ColorPicker label="Colour" value={lv.code?.color} auto autoColor={codeBox ? stickerInk(typeId, lv, codeBox) : codeSide === 'fin' ? finInk : bodyInk} contrastWith={stickerGround(lv, codeSide, codeBox && { typeId, box: codeBox })} onChange={(c) => update({ code: { ...lv.code, color: c } })} />
              </TextBlock>
              <TextBlock
                title="Titles" max={MAX_TITLE} placeholder={name} text={lv.titles?.text} shown={has('titles')} onShow={(on) => showSticker('titles', on)}
                clean={(v) => v.toUpperCase().replace(/\s+/g, ' ').replace(/^ /, '')}
                onText={(t) => update({ titles: { ...lv.titles, text: t } })}
                weight={lv.titles?.weight ?? 700} onWeight={(w) => update({ titles: { ...lv.titles, weight: w } })}
              >
                <ColorPicker label="Colour" value={lv.titles?.color} auto autoColor={titleBox ? stickerInk(typeId, lv, titleBox) : titleSide === 'fin' ? finInk : bodyInk} contrastWith={stickerGround(lv, titleSide, titleBox && { typeId, box: titleBox })} onChange={(c) => update({ titles: { ...lv.titles, color: c } })} />
              </TextBlock>
              <section className="lv-section">
                <h4>Small markings</h4>
                <div className="lv-row-toggles">
                  <button type="button" className={`lv-btn small lv-toggle${!lv.reg?.hide ? ' on' : ''}`} aria-pressed={!lv.reg?.hide} onClick={() => update({ reg: lv.reg?.hide ? (lv.reg.noFlag ? { noFlag: true } : undefined) : { ...lv.reg, hide: true } })}>Registration</button>
                  <button type="button" className={`lv-btn small lv-toggle${!lv.reg?.noFlag ? ' on' : ''}`} aria-pressed={!lv.reg?.noFlag} disabled={!!lv.reg?.hide} onClick={() => update({ reg: lv.reg?.noFlag ? (lv.reg.hide ? { hide: true } : undefined) : { ...lv.reg, noFlag: true } })}>Flag</button>
                </div>
                <div className="lv-row-toggles">
                  <button type="button" className={`lv-btn small lv-toggle${lv.reg?.at === 'fin' ? ' on' : ''}`} aria-pressed={lv.reg?.at === 'fin'} disabled={!!lv.reg?.hide} onClick={() => update({ reg: { ...lv.reg, at: lv.reg?.at === 'fin' ? undefined : 'fin' } })}>On the fin</button>
                  <button type="button" className={`lv-btn small lv-toggle${lv.reg?.fleet ? ' on' : ''}`} aria-pressed={!!lv.reg?.fleet} onClick={() => update({ reg: { ...lv.reg, fleet: lv.reg?.fleet ? undefined : true } })}>Fleet number</button>
                </div>
                <div className="lv-seg" role="radiogroup" aria-label="Aircraft model">
                  {([[undefined, 'Model by the registration'], ['forward', 'Model forward'], ['off', 'No model']] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={(lv.model === 'rear' ? undefined : lv.model) === v} className={(lv.model === 'rear' ? undefined : lv.model) === v ? 'on' : ''} onClick={() => update({ model: v })}>{label}</button>
                  ))}
                </div>
                <p className="lv-note small">Painted small where real aircraft carry them: the registration on the rear fuselage by the last door (or on the fin), the type next to it, the fleet number at the top of the fin. Shown on big views only.</p>
              </section>
            </>
          ) : tab === 'logo' ? (
            <>
              <LogoPicker value={lv.logo} onChange={setLogo} defaults={{ ...logoDefaults(lv), text: code.slice(0, 2) }} />
              {lv.logo && (
                <div className="lv-row-toggles">
                  <button type="button" className={`lv-btn small lv-toggle${lv.body?.engineLogo ? ' on' : ''}`} aria-pressed={!!lv.body?.engineLogo} onClick={() => update({ body: { ...lv.body, engineLogo: lv.body?.engineLogo ? undefined : true } })}>On the engines</button>
                  <button type="button" className={`lv-btn small lv-toggle${lv.body?.noseLogo ? ' on' : ''}`} aria-pressed={!!lv.body?.noseLogo} onClick={() => update({ body: { ...lv.body, noseLogo: lv.body?.noseLogo ? undefined : true } })}>By the nose</button>
                </div>
              )}
              {logoNote && <p className="lv-note small">{logoNote}</p>}
            </>
          ) : (
            <div className="lv-layout">
              <ul className="lv-list">
                {stickers.map((s) => (
                  <li key={s.id} className={`lv-row${s.id === selected ? ' sel' : ''}`}>
                    <button type="button" className="lv-row-name" onClick={() => setSelected(s.id === selected ? undefined : s.id)} aria-pressed={s.id === selected}>
                      {stickerName(s)}<small>{s.side === 'fin' ? 'Fin' : 'Fuselage'}{s.x === undefined ? ' · auto' : ''}</small>
                    </button>
                    <button type="button" className="lv-btn" onClick={() => (s.kind === 'logo' ? removeSticker(s.id) : showSticker(s.kind as 'code' | 'titles', false))}>
                      {s.kind === 'logo' ? 'Remove' : 'Hide'}
                    </button>
                  </li>
                ))}
                {(['code', 'titles'] as const).filter((k) => !has(k)).map((k) => (
                  <li key={k} className="lv-row off">
                    <span className="lv-row-name">{STICKER_NAME[k]}<small>Hidden</small></span>
                    <button type="button" className="lv-btn" onClick={() => showSticker(k, true)}>Show</button>
                  </li>
                ))}
              </ul>
              {sel && (
                <div className="lv-adjust">
                  <Slider label="Size" min={0.3} max={3} step={0.05} value={sel.scale} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => patchSticker(sel.id, { scale: v }, false)} onEnd={() => pending.current && commit(pending.current, true)} />
                  <Slider
                    label="Tilt" min={-45} max={45} step={1} value={sel.rotation ?? 0} fmt={(v) => `${v}°`}
                    onChange={(v) => patchSticker(sel.id, { rotation: Math.abs(v) <= 2 ? undefined : v }, false)} onEnd={() => pending.current && commit(pending.current, true)}
                  />
                  <button type="button" className="lv-btn" onClick={() => resetSticker(sel.id)}>Reset {stickerName(sel).toLowerCase()}</button>
                </div>
              )}
              {!sel && <p className="lv-note small">Tap a sticker on the aircraft to move it. Anything dragged off the airframe is trimmed like a decal.</p>}
              {selBox?.kind === 'logo' && !lv.logo && <p className="lv-note small">Pick a logo in the Logo tab.</p>}
              <div className="lv-actions">
                <button type="button" className="lv-btn" disabled={stickers.length >= MAX_STICKERS} onClick={() => addLogo('fin')}>Add logo to fin</button>
                <button type="button" className="lv-btn" disabled={stickers.length >= MAX_STICKERS} onClick={() => addLogo('fuselage')}>Add logo to fuselage</button>
                <button type="button" className="lv-btn" onClick={() => { setStickers(defaultStickers(latest())); setSelected(undefined); }}>Reset layout</button>
              </div>
            </div>
          )}
        </div>
        {(onCancel || onSave || editable || footer) && (
          <div className="lv-foot">
            {footer}
            {onCancel && <button type="button" className="lv-btn ghost" onClick={onCancel}>Cancel</button>}
            {editable && <button type="button" className="lv-btn ghost" onClick={resetAll}>Reset all</button>}
            {mode === 'company' && onApplyAll && <button type="button" className="lv-btn" onClick={onApplyAll}>Use on all aircraft</button>}
            {onSave && <button type="button" className="lv-btn primary" onClick={onSave}>Save</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function TextBlock({ title, max, placeholder, text, clean, onText, shown, onShow, weight, onWeight, children }: {
  title: string; max: number; placeholder: string; text: string | undefined; onText: (t: string | undefined) => void;
  /** Same rule as the save-time normalise, so the preview is what gets saved. */
  clean: (v: string) => string;
  shown: boolean; onShow: (on: boolean) => void; weight: 500 | 700; onWeight: (w: 500 | 700) => void; children: ReactNode;
}) {
  return (
    <section className="lv-textblock">
      <div className="lv-textblock-head">
        <h4>{title}</h4>
        <button type="button" className="lv-btn small" onClick={() => onShow(!shown)} aria-pressed={!shown}>{shown ? 'Hide' : 'Show'}</button>
      </div>
      <div className="lv-textrow">
        <input
          className="lv-input" value={text ?? ''} placeholder={placeholder} maxLength={max} autoCorrect="off" spellCheck={false} autoCapitalize="characters"
          onChange={(e) => onText(clean(e.target.value).slice(0, max) || undefined)} aria-label={`${title} text`}
        />
        <div className="lv-seg" role="radiogroup" aria-label={`${title} weight`}>
          <button type="button" role="radio" aria-checked={weight === 700} className={weight === 700 ? 'on' : ''} onClick={() => onWeight(700)} style={{ fontWeight: 700 }}>Bold</button>
          <button type="button" role="radio" aria-checked={weight === 500} className={weight === 500 ? 'on' : ''} onClick={() => onWeight(500)} style={{ fontWeight: 500 }}>Medium</button>
        </div>
      </div>
      {children}
    </section>
  );
}

function Slider({ label, min, max, step, value, fmt, onChange, onEnd }: {
  label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; onEnd: () => void;
}) {
  return (
    <label className="lv-slider">
      <span className="lv-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onEnd} onKeyUp={onEnd} onBlur={onEnd} />
      <output>{fmt(value)}</output>
    </label>
  );
}
