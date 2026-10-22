// Global dialogs (menu, saves, settings, confirm) and the in-game modal slot (decisions, game over).

import { BookOpenText, Download, FolderOpen, Home, Lightbulb, Play, PlusCircle, RefreshCw, Save, Settings as SettingsIcon, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { DAY, fmtDate } from '../../engine/core/time';
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
import { LiveryModal } from '../modals/LiveryModal';
import { ClassesModal } from '../modals/ClassesModal';
import { ConvertModal } from '../modals/ConvertModal';
import { AcquireModal } from '../modals/AcquireModal';
import { RefitModal } from '../modals/RefitModal';
import { LeaseModal } from '../modals/LeaseModal';
import { SellModal } from '../modals/SellModal';
import { ApprovalModal } from '../modals/ApprovalModal';
import { LadderStepModal } from '../modals/LadderStepModal';
import { WhatsNewModal } from '../modals/WhatsNewModal';
import { CrewControlModal } from '../modals/CrewControlModal';
import { ProblemModal } from '../modals/ProblemModal';
import { GlossaryModal } from '../modals/GlossaryModal';
import { TripMoveModal } from '../modals/TripMoveModal';
import { MaintMoveModal } from '../modals/MaintMoveModal';
import { ClientModal, OutlookModal, RivalModal, WorldEventModal } from '../modals/V08Modals';
import { CURRENT } from '../../data/whatsNew';
import { int, money } from '../format';
import { offline, promptInstall } from '../offline';
import { store, useStore } from '../store';

function GameOverModal() {
  const s = useStore();
  const g = s.game!;
  const days = Math.max(1, Math.round(((g.gameOver?.t ?? g.now) - g.started) / DAY));
  const auto = listSaves().find((m) => m.slot === AUTOSAVE_SLOT);
  if (s.modal) return null;
  return (
    <Modal title="Operations suspended">
      <p className="muted">{g.gameOver?.reason}</p>
      <div className="small mt-12">
        {g.company.name} operated {int(days)} days and flew {int(g.stats.legs)} revenue legs ({int(Math.round(g.stats.blockMin / 60))} BH) for {int(g.stats.contractsDone)} completed contracts.
        {g.stats.bestMonthProfit > 0 ? ` Best month: ${money(g.stats.bestMonthProfit)} profit.` : ''}
      </div>
      {auto && <div className="tiny dim mt-8">The autosave is from before the suspension ({auto.date}); Continue on the title screen resumes from there.</div>}
      <div className="row gap-8 mt-16 wrap">
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'saves', mode: 'load' })}><FolderOpen /> Load a save</button>
        <button className="btn" onClick={() => { store.quitToTitle(); store.setScreen('newgame'); }}><PlusCircle /> New game</button>
        <button className="btn btn-ghost" onClick={() => store.quitToTitle()}><Home /> Back to title</button>
      </div>
    </Modal>
  );
}

export function GameModals() {
  const s = useStore();
  const g = s.game;
  if (!g) return null;
  if (g.gameOver) return <GameOverModal />;
  // While decisions hold time (setting) the oldest opens by itself, unless set aside with 'Look first'
  // (the amber pause badge re-opens it); otherwise the Inbox pins them.
  if (!s.modal && s.decisionOpen) return <DecisionModal />;
  return null;
}

const SAVE_NOTE = 'Autosaves at each month end, when you pause and when you leave.';

/** 'Since 4 Mar 2027' for confirm dialogs: when the running game was last written to the autosave. */
function unsavedSince(): string {
  const g = store.game;
  if (!g) return '';
  return store.savedNow >= 0 ? `since ${fmtDate(store.savedNow)}` : 'since this session started';
}

/** Runs `go` at once on the title screen; while a game runs, asks first. */
function confirmReplace(title: string, confirm: string, go: () => void) {
  const g = store.game;
  if (!g || g.gameOver) return go();
  store.openModal({ kind: 'confirm', title, confirm, body: `This replaces the game you are playing. Progress ${unsavedSince()} that is not in a save will be lost.`, onConfirm: go });
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
        {offline.updateReady && <button className="menu-item" onClick={() => { store.saveAuto(true); location.reload(); }}><RefreshCw /> Save & restart to update</button>}
        <button className="menu-item danger" onClick={() => store.quitToTitle()}><Home /> Save & quit to title</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      <div className="tiny dim mt-12">{store.settings.autosave ? SAVE_NOTE : 'Autosave is off: the game saves only when you save it or quit to the title.'} Saves live in this browser — export a file to back up or move devices.</div>
    </Modal>
  );
}

function importFile(file?: File) {
  if (!file) return;
  file.text().then((text) => {
    try {
      const g = deserialize(text);
      confirmReplace('Import this save?', 'Import', () => {
        store.loadGame(g);
        store.toast('good', 'Save imported', `${g.company.name} · ${fmtDate(g.now)}`);
      });
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
  const back = () => store.openModal({ kind: 'saves', mode });
  const save = (slot: string) => {
    if (store.game && saveToSlot(store.game, slot)) {
      store.toast('good', 'Game saved', `Slot ${slot}`);
      force((x) => x + 1);
    } else store.toast('bad', 'Could not save', 'Browser storage is unavailable or full.');
  };
  const load = (slot: string) => {
    try {
      const g = loadFromSlot(slot);
      if (g) store.loadGame(g);
    } catch (e) {
      store.toast('bad', 'Could not load', (e as Error).message);
    }
  };
  const onSlot = (slot: string) => {
    const m = saves.find((x) => x.slot === slot);
    if (mode === 'save') {
      if (!m) return save(slot);
      store.openModal({ kind: 'confirm', title: `Overwrite slot ${slot}?`, confirm: 'Overwrite', body: `It holds ${m.company} on ${m.date}. That save will be replaced.`, onConfirm: () => { save(slot); back(); } });
    } else if (m) confirmReplace(`Load ${slot === AUTOSAVE_SLOT ? 'the autosave' : `slot ${slot}`}?`, 'Load', () => load(slot));
  };
  const del = (slot: string) => {
    const m = saves.find((x) => x.slot === slot);
    store.openModal({ kind: 'confirm', title: `Delete slot ${slot}?`, confirm: 'Delete', danger: true, body: m ? `${m.company} on ${m.date} will be deleted. This cannot be undone.` : 'This cannot be undone.', onConfirm: () => { deleteSlot(slot); back(); } });
  };
  return (
    <Modal title={mode === 'save' ? 'Save game' : 'Load game'} icon={mode === 'save' ? <Save className="accent" /> : <FolderOpen className="accent" />} onClose={() => store.closeModal()} footer={
      mode === 'load' ? <button className="btn" onClick={() => fileRef.current?.click()}><Upload /> Import from file</button> : undefined
    }>
      <div className="slots">
        {slots.map((slot) => {
          const m = saves.find((x) => x.slot === slot);
          return (
            <div key={slot} className={`slot${m ? '' : ' slot-empty'}`}>
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
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => del(slot)} aria-label="Delete save"><Trash2 /></button>
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
        <div className="set-row"><div><b>Autosave</b><div className="tiny dim">At each month end, when you pause and when you leave</div></div><Toggle on={st.autosave} onChange={(v) => store.setSettings({ autosave: v })} /></div>
        <div className="set-row"><div><b>Pause for decisions</b><div className="tiny dim">Stop the clock when an event needs you</div></div><Toggle on={st.autoPause.decision} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, decision: v } })} /></div>
        <div className="set-row"><div><b>Pause for urgent offers</b><div className="tiny dim">AOG cover, repatriation and other short-notice work</div></div><Toggle on={st.autoPause.urgentOffer} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, urgentOffer: v } })} /></div>
        <div className="set-row"><div><b>Pause for AOG</b><div className="tiny dim">When an aircraft breaks down</div></div><Toggle on={st.autoPause.aog} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, aog: v } })} /></div>
        <div className="set-row"><div><b>Pause for crew shortages</b><div className="tiny dim">A flight in the next 48 h has no legal crew</div></div><Toggle on={st.autoPause.crewShortage} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, crewShortage: v } })} /></div>
        <div className="set-row"><div><b>Pause when a contract starts</b><div className="tiny dim">Watch the first flights of new work</div></div><Toggle on={st.autoPause.contractStart} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, contractStart: v } })} /></div>
        <div className="set-row"><div><b>Pause at month end</b><div className="tiny dim">Read the statement before the next month starts</div></div><Toggle on={st.autoPause.monthEnd} onChange={(v) => store.setSettings({ autoPause: { ...st.autoPause, monthEnd: v } })} /></div>
        <div className="set-head upper dim">Display</div>
        <div className="set-row"><div><b>Map animations</b><div className="tiny dim">Flying aircraft on maps</div></div><Toggle on={st.mapAnimations} onChange={(v) => store.setSettings({ mapAnimations: v })} /></div>
        <div className="set-row"><div><b>Top bar spacing</b><div className="tiny dim">Moves the game below the frosted strip iPadOS adds at the top of the screen</div></div><Seg value={String(st.topGap)} onChange={(v) => store.setSettings({ topGap: v === 'auto' ? 'auto' : (Number(v) as 0 | 16 | 28 | 40) })} options={[{ value: 'auto', label: 'Auto' }, { value: '0', label: 'Off' }, { value: '16', label: '16' }, { value: '28', label: '28' }, { value: '40', label: '40' }]} /></div>
        <div className="set-row"><div><b>Pop-up notifications</b></div><Toggle on={st.toasts} onChange={(v) => store.setSettings({ toasts: v })} /></div>
        <div className="set-row"><div><b>What's new</b><div className="tiny dim">{CURRENT.version} {CURRENT.name}</div></div><button className="btn btn-sm" onClick={() => store.openModal({ kind: 'whatsNew' })}><Sparkles /> Show</button></div>
        <div className="set-head upper dim">Plain language</div>
        <div className="set-row"><div><b>Glossary</b><div className="tiny dim">What FDP, deadhead, AOG, sub-charter and the other words mean</div></div><button className="btn btn-sm" onClick={() => store.openModal({ kind: 'glossary' })}><BookOpenText /> Open</button></div>
        <div className="set-row"><div><b>First-time hints</b><div className="tiny dim">{st.hintsSeen.length ? `${st.hintsSeen.length} kind${st.hintsSeen.length === 1 ? '' : 's'} of problem switched off` : 'A one-paragraph story the first time each kind of problem appears'}</div></div><button className="btn btn-sm" onClick={() => store.setSettings({ hintsSeen: [] })} disabled={!st.hintsSeen.length}><Lightbulb /> Show again</button></div>
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
    case 'check': return s.game ? <CheckModal aircraftId={m.aircraftId} checkKind={m.checkKind} replace={m.replace} restFit={m.restFit} backToRefit={m.backToRefit} suggest={m.suggest} after={m.after} /> : null;
    case 'sheet': return s.game ? <BlockSheet refs={m.refs} idle={m.idle} /> : null;
    case 'duty': return s.game ? <DutyModal id={m.id} /> : null;
    case 'subcharter': return s.game ? <SubcharterModal contractId={m.contractId} flightId={m.flightId} rivalId={m.rivalId} /> : null;
    case 'livery': return s.game ? <LiveryModal target={m.target} /> : null;
    case 'convert': return s.game ? <ConvertModal key={m.crewIds.join()} crewIds={m.crewIds} family={m.family} onBooked={m.onBooked} /> : null;
    case 'classes': return s.game ? <ClassesModal /> : null;
    case 'acquire': return s.game ? <AcquireModal offerId={m.offerId} /> : null;
    case 'refit': return s.game ? <RefitModal aircraftId={m.aircraftId} layout={m.layout} offerId={m.offerId} rest={m.rest || m.section === 'rest'} restOption={m.restOption} after={m.after} /> : null;
    case 'lease': return s.game ? <LeaseModal aircraftId={m.aircraftId} tab={m.tab} /> : null;
    case 'sell': return s.game ? <SellModal aircraftId={m.aircraftId} /> : null;
    case 'approval': return s.game ? <ApprovalModal id={m.id} /> : null;
    case 'ladderStep': return s.game ? <LadderStepModal messageId={m.messageId} /> : null;
    case 'whatsNew': return <WhatsNewModal />;
    case 'crewControl': return s.game ? <CrewControlModal key={m.flightId} flightId={m.flightId} fix={m.fix} /> : null;
    case 'problem': return s.game ? <ProblemModal subject={m.subject} hint={m.hint} /> : null;
    case 'glossary': return <GlossaryModal term={m.term} />;
    case 'tripMove': return s.game ? <TripMoveModal key={`${m.flightId}>${m.targetId}`} flightId={m.flightId} targetId={m.targetId} /> : null;
    case 'maintMove': return s.game ? <MaintMoveModal key={`${m.maintId}@${m.start}`} maintId={m.maintId} start={m.start} /> : null;
    case 'client': return s.game ? <ClientModal clientId={m.clientId} /> : null;
    case 'rival': return s.game ? <RivalModal rivalId={m.rivalId} /> : null;
    case 'outlook': return s.game ? <OutlookModal /> : null;
    case 'worldEvent': return s.game ? <WorldEventModal eventId={m.eventId} /> : null;
  }
}
