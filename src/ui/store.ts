// Bridges the simulation engine and React: owns the game state, the real-time
// loop, navigation, toasts, settings and saving.

import { useSyncExternalStore } from 'react';
import type { Result } from '../engine/actions';
import { createGame, type NewGameOptions } from '../engine/newGame';
import { AUTOSAVE_SLOT, saveToSlot } from '../engine/save';
import { advanceDay } from '../engine/sim';
import type { GameState, Message } from '../engine/types';
import { monthKey } from '../engine/util';
import { type SoundName, sound } from './sound';

export type AppScreen = 'loading' | 'title' | 'newgame' | 'game';
export type Tab = 'hq' | 'map' | 'routes' | 'fleet' | 'market' | 'finance' | 'intel' | 'expansion' | 'brand' | 'goals' | 'inbox';
export type GameSpeed = 1 | 2 | 3 | 4;

export const SPEED_MS: Record<GameSpeed, number> = { 1: 4000, 2: 2000, 3: 900, 4: 350 };
export const SPEED_LABEL: Record<GameSpeed, string> = { 1: '1×', 2: '2×', 3: '4×', 4: '10×' };

export interface Settings {
  units: 'km' | 'mi';
  sound: boolean;
  volume: number;
  autosave: boolean;
  pauseOnEvents: boolean;
  /** Drop back to 1× when something important happens while fast-forwarding. */
  slowOnAlerts: boolean;
  mapAnimations: boolean;
  toasts: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  units: 'km', sound: true, volume: 0.5, autosave: true, pauseOnEvents: true, slowOnAlerts: true, mapAnimations: true, toasts: true,
};

export interface Nav {
  tab: Tab;
  routeId?: string;
  aircraftId?: string;
  /** Opens the route planner pre-filled. */
  plan?: { hub?: string; dest?: string };
  marketTab?: 'new' | 'used' | 'lease';
  marketType?: string;
}

export type ModalSpec =
  | { kind: 'menu' }
  | { kind: 'saves'; mode: 'save' | 'load' }
  | { kind: 'settings' }
  | { kind: 'handbook' }
  | { kind: 'cabin'; aircraftId: string }
  | { kind: 'order'; typeId: string }
  | { kind: 'buyUsed'; listingId: string }
  | { kind: 'lease'; offerId: string }
  | { kind: 'planner'; hub?: string; dest?: string }
  | { kind: 'confirm'; title: string; body: string; confirm: string; danger?: boolean; onConfirm: () => void };

export interface Toast {
  id: number;
  kind: 'good' | 'bad' | 'warn' | 'info';
  title: string;
  body?: string;
  leaving?: boolean;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('contrail:settings');
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // storage unavailable
  }
  return { ...DEFAULT_SETTINGS };
}

class GameStore {
  screen: AppScreen = 'loading';
  game: GameState | null = null;
  speed: GameSpeed = 2;
  paused = true;
  nav: Nav = { tab: 'hq' };
  modal: ModalSpec | null = null;
  toasts: Toast[] = [];
  settings: Settings = loadSettings();
  version = 0;
  clockVersion = 0;
  /** Fraction of the current day elapsed (for the clock). */
  dayFrac = 0;
  levelUp: number | null = null;

  private listeners = new Set<() => void>();
  private clockListeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private toastId = 0;
  private lastMsgId: string | null = null;
  private lastClockEmit = 0;

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
    this.paused = true;
    this.nav = { tab: 'hq' };
    this.screen = 'game';
    this.saveAuto();
    this.emit();
  }

  loadGame(state: GameState) {
    this.game = state;
    this.afterLoad();
    this.paused = true;
    this.nav = { tab: 'hq' };
    this.modal = null;
    this.screen = 'game';
    this.emit();
  }

  private afterLoad() {
    this.lastMsgId = this.game?.messages[0]?.id ?? null;
    this.acc = 0;
    this.dayFrac = 0;
    this.startLoop();
  }

  quitToTitle() {
    this.saveAuto();
    this.stopLoop();
    this.game = null;
    this.modal = null;
    this.screen = 'title';
    this.emit();
  }

  private lastAutosave = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Save now (on exit, pause, menus). */
  saveAuto() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    if (this.game && this.settings.autosave && !this.game.gameOver) {
      saveToSlot(this.game, AUTOSAVE_SLOT);
      this.lastAutosave = performance.now();
    }
  }

  /** Periodic autosave, throttled and run outside the animation frame to avoid hitches. */
  private scheduleAutosave() {
    if (this.autosaveTimer || performance.now() - this.lastAutosave < 45_000) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.saveAuto();
    }, 50);
  }

  // ---------- time ----------

  get blocked(): boolean {
    const g = this.game;
    if (!g) return true;
    if (g.gameOver || g.yearReview) return true;
    if (this.settings.pauseOnEvents && g.decisions.length > 0) return true;
    return false;
  }

  setSpeed(s: GameSpeed) {
    this.speed = s;
    this.paused = false;
    sound.play('tick');
    this.emit();
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) this.saveAuto();
    sound.play('tick');
    this.emit();
  }

  private startLoop() {
    this.stopLoop();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      this.frame(dt, now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame(dt: number, now: number) {
    const g = this.game;
    if (!g || this.paused || this.blocked || this.modalPauses()) return;
    const msPerDay = SPEED_MS[this.speed];
    this.acc += dt;
    let advanced = 0;
    while (this.acc >= msPerDay && advanced < 4) {
      this.acc -= msPerDay;
      this.stepDay();
      advanced++;
      if (this.blocked) break;
      if (SPEED_MS[this.speed] !== msPerDay) {
        // Slowed down by an alert: don't run the rest of this frame at the old speed.
        this.acc = 0;
        break;
      }
    }
    if (this.acc > msPerDay * 4) this.acc = 0;
    this.dayFrac = Math.min(0.999, this.acc / msPerDay);
    if (advanced > 0) this.emit();
    if (now - this.lastClockEmit > 80 || advanced > 0) {
      this.lastClockEmit = now;
      this.emitClock();
    }
  }

  /** Dialogs pause time so you can think. */
  private modalPauses(): boolean {
    return this.modal !== null;
  }

  stepDay() {
    const g = this.game;
    if (!g) return;
    const month = monthKey(g.day);
    const level = g.level;
    advanceDay(g);
    if (g.level > level) {
      this.levelUp = g.level;
      sound.play('levelup');
    }
    if (monthKey(g.day) !== month) {
      this.scheduleAutosave();
      sound.play('cash');
    }
    const alerted = this.handleAlerts(g);
    this.surfaceMessages(alerted);
    if (g.decisions.length && this.settings.pauseOnEvents) sound.play('alert');
  }

  /**
   * The engine flags what a player shouldn't miss (already merged and rate-limited). Toast it and,
   * when fast-forwarding, drop back to 1× so there is time to react. Returns the messages toasted.
   */
  private handleAlerts(g: GameState): Set<string> {
    const shown = new Set<string>();
    if (!g.alerts.length) return shown;
    const slow = this.settings.slowOnAlerts && this.speed > 1 && !this.paused;
    if (slow) this.speed = 1;
    for (const a of g.alerts) {
      const m = g.messages.find((x) => x.id === a.msgId);
      if (!this.settings.toasts && !slow) continue;
      shown.add(a.msgId);
      const kind = m?.kind === 'bad' ? 'bad' : m?.kind === 'good' ? 'good' : m?.kind === 'warn' ? 'warn' : 'info';
      const body = a.body.length > 140 ? a.body.slice(0, 137) + '…' : a.body;
      this.toast(kind, a.count > 1 ? `${a.title} (+${a.count - 1} more)` : a.title, slow ? `Slowed to 1×. ${body}` : body);
    }
    if (slow) sound.play('alert');
    return shown;
  }

  private surfaceMessages(skip: Set<string> = new Set()) {
    const g = this.game!;
    const fresh: Message[] = [];
    for (const m of g.messages) {
      if (m.id === this.lastMsgId) break;
      fresh.push(m);
    }
    this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    if (!this.settings.toasts) return;
    for (const m of fresh.reverse()) {
      if (skip.has(m.id)) continue;
      const important = m.kind === 'event' || m.kind === 'bad' || m.category === 'goal' || (m.category === 'fleet' && m.title.startsWith('Delivered') && g.fleet.length < 20);
      if (!important) continue;
      this.toast(m.kind === 'event' ? 'info' : m.kind === 'good' ? 'good' : m.kind === 'bad' ? 'bad' : m.kind === 'warn' ? 'warn' : 'info', m.title, m.body.length > 140 ? m.body.slice(0, 137) + '…' : m.body);
    }
  }

  // ---------- actions ----------

  /** Run a player action against the game, toast the result and re-render. */
  act<R extends Result>(fn: (g: GameState) => R, opts: { toastOk?: boolean; sound?: SoundName } = {}): R {
    const g = this.game;
    if (!g) return { ok: false, error: 'No game loaded' } as R;
    const res = fn(g);
    if (!res.ok) {
      this.toast('bad', 'Not possible', res.error);
      sound.play('error');
    } else {
      if (opts.toastOk !== false && res.msg) this.toast('good', res.msg);
      sound.play(opts.sound ?? 'success');
      this.surfaceMessagesQuiet();
    }
    this.emit();
    return res;
  }

  /** Mutate game state directly (no validation needed) and re-render. */
  update(fn: (g: GameState) => void) {
    if (!this.game) return;
    fn(this.game);
    this.emit();
  }

  private surfaceMessagesQuiet() {
    this.lastMsgId = this.game?.messages[0]?.id ?? this.lastMsgId;
  }

  // ---------- navigation & UI ----------

  navigate(tab: Tab, extra: Omit<Nav, 'tab'> = {}) {
    this.nav = { tab, ...extra };
    sound.play('click');
    this.emit();
    document.querySelector('.main')?.scrollTo({ top: 0 });
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
    this.toasts = [...this.toasts.slice(-4), { id, kind, title, body }];
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

  dismissLevelUp() {
    this.levelUp = null;
    this.emit();
  }

  setSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    sound.configure(this.settings.sound, this.settings.volume);
    try {
      localStorage.setItem('contrail:settings', JSON.stringify(this.settings));
    } catch {
      // ignore
    }
    this.emit();
  }
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
  window.addEventListener('beforeunload', () => store.saveAuto());
}

export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** Game state hook — only valid inside the game screen. */
export function useGame(): GameState {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store.game!;
}

export function useClock(): number {
  useSyncExternalStore(store.subscribeClock, store.getClockVersion);
  return store.dayFrac;
}
