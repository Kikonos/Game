// Livery colour field: 12 preset swatches, optional Auto (the contrast rule),
// and a Custom drawer with a hue strip, a saturation/lightness pad and a hex
// field. Touch first: every target is >= 44 px. No game state.

import { useId, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { contrast } from '../aircraft/AircraftArt';

export const PRESETS = ['#ffffff', '#16213a', '#0b1f4d', '#1e4fd8', '#3ee6ff', '#0f9d76', '#f5c451', '#f97316', '#d6283c', '#7a1f2b', '#8b5cff', '#9aa6bf'];

const HEX = /^#[0-9a-f]{6}$/i;

export function normHex(s: string): string | undefined {
  const t = s.trim().replace(/^#?/, '#');
  if (/^#[0-9a-f]{3}$/i.test(t)) return `#${t.slice(1).replace(/./g, (d) => d + d)}`.toLowerCase();
  return HEX.test(t) ? t.toLowerCase() : undefined;
}

export function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt((normHex(hex) ?? '#000000').slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Pointer drag over an element, reporting 0–1 fractions (x, y). */
function useDrag(onMove: (fx: number, fy: number) => void) {
  const el = useRef<HTMLDivElement>(null);
  const at = (e: RPointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    onMove(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
  };
  return {
    ref: el,
    onPointerDown: (e: RPointerEvent) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } at(e); },
    onPointerMove: (e: RPointerEvent) => { if (e.buttons && e.currentTarget.hasPointerCapture(e.pointerId)) at(e); },
  };
}

export function ColorPicker({ label, value, onChange, presets = PRESETS, auto, contrastWith, autoColor }: {
  label: string;
  value: string | undefined;
  onChange: (c: string | undefined) => void;
  presets?: string[];
  /** Offer "Auto" (value undefined). */
  auto?: boolean;
  /** Background the colour sits on: warns under 2:1. */
  contrastWith?: string;
  /** What Auto currently resolves to (shown in its swatch). */
  autoColor?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const shown = value ?? autoColor ?? '#ffffff';
  const [hsl, setHsl] = useState<[number, number, number]>(() => hexToHsl(shown));
  const [hex, setHex] = useState(shown);
  const set = (c: string | undefined) => {
    onChange(c);
    if (c) { setHsl(hexToHsl(c)); setHex(c); }
  };
  const fromHsl = (h: number, s: number, l: number) => {
    setHsl([h, s, l]);
    const c = hslToHex(h, s, l);
    setHex(c);
    onChange(c);
  };
  const hue = useDrag((fx) => fromHsl(fx * 359.9, hsl[1], hsl[2]));
  const pad = useDrag((fx, fy) => fromHsl(hsl[0], fx, 1 - fy));
  const low = contrastWith && contrast(shown, contrastWith) < 2;
  const isPreset = value !== undefined && presets.some((p) => p.toLowerCase() === value.toLowerCase());

  return (
    <div className="lv-color">
      <div className="lv-color-head">
        <span className="lv-label" id={`${id}-l`}>{label}</span>
        <span className="lv-color-now" style={{ background: shown }} aria-hidden />
        <code className="lv-color-hex">{value ? value.toUpperCase() : 'Auto'}</code>
        {low && <span className="lv-warn" role="status">Low contrast</span>}
      </div>
      <div className="lv-swatches" role="radiogroup" aria-labelledby={`${id}-l`}>
        {auto && (
          <button type="button" role="radio" aria-checked={value === undefined} className={`lv-swatch lv-swatch-auto${value === undefined ? ' on' : ''}`} onClick={() => set(undefined)} title="Auto: best contrast">
            <span style={{ background: autoColor ?? 'transparent' }} />A
          </button>
        )}
        {presets.map((c) => (
          <button
            type="button" role="radio" key={c} aria-checked={value?.toLowerCase() === c.toLowerCase()} aria-label={c}
            className={`lv-swatch${value?.toLowerCase() === c.toLowerCase() ? ' on' : ''}`} onClick={() => set(c)}
          >
            <span style={{ background: c }} />
          </button>
        ))}
        <button type="button" className={`lv-swatch lv-swatch-custom${open || (value && !isPreset) ? ' on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Custom colour">
          <span style={{ background: value && !isPreset ? value : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }} />
        </button>
      </div>
      {open && (
        <div className="lv-custom">
          <div
            className="lv-pad" {...pad}
            style={{ background: `linear-gradient(to bottom, #fff, transparent 50%, #000), linear-gradient(to right, ${hslToHex(hsl[0], 0, 0.5)}, ${hslToHex(hsl[0], 1, 0.5)})` }}
            role="slider" aria-label="Saturation and lightness" aria-valuenow={Math.round(hsl[2] * 100)}
          >
            <i style={{ left: `${hsl[1] * 100}%`, top: `${(1 - hsl[2]) * 100}%`, background: hslToHex(...hsl) }} />
          </div>
          <div className="lv-hue" {...hue} role="slider" aria-label="Hue" aria-valuenow={Math.round(hsl[0])}>
            <i style={{ left: `${(hsl[0] / 360) * 100}%` }} />
          </div>
          <label className="lv-hexfield">
            <span>Hex</span>
            <input
              value={hex} maxLength={7} spellCheck={false} autoCapitalize="off" autoCorrect="off" inputMode="text"
              onChange={(e) => {
                setHex(e.target.value);
                const c = normHex(e.target.value);
                if (c) { setHsl(hexToHsl(c)); onChange(c); }
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}
