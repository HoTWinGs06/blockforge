/**
 * BlockForge — synthesised sound.
 *
 * ORIGINALITY: every sound is SYNTHESISED with WebAudio at runtime. No audio
 * file is committed to this repository, and nothing here is copied, traced, or
 * approximated from an existing game's audio. The timbres below are BlockForge's
 * own: short filtered noise bursts and simple oscillator stabs.
 *
 * The AudioContext is created lazily on the first user gesture, because
 * browsers refuse to start audio before one.
 */

export type SoundName =
  | "step"
  | "break"
  | "place"
  | "deny"
  | "click"
  | "splash";

interface ToneSpec {
  readonly type: OscillatorType;
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly gain: number;
}

interface NoiseSpec {
  readonly duration: number;
  readonly gain: number;
  readonly filterFrom: number;
  readonly filterTo: number;
  readonly q: number;
}

/** BlockForge's own sound design. Deterministic - no randomness anywhere. */
const TONES: Readonly<Record<SoundName, ToneSpec | null>> = {
  step: { type: "triangle", from: 165, to: 128, duration: 0.07, gain: 0.05 },
  break: { type: "square", from: 240, to: 92, duration: 0.11, gain: 0.06 },
  place: { type: "sine", from: 320, to: 188, duration: 0.1, gain: 0.07 },
  deny: { type: "sawtooth", from: 118, to: 96, duration: 0.14, gain: 0.05 },
  click: { type: "sine", from: 880, to: 660, duration: 0.045, gain: 0.045 },
  splash: null,
};

const NOISE: Readonly<Record<SoundName, NoiseSpec | null>> = {
  step: null,
  break: { duration: 0.13, gain: 0.05, filterFrom: 1500, filterTo: 320, q: 1.1 },
  place: { duration: 0.07, gain: 0.035, filterFrom: 900, filterTo: 260, q: 0.9 },
  deny: null,
  click: null,
  splash: { duration: 0.28, gain: 0.05, filterFrom: 2600, filterTo: 420, q: 0.7 },
};

/** Plays BlockForge's synthesised sound effects. */
export class SoundBoard {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  /** Create the context on the first user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.context) {
      if (this.context.state === "suspended") {
        void this.context.resume();
      }
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      return;
    }
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.context.destination);
  }

  /** Play a sound by name. No-ops if the context was never unlocked. */
  play(name: SoundName): void {
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) {
      return;
    }
    const tone = TONES[name];
    const noise = NOISE[name];
    if (tone) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(tone.from, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, tone.to),
        ctx.currentTime + tone.duration,
      );
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(tone.gain, ctx.currentTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + tone.duration);
      osc.connect(gain).connect(master);
      osc.start();
      osc.stop(ctx.currentTime + tone.duration + 0.02);
    }
    if (noise) {
      // A short deterministic noise burst: a fixed-length pseudo-random buffer
      // generated from a simple LCG so it sounds identical every time.
      const frames = Math.floor(ctx.sampleRate * noise.duration);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let seed = 0x2f6e2b1 ^ name.length * 2654435761;
      for (let i = 0; i < frames; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = noise.q;
      filter.frequency.setValueAtTime(noise.filterFrom, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(40, noise.filterTo),
        ctx.currentTime + noise.duration,
      );
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(noise.gain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + noise.duration);
      src.connect(filter).connect(gain).connect(master);
      src.start();
    }
  }

  /** Release the audio context. */
  dispose(): void {
    if (this.context) {
      void this.context.close();
      this.context = null;
      this.master = null;
    }
  }
}
