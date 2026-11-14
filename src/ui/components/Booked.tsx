// v0.24 the 'booked' figure (the player: "a discreet 'booked' statistic per aircraft and in general over several periods
// of time"): a small pill with the last 30 days; a tap opens the periods back and ahead (engine/ops/booked.ts).

import { useMemo, useRef } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { bookedPct, bookedPeriods, type BookedPeriod } from '../../engine/ops';
import { PopBox, usePopover } from './Term';

/** The periods of some aircraft (all of the fleet in service when none given), once per game hour. */
export function useBooked(g: GameState, ids?: string[]): BookedPeriod[] {
  const hour = Math.floor(g.now / 60);
  const rev = flightsRev(g);
  const key = ids?.join() ?? '*';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => bookedPeriods(g, ids), [g, hour, rev, key, Object.keys(g.fleet).length]);
}

function Rows({ list }: { list: BookedPeriod[] }) {
  return (
    <>
      {list.map((p) => (
        <tr key={p.id}>
          <td className="nowrap">{p.label}</td>
          <td className="num"><b>{bookedPct(p.share)}</b></td>
          <td className="num dim">{p.perDay === null ? '–' : p.perDay.toFixed(1)}</td>
        </tr>
      ))}
    </>
  );
}

/** 'Booked 28 %' (last 30 days); a tap: back 7 / 30 / 90 days and the year, ahead 7 / 30 / 90 days, with BH a day. */
export function BookedPill({ g, ids, title }: { g: GameState; ids?: string[]; /** The popover heading ('9H-MLT booked', 'Fleet booked'). */ title: string }) {
  const list = useBooked(g, ids);
  const [open, toggle, close] = usePopover();
  const ref = useRef<HTMLSpanElement>(null);
  const head = list.find((p) => p.id === 'last30')!;
  const ahead = list.find((p) => p.id === 'next30')!;
  // The record's first day when it is younger than a period (a young company, an older save): said once, in the head.
  const since = list.find((p) => p.id === 'ytd')?.since;
  // Nothing flown yet (a new aircraft, a new company): the next 30 days instead.
  const show = head.share === null || (head.bh === 0 && ahead.bh > 0) ? ahead : head;
  return (
    <>
      <span ref={ref} role="button" tabIndex={0} className={`v24-booked ${open ? 'on' : ''}`} aria-expanded={open} aria-label={`${title}: ${bookedPct(show.share)} ${show.past ? 'in the last 30 days' : 'in the next 30 days'}`}
        onClick={toggle} onKeyDown={(k) => (k.key === 'Enter' || k.key === ' ') && toggle(k)}>
        Booked <b className="num">{bookedPct(show.share)}</b>{!show.past && <span className="dim"> ahead</span>}
      </span>
      {open && ref.current && (
        <PopBox anchor={ref.current} onClose={close} label={title} className="v24-booked-pop">
          <b>{title}</b>
          <table className="v24-booked-table small">
            <thead><tr><th>Flown{since !== undefined && <span className="v24-booked-since"> · since {fmtDay(since)}</span>}</th><th className="num">Booked</th><th className="num">BH a day</th></tr></thead>
            <tbody><Rows list={list.filter((p) => p.past)} /></tbody>
            <thead><tr><th>On the books</th><th /><th /></tr></thead>
            <tbody><Rows list={list.filter((p) => !p.past)} /></tbody>
          </table>
          <div className="tiny dim help-body">Sold flying (contracts, charters, routes) out of every hour the aircraft is ours, 24 a day. Ferries and positioning do not count. A busy short-haul jet flies 10–12 block hours a day: about 45 %.</div>
        </PopBox>
      )}
    </>
  );
}
