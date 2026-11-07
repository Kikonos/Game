// v0.18 the globe's marks, drawn as the flat map draws them (the same SVG shapes and CSS classes): offer pins (the
// offers filter applies, as on the flat map), weather and closure marks, world-event pins, crew-change marks, the
// diverted flights' rings and tags, and the world-event zones' names. React renders them once per hourly emit; the
// globe's frame loop places each one on screen (a transform per mark, hidden behind the Earth or near its limb).

import { CloudFog, CloudLightning, Ban, type LucideIcon, Moon } from 'lucide-react';
import { memo } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import type { ZoneView } from '../../../engine/ops';
import { HIT_R, pinOffset, type DivMark, WX_OFF } from '../LiveLayers';
import { EVENT_TONE, type EventPin, type PinGroup, type SlipMark } from '../mapLogic';
import type { WxKind, WxMark } from '../weather';
import { eventIcon } from '../WorldLayer';

export interface GlobeMarkProps {
  pins: PinGroup[];
  /** Airports already marked (their code shows above the dot): the pin sits to the left and carries no code. */
  marked: Set<string>;
  evPins: EventPin[];
  wx: WxMark[];
  slipMarks: SlipMark[];
  divs: DivMark[];
  zones: ZoneView[];
  /** The selection's id (offer, airport, event or crew change). */
  selected?: string;
  touch: boolean;
}

const WX_ICON: Record<WxKind, LucideIcon> = { storm: CloudLightning, cloud: CloudFog, curfew: Moon, closed: Ban };

/** [lon, lat] of an airport as the data attribute the loop reads ('' when unknown). */
const ll = (code: string) => {
  const a = AIRPORT_BY_CODE[code];
  return a ? `${a.lon},${a.lat}` : '';
};

/** The middle of a zone's ring (mean of its points on the sphere), as 'lon,lat'. */
function ringMid(ring: [number, number][]): string {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of ring) {
    const c = Math.cos((lat * Math.PI) / 180);
    x += c * Math.cos((lon * Math.PI) / 180);
    y += c * Math.sin((lon * Math.PI) / 180);
    z += Math.sin((lat * Math.PI) / 180);
  }
  const lon = (Math.atan2(y, x) * 180) / Math.PI;
  const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
  return `${lon},${lat}`;
}

export const GlobeMarks = memo(function GlobeMarks({ pins, marked, evPins, wx, slipMarks, divs, zones, selected, touch }: GlobeMarkProps) {
  const fs = touch ? 12 : 10.5;
  return (
    <>
      <g className="ops-zone-labels">
        {zones.map((z) => (
          <g key={z.eventId} className={`zl ${z.style}`} data-gm={`zone:${z.eventId}`} data-ll={ringMid(z.ring)} data-face="0.35">
            <text className="zone-label" y={4}>{z.label}</text>
          </g>
        ))}
      </g>
      <g className="ops-wx">
        <defs>
          {(['storm', 'cloud', 'curfew', 'closed'] as WxKind[]).map((k) => (
            <radialGradient key={k} id={`bh-gwx-${k}`} className={k}>
              <stop offset="0" className="h0" />
              <stop offset="0.55" className="h1" />
              <stop offset="1" className="h2" />
            </radialGradient>
          ))}
        </defs>
        {wx.map((m) => {
          const Icon = WX_ICON[m.kind];
          return (
            <g key={m.at} className={`wx ${m.kind}`} data-gm={`wx:${m.at}`} data-ll={ll(m.at)} data-off={`${WX_OFF[0]},${WX_OFF[1]}`}>
              <title>{`${m.at}: ${m.title}`}</title>
              <circle className="halo" r={28} fill={`url(#bh-gwx-${m.kind})`} />
              <g transform={`translate(${WX_OFF[0]} ${WX_OFF[1]})`}>
                <circle className="hit" r={HIT_R.touch * 0.8} />
                <circle className="disc" r={9.5} />
                <Icon x={-6.5} y={-6.5} width={13} height={13} strokeWidth={2.2} className="glyph" aria-hidden />
              </g>
            </g>
          );
        })}
      </g>
      <g className="dv-marker">
        {divs.map((m) => (
          <g key={m.id}>
            <g data-gm={`dvp:${m.id}`} data-ll={ll(m.to0)}>
              <circle className="dv-ring" r={11} />
              <text x={14} y={-8}>planned {m.to0}</text>
            </g>
            <g data-gm={`dva:${m.id}`} data-ll={ll(m.at)}>
              <text x={12} y={18}>DIVERTED {m.at}</text>
            </g>
          </g>
        ))}
      </g>
      <g className="ops-pins">
        {pins.map((p) => {
          const m = marked.has(p.code);
          const off = pinOffset(m);
          const sel = selected !== undefined && (selected === p.code || p.offers.some((o) => o.id === selected));
          return (
            <g key={p.code} className={`ops-pin ${p.urgent ? 'urgent' : ''} ${sel ? 'sel' : ''}`} data-gm={`pin:${p.code}`} data-ll={ll(p.code)} data-off={`${off[0]},${off[1]}`}>
              <g transform={`translate(${off[0]} ${off[1]})`}>
                {p.urgent && <circle className="ring" r={13} />}
                {sel && <circle className="sel-ring" r={16} />}
                <path className="dia" d="M0 -8.5L8.5 0L0 8.5L-8.5 0Z" />
                {p.offers.length > 1 && <text className="count" x={11} y={-7}>{p.offers.length}</text>}
                {(!m || sel) && <text className="code" y={21} style={{ fontSize: fs }}>{p.code}</text>}
              </g>
            </g>
          );
        })}
      </g>
      <g className="ops-events">
        {evPins.map((p) => {
          const Icon = eventIcon(p.kind);
          const sel = selected === p.eventId;
          return (
            <g key={p.eventId} className={`ops-ev ${EVENT_TONE[p.kind]}${sel ? ' sel' : ''}`} data-gm={`ev:${p.eventId}`} data-ll={ll(p.at)} data-off={`${p.off[0]},${p.off[1]}`}>
              <g transform={`translate(${p.off[0]} ${p.off[1]})`}>
                <title>{p.title}</title>
                {sel && <circle className="sel-ring" r={15} />}
                <circle className="disc" r={10} />
                <Icon x={-6.5} y={-6.5} width={13} height={13} strokeWidth={2.3} className="glyph" aria-hidden />
              </g>
            </g>
          );
        })}
      </g>
      <g className="ops-slips">
        {slipMarks.map((m) => {
          const sel = selected === m.id;
          return (
            <g key={m.id} className={`ops-slip${sel ? ' sel' : ''}`} data-gm={`slip:${m.id}`} data-ll={ll(m.at)} data-off={`${m.off[0]},${m.off[1]}`}>
              <g transform={`translate(${m.off[0]} ${m.off[1]})`}>
                <title>Crew change at {m.at}</title>
                {sel && <circle className="sel-ring" r={15} />}
                <circle className="disc" r={10} />
                <path className="glyph" d="M-5 -2.5H5M2.5 -5L5 -2.5L2.5 0M5 2.5H-5M-2.5 0L-5 2.5L-2.5 5" />
              </g>
            </g>
          );
        })}
      </g>
    </>
  );
});
