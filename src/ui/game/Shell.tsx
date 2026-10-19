import {
  Bell, BarChart3, Building2, ChevronRight, Globe2, Inbox as InboxIcon, LayoutDashboard, LayoutGrid, Megaphone, Menu, Pause, Plane, Play,
  Radar, Route as RouteIcon, Save, Settings as SettingsIcon, ShoppingCart, Trophy, Wallet,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import { monthProfit } from '../../engine/economy';
import { activeGoals, levelProgress } from '../../engine/progression';
import { formatDate } from '../../engine/util';
import { Bar, Modal, Stars } from '../components/ui';
import { LogoMark, TailBadge } from '../components/Logo';
import { money } from '../format';
import { type GameSpeed, SPEED_LABEL, type Tab, store, useClock, useGame, useStore } from '../store';
import { COMPACT_SHORT, type Tier, useMedia, useTier, useTouch } from '../useMedia';
import { Dashboard } from './Dashboard';
import { Expansion } from './Expansion';
import { Finance } from './Finance';
import { Fleet } from './Fleet';
import { Goals } from './Goals';
import { InboxScreen } from './Inbox';
import { Intel } from './Intel';
import { Brand } from './Brand';
import { Market } from './Market';
import { MapScreen } from './MapScreen';
import { GameModals, GlobalModals } from './Modals';
import { Routes } from './Routes';

const NAV: { tab: Tab; label: string; short: string; icon: ReactNode }[] = [
  { tab: 'hq', label: 'Headquarters', short: 'HQ', icon: <LayoutDashboard /> },
  { tab: 'map', label: 'Network Map', short: 'Map', icon: <Globe2 /> },
  { tab: 'routes', label: 'Routes', short: 'Routes', icon: <RouteIcon /> },
  { tab: 'fleet', label: 'Fleet', short: 'Fleet', icon: <Plane /> },
  { tab: 'market', label: 'Aircraft Market', short: 'Market', icon: <ShoppingCart /> },
  { tab: 'finance', label: 'Finance', short: 'Finance', icon: <Wallet /> },
  { tab: 'intel', label: 'Market Intel', short: 'Intel', icon: <Radar /> },
  { tab: 'expansion', label: 'Expansion', short: 'Expand', icon: <Building2 /> },
  { tab: 'brand', label: 'Brand & Service', short: 'Brand', icon: <Megaphone /> },
  { tab: 'goals', label: 'Goals & Ranks', short: 'Goals', icon: <Trophy /> },
  { tab: 'inbox', label: 'Inbox', short: 'Inbox', icon: <InboxIcon /> },
];
/** Compact tier: four primary tabs, the rest live in the More sheet. */
const PRIMARY: Tab[] = ['hq', 'map', 'routes', 'fleet'];

function useBadges() {
  const g = useGame();
  return {
    unread: g.messages.filter((m) => !m.read).length,
    idle: g.fleet.filter((a) => a.status === 'active' && a.assignments.length === 0).length,
    decisions: g.decisions.length,
  };
}

const count = (n: number) => (n > 99 ? '99+' : String(n));

/** Badge per destination: decisions on HQ, idle aircraft on Fleet, unread messages on Inbox. */
function useNavBadges(): Partial<Record<Tab, { text: string; label: string }>> {
  const { unread, idle, decisions } = useBadges();
  const b: Partial<Record<Tab, { text: string; label: string }>> = {};
  if (decisions) b.hq = { text: '!', label: `${decisions} decision${decisions > 1 ? 's' : ''} waiting` };
  if (idle) b.fleet = { text: count(idle), label: `${idle} idle aircraft` };
  if (unread) b.inbox = { text: count(unread), label: `${unread} unread` };
  return b;
}

function Clock({ weekday = true }: { weekday?: boolean }) {
  const frac = useClock();
  const g = store.game!;
  const mins = Math.floor(frac * 24 * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(Math.floor((mins % 60) / 5) * 5).padStart(2, '0');
  return (
    <div className="clock">
      <span className="date">{formatDate(g.day, weekday)}</span>
      <span className="time">{hh}:{mm} UTC</span>
    </div>
  );
}

/** Pause + labelled speeds (1× 2× 4× 10×). Pulses amber while a decision holds time. */
function SpeedControl() {
  const s = useStore();
  const hover = useMedia('(hover: hover)');
  const blocked = s.blocked;
  const running = !s.paused && !blocked;
  // The keyboard hint only where a pointer can hover to read it.
  const hint = blocked ? 'Time is paused until you decide' : hover ? 'Space: pause · 1–4: speed' : undefined;
  return (
    <div className={`speed ${blocked ? 'blocked' : ''}`} role="group" aria-label="Game speed" title={hint}>
      <button className={`sp-pause ${running ? '' : 'on'}`} onClick={() => s.togglePause()} aria-label={s.paused ? 'Resume' : 'Pause'} aria-pressed={!running}>
        {s.paused ? <Play /> : <Pause />}
      </button>
      <span className="sp-sep" aria-hidden />
      {([1, 2, 3, 4] as GameSpeed[]).map((sp) => (
        <button
          key={sp}
          className={s.speed === sp ? (running ? 'on' : 'sel') : ''}
          onClick={() => s.setSpeed(sp)}
          aria-label={`Speed ${SPEED_LABEL[sp]}`}
          aria-pressed={running && s.speed === sp}
        >
          {SPEED_LABEL[sp]}
        </button>
      ))}
    </div>
  );
}

/** Tail badge ringed by level progress; opens Goals (medium and compact tiers). */
function LevelBadge() {
  const g = useGame();
  const lp = levelProgress(g);
  return (
    <button className="lv-badge" onClick={() => store.navigate('goals')} aria-label={`Level ${g.level}, ${lp.cur.title}: goals`}>
      <svg className="lv-ring" viewBox="0 0 44 44" aria-hidden>
        <circle className="trk" cx="22" cy="22" r="20.5" />
        <circle className="val" cx="22" cy="22" r="20.5" pathLength={100} strokeDasharray={`${Math.max(2, lp.pct * 100)} 100`} />
      </svg>
      <TailBadge primary={g.airline.livery.primary} secondary={g.airline.livery.secondary} code={g.airline.code} size={30} />
      <span className="lv-n">{g.level}</span>
    </button>
  );
}

/** Airline name, level and XP progress; opens Goals (wide tier). */
function AirlinePill() {
  const g = useGame();
  const lp = levelProgress(g);
  const xp = `${Math.floor(g.xp).toLocaleString()} XP`;
  return (
    <button className="airline-pill" onClick={() => store.navigate('goals')} title={xp} aria-label={`${g.airline.name}, level ${g.level} ${lp.cur.title}, ${xp}: goals`}>
      <TailBadge primary={g.airline.livery.primary} secondary={g.airline.livery.secondary} code={g.airline.code} size={30} />
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="name ellipsis">{g.airline.name}</span>
        <span className="lvl ellipsis">Lv {g.level} · {lp.cur.title}</span>
        <Bar value={lp.pct} size="thin" />
      </div>
    </button>
  );
}

/** Cash over last month's result; opens Finance (touch, rail and compact tiers). */
function CashBlock() {
  const g = useGame();
  const last = g.finance.history[g.finance.history.length - 1];
  const lastProfit = last ? monthProfit(last) : null;
  return (
    <button className="tb-cash" onClick={() => store.navigate('finance')} aria-label={`Cash ${money(g.cash)}: finance`}>
      <span className={`v ${g.cash < 0 ? 'bad' : ''}`}>{money(g.cash)}</span>
      {lastProfit !== null && (
        <span className="s">
          <b className={lastProfit >= 0 ? 'good' : 'bad'}>{lastProfit >= 0 ? '+' : ''}{money(lastProfit)}</b>
          <span className="sl"> last month</span>
        </span>
      )}
    </button>
  );
}

/** Desktop stats, as before: cash and last month. */
function Stats() {
  const g = useGame();
  const last = g.finance.history[g.finance.history.length - 1];
  const lastProfit = last ? monthProfit(last) : null;
  return (
    <>
      <div className="tb-stat">
        <span className="l">Cash</span>
        <span className={`v ${g.cash < 0 ? 'bad' : ''}`}>{money(g.cash)}</span>
      </div>
      {lastProfit !== null && (
        <div className="tb-stat tb-hide-sm">
          <span className="l">Last month</span>
          <span className={`v ${lastProfit >= 0 ? 'good' : 'bad'}`}>{lastProfit >= 0 ? '+' : ''}{money(lastProfit)}</span>
        </div>
      )}
    </>
  );
}

function Reputation() {
  const g = useGame();
  return (
    <button className="tb-stat tb-rep" onClick={() => store.navigate('brand')} aria-label={`Reputation ${Math.round(g.reputation)}: brand`}>
      <span className="l">Reputation</span>
      <span className="v"><Stars value={g.reputation} /></span>
    </button>
  );
}

function Actions() {
  const { unread } = useBadges();
  return (
    <>
      <button className="btn btn-ghost btn-icon bell" onClick={() => store.navigate('inbox')} aria-label={`Inbox${unread ? `, ${unread} unread` : ''}`}>
        <Bell />
        {unread > 0 && <span className="pip">{count(unread)}</span>}
      </button>
      <button className="btn btn-ghost btn-icon" onClick={() => store.openModal({ kind: 'menu' })} aria-label="Menu"><Menu /></button>
    </>
  );
}

/** Top bar for the wide and medium tiers. */
function TopBar({ tier }: { tier: Tier }) {
  const touch = useTouch();
  // Desktop keeps its stats; touch and the rail tier get the tappable cash block.
  const desktop = tier === 'wide' && !touch;
  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark size={30} />
        <span className="wordmark">CONTRAIL</span>
      </div>
      <div className="tb-sep tb-brand-sep" />
      {tier === 'wide' ? <AirlinePill /> : <LevelBadge />}
      <div className="tb-sep tb-clock-sep" />
      <Clock weekday={tier === 'wide'} />
      <SpeedControl />
      <div className="tb-right">
        {desktop ? <Stats /> : <CashBlock />}
        {tier === 'wide' && <Reputation />}
        <Actions />
      </div>
    </header>
  );
}

/** Wide: sidebar with labels and the current goal. Medium: 76px rail, icon over a short label. */
function Sidebar({ rail }: { rail: boolean }) {
  const s = useStore();
  const g = s.game!;
  const badges = useNavBadges();
  const goal = activeGoals(g, 1)[0];
  return (
    <nav className={`sidebar ${rail ? 'rail' : ''}`} aria-label="Sections">
      {NAV.map((n) => {
        const b = badges[n.tab];
        const active = s.nav.tab === n.tab;
        return (
          <button
            key={n.tab}
            className={`nav-item ${active ? 'active' : ''}`}
            onClick={() => s.navigate(n.tab)}
            data-nav={n.tab}
            aria-current={active ? 'page' : undefined}
            aria-label={b ? `${n.label}, ${b.label}` : n.label}
          >
            <span className="ico">
              {n.icon}
              {rail && b && <span className="nb">{b.text}</span>}
            </span>
            <span className="lbl">{rail ? n.short : n.label}</span>
            {!rail && b && <span className="nbadge">{b.text}</span>}
          </button>
        );
      })}
      {goal && !rail && (
        <div className="nav-foot">
          <button className="side-goal" onClick={() => s.navigate('goals')}>
            <span className="upper dim">Current goal</span>
            <span className="t">{goal.title}</span>
            <Bar value={goal.progress(g)} />
          </button>
        </div>
      )}
    </nav>
  );
}

/** News ticker (wide and medium); tapping it opens the inbox. */
function Ticker() {
  const g = useGame();
  const items = g.messages.filter((m) => m.category === 'news' || m.category === 'market').slice(0, 10);
  const open = () => store.navigate('inbox');
  const props = {
    role: 'button',
    tabIndex: 0,
    'aria-label': 'News: open the inbox',
    onClick: open,
    onKeyDown: (e: ReactKeyboardEvent) => { if (e.key === 'Enter') open(); },
  };
  if (!items.length) return <footer className="ticker" {...props}><span className="tag"><BarChart3 /> NEWS</span></footer>;
  const list = [...items, ...items];
  return (
    <footer className="ticker" {...props}>
      <span className="tag"><BarChart3 /> NEWS</span>
      <div className="track" style={{ animationDuration: `${items.length * 9}s` }}>
        {list.map((m, i) => (
          <span className="item" key={`${m.id}-${i}`}>
            <span className="d">{formatDate(m.day)}</span>
            <span className={m.kind === 'bad' ? 'bad' : m.kind === 'good' ? 'good' : ''}>{m.title}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}

// ---------- compact tier (Split View, Slide Over, phones) ----------

function CompactBar({ short }: { short: boolean }) {
  if (short) {
    return (
      <header className="cp-top">
        <div className="cp-row">
          <LevelBadge />
          <Clock weekday={false} />
          <SpeedControl />
          <div className="cp-spacer" />
          <CashBlock />
          <Actions />
        </div>
      </header>
    );
  }
  return (
    <header className="cp-top">
      <div className="cp-row">
        <LevelBadge />
        <CashBlock />
        <div className="cp-spacer" />
        <Actions />
      </div>
      <div className="cp-row">
        <Clock weekday={false} />
        <div className="cp-spacer" />
        <SpeedControl />
      </div>
    </header>
  );
}

/** Bottom tab bar, or a side rail when the window is short (a phone on its side). */
function CompactNav({ short, more, onMore }: { short: boolean; more: boolean; onMore: () => void }) {
  const s = useStore();
  const badges = useNavBadges();
  const tab = s.nav.tab;
  const item = (key: Tab | 'more', label: string, icon: ReactNode, active: boolean, onClick: () => void, badge?: string) => (
    <button key={key} className={`cp-tab ${active ? 'active' : ''}`} onClick={onClick} data-nav={key} aria-current={active ? 'page' : undefined} aria-label={label}>
      <span className="ico">
        {icon}
        {badge && <span className="nb">{badge}</span>}
      </span>
      <span className="lbl">{label}</span>
    </button>
  );
  return (
    <nav className={short ? 'cp-rail' : 'cp-tabbar'} aria-label="Sections">
      {NAV.filter((n) => PRIMARY.includes(n.tab)).map((n) => item(n.tab, n.short, n.icon, !more && tab === n.tab, () => s.navigate(n.tab), badges[n.tab]?.text))}
      {item('more', 'More', <LayoutGrid />, more || !PRIMARY.includes(tab), onMore, badges.inbox?.text)}
    </nav>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const g = s.game!;
  const badges = useNavBadges();
  const goal = activeGoals(g, 1)[0];
  const go = (tab: Tab) => { onClose(); s.navigate(tab); };
  return (
    <Modal title="More" icon={<LayoutGrid className="accent" />} onClose={onClose} className="more-sheet">
      {goal && (
        <button className="more-goal" onClick={() => go('goals')}>
          <span className="col grow" style={{ gap: 6 }}>
            <span className="upper dim">Current goal</span>
            <span className="t">{goal.title}</span>
            <Bar value={goal.progress(g)} />
          </span>
          <ChevronRight />
        </button>
      )}
      <div className="more-grid">
        {NAV.filter((n) => !PRIMARY.includes(n.tab)).map((n) => (
          <button key={n.tab} className={`more-tile ${s.nav.tab === n.tab ? 'active' : ''}`} onClick={() => go(n.tab)} data-nav={n.tab}>
            <span className="ico">
              {n.icon}
              {badges[n.tab] && <span className="nb">{badges[n.tab]!.text}</span>}
            </span>
            <span className="lbl">{n.short}</span>
          </button>
        ))}
      </div>
      <div className="more-shortcuts">
        <button className="btn" onClick={() => { onClose(); s.openModal({ kind: 'saves', mode: 'save' }); }}><Save /> Save</button>
        <button className="btn" onClick={() => { onClose(); s.openModal({ kind: 'settings' }); }}><SettingsIcon /> Settings</button>
        <button className="btn" onClick={() => { onClose(); s.openModal({ kind: 'menu' }); }}><Menu /> Menu</button>
      </div>
    </Modal>
  );
}

export function Shell() {
  const s = useStore();
  const tier = useTier();
  const short = useMedia(COMPACT_SHORT);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        store.togglePause();
      } else if (['1', '2', '3', '4'].includes(e.key) && !store.modal) {
        store.setSpeed(Number(e.key) as GameSpeed);
      } else if (e.key === 'Escape' && !store.modal) {
        store.openModal({ kind: 'menu' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The More sheet is navigation, not a dialog: drop it when a real dialog opens or the layout leaves the compact tier.
  useEffect(() => {
    if (more && (s.modal || tier !== 'compact')) setMore(false);
  }, [more, s.modal, tier]);

  const tab = s.nav.tab;
  const content = (
    <main className={`main ${tab === 'map' ? 'no-scroll' : ''}`}>
      {tab === 'hq' && <Dashboard />}
      {tab === 'map' && <MapScreen />}
      {tab === 'routes' && <Routes />}
      {tab === 'fleet' && <Fleet />}
      {tab === 'market' && <Market />}
      {tab === 'finance' && <Finance />}
      {tab === 'intel' && <Intel />}
      {tab === 'expansion' && <Expansion />}
      {tab === 'brand' && <Brand />}
      {tab === 'goals' && <Goals />}
      {tab === 'inbox' && <InboxScreen />}
    </main>
  );

  if (tier === 'compact') {
    return (
      <div className={`shell compact ${short ? 'short' : ''}`}>
        <CompactBar short={short} />
        {content}
        <CompactNav short={short} more={more} onMore={() => setMore((m) => !m)} />
        {more && <MoreSheet onClose={() => setMore(false)} />}
        <GameModals />
        <GlobalModals />
      </div>
    );
  }
  return (
    <div className={`shell ${tier}`}>
      <TopBar tier={tier} />
      <Sidebar rail={tier === 'medium'} />
      {content}
      <Ticker />
      <GameModals />
      <GlobalModals />
    </div>
  );
}
