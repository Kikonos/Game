// Bridges the engine and React: owns the game state, the real-time loop (game minutes per frame),
// navigation, modals, quiet toasts, settings and saving. DESIGN.md §3.4 and §6.

import { useSyncExternalStore } from 'react';
import { clearPause, takePause, type PauseReason } from '../engine/core/pause';
import { CLOCK_STEP, type GameSpeed, minutesPerMs, monthKey } from '../engine/core/time';
import type { RatingFamily } from '../data/acmiTypes';
import type { ActionResult, Archetype, GameState, Message, PaintKind, Ref, Role } from '../engine/core/types';
import { acceptOffer, declineOffer, feasibilityAll, generateOffer } from '../engine/contracts';
import { DAY } from '../engine/core/time';
import { pushDecision } from '../engine/core/messages';
import { demoFlights, devFleet } from '../engine/dev';
import { createGame, type NewGameOptions } from '../engine/newGame';
import { AUTOSAVE_SLOT, saveToSlot, serialize } from '../engine/save';
import { advanceTo, settle } from '../engine/sim';
import { prepareAsyncSave, saveTextAsync, supersedeAsyncSave } from './asyncSave';
import { autoplay } from './devPlay';
import { type SoundName, sound } from './sound';

export type { GameSpeed } from '../engine/core/time';
export type AppScreen = 'loading' | 'title' | 'newgame' | 'game';
export type Tab = 'map' | 'contracts' | 'schedule' | 'crew' | 'fleet' | 'finance' | 'company' | 'inbox';

export const SPEED_LABEL: Record<GameSpeed, string> = { 1: '1×', 2: '2×', 4: '4×' };

export interface Settings {
  units: 'km' | 'nm';
  sound: boolean;
  volume: number;
  autosave: boolean;
  /** Which engine pause requests actually stop the clock. */
  autoPause: Record<PauseReason, boolean>;
  mapAnimations: boolean;
  toasts: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  units: 'km',
  sound: true,
  volume: 0.5,
  autosave: true,
  autoPause: { decision: true, urgentOffer: true, aog: true, monthEnd: false, contractStart: false, crewShortage: true },
  mapAnimations: true,
  toasts: true,
};

export interface Nav {
  tab: Tab;
  /** Selected entity (map panel, detail views). */
  sel?: Ref;
  /** Screen-specific sub-view, e.g. Contracts 'market' | 'active'. */
  view?: string;
}

export type ModalSpec =
  | { kind: 'menu' }
  | { kind: 'saves'; mode: 'save' | 'load' }
  | { kind: 'settings' }
  /** Offer review / accept / counter flow (B5). */
  | { kind: 'offer'; offerId: string }
  | { kind: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void }
  /** B5: a decision opened from the Inbox (closable); hire, training and check planning dialogs. */
  | { kind: 'decision'; decisionId: string }
  | { kind: 'hire'; role?: Role; family?: RatingFamily; base?: string }
  | { kind: 'train'; crewId: string }
  | { kind: 'check'; aircraftId: string; checkKind?: 'A' | 'C'; replace?: string }
  /** B5: Schedule detail sheet for the blocks near a tap (flights, maintenance) or an idle gap. */
  | { kind: 'sheet'; refs: Ref[]; idle?: { aircraftId: string; from: number; to: number; at: string } }
  /** Manual roster adjustment for a duty's trip (duty id or flight id). */
  | { kind: 'duty'; id: string }
  /** Hand legs of a contract to a rival operator. */
  | { kind: 'subcharter'; contractId: string; flightId?: string }
  /** v0.5.1 livery editor: the company livery or one aircraft's (Company · All white · Custom). */
  | { kind: 'livery'; target: 'company' | { aircraftId: string } };

export interface Toast {
  id: number;
  kind: 'good' | 'bad' | 'warn' | 'info';
  title: string;
  body?: string;
  leaving?: boolean;
}

const SETTINGS_KEY = 'contrail-acmi:settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Settings>;
      return { ...DEFAULT_SETTINGS, ...s, autoPause: { ...DEFAULT_SETTINGS.autoPause, ...s.autoPause } };
    }
  } catch {
    // storage unavailable
  }
  return { ...DEFAULT_SETTINGS, autoPause: { ...DEFAULT_SETTINGS.autoPause } };
}

class GameStore {
  screen: AppScreen = 'loading';
  game: GameState | null = null;
  speed: GameSpeed = 1;
  paused = true;
  /** Why the clock last stopped by itself (shown in the speed control tooltip). */
  pauseReason: PauseReason | null = null;
  nav: Nav = { tab: 'map' };
  modal: ModalSpec | null = null;
  toasts: Toast[] = [];
  settings: Settings = loadSettings();
  version = 0;
  clockVersion = 0;
  /** Continuous game time (fractional minutes) for smooth plane motion; g.now is its integer part. */
  exact = 0;
  /** Decision ids the player set aside with 'Look first'; the modal stays shut until the list changes. */
  decisionDeferred: string | null = null;
  /** Game time of the last completed autosave write (-1: none this session). */
  savedNow = -1;
  /** g.now + player edit count at the last completed autosave; unchanged state is not written twice. */
  private savedMark = '';
  private edits = 0;

  private listeners = new Set<() => void>();
  private clockListeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private toastId = 0;
  private lastMsgId: string | null = null;
  private clockLabel = -1;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  subscribeClock = (fn: () => void) => {
    this.clockListeners.add(fn);
    return () => this.clockListeners.delete(fn);
  };
  getVersion = () => this.version;
  getClockVersion = () => this.clockVersion;

  emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  private emitClock() {
    this.clockVersion++;
    for (const fn of this.clockListeners) fn();
  }

  // ---------- lifecycle ----------

  setScreen(s: AppScreen) {
    this.screen = s;
    this.emit();
  }

  startNewGame(opts: NewGameOptions) {
    this.game = createGame(opts);
    this.afterLoad();
    this.saveAuto();
    this.emit();
  }

  loadGame(state: GameState) {
    this.game = state;
    this.afterLoad();
    this.emit();
  }

  private afterLoad() {
    prepareAsyncSave();
    this.savedNow = -1;
    this.savedMark = '';
    this.decisionDeferred = null;
    this.lastMsgId = this.game?.messages[0]?.id ?? null;
    this.exact = this.game?.now ?? 0;
    this.paused = true;
    this.pauseReason = null;
    this.nav = { tab: 'map' };
    this.modal = null;
    this.screen = 'game';
    this.startLoop();
  }

  /** Always writes the autosave (even with Autosave off), unless the game is over. */
  quitToTitle() {
    this.saveAuto(true);
    this.stopLoop();
    this.game = null;
    this.modal = null;
    this.screen = 'title';
    this.emit();
  }

  private lastAutosave = 0;
  private saveWarned = false;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  private saveFailed() {
    if (this.saveWarned) return;
    this.saveWarned = true;
    this.toast('bad', 'Autosave failed', 'Browser storage is full or unavailable. Delete old saves in Menu → Save game.');
  }

  /** Synchronous autosave (leaving the page, quitting). `force` ignores the Autosave setting. */
  saveAuto(force = false): boolean {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    const g = this.game;
    if (!g || g.gameOver || !(force || this.settings.autosave)) return false;
    const mark = this.mark(g);
    if (mark === this.savedMark) return true;
    supersedeAsyncSave();
    const ok = saveToSlot(g, AUTOSAVE_SLOT);
    if (ok) {
      this.savedNow = g.now;
      this.savedMark = mark;
    } else this.saveFailed();
    this.lastAutosave = performance.now();
    return ok;
  }

  /** Autosave off the main thread (pause, month end): serialize here, compress in a worker. */
  saveAutoSoon() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    const g = this.game;
    if (!g || g.gameOver || !this.settings.autosave) return;
    const mark = this.mark(g);
    if (mark === this.savedMark) return;
    const now = g.now;
    this.lastAutosave = performance.now();
    const sent = saveTextAsync(serialize(g, AUTOSAVE_SLOT), AUTOSAVE_SLOT, (ok, latest) => {
      if (ok && latest) {
        this.savedNow = now;
        this.savedMark = mark;
      } else if (!ok && this.game === g) this.saveAuto();
    });
    if (!sent) this.saveAuto();
  }

  private mark(g: GameState): string {
    return `${g.now}:${this.edits}`;
  }

  /** Throttled autosave run outside the animation frame to avoid hitches. */
  private scheduleAutosave() {
    if (this.autosaveTimer || performance.now() - this.lastAutosave < 30_000) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.saveAutoSoon();
    }, 50);
  }

  // ---------- time ----------

  /** Time is held while a decision waits (when decisions auto-pause) or the game is over. */
  get blocked(): boolean {
    const g = this.game;
    if (!g) return true;
    if (g.gameOver) return true;
    return this.settings.autoPause.decision && g.decisions.length > 0;
  }

  setSpeed(s: GameSpeed) {
    this.speed = s;
    this.paused = false;
    this.pauseReason = null;
    sound.play('tick');
    this.emit();
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseReason = null;
    sound.play('tick');
    this.emit();
    // After the paused state paints; skipped when nothing moved since the last save.
    if (this.paused) setTimeout(() => this.saveAutoSoon(), 0);
  }

  /** 'Look first': shuts the self-opening decision dialog; time stays held (blocked) until it is answered. */
  deferDecision() {
    const g = this.game;
    this.decisionDeferred = g ? g.decisions.map((d) => d.id).join(',') : null;
    this.emit();
  }

  /** Whether the oldest decision opens by itself now. */
  get decisionOpen(): boolean {
    const g = this.game;
    if (!g || !g.decisions.length || !this.settings.autoPause.decision) return false;
    return this.decisionDeferred !== g.decisions.map((d) => d.id).join(',');
  }

  /** Re-opens a decision set aside with 'Look first'. */
  reopenDecision() {
    this.decisionDeferred = null;
    sound.play('click');
    this.emit();
  }

  private startLoop() {
    this.stopLoop();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - this.last);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Advances game time by dt real ms: events up to floor(exact), React refresh at most once per game hour. */
  private frame(dt: number) {
    const g = this.game;
    if (!g || this.paused || this.blocked || this.modal) return;
    this.exact += dt * minutesPerMs(this.speed);
    const target = Math.floor(this.exact);
    if (target > g.now) {
      const month = monthKey(g.now);
      // Only reasons the settings honour stop the loop; the others are dropped inside advanceTo.
      const res = advanceTo(g, target, this.honoured());
      const hour = res.hourChanged;
      if (res.pause) this.autoPause(res.pause);
      if (monthKey(g.now) !== month) this.scheduleAutosave();
      const fresh = this.surfaceMessages();
      if (hour || this.paused || fresh) this.emit();
    }
    const step = CLOCK_STEP[this.speed];
    const label = Math.floor(this.exact / step);
    if (label !== this.clockLabel) {
      this.clockLabel = label;
      this.emitClock();
    }
  }

  /** Pause reasons the settings honour. */
  private honoured(): Set<PauseReason> {
    return new Set((Object.keys(this.settings.autoPause) as PauseReason[]).filter((r) => this.settings.autoPause[r]));
  }

  private autoPause(reason: PauseReason) {
    this.paused = true;
    this.pauseReason = reason;
    if (this.game) this.exact = this.game.now;
    sound.play('alert');
  }

  /** Quiet toasts for important new messages only. Returns whether anything new arrived. */
  private surfaceMessages(): boolean {
    const g = this.game!;
    const fresh: Message[] = [];
    for (const m of g.messages) {
      if (m.id === this.lastMsgId) break;
      fresh.push(m);
    }
    this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    if (!this.settings.toasts) return fresh.length > 0;
    for (const m of fresh.reverse()) {
      if (m.tone === 'bad' || m.cat === 'goal') this.toast(m.tone === 'bad' ? 'bad' : 'good', m.title, m.body.length > 140 ? m.body.slice(0, 137) + '…' : m.body);
    }
    return fresh.length > 0;
  }

  // ---------- actions ----------

  /** Runs a player action against the game, toasts the result and re-renders. */
  act<T>(fn: (g: GameState) => ActionResult<T>, opts: { toastOk?: boolean; sound?: SoundName } = {}): ActionResult<T> {
    const g = this.game;
    if (!g) return { ok: false, error: 'No game loaded' };
    clearPause();
    this.edits++;
    const res = fn(g);
    // Cross-module follow-ups (e.g. crew re-sync) and pauses the action raised (e.g. crewShortage on accept).
    settle(g);
    const pause = takePause(this.honoured());
    if (pause && pause !== 'decision') this.autoPause(pause);
    if (!res.ok) {
      this.toast('bad', 'Not possible', res.error);
      sound.play('error');
    } else {
      if (opts.toastOk !== false && res.msg) this.toast('good', res.msg);
      sound.play(opts.sound ?? 'success');
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    }
    this.emit();
    return res;
  }

  /** Mutates game state directly (no validation needed) and re-renders. */
  update(fn: (g: GameState) => void) {
    if (!this.game) return;
    this.edits++;
    fn(this.game);
    this.emit();
  }

  // ---------- navigation & UI ----------

  navigate(tab: Tab, extra: Omit<Nav, 'tab'> = {}) {
    this.nav = { tab, ...extra };
    sound.play('click');
    this.emit();
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  /** Selects an entity on the current screen (map panel etc.). */
  select(sel: Ref | undefined) {
    this.nav = { ...this.nav, sel };
    this.emit();
  }

  openModal(m: ModalSpec) {
    this.modal = m;
    sound.play('click');
    this.emit();
  }

  closeModal() {
    this.modal = null;
    this.emit();
  }

  toast(kind: Toast['kind'], title: string, body?: string) {
    const id = ++this.toastId;
    this.toasts = [...this.toasts.slice(-2), { id, kind, title, body }];
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
      this.emit();
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
        this.emit();
      }, 260);
    }, kind === 'bad' ? 6000 : 4200);
  }

  setSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    sound.configure(this.settings.sound, this.settings.volume);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    this.emit();
  }

  /** Console helpers for building screens before every module exists. */
  dev = {
    demoFlights: (days = 3) => {
      if (!this.game) return 0;
      const n = demoFlights(this.game, undefined, days);
      this.emit();
      return n;
    },
    /** One offer of an archetype (null until B1 lands); opens the offer modal. */
    offer: (archetype?: Archetype) => {
      if (!this.game) return null;
      const o = generateOffer(this.game, archetype);
      if (o) this.openModal({ kind: 'offer', offerId: o.id });
      this.emit();
      return o?.id ?? null;
    },
    /** v0.5.1: a season base whose client asks for their livery (forced request); opens the offer modal. */
    paintOffer: (kind: PaintKind = 'full', required?: boolean) => {
      const g = this.game;
      if (!g) return null;
      const o = generateOffer(g, 'seasonBase', { paint: { kind, required }, wide: false, start: g.now + 40 * DAY, days: 90 });
      if (o) this.openModal({ kind: 'offer', offerId: o.id });
      this.emit();
      return o?.id ?? null;
    },
    /** v0.5.1: signs a forced paint offer on the first aircraft that can take it (paint on); returns the contract id. */
    paintJob: (kind: PaintKind = 'decals', days = 60) => {
      const g = this.game;
      if (!g) return null;
      for (const lead of [12, 20, 30, 45, 60, 90, 120]) {
        const o = generateOffer(g, 'seasonBase', { paint: { kind, required: true }, wide: false, start: g.now + lead * DAY, days });
        if (!o) continue;
        const ok = feasibilityAll(g, o.id, { paint: true }).find((r) => r.level !== 'no');
        const res = ok ? acceptOffer(g, o.id, [ok.aircraftId], { paint: true }) : null;
        if (res?.ok) {
          this.emit();
          return res.data!.contractId;
        }
        declineOffer(g, o.id);
      }
      this.emit();
      return null;
    },
    /** Grows the fleet to n aircraft (clones) for perf checks with demoFlights. */
    fleet: (n = 10) => {
      if (!this.game) return 0;
      const added = devFleet(this.game, n);
      this.emit();
      return added;
    },
    /** B5: a sample decision (no engine effect) to check DecisionModal, the Inbox pin and the pause badge. */
    decision: () => {
      if (!this.game) return null;
      const d = pushDecision(this.game, {
        kind: 'dev', title: 'Sample decision', body: 'A dev-only decision with three options. Choosing one does nothing.', defaultOption: 'b', expires: this.game.now + 6 * 60,
        options: [
          { id: 'a', label: 'Spend money', desc: 'Costs cash, keeps the client happy.', tone: 'good', chips: ['−$12K', 'Reliable +1'] },
          { id: 'b', label: 'Wait and see', desc: 'Nothing happens.' },
          { id: 'c', label: 'Refuse', desc: 'Saves money, upsets the client.', tone: 'bad', chips: ['Clean −1'] },
        ],
      });
      this.emit();
      return d.id;
    },
    /** Fast-forwards `days` game days with a simple policy (accept best offers, decision defaults, hire to staffing). */
    autoplay: (days = 30) => {
      const g = this.game;
      if (!g) return 0;
      const n = autoplay(g, days);
      this.exact = g.now;
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      this.emit();
      this.emitClock();
      return n;
    },
    /** B5: React renders per screen (dev builds only), to check the calm-UI budget (≤ ~2/s at 4×). */
    renders: {} as Record<string, number>,
  };
}

export const store = new GameStore();

let resumeSave: string | null = null;
/** A game handed over by a live update; the loading screen resumes it. */
export function setResumeSave(text: string) {
  resumeSave = text;
}
export function takeResumeSave(): string | null {
  const s = resumeSave;
  resumeSave = null;
  return s;
}
sound.configure(store.settings.sound, store.settings.volume);
// Handy for debugging and automated testing from the console.
(globalThis as unknown as { __contrail?: GameStore }).__contrail = store;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.saveAuto();
  });
  window.addEventListener('pagehide', () => store.saveAuto());
  window.addEventListener('beforeunload', () => store.saveAuto());
}

export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Game state hook — only valid inside the game screen. Re-renders at most once per game hour while running. */
export function useGame(): GameState {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.game!;
}

/** Clock hook: re-renders when the displayed clock label changes (CLOCK_STEP); returns fractional game minutes. */
export function useClock(): number {
  useSyncExternalStore(store.subscribeClock, store.getClockVersion);
  return store.exact;
}

/** Continuous game time for imperative animation loops (map planes); read every frame, never via React. */
export function liveMinute(): number {
  return store.exact;
}
