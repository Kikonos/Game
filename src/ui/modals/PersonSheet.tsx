// v0.18 the person sheet: a tap on a crew member anywhere opens it. First their monthly roster (a Mon–Sun month grid in
// the style of an airline crew roster app: trips as one rounded span with a plane and the layover stations, days off as a
// house 'XX', standby / reserve / leave / sick / training each with its own icon), then the tapped day's duties, the
// month's totals and the person's essentials. Lazy chunk (Modals.tsx).

import '../../styles/acmi/v018person.css';
import { BedDouble, ChevronLeft, ChevronRight, GraduationCap, Lock, UserPlus, Users } from 'lucide-react';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { flag } from '../../data/countries';
import type { RatingFamily } from '../../data/acmiTypes';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, fmtDate, fmtDay, fmtDayAt, fmtDayRange, fmtTime, monthKey, monthStart, toDate } from '../../engine/core/time';
import type { CrewMember, GameState } from '../../engine/core/types';
import {
  crewCalendar, crewGauges, crewMonth, crewName, crewRev, crewStatusView, crewWindows, leaveBalance, LIMITS, moraleOf, publishDayOf, publishedTo, type CalBlock,
} from '../../engine/crew';
import { crewSupply, familyNeeds } from '../../engine/crew/sets';
import { dayIndex, midnight } from '../../engine/crew/dayPlan';
import { lockOf } from '../../engine/scenario';
import { BoardingPasses } from '../components/BoardingPass';
import { FlightTypeChip } from '../components/FlightType';
import { Gauge } from '../components/Gauge';
import { LockNote, lockedProps } from '../components/Locked';
import { RankMark } from '../components/RankMark';
import { restNow } from '../components/problemLogic';
import { Modal } from '../components/ui';
import { money } from '../format';
import { LimitBar } from '../screens/common';
import { calLabel } from '../screens/crewLogic';
import { ratingLine } from '../screens/crewPlanLogic';
import { moraleTone } from '../screens/rosterBoardLogic';
import { limitTone, ROLE_LABEL } from '../screens/screenLogic';
import { store, useGame, type ModalSpec } from '../store';
import { DAY_KIND_LABEL, endAt, hm, stationOf, monthGrid, monthTotals, type DayCell, type DayIcon, type DayKind, type MonthGrid } from './personLogic';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------- glyphs (filled, upright, like a crew roster app) ----------

const PLANE = 'M12 2.2c.9 0 1.5.8 1.5 1.8v5.3l7.8 4.6v2l-7.8-2.4v4.9l2.2 1.6V21.6L12 20.6l-3.7 1v-1.6l2.2-1.6v-4.9L2.7 15.9v-2l7.8-4.6V4c0-1 .6-1.8 1.5-1.8z';
function Glyph({ icon }: { icon: DayIcon }) {
  if (!icon) return null;
  const svg = (children: ReactNode, cls = '') => <svg className={`ps-ico ${cls}`} viewBox="0 0 24 24" aria-hidden>{children}</svg>;
  switch (icon) {
    case 'plane': return svg(<path d={PLANE} />);
    // Riding as a passenger: the plane with a faint one behind it.
    case 'pax': return svg(<><path d={PLANE} transform="translate(-2.6 2.4) scale(0.92)" className="ghost" /><path d={PLANE} transform="translate(1.6 -1) scale(0.92)" /></>, 'pax');
    case 'ferry': return svg(<path d={PLANE} className="hollow" />, 'ferry');
    case 'house': return svg(<path d="M12 3.2 2.6 11.1c-.5.5-.2 1.3.5 1.3H5v7.4c0 .7.5 1.2 1.2 1.2H10v-5.4h4V21h3.8c.7 0 1.2-.5 1.2-1.2v-7.4h1.9c.7 0 1-.8.5-1.3L12 3.2z" />);
    case 'bed': return svg(<path d="M3 6.5c.6 0 1 .4 1 1V13h7V9.6c0-.6.4-1 1-1h6.2A2.8 2.8 0 0 1 21 11.4V19c0 .6-.4 1-1 1s-1-.4-1-1v-2H4v2c0 .6-.4 1-1 1s-1-.4-1-1V7.5c0-.6.4-1 1-1zm4.5 1.7a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z" />);
    case 'phone': return svg(<path d="M8.6 3.4 6.4 3c-.9-.2-1.8.3-2.1 1.2-.9 2.7-.2 6.4 3.3 10.1 3.6 3.7 7.3 4.6 10.1 3.7.9-.3 1.4-1.2 1.2-2.1l-.5-2.2c-.2-.8-.9-1.3-1.7-1.3l-2.3.2c-.4 0-.8.2-1.1.5l-.8.9c-1.7-.8-3.1-2.2-4-4l.9-.8c.3-.3.5-.7.5-1.1l.2-2.3c0-.8-.5-1.5-1.3-1.7z" />);
    case 'tower': return svg(<path d="M8 3h8l1.2 4.2c.2.6-.3 1.3-1 1.3H15l-.6 3.5H16v2h-1.9L13 21h-2l-1.1-7H8v-2h1.6L9 8.5H7.8c-.7 0-1.2-.7-1-1.3L8 3zm2.1 2-.4 1.5h4.6L13.9 5h-3.8z" />);
    case 'clock': return svg(<path d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm-.1 4.3c-.6 0-1 .4-1 1v4.6c0 .3.2.7.5.9l3.2 2.1c.5.3 1.1.2 1.4-.3.3-.5.2-1.1-.3-1.4l-2.8-1.8V7.8c0-.6-.4-1-1-1z" />);
    case 'palm': return svg(<path d="M12.6 9.4c1.9-.5 4.4-.2 6.4 1.6.4.4.1 1-.4 1-1.7-.1-3.4.3-4.6 1.1l2.6 8.4c.2.5-.2.9-.7.9h-1.1c-.4 0-.7-.2-.8-.6L11.8 12c-1.6.3-3.3 1.3-4.4 2.7-.3.4-1 .3-1.1-.2-.4-2.2.6-4.3 2.4-5.4-1.5-.6-3.4-.5-4.9.2-.5.2-1-.3-.8-.8.9-1.9 3.2-3 5.5-2.7-.8-1.1-2-1.8-3.3-2.1-.5-.1-.6-.8-.1-1 2.3-.9 4.8.1 6 2.1.9-1.6 2.7-2.6 4.6-2.5.5 0 .7.7.3 1-1.3.8-2.4 2-3 3.4.9-.1 1.4.1 1.4.1z" />);
    case 'sick': return svg(<path d="M12 2.5c1.7 0 3 1.3 3 3v8.2a4.8 4.8 0 1 1-6 0V5.5c0-1.7 1.3-3 3-3zm0 2c-.6 0-1 .4-1 1v9.3l-.5.3a2.8 2.8 0 1 0 3 0l-.5-.3V5.5c0-.6-.4-1-1-1zm0 5.5c.5 0 1 .4 1 1v4.6a1.9 1.9 0 1 1-2 0V11c0-.6.5-1 1-1z" />);
    case 'cap': return svg(<path d="M11.5 3.6c.3-.1.7-.1 1 0l9.6 4.3c.8.4.8 1.5 0 1.9L19 11.2V16c0 .4-.2.8-.6 1-1.9 1.2-4.1 1.8-6.4 1.8s-4.5-.6-6.4-1.8c-.4-.2-.6-.6-.6-1v-4.8L3.3 10v5c0 .6-.4 1-1 1s-1-.4-1-1V9c0-.4.2-.8.6-.9l9.6-4.5z" />);
    case 'join': return svg(<path d="M10 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM3 19.2c0-3.3 3.1-5.7 7-5.7 1.3 0 2.5.3 3.6.8a5.5 5.5 0 0 0-.6 5.9H4c-.6 0-1-.4-1-1zm15.5-5.7c.6 0 1 .4 1 1V16h1.5c.6 0 1 .4 1 1s-.4 1-1 1h-1.5v1.5c0 .6-.4 1-1 1s-1-.4-1-1V18H16c-.6 0-1-.4-1-1s.4-1 1-1h1.5v-1.5c0-.6.4-1 1-1z" />);
  }
}

// ---------- data ----------

/** v0.14 the family the crew sets count a person in (home fleet). */
function homeOf(g: GameState, id: string): RatingFamily | undefined {
  return crewSupply(g, familyNeeds(g)).homes.get(id);
}

interface MonthData {
  grid: MonthGrid;
  blocks: CalBlock[];
  a: number;
  b: number;
}

function useMonth(g: GameState, c: CrewMember, mk: number): MonthData {
  const rev = flightsRev(g);
  const crev = crewRev(g);
  const hour = Math.floor(g.now / HOUR);
  return useMemo(() => {
    const k1st = Math.floor(monthStart(mk) / DAY);
    const nDays = Math.round((monthStart(mk + 1) - monthStart(mk)) / DAY);
    const wd1st = (toDate(k1st * DAY).getUTCDay() + 6) % 7;
    const first = k1st - wd1st;
    const nWeeks = Math.ceil((wd1st + nDays) / 7);
    const from = midnight(c.base, first);
    const to = midnight(c.base, first + nWeeks * 7);
    const blocks = crewCalendar(g, c.id, from, to);
    // The duty log keeps 28 days: before that a day is 'no record', not a day off.
    const keptFrom = dayIndex(c.base, g.now - 28 * DAY);
    const grid = monthGrid(blocks, {
      k1st, nDays, wd1st, base: c.base, now: g.now, keptFrom,
      midnight: (k) => midnight(c.base, k), dayOf: (t) => dayIndex(c.base, t), dateOf: (k) => toDate(k * DAY).getUTCDate(),
      ext: (id) => !!g.duties[id]?.ext,
    });
    return { grid, blocks, a: midnight(c.base, k1st), b: midnight(c.base, k1st + nDays) };
  }, [g, c.id, c.base, mk, rev, crev, hour]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------- calendar ----------

function DayInner({ cell }: { cell: DayCell }) {
  return (
    <>
      <span className="ps-n num">{cell.date}</span>
      {cell.badge && <span className={`ps-badge ${cell.badge === 'A' ? 'a' : 'x'}`} aria-label={cell.badge === 'A' ? 'airport standby' : 'planned extension'}>{cell.badge}</span>}
      {cell.legality && <span className={`ps-leg ${cell.legality}`} aria-label={cell.legality === 'illegal' ? 'cannot legally fly' : 'tight'} />}
      <Glyph icon={cell.icon} />
      {cell.code && <span className="ps-code">{cell.code}</span>}
    </>
  );
}

function Calendar({ grid, sel, onSel, mk, setMk, bounds, todayWd }: { grid: MonthGrid; sel: number; onSel: (k: number) => void; mk: number; setMk: (m: number) => void; bounds: [number, number]; todayWd: number | null }) {
  const pick = (e: React.MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-k]');
    if (el) onSel(Number(el.dataset.k));
  };
  return (
    <div className="ps-cal">
      <div className="ps-nav">
        <button className="btn btn-ghost btn-icon" onClick={() => setMk(mk - 1)} disabled={mk <= bounds[0]} aria-label="Previous month"><ChevronLeft /></button>
        <h3 className="ps-month">{MONTH[mk % 12]} <span className="dim">{Math.floor(mk / 12)}</span></h3>
        <button className="btn btn-ghost btn-icon" onClick={() => setMk(mk + 1)} disabled={mk >= bounds[1]} aria-label="Next month"><ChevronRight /></button>
      </div>
      <div className="ps-wd" aria-hidden>{WD.map((d, i) => <span key={d} className={i === todayWd ? 'on' : ''}>{d}</span>)}</div>
      <div className="ps-weeks" onClick={pick} role="grid" aria-label={`Roster for ${MONTH[mk % 12]}`}>
        {grid.weeks.map((row, w) => (
          <div key={w} className="ps-week" role="row">
            {row.map((it) => {
              if (it.type === 'day') {
                const c = it.cell;
                return (
                  <button key={c.k} data-k={c.k} role="gridcell" style={{ gridColumn: it.col + 1 }} aria-label={`${c.date}: ${DAY_KIND_LABEL[c.kind]}${c.code ? ` ${c.code}` : ''}`}
                    className={`ps-day k-${c.kind} ${c.inMonth ? '' : 'out'} ${c.past ? 'past' : ''} ${c.today ? 'today' : ''} ${sel === c.k ? 'on' : ''}`}>
                    <DayInner cell={c} />
                  </button>
                );
              }
              const on = it.cells.some((c) => c.k === sel);
              return (
                <div key={`${it.owner}-${it.col}`} className={`ps-span k-${it.kind} ${it.contL ? 'cl' : ''} ${it.contR ? 'cr' : ''} ${on ? 'on' : ''} ${it.cells.every((c) => !c.inMonth) ? 'out' : ''}`} style={{ gridColumn: `${it.col + 1} / span ${it.len}` }}>
                  {it.cells.map((c) => (
                    <button key={c.k} data-k={c.k} role="gridcell" aria-label={`${c.date}: ${DAY_KIND_LABEL[c.kind]}${c.code ? ` ${c.code}` : ''}`}
                      className={`ps-sd ${c.inMonth ? '' : 'out'} ${c.past ? 'past' : ''} ${c.today ? 'today' : ''} ${sel === c.k ? 'on' : ''}`}>
                      <DayInner cell={c} />
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- details ----------

/** '21:00 JFK · 02:00 UTC': the station's local time first (what the crew live by), UTC after, dimmed. */
const both = (t: number, at?: string) => (at ? <><b className="num">{fmtTime(t, at)}</b><span className="dim"> {at} · {fmtTime(t)} UTC</span></> : <><b className="num">{fmtTime(t)}</b><span className="dim"> UTC</span></>);
/** The station's local date of t. */
const dayAt = (t: number, at?: string) => (at ? fmtDayAt(at, t) : fmtDay(t));

/** One duty or journey: its legs, report / release (local, then UTC), block, FDP of the limit, the rest after. */
function DutyCard({ g, c, b, rests, hi, layover }: { g: GameState; c: CrewMember; b: CalBlock; rests: CalBlock[]; hi: boolean; layover: boolean }) {
  const d = b.dutyId ? g.duties[b.dutyId] : undefined;
  const fl = b.flights ?? [];
  const from = fl[0]?.from;
  const to = fl.length ? fl[fl.length - 1].to : b.at;
  const block = fl.reduce((n, f) => n + Math.max(0, f.sta - f.std), 0);
  // The rest after a duty, unless a layover band below says it.
  const rest = b.kind === 'duty' && !layover ? rests.find((r) => r.start >= b.end - 1 && r.start <= b.end + 6 * HOUR) : undefined;
  // A flown duty whose flights are gone keeps only its log line: shown once, in the facts below (not as a route).
  const route = fl.length ? [fl[0].from, ...fl.map((f) => f.to)].join(' – ') : /^Flown: /.test(b.detail) ? '' : b.detail.split('\n')[0];
  const travel = b.kind !== 'duty';
  // v0.18.1 a ticket still on record: its boarding passes on the day it flies.
  const ticket = b.kind === 'deadhead' && b.flightIds?.[0] ? g.flights[b.flightIds[0]] : undefined;
  return (
    <div className={`ps-duty ${hi ? 'hi' : ''}`}>
      <div className="row gap-8 ps-duty-h">
        <b>{calLabel(b)}</b>
        <span className="mono small ellipsis grow">{route}</span>
        {b.legality && b.legality !== 'legal' && <span className={`badge ${b.legality === 'tight' ? 'warn' : 'bad'}`}>{b.legality === 'tight' ? 'Tight' : 'Illegal'}</span>}
        {d && g.pairings[d.pairingId]?.slots.some((x) => x.crewId === c.id && x.locked) && <Lock className="sc-ico-s accent" aria-label="set by you" />}
      </div>
      {fl.length > 0 && (
        <div className="ps-legs">
          {fl.map((f) => (
            <div key={f.id} className="ps-legrow small">
              <span className="mono">{f.no}</span>
              <span className="mono">{f.from}–{f.to}</span>
              <span className="num">{fmtTime(f.std, f.from)}–{fmtTime(f.sta, f.to)}<span className="dim"> local</span></span>
              <span className="num dim">{fmtTime(f.std)}–{fmtTime(f.sta)} UTC</span>
              <FlightTypeChip type={f.type} />
            </div>
          ))}
        </div>
      )}
      <div className="ps-facts small">
        <span className="k">{travel ? 'Check-in' : 'Report'}</span><span>{dayAt(b.start, from)} · {both(b.start, from)}</span>
        {travel && fl.length > 0 && <><span className="k">Departs</span><span>{dayAt(fl[0].std, from)} · {both(fl[0].std, from)}</span></>}
        <span className="k">{travel ? 'Arrives' : 'Release'}</span><span>{dayAt(b.end, to)} · {both(b.end, to)}</span>
        {block > 0 && !travel && <><span className="k">Block</span><span className="num">{hm(block)}</span></>}
        {d && <><span className="k">FDP</span><span className="num">{hm(d.fdp)} <span className="dim">of {hm(d.maxFdp + (d.discretion ?? 0))}{d.augment ? ` · ${2 + d.augment} pilots` : ''}</span></span></>}
        {!fl.length && b.detail && (!d || /^Flown: /.test(b.detail)) && <><span className="k">Flown</span><span>{b.detail.replace(/^Flown: /, '')}<span className="dim"> · flight numbers were not recorded before v0.18.1</span></span></>}
        {rest && <><span className="k">Rest</span><span className="num">{hm(rest.end - rest.start)} <span className="dim">{rest.at ? `at ${rest.at}` : 'at home'} · until {fmtDay(rest.end)} {fmtTime(rest.end)} UTC{rest.restWhy ? ` · ${rest.restWhy}` : ''}</span></span></>}
      </div>
      {hi && ticket && <BoardingPasses g={g} ticketId={ticket.id} crew={c} />}
      {d && !d.done && <button className="btn btn-sm ps-change" onClick={() => store.openModal({ kind: 'duty', id: d.id })}><Users /> Change crew</button>}
    </div>
  );
}

/**
 * v0.18.1 (player's report: "is the layover really 14 hours?") between two parts of a trip: the time at the station from
 * release (or arrival) to the next report or check-in, and the legal minimum rest with its reason.
 */
function Layover({ a, b, rests }: { a: CalBlock; b: CalBlock; rests: CalBlock[] }) {
  const at = endAt(a);
  const r = rests.find((x) => x.start >= a.end - 1 && x.start <= a.end + 6 * HOUR);
  const gap = b.start - a.end;
  if (gap <= 0 || !at) return null;
  return (
    <div className="ps-layover small" role="note">
      <BedDouble aria-hidden />
      <span className="grow"><b>Layover {at} {hm(gap)}</b>{r?.minRest ? <span className="dim"> · minimum rest {hm(r.minRest)}{r.restWhy ? ` (${r.restWhy})` : ''}</span> : null}</span>
    </div>
  );
}

function DayDetail({ g, c, data, k }: { g: GameState; c: CrewMember; data: MonthData; k: number }) {
  const cell = data.grid.cells.find((x) => x.k === k);
  if (!cell) return null;
  const ow = cell.owner ? data.grid.owners.get(cell.owner) : undefined;
  const rests = data.blocks.filter((b) => b.kind === 'rest');
  const head = (title: string, when: string, kind: DayKind) => (
    <div className="row gap-8 ps-dd-h"><span className={`ps-sw k-${kind}`} aria-hidden /><b>{title}</b><span className="grow" /><span className="small muted nowrap">{when}</span></div>
  );
  if (ow && ow.kind === 'trip') {
    // 'LIS – SGN · 4 duties · block 16:52': where the trip starts, each duty's far station, the total block.
    const st = [ow.blocks[0].flights?.[0]?.from ?? '', ...ow.blocks.map((b) => (b.kind === 'duty' ? stationOf(b) : endAt(b)) ?? '')].filter((x, i, a) => x && x !== a[i - 1]);
    const days = ow.k1 - ow.k0 + 1;
    const nDuty = ow.blocks.filter((b) => b.kind === 'duty').length;
    const block = ow.blocks.reduce((n, b) => n + (b.kind === 'duty' ? (b.flights ?? []).reduce((m, f) => m + Math.max(0, f.sta - f.std), 0) : 0), 0);
    return (
      <div className="ps-dd">
        {head(days > 1 ? `Trip · ${days} days` : 'Flying', fmtDayRange(midnight(c.base, ow.k0) + 12 * HOUR, midnight(c.base, ow.k1) + 12 * HOUR), 'trip')}
        <div className="small muted">{st.length > 0 && <span className="mono">{st.join(' – ')}</span>}{st.length > 0 && ' · '}{nDuty} dut{nDuty === 1 ? 'y' : 'ies'}{block ? ` · block ${hm(block)}` : ''}</div>
        {ow.blocks.map((b, i) => {
          const next = ow.blocks[i + 1];
          const away = !!next && endAt(b) !== c.base;
          return (
            <Fragment key={`${b.kind}-${b.start}`}>
              <DutyCard g={g} c={c} b={b} rests={rests} hi={dayIndex(c.base, b.start) === k} layover={away} />
              {away && <Layover a={b} b={next} rests={rests} />}
            </Fragment>
          );
        })}
      </div>
    );
  }
  const date = fmtDate(cell.start + 12 * HOUR, true);
  if (ow) {
    const b = ow.blocks[0];
    return <div className="ps-dd">{head(DAY_KIND_LABEL[ow.kind], `${fmtDay(b.start)} – ${fmtDay(b.end - 1)}`, ow.kind)}<div className="small muted">{b.detail}</div></div>;
  }
  const shown = cell.blocks.filter((b) => b.kind !== 'rest' || cell.kind === 'rest');
  return (
    <div className="ps-dd">
      {head(DAY_KIND_LABEL[cell.kind], date, cell.kind)}
      {cell.kind === 'none' ? <div className="small muted">Days older than 28 days are not kept, except the flights flown.</div> : shown.length ? shown.map((b) => (
        <div key={`${b.kind}-${b.start}`} className="small muted">{b.kind === 'standby' || b.kind === 'rest' ? b.detail : b.detail}</div>
      )) : <div className="small muted">Nothing rostered.</div>}
    </div>
  );
}

// ---------- totals and essentials ----------

function Totals({ g, c, data, mk }: { g: GameState; c: CrewMember; data: MonthData; mk: number }) {
  const t = monthTotals(data.blocks, data.a, data.b, g.now, (s) => c.log.find((e) => e.start === s), data.grid.cells);
  const v = crewMonth(g, c.id, data.a + 12 * HOUR);
  const w = crewWindows(g, c, g.now);
  const pub = publishedTo(g);
  const short = v.off < v.offMin && monthKey(pub) > v.key;
  const cur = monthKey(g.now) === mk;
  const tile = (k: string, val: ReactNode, sub?: ReactNode, tone?: string) => (
    <div className={`ps-tot ${tone ?? ''}`}><span className="k">{k}</span><b className="num">{val}</b>{sub && <span className="tiny dim">{sub}</span>}</div>
  );
  return (
    <div className="ps-tots">
      {tile('Block hours', hm(t.block), t.blockFlown && t.blockFlown < t.block ? `${hm(t.blockFlown)} flown` : t.block ? (t.blockFlown ? 'all flown' : 'planned') : 'no flying')}
      {tile('Duty hours', hm(t.duty), `${t.duties} dut${t.duties === 1 ? 'y' : 'ies'} · ${t.sectors} sector${t.sectors === 1 ? '' : 's'}`)}
      {tile('Days off', `${v.off}`, monthKey(pub) > v.key ? `of ${v.offMin} required` : `of ${v.offMin} · roster out ${fmtDay(publishDayOf(g, Math.floor(data.a / DAY) + 1))}`, short ? 'bad' : '')}
      {cur ? tile('Block 28 days', `${Math.round(w.block28d / HOUR)} h`, `of ${LIMITS.block28d / HOUR} h`, limitTone(w.block28d / LIMITS.block28d) === 'good' ? '' : limitTone(w.block28d / LIMITS.block28d)) : tile('Standby', `${v.standby.home + v.standby.hotel + v.standby.airport + v.standby.reserve}`, 'days')}
      {cur ? tile('Block 12 months', `${Math.round(w.block12m / HOUR)} h`, `of ${LIMITS.block12m / HOUR} h`, limitTone(w.block12m / LIMITS.block12m) === 'good' ? '' : limitTone(w.block12m / LIMITS.block12m)) : tile('Leave', `${v.leave}`, 'days')}
    </div>
  );
}

/** v0.18.1 '18 of 30 days left · asked 12–25 Feb'. */
function leaveLine(g: GameState, c: CrewMember): ReactNode {
  const b = leaveBalance(g, c);
  const q = (g.leaveRequests ?? []).find((x) => x.crewId === c.id && x.status === 'pending');
  return <>{b.left} of {b.ent + b.carried} days left{q && <span className="dim"> · asked {fmtDay(q.from + 720)} for {q.days}</span>}</>;
}

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

function Essentials({ g, c }: { g: GameState; c: CrewMember }) {
  const sv = crewStatusView(g, c.id);
  const m = moraleOf(g, c.id);
  const joining = sv.startLabel === 'Joins';
  const gauges = joining ? [] : crewGauges(g, c.id).map((s) => restNow(s, g.now));
  const drivers = m.drivers.filter((d) => Math.round(d.value) !== 0).slice(0, 3);
  const resign = Math.round(m.resignPerMonth * 1000) / 10;
  const hireLock = lockOf(g, 'hiring');
  const trainLock = lockOf(g, 'training');
  const rows: [string, ReactNode][] = [
    ['Now at', sv.nowAt || c.loc],
    ...(joining ? [] : [['Rest until', sv.restUntil ? `${fmtDay(sv.restUntil)} ${fmtTime(sv.restUntil)} UTC` : '—'] as [string, ReactNode]]),
    [sv.startLabel, fmtDate(sv.startDate)],
    ['Total hours', Math.round(c.totalHours).toLocaleString('en-US')],
    // v0.18.1 the year's leave allowance and a request waiting.
    ...(joining ? [] : [['Annual leave', leaveLine(g, c)] as [string, ReactNode]]),
    ['Languages', c.languages.join(', ') || '—'],
    ['Salary', `${money(c.salary)}/month`],
  ];
  return (
    <div className="ps-ess">
      {c.notice && (
        <div className="sc-notice">
          <span className="grow small"><b>Resigned</b> · last day {fmtDate(c.notice.leaves - 1)}</span>
          <button className={`btn btn-sm ${hireLock ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'hire', role: c.role, family: c.ratings[0], base: c.base })} {...lockedProps(hireLock)}><UserPlus /> Hire replacement</button>
        </div>
      )}
      {sv.text && <div className={`small sc-crew-status ${sv.tone === 'info' ? 'accent' : sv.tone}`}>{sv.text}</div>}
      <div className="ps-morale">
        <div className="row between small"><span className="muted">Morale</span><span className="num"><b>{m.value}</b><span className="dim"> / 100 · trend {signed(m.trend14d) || '0'}</span></span></div>
        <div className={`bar thin ${moraleTone(m.value)}`}><span style={{ width: `${Math.min(100, m.value)}%` }} /></div>
        <div className="ps-drivers">
          {drivers.length ? drivers.map((d) => <span key={d.label} className={`chip sc-chip ${d.value > 0 ? 'good' : 'bad'}`}>{d.label} {signed(d.value)}</span>) : <span className="small muted">Steady near the company target of {m.target}.</span>}
          {m.sickMult > 1.05 && <span className={`chip sc-chip ${m.sickMult >= 1.3 ? 'bad' : 'warn'}`}>Sick risk ×{m.sickMult.toFixed(1)}</span>}
          {!c.notice && resign > 0.8 && <span className={`chip sc-chip ${resign >= 1.6 ? 'bad' : 'warn'}`}>Resign risk {resign}%/mo</span>}
          {c.bondUntil !== undefined && c.bondUntil > g.now && <span className="chip sc-chip">Bonded to {fmtDate(c.bondUntil)}</span>}
        </div>
      </div>
      <LimitBar label="Fatigue" value={c.fatigue} limit={100} unit="" tone={limitTone(c.fatigue / 100)} />
      <div className="ps-kv">{rows.map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>
      {gauges.length > 0 && (
        <details className="ps-limits">
          <summary className="upper dim">Flight time limits</summary>
          <div className="grid-2 sc-limits">{gauges.map((s) => <Gauge key={s.id} spec={s} />)}</div>
        </details>
      )}
      <div className="row gap-8">
        <button className={`btn grow ${trainLock ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'train', crewId: c.id })} {...lockedProps(trainLock)}><GraduationCap /> Train</button>
        <button className={`btn grow ${hireLock ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'hire', role: c.role, family: c.ratings[0], base: c.base })} {...lockedProps(hireLock)}><UserPlus /> Hire similar</button>
      </div>
      <LockNote why={hireLock ?? trainLock} />
    </div>
  );
}

/** The legend under the calendar: only the kinds this month shows. */
function Legend({ grid }: { grid: MonthGrid }) {
  const have = new Set(grid.cells.filter((c) => c.inMonth).map((c) => c.kind));
  const order: DayKind[] = ['trip', 'off', 'offAway', 'sby', 'sbyHotel', 'asby', 'res', 'leave', 'sick', 'training', 'joining'];
  const items = order.filter((k) => have.has(k));
  if (!items.length) return null;
  return <div className="ps-legend tiny muted">{items.map((k) => <span key={k} className="row gap-4"><span className={`ps-sw k-${k}`} aria-hidden />{DAY_KIND_LABEL[k]}</span>)}</div>;
}

export default function PersonSheet({ crewId, back }: { crewId: string; back?: ModalSpec }) {
  const g = useGame();
  const c = g.crew[crewId];
  // A person who left while the sheet was open: nothing to show.
  return c ? <Sheet key={c.id} g={g} c={c} back={back} /> : null;
}

function Sheet({ g, c, back }: { g: GameState; c: CrewMember; back?: ModalSpec }) {
  const todayK = dayIndex(c.base, g.now);
  const nowKey = monthKey(midnight(c.base, todayK) + 12 * HOUR);
  const [mk, setMk] = useState(nowKey);
  const [sel, setSel] = useState<number>(todayK);
  const close = () => (back ? store.openModal(back) : store.closeModal());
  const data = useMonth(g, c, mk);
  const bounds: [number, number] = [nowKey - 1, monthKey(Math.max(publishedTo(g), g.now) + 40 * DAY)];
  const setMonth = (m: number) => {
    setMk(m);
    // The selection follows: today in this month, else its 1st.
    const k1 = Math.floor(monthStart(m) / DAY);
    setSel(nowKey === m ? todayK : k1);
  };
  const sv = crewStatusView(g, c.id);
  const todayWd = mk === nowKey ? (toDate(todayK * DAY).getUTCDay() + 6) % 7 : null;
  return (
    <Modal
      size="xwide"
      className="ps-modal"
      onClose={close}
      icon={back ? <button className="btn btn-ghost btn-icon ps-back" onClick={() => store.openModal(back)} aria-label="Back"><ChevronLeft /></button> : <span className="sc-flag ps-flag" aria-hidden>{flag(c.nationality)}</span>}
      title={
        <span className="ps-title">
          <span className="row gap-8"><span className="ellipsis">{crewName(c)}</span><RankMark role={c.role} /><span className={`badge ${sv.tone === 'bad' ? 'bad' : sv.tone === 'warn' ? 'warn' : sv.tone === 'good' ? 'good' : ''}`}>{sv.label}</span></span>
          <span className="ps-sub small muted ellipsis">{ROLE_LABEL[c.role]} · {ratingLine(c.ratings, homeOf(g, c.id), [...new Set(Object.values(g.fleet).map((a) => a.typeId))])} · base {c.base}</span>
        </span>
      }
    >
      <div className="ps">
        <div className="ps-left">
          <Calendar grid={data.grid} sel={sel} onSel={setSel} mk={mk} setMk={setMonth} bounds={bounds} todayWd={todayWd} />
          <Legend grid={data.grid} />
        </div>
        <div className="ps-right">
          <DayDetail g={g} c={c} data={data} k={sel} />
          <div className="upper dim ps-h">{MONTH[mk % 12]} totals</div>
          <Totals g={g} c={c} data={data} mk={mk} />
          <div className="upper dim ps-h">About {c.first}</div>
          <Essentials g={g} c={c} />
        </div>
      </div>
    </Modal>
  );
}
