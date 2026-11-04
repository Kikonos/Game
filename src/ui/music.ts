// v0.12 five pieces take turns (TRACKS: Cruise, Night Flight, Golden Hour, Ops Room, Long Haul), a few minutes each.
// v0.9.1 calm background music, generated live with WebAudio (no audio files, nothing recorded): warm pads on a slow
// chord cycle (Imaj7 – vi7 – IVmaj7 – Vsus and two cousins), 64 bpm, sparse electric-piano notes on top with a soft
// echo, no drums. Long-form variation from UI-side randomness (never the engine's RNG): the key moves every few
// cycles, voicings, octaves, note timing and velocity are drawn fresh, and some cycles leave the melody out.
// Notes are scheduled a few seconds ahead from a 1 s timer: no per-frame work. Its own gain stage (`level`) carries the
// settings' volume and the fades (on/off, hidden/visible); a second one (`duck`) dips it under chimes and alarms.
// v0.15.1 TERMINAL: a departure-lounge piece for the title and menu screens (never in the in-game playlist), rewritten
// after the player found the first one too busy: a soft Rhodes-style electric piano comping maj9 chords on a light
// bossa-nova pulse (a round upright-style bass, a soft shaker, brush swishes on 2 and 4, a felt kick), airy pads, a
// sparse melody (Rhodes, now and then a glass bell), all in a synthesised hall reverb; under it a wordless airport bed
// (the hall's low hum, a distant jet passing now and then) and, every minute or so, a soft two-note PA "ding-dong".
// A player made with `[TERMINAL]` plays it on its own, looping without a seam.

export interface AudioParamLike {
  value: number;
  setTargetAtTime(v: number, t: number, tau: number): unknown;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime?(v: number, t: number): unknown;
  exponentialRampToValueAtTime?(v: number, t: number): unknown;
}

/** Seconds: a fade in or out (a few seconds, never a cut). */
export const MUSIC_FADE = 3;
/** The dip under a chime or an alarm: the level it falls to, how fast, and how slowly it comes back. */
export const DUCK = { level: 0.3, downTau: 0.08, upTau: 0.6 };
/** The music's own share of the master volume (low: it sits under everything). */
export const MUSIC_GAIN = 0.32;

const LOOKAHEAD = 4;
const TICK_MS = 1000;

/** Chord tones in semitones from the key (major, minor and suspended colours). */
const CHORDS: Record<string, number[]> = {
  Imaj7: [0, 4, 7, 11],
  Iadd9: [0, 4, 7, 14],
  ii7: [2, 5, 9, 12],
  IImaj: [2, 6, 9, 14],
  iii7: [4, 7, 11, 14],
  IVmaj7: [5, 9, 12, 16],
  Vsus: [7, 12, 14, 17],
  V7sus: [7, 12, 14, 17, 22],
  vi7: [9, 12, 16, 19],
  i7: [0, 3, 7, 10],
  i9: [0, 3, 7, 10, 14],
  iv7: [5, 8, 12, 15],
  bVImaj7: [8, 12, 15, 19],
  bVII: [10, 14, 17, 22],
  Isus2: [0, 2, 7, 12],
  IVsus2: [5, 7, 12, 17],
  // v0.15 the lounge colours (Terminal): ninths, the bass takes the root and the piano the rest.
  Imaj9: [0, 4, 7, 11, 14],
  IVmaj9: [5, 9, 12, 16, 19],
  ii9: [2, 5, 9, 12, 16],
  vi9: [9, 12, 16, 19, 23],
  V9sus: [7, 12, 17, 21],
};

type Rng = () => number;

/** The lead voice: a soft electric piano, a bell, a plucked arpeggio, a Rhodes (v0.15), or none. */
type Lead = 'epiano' | 'bell' | 'pluck' | 'rhodes' | 'none';

/**
 * v0.12 one piece of the soundtrack: its tempo and harmony, the pad's colour, the lead and how busy it is, an optional
 * soft bass pulse, and how long it plays before the next one takes over (minutes).
 */
export interface Track {
  name: string;
  bpm: number;
  /** Beats per chord. */
  chordBeats: number;
  progressions: string[][];
  /** Keys (MIDI of the root, around C3–G3): warm, never shrill. */
  keys: number[];
  /** The melody's notes (semitones from the key): a pentatonic that never clashes with the pads. */
  scale: number[];
  /** Pad low-pass cut-off (Hz) and level. */
  padCut: number;
  padGain: number;
  lead: Lead;
  /** Share of beats (eighths for the pluck) that get a lead note. */
  density: number;
  /** A soft bass on beats 1 and 3 (or 1, 3½ for a little swing). */
  bass: boolean;
  minutes: number;
  /** v0.15 the lounge arrangement (Terminal): Rhodes comping, warm pads, groove, and the terminal bed under it. */
  lounge?: boolean;
}

/** v0.12 the soundtrack: five calm pieces that take turns (the first one is the v0.9.1 music). */
export const TRACKS: Track[] = [
  { name: 'Cruise', bpm: 64, chordBeats: 8, progressions: [['Imaj7', 'vi7', 'IVmaj7', 'Vsus'], ['Imaj7', 'iii7', 'vi7', 'IVmaj7'], ['IVmaj7', 'Imaj7', 'ii7', 'Vsus']], keys: [50, 53, 55, 51, 48], scale: [0, 2, 4, 7, 9], padCut: 900, padGain: 0.032, lead: 'epiano', density: 0.32, bass: false, minutes: 4 },
  { name: 'Night Flight', bpm: 56, chordBeats: 8, progressions: [['i7', 'bVImaj7', 'iv7', 'bVII'], ['i9', 'iv7', 'bVImaj7', 'bVII']], keys: [48, 50, 45, 47], scale: [0, 3, 5, 7, 10], padCut: 650, padGain: 0.034, lead: 'bell', density: 0.18, bass: false, minutes: 4 },
  { name: 'Golden Hour', bpm: 72, chordBeats: 8, progressions: [['Imaj7', 'IImaj', 'vi7', 'IVmaj7'], ['IVmaj7', 'IImaj', 'Imaj7', 'Vsus']], keys: [53, 55, 52, 50], scale: [0, 2, 4, 7, 9], padCut: 1100, padGain: 0.026, lead: 'pluck', density: 0.7, bass: false, minutes: 3.5 },
  { name: 'Ops Room', bpm: 84, chordBeats: 8, progressions: [['ii7', 'V7sus', 'Imaj7', 'vi7'], ['IVmaj7', 'iii7', 'ii7', 'V7sus']], keys: [50, 48, 53], scale: [0, 2, 4, 7, 9], padCut: 800, padGain: 0.026, lead: 'epiano', density: 0.24, bass: true, minutes: 3.5 },
  { name: 'Long Haul', bpm: 50, chordBeats: 12, progressions: [['Isus2', 'IVsus2', 'Iadd9', 'Vsus'], ['Iadd9', 'vi7', 'IVsus2', 'Isus2']], keys: [48, 50, 46], scale: [0, 2, 7, 9, 12], padCut: 700, padGain: 0.036, lead: 'bell', density: 0.09, bass: false, minutes: 5 },
];

/**
 * v0.15.1 the departure lounge (title and menu screens only; not in TRACKS, so never in the in-game playlist): 76 bpm,
 * two bars a chord, slow maj9 progressions (Imaj9 – vi9 – ii9 – V9sus and three cousins) in warm keys from C to G; the
 * key moves to a neighbour every few cycles, never a leap.
 */
export const TERMINAL: Track = {
  name: 'Terminal', bpm: 76, chordBeats: 8,
  progressions: [['Imaj9', 'vi9', 'ii9', 'V9sus'], ['Imaj9', 'ii9', 'iii7', 'IVmaj9'], ['IVmaj9', 'V9sus', 'iii7', 'vi9'], ['Imaj9', 'IVmaj9', 'ii9', 'V9sus']],
  keys: [48, 50, 51, 53, 55], scale: [0, 2, 4, 7, 9], padCut: 1100, padGain: 0.034, lead: 'rhodes', density: 0.22, bass: true, minutes: 3,
  lounge: true,
};

/** v0.15.1 Terminal's comping (beat, length in beats, velocity) for one two-bar chord: hits on the beat and anticipated off-beats, one pattern a single long chord. */
export const COMP: [number, number, number][][] = [
  [[0, 3, 1], [3.5, 1.2, 0.6], [5.5, 2.2, 0.75]],
  [[0, 1.8, 0.95], [2.5, 1.2, 0.6], [4, 2.5, 0.85], [6.5, 1.3, 0.6]],
  [[0, 7.6, 0.9]],
  [[0.5, 2.5, 0.8], [4, 1.8, 0.85], [6, 1.8, 0.7]],
];
/** v0.15.1 Terminal's bass (beat, semitones from the root, length, velocity): a bossa-nova walk, the root on the beat and the fifth below on the "and". */
export const BASS_LINES: [number, number, number, number][][] = [
  [[0, 0, 1.5, 1], [1.5, -5, 0.5, 0.6], [2, 0, 1.5, 0.85], [3.5, -5, 0.5, 0.55], [4, 0, 1.5, 0.95], [5.5, -5, 0.5, 0.6], [6, 0, 1.5, 0.85], [7.5, 7, 0.5, 0.5]],
  [[0, 0, 3.5, 1], [3.5, -5, 0.5, 0.6], [4, 0, 2, 0.9], [6, 7, 1, 0.6], [7, -5, 1, 0.55]],
  [[0, 0, 1.5, 1], [1.5, -5, 0.5, 0.6], [2, 0, 2, 0.85], [4, 0, 1.5, 0.95], [5.5, -5, 0.5, 0.6], [6, 0, 2, 0.85]],
  [[0, 0, 2, 1], [2, 7, 2, 0.6], [4, 0, 3.5, 0.95], [7.5, -5, 0.5, 0.6]],
];
/** v0.15.1 the lounge's levels: the Rhodes comping, the bass, the melody's first and later notes, and the kit (the shaker on the beat and off it, the brush swish, the felt kick). */
export const LOUNGE = { comp: 0.085, bass: 0.11, lead: 0.095, leadMore: 0.075, shaker: 0.013, shakerOff: 0.008, swish: 0.02, kick: 0.05 };
/** v0.15.1 the melody's slots in a two-bar chord (beats): on the beat and syncopated. */
export const MELODY_SLOTS = [0.5, 1.5, 2, 3.5, 4, 4.5, 5.5, 6, 7];
/**
 * v0.15.1 the airport bed: the hall's hum level, the distant jet (a chance per chord after a gap in chords, its level) and
 * the PA chime (a chance per chord after a gap, its level). The first jet and the first chime come as soon as their gap
 * allows (within the first half minute), the later ones by chance. Never a voice.
 */
export const BED = { hum: 0.04, jetChance: 0.3, jetGap: 3, jetGain: 0.14, chimeChance: 0.22, chimeGap: 6, chimeGain: 0.1 };
/** v0.15.1 the hall reverb: its length (s), the time to −60 dB, the pre-delay, the wet share, the melody echo's wet share; and the lounge's trim into the music level. */
export const HALL = { sec: 2.6, rt60: 2.1, predelay: 0.012, wet: 0.3, echoWet: 0.2, trim: 1.5 };

/** v0.15.1 the next key of a lounge section (pure): a neighbour in the track's key list (a step, never a leap); any key when none is set. */
export function nextKey(keys: number[], cur: number, r: Rng): number {
  const i = keys.indexOf(cur);
  if (i < 0 || keys.length < 2) return keys[Math.floor(r() * keys.length)];
  const j = i === 0 ? 1 : i === keys.length - 1 ? i - 1 : r() < 0.5 ? i - 1 : i + 1;
  return keys[j];
}

/** v0.15.1 the bass register (pure): the root moved by octaves into G1–G2 (MIDI 31–43), where an upright sits. */
export function bassRoot(midi: number): number {
  let m = midi;
  while (m > 43) m -= 12;
  while (m < 31) m += 12;
  return m;
}

/** v0.15 a close voicing (pure): every note moved by octaves into [lo, lo + 12), lowest first. */
export function closeVoicing(notes: number[], lo: number): number[] {
  return notes.map((m) => lo + ((((m - lo) % 12) + 12) % 12)).sort((a, b) => a - b);
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * The music's target level for the settings (pure): the master switch and the Music switch both on, the Music volume
 * (the master volume applies after it, on the master bus), and nothing while the app is hidden.
 */
export function musicLevel(cfg: { on: boolean; music: boolean; musicVolume: number }, visible: boolean): number {
  return cfg.on && cfg.music && visible ? Math.max(0, Math.min(1, cfg.musicVolume)) * MUSIC_GAIN : 0;
}

/** The generator: wire it to an output, then start / setLevel / duck / stop. */
export class MusicPlayer {
  private readonly level: GainNode;
  private readonly duckG: GainNode;
  private readonly echo: DelayNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private chord = 0;
  private cycle = 0;
  private trackIx = 0;
  private trackStart = 0;
  private key = 0;
  private prog: string[] = [];
  private melody = true;
  private target = 0;
  private duckUntil = 0;
  /**
   * v0.15.1 Terminal: the hall reverb's send and the Rhodes' stereo tremolo (null without the nodes: dry, centred), the
   * melody's colour this section, its last degree (it moves by steps), chords since the last PA chime and jet, the noise
   * and hum buffers.
   */
  private readonly verb: GainNode | null = null;
  private readonly rhodesBus: AudioNode;
  /** v0.15.1 where the lounge's voices go: a trim into `level` (the level the playlist pieces sit at). */
  private readonly mix: GainNode;
  private glass = false;
  private melDeg = 3;
  private sinceChime = BED.chimeGap - 2;
  private sinceJet = BED.jetGap - 1;
  private chimes = 0;
  private jets = 0;
  private bufs: { white?: AudioBuffer; hum?: AudioBuffer } = {};

  /** `tracks`: the pieces this player takes turns with (v0.15 `[TERMINAL]`: the lounge piece on its own, looping). */
  constructor(private readonly c: AudioContext, out: AudioNode, private readonly rng: Rng = Math.random, private readonly tracks: Track[] = TRACKS) {
    this.duckG = c.createGain();
    this.level = c.createGain();
    this.level.gain.value = 0;
    this.level.connect(this.duckG);
    this.duckG.connect(out);
    const lounge = !!tracks[0]?.lounge;
    // A soft echo for the piano notes (one delay line with a low-passed feedback: a little space, cheap).
    try {
      const d = c.createDelay(1.5);
      // A dotted eighth at Cruise's 64 bpm: soft space for every piece; v0.15.1 Terminal's own dotted eighth.
      d.delayTime.value = lounge ? 0.75 * (60 / tracks[0].bpm) : 0.7;
      const fb = c.createGain();
      fb.gain.value = 0.28;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      d.connect(lp).connect(fb).connect(d);
      const wet = c.createGain();
      wet.gain.value = lounge ? HALL.echoWet : 0.35;
      lp.connect(wet).connect(this.level);
      this.echo = d;
    } catch {
      // no delay node (old WebKit): dry notes
    }
    // v0.15.1 the lounge's hall and the Rhodes' stereo tremolo (both optional: without the nodes the notes play dry, centred).
    this.mix = this.level;
    if (lounge) {
      this.mix = c.createGain();
      this.mix.gain.value = HALL.trim;
      this.mix.connect(this.level);
      this.verb = hallVerb(c, this.mix, rng);
    }
    this.rhodesBus = lounge ? tremoloBus(c, this.mix, this.verb) : this.mix;
  }

  get gainParam(): AudioParamLike {
    return this.level.gain;
  }
  get duckParam(): AudioParamLike {
    return this.duckG.gain;
  }
  get running(): boolean {
    return this.timer !== null;
  }
  /** v0.15 scheduling and not fading to silence (what Settings › Now playing names). */
  get playing(): boolean {
    return this.timer !== null && this.target > 0;
  }

  /** v0.12 the piece playing now. */
  get track(): Track {
    return this.tracks[this.trackIx];
  }

  /** v0.12 on to the next piece at the next chord (the pads' long release carries the change). */
  nextTrack() {
    this.trackIx = (this.trackIx + 1) % this.tracks.length;
    this.trackStart = this.next;
    this.newSection();
  }

  /** Fades to `v` over a few seconds (0: silent; the scheduler stops once the fade is over). */
  setLevel(v: number, fade = MUSIC_FADE) {
    const t = this.c.currentTime;
    const g = this.level.gain;
    this.target = v;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(v, t, fade / 3);
    if (v > 0) this.start();
  }

  /** Dips under a chime or an alarm lasting `sec`, then comes back slowly. */
  duck(sec: number) {
    const t = this.c.currentTime;
    const g = this.duckG.gain;
    const until = t + Math.max(0.3, sec);
    this.duckUntil = Math.max(this.duckUntil, until);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(DUCK.level, t, DUCK.downTau);
    g.setTargetAtTime(1, this.duckUntil, DUCK.upTau);
  }

  /** v0.10.2 back up now (a ring stopped early). */
  unduck() {
    const t = this.c.currentTime;
    this.duckUntil = t;
    const g = this.duckG.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.setTargetAtTime(1, t, DUCK.upTau);
  }

  private start() {
    if (this.timer) return;
    this.next = Math.max(this.next, this.c.currentTime + 0.1);
    // The first start picks a piece at random; afterwards they take turns in order.
    if (this.trackStart === 0) this.trackIx = Math.floor(this.rng() * this.tracks.length);
    this.trackStart = this.next;
    this.newSection();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Stops scheduling (notes already queued play out under the fade). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private newSection() {
    const r = this.rng;
    const tr = this.track;
    // v0.15.1 the lounge moves to a neighbouring key (a step, never a leap) and picks the melody's colour for the section.
    this.key = tr.lounge ? nextKey(tr.keys, this.key, r) : tr.keys[Math.floor(r() * tr.keys.length)];
    this.glass = !!tr.lounge && r() < 0.3;
    this.prog = tr.progressions[Math.floor(r() * tr.progressions.length)];
    this.chord = 0;
  }

  /** Schedules every chord starting inside the lookahead; stops itself after a fade to silence. */
  tick() {
    const c = this.c;
    if (c.state !== 'running') return;
    const now = c.currentTime;
    // Silent and faded out: no more notes (setLevel above 0 starts it again).
    if (this.target === 0 && this.level.gain.value < 0.002) {
      this.stop();
      return;
    }
    // Back from a pause of the clock (a suspended context): pick up from now, never a burst of old notes.
    if (this.next < now) this.next = now + 0.1;
    while (this.next < now + LOOKAHEAD) {
      const tr = this.track;
      this.playChord(this.next);
      this.next += tr.chordBeats * (60 / tr.bpm);
      this.chord++;
      if (this.chord >= this.prog.length) {
        this.chord = 0;
        this.cycle++;
        // v0.12 its minutes played: the next piece takes over at the end of the cycle.
        if (this.next - this.trackStart >= tr.minutes * 60) this.nextTrack();
        // Every 3–5 cycles a new key and progression; one cycle in four without the lead.
        else if (this.cycle % (3 + Math.floor(this.rng() * 3)) === 0) this.newSection();
        this.melody = this.rng() > 0.25;
      }
    }
  }

  private playChord(t: number) {
    const r = this.rng;
    const tr = this.track;
    if (tr.lounge) return this.playLounge(t);
    const beat = 60 / tr.bpm;
    const tones = CHORDS[this.prog[this.chord]];
    const dur = tr.chordBeats * beat;
    // Voicing: a random inversion, spread across an octave and a half; a soft root below.
    const inv = Math.floor(r() * tones.length);
    const voiced = tones.map((x, i) => this.key + x + (i < inv ? 12 : 0));
    pad(this.c, this.level, hz(this.key + tones[0] - 12), t, dur, 0.05, tr.padCut);
    for (const m of voiced) pad(this.c, this.level, hz(m), t, dur, tr.padGain + r() * 0.01, tr.padCut);
    // v0.12 a soft bass pulse (Ops Room): the root an octave down on beats 1 and 3, now and then a swung pickup.
    if (tr.bass) {
      for (let b = 0; b < tr.chordBeats; b += 2) bass(this.c, this.level, hz(this.key + tones[0] - 24), t + b * beat + (b % 4 === 2 && r() < 0.3 ? beat / 2 : 0), beat * 1.6);
    }
    if (!this.melody || tr.lead === 'none') return;
    if (tr.lead === 'pluck') {
      // A rolling arpeggio on eighths over the chord tones, up and back, a few left out.
      const steps = tr.chordBeats * 2;
      const up = [...voiced, voiced[0] + 12];
      const seq = [...up, ...up.slice(1, -1).reverse()];
      for (let i = 0; i < steps; i++) {
        if (r() > tr.density) continue;
        pluck(this.c, this.level, this.echo, hz(seq[i % seq.length] + 12), t + i * beat / 2 + (r() - 0.5) * 0.02, 0.035 + r() * 0.02);
      }
      return;
    }
    // Sparse lead: on some beats, a note of the scale one or two octaves up, a little late or early.
    for (let b = 0; b < tr.chordBeats; b++) {
      if (r() > tr.density) continue;
      const deg = tr.scale[Math.floor(r() * tr.scale.length)];
      const oct = r() < 0.7 ? 24 : 12;
      const at = t + b * beat + (r() - 0.5) * 0.12 + (r() < 0.2 ? beat / 2 : 0);
      if (tr.lead === 'bell') bell(this.c, this.level, this.echo, hz(this.key + deg + oct), at, 0.04 + r() * 0.03);
      else epiano(this.c, this.level, this.echo, hz(this.key + deg + oct), at, 0.05 + r() * 0.04);
    }
  }
  /**
   * v0.15.1 one two-bar chord of Terminal: airy pads, Rhodes comping, the bossa bass and the brushed kit, a sparse
   * melody, the airport bed (hum, now and then a distant jet) and, every minute or so, the PA chime.
   */
  private playLounge(t: number) {
    const c = this.c;
    const r = this.rng;
    const tr = this.track;
    const out = this.mix;
    const verb = this.verb;
    const beat = 60 / tr.bpm;
    const tones = CHORDS[this.prog[this.chord]];
    const dur = tr.chordBeats * beat;
    const root = this.key + tones[0];
    // Rootless when the chord has five tones (the bass has the root): the piano close-voiced from middle C, the pads an octave under it.
    const upper = (tones.length > 4 ? tones.slice(1) : tones).map((x) => this.key + x);
    const voiced = closeVoicing(upper, 60);
    closeVoicing(upper, 53).slice(0, 3).forEach((m, i) => airPad(c, out, verb, hz(m), t, dur, tr.padGain + r() * 0.004, tr.padCut, (i - 1) * 0.5));
    // A light swing on the off-beats.
    const at = (b: number) => t + b * beat + (b % 1 !== 0 ? beat * 0.07 : 0);
    // Comping: a soft roll from the lowest note up; a four-note chord now and then loses its fifth (a lighter hand).
    const hand = voiced.length > 3 && r() < 0.4 ? voiced.filter((_, i) => i !== 1) : voiced;
    for (const [b, len, vel] of COMP[Math.floor(r() * COMP.length)]) {
      hand.forEach((m, i) => rhodes(c, this.rhodesBus, null, hz(m), at(b) + i * 0.013 + r() * 0.006, len * beat, (LOUNGE.comp + r() * 0.012) * vel));
    }
    const low = bassRoot(root);
    for (const [b, deg, len, vel] of BASS_LINES[Math.floor(r() * BASS_LINES.length)]) loungeBass(c, out, hz(low + deg), at(b), len * beat, LOUNGE.bass * vel);
    // The kit: a soft shaker on the eighths (the beat a little stronger), a brush swish on 2 and 4, a felt kick on 1 and 3.
    const white = (this.bufs.white ??= noiseBuffer(c, 1));
    for (let b = 0; b < tr.chordBeats; b += 0.5) shaker(c, out, white, at(b), b % 1 === 0 ? LOUNGE.shaker : LOUNGE.shakerOff, r() * 0.5);
    for (let b = 1; b < tr.chordBeats; b += 2) swish(c, out, verb, white, at(b) - 0.06, LOUNGE.swish * (1 + r() * 0.25), r() * 0.5);
    for (let b = 0; b < tr.chordBeats; b += 2) kick(c, out, at(b), LOUNGE.kick);
    // The melody: a short phrase on the odd chords, an answer or nothing on the even ones; stepwise through the pentatonic.
    if (this.melody) {
      const n = this.chord % 2 === 0 ? 1 + Math.floor(r() * 3) : Math.floor(r() * 2);
      const slots = MELODY_SLOTS.filter(() => r() < 0.5).slice(0, n);
      slots.forEach((b, i) => {
        const step = r() < 0.75 ? (r() < 0.5 ? -1 : 1) : Math.floor(r() * 5) - 2;
        this.melDeg = Math.max(1, Math.min(tr.scale.length * 2 - 1, this.melDeg + step));
        const m = this.key + 12 + tr.scale[this.melDeg % tr.scale.length] + 12 * Math.floor(this.melDeg / tr.scale.length);
        const len = beat * ((slots[i + 1] ?? b + 2) - b) * 0.9;
        const gain = (i === 0 ? LOUNGE.lead : LOUNGE.leadMore) + r() * 0.015;
        if (this.glass) glass(c, out, verb, hz(m + 12), at(b), gain * 0.7);
        else rhodes(c, this.rhodesBus, this.echo, hz(m), at(b) + (r() - 0.5) * 0.02, len, gain);
      });
    }
    // The airport bed: the hall's hum (a grain per chord, they overlap), a distant jet now and then, and the PA chime.
    const hum = (this.bufs.hum ??= humBuffer(c, r));
    humGrain(c, out, hum, t, dur, BED.hum * (0.85 + r() * 0.3), r() * hum.duration);
    this.sinceJet++;
    if (this.sinceJet > BED.jetGap && (this.jets === 0 || r() < BED.jetChance)) {
      this.sinceJet = 0;
      this.jets++;
      jetPass(c, out, verb, white, t + r() * dur * 0.5, BED.jetGain * (0.7 + r() * 0.6), r());
    }
    this.sinceChime++;
    if (this.sinceChime > BED.chimeGap && (this.chimes === 0 || r() < BED.chimeChance)) {
      this.sinceChime = 0;
      this.chimes++;
      paChime(c, out, verb, this.key + 24, at(4.25), BED.chimeGain, r());
    }
  }
}

/** A warm pad voice: two slightly detuned sines and a triangle, low-passed, slow attack and release. */
function pad(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain: number, cut = 900) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cut;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 2);
  g.gain.setValueAtTime(gain, t + dur - 1);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
  lp.connect(g).connect(out);
  for (const [det, type] of [[-4, 'sine'], [4, 'sine'], [0, 'triangle']] as [number, OscillatorType][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = det;
    o.connect(lp);
    o.start(t);
    o.stop(t + dur + 2.6);
  }
}

/** A soft electric-piano note: a sine with a faint octave partial, quick attack, long gentle decay, into the echo. */
function epiano(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
  g.connect(out);
  if (echo) g.connect(echo);
  for (const [mul, amp] of [[1, 1], [2, 0.12]] as [number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 2.9);
  }
}

/** v0.12 a bell (Night Flight, Long Haul): a sine with an inharmonic partial, a soft strike and a long ring. */
function bell(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
  g.connect(out);
  if (echo) g.connect(echo);
  for (const [mul, amp] of [[1, 1], [2.76, 0.18], [5.4, 0.05]] as [number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 4.6);
  }
}

/** v0.12 a plucked note (Golden Hour): a low-passed triangle, quick attack and short decay, into the echo. */
function pluck(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, gain: number) {
  const g = c.createGain();
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  lp.connect(g);
  g.connect(out);
  if (echo) g.connect(echo);
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = f;
  o.connect(lp);
  o.start(t);
  o.stop(t + 1);
}

/** v0.12 a soft bass note (Ops Room): a sine with a rounded attack. */
function bass(c: AudioContext, out: AudioNode, f: number, t: number, dur: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(out);
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = f;
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.05);
}


/**
 * v0.15.1 Terminal's airy pad: two triangles a few cents apart and a sine an octave up, low-passed with a slow opening,
 * a slow attack and release, a little of it into the hall; the three notes of a chord spread left, centre and right.
 */
function airPad(c: AudioContext, out: AudioNode, verb: AudioNode | null, f: number, t: number, dur: number, gain: number, cut: number, pan = 0) {
  const g = c.createGain();
  g.gain.value = 0;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.3;
  lp.frequency.setValueAtTime(cut * 0.6, t);
  lp.frequency.linearRampToValueAtTime(cut, t + dur * 0.7);
  lp.frequency.linearRampToValueAtTime(cut * 0.7, t + dur + 2.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 2);
  g.gain.setValueAtTime(gain, t + dur - 0.6);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
  lp.connect(g).connect(panned(c, out, pan));
  if (verb) g.connect(verb);
  for (const [det, type, mul, amp] of [[-6, 'triangle', 1, 0.6], [6, 'triangle', 1, 0.6], [0, 'sine', 2, 0.22]] as [number, OscillatorType, number, number][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f * mul;
    o.detune.value = det;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(lp);
    o.start(t);
    o.stop(t + dur + 2.6);
  }
}

/**
 * v0.15.1 a Rhodes-style electric-piano note: a sine carrier with a 1:1 FM modulator whose depth falls fast (a soft bite
 * mellowing into a round tone; less of it the higher the note), a faint tine partial, a decay to a soft sustain held
 * for `dur`, then a short release. Into the Rhodes bus (the stereo tremolo) and, for the melody, the echo.
 */
function rhodes(c: AudioContext, out: AudioNode, echo: DelayNode | null, f: number, t: number, dur: number, gain0: number) {
  const gain = Math.max(0.0002, gain0);
  const hold = Math.max(0.4, dur);
  const end = t + hold + 0.5;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(gain * 0.5, t + 0.6);
  g.gain.exponentialRampToValueAtTime(gain * 0.22, t + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 0.5;
  lp.frequency.value = 2400;
  lp.connect(g).connect(out);
  if (echo) g.connect(echo);
  const car = c.createOscillator();
  car.type = 'sine';
  car.frequency.value = f;
  const mod = c.createOscillator();
  mod.type = 'sine';
  mod.frequency.value = f;
  const depth = c.createGain();
  const index = 0.85 * Math.min(1, Math.sqrt(400 / f));
  depth.gain.setValueAtTime(f * index, t);
  depth.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
  mod.connect(depth).connect(car.frequency);
  car.connect(lp);
  const tine = c.createOscillator();
  tine.type = 'sine';
  tine.frequency.value = f * 6.1;
  const tg = c.createGain();
  tg.gain.value = 0;
  tg.gain.setValueAtTime(0.0001, t);
  tg.gain.linearRampToValueAtTime(0.045, t + 0.003);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  tine.connect(tg).connect(lp);
  for (const o of [car, mod, tine]) {
    o.start(t);
    o.stop(end + 0.05);
  }
}

/** v0.15.1 a glass bell (the melody's other colour): a sine with an octave partial and a short bright one, a long ring, mostly in the hall. */
function glass(c: AudioContext, out: AudioNode, verb: AudioNode | null, f: number, t: number, gain0: number) {
  const gain = Math.max(0.0002, gain0);
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
  const dry = c.createGain();
  dry.gain.value = 0.6;
  g.connect(dry).connect(out);
  if (verb) g.connect(verb);
  for (const [mul, amp, len] of [[1, 1, 3], [2, 0.22, 2], [4.2, 0.05, 0.3]] as [number, number, number][]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * mul;
    const a = c.createGain();
    a.gain.setValueAtTime(amp, t);
    a.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 3.1);
  }
}

/** v0.15.1 Terminal's bass: a round sine with a little triangle, low-passed, a soft pluck decaying under `dur` (an upright, dry). */
function loungeBass(c: AudioContext, out: AudioNode, f: number, t: number, dur: number, gain0: number) {
  const gain = Math.max(0.0002, gain0);
  const g = c.createGain();
  g.gain.value = 0;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.03);
  g.gain.exponentialRampToValueAtTime(gain * 0.5, t + Math.min(0.5, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
  lp.connect(g).connect(out);
  for (const [type, amp] of [['sine', 1], ['triangle', 0.3]] as [OscillatorType, number][]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const a = c.createGain();
    a.gain.value = amp;
    o.connect(a).connect(lp);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
}

/** v0.15.1 a soft shaker: a very short band-passed puff of noise. */
function shaker(c: AudioContext, out: AudioNode, buf: AudioBuffer, t: number, gain: number, offset: number) {
  const s = c.createBufferSource();
  s.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 5000;
  bp.Q.value = 1.1;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  s.connect(bp).connect(g).connect(out);
  s.start(t, offset);
  s.stop(t + 0.12);
}

/** v0.15.1 a brush swish (beats 2 and 4): band-passed noise swelling over 90 ms and dying away, a little into the hall. */
function swish(c: AudioContext, out: AudioNode, verb: AudioNode | null, buf: AudioBuffer, t: number, gain: number, offset: number) {
  const s = c.createBufferSource();
  s.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2800;
  bp.Q.value = 0.7;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.09);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  s.connect(bp).connect(g).connect(out);
  if (verb) g.connect(verb);
  s.start(t, offset);
  s.stop(t + 0.4);
}

/** v0.15.1 a felt kick: a sine falling from 75 to 45 Hz, very soft and short. */
function kick(c: AudioContext, out: AudioNode, t: number, gain: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(75, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + 0.35);
}

/** v0.15.1 one grain of the hall's hum (looped buffer, its own offset): fades in over 2.5 s, holds, fades out over the next grain's fade-in. */
function humGrain(c: AudioContext, out: AudioNode, buf: AudioBuffer, t: number, dur: number, gain: number, offset: number) {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 2.5);
  g.gain.setValueAtTime(gain, t + dur);
  g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
  s.connect(lp).connect(g).connect(out);
  s.start(t, offset);
  s.stop(t + dur + 2.6);
}

/** v0.15.1 the distant jet's timing (s): the swell up, the hold, and the fade as it climbs away. */
export const JET = { up: 5, hold: 1.5, down: 7 };

/**
 * v0.15.1 a jet passing far off: noise through a band falling from 420 to 260 Hz (it turns away) under a low-pass,
 * swelling and dying over about 13 s, half of it in the hall. Very low: felt more than heard.
 */
function jetPass(c: AudioContext, out: AudioNode, verb: AudioNode | null, buf: AudioBuffer, t: number, gain: number, offset: number) {
  const len = JET.up + JET.hold + JET.down;
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(420, t);
  bp.frequency.linearRampToValueAtTime(260, t + len);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  const g = c.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + JET.up);
  g.gain.setValueAtTime(gain, t + JET.up + JET.hold);
  g.gain.linearRampToValueAtTime(0.0001, t + len);
  s.connect(bp).connect(lp).connect(g).connect(out);
  if (verb) {
    const send = c.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(verb);
  }
  s.start(t, offset);
  s.stop(t + len + 0.1);
}

/** v0.15.1 the PA chime's notes (semitones from the key): a falling "ding-dong" (sol–mi or mi–do), now and then a rising three-note call. */
export function chimeNotes(r: number): number[] {
  return r < 0.45 ? [7, 4] : r < 0.8 ? [4, 0] : [0, 4, 7];
}

/**
 * v0.15.1 a soft PA chime far off in the hall: bell-like notes 0.55 s apart (a sine with an octave and a third partial),
 * through a speaker-like band, mostly in the hall, a little dry. In the key, so it never clashes with the music.
 */
function paChime(c: AudioContext, out: AudioNode, verb: AudioNode | null, root: number, t: number, gain: number, pick: number) {
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1400;
  bp.Q.value = 0.5;
  const dry = c.createGain();
  dry.gain.value = 0.35;
  bp.connect(dry).connect(out);
  if (verb) bp.connect(verb);
  chimeNotes(pick).forEach((deg, i) => {
    const s = t + i * 0.55;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.linearRampToValueAtTime(gain, s + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 2.2);
    g.connect(bp);
    for (const [mul, amp] of [[1, 1], [2, 0.3], [3, 0.08]] as [number, number][]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz(root + deg) * mul;
      const a = c.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(s);
      o.stop(s + 2.3);
    }
  });
}

/** v0.15 a short white-noise buffer (the kit, the jet). */
function noiseBuffer(c: AudioContext, sec: number): AudioBuffer {
  const n = Math.floor(c.sampleRate * sec);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** v0.15.1 `out` through a stereo panner at `pan` (−1 left to 1 right); `out` itself when there is no panner or no pan. */
function panned(c: AudioContext, out: AudioNode, pan: number): AudioNode {
  if (!pan) return out;
  try {
    const p = c.createStereoPanner();
    p.pan.value = pan;
    p.connect(out);
    return p;
  } catch {
    return out;
  }
}

/**
 * v0.15.1 the Rhodes' stereo tremolo: one slow LFO swings the sound between a left and a right side (a Rhodes' own
 * vibrato), both into the output and the hall. Without a panner (old WebKit) the notes go straight to the output.
 */
function tremoloBus(c: AudioContext, out: AudioNode, verb: AudioNode | null): AudioNode {
  try {
    const inp = c.createGain();
    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.9;
    for (const side of [-1, 1]) {
      const g = c.createGain();
      g.gain.value = 0.72;
      const depth = c.createGain();
      depth.gain.value = 0.22 * side;
      lfo.connect(depth).connect(g.gain);
      const pan = c.createStereoPanner();
      pan.pan.value = 0.5 * side;
      inp.connect(g).connect(pan).connect(out);
      if (verb) pan.connect(verb);
    }
    lfo.start(c.currentTime);
    return inp;
  } catch {
    return out;
  }
}

/**
 * v0.15.1 the hall's impulse response (pure): two uncorrelated channels of noise dying away to −60 dB at `rt60` s, the
 * high frequencies first (a one-pole low-pass closing along the tail), after a short pre-delay; each channel carries
 * unit energy, so the wet share sets the hall's level.
 */
export function hallImpulse(rng: Rng, rate: number, sec = HALL.sec, rt60 = HALL.rt60, predelay = HALL.predelay): [Float32Array, Float32Array] {
  const n = Math.max(2, Math.floor(rate * sec));
  const pre = Math.min(n - 1, Math.floor(rate * predelay));
  const k = Math.log(1000) / (rt60 * rate);
  const chs: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const d of chs) {
    let y = 0;
    let sq = 0;
    for (let i = pre; i < n; i++) {
      const u = (i - pre) / (n - pre);
      // The low-pass opens to about 5 kHz at the start and closes to about 1 kHz by the end (at 44.1 kHz).
      const a = (0.7 - 0.55 * u) * Math.min(1, 44100 / rate);
      y += a * (rng() * 2 - 1 - y);
      const v = y * Math.exp(-k * (i - pre)) * Math.min(1, (i - pre) / (0.004 * rate));
      d[i] = v;
      sq += v * v;
    }
    const g = 1 / Math.max(1e-9, Math.sqrt(sq));
    for (let i = pre; i < n; i++) d[i] *= g;
  }
  return chs;
}

/** v0.15.1 the hall reverb: a convolver on `hallImpulse`, returning its send (null without a convolver). */
function hallVerb(c: AudioContext, out: AudioNode, rng: Rng): GainNode | null {
  try {
    const v = c.createConvolver();
    const ir = hallImpulse(rng, c.sampleRate);
    const b = c.createBuffer(2, ir[0].length, c.sampleRate);
    b.getChannelData(0).set(ir[0]);
    b.getChannelData(1).set(ir[1]);
    v.buffer = b;
    const send = c.createGain();
    const wet = c.createGain();
    wet.gain.value = HALL.wet;
    send.connect(v).connect(wet).connect(out);
    return send;
  } catch {
    return null;
  }
}

/** v0.15.1 the hum's sample rate and length (s): it loops seamlessly (the filters run round the loop twice). */
export const HUM = { rate: 22050, sec: 8 };

/**
 * v0.15.1 the hall's hum, made once (pure): low noise (air handling and a building's rumble heard across a departure
 * lounge), a touch of 100 Hz mains hum far under it, softened twice round the loop and brought to RMS 0.25. Never a voice.
 */
export function humSamples(rng: Rng, rate = HUM.rate, sec = HUM.sec): Float32Array {
  const n = Math.floor(rate * sec);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1;
  // Two one-pole low-passes (about 120 Hz at 22.05 kHz) run round the loop twice, the first time only to settle their
  // state, so the loop point is as smooth as any other sample; then a slow breathing of the level (two periods per
  // loop, so it wraps) and the faint mains hum.
  const a = 0.034 * Math.min(1, 22050 / rate);
  let y1 = 0;
  let y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      y1 += a * (d[i] - y1);
      y2 += a * (y1 - y2);
      if (pass) d[i] = y2;
    }
  }
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * i) / n;
    d[i] = d[i] * (0.85 + 0.15 * Math.sin(2 * ph)) + 0.02 * Math.sin((2 * Math.PI * 100 * i) / rate) * (0.7 + 0.3 * Math.sin(3 * ph));
  }
  let sq = 0;
  for (let i = 0; i < n; i++) sq += d[i] * d[i];
  const k = 0.25 / Math.max(1e-9, Math.sqrt(sq / n));
  for (let i = 0; i < n; i++) d[i] *= k;
  return d;
}

function humBuffer(c: AudioContext, rng: Rng): AudioBuffer {
  const d = humSamples(rng);
  let b: AudioBuffer;
  try {
    b = c.createBuffer(1, d.length, HUM.rate);
  } catch {
    b = c.createBuffer(1, d.length, c.sampleRate);
  }
  b.getChannelData(0).set(d);
  return b;
}
