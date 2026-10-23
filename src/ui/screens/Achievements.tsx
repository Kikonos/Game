// v0.9 Company › Achievements (UPDATE-0.9.md §14.1): six groups of tiles (icon, title, one line, then the date earned or
// a thin progress bar). Unearned tiles are dimmed but readable; none are secret. Static.

import { ACHIEVEMENT_GROUPS } from '../../data/achievements';
import { HEAD_DEFS } from '../../data/heads';
import { fmtDate } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { achievementsView } from '../../engine/ops';
import { NamedIcon } from '../components/NamedIcon';
import { realProgress } from './Team';

export function AchievementsView({ g }: { g: GameState }) {
  const list = achievementsView(g);
  const got = list.filter((a) => a.at !== null).length;
  return (
    <div className="col gap-16 v9-ach">
      <div className="small muted"><b className="v9-ach-count">{got} of {list.length}</b> earned · some bring a department head (Company › Team)</div>
      {ACHIEVEMENT_GROUPS.map((gr) => {
        const items = list.filter((a) => a.group === gr.id);
        if (!items.length) return null;
        return (
          <section key={gr.id} className="col gap-8">
            <div className="upper dim">{gr.label}</div>
            <div className="v9-ach-grid">
              {items.map((a) => (
                <div key={a.id} className={`card v9-tile ${a.at !== null ? 'got' : ''}`}>
                  <span className="v9-tile-ico"><NamedIcon name={a.icon} /></span>
                  <div className="col grow" style={{ minWidth: 0, gap: 3 }}>
                    <b className="small">{a.title}</b>
                    <span className="tiny muted">{a.text}</span>
                    {a.at !== null ? (
                      <span className="tiny good">Earned {fmtDate(a.at)}{a.head ? ` · ${HEAD_DEFS[a.head].title}` : ''}</span>
                    ) : realProgress(a.progress) && a.progress ? (
                      <span className="col" style={{ gap: 3 }}>
                        <span className="tiny dim">{a.progress.label}</span>
                        <span className="v8-thin"><span className="new" style={{ width: `${Math.min(100, (a.progress.have / Math.max(1, a.progress.need)) * 100)}%` }} /></span>
                      </span>
                    ) : a.head ? <span className="tiny dim">Brings: {HEAD_DEFS[a.head].title}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
