// v0.17 (UPDATE-0.17.md §D.1, §N.3; lane `market-ui`): Ask lessors. Five rows (Type · Age · Lease · From · How many),
// each a picker with 44 px targets; under them who it goes to ("Goes to 7 lessors · 3 won't consider us yet (rating C) ·
// answers in 1–2 weeks"), the fleet-age warning, the AOC variation note and, for a rare type or one the ladder holds
// back, What it takes (§T). Send.

import { FileSignature } from 'lucide-react';
import { useState } from 'react';
import { ACMI_TYPES, ACMI_TYPES_LIST, type AcmiType } from '../../data/acmiTypes';
import { FACTORIES, NEW_BUILD } from '../../data/market';
import { BAL } from '../../engine/core/balance';
import { fromUTC, toDate, yearOf } from '../../engine/core/time';
import type { AgeBand, GameState } from '../../engine/core/types';
import { bandYears, rfpPreview, sendRfp, tightNow, tightWord, type RfpDraft } from '../../engine/leasing';
import { aircraftGate } from '../../engine/ops';
import { Modal, Seg, Toggle } from '../components/ui';
import { isExoticType, tName } from '../screens/market/marketLogic';
import { WhatItTakes } from '../screens/market/WhatItTakes';
import { store, useGame } from '../store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BANDS: { value: AgeBand; label: string; usual: string }[] = [
  { value: 'new', label: 'New build', usual: '96–144' },
  { value: 'young', label: 'Young', usual: '60–120' },
  { value: 'mid', label: 'Mid-life', usual: '24–96' },
  { value: 'old', label: 'Old', usual: '12–48' },
];
const TERMS = [12, 24, 36, 60, 96, 144];

/** Types on the request list: flown now or soon (gate held, pending or one approval away), the request-only A320neo, and every rare type (never hidden, §T). */
export function rfpTypes(g: GameState): { t: AcmiType; note: string; ok: boolean }[] {
  const year = yearOf(g.now);
  const out: { t: AcmiType; note: string; ok: boolean }[] = [];
  for (const t of ACMI_TYPES_LIST) {
    const reqOnly = BAL.v017.supply.rfpOnly.includes(t.id);
    if (!t.available && !reqOnly) continue;
    if ((t.firstYear ?? 0) > year && !(NEW_BUILD.includes(t.id) && FACTORIES[t.family])) continue;
    if (t.newOnly && !(NEW_BUILD.includes(t.id) && FACTORIES[t.family])) continue;
    const gate = aircraftGate(g, t.id);
    const exotic = isExoticType(t.id);
    if (gate.missing.length > 1 && !exotic) continue;
    const word = g.leasing ? tightWord(tightNow(g, t.id)) : '';
    const note = !gate.ok ? `${gate.text} first` : word;
    out.push({ t, note: `${word && !gate.ok ? `${word} · ` : ''}${note}`, ok: gate.ok });
  }
  return out;
}

/** The fleet's main type (most aircraft), the default pick. */
function mainType(g: GameState): string {
  const n: Record<string, number> = {};
  for (const a of Object.values(g.fleet)) n[a.typeId] = (n[a.typeId] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'a320ceo';
}

export function RfpModal({ typeId: wanted }: { typeId?: string }) {
  const g = useGame();
  const types = rfpTypes(g);
  const [typeId, setType] = useState(() => (wanted && ACMI_TYPES[wanted] ? wanted : mainType(g)));
  const t = ACMI_TYPES[typeId] ?? ACMI_TYPES.a320ceo;
  const bands = BANDS.map((b) => ({ ...b, ok: !!bandYears(g, t, b.value) }));
  const [band0, setBand] = useState<AgeBand>('mid');
  const band = bands.find((b) => b.value === band0)?.ok ? band0 : bands.find((b) => b.ok)?.value ?? 'mid';
  const [months, setMonths] = useState(36);
  const minNew = BAL.v017.newBuild.months[0];
  const term = band === 'new' && months < minNew ? minNew : months;
  // From: as soon as possible, or the first of a month (the next 24 months; new builds the next 60).
  const d = toDate(g.now);
  const horizon = band === 'new' ? 60 : 24;
  const opts = Array.from({ length: horizon }, (_, i) => {
    const y = d.getUTCFullYear() + Math.floor((d.getUTCMonth() + 1 + i) / 12);
    const m = (d.getUTCMonth() + 1 + i) % 12;
    return { t: fromUTC(y, m + 1, 1), label: `${MONTHS[m]} ${y}` };
  });
  const [from, setFrom] = useState<number | null>(null);
  const fromT = from !== null && opts.some((o) => o.t === from) ? from : null;
  const [flex, setFlex] = useState(true);
  const [count, setCount] = useState<1 | 2 | 3>(1);
  const draft: RfpDraft = { typeId: t.id, band, months: term, count, from: fromT, flex };
  const p = rfpPreview(g, draft);
  const close = () => store.closeModal();
  const send = () => {
    const r = store.act((gg) => sendRfp(gg, draft));
    if (!r.ok) return;
    close();
    store.navigate('fleet', { view: 'market', sel: { kind: 'rfp', id: r.data!.rfpId } });
  };
  const narrow = types.filter((x) => x.t.body !== 'wide');
  const wide = types.filter((x) => x.t.body === 'wide');
  const opt = (x: { t: AcmiType; note: string }) => <option key={x.t.id} value={x.t.id}>{tName(x.t.id)}{x.note ? ` · ${x.note}` : ''}</option>;
  return (
    <Modal title="Ask lessors" icon={<FileSignature className="accent" />} onClose={close} footer={
      <>
        {p.blocked && <span className="grow small warn">{p.blocked}</span>}
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn btn-primary" onClick={send} disabled={!!p.blocked}><FileSignature /> Send</button>
      </>
    }>
      <div className="rf-rows">
        <label className="rf-row">
          <span className="upper dim">Type</span>
          <select className="select input" value={t.id} onChange={(e) => setType(e.target.value)} aria-label="Type">
            <optgroup label="Narrowbody">{narrow.map(opt)}</optgroup>
            <optgroup label="Widebody">{wide.map(opt)}</optgroup>
          </select>
        </label>
        <div className="rf-row">
          <span className="upper dim">Age</span>
          <Seg<AgeBand> value={band} onChange={setBand} options={bands.filter((b) => b.ok).map((b) => ({ value: b.value, label: b.label }))} />
        </div>
        <div className="rf-row">
          <span className="upper dim">Lease</span>
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <Seg<number> value={term} onChange={setMonths} options={TERMS.filter((m) => band !== 'new' || m >= minNew).map((m) => ({ value: m, label: `${m}` }))} />
            <span className="tiny dim">Months. Lessors usually offer {bands.find((b) => b.value === band)?.usual} months on a {bands.find((b) => b.value === band)?.label.toLowerCase()} aircraft; shorter costs more.</span>
          </div>
        </div>
        <div className="rf-row">
          <span className="upper dim">From</span>
          <div className="rf-from">
            <select className="select input" value={fromT ?? ''} onChange={(e) => setFrom(e.target.value === '' ? null : Number(e.target.value))} aria-label="From">
              <option value="">As soon as possible</option>
              {opts.map((o) => <option key={o.t} value={o.t}>{o.label}</option>)}
            </select>
            {fromT !== null && <span className="row gap-8 small"><Toggle on={flex} onChange={setFlex} label="Flexible by a month" />Flexible by a month</span>}
          </div>
        </div>
        <div className="rf-row">
          <span className="upper dim">How many</span>
          <Seg<1 | 2 | 3> value={count} onChange={setCount} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]} />
        </div>
      </div>
      <div className="rf-box mt-12">
        <b className="small">{p.text || 'No lessor to ask'}</b>
        {fromT === null && <span className="tiny dim">As soon as possible: only aircraft in storage can go, so fewer lessors have one. Asking four to six months ahead works best.</span>}
        {p.lessors.length > 0 && (
          <div className="rf-lessors">
            {p.lessors.map((l) => <span key={l.id} className={`chip mk-chip ${l.ok ? 'good' : 'warn'}`} data-tip={l.why}>{l.ok ? `${l.name} ✓` : `${l.name}: ${l.why ?? 'not now'}`}</span>)}
          </div>
        )}
        {p.aocNote && <span className="small warn">{p.aocNote}</span>}
        {p.ageWarning && <span className="small warn">{p.ageWarning}</span>}
      </div>
      <div className="mt-12"><WhatItTakes g={g} typeId={t.id} /></div>
    </Modal>
  );
}
