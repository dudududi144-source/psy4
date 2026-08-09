/**
 * Continuous Trainer — runs entirely client-side.
 *
 * This solves the Cloudflare edge runtime limitation (server can't run heavy DSP).
 * The trainer runs in the browser, periodically:
 *   1. Renders a short snippet with current params (deterministic, offline)
 *   2. Analyzes it (FFT, dynamics, spectrum)
 *   3. Compares to the live reference profile
 *   4. Adjusts 1-3 parameters
 *   5. Applies the new params to the LIVE engine (real-time)
 *   6. Repeats
 *
 * This enables CONTINUOUS LEARNING while radio + engine play together.
 *
 * The learned params are saved to localStorage for future sessions.
 */

import { render, downmixToMono, SR, encodeWav } from '@/lib/studio/engine/forensic/offlineRenderer';
import { analyzeAudio } from '@/lib/studio/engine/forensic/audioAnalyzer';
import { computeReferenceScore } from '@/lib/studio/engine/reference/referenceScore';
import { analyzePerVoice, comparePerVoiceToReference } from '@/lib/studio/engine/reference/perVoiceAnalyzer';
import {
  createParameterRegistry, adjustParameter, applyChanges, registryToOverrides,
  type OptimizableParameter, type ParameterChange,
} from '@/lib/studio/engine/reference/parameterRegistry';
import { getWorldDNA } from '@/lib/studio/engine/reference/worldDNA';
import { FORENSIC_WORLDS } from '@/lib/studio/engine/forensic/worlds';
import type { ReferenceProfile, ReferenceMetrics } from '@/lib/studio/engine/reference/referenceListener';

export interface LearningIteration {
  iteration: number;
  timestamp: number;
  changes: ParameterChange[];
  oldScore: number;
  newScore: number;
  scoreDelta: number;
  accepted: boolean;
  reason: string;
  topProblem: string;
}

export interface LearningState {
  worldId: string;
  running: boolean;
  iterations: LearningIteration[];
  currentScore: number;
  bestScore: number;
  currentParams: Record<string, number>;
  bestParams: Record<string, number>;
  acceptedCount: number;
  rejectedCount: number;
  totalIterations: number;
  learnedKnowledge: Record<string, { value: number; score: number; attempts: number }>;
  // Per-voice scores (from perVoiceAnalyzer)
  perVoiceScores?: {
    kick: number;
    bass: number;
    lead: number;
    spectral: number;
  };
  // Per-voice analysis details
  voiceAnalysis?: {
    kick: { lufs: number; decayMs: number; active: boolean };
    bass: { lufs: number; bandEnergy: number; active: boolean };
    lead: { lufs: number; centroidHz: number; active: boolean };
    hat: { lufs: number; active: boolean };
  };
}

export type LearningMode = 'idle' | 'listening' | 'learning' | 'mastering';

export interface ContinuousTrainerConfig {
  worldId: string;
  seed: number;
  renderDuration: number;       // seconds per render (shorter = faster iterations)
  iterationIntervalMs: number;  // ms between iterations
  maxChangesPerIteration: number;
  autoApplyToEngine: boolean;   // apply learned params to live engine
  saveToLocalStorage: boolean;
}

const DEFAULT_CONFIG: ContinuousTrainerConfig = {
  worldId: 'dark-psy',
  seed: 1234,
  renderDuration: 8,
  iterationIntervalMs: 15000,  // 15 seconds between iterations
  maxChangesPerIteration: 2,
  autoApplyToEngine: true,
  saveToLocalStorage: true,
};

const STORAGE_KEY = 'psy4_learned_params';

export class ContinuousTrainer {
  private config: ContinuousTrainerConfig;
  private registry: OptimizableParameter[];
  private state: LearningState;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  // Callbacks
  private onIterationCallback: ((iter: LearningIteration) => void) | null = null;
  private onStateChangeCallback: ((state: LearningState) => void) | null = null;
  private onParamsAppliedCallback: ((params: Record<string, number>) => void) | null = null;

  // Reference to the live engine (for applying params)
  private engineRef: { setWorld: (params: any) => void } | null = null;

  // Tried changes tracking
  private triedChanges = new Set<string>();

  constructor(config?: Partial<ContinuousTrainerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const dna = getWorldDNA(this.config.worldId);
    const defaults = dna ? {
      kickDecay: dna.kickDecayTarget,
      kickFundamental: dna.kickFundamentalTarget,
      bassCutoff: dna.bassCutoffTarget,
      bassResonance: dna.bassResonanceTarget,
      leadCutoff: dna.leadCutoffTarget,
      leadDetune: dna.leadDetuneTarget,
      padCutoff: 1200,
      duck: 0.4,
    } : {};

    // Load saved params from localStorage
    let savedParams: Record<string, number> = {};
    if (this.config.saveToLocalStorage && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed[this.config.worldId]) {
            savedParams = parsed[this.config.worldId];
          }
        }
      } catch { /* ignore */ }
    }

    this.registry = createParameterRegistry({ ...defaults, ...savedParams });
    this.state = {
      worldId: this.config.worldId,
      running: false,
      iterations: [],
      currentScore: 0,
      bestScore: 0,
      currentParams: registryToOverrides(this.registry),
      bestParams: registryToOverrides(this.registry),
      acceptedCount: 0,
      rejectedCount: 0,
      totalIterations: 0,
      learnedKnowledge: {},
    };
  }

  /** Set the live engine reference so learned params can be applied. */
  setEngine(engine: { setWorld: (params: any) => void }): void {
    this.engineRef = engine;
  }

  private worker: Worker | null = null;
  private pendingRequestId = 0;
  private waitingForWorker = false;

  /** Start continuous learning. */
  start(referenceProfile: ReferenceProfile): void {
    if (this.running) return;
    this.running = true;
    this.state.running = true;
    this.onStateChangeCallback?.(this.state);

    // Initialize Web Worker for off-main-thread rendering
    try {
      this.worker = new Worker(new URL('./renderWorker.ts', import.meta.url));
      this.worker.onmessage = (e: MessageEvent) => {
        this.handleWorkerResponse(e.data, referenceProfile);
      };
      this.worker.onerror = (err) => {
        console.warn('[Trainer] Worker error, falling back to main thread:', err);
        this.worker = null;
      };
    } catch {
      console.warn('[Trainer] Could not create Worker, using main thread');
      this.worker = null;
    }

    // Run first iteration
    this.runIteration(referenceProfile);

    // Schedule periodic iterations
    this.intervalId = setInterval(() => {
      this.runIteration(referenceProfile);
    }, this.config.iterationIntervalMs);
  }

  /** Stop learning. */
  stop(): void {
    this.running = false;
    this.state.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.waitingForWorker = false;
    this.onStateChangeCallback?.(this.state);
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): LearningState {
    return { ...this.state };
  }

  getCurrentParams(): Record<string, number> {
    return registryToOverrides(this.registry);
  }

  onIteration(cb: (iter: LearningIteration) => void): void {
    this.onIterationCallback = cb;
  }

  onStateChange(cb: (state: LearningState) => void): void {
    this.onStateChangeCallback = cb;
  }

  onParamsApplied(cb: (params: Record<string, number>) => void): void {
    this.onParamsAppliedCallback = cb;
  }

  /** Run a single learning iteration — sends work to Worker if available. */
  private runIteration(referenceProfile: ReferenceProfile): void {
    if (!this.running) return;
    if (this.waitingForWorker) return; // don't stack requests

    const { worldId, seed, renderDuration } = this.config;
    const dna = getWorldDNA(worldId);
    if (!dna) return;

    const currentOverrides = registryToOverrides(this.registry);

    // If Worker is available, send the work there (non-blocking!)
    if (this.worker) {
      this.waitingForWorker = true;
      this.pendingRequestId++;
      this.worker.postMessage({
        type: 'train',
        id: this.pendingRequestId,
        seed,
        worldId,
        duration: renderDuration,
        currentParams: currentOverrides,
        referenceProfile,
        maxChangesPerIteration: this.config.maxChangesPerIteration,
      });
      // The Worker will call handleWorkerResponse when done.
      // The main thread is FREE — engine keeps playing!
      return;
    }

    // Fallback: run on main thread (will block briefly)
    this.runIterationMainThread(referenceProfile);
  }

  /** Handle response from Worker. */
  private handleWorkerResponse(data: any, referenceProfile: ReferenceProfile): void {
    this.waitingForWorker = false;
    if (!this.running) return;

    if (data.error) {
      console.warn('[Trainer] Worker error:', data.error);
      return;
    }

    if (data.type !== 'train') return;

    const { oldScore, newScore, changes, accepted, perVoiceScores, voiceAnalysis } = data;

    // Update state
    this.state.currentScore = newScore;
    if (perVoiceScores) this.state.perVoiceScores = perVoiceScores;
    if (voiceAnalysis) this.state.voiceAnalysis = voiceAnalysis;

    if (accepted) {
      // Apply changes to local registry
      this.registry = applyChanges(this.registry, changes);
      this.state.acceptedCount++;
      if (newScore > this.state.bestScore) {
        this.state.bestScore = newScore;
        this.state.bestParams = registryToOverrides(this.registry);
      }

      // Apply to live engine
      if (this.config.autoApplyToEngine && this.engineRef) {
        const overrides = registryToOverrides(this.registry);
        this.engineRef.setWorld(overrides);
        this.onParamsAppliedCallback?.(overrides);
      }

      // Save to localStorage
      if (this.config.saveToLocalStorage) {
        this.saveParams();
      }

      // Update learned knowledge
      for (const c of changes) {
        if (!this.state.learnedKnowledge[c.name]) {
          this.state.learnedKnowledge[c.name] = { value: c.newValue, score: newScore, attempts: 1 };
        } else {
          this.state.learnedKnowledge[c.name].value = c.newValue;
          this.state.learnedKnowledge[c.name].score = newScore;
          this.state.learnedKnowledge[c.name].attempts++;
        }
      }
    } else {
      this.state.rejectedCount++;
      for (const c of changes) {
        this.triedChanges.add(`${c.name}:${c.delta > 0 ? '+' : '-'}`);
      }
    }

    this.state.totalIterations++;

    const iteration: LearningIteration = {
      iteration: this.state.totalIterations,
      timestamp: Date.now(),
      changes,
      oldScore,
      newScore,
      scoreDelta: newScore - oldScore,
      accepted,
      reason: accepted
        ? `score improved by ${(newScore - oldScore).toFixed(1)}`
        : `score dropped by ${Math.abs(newScore - oldScore).toFixed(1)}`,
      topProblem: changes[0]?.name || 'none',
    };

    this.state.iterations.push(iteration);
    if (this.state.iterations.length > 100) {
      this.state.iterations = this.state.iterations.slice(-100);
    }

    this.onIterationCallback?.(iteration);
    this.onStateChangeCallback?.(this.state);
  }

  /** Run iteration on main thread (fallback when Worker unavailable). */
  private runIterationMainThread(referenceProfile: ReferenceProfile): void {

    try {
      const { worldId, seed, renderDuration } = this.config;
      const dna = getWorldDNA(worldId);
      if (!dna) return;

      const currentOverrides = registryToOverrides(this.registry);

      // 1. Render full mix for overall score
      const currentRender = render(seed, worldId, renderDuration, {
        paramOverrides: currentOverrides,
      });

      // 2. Analyze full mix
      const analysis = analyzeAudio(currentRender.samplesL, currentRender.samplesR, SR);
      const metrics = this.analysisToMetrics(analysis, worldId);

      // 3. Full mix score against reference
      const scoreResult = computeReferenceScore(metrics, referenceProfile, dna.bpmTarget);

      // 4. Per-voice analysis (isolates each voice for targeted learning)
      let perVoiceComparison: ReturnType<typeof comparePerVoiceToReference> | null = null;
      try {
        const perVoiceReport = analyzePerVoice(seed, worldId, renderDuration, currentOverrides);
        perVoiceComparison = comparePerVoiceToReference(perVoiceReport, referenceProfile);

        // Update state with per-voice scores
        this.state.perVoiceScores = {
          kick: perVoiceComparison.kickScore,
          bass: perVoiceComparison.bassScore,
          lead: perVoiceComparison.leadScore,
          spectral: perVoiceComparison.spectralScore,
        };
        this.state.voiceAnalysis = {
          kick: { lufs: perVoiceReport.kick.lufs, decayMs: perVoiceReport.kick.decayMs, active: perVoiceReport.kick.active },
          bass: { lufs: perVoiceReport.bass.lufs, bandEnergy: perVoiceReport.bass.bandEnergy, active: perVoiceReport.bass.active },
          lead: { lufs: perVoiceReport.lead.lufs, centroidHz: perVoiceReport.lead.centroidHz, active: perVoiceReport.lead.active },
          hat: { lufs: perVoiceReport.hat.lufs, active: perVoiceReport.hat.active },
        };
      } catch (e) {
        // per-voice analysis can fail on some worlds — continue with full-mix only
      }

      // 5. Combined score: 60% full-mix + 40% per-voice (if available)
      const oldScore = perVoiceComparison
        ? Math.round(scoreResult.total * 0.6 + perVoiceComparison.totalScore * 0.4)
        : scoreResult.total;

      // Update current score
      this.state.currentScore = oldScore;
      if (oldScore > this.state.bestScore) {
        this.state.bestScore = oldScore;
        this.state.bestParams = { ...currentOverrides };
      }

      // 6. Propose changes — use per-voice errors if available, else full-mix problems
      const changes = perVoiceComparison && perVoiceComparison.errors.length > 0
        ? this.proposeChangesFromPerVoice(perVoiceComparison, referenceProfile)
        : this.proposeChanges(scoreResult, referenceProfile);

      if (changes.length === 0) {
        // Random exploration
        const randomParam = this.registry[Math.floor(Math.random() * this.registry.length)];
        const randomDir = Math.random() > 0.5 ? 1 : -1;
        const newValue = adjustParameter(randomParam, randomDir * randomParam.step * 2);
        if (newValue !== randomParam.current) {
          changes.push({
            name: randomParam.name,
            oldValue: randomParam.current,
            newValue,
            delta: newValue - randomParam.current,
          });
        }
      }

      if (changes.length === 0) return;

      // 5. Render with new params
      const newRegistry = applyChanges(this.registry, changes);
      const newRender = render(seed, worldId, renderDuration, {
        paramOverrides: registryToOverrides(newRegistry),
      });
      const newAnalysis = analyzeAudio(newRender.samplesL, newRender.samplesR, SR);
      const newMetrics = this.analysisToMetrics(newAnalysis, worldId);
      const newScoreResult = computeReferenceScore(newMetrics, referenceProfile, dna.bpmTarget);
      const newScore = newScoreResult.total;

      // 6. Accept or reject
      const accepted = newScore > oldScore;
      const scoreDelta = newScore - oldScore;
      const topProblem = scoreResult.topProblems[0]?.name || 'none';

      if (accepted) {
        this.registry = newRegistry;
        this.state.currentScore = newScore;
        this.state.acceptedCount++;
        if (newScore > this.state.bestScore) {
          this.state.bestScore = newScore;
          this.state.bestParams = registryToOverrides(newRegistry);
        }
        // Clear tried changes on success — the landscape changed
        this.triedChanges.clear();

        // Apply to live engine if enabled
        if (this.config.autoApplyToEngine && this.engineRef) {
          const overrides = registryToOverrides(this.registry);
          this.engineRef.setWorld(overrides);
          this.onParamsAppliedCallback?.(overrides);
        }

        // Save to localStorage
        if (this.config.saveToLocalStorage) {
          this.saveParams();
        }

        // Update learned knowledge
        for (const c of changes) {
          if (!this.state.learnedKnowledge[c.name]) {
            this.state.learnedKnowledge[c.name] = { value: c.newValue, score: newScore, attempts: 1 };
          } else {
            this.state.learnedKnowledge[c.name].value = c.newValue;
            this.state.learnedKnowledge[c.name].score = newScore;
            this.state.learnedKnowledge[c.name].attempts++;
          }
        }
      } else {
        this.state.rejectedCount++;
        for (const c of changes) {
          this.triedChanges.add(`${c.name}:${c.delta > 0 ? '+' : '-'}`);
        }
      }

      this.state.totalIterations++;

      const iteration: LearningIteration = {
        iteration: this.state.totalIterations,
        timestamp: Date.now(),
        changes,
        oldScore,
        newScore,
        scoreDelta,
        accepted,
        reason: accepted
          ? `score improved by ${scoreDelta.toFixed(1)}`
          : `score dropped by ${Math.abs(scoreDelta).toFixed(1)}`,
        topProblem,
      };

      this.state.iterations.push(iteration);
      // Keep last 100 iterations
      if (this.state.iterations.length > 100) {
        this.state.iterations = this.state.iterations.slice(-100);
      }

      this.onIterationCallback?.(iteration);
      this.onStateChangeCallback?.(this.state);

    } catch (err) {
      console.error('[Trainer] iteration error:', err);
    }
  }

  /** Propose changes based on per-voice analysis errors. */
  private proposeChangesFromPerVoice(
    perVoice: ReturnType<typeof comparePerVoiceToReference>,
    referenceProfile: ReferenceProfile,
  ): ParameterChange[] {
    const changes: ParameterChange[] = [];
    const usedParams = new Set<string>();

    const isTried = (name: string, dir: number) =>
      this.triedChanges.has(`${name}:${dir > 0 ? '+' : '-'}`);

    // Sort errors by magnitude (biggest error first)
    const sortedErrors = [...perVoice.errors].sort((a, b) => Math.abs(b.error) - Math.abs(a.error));

    for (const err of sortedErrors.slice(0, this.config.maxChangesPerIteration)) {
      let paramName: string | null = null;
      let delta = 0;

      // Map per-voice errors to parameter changes
      if (err.voice === 'kick' && err.metric === 'decay') {
        const param = this.registry.find(p => p.name === 'kickDecay');
        if (param && !usedParams.has('kickDecay')) {
          paramName = 'kickDecay';
          const refDecaySec = err.refValue / 1000;
          const direction = refDecaySec > param.current ? 1 : -1;
          if (isTried('kickDecay', direction)) {
            if (isTried('kickDecay', -direction)) { paramName = null; }
            else { delta = -direction * param.step * 2; }
          } else {
            delta = (refDecaySec - param.current) * 0.5;
          }
          if (paramName) usedParams.add('kickDecay');
        }
      } else if (err.voice === 'bass' && err.metric === 'energy') {
        const param = this.registry.find(p => p.name === 'bassCutoff');
        if (param && !usedParams.has('bassCutoff')) {
          paramName = 'bassCutoff';
          // If our bass energy is too low, raise cutoff for more brightness
          const direction = err.error < 0 ? 1 : -1;
          if (isTried('bassCutoff', direction)) {
            if (isTried('bassCutoff', -direction)) { paramName = null; }
            else { delta = -direction * param.step * 2; }
          } else { delta = direction * 80; }
          if (paramName) usedParams.add('bassCutoff');
        }
      } else if (err.voice === 'lead' && err.metric === 'centroid') {
        const param = this.registry.find(p => p.name === 'leadCutoff');
        if (param && !usedParams.has('leadCutoff')) {
          paramName = 'leadCutoff';
          const direction = err.error < 0 ? 1 : -1;
          if (isTried('leadCutoff', direction)) {
            if (isTried('leadCutoff', -direction)) { paramName = null; }
            else { delta = -direction * param.step * 2; }
          } else { delta = direction * 500; }
          if (paramName) usedParams.add('leadCutoff');
        }
      }

      if (paramName) {
        const param = this.registry.find(p => p.name === paramName);
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

    return changes;
  }

  /** Propose parameter changes based on score problems. */
  private proposeChanges(
    scoreResult: ReturnType<typeof computeReferenceScore>,
    referenceProfile: ReferenceProfile,
  ): ParameterChange[] {
    const changes: ParameterChange[] = [];
    const usedParams = new Set<string>();

    const isTried = (name: string, dir: number) =>
      this.triedChanges.has(`${name}:${dir > 0 ? '+' : '-'}`);

    for (const problem of scoreResult.topProblems.slice(0, this.config.maxChangesPerIteration)) {
      let paramName: string | null = null;
      let delta = 0;

      switch (problem.name) {
        case 'Kick Decay': {
          const param = this.registry.find(p => p.name === 'kickDecay');
          if (param && !usedParams.has('kickDecay')) {
            paramName = 'kickDecay';
            const refDecaySec = referenceProfile.kickDecayMs.mean / 1000;
            const direction = refDecaySec > param.current ? 1 : -1;
            if (isTried('kickDecay', direction)) {
              if (isTried('kickDecay', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else {
              delta = (refDecaySec - param.current) * 0.5;
            }
            if (paramName) usedParams.add('kickDecay');
          }
          break;
        }
        case 'Bass Decay': {
          const param = this.registry.find(p => p.name === 'bassCutoff');
          if (param && !usedParams.has('bassCutoff')) {
            paramName = 'bassCutoff';
            const direction = problem.error > 0 ? -1 : 1;
            if (isTried('bassCutoff', direction)) {
              if (isTried('bassCutoff', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else { delta = direction * 60; }
            if (paramName) usedParams.add('bassCutoff');
          }
          break;
        }
        case 'Spectral Balance': {
          const param = this.registry.find(p => p.name === 'leadCutoff');
          if (param && !usedParams.has('leadCutoff')) {
            paramName = 'leadCutoff';
            const direction = problem.error < 0 ? 1 : -1;
            if (isTried('leadCutoff', direction)) {
              if (isTried('leadCutoff', -direction)) { paramName = null; }
              else { delta = -direction * param.step * 2; }
            } else { delta = direction * 400; }
            if (paramName) usedParams.add('leadCutoff');
          }
          break;
        }
        case 'Transient Density':
        case 'Loudness':
        case 'Energy': {
          const param = this.registry.find(p => p.name === 'duck');
          if (param && !usedParams.has('duck')) {
            paramName = 'duck';
            const direction = problem.error < 0 ? 1 : -1;
            if (isTried('duck', direction)) {
              if (isTried('duck', -direction)) { paramName = null; }
              else { delta = -direction * param.step; }
            } else { delta = direction * 0.1; }
            if (paramName) usedParams.add('duck');
          }
          break;
        }
      }

      if (paramName) {
        const param = this.registry.find(p => p.name === paramName);
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

    return changes;
  }

  /** Convert analysis to reference metrics format. */
  private analysisToMetrics(analysis: ReturnType<typeof analyzeAudio>, worldId: string): ReferenceMetrics {
    const sp = analysis.spectrum;
    const d = analysis.dynamics;
    const le = analysis.lowEnd;
    const tr = analysis.transients;
    const dur = analysis.duration || 1;

    return {
      bpm: FORENSIC_WORLDS[worldId]?.bpm || 142,
      bpmConfidence: 0.9,
      rms: d.rms,
      peak: d.peak,
      lufs: d.lufs,
      crestFactor: d.crest,
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

  /** Save learned params to localStorage for future sessions. */
  private saveParams(): void {
    if (typeof window === 'undefined') return;
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      const all = existing ? JSON.parse(existing) : {};
      all[this.config.worldId] = registryToOverrides(this.registry);
      all[this.config.worldId]._bestScore = this.state.bestScore;
      all[this.config.worldId]._lastUpdated = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  /** Load previously learned params from localStorage. */
  static loadLearnedParams(worldId: string): Record<string, number> | null {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      return parsed[worldId] || null;
    } catch {
      return null;
    }
  }

  /** Reset learning (clear all stored knowledge). */
  reset(): void {
    this.stop();
    this.triedChanges.clear();
    this.state = {
      worldId: this.config.worldId,
      running: false,
      iterations: [],
      currentScore: 0,
      bestScore: 0,
      currentParams: registryToOverrides(this.registry),
      bestParams: registryToOverrides(this.registry),
      acceptedCount: 0,
      rejectedCount: 0,
      totalIterations: 0,
      learnedKnowledge: {},
    };
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}
