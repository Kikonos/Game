import {
  Bell, BarChart3, Building2, Globe2, Inbox as InboxIcon, LayoutDashboard, Megaphone, Menu, Pause, Plane, Play, Radar,
  Route as RouteIcon, ShoppingCart, Trophy, Wallet, Zap,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { monthProfit } from '../../engine/economy';
import { activeGoals, levelProgress } from '../../engine/progression';
import { formatDate } from '../../engine/util';
import { Bar, Stars } from '../components/ui';
import { LogoMark, TailBadge } from '../components/Logo';
import { money } from '../format';
import { type GameSpeed, SPEED_LABEL, type Tab, store, useClock, useGame, useStore } from '../store';
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

const NAV: { tab: Tab; label: string; icon: ReactNode }[] = [
  { tab: 'hq', label: 'Headquarters', icon: <LayoutDashboard /> },
  { tab: 'map', label: 'Network Map', icon: <Globe2 /> },
  { tab: 'routes', label: 'Routes', icon: <RouteIcon /> },
  { tab: 'fleet', label: 'Fleet', icon: <Plane /> },
  { tab: 'market', label: 'Aircraft Market', icon: <ShoppingCart /> },
  { tab: 'finance', label: 'Finance', icon: <Wallet /> },
  { tab: 'intel', label: 'Market Intel', icon: <Radar /> },
  { tab: 'expansion', label: 'Expansion', icon: <Building2 /> },
  { tab: 'brand', label: 'Brand & Service', icon: <Megaphone /> },
  { tab: 'goals', label: 'Goals & Ranks', icon: <Trophy /> },
  { tab: 'inbox', label: 'Inbox', icon: <InboxIcon /> },
];

function Clock() {
  const frac = useClock();
  const g = store.game!;
  const mins = Math.floor(frac * 24 * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(Math.floor((mins % 60) / 5) * 5).padStart(2, '0');
  return (
    <div className="clock">
      <span className="date">{formatDate(g.day, true)}</span>
      <span className="time">{hh}:{mm} UTC</span>
    </div>
  );
}

function SpeedControl() {
  const s = useStore();
  const blocked = s.blocked;
  return (
    <div className="speed" title={blocked ? 'Time is paused — a decision needs your attention' : 'Space: pause · 1–4: speed'}>
      <button className={`paused ${s.paused || blocked ? 'active' : ''}`} onClick={() => s.togglePause()} aria-label="Pause">
        {s.paused ? <Play /> : <Pause />}
      </button>
      {([1, 2, 3, 4] as GameSpeed[]).map((sp) => (
        <button key={sp} className={!s.paused && !blocked && s.speed === sp ? 'active' : ''} onClick={() => s.setSpeed(sp)} aria-label={`Speed ${SPEED_LABEL[sp]}`}>
          {sp === 4 ? <Zap /> : <span className="spd">{'›'.repeat(sp)}</span>}
        </button>
      ))}
    </div>
  );
}

function TopBar() {
  const s = useStore();
  const g = s.game!;
  const lp = levelProgress(g);
  const last = g.finance.history[g.finance.history.length - 1];
  const lastProfit = last ? monthProfit(last) : null;
  const unread = g.messages.filter((m) => !m.read).length;
  return (
    <header className="topbar">
      <div className="brand tb-hide-md">
        <LogoMark size={30} />
        <span className="wordmark">CONTRAIL</span>
      </div>
      <div className="tb-sep tb-hide-md" />
      <button className="airline-pill" onClick={() => s.navigate('goals')} title={`${Math.floor(g.xp).toLocaleString()} XP`}>
        <TailBadge primary={g.airline.livery.primary} secondary={g.airline.livery.secondary} code={g.airline.code} size={30} />
        <div className="col gap-4" style={{ gap: 2, minWidth: 110 }}>
          <span className="name ellipsis">{g.airline.name}</span>
          <span className="lvl">Lv {g.level} · {lp.cur.title}</span>
          <Bar value={lp.pct} size="thin" />
        </div>
      </button>
      <div className="tb-sep" />
      <Clock />
      <SpeedControl />
      <div className="tb-right">
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
        <div className="tb-stat tb-hide-md">
          <span className="l">Reputation</span>
          <span className="v"><Stars value={g.reputation} /></span>
        </div>
        <button className="btn btn-ghost btn-icon bell" onClick={() => s.navigate('inbox')} aria-label="Inbox">
          <Bell />
          {unread > 0 && <span className="pip">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="btn btn-ghost btn-icon" onClick={() => s.openModal({ kind: 'menu' })} aria-label="Menu"><Menu /></button>
      </div>
    </header>
  );
}

function Sidebar() {
  const s = useStore();
  const g = s.game!;
  const unread = g.messages.filter((m) => !m.read).length;
  const idle = g.fleet.filter((a) => a.status === 'active' && a.assignments.length === 0).length;
  const goal = activeGoals(g, 1)[0];
  return (
    <nav className="sidebar">
      {NAV.map((n) => (
        <button key={n.tab} className={`nav-item ${s.nav.tab === n.tab ? 'active' : ''}`} onClick={() => s.navigate(n.tab)} title={n.label}>
          {n.icon}
          <span>{n.label}</span>
          {n.tab === 'inbox' && unread > 0 && <span className="nbadge">{unread > 99 ? '99+' : unread}</span>}
          {n.tab === 'fleet' && idle > 0 && <span className="nbadge" title="Idle aircraft">{idle}</span>}
          {n.tab === 'hq' && g.decisions.length > 0 && <span className="nbadge">!</span>}
        </button>
      ))}
      {goal && (
        <div className="nav-foot">
          <button className="side-goal" onClick={() => s.navigate('goals')} style={{ width: '100%', textAlign: 'left' }}>
            <div className="upper dim">Current goal</div>
            <div className="t">{goal.title}</div>
            <Bar value={goal.progress(g)} />
          </button>
        </div>
      )}
    </nav>
  );
}

function Ticker() {
  const g = useGame();
  const items = g.messages.filter((m) => m.category === 'news' || m.category === 'market').slice(0, 10);
  if (!items.length) return <footer className="ticker"><span className="tag"><BarChart3 /> NEWS</span></footer>;
  const list = [...items, ...items];
  return (
    <footer className="ticker">
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

export function Shell() {
  const s = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
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

  const tab = s.nav.tab;
  return (
    <div className="shell">
      <TopBar />
      <Sidebar />
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
      <Ticker />
      <GameModals />
      <GlobalModals />
    </div>
  );
}
