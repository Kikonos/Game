// v0.15 Scenarios: a locked action shows why ("Not in this scenario: the Hajj airlift is your job"), never hidden:
// the reason under a disabled button, or a calm notice on a locked screen or tab. The reasons come from the engine
// (scenario/rules.ts lockOf), the same check the action itself makes.

import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/** The lock and the reason, one line (null renders nothing). */
export function LockNote({ why, tone, className }: { why: string | null | undefined; tone?: 'warn'; className?: string }) {
  if (!why) return null;
  return <div className={`lock-note ${tone ?? ''} ${className ?? ''}`} role="note"><Lock aria-hidden /><span>{why}</span></div>;
}

/** A locked screen or tab: what it is and why it is closed in this scenario. */
export function LockedPanel({ title, why, children }: { title: string; why: string; children?: ReactNode }) {
  return (
    <div className="lock-panel" role="note">
      <Lock aria-hidden />
      <div className="grow">
        <b>{title}</b>
        <div className="small muted">{why}</div>
        {children}
      </div>
    </div>
  );
}

/** Props for a button the scenario locks: disabled, dimmed, the reason as its tooltip and label. */
export function lockedProps(why: string | null | undefined): { disabled?: boolean; 'data-tip'?: string; 'aria-description'?: string } {
  return why ? { disabled: true, 'data-tip': why, 'aria-description': why } : {};
}
