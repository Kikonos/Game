// v0.8 Company › Rivals (UPDATE-0.8.md §3.6): real ACMI operators with a style, a fleet that changes, how busy they
// are, and our dealings with them (jobs they took, hires both ways). RivalDetail is shared with RivalModal.

import { PlaneTakeoff } from 'lucide-react';
import { useMemo } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { LEVEL_NAME, rivalList, rivalView, type RivalView } from '../../engine/contracts';
import { typeOf } from '../../engine/core/perf';
import { fmtDay } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { Empty } from '../components/ui';
import { store } from '../store';
import { LevelPill } from './Clients';

/** 'Low fares' chip in the style's colour. */
export function StyleChip({ v }: { v: Pick<RivalView, 'style' | 'styleName'> }) {
  return <span className={`chip sc-chip v8-style ${v.style}`}>{v.styleName}</span>;
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** 'Took 3 jobs from us · we hired them twice · they hired us once'. */
export function dealings(v: RivalView): string {
  const p: string[] = [];
  if (v.won) p.push(`Took ${v.won} job${v.won === 1 ? '' : 's'} from us`);
  if (v.hiredThem) p.push(`we hired them ${times(v.hiredThem)}`);
  if (v.hiredUs) p.push(`they hired us ${times(v.hiredUs)}`);
  const s = p.join(' · ');
  return s ? s[0].toUpperCase() + s.slice(1) : 'No dealings yet';
}

const fleetLine = (v: RivalView) => `${v.fleetCount} aircraft${v.fleetDelta ? ` (${v.fleetDelta > 0 ? '+' : '−'}${Math.abs(v.fleetDelta)} this year)` : ''}`;

export function RivalDetail({ v }: { v: RivalView }) {
  const ap = AIRPORT_BY_CODE[v.base];
  return (
    <div className="col gap-12 v8-detail">
      <div className="row gap-12">
        <span className="v8-flag-l" aria-hidden>{flag(v.country)}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row gap-8"><b className="v8-name ellipsis">{v.name}</b><StyleChip v={v} /></div>
          <div className="small muted ellipsis">{v.base}{ap ? ` ${ap.city}` : ''} · {fleetLine(v)}</div>
        </div>
      </div>
      <p className="muted small v8-style-text">{v.styleText}.</p>
      {v.ceased ? (
        <div className="v8-box small"><b className="bad">Ceased operations {fmtDay(v.ceased)}</b><div className="muted">Its clients are looking for aircraft, and its crews for work.</div></div>
      ) : (
        <div className="v8-busy">
          <div className="row between small"><span className="muted">{v.busyText}</span><span className="num dim">{Math.round(v.busy * 100)} % booked</span></div>
          <div className="v8-thin"><span className={v.busy >= 0.9 ? 'bad' : v.busy >= 0.75 ? 'warn' : 'good'} style={{ width: `${Math.round(v.busy * 100)}%` }} /></div>
        </div>
      )}
      <div className="v8-box">
        <div className="upper dim">Fleet</div>
        <div className="v8-fleet">
          {v.fleet.map((f) => (
            <span key={f.typeId} className="v8-fleet-row small"><span>{typeOf(f.typeId).short}</span><b className="num">{f.count}</b></span>
          ))}
          {!v.fleet.length && <span className="small dim">No aircraft</span>}
        </div>
      </div>
      <div className="small"><b>Dealings:</b> <span className="muted">{dealings(v)}</span></div>
      {v.level && <div className="row gap-8 small"><span className="muted">As a client of ours:</span><LevelPill level={v.level} text={LEVEL_NAME[v.level]} /></div>}
      <div className="col gap-4">
        <div className="upper dim">Recent</div>
        {!v.log.length && <div className="small dim">Nothing yet: fleet changes, jobs they take and hires show here.</div>}
        {v.log.map((l, i) => (
          <div key={i} className="v8-log v8-log2 small"><span className="dim nowrap">{fmtDay(l.t)}</span><span className="muted">{l.text}</span></div>
        ))}
      </div>
    </div>
  );
}

function RivalRow({ v, on }: { v: RivalView; on: boolean }) {
  return (
    <button className={`v8-row ${on ? 'on' : ''} ${v.ceased ? 'ceased' : ''}`} onClick={() => store.select({ kind: 'rival', id: v.id })} aria-pressed={on}>
      <span className="sc-flag-s" aria-hidden>{flag(v.country)}</span>
      <span className="col grow" style={{ minWidth: 0 }}>
        <span className="row gap-8"><b className="ellipsis">{v.name}</b><StyleChip v={v} /></span>
        {v.ceased ? <span className="small dim">Ceased operations {fmtDay(v.ceased)}</span> : (
          <span className="v8-thin" title={v.busyText}><span className={v.busy >= 0.9 ? 'bad' : v.busy >= 0.75 ? 'warn' : 'good'} style={{ width: `${Math.round(v.busy * 100)}%` }} /></span>
        )}
      </span>
      <span className="col v8-row-r">
        <span className="small nowrap">{fleetLine(v)}</span>
        <span className="small dim nowrap">{v.ceased ? '' : v.busyText.split(':')[0]}</span>
      </span>
    </button>
  );
}

/** Company › Rivals: list on the left, the selected operator on the right. */
export function RivalsView({ g }: { g: GameState }) {
  const month = Math.floor(g.now / (1440 * 30));
  const list = useMemo(() => rivalList(g), [g, month, store.editCount, g.rivals.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const selId = store.nav.sel?.kind === 'rival' ? store.nav.sel.id : list[0]?.id;
  const v = selId ? rivalView(g, selId) : null;
  const took = list.filter((r) => r.won > 0).length;
  return (
    <div className="v8-split">
      <div className="card v8-pane v8-list">
        <div className="v8-list-head small muted">{list.filter((r) => !r.ceased).length} operators{took ? ` · ${took} took jobs from us` : ''}</div>
        {list.map((r) => <RivalRow key={r.id} v={r} on={r.id === v?.id} />)}
      </div>
      <div className="card v8-pane v8-pane-r">
        {v ? <RivalDetail v={v} /> : <Empty icon={<PlaneTakeoff />} title="No rivals">Other ACMI operators appear here.</Empty>}
      </div>
    </div>
  );
}
