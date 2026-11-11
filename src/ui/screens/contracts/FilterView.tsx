// v0.16 Contracts › Filter (UPDATE-0.16.md §D): what you tell your sales team and the brokers not to bring you. Client
// kinds off, a minimum client level, a minimum rate per block hour (ACMI) or profit (charter), only some aircraft
// families or markets. A hidden offer neither chimes nor writes; the Market tab counts them in one row (HiddenOffersRow)
// that opens the list, so nothing is ever lost.

import { EyeOff, Funnel, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../../data/acmiTypes';
import { flag } from '../../../data/countries';
import { MARKETS, type MarketId } from '../../../data/markets';
import { clearOfferFilter, FILTER_KINDS, filterEmpty, hiddenOffers, KIND_LABEL, setOfferFilter } from '../../../engine/contracts/filter';
import { STARS_NAME } from '../../../engine/contracts/prestige';
import { fmtDay } from '../../../engine/core/time';
import type { ClientKind, GameState, OfferFilter, Stars } from '../../../engine/core/types';
import { Card, Seg, Stepper, Toggle } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';
import { ArchIcon } from '../common';
import { ShapeTags } from '../../components/ShapeTags';
import { Help } from '../../components/Help';
import { BODIES, BODY_LABEL, HAUL_LABEL, HAUL_RANGE, HAULS, shapeOf, type Body, type Haul } from '../../../engine/contracts/shape';
import { marketOffers, offerDays, offerModal, productLine, routeSummary } from '../screenLogic';

const FAMILIES: RatingFamily[] = [...new Set(ACMI_TYPES_LIST.map((t) => t.family))];

/** One section: a label line and its control. */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flt-row">
      <div className="flt-row-head">
        <span className="small"><b>{label}</b></span>
        {hint && <span className="tiny dim">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** A set of on/off chips; `off` = the chips drawn as switched off when selected (the kinds), else as chosen. */
function ChipSet<T extends string>({ items, selected, off, onToggle }: { items: { id: T; label: string }[]; selected: readonly T[]; off?: boolean; onToggle: (id: T) => void }) {
  return (
    <div className="flt-chips">
      {items.map((it) => {
        const on = selected.includes(it.id);
        return (
          <button key={it.id} className={`flt-chip ${on ? (off ? 'off' : 'on') : ''}`} onClick={() => onToggle(it.id)} aria-pressed={on}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterView({ g }: { g: GameState }) {
  const f: OfferFilter = g.filter ?? { on: false, kindsOff: [] };
  const set = (patch: Partial<OfferFilter>) => store.act((gg) => setOfferFilter(gg, patch), { toastOk: false });
  const toggleIn = <T extends string>(list: readonly T[] | undefined, id: T): T[] => (list?.includes(id) ? list.filter((x) => x !== id) : [...(list ?? []), id]);
  const hidden = hiddenOffers(g).length;
  const empty = filterEmpty(g.filter);
  return (
    <div className="flt">
      {/* v0.22 how the filter works sits behind the '?' by the title (no permanent lines). */}
      <Card title={<>Offer filter <Help title="Offer filter">
        <p>What you tell your sales team and the brokers not to bring you.</p>
        <p>Hidden offers do not chime or write to you. They sit under one row on the Market tab until they lapse, so you can still open and sign them.</p>
        <p>Humanitarian work, tenders you won, leads you worked and your own clients always come through.</p>
      </Help></>} icon={<Funnel className="ico" />} className="flt-card">
        <div className="row between gap-12 flt-switch">
          <span className="row gap-12">
            <Toggle on={f.on} onChange={(on) => set({ on })} label="Filter on" />
            <b>{f.on ? 'Filter on' : 'Filter off'}</b>
          </span>
          <span className={`small ${hidden ? 'warn' : 'dim'}`}>{f.on ? (hidden ? `${hidden} offer${hidden === 1 ? '' : 's'} hidden now` : empty ? 'Nothing set: every offer shows' : 'Nothing hidden right now') : 'Every offer shows'}</span>
        </div>
        <Row label="Do not bring me work from">
          <ChipSet items={FILTER_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] }))} selected={f.kindsOff} off onToggle={(k: ClientKind) => set({ kindsOff: toggleIn(f.kindsOff, k) })} />
        </Row>
        <Row label="Client stars" hint="only clients with this many stars or more">
          <Seg<Stars | 0> value={f.minStars ?? 0} onChange={(v) => set({ minStars: v || undefined })} options={[
            { value: 0, label: 'Any' }, ...([1, 2, 3, 4, 5] as Stars[]).map((n) => ({ value: n, label: `${'★'.repeat(n)}${n < 5 ? '+' : ''}` })),
          ]} />
          {f.minStars ? <div className="tiny dim">{f.minStars} of 5 stars and up: {STARS_NAME[f.minStars].toLowerCase()} and above.</div> : null}
        </Row>
        {/* v0.18 aircraft size and distance (contracts/shape.ts; the haul by the longest leg's block time). */}
        <div className="flt-two">
          <Row label="Aircraft size" hint={f.bodies?.length ? 'only jobs for these' : 'none chosen: any'}>
            <ChipSet items={BODIES.map((b) => ({ id: b, label: BODY_LABEL[b] }))} selected={f.bodies ?? []} onToggle={(b: Body) => set({ bodies: toggleIn(f.bodies, b) })} />
          </Row>
          <Row label="Distance" hint="by the longest leg">
            <ChipSet items={HAULS.map((h) => ({ id: h, label: HAUL_LABEL[h] }))} selected={f.hauls ?? []} onToggle={(h: Haul) => set({ hauls: toggleIn(f.hauls, h) })} />
          </Row>
        </div>
        <div className="tiny dim flt-haul-note">Short-haul {HAUL_RANGE.short} · medium {HAUL_RANGE.medium} · long {HAUL_RANGE.long} · ultra-long {HAUL_RANGE.ultra} of block time.</div>
        <div className="flt-two">
          <Row label="Minimum rate per block hour" hint="ACMI and wet leases">
            <Stepper value={f.minRatePerBH ?? 0} min={0} max={25_000} step={250} onChange={(v) => set({ minRatePerBH: v })} format={(v) => (v ? `$${v.toLocaleString('en-US')}` : 'Any')} />
          </Row>
          <Row label="Minimum profit on a charter" hint="the best estimate on your fleet">
            <Stepper value={f.minProfit ?? 0} min={0} max={2_000_000} step={10_000} onChange={(v) => set({ minProfit: v })} format={(v) => (v ? money(v) : 'Any')} />
          </Row>
        </div>
        <Row label="Only these aircraft families" hint={f.families?.length ? 'jobs none of them can fly are hidden' : 'none chosen: any'}>
          <ChipSet items={FAMILIES.map((x) => ({ id: x, label: x }))} selected={f.families ?? []} onToggle={(x: RatingFamily) => set({ families: toggleIn(f.families, x) })} />
        </Row>
        <Row label="Only these markets" hint={f.markets?.length ? 'a job touching none of them is hidden' : 'none chosen: any'}>
          <ChipSet items={MARKETS.map((m) => ({ id: m.id, label: m.short }))} selected={(f.markets ?? []) as MarketId[]} onToggle={(m: MarketId) => set({ markets: toggleIn(f.markets, m) })} />
        </Row>
        {g.filter && (
          <div className="row gap-12 wrap mt-8" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => store.act((gg) => clearOfferFilter(gg), { toastOk: false })}><RotateCcw /> Reset</button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** The Market tab's "N offers hidden by your filter · show" row, opening the hidden list (tap a row: the offer dialog). */
export function HiddenOffersRow({ g }: { g: GameState }) {
  const [open, setOpen] = useState(false);
  const list = hiddenOffers(g);
  if (!list.length) return null;
  const n = list.length;
  return (
    <div className="flt-hidden">
      <div className="row between gap-8">
        <button className="flt-hidden-row" onClick={() => setOpen(!open)} aria-expanded={open}>
          <EyeOff className="sc-ico-s" /><span>{n} offer{n === 1 ? '' : 's'} hidden by your filter</span><span className="dim">· {open ? 'hide' : 'show'}</span>
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => store.navigate('contracts', { view: 'filter' })}><Funnel /> Filter</button>
      </div>
      {open && (
        <div className="card sc-list flt-hidden-list">
          {list.map((o) => {
            const cl = g.clients[o.clientId];
            return (
              <button key={o.id} className="sc-list-row flt-hidden-item" onClick={() => store.openModal(offerModal(g, o.id))}>
                <ArchIcon a={o.archetype} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row gap-8"><b className="ellipsis">{o.title}</b><ShapeTags s={shapeOf(o)} compact /></div>
                  <div className="small muted ellipsis">{[cl ? `${flag(cl.country)} ${cl.name}` : '', routeSummary(o.pattern), offerDays(o).map(fmtDay).join(' – ')].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="right small nowrap">
                  <div>{productLine(o.product, o)}</div>
                  <div className="dim">est. {money(o.estValue)}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * v0.18 the Market's quick chips: All · Narrowbody · Widebody | Short · Medium · Long · Ultra-long. They set the same
 * offer filter as Contracts › Filter (saved with the game; a job they hide goes under "N offers hidden"), each with
 * how many open offers it would show.
 */
export function OfferQuickChips({ g }: { g: GameState }) {
  const f: OfferFilter = g.filter ?? { on: false, kindsOff: [] };
  const live = [...marketOffers(g), ...hiddenOffers(g)];
  const shapes = live.map((o) => shapeOf(o));
  const onB = f.on ? f.bodies ?? [] : [];
  const onH = f.on ? f.hauls ?? [] : [];
  const set = (patch: Partial<OfferFilter>) => store.act((gg) => setOfferFilter(gg, { on: true, ...patch }), { toastOk: false });
  const toggleIn = <T extends string>(list: readonly T[], id: T): T[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const chip = (key: string, label: string, on: boolean, n: number, act: () => void) => (
    <button key={key} className={`flt-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={act}>{label}<span className="n">{n}</span></button>
  );
  const any = !onB.length && !onH.length;
  return (
    <div className="of-quick" role="group" aria-label="Quick filter">
      <button className={`flt-chip ${any ? 'on' : ''}`} aria-pressed={any} onClick={() => set({ bodies: [], hauls: [] })}>All<span className="n">{live.length}</span></button>
      {BODIES.map((b) => chip(b, BODY_LABEL[b], onB.includes(b), shapes.filter((s) => s.body === b).length, () => set({ bodies: toggleIn(onB, b), ...(f.on ? {} : { hauls: [] }) })))}
      <span className="of-quick-sep" aria-hidden="true" />
      {HAULS.map((h) => chip(h, HAUL_LABEL[h].replace('-haul', ''), onH.includes(h), shapes.filter((s) => s.haul === h).length, () => set({ hauls: toggleIn(onH, h), ...(f.on ? {} : { bodies: [] }) })))}
      <button className="btn btn-sm btn-ghost of-quick-more" onClick={() => store.navigate('contracts', { view: 'filter' })} aria-label="All filter settings"><Funnel /></button>
    </div>
  );
}
