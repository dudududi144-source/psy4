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

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (listenerRef.current) listenerRef.current.disconnect();
    if (analyzerRef.current) analyzerRef.current.detach();
    if (engineRef.current) engineRef.current.stop();
    if (trainerRef.current) trainerRef.current.stop();
  }, []);

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
          <span>PSY4 · Engine V2 · Pooled Voices · 8 Tracks · Factory Presets · Style Detection · A/B Spectral</span>
          <span>NO ScriptProcessor · NO AudioWorklet · Pure Web Audio</span>
        </div>
      </footer>
    </div>
  );
}
