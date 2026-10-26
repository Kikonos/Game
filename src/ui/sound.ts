// v0.9 aviation sound set (UPDATE-0.9.md §S). v0.9.1 (§S.2): every chime is the player's own recording of a real
// airliner HI-LO cabin chime, cut into its HI and LO (public/sounds/chime-hi.mp3, chime-lo.mp3, cached offline by the
// PWA), decoded into WebAudio buffers after the first-tap unlock and sequenced like a cabin system: one HI-LO for a new
// contract offer, HIs 0.8 s apart for attention and emergencies, LOs for calm news. UI clicks, the urgent alarm and the
// ambience stay synthesised. Each event maps to exactly one sound in SOUND_OF (§S.3). Chimes and alerts merge in a
// 900 ms window and play the highest-priority one once; for 4 s after a sound only one that outranks it plays, and the
// same sound never repeats inside its own cooldown (the alarm: 20 s). The urgent alarm is only for CREW SHORTAGE and
// CREW OUT OF HOURS. Nothing plays before the first tap (iOS audio unlock).

import type { Cue } from '../engine/core/cues';
import { MUSIC_FADE, musicLevel, MusicPlayer } from './music';

export type SoundId =
  | 'tap' | 'toggle' | 'error' | 'hi' | 'lo' | 'hiLo' | 'hi2' | 'hi3' | 'lo2' | 'alarm' | 'ring'
  | 'ambCabin' | 'ambTerminal' | 'music';
export type SoundCat = 'alerts' | 'chimes' | 'ui' | 'ambience' | 'music';
/** UI-only events (the engine's cues are the rest). v0.9.1: pause and resume make no sound. */
export type UiEvent = 'tap' | 'toggle' | 'toggleOff' | 'error';
export type SoundEvent = Cue | UiEvent;
export type Ambience = 'off' | 'cabin' | 'terminal';

/** THE table: each event → exactly one sound (§S.3). Keep identical to UPDATE-0.9.md §S.3. */
export const SOUND_OF: Record<SoundEvent, SoundId> = {
  tap: 'tap', toggle: 'toggle', toggleOff: 'toggle', error: 'error',
  flightDep: 'lo', flightArr: 'lo',
  message: 'lo', crewJoined: 'lo', paymentIn: 'lo', monthEnd: 'lo', headDone: 'lo', contractSigned: 'lo', headHired: 'lo',
  decision: 'hi', counterReply: 'hi', notice: 'hi',
  offerNew: 'hiLo',
  aog: 'hi2', delayPenalty: 'hi2', sickCall: 'hi2', latePayer: 'hi2', offerLapsing: 'hi2', worldEventOurs: 'hi2', crewAmber: 'hi2', ruleAlert: 'hi2',
  cancelRisk: 'hi3', airspaceActive: 'hi3', cashNegative: 'hi3', evacuation: 'hi3', clientCollapse: 'hi3',
  crewShortage: 'alarm', crewOutOfHours: 'alarm',
  achievement: 'lo2', ladder: 'lo2', headUnlocked: 'lo2', delivered: 'lo2',
  // v0.10.2 an urgent, high-paying offer phones in: a soft ring until answered (the call pop-up is its note)
  offerCall: 'ring',
  // v0.11 Operations: a disruption card 1 HI; a diversion, a medical emergency, a detention, a missed audit deadline 2 HI.
  opsDisruption: 'hi', opsEmergency: 'hi2',
};

export const CAT_OF: Record<SoundId, SoundCat> = {
  tap: 'ui', toggle: 'ui', error: 'ui',
  hi: 'chimes', lo: 'chimes', hiLo: 'chimes', lo2: 'chimes',
  hi2: 'alerts', hi3: 'alerts', alarm: 'alerts', ring: 'alerts',
  ambCabin: 'ambience', ambTerminal: 'ambience',
  music: 'music',
};

/** Merge priority (§S.4): the highest in a window plays once. */
export const PRIORITY: Partial<Record<SoundId, number>> = {
  alarm: 100, hi3: 90, ring: 85, hi2: 80, hiLo: 60, lo2: 55, hi: 45, lo: 30,
};
/** Quiet time after a sound plays (ms) for a repeat of the SAME sound (§S.4): the alarm never twice inside 20 s. */
export const COOLDOWN: Partial<Record<SoundId, number>> = {
  alarm: 20_000, ring: 20_000, hi3: 10_000, hi2: 6_000, hiLo: 3_000, lo2: 3_000, hi: 2_500, lo: 2_000,
};
/** v0.9 round 4 (§S.4): for this long after any sound, only a request that outranks it plays (one meaning at a time). */
export const CROSS_MS = 4_000;

/**
 * v0.9.1 (§S.2) the cabin-system sequences: [sample, start in s]. HIs 0.8 s apart, the LO 0.85 s after its HI (as in
 * the recording: the LO strikes 0.85 s after the HI), LOs 0.9 s apart.
 */
export const HI_GAP = 0.8;
export const LO_AFTER = 0.85;
export const LO_GAP = 0.9;
export const SEQ: Partial<Record<SoundId, ['hi' | 'lo', number][]>> = {
  hi: [['hi', 0]],
  lo: [['lo', 0]],
  hiLo: [['hi', 0], ['lo', LO_AFTER]],
  hi2: [['hi', 0], ['hi', HI_GAP]],
  hi3: [['hi', 0], ['hi', HI_GAP], ['hi', 2 * HI_GAP]],
  lo2: [['lo', 0], ['lo', LO_GAP]],
};
/** Sample lengths (s): HI ≈ 0.91, LO ≈ 1.04. */
const SAMPLE_LEN = { hi: 0.92, lo: 1.05 };
/** Rough length (s) of a sound, so UI clicks stay quiet while an alert sounds and the music stays dipped. */
export function soundLength(id: SoundId): number {
  if (id === 'alarm') return 2.6;
  if (id === 'ring') return RING_CYCLES * RING_EVERY;
  const q = SEQ[id];
  return q ? Math.max(...q.map(([k, t]) => t + SAMPLE_LEN[k])) : 0;
}

/** v0.10.2 the phone ring: two short trills every RING_EVERY s, RING_CYCLES times (about 20 s) or until answered. */
export const RING_EVERY = 3;
export const RING_CYCLES = 7;

export const MERGE_MS = 900;
const UI_GAP_MS = 50;

/** The Test sounds list (Settings): every sound with its meaning, in the player's words. */
export const SOUND_MEANING: { id: SoundId; name: string; meaning: string }[] = [
  { id: 'hiLo', name: 'HI-LO', meaning: 'A new contract offer (how flight attendants call each other on board)' },
  { id: 'hi', name: '1 HI', meaning: 'A small thing needs you: a counter-offer reply, a decision waiting, an ATC slot, a slow turnaround, a curfew, a bird strike, a ramp finding' },
  { id: 'hi2', name: '2 HI', meaning: 'Emergency: an AOG, a sick call, a diversion, a medical emergency on board, an aircraft detained, a late payer, an offer about to lapse, a delay penalty' },
  { id: 'hi3', name: '3 HI', meaning: 'Urgent emergency: a flight about to be cancelled, airspace closed on an active flight, cash below zero, an evacuation' },
  { id: 'lo', name: '1 LO', meaning: 'Calm news: a contract signed, crew joined, a payment in; with Flight chimes on, each departure and landing' },
  { id: 'lo2', name: '2 LO', meaning: 'Good news: an achievement, a department head unlocked, an aircraft delivered' },
  { id: 'alarm', name: 'Urgent alarm', meaning: 'Only crew shortage and crew out of hours' },
  { id: 'ring', name: 'Phone ring', meaning: 'A client on the phone: urgent work that pays well above the norm (rings until you answer)' },
  { id: 'tap', name: 'Click', meaning: 'Buttons and tabs' },
  { id: 'toggle', name: 'Toggle', meaning: 'Switches and speed buttons' },
  { id: 'error', name: 'Soft dunk', meaning: 'An action that is not possible' },
  { id: 'ambCabin', name: 'Cabin hum', meaning: 'Ambience: a quiet cabin in cruise' },
  { id: 'ambTerminal', name: 'Terminal air', meaning: 'Ambience: a terminal in the distance' },
  { id: 'music', name: 'Music', meaning: 'Calm background music: soft pads and a few piano notes' },
];

export interface SoundConfig {
  on: boolean;
  volume: number;
  cats: { alerts: boolean; chimes: boolean; flights: boolean; ui: boolean };
  ambience: Ambience;
  /** v0.9.1 background music: its own switch and volume, under the master switch and volume. */
  music: boolean;
  musicVolume: number;
}

const CAT_GAIN: Record<SoundCat, number> = { alerts: 1, chimes: 0.8, ui: 0.5, ambience: 0.25, music: 1 };

/** v0.9.1 (§S.6): would this event make a sound with these settings (the toast that names it shows whenever it does)? Pure. */
export function audible(cfg: Pick<SoundConfig, 'on' | 'cats'>, e: SoundEvent): boolean {
  const id = SOUND_OF[e];
  if (!id || !cfg.on) return false;
  const cat = CAT_OF[id];
  if (cat === 'ui') return cfg.cats.ui;
  if ((e === 'flightDep' || e === 'flightArr') && !cfg.cats.flights) return false;
  return cat === 'alerts' ? cfg.cats.alerts : cfg.cats.chimes;
}

/**
 * Merge rule (pure, for tests): given the requests of one window and the last sound that played, the sound to play now
 * (or null). Inside the 4 s cross-sound window only a request that outranks the last sound plays; the same sound never
 * repeats inside its own cooldown (the alarm: 20 s).
 */
export function pickMerged(reqs: SoundId[], last: { id: SoundId; at: number } | null, now: number): SoundId | null {
  let best: SoundId | null = null;
  for (const r of reqs) if (best === null || (PRIORITY[r] ?? 0) > (PRIORITY[best] ?? 0)) best = r;
  if (!best) return null;
  if (last && now - last.at < CROSS_MS && (PRIORITY[best] ?? 0) <= (PRIORITY[last.id] ?? 0)) return null;
  if (last && best === last.id && now - last.at < (COOLDOWN[best] ?? 0)) return null;
  return best;
}

/** v0.9 round 4 (§S.5): requests raised while the context is asleep (a call, Siri): at most the highest-priority one is kept for the resume. */
export function holdAsleep(reqs: SoundId[]): SoundId[] {
  let best: SoundId | null = null;
  for (const r of reqs) if (best === null || (PRIORITY[r] ?? 0) > (PRIORITY[best] ?? 0)) best = r;
  return best ? [best] : [];
}

/** v0.9.1 the two samples, next to the app (the PWA precaches them). */
const SAMPLE_URL = { hi: 'sounds/chime-hi.mp3', lo: 'sounds/chime-lo.mp3' };

type Win = Window & { webkitAudioContext?: typeof AudioContext };

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Partial<Record<SoundCat, GainNode>> = {};
  private cfg: SoundConfig = { on: true, volume: 0.6, cats: { alerts: true, chimes: true, flights: false, ui: true }, ambience: 'off', music: true, musicVolume: 0.35 };
  private music: MusicPlayer | null = null;
  private visible = true;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private unlocked = false;
  private pending: SoundId[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last: { id: SoundId; at: number } | null = null;
  private lastUi = 0;
  private alertUntil = 0;
  private amb: { stop: (fade: number) => void; kind: Ambience } | null = null;
  /** Where ambience may play (the game screen). */
  private ambOk = false;
  private previewStop: (() => void) | null = null;
  private testRestore: ReturnType<typeof setTimeout> | null = null;
  /** v0.9.1 the decoded HI and LO samples (loaded once, after the unlock). */
  private samples: { hi?: AudioBuffer; lo?: AudioBuffer } = {};
  private loading: Promise<void> | null = null;
  /** Played sounds (newest last, 200 max): dev checks of the rate limit. */
  readonly log: { id: SoundId; t: number }[] = [];

  configure(c: Partial<SoundConfig>) {
    this.cfg = { ...this.cfg, ...c, cats: { ...this.cfg.cats, ...c.cats } };
    this.applyGains();
    this.syncAmbience();
    this.syncMusic();
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  /** The context is asleep (suspended, or WebKit's 'interrupted' after a call or another app took the audio). */
  private get asleep(): boolean {
    return !!this.ctx && this.ctx.state !== 'running';
  }

  /**
   * iOS/Safari: the first tap (or key) anywhere unlocks audio; the context sleeps while the page is hidden. The listener
   * stays: any later tap wakes a context iOS suspended or interrupted (resume only works inside a gesture there).
   */
  installUnlock() {
    if (typeof window === 'undefined') return;
    const go = () => {
      if (!this.unlocked || (this.asleep && document.visibilityState === 'visible')) this.unlock();
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
    document.addEventListener('visibilitychange', () => this.setVisible(document.visibilityState !== 'hidden'));
  }

  /**
   * v0.9.1 the app hidden or in the background: the music fades out (a few seconds, never a cut) and the context then
   * sleeps; back in front it wakes and the music fades back in.
   */
  setVisible(v: boolean) {
    this.visible = v;
    const c = this.ctx;
    if (!c) return;
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (!v) {
      const playing = !!this.music?.running;
      this.syncMusic(1.5);
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (!this.visible) void c.suspend().catch(() => {});
      }, playing ? 1600 : 0);
      return;
    }
    if (this.unlocked) void c.resume().catch(() => {});
    this.syncMusic();
  }

  /** v0.9.1 the music's level for the settings and the app's visibility; it starts only after the first-tap unlock. */
  private syncMusic(fade = MUSIC_FADE) {
    const lvl = this.unlocked ? musicLevel(this.cfg, this.visible) : 0;
    if (lvl === 0 && !this.music) return;
    const c = this.context();
    if (!c) return;
    this.music ??= new MusicPlayer(c, this.bus.music!);
    this.music.setLevel(lvl, fade);
  }

  /** Creates / resumes the context and plays a one-sample silent buffer (must run inside a user gesture). */
  unlock() {
    try {
      // Safari 16.4+: 'ambient' follows the ringer switch and mixes with the player's music.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'ambient';
    } catch {
      // not supported
    }
    const c = this.context();
    if (!c) return;
    if (c.state !== 'running') void c.resume().catch(() => {});
    try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, 22050);
      s.connect(c.destination);
      s.start(0);
    } catch {
      // ignore
    }
    this.unlocked = true;
    void this.loadSamples();
    this.syncAmbience();
    this.syncMusic();
    // A request held while the context slept plays once it runs again.
    if (this.pending.length) this.timer ??= setTimeout(() => this.flush(), MERGE_MS);
  }

  /** v0.9.1 fetches and decodes the two chime samples once (offline: from the PWA cache). */
  loadSamples(): Promise<void> {
    const c = this.context();
    if (!c) return Promise.resolve();
    this.loading ??= (async () => {
      const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
      await Promise.all((['hi', 'lo'] as const).map(async (k) => {
        try {
          const res = await fetch(`${base}${SAMPLE_URL[k]}`);
          const data = await res.arrayBuffer();
          this.samples[k] = await new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(data, ok, bad));
        } catch {
          // no sample: that chime stays silent (its toast still shows)
        }
      }));
    })();
    return this.loading;
  }

  /** v0.9.1 true once both samples are decoded (dev checks). */
  get samplesReady(): boolean {
    return !!this.samples.hi && !!this.samples.lo;
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext ?? (window as Win).webkitAudioContext;
      if (!Ctx) return null;
      const c = new Ctx();
      // per-category bus → master → (dry + room reverb) → compressor → out
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      comp.connect(c.destination);
      const master = c.createGain();
      master.connect(comp);
      const verb = c.createConvolver();
      verb.buffer = impulse(c, 1.2);
      const wet = c.createGain();
      wet.gain.value = 0.12;
      master.connect(verb).connect(wet).connect(comp);
      for (const k of ['alerts', 'chimes', 'ui', 'ambience', 'music'] as SoundCat[]) {
        const gN = c.createGain();
        gN.connect(master);
        this.bus[k] = gN;
      }
      this.ctx = c;
      this.master = master;
      this.applyGains();
      return c;
    } catch {
      return null;
    }
  }

  private applyGains() {
    const c = this.ctx;
    if (!c || !this.master) return;
    this.master.gain.setTargetAtTime(this.cfg.on ? this.cfg.volume : 0, c.currentTime, 0.02);
    for (const k of Object.keys(this.bus) as SoundCat[]) {
      // Ambience and music carry their own switches (their players fade); the master gain covers both.
      const on = k === 'ambience' || k === 'music' ? true : this.cfg.cats[k as 'alerts' | 'chimes' | 'ui'];
      this.bus[k]!.gain.setTargetAtTime(on ? CAT_GAIN[k] : 0, c.currentTime, 0.02);
    }
  }

  /** v0.9.1 would this event sound with the current settings (store: a cue's toast shows whenever it does). */
  audible(e: SoundEvent): boolean {
    return audible(this.cfg, e);
  }

  /** An event (engine cue or UI): UI sounds at once, chimes and alerts through the merge window. */
  event(e: SoundEvent) {
    const id = SOUND_OF[e];
    if (!id || !this.unlocked || !audible(this.cfg, e)) return;
    const cat = CAT_OF[id];
    if (cat === 'ui') {
      const t = performance.now();
      if (t - this.lastUi < UI_GAP_MS || t < this.alertUntil) return;
      this.lastUi = t;
      this.render(id, e === 'toggleOff' ? { down: true } : {});
      return;
    }
    this.pending.push(id);
    this.timer ??= setTimeout(() => this.flush(), MERGE_MS);
  }

  private flush() {
    this.timer = null;
    const reqs = this.pending;
    this.pending = [];
    // Asleep (interrupted by a call or another app): nothing is scheduled on a frozen clock, so nothing stacks up and
    // fires together on the resume; the highest-priority request waits for the next tap (installUnlock → unlock).
    if (this.asleep) {
      this.pending = holdAsleep(reqs);
      return;
    }
    const now = performance.now();
    const id = pickMerged(reqs, this.last, now);
    if (!id) return;
    this.last = { id, at: now };
    if (CAT_OF[id] === 'alerts') this.alertUntil = now + soundLength(id) * 1000;
    // v0.9.1 the music dips under every chime and alert, then comes back.
    this.music?.duck(soundLength(id) + 0.4);
    this.render(id);
  }

  /** Settings › Test sounds: plays one now (any category, at the set volume), no merge. */
  test(id: SoundId) {
    if (!this.unlocked || this.asleep) this.unlock();
    if (id === 'ambCabin' || id === 'ambTerminal') return this.preview(id === 'ambCabin' ? 'cabin' : 'terminal');
    if (id === 'music') return this.previewMusic();
    this.render(id, { test: true });
  }

  /** Where ambience may play (true on the game screen); it fades in over 2 s and out when leaving. */
  setScene(game: boolean) {
    if (this.ambOk === game) return;
    this.ambOk = game;
    this.syncAmbience();
  }

  private syncAmbience() {
    const want: Ambience = this.cfg.on && this.unlocked && this.ambOk ? this.cfg.ambience : 'off';
    if ((this.amb?.kind ?? 'off') === want) return;
    this.amb?.stop(2);
    this.amb = null;
    if (want === 'off') return;
    const c = this.context();
    if (!c) return;
    this.amb = { kind: want, stop: startAmbience(c, this.bus.ambience!, want, 2) };
  }

  /** A 4 s sample of an ambience (Test sounds), whatever the setting. */
  private preview(kind: 'cabin' | 'terminal') {
    const c = this.context();
    if (!c || !this.master) return;
    this.previewStop?.();
    const gN = c.createGain();
    gN.gain.value = CAT_GAIN.ambience * 2;
    gN.connect(this.master);
    this.hearTest(c);
    const stop = startAmbience(c, gN, kind, 0.4);
    const t = setTimeout(() => stop(0.8), 4000);
    this.previewStop = () => { clearTimeout(t); stop(0.2); };
  }

  /** v0.9.1 Test sounds › Music: 12 s of the music whatever its setting (when it already plays, it is what you hear). */
  private previewMusic() {
    const c = this.context();
    if (!c || !this.master) return;
    if (this.music?.running && musicLevel(this.cfg, this.visible) > 0) return;
    this.previewStop?.();
    const gN = c.createGain();
    gN.connect(this.master);
    this.hearTest(c);
    const p = new MusicPlayer(c, gN);
    p.setLevel(musicLevel({ on: true, music: true, musicVolume: Math.max(0.35, this.cfg.musicVolume) }, true), 1);
    const t = setTimeout(() => p.setLevel(0, 2), 12_000);
    this.previewStop = () => { clearTimeout(t); p.setLevel(0, 0.6); };
  }

  /** With the master switch off, a test still plays: the master opens for a few seconds. */
  private hearTest(c: AudioContext) {
    if (this.cfg.on || !this.master) return;
    this.master.gain.setTargetAtTime(this.cfg.volume, c.currentTime, 0.01);
    if (this.testRestore) clearTimeout(this.testRestore);
    this.testRestore = setTimeout(() => this.applyGains(), 5000);
  }

  private render(id: SoundId, o: { down?: boolean; test?: boolean } = {}) {
    const c = this.context();
    if (!c || !this.master) return;
    this.log.push({ id, t: performance.now() });
    if (this.log.length > 200) this.log.shift();
    // A test plays through its own gain (its category may be switched off).
    let out: AudioNode = this.bus[CAT_OF[id]]!;
    if (o.test) {
      const gN = c.createGain();
      gN.gain.value = CAT_GAIN[CAT_OF[id]];
      gN.connect(this.master);
      out = gN;
      this.hearTest(c);
    }
    const t = c.currentTime + 0.02;
    const seq = SEQ[id];
    if (seq) {
      this.playSeq(c, out, seq, t);
      return;
    }
    switch (id) {
      case 'tap':
        tone(c, out, 1600, t, 0.025, 0.04, 'sine');
        tick(c, out, t, 0.006, 0.03, 3200);
        break;
      case 'toggle':
        tone(c, out, o.down ? 1500 : 1200, t, 0.03, 0.035, 'sine');
        tone(c, out, o.down ? 1200 : 1500, t + 0.04, 0.03, 0.035, 'sine');
        break;
      case 'error': tone(c, out, 196, t, 0.12, 0.09, 'triangle'); break;
      case 'alarm': alarm(c, out, t); break;
      case 'ring':
        this.stopRing();
        this.ringStop = ring(c, out, t, o.test ? 2 : RING_CYCLES);
        break;
      default: break;
    }
  }

  private ringStop: (() => void) | null = null;
  /** v0.10.2 the call was answered, declined or put away: the ring stops at once (clicks sound again, the music returns). */
  stopRing() {
    this.ringStop?.();
    this.ringStop = null;
    this.pending = this.pending.filter((x) => x !== 'ring');
    if (this.last?.id === 'ring') {
      this.alertUntil = 0;
      this.music?.unduck();
    }
  }

  /** v0.9.1 a cabin-system sequence of the HI and LO samples (decoded first when the unlock has only just run). */
  private playSeq(c: AudioContext, out: AudioNode, seq: ['hi' | 'lo', number][], t: number) {
    const go = (at: number) => {
      for (const [k, dt] of seq) {
        const b = this.samples[k];
        if (!b) continue;
        const src = c.createBufferSource();
        src.buffer = b;
        src.connect(out);
        src.start(at + dt);
      }
    };
    if (this.samplesReady) return go(t);
    const asked = performance.now();
    void this.loadSamples().then(() => {
      // Late by more than a moment (a slow first load): skip it rather than chime out of step with its toast.
      if (performance.now() - asked < 2500) go(c.currentTime + 0.02);
    });
  }
}

function tone(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number, type: OscillatorType) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.03);
}

/** A tiny filtered-noise tick (the click's attack). */
function tick(c: AudioContext, out: AudioNode, t: number, dur: number, gain: number, hz: number) {
  const s = c.createBufferSource();
  s.buffer = noise(c, 0.02, 'white');
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = hz;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(bp).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.01);
}

/** Master-caution style: 3 bursts of 3 pulses (110 ms on, 70 ms off) of a C6 + G6 dyad, low-passed; never looped. */
function alarm(c: AudioContext, out: AudioNode, t: number) {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.connect(out);
  for (let b = 0; b < 3; b++) {
    for (let p = 0; p < 3; p++) {
      const s = t + b * 1.07 + p * 0.18;
      for (const [f, type, amp] of [[1046.5, 'sine', 0.16], [1567.98, 'sine', 0.1], [1046.5, 'triangle', 0.05]] as [number, OscillatorType, number][]) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(amp, s + 0.006);
        g.gain.setValueAtTime(amp, s + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.11);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(s + 0.13);
      }
    }
  }
}

/** v0.10.2 a soft phone ring: per cycle two 0.4 s trills (two sines a minor third apart, warbled at 20 Hz), 0.2 s
 *  apart, every RING_EVERY s; all scheduled through one gain so stopping it is one fade. */
function ring(c: AudioContext, out: AudioNode, t: number, cycles: number): () => void {
  const bus = c.createGain();
  bus.gain.value = 1;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  bus.connect(lp).connect(out);
  const oscs: OscillatorNode[] = [];
  for (let k = 0; k < cycles; k++) {
    for (const off of [0, 0.6]) {
      const s = t + k * RING_EVERY + off;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, s);
      // the warble: 20 Hz on/off within the trill, soft edges
      for (let i = 0; i < 8; i++) {
        const a = s + i * 0.05;
        g.gain.linearRampToValueAtTime(0.07, a + 0.008);
        g.gain.linearRampToValueAtTime(0.012, a + 0.045);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.42);
      g.connect(bus);
      for (const f of [1046.5, 1244.5]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(g);
        o.start(s);
        o.stop(s + 0.45);
        oscs.push(o);
      }
    }
  }
  return () => {
    const now = c.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + 0.08);
    setTimeout(() => {
      for (const o of oscs) try { o.stop(); } catch { /* already stopped */ }
      bus.disconnect();
    }, 150);
  };
}

/** A 1.2 s stereo room: decaying noise. */
function impulse(c: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  }
  return b;
}

function noise(c: AudioContext, sec: number, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const n = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
  }
  return b;
}

/** Cabin hum (brown noise under 180 Hz, two slow-beating sines) or terminal air (pink noise band, slow drift), looping; returns stop(fadeSeconds). */
function startAmbience(c: AudioContext, out: AudioNode, kind: 'cabin' | 'terminal', fadeIn: number): (fade: number) => void {
  const g = c.createGain();
  const t = c.currentTime;
  const level = kind === 'cabin' ? 0.2 : 0.16;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level, t + fadeIn);
  g.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];
  const src = c.createBufferSource();
  src.buffer = noise(c, 4, kind === 'cabin' ? 'brown' : 'pink');
  src.loop = true;
  const f = c.createBiquadFilter();
  if (kind === 'cabin') {
    f.type = 'lowpass';
    f.frequency.value = 180;
    src.connect(f).connect(g);
    for (const hz of [98, 101]) {
      const o = c.createOscillator();
      o.frequency.value = hz;
      const og = c.createGain();
      og.gain.value = 0.12;
      o.connect(og).connect(g);
      nodes.push(o);
    }
  } else {
    f.type = 'bandpass';
    f.frequency.value = 670;
    f.Q.value = 0.45;
    const drift = c.createGain();
    drift.gain.value = 1;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.05;
    const depth = c.createGain();
    depth.gain.value = 0.3;
    lfo.connect(depth).connect(drift.gain);
    src.connect(f).connect(drift).connect(g);
    nodes.push(lfo);
  }
  nodes.push(src);
  for (const n of nodes) n.start(t);
  return (fade: number) => {
    const now = c.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
    g.gain.linearRampToValueAtTime(0.0001, now + fade);
    for (const n of nodes) n.stop(now + fade + 0.05);
  };
}

export const sound = new Sound();
