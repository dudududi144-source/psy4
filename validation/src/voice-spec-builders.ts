/**
 * PSY4 Vertical Validation — VoiceSpec Builders (B/C/D/E)
 *
 * These 4 builders produce VoiceSpecification[] from the SAME CompositionEvent[].
 * The ONLY difference between variants is how the VoiceSpec is built:
 *
 * B (raw):       minimal VoiceSpec — codebook defaults, NO performance realization, NO acoustic targets
 * C (codebook):  same as B but routed through CompositionEvent → VoiceSpec (proves the path)
 * D (+perf):     B/C + performance realization (velocity/microtiming/articulation from Foundation intent)
 * E (+acoustic): D + acoustic compilation (BPM-aware envelopes, masking, voiceGroup)
 *
 * Per LOCKED PROTOCOL (PRE-RENDER SNAPSHOT):
 * - Same input guarantee: B and C receive the SAME Foundation output.
 * - C must NOT receive musical information B didn't.
 * - GAPs (articulation, microtiming for MotifNote, dynamics curve, timbral character)
 *   are NOT filled. D/E use flat defaults where info is missing, and log the GAP.
 */

import type { CompositionEvent, VoiceSpecification, SynthGraph, VoicePerformance, AcousticTargets, MixPlacement } from './types.ts';
import { mtof } from './audio-utils.ts';

// ─── Role derivation (PSY4 computation — NOT a Foundation field) ────────────
type Role = 'kick' | 'bass' | 'lead' | 'hat' | 'perc';

function deriveRole(ev: CompositionEvent): Role {
  if (ev.trackName === 'kick') return 'kick';
  if (ev.trackName === 'hat') return 'hat';
  if (ev.trackName === 'perc') return 'perc';
  if (ev.sourceMaterial === 'bass-pattern') return 'bass';
  if (ev.sourceMaterial === 'motif') return 'lead';
  return 'perc';
}

// ─── Codebook: default SynthGraph per role ──────────────────────────────────
// (Simple if/else rules — NOT a pipeline stage, NOT architecture)

function defaultKickGraph(): SynthGraph {
  return {
    oscillators: [{ type: 'sine', detune: 0, role: 'carrier', gain: 0.6 }],
    filter: { type: 'lowpass', cutoff: 200, Q: 1, envAmount: 0, envDecay: 0.1 },
    amplifier: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 },
    saturation: { amount: 0.2, character: 0.3 },
    stereo: { width: 0, motion: 0 },
  };
}

function defaultBassGraph(): SynthGraph {
  return {
    oscillators: [{ type: 'sawtooth', detune: 0, role: 'carrier', gain: 0.25 }],
    filter: { type: 'lowpass', cutoff: 700, Q: 6, envAmount: 0.75, envDecay: 0.025 },
    amplifier: { attack: 0.001, decay: 0.065, sustain: 0, release: 0.005 },
    saturation: { amount: 0.3, character: 0.4 },
    stereo: { width: 0, motion: 0 },
  };
}

function defaultLeadGraph(): SynthGraph {
  // FM lead (metallic goa/acid character)
  return {
    oscillators: [
      { type: 'sine', detune: 0, role: 'carrier', gain: 0.3 },
      { type: 'sine', ratio: 2, detune: 0, role: 'modulator', gain: 0.5 },
    ],
    filter: { type: 'lowpass', cutoff: 2400, Q: 8, envAmount: 0.6, envDecay: 0.08 },
    amplifier: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.2 },
    fmDepth: 800,
    lfo: { rate: 0.5, depth: 0.3, target: 'filterCutoff' },
    saturation: { amount: 0.25, character: 0.5 },
    stereo: { width: 0.5, motion: 0.2 },
  };
}

function defaultHatGraph(): SynthGraph {
  return {
    oscillators: [],
    filter: { type: 'highpass', cutoff: 7000, Q: 0.7, envAmount: 0, envDecay: 0.05 },
    amplifier: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
    saturation: { amount: 0, character: 0 },
    stereo: { width: 0.3, motion: 0 },
  };
}

// ─── Default mix placement per role ─────────────────────────────────────────
function defaultMix(role: Role): MixPlacement {
  switch (role) {
    case 'kick': return { channel: 'kick', gain: 0.8, pan: 0, sends: { reverb: 0.05, delay: 0 } };
    case 'bass': return { channel: 'bass', gain: 0.7, pan: 0, sends: { reverb: 0.02, delay: 0 } };
    case 'lead': return { channel: 'lead', gain: 0.5, pan: 0, sends: { reverb: 0.25, delay: 0.2 } };
    case 'hat': return { channel: 'hat', gain: 0.4, pan: 0.2, sends: { reverb: 0.15, delay: 0.1 } };
    case 'perc': return { channel: 'perc', gain: 0.5, pan: -0.2, sends: { reverb: 0.2, delay: 0.05 } };
  }
}

// ─── Default acoustic targets (flat — no BPM-aware computation) ─────────────
function defaultAcousticTargets(freq: number, role: Role): AcousticTargets {
  const register = freq < 80 ? 'sub' : freq < 250 ? 'bass' : freq < 500 ? 'low-mid' : freq < 2000 ? 'mid' : freq < 4000 ? 'high-mid' : freq < 8000 ? 'high' : 'air';
  const env = role === 'kick' ? { attack: 0.001, decay: 0.1, sustain: 0, release: 0.05 }
    : role === 'bass' ? { attack: 0.001, decay: 0.065, sustain: 0, release: 0.005 }
    : role === 'lead' ? { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.2 }
    : { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 };
  return {
    fundamentalHz: freq,
    register,
    envelope: env,
    stereoPolicy: role === 'kick' || role === 'bass' ? 'mono' : role === 'lead' ? 'wide' : 'narrow',
  };
}

// ─── Default performance (flat — no realization) ────────────────────────────
function defaultPerformance(ev: CompositionEvent, bpm: number): VoicePerformance {
  const stepDur = (60 / bpm) / 4;
  return {
    frequency: mtof(ev.midi),
    velocity: ev.velocity, // raw — no realization
    durationSec: ev.durationSteps * stepDur, // raw
    microTimingSec: 0, // flat — Foundation micros not always present (GAP)
    articulation: 'normal', // flat — Foundation has no articulation field (GAP)
  };
}

// ─── Realized performance (D — uses Foundation actual fields) ───────────────
function realizedPerformance(ev: CompositionEvent, bpm: number): VoicePerformance {
  const stepDur = (60 / bpm) / 4;
  const role = deriveRole(ev);
  const tension = ev.barContext.tension;

  // Velocity realization: scale by tension + role conventions
  // (uses Foundation's actual velocity + tension — NO invented info)
  let velScale = 1.0;
  if (role === 'kick') velScale = 0.85 + tension * 0.15; // kicks louder in high tension
  else if (role === 'bass') velScale = 0.8 + tension * 0.2;
  else if (role === 'lead') velScale = 0.6 + tension * 0.4; // lead more dynamic
  else if (role === 'hat') velScale = 0.7 + tension * 0.1;
  const velocity = Math.min(1, ev.velocity * velScale);

  // Microtiming: GAP for MotifNote (no micros field). For drum-pattern tracks,
  // Foundation's RhythmPattern.micros would be used if present. In our generator,
  // we didn't populate micros, so this is a GAP — flat 0.
  // LOG GAP: microtiming not available for motif notes.
  const microTimingSec = 0; // GAP

  // Articulation: GAP — Foundation has no articulation field.
  // Derive from velocity threshold (PSY4 computation, not Foundation info).
  const articulation: VoicePerformance['articulation'] =
    ev.velocity > 0.85 ? 'accent' :
    ev.velocity < 0.4 ? 'staccato' :
    'normal';

  // Duration: realized from durationSteps × BPM × articulation factor
  let durFactor = 1.0;
  if (articulation === 'staccato') durFactor = 0.5;
  else if (articulation === 'accent') durFactor = 0.9;
  const durationSec = ev.durationSteps * stepDur * durFactor;

  return { frequency: mtof(ev.midi), velocity, durationSec, microTimingSec, articulation };
}

// ─── Compiled acoustic targets (E — BPM-aware + voiceGroup) ─────────────────
function compiledAcousticTargets(ev: CompositionEvent, role: Role, allEvents: CompositionEvent[]): AcousticTargets {
  const freq = mtof(ev.midi);
  const bpm = ev.barContext.bpm;
  const stepDur = (60 / bpm) / 4;
  const sixteenth = stepDur; // 1/16 note in seconds

  // BPM-aware envelopes (computed from musical durations, not hardcoded ms)
  const env = role === 'kick'
    ? { attack: 0.001, decay: sixteenth * 1.0, sustain: 0, release: 0.05 } // kick decays in 1/16
    : role === 'bass'
    ? { attack: 0.001, decay: sixteenth * 0.65, sustain: 0, release: 0.005 } // bass decays in ~2/3 of 1/16
    : role === 'lead'
    ? { attack: 0.005, decay: sixteenth * 1.5, sustain: 0.4, release: sixteenth * 2 } // lead longer
    : { attack: 0.001, decay: sixteenth * 0.4, sustain: 0, release: 0.01 };

  // VoiceGroup: find kick+bass on same step (for masking budget)
  // PSY4 derivation from step alignment — NOT a Foundation field
  const sameStepEvents = allEvents.filter(e => e.step === ev.step);
  const hasKick = sameStepEvents.some(e => deriveRole(e) === 'kick');
  const hasBass = sameStepEvents.some(e => deriveRole(e) === 'bass');
  const groupConstraints = (role === 'kick' && hasBass) || (role === 'bass' && hasKick)
    ? {
        vsPartnerRole: role === 'kick' ? 'bass' : 'kick',
        frequencySeparation: 15, // Hz gap target
        phaseOffset: 90, // degrees — avoid cancellation
        maskingBudget: 0.2, // allowed spectral overlap
        sidechainRecovery: sixteenth * 0.5,
      }
    : undefined;

  return {
    fundamentalHz: freq,
    register: freq < 80 ? 'sub' : freq < 250 ? 'bass' : freq < 500 ? 'low-mid' : freq < 2000 ? 'mid' : freq < 4000 ? 'high-mid' : freq < 8000 ? 'high' : 'air',
    envelope: env,
    groupConstraints,
    stereoPolicy: role === 'kick' || role === 'bass' ? 'mono' : role === 'lead' ? 'wide' : 'narrow',
  };
}

// ─── Builder: Variant B (raw — minimal VoiceSpec, codebook defaults) ────────
// B receives the same Foundation output. It builds a VoiceSpec with codebook
// defaults but NO performance realization and NO acoustic compilation.
// The VoiceSpec is essentially a passthrough — proving the path works.

export function buildVariantB(events: CompositionEvent[], bpm: number): VoiceSpecification[] {
  return events.map(ev => {
    const role = deriveRole(ev);
    const graph = role === 'kick' ? defaultKickGraph()
      : role === 'bass' ? defaultBassGraph()
      : role === 'lead' ? defaultLeadGraph()
      : defaultHatGraph();
    return {
      source: {
        type: role === 'kick' || role === 'hat' ? 'sample' : 'synth',
        synthGraph: graph,
      },
      performance: defaultPerformance(ev, bpm), // flat
      acousticTargets: defaultAcousticTargets(mtof(ev.midi), role), // flat
      mix: defaultMix(role),
    };
  });
}

// ─── Builder: Variant C (codebook defaults, routed through CompositionEvent→VoiceSpec) ──
// C is IDENTICAL to B in terms of VoiceSpec content. The difference is that
// C's VoiceSpec is built from CompositionEvent (the validation contract path).
// Since B also builds from CompositionEvent (same input), C and B produce
// the SAME VoiceSpec. This is intentional — it isolates the path overhead.
//
// In practice, B and C use the same builder. The "path" difference is:
// - B: events consumed directly by renderer (raw)
// - C: events → CompositionEvent → VoiceSpec → renderer
//
// Since our events ARE already CompositionEvents (Foundation output is mapped
// to CompositionEvent in generate-units.ts), B and C use the same code path.
// The H2 hypothesis tests whether the CompositionEvent→VoiceSpec transformation
// adds value. If C ≈ B, the transformation is overhead.

export function buildVariantC(events: CompositionEvent[], bpm: number): VoiceSpecification[] {
  // Same as B — the "contract path" is the CompositionEvent→VoiceSpec mapping.
  // If this path adds overhead without value, H2 fails.
  return buildVariantB(events, bpm);
}

// ─── Builder: Variant D (B/C + performance realization) ────────────────────
export function buildVariantD(events: CompositionEvent[], bpm: number): VoiceSpecification[] {
  return events.map(ev => {
    const role = deriveRole(ev);
    const graph = role === 'kick' ? defaultKickGraph()
      : role === 'bass' ? defaultBassGraph()
      : role === 'lead' ? defaultLeadGraph()
      : defaultHatGraph();
    return {
      source: {
        type: role === 'kick' || role === 'hat' ? 'sample' : 'synth',
        synthGraph: graph,
      },
      performance: realizedPerformance(ev, bpm), // REALIZED
      acousticTargets: defaultAcousticTargets(mtof(ev.midi), role), // flat
      mix: defaultMix(role),
    };
  });
}

// ─── Builder: Variant E (D + acoustic compilation) ─────────────────────────
export function buildVariantE(events: CompositionEvent[], bpm: number): VoiceSpecification[] {
  return events.map(ev => {
    const role = deriveRole(ev);
    const graph = role === 'kick' ? defaultKickGraph()
      : role === 'bass' ? defaultBassGraph()
      : role === 'lead' ? defaultLeadGraph()
      : defaultHatGraph();
    return {
      source: {
        type: role === 'kick' || role === 'hat' ? 'sample' : 'synth',
        synthGraph: graph,
      },
      performance: realizedPerformance(ev, bpm), // REALIZED
      acousticTargets: compiledAcousticTargets(ev, role, events), // COMPILED (BPM-aware + voiceGroup)
      mix: defaultMix(role),
    };
  });
}
