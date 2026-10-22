// Small shared pieces for the B5 screens and modals.

import {
  Briefcase, CalendarClock, Flag as FlagIcon, Globe2, HeartHandshake, Medal, Music, Plane, PlaneLanding, Shield, Ship, Snowflake, Stethoscope, Trophy, Users, Wrench,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { Archetype } from '../../engine/core/types';
import { store } from '../store';
import type { Chip } from './screenLogic';

/** Dev-only render counter per screen (store.dev.renders), to check the calm-UI budget. */
export function useRenderCount(name: string): void {
  // Counted per commit (an effect), so StrictMode's double render calls don't inflate it.
  useEffect(() => {
    if (import.meta.env.DEV) store.dev.renders[name] = (store.dev.renders[name] ?? 0) + 1;
  });
}

const ARCH_ICON: Partial<Record<Archetype, ReactNode>> = {
  seasonBase: <CalendarClock />, aogCover: <Wrench />, adhoc: <Plane />, sports: <Trophy />, repatriation: <PlaneLanding />,
  tourSeries: <Globe2 />, troopRotation: <Shield />, hajj: <Users />, unRotation: <Shield />, vip: <Medal />, humanitarian: <HeartHandshake />,
  evacuation: <FlagIcon />, deportation: <Ship />, capacityLease: <Briefcase />, subcharterIn: <Plane />, dryLeaseOut: <Briefcase />,
  medical: <Stethoscope />, musicTour: <Music />, antarctic: <Snowflake />,
};

export function ArchIcon({ a }: { a: Archetype }) {
  return <span className={`arch-ico arch-${a}`} aria-hidden>{ARCH_ICON[a] ?? <Music />}</span>;
}

export function Dot({ tone }: { tone?: 'good' | 'warn' | 'bad' | 'info' | 'off' | null }) {
  return <span className={`sc-dot ${tone ?? ''}`} aria-hidden />;
}

export function Chips({ chips }: { chips: Chip[] }) {
  if (!chips.length) return null;
  return (
    <div className="sc-chips">
      {chips.map((c, i) => (
        <span key={i} className={`chip sc-chip ${c.tone ?? ''}`} data-tip={c.tip}>{c.label}</span>
      ))}
    </div>
  );
}

/** Labelled limit bar: value / limit with a tone. */
export function LimitBar({ label, value, limit, unit = 'h', tone }: { label: string; value: number; limit: number; unit?: string; tone: 'good' | 'warn' | 'bad' }) {
  const r = limit > 0 ? value / limit : 0;
  return (
    <div className="sc-limit">
      <div className="row between small">
        <span className="muted">{label}</span>
        <span className="num">{Math.round(value)}<span className="dim"> / {limit}{unit}</span></span>
      </div>
      <div className={`bar thin ${tone}`}><span style={{ width: `${Math.min(100, r * 100)}%` }} /></div>
    </div>
  );
}

export function ScreenHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="screen-head sc-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub && <div className="subtitle">{sub}</div>}
      </div>
      {children && <div className="sc-head-tools">{children}</div>}
    </div>
  );
}

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="sc-kv">
      {rows.map(([k, v], i) => (
        <div key={i}><span>{k}</span><b>{v}</b></div>
      ))}
    </div>
  );
}
