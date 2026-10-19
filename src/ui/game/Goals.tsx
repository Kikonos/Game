import { Check, Lock, Medal, Trophy } from 'lucide-react';
import { AIRCRAFT } from '../../data/aircraft';
import { GOALS, LEVELS, levelProgress, maxHubs } from '../../engine/progression';
import { Bar, Card } from '../components/ui';
import { int, money, pct } from '../format';
import { useGame } from '../store';
import { Rivals } from './Intel';

function unlocksAt(level: number): string[] {
  const out: string[] = [];
  if (maxHubs(level) > maxHubs(level - 1)) out.push(`${maxHubs(level)} hubs`);
  const types = AIRCRAFT.filter((t) => t.minLevel === level).map((t) => t.name.replace('Boeing ', 'B').replace('Airbus ', ''));
  if (types.length) out.push(types.join(', '));
  if (level === 2) out.push('More regions');
  if (level === 3) out.push('Loyalty programme · Revenue management');
  if (level === 5) out.push('Long-haul certificate · Other continents');
  if (level === 6) out.push('Overseas hubs');
  return out;
}

export function Goals() {
  const g = useGame();
  const lp = levelProgress(g);
  const done = GOALS.filter((x) => g.completedGoals.includes(x.id)).length;
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Goals & Ranks</h1>
          <div className="subtitle">{done} of {GOALS.length} goals complete · {int(g.xp)} XP</div>
        </div>
      </div>
      <div className="grid-3 goals-layout">
        <Card title="Airline level" icon={<Medal className="ico" />} className="level-card">
          <div className="row gap-12">
            <div className="level-badge">{g.level}</div>
            <div className="grow">
              <b className="big">{lp.cur.title}</b>
              <Bar value={lp.pct} />
              <div className="tiny dim mt-8">{lp.next ? `${int(lp.next.xp - g.xp)} XP to ${lp.next.title}` : 'Maximum level reached!'}</div>
            </div>
          </div>
          <div className="tiny dim mt-12 level-note">Earn XP from every passenger, monthly profits and completed goals.</div>
          <div className="ladder mt-12">
            {LEVELS.map((l) => (
              <div key={l.level} className={`ladder-row ${g.level >= l.level ? 'reached' : ''} ${g.level === l.level ? 'current' : ''}`}>
                <span className="lv">{l.level}</span>
                <div className="grow">
                  <b className="small">{l.title}</b>
                  <div className="tiny dim">{unlocksAt(l.level).join(' · ') || '—'}</div>
                </div>
                <span className="tiny dim num">{l.xp ? int(l.xp) : ''}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Goals" icon={<Trophy className="ico" />} className="span-2 goals-card">
          <div className="goal-grid">
            {GOALS.map((goal) => {
              const complete = g.completedGoals.includes(goal.id);
              const prog = complete ? 1 : goal.progress(g);
              return (
                <div key={goal.id} className={`goal-card ${complete ? 'complete' : ''}`}>
                  <div className="row between">
                    <b>{goal.title}</b>
                    {complete ? <span className="badge good"><Check size={12} /> Done</span> : prog > 0 ? <span className="tiny dim">{goal.status ? goal.status(g) : pct(prog)}</span> : <Lock size={13} className="dim" />}
                  </div>
                  <div className="small muted">{goal.desc}</div>
                  {!complete && <Bar value={prog} size="thin" />}
                  <div className="tiny dim">Reward: {money(goal.reward.cash, 0)} · {int(goal.reward.xp)} XP</div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="mt-16"><Rivals /></div>
    </div>
  );
}
