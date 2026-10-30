// New Game: start setup (v0.12: data/setups.ts, the classic pair by default), home base (the engine's list, Lisbon
// default), company name, code and livery.
// The base drives where the fleet and crew start, the registration prefix and the offers around it
// (engine/newGame.ts, data/naming.ts). DESIGN.md §2.3, §6.3.

import { ArrowLeft, Palette, Rocket } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { DEFAULT_SETUP, DIFFICULTY_LABEL, SETUP_BY_ID, START_SETUPS, type SetupId, type StartSetup } from '../../data/setups';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { COUNTRIES, flag } from '../../data/countries';
import { COMPANY_PRESETS, DEFAULT_HOME_BASE, HOME_BASE_NOTES, HOME_BASES, type HomeBase } from '../../data/naming';
import { localOffset } from '../../engine/core/time';
import type { Livery, TailStyle } from '../../engine/core/types';
import { fleetWords, normaliseOptions, setupCrew } from '../../engine/newGame';
import { familyName } from '../../engine/crew/sets';
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

/** v0.12 the crew each setup starts with (computed once). */
const CREW = new Map(START_SETUPS.map((x) => [x.id, setupCrew(x)]));

/** '2× A320 · 60 crew · $3.0M' (a setup card). */
const setupLine = (x: StartSetup) => `${fleetWords(x.fleet)} · ${CREW.get(x.id)?.total ?? 0} crew · ${money(x.cash, 1)}`;

/** The fleet in the summary: 'A320ceo 180Y, owned (2006); A320ceo 180Y, leased from AerCap (2013)'. */
const fleetText = (x: StartSetup) => x.fleet.map((a) => {
  const t = ACMI_TYPES[a.typeId];
  return `${t.name.replace(/^(Airbus|Boeing) /, '')} ${t.cabins[a.cabin ?? 0].label}, ${a.owned ? 'owned' : 'leased'} (${a.built})`;
}).join('; ');

export function NewGame() {
  const first = Math.max(0, COMPANY_PRESETS.findIndex((p) => p.base === DEFAULT_HOME_BASE));
  const [preset, setPreset] = useState(first);
  const [name, setName] = useState(COMPANY_PRESETS[first]?.name ?? '');
  const [code, setCode] = useState(COMPANY_PRESETS[first]?.code ?? '');
  const [base, setBase] = useState<HomeBase>(DEFAULT_HOME_BASE);
  const [setupId, setSetupId] = useState<SetupId>(DEFAULT_SETUP);
  const setup = SETUP_BY_ID[setupId];
  const crew = CREW.get(setupId)!;
  const families = useMemo(() => [...new Set(setup.fleet.map((a) => ACMI_TYPES[a.typeId].family))], [setup]);
  const [livery, setLivery] = useState<Livery>({ primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' });
  const [editing, setEditing] = useState(false);
  const derived = (code || name.replace(/[^A-Za-z]/g, '').slice(0, 2)).toUpperCase().padEnd(2, 'X');
  const p = COMPANY_PRESETS[preset];
  const same = !!p && p.name === name.trim();
  const opts = normaliseOptions({ name, code: derived, icao: same ? p.icao : undefined, callsign: same ? p.callsign : undefined, livery, base, setup: setupId });
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
            <div className="upper dim">Block Hours · new operator · {setup.name}</div>
            <h2>{setup.blurb}</h2>
          </div>
        </div>
      </header>

      <div className="ng-body">
        <div className="ng-panel">
          <div className="col gap-16">
            {/* v0.12 start setups: every one narrowbody short-haul. */}
            <div className="field">
              <label>Start setup</label>
              <div className="ng-setups" role="radiogroup" aria-label="Start setup">
                {START_SETUPS.map((x) => (
                  <button key={x.id} role="radio" className={`card ng-setup hoverable ${setupId === x.id ? 'selected' : ''}`} onClick={() => setSetupId(x.id)} aria-checked={setupId === x.id}>
                    <span className="ng-setup-top">
                      <b className="ellipsis">{x.name}</b>
                      <span className={`chip ng-diff d${x.difficulty}`}>{DIFFICULTY_LABEL[x.difficulty]}</span>
                    </span>
                    <span className="small dim ellipsis">{setupLine(x)}</span>
                  </button>
                ))}
              </div>
              <div className="small muted ng-base-note">{setup.blurb} {DIFFICULTY_LABEL[setup.difficulty]}: {setup.why.toLowerCase()}.</div>
            </div>
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
                {!PALETTE.includes(livery.primary) && <button className="swatch on custom" style={{ background: livery.primary }} onClick={() => setEditing(true)} aria-label={`Primary ${livery.primary} (custom)`} title="Custom colour" />}
              </div>
            </div>
            <div className="field">
              <label>Accent colour</label>
              <div className="swatches">
                {SECONDARY.map((c) => <button key={c} className={`swatch ${livery.secondary === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setLivery({ ...livery, secondary: c })} aria-label={`Accent ${c}`} />)}
                {!SECONDARY.includes(livery.secondary) && <button className="swatch on custom" style={{ background: livery.secondary }} onClick={() => setEditing(true)} aria-label={`Accent ${livery.secondary} (custom)`} title="Custom colour" />}
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
              <AircraftArt typeId={setup.fleet[0].typeId} livery={livery} code={derived} name={opts.name} />
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
                <li>{fleetText(setup)} at {base}{reg ? `, on the ${reg} register` : ''}.</li>
                <li>{crew.total} crew based at {base}: {crew.byRole.CPT ?? 0} captains, {crew.byRole.FO ?? 0} first officers, {crew.byRole.PUR ?? 0} pursers, {crew.byRole.CC ?? 0} cabin crew{families.length > 1 ? `, in ${families.length} type pools (${families.map(familyName).join(' and ')})` : ''}.</li>
                <li>{money(setup.cash, 1)} in the bank. {setup.fleet.some((a) => !a.owned) ? 'Rent and salaries are due every month.' : 'No rent: salaries and maintenance are due every month.'}</li>
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
