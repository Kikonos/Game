// v0.8 Ops Map world layer (UPDATE-0.8.md §5.6): world-event zones and pins. Calm and cheap: the zone fills are
// painted with the land in its composited layer (WorldMap `ground`), so panning and zooming never repaint them; only
// their labels, the selected zone's outline and the event pins sit in the light overlay (static, re-rendered with
// the hourly emit). Nothing here animates. The engine decides what is closed (worldZones); the map only draws it.

import { Ban, Cloud, Fan, Hand, type LucideIcon, PlaneLanding, Shield, TrendingDown, Waves } from 'lucide-react';
import { memo, useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { WorldEventKind } from '../../engine/core/types';
import { EVENT_ICON, type ZoneView } from '../../engine/ops';
import { HIT_R } from './LiveLayers';
import { EVENT_TONE, type EventPin, ringLabelAt, ringPath } from './mapLogic';
import type { MapLayerCtx } from './WorldMap';

type Proj = MapLayerCtx['proj'];

const ICONS: Record<string, LucideIcon> = { shield: Shield, hand: Hand, cloud: Cloud, wave: Waves, tailDown: PlaneLanding, noEntry: Ban, engine: Fan, chartDown: TrendingDown };

/** The event's glyph (lucide, by EVENT_ICON). */
export const eventIcon = (kind: WorldEventKind): LucideIcon => ICONS[EVENT_ICON[kind]] ?? Shield;

/** Hatch spacing in screen px (closed airspace). */
const HATCH_PX = 7;
const HATCH_ID = 'ops-zone-hatch';

/**
 * Hatch size (map units) for a zoom: quantised to whole octaves so a pinch only rewrites it (one repaint of the land
 * layer) when the zoom doubles or halves, never per frame.
 */
export const hatchUnit = (px: number, k: number) => HATCH_PX / (px * 2 ** Math.round(Math.log2(Math.max(1e-6, k))));

/** Zone fills for the land layer: closed (muted red + 45° hatch), war risk (amber dashed outline), ash (grey). */
export const ZoneGround = memo(function ZoneGround({ zones, proj, hatch }: { zones: ZoneView[]; proj: Proj; hatch: number }) {
  const shapes = useMemo(() => zones.map((z) => ({ z, d: ringPath(z.ring, proj) })).filter((s) => s.d), [zones, proj]);
  if (!shapes.length) return null;
  return (
    <g className="ops-zones" pointerEvents="none">
      {shapes.some((s) => s.z.style === 'closed') && (
        <defs>
          <pattern id={HATCH_ID} patternUnits="userSpaceOnUse" width={hatch} height={hatch} patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={hatch} className="hatch" strokeWidth={hatch * 0.16} />
          </pattern>
        </defs>
      )}
      {shapes.map(({ z, d }) => (
        <g key={z.eventId} className={`zone ${z.style}`}>
          <path className="fill" d={d} />
          {z.style === 'closed' && <path className="hatch-fill" d={d} fill={`url(#${HATCH_ID})`} />}
          <path className="edge" d={d} />
        </g>
      ))}
    </g>
  );
});

/** Label font px (screen) and the margin a zone must leave around it to show one. */
const LABEL_FS = 11;
const LABEL_PAD = 16;

/**
 * Overlay part of the zones: 'Closed · Sudan' at the shape's centre once the shape is wide enough on screen for it,
 * and the selected event's outline. Text in a `.mk` group (screen px; WorldMap counter-scales it live).
 */
export const ZoneLabels = memo(function ZoneLabels({ zones, proj, unit, selected }: { zones: ZoneView[]; proj: Proj; unit: number; selected?: string }) {
  const items = useMemo(() => zones.map((z) => ({ z, at: ringLabelAt(z.ring, proj), d: z.eventId === selected ? ringPath(z.ring, proj) : '' })), [zones, proj, selected]);
  if (!items.length) return null;
  return (
    <g className="ops-zone-labels" pointerEvents="none">
      {items.map(({ z, at, d }) => {
        const show = !!at && at.w / unit >= z.label.length * LABEL_FS * 0.6 + LABEL_PAD;
        return (
          <g key={z.eventId} className={`zl ${z.style}`}>
            {d && <path className="zone-sel" d={d} />}
            {at && (show || d) && (
              <g transform={`translate(${at.x} ${at.y})`}>
                <g className="mk" transform={`scale(${unit})`}>
                  <text className="zone-label" y={4}>{z.label}</text>
                </g>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
});

/** Event pins: one small static disc with the kind's glyph at the event's airport (44 px hit), above the offer pins. */
export const EventPinsLayer = memo(function EventPinsLayer({ pins, proj, unit, selected }: { pins: EventPin[]; proj: Proj; unit: number; selected?: string }) {
  const pts = useMemo(() => pins.map((p) => {
    const a = AIRPORT_BY_CODE[p.at];
    return { p, q: a ? proj([a.lon, a.lat]) : null };
  }), [pins, proj]);
  return (
    <g className="ops-events">
      {pts.map(({ p, q }) => {
        if (!q) return null;
        const Icon = eventIcon(p.kind);
        const sel = selected === p.eventId;
        return (
          <g key={p.eventId} transform={`translate(${q[0]} ${q[1]})`} className={`ops-ev ${EVENT_TONE[p.kind]}${sel ? ' sel' : ''}`} data-id={p.eventId}>
            <g className="mk" transform={`scale(${unit})`}>
              <g transform={`translate(${p.off[0]} ${p.off[1]})`}>
                <title>{p.title}</title>
                <circle className="hit" r={HIT_R.touch} />
                {sel && <circle className="sel-ring" r={15} />}
                <circle className="disc" r={10} />
                <Icon x={-6.5} y={-6.5} width={13} height={13} strokeWidth={2.3} className="glyph" aria-hidden />
              </g>
            </g>
          </g>
        );
      })}
    </g>
  );
});
