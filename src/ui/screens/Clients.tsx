// v0.8 Schedule › Clients (on Company until v0.11) (UPDATE-0.8.md §1.8): every client's relationship level, what it brings and what is missing
// for the next; recent changes in plain words; their contracts and open offers. ClientDetail is shared with ClientModal.

import {
  Briefcase, Building2, ChevronRight, Handshake, HeartHandshake, Landmark, Music, Palmtree, Plane, PlaneTakeoff, Trophy, Users,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { clientList, clientView, LEVEL_NAME, LEVEL_ORDER, perkLines, type ClientLevel, type ClientView } from '../../engine/contracts';
import { BAL } from '../../engine/core/balance';
import { fmtDay, fmtMonth, monthKey } from '../../engine/core/time';
import type { ClientKind, GameState } from '../../engine/core/types';
import { problemFor } from '../../engine/problems';
import { ProblemCardView } from '../components/ProblemCard';
import { Empty, Seg } from '../components/ui';
import { money } from '../format';
import { store } from '../store';
import { ArchIcon } from './common';

const KIND_ICON: Record<ClientKind, ReactNode> = {
  airline: <Plane />, tourOperator: <Palmtree />, government: <Landmark />, agency: <HeartHandshake />, sports: <Trophy />,
  music: <Music />, corporate: <Building2 />, broker: <Handshake />, operator: <PlaneTakeoff />,
};
export const KIND_LABEL: Record<ClientKind, string> = {
  airline: 'Airline', tourOperator: 'Tour operator', government: 'Government', agency: 'Aid agency', sports: 'Sports club',
  music: 'Music promoter', corporate: 'Corporate', broker: 'Broker', operator: 'Operator',
};

export function KindIcon({ kind }: { kind: ClientKind }) {
  return <span className="v8-kind" aria-label={KIND_LABEL[kind]}>{KIND_ICON[kind] ?? <Users />}</span>;
}

/** 'Trusted' pill in the level's colour. */
export function LevelPill({ level, text }: { level: ClientLevel; text?: string }) {
  return <span className={`v8-level ${level}`}>{text ?? LEVEL_NAME[level]}</span>;
}

/** Way to the next level (BAL.v08.levels), 0–1: the lower of relation progress and jobs done / jobs needed. */
function towardNext(v: ClientView): number {
  const L = BAL.v08.levels;
  const cl = (x: number) => Math.max(0, Math.min(1, x));
  switch (v.level) {
    case 'new': return v.jobs ? 1 : 0;
    case 'unhappy': return cl((v.relation + 40) / (L.unhappyBack + 40));
    case 'known': return Math.min(cl(v.relation / L.trusted[0]), cl(v.jobs / L.trusted[1]));
    case 'trusted': return Math.min(cl((v.relation - L.trusted[0]) / (L.partner[0] - L.trusted[0])), cl(v.jobs / L.partner[1]));
    default: return 1;
  }
}

/** The five steps, the current one filled (static). */
export function LevelStrip({ level }: { level: ClientLevel }) {
  const cur = LEVEL_ORDER.indexOf(level);
  return (
    <div className="v8-strip" role="img" aria-label={`Level: ${LEVEL_NAME[level]}`}>
      {LEVEL_ORDER.map((l, i) => (
        <span key={l} className={`v8-step ${l} ${i === cur ? 'on' : i < cur && l !== 'unhappy' ? 'past' : ''}`}>{LEVEL_NAME[l]}</span>
      ))}
    </div>
  );
}

/** One client in full: level strip, what it brings, the way to the next level, recent changes, work. */
export function ClientDetail({ g, v, inModal }: { g: GameState; v: ClientView; inModal?: boolean }) {
  const card = v.unhappy ? problemFor(g, v.unhappy) : null;
  const ap = AIRPORT_BY_CODE[v.base];
  const go = (fn: () => void) => () => {
    if (inModal) store.closeModal();
    fn();
  };
  return (
    <div className="col gap-12 v8-detail">
      <div className="row gap-12">
        <span className="v8-flag-l" aria-hidden>{flag(v.country)}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8">{!inModal && <b className="v8-name ellipsis">{v.name}</b>}<LevelPill level={v.level} /></div>
          <div className="small muted ellipsis">{KIND_LABEL[v.kind]} · {v.base}{ap ? ` ${ap.city}` : ''} · {v.jobs} job{v.jobs === 1 ? '' : 's'} done{v.lastJob ? ` · last ${fmtMonth(monthKey(v.lastJob))}` : ''} · relation {v.relation}</div>
        </div>
      </div>
      {card && <ProblemCardView card={card} g={g} hideActions />}
      <LevelStrip level={v.level} />
      <div className="v8-box">
        <div className="upper dim">What it brings</div>
        <ul className="v8-lines">{v.perks.map((p) => <li key={p}>{p}</li>)}</ul>
        {v.next && <div className="small mt-8"><b>To reach {LEVEL_NAME[v.next.level]}:</b> <span className="muted">{v.next.need}</span></div>}
        {v.next && v.next.level !== 'new' && v.next.level !== 'known' && (
          <div className="tiny dim mt-4">Then: {perkLines(v.next.level).slice(0, 3).join(' · ')}</div>
        )}
        {!v.next && <div className="small good mt-8">Top level: keep it there by flying their work on time.</div>}
      </div>
      {(v.active.length > 0 || v.offers.length > 0) && (
        <div className="col gap-4">
          <div className="upper dim">Work with them</div>
          {v.active.map((id) => {
            const c = g.contracts[id];
            if (!c) return null;
            return (
              <button key={id} className="v8-link" onClick={go(() => store.navigate('contracts', { view: 'active', sel: { kind: 'contract', id } }))}>
                <ArchIcon a={c.archetype} /><span className="grow ellipsis">{c.title}</span><span className="small dim nowrap">{fmtDay(c.start)} – {fmtDay(c.end)}</span><ChevronRight className="sc-ico-s dim" />
              </button>
            );
          })}
          {v.offers.map((id) => {
            const o = g.offers[id];
            if (!o) return null;
            return (
              <button key={id} className="v8-link" onClick={() => store.openModal({ kind: 'offer', offerId: id })}>
                <ArchIcon a={o.archetype} /><span className="grow ellipsis">Offer: {o.title}</span><span className="small dim nowrap">{money(o.estValue)}</span><ChevronRight className="sc-ico-s dim" />
              </button>
            );
          })}
        </div>
      )}
      <div className="col gap-4">
        <div className="upper dim">Recent</div>
        {!v.log.length && <div className="small dim">Nothing yet. On-time flying, favours and extra legs build it; cancellations and hand-overs to rivals hurt it.</div>}
        {v.log.map((l, i) => (
          <div key={i} className="v8-log small">
            <span className="dim nowrap">{fmtDay(l.t)}</span>
            <span className={`num nowrap ${l.delta > 0 ? 'good' : l.delta < 0 ? 'bad' : 'dim'}`}>{l.delta > 0 ? '+' : l.delta < 0 ? '−' : ''}{Math.abs(l.delta)}</span>
            <span className="muted">{l.text || (l.delta > 0 ? 'Good flying' : 'A setback')}</span>
          </div>
        ))}
      </div>
      {v.rivalId && (
        <button className="btn" onClick={() => store.openModal({ kind: 'rival', rivalId: v.rivalId! })}><PlaneTakeoff /> This client is a rival operator</button>
      )}
    </div>
  );
}

type Filter = 'working' | 'all' | 'unhappy';

function ClientRow({ v, on, onPick }: { v: ClientView; on: boolean; onPick: () => void }) {
  return (
    <button className={`v8-row ${on ? 'on' : ''}`} onClick={onPick} aria-pressed={on}>
      <span className="sc-flag-s" aria-hidden>{flag(v.country)}</span>
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row gap-8"><b className="ellipsis">{v.name}</b><KindIcon kind={v.kind} /></span>
        <span className="v8-thin"><span className={v.level} style={{ width: `${towardNext(v) * 100}%` }} /></span>
      </span>
      <span className="col v8-row-r">
        <LevelPill level={v.level} />
        <span className="small dim nowrap">{v.jobs} job{v.jobs === 1 ? '' : 's'}{v.lastJob ? ` · last ${fmtMonth(monthKey(v.lastJob)).split(' ')[0]}` : ''}</span>
      </span>
    </button>
  );
}

/** Schedule › Clients: filtered list on the left, the selected client on the right (no modal on landscape). */
export function ClientsView({ g }: { g: GameState }) {
  const [filter, setFilter] = useState<Filter>(() => (clientList(g, 'working').length ? 'working' : 'all'));
  const day = Math.floor(g.now / 1440);
  const nUnhappy = Object.values(g.clients).filter((c) => c.level === 'unhappy').length;
  // Levels move at most daily; the list follows the day and player edits.
  const list = useMemo(() => clientList(g, filter).sort((a, b) => +(b.level === 'unhappy') - +(a.level === 'unhappy')), [g, filter, day, store.editCount]); // eslint-disable-line react-hooks/exhaustive-deps
  const selId = store.nav.sel?.kind === 'client' ? store.nav.sel.id : list[0]?.id;
  const v = selId ? clientView(g, selId) : null;
  return (
    <div className="v8-split">
      <div className="card v8-pane v8-list">
        <div className="v8-list-head">
          <Seg<Filter> value={filter} onChange={setFilter} options={[
            { value: 'working', label: 'With us or offering' },
            { value: 'all', label: 'All' },
            { value: 'unhappy', label: `Unhappy${nUnhappy ? ` ${nUnhappy}` : ''}` },
          ]} />
        </div>
        {!list.length && <div className="small muted sc-pad">{filter === 'unhappy' ? 'No unhappy clients. Keep it that way: fly on time and say yes to favours.' : 'No clients yet. Sign an offer and its client appears here.'}</div>}
        {list.map((c) => <ClientRow key={c.id} v={c} on={c.id === v?.id} onPick={() => store.select({ kind: 'client', id: c.id })} />)}
      </div>
      <div className="card v8-pane v8-pane-r">
        {v ? <ClientDetail g={g} v={v} /> : <Empty icon={<Briefcase />} title="Pick a client">Their level, what it brings and how to reach the next.</Empty>}
      </div>
    </div>
  );
}
