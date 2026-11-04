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
import { PRESTIGE_NAME } from '../../../engine/contracts/prestige';
import { fmtDay } from '../../../engine/core/time';
import type { ClientKind, GameState, OfferFilter, Prestige } from '../../../engine/core/types';
import { Card, Seg, Stepper, Toggle } from '../../components/ui';
import { money } from '../../format';
import { store } from '../../store';
import { ArchIcon } from '../common';
import { offerDays, offerModal, productLine, routeSummary } from '../screenLogic';

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
      <Card title="Offer filter" icon={<Funnel className="ico" />} sub="What you tell your sales team and the brokers not to bring you." className="flt-card">
        <div className="row between gap-12 flt-switch">
          <span className="row gap-12">
            <Toggle on={f.on} onChange={(on) => set({ on })} label="Filter on" />
            <b>{f.on ? 'Filter on' : 'Filter off'}</b>
          </span>
          <span className={`small ${hidden ? 'warn' : 'dim'}`}>{f.on ? (hidden ? `${hidden} offer${hidden === 1 ? '' : 's'} hidden now` : empty ? 'Nothing set: every offer shows' : 'Nothing hidden right now') : 'Every offer shows'}</span>
        </div>
        <div className="small muted">Hidden offers do not chime or write to you. They sit under one row on the Market tab until they lapse, so you can still open and sign them.</div>
        <Row label="Do not bring me work from" hint="tap to switch a kind off">
          <ChipSet items={FILTER_KINDS.map((k) => ({ id: k, label: KIND_LABEL[k] }))} selected={f.kindsOff} off onToggle={(k: ClientKind) => set({ kindsOff: toggleIn(f.kindsOff, k) })} />
        </Row>
        <Row label="Client level" hint="only clients at this level or above">
          <Seg<Prestige | 0> value={f.minPrestige ?? 0} onChange={(v) => set({ minPrestige: v || undefined })} options={[
            { value: 0, label: 'Any' }, { value: 2, label: `2+ ${PRESTIGE_NAME[2]}` }, { value: 3, label: `3+ ${PRESTIGE_NAME[3]}` }, { value: 4, label: `4 ${PRESTIGE_NAME[4]}` },
          ]} />
        </Row>
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
        <div className="row between gap-12 wrap mt-8">
          <span className="tiny dim">Humanitarian work, tenders you won, leads you worked and your own clients always come through.</span>
          {g.filter && <button className="btn btn-sm btn-ghost" onClick={() => store.act((gg) => clearOfferFilter(gg), { toastOk: false })}><RotateCcw /> Reset</button>}
        </div>
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
                  <div className="ellipsis"><b>{o.title}</b></div>
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
