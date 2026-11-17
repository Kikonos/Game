// v0.24.1 Settings › Key bindings: the list of every shortcut and the editor. Tap a key chip, press the new key (Esc
// cancels); a key another action has asks Swap or Cancel. Stored in the app settings on this device (keymap.ts).

import { Keyboard, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Help } from '../components/Help';
import { Modal } from '../components/ui';
import { deviceNow } from '../device';
import { DEFAULT_KEYS, FIXED_KEYS, keyCapture, KEY_ACTIONS, KEY_GROUPS, keyLabel, normKey, rebind, resetKey, swapKeys, unbindable, type KeyAction } from '../keymap';
import { store, useStore } from '../store';


const LABEL = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.label])) as Record<KeyAction, string>;

export function KeyBindings() {
  const s = useStore();
  const keys = s.settings.keys;
  const [wait, setWait] = useState<KeyAction | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [clash, setClash] = useState<{ action: KeyAction; key: string; other: KeyAction } | null>(null);

  useEffect(() => {
    keyCapture.on = !!wait;
    if (!wait) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) {
        setWait(null);
        setNote(null);
        return;
      }
      const why = unbindable(e);
      if (why) {
        setNote(why);
        return;
      }
      const k = normKey(e);
      const r = rebind(store.settings.keys, wait, k);
      if (r.conflict) setClash({ action: wait, key: k, other: r.conflict });
      else store.setSettings({ keys: r.map });
      setWait(null);
      setNote(null);
    };
    // Capture on the window, before the shortcuts and the dialog's own Escape.
    window.addEventListener('keydown', h, true);
    return () => {
      window.removeEventListener('keydown', h, true);
      keyCapture.on = false;
    };
  }, [wait]);

  const touch = deviceNow().input === 'touch';
  const changed = (Object.keys(DEFAULT_KEYS) as KeyAction[]).some((a) => keys[a] !== DEFAULT_KEYS[a]);
  return (
    <div className={`kb ${touch ? 'kb-touch' : ''}`}>
      <div className="row gap-6 kb-top">
        <span className="tiny dim grow">Tap a key to change it</span>
        {touch && <Help title="Key bindings">These work with a keyboard: a Mac, a PC, or an iPad with a keyboard attached.</Help>}
        <button className="btn btn-sm" disabled={!changed} onClick={() => { store.setSettings({ keys: { ...DEFAULT_KEYS } }); setClash(null); }}><RotateCcw /> Reset all</button>
      </div>
      {clash && (
        <div className="kb-clash" role="alert">
          <span className="small"><kbd>{keyLabel(clash.key)}</kbd> is already {LABEL[clash.other]}.</span>
          <div className="row gap-6">
            <button className="btn btn-sm btn-primary" onClick={() => { store.setSettings({ keys: swapKeys(store.settings.keys, clash.action, clash.key) }); setClash(null); }}>Swap</button>
            <button className="btn btn-sm" onClick={() => setClash(null)}>Cancel</button>
          </div>
        </div>
      )}
      {note && <div className="small warn kb-note">{note}</div>}
      {KEY_GROUPS.map((grp) => (
        <div key={grp} className="kb-group">
          <div className="upper dim tiny kb-gh">{grp}</div>
          {KEY_ACTIONS.filter((a) => a.group === grp).map((a) => {
            const on = wait === a.id;
            const k = keys[a.id];
            return (
              <div key={a.id} className={`kb-row ${on ? 'on' : ''}`}>
                <span className="small grow">{a.label}</span>
                <button className={`kb-chip ${on ? 'wait' : ''} ${k ? '' : 'none'}`} onClick={() => { setClash(null); setNote(null); setWait(on ? null : a.id); }} aria-label={`${a.label}: ${on ? 'press a key' : k ? keyLabel(k) : 'no key'}`}>
                  {on ? 'Press a key…' : keyLabel(k)}
                </button>
                <button className="btn btn-ghost btn-icon btn-sm kb-reset" style={{ visibility: k !== DEFAULT_KEYS[a.id] ? 'visible' : 'hidden' }} onClick={() => store.setSettings({ keys: resetKey(store.settings.keys, a.id) })} aria-label={`Reset ${a.label}`} title={`Reset to ${keyLabel(DEFAULT_KEYS[a.id])}`}><RotateCcw /></button>
              </div>
            );
          })}
          {FIXED_KEYS.filter((f) => f.group === grp).map((f) => (
            <div key={f.keys} className="kb-row fixed">
              <span className="small grow muted">{f.label}</span>
              <kbd className="kb-chip fixed">{f.keys}</kbd>
              <span className="kb-reset" />
            </div>
          ))}
        </div>
      ))}
      {wait && <div className="tiny muted kb-note">Esc cancels</div>}
    </div>
  );
}

/** The '?' key: the bindings on their own. */
export function KeysModal() {
  return (
    <Modal title="Key bindings" icon={<Keyboard className="accent" />} onClose={() => store.closeModal()} className="kb-modal">
      <KeyBindings />
    </Modal>
  );
}
