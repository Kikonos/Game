// New Game (B5 polishes): company name, code and livery, home base from the five ACMI bases,
// scenario "Startup". Skeleton version by the architect. DESIGN.md §6.3.

import { ArrowLeft, Rocket } from 'lucide-react';
import { useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { flag } from '../../data/countries';
import { COMPANY_PRESETS, HOME_BASES } from '../../data/naming';
import type { Livery, TailStyle } from '../../engine/core/types';
import { BAL } from '../../engine/core/balance';
import { AircraftArt } from '../components/AircraftArt';
import { LogoMark, TailBadge } from '../components/Logo';
import { Seg } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const PALETTE = ['#1e4fd8', '#0f9d76', '#d6283c', '#7a3cff', '#ff7a00', '#0b1f4d', '#e0457b', '#00a3c4', '#c8a000', '#202733'];
const SECONDARY = ['#ffffff', '#3ee6ff', '#f5c451', '#ff5d8f', '#9be15d', '#ff8a00', '#c0c7d6', '#111827'];

const BASE_NOTES: Record<string, string> = {
  LIS: 'Lusophone widebody heartland: Brazil, Africa, diaspora and repatriation work.',
  VNO: 'Baltic narrowbody machine: low costs, summer bases all over Europe.',
  MLA: 'Island AOC with a Mediterranean reach and a favourable registry.',
  MAD: 'Iberian hub: Latin America, sports clubs and tour operators.',
  RIX: 'Baltic base with winter work in Canada and the Nordics.',
};

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

export function NewGame() {
  const [preset, setPreset] = useState(0);
  const [name, setName] = useState(COMPANY_PRESETS[0].name);
  const [code, setCode] = useState(COMPANY_PRESETS[0].code);
  const [base, setBase] = useState<string>('LIS');
  const [livery, setLivery] = useState<Livery>({ primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' });
  const root = useRef<HTMLDivElement>(null);
  const derived = (code || name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase().padEnd(2, 'X');

  const usePreset = (i: number) => {
    const p = COMPANY_PRESETS[i];
    setPreset(i);
    setName(p.name);
    setCode(p.code);
    setBase(p.base);
  };

  const launch = () => {
    const p = COMPANY_PRESETS[preset];
    const same = p.name === name;
    store.startNewGame({ name: name.trim() || p.name, code: derived, icao: same ? p.icao : undefined, callsign: same ? p.callsign : undefined, livery, base });
  };

  return (
    <div className="newgame acmi-ng" ref={root}>
      <header className="ng-head">
        <div className="row gap-12">
          <LogoMark size={36} />
          <div>
            <div className="upper dim">New ACMI operator · Startup</div>
            <h2>Two A320s, a crew room and a summer to win</h2>
          </div>
        </div>
      </header>

      <div className="ng-body">
        <div className="ng-panel">
          <div className="col gap-16">
            <div className="field">
              <label>Presets</label>
              <div className="row wrap gap-8">
                {COMPANY_PRESETS.map((p, i) => (
                  <button key={p.name} className={`chip ${preset === i ? 'active' : ''}`} onClick={() => usePreset(i)}>{p.name}</button>
                ))}
              </div>
            </div>
            <div className="grid-2">
              <div className="field">
                <label>Company name</label>
                <input className="input" value={name} maxLength={28} autoComplete="off" autoCapitalize="words" enterKeyHint="next" onKeyDown={blurOnEnter} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label>Code</label>
                <input className="input mono" value={code} placeholder={derived} maxLength={2} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="done" onKeyDown={blurOnEnter} onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())} />
              </div>
            </div>
            <div className="field">
              <label>Home base</label>
              <div className="col gap-8">
                {HOME_BASES.map((b) => {
                  const a = AIRPORT_BY_CODE[b];
                  return (
                    <button key={b} className={`card hub-card hoverable ${base === b ? 'selected' : ''}`} onClick={() => setBase(b)}>
                      <div className="row gap-8">
                        <span className="code">{b}</span>
                        <b>{a.city}</b>
                        <span className="dim small">{flag(a.country)} {a.name}</span>
                      </div>
                      <div className="small muted mt-4">{BASE_NOTES[b]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <label>Primary colour</label>
              <div className="swatches">
                {PALETTE.map((c) => <button key={c} className={`swatch ${livery.primary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, primary: c })} aria-label={c} />)}
              </div>
            </div>
            <div className="field">
              <label>Accent colour</label>
              <div className="swatches">
                {SECONDARY.map((c) => <button key={c} className={`swatch ${livery.secondary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, secondary: c })} aria-label={c} />)}
              </div>
            </div>
            <div className="field ng-tail">
              <label>Tail design</label>
              <Seg<TailStyle> value={livery.tail} onChange={(tail) => setLivery({ ...livery, tail })} options={[
                { value: 'solid', label: 'Solid' }, { value: 'split', label: 'Split' }, { value: 'stripe', label: 'Stripe' }, { value: 'sweep', label: 'Sweep' },
              ]} />
            </div>
          </div>
        </div>

        <div className="ng-visual">
          <div className="ng-livery card">
            <div className="upper dim">Your first aircraft</div>
            <div className="livery-stage">
              <AircraftArt typeId="a320ceo" livery={livery} code={derived} name={name} />
            </div>
            <div className="ng-summary">
              <div className="row gap-12">
                <TailBadge primary={livery.primary} secondary={livery.secondary} code={derived} size={44} />
                <div>
                  <b className="big">{name || 'Your company'}</b>
                  <div className="small muted">{derived} · Based at {AIRPORT_BY_CODE[base].city} ({base})</div>
                </div>
              </div>
              <ul className="ng-tips small muted">
                <li>2× A320ceo 180Y: one owned (2006), one dry-leased in (2013).</li>
                <li>60 crew: 10 captains, 10 first officers, 10 senior cabin crew, 30 cabin crew.</li>
                <li>{money(BAL.startCash, 1)} in the bank. Rent and salaries are due every month.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <footer className="ng-foot">
        <button className="btn btn-ghost" onClick={() => store.setScreen('title')}><ArrowLeft /> Back to menu</button>
        <div className="ng-foot-sum">
          <span className="ng-foot-pick"><TailBadge primary={livery.primary} secondary={livery.secondary} code={derived} size={22} /><span className="ellipsis">{name}</span> <span className="dim">· {base}</span></span>
        </div>
        <button className="btn btn-primary btn-lg" onClick={launch} disabled={!name.trim()}><Rocket /> Start operations</button>
      </footer>
    </div>
  );
}
