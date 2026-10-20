// Logo choice: None, a monogram or one of the 15 original marks, plus its two
// colours (and the monogram letters). No game state.

import { LOGO_IDS } from '../../../data/livery';
import type { LiveryLogo } from '../../../engine/core/types';
import { LOGOS, LogoGlyph } from '../aircraft/logos';
import { ColorPicker } from './ColorPicker';

export function LogoPicker({ value, onChange, defaults }: {
  value: LiveryLogo | undefined;
  onChange: (l: LiveryLogo | undefined) => void;
  /** Colours and monogram text a newly picked logo starts with. */
  defaults?: { color: string; color2?: string; text?: string };
}) {
  const base = { color: value?.color ?? defaults?.color ?? '#ffffff', color2: value?.color2 ?? defaults?.color2, text: value?.text ?? defaults?.text };
  const pick = (id: LiveryLogo['id'] | null) => onChange(id === null ? undefined : { ...base, id });
  const cell = (id: LiveryLogo['id'], name: string) => (
    <button type="button" key={id} className={`lv-logo${value?.id === id ? ' on' : ''}`} onClick={() => pick(id)} aria-pressed={value?.id === id} title={name}>
      <svg viewBox="0 0 100 100" aria-hidden><LogoGlyph logo={{ ...base, id, color: base.color, text: id === 'mono' ? base.text || 'BH' : undefined }} /></svg>
      <span>{name}</span>
    </button>
  );
  return (
    <div className="lv-logopick">
      <div className="lv-logos" role="group" aria-label="Logo">
        <button type="button" className={`lv-logo${!value ? ' on' : ''}`} onClick={() => pick(null)} aria-pressed={!value}>
          <svg viewBox="0 0 100 100" aria-hidden><path d="M20 20L80 80M80 20L20 80" stroke="currentColor" strokeWidth="8" strokeLinecap="round" /></svg>
          <span>None</span>
        </button>
        {cell('mono', 'Monogram')}
        {LOGO_IDS.map((id) => cell(id, LOGOS[id].name))}
      </div>
      {value && (
        <>
          {value.id === 'mono' && (
            <label className="lv-field">
              <span className="lv-label">Letters</span>
              <input
                className="lv-input" value={value.text ?? ''} maxLength={3} placeholder="BH" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                onChange={(e) => onChange({ ...value, text: e.target.value.toUpperCase().replace(/[^A-Z0-9&]/g, '').slice(0, 3) || undefined })}
              />
            </label>
          )}
          <ColorPicker label={value.id === 'mono' ? 'Roundel' : 'Colour 1'} value={value.color} onChange={(c) => onChange({ ...value, color: c ?? '#ffffff' })} />
          <ColorPicker
            label={value.id === 'mono' ? 'Letters' : 'Colour 2'} value={value.color2} auto autoColor={value.id === 'mono' ? undefined : value.color}
            onChange={(c) => onChange({ ...value, color2: c })}
          />
        </>
      )}
    </div>
  );
}
