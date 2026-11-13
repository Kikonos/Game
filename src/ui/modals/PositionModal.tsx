// v0.23.3 Position an aircraft (player request): opened from an idle stretch on the Schedule, beside Book C-check,
// Book A-check and Cabin refit. Pick where to (a shortlist first, then search), see the plan the schedule's own ferry
// planner flies (route, times, cost, crew, what follows) and confirm; refused with one plain reason when it can't be
// done. Engine: ops/position.ts (the quote is worked out on a copy of the game; the booking is that same plan).

import { PlaneTakeoff, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORTS, AIRPORT_BY_CODE } from '../../data/airports';
import { flightsRev } from '../../engine/core/entities';
import { typeOf } from '../../engine/core/perf';
import { fmtDay, fmtDuration, fmtTime } from '../../engine/core/time';
import { positionAircraft, positionTargets, quotePosition, type PositionQuote, type PositionTarget } from '../../engine/ops/position';
import { Help } from '../components/Help';
import { Modal, Stepper } from '../components/ui';
import { money } from '../format';
import { KV } from '../screens/common';
import { store, useGame } from '../store';

/** Airports matching what was typed: code first, then city and name; never fuel-stop fields or ice runways. */
export function searchAirports(text: string, skip: string, max = 6): PositionTarget[] {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank = (a: (typeof AIRPORTS)[number]) => (a.code.toLowerCase() === q ? 0 : a.code.toLowerCase().startsWith(q) ? 1 : a.city.toLowerCase().startsWith(q) ? 2 : a.city.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) ? 3 : 9);
  return AIRPORTS.filter((a) => !a.enroute && !a.ice && a.code !== skip && rank(a) < 9)
    .sort((a, b) => rank(a) - rank(b) || b.size - a.size || (a.code < b.code ? -1 : 1))
    .slice(0, max)
    .map((a) => ({ code: a.code, tag: a.city }));
}

const both = (t: number, ap: string) => `${fmtDay(t)} ${fmtTime(t)} UTC · ${fmtTime(t, ap)} ${ap}`;
const laterText = (h: number) => (h === 0 ? 'Earliest' : h % 24 === 0 ? `+${h / 24} day${h === 24 ? '' : 's'}` : `+${h} h`);

function Plan({ q }: { q: PositionQuote }) {
  const first = q.legs[0];
  const last = q.legs[q.legs.length - 1];
  const nights = q.legs.filter((l) => l.night).length;
  const fuelStops = q.stops.length - nights;
  const via = [nights ? `${nights} night stop${nights > 1 ? 's' : ''}` : '', fuelStops > 0 ? `${fuelStops} fuel stop${fuelStops > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
  const tone = q.crew?.level === 'ok' ? 'good' : q.crew?.level === 'tight' ? 'warn' : q.crew?.level === 'later' ? 'muted' : 'bad';
  return (
    <div className="cv-cost ps-plan">
      <b className="ps-route">{[first.from, ...q.legs.map((l) => l.to)].join(' → ')}</b>
      <KV rows={[
        ['Leaves', both(first.std, first.from)],
        ['Lands', both(last.sta, last.to)],
        ['Block', `${fmtDuration(q.block, true)}${via ? ` · ${via}` : ''}`],
        ['Cost', <>{money(q.total)} <span className="ps-sub">fuel {money(q.fuel)} · fees {money(q.fees)}{q.crewCost ? ` · crew travel ${money(q.crewCost)}` : ''}</span></>],
        ...(q.crew ? [['Crew', <span className={tone}>{q.crew.text}</span>] as [string, React.ReactNode]] : []),
      ]} />
      {q.notes.map((n) => <span key={n} className="small muted">{n}</span>)}
    </div>
  );
}

export function PositionModal({ aircraftId, from }: { aircraftId: string; from: number }) {
  const g = useGame();
  const ac = g.fleet[aircraftId];
  const [to, setTo] = useState<string | null>(null);
  const [later, setLater] = useState(0);
  const [text, setText] = useState('');
  const rev = flightsRev(g);
  const list = useMemo(() => positionTargets(g, aircraftId, from, 6), [g, aircraftId, from, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useMemo(() => (list[0] ? quotePosition(g, aircraftId, list[0].code, { from, quick: true }) : null), [g, aircraftId, from, list, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useMemo(() => (to ? quotePosition(g, aircraftId, to, { from, later: later * 60 }) : null), [g, aircraftId, to, from, later, rev, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  // On a short screen the plan is under the fold: bring it into view once a destination is picked.
  const planRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (to) planRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [to, q]);
  if (!ac) return null;
  const at = q?.from || first?.from || ac.at;
  const found = searchAirports(text, at);
  const close = () => store.closeModal();
  const pick = (code: string) => {
    setTo(code);
    setLater(0);
  };
  const book = () => {
    if (!to || !q?.ok) return;
    if (store.act((gg) => positionAircraft(gg, aircraftId, to, { from, later: later * 60 })).ok) close();
  };
  const chip = (x: PositionTarget) => (
    <button key={x.code} className={`cv-chip rf-chip ps-chip ${x.code === to ? 'on' : ''}`} aria-pressed={x.code === to} title={x.hint} onClick={() => pick(x.code)}>
      <b>{x.code}</b>
      <span className="tiny dim">{x.tag}</span>
    </button>
  );
  const free = q?.earliest ?? first?.earliest ?? null;
  return (
    <Modal
      className="ps-modal"
      title={<>Position · {ac.reg} <Help title="Position an aircraft">
        <p>Sends the aircraft empty to another airport. It flies the usual ferry route, with fuel stops if it needs them, as soon as two pilots can legally take it.</p>
        <p>You pay fuel, airport fees and the pilots’ travel as it flies. Nothing is charged now.</p>
        <p>It then waits there for work: no automatic ferry home. Its next job starts from where it stands.</p>
        <p>Cancel it from the Schedule before it leaves: tap the flight. Crew tickets already bought are not refunded.</p>
      </Help></>}
      icon={<PlaneTakeoff className="accent" />} onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>Cancel</button>
          <span className="grow" />
          <button className="btn btn-primary" onClick={book} disabled={!q?.ok}><PlaneTakeoff /> {q?.ok ? `Position · ${money(q.total)}` : 'Position'}</button>
        </>
      }
    >
      <div className="col gap-12">
        <div className="small muted">{typeOf(ac.typeId).short} at {AIRPORT_BY_CODE[at]?.city ?? at} ({at}){free !== null ? ` · can leave ${fmtDay(free)} ${fmtTime(free)} UTC` : ''}</div>
        <div className="upper dim">To</div>
        <div className="row wrap gap-8">
          {list.map(chip)}
          {to && !list.some((x) => x.code === to) && !found.some((x) => x.code === to) && chip({ code: to, tag: AIRPORT_BY_CODE[to]?.city ?? '' })}
        </div>
        <label className="ps-search">
          <Search aria-hidden />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Another airport: code or city" aria-label="Search airports" autoCorrect="off" autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" />
        </label>
        {text.trim().length >= 2 && (
          <div className="row wrap gap-8">
            {found.map(chip)}
            {!found.length && <span className="small muted">No airport found.</span>}
          </div>
        )}
        <div ref={planRef} className="col gap-12">
          {q?.ok && <Plan q={q} />}
          {q && !q.ok && <div className="cv-cost small ps-no"><b className="bad">Not possible</b><span>{q.reason}.</span></div>}

        {q && (q.ok || later > 0) && (
          <div className="row between gap-8 ps-later">
            <span className="small muted">Leave</span>
            <Stepper value={later} min={0} max={14 * 24} step={6} onChange={setLater} format={laterText} />
          </div>
        )}
        {!q && <div className="small muted">Pick where {ac.reg} should go.</div>}
        </div>
      </div>
    </Modal>
  );
}
