import { ArrowLeft, ArrowRight, Check, Rocket } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORTS_BY_REGION, SIZE_LABEL } from '../../data/airports';
import { COUNTRIES, flag } from '../../data/countries';
import { CONTINENT_ORDER, CONTINENTS, REGIONS, REGION_BY_ID } from '../../data/regions';
import { airportMass, baseCompetition, baseDemand } from '../../engine/demand';
import { HUB_MONTHLY } from '../../engine/economy';
import { distance } from '../../engine/geo';
import { DIFFICULTY } from '../../engine/newGame';
import { regionMass } from '../../engine/progression';
import type { Difficulty, Livery, TailStyle } from '../../engine/types';
import { AircraftArt } from '../components/AircraftArt';
import { LogoMark, TailBadge } from '../components/Logo';
import { Bar, Seg } from '../components/ui';
import { money } from '../format';
import { WorldMap } from '../map/WorldMap';
import { store } from '../store';

const PALETTE = ['#1e4fd8', '#0f9d76', '#d6283c', '#7a3cff', '#ff7a00', '#0b1f4d', '#e0457b', '#00a3c4', '#c8a000', '#202733', '#5e2ca5', '#2bb34a'];
const SECONDARY = ['#ffffff', '#3ee6ff', '#f5c451', '#ff5d8f', '#9be15d', '#ff8a00', '#c0c7d6', '#111827'];
const STEPS = ['Region', 'Hub', 'Brand', 'Launch'];

const NAMES = ['Aurora Air', 'Skylark Airways', 'Meridian Air', 'Cirrus Airlines', 'Vela Airways', 'Northwind Air', 'Solstice Airways', 'Halcyon Air', 'Zephyr Airlines', 'Polaris Air'];

function regionStats(id: string) {
  const aps = AIRPORTS_BY_REGION[id];
  const mass = regionMass(id);
  const comp = aps.reduce((s, a) => s + a.size, 0) / aps.length;
  return { aps, mass, comp };
}

export function NewGame() {
  const [step, setStep] = useState(0);
  const [region, setRegion] = useState('IBE');
  const [hub, setHub] = useState('MAD');
  const [name, setName] = useState(() => NAMES[Math.floor(Math.random() * NAMES.length)]);
  const [code, setCode] = useState('');
  const [ceo, setCeo] = useState('');
  const [livery, setLivery] = useState<Livery>({ primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' });
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const derivedCode = (code || name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase().padEnd(2, 'X');

  const maxMass = useMemo(() => Math.max(...REGIONS.map((r) => regionMass(r.id))), []);
  const hubOptions = useMemo(() => {
    const aps = AIRPORTS_BY_REGION[region];
    return aps
      .map((a) => {
        const market = aps.filter((b) => b.code !== a.code && distance(a.code, b.code) >= 150).reduce((s, b) => s + baseDemand(a.code, b.code), 0);
        const comp = aps.filter((b) => b.code !== a.code).reduce((s, b) => s + baseCompetition(a.code, b.code), 0) / Math.max(1, aps.length - 1);
        return { a, market, comp };
      })
      .sort((x, y) => y.market - x.market);
  }, [region]);
  const maxMarket = Math.max(...hubOptions.map((h) => h.market));
  const rotate = REGION_BY_ID[region].continent === 'OC' ? -150 : 0;

  const pickRegion = (id: string) => {
    setRegion(id);
    const best = AIRPORTS_BY_REGION[id].slice().sort((a, b) => airportMass(b) - airportMass(a))[0];
    setHub(best.code);
  };

  const launch = () => {
    store.startNewGame({ name, code: derivedCode, ceo: ceo || 'You', livery, hub, difficulty });
  };

  const mapAirports = AIRPORTS_BY_REGION[region].map((a) => ({ code: a.code, state: a.code === hub && step >= 1 ? ('hub' as const) : ('open' as const), label: step === 1 }));

  return (
    <div className="newgame">
      <header className="ng-head">
        <div className="row gap-12">
          <LogoMark size={36} />
          <div>
            <div className="upper dim">New airline</div>
            <h2>{['Choose your home region', 'Choose your hub airport', 'Design your brand', 'Ready for take-off'][step]}</h2>
          </div>
        </div>
        <ol className="ng-steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'active' : i < step ? 'done' : ''}>
              <span className="n">{i < step ? <Check size={12} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </header>

      <div className="ng-body">
        <div className="ng-panel">
          {step === 0 && (
            <div className="ng-regions">
              {CONTINENT_ORDER.map((c) => (
                <div key={c}>
                  <div className="upper ng-cont" style={{ color: CONTINENTS[c].color }}>{CONTINENTS[c].name}</div>
                  <div className="grid-2">
                    {REGIONS.filter((r) => r.continent === c).map((r) => {
                      const st = regionStats(r.id);
                      return (
                        <button key={r.id} className={`card region-card hoverable ${region === r.id ? 'selected' : ''}`} onClick={() => pickRegion(r.id)}>
                          <div className="row between">
                            <b>{r.name}</b>
                            <span className="dim small">{st.aps.length} airports</span>
                          </div>
                          <div className="rc-bars">
                            <span className="dim tiny">Market</span><Bar value={st.mass / maxMass} />
                            <span className="dim tiny">Rivals</span><Bar value={(st.comp - 1) / 4} tone="warn" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="col gap-8">
              <p className="muted small">Your hub is where your aircraft are based and every route starts. Big hubs have huge markets — and fierce competition and higher costs. You can open more hubs later.</p>
              {hubOptions.map(({ a, market, comp }, i) => (
                <button key={a.code} className={`card hub-card hoverable ${hub === a.code ? 'selected' : ''}`} onClick={() => setHub(a.code)}>
                  <div className="row between">
                    <div className="row gap-8">
                      <span className="code">{a.code}</span>
                      <b>{a.city}</b>
                      <span className="dim small">{flag(a.country)} {a.name}</span>
                    </div>
                    {i === 0 && <span className="badge accent">Largest market</span>}
                  </div>
                  <div className="hub-stats">
                    <div><span className="dim tiny">Size</span><span className="small">{SIZE_LABEL[a.size]}</span></div>
                    <div><span className="dim tiny">Local market</span><Bar value={market / maxMarket} /></div>
                    <div><span className="dim tiny">Competition</span><Bar value={comp / 1.6} tone="warn" /></div>
                    <div><span className="dim tiny">Hub cost</span><span className="small num">{money(HUB_MONTHLY[a.size] * 0.15)}–{money(HUB_MONTHLY[a.size])}/mo</span></div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {step === 2 && (
            <div className="col gap-16">
              <div className="grid-2">
                <div className="field">
                  <label>Airline name</label>
                  <input className="input" value={name} maxLength={28} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label>Airline code (IATA)</label>
                  <input className="input mono" value={code} placeholder={derivedCode} maxLength={2} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
                </div>
              </div>
              <div className="field">
                <label>Your name (CEO)</label>
                <input className="input" value={ceo} placeholder="You" maxLength={28} onChange={(e) => setCeo(e.target.value)} />
              </div>
              <div className="field">
                <label>Primary colour</label>
                <div className="swatches">
                  {PALETTE.map((c) => <button key={c} className={`swatch ${livery.primary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, primary: c })} aria-label={c} />)}
                  <input type="color" className="swatch-input" value={livery.primary} onChange={(e) => setLivery({ ...livery, primary: e.target.value })} aria-label="Custom primary colour" />
                </div>
              </div>
              <div className="field">
                <label>Accent colour</label>
                <div className="swatches">
                  {SECONDARY.map((c) => <button key={c} className={`swatch ${livery.secondary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, secondary: c })} aria-label={c} />)}
                  <input type="color" className="swatch-input" value={livery.secondary} onChange={(e) => setLivery({ ...livery, secondary: e.target.value })} aria-label="Custom accent colour" />
                </div>
              </div>
              <div className="field">
                <label>Tail design</label>
                <Seg<TailStyle> value={livery.tail} onChange={(tail) => setLivery({ ...livery, tail })} options={[
                  { value: 'solid', label: 'Solid' }, { value: 'split', label: 'Split' }, { value: 'stripe', label: 'Stripe' }, { value: 'sweep', label: 'Sweep' },
                ]} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="col gap-12">
              <div className="label">Difficulty</div>
              {(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => (
                <button key={d} className={`card diff-card hoverable ${difficulty === d ? 'selected' : ''}`} onClick={() => setDifficulty(d)}>
                  <div className="row between"><b>{DIFFICULTY[d].label}</b><span className="num">{money(DIFFICULTY[d].cash, 0)}</span></div>
                  <div className="small muted">{DIFFICULTY[d].desc}</div>
                </button>
              ))}
              <div className="card ng-summary">
                <div className="row gap-12">
                  <TailBadge primary={livery.primary} secondary={livery.secondary} code={derivedCode} size={44} />
                  <div>
                    <b className="big">{name}</b>
                    <div className="small muted">{derivedCode} · Based at {hub} · {REGION_BY_ID[region].name}</div>
                  </div>
                </div>
                <ul className="ng-tips small muted">
                  <li>Lease or buy your first aircraft in the <b>Aircraft Market</b>.</li>
                  <li>Open routes from your hub in the <b>Route Planner</b> and assign aircraft.</li>
                  <li>Grow to unlock new regions, then whole continents.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="ng-visual">
          {step < 2 ? (
            <div className="ng-map card">
              <WorldMap rotate={rotate} routes={step === 1 ? AIRPORTS_BY_REGION[region].filter((a) => a.code !== hub && distance(hub, a.code) >= 150).map((a) => ({ id: a.code, from: hub, to: a.code, weight: Math.min(1, baseDemand(hub, a.code) / 1500), dashed: true })) : []} airports={mapAirports} fit={AIRPORTS_BY_REGION[region].map((a) => a.code)} fitPad={[10, 10, 210, 10]} interactive={step === 1} onSelect={(c) => c && AIRPORTS_BY_REGION[region].some((a) => a.code === c) && setHub(c)} controls={false} animate={false} />
              <div className="ng-map-caption">
                <div className="upper" style={{ color: CONTINENTS[REGION_BY_ID[region].continent].color }}>{CONTINENTS[REGION_BY_ID[region].continent].name}</div>
                <h3>{REGION_BY_ID[region].name}</h3>
                <p className="small muted">{REGION_BY_ID[region].blurb}</p>
                <div className="row wrap gap-4 mt-8">
                  {[...new Set(AIRPORTS_BY_REGION[region].map((a) => a.country))].map((c) => <span key={c} className="chip">{flag(c)} {COUNTRIES[c]?.name}</span>)}
                </div>
              </div>
            </div>
          ) : (
            <div className="ng-livery card">
              <div className="upper dim">Livery preview</div>
              <div className="livery-stage">
                <AircraftArt typeId="a320neo" livery={livery} code={derivedCode} name={name} />
              </div>
              <div className="grid-2">
                <AircraftArt typeId="atr72" livery={livery} code={derivedCode} name={name} />
                <AircraftArt typeId="b789" livery={livery} code={derivedCode} name={name} />
              </div>
            </div>
          )}
        </div>
      </div>

      <footer className="ng-foot">
        <button className="btn btn-ghost" onClick={() => (step === 0 ? store.setScreen('title') : setStep(step - 1))}>
          <ArrowLeft /> {step === 0 ? 'Back to menu' : 'Back'}
        </button>
        {step < 3 ? (
          <button className="btn btn-primary btn-lg" onClick={() => setStep(step + 1)} disabled={step === 2 && !name.trim()}>
            Continue <ArrowRight />
          </button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={launch}>
            <Rocket /> Launch {name}
          </button>
        )}
      </footer>
    </div>
  );
}
