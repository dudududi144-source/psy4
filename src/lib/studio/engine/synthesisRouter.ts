/**
 * Synthesis Router (Task A1) — produces a CONCRETE PLAN of adjustments the
 * engine should make to match the reference's effects chain + timbre.
 *
 * The router is a PURE function: it takes the reference's DetectedEffects,
 * the reference's TimbreFingerprint, our engine's current TimbreFingerprint,
 * and the active worldId, and returns a SynthesisPlan with:
 *
 *   - leadMode / padMode / arpMode: which synthesis mode each melodic
 *     track should run (fm / supersaw / wavetable / classic).
 *   - bassMode: always 'classic' (bass synthesis is stable).
 *   - effects: per-track effect routing (reverb/delay/chorus/phaser/
 *     distortion send levels) for each track group.
 *   - adjustments: an array of concrete parameter changes (param, track,
 *     currentValue, targetValue, reason) the engine should apply.
 *
 * Routing logic:
 *
 *   - HEAVY REVERB (>0.4) → boost reverb sends on LEAD/PAD/ARP.
 *   - LONG REVERB DECAY (>2s) → boost reverb sends even more.
 *   - DELAY (>0.3) → enable delay sends on LEAD/ARP at the detected time.
 *   - CHORUS (>0.3) → enable chorus on LEAD/PAD, set rate to match.
 *   - DISTORTION (>0.3) → enable distortion send on LEAD/BASS.
 *   - COMPRESSION (>0.5) → push master compressor ratio.
 *   - FILTER CUTOFF detected → set LEAD cutoff override.
 *   - HAAS effect → set Haas delay/mix on LEAD/PAD.
 *   - FM TIMBRE → switch LEAD to FM mode, set FM depth.
 *   - SUPERSAW TIMBRE → switch LEAD to supersaw, set saw spread.
 *   - WAVETABLE TIMBRE → switch PAD to wavetable, set wt position.
 *
 * World-aware: the router respects the active world's character. Dark worlds
 * (dark-psy, forest) lean toward FM; bright worlds (morning-psy, cosmic)
 * lean toward supersaw; acid worlds (goa, acid-psy) always keep FM on lead.
 *
 * Pure function — never throws, all inputs guarded.
 *
 * @module synthesisRouter
 */

import type { DetectedEffects } from './effectsDetector';
import type { TimbreFingerprint } from './timbreFingerprint';

// ─── Public types ──────────────────────────────────────────────────────────

export type SynthesisMode = 'fm' | 'supersaw' | 'wavetable' | 'classic';

export interface SynthesisPlan {
  leadMode: SynthesisMode;
  padMode: SynthesisMode;
  arpMode: SynthesisMode;
  bassMode: SynthesisMode; // always 'classic'
  // Per-track effect routing (send levels 0..1).
  effects: {
    reverb: { lead: number; pad: number; arp: number; bass: number; drums: number };
    delay: { lead: number; pad: number; arp: number; bass: number; drums: number };
    chorus: { lead: number; pad: number; arp: number };
    phaser: { lead: number; arp: number };
    distortion: { lead: number; bass: number };
  };
  // Adjustments to make (concrete parameter changes for the engine).
  adjustments: SynthesisAdjustment[];
}

export interface SynthesisAdjustment {
  param: string;
  track: number;
  currentValue: number;
  targetValue: number;
  reason: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

const clamp01 = (v: number): number => {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
};

const clamp = (v: number, lo: number, hi: number): number => {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : (v > hi ? hi : v);
};

// Track index constants (mirror psy4EngineV2).
const TRACK = {
  KICK: 0, SNARE: 1, HATS: 2, PERC: 3, BASS: 4, LEAD: 5, PAD: 6, ARP: 7,
};

/**
 * Infer the LEAD synthesis mode from the reference timbre + world.
 *
 *   - FM if inharmonicity > 0.3 (metallic) OR acid world.
 *   - Supersaw if HNR > 0.5 + wide stereo + bright centroid.
 *   - Wavetable if evolving signature (mid inharmonicity + moderate HNR).
 *   - Classic as fallback.
 */
function inferLeadMode(refTimbre: TimbreFingerprint, worldId: string): SynthesisMode {
  const acid = worldId === 'goa' || worldId === 'acid-psy';
  // Acid worlds ALWAYS use FM on lead — that's the genre.
  if (acid) return 'fm';

  if (refTimbre.inharmonicity > 0.3) return 'fm';
  if (refTimbre.oddEvenRatio > 1.4) return 'fm'; // square-like, often FM

  // Supersaw: bright + clean + rich spread.
  if (refTimbre.spectralCentroid > 2000 && refTimbre.spectralSpread > 2500) return 'supersaw';
  if (refTimbre.signature.includes('saw-') || refTimbre.signature.includes('rich')) return 'supersaw';

  // Wavetable: evolving / mid character.
  if (refTimbre.signature.includes('wt-')) return 'wavetable';
  if (refTimbre.spectralFlux > 0.5 && refTimbre.inharmonicity > 0.1) return 'wavetable';

  return 'classic';
}

/**
 * Infer the PAD synthesis mode. Pads benefit from supersaw (thick) or
 * wavetable (evolving). FM is too aggressive for pads.
 */
function inferPadMode(refTimbre: TimbreFingerprint, _worldId: string): SynthesisMode {
  // Evolving flux → wavetable pad.
  if (refTimbre.spectralFlux > 0.4) return 'wavetable';
  // Wide + clean → supersaw pad.
  if (refTimbre.spectralSpread > 2000) return 'supersaw';
  return 'classic';
}

/**
 * Infer the ARP synthesis mode. Arps work well with wavetable (morphing)
 * or FM (squelchy). Supersaw arps are common in morning psy.
 */
function inferArpMode(refTimbre: TimbreFingerprint, worldId: string): SynthesisMode {
  if (worldId === 'goa' || worldId === 'acid-psy') return 'fm';
  if (refTimbre.inharmonicity > 0.25) return 'fm';
  if (refTimbre.spectralFlux > 0.4) return 'wavetable';
  if (worldId === 'morning-psy' || worldId === 'cosmic') return 'supersaw';
  return 'classic';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Compute a SynthesisPlan from the reference's detected effects + timbre
 * (and our current timbre, so we know what we're starting from).
 *
 * @param referenceEffects  Effects chain detected on the radio reference.
 * @param referenceTimbre   Timbre fingerprint of the reference.
 * @param currentTimbre     Our engine's current timbre (may be a stale
 *                          snapshot — used for the adjustments list).
 * @param worldId           Active world id (used for world-aware routing).
 * @returns A SynthesisPlan with mode assignments, effect routing, and a
 *          list of concrete adjustments.
 */
export function routeSynthesis(
  referenceEffects: DetectedEffects,
  referenceTimbre: TimbreFingerprint,
  currentTimbre: TimbreFingerprint | null,
  worldId: string,
): SynthesisPlan {
  const adjustments: SynthesisAdjustment[] = [];

  // ── Mode selection ──
  const leadMode = inferLeadMode(referenceTimbre, worldId);
  const padMode = inferPadMode(referenceTimbre, worldId);
  const arpMode = inferArpMode(referenceTimbre, worldId);

  // ── Reverb sends (per-track) ──
  // Base levels scaled by the reference's reverb amount + decay.
  const reverbAmount = clamp01(referenceEffects.reverbAmount);
  const reverbDecay = clamp(referenceEffects.reverbDecay, 0, 8);
  // Longer decay = more send (each extra second of decay adds ~0.05 to sends).
  const decayBoost = clamp(reverbDecay / 4 * 0.1, 0, 0.15);
  const reverbLead = clamp(0.18 + reverbAmount * 0.25 + decayBoost, 0, 0.55);
  const reverbPad = clamp(0.22 + reverbAmount * 0.30 + decayBoost, 0, 0.6);
  const reverbArp = clamp(0.15 + reverbAmount * 0.20 + decayBoost, 0, 0.5);
  const reverbBass = clamp01(0.04 + reverbAmount * 0.04); // bass stays mostly dry
  const reverbDrums = clamp01(0.10 + reverbAmount * 0.15);
  if (reverbAmount > 0.3) {
    adjustments.push({
      param: 'sendReverb',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: reverbLead,
      reason: `Heavy reverb detected (${(reverbAmount * 100).toFixed(0)}%, ${reverbDecay.toFixed(1)}s decay) → boost lead reverb send`,
    });
    adjustments.push({
      param: 'sendReverb',
      track: TRACK.PAD,
      currentValue: 0,
      targetValue: reverbPad,
      reason: `Long reverb tail (${reverbDecay.toFixed(1)}s) → wash the pad`,
    });
  }

  // ── Delay sends ──
  const delayAmount = clamp01(referenceEffects.delayAmount);
  const delayTime = clamp(referenceEffects.delayTime, 0, 2000);
  const delayFb = clamp01(referenceEffects.delayFeedback);
  // If we know the delay time, route to lead + arp (typical delay targets).
  const delayLead = clamp(0.10 + delayAmount * 0.20, 0, 0.4);
  const delayArp = clamp(0.12 + delayAmount * 0.22, 0, 0.45);
  const delayPad = clamp01(0.06 + delayAmount * 0.10);
  const delayBass = clamp01(0.02 + delayAmount * 0.02);
  const delayDrums = clamp01(0.04 + delayAmount * 0.06);
  if (delayAmount > 0.25) {
    adjustments.push({
      param: 'sendDelay',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: delayLead,
      reason: delayTime > 0
        ? `Delay detected (${delayTime.toFixed(0)} ms, feedback ${(delayFb * 100).toFixed(0)}%) → echo lead`
        : `Delay-like character → boost lead delay send`,
    });
    if (delayTime > 0) {
      adjustments.push({
        param: 'delayTimeMs',
        track: TRACK.LEAD,
        currentValue: 0,
        targetValue: delayTime,
        reason: `Match reference delay time (${delayTime.toFixed(0)} ms)`,
      });
    }
  }

  // ── Chorus sends ──
  const chorusAmount = clamp01(referenceEffects.chorusAmount);
  const chorusRate = clamp(referenceEffects.chorusRate, 0, 10);
  const chorusLead = clamp(0.15 + chorusAmount * 0.30, 0, 0.5);
  const chorusPad = clamp(0.10 + chorusAmount * 0.20, 0, 0.4);
  const chorusArp = clamp(0.12 + chorusAmount * 0.25, 0, 0.45);
  if (chorusAmount > 0.25) {
    adjustments.push({
      param: 'sendChorus',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: chorusLead,
      reason: `Chorus/modulation detected (${(chorusAmount * 100).toFixed(0)}% depth${chorusRate > 0 ? `, ${chorusRate.toFixed(1)} Hz` : ''}) → thicken lead`,
    });
    if (chorusRate > 0) {
      adjustments.push({
        param: 'chorusRate',
        track: -1, // -1 = global send effect
        currentValue: 0,
        targetValue: chorusRate,
        reason: `Match reference chorus rate (${chorusRate.toFixed(1)} Hz)`,
      });
    }
  }

  // ── Phaser sends ──
  // Phaser is rarer; we trigger it when the reference has notable stereo
  // modulation that's NOT chorus (lower rate, wider sweep).
  const phaserAmount = chorusAmount > 0.3 && referenceEffects.stereoWidth > 0.5 ? 0.2 : 0;
  const phaserLead = clamp01(phaserAmount);
  const phaserArp = clamp01(phaserAmount * 1.2);
  if (phaserAmount > 0.05) {
    adjustments.push({
      param: 'sendPhaser',
      track: TRACK.ARP,
      currentValue: 0,
      targetValue: phaserArp,
      reason: `Wide modulated stereo → add phaser to arp`,
    });
  }

  // ── Distortion sends ──
  const distortionAmount = clamp01(referenceEffects.distortionAmount);
  const distLead = clamp(0.10 + distortionAmount * 0.20, 0, 0.4);
  const distBass = clamp(0.05 + distortionAmount * 0.15, 0, 0.3);
  if (distortionAmount > 0.25) {
    adjustments.push({
      param: 'sendDistortion',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: distLead,
      reason: `Distortion/saturation detected (${(distortionAmount * 100).toFixed(0)}%) → drive lead`,
    });
    adjustments.push({
      param: 'sendDistortion',
      track: TRACK.BASS,
      currentValue: 0,
      targetValue: distBass,
      reason: `Saturated reference → warm up bass`,
    });
  }

  // ── Filter cutoff ──
  if (referenceEffects.filterCutoff > 200) {
    adjustments.push({
      param: 'cutoff',
      track: TRACK.LEAD,
      currentValue: currentTimbre?.spectralCentroid ?? 0,
      targetValue: referenceEffects.filterCutoff,
      reason: `Reference filter detected at ${referenceEffects.filterCutoff.toFixed(0)} Hz → set lead cutoff`,
    });
  }

  // ── Haas / stereo width ──
  if (referenceEffects.haasEffect) {
    adjustments.push({
      param: 'haasMix',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: 0.7,
      reason: `Haas / double-track detected (correlation < 0.4) → widen lead`,
    });
    adjustments.push({
      param: 'haasDelayMs',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: 14,
      reason: `Match Haas delay (~14 ms typical)`,
    });
  }

  // ── Compression ──
  if (referenceEffects.compressionAmount > 0.5) {
    adjustments.push({
      param: 'midRatio',
      track: -1, // master
      currentValue: 3,
      targetValue: clamp(3 + referenceEffects.compressionAmount * 2, 3, 5),
      reason: `Heavy compression detected (${(referenceEffects.compressionAmount * 100).toFixed(0)}%) → push master mid ratio`,
    });
  }

  // ── Mode-specific adjustments ──
  if (leadMode === 'fm') {
    // FM depth derived from inharmonicity (0.3 → 2, 1.0 → 8).
    const fmDepth = clamp(2 + referenceTimbre.inharmonicity * (8 / 0.7), 1, 8);
    adjustments.push({
      param: 'fmDepth',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: fmDepth,
      reason: `FM character detected (inharmonicity ${(referenceTimbre.inharmonicity * 100).toFixed(0)}%) → FM depth ${fmDepth.toFixed(1)}`,
    });
  }
  if (leadMode === 'supersaw') {
    const spread = clamp01(0.3 + referenceTimbre.spectralSpread / 6000);
    adjustments.push({
      param: 'sawSpread',
      track: TRACK.LEAD,
      currentValue: 0,
      targetValue: spread,
      reason: `Supersaw character (spread ${referenceTimbre.spectralSpread.toFixed(0)} Hz) → detune spread ${spread.toFixed(2)}`,
    });
  }
  if (padMode === 'wavetable') {
    const wtPos = clamp01(referenceTimbre.spectralCentroid / 6000);
    adjustments.push({
      param: 'wtPosition',
      track: TRACK.PAD,
      currentValue: 0,
      targetValue: wtPos,
      reason: `Evolving pad character (flux ${(referenceTimbre.spectralFlux * 100).toFixed(0)}%) → wavetable position ${wtPos.toFixed(2)}`,
    });
  }

  return {
    leadMode,
    padMode,
    arpMode,
    bassMode: 'classic',
    effects: {
      reverb: { lead: reverbLead, pad: reverbPad, arp: reverbArp, bass: reverbBass, drums: reverbDrums },
      delay: { lead: delayLead, pad: delayPad, arp: delayArp, bass: delayBass, drums: delayDrums },
      chorus: { lead: chorusLead, pad: chorusPad, arp: chorusArp },
      phaser: { lead: phaserLead, arp: phaserArp },
      distortion: { lead: distLead, bass: distBass },
    },
    adjustments,
  };
}
