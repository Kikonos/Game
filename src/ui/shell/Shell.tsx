// Game shell for iPad landscape: top bar (company, UTC clock, speed control, cash, alerts, menu)
// and a left rail of eight screens. No ticker (calm visuals). DESIGN.md §6.1. Owner: architect → B5.

import {
  Bell, Building2, CalendarRange, FileSignature, Globe2, Inbox as InboxIcon, Menu, Pause, Plane, Play, Users, Wallet,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { fmtDate, fmtTime } from '../../engine/core/time';
import { TailBadge } from '../components/Logo';
import { money } from '../format';
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
import { type GameSpeed, SPEED_LABEL, type Tab, store, useClock, useGame, useStore } from '../store';
import { useMedia, useTier } from '../useMedia';
import { CLOCK_STEP, SPEEDS } from '../../engine/core/time';
import type { PauseReason } from '../../engine/core/pause';

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
  else if (g.messages.some((m) => !m.read)) b.inbox = '';
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

/** Pause + labelled speeds (1× 2× 4×); static amber while a decision holds time. */
function SpeedControl() {
  const s = useStore();
  const hover = useMedia('(hover: hover)');
  const blocked = s.blocked;
  const running = !s.paused && !blocked;
  const hint = blocked ? 'Time is paused until you decide' : hover ? 'Space: pause · 1–3: speed' : undefined;
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
  marketOffer: 'Market offer',
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
    else if (reason === 'crewShortage') {
      // The flight in the newest 'No crew for …' message: its detail sheet has the crew/duty actions.
      const ref = g?.messages.find((m) => m.cat === 'crew' && m.ref?.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled')?.ref;
      const link = g && ref ? refTarget(g, ref) : null;
      if (!ref || !link) return s.navigate('crew');
      s.navigate(link.tab, { sel: link.sel, view: link.view });
      s.openModal({ kind: 'sheet', refs: [ref] });
    }
    else if (reason === 'contractStart') s.navigate('schedule');
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
  return (
    <button className="tb-cash" onClick={() => store.navigate('finance')} aria-label={`Cash ${money(cash)}: finance`}>
      <span className={`v ${cash < 0 ? 'bad' : ''}`}>{money(cash)}</span>
      <span className="s"><span className="sl">cash</span></span>
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

function TopBar() {
  return (
    <header className="topbar">
      <CompanyPill />
      <div className="tb-sep" />
      <Clock />
      <SpeedControl />
      <PauseBadge />
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
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        store.togglePause();
      } else if (['1', '2', '3'].includes(e.key) && !store.modal) {
        store.setSpeed(SPEEDS[Number(e.key) - 1] as GameSpeed);
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
      <TopBar />
      <Rail />
      <main className={`main ${tab === 'map' ? 'no-scroll' : ''}`}>
        {tab === 'map' && <OpsMap />}
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
