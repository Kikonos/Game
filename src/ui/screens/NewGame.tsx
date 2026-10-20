// New Game: home base (the engine's list, Lisbon default), company name, code and livery, scenario "Startup".
// The base drives where the fleet and crew start, the registration prefix and the offers around it
// (engine/newGame.ts, data/naming.ts). DESIGN.md §2.3, §6.3.

import { ArrowLeft, Palette, Rocket } from 'lucide-react';
import { useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { COUNTRIES, flag } from '../../data/countries';
import { COMPANY_PRESETS, DEFAULT_HOME_BASE, HOME_BASE_NOTES, HOME_BASES, type HomeBase } from '../../data/naming';
import { BAL } from '../../engine/core/balance';
import { localOffset } from '../../engine/core/time';
import type { Livery, TailStyle } from '../../engine/core/types';
import { normaliseOptions } from '../../engine/newGame';
import { normaliseLivery } from '../../engine/ops';
import { AircraftArt } from '../components/AircraftArt';
import { LogoMark, TailBadge } from '../components/Logo';
import { Seg } from '../components/ui';
import { money } from '../format';
import { LiverySheet } from '../modals/LiveryModal';
import { store } from '../store';

const PALETTE = ['#1e4fd8', '#0f9d76', '#d6283c', '#7a3cff', '#ff7a00', '#0b1f4d', '#e0457b', '#00a3c4', '#c8a000', '#202733'];
const SECONDARY = ['#ffffff', '#3ee6ff', '#f5c451', '#ff5d8f', '#9be15d', '#ff8a00', '#c0c7d6', '#111827'];

const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

/** Standard offset of a base (winter time), e.g. 'UTC+2'. */
const utcLabel = (base: string) => {
  const h = localOffset(base, 0) / 60;
  return h === 0 ? 'UTC' : `UTC${h > 0 ? '+' : '−'}${Math.abs(h)}`;
};

const isBase = (b: string): b is HomeBase => (HOME_BASES as readonly string[]).includes(b);

export function NewGame() {
  const first = Math.max(0, COMPANY_PRESETS.findIndex((p) => p.base === DEFAULT_HOME_BASE));
  const [preset, setPreset] = useState(first);
  const [name, setName] = useState(COMPANY_PRESETS[first]?.name ?? '');
  const [code, setCode] = useState(COMPANY_PRESETS[first]?.code ?? '');
  const [base, setBase] = useState<HomeBase>(DEFAULT_HOME_BASE);
  const [livery, setLivery] = useState<Livery>({ primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' });
  const [editing, setEditing] = useState(false);
  const derived = (code || name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase().padEnd(2, 'X');
  const p = COMPANY_PRESETS[preset];
  const same = !!p && p.name === name.trim();
  const opts = normaliseOptions({ name, code: derived, icao: same ? p.icao : undefined, callsign: same ? p.callsign : undefined, livery, base });
  const ap = AIRPORT_BY_CODE[base];
  const reg = COUNTRIES[ap?.country ?? '']?.reg ?? '';

  // Picking a base also picks its house preset while the name is still an untouched preset.
  const pickBase = (b: HomeBase) => {
    setBase(b);
    const i = COMPANY_PRESETS.findIndex((x) => x.base === b);
    if (i >= 0 && COMPANY_PRESETS.some((x) => x.name === name.trim())) {
      setPreset(i);
      setName(COMPANY_PRESETS[i].name);
      setCode(COMPANY_PRESETS[i].code);
    }
  };

  const usePreset = (i: number) => {
    const x = COMPANY_PRESETS[i];
    setPreset(i);
    setName(x.name);
    setCode(x.code);
    if (isBase(x.base)) setBase(x.base);
  };

  return (
    <div className="newgame acmi-ng">
      <header className="ng-head">
        <div className="row gap-12">
          <LogoMark size={36} />
          <div>
            <div className="upper dim">Block Hours · new operator · Startup</div>
            <h2>Two A320s, a crew room and a summer to win</h2>
          </div>
        </div>
      </header>

      <div className="ng-body">
        <div className="ng-panel">
          <div className="col gap-16">
            <div className="field">
              <label>Home base</label>
              <div className="ng-bases">
                {HOME_BASES.map((b) => {
                  const a = AIRPORT_BY_CODE[b];
                  return (
                    <button key={b} className={`card ng-base hoverable ${base === b ? 'selected' : ''}`} onClick={() => pickBase(b)} aria-pressed={base === b}>
                      <span className="code">{b}</span>
                      <span className="col ng-base-txt">
                        <b className="ellipsis">{a?.city ?? b}</b>
                        <span className="small dim ellipsis">{a ? `${flag(a.country)} ${COUNTRIES[a.country]?.name ?? a.country}` : ''}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="small muted ng-base-note">{HOME_BASE_NOTES[base]}</div>
            </div>
            <div className="field">
              <label>Company presets</label>
              <div className="row wrap gap-8">
                {COMPANY_PRESETS.map((x, i) => (
                  <button key={x.name} className={`chip ng-chip ${preset === i && same ? 'active' : ''}`} onClick={() => usePreset(i)}>{x.name}</button>
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
              <label>Primary colour</label>
              <div className="swatches">
                {PALETTE.map((c) => <button key={c} className={`swatch ${livery.primary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, primary: c })} aria-label={`Primary ${c}`} />)}
              </div>
            </div>
            <div className="field">
              <label>Accent colour</label>
              <div className="swatches">
                {SECONDARY.map((c) => <button key={c} className={`swatch ${livery.secondary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, secondary: c })} aria-label={`Accent ${c}`} />)}
              </div>
            </div>
            <div className="field ng-tail">
              <label>Tail design</label>
              <div className="row gap-12 wrap">
                <Seg<TailStyle | 'white'> value={livery.plain ? 'white' : livery.tail} onChange={(t) => setLivery(t === 'white' ? { ...livery, plain: true } : { ...livery, tail: t, plain: undefined })} options={[
                  { value: 'solid', label: 'Solid' }, { value: 'split', label: 'Split' }, { value: 'stripe', label: 'Stripe' }, { value: 'sweep', label: 'Sweep' }, { value: 'white', label: 'White' },
                ]} />
                <button className="btn" onClick={() => setEditing(true)}><Palette /> Customise livery…</button>
              </div>
              <div className="small muted">Letter colours, logos and where the titles sit. You can change it later in Company.</div>
            </div>
          </div>
        </div>

        <div className="ng-visual">
          <div className="ng-livery card">
            <div className="upper dim">Your first aircraft</div>
            <div className="livery-stage">
              <AircraftArt typeId="a320ceo" livery={livery} code={derived} name={opts.name} />
              <button className="btn ng-edit-livery" onClick={() => setEditing(true)}><Palette /> Customise</button>
            </div>
            <div className="ng-summary">
              <div className="row gap-12">
                <TailBadge primary={livery.primary} secondary={livery.secondary} code={derived} size={44} livery={livery} />
                <div style={{ minWidth: 0 }}>
                  <b className="big ellipsis">{opts.name}</b>
                  <div className="small muted">{opts.code}{opts.icao ? ` · ${opts.icao}` : ''} · based at {ap?.city ?? base} ({base}, {utcLabel(base)})</div>
                </div>
              </div>
              <ul className="ng-tips small muted">
                <li>2× A320ceo 180Y at {base}: one owned (2006), one dry-leased in (2013){reg ? `, on the ${reg} register` : ''}.</li>
                <li>60 crew based at {base}: 10 captains, 10 first officers, 10 senior cabin crew, 30 cabin crew.</li>
                <li>{money(BAL.startCash, 1)} in the bank. Rent and salaries are due every month.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <footer className="ng-foot">
        <button className="btn btn-ghost" onClick={() => store.setScreen('title')}><ArrowLeft /> Back to menu</button>
        <div className="ng-foot-sum">
          <span className="ng-foot-pick"><TailBadge primary={livery.primary} secondary={livery.secondary} code={derived} size={22} livery={livery} /><span className="ellipsis">{opts.name}</span> <span className="dim">· {base}</span></span>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => store.startNewGame(opts)} disabled={!name.trim()}><Rocket /> Start operations</button>
      </footer>
      {editing && <LiverySheet value={livery} code={derived} name={opts.name} onCancel={() => setEditing(false)} onSave={(l) => { setLivery(normaliseLivery(l)); setEditing(false); }} />}
    </div>
  );
}
