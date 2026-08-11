import { AUDIO } from '../config/content';

/**
 * All sound is synthesized with the Web Audio API — no audio files, no network.
 * The context is created lazily on the first user gesture (iOS requirement).
 */
export class AudioFX {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceNodes: AudioNode[] = [];
  private ambienceGain: GainNode | null = null;
  private enabled = true;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? AUDIO.masterVolume : 0, this.ctx.currentTime, 0.05);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? AUDIO.masterVolume : 0;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    // iOS Safari can leave the context in the non-standard 'interrupted'
    // state after a phone call / Siri — treat anything not running (except
    // 'closed') as resumable, or audio dies for the rest of the session.
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  // -- helpers --------------------------------------------------------------

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private env(target: AudioNode, t0: number, peak: number, attack: number, decay: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    g.connect(target);
    return g;
  }

  private osc(
    type: OscillatorType,
    freq: number,
    t0: number,
    dur: number,
    dest: AudioNode,
    slideTo?: number
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    o.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this._noise) {
      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }
  private _noise: AudioBuffer | null = null;

  private noise(
    t0: number,
    dur: number,
    dest: AudioNode,
    filterType: BiquadFilterType,
    freq: number,
    freqEnd?: number
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    src.connect(f);
    f.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  private ready(): boolean {
    return !!(this.ctx && this.master && this.enabled);
  }

  // -- one-shots ------------------------------------------------------------

  click(): void {
    if (!this.ready()) return;
    const t = this.now();
    const g = this.env(this.master!, t, 0.25, 0.004, 0.07);
    this.osc('square', 740, t, 0.06, g, 620);
  }

  pickup(step: number): void {
    if (!this.ready()) return;
    const t = this.now();
    const semis = [0, 2, 4, 7, 9, 12, 14, 16][step % 8];
    const f = 660 * Math.pow(2, semis / 12);
    const g = this.env(this.master!, t, 0.3, 0.004, 0.16);
    this.osc('triangle', f, t, 0.16, g);
    const g2 = this.env(this.master!, t + 0.01, 0.12, 0.004, 0.12);
    this.osc('sine', f * 2, t + 0.01, 0.1, g2);
  }

  jump(): void {
    if (!this.ready()) return;
    const t = this.now();
    const g = this.env(this.master!, t, 0.22, 0.01, 0.16);
    this.osc('sine', 200, t, 0.16, g, 380);
    const gn = this.env(this.master!, t, 0.1, 0.01, 0.12);
    this.noise(t, 0.12, gn, 'highpass', 900, 2400);
  }

  land(): void {
    if (!this.ready()) return;
    const t = this.now();
    const g = this.env(this.master!, t, 0.3, 0.005, 0.1);
    this.osc('sine', 110, t, 0.09, g, 60);
    const gn = this.env(this.master!, t, 0.12, 0.005, 0.07);
    this.noise(t, 0.07, gn, 'lowpass', 900, 300);
  }

  slide(): void {
    if (!this.ready()) return;
    const t = this.now();
    const gn = this.env(this.master!, t, 0.2, 0.02, 0.3);
    this.noise(t, 0.32, gn, 'bandpass', 700, 260);
  }

  laneWhoosh(): void {
    if (!this.ready()) return;
    const t = this.now();
    const gn = this.env(this.master!, t, 0.1, 0.015, 0.1);
    this.noise(t, 0.11, gn, 'bandpass', 1400, 700);
  }

  crash(): void {
    if (!this.ready()) return;
    const t = this.now();
    const g = this.env(this.master!, t, 0.5, 0.005, 0.4);
    this.osc('sine', 90, t, 0.35, g, 38);
    const gn = this.env(this.master!, t, 0.4, 0.003, 0.3);
    this.noise(t, 0.3, gn, 'lowpass', 2200, 220);
    const g3 = this.env(this.master!, t + 0.02, 0.12, 0.005, 0.2);
    this.osc('square', 160, t + 0.02, 0.2, g3, 70);
  }

  record(): void {
    if (!this.ready()) return;
    const t = this.now();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const g = this.env(this.master!, t + i * 0.09, 0.22, 0.01, 0.22);
      this.osc('triangle', f, t + i * 0.09, 0.2, g);
    });
  }

  tramBell(): void {
    if (!this.ready()) return;
    const t = this.now();
    for (const [f, dt] of [
      [880, 0],
      [700, 0.14],
    ] as const) {
      const g = this.env(this.master!, t + dt, 0.14, 0.005, 0.35);
      this.osc('triangle', f, t + dt, 0.35, g);
      const g2 = this.env(this.master!, t + dt, 0.05, 0.005, 0.3);
      this.osc('sine', f * 2.7, t + dt, 0.3, g2);
    }
  }

  countTick(final: boolean): void {
    if (!this.ready()) return;
    const t = this.now();
    const g = this.env(this.master!, t, 0.2, 0.005, final ? 0.25 : 0.09);
    this.osc('triangle', final ? 880 : 620, t, final ? 0.25 : 0.08, g);
  }

  // -- ambience -------------------------------------------------------------

  startAmbience(): void {
    if (!this.ctx || !this.master || this.ambienceNodes.length) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(AUDIO.ambienceVolume, t + 2);
    gain.connect(this.master);

    // Soft wind: looped noise through a slowly wandering lowpass.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    src.connect(lp);
    lp.connect(gain);
    src.start(t);
    lfo.start(t);

    // A very quiet warm pad (open fifth).
    const padGain = ctx.createGain();
    padGain.gain.value = 0.16;
    padGain.connect(gain);
    for (const f of [110, 165.2]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (f % 7) * 2;
      o.connect(padGain);
      o.start(t);
      this.ambienceNodes.push(o);
    }

    this.ambienceGain = gain;
    this.ambienceNodes.push(src, lfo, lp, gain, padGain);
  }

  stopAmbience(): void {
    if (!this.ctx || !this.ambienceGain) return;
    const t = this.ctx.currentTime;
    this.ambienceGain.gain.setTargetAtTime(0.0001, t, 0.4);
    const nodes = this.ambienceNodes;
    this.ambienceNodes = [];
    this.ambienceGain = null;
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          (n as OscillatorNode).stop?.();
        } catch {
          /* already stopped */
        }
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    }, 1500);
  }
}
