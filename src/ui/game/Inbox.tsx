import { CheckCheck, Inbox as InboxIcon } from 'lucide-react';
import { useState } from 'react';
import * as A from '../../engine/actions';
import type { MsgCategory } from '../../engine/types';
import { formatDate } from '../../engine/util';
import { Empty } from '../components/ui';
import { store, useGame } from '../store';

const CATS: { id: MsgCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'news', label: 'News' }, { id: 'market', label: 'Market' }, { id: 'ops', label: 'Operations' },
  { id: 'fleet', label: 'Fleet' }, { id: 'finance', label: 'Finance' }, { id: 'goal', label: 'Goals' },
];

export function InboxScreen() {
  const g = useGame();
  const [cat, setCat] = useState<MsgCategory | 'all'>('all');
  const list = g.messages.filter((m) => cat === 'all' || m.category === cat);
  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <h1>Inbox</h1>
          <div className="subtitle">{g.messages.filter((m) => !m.read).length} unread</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => store.update((gg) => A.markAllRead(gg))}><CheckCheck /> Mark all read</button>
        </div>
      </div>
      {g.decisions.length > 0 && (
        <div className="note warn mb-16">You have {g.decisions.length} decision{g.decisions.length > 1 ? 's' : ''} waiting — time is paused until you respond.</div>
      )}
      <div className="row wrap gap-8 mb-16">
        {CATS.map((c) => (
          <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>
            {c.label} <span className="dim">{g.messages.filter((m) => (c.id === 'all' || m.category === c.id) && !m.read).length || ''}</span>
          </button>
        ))}
      </div>
      <section className="card">
        {list.length === 0 ? <Empty icon={<InboxIcon className="big-ico" />} title="Nothing here" /> : (
          <div className="inbox">
            {list.map((m) => (
              <button key={m.id} className={`msg ${m.read ? 'read' : ''}`} onClick={() => store.update(() => { m.read = true; })}>
                <span className={`msg-dot ${m.kind}`} />
                <div className="grow">
                  <div className="row between"><b>{m.title}</b><span className="tiny dim">{formatDate(m.day)}</span></div>
                  {m.body && <div className="small muted">{m.body}</div>}
                </div>
                <span className="badge outline tiny">{m.category}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
