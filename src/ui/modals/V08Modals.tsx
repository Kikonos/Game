// v0.8 World dialogs (UPDATE-0.8.md §1.8, §3.6, §4.4, §5.5): a client's relationship (from offers and the Inbox),
// a rival operator, the market outlook (from the Contracts head) and one world event. All static: nothing animates.

import { CalendarRange, ChevronRight, Globe2, Map as MapIcon, PlaneTakeoff, TrendingUp, Users } from 'lucide-react';
import { clientView, rivalView } from '../../engine/contracts';
import { DAY, fmtDay, fmtMonth, monthKey, monthStart, nextMonthStart } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { marketOutlook, worldEvent, worldEvents, type MarketOutlook } from '../../engine/ops';
import { Modal } from '../components/ui';
import { money } from '../format';
import { ArchIcon } from '../screens/common';
import { ClientDetail } from '../screens/Clients';
import { RivalDetail } from '../screens/Rivals';
import { store, useGame } from '../store';
import { EventIcon } from './v08Bits';

export function ClientModal({ clientId }: { clientId: string }) {
  const g = useGame();
  const v = clientView(g, clientId);
  if (!v) return null;
  return (
    <Modal title={v.name} icon={<Users className="accent" />} onClose={() => store.closeModal()} className="v8-modal" footer={
      <>
        <button className="btn" onClick={() => { store.closeModal(); store.navigate('company', { view: 'clients', sel: { kind: 'client', id: v.id } }); }}>All clients</button>
        <button className="btn btn-primary" onClick={() => store.closeModal()}>Done</button>
      </>
    }>
      <ClientDetail g={g} v={v} inModal />
    </Modal>
  );
}

export function RivalModal({ rivalId }: { rivalId: string }) {
  const g = useGame();
  const v = rivalView(g, rivalId);
  if (!v) return null;
  return (
    <Modal title={v.name} icon={<PlaneTakeoff className="accent" />} onClose={() => store.closeModal()} className="v8-modal" footer={
      <>
        <button className="btn" onClick={() => { store.closeModal(); store.navigate('company', { view: 'rivals', sel: { kind: 'rival', id: v.id } }); }}>All rivals</button>
        <button className="btn btn-primary" onClick={() => store.closeModal()}>Done</button>
      </>
    }>
      <RivalDetail v={v} inModal />
    </Modal>
  );
}

// ---------- outlook ----------

const PHASE_NAME = { boom: 'Boom', steady: 'Steady', soft: 'Soft', slump: 'Slump' } as const;
const toneOf = (i: number) => (i >= 1.04 ? 'good' : i <= 0.92 ? 'bad' : i < 0.96 ? 'warn' : '');

/** 'High ↑', 'Normal' (no arrow inside the normal band), 'Soft ↓'. */
function demandWord(i: number, t: -1 | 0 | 1): string {
  const w = i >= 1.12 ? 'High' : i >= 1.04 ? 'Firm' : i >= 0.96 ? 'Normal' : i >= 0.88 ? 'Soft' : 'Weak';
  return w === 'Normal' || !t ? w : `${w} ${t > 0 ? '↑' : '↓'}`;
}

/** 'Hajj flights in 43 d' when the next inbound airlift starts within 120 days. */
function hajjLine(o: MarketOutlook, now: number): string {
  const h = o.hajj.find((x) => x.pre[0] > now);
  const d = h ? Math.ceil((h.pre[0] - now) / DAY) : 0;
  if (h && d <= 120) return `Hajj flights in ${d} d`;
  const on = o.hajj.find((x) => x.pre[0] <= now && x.post[1] > now);
  return on ? (now < on.pre[1] ? 'Hajj flights now (in)' : now >= on.post[0] ? 'Hajj flights now (home)' : 'Hajj now') : '';
}

/** The four outlook tiles (Contracts head strip; larger in the dialog). Static: values change at most monthly. */
export function OutlookTiles({ o, now, big }: { o: MarketOutlook; now: number; big?: boolean }) {
  const fuelTone = o.fuel.price > 900 ? 'warn' : '';
  const hl = hajjLine(o, now);
  return (
    <div className={`v8-tiles ${big ? 'big' : ''}`}>
      <span className={`v8-tile ${toneOf(o.narrow.index)}`}><span className="v8-tile-k">Narrowbody</span><b>{demandWord(o.narrow.index, o.narrow.trend)}</b></span>
      <span className={`v8-tile ${toneOf(o.wide.index)}`}><span className="v8-tile-k">Widebody</span><b>{demandWord(o.wide.index, o.wide.trend)}</b></span>
      <span className={`v8-tile ${fuelTone}`}><span className="v8-tile-k">Fuel</span><b>{o.fuel.text.replace(/^Fuel /, '')}</b></span>
      <span className="v8-tile v8-tile-season">
        <span className="v8-tile-k">{PHASE_NAME[o.phase]} market</span>
        <b>{o.season.name.split(' · ')[0]}</b>
        {hl && <span className="v8-tile-sub">{hl}</span>}
      </span>
    </div>
  );
}

interface Bar { from: number; to: number; label: string; cls: string; short?: string }

function seasonBars(from: number, to: number): Bar[] {
  const out: Bar[] = [];
  for (let t = from; t < to; t = nextMonthStart(t)) {
    const m = new Date(Date.UTC(2000, 0, 1) + t * 60_000).getUTCMonth();
    const cls = m >= 5 && m <= 8 ? 'peak' : m >= 10 || m <= 2 ? 'trough' : 'shoulder';
    const last = out[out.length - 1];
    if (last && last.cls === cls) last.to = nextMonthStart(t);
    else out.push({ from: t, to: nextMonthStart(t), cls, label: cls === 'peak' ? 'Summer peak' : cls === 'trough' ? 'Winter trough' : '', short: cls === 'peak' ? 'Summer' : cls === 'trough' ? 'Winter' : '' });
  }
  return out;
}

/** A static 12-month calendar: season, Hajj in / home, Antarctic season, active world events; one today line. */
function Calendar({ g, o }: { g: GameState; o: MarketOutlook }) {
  const from = monthStart(monthKey(g.now));
  let to = from;
  for (let i = 0; i < 12; i++) to = nextMonthStart(to);
  const span = to - from;
  const pos = (t: number) => Math.max(0, Math.min(100, ((t - from) / span) * 100));
  const bar = (b: Bar, i: number) => {
    if (b.to <= from || b.from >= to) return null;
    const l = pos(b.from);
    const w = Math.max(0.8, pos(b.to) - l);
    // Under ~100 px the short label ('In', 'Winter'); the full text stays in the tooltip and the lines below.
    const txt = w > 13 ? b.label : w > 4 ? (b.short ?? b.label) : '';
    // A short event names itself beside its bar (each event has its own lane), so its bar stays empty.
    const tagged = b.cls === 'event' && txt !== b.label && l + w <= 70;
    const bar = <span key={i} className={`v8-cal-bar ${b.cls}`} style={{ left: `${l}%`, width: `${w}%` }} title={b.label}>{tagged ? '' : txt}</span>;
    if (!tagged) return bar;
    return [bar, <span key={`${i}t`} className="v8-cal-tag small muted" style={{ left: `calc(${l + w}% + 6px)` }}>{b.label}</span>];
  };
  const months: number[] = [];
  for (let t = from; t < to; t = nextMonthStart(t)) months.push(t);
  const hajj: Bar[] = o.hajj.flatMap((h) => [
    { from: h.pre[0], to: h.pre[1], cls: 'hajj', label: `Hajj ${h.ah} in`, short: 'In' },
    { from: h.post[0], to: h.post[1], cls: 'hajj', label: 'home' },
  ]);
  const ant: Bar[] = [{ from: o.antarctic[0], to: o.antarctic[1], cls: 'ant', label: 'Antarctic season', short: 'Antarctic' }];
  // The next season too (it may start inside the window when this one has passed).
  ant.push({ from: o.antarctic[0] + 365 * DAY, to: o.antarctic[1] + 365 * DAY, cls: 'ant', label: 'Antarctic season', short: 'Antarctic' });
  // Overlapping events go on separate lanes (at most 3; the rest share the last).
  const lanes: Bar[][] = [];
  for (const e of [...worldEvents(g, { active: true })].sort((a, b) => a.start - b.start)) {
    const b: Bar = { from: e.start, to: e.end, cls: 'event', label: e.title, short: e.title.split(/[\s–-]/)[0] };
    const lane = lanes.find((ln) => ln[ln.length - 1].to <= b.from) ?? (lanes.length < 3 ? (lanes[lanes.length] = []) : lanes[2]);
    lane.push(b);
  }
  const rows: [string, Bar[]][] = [['Season', seasonBars(from, to)], ['Hajj', hajj], ['Antarctica', ant], ...lanes.map((ln, i) => [i ? '' : 'Events', ln] as [string, Bar[]])];
  return (
    <div className="v8-cal">
      <div className="v8-cal-row v8-cal-head">
        <span className="v8-cal-k" />
        <span className="v8-cal-track">{months.map((t) => <span key={t} className="v8-cal-m" style={{ left: `${pos(t)}%` }}>{fmtMonth(monthKey(t)).split(' ')[0]}</span>)}</span>
      </div>
      {rows.map(([k, bars], ri) => (
        <div key={ri} className="v8-cal-row">
          <span className="v8-cal-k small muted">{k}</span>
          <span className="v8-cal-track">{bars.map(bar)}<span className="v8-cal-now" style={{ left: `${pos(g.now)}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

export function OutlookModal() {
  const g = useGame();
  const o = marketOutlook(g);
  return (
    <Modal title="Market outlook" icon={<TrendingUp className="accent" />} onClose={() => store.closeModal()} size="wide" className="v8-modal" footer={
      <button className="btn btn-primary" onClick={() => store.closeModal()}>Done</button>
    }>
      <div className="col gap-12">
        <OutlookTiles o={o} now={g.now} big />
        <p className="muted v8-phase">{o.phaseText} {o.season.text}</p>
        <div className="small dim">{o.offersText}. The outlook changes once a month; long contracts keep the rate they were signed at.</div>
        <div className="upper dim">Next 12 months</div>
        <Calendar g={g} o={o} />
        <div className="small muted">Hajj: {o.hajj.map((h) => `${fmtDay(h.arafah)} ${new Date(Date.UTC(2000, 0, 1) + h.arafah * 60_000).getUTCFullYear()}`).join(' · ')} (Day of Arafah; about 11 days earlier every year)</div>
        {o.shocks.length > 0 && (
          <div className="col gap-4">
            <div className="upper dim">Shocks</div>
            {o.shocks.map((s) => <div key={s.text} className="small">{s.text}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- world event ----------

export function WorldEventModal({ eventId }: { eventId: string }) {
  const g = useGame();
  const e = worldEvent(g, eventId);
  if (!e) return null;
  const toMap = () => { store.closeModal(); store.navigate('map', { sel: { kind: 'event', id: e.id } }); };
  return (
    <Modal title={e.title} icon={<EventIcon icon={e.icon} />} onClose={() => store.closeModal()} className="v8-modal" footer={
      <>
        <button className="btn" onClick={toMap}><MapIcon /> Show on the map</button>
        <button className="btn btn-primary" onClick={() => store.closeModal()}>Done</button>
      </>
    }>
      <div className="col gap-12">
        <div className="row gap-8 wrap">
          <span className={`badge ${e.active ? 'warn' : ''}`}>{e.active ? 'Happening now' : g.now < e.start ? 'Starts soon' : 'Over'}</span>
          <span className="small muted">{e.place} · {fmtDay(e.start)} – {fmtDay(e.end)}</span>
        </div>
        <p className="muted sc-blurb">{e.body}</p>
        {e.effects.length > 0 && (
          <div className="v8-box">
            <div className="upper dim">What it changes</div>
            <ul className="v8-lines">{e.effects.map((x) => <li key={x}>{x}</li>)}</ul>
          </div>
        )}
        {e.flights.length > 0 && (
          <div className="col gap-4">
            <div className="upper dim">Our flights</div>
            {e.flights.slice(0, 8).map((id) => {
              const f = g.flights[id];
              if (!f) return null;
              return (
                <button key={id} className="v8-link" onClick={() => store.openModal({ kind: 'sheet', refs: [{ kind: 'flight', id }] })}>
                  <CalendarRange className="sc-ico-s" /><span className="mono">{f.no}</span><span className="mono">{f.from}→{f.to}</span><span className="grow small dim">{fmtDay(f.std)}</span><ChevronRight className="sc-ico-s dim" />
                </button>
              );
            })}
            {e.flights.length > 8 && <div className="small dim">… and {e.flights.length - 8} more</div>}
          </div>
        )}
        {e.offers.length > 0 && (
          <div className="col gap-4">
            <div className="upper dim">Work it created</div>
            {e.offers.map((id) => {
              const o = g.offers[id];
              if (!o) return null;
              return (
                <button key={id} className="v8-link" onClick={() => store.openModal({ kind: 'offer', offerId: id })}>
                  <ArchIcon a={o.archetype} /><span className="grow ellipsis">{o.title}</span><span className="small dim nowrap">{money(o.estValue)}</span><ChevronRight className="sc-ico-s dim" />
                </button>
              );
            })}
          </div>
        )}
        {!e.flights.length && !e.offers.length && <div className="small dim"><Globe2 className="sc-ico-s" /> None of our flights are affected.</div>}
      </div>
    </Modal>
  );
}
