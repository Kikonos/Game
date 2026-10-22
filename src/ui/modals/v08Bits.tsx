// v0.8 small shared pieces: the world-event glyph, the client crew seat strip, the mixed-crew grey rows.

import { Ban, Cloud, Cog, Flame, Hand, PlaneLanding, Shield, TrendingDown, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Role } from '../../engine/core/types';

const ICONS: Record<string, ReactNode> = {
  shield: <Shield />, hand: <Hand />, cloud: <Cloud />, wave: <Waves />, tailDown: <PlaneLanding />, noEntry: <Ban />, engine: <Cog />, chartDown: <TrendingDown />,
};

/** The glyph of a world event kind (EVENT_ICON names). */
export function EventIcon({ icon }: { icon: string }) {
  return <span className={`v8-ev-ico ${icon}`} aria-hidden>{ICONS[icon] ?? <Flame />}</span>;
}

/** One square per cabin seat: ours in the accent colour with role labels, theirs grey with the client's name. */
export function SeatStrip({ ours, theirs, client }: { ours: Role[]; theirs: Role[]; client: string }) {
  return (
    <div className="col gap-4">
      <div className="v8-seats" role="img" aria-label={`${ours.length} of our cabin crew, ${theirs.length} of ${client}'s`}>
        {ours.map((r, i) => <span key={`o${i}`} className="v8-seat ours">{r}</span>)}
        {theirs.map((r, i) => <span key={`t${i}`} className="v8-seat theirs">{r}</span>)}
      </div>
      <div className="row gap-12 small dim"><span className="row gap-4"><span className="v8-seat-key ours" />ours ({ours.length})</span><span className="row gap-4"><span className="v8-seat-key theirs" />{client} ({theirs.length})</span></div>
    </div>
  );
}

/** 'Air Sénégal crew · CC ×6': grey, non-interactive rows after our seats (duty modal, flight sheet). */
export function ClientCrewRow({ label, roles }: { label: string; roles: Role[] }) {
  const counts = new Map<Role, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  return (
    <div className="v8-client-crew small" aria-disabled>
      <span className="v8-cc-dot" aria-hidden />
      <span className="grow ellipsis">{label}</span>
      <span className="dim nowrap">{[...counts].map(([r, n]) => `${r} ×${n}`).join(' · ')}</span>
    </div>
  );
}
