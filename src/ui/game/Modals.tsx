import {
  AlertTriangle, BookOpen, Download, FolderOpen, Home, Play, Save, Settings as SettingsIcon, Sparkles, Trash2, Trophy, Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import * as A from '../../engine/actions';
import { levelInfo } from '../../engine/progression';
import { AUTOSAVE_SLOT, SLOTS, deleteSlot, deserialize, listSaves, loadFromSlot, saveToSlot, serialize } from '../../engine/save';
import { formatDate } from '../../engine/util';
import { Modal, Seg, Toggle } from '../components/ui';
import { compact, money } from '../format';
import { offline, promptInstall } from '../offline';
import { store, useStore } from '../store';
import { CabinModal } from './CabinConfig';
import { BuyUsedModal, LeaseModal, OrderModal } from './Market';
import { RoutePlanner } from './Routes';

// ---------- in-game event modals ----------

function DecisionModal() {
  const s = useStore();
  const d = s.game!.decisions[0];
  if (!d) return null;
  return (
    <Modal title={d.title} icon={<AlertTriangle className="warn" />} className="decision">
      <p className="muted">{d.body}</p>
      <div className="col gap-8 mt-16">
        {d.options.map((o) => (
          <button key={o.id} className="decision-opt" onClick={() => store.act((g) => A.resolveDecision(g, d.id, o.id), { toastOk: false })}>
            <b>{o.label}</b>
            <span className="small muted">{o.desc}</span>
          </button>
        ))}
      </div>
      <div className="tiny dim mt-12">{formatDate(d.day)} · Time is paused until you decide.</div>
    </Modal>
  );
}

function YearReviewModal() {
  const s = useStore();
  const y = s.game!.yearReview!;
  return (
    <Modal title={`${y.year} — Year in review`} icon={<Trophy className="accent" />} size="wide" footer={
      <button className="btn btn-primary" onClick={() => store.update((g) => { g.yearReview = null; })}><Play /> On to {y.year + 1}</button>
    }>
      <div className="year-grid">
        <div><span>Passengers</span><b>{compact(y.pax)}</b></div>
        <div><span>Revenue</span><b>{money(y.revenue)}</b></div>
        <div><span>Net profit</span><b className={y.profit >= 0 ? 'good' : 'bad'}>{money(y.profit)}</b></div>
        <div><span>Fleet</span><b>{y.fleet}</b></div>
        <div><span>Routes</span><b>{y.routes}</b></div>
        <div><span>Reputation</span><b>{Math.round(y.reputation)}</b></div>
        <div><span>World ranking</span><b>#{y.rank}</b></div>
        <div><span>Star route</span><b>{y.bestRoute ?? '—'}</b></div>
      </div>
      <p className="small muted mt-16">
        {y.profit > 0 ? 'The board is delighted with the results. ' : 'A tough year — the board expects a turnaround. '}
        Keep an eye on the Event Calendar for next year’s big demand drivers.
      </p>
    </Modal>
  );
}

function GameOverModal() {
  const s = useStore();
  const go = s.game!.gameOver!;
  return (
    <Modal title="Bankruptcy" icon={<AlertTriangle className="bad" />} footer={
      <>
        <button className="btn" onClick={() => store.openModal({ kind: 'saves', mode: 'load' })}><FolderOpen /> Load a save</button>
        <button className="btn btn-primary" onClick={() => store.quitToTitle()}><Home /> Back to title</button>
      </>
    }>
      <p>{go.reason}</p>
      <p className="small muted">{s.game!.airline.name} ceased operations on {formatDate(go.day)}. Every great airline founder has a failure or two — try again with the lessons learned.</p>
    </Modal>
  );
}

function LevelUpModal() {
  const s = useStore();
  const lv = s.levelUp!;
  const info = levelInfo(lv);
  return (
    <div className="levelup" onClick={() => store.dismissLevelUp()}>
      <div className="levelup-card">
        <Sparkles className="accent" />
        <div className="upper accent">Level up</div>
        <div className="levelup-n">{lv}</div>
        <h2>{info.title}</h2>
        <p className="small muted">New opportunities await — check Expansion and the Aircraft Market.</p>
        <button className="btn btn-primary mt-12" onClick={() => store.dismissLevelUp()}>Continue</button>
      </div>
    </div>
  );
}

export function GameModals() {
  const s = useStore();
  const g = s.game;
  if (!g) return null;
  if (g.gameOver) return <GameOverModal />;
  if (g.yearReview) return <YearReviewModal />;
  if (g.decisions.length && !s.modal) return <DecisionModal />;
  if (s.levelUp && !s.modal) return <LevelUpModal />;
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
    a.download = `${g.airline.name.replace(/\W+/g, '-').toLowerCase()}-${formatDate(g.day).replace(/ /g, '-')}.contrail.json`;
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
        <button className="menu-item" onClick={() => store.openModal({ kind: 'handbook' })}><BookOpen /> Handbook</button>
        <button className="menu-item danger" onClick={() => store.quitToTitle()}><Home /> Save & quit to title</button>
      </div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => importFile(e.target.files?.[0])} />
      <div className="tiny dim mt-12">Your game autosaves every month. Saves live in this browser — export a file to back up or move devices.</div>
    </Modal>
  );
}

function importFile(file?: File) {
  if (!file) return;
  file.text().then((text) => {
    try {
      const g = deserialize(text);
      store.loadGame(g);
      store.toast('good', 'Save imported', `${g.airline.name} · ${formatDate(g.day)}`);
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
                  <div className="small muted">{m ? `${m.airline} · ${formatDate(m.day)} · ${money(m.cash)} · ${m.fleet} aircraft · Lv ${m.level}` : 'Empty'}</div>
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
        <div className="set-row"><div><b>Distance units</b></div><Seg value={st.units} onChange={(v) => store.setSettings({ units: v })} options={[{ value: 'km', label: 'Kilometres' }, { value: 'mi', label: 'Miles' }]} /></div>
        <div className="set-row"><div><b>Sound effects</b><div className="tiny dim">Synthesised UI sounds</div></div><Toggle on={st.sound} onChange={(v) => store.setSettings({ sound: v })} /></div>
        <div className="set-row"><div><b>Volume</b></div><input type="range" min={0} max={1} step={0.05} value={st.volume} style={{ width: 160, ['--fill' as string]: `${st.volume * 100}%` }} onChange={(e) => store.setSettings({ volume: Number(e.target.value) })} /></div>
        <div className="set-row"><div><b>Autosave</b><div className="tiny dim">Every month and when you leave</div></div><Toggle on={st.autosave} onChange={(v) => store.setSettings({ autosave: v })} /></div>
        <div className="set-row"><div><b>Pause for decisions</b><div className="tiny dim">Stop the clock when an event needs you</div></div><Toggle on={st.pauseOnEvents} onChange={(v) => store.setSettings({ pauseOnEvents: v })} /></div>
        <div className="set-row"><div><b>Slow down for alerts</b><div className="tiny dim">Drop to 1× when a rival attacks, cash runs low or an aircraft needs a route</div></div><Toggle on={st.slowOnAlerts} onChange={(v) => store.setSettings({ slowOnAlerts: v })} /></div>
        <div className="set-row"><div><b>Map animations</b><div className="tiny dim">Flying aircraft on maps</div></div><Toggle on={st.mapAnimations} onChange={(v) => store.setSettings({ mapAnimations: v })} /></div>
        <div className="set-row"><div><b>Pop-up notifications</b></div><Toggle on={st.toasts} onChange={(v) => store.setSettings({ toasts: v })} /></div>
        <div className="set-row"><div><b>Offline play</b><div className="tiny dim">{offline.ready ? 'Installed — the game works without internet.' : 'Caches after the first online visit.'}</div></div>
          {offline.installPrompt ? <button className="btn btn-sm" onClick={() => void promptInstall()}><Download /> Install app</button> : <span className={`badge ${offline.ready ? 'good' : ''}`}>{offline.ready ? 'Ready' : 'Pending'}</span>}
        </div>
      </div>
    </Modal>
  );
}

const HANDBOOK: { title: string; body: string[] }[] = [
  { title: 'Getting started', body: [
    'Lease or buy an aircraft in the Aircraft Market. Leasing needs only a deposit; buying costs more up-front but builds equity.',
    'Open a route from your hub in the Route Planner, then assign aircraft and a weekly frequency on the route screen.',
    'Press Space (or the play button) to start the clock. Speeds 1–4 run from relaxed to very fast.',
  ] },
  { title: 'Demand & fares', body: [
    'Every city pair has a market based on population, wealth, business and tourism. Seasons, the economy, events and city trends move it constantly.',
    'You win a share of each market based on frequency, fares, comfort and reputation versus your rivals. Rival strength is shown as Low / Moderate / High.',
    'Fares above the market price earn more per seat but drive passengers away fast. When a route is full, raise fares; when it is empty, lower them or cut capacity. “Optimise” finds good fares for you.',
    'Hubs create connecting traffic: passengers fly spoke → hub → spoke. More routes from a hub means more connections.',
  ] },
  { title: 'Aircraft & cabins', body: [
    'Every aircraft is a real type with realistic range, speed, fuel burn and price. Turboprops excel on short hops; widebodies open the world.',
    'Cabins use real seat products — slimline economy, premium economy, recliners, lie-flat beds and first-class suites — each with real pitch and seats-per-row.',
    'Premium cabins earn high fares on long, business-heavy routes. On short leisure routes, density wins.',
    'Each aircraft family needs pilot training. A simpler fleet is cheaper to run.',
  ] },
  { title: 'Maintenance & reliability', body: [
    'Aircraft lose condition as they fly. Low condition raises maintenance costs and breakdowns, which hurt reputation.',
    'Heavy checks restore condition. Auto-maintenance can schedule them for you.',
  ] },
  { title: 'Expansion', body: [
    'You start with traffic rights in one region. Level up to unlock more regions on your continent.',
    'At level 5, earn the Long-Haul Operations Certificate, then unlock other continents one by one until you are a global airline.',
    'Open extra hubs as you level up, and build lounges, maintenance bases and connection centres.',
  ] },
  { title: 'Money', body: [
    'Monthly costs include leases, staff, hubs and stations, insurance and interest. Watch the income statement in Finance.',
    'Loans are limited by your credit rating and assets. Lessors also cap your total lease payments based on revenue and equity.',
    'If your cash stays negative for four month-ends, the airline goes bankrupt.',
  ] },
  { title: 'Shortcuts & saving', body: [
    'Space: pause/resume · 1–4: game speed · Esc: menu.',
    'The game autosaves every month into this browser. Use Export / Import in the menu to back up saves or move them between devices.',
    'CONTRAIL works fully offline once loaded — install it from the browser for an app-like experience.',
  ] },
];

function HandbookModal() {
  return (
    <Modal title="Airline Handbook" icon={<BookOpen className="accent" />} size="wide" onClose={() => store.closeModal()}>
      <div className="handbook">
        {HANDBOOK.map((sec) => (
          <section key={sec.title}>
            <h3>{sec.title}</h3>
            <ul>{sec.body.map((b, i) => <li key={i} className="small muted">{b}</li>)}</ul>
          </section>
        ))}
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
    case 'handbook': return <HandbookModal />;
    case 'confirm': return <ConfirmModal {...m} />;
    case 'cabin': return s.game ? <CabinModal aircraftId={m.aircraftId} /> : null;
    case 'order': return s.game ? <OrderModal typeId={m.typeId} /> : null;
    case 'buyUsed': return s.game ? <BuyUsedModal listingId={m.listingId} /> : null;
    case 'lease': return s.game ? <LeaseModal offerId={m.offerId} /> : null;
    case 'planner': return s.game ? <RoutePlanner hub={m.hub} dest={m.dest} /> : null;
  }
}
