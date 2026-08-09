/**
 * Per-Voice Analyzer — measures each voice's contribution separately.
 *
 * The old analyzer only measured the full mix, which meant bass/lead
 * parameter changes were invisible (kick dominated everything).
 *
 * This analyzer renders each voice ISOLATED, measures it, then compares
 * to the reference profile's per-band targets. This gives the optimizer
 * 5x more signal to learn from.
 *
 * Voices measured:
 *   - KICK: 40-120 Hz band
 *   - BASS: 80-250 Hz band
 *   - LEAD: 500-4000 Hz band
 *   - HAT/PERC: 4000-12000 Hz band
 *   - PAD/ATMOS: 200-800 Hz band
 */

import { render, SR } from '@/lib/studio/engine/forensic/offlineRenderer';
import { analyzeAudio } from '@/lib/studio/engine/forensic/audioAnalyzer';
import {
  V_KICK, V_BASS, V_LEAD, V_ACID, V_PAD,
  V_HAT, V_CLAP, V_PERC, V_SHAKER, V_TEXTURE,
} from '@/lib/studio/engine/forensic/voices';
import type { ReferenceProfile } from '@/lib/studio/engine/reference/referenceListener';

export interface VoiceAnalysis {
  voiceName: string;
  voiceId: number;
  lufs: number;
  rms: number;
  peak: number;
  centroidHz: number;
  decayMs: number;
  bandEnergy: number;  // energy in the voice's primary band
  active: boolean;     // did this voice produce audio?
}

export interface PerVoiceReport {
  kick: VoiceAnalysis;
  bass: VoiceAnalysis;
  lead: VoiceAnalysis;
  hat: VoiceAnalysis;
  pad: VoiceAnalysis;
  acid: VoiceAnalysis;
  totalScore: number;
  recommendations: string[];
}

const VOICE_CONFIGS = [
  { name: 'kick', id: V_KICK, bandLo: 40, bandHi: 120 },
  { name: 'bass', id: V_BASS, bandLo: 80, bandHi: 250 },
  { name: 'lead', id: V_LEAD, bandLo: 500, bandHi: 4000 },
  { name: 'hat', id: V_HAT, bandLo: 4000, bandHi: 12000 },
  { name: 'pad', id: V_PAD, bandLo: 200, bandHi: 800 },
  { name: 'acid', id: V_ACID, bandLo: 200, bandHi: 3000 },
];

/**
 * Analyze each voice in isolation.
 * @param seed Render seed
 * @param worldId World ID
 * @param duration Render duration
 * @param paramOverrides Parameter overrides
 */
export function analyzePerVoice(
  seed: number,
  worldId: string,
  duration: number,
  paramOverrides: Record<string, number> = {},
): PerVoiceReport {
  const results: Record<string, VoiceAnalysis> = {};

  for (const config of VOICE_CONFIGS) {
    try {
      const r = render(seed, worldId, duration, {
        paramOverrides,
        onlyVoices: [config.id],
      });
      const analysis = analyzeAudio(r.samplesL, r.samplesR, SR);

      // Check if voice produced audio
      const rms = analysis.dynamics.rms;
      const active = rms > 0.001;

      // Compute band energy for this voice's primary band
      const band = analysis.spectrum.bands.find(b => {
        const [lo, hi] = b.name.split('-').map(parseFloat);
        return lo >= config.bandLo * 0.8 && hi <= config.bandHi * 1.2;
      });

      results[config.name] = {
        voiceName: config.name,
        voiceId: config.id,
        lufs: analysis.dynamics.lufs,
        rms,
        peak: analysis.dynamics.peak,
        centroidHz: analysis.spectrum.centroidHz,
        decayMs: analysis.lowEnd.kickDecay * 1000, // approximate
        bandEnergy: band?.energy || 0,
        active,
      };
    } catch {
      results[config.name] = {
        voiceName: config.name,
        voiceId: config.id,
        lufs: -Infinity,
        rms: 0,
        peak: 0,
        centroidHz: 0,
        decayMs: 0,
        bandEnergy: 0,
        active: false,
      };
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];
  if (!results.kick.active) recommendations.push('Kick not audible — increase kick level');
  if (!results.bass.active) recommendations.push('Bass not audible — increase bass level');
  if (!results.lead.active) recommendations.push('Lead not audible — increase lead level');
  if (results.kick.active && results.bass.active) {
    const kickBassRatio = results.kick.rms / (results.bass.rms + 0.001);
    if (kickBassRatio > 5) recommendations.push(`Kick ${kickBassRatio.toFixed(1)}x louder than bass — reduce kick or boost bass`);
    if (kickBassRatio < 0.5) recommendations.push(`Bass ${(1/kickBassRatio).toFixed(1)}x louder than kick — boost kick or reduce bass`);
  }
  if (results.lead.active && results.lead.lufs < -25) {
    recommendations.push('Lead too quiet — increase lead level');
  }
  if (results.hat.active && results.hat.lufs < -30) {
    recommendations.push('Hats too quiet — increase hat level');
  }

  // Total score — based on how many voices are active and balanced
  let totalScore = 0;
  const activeCount = Object.values(results).filter(v => v.active).length;
  totalScore += (activeCount / 6) * 40; // 40 points for all voices active

  // Balance score — how close are kick/bass/lead levels?
  if (results.kick.active && results.bass.active && results.lead.active) {
    const levels = [results.kick.lufs, results.bass.lufs, results.lead.lufs];
    const maxLevel = Math.max(...levels);
    const minLevel = Math.min(...levels);
    const spread = maxLevel - minLevel;
    if (spread < 6) totalScore += 30; // well balanced
    else if (spread < 12) totalScore += 20;
    else if (spread < 20) totalScore += 10;
  }

  // Presence score — are all frequency bands covered?
  const bands = ['kick', 'bass', 'pad', 'lead', 'hat'];
  const coveredBands = bands.filter(b => results[b]?.active).length;
  totalScore += (coveredBands / 5) * 30;

  return {
    kick: results.kick,
    bass: results.bass,
    lead: results.lead,
    hat: results.hat,
    pad: results.pad,
    acid: results.acid,
    totalScore: Math.round(totalScore),
    recommendations,
  };
}

/**
 * Compare our per-voice analysis to the reference profile.
 * Returns per-voice scores that the optimizer can use.
 */
export function comparePerVoiceToReference(
  ourAnalysis: PerVoiceReport,
  referenceProfile: ReferenceProfile,
): {
  kickScore: number;
  bassScore: number;
  leadScore: number;
  spectralScore: number;
  totalScore: number;
  errors: { voice: string; metric: string; ourValue: number; refValue: number; error: number }[];
} {
  const errors: { voice: string; metric: string; ourValue: number; refValue: number; error: number }[] = [];

  // Kick comparison
  const refKickDecay = referenceProfile.kickDecayMs.mean;
  const ourKickDecay = ourAnalysis.kick.decayMs;
  const kickDecayError = ourKickDecay - refKickDecay;
  if (Math.abs(kickDecayError) > 10) {
    errors.push({
      voice: 'kick', metric: 'decay',
      ourValue: ourKickDecay, refValue: refKickDecay, error: kickDecayError,
    });
  }

  // Bass comparison
  const refSubEnergy = referenceProfile.subEnergy.mean;
  const ourBassEnergy = ourAnalysis.bass.bandEnergy;
  const bassEnergyError = ourBassEnergy - refSubEnergy;
  if (Math.abs(bassEnergyError) > 0.1) {
    errors.push({
      voice: 'bass', metric: 'energy',
      ourValue: ourBassEnergy, refValue: refSubEnergy, error: bassEnergyError,
    });
  }

  // Lead comparison
  const refCentroid = referenceProfile.spectralCentroid.mean;
  const ourLeadCentroid = ourAnalysis.lead.centroidHz;
  const leadCentroidError = ourLeadCentroid - refCentroid;
  if (Math.abs(leadCentroidError) > 200) {
    errors.push({
      voice: 'lead', metric: 'centroid',
      ourValue: ourLeadCentroid, refValue: refCentroid, error: leadCentroidError,
    });
  }

  // Scores (0-100 each)
  const kickScore = Math.max(0, 100 - Math.abs(kickDecayError) * 0.5);
  const bassScore = Math.max(0, 100 - Math.abs(bassEnergyError) * 100);
  const leadScore = Math.max(0, 100 - Math.abs(leadCentroidError) * 0.02);
  const spectralScore = ourAnalysis.totalScore;

  const totalScore = Math.round(
    kickScore * 0.25 + bassScore * 0.25 + leadScore * 0.25 + spectralScore * 0.25
  );

  return {
    kickScore: Math.round(kickScore),
    bassScore: Math.round(bassScore),
    leadScore: Math.round(leadScore),
    spectralScore: Math.round(spectralScore),
    totalScore,
    errors,
  };
}
