// Inbox (B5): open decisions pinned on top, then messages with category filters; tapping a message marks it
// read and follows its ref. DESIGN.md §6.3.

import { CheckCheck, ChevronRight, Hourglass, Inbox as InboxIcon } from 'lucide-react';
import { useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState, Message, MessageCat } from '../../engine/core/types';
import { Empty, Tabs } from '../components/ui';
import { store, useGame } from '../store';
import { Dot, ScreenHead, useRenderCount } from './common';
import { expiryLabel, filterMessages, MSG_CATS, refTarget } from './screenLogic';

const PAGE = 80;

function open(g: GameState, m: Message) {
  if (!m.read) store.update((gg) => {
    const x = gg.messages.find((y) => y.id === m.id);
    if (x) x.read = true;
  });
  const link = m.ref ? refTarget(g, m.ref) : null;
  if (!link) return;
  if (link.offerId) {
    store.navigate('contracts', { view: 'market' });
    store.openModal({ kind: 'offer', offerId: link.offerId });
  } else store.navigate(link.tab, { sel: link.sel, view: link.view });
}

function Decisions({ g }: { g: GameState }) {
  if (!g.decisions.length) return null;
  return (
    <div className="col gap-8 mb-16">
      {g.decisions.map((d) => {
        const def = d.options.find((o) => o.id === d.defaultOption);
        return (
          <button key={d.id} className="card sc-decision-card" onClick={() => store.openModal({ kind: 'decision', decisionId: d.id })}>
            <Hourglass className="sc-ico warn" />
            <span className="grow col gap-4" style={{ minWidth: 0 }}>
              <b className="ellipsis">{d.title}</b>
              <span className="small muted sc-clamp">{d.body}</span>
              <span className="tiny dim">{expiryLabel(g.now, d.expires)}{def ? ` · then: ${def.label}` : ''}</span>
            </span>
            <span className="btn btn-primary">Decide</span>
          </button>
        );
      })}
    </div>
  );
}

export function InboxScreen() {
  useRenderCount('inbox');
  const g = useGame();
  const [cat, setCat] = useState<MessageCat | 'all'>('all');
  const [more, setMore] = useState(false);
  const list = filterMessages(g.messages, cat);
  const shown = more ? list : list.slice(0, PAGE);
  const unread = g.messages.filter((m) => !m.read).length;
  const counts = new Map<string, number>();
  for (const m of g.messages) if (!m.read) counts.set(m.cat, (counts.get(m.cat) ?? 0) + 1);
  const markAll = () => store.update((gg) => {
    for (const m of gg.messages) m.read = true;
  });
  return (
    <div className="screen sc-inbox">
      <ScreenHead title="Inbox" sub={`${g.decisions.length ? `${g.decisions.length} decision${g.decisions.length > 1 ? 's' : ''} waiting · ` : ''}${unread} unread`}>
        <button className="btn" onClick={markAll} disabled={!unread}><CheckCheck /> Mark all read</button>
      </ScreenHead>
      <Decisions g={g} />
      <div className="sc-seg-wrap mb-8">
        <Tabs<MessageCat | 'all'> value={cat} onChange={(v) => { setCat(v); setMore(false); }} tabs={MSG_CATS.filter((c) => c.id === 'all' || g.messages.some((m) => m.cat === c.id)).map((c) => ({ id: c.id, label: c.label, count: c.id === 'all' ? unread || undefined : counts.get(c.id) }))} />
      </div>
      {!list.length ? (
        <Empty icon={<InboxIcon />} title="No messages">Operations, crew, commercial and finance news land here.</Empty>
      ) : (
        <div className="card sc-list">
          {shown.map((m) => (
            <button key={m.id} className={`sc-msg ${m.read ? 'read' : ''}`} onClick={() => open(g, m)}>
              <Dot tone={m.tone} />
              <span className="grow col gap-4" style={{ minWidth: 0 }}>
                <span className="row gap-8"><b className="ellipsis">{m.title}</b><span className="tiny dim nowrap">{fmtDateTime(m.t)}</span></span>
                <span className="small muted sc-clamp">{m.body}</span>
              </span>
              {m.ref && <ChevronRight className="sc-ico-s dim" />}
            </button>
          ))}
          {list.length > shown.length && <button className="btn btn-ghost sc-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
        </div>
      )}
    </div>
  );
}
