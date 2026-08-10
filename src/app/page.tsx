'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Radio, Play, Square, Activity, Wifi, WifiOff, Volume2, VolumeX,
  Zap, Brain, CheckCircle2, Music, Gauge, Waves, Sparkles, TrendingUp,
  TrendingDown, Target, ArrowUp, ArrowDown, Check, Shuffle,
  Cpu, SlidersHorizontal, Layers, Piano, ListMusic, AudioWaveform,
  Fingerprint, ScanSearch, Wand2, Disc3, Link2, Link2Off,
  KeyRound, Drum, Flame, LayoutGrid,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import type { RadioStream } from '@/lib/studio/engine/reference/radioStreams';
import type { ReferenceProfile } from '@/lib/studio/engine/reference/referenceListener';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RefMetrics {
  bpm: number; lufs: number; subEnergy: number; lowEnergy: number;
  midEnergy: number; highEnergy: number; airEnergy: number;
  spectralCentroid: number; transientDensity: number; kickDecayMs: number;
  bassDecayMs: number; stereoWidth: number; energy: number;
  detectedKey?: { root: number; rootName: string; scale: string; confidence: number };
  detectedStyle?: { style: string; confidence: number };
}

type RefProfile = ReferenceProfile;

/** Shape produced by engine.getStyleClassification() (Track C). Optional. */
interface StyleMatch {
  style: string;
  confidence: number;          // 0..1
  reasons?: string[];          // human-readable justification strings
}

/** Static world metadata mirrored from worlds.ts (so the dropdown is decoupled). */
const WORLD_OPTIONS: { id: string; name: string; description: string }[] = [
  { id: 'progressive-psy', name: 'Progressive Psy', description: 'Slow-building, melodic, hypnotic · 124-134 BPM' },
  { id: 'dark-psy',        name: 'Dark Psy',        description: 'Fast, intense, foreboding · 145-156 BPM' },
  { id: 'morning-psy',     name: 'Morning Psy',     description: 'Uplifting, bright, euphoric · 138-146 BPM' },
  { id: 'goa',             name: 'Goa',             description: 'Acidic, melodic, mystical · 134-146 BPM' },
  { id: 'forest',          name: 'Forest',          description: 'Organic, deep, mysterious · 144-156 BPM' },
  { id: 'deep-psy',        name: 'Deep Psy',        description: 'Minimal, hypnotic, spacious · 128-140 BPM' },
  { id: 'hypnotic',        name: 'Hypnotic',        description: 'Repetitive, trance-inducing · 126-136 BPM' },
  { id: 'cosmic',          name: 'Cosmic',          description: 'Spacious, ethereal, drifting · 130-144 BPM' },
  { id: 'organic-psy',     name: 'Organic Psy',     description: 'Warm, natural, flowing · 132-144 BPM' },
  { id: 'acid-psy',        name: 'Acid Psy',        description: '303-style acid lines, squelchy · 136-148 BPM' },
];
const WORLD_NAME: Record<string, string> = Object.fromEntries(WORLD_OPTIONS.map(w => [w.id, w.name]));

type Mode = 'listen' | 'analyze' | 'train';

const SPECTRAL_BANDS = [
  { key: 'subEnergy',  label: 'SUB',  range: '20-60 Hz' },
  { key: 'lowEnergy',  label: 'LOW',  range: '60-250 Hz' },
  { key: 'midEnergy',  label: 'MID',  range: '250-2k Hz' },
  { key: 'highEnergy', label: 'HIGH', range: '2k-6k Hz' },
  { key: 'airEnergy',  label: 'AIR',  range: '6k-20k Hz' },
] as const;

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PSY4Page() {
  const [streams, setStreams] = useState<RadioStream[]>([]);
  const [streamId, setStreamId] = useState('');
  const [mode, setMode] = useState<Mode>('listen');
  const [worldId, setWorldId] = useState('dark-psy');

  // Reference
  const [refConnected, setRefConnected] = useState(false);
  const [refMetrics, setRefMetrics] = useState<RefMetrics | null>(null);
  const [refProfile, setRefProfile] = useState<RefProfile | null>(null);
  const [refPlaying, setRefPlaying] = useState(false);

  // Engine
  const [engineOn, setEngineOn] = useState(false);
  const [selfMetrics, setSelfMetrics] = useState<RefMetrics | null>(null);
  const [engineState, setEngineState] = useState<{ bpm: number; key: string; section: string; style: string }>({
    bpm: 145, key: 'phrygian', section: 'INTRO', style: 'dark-psy',
  });

  // Learning
  const [learning, setLearning] = useState(false);
  const [learnState, setLearnState] = useState<any>(null);

  // Reference pursuit status — snapshot of (target, actual) pairs from the engine
  const [pursuit, setPursuit] = useState<any>(null);

  // Style detection (Track D / 19) — top style matches with confidence + reasons
  const [styleMatches, setStyleMatches] = useState<StyleMatch[]>([]);
  // The world the engine is currently using (mirrors engine.currentWorld).
  const [activeWorld, setActiveWorld] = useState<string>('dark-psy');
  // When true, the world selector shows an "AUTO" badge (engine has auto-switched).
  const [autoSwitchActive, setAutoSwitchActive] = useState(false);

  // ── Integration UI state (Task I1-UI) ──
  // Synthesis character (FM / supersaw / wavetable / classic) per track.
  const [synthChar, setSynthChar] = useState<any>(null);
  // Per-track synth-mode overrides (always works — backed by getSynthModeOverrides).
  const [synthOverrides, setSynthOverrides] = useState<Record<number, string>>({});
  // Effects matrix state (per-track EQ/comp/sat + send levels).
  const [effectsState, setEffectsState] = useState<any>(null);
  // Current chord + progression (from HarmonyEngine, Task H1).
  const [currentChord, setCurrentChord] = useState<any>(null);
  const [progressionInfo, setProgressionInfo] = useState<{ chords: any[]; idx: number } | null>(null);
  // Deep pursuit dashboard (harmonic / transient / stereo field metrics).
  const [pursuitDashboard, setPursuitDashboard] = useState<any>(null);
  // Melody engine state (phrase position, tension, call-response).
  const [melodyState, setMelodyState] = useState<any>(null);
  // ── Task A1: deep A/B analysis ──
  // Detected effects + reference timbre + current timbre + comparison +
  // unique elements + synthesis plan. Pulled via engine.getDeepAnalysis().
  const [deepAnalysis, setDeepAnalysis] = useState<any>(null);

  // ── Task D1: DJ-style phase sync ──
  // Live sync status (synced indicator, phase offset, BPM match, downbeat
  // alignment, beat grid). Pulled via engine.getSyncStatus() on every
  // analyzer tick. The toggle state is mirrored locally so the UI shows
  // the user's last choice even before the engine is started.
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [syncEnabled, setSyncEnabled] = useState<boolean>(false);

  // Refs
  const listenerRef = useRef<any>(null);
  const analyzerRef = useRef<any>(null);
  const engineRef = useRef<any>(null);
  const trainerRef = useRef<any>(null);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);

  // Previous deltas per pursuit dimension, used to render convergence arrows.
  const prevDeltaRef = useRef<Record<string, number>>({});
  // Tracks the last world we toasted about, to avoid spamming on every tick.
  const lastSwitchToastRef = useRef<string>('');

  // Load streams
  useEffect(() => {
    fetch('/api/streams.json').then(r => r.json()).then(d => {
      if (d.ok) {
        setStreams(d.streams);
        const https = d.streams.find((s: RadioStream) => s.url.startsWith('https'));
        setStreamId(https?.id || d.streams[0]?.id);
      }
    }).catch(() => {});
  }, []);

  // ─── Reference ────────────────────────────────────────────────────────────

  const connectRef = useCallback(async () => {
    const stream = streams.find(s => s.id === streamId);
    if (!stream) return;
    try {
      const { ReferenceListenerV2 } = await import('@/lib/studio/engine/reference/referenceListenerV2');
      if (listenerRef.current) await listenerRef.current.disconnect();
      const l = new ReferenceListenerV2();
      l.onMetrics(m => {
        setRefMetrics(m);
        if (engineRef.current?.applyMusicalUnderstanding && m.bpm > 0) {
          engineRef.current.applyMusicalUnderstanding({
            key: { root: m.detectedKey?.root ?? 1, scale: m.detectedKey?.scale ?? 'phrygian', confidence: m.detectedKey?.confidence ?? 0 },
            bpm: m.bpm, bpmConfidence: m.bpmConfidence, style: m.detectedStyle?.style ?? 'dark-psy', styleConfidence: m.detectedStyle?.confidence ?? 0,
          });
        }
        if (engineRef.current?.liveTrack) {
          engineRef.current.liveTrack({
            lufs: m.lufs,
            kickDecayMs: m.kickDecayMs,
            spectralCentroid: m.spectralCentroid,
            subEnergy: m.subEnergy,
            lowEnergy: m.lowEnergy,
            midEnergy: m.midEnergy,
            highEnergy: m.highEnergy,
            airEnergy: m.airEnergy,
            transientDensity: m.transientDensity,
            bassDecayMs: m.bassDecayMs,
            stereoWidth: m.stereoWidth,
            energy: m.energy,
            bpm: m.bpm,
            detectedKey: m.detectedKey,
            // ── Task T1: pass the new harmonic-content / transient-shape /
            //    stereo-field metrics so the engine can drive the synthesis
            //    detector + effects pursuit. All optional — undefined is
            //    gracefully handled by the engine.
            spectralCrest: m.spectralCrest,
            hnr: m.hnr,
            inharmonicity: m.inharmonicity,
            spectralSlopeDb: m.spectralSlopeDb,
            transientSharpness: m.transientSharpness,
            transientDecayMs: m.transientDecayMs,
            stereoBalance: m.stereoBalance,
            stereoCorrelation: m.stereoCorrelation,
            msRatio: m.msRatio,
            // ── Task D1: pass the reference listener's phaseInfo (built
            //    from kick-band transients) so the engine's PhaseSync can
            //    phase-lock our beat grid to the radio's. Optional — when
            //    undefined (no kick transients, low confidence, or V1
            //    listener), the PhaseSync gracefully no-ops.
            phaseInfo: m.phaseInfo,
            // ── Task D1 (upgrade): pass the reference listener's grooveInfo
            //    (swing + push/pull feel) so the DJController can match the
            //    radio's groove. Optional — when undefined, the groove
            //    dimension gracefully no-ops.
            grooveInfo: m.grooveInfo,
          });
        }
      });
      l.onProfile(p => setRefProfile(p));
      l.onError(e => toast.error(`Stream error: ${e.message}`));
      const ok = await l.connect(stream);
      if (ok) { l.start(); listenerRef.current = l; setRefConnected(true); toast.success(`Connected: ${stream.name}`); }
    } catch (e) { toast.error(`Connection failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [streamId, streams]);

  const disconnectRef = useCallback(async () => {
    if (listenerRef.current) { await listenerRef.current.disconnect(); listenerRef.current = null; }
    setRefConnected(false); setRefMetrics(null); setRefProfile(null);
  }, []);

  const toggleRefAudio = useCallback(async () => {
    if (refPlaying && refAudioRef.current) { refAudioRef.current.pause(); setRefPlaying(false); return; }
    const stream = streams.find(s => s.id === streamId);
    if (!stream) return;
    try {
      if (!refAudioRef.current) { refAudioRef.current = new Audio(); refAudioRef.current.crossOrigin = 'anonymous'; refAudioRef.current.volume = 0.6; }
      refAudioRef.current.src = stream.url.startsWith('https') ? stream.url : `/api/reference/proxy?stream=${stream.id}&continuous=1`;
      await refAudioRef.current.play();
      setRefPlaying(true);
    } catch (e) { toast.error(`Playback failed: ${e instanceof Error ? e.message : String(e)}`); }
  }, [refPlaying, streamId, streams]);

  // ─── Engine ───────────────────────────────────────────────────────────────

  const startEngine = useCallback(async () => {
    try {
      const { Psy4EngineV2 } = await import('@/lib/studio/engine/psy4EngineV2');
      if (engineRef.current) engineRef.current.stop();
      const engine = new Psy4EngineV2();
      engine.onSectionChange = (s: string) => setEngineState(prev => ({ ...prev, section: s }));
      // Track D: subscribe to world changes so the dropdown + STYLE card follow.
      engine.onWorldChange = (newWorldId: string, reason?: string) => {
        setActiveWorld(newWorldId);
        setWorldId(newWorldId);
        setAutoSwitchActive(true);
        setEngineState(prev => ({ ...prev, style: newWorldId }));
        if (newWorldId !== lastSwitchToastRef.current) {
          lastSwitchToastRef.current = newWorldId;
          const label = WORLD_NAME[newWorldId] ?? newWorldId;
          toast.success(`Auto-switched to ${label}`, {
            description: reason ?? 'Style classifier matched a new world',
          });
        }
      };
      engine.start(worldId);
      engineRef.current = engine;
      setEngineOn(true);
      setActiveWorld(engine.getCurrentWorldId?.() ?? worldId);
      setAutoSwitchActive(false);
      setEngineState({ bpm: (engine as any)._bpm || 145, key: engine.getMusicalKey()?.scale || 'phrygian', section: 'INTRO', style: worldId });

      // Self-analyzer
      const analyser = engine.getAnalyser();
      if (analyser) {
        const { SelfAnalyzer } = await import('@/lib/studio/engine/reference/selfAnalyzer');
        const a = new SelfAnalyzer();
        a.attach(analyser, engine.ctx!);
        a.setEngineBpm((engine as any)._bpm || 145);
        a.onMetrics(m => {
          setSelfMetrics(m);
          a.setEngineBpm((engineRef.current as any)?._bpm || 145);
          if (engineRef.current?.selfTrack) engineRef.current.selfTrack({
            lufs: m.lufs,
            energy: m.energy,
            spectralCentroid: m.spectralCentroid,
            transientDensity: m.transientDensity,
            subEnergy: m.subEnergy,
            highEnergy: m.highEnergy,
          });
          // Refresh pursuit status snapshot for UI display
          if (engineRef.current?.getPursuitStatus) {
            try { setPursuit(engineRef.current.getPursuitStatus()); } catch {}
          }
          // ── Integration UI pulls (Task I1-UI) ──
          // All optional-chained: T1 may or may not have wired the getters yet.
          try {
            if (engineRef.current?.getSynthesisCharacter) {
              setSynthChar(engineRef.current.getSynthesisCharacter());
            }
            if (engineRef.current?.getSynthModeOverrides) {
              setSynthOverrides(engineRef.current.getSynthModeOverrides() || {});
            }
            if (engineRef.current?.getEffectsState) {
              setEffectsState(engineRef.current.getEffectsState());
            }
            if (engineRef.current?.getCurrentChord) {
              setCurrentChord(engineRef.current.getCurrentChord());
            }
            if (engineRef.current?.getCurrentProgression) {
              const chords = engineRef.current.getCurrentProgression();
              const idx = engineRef.current.getChordIdx?.() ?? 0;
              if (Array.isArray(chords)) setProgressionInfo({ chords, idx });
            }
            if (engineRef.current?.getPursuitDashboard) {
              setPursuitDashboard(engineRef.current.getPursuitDashboard());
            }
            if (engineRef.current?.getMelodyState) {
              setMelodyState(engineRef.current.getMelodyState());
            }
            // ── Task A1: pull deep A/B analysis ──
            if (engineRef.current?.getDeepAnalysis) {
              try { setDeepAnalysis(engineRef.current.getDeepAnalysis()); } catch {}
            }
            // ── Task D1: pull DJ sync status + mirror toggle state ──
            // Optional chaining so we degrade gracefully if D1 isn't merged.
            if (engineRef.current?.getSyncStatus) {
              try { setSyncStatus(engineRef.current.getSyncStatus()); } catch {}
            }
            if (engineRef.current?.isSyncEnabled) {
              try { setSyncEnabled(engineRef.current.isSyncEnabled()); } catch {}
            }
          } catch {}
          // Track D: pull style classification + active world on every tick.
          // Optional chaining so we degrade gracefully if Track C isn't merged yet.
          if (engineRef.current?.getStyleClassification) {
            try {
              const matches = engineRef.current.getStyleClassification() as StyleMatch[];
              if (Array.isArray(matches)) setStyleMatches(matches);
            } catch {}
          }
          if (engineRef.current?.getCurrentWorldId) {
            try {
              const cw = engineRef.current.getCurrentWorldId() as string;
              if (cw && cw !== activeWorldRef.current) {
                activeWorldRef.current = cw;
                setActiveWorld(cw);
              }
            } catch {}
          }
          const refM = refMetrics;
          setEngineState(prev => ({
            ...prev,
            bpm: (engineRef.current as any)?._bpm || prev.bpm,
            key: engineRef.current?.getMusicalKey()?.scale || prev.key,
            style: refM?.detectedStyle?.style || prev.style,
          }));
        });
        a.start();
        analyzerRef.current = a;
      }
      toast.success('Engine V2 started');
    } catch (e) { toast.error(`Engine error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [worldId]);

  // Mirror activeWorld in a ref so the polling closure sees the latest value
  // without re-binding on every change (which would re-create the analyzer).
  const activeWorldRef = useRef('dark-psy');
  useEffect(() => { activeWorldRef.current = activeWorld; }, [activeWorld]);

  const stopEngine = useCallback(() => {
    if (analyzerRef.current) { analyzerRef.current.detach(); analyzerRef.current = null; }
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    if (trainerRef.current) { trainerRef.current.stop(); trainerRef.current = null; }
    setEngineOn(false); setSelfMetrics(null); setLearning(false);
    setStyleMatches([]); setPursuit(null);
    // Reset Integration UI state (Task I1-UI) so stale data doesn't persist.
    setSynthChar(null); setSynthOverrides({}); setEffectsState(null);
    setCurrentChord(null); setProgressionInfo(null);
    setPursuitDashboard(null); setMelodyState(null);
    setDeepAnalysis(null);
    // ── Task D1: clear sync status (the engine is gone) ──
    // We DON'T reset syncEnabled — the user's toggle choice persists across
    // restarts. When the engine is restarted, the new engine's PhaseSync
    // will pick up the toggle state on the first toggle click.
    setSyncStatus(null);
    prevDeltaRef.current = {};
    lastSwitchToastRef.current = '';
  }, []);

  // ─── Learning ─────────────────────────────────────────────────────────────

  const startLearning = useCallback(async () => {
    if (!refProfile) { toast.error('Connect reference first'); return; }
    try {
      const { ContinuousTrainer } = await import('@/lib/studio/engine/reference/continuousTrainer');
      if (trainerRef.current) trainerRef.current.stop();
      const t = new ContinuousTrainer({ worldId, seed: 1234, renderDuration: 8, iterationIntervalMs: 12000, maxChangesPerIteration: 2, autoApplyToEngine: true, saveToLocalStorage: true });
      if (engineRef.current) t.setEngine({ setWorld: (p: any) => engineRef.current?.setWorld?.(p) });
      t.onIteration(() => setLearnState({ ...t.getState() }));
      t.onStateChange(s => setLearnState({ ...s }));
      t.start(refProfile);
      trainerRef.current = t;
      setLearning(true);
      toast.success('Learning started');
    } catch (e) { toast.error(`Learning error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [refProfile, worldId]);

  const stopLearning = useCallback(() => {
    if (trainerRef.current) { trainerRef.current.stop(); trainerRef.current = null; }
    setLearning(false);
  }, []);

  // When the user manually selects a world, turn off AUTO mode and apply it live.
  const onUserSelectWorld = useCallback((newWorld: string) => {
    setWorldId(newWorld);
    setActiveWorld(newWorld);
    setAutoSwitchActive(false);
    lastSwitchToastRef.current = newWorld;
    if (engineRef.current) {
      try { engineRef.current.start?.(newWorld); } catch {}
    }
  }, []);

  // ── Task D1: toggle DJ-style phase sync on/off ──
  // Forwards the user's choice to the engine's PhaseSync. The engine's
  // getSyncStatus() will reflect the new state on the next analyzer tick.
  // Safe to call before the engine is started — we just store the choice
  // locally; when the engine starts, the user can toggle again.
  //
  // Task D1 (upgrade): this now toggles MASTER SYNC (the full DJ controller
  // — BPM + phase + key + groove + energy + beat-grid). When on, ALL
  // dimensions are engaged; when off, the engine runs free but the sync
  // state is still computed + exposed for UI display.
  const toggleSync = useCallback(() => {
    const next = !syncEnabled;
    setSyncEnabled(next);
    if (engineRef.current?.setSyncEnabled) {
      try { engineRef.current.setSyncEnabled(next); } catch {}
    }
    if (next) {
      toast.success('MASTER SYNC enabled', {
        description: 'Full DJ controller: BPM + phase + key (Camelot) + groove (swing/push-pull) + energy + beat-grid.',
      });
    } else {
      toast.info('MASTER SYNC disabled', {
        description: 'Engine reverts to free-running (still tracks the radio BPM via applyMusicalUnderstanding).',
      });
    }
  }, [syncEnabled]);

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (listenerRef.current) listenerRef.current.disconnect();
    if (analyzerRef.current) analyzerRef.current.detach();
    if (engineRef.current) engineRef.current.stop();
    if (trainerRef.current) trainerRef.current.stop();
  }, []);

  // ── Integration UI helpers (Task I1-UI) ──

  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const midiToName = (m: number) => {
    if (typeof m !== 'number' || !Number.isFinite(m)) return '—';
    const n = Math.round(m);
    return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
  };
  const CHORD_TYPE_LABEL: Record<string, string> = {
    triad: '', maj7: 'maj7', min7: 'min7', dom7: '7', min9: 'min9',
    maj9: 'maj9', sus2: 'sus2', sus4: 'sus4', dim: 'dim', aug: 'aug', min7b5: 'm7b5',
  };
  const INVERSION_LABEL = ['root', '1st inv', '2nd inv', '3rd inv'];

  // Per-track defaults — mirrors applyWorldPresets() in psy4EngineV2.
  // Used as a fallback when getSynthesisCharacter() is unavailable so the user
  // still sees which synthesis mode each track is running.
  const TRACK_NAMES = ['KICK', 'SNARE', 'HATS', 'PERC', 'BASS', 'LEAD', 'PAD', 'ARP'];
  const TRACK_DEFAULT_MODE: Record<number, string> = {
    0: 'classic', 1: 'classic', 2: 'classic', 3: 'classic',
    4: 'classic', 5: 'fm', 6: 'supersaw', 7: 'wavetable',
  };

  const modeColor = (mode?: string): string => {
    switch (mode) {
      case 'fm': return 'bg-rose-600 text-white border-rose-500';
      case 'supersaw': return 'bg-amber-600 text-white border-amber-500';
      case 'wavetable': return 'bg-emerald-600 text-white border-emerald-500';
      case 'classic': return 'bg-slate-600 text-white border-slate-500';
      default: return 'bg-slate-700 text-slate-200 border-slate-600';
    }
  };
  const modeTextColor = (mode?: string): string => {
    switch (mode) {
      case 'fm': return 'text-rose-400';
      case 'supersaw': return 'text-amber-400';
      case 'wavetable': return 'text-emerald-400';
      default: return 'text-slate-300';
    }
  };

  // Resolve the effective synthesis mode for a track: override first, then
  // synthChar (if T1 has populated it), then the static default.
  const effectiveMode = (trackIdx: number): string => {
    if (synthOverrides?.[trackIdx]) return synthOverrides[trackIdx];
    if (synthChar?.tracks?.[trackIdx]?.mode) return synthChar.tracks[trackIdx].mode;
    if (synthChar?.mode && synthChar?.primaryTrack === trackIdx) return synthChar.mode;
    return TRACK_DEFAULT_MODE[trackIdx] ?? 'classic';
  };

  // Color for a target-vs-actual delta (used by deep pursuit rows).
  const deltaColor = (delta: number | undefined, tol: number): string => {
    if (delta === undefined || !Number.isFinite(delta)) return 'text-slate-500';
    const a = Math.abs(delta);
    if (a <= tol) return 'text-emerald-400';
    if (a <= tol * 3) return 'text-amber-400';
    return 'text-rose-400';
  };

  // Mini horizontal bar for 0..1 normalized values.
  const MiniBar = ({ value, max = 1, color = 'bg-cyan-500' }: { value: number; max?: number; color?: string }) => {
    const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const pct = Math.max(0, Math.min(100, (v / Math.max(0.0001, max)) * 100));
    return (
      <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden" aria-hidden>
        <div className={`h-full ${color} rounded transition-all duration-200`} style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
    );
  };

  // ─── Render helpers ───────────────────────────────────────────────────────

  const refVal = (v?: number) => v !== undefined ? v.toFixed(2) : '—';
  const refDb = (v?: number) => v !== undefined ? `${v.toFixed(1)} dB` : '—';
  const refHz = (v?: number) => v !== undefined ? `${v.toFixed(0)} Hz` : '—';
  const refMs = (v?: number) => v !== undefined ? `${v.toFixed(0)} ms` : '—';

  // ─── Derived style match data ─────────────────────────────────────────────

  const topMatch = styleMatches.length > 0 ? styleMatches[0] : null;
  const top3 = styleMatches.slice(0, 3);
  const topConfidence = topMatch?.confidence ?? 0;

  const confidenceBadgeClass = (c: number) =>
    c > 0.7 ? 'bg-emerald-600 text-white border-emerald-500'
    : c > 0.4 ? 'bg-amber-600 text-white border-amber-500'
    : 'bg-rose-700 text-white border-rose-500';
  const confidenceTextColor = (c: number) =>
    c > 0.7 ? 'text-emerald-400'
    : c > 0.4 ? 'text-amber-400'
    : 'text-rose-400';

  // ─── Convergence computation for the pursuit card ─────────────────────────

  type PursuitRow = {
    label: string; target: number; actual: number; unit: string;
    tol: number; delta: number; absDelta: number; arrow: 'up' | 'down' | 'ok' | 'idle';
    color: string;
  };

  const pursuitRows: PursuitRow[] = useMemo(() => {
    if (!pursuit) return [];
    const defs: [string, number, number, string, number][] = [
      ['Kick decay',    pursuit.kickDecay?.target ?? 0,        pursuit.kickDecay?.actual ?? 0,        's',  0.005],
      ['Centroid',      pursuit.centroid?.target ?? 0,         pursuit.centroid?.actual ?? 0,         'Hz', 50],
      ['Transient',     pursuit.transientDensity?.target ?? 0, pursuit.transientDensity?.actual ?? 0, '/s', 0.5],
      ['BPM',           pursuit.bpm?.target ?? 0,              pursuit.bpm?.actual ?? 0,              '',   0.5],
    ];
    return defs.map(([label, target, actual, unit, tol]) => {
      const delta = actual - target;
      const absDelta = Math.abs(delta);
      const isActive = target > 0;
      const prev = prevDeltaRef.current[label];
      prevDeltaRef.current[label] = absDelta;
      let arrow: PursuitRow['arrow'] = 'idle';
      if (isActive) {
        if (absDelta <= tol) arrow = 'ok';
        else if (prev === undefined) arrow = 'idle';
        else if (absDelta < prev - 1e-6) arrow = 'up';
        else if (absDelta > prev + 1e-6) arrow = 'down';
        else arrow = 'idle';
      }
      const color = !isActive ? 'text-slate-500'
        : absDelta <= tol ? 'text-emerald-400'
        : absDelta <= tol * 3 ? 'text-amber-400'
        : 'text-rose-400';
      return { label, target, actual, unit, tol, delta, absDelta, arrow, color };
    });
  }, [pursuit]);

  const ArrowIcon = ({ a }: { a: PursuitRow['arrow'] }) => {
    if (a === 'up')   return <TrendingUp className="w-3 h-3 inline mr-0.5 text-emerald-400" aria-label="converging" />;
    if (a === 'down') return <TrendingDown className="w-3 h-3 inline mr-0.5 text-rose-400" aria-label="diverging" />;
    if (a === 'ok')   return <Check className="w-3 h-3 inline mr-0.5 text-emerald-400" aria-label="within tolerance" />;
    return <span className="text-slate-600 mr-0.5">·</span>;
  };

  // ─── Spectral A/B bands ───────────────────────────────────────────────────

  const spectralBands = useMemo(() => {
    return SPECTRAL_BANDS.map(b => {
      const r = refMetrics ? (refMetrics as any)[b.key] as number | undefined : undefined;
      const o = selfMetrics ? (selfMetrics as any)[b.key] as number | undefined : undefined;
      const refNorm  = r !== undefined ? Math.min(1, Math.max(0, r)) : 0;
      const ownNorm  = o !== undefined ? Math.min(1, Math.max(0, o)) : 0;
      const delta    = (r !== undefined && o !== undefined) ? (o - r) : null;
      return { ...b, ref: r, own: o, refNorm, ownNorm, delta };
    });
  }, [refMetrics, selfMetrics]);

  const spectralDeltaColor = (d: number | null) =>
    d === null ? 'text-slate-500'
    : Math.abs(d) < 0.1 ? 'text-emerald-400'
    : Math.abs(d) < 0.2 ? 'text-amber-400'
    : 'text-rose-400';

  // Custom scrollbar styling for long lists (Tailwind utility classes only).
  const scrollList = 'max-h-96 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgb(71_85_105)_transparent]';

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Toaster />
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Radio className="w-7 h-7 text-fuchsia-400" />
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">PSY4 ENGINE V2</h1>
              <p className="text-[10px] text-slate-400 font-mono">POOLED VOICES · FACTORY PRESETS · LIVE SYNC · STYLE DETECTION</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={refConnected ? 'default' : 'secondary'} className="font-mono text-[10px]">
              {refConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
              {refConnected ? 'REF LIVE' : 'REF OFF'}
            </Badge>
            <Badge variant={engineOn ? 'default' : 'secondary'} className="font-mono text-[10px]">
              <Activity className="w-3 h-3 mr-1" />
              {engineOn ? `ENGINE ${engineState.bpm} BPM` : 'ENGINE OFF'}
            </Badge>
            {autoSwitchActive && (
              <Badge className="bg-fuchsia-600 text-white animate-pulse text-[10px]"><Shuffle className="w-3 h-3 mr-1" />AUTO</Badge>
            )}
            {learning && <Badge className="bg-emerald-600 text-white animate-pulse text-[10px]"><Brain className="w-3 h-3 mr-1" />LEARNING</Badge>}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 space-y-4">
        {/* Mode + Stream + World */}
        <Card className="border-slate-800 bg-slate-900/60">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              {(['listen', 'analyze', 'train'] as Mode[]).map(m => (
                <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)} className={mode === m ? 'bg-fuchsia-600 hover:bg-fuchsia-700' : ''}>{m.toUpperCase()}</Button>
              ))}
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <select
                  value={streamId}
                  onChange={e => setStreamId(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                  aria-label="Reference stream"
                >
                  {streams.map(s => <option key={s.id} value={s.id}>{s.name} ({s.bitrate}kbps)</option>)}
                </select>
                <div className="flex items-center gap-1">
                  {autoSwitchActive && (
                    <Badge className="bg-fuchsia-600 text-white text-[9px] px-1 py-0 font-mono">AUTO</Badge>
                  )}
                  <select
                    value={worldId}
                    onChange={e => onUserSelectWorld(e.target.value)}
                    className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                    aria-label="Active world"
                  >
                    {WORLD_OPTIONS.map(w => (
                      <option key={w.id} value={w.id}>{w.name} — {w.description}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transport */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Reference */}
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Radio className="w-4 h-4 text-fuchsia-400" /> REFERENCE</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                {!refConnected ? (
                  <Button onClick={connectRef} size="sm" className="bg-emerald-600 hover:bg-emerald-700"><Wifi className="w-4 h-4 mr-1" /> CONNECT</Button>
                ) : (
                  <Button onClick={disconnectRef} size="sm" variant="destructive"><WifiOff className="w-4 h-4 mr-1" /> DISCONNECT</Button>
                )}
                {refConnected && (
                  <Button onClick={toggleRefAudio} size="sm" variant={refPlaying ? 'secondary' : 'outline'} className={refPlaying ? 'bg-amber-600 text-white' : ''}>
                    {refPlaying ? <Volume2 className="w-4 h-4 mr-1" /> : <VolumeX className="w-4 h-4 mr-1" />}
                    {refPlaying ? 'STOP' : 'PLAY'}
                  </Button>
                )}
              </div>
              {refProfile && <div className="text-[10px] font-mono text-slate-400">{refProfile.windowCount} windows · BPM {refProfile.bpm.mean.toFixed(0)} · LUFS {refProfile.lufs.mean.toFixed(1)}</div>}
              {refMetrics?.detectedKey && <div className="text-[10px] font-mono text-emerald-400">Key: {refMetrics.detectedKey.rootName} {refMetrics.detectedKey.scale} (conf {refMetrics.detectedKey.confidence.toFixed(2)})</div>}
            </CardContent>
          </Card>

          {/* Engine */}
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Activity className="w-4 h-4 text-cyan-400" /> ENGINE V2</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                {!engineOn ? (
                  <Button onClick={startEngine} size="sm" className="bg-cyan-600 hover:bg-cyan-700"><Play className="w-4 h-4 mr-1" /> START</Button>
                ) : (
                  <Button onClick={stopEngine} size="sm" variant="destructive"><Square className="w-4 h-4 mr-1" /> STOP</Button>
                )}
              </div>
              {engineOn && (
                <div className="text-[10px] font-mono text-slate-400">
                  BPM: <span className="text-cyan-400">{engineState.bpm}</span> · Key: <span className="text-cyan-400">{engineState.key}</span> · Style: <span className="text-fuchsia-400">{engineState.style}</span> · Section: <span className="text-cyan-400">{engineState.section}</span>
                </div>
              )}
              {engineOn && (
                <div className="text-[10px] font-mono text-slate-400">
                  Active world: <span className="text-fuchsia-400">{WORLD_NAME[activeWorld] ?? activeWorld}</span>
                  <span className="text-slate-600"> ({activeWorld})</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* STYLE DETECTION CARD (Task 19) — visible in listen + analyze */}
        {(mode === 'listen' || mode === 'analyze') && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-amber-400" />
                STYLE DETECTION
                {topMatch && (
                  <Badge className={`ml-2 font-mono text-[10px] border ${confidenceBadgeClass(topConfidence)}`}>
                    {(topConfidence * 100).toFixed(0)}% {topMatch.style.toUpperCase()}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Active world + detected style */}
                <div className="md:col-span-1 space-y-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Active World</div>
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center gap-2">
                      <Music className="w-4 h-4 text-fuchsia-400" />
                      <span className="text-sm font-semibold text-fuchsia-300">{WORLD_NAME[activeWorld] ?? activeWorld}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-1">{activeWorld}</div>
                  </div>
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mt-2">Detected Style</div>
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    {topMatch ? (
                      <>
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm font-semibold text-amber-300">{topMatch.style}</span>
                          <span className={`text-sm font-mono font-bold ${confidenceTextColor(topConfidence)}`}>
                            {(topConfidence * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 bg-slate-800 rounded overflow-hidden">
                          <div
                            className={`h-full rounded ${topConfidence > 0.7 ? 'bg-emerald-500' : topConfidence > 0.4 ? 'bg-amber-500' : 'bg-rose-500'}`}
                            style={{ width: `${Math.min(100, topConfidence * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-slate-500 font-mono">
                        {engineOn ? 'Awaiting classification…' : 'Start engine to detect style'}
                      </div>
                    )}
                  </div>
                </div>

                {/* Top 3 ranked matches */}
                <div className="md:col-span-1 space-y-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Top 3 Matches</div>
                  <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
                    {top3.length === 0 ? (
                      <div className="text-[11px] text-slate-500 font-mono">No matches yet</div>
                    ) : top3.map((m, i) => {
                      const c = m.confidence;
                      return (
                        <div key={`${m.style}-${i}`} className="space-y-1">
                          <div className="flex items-center justify-between text-[11px] font-mono">
                            <span className="flex items-center gap-1">
                              <span className={`w-4 text-center ${i === 0 ? 'text-amber-300 font-bold' : 'text-slate-400'}`}>#{i + 1}</span>
                              <span className={i === 0 ? 'text-slate-100' : 'text-slate-300'}>{m.style}</span>
                            </span>
                            <span className={`font-bold ${confidenceTextColor(c)}`}>{(c * 100).toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-800 rounded overflow-hidden">
                            <div
                              className={`h-full rounded ${c > 0.7 ? 'bg-emerald-500' : c > 0.4 ? 'bg-amber-500' : 'bg-rose-500'}`}
                              style={{ width: `${Math.min(100, c * 100).toFixed(1)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Reasons for the top match */}
                <div className="md:col-span-1 space-y-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Why this style?</div>
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    {topMatch?.reasons && topMatch.reasons.length > 0 ? (
                      <ul className={`space-y-1 text-[11px] font-mono text-slate-300 ${scrollList}`}>
                        {topMatch.reasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5">
                            <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-400" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-[11px] text-slate-500 font-mono">
                        {topMatch ? 'No detailed reasons provided' : 'Start engine and connect reference'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Auto-switch hint */}
              {autoSwitchActive && (
                <div className="text-[10px] font-mono text-fuchsia-400 flex items-center gap-1">
                  <Shuffle className="w-3 h-3" />
                  AUTO-SWITCH active — engine follows the detected style automatically. Pick a world manually to override.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── DJ CONTROLLER (Task D1 — full DJ sync) ─── */}
        {/* Full DJ-style sync — BPM + phase + key (Camelot harmonic mixing)
            + groove (swing + push/pull) + energy (smoothed + transition
            detection) + beat-grid / phrase alignment. The Pioneer CDJ /
            Traktor / Serato sync model applied to a generative psytrance
            engine. Visible in listen + analyze + train when the engine is
            running. When MASTER SYNC is on, all dimensions are engaged;
            when off, the engine runs free but the sync state is still
            computed + displayed (so the user can see how far off we are). */}
        {(mode === 'listen' || mode === 'analyze' || mode === 'train') && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Disc3 className={`w-4 h-4 ${syncEnabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                DJ CONTROLLER
                <span className="text-[10px] text-slate-500 font-mono ml-2">bpm · phase · key · groove · energy · phrase</span>
                {/* Toggle button — top-right of the header */}
                <button
                  type="button"
                  onClick={toggleSync}
                  className={`ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono font-bold border transition-colors ${
                    syncEnabled
                      ? 'bg-emerald-600 text-white border-emerald-500 hover:bg-emerald-700'
                      : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'
                  }`}
                  aria-pressed={syncEnabled}
                  aria-label={syncEnabled ? 'Disable master sync' : 'Enable master sync'}
                >
                  {syncEnabled ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
                  {syncEnabled ? 'MASTER' : 'FREE-RUN'}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!syncEnabled ? (
                <div className="bg-slate-950 border border-slate-800 rounded p-4 text-center">
                  <div className="text-[11px] text-slate-400 font-mono">
                    MASTER SYNC is off — the engine runs free (still tracks the radio BPM via
                    applyMusicalUnderstanding, but does NOT phase-lock or harmonic-match).
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Click <span className="text-emerald-400 font-bold">FREE-RUN</span> above to engage
                    full DJ sync (BPM + phase + key + groove + energy + phrase).
                  </div>
                </div>
              ) : !syncStatus || (!syncStatus.refBpm && !syncStatus.ownBpm) ? (
                <div className="bg-slate-950 border border-slate-800 rounded p-4 text-center">
                  <div className="text-[11px] text-amber-400 font-mono">
                    ⚠ Waiting for sync data — connect a stream and let the engine play. The reference
                    listener extracts beat phase, key, groove, and energy every ~10s; the engine
                    records its own beats from <code className="text-cyan-400">triggerDrum(0, ...)</code>.
                  </div>
                </div>
              ) : (
                <>
                  {/* ── Master sync quality bar (prominent at top) ── */}
                  {/* Aggregates all dimensions into a single 0..100 score.
                      Weights: phase+BPM 40%, key 25%, energy 15%, groove 10%,
                      phrase 10%. This is the headline number a DJ would look
                      at — "how locked is the mix?". */}
                  <div className={`bg-slate-950 border rounded p-3 ${
                    syncStatus.syncQuality > 80 ? 'border-emerald-700'
                    : syncStatus.syncQuality > 60 ? 'border-amber-700'
                    : 'border-rose-800'
                  }`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Disc3 className={`w-3.5 h-3.5 ${
                          syncStatus.syncQuality > 80 ? 'text-emerald-400 animate-spin'
                          : syncStatus.syncQuality > 60 ? 'text-amber-400'
                          : 'text-rose-400'
                        }`} style={syncStatus.syncQuality > 80 ? { animationDuration: '3s' } : undefined} />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Master Sync Quality</span>
                      </div>
                      <span className={`text-lg font-bold font-mono ${
                        syncStatus.syncQuality > 80 ? 'text-emerald-300'
                        : syncStatus.syncQuality > 60 ? 'text-amber-300'
                        : 'text-rose-300'
                      }`}>
                        {syncStatus.syncQuality.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-800 rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-300 ${
                          syncStatus.syncQuality > 80 ? 'bg-emerald-500'
                          : syncStatus.syncQuality > 60 ? 'bg-amber-500'
                          : 'bg-rose-500'
                        }`}
                        style={{ width: `${syncStatus.syncQuality.toFixed(1)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-[9px] font-mono">
                      <span className={syncStatus.synced ? 'text-emerald-400' : 'text-rose-400'}>
                        ● phase {syncStatus.synced ? 'LOCKED' : 'DRIFT'}
                      </span>
                      <span className={syncStatus.keySynced ? 'text-emerald-400' : 'text-amber-400'}>
                        ● key {syncStatus.keySynced ? 'MATCHED' : 'OFF'}
                      </span>
                      <span className={syncStatus.grooveSynced ? 'text-emerald-400' : 'text-amber-400'}>
                        ● groove {syncStatus.grooveSynced ? 'GROOVE' : 'OFF'}
                      </span>
                      <span className={syncStatus.energySynced ? 'text-emerald-400' : 'text-amber-400'}>
                        ● energy {syncStatus.energySynced ? 'FOLLOW' : 'OFF'}
                      </span>
                      <span className={syncStatus.beatGridAligned ? 'text-emerald-400' : 'text-amber-400'}>
                        ● phrase {syncStatus.beatGridAligned ? 'ALIGNED' : 'OFF'}
                      </span>
                    </div>
                  </div>

                  {/* ── Status grid: synced / offset / BPM / downbeat ── */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* SYNCED indicator */}
                    <div className={`bg-slate-950 border rounded p-3 ${syncStatus.synced ? 'border-emerald-700' : 'border-rose-800'}`}>
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Status</div>
                      <div className={`flex items-center gap-1.5 ${syncStatus.synced ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {syncStatus.synced ? <Check className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                        <span className="text-base font-bold font-mono">{syncStatus.synced ? 'LOCKED' : 'DRIFT'}</span>
                      </div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                        conf {(syncStatus.confidence * 100).toFixed(0)}%
                      </div>
                    </div>

                    {/* Phase offset */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Phase Offset</div>
                      <div className="flex items-baseline gap-1">
                        <span className={`text-base font-bold font-mono ${
                          Math.abs(syncStatus.offsetMs) < 16 ? 'text-emerald-300'
                          : Math.abs(syncStatus.offsetMs) < 50 ? 'text-amber-300'
                          : 'text-rose-300'
                        }`}>
                          {syncStatus.offsetMs > 0 ? '+' : ''}{syncStatus.offsetMs.toFixed(1)}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">ms</span>
                      </div>
                      <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                        target {syncStatus.targetOffsetMs > 0 ? '+' : ''}{syncStatus.targetOffsetMs.toFixed(0)}ms
                      </div>
                    </div>

                    {/* BPM match */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">BPM Match</div>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[10px] font-mono text-fuchsia-300">{syncStatus.refBpm.toFixed(1)}</span>
                        <span className="text-[9px] text-slate-600">vs</span>
                        <span className="text-[10px] font-mono text-cyan-300">{syncStatus.ownBpm.toFixed(1)}</span>
                      </div>
                      <div className="mt-1">
                        <div className="flex justify-between text-[9px] font-mono mb-0.5">
                          <span className="text-slate-500">match</span>
                          <span className={`${
                            syncStatus.bpmMatchPct > 90 ? 'text-emerald-300'
                            : syncStatus.bpmMatchPct > 70 ? 'text-amber-300'
                            : 'text-rose-300'
                          }`}>{syncStatus.bpmMatchPct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all duration-200 ${
                              syncStatus.bpmMatchPct > 90 ? 'bg-emerald-500'
                              : syncStatus.bpmMatchPct > 70 ? 'bg-amber-500'
                              : 'bg-rose-500'
                            }`}
                            style={{ width: `${syncStatus.bpmMatchPct.toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Downbeat alignment */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Downbeat Align</div>
                      <div className={`text-base font-bold font-mono ${
                        syncStatus.downbeatAlignment > 85 ? 'text-emerald-300'
                        : syncStatus.downbeatAlignment > 50 ? 'text-amber-300'
                        : 'text-rose-300'
                      }`}>
                        {syncStatus.downbeatAlignment.toFixed(0)}%
                      </div>
                      <div className="mt-1">
                        <div className="h-1 w-full bg-slate-800 rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all duration-200 ${
                              syncStatus.downbeatAlignment > 85 ? 'bg-emerald-500'
                              : syncStatus.downbeatAlignment > 50 ? 'bg-amber-500'
                              : 'bg-rose-500'
                            }`}
                            style={{ width: `${syncStatus.downbeatAlignment.toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── KEY sync (Camelot harmonic mixing) ── */}
                  {/* Shows the reference key vs our key, mapped to Camelot
                      wheel positions (e.g., 8A = A minor). Compatibility %
                      is the harmonic-mixing score (0..1). When the radio's
                      key is incompatible, the suggested shift (semitones)
                      is shown — when master sync is on, the engine applies
                      this shift gradually (1 semitone per bar) to reach
                      the nearest compatible key. */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-violet-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Key Sync · Camelot</span>
                      </div>
                      <span className={`text-[10px] font-mono font-bold ${syncStatus.keySynced ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {syncStatus.keySynced ? '● MATCHED' : '○ MISMATCH'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {/* Reference key */}
                      <div className="bg-slate-900 border border-fuchsia-900 rounded p-2 text-center">
                        <div className="text-[9px] text-slate-500 font-mono uppercase">REF</div>
                        <div className="text-base font-bold font-mono text-fuchsia-300">
                          {syncStatus.refCamelot ?? '—'}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {syncStatus.refKey ? `${syncStatus.refKey.root} ${syncStatus.refKey.scale}`.slice(0, 14) : '—'}
                        </div>
                      </div>
                      {/* Compatibility */}
                      <div className="bg-slate-900 border border-slate-700 rounded p-2 text-center">
                        <div className="text-[9px] text-slate-500 font-mono uppercase">Compat</div>
                        <div className={`text-base font-bold font-mono ${
                          syncStatus.keyCompatibility > 0.8 ? 'text-emerald-300'
                          : syncStatus.keyCompatibility > 0.5 ? 'text-amber-300'
                          : 'text-rose-300'
                        }`}>
                          {(syncStatus.keyCompatibility * 100).toFixed(0)}%
                        </div>
                        <div className="h-1 w-full bg-slate-800 rounded overflow-hidden mt-1">
                          <div
                            className={`h-full rounded transition-all duration-200 ${
                              syncStatus.keyCompatibility > 0.8 ? 'bg-emerald-500'
                              : syncStatus.keyCompatibility > 0.5 ? 'bg-amber-500'
                              : 'bg-rose-500'
                            }`}
                            style={{ width: `${(syncStatus.keyCompatibility * 100).toFixed(1)}%` }}
                          />
                        </div>
                      </div>
                      {/* Own key */}
                      <div className="bg-slate-900 border border-cyan-900 rounded p-2 text-center">
                        <div className="text-[9px] text-slate-500 font-mono uppercase">OURS</div>
                        <div className="text-base font-bold font-mono text-cyan-300">
                          {syncStatus.ownCamelot ?? '—'}
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-0.5">
                          {syncStatus.ownKey ? `${syncStatus.ownKey.root} ${syncStatus.ownKey.scale}`.slice(0, 14) : '—'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <div className="text-slate-500">
                        suggested shift: <span className={syncStatus.suggestedShift === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                          {syncStatus.suggestedShift > 0 ? '+' : ''}{syncStatus.suggestedShift} st
                        </span>
                      </div>
                      <div className="text-slate-500">
                        applied: <span className={syncStatus.appliedShift === 0 ? 'text-slate-400' : 'text-violet-400'}>
                          {syncStatus.appliedShift > 0 ? '+' : ''}{syncStatus.appliedShift} st
                        </span>
                        {syncStatus.appliedShift !== 0 && <span className="text-emerald-400 ml-1">· live</span>}
                      </div>
                    </div>
                  </div>

                  {/* ── GROOVE sync (swing + push/pull) ── */}
                  {/* Shows the reference groove vs our groove: swing amount
                      (0..0.5) and push/pull feel (ms, signed). The match %
                      combines both. When master sync is on, our swing
                      converges toward the radio's swing (≤0.02/bar) and
                      the push/pull offset is applied to the scheduler
                      (capped at ±30ms — glitch-free). */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Drum className="w-3.5 h-3.5 text-orange-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Groove Sync · swing + push/pull</span>
                      </div>
                      <span className={`text-[10px] font-mono font-bold ${syncStatus.grooveSynced ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {syncStatus.grooveSynced ? '● GROOVE' : '○ ADJUSTING'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Swing */}
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-mono mb-1">
                          <span className="text-slate-500 uppercase tracking-wider">Swing</span>
                          <span className={syncStatus.grooveMatch > 0.85 ? 'text-emerald-300' : syncStatus.grooveMatch > 0.5 ? 'text-amber-300' : 'text-rose-300'}>
                            {(syncStatus.grooveMatch * 100).toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-[10px] font-mono text-fuchsia-300">{(syncStatus.refSwing * 100).toFixed(0)}%</span>
                          <span className="text-[9px] text-slate-600">vs</span>
                          <span className="text-[10px] font-mono text-cyan-300">{(syncStatus.ownSwing * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                          <div className="h-full bg-fuchsia-500 rounded transition-all duration-200" style={{ width: `${(syncStatus.refSwing * 200).toFixed(1)}%` }} />
                        </div>
                        <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden mt-0.5">
                          <div className="h-full bg-cyan-500 rounded transition-all duration-200" style={{ width: `${(syncStatus.ownSwing * 200).toFixed(1)}%` }} />
                        </div>
                      </div>
                      {/* Push/pull */}
                      <div>
                        <div className="flex items-baseline justify-between text-[10px] font-mono mb-1">
                          <span className="text-slate-500 uppercase tracking-wider">Push/Pull</span>
                          <span className={`${
                            Math.abs(syncStatus.pushPullMs) < 8 ? 'text-emerald-300'
                            : Math.abs(syncStatus.pushPullMs) < 20 ? 'text-amber-300'
                            : 'text-rose-300'
                          }`}>
                            {syncStatus.pushPullMs > 0 ? '+' : ''}{syncStatus.pushPullMs.toFixed(1)}ms
                          </span>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mb-1">
                          {syncStatus.pushPullMs > 8 ? 'laid back ↓' : syncStatus.pushPullMs < -8 ? 'pushed ↑' : 'on grid ●'}
                        </div>
                        {/* Push/pull meter — center = 0, left = pushed, right = laid back */}
                        <div className="relative h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-600" />
                          <div
                            className={`absolute top-0 bottom-0 rounded transition-all duration-200 ${
                              Math.abs(syncStatus.pushPullMs) < 8 ? 'bg-emerald-500'
                              : Math.abs(syncStatus.pushPullMs) < 20 ? 'bg-amber-500'
                              : 'bg-rose-500'
                            }`}
                            style={
                              syncStatus.pushPullMs >= 0
                                ? { left: '50%', width: `${Math.min(50, Math.abs(syncStatus.pushPullMs) / 60 * 100).toFixed(1)}%` }
                                : { right: '50%', width: `${Math.min(50, Math.abs(syncStatus.pushPullMs) / 60 * 100).toFixed(1)}%` }
                            }
                          />
                        </div>
                        <div className="flex justify-between text-[8px] font-mono text-slate-600 mt-0.5">
                          <span>pushed</span>
                          <span>laid back</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── ENERGY sync (smoothed + transition detection) ── */}
                  {/* Shows the reference energy (4-bar smoothed) vs our own
                      energy (current flow density as proxy). The transition
                      indicator flags build / drop / break / rise events so
                      the user can see when the radio's energy curve is
                      shifting. When master sync is on, the engine's phrase
                      realignment triggers on transitions (drop / break). */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Energy Sync · smoothed (4-bar MA)</span>
                      </div>
                      <span className={`text-[10px] font-mono font-bold ${syncStatus.energySynced ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {syncStatus.energySynced ? '● FOLLOW' : '○ CHASING'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between mb-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-mono text-fuchsia-300">{(syncStatus.refEnergySmoothed * 100).toFixed(0)}%</span>
                        <span className="text-[9px] text-slate-600">vs</span>
                        <span className="text-[10px] font-mono text-cyan-300">{(syncStatus.ownEnergy * 100).toFixed(0)}%</span>
                      </div>
                      <span className={`text-[10px] font-mono ${
                        Math.abs(syncStatus.energyDelta) < 0.12 ? 'text-emerald-300'
                        : Math.abs(syncStatus.energyDelta) < 0.25 ? 'text-amber-300'
                        : 'text-rose-300'
                      }`}>
                        Δ {syncStatus.energyDelta > 0 ? '+' : ''}{syncStatus.energyDelta.toFixed(2)}
                      </span>
                    </div>
                    {/* Two-row bar (ref + ours) */}
                    <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                      <div className="h-full bg-fuchsia-500 rounded transition-all duration-200" style={{ width: `${(syncStatus.refEnergySmoothed * 100).toFixed(1)}%` }} />
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden mt-0.5">
                      <div className="h-full bg-cyan-500 rounded transition-all duration-200" style={{ width: `${(syncStatus.ownEnergy * 100).toFixed(1)}%` }} />
                    </div>
                    {/* Transition indicator */}
                    <div className="flex items-center justify-between mt-2 text-[10px] font-mono">
                      <span className="text-slate-500 uppercase tracking-wider">transition</span>
                      {syncStatus.energyTransition === 'none' ? (
                        <span className="text-slate-400">— stable</span>
                      ) : syncStatus.energyTransition === 'drop' ? (
                        <span className="text-rose-400 font-bold flex items-center gap-1">
                          <Zap className="w-3 h-3" /> DROP
                        </span>
                      ) : syncStatus.energyTransition === 'break' ? (
                        <span className="text-sky-400 font-bold flex items-center gap-1">
                          <Waves className="w-3 h-3" /> BREAK
                        </span>
                      ) : syncStatus.energyTransition === 'build' ? (
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" /> BUILD
                        </span>
                      ) : (
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <ArrowUp className="w-3 h-3" /> RISE
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── BEAT-GRID / PHRASE alignment ── */}
                  {/* Shows the reference bar-in-phrase vs our own. A phrase
                      is 4 bars (psytrance standard). When the radio hits a
                      phrase boundary (drop / break), our bar-in-phrase
                      should be 0 too — if not, master sync snaps us to bar
                      0 on the next transition (the "cut short and drop now"
                      DJ move). */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <LayoutGrid className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                          Beat-Grid · phrase ({syncStatus.phraseLengthBars}-bar)
                        </span>
                      </div>
                      <span className={`text-[10px] font-mono font-bold ${syncStatus.beatGridAligned ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {syncStatus.beatGridAligned ? '● ALIGNED' : '○ DRIFT'}
                      </span>
                    </div>
                    {/* Phrase visualization: 4 cells per phrase, ref row + ours row */}
                    {(() => {
                      const refBar = syncStatus.refBarInPhrase ?? 0;
                      const ownBar = syncStatus.ownBarInPhrase ?? 0;
                      const phraseLen = syncStatus.phraseLengthBars ?? 4;
                      const cells = Array.from({ length: phraseLen }, (_, i) => i);
                      const renderPhraseRow = (label: string, current: number, color: 'fuchsia' | 'cyan') => {
                        const colorClasses = color === 'fuchsia'
                          ? { active: 'bg-fuchsia-500 border-fuchsia-300', idle: 'bg-fuchsia-950 border-fuchsia-900', text: 'text-fuchsia-300' }
                          : { active: 'bg-cyan-500 border-cyan-300', idle: 'bg-cyan-950 border-cyan-900', text: 'text-cyan-300' };
                        return (
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-mono ${colorClasses.text} w-10`}>{label}</span>
                            <div className="flex-1 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${phraseLen}, 1fr)` }}>
                              {cells.map(b => {
                                const isActive = b === current;
                                const isStart = b === 0;
                                return (
                                  <div
                                    key={b}
                                    className={`relative h-6 rounded border flex items-center justify-center transition-all duration-100 ${
                                      isActive ? colorClasses.active : colorClasses.idle
                                    } ${isStart ? 'ring-1 ring-offset-1 ring-offset-slate-950' : ''}`}
                                    style={isStart ? { boxShadow: `0 0 0 1px ${color === 'fuchsia' ? 'rgb(217 70 239)' : 'rgb(34 211 238)'}` } : undefined}
                                  >
                                    <span className={`text-[9px] font-mono font-bold ${isActive ? 'text-white' : 'text-slate-600'}`}>
                                      {b + 1}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      };
                      return (
                        <div className="space-y-1.5">
                          {renderPhraseRow('REF', refBar, 'fuchsia')}
                          {renderPhraseRow('OURS', ownBar, 'cyan')}
                        </div>
                      );
                    })()}
                    <div className="text-[10px] text-slate-500 font-mono mt-2 flex flex-wrap gap-3">
                      <span><span className="inline-block w-2 h-2 bg-fuchsia-500 rounded-sm mr-1" />radio bar-in-phrase</span>
                      <span><span className="inline-block w-2 h-2 bg-cyan-500 rounded-sm mr-1" />engine bar-in-phrase</span>
                      <span><span className="inline-block w-2 h-2 border-2 border-fuchsia-300 rounded-sm mr-1" />phrase start</span>
                    </div>
                  </div>

                  {/* ── Beat grid visualization (per-bar, 4 beats) ── */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2 flex items-center justify-between">
                      <span>Beat Grid (in-bar)</span>
                      {syncStatus.beatDropPending && (
                        <span className="text-amber-400 font-bold flex items-center gap-1">
                          <Zap className="w-3 h-3" /> beat-drop pending
                        </span>
                      )}
                    </div>
                    {(() => {
                      const refDb = syncStatus.refDownbeat ?? 0;
                      const ownDb = syncStatus.ownDownbeat ?? 0;
                      const refPhase = syncStatus.refPhase ?? 0;
                      const ownPhase = syncStatus.ownPhase ?? 0;
                      const beats = [0, 1, 2, 3];
                      const renderRow = (label: string, current: number, phase: number, color: 'fuchsia' | 'cyan') => {
                        const colorClasses = color === 'fuchsia'
                          ? { active: 'bg-fuchsia-500 border-fuchsia-300', idle: 'bg-fuchsia-950 border-fuchsia-800', text: 'text-fuchsia-300', downbeat: 'bg-fuchsia-400' }
                          : { active: 'bg-cyan-500 border-cyan-300', idle: 'bg-cyan-950 border-cyan-800', text: 'text-cyan-300', downbeat: 'bg-cyan-400' };
                        return (
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-mono ${colorClasses.text} w-10`}>{label}</span>
                            <div className="flex-1 grid grid-cols-4 gap-1.5">
                              {beats.map(b => {
                                const isActive = b === current;
                                const isDownbeat = b === 0;
                                return (
                                  <div
                                    key={b}
                                    className={`relative h-8 rounded border-2 flex items-center justify-center transition-all duration-100 ${
                                      isActive ? colorClasses.active : colorClasses.idle
                                    } ${isDownbeat ? 'ring-1 ring-offset-1 ring-offset-slate-950' : ''}`}
                                    style={isDownbeat ? { boxShadow: `0 0 0 1px ${color === 'fuchsia' ? 'rgb(217 70 239)' : 'rgb(34 211 238)'}` } : undefined}
                                  >
                                    <span className={`text-[10px] font-mono font-bold ${isActive ? 'text-white' : 'text-slate-600'}`}>
                                      {b + 1}
                                    </span>
                                    {/* Phase progress bar at the bottom of the active beat */}
                                    {isActive && (
                                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30 rounded-b">
                                        <div
                                          className={`h-full ${colorClasses.downbeat} rounded-b transition-all duration-75`}
                                          style={{ width: `${(phase * 100).toFixed(1)}%` }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      };
                      return (
                        <div className="space-y-2">
                          {renderRow('REF', refDb, refPhase, 'fuchsia')}
                          {renderRow('OURS', ownDb, ownPhase, 'cyan')}
                        </div>
                      );
                    })()}
                    <div className="text-[10px] text-slate-500 font-mono mt-2 flex flex-wrap gap-3">
                      <span><span className="inline-block w-2 h-2 bg-fuchsia-500 rounded-sm mr-1" />radio beat-in-bar</span>
                      <span><span className="inline-block w-2 h-2 bg-cyan-500 rounded-sm mr-1" />engine beat-in-bar</span>
                      <span><span className="inline-block w-2 h-2 border-2 border-fuchsia-300 rounded-sm mr-1" />downbeat (bar start)</span>
                      <span>Δ {(syncStatus.phaseDiff * 100).toFixed(1)}% phase</span>
                    </div>
                  </div>

                  {/* ── Convergence footer ── */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 uppercase tracking-wider">BPM convergence</span>
                        {Math.abs(syncStatus.convergenceBpmDelta) < 0.1 ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <Check className="w-3 h-3" /> converged
                          </span>
                        ) : (
                          <span className="text-amber-400 flex items-center gap-1">
                            {syncStatus.convergenceBpmDelta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                            {syncStatus.convergenceBpmDelta > 0 ? '+' : ''}{syncStatus.convergenceBpmDelta.toFixed(2)} BPM
                          </span>
                        )}
                      </div>
                      <div className="text-slate-500">
                        phase Δ = {(syncStatus.phaseDiff * 100).toFixed(1)}%
                        {syncStatus.phaseDiff < 0.04 && <span className="text-emerald-400 ml-1">· locked</span>}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* A/B COMPARISON (existing table) */}
        {(mode === 'analyze' || mode === 'train') && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Gauge className="w-4 h-4 text-amber-400" /> A/B COMPARISON</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400 font-mono text-[10px]">METRIC</TableHead>
                    <TableHead className="text-fuchsia-400 font-mono text-[10px]">REFERENCE</TableHead>
                    <TableHead className="text-cyan-400 font-mono text-[10px]">OUR ENGINE</TableHead>
                    <TableHead className="text-amber-400 font-mono text-[10px]">ERROR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    ['BPM', refProfile?.bpm.mean, selfMetrics?.bpm, '', (r: number, o: number) => (o - r).toFixed(1)],
                    ['LUFS', refProfile?.lufs.mean, selfMetrics?.lufs, ' dB', (r: number, o: number) => (o - r).toFixed(1)],
                    ['Sub', refProfile?.subEnergy.mean, selfMetrics?.subEnergy, '', (r: number, o: number) => (o - r).toFixed(2)],
                    ['Low', refProfile?.lowEnergy.mean, selfMetrics?.lowEnergy, '', (r: number, o: number) => (o - r).toFixed(2)],
                    ['Mid', refProfile?.midEnergy.mean, selfMetrics?.midEnergy, '', (r: number, o: number) => (o - r).toFixed(2)],
                    ['High', refProfile?.highEnergy.mean, selfMetrics?.highEnergy, '', (r: number, o: number) => (o - r).toFixed(2)],
                    ['Centroid', refProfile?.spectralCentroid.mean, selfMetrics?.spectralCentroid, ' Hz', (r: number, o: number) => (o - r).toFixed(0)],
                    ['Transient', refProfile?.transientDensity.mean, selfMetrics?.transientDensity, '/s', (r: number, o: number) => (o - r).toFixed(1)],
                    ['Kick decay', refProfile?.kickDecayMs.mean, selfMetrics?.kickDecayMs, 'ms', (r: number, o: number) => (o - r).toFixed(0)],
                    ['Bass decay', refProfile?.bassDecayMs.mean, selfMetrics?.bassDecayMs, 'ms', (r: number, o: number) => (o - r).toFixed(0)],
                    ['Stereo', refProfile?.stereoWidth.mean, selfMetrics?.stereoWidth, '', (r: number, o: number) => (o - r).toFixed(2)],
                    ['Energy', refProfile?.energy.mean, selfMetrics?.energy, '', (r: number, o: number) => (o - r).toFixed(2)],
                  ].map(([label, rv, ov, unit, fn]: any) => {
                    const r = rv ?? 0, o = ov ?? 0;
                    const err = r > 0 && o > 0 ? fn(r, o) : '—';
                    const errColor = err === '—' ? 'text-slate-500' : Math.abs(parseFloat(err)) < 0.1 ? 'text-emerald-400' : Math.abs(parseFloat(err)) < 0.3 ? 'text-amber-400' : 'text-rose-400';
                    return (
                      <TableRow key={label} className="border-slate-800">
                        <TableCell className="font-mono text-[10px] text-slate-300">{label}</TableCell>
                        <TableCell className="font-mono text-[10px] text-fuchsia-300">{rv !== undefined ? rv.toFixed(2) : '—'}{unit}</TableCell>
                        <TableCell className="font-mono text-[10px] text-cyan-300">{ov !== undefined ? ov.toFixed(2) : '—'}{unit}</TableCell>
                        <TableCell className={`font-mono text-[10px] ${errColor}`}>{err}{err !== '—' ? unit : ''}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {(!refProfile || !selfMetrics) && <p className="text-[10px] text-amber-400 mt-2 font-mono">{!refProfile ? '⚠ Connect reference' : ''} {!selfMetrics ? '⚠ Start engine' : ''}</p>}
            </CardContent>
          </Card>
        )}

        {/* ─── DEEP A/B ANALYSIS (Task A1) ─── */}
        {/* Massive expansion of the A/B comparison: detects EFFECTS
            (reverb/delay/chorus/distortion/compression/filter), TIMBRE
            fingerprints (spectral shape + harmonics + formants + signature),
            UNIQUE ELEMENTS (risers/impacts/FX/vocal chops/glitches/stabs),
            and the SYNTHESIS PLAN (mode routing + per-track sends + reasons).
            Visible in analyze + train when the engine is running. */}
        {(mode === 'analyze' || mode === 'train') && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ScanSearch className="w-4 h-4 text-fuchsia-400" />
                DEEP A/B ANALYSIS
                <span className="text-[10px] text-slate-500 font-mono ml-2">effects · timbre · unique · plan</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(!deepAnalysis || (!deepAnalysis.effects && !deepAnalysis.refTimbre)) ? (
                <div className="text-[11px] text-amber-400 font-mono py-6 text-center">
                  ⚠ Waiting for reference features — connect a stream and the deep analysis
                  (effects / timbre / unique elements / synthesis plan) appears here within ~10s.
                </div>
              ) : (
                <>
                  {/* ─── 1. EFFECTS ─── */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-mono mb-2 text-cyan-400 flex items-center gap-1">
                      <Waves className="w-3 h-3" /> Effects Detection
                    </div>
                    {deepAnalysis.effects ? (
                      <div className="bg-slate-950 border border-slate-800 rounded p-3">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-700">
                              <TableHead className="text-slate-400 font-mono text-[10px]">EFFECT</TableHead>
                              <TableHead className="text-fuchsia-400 font-mono text-[10px]">REFERENCE</TableHead>
                              <TableHead className="text-cyan-400 font-mono text-[10px]">OUR ENGINE</TableHead>
                              <TableHead className="text-amber-400 font-mono text-[10px]">DELTA</TableHead>
                              <TableHead className="text-emerald-400 font-mono text-[10px]">MATCH</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(() => {
                              const e = deepAnalysis.effects;
                              const ourEffects = deepAnalysis.currentTimbre;
                              // Compute "our" effects proxy from the current timbre + per-track sends in pursuitDashboard.
                              const ourReverb = pursuitDashboard?.effects?.reverbSend
                                ? Math.max(...pursuitDashboard.effects.reverbSend.slice(5, 8).map((v: number) => v || 0))
                                : 0;
                              const ourDelay = pursuitDashboard?.effects?.delaySend
                                ? Math.max(...pursuitDashboard.effects.delaySend.slice(5, 8).map((v: number) => v || 0))
                                : 0;
                              const ourChorus = pursuitDashboard?.effects?.chorusSend
                                ? Math.max(...pursuitDashboard.effects.chorusSend.slice(5, 8).map((v: number) => v || 0))
                                : 0;
                              const ourDist = pursuitDashboard?.effects?.distortionSend
                                ? Math.max(...pursuitDashboard.effects.distortionSend.slice(4, 8).map((v: number) => v || 0))
                                : 0;
                              const rows: [string, number, number, string][] = [
                                ['Reverb',     e.reverbAmount,     ourReverb,  ''],
                                ['Rev decay',  e.reverbDecay,      0,          's'],
                                ['Delay',      e.delayAmount,      ourDelay,   ''],
                                ['Delay time', e.delayTime,        0,          'ms'],
                                ['Delay fb',   e.delayFeedback,    0,          ''],
                                ['Chorus',     e.chorusAmount,     ourChorus,  ''],
                                ['Chorus rate',e.chorusRate,       0,          'Hz'],
                                ['Distortion', e.distortionAmount, ourDist,    ''],
                                ['Compression',e.compressionAmount,0,         ''],
                                ['Filter cut', e.filterCutoff,     0,          'Hz'],
                                ['Filter res', e.filterResonance,  0,          ''],
                                ['Stereo',     e.stereoWidth,      ourEffects?.spectralSpread ? Math.min(1, ourEffects.spectralSpread / 6000) : 0, ''],
                              ];
                              return rows.map(([label, ref, our, unit]) => {
                                const refStr = ref > 0 ? (unit === 'Hz' || unit === 'ms' ? ref.toFixed(0) : ref.toFixed(2)) : '—';
                                const ourStr = our > 0 ? (unit === 'Hz' || unit === 'ms' ? our.toFixed(0) : our.toFixed(2)) : '—';
                                const delta = ref > 0 && our > 0 ? our - ref : null;
                                const dColor = delta === null ? 'text-slate-500'
                                  : Math.abs(delta) < 0.05 ? 'text-emerald-400'
                                  : Math.abs(delta) < 0.15 ? 'text-amber-400'
                                  : 'text-rose-400';
                                const match = delta === null ? '—'
                                  : Math.abs(delta) < 0.05 ? '✓'
                                  : Math.abs(delta) < 0.15 ? '~'
                                  : '✗';
                                const matchColor = match === '✓' ? 'text-emerald-400'
                                  : match === '~' ? 'text-amber-400'
                                  : match === '✗' ? 'text-rose-400' : 'text-slate-500';
                                return (
                                  <TableRow key={label} className="border-slate-800">
                                    <TableCell className="font-mono text-[10px] text-slate-300">{label}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-fuchsia-300">{refStr}{unit}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-cyan-300">{ourStr}{unit}</TableCell>
                                    <TableCell className={`font-mono text-[10px] ${dColor}`}>
                                      {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}${unit}`}
                                    </TableCell>
                                    <TableCell className={`font-mono text-[10px] font-bold ${matchColor}`}>{match}</TableCell>
                                  </TableRow>
                                );
                              });
                            })()}
                          </TableBody>
                        </Table>
                        {deepAnalysis.effects.haasEffect && (
                          <div className="text-[10px] text-fuchsia-400 font-mono mt-2">
                            ⚡ Haas / double-track detected on reference (low correlation + wide stereo)
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 font-mono">No effects detected yet.</div>
                    )}
                  </div>

                  {/* ─── 2. TIMBRE FINGERPRINT ─── */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-mono mb-2 text-emerald-400 flex items-center gap-1">
                      <Fingerprint className="w-3 h-3" /> Timbre Fingerprint
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Reference vs our timbre side by side */}
                      <div className="bg-slate-950 border border-slate-800 rounded p-3">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-700">
                              <TableHead className="text-slate-400 font-mono text-[10px]">METRIC</TableHead>
                              <TableHead className="text-fuchsia-400 font-mono text-[10px]">REF</TableHead>
                              <TableHead className="text-cyan-400 font-mono text-[10px]">OURS</TableHead>
                              <TableHead className="text-amber-400 font-mono text-[10px]">Δ</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(() => {
                              const r = deepAnalysis.refTimbre;
                              const o = deepAnalysis.currentTimbre;
                              if (!r) return null;
                              const rows: [string, number, number, string, number][] = [
                                ['Centroid',     r.spectralCentroid,    o?.spectralCentroid ?? 0,    'Hz', 200],
                                ['Spread',       r.spectralSpread,      o?.spectralSpread ?? 0,      'Hz', 500],
                                ['Skewness',     r.spectralSkewness,    o?.spectralSkewness ?? 0,    '',   0.3],
                                ['Kurtosis',     r.spectralKurtosis,    o?.spectralKurtosis ?? 0,    '',   1.5],
                                ['Flux',         r.spectralFlux,        o?.spectralFlux ?? 0,        '',   0.15],
                                ['f0',           r.fundamentalFrequency,o?.fundamentalFrequency ?? 0,'Hz', 30],
                                ['Inharmonicity',r.inharmonicity,       o?.inharmonicity ?? 0,       '',   0.1],
                                ['Odd:Even',     r.oddEvenRatio,        o?.oddEvenRatio ?? 0,        '',   0.3],
                                ['Attack',       r.attackTime,          o?.attackTime ?? 0,          'ms', 5],
                              ];
                              return rows.map(([label, rv, ov, unit, tol]) => {
                                const delta = rv > 0 && ov > 0 ? ov - rv : null;
                                const dColor = delta === null ? 'text-slate-500'
                                  : Math.abs(delta) <= tol ? 'text-emerald-400'
                                  : Math.abs(delta) <= tol * 3 ? 'text-amber-400'
                                  : 'text-rose-400';
                                return (
                                  <TableRow key={label} className="border-slate-800">
                                    <TableCell className="font-mono text-[10px] text-slate-300">{label}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-fuchsia-300">
                                      {rv > 0 ? (unit === 'Hz' || unit === 'ms' ? rv.toFixed(0) : rv.toFixed(2)) : '—'}{unit}
                                    </TableCell>
                                    <TableCell className="font-mono text-[10px] text-cyan-300">
                                      {ov > 0 ? (unit === 'Hz' || unit === 'ms' ? ov.toFixed(0) : ov.toFixed(2)) : '—'}{unit}
                                    </TableCell>
                                    <TableCell className={`font-mono text-[10px] ${dColor}`}>
                                      {delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`}
                                    </TableCell>
                                  </TableRow>
                                );
                              });
                            })()}
                          </TableBody>
                        </Table>
                        {/* Signatures + formants + comparison */}
                        <div className="mt-3 space-y-2 text-[10px] font-mono">
                          <div className="flex flex-wrap gap-2">
                            <span className="text-slate-500">REF sig:</span>
                            <span className="text-fuchsia-300 font-bold">{deepAnalysis.refTimbre?.signature ?? '—'}</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="text-slate-500">OURS sig:</span>
                            <span className="text-cyan-300 font-bold">{deepAnalysis.currentTimbre?.signature ?? '—'}</span>
                          </div>
                          {deepAnalysis.refTimbre?.formants && deepAnalysis.refTimbre.formants.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              <span className="text-slate-500">REF formants:</span>
                              {deepAnalysis.refTimbre.formants.map((f: any, i: number) => (
                                <span key={i} className="text-emerald-300 px-1.5 py-0.5 bg-emerald-950 border border-emerald-800 rounded text-[9px]">
                                  {f.freq.toFixed(0)}Hz · {(f.amp * 100).toFixed(0)}%
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Similarity + matching traits + differences */}
                      <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-3">
                        <div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Similarity</div>
                          <div className="flex items-baseline justify-between">
                            <span className={`text-2xl font-bold font-mono ${
                              (deepAnalysis.timbreComparison?.similarity ?? 0) > 0.7 ? 'text-emerald-300'
                              : (deepAnalysis.timbreComparison?.similarity ?? 0) > 0.4 ? 'text-amber-300'
                              : 'text-rose-300'
                            }`}>
                              {deepAnalysis.timbreComparison ? `${Math.round(deepAnalysis.timbreComparison.similarity * 100)}%` : '—'}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">target ≥ 70%</span>
                          </div>
                          {deepAnalysis.timbreComparison && (
                            <div className="mt-2">
                              <MiniBar
                                value={deepAnalysis.timbreComparison.similarity}
                                max={1}
                                color={(deepAnalysis.timbreComparison.similarity ?? 0) > 0.7 ? 'bg-emerald-500' : (deepAnalysis.timbreComparison.similarity ?? 0) > 0.4 ? 'bg-amber-500' : 'bg-rose-500'}
                              />
                            </div>
                          )}
                        </div>
                        {deepAnalysis.timbreComparison?.matchingTraits && deepAnalysis.timbreComparison.matchingTraits.length > 0 && (
                          <div>
                            <div className="text-[10px] text-emerald-400 uppercase tracking-wider font-mono mb-1">Matching Traits</div>
                            <ul className={`space-y-1 text-[10px] font-mono text-slate-300 ${scrollList}`}>
                              {deepAnalysis.timbreComparison.matchingTraits.map((t: string, i: number) => (
                                <li key={i} className="flex gap-1.5">
                                  <Check className="w-3 h-3 mt-0.5 flex-shrink-0 text-emerald-400" />
                                  <span>{t}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {deepAnalysis.timbreComparison?.differences && deepAnalysis.timbreComparison.differences.length > 0 && (
                          <div>
                            <div className="text-[10px] text-rose-400 uppercase tracking-wider font-mono mb-1">Differences</div>
                            <ul className={`space-y-1 text-[10px] font-mono text-slate-300 ${scrollList}`}>
                              {deepAnalysis.timbreComparison.differences.map((d: string, i: number) => (
                                <li key={i} className="flex gap-1.5">
                                  <ArrowDown className="w-3 h-3 mt-0.5 flex-shrink-0 text-rose-400" />
                                  <span>{d}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ─── 3. UNIQUE ELEMENTS ─── */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-mono mb-2 text-amber-400 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Unique Elements
                      <span className="text-slate-500 ml-1">({deepAnalysis.uniqueElements?.length ?? 0} detected · history {deepAnalysis.historyLength ?? 0} windows)</span>
                    </div>
                    {deepAnalysis.uniqueElements && deepAnalysis.uniqueElements.length > 0 ? (
                      <div className={`space-y-1.5 ${scrollList}`}>
                        {deepAnalysis.uniqueElements.map((u: any, i: number) => {
                          const typeColor: Record<string, string> = {
                            riser: 'bg-emerald-950 border-emerald-700 text-emerald-300',
                            impact: 'bg-rose-950 border-rose-700 text-rose-300',
                            fx: 'bg-fuchsia-950 border-fuchsia-700 text-fuchsia-300',
                            vocalChop: 'bg-cyan-950 border-cyan-700 text-cyan-300',
                            reverseHit: 'bg-amber-950 border-amber-700 text-amber-300',
                            glitch: 'bg-purple-950 border-purple-700 text-purple-300',
                            sweep: 'bg-teal-950 border-teal-700 text-teal-300',
                            stab: 'bg-orange-950 border-orange-700 text-orange-300',
                          };
                          return (
                            <div key={i} className={`border rounded p-2 text-[10px] font-mono ${typeColor[u.type] || 'bg-slate-950 border-slate-700 text-slate-300'}`}>
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <span className="font-bold uppercase">{u.type}</span>
                                <span className="opacity-70">
                                  {(u.duration / 1000).toFixed(1)}s · {u.frequency.toFixed(0)}Hz · conf {(u.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div className="text-[9px] opacity-80 mt-0.5">{u.description}</div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 font-mono bg-slate-950 border border-slate-800 rounded p-3">
                        No unique elements detected yet — risers / impacts / FX sweeps / vocal chops will appear here as
                        the engine accumulates feature history (needs ≥2 analysis windows).
                      </div>
                    )}
                  </div>

                  {/* ─── 4. SYNTHESIS PLAN ─── */}
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-mono mb-2 text-fuchsia-400 flex items-center gap-1">
                      <Wand2 className="w-3 h-3" /> Synthesis Plan
                      <span className="text-slate-500 ml-1">(auto-applied every 10s · {deepAnalysis.synthPlan?.adjustments?.length ?? 0} adjustments queued)</span>
                    </div>
                    {deepAnalysis.synthPlan ? (
                      <div className="space-y-3">
                        {/* Mode routing */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {(() => {
                            const p = deepAnalysis.synthPlan;
                            const modes: [string, string][] = [
                              ['LEAD', p.leadMode],
                              ['PAD',  p.padMode],
                              ['ARP',  p.arpMode],
                              ['BASS', p.bassMode],
                            ];
                            return modes.map(([name, m]) => (
                              <div key={name} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                                <div className="text-[9px] text-slate-500 uppercase font-mono">{name}</div>
                                <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${modeColor(m)}`}>
                                  {(m || 'classic').toUpperCase()}
                                </div>
                              </div>
                            ));
                          })()}
                        </div>

                        {/* Effect routing grid */}
                        <div className="bg-slate-950 border border-slate-800 rounded p-3">
                          <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Effect Routing (send levels)</div>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-slate-700">
                                  <TableHead className="text-slate-400 font-mono text-[10px] sticky left-0 bg-slate-950">SEND</TableHead>
                                  <TableHead className="text-amber-400 font-mono text-[10px]">LEAD</TableHead>
                                  <TableHead className="text-amber-400 font-mono text-[10px]">PAD</TableHead>
                                  <TableHead className="text-amber-400 font-mono text-[10px]">ARP</TableHead>
                                  <TableHead className="text-amber-400 font-mono text-[10px]">BASS</TableHead>
                                  <TableHead className="text-amber-400 font-mono text-[10px]">DRUMS</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(() => {
                                  const p = deepAnalysis.synthPlan;
                                  const rows: [string, any][] = [
                                    ['Reverb',     p.effects.reverb],
                                    ['Delay',      p.effects.delay],
                                    ['Chorus',     p.effects.chorus],
                                    ['Phaser',     p.effects.phaser],
                                    ['Distortion', p.effects.distortion],
                                  ];
                                  return rows.map(([name, sends]) => {
                                    const vals = [
                                      sends.lead ?? 0, sends.pad ?? 0, sends.arp ?? 0,
                                      sends.bass ?? 0, sends.drums ?? 0,
                                    ];
                                    return (
                                      <TableRow key={name} className="border-slate-800">
                                        <TableCell className="font-mono text-[10px] text-slate-300 sticky left-0 bg-slate-950">{name}</TableCell>
                                        {vals.map((v, i) => (
                                          <TableCell key={i} className="font-mono text-[10px]">
                                            <div className="flex items-center gap-1.5">
                                              <span className={v > 0.05 ? 'text-cyan-300' : 'text-slate-600'}>
                                                {(v * 100).toFixed(0)}
                                              </span>
                                              <div className="w-12 h-1.5 bg-slate-800 rounded overflow-hidden">
                                                <div
                                                  className={`h-full rounded ${v > 0.3 ? 'bg-emerald-500' : v > 0.1 ? 'bg-amber-500' : 'bg-slate-700'}`}
                                                  style={{ width: `${Math.min(100, v * 100).toFixed(1)}%` }}
                                                />
                                              </div>
                                            </div>
                                          </TableCell>
                                        ))}
                                      </TableRow>
                                    );
                                  });
                                })()}
                              </TableBody>
                            </Table>
                          </div>
                        </div>

                        {/* Adjustments list with reasons */}
                        {deepAnalysis.synthPlan.adjustments && deepAnalysis.synthPlan.adjustments.length > 0 && (
                          <div className="bg-slate-950 border border-slate-800 rounded p-3">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Adjustments</div>
                            <ul className={`space-y-1 text-[10px] font-mono ${scrollList}`}>
                              {deepAnalysis.synthPlan.adjustments.map((a: any, i: number) => {
                                const trackName = a.track === -1 ? 'MASTER' : (TRACK_NAMES[a.track] ?? `T${a.track}`);
                                return (
                                  <li key={i} className="flex gap-2 items-start">
                                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-300 flex-shrink-0">
                                      {trackName}
                                    </span>
                                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-fuchsia-300 flex-shrink-0">
                                      {a.param}
                                    </span>
                                    <span className="text-slate-500 flex-shrink-0">
                                      {typeof a.currentValue === 'number' && a.currentValue > 0 ? a.currentValue.toFixed(2) : '—'} → {a.targetValue.toFixed(2)}
                                    </span>
                                    <span className="text-slate-400">{a.reason}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 font-mono bg-slate-950 border border-slate-800 rounded p-3">
                        No synthesis plan yet — appears once reference effects + timbre are detected.
                      </div>
                    )}
                  </div>

                  <p className="text-[10px] text-slate-500 font-mono">
                    <ScanSearch className="w-3 h-3 inline mr-1" />
                    Engine runs the effects detector + timbre fingerprint + uniqueness detector + synthesis router on every
                    reference update (every ~10s). Modes + sends auto-apply every 10s (anti-thrash). The dashboard updates
                    live — wait for ≥2 analysis windows for unique-element detection.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* A/B SPECTRAL VISUALIZATION (Task 20) — 5 bands × 2 bars + delta */}
        {mode === 'analyze' && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Waves className="w-4 h-4 text-emerald-400" />
                A/B SPECTRAL VISUALIZATION
                <span className="text-[10px] text-slate-500 font-mono ml-2">5 bands · ref vs engine</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!refMetrics || !selfMetrics) ? (
                <div className="text-[11px] text-amber-400 font-mono py-6 text-center">
                  {!refMetrics ? '⚠ Connect reference to populate REFERENCE bars' : ''}
                  {!refMetrics && !selfMetrics ? ' · ' : ''}
                  {!selfMetrics ? '⚠ Start engine to populate ENGINE bars' : ''}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Legend */}
                  <div className="flex items-center gap-4 text-[10px] font-mono">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-fuchsia-500 rounded-sm" /> REFERENCE (radio)</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 bg-cyan-500 rounded-sm" /> OUR ENGINE</span>
                  </div>

                  {/* Bands */}
                  <div className="grid grid-cols-5 gap-2 md:gap-3">
                    {spectralBands.map(b => {
                      const refH = Math.max(2, b.refNorm * 100);
                      const ownH = Math.max(2, b.ownNorm * 100);
                      const dColor = spectralDeltaColor(b.delta);
                      return (
                        <div key={b.key} className="bg-slate-950 border border-slate-800 rounded p-2 flex flex-col">
                          <div className="text-[10px] font-mono text-slate-300 font-bold text-center">{b.label}</div>
                          <div className="text-[8px] font-mono text-slate-600 text-center mb-2">{b.range}</div>

                          {/* Bar chart area — fixed height, two side-by-side bars */}
                          <div className="h-28 flex items-end justify-center gap-1 bg-slate-900/50 rounded p-1">
                            <div className="flex flex-col items-center" style={{ width: '40%' }}>
                              <span className="text-[8px] font-mono text-fuchsia-300 mb-0.5">{b.ref !== undefined ? b.ref.toFixed(2) : '—'}</span>
                              <div
                                className="w-full bg-gradient-to-t from-fuchsia-700 to-fuchsia-400 rounded-t-sm transition-all duration-300"
                                style={{ height: `${refH}%` }}
                                title={`Reference ${b.label}: ${b.ref !== undefined ? b.ref.toFixed(3) : '—'}`}
                              />
                            </div>
                            <div className="flex flex-col items-center" style={{ width: '40%' }}>
                              <span className="text-[8px] font-mono text-cyan-300 mb-0.5">{b.own !== undefined ? b.own.toFixed(2) : '—'}</span>
                              <div
                                className="w-full bg-gradient-to-t from-cyan-700 to-cyan-400 rounded-t-sm transition-all duration-300"
                                style={{ height: `${ownH}%` }}
                                title={`Engine ${b.label}: ${b.own !== undefined ? b.own.toFixed(3) : '—'}`}
                              />
                            </div>
                          </div>

                          {/* Delta */}
                          <div className="mt-2 text-center">
                            <div className="text-[8px] text-slate-600 font-mono uppercase">Δ</div>
                            <div className={`text-[11px] font-mono font-bold ${dColor}`}>
                              {b.delta === null ? '—' : `${b.delta > 0 ? '+' : ''}${b.delta.toFixed(2)}`}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="text-[10px] text-slate-500 font-mono">
                    Green Δ &lt; 0.1 · Yellow &lt; 0.2 · Red &gt; 0.2 — bars normalize 0..1 energy per band.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── SYNTHESIS CHARACTER (Task I1-UI · CHANGE 1) ─── */}
        {/* Shows the active synthesis mode per track (FM / supersaw / wavetable / classic)
            with confidence, FM depth, saw spread, wavetable position, and reasons.
            Visible in listen + analyze so the user can see what the engine is doing. */}
        {(mode === 'listen' || mode === 'analyze') && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Cpu className="w-4 h-4 text-amber-400" />
                SYNTHESIS
                <span className="text-[10px] text-slate-500 font-mono ml-2">FM · supersaw · wavetable · classic</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Per-track mode grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {TRACK_NAMES.map((name, idx) => {
                  const mode = effectiveMode(idx);
                  const overridden = !!synthOverrides?.[idx];
                  return (
                    <div key={name} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase font-mono">{name}</div>
                      <div className={`mt-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${modeColor(mode)}`}>
                        {mode.toUpperCase()}
                      </div>
                      {overridden && (
                        <div className="text-[8px] text-fuchsia-400 font-mono mt-0.5">override</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Primary character (from getSynthesisCharacter — T1) */}
              {synthChar ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Mode + confidence */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Detected Character</div>
                    <div className="flex items-baseline justify-between">
                      <span className={`text-base font-bold ${modeTextColor(synthChar.mode)}`}>
                        {(synthChar.mode || 'classic').toUpperCase()}
                      </span>
                      {typeof synthChar.confidence === 'number' && (
                        <span className={`text-sm font-mono font-bold ${deltaColor(synthChar.confidence - 0.7, 0.2)}`}>
                          {Math.round(synthChar.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {typeof synthChar.confidence === 'number' && (
                      <MiniBar value={synthChar.confidence} color="bg-amber-500" />
                    )}
                  </div>

                  {/* Mode-specific params */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Mode Parameters</div>
                    {synthChar.mode === 'fm' && typeof synthChar.fmDepth === 'number' && (
                      <div>
                        <div className="flex justify-between text-[10px] font-mono"><span className="text-slate-400">FM depth</span><span className={modeTextColor('fm')}>{synthChar.fmDepth.toFixed(2)}</span></div>
                        <MiniBar value={synthChar.fmDepth} max={8} color="bg-rose-500" />
                      </div>
                    )}
                    {synthChar.mode === 'supersaw' && typeof synthChar.sawSpread === 'number' && (
                      <div>
                        <div className="flex justify-between text-[10px] font-mono"><span className="text-slate-400">Saw spread</span><span className={modeTextColor('supersaw')}>{synthChar.sawSpread.toFixed(2)}</span></div>
                        <MiniBar value={synthChar.sawSpread} max={1} color="bg-amber-500" />
                      </div>
                    )}
                    {synthChar.mode === 'wavetable' && typeof synthChar.wtPosition === 'number' && (
                      <div>
                        <div className="flex justify-between text-[10px] font-mono"><span className="text-slate-400">Wavetable pos</span><span className={modeTextColor('wavetable')}>{synthChar.wtPosition.toFixed(2)}</span></div>
                        <MiniBar value={synthChar.wtPosition} max={1} color="bg-emerald-500" />
                      </div>
                    )}
                    {synthChar.mode === 'classic' && (
                      <div className="text-[10px] font-mono text-slate-400">2-osc classic saw/square/sine</div>
                    )}
                    {!synthChar.mode && (
                      <div className="text-[10px] font-mono text-slate-500">No character data yet</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-slate-500 font-mono bg-slate-950 border border-slate-800 rounded p-3">
                  Detailed character detection unavailable — showing per-track world-default modes above.
                </div>
              )}

              {/* Reasons (if available) */}
              {synthChar?.reasons && Array.isArray(synthChar.reasons) && synthChar.reasons.length > 0 && (
                <div className="bg-slate-950 border border-slate-800 rounded p-3">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Why this character?</div>
                  <ul className={`space-y-1 text-[11px] font-mono text-slate-300 ${scrollList}`}>
                    {synthChar.reasons.map((r: string, i: number) => (
                      <li key={i} className="flex gap-1.5">
                        <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-400" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── EFFECTS MATRIX (Task I1-UI · CHANGE 2) ─── */}
        {/* Per-track insert chain (EQ / comp / sat) + 6 send levels.
            Driven by getEffectsState() if T1 has wired it; otherwise a clear
            placeholder is shown so the user knows the panel exists. */}
        {mode === 'analyze' && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                EFFECTS MATRIX
                <span className="text-[10px] text-slate-500 font-mono ml-2">8 tracks · EQ / comp / sat / sends</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {effectsState && Array.isArray(effectsState.tracks) && effectsState.tracks.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-700">
                        <TableHead className="text-slate-400 font-mono text-[10px] sticky left-0 bg-slate-900/60">TRACK</TableHead>
                        <TableHead className="text-fuchsia-400 font-mono text-[10px]">EQ LOW</TableHead>
                        <TableHead className="text-fuchsia-400 font-mono text-[10px]">EQ MID</TableHead>
                        <TableHead className="text-fuchsia-400 font-mono text-[10px]">EQ HIGH</TableHead>
                        <TableHead className="text-amber-400 font-mono text-[10px]">COMP</TableHead>
                        <TableHead className="text-rose-400 font-mono text-[10px]">SAT</TableHead>
                        <TableHead className="text-emerald-400 font-mono text-[10px]">CHORUS</TableHead>
                        <TableHead className="text-emerald-400 font-mono text-[10px]">PHASER</TableHead>
                        <TableHead className="text-rose-400 font-mono text-[10px]">DIST</TableHead>
                        <TableHead className="text-cyan-400 font-mono text-[10px]">REVERB</TableHead>
                        <TableHead className="text-cyan-400 font-mono text-[10px]">DELAY</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {effectsState.tracks.map((t: any, i: number) => {
                        const eqLow = typeof t.eqLowGain === 'number' ? t.eqLowGain : 0;
                        const eqMid = typeof t.eqMidGain === 'number' ? t.eqMidGain : 0;
                        const eqHigh = typeof t.eqHighGain === 'number' ? t.eqHighGain : 0;
                        const compThresh = typeof t.compThreshold === 'number' ? t.compThreshold : -18;
                        const satDrive = typeof t.satDrive === 'number' ? t.satDrive : 1;
                        const eqColor = (v: number) => Math.abs(v) < 1 ? 'text-emerald-400' : Math.abs(v) < 4 ? 'text-amber-400' : 'text-rose-400';
                        return (
                          <TableRow key={i} className="border-slate-800">
                            <TableCell className="font-mono text-[10px] text-slate-300 sticky left-0 bg-slate-900/60">{TRACK_NAMES[i] ?? `T${i}`}</TableCell>
                            <TableCell className="font-mono text-[10px]"><div className={eqColor(eqLow)}>{eqLow > 0 ? '+' : ''}{eqLow.toFixed(1)}dB</div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className={eqColor(eqMid)}>{eqMid > 0 ? '+' : ''}{eqMid.toFixed(1)}dB</div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className={eqColor(eqHigh)}>{eqHigh > 0 ? '+' : ''}{eqHigh.toFixed(1)}dB</div></TableCell>
                            <TableCell className="font-mono text-[10px] text-amber-300">{compThresh.toFixed(0)}dB</TableCell>
                            <TableCell className="font-mono text-[10px]">
                              <div className="flex items-center gap-1">
                                <span className="text-rose-300">{satDrive.toFixed(1)}</span>
                                <div className="w-8"><MiniBar value={satDrive} max={6} color="bg-rose-500" /></div>
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-[10px]"><div className="w-10"><MiniBar value={t.sendChorus ?? 0} max={1} color="bg-emerald-500" /></div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className="w-10"><MiniBar value={t.sendPhaser ?? 0} max={1} color="bg-emerald-500" /></div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className="w-10"><MiniBar value={t.sendDistortion ?? 0} max={1} color="bg-rose-500" /></div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className="w-10"><MiniBar value={t.sendReverb ?? 0} max={1} color="bg-cyan-500" /></div></TableCell>
                            <TableCell className="font-mono text-[10px]"><div className="w-10"><MiniBar value={t.sendDelay ?? 0} max={1} color="bg-cyan-500" /></div></TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded p-4 text-center">
                  <div className="text-[11px] text-amber-400 font-mono">Effects state unavailable</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Engine method <code className="text-cyan-400">getEffectsState()</code> not yet wired — per-track rack configs will appear here once T1 ships.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── HARMONY (Task I1-UI · CHANGE 3) ─── */}
        {/* Current chord (root + type + inversion), chord notes as MIDI→note names,
            the section progression with the current chord highlighted, and the
            voice-led voicing notes. Driven by getCurrentChord() + getHarmony(). */}
        {mode === 'analyze' && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Piano className="w-4 h-4 text-emerald-400" />
                HARMONY
                <span className="text-[10px] text-slate-500 font-mono ml-2">voice leading · 7th/9th chords · inversions</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentChord ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {/* Chord name */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Current Chord</div>
                      <div className="text-xl font-bold text-emerald-300 font-mono">
                        {midiToName(currentChord.root)}
                        <span className="text-emerald-400">{CHORD_TYPE_LABEL[currentChord.type] ?? currentChord.type}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">
                        degree {currentChord.scaleDegree} · {INVERSION_LABEL[currentChord.inversion] ?? `inv ${currentChord.inversion}`}
                      </div>
                    </div>

                    {/* Chord notes */}
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 md:col-span-2">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Chord Notes</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.isArray(currentChord.notes) && currentChord.notes.map((n: number, i: number) => (
                          <span key={i} className="px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-800 rounded text-[11px] font-mono text-emerald-300">
                            {midiToName(n)}
                          </span>
                        ))}
                      </div>
                      <div className="text-[9px] text-slate-600 font-mono mt-1.5">root-position voicing · {Array.isArray(currentChord.notes) ? currentChord.notes.length : 0} notes</div>
                    </div>
                  </div>

                  {/* Progression */}
                  {progressionInfo && progressionInfo.chords.length > 0 ? (
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Progression (current highlighted)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {progressionInfo.chords.map((c: any, i: number) => {
                          const isCurrent = i === (progressionInfo.idx - 1);
                          return (
                            <span
                              key={i}
                              className={`px-2 py-1 rounded text-[11px] font-mono border ${
                                isCurrent
                                  ? 'bg-emerald-600 text-white border-emerald-400'
                                  : 'bg-slate-900 text-slate-400 border-slate-800'
                              }`}
                            >
                              {midiToName(c.root)}{CHORD_TYPE_LABEL[c.type] ?? c.type}
                            </span>
                          );
                        })}
                      </div>
                      <div className="text-[9px] text-slate-600 font-mono mt-2">
                        bar {Math.max(1, progressionInfo.idx)} of {progressionInfo.chords.length} · section regenerates on section boundaries
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-950 border border-slate-800 rounded p-3 text-[10px] text-slate-500 font-mono">
                      Progression view unavailable — engine method <code className="text-cyan-400">getCurrentProgression()</code> not yet wired.
                    </div>
                  )}

                  {/* Voicing (computed from chord intervals — root-position) */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-2">Voicing (root position)</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                      <div>
                        <span className="text-slate-500">Bass: </span>
                        <span className="text-fuchsia-300">{midiToName(currentChord.root)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Upper voices: </span>
                        <span className="text-cyan-300">
                          {Array.isArray(currentChord.notes) ? currentChord.notes.slice(1).map((n: number) => midiToName(n)).join(' · ') : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="text-[9px] text-slate-600 font-mono mt-1.5">
                      Voice-led voicing is computed at trigger time — pad plays 1 voice per note with 5ms stagger.
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded p-4 text-center">
                  <div className="text-[11px] text-slate-400 font-mono">No chord playing yet</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Chords trigger at the start of each bar in lead sections. Wait for a drop or build.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── DEEP PURSUIT (Task I1-UI · CHANGE 4) ─── */}
        {/* Enhanced pursuit dashboard: harmonic content (flatness, crest, HNR,
            inharmonicity, slope), transient shape (sharpness, decay), and stereo
            field (width, balance, correlation, M/S ratio). Each row shows
            target / actual / delta + convergence arrow. */}
        {mode === 'analyze' && engineOn && pursuitDashboard && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="w-4 h-4 text-fuchsia-400" />
                DEEP PURSUIT
                <span className="text-[10px] text-slate-500 font-mono ml-2">harmonic · transient · stereo field</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Helper to render a metric group */}
              {(() => {
                const renderGroup = (title: string, color: string, rows: any[]) => {
                  if (!rows || rows.length === 0) return null;
                  return (
                    <div className="bg-slate-950 border border-slate-800 rounded p-3">
                      <div className={`text-[10px] uppercase tracking-wider font-mono mb-2 ${color}`}>{title}</div>
                      <div className="space-y-1.5">
                        {rows.map((r: any, i: number) => {
                          const target = typeof r.target === 'number' ? r.target : 0;
                          const actual = typeof r.actual === 'number' ? r.actual : 0;
                          const delta = typeof r.target === 'number' && typeof r.actual === 'number' ? (r.actual - r.target) : undefined;
                          const tol = typeof r.tol === 'number' ? r.tol : (Math.abs(target) * 0.1 + 0.01);
                          const isActive = target > 0 || actual > 0;
                          const dColor = !isActive ? 'text-slate-500' : deltaColor(delta, tol);
                          const arrow = !isActive ? 'idle'
                            : Math.abs(delta ?? 0) <= tol ? 'ok'
                            : (Math.abs(delta ?? 0) < (r.prevDelta ?? Math.abs(delta ?? 0) + 1) ? 'up' : 'down');
                          return (
                            <div key={i} className="grid grid-cols-12 gap-1 items-center text-[10px] font-mono">
                              <span className="col-span-3 text-slate-300 truncate" title={r.label}>{r.label}</span>
                              <span className="col-span-3 text-fuchsia-300 text-right">{isActive ? target.toFixed(2) : '—'}{r.unit || ''}</span>
                              <span className="col-span-3 text-cyan-300 text-right">{isActive ? actual.toFixed(2) : '—'}{r.unit || ''}</span>
                              <span className={`col-span-2 text-right ${dColor}`}>
                                {isActive ? `${(delta ?? 0) > 0 ? '+' : ''}${(delta ?? 0).toFixed(2)}` : 'idle'}
                              </span>
                              <span className="col-span-1 text-right">
                                <ArrowIcon a={arrow as any} />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                };
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {renderGroup('Harmonic Content', 'text-emerald-400', pursuitDashboard.harmonic || [])}
                    {renderGroup('Transient Shape', 'text-amber-400', pursuitDashboard.transient || [])}
                    {renderGroup('Stereo Field', 'text-fuchsia-400', pursuitDashboard.stereo || [])}
                  </div>
                );
              })()}
              <p className="text-[10px] text-slate-500 font-mono">
                <ArrowIcon a="up" /> converging · <ArrowIcon a="down" /> diverging · <ArrowIcon a="ok" /> locked.
                Each row pairs the radio target with our engine's actual value, with tolerance-scaled color coding.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ─── MELODY (Task I1-UI · CHANGE 5) ─── */}
        {/* Small indicator showing phrase position (A / A' / B / A''), tension
            level, and call-response state. */}
        {mode === 'analyze' && engineOn && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ListMusic className="w-4 h-4 text-amber-400" />
                MELODY
                <span className="text-[10px] text-slate-500 font-mono ml-2">motif development · call-response · tension</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {melodyState ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Phrase position */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Phrase Position</div>
                    <div className="text-2xl font-bold text-amber-300 font-mono">
                      {melodyState.phraseLabel || melodyState.position || 'A'}
                    </div>
                    {typeof melodyState.phraseCount === 'number' && (
                      <div className="text-[9px] text-slate-600 font-mono mt-0.5">phrase #{melodyState.phraseCount}</div>
                    )}
                  </div>

                  {/* Tension */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Tension</div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-bold text-fuchsia-300 font-mono">
                        {typeof melodyState.tension === 'number' ? `${Math.round(melodyState.tension * 100)}%` : '—'}
                      </span>
                      {typeof melodyState.energy === 'number' && (
                        <span className="text-[10px] text-slate-500 font-mono">energy {Math.round(melodyState.energy * 100)}%</span>
                      )}
                    </div>
                    {typeof melodyState.tension === 'number' && (
                      <div className="mt-2"><MiniBar value={melodyState.tension} max={1} color="bg-fuchsia-500" /></div>
                    )}
                  </div>

                  {/* Call-response */}
                  <div className="bg-slate-950 border border-slate-800 rounded p-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider font-mono mb-1">Call / Response</div>
                    {melodyState.callResponseActive ? (
                      <div className="flex items-center gap-2">
                        <AudioWaveform className="w-4 h-4 text-emerald-400" />
                        <span className="text-sm font-mono text-emerald-300">ACTIVE</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-slate-500">idle</span>
                      </div>
                    )}
                    {typeof melodyState.motifLength === 'number' && (
                      <div className="text-[9px] text-slate-600 font-mono mt-0.5">motif: {melodyState.motifLength} notes</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-950 border border-slate-800 rounded p-4 text-center">
                  <div className="text-[11px] text-slate-400 font-mono">Melody state unavailable</div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Engine method <code className="text-cyan-400">getMelodyState()</code> not yet wired — melody info appears here once T1 ships.
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* REFERENCE PURSUIT — enhanced with convergence arrows (Track D) */}
        {(mode === 'analyze' || mode === 'train') && pursuit && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Target className="w-4 h-4 text-fuchsia-400" />
                REFERENCE PURSUIT
                <span className="text-[10px] text-slate-500 font-mono ml-2">target vs actual · live convergence</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400 font-mono text-[10px]">DIMENSION</TableHead>
                    <TableHead className="text-fuchsia-400 font-mono text-[10px]">RADIO TARGET</TableHead>
                    <TableHead className="text-cyan-400 font-mono text-[10px]">ENGINE ACTUAL</TableHead>
                    <TableHead className="text-amber-400 font-mono text-[10px]">DELTA</TableHead>
                    <TableHead className="text-emerald-400 font-mono text-[10px]">CONVERGENCE</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pursuitRows.map(row => {
                    const fmt = (v: number) => v === 0 ? '—' : (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0));
                    const isActive = row.target > 0;
                    return (
                      <TableRow key={row.label} className="border-slate-800">
                        <TableCell className="font-mono text-[10px] text-slate-300">{row.label}</TableCell>
                        <TableCell className="font-mono text-[10px] text-fuchsia-300">{fmt(row.target)}{row.unit}</TableCell>
                        <TableCell className="font-mono text-[10px] text-cyan-300">{fmt(row.actual)}{row.unit}</TableCell>
                        <TableCell className={`font-mono text-[10px] ${row.color}`}>
                          {isActive ? `${row.delta > 0 ? '+' : ''}${fmt(row.delta)}${row.unit}` : 'idle'}
                        </TableCell>
                        <TableCell className={`font-mono text-[10px] ${row.color}`}>
                          <span className="inline-flex items-center">
                            <ArrowIcon a={row.arrow} />
                            {row.arrow === 'up' ? 'converging' : row.arrow === 'down' ? 'diverging' : row.arrow === 'ok' ? 'locked' : 'idle'}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="border-slate-800">
                    <TableCell className="font-mono text-[10px] text-slate-300">Key</TableCell>
                    <TableCell colSpan={4} className="font-mono text-[10px] text-emerald-300">
                      root {pursuit.key?.root ?? '—'} · {pursuit.key?.scale ?? '—'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <p className="text-[10px] text-slate-500 mt-2 font-mono">
                Engine smoothly ramps kick decay / cutoff / transient density / BPM and re-creates
                LeadMotif + AcidPattern on key change. <ArrowIcon a="up" /> = getting closer ·
                <ArrowIcon a="down" /> = drifting away · <ArrowIcon a="ok" /> = within tolerance.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Learning */}
        {mode === 'train' && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Brain className="w-4 h-4 text-emerald-400" /> CONTINUOUS LEARNING</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                {!learning ? (
                  <Button onClick={startLearning} size="sm" disabled={!refProfile} className="bg-emerald-600 hover:bg-emerald-700"><Zap className="w-4 h-4 mr-1" /> START</Button>
                ) : (
                  <Button onClick={stopLearning} size="sm" variant="destructive"><Square className="w-4 h-4 mr-1" /> STOP</Button>
                )}
              </div>
              {learning && learnState && (
                <div className="grid grid-cols-4 gap-2">
                  {[['SCORE', learnState.currentScore?.toFixed(1) ?? '—', 'text-cyan-400'],
                    ['BEST', learnState.bestScore?.toFixed(1) ?? '—', 'text-emerald-400'],
                    ['ACCEPTED', learnState.acceptedCount ?? 0, 'text-emerald-400'],
                    ['TOTAL', learnState.totalIterations ?? 0, 'text-slate-300']].map(([l, v, c]) => (
                    <div key={l} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                      <div className="text-[8px] text-slate-500 uppercase">{l}</div>
                      <div className={`text-lg font-bold ${c}`}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
              {learning && learnState?.iterations?.length > 0 && (
                <div className={`space-y-1 ${scrollList}`}>
                  {[...learnState.iterations].reverse().slice(0, 10).map((it: any, i: number) => (
                    <div key={i} className={`border rounded p-2 text-[10px] font-mono ${it.accepted ? 'border-emerald-800 bg-emerald-950/30' : 'border-rose-800 bg-rose-950/30'}`}>
                      <span className="text-slate-300">#{it.iteration}</span> {' '}
                      {it.changes.map((c: any) => `${c.name} ${c.oldValue.toFixed(2)}→${c.newValue.toFixed(2)}`).join(', ')} {' '}
                      <span className={it.accepted ? 'text-emerald-400' : 'text-rose-400'}>{it.accepted ? '✓' : '✗'} {it.newScore.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Live Reference Metrics */}
        {mode === 'listen' && refMetrics && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Waves className="w-4 h-4 text-fuchsia-400" /> LIVE METRICS</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs font-mono">
                {[['BPM', refMetrics.bpm.toFixed(0)], ['LUFS', refMetrics.lufs.toFixed(1)], ['SUB', refMetrics.subEnergy.toFixed(2)],
                  ['LOW', refMetrics.lowEnergy.toFixed(2)], ['MID', refMetrics.midEnergy.toFixed(2)], ['HIGH', refMetrics.highEnergy.toFixed(2)],
                  ['CENTROID', `${refMetrics.spectralCentroid.toFixed(0)}Hz`], ['TRANSIENT', `${refMetrics.transientDensity.toFixed(1)}/s`],
                  ['KICK', `${refMetrics.kickDecayMs.toFixed(0)}ms`], ['BASS', `${refMetrics.bassDecayMs.toFixed(0)}ms`],
                  ['ENERGY', refMetrics.energy.toFixed(2)], ['CONF', `${(refMetrics.energy * 100).toFixed(0)}%`]].map(([l, v]) => (
                  <div key={l} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                    <div className="text-[8px] text-slate-500 uppercase">{l}</div>
                    <div className="text-sm text-slate-200">{v}</div>
                  </div>
                ))}
              </div>
              {refMetrics.detectedKey && (
                <div className="mt-3 p-2 bg-emerald-950/30 border border-emerald-800 rounded text-[10px] font-mono text-emerald-400">
                  DETECTED: {refMetrics.detectedKey.rootName} {refMetrics.detectedKey.scale} (confidence {refMetrics.detectedKey.confidence.toFixed(2)})
                  {refMetrics.detectedStyle && ` · Style: ${refMetrics.detectedStyle.style}`}
                </div>
              )}
              {engineOn && (
                <div className="mt-2 p-2 bg-cyan-950/30 border border-cyan-800 rounded text-[10px] font-mono text-cyan-400">
                  ENGINE SYNCED: BPM {engineState.bpm} · Key {engineState.key} · Section {engineState.section} · World {WORLD_NAME[activeWorld] ?? activeWorld}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="border-t border-slate-800 bg-slate-900/60 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-3 text-[10px] text-slate-500 font-mono flex items-center justify-between flex-wrap gap-2">
          <span>PSY4 · Engine V2 · Synthesis · Effects · Harmony · Deep Pursuit · Melody · Style Detection · A/B Spectral · DJ Phase Sync</span>
          <span>NO ScriptProcessor · NO AudioWorklet · Pure Web Audio</span>
        </div>
      </footer>
    </div>
  );
}
