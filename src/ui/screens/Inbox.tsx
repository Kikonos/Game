// Inbox (B5): open decisions pinned on top, then messages with category filters; tapping a message marks it
// read and follows its ref. DESIGN.md §6.3. v0.7.1: a 'Problems only' filter, a severity badge on every warning
// (money / passengers / lateness) and an Explain button that unfolds the four-line card in place.

import { CheckCheck, ChevronRight, HelpCircle, Hourglass, Inbox as InboxIcon, PencilLine, ShieldAlert, TimerOff, Trophy, Users, X } from 'lucide-react';
import { HEAD_DEFS } from '../../data/heads';
import type { HeadId } from '../../engine/core/types';
import { NamedIcon } from '../components/NamedIcon';
import { useMemo, useState } from 'react';
import { fmtDateTime } from '../../engine/core/time';
import type { GameState, Message } from '../../engine/core/types';
import { hurtBadges, messageBadges, problemAt, problemFor, problems, usdShort } from '../../engine/problems';
import { reopenLatePayment } from '../../engine/ops';
import { HurtBadges, ProblemCardView } from '../components/ProblemCard';
import { Empty, Tabs } from '../components/ui';
import { store, useGame } from '../store';
import { Dot, ScreenHead, useRenderCount } from './common';
import { expiryLabel, filterMessages, isOpportunity, isProblemMessage, MSG_CATS, PROBLEM_RECENT, refTarget, type MsgFilter } from './screenLogic';
import { ScreenHint } from '../components/ScreenHint';

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
  if ((m.problem?.kind === 'crewShort' || m.problem?.kind === 'crewIllegal' || m.problem?.kind === 'crewHours' || m.topic === 'crewRed' || m.topic === 'crewHours') && m.ref?.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled') {
    return store.openModal({ kind: 'crewControl', flightId: m.ref.id });
  }
  if (m.ref?.kind === 'cash' || m.ref?.kind === 'statement') return store.navigate('finance');
  if (m.ref?.kind === 'decision') {
    if (g.decisions.some((d) => d.id === m.ref!.id)) store.openModal({ kind: 'decision', decisionId: m.ref.id });
    return;
  }
  // v0.10.2 a phone call still open rings again from its Inbox line
  if (m.ref?.kind === 'offer' && g.offers[m.ref.id]?.call && g.offers[m.ref.id].status === 'open' && g.offers[m.ref.id].expires > g.now) {
    return store.openModal({ kind: 'offerCall', offerId: m.ref.id });
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

/**
 * v0.9 round 4 (§5.3 override): a head's note carries a Change action: a flight still to fly opens Crew Control, a
 * receivable still unpaid asks the late-payment decision again (the head never takes it twice). What the player then
 * does within 2 h counts as overridden on the Team view.
 */
function changeOf(g: GameState, m: Message): (() => void) | null {
  if (m.topic !== 'head' || !m.ref) return null;
  if (m.ref.kind === 'flight' && g.flights[m.ref.id]?.status === 'scheduled') return () => store.openModal({ kind: 'crewControl', flightId: m.ref!.id });
  if (m.ref.kind === 'receivable' && g.finance.receivables.some((r) => r.id === m.ref!.id && r.paid === null)) {
    return () => {
      const r = store.act((gg) => reopenLatePayment(gg, m.ref!.id), { toastOk: false });
      if (r.ok && r.data) store.openModal({ kind: 'decision', decisionId: r.data.decisionId });
    };
  }
  return null;
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
  // An offer that has gone was never a problem: no 'dealt with'.
  if (isOpportunity(m)) return <div className="pc dealt"><div className="row gap-8"><Dot tone="off" /><b>This offer has gone</b></div><div className="small muted">The client placed the work elsewhere. New offers land on the Contracts market.</div></div>;
  return (
    <div className="pc dealt">
      <div className="row gap-8"><Dot tone="good" /><b>This has been dealt with</b></div>
      <div className="small muted">{m.body}</div>
      {m.hurt && <div className="row gap-8 small dim">At the time: <HurtBadges badges={hurtBadges(m.hurt)} level={m.hurt.level} /></div>}
    </div>
  );
}

/** v0.9 the row's mark: crew out of hours (TimerOff) and crew shortage (Users) at the red stage, an achievement's trophy,
 *  a department head's icon; otherwise the tone dot. */
function MsgIcon({ m }: { m: Message }) {
  if (m.topic === 'crewHours' || m.problem?.kind === 'crewHours') return <TimerOff className={`sc-ico-s ${m.tone === 'bad' ? 'bad' : 'warn'} v9-msg-ico`} aria-label="Crew out of hours" />;
  if (m.topic === 'crewRed') return <Users className="sc-ico-s bad v9-msg-ico" aria-label="Crew shortage" />;
  if (m.topic === 'achievement') return <Trophy className="sc-ico-s gold v9-msg-ico" aria-label="Achievement" />;
  if (m.topic === 'head' && m.ref?.kind === 'head' && HEAD_DEFS[m.ref.id as HeadId]) return <NamedIcon name={HEAD_DEFS[m.ref.id as HeadId].icon} className="sc-ico-s accent v9-msg-ico" />;
  return <Dot tone={m.tone} />;
}

/** The badge of a message: an offer's money is work on the table (blue), everything else what it costs. */
function MsgBadges({ m }: { m: Message }) {
  if (isOpportunity(m)) return m.hurt && m.hurt.money > 0 ? <span className="pc-badges"><span className="pc-badge opp">{usdShort(m.hurt.money)} of work</span></span> : null;
  const badges = messageBadges(m);
  return badges.length > 0 ? <HurtBadges badges={badges} level={m.hurt?.level ?? 'low'} /> : null;
}

/** 'Problems only': what is wrong right now, worst first (the same list behind every WHY? dot), each a tap to its card. */
function ProblemsNow({ g }: { g: GameState }) {
  const list = problems(g);
  if (!list.length) return null;
  return (
    <div className="col gap-8 mb-16">
      <div className="upper dim">Right now</div>
      {list.slice(0, 12).map((c) => (
        <button key={`${c.subject.kind}:${c.subject.ref.id}`} className={`pc pc-compact pc-now ${c.severity}`} onClick={() => store.openModal({ kind: 'problem', subject: c.subject })}>
          <ShieldAlert className={`sc-ico-s ${c.severity === 'red' ? 'bad' : 'warn'}`} />
          <b className="pc-what-s grow ellipsis">{c.what}</b>
          <HurtBadges badges={c.hurt.badges} level={c.hurt.level} />
          <ChevronRight className="sc-ico-s dim" />
        </button>
      ))}
      {list.length > 12 && <div className="tiny dim">… and {list.length - 12} more; the dots on each screen lead to them.</div>}
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
  const hour = Math.floor(g.now / 60);
  // The problem filter asks the engine whether each message's problem is still live: once per hour / new message.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => filterMessages(msgs, cat, g), [g, msgs, cat, hour, g.messages.length]);
  const shown = more ? list : list.slice(0, PAGE);
  const unread = msgs.filter((m) => !m.read).length;
  const counts = new Map<string, number>();
  for (const m of msgs) if (!m.read) {
    counts.set(m.cat, (counts.get(m.cat) ?? 0) + 1);
    if (m.topic === 'market') counts.set('market', (counts.get('market') ?? 0) + 1);
    if (m.topic === 'world') counts.set('world', (counts.get('world') ?? 0) + 1);
    if (isProblemMessage(m, g)) counts.set('problems', (counts.get('problems') ?? 0) + 1);
  }
  const markAll = () => store.update((gg) => {
    for (const m of gg.messages) if (store.shows(m)) m.read = true;
  });
  const anyProblem = problems(g).length > 0 || g.decisions.length > 0 || msgs.some((m) => m.tone === 'bad' && g.now - m.t <= PROBLEM_RECENT);
  const cats: { id: MsgFilter; label: string }[] = [
    MSG_CATS[0],
    ...(anyProblem ? [{ id: 'problems' as const, label: 'Problems only' }] : []),
    ...MSG_CATS.slice(1).filter((c) => msgs.some((m) => m.cat === c.id)),
    ...(msgs.some((m) => m.topic === 'market') ? [{ id: 'market' as const, label: 'Market' }] : []),
    ...(msgs.some((m) => m.topic === 'world') ? [{ id: 'world' as const, label: 'World' }] : []),
  ];
  return (
    <div className="screen sc-inbox">
      <ScreenHead title="Inbox" sub={`${g.decisions.length ? `${g.decisions.length} decision${g.decisions.length > 1 ? 's' : ''} waiting · ` : ''}${unread} unread`}>
        <button className="btn" onClick={markAll} disabled={!unread}><CheckCheck /> Mark all read</button>
      </ScreenHead>
      <ScreenHint id="inbox" />
      <Decisions g={g} />
      <div className="sc-seg-wrap mb-8">
        <Tabs<MsgFilter> value={cat} onChange={(v) => { setCat(v); setMore(false); }} tabs={cats.map((c) => ({ id: c.id, label: c.label, count: c.id === 'all' ? unread || undefined : counts.get(c.id) }))} />
      </div>
      {cat === 'problems' && <ProblemsNow g={g} />}
      {!list.length ? (
        cat === 'problems' && problems(g).length > 0 ? null : <Empty icon={<InboxIcon />} title={cat === 'problems' ? 'No problems' : 'No messages'}>{cat === 'problems' ? 'Open problems and the bad news of the last week land here with their story.' : 'Operations, crew, commercial and finance news land here.'}</Empty>
      ) : (
        <div className="card sc-list">
          {shown.map((m) => {
            const prob = !!m.problem || m.tone === 'bad' || m.tone === 'warn';
            const on = explain === m.id;
            const change = changeOf(g, m);
            return (
              <div key={m.id} className={`sc-msg-wrap ${on ? 'on' : ''}`}>
                <div className="sc-msg-line">
                  <button className={`sc-msg ${m.read ? 'read' : ''}`} onClick={() => open(g, m)}>
                    <MsgIcon m={m} />
                    <span className="grow col gap-4" style={{ minWidth: 0 }}>
                      <span className="row gap-8"><b className="ellipsis">{m.title}</b><MsgBadges m={m} /><span className="tiny dim nowrap">{fmtDateTime(m.t)}</span></span>
                      <span className="small muted sc-clamp">{m.body}</span>
                    </span>
                    {m.ref && <ChevronRight className="sc-ico-s dim" />}
                  </button>
                  {prob && (
                    <button className={`btn btn-ghost sc-explain ${on ? 'btn-on' : ''}`} onClick={() => setExplain(on ? null : m.id)} aria-expanded={on} aria-label={on ? 'Hide the story' : 'Explain'}>
                      {on ? <X /> : <HelpCircle />}<span className="sc-explain-t">{on ? 'Hide' : 'Explain'}</span>
                    </button>
                  )}
                  {change && (
                    <button className="btn btn-ghost sc-explain" onClick={change} aria-label="Change what the head did">
                      <PencilLine /><span className="sc-explain-t">Change</span>
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
