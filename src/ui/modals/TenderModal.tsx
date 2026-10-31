// v0.14 the bid form of a tender: what the airline asks (base, routes, dates, seats), and our bid: rate per block
// hour against the market rate, MGH, the tail (with its fit), the crew (ours or mixed with their cabin crew) and the
// dates. Send / update / withdraw before the deadline. A closed tender shows the bid and, once decided, the result.

import { Check, CircleAlert, CircleX, FileSignature, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { bidQuote, placeBid, tenderById, tenderRow, withdrawBid } from '../../engine/commercial';
import { DAY, fmtDay } from '../../engine/core/time';
import { Modal, Seg, Stepper } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v * 100))} %`;
const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;

export function TenderModal({ tenderId }: { tenderId: string }) {
  const g = useGame();
  const t = tenderById(g, tenderId);
  const row = t ? tenderRow(g, t) : null;
  const q = useMemo(() => (t?.status === 'open' ? bidQuote(g, tenderId) : null), [g, tenderId, t?.status, Math.floor(g.now / DAY)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rate, setRate] = useState(t?.bid?.rate ?? q?.budget ?? 0);
  const [mgh, setMgh] = useState(t?.bid?.mgh ?? q?.mgh ?? 0);
  const [acId, setAc] = useState(t?.bid?.aircraftId ?? q?.aircraft.find((a) => a.level !== 'no')?.id ?? q?.aircraft[0]?.id ?? '');
  const [crew, setCrew] = useState<'ours' | 'mixed'>(t?.bid?.crew ?? 'ours');
  const [ds, setDs] = useState(t?.bid && q ? Math.round((t.bid.start - t.ask.start) / DAY) : 0);
  const [de, setDe] = useState(t?.bid && q ? Math.round((t.bid.end - t.ask.end) / DAY) : 0);
  const [err, setErr] = useState<string | null>(null);
  if (!t || !row) return null;
  const close = () => store.closeModal();
  const send = () => {
    const r = store.act((gg) => placeBid(gg, tenderId, { rate, mgh, aircraftId: acId, crew, start: t.ask.start + ds * DAY, end: t.ask.end + de * DAY }));
    if (r.ok) close();
    else setErr(r.error);
  };
  const withdraw = () => {
    const r = store.act((gg) => withdrawBid(gg, tenderId));
    if (!r.ok) setErr(r.error);
  };
  const p = t.ask.pattern;
  const footer = q ? (
    <div className="row gap-8 between wrap">
      {t.bid ? <button className="btn" onClick={withdraw}><Undo2 /> Withdraw</button> : <span />}
      <span className="row gap-8">
        <button className="btn" onClick={close}>Close</button>
        <button className="btn btn-primary" onClick={send} disabled={!acId}><FileSignature /> {t.bid ? 'Update bid' : 'Send bid'}</button>
      </span>
    </div>
  ) : <div className="row end"><button className="btn" onClick={close}>Close</button></div>;
  const ac = q?.aircraft.find((a) => a.id === acId);
  return (
    <Modal title={<span>{flag(row.country)} {row.client} · {row.round}</span>} icon={<FileSignature />} onClose={close} footer={footer} className="v14-tender">
      <div className="col gap-12">
        <div className="v8-box col gap-4">
          <b>{row.wanted} based at {city(row.base)}</b>
          <span className="small muted">{fmtDay(row.start)} – {fmtDay(row.end - 1)}{p.kind === 'base' ? ` · ${p.waves.length} wave${p.waves.length > 1 ? 's' : ''} a day to ${row.dests.map(city).slice(0, 5).join(', ')}${row.dests.length > 5 ? '…' : ''}` : ''}</span>
          <span className="small muted">{row.status === 'open' ? `Bids close ${fmtDay(row.deadline)} · about ${row.rivals || 'no'} other operator${row.rivals === 1 ? '' : 's'} bidding` : `Award about ${fmtDay(row.resultAt)}`}{row.invited ? ' · they invited us' : ''}</span>
        </div>
        {q && (
          <>
            <div className="set-row v14-field">
              <div><b>Rate per block hour</b><div className="tiny dim">Market rate {money(q.budget)} · {pct(rate / q.budget - 1)}</div></div>
              <Stepper value={rate} min={q.rateMin} max={q.rateMax} step={10} onChange={setRate} format={(v) => money(v)} />
            </div>
            <div className="set-row v14-field">
              <div><b>MGH a month</b><div className="tiny dim">They ask {q.mgh} · lower is easier for them</div></div>
              <Stepper value={mgh} min={q.mghMin} max={q.mghMax} step={10} onChange={setMgh} format={(v) => `${v} BH`} />
            </div>
            <div className="col gap-4">
              <div className="upper dim">Aircraft</div>
              {q.aircraft.length === 0 && <div className="small warn">No narrowbody in the fleet to bid.</div>}
              {q.aircraft.map((a) => (
                <button key={a.id} className={`v8-row v14-ac ${a.id === acId ? 'on' : ''}`} onClick={() => setAc(a.id)} aria-pressed={a.id === acId}>
                  {a.level === 'ok' ? <Check className="sc-ico-s good" /> : a.level === 'warn' ? <CircleAlert className="sc-ico-s warn" /> : <CircleX className="sc-ico-s bad" />}
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <b className="mono">{a.reg} <span className="small muted">{a.type} · {a.age} years</span></b>
                    {(a.note || a.otherBids > 0) && <span className="tiny dim ellipsis">{[a.note, a.otherBids ? `also in ${a.otherBids} other bid${a.otherBids > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="set-row v14-field">
              <div><b>Crew</b><div className="tiny dim">{crew === 'ours' ? q.crewLabel : `Their cabin crew with our pilots and purser (−${money(q.mixedCut)}/BH each)`}{q.mixedPref ? ' · they like their own cabin crew on board' : ''}</div></div>
              <Seg<'ours' | 'mixed'> value={crew} onChange={setCrew} options={[{ value: 'ours', label: 'Our crew' }, { value: 'mixed', label: 'Mixed' }]} />
            </div>
            <div className="set-row v14-field">
              <div><b>Start</b><div className="tiny dim">They ask {fmtDay(t.ask.start)}</div></div>
              <Stepper value={ds} min={Math.round((q.startRange[0] - t.ask.start) / DAY)} max={Math.round((q.startRange[1] - t.ask.start) / DAY)} step={7} onChange={setDs} format={(v) => fmtDay(t.ask.start + v * DAY)} />
            </div>
            <div className="set-row v14-field">
              <div><b>End</b><div className="tiny dim">They ask {fmtDay(t.ask.end - 1)}</div></div>
              <Stepper value={de} min={Math.round((q.endRange[0] - t.ask.end) / DAY)} max={Math.round((q.endRange[1] - t.ask.end) / DAY)} step={7} onChange={setDe} format={(v) => fmtDay(t.ask.end - 1 + v * DAY)} />
            </div>
            {ac?.level === 'no' && <div className="small warn">{ac.reg} cannot fly it as things stand: if you win, you sign on another aircraft or let it go.</div>}
            {err && <div className="small bad">{err}</div>}
          </>
        )}
        {!q && t.bid && (
          <div className="small">Your bid: {money(t.bid.rate)}/BH · MGH {t.bid.mgh} · {g.fleet[t.bid.aircraftId]?.reg ?? '—'} · {t.bid.crew === 'mixed' ? 'mixed crew' : 'our crew'} · {fmtDay(t.bid.start)} – {fmtDay(t.bid.end - 1)}</div>
        )}
        {row.result && (
          <div className={`small ${row.status === 'won' ? 'good' : 'warn'}`}>{row.status === 'won' ? `Won: ${row.result.why}.` : `${row.result.winnerName} won: ${row.result.why}.`}</div>
        )}
        {row.status === 'noBid' && <div className="small dim">Closed: you did not bid.</div>}
        {row.status === 'withdrawn' && <div className="small dim">Withdrawn: the airline no longer flies.</div>}
      </div>
    </Modal>
  );
}
