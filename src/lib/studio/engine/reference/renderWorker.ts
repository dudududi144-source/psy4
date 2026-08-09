/**
 * Render Worker — runs the offline renderer in a separate thread.
 *
 * This solves the latency/freezing problem: when the ContinuousTrainer
 * renders an 8-second snippet, it takes ~2-3 seconds of CPU. If this
 * runs on the main thread, the live engine STOPS PLAYING during render.
 *
 * By moving rendering to a Web Worker, the main thread stays free
 * for audio scheduling and UI updates.
 */

/// <reference lib="webworker" />

import { render, SR } from '../forensic/offlineRenderer';
import { analyzeAudio } from '../forensic/audioAnalyzer';
import { analyzePerVoice, comparePerVoiceToReference } from './perVoiceAnalyzer';
import { computeReferenceScore } from './referenceScore';
import { getWorldDNA } from './worldDNA';
import { createParameterRegistry, applyChanges, registryToOverrides, adjustParameter, type ParameterChange } from './parameterRegistry';
import { FORENSIC_WORLDS } from '../forensic/worlds';
import type { ReferenceProfile, ReferenceMetrics } from './referenceListener';

export interface RenderRequest {
  type: 'render';
  id: number;
  seed: number;
  worldId: string;
  duration: number;
  paramOverrides: Record<string, number>;
}

export interface AnalyzeRequest {
  type: 'analyze';
  id: number;
  samplesL: Float32Array;
  samplesR: Float32Array;
}

export interface TrainRequest {
  type: 'train';
  id: number;
  seed: number;
  worldId: string;
  duration: number;
  currentParams: Record<string, number>;
  referenceProfile: ReferenceProfile;
  maxChangesPerIteration: number;
}

export type WorkerRequest = RenderRequest | AnalyzeRequest | TrainRequest;

export interface RenderResponse {
  type: 'render';
  id: number;
  samplesL: Float32Array;
  samplesR: Float32Array;
  events: any[];
  duration: number;
}

export interface AnalyzeResponse {
  type: 'analyze';
  id: number;
  metrics: ReferenceMetrics;
  score: number;
  perVoice?: any;
}

export interface TrainResponse {
  type: 'train';
  id: number;
  oldScore: number;
  newScore: number;
  changes: ParameterChange[];
  accepted: boolean;
  perVoiceScores?: { kick: number; bass: number; lead: number; spectral: number };
  voiceAnalysis?: any;
}

export type WorkerResponse = RenderResponse | AnalyzeResponse | TrainResponse;

function analysisToMetrics(analysis: ReturnType<typeof analyzeAudio>, worldId: string): ReferenceMetrics {
  const sp = analysis.spectrum;
  const d = analysis.dynamics;
  const le = analysis.lowEnd;
  const tr = analysis.transients;
  const dur = analysis.duration || 1;
  return {
    bpm: FORENSIC_WORLDS[worldId]?.bpm || 142,
    bpmConfidence: 0.9,
    rms: d.rms, peak: d.peak, lufs: d.lufs, crestFactor: d.crest,
    subEnergy: le.subRms,
    lowEnergy: le.kickRms + le.bassRms,
    midEnergy: sp.bands.find(b => b.name === '500-2k')?.energy || 0,
    highEnergy: sp.bands.find(b => b.name === '2k-8k')?.energy || 0,
    airEnergy: sp.bands.find(b => b.name === '8k-20k')?.energy || 0,
    spectralCentroid: sp.centroidHz,
    spectralFlatness: sp.flatness,
    spectralRolloff: sp.rolloff,
    transientDensity: tr.count / dur,
    kickDensity: tr.count / dur * 0.3,
    hatDensity: tr.count / dur * 0.4,
    percussionDensity: tr.count / dur,
    stereoWidth: 0.35,
    kickDecayMs: le.kickDecay * 1000,
    bassDecayMs: le.bassDecay * 1000,
    rhythmicRegularity: tr.consistency,
    repetitionScore: 0.5,
    energy: Math.min(1, d.rms * 3),
    overallConfidence: 0.8,
    timestamp: Date.now(),
    sourceStream: 'self',
  };
}

// Track tried changes (persists across train requests)
const triedChanges = new Set<string>();
let currentRegistry: any[] | null = null;
let bestScore = 0;
let bestParams: Record<string, number> = {};

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === 'render') {
    try {
      const result = render(req.seed, req.worldId, req.duration, {
        paramOverrides: req.paramOverrides,
      });
      const response: RenderResponse = {
        type: 'render',
        id: req.id,
        samplesL: result.samplesL,
        samplesR: result.samplesR,
        events: result.events,
        duration: result.duration,
      };
      (self as any).postMessage(response, [result.samplesL.buffer, result.samplesR.buffer]);
    } catch (err) {
      (self as any).postMessage({
        type: 'render',
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (req.type === 'analyze') {
    try {
      const analysis = analyzeAudio(req.samplesL, req.samplesR, SR);
      const response: AnalyzeResponse = {
        type: 'analyze',
        id: req.id,
        metrics: analysisToMetrics(analysis, 'dark-psy'), // worldId passed if needed
        score: 0, // computed by caller
      };
      (self as any).postMessage(response);
    } catch (err) {
      (self as any).postMessage({
        type: 'analyze',
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (req.type === 'train') {
    try {
      const { seed, worldId, duration, currentParams, referenceProfile, maxChangesPerIteration } = req;
      const dna = getWorldDNA(worldId);
      if (!dna) {
        (self as any).postMessage({ type: 'train', id: req.id, error: 'No DNA' });
        return;
      }

      // Initialize registry if needed
      if (!currentRegistry) {
        currentRegistry = createParameterRegistry({
          kickDecay: dna.kickDecayTarget,
          kickFundamental: dna.kickFundamentalTarget,
          bassCutoff: dna.bassCutoffTarget,
          bassResonance: dna.bassResonanceTarget,
          leadCutoff: dna.leadCutoffTarget,
          leadDetune: dna.leadDetuneTarget,
          padCutoff: 1200,
          duck: 0.4,
          ...currentParams,
        });
      }

      const overrides = registryToOverrides(currentRegistry);

      // Render current
      const currentRender = render(seed, worldId, duration, { paramOverrides: overrides });
      const currentAnalysis = analyzeAudio(currentRender.samplesL, currentRender.samplesR, SR);
      const currentMetrics = analysisToMetrics(currentAnalysis, worldId);
      const scoreResult = computeReferenceScore(currentMetrics, referenceProfile, dna.bpmTarget);

      // Per-voice analysis
      let perVoiceComparison: any = null;
      let perVoiceScores: any = undefined;
      let voiceAnalysis: any = undefined;
      try {
        const perVoiceReport = analyzePerVoice(seed, worldId, duration, overrides);
        perVoiceComparison = comparePerVoiceToReference(perVoiceReport, referenceProfile);
        perVoiceScores = {
          kick: perVoiceComparison.kickScore,
          bass: perVoiceComparison.bassScore,
          lead: perVoiceComparison.leadScore,
          spectral: perVoiceComparison.spectralScore,
        };
        voiceAnalysis = {
          kick: { lufs: perVoiceReport.kick.lufs, decayMs: perVoiceReport.kick.decayMs, active: perVoiceReport.kick.active },
          bass: { lufs: perVoiceReport.bass.lufs, bandEnergy: perVoiceReport.bass.bandEnergy, active: perVoiceReport.bass.active },
          lead: { lufs: perVoiceReport.lead.lufs, centroidHz: perVoiceReport.lead.centroidHz, active: perVoiceReport.lead.active },
          hat: { lufs: perVoiceReport.hat.lufs, active: perVoiceReport.hat.active },
        };
      } catch {}

      const oldScore = perVoiceComparison
        ? Math.round(scoreResult.total * 0.6 + perVoiceComparison.totalScore * 0.4)
        : scoreResult.total;

      // Propose changes
      const changes: ParameterChange[] = [];
      const usedParams = new Set<string>();

      const isTried = (name: string, dir: number) => triedChanges.has(`${name}:${dir > 0 ? '+' : '-'}`);

      // Use per-voice errors if available, else full-mix problems
      const errorSource = perVoiceComparison && perVoiceComparison.errors.length > 0
        ? perVoiceComparison.errors.sort((a: any, b: any) => Math.abs(b.error) - Math.abs(a.error))
        : scoreResult.topProblems.map(p => ({ voice: p.name, metric: 'general', error: p.error, ourValue: 0, refValue: 0 }));

      for (const err of errorSource.slice(0, maxChangesPerIteration)) {
        let paramName: string | null = null;
        let delta = 0;

        // Map errors to parameter changes
        if (err.voice === 'Kick Decay' || (err.voice === 'kick' && err.metric === 'decay')) {
          const param = currentRegistry.find((p: any) => p.name === 'kickDecay');
          if (param && !usedParams.has('kickDecay')) {
            paramName = 'kickDecay';
            const refDecaySec = (err.refValue || referenceProfile.kickDecayMs.mean) / 1000;
            const direction = refDecaySec > param.current ? 1 : -1;
            if (isTried('kickDecay', direction)) {
              if (isTried('kickDecay', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else {
              delta = (refDecaySec - param.current) * 0.5;
            }
            if (paramName) usedParams.add('kickDecay');
          }
        } else if (err.voice === 'Bass Decay' || (err.voice === 'bass' && err.metric === 'energy')) {
          const param = currentRegistry.find((p: any) => p.name === 'bassCutoff');
          if (param && !usedParams.has('bassCutoff')) {
            paramName = 'bassCutoff';
            const direction = err.error > 0 ? -1 : 1;
            if (isTried('bassCutoff', direction)) {
              if (isTried('bassCutoff', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else { delta = direction * 60; }
            if (paramName) usedParams.add('bassCutoff');
          }
        } else if (err.voice === 'Spectral Balance' || (err.voice === 'lead' && err.metric === 'centroid')) {
          const param = currentRegistry.find((p: any) => p.name === 'leadCutoff');
          if (param && !usedParams.has('leadCutoff')) {
            paramName = 'leadCutoff';
            const direction = err.error < 0 ? 1 : -1;
            if (isTried('leadCutoff', direction)) {
              if (isTried('leadCutoff', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else { delta = direction * 400; }
            if (paramName) usedParams.add('leadCutoff');
          }
        } else if (err.voice === 'Loudness' || err.voice === 'Transient Density' || err.voice === 'Energy') {
          // Use masterLevel for loudness, duck for transients
          const paramName2 = err.voice === 'Loudness' ? 'masterLevel' : 'duck';
          const param = currentRegistry.find((p: any) => p.name === paramName2);
          if (param && !usedParams.has(paramName2)) {
            paramName = paramName2;
            const direction = err.error < 0 ? 1 : -1;
            if (isTried(paramName2, direction)) {
              if (isTried(paramName2, -direction)) { paramName = null; }
              else { delta = -direction * param.step; }
            } else {
              delta = paramName2 === 'masterLevel' ? direction * 0.1 : direction * 0.08;
            }
            if (paramName) usedParams.add(paramName2);
          }
        }

        if (paramName) {
          const param = currentRegistry.find((p: any) => p.name === paramName);
          if (param) {
            const newValue = adjustParameter(param, delta);
            if (newValue !== param.current) {
              changes.push({
                name: paramName,
                oldValue: param.current,
                newValue,
                delta: newValue - param.current,
              });
            }
          }
        }
      }

      // Random exploration if no changes
      if (changes.length === 0 && currentRegistry) {
        const randomParam = currentRegistry[Math.floor(Math.random() * currentRegistry.length)];
        const randomDir = Math.random() > 0.5 ? 1 : -1;
        const newValue = adjustParameter(randomParam, randomDir * randomParam.step * 2);
        if (newValue !== randomParam.current) {
          changes.push({ name: randomParam.name, oldValue: randomParam.current, newValue, delta: newValue - randomParam.current });
        }
      }

      if (changes.length === 0) {
        (self as any).postMessage({
          type: 'train', id: req.id,
          oldScore, newScore: oldScore, changes: [], accepted: false,
          perVoiceScores, voiceAnalysis,
        });
        return;
      }

      // Render with new params
      const newRegistry = applyChanges(currentRegistry, changes);
      const newRender = render(seed, worldId, duration, { paramOverrides: registryToOverrides(newRegistry) });
      const newAnalysis = analyzeAudio(newRender.samplesL, newRender.samplesR, SR);
      const newMetrics = analysisToMetrics(newAnalysis, worldId);
      const newScoreResult = computeReferenceScore(newMetrics, referenceProfile, dna.bpmTarget);

      let newPerVoice: any = null;
      try {
        const perVoiceReport2 = analyzePerVoice(seed, worldId, duration, registryToOverrides(newRegistry));
        newPerVoice = comparePerVoiceToReference(perVoiceReport2, referenceProfile);
      } catch {}

      const newScore = newPerVoice
        ? Math.round(newScoreResult.total * 0.6 + newPerVoice.totalScore * 0.4)
        : newScoreResult.total;

      const accepted = newScore > oldScore;

      if (accepted) {
        currentRegistry = newRegistry;
        if (newScore > bestScore) {
          bestScore = newScore;
          bestParams = registryToOverrides(newRegistry);
        }
        triedChanges.clear();
      } else {
        for (const c of changes) {
          triedChanges.add(`${c.name}:${c.delta > 0 ? '+' : '-'}`);
        }
      }

      const response: TrainResponse = {
        type: 'train',
        id: req.id,
        oldScore,
        newScore,
        changes,
        accepted,
        perVoiceScores,
        voiceAnalysis,
      };
      (self as any).postMessage(response);
    } catch (err) {
      (self as any).postMessage({
        type: 'train',
        id: req.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
