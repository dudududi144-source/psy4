/**
 * LIVE ENGINE — phrase-based streaming with lookahead.
 *
 * Instead of rendering a full 2-minute track, the Live Engine generates short
 * phrases (4 bars) on demand. The browser requests the next phrase while the
 * current one plays, creating continuous music with live macro control.
 *
 * Architecture:
 *   LiveSession (server-side state, one per browser)
 *     → holds MusicalMemory + World + macros
 *     → generates phrase N+1 while phrase N plays
 *     → macros change the NEXT phrase, not the current one (quantized)
 *
 * REAL IMPLEMENTATION.
 */

import { Studio } from '../render/engine';
import { encodeWav, peak } from '../render/wav';
import { Rng, hashSeed } from '../rng';
import { SCALES, scaleNote } from '../dsp/wavetable';
import { World, WORLDS, WorldId } from './worlds';
import { MusicalMemory, MacroControls, DEFAULT_MACROS, initMemory, mutateMotif, resolveMotifNotes } from './musicalMemory';
import { buildArrangement, decideForBar, applyAction, applyMacroChange, LayerId } from './musicalDirector';
import { analyzeMusic, verdictPsytranceLoop } from '../audit/musicalAnalysis';
import { evaluateTaste } from './tasteEngine';
import { DrumVoice } from '../devices/analog-rytm';
import { H90Algorithm } from '../devices/eventide-h90';

export interface LivePhrase {
  phraseIndex: number;
  startBar: number;
  bars: number;
  wav: ArrayBuffer;       // 16-bit PCM WAV
  durationSec: number;
  analysis: ReturnType<typeof analyzeMusic>;
  taste: ReturnType<typeof evaluateTaste>;
  seed: number;
  bpm: number;
  section: string;
  energy: number;
  density: number;
}

export interface LiveSession {
  sessionId: string;
  world: World;
  worldId: WorldId;
  seed: number;
  bpm: number;
  memory: MusicalMemory;
  macros: MacroControls;
  arrangement: ReturnType<typeof buildArrangement>;
  phraseIndex: number;
  currentBar: number;
  phrases: LivePhrase[];      // generated phrases (capped to avoid memory growth)
  createdAt: number;
  lastActivity: number;
  pendingMacroChanges: Partial<MacroControls> | null;
  pendingAction: string | null;
}

// In-memory session store (one per browser tab)
const sessions = new Map<string, LiveSession>();
const MAX_PHRASES_PER_SESSION = 6; // keep last 6 phrases (memory cap)

/** Create a new live session. */
export function createLiveSession(worldId: WorldId, seed?: number, macros?: Partial<MacroControls>): LiveSession {
  const world = WORLDS[worldId];
  if (!world) throw new Error(`Unknown world: ${worldId}`);
  const actualSeed = seed ?? Math.floor(Math.random() * 1000000);
  const actualMacros = { ...DEFAULT_MACROS, ...macros };
  const memory = initMemory(world, actualMacros, actualSeed);
  const arrangement = buildArrangement(world, actualMacros);
  const sessionId = `live-${actualSeed.toString(36)}-${Date.now().toString(36)}`;
  const session: LiveSession = {
    sessionId, world, worldId, seed: actualSeed, bpm: world.defaultBpm,
    memory, macros: actualMacros, arrangement,
    phraseIndex: 0, currentBar: 0, phrases: [],
    createdAt: Date.now(), lastActivity: Date.now(),
    pendingMacroChanges: null, pendingAction: null,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getLiveSession(sessionId: string): LiveSession | null {
  return sessions.get(sessionId) ?? null;
}

/** Generate the next phrase for a session. This is the core live generation function. */
export function generateNextPhrase(sessionId: string, phraseBars = 4): LivePhrase {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.lastActivity = Date.now();

  // apply pending macro changes (quantized to phrase boundary)
  if (session.pendingMacroChanges) {
    session.macros = { ...session.macros, ...session.pendingMacroChanges };
    session.memory = applyMacroChange(session.memory, session.pendingMacroChanges);
    session.pendingMacroChanges = null;
  }
  // apply pending action (quantized to phrase boundary)
  if (session.pendingAction) {
    session.memory = applyAction(session.memory, session.pendingAction, session.world);
    session.pendingAction = null;
  }

  const { world, macros, memory, arrangement } = session;
  const rng = new Rng(session.seed + session.phraseIndex * 1000);
  const sr = 22050;
  const startBar = session.currentBar;
  const totalArrangementBars = arrangement.reduce((a, s) => a + s.bars, 0);

  // configure studio from world + current macros
  const studio = new Studio({
    bars: phraseBars, sampleRate: sr, blockSize: 256, seed: session.seed + session.phraseIndex,
    bpm: session.bpm,
    muse: { oscAShape: world.leadTimbre.oscShape, cutoff: world.leadTimbre.cutoff, resonance: world.leadTimbre.resonance, attack: world.leadTimbre.attack, decay: world.leadTimbre.decay, sustain: world.leadTimbre.sustain, release: world.leadTimbre.release, drive: world.leadTimbre.drive, level: world.leadTimbre.level },
    sub37: { oscAShape: world.bassTimbre.oscShape, cutoff: world.bassTimbre.cutoff, resonance: world.bassTimbre.resonance, attack: world.bassTimbre.attack, decay: world.bassTimbre.decay, sustain: world.bassTimbre.sustain, release: world.bassTimbre.release, multidrive: (world.bassTimbre.drive - 1) * 0.5, level: world.bassTimbre.level },
    prophet6: { oscAShape: world.padTimbre.oscShape, cutoff: world.padTimbre.cutoff, resonance: world.padTimbre.resonance, attack: world.padTimbre.attack, decay: world.padTimbre.decay, sustain: world.padTimbre.sustain, release: world.padTimbre.release, level: world.padTimbre.level },
    iridium: { cutoff: world.textureTimbre.cutoff, resonance: world.textureTimbre.resonance, attack: world.textureTimbre.attack, level: world.textureTimbre.level, fmAmount: 0.3 + macros.psychedelia * 0.4, granular: 0.3 + macros.psychedelia * 0.4, morphRate: 0.05 + macros.evolution * 0.3 },
    h90: { algorithm1: world.fxAlgorithm1 as H90Algorithm, algorithm2: world.fxAlgorithm2 as H90Algorithm, mix: world.fxMix * (0.5 + macros.space * 0.5), feedback: 0.3 + macros.psychedelia * 0.4, modRate: 0.2 + macros.evolution * 0.5 },
  });

  // schedule each bar in this phrase
  let mem = { ...memory, currentBar: startBar };
  for (let bar = 0; bar < phraseBars; bar++) {
    const absBar = startBar + bar;
    mem.currentBar = absBar;
    // loop arrangement if needed
    mem.journeyPosition = totalArrangementBars > 0 ? (absBar % totalArrangementBars) / totalArrangementBars : 0;
    const { decision, memory: newMem } = decideForBar(mem, world, macros, arrangement, rng);
    mem = newMem;
    // apply mutations
    for (const m of decision.mutate) {
      if (m.layer === 'lead') mem.leadMotif = mutateMotif(mem.leadMotif, rng, m.intensity);
      if (m.layer === 'bass') mem.bassMotif = mutateMotif(mem.bassMotif, rng, m.intensity);
      if (m.layer === 'arp') mem.arpMotif = mutateMotif(mem.arpMotif, rng, m.intensity);
      if (m.layer === 'perc') mem.percussionMotif = mutateMotif(mem.percussionMotif, rng, m.intensity);
    }
    // apply FX changes
    if (decision.fxAlgorithm1 || decision.fxAlgorithm2) {
      studio.h90.setParams({
        ...(decision.fxAlgorithm1 ? { algorithm1: decision.fxAlgorithm1 as H90Algorithm } : {}),
        ...(decision.fxAlgorithm2 ? { algorithm2: decision.fxAlgorithm2 as H90Algorithm } : {}),
      });
    }
    scheduleBarLive(studio, mem, world, macros, decision.activeLayers, absBar);
  }

  // render
  const { left, right } = studio.render(phraseBars);
  const wav = encodeWav(left, right, sr);
  const analysis = analyzeMusic(left, right, sr, session.bpm);
  const taste = evaluateTaste(analysis, mem);

  // update session state
  session.memory = mem;
  session.phraseIndex++;
  session.currentBar = startBar + phraseBars;

  const phrase: LivePhrase = {
    phraseIndex: session.phraseIndex,
    startBar, bars: phraseBars,
    wav, durationSec: studio.transport.seconds(),
    analysis, taste,
    seed: session.seed + session.phraseIndex,
    bpm: session.bpm,
    section: mem.currentSection,
    energy: mem.energy, density: mem.density,
  };

  // cap stored phrases (memory safety)
  session.phrases.push(phrase);
  if (session.phrases.length > MAX_PHRASES_PER_SESSION) {
    session.phrases.shift();
  }

  return phrase;
}

/** Schedule layers for a single bar in live mode. */
function scheduleBarLive(
  studio: Studio,
  memory: MusicalMemory,
  world: World,
  macros: MacroControls,
  activeLayers: LayerId[],
  bar: number
) {
  const active = new Set(activeLayers);
  const scale = SCALES[memory.currentScale] || SCALES.minor;
  const root = memory.currentKey;
  const density = memory.density;
  const energy = memory.energy;

  if (active.has('kick')) {
    for (let beat = 0; beat < 4; beat++) studio.scheduleKick(bar, beat * 4, 0.9 + energy * 0.1);
  }
  if (active.has('bass')) {
    const bassNotes = resolveMotifNotes(memory.bassMotif, root - 12, memory.currentScale);
    for (const bn of bassNotes) {
      if (Math.random() < density * 1.2) studio.scheduleBass(bar, bn.step, bn.note, bn.velocity * (0.7 + energy * 0.3), 0.1);
    }
  }
  if (active.has('lead') && density > 0.4) {
    const leadNotes = resolveMotifNotes(memory.leadMotif, root + 12, memory.currentScale);
    for (const ln of leadNotes) {
      if (Math.random() < density) studio.scheduleLead(bar, ln.step, ln.note, ln.velocity * (0.5 + energy * 0.4), 0.2 + macros.groove * 0.1);
    }
  }
  if (active.has('pad')) {
    for (const deg of [0, 3, 7]) studio.schedulePad(bar, scaleNote(root, scale, deg), 0.3 + energy * 0.2, 4);
  }
  if (active.has('texture') && bar % 2 === 0) {
    const texDeg = scaleNote(root + 12, scale, memory.atmosphereMotif.notes[0] || 0);
    studio.scheduleTexture(bar, texDeg, 0.3 + energy * 0.3, 8);
  }
  if (active.has('arp') && density > 0.5) {
    const arpNotes = resolveMotifNotes(memory.arpMotif, root + 12, memory.currentScale);
    for (const an of arpNotes) {
      if (Math.random() < density) studio.scheduleLead(bar, an.step, an.note, an.velocity * 0.6, 0.1);
    }
  }
  if (active.has('hats') || active.has('perc')) {
    for (const pn of resolveMotifNotes(memory.percussionMotif, root, memory.currentScale)) {
      const voice = memory.percussionMotif.notes[memory.percussionMotif.rhythm.indexOf(pn.step)] || 2;
      if (voice === 1 && active.has('perc')) studio.scheduleDrum('snare', bar, pn.step, pn.velocity);
      if (voice === 2 && active.has('hats')) studio.scheduleDrum('hat', bar, pn.step, pn.velocity);
    }
  }
}

/** Queue a macro change for the next phrase boundary (quantized). */
export function queueMacroChange(sessionId: string, changes: Partial<MacroControls>): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.pendingMacroChanges = { ...session.pendingMacroChanges, ...changes };
}

/** Queue an action for the next phrase boundary (quantized). */
export function queueAction(sessionId: string, action: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.pendingAction = action;
}

/** Get session state for UI display. */
export function getSessionState(sessionId: string): {
  sessionId: string; worldId: WorldId; seed: number; bpm: number;
  phraseIndex: number; currentBar: number; section: string;
  macros: MacroControls; totalMutations: number;
  phrasesGenerated: number;
} | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    worldId: session.worldId,
    seed: session.seed,
    bpm: session.bpm,
    phraseIndex: session.phraseIndex,
    currentBar: session.currentBar,
    section: session.memory.currentSection,
    macros: session.macros,
    totalMutations: session.memory.totalMutations,
    phrasesGenerated: session.phraseIndex,
  };
}

/** Clean up old inactive sessions (memory safety). */
export function cleanupStaleSessions(maxAgeMs = 30 * 60 * 1000): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > maxAgeMs) {
      sessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}
