// v0.10 livery editor panels for body paint (BODY_PAINT): quick looks, the fuselage (colour, belly and its split
// line, stripes, nose band, nose) and the tail and engines (fin colours, fin-root stripe, engine colour, intake lips).
// Every colour is painted through the art's light, so panel lines, windows and doors show through. No game state:
// the editor owns the livery.

import type { ReactNode } from 'react';
import { BODY_PRESETS, bodyPreset, MAX_STRIPES, type BodyPresetId } from '../../../data/livery';
import type { Livery, LiveryBody, LiveryStripe } from '../../../engine/core/types';
import { AircraftArt } from '../aircraft/AircraftArt';
import { ColorPicker } from './ColorPicker';

type Patch = (b: LiveryBody | undefined) => void;

/** Body paint with one field changed; an empty body becomes undefined (today's white fuselage). */
function withBody(b: LiveryBody | undefined, patch: Partial<LiveryBody>): LiveryBody | undefined {
  const out: LiveryBody = { ...(b ?? {}), ...patch };
  for (const k of Object.keys(out) as (keyof LiveryBody)[]) if (out[k] === undefined || (Array.isArray(out[k]) && !(out[k] as unknown[]).length)) delete out[k];
  return Object.keys(out).length ? out : undefined;
}

/** Which preset a livery's body paint matches (for the pressed state). */
function presetOf(lv: Livery): BodyPresetId | null {
  const key = JSON.stringify(lv.body ?? null);
  return BODY_PRESETS.find((p) => JSON.stringify(bodyPreset(p.id, lv) ?? null) === key)?.id ?? null;
}

export function BodyPresets({ lv, typeId, code, onBody }: { lv: Livery; typeId: string; code: string; onBody: Patch }) {
  const on = presetOf(lv);
  return (
    <section className="lv-section">
      <h4>Quick looks</h4>
      <div className="lv-presets">
        {BODY_PRESETS.map((p) => {
          const sample: Livery = { ...lv, plain: undefined, body: bodyPreset(p.id, lv) };
          return (
            <button key={p.id} type="button" className={`lv-scheme${on === p.id && !lv.plain ? ' on' : ''}`} aria-pressed={on === p.id && !lv.plain} title={p.hint} onClick={() => onBody(bodyPreset(p.id, lv))}>
              <AircraftArt typeId={typeId} livery={sample} code={code} detail="simple" height={40} />
              <span>{p.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Toggle({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={`lv-btn small lv-toggle${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)}>{children}</button>
  );
}

function Range({ label, min, max, step, value, fmt, onChange, disabled }: {
  label: string; min: number; max: number; step: number; value: number; fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className={`lv-slider${disabled ? ' off' : ''}`}>
      <span className="lv-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <output>{fmt(value)}</output>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** The fuselage: colour, belly (split height and angle), up to three stripes, the nose. */
export function BodyPanel({ lv, onBody }: { lv: Livery; onBody: Patch }) {
  const b = lv.body;
  const set = (patch: Partial<LiveryBody>) => onBody(withBody(b, patch));
  const stripes = b?.stripes ?? [];
  const setStripe = (i: number, p: Partial<LiveryStripe>) => set({ stripes: stripes.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const addStripe = () => set({ stripes: [...stripes, { color: stripes.length ? lv.secondary : lv.primary, y: stripes.length ? Math.min(0.85, (stripes[stripes.length - 1].y ?? 0.4) + 0.12) : 0.4, h: stripes.length ? 0.04 : 0.09, windows: !stripes.length || undefined }] });
  return (
    <>
      <section className="lv-section">
        <ColorPicker label="Fuselage" value={b?.color} auto autoColor="#ffffff" onChange={(c) => set({ color: c })} />
        <p className="lv-note small">Auto keeps the white of the drawing.</p>
      </section>
      <section className="lv-section">
        <div className="lv-textblock-head">
          <h4>Belly</h4>
          <Toggle on={!!b?.belly} onChange={(v) => set({ belly: v ? { color: lv.secondary, split: 0.62, tilt: 0, windows: true } : undefined })}>{b?.belly ? 'On' : 'Off'}</Toggle>
        </div>
        {b?.belly && (
          <>
            <ColorPicker label="Belly colour" value={b.belly.color} onChange={(c) => c && set({ belly: { ...b.belly!, color: c } })} />
            <div className="lv-row-toggles">
              <Toggle on={!!b.belly.windows} onChange={(v) => set({ belly: { ...b.belly!, windows: v || undefined } })}>Just below the windows</Toggle>
              <Toggle on={!!b.belly.line} onChange={(v) => set({ belly: { ...b.belly!, line: v ? { color: lv.primary, h: 0.02 } : undefined } })}>Line at the split</Toggle>
            </div>
            <Range label="Split" min={0.25} max={0.9} step={0.01} value={b.belly.split} fmt={pct} disabled={!!b.belly.windows} onChange={(v) => set({ belly: { ...b.belly!, split: v } })} />
            {b.belly.line && (
              <>
                <ColorPicker label="Line colour" value={b.belly.line.color} onChange={(c) => c && set({ belly: { ...b.belly!, line: { ...b.belly!.line!, color: c } } })} />
                <Range label="Line width" min={0.005} max={0.06} step={0.005} value={b.belly.line.h} fmt={pct} onChange={(v) => set({ belly: { ...b.belly!, line: { ...b.belly!.line!, h: v } } })} />
              </>
            )}
            <Range label="Angle" min={-1} max={1} step={0.05} value={b.belly.tilt} fmt={(v) => (Math.abs(v) < 0.025 ? 'level' : v > 0 ? `nose +${Math.round(v * 10)}` : `tail +${Math.round(-v * 10)}`)} onChange={(v) => set({ belly: { ...b.belly!, tilt: Math.abs(v) < 0.025 ? 0 : v } })} />
          </>
        )}
      </section>
      <section className="lv-section">
        <div className="lv-textblock-head">
          <h4>Stripes <small className="dim">{stripes.length} of {MAX_STRIPES}</small></h4>
          <button type="button" className="lv-btn small" disabled={stripes.length >= MAX_STRIPES} onClick={addStripe}>Add stripe</button>
        </div>
        {stripes.map((s, i) => (
          <div key={i} className="lv-stripe">
            <div className="lv-textblock-head">
              <b className="small">Stripe {i + 1}</b>
              <button type="button" className="lv-btn small ghost" onClick={() => set({ stripes: stripes.filter((_, k) => k !== i) })}>Remove</button>
            </div>
            <ColorPicker label="Colour" value={s.color} onChange={(c) => c && setStripe(i, { color: c })} />
            <div className="lv-row-toggles">
              <Toggle on={!!s.windows} onChange={(v) => setStripe(i, { windows: v || undefined })}>Along the windows</Toggle>
              <Toggle on={!!s.sweep} onChange={(v) => setStripe(i, { sweep: v || undefined })}>Sweep up the tail</Toggle>
            </div>
            <Range label="Height" min={0} max={1} step={0.01} value={s.y} fmt={pct} disabled={!!s.windows} onChange={(v) => setStripe(i, { y: v })} />
            <Range label="Width" min={0.02} max={0.3} step={0.005} value={s.h} fmt={pct} onChange={(v) => setStripe(i, { h: v })} />
          </div>
        ))}
      </section>
      <section className="lv-section">
        <div className="lv-textblock-head">
          <h4>Nose band</h4>
          <Toggle on={!!b?.noseBand} onChange={(v) => set({ noseBand: v ? { color: lv.primary, accent: lv.secondary } : undefined })}>{b?.noseBand ? 'On' : 'Off'}</Toggle>
        </div>
        {b?.noseBand && (
          <>
            <ColorPicker label="Band colour" value={b.noseBand.color} onChange={(c) => c && set({ noseBand: { ...b.noseBand!, color: c } })} />
            <ColorPicker label="Line under it" value={b.noseBand.accent} auto autoColor={b.noseBand.color} onChange={(c) => set({ noseBand: { ...b.noseBand!, accent: c } })} />
          </>
        )}
        <p className="lv-note small">Under the cockpit, from the nose tip back to the first door.</p>
      </section>
      <section className="lv-section">
        <div className="lv-textblock-head">
          <h4>Nose</h4>
          <Toggle on={!!b?.nose} onChange={(v) => set({ nose: v ? '#16213a' : undefined })}>{b?.nose ? 'On' : 'Off'}</Toggle>
        </div>
        {b?.nose && <ColorPicker label="Nose colour" value={b.nose} onChange={(c) => c && set({ nose: c })} />}
      </section>
    </>
  );
}

/** Tail (the scheme's two colours, independent of the fuselage) and the engines (own colour, intake lips). */
export function TailEnginePanel({ lv, onTail, onBody }: { lv: Livery; onTail: (p: Partial<Livery>) => void; onBody: Patch }) {
  const b = lv.body;
  const set = (patch: Partial<LiveryBody>) => onBody(withBody(b, patch));
  return (
    <>
      <section className="lv-section">
        <ColorPicker label="Tail" value={lv.primary} onChange={(c) => onTail({ primary: c ?? lv.primary })} />
        <ColorPicker label="Tail accent" value={lv.secondary} onChange={(c) => onTail({ secondary: c ?? lv.secondary })} />
        <div className="lv-textblock-head">
          <h4>Fin-root stripe</h4>
          <Toggle on={!!b?.finRoot} onChange={(v) => set({ finRoot: v ? lv.secondary : undefined })}>{b?.finRoot ? 'On' : 'Off'}</Toggle>
        </div>
        {b?.finRoot && <ColorPicker label="Stripe colour" value={b.finRoot} onChange={(c) => c && set({ finRoot: c })} />}
      </section>
      <section className="lv-section">
        <ColorPicker label="Engines" value={b?.engines} auto autoColor={b?.belly?.color ?? lv.primary} onChange={(c) => set({ engines: c })} />
        <p className="lv-note small">Auto paints the cowls in the belly colour, or the tail colour without a belly. The exhaust stays bare metal.</p>
        <div className="lv-textblock-head">
          <h4>Intake lips</h4>
          <Toggle on={!!b?.lip} onChange={(v) => set({ lip: v ? lv.secondary : undefined })}>{b?.lip ? 'Painted' : 'Bare metal'}</Toggle>
        </div>
        {b?.lip && <ColorPicker label="Lip colour" value={b.lip} onChange={(c) => c && set({ lip: c })} />}
      </section>
    </>
  );
}
