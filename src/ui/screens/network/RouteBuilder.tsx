// v0.19.2 build your own route (player: "why can't I also build my own route to any destination I like?"). Pick
// one of our bases, any airport in the game's list (search by city, code or country), see the map, the fuel stops the
// chosen aircraft needs (suggested, editable) and a first look at the market with its honest spread; then order the
// study and follow the same staged launch as the catalogue's routes (LaunchWizard).

import { ArrowLeft, Compass, MapPin, Play, Plus, Rocket, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { countryName, flag } from '../../../data/countries';
import { SEGMENT_LABEL, stationFor, type RouteMarket } from '../../../data/routes';
import { BAL } from '../../../engine/core/balance';
import { distance } from '../../../engine/core/geo';
import { blockMinutes, etopsCap, typeOf } from '../../../engine/core/perf';
import { fmtSpan } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import {
  catalogueOf, chainProblem, customBlock, customId, customMarket, customRange, routeBases, studyAccuracy, studyBlock, suggestStops,
} from '../../../engine/network';
import type { RouteModel, Segment, StudyDepth } from '../../../engine/network/types';
import { Modal, Seg } from '../../components/ui';
import { int, money } from '../../format';
import { store, useGame } from '../../store';
import { net } from './netApi';
import { hhmm, MODEL_HINT, rightsWord, searchAirports } from './networkLogic';
import { RouteMap } from './RouteMap';

const DEPTHS: StudyDepth[] = ['desk', 'full', 'survey'];
const DEPTH_WORD: Record<StudyDepth, string> = { desk: 'Desk study', full: 'Full study', survey: 'Full + survey' };
const MODEL_WORD: Record<RouteModel, string> = { own: 'Own brand', partner: 'For a partner', tour: 'Holidays charter' };
const DAY_NAME = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const pctOf = (v: number) => `${Math.round(v * 100)} %`;

function Picker({ label, value, exclude, onPick, placeholder }: { label: string; value?: string; exclude: string[]; onPick: (code: string) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchAirports(q, exclude), [q, exclude.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = value ? AIRPORT_BY_CODE[value] : undefined;
  return (
    <div className="rb-pick">
      <label className="rb-search">
        <Search className="sc-ico-s dim" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={a ? `${a.city} (${a.code}) · ${placeholder}` : placeholder} aria-label={label} autoComplete="off" spellCheck={false} />
        {q && <button className="rb-clear" onClick={() => setQ('')} aria-label="Clear the search"><X className="sc-ico-s" /></button>}
      </label>
      {hits.length > 0 && (
        <div className="rb-hits" role="listbox" aria-label={`${label}: matches`}>
          {hits.map((h) => (
            <button key={h.code} role="option" aria-selected={h.code === value} className="rb-hit" onClick={() => { onPick(h.code); setQ(''); }}>
              <span className="nw-flag" aria-hidden>{flag(h.country)}</span>
              <span className="col grow rb-hit-text"><b className="ellipsis">{h.city}</b><span className="tiny muted ellipsis">{h.name} · {countryName(h.country)}</span></span>
              <span className="mono small muted">{h.code}</span>
            </button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && !hits.length && <div className="tiny muted rb-none">No airport matches “{q.trim()}”.</div>}
    </div>
  );
}

function SeasonBars({ v }: { v: number[] }) {
  const max = Math.max(...v, 1);
  return (
    <div className="rb-season" aria-label="Season: travellers by month against the year's average">
      {v.map((x, i) => (
        <span key={i} className="rb-sb" title={`${MON[i]}: ${Math.round(x * 100)} % of an average month`}>
          <i style={{ height: `${Math.max(8, (x / max) * 100)}%` }} />
          <em className="tiny dim">{MON[i]}</em>
        </span>
      ))}
    </div>
  );
}

function MarketPreview({ m, typeId }: { m: RouteMarket; typeId: string }) {
  const r = customRange(m);
  const segs = (Object.entries(m.segments) as [Segment, number][]).filter(([, v]) => v >= 0.03).sort((a, b) => b[1] - a[1]);
  const nonstop = m.competitors.filter((c) => c.stops === 0);
  const one = m.competitors.filter((c) => c.stops > 0);
  const st = stationFor(m.to);
  const km = Math.round(distance(m.from, m.to));
  const cargo = [m.cargo.south ? `${Math.round(m.cargo.south / 100) / 10} t out` : '', m.cargo.north ? `${Math.round(m.cargo.north / 100) / 10} t back` : 'none back'].filter(Boolean).join(' · ');
  const tt = m.timetable;
  let blk = 0;
  try { blk = blockMinutes(typeId, m.from, m.to); } catch { blk = 0; }
  return (
    <div className="col gap-10 rb-market">
      <div className="rb-size">
        <span className="tiny dim upper">Travellers a year, both ways</span>
        <b className="num">about {int(r.mid)}</b>
        <span className="small muted">a first guess from the airports and the ties: anywhere from {int(r.lo)} to {int(r.hi)}. A study narrows it.</span>
      </div>
      <p className="small nw-blurb">{m.blurb}</p>
      <div className="rb-segs" aria-label="Who travels">
        {segs.map(([k, v]) => (
          <span key={k} className="rb-seg"><span className="small">{SEGMENT_LABEL[k]}</span><span className="rb-seg-bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></span><span className="tiny num muted">{pctOf(v)}</span></span>
        ))}
      </div>
      <div><span className="tiny dim upper">Season</span><SeasonBars v={m.season ?? BAL.v019.demand.season} /></div>
      <div className="nw-facts">
        <div><span>Distance</span><b className="num">{int(km)} km{blk ? ` · about ${Math.floor(blk / 60)} h ${String(blk % 60).padStart(2, '0')}` : ''}</b></div>
        <div><span>Nonstop rivals</span><b>{nonstop.length ? nonstop.map((c) => `${c.name} ${c.perWeek}/wk`).join(', ') : 'none: we would be the only one'}</b></div>
        <div><span>One-stop rivals</span><b>{one.length ? one.map((c) => c.name).join(', ') : 'none'}</b></div>
        <div><span>Economy fares</span><b className="num">{money(m.fareY[0])}–{money(m.fareY[1])} one way</b></div>
        <div><span>Cargo a rotation</span><b>{cargo}</b></div>
        <div><span>Traffic rights</span><b>{rightsWord(m.rightsHard ?? 0)}</b></div>
        <div><span>At {m.to}</span><b>fuel {st.fuelX >= 1 ? '+' : '−'}{Math.abs(Math.round((st.fuelX - 1) * 100))} % on the world price · charges {money(st.airport)} a widebody turn · handling {money(st.handling)}</b></div>
        <div><span>Usual timetable</span><b>Weekly, {DAY_NAME[tt.day]} {hhmm(tt.out)}{tt.nights ? `, ${tt.nights} night there` : ', back the same day'}</b></div>
        {m.risk && <div><span>Risk</span><b>{[m.risk.coup ? `unrest (${pctOf(m.risk.coup)} a year)` : '', m.risk.fx ? `ticket cash can be stuck (${pctOf(m.risk.fx)})` : ''].filter(Boolean).join(' · ')}</b></div>}
      </div>
    </div>
  );
}

function fleetTypes(g: GameState): string[] {
  const ids = [...new Set(Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').map((a) => a.typeId))];
  const range = (id: string) => { try { return typeOf(id).rangeNm; } catch { return 0; } };
  return ids.sort((a, b) => range(b) - range(a));
}

export function RouteBuilder({ from: from0, to: to0 }: { from?: string; to?: string }) {
  const g = useGame();
  const bases = useMemo(() => routeBases(g), [g]);
  const types = useMemo(() => {
    const t = fleetTypes(g);
    return t.length ? t : ['b763'];
  }, [g]);
  const [from, setFrom] = useState(from0 && bases.includes(from0) ? from0 : bases[0]);
  const [to, setTo] = useState<string | undefined>(to0);
  const [typeId, setTypeId] = useState(types[0]);
  const [stops, setStops] = useState<{ via: string[]; viaBack: string[] } | null>(null);
  const [addStop, setAddStop] = useState(false);
  const [depth, setDepth] = useState<StudyDepth>('full');
  const [model, setModel] = useState<RouteModel>('own');
  const close = () => store.closeModal();
  const tname = (id: string) => { try { return typeOf(id).name; } catch { return id; } };
  // Fuel stops: suggested for the aircraft (within our ETOPS approval) until the player edits them.
  const auto = useMemo(() => (to ? suggestStops(g, typeId, from, to) : null), [g, typeId, from, to]);
  const via = stops?.via ?? (auto && 'via' in auto ? auto.via : []);
  const viaBack = stops?.viaBack ?? (auto && 'via' in auto ? auto.viaBack : []);
  const draft = to ? { from, to, via, viaBack } : null;
  const m = draft ? customMarket(draft) : null;
  const cat = to ? catalogueOf(from, to) : undefined;
  const id = draft ? customId(draft) : '';
  const block = draft ? customBlock(draft) ?? studyBlock(g, id) : null;
  const fit = m ? chainProblem(m, typeId, etopsCap(g.company.approvals, typeId)) : null;
  const autoWhy = auto && 'why' in auto ? auto.why : null;
  const models = m?.models ?? ['own'];
  const md = models.includes(model) ? model : models[0];
  const acc = studyAccuracy(depth, true);
  const cfg = BAL.v019.launch.study[depth];
  const pickTo = (c: string) => { setTo(c); setStops(null); setAddStop(false); };
  const pickFrom = (c: string) => { setFrom(c); setStops(null); };
  const go = () => {
    if (!m) return;
    const res = store.act((gg) => {
      const x = net.startStudy(gg, m.id, depth, md);
      return x.routeId ? { ok: true, msg: `Study started: ${m.city}` } : { ok: false, error: x.why ?? 'Could not start the study.' };
    });
    if (res.ok) {
      const rid = Object.values(store.game?.network?.routes ?? {}).find((x) => x.marketId === m.id && x.status !== 'closed')?.id;
      if (rid) store.openModal({ kind: 'routeLaunch', routeId: rid });
      else close();
    }
  };
  const A = AIRPORT_BY_CODE[from];
  const B = to ? AIRPORT_BY_CODE[to] : undefined;
  return (
    <Modal title={B ? `${A?.city ?? from} – ${B.city}` : 'Build your own route'} icon={<Compass className="accent" />} onClose={close} size="xwide" className="nw-modal rb" footer={
      <>
        <button className="btn btn-ghost" onClick={() => store.openModal({ kind: 'routeLaunch' })}><ArrowLeft /> Suggestions</button>
        <span className="grow" />
        <button className="btn" onClick={close}>Not now</button>
        {cat ? (
          <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'routeLaunch', marketId: cat.id })}><Rocket /> Open the researched market</button>
        ) : (
          <button className="btn btn-primary" disabled={!m || !!block || !!fit} onClick={go}><Play /> Order the study{m ? ` · ${money(cfg.cost)}` : ''}</button>
        )}
      </>
    }>
      <div className="rb-grid">
        <div className="col gap-12 rb-form">
          <div className="col gap-6">
            <span className="upper dim">From</span>
            {bases.length > 4 ? (
              <select className="nw-select" value={from} onChange={(e) => pickFrom(e.target.value)} aria-label="Origin base">
                {bases.map((b) => <option key={b} value={b}>{AIRPORT_BY_CODE[b]?.city ?? b} ({b})</option>)}
              </select>
            ) : bases.length > 1 ? (
              <Seg<string> value={from} onChange={pickFrom} options={bases.map((b) => ({ value: b, label: `${AIRPORT_BY_CODE[b]?.city ?? b}` }))} />
            ) : (
              <div className="small"><MapPin className="sc-ico-s accent" /> {A?.city ?? from} <span className="mono muted">{from}</span> <span className="tiny muted">· our base</span></div>
            )}
          </div>
          <div className="col gap-6">
            <span className="upper dim">To</span>
            <Picker label="Destination" value={to} exclude={[from]} onPick={pickTo} placeholder="city, airport code or country" />
          </div>
          <div className="col gap-6">
            <span className="upper dim">Planned on</span>
            <select className="nw-select" value={typeId} onChange={(e) => { setTypeId(e.target.value); setStops(null); }} aria-label="Aircraft type for the plan">
              {types.map((t) => <option key={t} value={t}>{tname(t)}</option>)}
            </select>
            <span className="tiny muted">For the range ring and the fuel stops; the study tries every size.</span>
          </div>
          {to && (
            <div className="col gap-6">
              <div className="row between"><span className="upper dim">Fuel stops</span>{stops && <button className="btn btn-ghost btn-sm" onClick={() => setStops(null)}><Sparkles /> Suggest</button>}</div>
              <div className="rb-stops">
                {via.length === 0 && viaBack.length === 0 && <span className="small muted">{autoWhy ?? 'None: nonstop both ways.'}</span>}
                {via.map((s) => (
                  <span key={`o${s}`} className="rb-stop"><span className="mono small">{s}</span><span className="tiny muted">{AIRPORT_BY_CODE[s]?.city}</span>
                    <button aria-label={`Remove the stop at ${s}`} onClick={() => setStops({ via: via.filter((x) => x !== s), viaBack: viaBack.filter((x) => x !== s) })}><X className="sc-ico-s" /></button>
                  </span>
                ))}
                {viaBack.filter((s) => !via.includes(s)).map((s) => (
                  <span key={`b${s}`} className="rb-stop back"><span className="mono small">{s}</span><span className="tiny muted">back only</span>
                    <button aria-label={`Remove the stop at ${s}`} onClick={() => setStops({ via, viaBack: viaBack.filter((x) => x !== s) })}><X className="sc-ico-s" /></button>
                  </span>
                ))}
                {via.length + viaBack.length < 4 && !addStop && <button className="btn btn-ghost btn-sm" onClick={() => setAddStop(true)}><Plus /> Add a stop</button>}
              </div>
              {addStop && <Picker label="Fuel stop" exclude={[from, to, ...via]} onPick={(c) => { setStops({ via: [...via, c], viaBack: [c, ...viaBack] }); setAddStop(false); }} placeholder="a stop on the way" />}
              {fit && <span className="small warn">{fit}</span>}
            </div>
          )}
        </div>
        <div className="rb-map">
          <RouteMap from={from} to={to} via={via} viaBack={viaBack} typeId={typeId} rivals={m?.competitors} />
        </div>
      </div>
      {!to && <p className="small muted rb-hint">Any airport in our list is a destination: search by city, code or country. Most pairs nobody flies are thin; strong ones are where people are tied (family, work, holidays).</p>}
      {cat && <div className="small warn rb-cat">{cat.city} from {AIRPORT_BY_CODE[cat.from]?.city} is one of the suggested markets, already researched: open it there.</div>}
      {m && !cat && (
        <div className="rb-below">
          {block && <div className="small warn">{block}</div>}
          <MarketPreview m={m} typeId={typeId} />
          {models.length > 1 && (
            <div className="col gap-6">
              <span className="upper dim">How we sell it</span>
              <Seg<RouteModel> value={md} onChange={setModel} options={models.map((x) => ({ value: x, label: MODEL_WORD[x] }))} />
              <span className="tiny muted">{MODEL_HINT[md]}</span>
            </div>
          )}
          <div className="col gap-6">
            <span className="upper dim">Step 1 · Market study</span>
            <div className="nw-depths">
              {DEPTHS.map((d) => {
                const c = BAL.v019.launch.study[d];
                return (
                  <button key={d} className={`nw-depth ${depth === d ? 'on' : ''}`} onClick={() => setDepth(d)} aria-pressed={depth === d}>
                    <b>{DEPTH_WORD[d]}</b>
                    <span className="small num">{money(c.cost)} · {fmtSpan(Math.max(1, Math.round(c.days[0] / 7)), Math.max(1, Math.round(c.days[1] / 7)), 'weeks')}</span>
                    <span className="tiny muted">estimate within ±{Math.round(studyAccuracy(d, true) * 100)} %</span>
                  </button>
                );
              })}
            </div>
            <span className="tiny muted">Nobody has researched this pair, so every study is a little less sure than for the suggestions (±{Math.round(acc * 100)} % for this one). Then the same launch: business case, rights, slots, brand, distribution, timetable on sale, campaign, stations, crew briefings and the first flight.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
