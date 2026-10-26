// v0.12 Visual A: spotter mode — for quiet days, to watch the planes. The map follows one airborne aircraft (WorldMap
// `follow`); this panel shows it big in its livery with its flight, route and progress, a plausible altitude and
// ground speed, and when it lands (local time at the destination). It moves on about every 60 s, or on Next; with
// nothing in the air it shows the next departure counting down, the aircraft on its stand. A view only: it reads the
// game, never changes it, and works the same with the clock running or paused.

import { SkyArt } from '../components/SkyArt';
import { ChevronRight, X } from 'lucide-react';
import { ACMI_TYPES, artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightTimes } from '../../engine/core/query';
import { fmtDuration, fmtTime } from '../../engine/core/time';
import type { Aircraft, Flight, GameState } from '../../engine/core/types';
import { AircraftArt } from '../components/AircraftArt';
import { Bar } from '../components/ui';
import { useClock } from '../store';
import { mapLivery } from './mapLogic';
import { flightProfile, nextDeparture, type SpotPhase } from './spotter';

const PHASE: Record<SpotPhase, string> = { taxiOut: 'Taxiing out', climb: 'Climbing', cruise: 'Cruising', descent: 'Descending', taxiIn: 'Taxiing in' };
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const ft = (n: number) => `${n.toLocaleString('en-US')} ft`;

function Art({ g, ac }: { g: GameState; ac: Aircraft }) {
  const lv = mapLivery(g, ac);
  // v0.12 against the sky of the local time where it is (or lands)
  return <SkyArt g={g} ac={ac} className="spot-art"><AircraftArt typeId={artFor(ac.typeId, ac.variant)} livery={lv.livery} code={lv.code} name={lv.name} reg={ac.reg} acName={ac.name} /></SkyArt>;
}

function Who({ ac }: { ac: Aircraft }) {
  return (
    <div className="spot-who">
      <b className="mono">{ac.reg}</b>
      {ac.name && <span className="spot-name">{ac.name}</span>}
      <span className="muted small">{ACMI_TYPES[ac.typeId]?.name ?? ac.typeId}</span>
    </div>
  );
}

function Route({ f, progress }: { f: Flight; progress: number }) {
  const to0 = f.div && f.div.to0 !== f.to ? f.div.to0 : null;
  return (
    <div className="spot-route">
      <div className="row between">
        <b className="mono">{f.no}</b>
        {to0 && <span className="warn-t small">Diverting to {f.to}</span>}
      </div>
      <div className="spot-ends">
        <span><b className="mono">{f.from}</b><span className="muted small">{city(f.from)}</span></span>
        <span className="spot-ends-to"><b className="mono">{f.to}</b><span className="muted small">{city(f.to)}</span></span>
      </div>
      <Bar value={progress} size="thin" />
    </div>
  );
}

function Airborne({ g, ac, t }: { g: GameState; ac: Aircraft; t: number }) {
  const f = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (!f) return null;
  const p = flightProfile(f, ac.typeId, t);
  const { on } = flightTimes(f);
  return (
    <>
      <Art g={g} ac={ac} />
      <Who ac={ac} />
      <Route f={f} progress={p.progress} />
      <div className="spot-stats">
        <div><span>Altitude</span><b className="num">{p.altFt ? ft(p.altFt) : 'On the ground'}</b><span className="muted small">{PHASE[p.phase]}</span></div>
        <div><span>Ground speed</span><b className="num">{p.gsKt} kt</b></div>
        <div><span>Lands</span><b className="num">{fmtTime(on, f.to)} local</b><span className="muted small">{on > t ? `in ${fmtDuration(on - t)}` : 'now'}</span></div>
      </div>
    </>
  );
}

function NextUp({ g, t }: { g: GameState; t: number }) {
  const nx = nextDeparture(g, t);
  if (!nx) return <p className="muted spot-empty">Nothing in the air and no departures planned.</p>;
  const { flight: f, ac } = nx;
  const dep = f.std + f.delay;
  return (
    <>
      <p className="muted small spot-empty">Nothing in the air right now. Next departure:</p>
      <Art g={g} ac={ac} />
      <Who ac={ac} />
      <Route f={f} progress={0} />
      <div className="spot-stats">
        <div><span>On stand at</span><b className="mono">{f.from}</b></div>
        <div><span>Leaves</span><b className="num">{fmtTime(dep, f.from)} local</b><span className="muted small">in {fmtDuration(Math.max(0, dep - t))}</span></div>
      </div>
    </>
  );
}

/** The spotter panel (right side, where the selection panel sits). `id`: the aircraft being followed, null for the next departure. */
export function SpotterPanel({ g, id, onNext, onClose, canNext }: { g: GameState; id: string | null; onNext: () => void; onClose: () => void; canNext: boolean }) {
  // Steps with the clock label (10–30 game minutes), so the numbers move calmly; paused, it stands still.
  const t = useClock();
  const ac = id ? g.fleet[id] : undefined;
  return (
    <aside className="ops-panel ops-spot card" aria-label="Spotter">
      <div className="op-head">
        <div className="col"><span className="upper dim">Spotter</span></div>
        {canNext && <button className="btn btn-ghost spot-next" onClick={onNext} aria-label="Next aircraft">Next <ChevronRight /></button>}
        <button className="btn btn-ghost btn-icon op-close" onClick={onClose} aria-label="Close spotter"><X /></button>
      </div>
      <div className="spot-body">
        {ac && ac.flightId ? <Airborne g={g} ac={ac} t={t} /> : <NextUp g={g} t={t} />}
      </div>
    </aside>
  );
}
