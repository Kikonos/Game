// v0.18 the aircraft spec sheet (player: "when buying or leasing the information is quite limited"), after an
// operator's own spec sheets (Euro Atlantic Airways): who and what it is with its side-view art, the key figures as
// an icon row, range discs from our base and four world cities, the money and terms, how it fits our network, and a
// seat map of every standard cabin of the type with this airframe's own highlighted. Also the side-by-side compare
// of up to three Market offers. Lazy chunk (ui/specs/SpecsLink.tsx opens it); reads the game, changes nothing.

import { Armchair, BedDouble, Columns3, Fan, FileText, Fuel, Gauge, Globe, MonitorPlay, Package, Plug, Route, Ruler, Sofa, Users, Volume2, Weight, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { CabinPreset } from '../../data/acmiTypes';
import { amenity } from '../../data/specs';
import { lopaOf } from '../../data/lopa';
import { rangeFromNm, typeOf } from '../../engine/core/perf';
import type { Cabin } from '../../engine/core/types';
import { AircraftArt } from '../components/AircraftArt';
import { Modal, Seg } from '../components/ui';
import { KV } from '../screens/common';
import { capFirst, layoutLabel } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { discLandReady, discSvg, loadDiscLand } from './rangeDiscs';
import { seatMap, seatMapSvg, type SeatMap } from './seatMap';
import { cabinFigures, discCities, keyFigures, specData, type KeyFig, type SpecData, type SpecSubject } from './specLogic';
import type { SpecTarget } from './SpecsLink';
import './seatmap.css';
import './specs.css';

const ICON: Record<string, ReactNode> = {
  range: <Globe />, cruise: <Gauge />, mtow: <Weight />, cargo: <Package />, engines: <Fan />, fuel: <Fuel />, etops: <Route />, runway: <Ruler />, noise: <Volume2 />,
  j: <Sofa />, w: <Armchair />, y: <Armchair />, fc: <BedDouble />, cc: <BedDouble />, ife: <MonitorPlay />, power: <Plug />, crew: <Users />,
};

function Figs({ figs, label }: { figs: KeyFig[]; label: string }) {
  return (
    <div className="sp-figs" role="list" aria-label={label}>
      {figs.map((f) => (
        <div key={f.k} className={`sp-fig k-${f.k}`} role="listitem">
          <span className="sp-fig-ico" aria-hidden>{ICON[f.k]}</span>
          <span className="sp-fig-l">{f.label}</span>
          <b className="sp-fig-v">{f.value}</b>
          {f.sub && <span className="sp-fig-s">{f.sub}</span>}
        </div>
      ))}
    </div>
  );
}

/** Holds game time while the sheet is open (the dialog under it may not). */
function useHoldTime() {
  useEffect(() => {
    const was = store.holdTime;
    store.holdTime = true;
    return () => { store.holdTime = was; };
  }, []);
}

function RangeDiscs({ d }: { d: SpecData }) {
  const g = useGame();
  const [, setReady] = useState(discLandReady());
  useEffect(() => {
    let live = true;
    loadDiscLand().then(() => live && setReady(true)).catch(() => {});
    return () => { live = false; };
  }, []);
  const cities = discCities(g);
  return (
    <section className="sp-sec">
      <h3 className="sp-h">Range from</h3>
      <div className="sp-discs">
        {cities.map((c) => {
          const a = AIRPORT_BY_CODE[c];
          if (!a) return null;
          const nm = rangeFromNm(d.typeId, c);
          return (
            <figure key={c} className="sp-disc" aria-label={`From ${a.city}: ${Math.round(nm * 1.852).toLocaleString('en-US')} km at full payload`}>
              <div className="sp-disc-svg" dangerouslySetInnerHTML={{ __html: discSvg(a.lat, a.lon, nm, 132) }} />
              <figcaption><b>{a.city}</b><span>{(Math.round((nm * 1.852) / 10) * 10).toLocaleString('en-US')} km</span></figcaption>
            </figure>
          );
        })}
      </div>
      <div className="tiny dim">Full passenger payload with reserves, still air. A short or high runway takes range off (the city's longest runway counts).</div>
    </section>
  );
}

/** The cabin tabs: every standard cabin of the type; this airframe's own first when it is none of them. */
function cabinTabs(d: SpecData): { key: string; label: string; cab: Cabin | CabinPreset; own: boolean }[] {
  const own = d.cabin;
  const tabs = d.presets.map((p) => ({ key: `${p.layout}:${p.label}`, label: p.label, cab: p, own: !!own && own.j === p.j && own.w === p.w && own.y === p.y }));
  if (own && !tabs.some((t) => t.own)) tabs.unshift({ key: 'own', label: own.label, cab: own, own: true });
  return tabs;
}

const CLS_NAME = { J: 'Business', W: 'Premium economy', Y: 'Economy', R: 'Crew rest seats' } as const;

function SeatMapSection({ d }: { d: SpecData }) {
  const tabs = cabinTabs(d);
  const ownTab = tabs.find((t) => t.own) ?? tabs[0];
  const [key, setKey] = useState(ownTab.key);
  const tab = tabs.find((t) => t.key === key) ?? ownTab;
  const [zoom, setZoom] = useState(1);
  const cab = tab.cab;
  const m = useMemo(() => seatMap(d.typeId, { j: cab.j, w: cab.w, y: cab.y, layout: cab.layout }, { variant: d.variant, restSeats: tab.own ? d.restSeats : 0, bunks: tab.own && d.bunks }), [d.typeId, d.variant, cab, tab.own, d.restSeats, d.bunks]);
  const svg = m.ok ? seatMapSvg(m) : '';
  const lopa = lopaOf(d.typeId, d.variant);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { box.current?.scrollTo({ top: 0 }); }, [key]);
  return (
    <section className="sp-sec">
      <div className="row gap-12 wrap sp-map-head">
        <h3 className="sp-h">Seat map</h3>
        <Seg<string> value={tab.key} onChange={setKey} options={tabs.map((t) => ({ value: t.key, label: <span className="row gap-4">{t.own && <span className="sp-own-dot" aria-label="This aircraft" />}{t.label}</span> }))} />
        <span className="tiny dim grow">{capFirst(layoutLabel(cab.layout))}{tab.own && d.cabin ? ' · this aircraft' : ''}</span>
      </div>
      {m.ok ? (
        <div className="sp-map">
          <div className="sp-map-col">
            <div className="sp-zoom">
              <button className="btn btn-icon btn-sm" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1} aria-label="Zoom out"><ZoomOut /></button>
              <button className="btn btn-icon btn-sm" onClick={() => setZoom((z) => Math.min(3.4, z * 1.5))} disabled={zoom >= 3.3} aria-label="Zoom in"><ZoomIn /></button>
            </div>
            <div className="sp-map-box" ref={box}>
              <div className={`sp-map-svg ${m.decks.length > 1 ? 'two' : ''}`} style={{ width: `${zoom * 100}%` }} role="img" aria-label={mapLabel(d, m)} dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          </div>
          <div className="sp-map-side">
            <ClassCards d={d} m={m} layout={cab.layout} />
            <Legend m={m} bunks={tab.own && d.bunks} />
            <SeatTable m={m} />
            {lopa && <div className="tiny dim">Layout after {lopa.src}. Row 13 is left out, as many airlines do.</div>}
          </div>
        </div>
      ) : (
        <div className="sp-nomap">
          <span className="small muted">{m.reason}.</span>
          <SeatCounts cab={cab} />
        </div>
      )}
    </section>
  );
}

function mapLabel(d: SpecData, m: SeatMap): string {
  const parts = m.decks.map((k) => `${k.id === 'upper' ? 'Upper deck' : 'Main deck'}: ${Object.entries(k.abreast).filter(([c]) => c !== 'R').map(([c, a]) => `${k.counts[c as 'J' | 'W' | 'Y']} ${CLS_NAME[c as 'J'].toLowerCase()} ${a}`).join(', ')}, ${k.doors.filter((x) => !x.ow).length} door pairs`);
  return `Seat map of the ${d.t.name}: ${parts.join('; ')}`;
}

function ClassCards({ d, m, layout }: { d: SpecData; m: SeatMap; layout: string }) {
  const classes = (['J', 'W', 'Y'] as const).filter((c) => m.counts[c] > 0);
  return (
    <div className="sp-classes">
      {classes.map((c) => {
        const ab = m.decks.map((k) => k.abreast[c]).filter(Boolean).join(' / ');
        const pitch = m.pitch[c] ?? 30;
        const a = amenity(d.typeId, c, m.decks.find((k) => k.abreast[c])?.abreast[c] ?? '', pitch, layout);
        return (
          <div key={c} className={`sp-class c-${c}`}>
            <div className="row between"><b>{CLS_NAME[c]}</b><span className="num">{m.counts[c]} seats</span></div>
            <div className="sp-chips">
              <span className="sp-chip">{a.seat}</span>
              <span className="sp-chip">{ab}</span>
              <span className="sp-chip" title="Seat pitch">{Math.round(pitch)} in pitch</span>
              <span className="sp-chip" title="Seat width">{a.width} in wide</span>
              {a.recline !== 'flat' && <span className="sp-chip">{a.recline} recline</span>}
              <span className="sp-chip">{a.screen ? `${a.screen} in screen` : c === 'Y' && d.t.body === 'wide' ? 'Streamed IFE' : 'No screen'}</span>
              <span className="sp-chip">{a.power === 'ac' ? 'AC + USB' : a.power === 'usb' ? 'USB' : 'No power'}</span>
            </div>
          </div>
        );
      })}
      {m.tight && <div className="small warn">Tighter than any airline flies: this many seats only at the exit limit.</div>}
      {m.dense && <div className="small muted">High-density economy ({m.decks[0].abreast.Y}).</div>}
    </div>
  );
}

function Legend({ m, bunks }: { m: SeatMap; bunks: boolean }) {
  const doors = m.decks.map((k) => `${k.doors.filter((x) => !x.ow).length}${k.id === 'upper' ? ' upper' : ''}`).join(' + ');
  const ow = m.decks.reduce((n, k) => n + k.doors.filter((x) => x.ow).length, 0);
  return (
    <div className="sp-legend small">
      <span><i className="lg door" />Doors: {doors} each side</span>
      {ow > 0 && <span><i className="lg ow" />Overwing exits: {ow} each side</span>}
      {m.decks.some((k) => k.rows.some((r) => r.exit)) && <span><i className="lg exit" />Exit rows</span>}
      <span><i className="lg mon" />Galley <i className="lg wc" />Lavatory</span>
      {m.decks.some((k) => k.rows.some((r) => r.cls === 'R')) && <span><i className="lg rest-seat" />Crew rest seats</span>}
      {bunks && <span><i className="lg rest" />Crew bunks (dashed: overhead or under the floor)</span>}
    </div>
  );
}

/** The text alternative: rows, abreast and pitch per class and deck. */
function SeatTable({ m }: { m: SeatMap }) {
  return (
    <table className="sp-table small">
      <thead><tr><th>Class</th><th>Seats</th><th>Rows</th><th>Abreast</th><th>Pitch</th></tr></thead>
      <tbody>
        {m.decks.flatMap((k) => (['J', 'W', 'R', 'Y'] as const).filter((c) => k.counts[c] > 0).map((c) => {
          const rows = k.rows.filter((r) => r.cls === c);
          return (
            <tr key={`${k.id}${c}`}>
              <td>{CLS_NAME[c]}{m.decks.length > 1 ? ` (${k.id === 'upper' ? 'upper' : 'main'})` : ''}</td>
              <td className="num">{k.counts[c]}</td>
              <td className="num">{rows.length ? `${rows[0].n}–${rows[rows.length - 1].n}` : ''}</td>
              <td>{k.abreast[c]}</td>
              <td className="num">{Math.round(m.pitch[c] ?? 0)} in</td>
            </tr>
          );
        }))}
      </tbody>
    </table>
  );
}

function SeatCounts({ cab }: { cab: Cabin | CabinPreset }) {
  return (
    <table className="sp-table small">
      <thead><tr><th>Class</th><th>Seats</th></tr></thead>
      <tbody>
        {cab.j > 0 && <tr><td>Business</td><td className="num">{cab.j}</td></tr>}
        {cab.w > 0 && <tr><td>Premium economy</td><td className="num">{cab.w}</td></tr>}
        {cab.y > 0 && <tr><td>Economy</td><td className="num">{cab.y}</td></tr>}
      </tbody>
    </table>
  );
}

function OneSheet({ d }: { d: SpecData }) {
  const g = useGame();
  const cab = d.cabin ?? d.presets[0];
  return (
    <>
      <div className="sp-top">
        <div className="sp-art"><AircraftArt typeId={d.art.typeId} livery={d.art.livery} code={d.art.code} name={d.art.name} reg={d.art.reg} acName={d.art.acName} /></div>
        <div className="sp-id">
          <div className="row gap-8 wrap"><h3 className="sp-title">{d.title}</h3>{d.badge && <span className={`badge ${d.badge.tone}`}>{d.badge.label}</span>}</div>
          <div className="small muted">{d.sub}</div>
          {d.artNote && <div className="tiny dim">{d.artNote}</div>}
          <div className="sp-facts">{d.facts.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
        </div>
      </div>
      <Figs figs={keyFigures(g, d)} label="Key figures" />
      {cab && <Figs figs={cabinFigures(d, cab)} label="Cabin and crew" />}
      <RangeDiscs d={d} />
      <div className="sp-cols">
        <section className="sp-sec">
          <h3 className="sp-h">Money and terms</h3>
          <KV rows={d.money} />
          {d.lessor && <div className="small mt-8"><b>{d.lessor.name}</b>{d.lessor.note ? <span className="muted"> · {d.lessor.note}</span> : null}<div className="muted">{d.lessor.stance}</div></div>}
        </section>
        <section className="sp-sec">
          <h3 className="sp-h">Running cost</h3>
          <KV rows={d.ops} />
          <h3 className="sp-h mt-12">Our network</h3>
          {d.fit ? d.fit.lines.map((l, i) => <div key={i} className={`small ${l.tone}`}>{l.text}</div>) : <div className="small muted">No routes signed yet.</div>}
        </section>
      </div>
      <SeatMapSection d={d} />
    </>
  );
}

// ---------- compare ----------

function CompareView({ ds, onOpen }: { ds: SpecData[]; onOpen: (s: SpecSubject) => void }) {
  const g = useGame();
  const row = (label: string, f: (d: SpecData) => ReactNode) => (
    <tr key={label}><th scope="row">{label}</th>{ds.map((d, i) => <td key={i}>{f(d)}</td>)}</tr>
  );
  const kv = (d: SpecData, k: string) => d.money.find(([x]) => x === k)?.[1] ?? '—';
  const fact = (d: SpecData, k: string) => d.facts.find(([x]) => x === k)?.[1] ?? '—';
  return (
    <div className="sp-cmp-wrap">
      <table className="sp-cmp">
        <thead>
          <tr>
            <th />
            {ds.map((d, i) => (
              <th key={i} scope="col">
                <div className="sp-cmp-art"><AircraftArt typeId={d.art.typeId} livery={d.art.livery} detail="simple" /></div>
                <b>{d.title.replace(/^Offered: /, '')}</b>
                <div className="tiny muted">{d.lessor?.name ?? ''}</div>
                <button className="btn btn-sm mt-8" onClick={() => onOpen(d.subject)}><FileText /> Full sheet</button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {row('Built', (d) => fact(d, 'Built'))}
          {row('Before', (d) => fact(d, 'Before'))}
          {row('Ready', (d) => fact(d, 'Ready'))}
          {row('Cabin', (d) => d.cabin?.label ?? '—')}
          {row('Range', (d) => `${Math.round(d.t.rangeNm * 1.852).toLocaleString('en-US')} km`)}
          {row('Range from base', (d) => `${Math.round(rangeFromNm(d.typeId, g.company.homeBase) * 1.852).toLocaleString('en-US')} km`)}
          {row('Pilots rest', (d) => d.rest ? cabinFigures(d, d.cabin!).find((f) => f.k === 'fc')?.value ?? '—' : '—')}
          {row('Cabin crew rest', (d) => d.rest ? cabinFigures(d, d.cabin!).find((f) => f.k === 'cc')?.value ?? '—' : '—')}
          {row('Rent or price', (d) => kv(d, 'Rent') !== '—' ? kv(d, 'Rent') : kv(d, 'Price'))}
          {row('Deposit', (d) => kv(d, 'Deposit'))}
          {row('Reserves', (d) => kv(d, 'Reserves'))}
          {row('Running cost', (d) => kv(d, 'Running cost'))}
          {row('ETOPS', (d) => d.etops)}
          {row('Runway', (d) => `${typeOf(d.typeId).minRunwayM.toLocaleString('en-US')} m`)}
          {row('Our network', (d) => d.fit?.lines[0]?.text ?? 'No routes yet')}
          {row('Lessor', (d) => d.lessor?.stance ?? '—')}
        </tbody>
      </table>
    </div>
  );
}

export default function SpecSheet({ target, onClose }: { target: SpecTarget; onClose: () => void }) {
  useHoldTime();
  const g = useGame();
  // From the compare, a column's full sheet (Back returns to the compare).
  const [one, setOne] = useState<SpecSubject | null>(null);
  const cur: SpecTarget = one ?? target;
  const single = cur.kind !== 'compare' ? specData(g, cur) : null;
  const many = cur.kind === 'compare' ? cur.offerIds.map((id) => specData(g, { kind: 'offer', id })).filter((x): x is SpecData => !!x) : [];
  const title = cur.kind === 'compare' ? `Compare ${many.length} offers` : 'Aircraft spec sheet';
  return (
    <Modal className="sp-modal" size="xwide" title={title} icon={cur.kind === 'compare' ? <Columns3 className="accent" /> : <FileText className="accent" />} onClose={onClose} footer={one ? (
      <>
        <span className="grow" />
        <button className="btn" onClick={() => setOne(null)}>Back to compare</button>
        <button className="btn btn-primary" onClick={onClose}><X /> Close</button>
      </>
    ) : undefined}>
      {cur.kind === 'compare'
        ? (many.length ? <CompareView ds={many} onOpen={setOne} /> : <p className="muted">These offers have gone.</p>)
        : single ? <OneSheet d={single} /> : <p className="muted">This aircraft or offer is no longer there.</p>}
    </Modal>
  );
}
