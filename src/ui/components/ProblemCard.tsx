// v0.7.1 the four-line card every problem is told with (UPDATE-0.7.1.md §1, §5): WHAT, WHY (one sentence), DOES IT
// HURT? (money, passengers, delay) and WHAT YOU CAN DO (the action buttons), the visual aid of the main cause between
// them (reach bar, gauges, mini-map, timeline) and the jargon behind a Details tap. Compact (Inbox): WHAT + badges.
// Glossary words are wrapped in <Term>. The MAP lane's MiniMap is loaded when its file exists (import.meta.glob).

import { ChevronDown, ChevronUp } from 'lucide-react';
import { lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import type { MiniMapSpec, ProblemAction, ProblemCard } from '../../engine/problems/types';
import { store } from '../store';
import { Gauge } from './Gauge';
import { actionTarget } from './problemLogic';
import { ReachBar } from './ReachBar';
import { Plain } from './Term';
import { Timeline } from './Timeline';

type MiniMapProps = { spec: MiniMapSpec; width?: number };
const MINI = import.meta.glob('../map/MiniMap.tsx') as Record<string, () => Promise<Record<string, unknown>>>;
const miniLoader = MINI['../map/MiniMap.tsx'];
const MiniMapLazy: ComponentType<MiniMapProps> | null = miniLoader
  ? lazy(() => miniLoader().then((m) => ({ default: (m.MiniMap ?? m.default) as ComponentType<MiniMapProps> })))
  : null;

/** The mini-map for a location cause, when the MAP lane's component is in the tree (else the itinerary as text). */
export function MiniMapSlot({ spec }: { spec: MiniMapSpec }) {
  if (MiniMapLazy) {
    return (
      <Suspense fallback={<div className="pc-mini-fallback small dim">Map…</div>}>
        <MiniMapLazy spec={spec} />
      </Suspense>
    );
  }
  const who = spec.crew.map((c) => `${c.name} at ${c.at}`).join(', ');
  return <div className="pc-mini-fallback small muted">{who}{spec.path.length ? ` → ${spec.path.map((p) => `${p.no ?? (p.jet ? 'jet' : 'flight')} ${p.from}–${p.to}`).join(', ')} → ${spec.to}` : ` · needed at ${spec.to}`}</div>;
}

/** Runs a card action: opens the modal it names or navigates there (closing the current dialog first). */
export function runAction(g: GameState, a: ProblemAction, opts: { keepModal?: boolean } = {}) {
  const t = actionTarget(g, a);
  if (!t) return store.toast('info', 'Nothing to open', 'That item has gone.');
  if ('modal' in t) return store.openModal(t.modal);
  if (!opts.keepModal) store.closeModal();
  store.navigate(t.nav.tab, { view: t.nav.view, sel: t.nav.sel });
}

export function HurtBadges({ badges, level }: { badges: string[]; level: 'none' | 'low' | 'high' }) {
  return (
    <span className="pc-badges">
      {badges.map((b) => <span key={b} className={`pc-badge ${level}`}>{b}</span>)}
    </span>
  );
}

/** The visual aid of the main cause (full cards): reach bar, gauges, mini-map, timeline. */
export function Visuals({ card, all }: { card: ProblemCard; all?: boolean }) {
  const v = card.visuals;
  const parts: ReactNode[] = [];
  if (v.reach) parts.push(<ReachBar key="reach" spec={v.reach} />);
  if (v.minimap) parts.push(<MiniMapSlot key="mini" spec={v.minimap} />);
  if (v.timeline) parts.push(<Timeline key="tl" spec={v.timeline} />);
  if (v.gauges?.length) parts.push(<div key="g" className="pc-gauges">{(all ? v.gauges : v.gauges.slice(0, 4)).map((s) => <Gauge key={`${s.id}-${s.crewId ?? ''}`} spec={s} />)}</div>);
  if (!parts.length) return null;
  return <div className="pc-visual">{parts}</div>;
}

export function ProblemCardView({ card, compact, g, hideActions, onAction, children }: {
  card: ProblemCard;
  /** Inbox row: WHAT + badges only. */
  compact?: boolean;
  g: GameState;
  hideActions?: boolean;
  /** Replaces the default action handling (e.g. the Crew Control panel handles its own). */
  onAction?: (a: ProblemAction) => void;
  /** Extra content under WHAT YOU CAN DO (e.g. the Crew Control button of a banner). */
  children?: ReactNode;
}) {
  const [details, setDetails] = useState(false);
  const act = (a: ProblemAction) => (onAction ? onAction(a) : runAction(g, a));
  if (compact) {
    return (
      <div className={`pc pc-compact ${card.severity}`}>
        <b className="pc-what-s">{card.what}</b>
        <HurtBadges badges={card.hurt.badges} level={card.hurt.level} />
      </div>
    );
  }
  return (
    <div className={`pc ${card.severity}`}>
      <div className="pc-row pc-what-row">
        <span className="pc-k">What</span>
        <span className="pc-what"><Plain text={card.what} terms={card.terms} /></span>
      </div>
      <div className="pc-row">
        <span className="pc-k">Why</span>
        <span className="pc-why"><Plain text={card.why} terms={card.terms} /></span>
      </div>
      <div className="pc-row">
        <span className="pc-k">Does it hurt?</span>
        <span className="pc-hurt">
          <span className={`pc-hurt-t ${card.hurt.level}`}>{card.hurt.text}</span>
          <HurtBadges badges={card.hurt.badges} level={card.hurt.level} />
          {card.by !== undefined && card.by > g.now && <span className="tiny dim pc-by">by {fmtDateTime(card.by)} UTC</span>}
        </span>
      </div>
      <Visuals card={card} />
      {(!hideActions && card.actions.length > 0) || children ? (
        <div className="pc-row pc-do-row">
          <span className="pc-k">What you can do</span>
          <span className="pc-do">
            {!hideActions && card.actions.map((a, i) => (
              <button key={a.id} className={`btn ${a.primary || i === 0 ? 'btn-primary' : ''}`} onClick={() => act(a)}>{a.label}</button>
            ))}
            {children}
          </span>
        </div>
      ) : null}
      {card.details.length > 0 && (
        <div className="pc-details">
          <button className="btn btn-ghost btn-sm pc-details-btn" onClick={() => setDetails(!details)} aria-expanded={details}>
            {details ? <ChevronUp /> : <ChevronDown />} Details
          </button>
          {details && <ul className="pc-details-list small muted">{card.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
