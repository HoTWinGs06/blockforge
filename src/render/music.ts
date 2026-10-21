/**
 * BlockForge — background music.
 *
 * ORIGINALITY: the bed is SYNTHESISED with WebAudio at runtime. A few
 * detuned oscillators through one slowly swept lowpass, plus a soft band of
 * filtered noise. No audio file is committed to this repository, nothing
 * here is copied, traced or approximated from an existing game's music, and
 * there is no licence to audit: there is no file.
 *
 * The parameters (root note, chord, filter range, noise colour) come from
 * the engine's seeded PRNG, so the music is derived from the world seed
 * like everything else, and the bed evolves continuously instead of
 * repeating a bar.
 *
 * THE GRAPH IS A CONTINUOUS GENERATOR: the oscillators and the noise source
 * run for the whole session and are never restarted, so there is no loop
 * boundary and therefore no seam, and crossing a chunk boundary cannot
 * interrupt the stream. The one looping element, the noise buffer, is
 * bridged end-to-start so its wrap is continuous too.
 *
 * The AudioContext is created lazily, inside the title screen's click
 * handler, because browsers refuse to start audio before a user gesture -
 * and creating one outside a gesture logs an autoplay warning.
 */

import { createRng } from "../core/index.js";
import { WORLD_SEED } from "./engineBridge.js";

/** The bus level. The bed sits well under the sound effects. */
const BED_LEVEL = 0.12;

/** The level of the noise layer under the pad. */
const NOISE_LEVEL = 0.05;

/** How long the noise buffer is before it repeats, in seconds. */
const NOISE_SECONDS = 4;

/** The one-pole coefficient that turns white noise into a soft band. */
const NOISE_SMOOTHING = 0.12;

/** Low notes the pad can root itself on. */
const ROOTS: readonly number[] = [110, 123.47, 146.83, 164.81, 196];

/** The context and the voices, once the bed is running. */
let context: AudioContext | null = null;
let voices: AudioScheduledSourceNode[] = [];
let running = false;

/** True while the bed is playing. */
export function isMusicPlaying(): boolean {
  return running;
}

/**
 * Build a noise buffer that loops without a seam.
 *
 * The noise is smoothed first, so it is continuous sample to sample, and
 * the ends are then bridged onto each other, so the wrap from the last
 * sample back to the first is continuous as well. Without that the loop
 * point is a click.
 */
function buildSeamlessNoise(ctx: AudioContext, seed: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let lcg = seed >>> 0;
  let smoothed = 0;
  for (let i = 0; i < frames; i++) {
    lcg = (lcg * 1664525 + 1013904223) >>> 0;
    const white = (lcg / 4294967296) * 2 - 1;
    smoothed += NOISE_SMOOTHING * (white - smoothed);
    data[i] = smoothed;
  }

  // Bridge the ends: subtract the straight line between the first and the
  // last sample, so the buffer ends where it starts.
  const first = data[0] ?? 0;
  const last = data[frames - 1] ?? 0;
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1);
    data[i] = (data[i] ?? 0) - (first + (last - first) * t);
  }

  // Normalise, so the level does not depend on the smoothing.
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const value = Math.abs(data[i] ?? 0);
    if (value > peak) {
      peak = value;
    }
  }
  if (peak > 0) {
    for (let i = 0; i < frames; i++) {
      data[i] = ((data[i] ?? 0) / peak) * 0.6;
    }
  }

  return buffer;
}

/**
 * Start the background bed.
 *
 * Call this from a user gesture - the title screen's click - so the browser
 * allows the audio to start. Calling it twice does nothing the second time:
 * the bed is one continuous stream for the whole session.
 */
export function startMusic(seed: number = WORLD_SEED): void {
  if (running) {
    return;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    // No audio on this machine: the game still runs.
    return;
  }

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return;
  }

  try {
    const rng = createRng(seed).fork("music");
    const root = ROOTS[Math.floor(rng.nextFloat() * ROOTS.length)] ?? 110;

    // The bus fades in, so the bed never slams in on the click.
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.linearRampToValueAtTime(BED_LEVEL, ctx.currentTime + 4);
    master.connect(ctx.destination);

    // The pad: three voices through one lowpass.
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500 + rng.nextFloat() * 400;
    filter.Q.value = 1.1;
    filter.connect(master);

    const pad = ctx.createGain();
    pad.gain.value = 0.5;
    pad.connect(filter);

    const sounding: AudioScheduledSourceNode[] = [];
    const chord: readonly (readonly [number, OscillatorType, number])[] = [
      [1, "triangle", 0.5],
      [1.5, "sine", 0.25],
      [2, "sine", 0.18],
    ];
    for (const [multiple, type, level] of chord) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = root * multiple;
      osc.detune.value = (rng.nextFloat() - 0.5) * 8;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(pad);
      osc.start();
      sounding.push(osc);
    }

    // A slow sweep across the filter, so the pad breathes.
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.03 + rng.nextFloat() * 0.05;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 120 + rng.nextFloat() * 220;
    sweep.connect(sweepDepth);
    sweepDepth.connect(filter.frequency);
    sweep.start();
    sounding.push(sweep);

    // The noise layer: a soft band of air under the pad.
    const noise = ctx.createBufferSource();
    noise.buffer = buildSeamlessNoise(ctx, rng.nextUint32());
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "lowpass";
    noiseFilter.frequency.value = 300 + rng.nextFloat() * 500;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = NOISE_LEVEL;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();
    sounding.push(noise);

    // A slow breath on the noise, so it never sits still.
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.02 + rng.nextFloat() * 0.04;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.03;
    breath.connect(breathDepth);
    breathDepth.connect(noiseGain.gain);
    breath.start();
    sounding.push(breath);

    context = ctx;
    voices = sounding;
    running = true;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        /* the browser refused to start; the game carries on without music */
      });
    }
  } catch {
    // A machine that cannot make the sound still gets a game.
    void ctx.close().catch(() => {
      /* nothing to do */
    });
  }
}

/** Stop the bed and release the audio context. */
export function stopMusic(): void {
  for (const voice of voices) {
    try {
      voice.stop();
    } catch {
      /* the voice was already stopped */
    }
  }
  voices = [];
  if (context) {
    void context.close().catch(() => {
      /* the context was already closed */
    });
  }
  context = null;
  running = false;
}

/**
 * Arm the bed to start on the title screen's click.
 *
 * The title screen's own click handler already reaches the sound board;
 * this listener puts the music on the same gesture, which is the first
 * user interaction of the session and the only moment a browser will let
 * an AudioContext start.
 *
 * The listener lives on the document and checks that the click landed
 * inside the title screen, so the music starts on the TITLE-SCREEN click
 * and not on some later click in the world.
 */
function armMusicOnTitleClick(): void {
  if (typeof document === "undefined") {
    return;
  }
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("#blockforge-title") !== null) {
        startMusic();
      }
    },
    { capture: true },
  );
}

// The render barrel is imported by the game before the title screen is
// built, so arming here is what puts the music on the first click.
armMusicOnTitleClick();
