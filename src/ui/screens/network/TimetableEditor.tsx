// v0.19 the timetable editor (docs/UPDATE-0.19.md §D.1, §K): one series' pattern (weekly days, every N weeks or
// monthly), local departure times, nights at the destination, the aircraft type and cabin, a pinned tail and the
// dates. The engine checks turns, runways, curfews, slots and the crew day before it saves (setSeries).

import { Check, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { CabinLayout } from '../../../data/acmiTypes';
import { typeOf } from '../../../engine/core/perf';
import { DAY } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { monthsWords, seasonMonths } from '../../../engine/network/model';
import type { Route, RouteSeries } from '../../../engine/network/types';
import { Seg, Stepper } from '../../components/ui';
import { store } from '../../store';
import { net } from './netApi';
import { DAY_SHORT, daysOf, hhmm, LAYOUT_WORD, marketOf, seriesWords } from './networkLogic';

const NTH: { value: number; label: string }[] = [{ value: 1, label: '1st' }, { value: 2, label: '2nd' }, { value: 3, label: '3rd' }, { value: 4, label: '4th' }, { value: -1, label: 'Last' }];

function dateInput(t: number): string {
  const d = new Date(Date.UTC(2000, 0, 1) + t * 60_000);
  return d.toISOString().slice(0, 10);
}
function fromInput(v: string): number | null {
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round((ms - Date.UTC(2000, 0, 1)) / 60_000) : null;
}

export function TimetableEditor({ g, r, series, onDone }: { g: GameState; r: Route; series?: RouteSeries; onDone: () => void }) {
  const m = marketOf(r);
  const base = series ?? r.series[0];
  const [s, setS] = useState<RouteSeries>(() => base ? { ...base, id: series ? base.id : '' } : {
    id: '', days: 1 << (m?.timetable.day ?? 4), every: 1, out: m?.timetable.out ?? 400, back: m?.timetable.back ?? 810, nights: m?.timetable.nights ?? 0,
    typeId: 'b763', layout: 'two-class', from: g.now + 60 * DAY, to: g.now + 240 * DAY,
  });
  const [err, setErr] = useState<string | null>(null);
  const monthly = !!s.monthly;
  const season = m ? seasonMonths(m) : null;
  const fleetTypes = useMemo(() => [...new Set(Object.values(g.fleet).map((a) => a.typeId))], [g.fleet]);
  const tails = Object.values(g.fleet).filter((a) => a.typeId === s.typeId && a.status !== 'leasedOut');
  const layouts: CabinLayout[] = ['two-class', 'all-economy', 'three-class'];
  const set = (x: Partial<RouteSeries>) => { setErr(null); setS({ ...s, ...x }); };
  const toggle = (i: number) => {
    const days = s.days ^ (1 << i);
    if (days) set({ days });
  };
  const save = () => {
    const res = store.act((gg) => {
      const why = net.setSeries(gg, r.id, s);
      return why ? { ok: false, error: why } : { ok: true, msg: `Timetable saved: ${seriesWords(s)}` };
    });
    if (res.ok) onDone();
    else setErr(res.error);
  };
  return (
    <div className="nw-tt">
      <div className="nw-draft-row">
        <span className="small muted">How often</span>
        <Seg<string> value={monthly ? 'm' : String(s.every)} onChange={(v) => set(v === 'm' ? { monthly: { nth: 1, weekday: daysOf(s.days)[0] ?? 4 } } : { monthly: undefined, every: Number(v) })} options={[{ value: '1', label: 'Weekly' }, { value: '2', label: 'Every 2 wk' }, { value: '4', label: 'Every 4 wk' }, { value: 'm', label: 'Monthly' }]} />
      </div>
      {monthly && (
        <div className="nw-draft-row">
          <span className="small muted">Which week</span>
          <Seg<number> value={s.monthly!.nth} onChange={(v) => set({ monthly: { ...s.monthly!, nth: v } })} options={NTH} />
        </div>
      )}
      <div className="nw-draft-row">
        <span className="small muted">{monthly ? 'Day' : 'Days'}</span>
        <div className="nw-days" role="group" aria-label="Days of the week">
          {DAY_SHORT.map((n, i) => {
            const on = monthly ? s.monthly!.weekday === i : !!(s.days & (1 << i));
            return <button key={n} className={`nw-day ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => (monthly ? set({ monthly: { ...s.monthly!, weekday: i }, days: 1 << i }) : toggle(i))}>{n.slice(0, 2)}</button>;
          })}
        </div>
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Leaves {m?.from ?? ''}</span>
        <Stepper value={s.out} min={0} max={DAY - 15} step={15} onChange={(v) => set({ out: v })} format={(v) => `${hhmm(v)} local`} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Nights at {m?.to ?? 'the destination'}</span>
        <Stepper value={s.nights} min={0} max={6} onChange={(v) => set({ nights: v })} format={(v) => (v ? String(v) : 'Same day')} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Back from {m?.to ?? 'there'}</span>
        <Stepper value={s.back} min={0} max={DAY - 15} step={15} onChange={(v) => set({ back: v })} format={(v) => `${hhmm(v)} local`} />
      </div>
      <div className="nw-draft-row">
        <span className="small muted">Aircraft</span>
        <span className="row gap-6 wrap">
          <select className="nw-select" value={s.typeId} onChange={(e) => set({ typeId: e.target.value, tail: undefined })} aria-label="Aircraft type">
            {[...new Set([s.typeId, ...fleetTypes])].map((id) => <option key={id} value={id}>{(() => { try { return typeOf(id).name; } catch { return id; } })()}</option>)}
          </select>
          <select className="nw-select" value={s.layout} onChange={(e) => set({ layout: e.target.value as CabinLayout })} aria-label="Cabin">
            {layouts.map((l) => <option key={l} value={l}>{LAYOUT_WORD[l]}</option>)}
          </select>
          <select className="nw-select" value={s.tail ?? ''} onChange={(e) => set({ tail: e.target.value || undefined })} aria-label="Aircraft">
            <option value="">Any free one</option>
            {tails.map((a) => <option key={a.id} value={a.id}>{a.reg} · {a.cabin.label}</option>)}
          </select>
        </span>
      </div>
      {season && (
        <div className="nw-draft-row">
          <span className="small muted">Months</span>
          <Seg<string> value={s.months !== undefined ? 's' : 'y'} onChange={(v) => set({ months: v === 's' ? season : undefined })} options={[{ value: 's', label: monthsWords(season) }, { value: 'y', label: 'All year' }]} />
        </div>
      )}
      <div className="nw-draft-row">
        <span className="small muted">Runs</span>
        <span className="row gap-6 wrap">
          <input className="nw-date" type="date" value={dateInput(s.from)} onChange={(e) => { const t = fromInput(e.target.value); if (t !== null) set({ from: t }); }} aria-label="From" />
          <span className="small muted">to</span>
          <input className="nw-date" type="date" value={dateInput(s.to)} onChange={(e) => { const t = fromInput(e.target.value); if (t !== null) set({ to: t + DAY - 1 }); }} aria-label="To" />
        </span>
      </div>
      <div className="small"><b>{seriesWords(s)}</b> · {hhmm(s.out)} local · {s.nights ? `${s.nights} night${s.nights > 1 ? 's' : ''} at ${m?.to ?? 'the destination'}` : 'back the same day'}</div>
      {err && <div className="small bad">{err}</div>}
      <div className="row gap-8">
        <button className="btn btn-primary btn-sm" onClick={save}><Check /> Save</button>
        <button className="btn btn-sm" onClick={onDone}><X /> Cancel</button>
        <span className="tiny muted">Flights already on sale keep their passengers; moving them costs a little, more close to the day.</span>
      </div>
    </div>
  );
}
