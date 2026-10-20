// Global dialogs (menu, saves, settings, confirm) and the in-game modal slot (decisions, game over).

import { Download, FolderOpen, Home, Play, Save, Settings as SettingsIcon, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { fmtDate } from '../../engine/core/time';
import { AUTOSAVE_SLOT, SLOTS, deleteSlot, deserialize, listSaves, loadFromSlot, saveToSlot, serialize } from '../../engine/save';
import { Modal, Seg, Toggle } from '../components/ui';
import { DecisionModal } from '../modals/DecisionModal';
import { CheckModal } from '../modals/CheckModal';
import { HireModal } from '../modals/HireModal';
import { OfferModal } from '../modals/OfferModal';
import { BlockSheet } from '../modals/BlockSheet';
import { DutyModal } from '../modals/DutyModal';
import { SubcharterModal } from '../modals/SubcharterModal';
import { TrainModal } from '../modals/TrainModal';
import { money } from '../format';
import { offline, promptInstall } from '../offline';
import { store, useStore } from '../store';

function GameOverModal() {
  const s = useStore();
  const g = s.game!;
  return (
    <Modal title="Operations suspended">
      <p className="muted">{g.gameOver?.reason}</p>
      <div className="row gap-8 mt-16">
        <button className="btn btn-primary" onClick={() => store.quitToTitle()}><Home /> Back to title</button>
      </div>
    </Modal>
  );
}

export function GameModals() {
  const s = useStore();
  const g = s.game;
  if (!g) return null;
  if (g.gameOver) return <GameOverModal />;
  // While decisions hold time (setting) the oldest opens by itself; otherwise the Inbox pins them.
  if (g.decisions.length && !s.modal && s.settings.autoPause.decision) return <DecisionModal />;
  return null;
}

// ---------- menus & dialogs ----------

function MenuModal() {
  const fileRef = useRef<HTMLInputElement>(null);
  const exportSave = () => {
    const g = store.game;
    if (!g) return;
    const blob = new Blob([serialize(g)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${g.company.name.replace(/\W+/g, '-').toLowerCase()}-${fmtDate(g.now).replace(/ /g, '-')}.blockhours.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <Modal title="Menu" onClose={() => store.closeModal()}>
      <div className="menu-list">
        <button className="menu-item" onClick={() => store.closeModal()}><Play /> Resume</button>
        <button className="menu-item" onClick={() => store.openModal({ kind: 'saves', mode: 'save' })}><Save /> Save game</button>
        <button className="menu-item" onClick={() => store.openModal({ kind: 'saves', mode: 'load' })}><FolderOpen /> Load game</button>
        <button className="menu-item" onClick={exportSave}><Download /> Export save file</button>
        <button className="menu-item" onClick={() => fileRef.current?.click()}><Upload /> Import save file</button>
        <button className="menu-item" onClick={() => store.openModal({ kind: 'settings' })}><SettingsIcon /> Settings</button>
        <button className="menu-item danger" onClick={() => store.quitToTitle()}><Home /> Save & quit to title</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      <div className="tiny dim mt-12">Your game autosaves every month and when you pause. Saves live in this browser — export a file to back up or move devices.</div>
    </Modal>
  );
}

function importFile(file?: File) {
  if (!file) return;
  file.text().then((text) => {
    try {
      const g = deserialize(text);
      store.loadGame(g);
      store.toast('good', 'Save imported', `${g.company.name} · ${fmtDate(g.now)}`);
    } catch (e) {
      store.toast('bad', 'Import failed', (e as Error).message);
    }
  });
}

function SavesModal({ mode }: { mode: 'save' | 'load' }) {
  const [, force] = useState(0);
  const saves = listSaves();
  const fileRef = useRef<HTMLInputElement>(null);
  const slots = mode === 'save' ? SLOTS : [AUTOSAVE_SLOT, ...SLOTS];
  const onSlot = (slot: string) => {
    if (mode === 'save') {
      if (store.game && saveToSlot(store.game, slot)) {
        store.toast('good', 'Game saved', `Slot ${slot}`);
        force((x) => x + 1);
      } else store.toast('bad', 'Could not save', 'Browser storage is unavailable or full.');
    } else {
      try {
        const g = loadFromSlot(slot);
        if (g) store.loadGame(g);
      } catch (e) {
        store.toast('bad', 'Could not load', (e as Error).message);
      }
    }
  };
  return (
    <Modal title={mode === 'save' ? 'Save game' : 'Load game'} icon={mode === 'save' ? <Save className="accent" /> : <FolderOpen className="accent" />} onClose={() => store.closeModal()} footer={
      mode === 'load' ? <button className="btn" onClick={() => fileRef.current?.click()}><Upload /> Import from file</button> : undefined
    }>
      <div className="slots">
        {slots.map((slot) => {
          const m = saves.find((x) => x.slot === slot);
          return (
            <div key={slot} className={`slot ${m ? '' : 'empty'}`}>
              <button className="slot-main" disabled={mode === 'load' && !m} onClick={() => onSlot(slot)}>
                <span className="slot-color" style={{ background: m?.color ?? 'transparent' }} />
                <div className="grow">
                  <b>{slot === AUTOSAVE_SLOT ? 'Autosave' : `Slot ${slot}`}</b>
                  <div className="small muted">{m ? `${m.company} · ${m.date} · ${money(m.cash)} · ${m.fleet} aircraft` : 'Empty'}</div>
                  {m && <div className="tiny dim">Saved {new Date(m.savedAt).toLocaleString()}</div>}
                </div>
                <span className="small accent">{mode === 'save' ? (m ? 'Overwrite' : 'Save') : m ? 'Load' : ''}</span>
              </button>
              {m && slot !== AUTOSAVE_SLOT && (
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { deleteSlot(slot); force((x) => x + 1); }} aria-label="Delete save"><Trash2 /></button>
              )}
            </div>
          );
        })}
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
    </Modal>
  );
}

function SettingsModal() {
  const s = useStore();
  const st = s.settings;
  return (
    <Modal title="Settings" icon={<SettingsIcon className="accent" />} onClose={() => store.closeModal()}>
      <div className="settings">
        <div className="set-row"><div><b>Distance units</b></div><Seg value={st.units} onChange={(v) => store.setSettings({ units: v })} options={[{ value: 'km', label: 'Kilometres' }, { value: 'nm', label: 'Nautical miles' }]} /></div>
        <div className="set-row"><div><b>Sound effects</b><div className="tiny dim">Synthesised UI sounds</div></div><Toggle on={st.sound} onChange={(v) => store.setSettings({ sound: v })} /></div>
        <div className="set-row"><div><b>Volume</b></div><input type="range" min={0} max={1} step={0.05} value={st.volume} style={{ width: 160, ['--fill' as string]: `${st.volume * 100}%` }} onChange={(e) => store.setSettings({ volume: Number(e.target.value) })} /></div>
        <div className="set-row"><div><b>Autosave</b><div className="tiny dim">Every month and when you leave</div></div><Toggle on={st.autosave} onChange={(v) => store.setSettings({ autosave: v })} /></div>
        <div className="set-row"><div><b>Pause for decisions</b><div className="tiny dim">Stop the clock when an event needs you</div></div><Toggle on={st.autoPause.decision} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, decision: v } })} /></div>
        <div className="set-row"><div><b>Pause for urgent offers</b><div className="tiny dim">AOG cover, repatriation and other short-notice work</div></div><Toggle on={st.autoPause.urgentOffer} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, urgentOffer: v } })} /></div>
        <div className="set-row"><div><b>Pause for AOG</b><div className="tiny dim">When an aircraft breaks down</div></div><Toggle on={st.autoPause.aog} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, aog: v } })} /></div>
        <div className="set-row"><div><b>Pause for crew shortages</b><div className="tiny dim">A flight in the next 48 h has no legal crew</div></div><Toggle on={st.autoPause.crewShortage} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, crewShortage: v } })} /></div>
        <div className="set-row"><div><b>Pause when a contract starts</b><div className="tiny dim">Watch the first flights of new work</div></div><Toggle on={st.autoPause.contractStart} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, contractStart: v } })} /></div>
        <div className="set-row"><div><b>Pause at month end</b><div className="tiny dim">Read the statement before the next month starts</div></div><Toggle on={st.autoPause.monthEnd} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, monthEnd: v } })} /></div>
        <div className="set-row"><div><b>Map animations</b><div className="tiny dim">Flying aircraft on maps</div></div><Toggle on={st.mapAnimations} onChange={(v) => store.setSettings({ mapAnimations: v })} /></div>
        <div className="set-row"><div><b>Pop-up notifications</b></div><Toggle on={st.toasts} onChange={(v) => store.setSettings({ toasts: v })} /></div>
        <div className="set-row"><div><b>Offline play</b><div className="tiny dim">{offline.ready ? 'Installed — the game works without internet.' : 'Caches after the first online visit.'}</div></div>
          {offline.installPrompt ? <button className="btn btn-sm" onClick={() => void promptInstall()}><Download /> Install app</button> : <span className={`badge ${offline.ready ? 'good' : ''}`}>{offline.ready ? 'Ready' : 'Pending'}</span>}
        </div>
      </div>
    </Modal>
  );
}

function ConfirmModal({ title, body, confirm, danger, onConfirm }: { title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Modal title={title} onClose={() => store.closeModal()} footer={
      <>
        <button className="btn" onClick={() => store.closeModal()}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { store.closeModal(); onConfirm(); }}>{confirm}</button>
      </>
    }>
      <p className="muted">{body}</p>
    </Modal>
  );
}

export function GlobalModals() {
  const s = useStore();
  const m = s.modal;
  if (!m) return null;
  switch (m.kind) {
    case 'menu': return <MenuModal />;
    case 'saves': return <SavesModal mode={m.mode} />;
    case 'settings': return <SettingsModal />;
    case 'confirm': return <ConfirmModal {...m} />;
    case 'offer': return s.game ? <OfferModal offerId={m.offerId} /> : null;
    case 'decision': return s.game ? <DecisionModal decisionId={m.decisionId} /> : null;
    case 'hire': return s.game ? <HireModal {...m} /> : null;
    case 'train': return s.game ? <TrainModal crewId={m.crewId} /> : null;
    case 'check': return s.game ? <CheckModal aircraftId={m.aircraftId} checkKind={m.checkKind} replace={m.replace} /> : null;
    case 'sheet': return s.game ? <BlockSheet refs={m.refs} idle={m.idle} /> : null;
    case 'duty': return s.game ? <DutyModal id={m.id} /> : null;
    case 'subcharter': return s.game ? <SubcharterModal contractId={m.contractId} flightId={m.flightId} /> : null;
  }
}
