// Game shell for iPad landscape: top bar (company, UTC clock, speed control, cash, alerts, menu)
// and a left rail of eight screens. No ticker (calm visuals). DESIGN.md §6.1. Owner: architect → B5.
// v0.7.2: the live ops strip (OpsStrip) fills the space between the speed control and cash.

import {
  Bell, Building2, CalendarRange, FileSignature, Globe2, Inbox as InboxIcon, Menu, Pause, Plane, Play, TrendingDown, TrendingUp, Users, Wallet,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { fmtDate, fmtTime } from '../../engine/core/time';
import { TailBadge } from '../components/Logo';
import { money, moneyDelta } from '../format';
import { GameModals, GlobalModals } from '../game/Modals';
import { OpsMap } from '../map/OpsMap';
import { CompanyScreen } from '../screens/Company';
import { ContractsScreen } from '../screens/Contracts';
import { CrewScreen } from '../screens/Crew';
import { FinanceScreen } from '../screens/Finance';
import { FleetScreen } from '../screens/Fleet';
import { InboxScreen } from '../screens/Inbox';
import { ScheduleScreen } from '../screens/Schedule';
import { refTarget } from '../screens/screenLogic';
import { OpsStrip } from './OpsStrip';
import { profitPerDay } from './cashRate';
import { shortFlights } from '../../engine/crew';
import { type GameSpeed, SPEED_LABEL, type Tab, store, useClock, useGame, useStore } from '../store';
import { useMedia, useTier } from '../useMedia';
import { CLOCK_STEP, SPEEDS } from '../../engine/core/time';
import type { PauseReason } from '../../engine/core/pause';
import { ScreenHint } from '../components/ScreenHint';

export const NAV: { tab: Tab; label: string; short: string; icon: ReactNode }[] = [
  { tab: 'map', label: 'Ops Map', short: 'Map', icon: <Globe2 /> },
  { tab: 'contracts', label: 'Contracts', short: 'Contracts', icon: <FileSignature /> },
  { tab: 'schedule', label: 'Schedule', short: 'Schedule', icon: <CalendarRange /> },
  { tab: 'crew', label: 'Crew', short: 'Crew', icon: <Users /> },
  { tab: 'fleet', label: 'Fleet', short: 'Fleet', icon: <Plane /> },
  { tab: 'finance', label: 'Finance', short: 'Finance', icon: <Wallet /> },
  { tab: 'company', label: 'Company', short: 'Company', icon: <Building2 /> },
  { tab: 'inbox', label: 'Inbox', short: 'Inbox', icon: <InboxIcon /> },
];

const count = (n: number) => (n > 99 ? '99+' : String(n));

/** Badges: open offers on Contracts; on Inbox the bell's rule (decisions + unread bad/warn), a dot for other unread. */
function useNavBadges(): Partial<Record<Tab, string>> {
  const g = useGame();
  const offers = Object.values(g.offers).filter((o) => o.status === 'open').length;
  const alerts = g.decisions.length + g.messages.filter((m) => !m.read && (m.tone === 'bad' || m.tone === 'warn')).length;
  const b: Partial<Record<Tab, string>> = {};
  if (offers) b.contracts = count(offers);
  if (alerts) b.inbox = count(alerts);
  // v0.7: hidden market alerts don't light the dot.
  else if (g.messages.some((m) => !m.read && store.shows(m))) b.inbox = '';
  return b;
}

/** UTC date and time; the label moves in CLOCK_STEP minutes so it never flickers. */
function Clock() {
  const t = useClock();
  const s = store;
  const step = CLOCK_STEP[s.speed];
  const shown = Math.floor(t / step) * step;
  return (
    <div className="clock">
      <span className="date">{fmtDate(shown, true)}</span>
      <span className="time">{fmtTime(shown)} UTC</span>
    </div>
  );
}

/** v0.12 keys 1, 2 and 4 pick the speed they name (3 stays 4×, the third button, as before). */
const SPEED_KEYS: Record<string, GameSpeed> = { 1: SPEEDS[0], 2: SPEEDS[1], 3: SPEEDS[2], 4: SPEEDS[2] };

/** Pause + labelled speeds (1× 2× 4×); static amber while a decision holds time. */
function SpeedControl() {
  const s = useStore();
  const hover = useMedia('(hover: hover)');
  const blocked = s.blocked;
  const running = !s.paused && !blocked;
  const hint = blocked ? 'Time is paused until you decide' : hover ? 'Space: pause · 1, 2, 4: speed' : undefined;
  return (
    <div className={`speed ${blocked ? 'blocked' : ''}`} role="group" aria-label="Game speed" title={hint}>
      <button className={`sp-pause ${running ? '' : 'on'}`} onClick={() => s.togglePause()} aria-label={s.paused ? 'Resume' : 'Pause'} aria-pressed={!running}>
        {s.paused ? <Play /> : <Pause />}
      </button>
      <span className="sp-sep" aria-hidden />
      {SPEEDS.map((sp) => (
        <button key={sp} className={s.speed === sp ? (running ? 'on' : 'sel') : ''} onClick={() => s.setSpeed(sp)} aria-label={`Speed ${SPEED_LABEL[sp]}`} aria-pressed={running && s.speed === sp}>
          {SPEED_LABEL[sp]}
        </button>
      ))}
    </div>
  );
}

const PAUSE_LABEL: Record<PauseReason, string> = {
  decision: 'Decision waiting', urgentOffer: 'Urgent offer', aog: 'Aircraft AOG', monthEnd: 'Month closed', contractStart: 'Contract starts', crewShortage: 'Crew shortage',
  marketOffer: 'Market offer', crewHours: 'Crew out of hours', rule: 'Your rule',
};

/** Static amber badge saying why the clock stopped (no pulsing); tap goes where the reason lives. */
function PauseBadge() {
  const s = useStore();
  const reason: PauseReason | null = s.blocked ? 'decision' : s.paused ? s.pauseReason : null;
  if (!reason) return null;
  const go = () => {
    const g = s.game;
    if (reason === 'decision' && s.settings.autoPause.decision && !s.decisionOpen) return s.reopenDecision();
    if (reason === 'urgentOffer') s.navigate('contracts', { view: 'market' });
    else if (reason === 'monthEnd') s.navigate('finance');
    else if (reason === 'crewShortage' || reason === 'crewHours') {
      // v0.7.1: Crew Control for the soonest short flight (v0.9: of that kind first); else the newest crew message's flight sheet.
      const all = g ? shortFlights(g) : [];
      const short = all.find((x) => (x.kind ?? 'short') === (reason === 'crewHours' ? 'hours' : 'short')) ?? all[0];
      if (short) return s.openModal({ kind: 'crewControl', flightId: short.flightId });
      const ref = g?.messages.find((m) => m.cat === 'crew' && m.ref?.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled')?.ref;
      const link = g && ref ? refTarget(g, ref) : null;
      if (!ref || !link) return s.navigate('crew');
      s.navigate(link.tab, { sel: link.sel, view: link.view });
      s.openModal({ kind: 'sheet', refs: [ref] });
    }
    else if (reason === 'contractStart') s.navigate('schedule');
    else if (reason === 'rule') s.navigate('company', { view: 'team', sel: { kind: 'head', id: 'watch' } });
    else if (reason === 'marketOffer') {
      // v0.7.2: straight to the newest offer.
      const o = g?.market.aircraft.filter((x) => x.expires > g.now).at(-1);
      s.navigate('fleet', { view: 'market', sel: o ? { kind: 'market', id: o.id } : undefined });
    }
    else s.navigate('inbox');
  };
  return (
    <button className="pause-badge" onClick={go} aria-label={`Paused: ${PAUSE_LABEL[reason]}`}>
      <span className="pb-k">Paused</span>
      <span className="pb-r">{PAUSE_LABEL[reason]}</span>
    </button>
  );
}

function CompanyPill() {
  const g = useGame();
  const c = g.company;
  return (
    <button className="airline-pill" onClick={() => store.navigate('company')} aria-label={`${c.name}: company`}>
      <TailBadge primary={c.livery.primary} secondary={c.livery.secondary} code={c.code} size={30} livery={c.livery} />
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="name ellipsis">{c.name}</span>
        <span className="lvl ellipsis">{c.icao} · {c.homeBase}</span>
      </div>
    </button>
  );
}

function CashBlock() {
  const g = useGame();
  const cash = g.company.cash;
  // v0.12 profit per day (green / red), recomputed at most hourly.
  const hour = Math.floor(g.now / 60);
  const rate = useMemo(() => profitPerDay(g), [g, hour]); // eslint-disable-line react-hooks/exhaustive-deps
  const rateText = rate ? `${moneyDelta(Math.round(rate.perDay))}/day` : '';
  const rateWhy = rate ? (rate.basis === 'lastMonth' ? 'Profit per day last month' : 'Profit per day this month, with rent, insurance, overhead and salaries spread over the month') : '';
  return (
    <button className="tb-cash" onClick={() => store.navigate('finance')} aria-label={`Cash ${money(cash)}${rate ? `, ${rateText}` : ''}: finance`} title={rateWhy || undefined}>
      {/* v0.12 '$2.97M cash' on one line; the profit-per-day pill under the amount, right edges aligned */}
      <span className={`v ${cash < 0 ? 'bad' : ''}`}>{money(cash)}</span>
      <span className="sl">cash</span>
      {rate && (
        <span className={`tb-rate ${rate.perDay >= 0 ? 'up' : 'down'}`}>
          {rate.perDay >= 0 ? <TrendingUp aria-hidden /> : <TrendingDown aria-hidden />}
          <b>{money(Math.abs(Math.round(rate.perDay)))}</b><i>/day</i>
        </span>
      )}
    </button>
  );
}

function Alerts() {
  const g = useGame();
  const n = g.decisions.length + g.messages.filter((m) => !m.read && (m.tone === 'bad' || m.tone === 'warn')).length;
  return (
    <>
      <button className="btn btn-ghost btn-icon bell" onClick={() => store.navigate('inbox')} aria-label={`Inbox${n ? `, ${n} alerts` : ''}`}>
        <Bell />
        {n > 0 && <span className="pip">{count(n)}</span>}
      </button>
      <button className="btn btn-ghost btn-icon" onClick={() => store.openModal({ kind: 'menu' })} aria-label="Menu"><Menu /></button>
    </>
  );
}

function TopBar({ compact }: { compact: boolean }) {
  const s = useStore();
  const badgeKey = s.blocked ? 'decision' : s.paused ? s.pauseReason ?? '' : '';
  return (
    <header className="topbar">
      <CompanyPill />
      <div className="tb-sep" />
      <Clock />
      <SpeedControl />
      <OpsStrip badge={<PauseBadge />} badgeKey={badgeKey} compact={compact} />
      <div className="tb-right">
        <CashBlock />
        <Alerts />
      </div>
    </header>
  );
}

function Rail() {
  const s = useStore();
  const badges = useNavBadges();
  return (
    <nav className="sidebar rail" aria-label="Sections">
      {NAV.map((n) => {
        const active = s.nav.tab === n.tab;
        const b = badges[n.tab];
        return (
          <button key={n.tab} className={`nav-item ${active ? 'active' : ''}`} onClick={() => s.navigate(n.tab)} data-nav={n.tab} aria-current={active ? 'page' : undefined} aria-label={b ? `${n.label}, ${b}` : b === '' ? `${n.label}, unread` : n.label}>
            <span className="ico">
              {n.icon}
              {b !== undefined && <span className={`nb ${b ? '' : 'dot'}`}>{b}</span>}
            </span>
            <span className="lbl">{n.short}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Shell() {
  const s = useStore();
  const tier = useTier();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      // v0.12 ⌘1 / Ctrl+1 belong to the browser (tabs), and a held key repeats nothing here.
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        store.togglePause();
      } else if (SPEED_KEYS[e.key] && !store.modal) {
        store.setSpeed(SPEED_KEYS[e.key]);
      } else if (e.key === 'Escape' && !store.modal) {
        store.openModal({ kind: 'menu' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tab = s.nav.tab;
  return (
    <div className={`shell acmi ${tier === 'compact' ? 'compact-acmi' : 'medium'}`}>
      <TopBar compact={tier === 'compact'} />
      <Rail />
      <main className={`main ${tab === 'map' ? 'no-scroll' : ''}`}>
        {tab === 'map' && <OpsMap />}
        {/* The map hint sits where the selection panel opens: hidden while one is open. */}
        {tab === 'map' && !s.nav.sel && <ScreenHint id="map" className="float" />}
        {tab === 'contracts' && <ContractsScreen />}
        {tab === 'schedule' && <ScheduleScreen />}
        {tab === 'crew' && <CrewScreen />}
        {tab === 'fleet' && <FleetScreen />}
        {tab === 'finance' && <FinanceScreen />}
        {tab === 'company' && <CompanyScreen />}
        {tab === 'inbox' && <InboxScreen />}
      </main>
      <GameModals />
      <GlobalModals />
    </div>
  );
}
