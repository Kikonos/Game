// Bridges the engine and React: owns the game state, the real-time loop (game minutes per frame),
// navigation, modals, quiet toasts, settings and saving. DESIGN.md §3.4 and §6.

import { deliveryCardFor } from './modals/deliveryCard';
import { startTransition, useEffect, useState, useSyncExternalStore } from 'react';
import { clearPause, takePause, type PauseReason } from '../engine/core/pause';
import { CLOCK_STEP, type GameSpeed, minutesPerMs, monthKey } from '../engine/core/time';
import type { CabinLayout, RatingFamily } from '../data/acmiTypes';
import type { ActionResult, ApprovalId, Archetype, CrewFix, GameState, Message, PaintKind, ProblemRef, Ref, RestRefitId, Role } from '../engine/core/types';
import { HINTS, type TermId } from '../data/glossary';
import { problemFor } from '../engine/problems';
import { acceptOffer, counterOffer, declineOffer, feasibilityAll, generateOffer } from '../engine/contracts';
import { DAY } from '../engine/core/time';
import { pushDecision } from '../engine/core/messages';
import type { ClientLevel } from '../engine/contracts';
import type { WorldEventKind } from '../engine/core/types';
import { devDeportation, devDryLease, devEvacuation, devHajj, devLevel, devMixedCrew, devRivalBid, devWorldEvent } from '../engine/dev';
import { demoFlights, devAddType, devCrewShortage, devExtension, devFleet, devGrantApproval, devMarketOffer, devRestPlan, devRestSeats, devSaleReady, devShortCruise, devSplit, devStandby } from '../engine/dev';
import { dropTargets, moveDuty, publishedTo, resignNow, type DropTarget, type MoveScope } from '../engine/crew';
import { acquireAircraft, headsView, headView } from '../engine/ops';
import { createGame, type NewGameOptions } from '../engine/newGame';
import { AUTOSAVE_SLOT, saveToSlot, serialize } from '../engine/save';
import { advanceTo, settle } from '../engine/sim';
import { prepareAsyncSave, saveTextAsync, supersedeAsyncSave } from './asyncSave';
import { autoplay } from './devPlay';
import { type Ambience, sound, type SoundEvent } from './sound';
import { activeTheme, applyTheme, type Theme, type ThemePref } from './theme';
import { deviceNow, type DevicePref, onDeviceChange, setDevicePrefs, type UiSizePref } from './device';
import { cue, takeCueEvents, takeCues, type CueEvent } from '../engine/core/cues';
import type { HeadId } from '../engine/core/types';
import { devAchievement, devCrewHours, devJumbo, devPeak, devPosition, devRestAtDeparture, devRoster, devSlipOffer, devUnlockHead } from '../engine/dev';
import type { OohLimit, Pace } from '../engine/core/types';
import { setPace } from '../engine/ops/director';
import { devDisruption } from '../engine/ops/disrupt';
import { CURFEWS } from '../data/opsData';
import { inspect, rampFindings } from '../engine/ops/ramp';
import { devAudit } from '../engine/ops/audit';

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
  /** Extra empty band above the top bar (px) — iPadOS 26 frosts the top edge of home-screen web apps. */
  topGap: 'auto' | 0 | 16 | 28 | 40;
  toasts: boolean;
  /** v0.7: new aircraft market offers show in the Inbox with a quiet toast (off: hidden, never pause). */
  marketAlerts: boolean;
  /** The newest "What's new" version the player has dismissed ('' = never). */
  seenWhatsNew: string;
  /** v0.7.1: kinds of problem whose first-time hint the player dismissed with 'Don't show again'. */
  hintsSeen: string[];
  /** v0.9 §S.5 sound categories (master = `sound`, `volume`); ambience stays off unless chosen. */
  soundCats: { alerts: boolean; chimes: boolean; flights: boolean; ui: boolean };
  ambience: Ambience;
  /** v0.9.1 calm background music: on by default at a low volume (its own switch and volume; ambience stays apart). */
  music: boolean;
  musicVolume: number;
  /** v0.9 §14.2 screens whose first-time hint the player switched off ('Don't show again'). */
  screenHintsSeen: string[];
  /** v0.12 screens whose hint has been seen once: it folds into the screen's '?' button. */
  screenHintsFolded: string[];
  /** v0.9 §X: '' until the one-time What's new catch-up (v0.9 + v0.8 + v0.7.4) has been shown, then 'v0.9'. */
  whatsNewCatchUp: string;
  /** v0.11 Appearance: Light, Dark or follow the device. New installs: 'system'; players from before: 'dark' (their look). */
  theme: ThemePref;
  /** v0.11 Gameplay → Pace: how long the quiet spells between busy ones are (the engine's event director). */
  pace: Pace;
  /** v0.12 Display › Device: 'auto' detects the iPhone, iPad or computer (ui/device.ts); the others override it. */
  device: DevicePref;
  /** v0.12 Display › Size: Smaller / Normal / Larger; 'auto' is Larger on a big computer screen, Normal elsewhere. */
  uiSize: UiSizePref;
}

const DEFAULT_SETTINGS: Settings = {
  units: 'km',
  sound: true,
  volume: 0.6,
  autosave: true,
  autoPause: { decision: true, urgentOffer: true, aog: true, monthEnd: false, contractStart: false, crewShortage: true, marketOffer: false, crewHours: true, rule: true },
  mapAnimations: true,
  topGap: 'auto',
  toasts: true,
  marketAlerts: true,
  seenWhatsNew: '',
  hintsSeen: [],
  soundCats: { alerts: true, chimes: true, flights: false, ui: true },
  ambience: 'off',
  music: true,
  musicVolume: 0.35,
  screenHintsSeen: [],
  screenHintsFolded: [],
  whatsNewCatchUp: '',
  theme: 'system',
  pace: 'normal',
  device: 'auto',
  uiSize: 'auto',
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
  | { kind: 'hire'; role?: Role; family?: RatingFamily; base?: string; /** Peak-staffing round: prefilled from the busy-month heads-up. */ count?: number }
  /** v0.7.4 Crew planning round-up: hire the crew that complete `target` sets of a family. */
  | { kind: 'roundUp'; family: RatingFamily; target: number }
  | { kind: 'train'; crewId: string }
  | { kind: 'check'; aircraftId: string; checkKind?: 'A' | 'C'; replace?: string; /** v0.7.3 tick the crew rest add-on */ restFit?: 'fcrc' | 'overhead'; /** v0.7.3 back to the refit modal's crew rest section */ backToRefit?: boolean; /** v0.7.2.2 from an idle gap: the slot to offer first (A: start and airport; C: windows from `after` at this hub). */ suggest?: { start: number; at: string }; after?: number }
  /** B5: Schedule detail sheet for the blocks near a tap (flights, maintenance) or an idle gap. */
  | { kind: 'sheet'; refs: Ref[]; idle?: { aircraftId: string; from: number; to: number; at: string } }
  /** Manual roster adjustment for a duty's trip (duty id or flight id). */
  | { kind: 'duty'; id: string }
  /** Hand legs of a contract to a rival operator. */
  | { kind: 'subcharter'; contractId: string; flightId?: string; /** v0.8 the rival to pre-select */ rivalId?: string }
  /** v0.5.1 livery editor: the company livery or one aircraft's (Company · All white · Custom). */
  | { kind: 'livery'; target: 'company' | { aircraftId: string } }
  /** v0.6: bulk type-rating conversion for the selected crew; the classes list (cancel per class / member). */
  | { kind: 'convert'; crewIds: string[]; family?: RatingFamily; onBooked?: () => void }
  | { kind: 'classes' }
  /** v0.7: sign a market offer; cabin refit; lease extend/return; an approval on the ladder; the ladder-step celebration. */
  | { kind: 'acquire'; offerId: string }
  | { kind: 'refit'; aircraftId: string; layout?: CabinLayout; /** back to this offer when done */ offerId?: string; /** v0.7.2 open on crew rest seats */ rest?: boolean; /** v0.7.3 open on the crew rest section, this option picked */ section?: 'rest'; restOption?: RestRefitId; /** v0.7.2.2 from an idle gap: windows from this time */ after?: number }
  | { kind: 'lease'; aircraftId: string; /** v0.7.2 'early': the early-return tab */ tab?: 'renew' | 'early' }
  /** v0.7.2: sell an owned aircraft (quote, blockers, confirm; cancel an agreed sale). */
  | { kind: 'sell'; aircraftId: string }
  | { kind: 'approval'; id: ApprovalId }
  | { kind: 'ladderStep'; messageId: string }
  | { kind: 'whatsNew'; /** v0.8 fix pack: every version (Settings), not just the unseen ones. */ all?: boolean }
  /** v0.7.1: Crew Control for a flight (a fix pre-expanded); the four-line card of a problem (hint: first-time story); the glossary. */
  | { kind: 'crewControl'; flightId: string; fix?: CrewFix }
  | { kind: 'problem'; subject: ProblemRef; hint?: boolean }
  | { kind: 'glossary'; term?: TermId }
  /** v0.7.2.1 trip swap: confirm moving the trip of a flight to another aircraft (money before / after). */
  | { kind: 'tripMove'; flightId: string; targetId: string; /** v0.9.1 the dialog to come back to (the offer's schedule portal) */ back?: ModalSpec }
  /** v0.7.2.2 check planning: confirm moving a booked A/C-check or refit along its aircraft's timeline. */
  | { kind: 'maintMove'; maintId: string; start: number }
  /** v0.8 World: a client's relationship, a rival operator, the market outlook, a world event. */
  | { kind: 'client'; clientId: string }
  | { kind: 'rival'; rivalId: string }
  | { kind: 'outlook' }
  | { kind: 'worldEvent'; eventId: string }
  /** v0.9 §5.4 the celebration card of a department head just earned (`ids`: several earned at once, e.g. an old save). */
  | { kind: 'headUnlocked'; id: HeadId; ids?: HeadId[] }
  /** v0.9.1 a client's answer to our counter-offer, wherever the player is (Accept / Decline as it applies). */
  | { kind: 'counterReply'; offerId?: string; contractId?: string; title: string; body: string }
  /** v0.10.2 an urgent, high-paying offer phones in (it rings while shown). */
  | { kind: 'offerCall'; offerId: string }
  /** v0.9.1 an aircraft handed over: the celebration card, then 'Follow the delivery flight?'. */
  | { kind: 'delivered'; aircraftId: string }
  | { kind: 'followDelivery'; aircraftId: string };

export interface Toast {
  id: number;
  /** v0.9 'achievement': the calm trophy toast (§14.1). */
  kind: 'good' | 'bad' | 'warn' | 'info' | 'achievement';
  title: string;
  body?: string;
  leaving?: boolean;
}

const SETTINGS_KEY = 'contrail-acmi:settings';
/** v0.9.1 how long a toast stays (the player: 5 s; a tap dismisses it sooner). */
export const TOAST_MS = 5000;

/** v0.9.1 a cue's toast colour: its tone (an achievement and a ladder step get the trophy toast). */
export function cueToastKind(e: Pick<CueEvent, 'cue' | 'tone'>): Toast['kind'] {
  if (e.cue === 'achievement' || e.cue === 'ladder' || e.cue === 'headUnlocked' || e.cue === 'delivered') return 'achievement';
  if (e.cue === 'crewShortage' || e.cue === 'crewOutOfHours') return 'bad';
  return e.tone === 'bad' ? 'bad' : e.tone === 'warn' ? 'warn' : e.tone === 'good' ? 'good' : 'info';
}

/** Pushes the shell below the band iPadOS 26 blurs at the top of web apps ('auto' = 28 px when installed). */
export function applyTopGap(s: Pick<Settings, 'topGap'>) {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const installed = nav.standalone === true || matchMedia('(display-mode: standalone)').matches;
    // v0.12 only the iPad frosts that band: an iPhone on its side or an installed app on a computer has none.
    const px = s.topGap === 'auto' ? (installed && deviceNow().kind === 'ipad' ? 28 : 0) : s.topGap;
    document.documentElement.style.setProperty('--top-gap', `${px}px`);
  } catch {
    // no DOM (tests)
  }
}

/** Stored settings (an older version's included) with every missing field at its default. Pure. */
export function settingsFrom(s: Partial<Settings>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, ...s, autoPause: { ...DEFAULT_SETTINGS.autoPause, ...s.autoPause }, soundCats: { ...DEFAULT_SETTINGS.soundCats, ...s.soundCats } };
  // v0.9.1 settings saved before the music: on, at its low default.
  out.music ??= DEFAULT_SETTINGS.music;
  out.musicVolume ??= DEFAULT_SETTINGS.musicVolume;
  // v0.12 settings saved before folded hints: none folded yet.
  out.screenHintsFolded ??= [];
  // v0.11 settings saved before themes: the dark look they have played with.
  if (s.theme !== 'light' && s.theme !== 'dark' && s.theme !== 'system') out.theme = 'dark';
  // v0.11 settings saved before Pace: Normal.
  if (s.pace !== 'calm' && s.pace !== 'normal' && s.pace !== 'busy') out.pace = 'normal';
  // v0.12 settings saved before devices: detect the device, size from the screen.
  out.device ??= DEFAULT_SETTINGS.device;
  out.uiSize ??= DEFAULT_SETTINGS.uiSize;
  if (!(['auto', 'iphone', 'ipad', 'computer'] as const).includes(out.device)) out.device = 'auto';
  if (!(['auto', 'small', 'normal', 'large'] as const).includes(out.uiSize)) out.uiSize = 'auto';
  return out;
}

/** Saved games in this browser (a player from before themes, even with no settings stored). */
function hasSaves(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i)?.startsWith('contrail-acmi:save:')) return true;
  } catch {
    // storage unavailable
  }
  return false;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return settingsFrom(JSON.parse(raw) as Partial<Settings>);
  } catch {
    // storage unavailable
  }
  return { ...DEFAULT_SETTINGS, autoPause: { ...DEFAULT_SETTINGS.autoPause }, soundCats: { ...DEFAULT_SETTINGS.soundCats }, theme: hasSaves() ? 'dark' : DEFAULT_SETTINGS.theme };
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
  /** v0.7.1: the dialog the glossary opened over (a Term's 'Glossary ›'); it comes back when the glossary closes. */
  private modalBelow: ModalSpec | null = null;
  /** v0.6: a roster-board drag in progress holds the clock like a modal (no render; the speed control stays as set). */
  holdTime = false;
  toasts: Toast[] = [];
  settings: Settings = loadSettings();
  /** v0.11 the colour theme on screen (Settings › Appearance; 'system' follows the device live). */
  theme: Theme = applyTheme(this.settings.theme, () => this.onSystemTheme());
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
  /** v0.7: ladder-step celebrations and v0.7.1 first-time hints waiting for the modal slot; ids / kinds already shown (not saved). */
  private ladderQueue: ({ ladder: string } | { hint: ProblemRef } | { head: HeadId[] } | { pop: ModalSpec })[] = [];
  /** v0.9.1 messages a cue already toasted (surfaceMessages skips them). */
  private cueToasted = new Set<string>();
  private ladderSeen = new Set<string>();
  private hintShown = new Set<string>();
  /** v0.12 aircraft whose welcome card this session already queued (once per delivery). */
  private welcomed = new Set<string>();

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
    // v0.9 §S.1: the engine's sound cues since the last look (advance, actions, dev scenes) go to the sound set.
    this.drainCues();
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /**
   * v0.9.1 (§S.6) every chime says what it is for: a cue that will sound shows its note as a toast (the Inbox holds the
   * message too when it came with one) and only then plays; a cue the settings silence follows the quiet toast rules.
   * A counter-offer reply opens its pop-up and a delivery its celebration card either way.
   */
  private drainCues(): number {
    let shown = 0;
    for (const e of takeCueEvents()) {
      if (e.cue === 'counterReply' && (e.ref?.kind === 'offer' || e.ref?.kind === 'contract')) {
        this.queuePop({ kind: 'counterReply', ...(e.ref.kind === 'offer' ? { offerId: e.ref.id } : { contractId: e.ref.id }), title: e.title, body: e.body ?? '' }, true);
      }
      // v0.12 the welcome card: once per handover, never for the fleet a new game starts with (deliveryCardFor). Its
      // chime rings when the card opens (flushLadder), not while another dialog (a phone call) still has the screen.
      if (e.cue === 'delivered') {
        const id = this.game ? deliveryCardFor(this.game, e, this.welcomed) : null;
        if (id) {
          this.welcomed.add(id);
          this.queuePop({ kind: 'delivered', aircraftId: id }, true);
          if (e.msgId) this.cueToasted.add(e.msgId);
          continue;
        }
        // No card (no aircraft named, or already welcomed): the usual toast, then the chime.
      }
      // v0.10.2 a phone call: the clock stops whatever the auto-pause settings say; its pop-up is the note and rings
      // while it shows (CallModal) when its turn in the queue comes. Closed unanswered, the Inbox line rings it again.
      if (e.cue === 'offerCall' && e.ref?.kind === 'offer') {
        if (e.msgId) this.cueToasted.add(e.msgId);
        this.queuePop({ kind: 'offerCall', offerId: e.ref.id }, true);
        if (!this.paused) this.autoPause('urgentOffer');
        continue;
      }
      if (!sound.audible(e.cue)) continue;
      if (e.msgId) this.cueToasted.add(e.msgId);
      // Its own pop-up (a counter reply) is the note; anything else shows a toast.
      const pop = e.cue === 'counterReply' && (e.ref?.kind === 'offer' || e.ref?.kind === 'contract');
      if (!pop) this.pushToast(cueToastKind(e), e.title, e.body ? (e.body.length > 140 ? e.body.slice(0, 137) + '…' : e.body) : undefined);
      sound.event(e.cue);
      shown++;
    }
    if (this.ladderQueue.length && !this.modal) this.flushLadder();
    return shown;
  }

  /** v0.9.1 a pop-up waits its turn behind an open dialog (`first`: ahead of the cards already waiting). */
  private queuePop(m: ModalSpec, first = false) {
    if (first) this.ladderQueue.unshift({ pop: m });
    else this.ladderQueue.push({ pop: m });
  }

  private emitClock() {
    this.clockVersion++;
    for (const fn of this.clockListeners) fn();
  }

  // ---------- lifecycle ----------

  setScreen(s: AppScreen) {
    this.screen = s;
    sound.setScene(s === 'game');
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
    // v0.11 the game follows the player's Pace setting (the director redraws the spells still to come).
    if (this.game && !this.game.gameOver) setPace(this.game, this.settings.pace);
    // v0.7.2.2: the normal re-plan (the same settle the first clock tick runs) before the first look, so empty legs
    // left behind by an older version (a moved trip's ferries) are already cleaned up when the Schedule opens.
    if (this.game && !this.game.gameOver) settle(this.game);
    prepareAsyncSave();
    this.savedNow = -1;
    this.savedMark = '';
    this.decisionDeferred = null;
    this.lastMsgId = this.game?.messages[0]?.id ?? null;
    takeCues(); // what loading and the first settle raised is old news
    this.ladderQueue = [];
    this.ladderSeen = new Set();
    this.hintShown = new Set();
    this.welcomed = new Set();
    this.exact = this.game?.now ?? 0;
    this.paused = true;
    this.pauseReason = null;
    this.nav = { tab: 'map' };
    this.modal = null;
    this.modalBelow = null;
    this.screen = 'game';
    sound.setScene(true);
    // v0.9 §5.2 heads earned in an old save: the load posted 'N department heads are available' (now, unread), which the
    // lastMsgId above marks as seen; queue its celebration card here, once per session.
    const g = this.game;
    if (g && !g.gameOver) {
      const m = g.messages.find((x) => x.t === g.now && !x.read && x.topic === 'head' && HEADS_AVAILABLE.test(x.title));
      if (m && !this.headCardsShown.has(m.id)) { this.headCardsShown.add(m.id); this.queueHead(m); this.flushLadder(); }
    }
    this.startLoop();
  }

  /** v0.9 §5.2 backfill messages whose card this session already opened. */
  private headCardsShown = new Set<string>();

  /** Always writes the autosave (even with Autosave off), unless the game is over. */
  quitToTitle() {
    this.saveAuto(true);
    this.stopLoop();
    this.game = null;
    this.modal = null;
    this.screen = 'title';
    sound.setScene(false);
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
    // Round 4: settled first (statuses, re-plans), so the saved state is the one the next frame would start from and a
    // reload serializes identically.
    if (!g.gameOver) settle(g);
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
    if (!g.gameOver) settle(g);
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
    // v0.9.1 (the player): pause and resume make no sound at all.
    this.emit();
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseReason = null;
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
    if (!g || this.paused || this.blocked || this.modal || this.holdTime) return;
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
    // v0.7: the market pause only with market alerts on.
    return new Set((Object.keys(this.settings.autoPause) as PauseReason[]).filter((r) => this.settings.autoPause[r] && (r !== 'marketOffer' || this.settings.marketAlerts)));
  }

  private autoPause(reason: PauseReason) {
    this.paused = true;
    this.pauseReason = reason;
    if (this.game) this.exact = this.game.now;
  }

  /** Quiet toasts for important new messages only. Returns whether anything new arrived. */
  private surfaceMessages(): boolean {
    this.drainCues();
    const fresh = this.takeFresh();
    for (const m of fresh) {
      // v0.9.1 its cue already showed it (and chimed).
      if (this.cueToasted.delete(m.id)) {
        this.queueHint(m);
        if (m.topic === 'ladder') this.queueLadder(m.id);
        else this.queueHead(m);
        continue;
      }
      // v0.7.1: the first warning of each kind of problem gets its one-time hint (never over another dialog).
      this.queueHint(m);
      // v0.7: ladder steps get the celebration card instead of a toast; market offers a quiet info toast (alerts on).
      if (m.topic === 'ladder') this.queueLadder(m.id);
      else if (this.queueHead(m)) continue;
      else if (m.topic === 'crewRed' || m.topic === 'crewHours') {
        // v0.7.1 the red crew stage (v0.9: shortage or out of hours; the urgent alarm comes from its cue): the banner as the toast title.
        if (this.settings.toasts && !this.modal) this.toast('bad', crewRedTitle(m), m.body.length > 140 ? m.body.slice(0, 137) + '…' : m.body);
      } else if (!this.settings.toasts || this.modal) continue; // news waits in the Inbox while a dialog is open
      else if (m.topic === 'achievement') {
        // v0.9 §14.1 a calm trophy toast; an achievement that earns a head is followed by the head's card instead.
        if (!fresh.some((x) => x.topic === 'head' && HEAD_EARNED.test(x.title))) this.toast('achievement', m.title.replace(/^Achievement: /, ''), m.body);
      } else if (m.topic === 'head') continue; // a head's quiet note waits in the Inbox
      else if (m.topic === 'market') {
        if (this.settings.marketAlerts) this.toast('info', m.title.replace(/^Market: /, ''), marketToastBody(m));
      } else if (m.tone === 'bad' || m.cat === 'goal') this.toast(m.tone === 'bad' ? 'bad' : 'good', m.title, m.body.length > 140 ? m.body.slice(0, 137) + '…' : m.body);
    }
    this.flushLadder();
    return fresh.length > 0;
  }

  /** Messages since the last look, oldest first. */
  private takeFresh(): Message[] {
    const g = this.game!;
    const fresh: Message[] = [];
    for (const m of g.messages) {
      if (m.id === this.lastMsgId) break;
      fresh.push(m);
    }
    this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    return fresh.reverse();
  }

  /** v0.9 §5.4 a head just earned (or several, from an old save) queues its celebration card; true when queued. */
  private queueHead(m: Message): boolean {
    if (m.topic !== 'head' || !(HEAD_EARNED.test(m.title) || HEADS_AVAILABLE.test(m.title))) return false;
    const g = this.game;
    if (!g) return false;
    const ids = m.ref?.kind === 'head' && HEAD_EARNED.test(m.title) ? [m.ref.id as HeadId]
      : headsView(g).filter((h) => h.unlocked && !h.person).map((h) => h.id);
    if (!ids.length || this.ladderQueue.some((q) => 'head' in q && q.head[0] === ids[0])) return false;
    this.ladderQueue.push({ head: ids });
    return true;
  }

  private queueLadder(id: string) {
    if (this.ladderSeen.has(id) || this.ladderQueue.some((q) => 'ladder' in q && q.ladder === id)) return;
    this.ladderQueue.push({ ladder: id });
  }

  /** v0.7.1: a warn/bad message about a kind of problem not yet explained queues its first-time hint (once per session). */
  private queueHint(m: Message) {
    const p = m.problem;
    if (!p || (m.tone !== 'warn' && m.tone !== 'bad')) return;
    // Only kinds with a story (HINTS): never an empty dialog.
    if (!HINTS[p.kind]) return;
    if (this.settings.hintsSeen.includes(p.kind) || this.hintShown.has(p.kind)) return;
    if (this.ladderQueue.some((q) => 'hint' in q && q.hint.kind === p.kind)) return;
    this.ladderQueue.push({ hint: p });
  }

  /** 'Don't show again' on a first-time hint. */
  hintSeen(kind: string) {
    if (!this.settings.hintsSeen.includes(kind)) this.setSettings({ hintsSeen: [...this.settings.hintsSeen, kind] });
  }

  /** Opens the next ladder celebration or first-time hint when the modal slot is free (never over another dialog or a decision). */
  private flushLadder(): void {
    if (this.modal || !this.game || this.game.gameOver || this.decisionOpen || !this.ladderQueue.length) return;
    const q = this.ladderQueue.shift()!;
    if ('pop' in q) {
      const m = q.pop;
      // Gone meanwhile (answered on the offer card, the aircraft sold): nothing to show.
      if (m.kind === 'counterReply' && !(m.offerId ? this.game.offers[m.offerId] : this.game.contracts[m.contractId ?? ''])) return this.flushLadder();
      if ((m.kind === 'delivered' || m.kind === 'followDelivery') && !this.game.fleet[m.aircraftId]) return this.flushLadder();
      // answered on the offer card, lapsed or taken meanwhile: no call
      if (m.kind === 'offerCall' && !(this.game.offers[m.offerId]?.status === 'open' && this.game.offers[m.offerId].expires > this.game.now)) return this.flushLadder();
      this.modal = m;
      // v0.12 the delivery chime rings with its card (the card is its note; the Inbox keeps the message).
      if (m.kind === 'delivered' && sound.audible('delivered')) sound.event('delivered');
      this.toasts = this.toasts.filter((t) => !t.leaving);
      return;
    }
    if ('head' in q) {
      // Hired meanwhile (Company › Team): nothing to celebrate any more.
      const open = q.head.filter((id) => !headView(this.game!, id).person);
      if (!open.length) return this.flushLadder();
      this.modal = { kind: 'headUnlocked', id: open[0], ids: open.length > 1 ? open : undefined };
      return;
    }
    if ('hint' in q) {
      if (this.settings.hintsSeen.includes(q.hint.kind)) { this.hintShown.add(q.hint.kind); return this.flushLadder(); }
      // Fixed by the time the slot freed: keep the hint for the next time that kind appears.
      if (!problemFor(this.game, q.hint)) return this.flushLadder();
      this.hintShown.add(q.hint.kind);
      this.modal = { kind: 'problem', subject: q.hint, hint: true };
      return;
    }
    const id = q.ladder;
    this.ladderSeen.add(id);
    if (!this.game.messages.some((m) => m.id === id)) return this.flushLadder();
    this.modal = { kind: 'ladderStep', messageId: id };
  }

  /** v0.7: whether the Inbox, badges and toasts show this message (market alerts can be turned off). */
  shows(m: Message): boolean {
    return m.topic !== 'market' || this.settings.marketAlerts;
  }

  /** v0.7: player edits so far (actions and direct updates); useThrottledNow passes these through at once. */
  get editCount(): number {
    return this.edits;
  }

  /** v0.7: the clock is running (time moves by itself). */
  get running(): boolean {
    return !!this.game && !this.paused && !this.blocked && !this.modal && !this.holdTime;
  }

  // ---------- actions ----------

  /** Runs a player action against the game, toasts the result and re-renders. */
  act<T>(fn: (g: GameState) => ActionResult<T>, opts: { toastOk?: boolean } = {}): ActionResult<T> {
    const g = this.game;
    if (!g) return { ok: false, error: 'No game loaded' };
    clearPause();
    this.edits++;
    let res: ActionResult<T>;
    try {
      res = fn(g);
    } catch (e) {
      // An engine throw must not take the UI down; report it as a refused action.
      console.warn('[act]', e);
      res = { ok: false, error: 'Something went wrong with that action.' };
    }
    // Cross-module follow-ups (e.g. crew re-sync) and pauses the action raised (e.g. crewShortage on accept).
    settle(g);
    const pause = takePause(this.honoured());
    if (pause && pause !== 'decision') this.autoPause(pause);
    // v0.9.1 the action's cues show (and chime) with their notes; the result toast only when none did.
    const cued = this.drainCues();
    if (!res.ok) {
      this.toast('bad', 'Not possible', res.error);
      sound.event('error');
    } else if (opts.toastOk !== false && res.msg && !cued) this.toast('good', res.msg);
    // The action's own messages are not toasted (its result is); ladder steps and heads still get their card, problems their hint.
    for (const m of this.takeFresh()) {
      const cueShown = this.cueToasted.delete(m.id);
      if (m.topic === 'ladder') this.queueLadder(m.id);
      else if (m.topic === 'achievement' && this.settings.toasts && !cueShown) this.toast('achievement', m.title.replace(/^Achievement: /, ''), m.body);
      else this.queueHead(m);
      this.queueHint(m);
    }
    this.flushLadder();
    this.emit();
    return res;
  }

  /**
   * v0.9 §R.5 a move onto a published day off asks first ("Take Ana Silva's day off?"): morale −6, the day off moves.
   * The roster board's drop and dev.offBreak use it.
   */
  askTakeOff(dutyId: string, fromCrewId: string, toCrewId: string, scope: MoveScope, t: DropTarget) {
    const who = this.game?.crew[toCrewId];
    // 'Takes Ana's day off Tue 4 Nov; it moves to Thu 13 Nov (morale −6)' → the day in the title, the rest once below.
    const m = /^Takes .+?'s day off (.+?)(?:; it moves to (.+?))? \(morale (.+?)\)$/.exec(t.offBreak ?? '');
    this.openModal({
      kind: 'confirm', title: `Take ${who ? `${who.first} ${who.last}'s` : 'their'} day off${m ? ` on ${m[1]}` : ''}?`, confirm: 'Take the day',
      body: m ? `${m[2] ? `It moves to ${m[2]}. ` : ''}Morale ${m[3]}.` : `${t.offBreak}.`,
      onConfirm: () => this.act((gg) => moveDuty(gg, dutyId, fromCrewId, toCrewId, scope, { takeOff: true })),
    });
  }

  /** Mutates game state directly (no validation needed) and re-renders. */
  update(fn: (g: GameState) => void) {
    if (!this.game) return;
    this.edits++;
    fn(this.game);
    this.emit();
  }

  /** v0.7.3 dev scenes: builds one, settles, opens it (flight sheet / duty modal / Crew Control); returns the id. */
  private devScene(build: (g: GameState) => string, open: 'sheet' | 'duty' | 'crewControl'): string {
    const g = this.game;
    if (!g) return '';
    const id = build(g);
    settle(g);
    this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    if (id) this.openModal(open === 'sheet' ? { kind: 'sheet', refs: [{ kind: 'flight', id }] } : open === 'duty' ? { kind: 'duty', id } : { kind: 'crewControl', flightId: id });
    this.emit();
    return id;
  }

  /** v0.8 dev offers: builds one, settles, opens the offer dialog on the Contracts market; returns the offer id. */
  private devOffer(build: (g: GameState) => string): string {
    const g = this.game;
    if (!g) return '';
    const id = build(g);
    settle(g);
    this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
    if (id && g.offers[id]) {
      this.nav = { tab: 'contracts', view: 'market' };
      this.openModal({ kind: 'offer', offerId: id });
    }
    this.emit();
    return id;
  }

  // ---------- navigation & UI ----------

  navigate(tab: Tab, extra: Omit<Nav, 'tab'> = {}) {
    // v0.11 Clients moved from Company to Contracts; older links still land there.
    if (tab === 'company' && extra.view === 'clients') tab = 'contracts';
    this.nav = { tab, ...extra };
    this.emit();
    document.querySelector('.main')?.scrollTo({ top: 0 });
  }

  /** Selects an entity on the current screen (map panel etc.). */
  select(sel: Ref | undefined) {
    this.nav = { ...this.nav, sel };
    this.emit();
  }

  openModal(m: ModalSpec) {
    this.modalBelow = m.kind === 'glossary' && this.modal && this.modal.kind !== 'glossary' ? this.modal : null;
    this.modal = m;
    // A dialog takes the stage: quiet toasts (already in the Inbox) must not cover its header.
    this.toasts = [];
    this.emit();
  }

  /** Closes the dialog; the glossary goes back to the dialog it was opened over unless `all`. */
  closeModal(opts: { all?: boolean; /** v0.9.1 the waiting cards stay queued (they come once time runs again) */ hold?: boolean } = {}) {
    const below = !opts.all && this.modal?.kind === 'glossary' ? this.modalBelow : null;
    this.modalBelow = null;
    this.modal = below;
    if (!below && !opts.hold) this.flushLadder();
    this.emit();
  }

  toast(kind: Toast['kind'], title: string, body?: string) {
    this.pushToast(kind, title, body);
    this.emit();
  }

  /** v0.9.1 a toast stays 5 s (lower right), then fades; a tap dismisses it (dismissToast). */
  private pushToast(kind: Toast['kind'], title: string, body?: string) {
    const id = ++this.toastId;
    this.toasts = [...this.toasts.slice(-2), { id, kind, title, body }];
    setTimeout(() => this.dismissToast(id), TOAST_MS);
  }

  dismissToast(id: number) {
    if (!this.toasts.some((t) => t.id === id && !t.leaving)) return;
    this.toasts = this.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
    this.emit();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.emit();
    }, 260);
  }

  /** The device switched light/dark while Appearance is 'System'. */
  private onSystemTheme() {
    this.theme = activeTheme();
    this.emit();
  }

  setSettings(p: Partial<Settings>) {
    this.settings = { ...this.settings, ...p };
    configureSound(this.settings);
    applyTopGap(this.settings);
    if (p.theme) this.theme = applyTheme(this.settings.theme, () => this.onSystemTheme());
    if (p.device || p.uiSize) setDevicePrefs({ device: this.settings.device, uiSize: this.settings.uiSize });
    if (p.pace && this.game && !this.game.gameOver) setPace(this.game, p.pace);
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
    /** v0.10.2 an urgent, high-paying AOG cover that phones in (the call card and its ring); returns the offer id. */
    call: () => {
      const g = this.game;
      if (!g) return null;
      const o = generateOffer(g, 'aogCover', { start: g.now + 26 * 60, wide: false, window: false, paint: false, cabin: false });
      if (!o) return null;
      o.urgency = 'urgent';
      o.call = true;
      o.expires = Math.min(o.expires, g.now + 5 * 60);
      cue('offerCall', { title: `Phone call: ${o.title}`, ref: { kind: 'offer', id: o.id } });
      this.emit();
      return o.id;
    },
    /** v0.7.4: an aircraft of a type at home base with its crew (e.g. 'b763'); returns its id. */
    addType: (typeId: string, cabinIx = 0) => {
      const g = this.game;
      if (!g) return '';
      const id = devAddType(g, typeId, cabinIx);
      settle(g);
      this.emit();
      return id;
    },
    /** v0.7.4: a long season base whose client wants its cabin (forced request); opens the offer modal. */
    cabinOffer: (layout: 'two-class' | 'all-economy' = 'two-class', required = false, share = 1) => {
      const g = this.game;
      if (!g) return null;
      let o = null;
      // A season base whose cabin rules allow the layout asked for (some want 174+ seats: all economy only).
      for (let i = 0; i < 8 && !(o && o.cabin?.layout === layout); i++) o = generateOffer(g, 'seasonBase', { cabin: { layout, required, share, revert: true }, paint: false, wide: false, start: g.now + 40 * DAY, days: 120 });
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
    /** v0.11 a disruption card now: on an airborne revenue leg (diversion, medical, technical) or the next one at the gate. */
    disruption: (kind: 'diversion' | 'technical' | 'medical' | 'birdStrike' | 'curfew' | 'ctot' | 'turnaround' | 'sickAway') => {
      const g = this.game;
      if (!g) return false;
      const air = ['diversion', 'technical', 'medical'].includes(kind);
      const landed = kind === 'birdStrike';
      const list = Object.values(g.flights).filter((f) => {
        if (!f.aircraftId || f.kind !== 'revenue') return false;
        if (air) return f.status === 'enroute' && (f.eta ?? f.sta) > g.now + 40;
        if (landed) return f.status === 'done' && g.fleet[f.aircraftId].at === f.to && !g.fleet[f.aircraftId].flightId;
        const d = f.dutyId ? g.duties[f.dutyId] : undefined;
        return f.status === 'scheduled' && f.std > g.now && !!d && (kind !== 'sickAway' || (d.report > g.now + 30 && d.flightIds[0] === f.id && f.from !== g.company.homeBase && !!g.pairings[d.pairingId]?.slots.some((x) => x.crewId && g.crew[x.crewId]?.loc === f.from)));
      }).sort((a, b) => (kind === 'curfew' ? Number(!!CURFEWS[b.to]) - Number(!!CURFEWS[a.to]) : 0)
        || (kind === 'sickAway' ? Number(b.from !== g.company.homeBase) - Number(a.from !== g.company.homeBase) : 0)
        || (landed ? (b.ata ?? 0) - (a.ata ?? 0) : a.std - b.std));
      let ok = false;
      for (const pick of list.slice(0, 8)) {
        // A weather closure shows on the approach: the clock moves to 25 min before the leg lands.
        if (kind === 'diversion' && (pick.eta ?? pick.sta) - g.now > 40) advanceTo(g, (pick.eta ?? pick.sta) - 25, new Set(['decision']));
        if (air && pick.status !== 'enroute') continue;
        if ((ok = devDisruption(g, kind, pick.id))) break;
      }
      this.exact = g.now;
      this.clockLabel = -1;
      this.emitClock();
      this.emit();
      return ok;
    },
    /** v0.11 advances the clock `min` minutes (stops at a new decision); dev and screenshots. */
    advance: (min: number) => {
      const g = this.game;
      if (!g) return;
      const n = g.decisions.length;
      const end = g.now + min;
      for (let i = 0; i < 200 && g.now < end && g.decisions.length <= n; i++) advanceTo(g, Math.min(end, g.now + 10), new Set(['decision']));
      this.exact = g.now;
      this.clockLabel = -1;
      this.emitClock();
      this.emit();
    },
    /** v0.11 a ramp inspection now on the first aircraft (`cat`: the worst finding wanted, 0 = clean). */
    ramp: (cat = 3) => {
      const g = this.game;
      if (!g) return null;
      const ac = Object.values(g.fleet).find((a) => !a.flightId && a.status === 'available') ?? Object.values(g.fleet)[0];
      ac.maint.deferred = Math.max(ac.maint.deferred, cat >= 3 ? 0.5 : 0.1);
      for (let i = 0; i < 2000; i++) {
        const k = `dev:${i}`;
        const r = rampFindings(g, ac, k);
        const worst = r.cats[2] ? 3 : r.cats[1] ? 2 : r.cats[0] ? 1 : 0;
        if (worst === cat && (cat < 3 || r.action === '3b')) {
          const out = inspect(g, ac, ac.at, undefined, k);
          this.emit();
          return out.id;
        }
      }
      return null;
    },
    /** v0.11 the yearly audit: 'announce' (4 weeks' notice) or held now with a record that brings findings. */
    audit: (mode: 'announce' | 'now' = 'now') => {
      const g = this.game;
      if (!g) return;
      if (mode === 'now') {
        g.stats.incidents = [...(g.stats.incidents ?? []), [g.now - 20 * DAY, 'illegalCrew']];
        const ac = Object.values(g.fleet)[0];
        for (let i = 0; i < 2; i++) {
          const k = Array.from({ length: 400 }, (_, j) => `audit-dev:${i}:${j}`).find((x) => rampFindings(g, ac, x).cats[2] > 0 && rampFindings(g, ac, x).action === '3b');
          if (k) inspect(g, ac, ac.at, undefined, k);
        }
      }
      devAudit(g, mode === 'announce');
      this.emit();
    },
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
    /** Peak-staffing round: stages a busy month ahead `short` people per role short (screenshots); returns the gaps. */
    peak: (short?: Partial<Record<Role, number>>) => {
      const g = this.game;
      if (!g) return [];
      const gaps = devPeak(g, short);
      this.emit();
      return gaps.map((x) => `${x.monthName} ${x.family} ${x.role} short ${x.short}${x.serious ? ' serious' : ''}${x.late ? ' late' : ''}`);
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
    /** v0.6: everyone's morale set to n (0–100). */
    morale: (n = 30) => {
      const g = this.game;
      if (!g) return 0;
      const crew = Object.values(g.crew);
      for (const c of crew) c.morale = Math.max(0, Math.min(100, n));
      this.emit();
      return crew.length;
    },
    /** v0.6: a crew member (default: the first not on notice) resigns now, with notice. */
    resign: (crewId?: string) => {
      const g = this.game;
      if (!g) return null;
      const id = crewId ?? Object.values(g.crew).find((c) => !c.notice && c.status !== 'joining')?.id;
      const ok = !!id && resignNow(g, id);
      settle(g);
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      this.emit();
      return ok ? id : null;
    },
    /** v0.7: posts an aircraft market offer now and opens Fleet → Market; returns the offer id. */
    marketOffer: (typeId?: string, opts?: { kind?: 'dryLeaseIn' | 'buy'; newBuild?: boolean; site?: string }) => {
      const g = this.game;
      if (!g) return null;
      const id = devMarketOffer(g, typeId, opts);
      settle(g);
      const pause = takePause(this.honoured());
      if (pause) this.autoPause(pause);
      this.surfaceMessages();
      this.navigate('fleet', { view: 'market', sel: { kind: 'market', id } });
      return id;
    },
    /**
     * v0.9.1 a counter-offer and its reply: counters the first open offer an aircraft can fly at +5 % and plays on to
     * the client's answer (its pop-up opens). Returns the offer id, or null.
     */
    counterReply: (): string | null => {
      const g = this.game;
      if (!g) return null;
      for (let i = 0; i < 12 && !Object.values(g.offers).some((o) => o.status === 'open' && !o.counter && o.product.kind !== 'dry' && feasibilityAll(g, o.id).some((x) => x.level !== 'no')); i++) generateOffer(g, 'adhoc');
      for (const o of Object.values(g.offers)) {
        if (o.status !== 'open' || o.counter || o.product.kind === 'dry') continue;
        const r = feasibilityAll(g, o.id).find((x) => x.level !== 'no');
        if (!r) continue;
        const price = o.product.kind === 'wet' ? o.product.ratePerBH * 1.05 : o.product.kind === 'charter' ? o.product.price * 1.05 : 0;
        if (!counterOffer(g, o.id, price, [r.aircraftId]).ok) continue;
        advanceTo(g, (g.offers[o.id].counter?.replyAt ?? g.now) + 1, new Set());
        this.exact = g.now;
        this.surfaceMessages();
        this.emit();
        return o.id;
      }
      return null;
    },
    /** v0.9.1 an aircraft handed over abroad: signs an A320 at `site` and plays on to the handover (its card opens). */
    delivery: (site = 'SCL'): string | null => {
      const g = this.game;
      if (!g) return null;
      const offer = devMarketOffer(g, 'a320ceo', { kind: 'dryLeaseIn', site });
      const r = offer ? acquireAircraft(g, offer) : null;
      if (!r?.ok) return null;
      const ac = g.fleet[r.data!.aircraftId];
      advanceTo(g, (ac.delivery?.handover ?? g.now) + 1, new Set());
      this.exact = g.now;
      this.surfaceMessages();
      this.emit();
      return ac.id;
    },
    /** v0.7: grants an approval now (the ladder goal and its celebration card follow). */
    grant: (id: ApprovalId) => {
      const g = this.game;
      if (!g) return;
      devGrantApproval(g, id);
      settle(g);
      this.surfaceMessages();
      this.emit();
    },
    /** v0.7.1: empties the pilot seats of the next crewed flight within `hours`, runs the ladder and opens Crew Control. */
    crewShortage: (hours = 10, roles?: Role[]) => {
      const g = this.game;
      if (!g) return '';
      const id = devCrewShortage(g, { hours, roles });
      settle(g);
      const pause = takePause(this.honoured());
      if (pause) this.autoPause(pause);
      this.surfaceMessages();
      if (id) this.openModal({ kind: 'crewControl', flightId: id });
      this.emit();
      return id;
    },
    /** v0.7.2: an A330-300 with crew rest seats and an augmented duty booked; opens its flight sheet; returns the flight id. */
    restSeats: () => {
      const g = this.game;
      if (!g) return '';
      const id = devRestSeats(g);
      settle(g);
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      if (id) this.openModal({ kind: 'sheet', refs: [{ kind: 'flight', id }] });
      this.emit();
      return id;
    },
    /** v0.7.3 §7: dev scenes; each opens the flight sheet (flight id) or the duty modal (duty id) and returns the id. */
    restPlan: () => this.devScene(devRestPlan, 'sheet'),
    shortCruise: () => this.devScene(devShortCruise, 'sheet'),
    extension: () => this.devScene(devExtension, 'duty'),
    split: () => this.devScene(devSplit, 'duty'),
    standby: () => this.devScene(devStandby, 'crewControl'),
    /** v0.7.2: an owned aircraft with no work after 10 days (sellable); opens the sale dialog; returns its id. */
    saleReady: () => {
      const g = this.game;
      if (!g) return '';
      const id = devSaleReady(g);
      settle(g);
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      if (id) this.openModal({ kind: 'sell', aircraftId: id });
      this.emit();
      return id;
    },
    /** v0.8 dev scenes: each builds an offer (opens the offer dialog), a mixed-crew duty (duty modal), a client level
     *  (Contracts › Clients) or a world event (its dialog); returns the id ('' when none fits). */
    hajj: () => this.devOffer(devHajj),
    dryLease: () => this.devOffer(devDryLease),
    deportation: () => this.devOffer(devDeportation),
    evacuation: () => this.devOffer(devEvacuation),
    rivalBid: () => this.devOffer(devRivalBid),
    mixedCrew: () => this.devScene(devMixedCrew, 'duty'),
    level: (clientId?: string, level?: ClientLevel) => {
      const g = this.game;
      if (!g) return '';
      const id = devLevel(g, clientId, level);
      settle(g);
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      if (id) this.navigate('contracts', { view: 'clients', sel: { kind: 'client', id } });
      else this.emit();
      return id;
    },
    world: (kind?: WorldEventKind, tpl?: string) => {
      const g = this.game;
      if (!g) return '';
      const id = devWorldEvent(g, kind, tpl);
      settle(g);
      this.surfaceMessages();
      if (id) this.openModal({ kind: 'worldEvent', eventId: id });
      this.emit();
      return id;
    },
    /** v0.9 dev scenes: a head unlocked (its card), an achievement (toast), crew out of hours (Crew Control), a slip or
     *  jumbo offer (offer dialog), the rest plan failing at departure (Crew Control), the roster on a DUB tour (board). */
    head: (id: HeadId = 'opsControl') => {
      const g = this.game;
      if (!g) return '';
      const r = devUnlockHead(g, id);
      settle(g);
      this.surfaceMessages();
      this.emit();
      return r;
    },
    achievement: (id = 'cleanSheet') => {
      const g = this.game;
      if (!g) return '';
      const r = devAchievement(g, id);
      settle(g);
      this.surfaceMessages();
      this.emit();
      return r;
    },
    crewHours: (limit?: OohLimit) => {
      const g = this.game;
      if (!g) return '';
      const id = devCrewHours(g, limit);
      settle(g);
      const pause = takePause(this.honoured());
      if (pause) this.autoPause(pause);
      this.surfaceMessages();
      if (id) this.openModal({ kind: 'crewControl', flightId: id });
      this.emit();
      return id;
    },
    slip: (route?: 'MAD-SIN' | 'DIL-LIS') => this.devOffer((g) => devSlipOffer(g, route)),
    /** v0.9 round 4 §5.3: the fleet planner's "position the day before" proposal (inbox message and Team card); the proposal id. */
    position: () => {
      const g = this.game;
      if (!g) return '';
      const id = devPosition(g);
      settle(g);
      this.surfaceMessages();
      this.navigate('inbox');
      this.emit();
      return id;
    },
    jumbo: () => this.devOffer(devJumbo),
    restAtDeparture: () => this.devScene(devRestAtDeparture, 'crewControl'),
    roster: () => {
      const g = this.game;
      if (!g) return '';
      const id = devRoster(g);
      settle(g);
      this.lastMsgId = g.messages[0]?.id ?? this.lastMsgId;
      this.exact = g.now;
      this.navigate('crew', { view: 'board', sel: id ? { kind: 'crew', id } : undefined });
      return id;
    },
    /** v0.9 §R.5: finds a duty whose move would take someone's published day off and opens the board's confirm; returns the duty id. */
    offBreak: () => {
      const g = this.game;
      if (!g) return '';
      const pub = publishedTo(g);
      let tried = 0;
      for (const d of Object.values(g.duties)) {
        if (d.done || d.report < g.now + 12 * 60 || d.report > pub) continue;
        const from = g.pairings[d.pairingId]?.slots.find((x) => x.crewId)?.crewId;
        if (!from || ++tried > 40) continue;
        const t = Object.values(dropTargets(g, d.id, from, 'duty')).find((x) => x.offBreak && x.level !== 'illegal' && x.level !== 'ineligible');
        if (!t) continue;
        this.navigate('crew', { view: 'board' });
        this.askTakeOff(d.id, from, t.crewId, 'duty', t);
        return d.id;
      }
      return '';
    },
    /** v0.9: plays a sound now (Test sounds), or a sound event through the merge (`event`); the played log. */
    sound: (id: Parameters<typeof sound.test>[0] = 'hi') => sound.test(id),
    soundEvent: (e: SoundEvent) => sound.event(e),
    soundLog: () => sound.log.slice(),
    /** B5: React renders per screen (dev builds only), to check the calm-UI budget (≤ ~2/s at 4×). */
    renders: {} as Record<string, number>,
  };
}

/** 'CREW SHORTAGE · AWQ816' from a red-stage message title ('CREW SHORTAGE: AWQ816 in 11 h'; v0.9 also CREW OUT OF HOURS). */
function crewRedTitle(m: Message): string {
  const x = /^(CREW SHORTAGE|CREW OUT OF HOURS): (\S+)/.exec(m.title);
  return x ? `${x[1]} · ${x[2]}` : m.title;
}

/** v0.9 head messages: one head earned ("You've earned an Ops Control duty manager"), several from an old save. */
const HEAD_EARNED = /^You['’]ve earned /;
const HEADS_AVAILABLE = /department heads? (?:is|are) available/i;

function configureSound(s: Settings) {
  sound.configure({ on: s.sound, volume: s.volume, cats: s.soundCats, ambience: s.ambience, music: s.music, musicVolume: s.musicVolume });
}

/** v0.9 §S.3 soft UI clicks: any button taps; toggles, segmented controls and speed buttons tick (capture, no React). */
function installClickSounds() {
  document.addEventListener('click', (e) => {
    const el = (e.target as Element | null)?.closest?.('button, [role="button"], [role="tab"], a[href]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    let ev: SoundEvent = 'tap';
    if (el.classList.contains('toggle')) ev = el.classList.contains('on') ? 'toggleOff' : 'toggle';
    else if (el.closest('.seg, .speed')) ev = el.classList.contains('sp-pause') ? 'tap' : 'toggle';
    sound.event(ev);
  }, true);
}

/** 'AerCap, Santiago': the lessor and handover city from a market message body (short, quiet toast). */
function marketToastBody(m: Message): string {
  const who = /^(.+?) offers/.exec(m.body)?.[1];
  const at = /handed over at ([^.,]+)/.exec(m.body)?.[1];
  return [who, at].filter(Boolean).join(', ') || (m.body.length > 100 ? m.body.slice(0, 97) + '…' : m.body);
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
configureSound(store.settings);
sound.installUnlock();
if (typeof document !== 'undefined') installClickSounds();
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

applyTopGap(store.settings);
// v0.12 the device is known once main.tsx installs it (and may change with the Device setting).
onDeviceChange(() => applyTopGap(store.settings));

/**
 * v0.7 C2: the game minute for heavy views (roster board). While the clock runs it re-renders at most once per `ms`
 * real milliseconds (trailing) as a transition, so React renders it in time slices between frames; when time stands
 * still, and after any player edit, at once.
 */
export function useThrottledNow(ms = 1000): number {
  const [, setV] = useState(0);
  useEffect(() => {
    let last = performance.now();
    let edits = store.editCount;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = (urgent: boolean) => {
      if (timer) clearTimeout(timer);
      timer = null;
      last = performance.now();
      edits = store.editCount;
      if (urgent) setV((v) => v + 1);
      else startTransition(() => setV((v) => v + 1));
    };
    const on = () => {
      const t = performance.now();
      if (!store.running || store.editCount !== edits) bump(true);
      else if (t - last >= ms) bump(false);
      else timer ??= setTimeout(() => bump(false), ms - (t - last));
    };
    const off = store.subscribe(on);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [ms]);
  return store.game?.now ?? 0;
}

/** v0.11 the colour theme on screen; re-renders only when it changes (Appearance, or the device under 'System'). */
export function useTheme(): Theme {
  return useSyncExternalStore(store.subscribe, () => store.theme);
}
