// Inbox (B5): open decisions pinned on top, then messages with category filters; tapping a message marks it
// read and follows its ref. DESIGN.md §6.3. v0.7.1: a 'Problems only' filter, a severity badge on every warning
// (money / passengers / lateness) and an Explain button that unfolds the four-line card in place.

import { CheckCheck, ChevronRight, HelpCircle, Hourglass, Inbox as InboxIcon, X } from 'lucide-react';
import { useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState, Message } from '../../engine/core/types';
import { hurtBadges, messageBadges, problemAt, problemFor } from '../../engine/problems';
import { HurtBadges, ProblemCardView } from '../components/ProblemCard';
import { Empty, Tabs } from '../components/ui';
import { store, useGame } from '../store';
import { Dot, ScreenHead, useRenderCount } from './common';
import { expiryLabel, filterMessages, isProblemMessage, MSG_CATS, refTarget, type MsgFilter } from './screenLogic';

const PAGE = 80;

function open(g: GameState, m: Message) {
  if (!m.read) store.update((gg) => {
    const x = gg.messages.find((y) => y.id === m.id);
    if (x) x.read = true;
  });
  // v0.7: a market alert opens Fleet → Market at its card, unless the offer has gone.
  if (m.ref?.kind === 'market' && !g.market.aircraft.some((o) => o.id === m.ref!.id && o.expires > g.now)) {
    store.toast('info', 'This offer has gone', 'The seller placed the aircraft elsewhere. New offers come every few weeks.');
    return;
  }
  // v0.7.1: a crew shortage still open goes straight to Crew Control.
  if ((m.problem?.kind === 'crewShort' || m.problem?.kind === 'crewIllegal' || m.topic === 'crewRed') && m.ref?.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled') {
    return store.openModal({ kind: 'crewControl', flightId: m.ref.id });
  }
  if (m.ref?.kind === 'cash' || m.ref?.kind === 'statement') return store.navigate('finance');
  if (m.ref?.kind === 'decision') {
    if (g.decisions.some((d) => d.id === m.ref!.id)) store.openModal({ kind: 'decision', decisionId: m.ref.id });
    return;
  }
  const link = m.ref ? refTarget(g, m.ref) : null;
  if (!link) return;
  if (link.offerId) {
    store.navigate('contracts', { view: 'market' });
    store.openModal({ kind: 'offer', offerId: link.offerId });
  } else store.navigate(link.tab, { sel: link.sel, view: link.view });
  // Crew problems on a flight still to fly: its sheet carries 'Adjust crew'.
  if (m.cat === 'crew' && m.ref?.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled') store.openModal({ kind: 'sheet', refs: [m.ref] });
}

function Decisions({ g }: { g: GameState }) {
  if (!g.decisions.length) return null;
  return (
    <div className="col gap-8 mb-16">
      {g.decisions.map((d) => {
        const def = d.options.find((o) => o.id === d.defaultOption);
        // v0.7.1: the severity badge from the decision's card (its flight, aircraft or the decision itself).
        const card = (d.ref ? problemAt(g, d.ref) : null) ?? problemAt(g, { kind: 'decision', id: d.id });
        return (
          <button key={d.id} className="card sc-decision-card" onClick={() => store.openModal({ kind: 'decision', decisionId: d.id })}>
            <Hourglass className="sc-ico warn" />
            <span className="grow col gap-4" style={{ minWidth: 0 }}>
              <span className="row gap-8 wrap"><b className="ellipsis">{d.title}</b>{card && <HurtBadges badges={card.hurt.badges} level={card.hurt.level} />}</span>
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

/** The unfolded card under a message: the live problem, or 'dealt with' with the words from when it was posted. */
function Explain({ g, m }: { g: GameState; m: Message }) {
  const card = (m.problem ? problemFor(g, m.problem) : null) ?? (m.ref && !m.problem ? problemAt(g, m.ref) : null);
  if (card) return <ProblemCardView card={card} g={g} />;
  return (
    <div className="pc dealt">
      <div className="row gap-8"><Dot tone="good" /><b>This has been dealt with</b></div>
      <div className="small muted">{m.body}</div>
      {m.hurt && <div className="row gap-8 small dim">At the time: <HurtBadges badges={hurtBadges(m.hurt)} level={m.hurt.level} /></div>}
    </div>
  );
}

export function InboxScreen() {
  useRenderCount('inbox');
  const g = useGame();
  const [cat, setCat] = useState<MsgFilter>('all');
  const [more, setMore] = useState(false);
  const [explain, setExplain] = useState<string | null>(null);
  // v0.7: market alerts off hides their messages (they stay in the save).
  const msgs = store.settings.marketAlerts ? g.messages : g.messages.filter((m) => store.shows(m));
  const list = filterMessages(msgs, cat);
  const shown = more ? list : list.slice(0, PAGE);
  const unread = msgs.filter((m) => !m.read).length;
  const counts = new Map<string, number>();
  for (const m of msgs) if (!m.read) {
    counts.set(m.cat, (counts.get(m.cat) ?? 0) + 1);
    if (m.topic === 'market') counts.set('market', (counts.get('market') ?? 0) + 1);
    if (isProblemMessage(m)) counts.set('problems', (counts.get('problems') ?? 0) + 1);
  }
  const markAll = () => store.update((gg) => {
    for (const m of gg.messages) if (store.shows(m)) m.read = true;
  });
  const problems = msgs.some(isProblemMessage) || g.decisions.length > 0;
  const cats: { id: MsgFilter; label: string }[] = [
    MSG_CATS[0],
    ...(problems ? [{ id: 'problems' as const, label: 'Problems only' }] : []),
    ...MSG_CATS.slice(1).filter((c) => msgs.some((m) => m.cat === c.id)),
    ...(msgs.some((m) => m.topic === 'market') ? [{ id: 'market' as const, label: 'Market' }] : []),
  ];
  return (
    <div className="screen sc-inbox">
      <ScreenHead title="Inbox" sub={`${g.decisions.length ? `${g.decisions.length} decision${g.decisions.length > 1 ? 's' : ''} waiting · ` : ''}${unread} unread`}>
        <button className="btn" onClick={markAll} disabled={!unread}><CheckCheck /> Mark all read</button>
      </ScreenHead>
      <Decisions g={g} />
      <div className="sc-seg-wrap mb-8">
        <Tabs<MsgFilter> value={cat} onChange={(v) => { setCat(v); setMore(false); }} tabs={cats.map((c) => ({ id: c.id, label: c.label, count: c.id === 'all' ? unread || undefined : counts.get(c.id) }))} />
      </div>
      {!list.length ? (
        <Empty icon={<InboxIcon />} title={cat === 'problems' ? 'No problems' : 'No messages'}>{cat === 'problems' ? 'Warnings and bad news land here with their story.' : 'Operations, crew, commercial and finance news land here.'}</Empty>
      ) : (
        <div className="card sc-list">
          {shown.map((m) => {
            const badges = messageBadges(m);
            const prob = isProblemMessage(m);
            const on = explain === m.id;
            return (
              <div key={m.id} className={`sc-msg-wrap ${on ? 'on' : ''}`}>
                <div className="sc-msg-line">
                  <button className={`sc-msg ${m.read ? 'read' : ''}`} onClick={() => open(g, m)}>
                    <Dot tone={m.tone} />
                    <span className="grow col gap-4" style={{ minWidth: 0 }}>
                      <span className="row gap-8"><b className="ellipsis">{m.title}</b>{badges.length > 0 && <HurtBadges badges={badges} level={m.hurt?.level ?? 'low'} />}<span className="tiny dim nowrap">{fmtDateTime(m.t)}</span></span>
                      <span className="small muted sc-clamp">{m.body}</span>
                    </span>
                    {m.ref && <ChevronRight className="sc-ico-s dim" />}
                  </button>
                  {prob && (
                    <button className={`btn btn-ghost sc-explain ${on ? 'btn-on' : ''}`} onClick={() => setExplain(on ? null : m.id)} aria-expanded={on} aria-label={on ? 'Hide the story' : 'Explain'}>
                      {on ? <X /> : <HelpCircle />}<span className="sc-explain-t">{on ? 'Hide' : 'Explain'}</span>
                    </button>
                  )}
                </div>
                {on && <div className="sc-msg-card"><Explain g={g} m={m} /></div>}
              </div>
            );
          })}
          {list.length > shown.length && <button className="btn btn-ghost sc-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
        </div>
      )}
    </div>
  );
}
