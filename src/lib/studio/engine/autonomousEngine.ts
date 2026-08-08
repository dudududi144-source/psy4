/**
 * AUTONOMOUS MUSIC ENGINE — the product core.
 *
 * Takes a World + MacroControls + seed → produces a complete, evolving,
 * coherent psychedelic music render with provenance.
 *
 * This bridges the intelligence layer (memory, director, generators) to the
 * sound layer (existing DSP studio). The user never touches MIDI/oscillators;
 * they press GENERATE and receive music.
 *
 * REAL IMPLEMENTATION.
 */

import { Studio, StudioConfig } from '../render/engine';
import { encodeWav, peak, rms, bufferHash } from '../render/wav';
import { Rng, hashSeed } from '../rng';
import { SCALES, scaleNote, mtof } from '../dsp/wavetable';
import { World, WORLDS, WorldId } from './worlds';
import { MusicalMemory, MacroControls, DEFAULT_MACROS, initMemory, mutateMotif, resolveMotifNotes } from './musicalMemory';
import { buildArrangement, decideForBar, applyAction, applyMacroChange, LayerId, ArrangementSection } from './musicalDirector';
import { analyzeMusic, MusicalAnalysis, verdictPsytranceLoop } from '../audit/musicalAnalysis';
import { buildProvenance, Provenance, ENGINE_VERSION } from '../audit/provenance';
import { DrumVoice } from '../devices/analog-rytm';
import { H90Algorithm } from '../devices/eventide-h90';

export interface GenerateRequest {
  worldId: WorldId;
  seed?: number;
  macros?: Partial<MacroControls>;
  bars?: number;
  sampleRate?: number;
  action?: string;           // action button (stranger/darker/drop/etc)
}

export interface GenerateResult {
  wav: ArrayBuffer;
  left: Float32Array;
  right: Float32Array;
  analysis: MusicalAnalysis;
  verdict: { pass: boolean; reasons: string[] };
  provenance: Provenance;
  memory: MusicalMemory;
  arrangement: ArrangementSection[];
  renderMs: number;
}

/** Generate a complete musical piece. The main product function. */
export function generate(req: GenerateRequest): GenerateResult {
  const world = WORLDS[req.worldId];
  if (!world) throw new Error(`Unknown world: ${req.worldId}`);
  const seed = req.seed ?? Math.floor(Math.random() * 1000000);
  const macros = { ...DEFAULT_MACROS, ...req.macros };
  const sr = req.sampleRate ?? 22050;
  const bars = req.bars ?? 32;
  const rng = new Rng(seed);

  // 1. initialize memory
  let memory = initMemory(world, macros, seed);
  // apply action if specified
  if (req.action) memory = applyAction(memory, req.action, world);

  // 2. build arrangement
  const arrangement = buildArrangement(world, macros);
  const totalBars = Math.min(bars, arrangement.reduce((a, s) => a + s.bars, 0));

  // 3. configure studio from world
  const studioConfig: Partial<StudioConfig> = {
    bars: totalBars, sampleRate: sr, blockSize: 256, seed, bpm: world.defaultBpm,
    muse: { oscAShape: world.leadTimbre.oscShape, cutoff: world.leadTimbre.cutoff, resonance: world.leadTimbre.resonance, attack: world.leadTimbre.attack, decay: world.leadTimbre.decay, sustain: world.leadTimbre.sustain, release: world.leadTimbre.release, drive: world.leadTimbre.drive, level: world.leadTimbre.level },
    sub37: { oscAShape: world.bassTimbre.oscShape, cutoff: world.bassTimbre.cutoff, resonance: world.bassTimbre.resonance, attack: world.bassTimbre.attack, decay: world.bassTimbre.decay, sustain: world.bassTimbre.sustain, release: world.bassTimbre.release, multidrive: (world.bassTimbre.drive - 1) * 0.5, level: world.bassTimbre.level },
    prophet6: { oscAShape: world.padTimbre.oscShape, cutoff: world.padTimbre.cutoff, resonance: world.padTimbre.resonance, attack: world.padTimbre.attack, decay: world.padTimbre.decay, sustain: world.padTimbre.sustain, release: world.padTimbre.release, level: world.padTimbre.level },
    iridium: { cutoff: world.textureTimbre.cutoff, resonance: world.textureTimbre.resonance, attack: world.textureTimbre.attack, level: world.textureTimbre.level, fmAmount: 0.3 + macros.psychedelia * 0.4, granular: 0.3 + macros.psychedelia * 0.4, morphRate: 0.05 + macros.evolution * 0.3 },
    h90: { algorithm1: world.fxAlgorithm1 as H90Algorithm, algorithm2: world.fxAlgorithm2 as H90Algorithm, mix: world.fxMix * (0.5 + macros.space * 0.5), feedback: 0.3 + macros.psychedelia * 0.4, modRate: 0.2 + macros.evolution * 0.5 },
  };
  const studio = new Studio(studioConfig);

  // 4. for each bar, ask the director and schedule notes
  for (let bar = 0; bar < totalBars; bar++) {
    memory.currentBar = bar;
    const { decision, memory: newMem } = decideForBar(memory, world, macros, arrangement, rng);
    memory = newMem;

    // apply mutations
    for (const m of decision.mutate) {
      if (m.layer === 'lead') memory.leadMotif = mutateMotif(memory.leadMotif, rng, m.intensity);
      if (m.layer === 'bass') memory.bassMotif = mutateMotif(memory.bassMotif, rng, m.intensity);
      if (m.layer === 'arp') memory.arpMotif = mutateMotif(memory.arpMotif, rng, m.intensity);
      if (m.layer === 'perc') memory.percussionMotif = mutateMotif(memory.percussionMotif, rng, m.intensity);
    }

    // apply FX program changes
    if (decision.fxAlgorithm1 || decision.fxAlgorithm2) {
      studio.h90.setParams({
        ...(decision.fxAlgorithm1 ? { algorithm1: decision.fxAlgorithm1 as H90Algorithm } : {}),
        ...(decision.fxAlgorithm2 ? { algorithm2: decision.fxAlgorithm2 as H90Algorithm } : {}),
      });
    }

    // schedule layers
    scheduleBar(studio, memory, world, macros, decision, bar);
  }

  // 5. render
  const renderT0 = Date.now();
  const { left, right } = studio.render(totalBars);
  const renderMs = Date.now() - renderT0;

  // 6. analyze
  const analysis = analyzeMusic(left, right, sr, world.defaultBpm);
  const verdict = verdictPsytranceLoop(analysis);

  // 7. encode WAV + provenance
  const wav = encodeWav(left, right, sr);
  const provenance = buildProvenance({
    artifactId: `${world.id}-${seed}`,
    artifactName: `${world.name} ${world.id} seed=${seed}`,
    fileName: `${world.id}-${seed}.wav`,
    seed, bpm: world.defaultBpm, sampleRate: sr, bars: totalBars,
    key: 'root', scale: world.defaultScale,
    renderDurationMs: renderMs, audioDurationSec: studio.transport.seconds(),
    wavBuffer: wav, left, peak: peak(left), rms: rms(left),
    validationResult: verdict.pass ? 'PASS' : 'FAIL', validationReasons: verdict.reasons,
  });

  return { wav, left, right, analysis, verdict, provenance, memory, arrangement, renderMs };
}

/** Schedule all layers for a single bar based on the director's decision. */
function scheduleBar(
  studio: Studio,
  memory: MusicalMemory,
  world: World,
  macros: MacroControls,
  decision: { activeLayers: LayerId[]; energy: number; density: number; tension: number },
  bar: number
) {
  const active = new Set(decision.activeLayers);
  const scale = SCALES[memory.currentScale] || SCALES.minor;
  const root = memory.currentKey;
  const density = decision.density;
  const energy = decision.energy;

  // KICK — 4 on floor (when active)
  if (active.has('kick')) {
    for (let beat = 0; beat < 4; beat++) {
      studio.scheduleKick(bar, beat * 4, 0.9 + energy * 0.1);
    }
  }

  // BASS — off-beat 16ths from bass motif
  if (active.has('bass')) {
    const bassNotes = resolveMotifNotes(memory.bassMotif, root - 12, memory.currentScale);
    for (const bn of bassNotes) {
      if (Math.random() < density * 1.2) {
        studio.scheduleBass(bar, bn.step, bn.note, bn.velocity * (0.7 + energy * 0.3), 0.1);
      }
    }
  }

  // LEAD — from lead motif
  if (active.has('lead') && density > 0.4) {
    const leadNotes = resolveMotifNotes(memory.leadMotif, root + 12, memory.currentScale);
    for (const ln of leadNotes) {
      if (Math.random() < density) {
        studio.scheduleLead(bar, ln.step, ln.note, ln.velocity * (0.5 + energy * 0.4), 0.2 + macros.groove * 0.1);
      }
    }
  }

  // PAD — sustained chord
  if (active.has('pad')) {
    const padDegrees = [0, 3, 7];
    for (const deg of padDegrees) {
      studio.schedulePad(bar, scaleNote(root, scale, deg), 0.3 + energy * 0.2, 4);
    }
  }

  // TEXTURE — evolving bed
  if (active.has('texture') && bar % 2 === 0) {
    const texDeg = scaleNote(root + 12, scale, memory.atmosphereMotif.notes[0] || 0);
    studio.scheduleTexture(bar, texDeg, 0.3 + energy * 0.3, 8);
  }

  // ARP — from arp motif
  if (active.has('arp') && density > 0.5) {
    const arpNotes = resolveMotifNotes(memory.arpMotif, root + 12, memory.currentScale);
    for (const an of arpNotes) {
      if (Math.random() < density) {
        studio.scheduleLead(bar, an.step, an.note, an.velocity * 0.6, 0.1);
      }
    }
  }

  // HATS + PERC — from perc motif
  if (active.has('hats') || active.has('perc')) {
    for (const pn of resolveMotifNotes(memory.percussionMotif, root, memory.currentScale)) {
      const voice = memory.percussionMotif.notes[memory.percussionMotif.rhythm.indexOf(pn.step)] || 2;
      if (voice === 1 && active.has('perc')) studio.scheduleDrum('snare', bar, pn.step, pn.velocity);
      if (voice === 2 && active.has('hats')) studio.scheduleDrum('hat', bar, pn.step, pn.velocity);
    }
  }
}

/** Generate a short preview (4 bars) for quick UI feedback. */
export function generatePreview(req: GenerateRequest): GenerateResult {
  return generate({ ...req, bars: 4, sampleRate: 22050 });
}

/** Generate a live segment (used for continuous playback). */
export function generateLiveSegment(req: GenerateRequest, startBar = 0, segmentBars = 8): GenerateResult {
  return generate({ ...req, bars: segmentBars, sampleRate: 22050 });
}
