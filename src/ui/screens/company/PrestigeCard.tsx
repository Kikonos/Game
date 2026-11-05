// v0.16 Company › Overview › Prestige (UPDATE-0.16.md §B): our level on the client ladder, what it brings, the next
// level's progress bars and what is still missing, in plain lines (contracts/prestige.ts prestigeView).

import { Crown } from 'lucide-react';
import { useMemo } from 'react';
import { PLAYER_STARS, PRESTIGE_LEVELS, PRESTIGE_NAME, prestigeView, starsLabel } from '../../../engine/contracts/prestige';
import { ClientStars } from '../../components/ClientStars';
import { DAY } from '../../../engine/core/time';
import type { GameState, Prestige } from '../../../engine/core/types';
import { Bar, Card } from '../../components/ui';

/** Short names for the four rungs (the strip is narrow on a phone). */
const RUNG: Record<Prestige, string> = { 1: 'Brochure work', 2: 'Charter market', 3: 'National carriers', 4: 'Majors & governments' };

export function PrestigeCard({ g }: { g: GameState }) {
  const day = Math.floor(g.now / DAY);
  const p = g.company.prestige;
  // The view moves daily, on a level-up and as visibility is earned (contracts completing).
  const v = useMemo(() => prestigeView(g), [g, day, p?.level, p?.visibility, g.company.approvals.length, g.company.pendingApprovals.length, g.stats.contractsDone]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title="Prestige" icon={<Crown className="ico" />} sub={<><ClientStars n={PLAYER_STARS[v.level]} size={12} /> {v.name}</>} className="pr-card">
      {/* v0.16.1 each rung with the stars it reaches (the engine's four levels behind). */}
      <div className="v8-tiers pr-tiers" role="img" aria-label={`Your rating: ${starsLabel(PLAYER_STARS[v.level])}, ${v.name}`}>
        {PRESTIGE_LEVELS.map((l) => (
          <span key={l} className={`v8-tier ${l === v.level ? 'on' : l < v.level ? 'past' : ''}`}><ClientStars n={PLAYER_STARS[l]} size={9} label="" />{RUNG[l]}</span>
        ))}
      </div>
      <div className="small muted mt-8">{v.who}.</div>
      <ul className="v8-lines mt-8">{v.brings.map((e) => <li key={e}>{e}</li>)}</ul>
      {v.iosaNote && <div className="small warn mt-8">{v.iosaNote}</div>}
      {v.next ? (
        <div className="col gap-8 mt-8">
          <div className="upper dim row gap-6">Next: <ClientStars n={PLAYER_STARS[v.next.level]} size={10} /> {PRESTIGE_NAME[v.next.level]}</div>
          {v.next.need.map((n) => (
            <div key={n.label} className="v8-prog">
              <div className="row between small">
                <span className="muted">{n.label}</span>
                <span className={`num ${n.ok ? 'good' : ''}`}>{n.label === 'IOSA registration' ? (n.ok ? 'held' : 'not held') : `${n.have.toLocaleString('en-US')} / ${n.need.toLocaleString('en-US')}`}</span>
              </div>
              <Bar value={n.need ? Math.min(1, n.have / n.need) : 1} size="thin" tone={n.ok ? 'good' : undefined} />
            </div>
          ))}
          {v.next.missing.length > 0 && <div className="small"><span className="muted">Still needed:</span> {v.next.missing.join(' · ')}</div>}
        </div>
      ) : (
        <div className="small mt-8">The top of the ladder: five stars, every client in the market calls.</div>
      )}
      <div className="tiny dim mt-8">Visibility comes from block hours flown, weighted by whom you fly for, and from contracts done; it never fades. A stretch offer is marked on its card.</div>
    </Card>
  );
}
