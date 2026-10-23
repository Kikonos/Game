// v0.9 aviation sound set (UPDATE-0.9.md §S): cabin and cockpit chimes synthesised with WebAudio (no audio files, so
// it works offline). Sine/triangle bell partials with a natural decay and a little room reverb; nothing harsh. Each
// event maps to exactly one sound in SOUND_OF (the doc's §S.3 table is its documentation). Chimes and alerts merge in a
// 900 ms window and play the highest-priority one once, with per-sound cooldowns, so 4× never machine-guns. The urgent
// alarm is only for CREW SHORTAGE and CREW OUT OF HOURS. Nothing plays before the first tap (iOS audio unlock).

import type { Cue } from '../engine/core/cues';

export type SoundId =
  | 'tap' | 'toggle' | 'error' | 'high' | 'low' | 'ding' | 'highLow' | 'highLowSoft' | 'double' | 'triple' | 'alarm'
  | 'achievement' | 'flourish' | 'ambCabin' | 'ambTerminal';
export type SoundCat = 'alerts' | 'chimes' | 'ui' | 'ambience';
/** UI-only events (the engine's cues are the rest). */
export type UiEvent = 'tap' | 'toggle' | 'toggleOff' | 'error' | 'pause' | 'resume';
export type SoundEvent = Cue | UiEvent;
export type Ambience = 'off' | 'cabin' | 'terminal';

/** THE table: each event → exactly one sound (§S.3). Keep identical to UPDATE-0.9.md §S.3. */
export const SOUND_OF: Record<SoundEvent, SoundId> = {
  tap: 'tap', toggle: 'toggle', toggleOff: 'toggle', error: 'error',
  pause: 'low', resume: 'low', flightDep: 'low', flightArr: 'low',
  message: 'high', crewJoined: 'high', paymentIn: 'high', monthEnd: 'high', headDone: 'high',
  decision: 'ding',
  offerNew: 'highLow', contractSigned: 'highLowSoft',
  aog: 'double', delayPenalty: 'double', sickCall: 'double', latePayer: 'double', offerLapsing: 'double', worldEventOurs: 'double', crewAmber: 'double', ruleAlert: 'double',
  cancelRisk: 'triple', airspaceActive: 'triple', cashNegative: 'triple', evacuation: 'triple', clientCollapse: 'triple',
  crewShortage: 'alarm', crewOutOfHours: 'alarm',
  achievement: 'achievement', ladder: 'achievement',
  headUnlocked: 'flourish', headHired: 'flourish',
};

export const CAT_OF: Record<SoundId, SoundCat> = {
  tap: 'ui', toggle: 'ui', error: 'ui',
  high: 'chimes', low: 'chimes', ding: 'chimes', highLow: 'chimes', highLowSoft: 'chimes', achievement: 'chimes', flourish: 'chimes',
  double: 'alerts', triple: 'alerts', alarm: 'alerts',
  ambCabin: 'ambience', ambTerminal: 'ambience',
};

/** Merge priority (§S.4): the highest in a window plays once. */
export const PRIORITY: Partial<Record<SoundId, number>> = {
  alarm: 100, triple: 90, double: 80, achievement: 70, flourish: 65, highLow: 60, highLowSoft: 55, ding: 45, high: 40, low: 30,
};
/** Quiet time after a sound plays (ms): a request that doesn't outrank it is dropped meanwhile. */
export const COOLDOWN: Partial<Record<SoundId, number>> = {
  alarm: 20_000, triple: 10_000, double: 6_000, highLow: 3_000, highLowSoft: 3_000, achievement: 3_000, flourish: 3_000, ding: 2_500, high: 2_500, low: 2_000,
};
/** Rough length (s), so UI clicks stay quiet while an alert sounds. */
const LENGTH: Partial<Record<SoundId, number>> = { double: 2.2, triple: 3.3, alarm: 2.6 };

export const MERGE_MS = 900;
const UI_GAP_MS = 50;

/** The Test sounds list (Settings): every sound with its meaning, in the player's words. */
export const SOUND_MEANING: { id: SoundId; name: string; meaning: string }[] = [
  { id: 'high', name: 'High chime', meaning: 'Routine news: a new message, a crew member joined, a payment in' },
  { id: 'low', name: 'Low chime', meaning: 'Calm moments: pause and resume; with Flight chimes on, each departure and landing' },
  { id: 'ding', name: 'Cockpit ding', meaning: 'A calm decision waits for you' },
  { id: 'highLow', name: 'High-low', meaning: 'A new contract offer' },
  { id: 'highLowSoft', name: 'Soft high-low', meaning: 'A contract signed' },
  { id: 'double', name: 'Double high-low', meaning: 'Needs you soon: AOG, a sick call, a late payer, an offer about to lapse' },
  { id: 'triple', name: 'Triple high-low', meaning: 'Serious: a flight about to be cancelled, airspace closed on an active flight, cash below zero' },
  { id: 'alarm', name: 'Urgent alarm', meaning: 'Only crew shortage and crew out of hours' },
  { id: 'achievement', name: 'Achievement', meaning: 'An achievement or a ladder step' },
  { id: 'flourish', name: 'Flourish', meaning: 'A department head unlocked or hired' },
  { id: 'tap', name: 'Click', meaning: 'Buttons and tabs' },
  { id: 'toggle', name: 'Toggle', meaning: 'Switches and speed buttons' },
  { id: 'error', name: 'Soft dunk', meaning: 'An action that is not possible' },
  { id: 'ambCabin', name: 'Cabin hum', meaning: 'Ambience: a quiet cabin in cruise' },
  { id: 'ambTerminal', name: 'Terminal air', meaning: 'Ambience: a terminal in the distance' },
];

export interface SoundConfig {
  on: boolean;
  volume: number;
  cats: { alerts: boolean; chimes: boolean; flights: boolean; ui: boolean };
  ambience: Ambience;
}

const CAT_GAIN: Record<SoundCat, number> = { alerts: 1, chimes: 0.8, ui: 0.5, ambience: 0.25 };

/**
 * Merge rule (pure, for tests): given the requests of one window and the last sound that played, the sound to play now
 * (or null). A request inside the last sound's cooldown is dropped unless it outranks it.
 */
export function pickMerged(reqs: SoundId[], last: { id: SoundId; at: number } | null, now: number): SoundId | null {
  let best: SoundId | null = null;
  for (const r of reqs) if (best === null || (PRIORITY[r] ?? 0) > (PRIORITY[best] ?? 0)) best = r;
  if (!best) return null;
  if (last && now - last.at < (COOLDOWN[last.id] ?? 0) && (PRIORITY[best] ?? 0) <= (PRIORITY[last.id] ?? 0)) return null;
  return best;
}

type Win = Window & { webkitAudioContext?: typeof AudioContext };

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: Partial<Record<SoundCat, GainNode>> = {};
  private cfg: SoundConfig = { on: true, volume: 0.6, cats: { alerts: true, chimes: true, flights: false, ui: true }, ambience: 'off' };
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
  /** Played sounds (newest last, 200 max): dev checks of the rate limit. */
  readonly log: { id: SoundId; t: number }[] = [];

  configure(c: Partial<SoundConfig>) {
    this.cfg = { ...this.cfg, ...c, cats: { ...this.cfg.cats, ...c.cats } };
    this.applyGains();
    this.syncAmbience();
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
    document.addEventListener('visibilitychange', () => {
      const c = this.ctx;
      if (!c) return;
      if (document.visibilityState === 'hidden') void c.suspend().catch(() => {});
      else if (this.unlocked) void c.resume().catch(() => {});
    });
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
    this.syncAmbience();
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
      for (const k of ['alerts', 'chimes', 'ui', 'ambience'] as SoundCat[]) {
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
      const on = k === 'ambience' ? true : this.cfg.cats[k as 'alerts' | 'chimes' | 'ui'];
      this.bus[k]!.gain.setTargetAtTime(on ? CAT_GAIN[k] : 0, c.currentTime, 0.02);
    }
  }

  /** An event (engine cue or UI): UI sounds at once, chimes and alerts through the merge window. */
  event(e: SoundEvent) {
    const id = SOUND_OF[e];
    if (!id || !this.cfg.on || !this.unlocked) return;
    const cat = CAT_OF[id];
    if (cat === 'ui') {
      if (!this.cfg.cats.ui) return;
      const t = performance.now();
      if (t - this.lastUi < UI_GAP_MS || t < this.alertUntil) return;
      this.lastUi = t;
      this.render(id, e === 'toggleOff' ? { down: true } : {});
      return;
    }
    if ((e === 'flightDep' || e === 'flightArr') && !this.cfg.cats.flights) return;
    if (cat === 'alerts' ? !this.cfg.cats.alerts : !this.cfg.cats.chimes) return;
    this.pending.push(id);
    this.timer ??= setTimeout(() => this.flush(), MERGE_MS);
  }

  private flush() {
    this.timer = null;
    const reqs = this.pending;
    this.pending = [];
    const now = performance.now();
    const id = pickMerged(reqs, this.last, now);
    if (!id) return;
    this.last = { id, at: now };
    if (LENGTH[id]) this.alertUntil = now + LENGTH[id]! * 1000;
    this.render(id);
  }

  /** Settings › Test sounds: plays one now (any category, at the set volume), no merge. */
  test(id: SoundId) {
    if (!this.unlocked || this.asleep) this.unlock();
    if (id === 'ambCabin' || id === 'ambTerminal') return this.preview(id === 'ambCabin' ? 'cabin' : 'terminal');
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
    const A5 = 880;
    const F5 = 698.46;
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
      case 'high': bell(c, out, A5, t, 0.22, 1.8); break;
      case 'low': bell(c, out, 587.33, t, 0.22, 2.3); break;
      case 'ding': bell(c, out, 1174.66, t, 0.16, 1.0); break;
      case 'highLow': bell(c, out, A5, t, 0.22, 1.8); bell(c, out, F5, t + 0.55, 0.22, 2.0); break;
      case 'highLowSoft': bell(c, out, A5, t, 0.11, 2.2); bell(c, out, F5, t + 0.7, 0.11, 2.5); break;
      case 'double':
        for (const k of [0, 1]) { bell(c, out, A5, t + k, 0.22, 1.5); bell(c, out, F5, t + k + 0.55, 0.22, 1.7); }
        break;
      case 'triple':
        for (const k of [0, 1, 2]) { bell(c, out, A5, t + k, 0.22, 1.4); bell(c, out, F5, t + k + 0.55, 0.22, 1.6); }
        break;
      case 'alarm': alarm(c, out, t); break;
      case 'achievement':
        bell(c, out, 523.25, t, 0.16, 1.6);
        bell(c, out, 659.25, t + 0.16, 0.16, 1.6);
        bell(c, out, 783.99, t + 0.32, 0.18, 2.4);
        bell(c, out, 1567.98, t + 0.32, 0.04, 2.0);
        break;
      case 'flourish':
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          bell(c, out, f, t + i * 0.09, 0.1, 1.5);
          tone(c, out, f * 2, t + i * 0.09, 0.5, 0.012, 'triangle');
        });
        break;
      case 'ambCabin': case 'ambTerminal': break;
    }
  }
}

/** One soft bell: sine partials 1× / 2× / 3× with faster decays, a 1× triangle and a voice detuned +2 cents. */
function bell(c: AudioContext, out: AudioNode, f: number, t: number, gain: number, dur: number) {
  const parts: [number, number, OscillatorType, number][] = [
    [f, 1, 'sine', dur], [f * 2, 0.18, 'sine', dur / 2], [f * 3, 0.06, 'sine', dur / 3], [f, 0.08, 'triangle', dur], [f * Math.pow(2, 2 / 1200), 0.35, 'sine', dur],
  ];
  for (const [freq, amp, type, d] of parts) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    const peak = Math.max(0.0002, gain * amp * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(peak * 0.001, t + 0.004 + d);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + d + 0.05);
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
