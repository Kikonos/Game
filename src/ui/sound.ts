// Tiny synthesized UI sound set (no audio files, so it works offline).

/** v0.7.1 'crewShortage': the red crew-shortage stage (the 'alert' pattern until the v0.9 sound set). */
export type SoundName = 'click' | 'tick' | 'success' | 'error' | 'alert' | 'cash' | 'levelup' | 'whoosh' | 'crewShortage';

class Sound {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private volume = 0.5;

  configure(enabled: boolean, volume: number) {
    this.enabled = enabled;
    this.volume = volume;
  }

  private audio(): AudioContext | null {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur);
    const peak = gain * this.volume;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + dur + 0.05);
  }

  play(name: SoundName) {
    const ctx = this.audio();
    if (!ctx || this.volume <= 0) return;
    switch (name) {
      case 'click': this.tone(880, 0, 0.05, 'sine', 0.05); break;
      case 'tick': this.tone(1200, 0, 0.04, 'triangle', 0.04); break;
      case 'success': this.tone(660, 0, 0.12, 'sine', 0.08); this.tone(990, 0.07, 0.18, 'sine', 0.07); break;
      case 'error': this.tone(220, 0, 0.18, 'triangle', 0.08, 160); break;
      case 'alert': this.tone(740, 0, 0.14, 'sine', 0.07); this.tone(740, 0.18, 0.14, 'sine', 0.07); break;
      case 'crewShortage': this.tone(740, 0, 0.14, 'sine', 0.07); this.tone(740, 0.18, 0.14, 'sine', 0.07); this.tone(620, 0.4, 0.2, 'sine', 0.06); break;
      case 'cash': this.tone(1320, 0, 0.08, 'triangle', 0.035); this.tone(1760, 0.06, 0.12, 'triangle', 0.03); break;
      case 'levelup':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, i * 0.09, 0.3, 'sine', 0.07));
        break;
      case 'whoosh': this.tone(300, 0, 0.5, 'sawtooth', 0.015, 1200); break;
    }
  }
}

export const sound = new Sound();
