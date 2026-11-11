// v0.14 the bid form of a tender: what the airline asks (base, routes, dates, seats), and our bid: rate per block
// hour against the market rate, MGH, the tail (with its fit), the crew (ours or mixed with their cabin crew) and the
// dates. Send / update / withdraw before the deadline. A closed tender shows the bid and, once decided, the result.

import { Check, CircleAlert, CircleX, FileSignature, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { bidAircraft, bidQuote, offerWithBid, placeBid, TENDER, tenderById, tenderRow, withdrawBid } from '../../engine/commercial';
import { DAY, fmtDay, fmtDayAt, toLocal } from '../../engine/core/time';
import { Modal, Seg, Stepper } from '../components/ui';
import { BodyTag, KindTag } from '../components/ShapeTags';
import { DurationStrip } from '../components/DurationStrip';
import { tenderFacts } from '../screens/Tenders';
import { store, useGame } from '../store';

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v * 100))} %`;
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
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
  // v0.14 each tail's fit on the terms as set (dates, crew): the offer dialog's feasibility, live with the form.
  const start = t ? t.ask.start + ds * DAY : 0;
  const end = t ? t.ask.end + de * DAY : 0;
  const fits = useMemo(() => (q ? bidAircraft(g, tenderId, { rate, mgh, start, end, crew }) : []), [g, q, tenderId, start, end, crew, Math.floor(g.now / DAY)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t || !row) return null;
  const ac = fits.find((a) => a.id === acId);
  // v0.14.1 Mixed: their cabin crew on our aircraft, the rate cut by mixedCut each (what we are paid is shown).
  const acFull = g.fleet[acId];
  const mixedTerms = crew === 'mixed' && acFull ? offerWithBid(t!, { rate, mgh, start, end, crew }, acFull.typeId, acFull.cabin.total) : null;
  const theirCabin = mixedTerms?.requirements.clientCabin?.n ?? 0;
  const netRate = mixedTerms && mixedTerms.product.kind === 'wet' ? mixedTerms.product.ratePerBH : rate;
  const close = () => store.closeModal();
  const send = () => {
    const r = store.act((gg) => placeBid(gg, tenderId, { rate, mgh, aircraftId: acId, crew, start, end }));
    if (r.ok) close();
    else setErr(r.error);
  };
  const withdraw = () => {
    const r = store.act((gg) => withdrawBid(gg, tenderId));
    if (!r.ok) setErr(r.error);
  };
  const p = t.ask.pattern;
  // v0.14.1 programme days on the base's local calendar (the airline's own dates; UTC is the evening before).
  const day = (m: number) => fmtDayAt(row.base, m);
  const footer = q ? (
    <div className="row gap-8 between wrap">
      {t.bid ? <button className="btn" onClick={withdraw}><Undo2 /> Withdraw</button> : <span />}
      <span className="row gap-8">
        <button className="btn" onClick={close}>Close</button>
        <button className="btn btn-primary" onClick={send} disabled={!acId || ac?.level === 'no'}><FileSignature /> {t.bid ? 'Update bid' : 'Send bid'}</button>
      </span>
    </div>
  ) : <div className="row end"><button className="btn" onClick={close}>Close</button></div>;
  return (
    <Modal title={<span className="row gap-8" style={{ alignItems: 'center' }}><span className="ellipsis">{flag(row.country)} {row.client} · {row.round}</span><BodyTag body={row.body} /></span>} icon={<FileSignature />} onClose={close} footer={footer} className="v14-tender">
      <div className="col gap-12">
        <div className="v8-box col gap-4">
          <b>{row.wanted.replace(/^a/, (m) => m.toUpperCase())} {p.kind === 'base' ? `based at ${city(row.base)}` : `from ${city(row.base)} to Jeddah and Madinah`}</b>
          {t.ask.title && <span className="small">{t.ask.title}</span>}
          <span className="small muted">{day(row.start)} – {day(row.end - 1)}{p.kind === 'base' ? ` · ${p.waves.length} wave${p.waves.length > 1 ? 's' : ''} a day to ${row.dests.map(city).slice(0, 5).join(', ')}${row.dests.length > 5 ? '…' : ''}` : ''}</span>
          {/* v0.20.1 how long it runs (the dates as bid), then the contest in facts; what a tender is sits behind the '?'. */}
          <DurationStrip now={g.now} first={toLocal(row.base, q ? start : t.bid?.start ?? row.start)} last={toLocal(row.base, (q ? end : t.bid?.end ?? row.end) - 1)} />
          <span className="row gap-8 wrap v0201-kind-row">
            {row.status === 'open' && <KindTag kind="tender" />}
            <span className="small muted">{tenderFacts(row)}{row.invited ? ' · they invited us' : ''}</span>
          </span>
        </div>
        {q && (
          <>
            <div className="set-row v14-field">
              <div><b>Rate per block hour</b><div className="tiny dim">Market rate {usd(q.budget)} · {pct(rate / q.budget - 1)}</div></div>
              <Stepper value={rate} min={q.rateMin} max={q.rateMax} step={10} onChange={setRate} format={(v) => usd(v)} />
            </div>
            <div className="set-row v14-field">
              <div><b>MGH a month</b><div className="tiny dim">They ask {q.mgh} · lower is easier for them</div></div>
              <Stepper value={mgh} min={q.mghMin} max={q.mghMax} step={10} onChange={setMgh} format={(v) => `${v} BH`} />
            </div>
            <div className="col gap-4">
              <div className="upper dim">Aircraft</div>
              {fits.length === 0 && <div className="small warn">No {row.body === 'wide' ? 'widebody' : 'narrowbody'} in the fleet to bid.</div>}
              {fits.map((a) => (
                <button key={a.id} className={`v8-row v14-tn-ac ${a.id === acId ? 'on' : ''}`} onClick={() => setAc(a.id)} aria-pressed={a.id === acId}>
                  {a.level === 'ok' ? <Check className="sc-ico-s good" /> : a.level === 'warn' ? <CircleAlert className="sc-ico-s warn" /> : <CircleX className="sc-ico-s bad" />}
                  <span className="col grow" style={{ minWidth: 0 }}>
                    <b className="mono">{a.reg} <span className="small muted">{a.type} · {a.age} years</span></b>
                    {(a.note || a.otherBids > 0) && <span className="tiny dim ellipsis">{[a.note, a.otherBids ? `also in ${a.otherBids} other bid${a.otherBids > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="set-row v14-field">
              <div><b>Crew</b><div className="tiny dim">{crew === 'ours' ? q.crewLabel : theirCabin ? `${theirCabin} of their cabin crew with our pilots and purser: −${usd(q.mixedCut)}/BH each, ${usd(netRate)}/BH to us` : `Their cabin crew with our pilots and purser (−${usd(q.mixedCut)}/BH each)`}{q.mixedPref ? ' · they like their own cabin crew on board' : ''}</div></div>
              <Seg<'ours' | 'mixed'> value={crew} onChange={setCrew} options={[{ value: 'ours', label: 'Our crew' }, { value: 'mixed', label: 'Mixed' }]} />
            </div>
            {q.fixed && <div className="small muted">Dates fixed by the Hajj calendar: {day(t.ask.start)} – {day(t.ask.end - 1)}. The pilgrims fly in and home on these days, so the bid takes them as they are.</div>}
            {!q.fixed && <><div className="set-row v14-field">
              <div><b>Start</b><div className="tiny dim">They ask {day(t.ask.start)}{q.startRange[0] > t.ask.start + TENDER.startShift[0] * DAY ? ` · not before ${day(q.startRange[0])}: they decide ${fmtDay(row.resultAt)}` : ''}</div></div>
              <Stepper value={ds} min={Math.round((q.startRange[0] - t.ask.start) / DAY)} max={Math.round((q.startRange[1] - t.ask.start) / DAY)} step={7} onChange={setDs} format={(v) => day(t.ask.start + v * DAY)} />
            </div>
            <div className="set-row v14-field">
              <div><b>End</b><div className="tiny dim">They ask {day(t.ask.end - 1)}</div></div>
              <Stepper value={de} min={Math.round((q.endRange[0] - t.ask.end) / DAY)} max={Math.round((q.endRange[1] - t.ask.end) / DAY)} step={7} onChange={setDe} format={(v) => day(t.ask.end - 1 + v * DAY)} />
            </div></>}
            {ac?.level === 'no' && <div className="small bad">{ac.reg} cannot fly it on these dates{ac.note ? `: ${ac.note}` : ''}. Choose another aircraft or other dates.</div>}
            {ac?.level !== 'no' && <div className="tiny dim">Checked again at the award: if {ac?.reg ?? 'the aircraft'} can no longer fly it then, you have {TENDER.signDays} days to sign it on another aircraft.</div>}
            {err && <div className="small bad">{err}</div>}
          </>
        )}
        {!q && t.bid && (
          <div className="small">Your bid: {usd(t.bid.rate)}/BH · MGH {t.bid.mgh} · {g.fleet[t.bid.aircraftId]?.reg ?? '—'} · {t.bid.crew === 'mixed' ? 'mixed crew' : 'our crew'} · {day(t.bid.start)} – {day(t.bid.end - 1)}</div>
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
