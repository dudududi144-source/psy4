/**
 * Forensic Offline Renderer — the deterministic render() function.
 *
 * render(seed, worldId, duration, options) => { samplesL, samplesR, events }
 *
 * This is the CRITICAL piece of the forensic infrastructure. It:
 *   1. Generates a musical timeline (events) from (seed, world)
 *   2. Renders events through the voice pool + bus/master/FX chain
 *   3. Returns stereo PCM as Float32Array
 *
 * DETERMINISM: Same seed + same world + same params => same output, always.
 * No Math.random(), no Date.now(), no performance.now(). Everything flows
 * from the seeded Rng.
 *
 * ISOMORPHIC: Runs in Node.js and browser. No Web Audio dependencies.
 *
 * ISOLATION: Supports rendering specific voices only (e.g., bass-only,
 * kick-only) for the bass isolation and kick/bass masking tests.
 */

import { Rng } from './prng';
import {
  KickVoice, BassVoice, LeadVoice, AcidVoice, PadVoice,
  HatVoice, ClapVoice, PercVoice, ShakerVoice, TextureVoice, FXVoice,
  V_KICK, V_BASS, V_LEAD, V_ACID, V_PAD,
  V_HAT, V_CLAP, V_PERC, V_SHAKER, V_TEXTURE,
  V_RISER, V_IMPACT, V_SWEEP, V_DOWNLIFTER,
  type BassParams, type LeadParams, type PadParams,
} from './voices';
import {
  BusProcessor, MasterChain, SchroederReverb, StereoDelay,
  type BusConfig,
} from './mixing';
import { FORENSIC_WORLDS, type Psy4World } from './worlds';
import {
  ARRANGEMENT, CHORD_PROGRESSIONS, mtof,
  buildSectionState, DEFAULT_FORENSIC_MACROS,
  type SectionState, type MusicEvent, type ForensicMacros,
} from './musicalGrammar';
import { SCALES, BASS_PATTERNS, scaleNote } from '../musicalGrammar';
import { SeededRng, LeadMotif, AcidPattern } from '../musicalGrammar';

export const SR = 44100;

export interface RenderOptions {
  macros?: Partial<ForensicMacros>;
  /** If set, only render these voice IDs (isolation mode). */
  onlyVoices?: number[];
  /** Override world params (for parameter validation). */
  paramOverrides?: Partial<Psy4World>;
  /** If true, skip reverb/delay (dry render for analysis). */
  dry?: boolean;
  /** Start time offset (seconds) — for rendering a section subset. */
  startTime?: number;
}

export interface RenderResult {
  samplesL: Float32Array;
  samplesR: Float32Array;
  sampleRate: number;
  duration: number;
  events: MusicEvent[];
  world: Psy4World;
  seed: number;
  options: RenderOptions;
}

// ─── Voice pool container ──────────────────────────────────────────────────

interface VoicePool {
  kick: KickVoice[];
  bass: BassVoice[];
  lead: LeadVoice[];
  acid: AcidVoice[];
  pad: PadVoice[];
  hat: HatVoice[];
  clap: ClapVoice[];
  perc: PercVoice[];
  shaker: ShakerVoice[];
  texture: TextureVoice[];
  fx: FXVoice[];
}

function createVoicePool(rng: Rng): VoicePool {
  return {
    kick: Array.from({ length: 8 }, () => new KickVoice(rng)),
    bass: Array.from({ length: 4 }, () => new BassVoice()),
    lead: Array.from({ length: 8 }, () => new LeadVoice(rng)),
    acid: Array.from({ length: 4 }, () => new AcidVoice()),
    pad: Array.from({ length: 4 }, () => new PadVoice()),
    hat: Array.from({ length: 8 }, () => new HatVoice(rng)),
    clap: Array.from({ length: 4 }, () => new ClapVoice(rng)),
    perc: Array.from({ length: 8 }, () => new PercVoice()),
    shaker: Array.from({ length: 4 }, () => new ShakerVoice(rng)),
    texture: Array.from({ length: 4 }, () => new TextureVoice(rng)),
    fx: Array.from({ length: 8 }, () => new FXVoice(rng)),
  };
}

function getFreeVoice<T extends { active: boolean }>(pool: T[]): T {
  for (const v of pool) {
    if (!v.active) return v;
  }
  return pool[0]; // voice stealing
}

// ─── Event generation (the musical brain) ──────────────────────────────────

/**
 * Generate the complete musical timeline for a render.
 * (Standalone port of the original psy4LiveEngine step() logic.)
 */
export function generateEvents(
  seed: number,
  world: Psy4World,
  duration: number,
  macros: ForensicMacros = DEFAULT_FORENSIC_MACROS,
): MusicEvent[] {
  const events: MusicEvent[] = [];
  const s16 = 60 / world.bpm / 4; // seconds per 16th note

  let sectionIdx = 0;
  let si = 0;       // step index within section
  let nextTime = 0; // absolute time of next step

  // Build first section
  let S = buildSectionState(
    ARRANGEMENT[0], seed, sectionIdx,
    world.root, world.scale, world.acid, world.bass,
  );

  const e = macros.energy;
  const psy = macros.psychedelia;
  const dens = macros.density;
  const sw = world.swing * macros.groove;

  while (nextTime < duration) {
    const t = nextTime;
    const sb = si % 16;           // step within bar
    const bar = Math.floor(si / 16);

    // ── Section automation ──
    const isPreDrop = S.label.includes('BUILD') && bar >= S.bars - 2;
    const isDropStart = S.bassOn && S.leadOn && bar === 0;
    const isPreTransition = bar === S.bars - 1;
    const isBuildClimax = S.label.includes('BUILD') && bar >= S.bars - 4;

    // Riser before drop
    if (isPreDrop && sb === 0) {
      events.push({ time: t, voice: V_RISER, note: 0, velocity: 0.3, duration: s16 * 32, param: 0 });
    }
    if (isBuildClimax && bar === S.bars - 4 && sb === 0) {
      events.push({ time: t, voice: V_SWEEP, note: 0, velocity: 0.2, duration: s16 * 16, param: 0 });
    }
    if (isDropStart && sb === 0) {
      events.push({ time: t, voice: V_IMPACT, note: 0, velocity: 0.4, duration: 0.5, param: 0 });
      events.push({ time: t + s16 * 2, voice: V_IMPACT, note: 0, velocity: 0.3, duration: 0.5, param: 0 });
    }
    if (!S.bassOn && bar === 0 && sb === 0) {
      events.push({ time: t, voice: V_SWEEP, note: 0, velocity: 0.2, duration: s16 * 32, param: 0 });
    }
    if (isPreTransition && sb === 12 && S.bassOn) {
      const sweepLen = S.label.includes('BUILD') ? s16 * 8 : s16 * 4;
      events.push({ time: t, voice: V_SWEEP, note: 0, velocity: 0.2, duration: sweepLen, param: 0 });
    }
    if (isDropStart && sb === 4) {
      events.push({ time: t, voice: V_DOWNLIFTER, note: 0, velocity: 0.2, duration: 0.1 + macros.energy * 0.05, param: 0 });
    }
    const hatsMuted = (S.label.includes('BUILD') && bar >= S.bars - 2) ||
                      (S.bassOn && S.leadOn && bar >= S.bars - 2 && S.label !== 'FINAL DROP');

    // ── PAD (chord progression, every 2 bars) ──
    if (sb === 0 && bar % 2 === 0) {
      const progs = CHORD_PROGRESSIONS[world.scale] || CHORD_PROGRESSIONS.minor;
      const chord = progs[(bar / 2) % progs.length];
      const padAmp = 0.12 * (0.5 + e * 0.5) * (!S.bassOn ? 1.5 : 0.8);
      // Play each chord tone
      for (const degree of chord) {
        const note = scaleNote(world.root - 12, world.scale, degree);
        events.push({ time: t, voice: V_PAD, note, velocity: padAmp, duration: s16 * 32, param: 0 });
      }
    }

    // ── TEXTURE ──
    if (sb === 0 && bar % 4 === 0 && S.bassOn || (sb === 0 && bar % 4 === 0 && S.leadOn)) {
      events.push({ time: t, voice: V_TEXTURE, note: 0, velocity: world.textureLevel * (0.5 + psy * 0.5), duration: s16 * 64, param: 0 });
    }
    if (sb === 0 && bar % 2 === 1 && (S.bassOn && S.leadOn)) {
      events.push({ time: t, voice: V_TEXTURE, note: 0, velocity: world.textureLevel * 0.4 * psy, duration: s16 * 32, param: 0 });
    }

    // ── KICK (4 on floor) ──
    if (sb % 4 === 0) {
      const isDownbeat = sb === 0;
      const kickVel = isDownbeat ? 0.5 + e * 0.05 : 0.42 + e * 0.08;
      events.push({ time: t, voice: V_KICK, note: 0, velocity: kickVel, duration: 0.3, param: 0 });
    }
    if (S.bassOn && S.leadOn && sb === 14 && S.rng.chance(0.3 * dens)) {
      events.push({ time: t, voice: V_KICK, note: 0, velocity: 0.15, duration: 0.2, param: 0 });
    }

    // ── BASS ──
    const isOff = sb % 2 === 1;
    const bt = isOff ? t + sw * s16 : t;
    const bassPatterns = BASS_PATTERNS[world.bass] || BASS_PATTERNS.off;
    const bassPatternRotIdx = (S.bassPatternIdx + Math.floor(bar / 4)) % bassPatterns.length;
    const bassPattern = bassPatterns[bassPatternRotIdx];
    const patternStep = Math.floor(sb / 2) % bassPattern.steps.length;
    let bassDegree = bassPattern.steps[patternStep];
    let bassAccent = bassPattern.accents[patternStep];

    if (bar % 2 === 1 && sb === 6 && S.rng.chance(0.4)) {
      bassDegree = S.rng.pick([2, 4, 7]);
      bassAccent = 0.6;
    }
    if (bar % 4 === 3 && sb === 14) {
      bassDegree = 7;
      bassAccent = 0.8;
    }

    let bassOn = bassDegree >= 0 && bassAccent > 0;
    if (world.bass === 'roll') bassOn = bassOn && (isOff || sb % 4 === 0);
    else if (world.bass === 'off') bassOn = bassOn && sb % 4 === 2;
    else if (world.bass === 'acid') bassOn = bassOn && (isOff || sb === 0);

    if (isPreDrop) bassOn = false;
    if (!S.bassOn) bassOn = false;

    if (bassOn) {
      const bassNote = scaleNote(world.root, world.scale, bassDegree);
      let bassVel = bassAccent * (0.35 + e * 0.15);
      let bassDur = s16 * 0.9;
      const isGhost = (bar % 2 === 1 && sb === 0 && S.rng.chance(0.3));
      if (isGhost) { bassVel = 0.2; bassDur = s16 * 0.4; }
      if (bar % 8 === 7 && sb === 0) {
        bassDur = s16 * 2.5;
        bassVel *= 1.1;
      }
      events.push({ time: bt, voice: V_BASS, note: bassNote, velocity: bassVel, duration: bassDur, param: world.acid ? 1 : 0 });
    }

    // ── ACID LINE ──
    if (world.acid && S.bassOn && S.leadOn && sb % 2 === 0 && S.rng.chance(0.5 * psy)) {
      if (S.acidPattern) {
        const acidNote = S.acidPattern.next();
        if (acidNote !== null) {
          events.push({ time: t, voice: V_ACID, note: acidNote, velocity: 0.15 + psy * 0.1, duration: s16 * 1.5, param: 0 });
        }
      }
    }

    // ── HATS ──
    if (!hatsMuted && world.hatPattern[sb] === 'x') {
      const beatPos = sb % 4;
      let hatVel: number;
      if (beatPos === 0) hatVel = 0.25;
      else if (beatPos === 2) hatVel = 0.18;
      else hatVel = 0.12;
      if (bar % 4 === 3) hatVel *= 1.2;
      hatVel *= (0.5 + dens * 0.5);
      events.push({ time: t + (sb % 4 === 2 ? sw * s16 : 0), voice: V_HAT, note: 0, velocity: hatVel, duration: 0.05, param: 0 });
    }
    if (!hatsMuted && world.hatPattern[sb] === '.' && sb % 2 === 0 && S.rng.chance(0.15 * dens) && S.bassOn) {
      events.push({ time: t, voice: V_HAT, note: 0, velocity: 0.04 + dens * 0.02, duration: 0.04, param: 0 });
    }

    // ── PERC ──
    if (world.percPattern[sb] === 'x' && S.rng.chance(S.percDensity * dens)) {
      events.push({ time: t, voice: V_PERC, note: 400 + S.rng.int(0, 200), velocity: 0.2, duration: 0.1, param: 0 });
    }

    // ── LEAD ──
    if (S.leadOn && S.leadMotif && sb % 2 === 0) {
      const result = S.leadMotif.nextNote(sb, bar, S.energy, S.rng);
      if (result) {
        events.push({ time: t, voice: V_LEAD, note: result.note, velocity: result.velocity * 0.5, duration: s16 * 1.5, param: 0 });
      }
    }

    // ── CLAP (on 2 and 4 in drops) ──
    if (S.bassOn && S.leadOn && (sb === 4 || sb === 12)) {
      events.push({ time: t, voice: V_CLAP, note: 0, velocity: 0.25, duration: 0.15, param: 0 });
    }

    // ── SHAKER (offbeat, in drops) ──
    if (S.bassOn && S.leadOn && sb % 2 === 1 && S.rng.chance(0.6)) {
      events.push({ time: t, voice: V_SHAKER, note: 0, velocity: 0.12, duration: 0.05, param: 0 });
    }

    // Advance step
    si++;
    nextTime += s16;
    if (si >= S.bars * 16) {
      sectionIdx++;
      const nextArr = ARRANGEMENT[sectionIdx % ARRANGEMENT.length];
      S = buildSectionState(
        nextArr, seed, sectionIdx,
        world.root, world.scale, world.acid, world.bass,
      );
      si = 0;
    }
  }

  return events;
}

// ─── Render (process events through DSP) ───────────────────────────────────

export function render(
  seed: number,
  worldId: string,
  duration: number,
  options: RenderOptions = {},
): RenderResult {
  const world: Psy4World = {
    ...FORENSIC_WORLDS[worldId],
    ...options.paramOverrides,
  };
  const macros = { ...DEFAULT_FORENSIC_MACROS, ...options.macros };
  const sr = SR;
  const totalSamples = Math.floor(duration * sr);

  // 1. Generate events
  const events = generateEvents(seed, world, duration, macros);

  // 2. Create voice pools (all deterministic)
  const poolRng = new Rng(seed ^ 0xDEAD);
  const pool = createVoicePool(poolRng);

  // 3. Create mixing infrastructure
  const drumConfig: Partial<BusConfig> = {
    hpFreq: 0, compThr: 0.5, compRatio: 3, compAtt: 0.002, compRel: 0.08,
    compMakeup: 1.4, drive: 1.4, gain: 1.0,
  };
  const bassConfig: Partial<BusConfig> = {
    hpFreq: 40, compThr: 0.4, compRatio: 2, compAtt: 0.005, compRel: 0.12,
    compMakeup: 1.2, drive: 1.2, gain: 1.0,
  };
  const musicConfig: Partial<BusConfig> = {
    hpFreq: 80, compThr: 0.45, compRatio: 2, compAtt: 0.01, compRel: 0.15,
    compMakeup: 1.1, drive: 1.15, gain: 1.0,
  };
  const atmosConfig: Partial<BusConfig> = {
    hpFreq: 60, compThr: 0, drive: 1.0, gain: 1.0,
  };
  const fxConfig: Partial<BusConfig> = {
    hpFreq: 40, compThr: 0.35, compRatio: 2.5, compAtt: 0.003, compRel: 0.1,
    compMakeup: 1.2, drive: 1.2, gain: 1.0,
  };

  const drumProcL = new BusProcessor(drumConfig);
  const drumProcR = new BusProcessor(drumConfig);
  const bassProcL = new BusProcessor(bassConfig);
  const bassProcR = new BusProcessor(bassConfig);
  const musicProcL = new BusProcessor(musicConfig);
  const musicProcR = new BusProcessor(musicConfig);
  const atmosProcL = new BusProcessor(atmosConfig);
  const atmosProcR = new BusProcessor(atmosConfig);
  const fxProcL = new BusProcessor(fxConfig);
  const fxProcR = new BusProcessor(fxConfig);

  const masterL = new MasterChain();
  const masterR = new MasterChain();

  const reverb = new SchroederReverb();
  const delay = new StereoDelay();

  // Section-aware FX sends
  let reverbSends = [0.08, 0.02, 0.25, 0.40, 0.30];
  let delaySends = [0.05, 0.0, 0.20, 0.10, 0.15];

  // Bus gains — REBALANCED + now optimizable via level parameters
  // Base gains provide good balance; level params scale them
  const baseBusGains = [0.45, 1.8, 1.5, 0.85, 0.65];
  const busGains = [
    baseBusGains[0] * (world.kickLevel ?? 1.0),   // drum bus (kick, hat, clap, perc)
    baseBusGains[1] * (world.bassLevel ?? 1.0),   // bass bus
    baseBusGains[2] * (world.leadLevel ?? 1.0),   // music bus (lead, acid)
    baseBusGains[3],                                // atmos bus (pad, texture)
    baseBusGains[4],                                // fx bus
  ];
  const masterLevel = world.masterLevel ?? 0.85;

  // Sidechain
  let duckEnv = 1.0;
  const duckDepth = world.duck;
  // FIX: was 0.08 (80ms) — too fast, bass plays on offbeat (117ms after kick)
  // so the duck recovered before the bass played, making duck a DEAD parameter.
  // 250ms release keeps the bass ducked through the offbeat.
  const duckRelease = 0.25;

  // Lead Haas delay buffer
  const leadDelayBuf = new Float32Array(18);
  let leadDelayIdx = 0;

  // Only-voices filter (for isolation rendering)
  const onlyVoices = options.onlyVoices ? new Set(options.onlyVoices) : null;

  // 4. Process events: sort by time, trigger voices
  //    We'll process events inline during sample rendering
  let eventIdx = 0;
  const sortedEvents = [...events].sort((a, b) => a.time - b.time);

  function triggerVoice(ev: MusicEvent): void {
    if (onlyVoices && !onlyVoices.has(ev.voice)) return;
    const sr = SR;
    const wp = world;
    const mc = macros;

    switch (ev.voice) {
      case V_KICK: {
        const v = getFreeVoice(pool.kick);
        v.trigger(0, ev.velocity, wp.kickFundamental, wp.kickDecay, sr);
        // Trigger sidechain
        duckEnv = 1 - duckDepth * 0.7 * (0.5 + mc.aggression * 0.5);
        break;
      }
      case V_BASS: {
        const v = getFreeVoice(pool.bass);
        const acid = ev.param >= 0.5;
        const freq = mtof(ev.note);
        const params: BassParams = {
          cutoffStart: Math.min(2000, wp.bassCutoff * 4),
          cutoffEnd: wp.bassCutoff,
          resonance: wp.bassResonance,
        };
        v.trigger(0, freq, ev.duration, ev.velocity, acid, sr, params);
        break;
      }
      case V_LEAD: {
        const v = getFreeVoice(pool.lead);
        const freq = mtof(ev.note);
        const params: LeadParams = {
          cutoff: wp.leadCutoff * (0.7 + mc.brightness * 0.6),
          detune: wp.leadDetune * (0.5 + mc.psychedelia),
          resonance: 2 + mc.psychedelia * 3,
          lfoRate: 0.5 + mc.psychedelia * 3,
          lfoDepth: mc.psychedelia * 0.3,
        };
        v.trigger(0, freq, ev.duration, ev.velocity, sr, params);
        break;
      }
      case V_ACID: {
        const v = getFreeVoice(pool.acid);
        const freq = mtof(ev.note);
        v.trigger(0, freq, ev.duration, ev.velocity, sr);
        break;
      }
      case V_PAD: {
        const v = getFreeVoice(pool.pad);
        const freq = mtof(ev.note);
        const params: PadParams = {
          cutoff: wp.padCutoff, attack: 0.5, detune: 7, evolveRate: 0.1,
        };
        v.trigger(0, freq, ev.duration, ev.velocity, sr, params);
        break;
      }
      case V_HAT: {
        const v = getFreeVoice(pool.hat);
        v.trigger(0, false, ev.velocity, sr);
        break;
      }
      case V_CLAP: {
        const v = getFreeVoice(pool.clap);
        v.trigger(0, ev.velocity, sr);
        break;
      }
      case V_PERC: {
        const v = getFreeVoice(pool.perc);
        v.trigger(0, ev.note, ev.velocity, sr);
        break;
      }
      case V_SHAKER: {
        const v = getFreeVoice(pool.shaker);
        v.trigger(0, ev.velocity, sr);
        break;
      }
      case V_TEXTURE: {
        const v = getFreeVoice(pool.texture);
        v.trigger(0, ev.duration, ev.velocity, world.textureType, sr);
        break;
      }
      case V_RISER: case V_IMPACT: case V_SWEEP: case V_DOWNLIFTER: {
        const v = getFreeVoice(pool.fx);
        v.trigger(ev.voice, 0, ev.duration, ev.velocity, sr);
        break;
      }
    }
  }

  // 5. Render sample by sample
  const samplesL = new Float32Array(totalSamples);
  const samplesR = new Float32Array(totalSamples);
  const dt = 1 / sr;

  for (let i = 0; i < totalSamples; i++) {
    const currentTime = i / sr;

    // Trigger any events that are due
    while (eventIdx < sortedEvents.length && sortedEvents[eventIdx].time <= currentTime) {
      triggerVoice(sortedEvents[eventIdx]);
      eventIdx++;
    }

    // Sidechain recovery
    if (duckEnv < 1) {
      duckEnv += (1 - duckEnv) * (dt / duckRelease);
    }

    // Mix voices into buses
    let drumBusL = 0, drumBusR = 0;
    let bassBusL = 0, bassBusR = 0;
    let musicBusL = 0, musicBusR = 0;
    let atmosBusL = 0, atmosBusR = 0;
    let fxBusL = 0, fxBusR = 0;

    // Kick → drum bus (mono)
    for (const v of pool.kick) {
      if (v.active) {
        const [s] = v.render();
        drumBusL += s; drumBusR += s;
      }
    }
    // Hat → drum bus (mono)
    for (const v of pool.hat) {
      if (v.active) {
        const [s] = v.render();
        drumBusL += s; drumBusR += s;
      }
    }
    // Clap → drum bus (mono)
    for (const v of pool.clap) {
      if (v.active) {
        const [s] = v.render();
        drumBusL += s; drumBusR += s;
      }
    }
    // Perc → drum bus (mono)
    for (const v of pool.perc) {
      if (v.active) {
        const [s] = v.render();
        drumBusL += s; drumBusR += s;
      }
    }
    // Shaker → drum bus (mono)
    for (const v of pool.shaker) {
      if (v.active) {
        const [s] = v.render();
        drumBusL += s; drumBusR += s;
      }
    }

    // Bass → bass bus (mono, sidechain ducked)
    for (const v of pool.bass) {
      if (v.active) {
        const [s] = v.render();
        const ducked = s * duckEnv;
        bassBusL += ducked; bassBusR += ducked;
      }
    }

    // Lead → music bus (Haas stereo)
    for (const v of pool.lead) {
      if (v.active) {
        const [s] = v.render();
        musicBusL += s;
        const delayed = leadDelayBuf[leadDelayIdx];
        leadDelayBuf[leadDelayIdx] = s;
        leadDelayIdx = (leadDelayIdx + 1) % 18;
        musicBusR += delayed;
      }
    }
    // Acid → music bus (mono)
    for (const v of pool.acid) {
      if (v.active) {
        const [s] = v.render();
        musicBusL += s; musicBusR += s;
      }
    }

    // Pad → atmos bus (stereo amplitude LFO)
    for (const v of pool.pad) {
      if (v.active) {
        const [s] = v.render();
        const lfo = Math.sin(i * 0.0008);
        atmosBusL += s * (0.85 + lfo * 0.15);
        atmosBusR += s * (0.85 - lfo * 0.15);
      }
    }
    // Texture → atmos bus (stereo pan)
    for (const v of pool.texture) {
      if (v.active) {
        const [s] = v.render();
        const pan = Math.sin(i * 0.0005);
        atmosBusL += s * (0.5 - pan * 0.3);
        atmosBusR += s * (0.5 + pan * 0.3);
      }
    }

    // FX → fx bus (mono)
    for (const v of pool.fx) {
      if (v.active) {
        const [s] = v.render();
        fxBusL += s; fxBusR += s;
      }
    }

    // Bus processing (separate L/R) — call .process on the BusProcessor
    // instances, NOT on the numeric accumulator variables.
    drumBusL = drumProcL.process(drumBusL, sr);
    drumBusR = drumProcR.process(drumBusR, sr);
    bassBusL = bassProcL.process(bassBusL, sr);
    bassBusR = bassProcR.process(bassBusR, sr);
    musicBusL = musicProcL.process(musicBusL, sr);
    musicBusR = musicProcR.process(musicBusR, sr);
    atmosBusL = atmosProcL.process(atmosBusL, sr);
    atmosBusR = atmosProcR.process(atmosBusR, sr);
    fxBusL = fxProcL.process(fxBusL, sr);
    fxBusR = fxProcR.process(fxBusR, sr);

    // Sum buses
    let mixL = drumBusL * busGains[0] + bassBusL * busGains[1] + musicBusL * busGains[2] + atmosBusL * busGains[3] + fxBusL * busGains[4];
    let mixR = drumBusR * busGains[0] + bassBusR * busGains[1] + musicBusR * busGains[2] + atmosBusR * busGains[3] + fxBusR * busGains[4];

    // FX sends
    if (!options.dry) {
      const reverbInput = (drumBusL + drumBusR) * 0.5 * reverbSends[0]
                        + (bassBusL + bassBusR) * 0.5 * reverbSends[1]
                        + (musicBusL + musicBusR) * 0.5 * reverbSends[2]
                        + (atmosBusL + atmosBusR) * 0.5 * reverbSends[3]
                        + (fxBusL + fxBusR) * 0.5 * reverbSends[4];
      const [revL, revR] = reverb.process(reverbInput, sr);

      const delayInputL = drumBusL * delaySends[0] + bassBusL * delaySends[1] + musicBusL * delaySends[2] + atmosBusL * delaySends[3] + fxBusL * delaySends[4];
      const delayInputR = drumBusR * delaySends[0] + bassBusR * delaySends[1] + musicBusR * delaySends[2] + atmosBusR * delaySends[3] + fxBusR * delaySends[4];
      const [delL, delR] = delay.process(delayInputL, delayInputR, sr);

      mixL += revL + delL;
      mixR += revR + delR;
    }

    // Guard against NaN/Infinity from feedback loops (reverb, delay, filter resonance)
    if (!isFinite(mixL)) mixL = 0;
    if (!isFinite(mixR)) mixR = 0;

    // Apply master level (optimizable)
    mixL *= masterLevel;
    mixR *= masterLevel;

    // Master chain (separate L/R)
    mixL = masterL.process(mixL, sr);
    mixR = masterR.process(mixR, sr);

    // Final safety clamp
    samplesL[i] = isFinite(mixL) ? Math.max(-1, Math.min(1, mixL)) : 0;
    samplesR[i] = isFinite(mixR) ? Math.max(-1, Math.min(1, mixR)) : 0;
  }

  return {
    samplesL,
    samplesR,
    sampleRate: sr,
    duration,
    events,
    world,
    seed,
    options,
  };
}

// ─── WAV encoding (for downloads / API responses) ──────────────────────────

export function encodeWav(samplesL: Float32Array, samplesR: Float32Array, sr: number): ArrayBuffer {
  const numSamples = samplesL.length;
  const buffer = new ArrayBuffer(44 + numSamples * 4);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 4, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);    // PCM
  view.setUint16(22, 2, true);    // stereo
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 4, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const l = Math.max(-1, Math.min(1, samplesL[i]));
    const r = Math.max(-1, Math.min(1, samplesR[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }

  return buffer;
}

// ─── Mono downmix ──────────────────────────────────────────────────────────

export function downmixToMono(samplesL: Float32Array, samplesR: Float32Array): Float32Array {
  const n = samplesL.length;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (samplesL[i] + samplesR[i]) * 0.5;
  }
  return mono;
}
