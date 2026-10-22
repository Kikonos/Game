// v0.7.2 top bar live ops strip (UPDATE-0.7.2.md F8, F2): the pause badge and warnings first (crew shortage, AOG,
// a new market offer), then calm two-line facts (Airborne · Next · On time today · Crew), each a button to its screen.
// Moves only on the clock step (CLOCK_STEP); no ticker, no animation. Items that don't fit drop by priority
// (CREW → ON TIME → AIRBORNE → NEXT), then extra warnings fold into '+N'. Widths come from a hidden measuring row.

import { AlertTriangle, Plane, Users, Wrench } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { CLOCK_STEP, fmtTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { shortFlights } from '../../engine/crew';
import { opsStripFacts } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { typeName } from '../screens/Market';
import { unseenOffers } from '../screens/screenLogic';
import { store, useClock, useGame } from '../store';

export type StripId = 'crewShort' | 'aog' | 'market' | 'next' | 'airborne' | 'onTime' | 'crew';

export interface StripItem {
  id: StripId;
  /** Warnings are never dropped (they fold into '+N'). */
  warn: boolean;
  tone: 'bad' | 'warn' | 'info' | '';
  label: string;
  value: string;
  aria: string;
  go: () => void;
}

/** Drop order when space is short (first goes first). */
export const DROP: StripId[] = ['crew', 'onTime', 'airborne', 'next'];

/** '1:20' to a departure (h:mm), '0:05'; past 24 h the UTC time. */
export function countdown(min: number, dep: number): string {
  const m = Math.max(0, Math.round(min));
  if (m >= 24 * 60) return fmtTime(dep);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Open, unexpired market offers the player has not looked at (market alerts on). */
function freshOffers(g: GameState) {
  if (!store.settings.marketAlerts) return [];
  const open = g.market.aircraft.filter((o) => o.expires > g.now);
  return open.filter((o) => unseenOffers([o.id]) > 0);
}

/** The strip's items in display order (warnings, then facts). `shown` = the stepped clock. */
export function stripItems(g: GameState, shown: number): StripItem[] {
  const out: StripItem[] = [];
  const short = shortFlights(g);
  const s0 = short[0];
  const sf = s0 ? g.flights[s0.flightId] : undefined;
  if (s0 && sf) {
    out.push({
      id: 'crewShort', warn: true, tone: s0.stage === 'red' ? 'bad' : 'warn', label: short.length > 1 ? `Crew short · ${short.length}` : 'Crew short',
      value: `${sf.no} ${fmtTime(sf.std)}`, aria: `Crew shortage: ${sf.no} at ${fmtTime(sf.std)}. Open Crew Control`,
      go: () => store.openModal({ kind: 'crewControl', flightId: sf.id }),
    });
  }
  const f = opsStripFacts(g);
  if (f.aog.length) {
    const a = f.aog[0];
    out.push({
      id: 'aog', warn: true, tone: 'bad', label: f.aog.length > 1 ? `AOG · ${f.aog.length}` : 'AOG', value: `${a.reg} ${a.at}`, aria: `${a.reg} AOG at ${a.at}. Open the card`,
      go: () => {
        const card = store.game ? problemAt(store.game, { kind: 'aircraft', id: a.aircraftId }) : null;
        if (card) store.openModal({ kind: 'problem', subject: card.subject });
        else store.navigate('fleet', { sel: { kind: 'aircraft', id: a.aircraftId } });
      },
    });
  }
  const offers = freshOffers(g);
  if (offers.length) {
    const o = offers[offers.length - 1];
    const what = `${typeName(o.typeId)} ${o.kind === 'dryLeaseIn' ? 'lease' : 'sale'}`;
    out.push({
      id: 'market', warn: true, tone: 'info', label: offers.length > 1 ? `New offer · +${offers.length - 1}` : 'New offer', value: what,
      aria: `New aircraft offer: ${what}. Open the market`,
      go: () => store.navigate('fleet', { view: 'market', sel: { kind: 'market', id: o.id } }),
    });
  }
  if (f.next) {
    const n = f.next;
    out.push({
      id: 'next', warn: false, tone: '', label: 'Next', value: `${n.no} ${n.from}→${n.to} in ${countdown(n.dep - shown, n.dep)}`,
      aria: `Next departure ${n.no} ${n.from} to ${n.to}. Open the flight`,
      go: () => {
        store.navigate('schedule', n.aircraftId ? { sel: { kind: 'aircraft', id: n.aircraftId } } : {});
        store.openModal({ kind: 'sheet', refs: [{ kind: 'flight', id: n.flightId }] });
      },
    });
  }
  if (f.fleet) {
    out.push({ id: 'airborne', warn: false, tone: '', label: 'Airborne', value: `${f.airborne}/${f.fleet}`, aria: `${f.airborne} of ${f.fleet} aircraft airborne. Open the map`, go: () => store.navigate('map') });
  }
  if (f.onTime) {
    const pct = Math.round((f.onTime.onTime / f.onTime.landed) * 100);
    out.push({ id: 'onTime', warn: false, tone: pct >= 85 ? '' : pct >= 70 ? 'warn' : 'bad', label: 'On time today', value: `${pct}%`, aria: `On time today ${pct}% of ${f.onTime.landed} legs. Open the schedule`, go: () => store.navigate('schedule') });
  }
  out.push({
    id: 'crew', warn: false, tone: '', label: 'Crew', value: `${f.crewOnDuty} on duty · ${f.crewAtHotels} at hotels`,
    aria: `${f.crewOnDuty} crew on duty, ${f.crewAtHotels} at hotels. Open Crew`, go: () => store.navigate('crew'),
  });
  return out;
}

/** Which items fit in `room` px: drop facts in DROP order, then fold warnings after the first into a '+N' chip. Pure. */
export function fitStrip(items: { id: StripId; warn: boolean; w: number }[], room: number, gap: number, plusW: number): { show: Set<StripId>; folded: number } {
  const show = new Set(items.map((i) => i.id));
  const width = (extra = 0) => {
    const vis = items.filter((i) => show.has(i.id));
    return vis.reduce((s, i) => s + i.w, 0) + gap * Math.max(0, vis.length - 1 + (extra ? 1 : 0)) + extra;
  };
  for (const id of DROP) {
    if (width() <= room) return { show, folded: 0 };
    show.delete(id);
  }
  const warns = items.filter((i) => i.warn);
  let folded = 0;
  while (width(folded ? plusW : 0) > room && warns.length - folded > 1) {
    folded++;
    show.delete(warns[warns.length - folded].id);
  }
  return { show, folded };
}

const ICON: Partial<Record<StripId, ReactNode>> = { crewShort: <Users />, aog: <Wrench />, market: <Plane /> };

function Item({ it, measure }: { it: StripItem; measure?: boolean }) {
  return (
    <button className={`os-item ${it.warn ? 'os-warn' : 'os-fact'} ${it.tone}`} data-strip={it.id} onClick={measure ? undefined : it.go} aria-label={it.aria} tabIndex={measure ? -1 : undefined}>
      {it.warn && <span className="os-ico" aria-hidden>{ICON[it.id] ?? <AlertTriangle />}</span>}
      <span className="os-txt">
        <span className="os-k">{it.label}</span>
        <span className="os-v">{it.value}</span>
      </span>
    </button>
  );
}

const GAP = 8;
const PLUS_W = 52;

/** The strip between the speed control and cash. `badge` = the pause badge (leftmost, never dropped); `badgeKey` changes with it. */
export function OpsStrip({ badge, badgeKey, compact }: { badge: ReactNode; badgeKey: string; compact: boolean }) {
  const g = useGame();
  const t = useClock();
  const step = CLOCK_STEP[store.speed];
  const shown = Math.floor(t / step) * step;
  const all = stripItems(g, shown).filter((i) => !compact || i.warn || i.id === 'next');
  const box = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ show: string; folded: number }>({ show: all.map((i) => i.id).join(), folded: 0 });
  const sig = all.map((i) => `${i.id}:${i.label}:${i.value}`).join('|');

  useLayoutEffect(() => {
    const el = box.current;
    const m = meter.current;
    if (!el || !m) return;
    const run = () => {
      const badgeW = (el.querySelector('.pause-badge') as HTMLElement | null)?.offsetWidth ?? 0;
      const room = el.clientWidth - (badgeW ? badgeW + GAP : 0);
      const widths = all.map((i) => ({ id: i.id, warn: i.warn, w: (m.querySelector(`[data-strip="${i.id}"]`) as HTMLElement | null)?.offsetWidth ?? 0 }));
      const r = fitStrip(widths, room, GAP, PLUS_W);
      const show = all.filter((i) => r.show.has(i.id)).map((i) => i.id).join();
      setFit((p) => (p.show === show && p.folded === r.folded ? p : { show, folded: r.folded }));
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, badgeKey]);

  const show = new Set(fit.show.split(','));
  const vis = all.filter((i) => show.has(i.id));
  const hidden = all.filter((i) => i.warn && !show.has(i.id));
  return (
    <div className="tb-strip" ref={box} role="group" aria-label="Live operations">
      {badge}
      {vis.map((it) => <Item key={it.id} it={it} />)}
      {fit.folded > 0 && hidden[0] && (
        <button className="os-item os-plus" onClick={hidden[0].go} aria-label={`${hidden.length} more warning${hidden.length === 1 ? '' : 's'}: ${hidden.map((h) => h.label).join(', ')}`}>+{hidden.length}</button>
      )}
      <div className="os-meter" ref={meter} aria-hidden>
        {all.map((it) => <Item key={it.id} it={it} measure />)}
      </div>
    </div>
  );
}
