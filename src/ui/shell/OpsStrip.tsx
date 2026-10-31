// v0.7.2 top bar live ops strip (UPDATE-0.7.2.md F8, F2): the pause badge and warnings first (crew shortage, AOG,
// a new market offer), then calm two-line facts (Airborne · Next · On time today · Crew), each a button to its screen.
// Moves only on the clock step (CLOCK_STEP); no ticker, no animation. Items that don't fit drop by priority
// (CREW, then warning chips slim to icon + value, then ON TIME → AIRBORNE → NEXT), then extra warnings fold into '+N'. Widths come from a hidden measuring row.

import { AlertTriangle, Plane, TimerOff, Users, Wrench } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { CLOCK_STEP, fmtDuration } from '../../engine/core/time';
import { dated } from '../components/problemLogic';
import { countdown, fitStrip, type StripId } from './opsStripLogic';
import type { GameState } from '../../engine/core/types';
import { shortFlights } from '../../engine/crew';
import { opsStripFacts } from '../../engine/ops';
import { problemAt } from '../../engine/problems';
import { typeName } from '../screens/Market';
import { unseenOffers } from '../screens/screenLogic';
import { store, useClock, useGame } from '../store';


export interface StripItem {
  id: StripId;
  /** Warnings are never dropped (they fold into '+N'). */
  warn: boolean;
  tone: 'bad' | 'warn' | 'info' | '';
  label: string;
  /** Beside the label, normal case ('in 1h 20m', '3 Apr 00:10'). */
  sub?: string;
  value: string;
  aria: string;
  go: () => void;
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
  // v0.9 §T.4: a seat with nobody (crew short) and a named crew member over a limit (out of hours) are separate items.
  const all = shortFlights(g);
  for (const kind of ['short', 'hours'] as const) {
    const list = all.filter((x) => (x.kind ?? 'short') === kind);
    const s0 = list[0];
    const sf = s0 ? g.flights[s0.flightId] : undefined;
    if (!s0 || !sf) continue;
    const red = list.some((x) => x.stage === 'red');
    const word = kind === 'hours' ? 'Out of hours' : 'Crew short';
    out.push({
      id: kind === 'hours' ? 'crewHours' : 'crewShort', warn: true, tone: red ? 'bad' : 'warn', label: list.length > 1 ? `${word} · ${list.length}` : word,
      // v0.12.1 with the day when it is not today (alerts reach 48 h ahead).
      value: `${sf.no} ${dated(sf.std, g.now)}`, aria: `${kind === 'hours' ? 'Crew out of hours' : 'Crew shortage'}: ${sf.no} at ${dated(sf.std, g.now)} UTC. Open Crew Control`,
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
    const when = countdown(n.dep, shown);
    const reg = n.aircraftId ? g.fleet[n.aircraftId]?.reg : undefined;
    // v0.12.1 a late leg shows how late it runs ('in 40m (+31m)').
    const late = n.late > 15 ? ` (+${fmtDuration(n.late)})` : '';
    out.push({
      id: 'next', warn: false, tone: n.late > 15 ? 'warn' : '', label: 'Next', sub: `${when}${late}`, value: `${n.no} ${n.from}→${n.to}`,
      aria: `Next departure ${n.no}${reg ? ` (${reg})` : ''} ${n.from} to ${n.to}, ${when}${late ? `, ${fmtDuration(n.late)} late` : ''}. Open the flight`,
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

const ICON: Partial<Record<StripId, ReactNode>> = { crewShort: <Users />, crewHours: <TimerOff />, aog: <Wrench />, market: <Plane /> };

/** One strip button. `slim` (warnings only): icon + value on one line, the label in the tooltip. */
function Item({ it, measure, slim }: { it: StripItem; measure?: string; slim?: boolean }) {
  const thin = slim && it.warn;
  return (
    <button className={`os-item ${it.warn ? 'os-warn' : 'os-fact'} ${thin ? 'os-slim' : ''} ${it.tone}`} data-strip={measure ? `${it.id}${measure}` : it.id} onClick={measure ? undefined : it.go} aria-label={it.aria} title={thin ? it.label : undefined} tabIndex={measure ? -1 : undefined}>
      {it.warn && <span className="os-ico" aria-hidden>{ICON[it.id] ?? <AlertTriangle />}</span>}
      {thin ? <span className="os-v">{it.value}</span> : (
        <span className="os-txt">
          <span className="os-k">{it.label}{it.sub && <span className="os-sub"> {it.sub}</span>}</span>
          <span className="os-v">{it.value}</span>
        </span>
      )}
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
  const [fit, setFit] = useState<{ show: string; folded: number; slim: boolean }>({ show: all.map((i) => i.id).join(), folded: 0, slim: false });
  const sig = all.map((i) => `${i.id}:${i.label}:${i.sub ?? ''}:${i.value}`).join('|');

  useLayoutEffect(() => {
    const el = box.current;
    const m = meter.current;
    if (!el || !m) return;
    const run = () => {
      const badgeW = (el.querySelector('.pause-badge') as HTMLElement | null)?.offsetWidth ?? 0;
      const room = el.clientWidth - (badgeW ? badgeW + GAP : 0);
      const wOf = (k: string) => (m.querySelector(`[data-strip="${k}"]`) as HTMLElement | null)?.offsetWidth ?? 0;
      const widths = all.map((i) => ({ id: i.id, warn: i.warn, w: wOf(`${i.id}-m`), ws: i.warn ? wOf(`${i.id}-s`) : undefined }));
      const r = fitStrip(widths, room, GAP, PLUS_W);
      const show = all.filter((i) => r.show.has(i.id)).map((i) => i.id).join();
      setFit((p) => (p.show === show && p.folded === r.folded && p.slim === r.slim ? p : { show, folded: r.folded, slim: r.slim }));
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
      {vis.map((it) => <Item key={it.id} it={it} slim={fit.slim} />)}
      {fit.folded > 0 && hidden[0] && (
        <button className="os-item os-plus" onClick={hidden[0].go} aria-label={`${hidden.length} more warning${hidden.length === 1 ? '' : 's'}: ${hidden.map((h) => h.label).join(', ')}`}>+{hidden.length}</button>
      )}
      <div className="os-meter" ref={meter} aria-hidden>
        {all.map((it) => <Item key={it.id} it={it} measure="-m" />)}
        {all.filter((it) => it.warn).map((it) => <Item key={`${it.id}-s`} it={it} measure="-s" slim />)}
      </div>
    </div>
  );
}
