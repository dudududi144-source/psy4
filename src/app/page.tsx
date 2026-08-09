'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Radio, Play, Square, Activity, Gauge, Loader2, Wifi, WifiOff,
  TrendingUp, TrendingDown, Minus, Brain, Target, Zap, AlertTriangle,
  CheckCircle2, XCircle, Volume2, VolumeX, RefreshCw,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RadioStream {
  id: string;
  name: string;
  url: string;
  format: string;
  bitrate: number;
  genre: string;
  worldMapping: string[];
  hasMetadata: boolean;
  priority: number;
  notes?: string;
}

interface ReferenceMetrics {
  bpm: number;
  bpmConfidence: number;
  rms: number;
  peak: number;
  lufs: number;
  crestFactor: number;
  subEnergy: number;
  lowEnergy: number;
  midEnergy: number;
  highEnergy: number;
  airEnergy: number;
  spectralCentroid: number;
  spectralFlatness: number;
  spectralRolloff: number;
  transientDensity: number;
  kickDensity: number;
  hatDensity: number;
  percussionDensity: number;
  stereoWidth: number;
  kickDecayMs: number;
  bassDecayMs: number;
  rhythmicRegularity: number;
  repetitionScore: number;
  energy: number;
  overallConfidence: number;
  timestamp: number;
  sourceStream: string;
}

interface ReferenceProfile {
  bpm: { mean: number; p10: number; p90: number; count: number };
  lufs: { mean: number; p10: number; p90: number };
  subEnergy: { mean: number; p10: number; p90: number };
  lowEnergy: { mean: number; p10: number; p90: number };
  midEnergy: { mean: number; p10: number; p90: number };
  highEnergy: { mean: number; p10: number; p90: number };
  airEnergy: { mean: number; p10: number; p90: number };
  spectralCentroid: { mean: number; p10: number; p90: number };
  transientDensity: { mean: number; p10: number; p90: number };
  kickDecayMs: { mean: number; p10: number; p90: number };
  bassDecayMs: { mean: number; p10: number; p90: number };
  stereoWidth: { mean: number; p10: number; p90: number };
  energy: { mean: number; p10: number; p90: number };
  windowCount: number;
  lastUpdated: number;
  sourceStream: string;
}

interface TrainingIteration {
  iteration: number;
  changes: { name: string; oldValue: number; newValue: number; delta: number }[];
  oldScore: number;
  newScore: number;
  scoreDelta: number;
  accepted: boolean;
  reason: string;
}

interface TrainingResult {
  ok: boolean;
  iterations: TrainingIteration[];
  initialScore: number;
  finalScore: number;
  bestScore: number;
  bestParams: Record<string, number>;
  referenceScoreBreakdown: string[];
  error?: string;
}

type Mode = 'listen' | 'analyze' | 'train';

// ─── World catalogue ────────────────────────────────────────────────────────

const WORLD_OPTIONS = [
  { id: 'progressive-psy', name: 'Progressive Psy', bpm: 128 },
  { id: 'dark-psy', name: 'Dark Psy', bpm: 150 },
  { id: 'goa', name: 'Goa', bpm: 140 },
  { id: 'morning-psy', name: 'Morning Psy', bpm: 142 },
  { id: 'forest', name: 'Forest', bpm: 148 },
  { id: 'acid-psy', name: 'Acid Psy', bpm: 142 },
];

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function ReferenceTrainingPage() {
  const [streams, setStreams] = useState<RadioStream[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<string>('');
  const [worldId, setWorldId] = useState('dark-psy');
  const [mode, setMode] = useState<Mode>('listen');

  // Reference state
  const [refConnected, setRefConnected] = useState(false);
  const [refMetrics, setRefMetrics] = useState<ReferenceMetrics | null>(null);
  const [refProfile, setRefProfile] = useState<ReferenceProfile | null>(null);
  const [refHistory, setRefHistory] = useState<ReferenceMetrics[]>([]);

  // Self-analysis state
  const [selfMetrics, setSelfMetrics] = useState<ReferenceMetrics | null>(null);
  const [enginePlaying, setEnginePlaying] = useState(false);

  // Training state
  const [training, setTraining] = useState(false);
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);

  // Performance
  const [perfStable, setPerfStable] = useState<boolean | null>(null);
  const [perfFailures, setPerfFailures] = useState<string[]>([]);

  // Refs for audio objects (not React state)
  const listenerRef = useRef<any>(null);
  const selfAnalyzerRef = useRef<any>(null);
  const engineRef = useRef<any>(null);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);
  const [refAudioPlaying, setRefAudioPlaying] = useState(false);

  // Load available streams — try API first, fall back to static JSON
  useEffect(() => {
    fetch('/api/reference/streams')
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.streams) {
          setStreams(data.streams);
          const matching = data.streams.filter((s: RadioStream) =>
            s.worldMapping.includes(worldId));
          const httpsMatch = matching.find((s: RadioStream) => s.url.startsWith('https'));
          setSelectedStreamId(httpsMatch?.id || matching[0]?.id || data.streams[0].id);
        }
      })
      .catch(() => {
        // Fallback to static JSON (for static hosting)
        fetch('/api/streams.json')
          .then(r => r.json())
          .then(data => {
            if (data.ok && data.streams) {
              setStreams(data.streams);
              const matching = data.streams.filter((s: RadioStream) =>
                s.worldMapping.includes(worldId));
              const httpsMatch = matching.find((s: RadioStream) => s.url.startsWith('https'));
              setSelectedStreamId(httpsMatch?.id || matching[0]?.id || data.streams[0].id);
            }
          })
          .catch(() => {});
      });
  }, []);

  // ─── Reference listener control ──────────────────────────────────────────

  const connectReference = useCallback(async () => {
    if (!selectedStreamId) return;
    const stream = streams.find(s => s.id === selectedStreamId);
    if (!stream) return;

    try {
      // Dynamically import the reference listener (client-side only)
      const { ReferenceListenerV2 } = await import('@/lib/studio/engine/reference/referenceListenerV2');

      // Disconnect existing
      if (listenerRef.current) {
        await listenerRef.current.disconnect();
      }

      const listener = new ReferenceListenerV2();
      listener.onMetrics(m => {
        setRefMetrics(m);
        setRefHistory(prev => [...prev.slice(-29), m]);
      });
      listener.onProfile(p => setRefProfile(p));
      listener.onError(e => {
        toast.error(`Reference stream error: ${e.message}`);
        setRefConnected(false);
      });

      const ok = await listener.connect(stream);
      if (ok) {
        listener.start();
        listenerRef.current = listener;
        setRefConnected(true);
        toast.success(`Connected to ${stream.name} — fetching stream for analysis`);
      } else {
        toast.error(`Failed to connect to ${stream.name}`);
      }
    } catch (err) {
      toast.error(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [selectedStreamId, streams]);

  const disconnectReference = useCallback(async () => {
    if (listenerRef.current) {
      await listenerRef.current.disconnect();
      listenerRef.current = null;
    }
    // Also stop reference audio playback if active
    if (refAudioRef.current) {
      refAudioRef.current.pause();
      refAudioRef.current = null;
      setRefAudioPlaying(false);
    }
    setRefConnected(false);
    setRefMetrics(null);
    setRefProfile(null);
    setRefHistory([]);
  }, []);

  // ─── Reference audio playback (so user can HEAR the radio) ─────────────
  const toggleRefAudio = useCallback(async () => {
    if (refAudioPlaying && refAudioRef.current) {
      refAudioRef.current.pause();
      setRefAudioPlaying(false);
      return;
    }
    const stream = streams.find(s => s.id === selectedStreamId);
    if (!stream) return;
    try {
      if (!refAudioRef.current) {
        refAudioRef.current = new Audio();
        refAudioRef.current.crossOrigin = 'anonymous';
        refAudioRef.current.volume = 0.6;
      }
      // Try proxy first, fall back to direct URL
      const tryPlay = async (url: string) => {
        refAudioRef.current!.src = url;
        await refAudioRef.current!.play();
      };
      try {
        await tryPlay(`/api/reference/proxy?stream=${encodeURIComponent(stream.id)}&continuous=1`);
      } catch {
        // Proxy failed — try direct URL (works for HTTPS streams)
        await tryPlay(stream.url);
      }
      setRefAudioPlaying(true);
      toast.success(`Playing: ${stream.name}`);
    } catch (err) {
      toast.error(`Playback failed: ${err instanceof Error ? err.message : String(err)}`);
      setRefAudioPlaying(false);
    }
  }, [refAudioPlaying, selectedStreamId, streams]);

  // ─── Engine playback + self-analysis ─────────────────────────────────────

  const startEngine = useCallback(async () => {
    try {
      const { Psy4LiveEngine } = await import('@/lib/studio/engine/psy4LiveEngine');
      const { SelfAnalyzer } = await import('@/lib/studio/engine/reference/selfAnalyzer');

      if (engineRef.current) {
        engineRef.current.stop();
      }

      const engine = new Psy4LiveEngine();
      engine.start(worldId, Math.floor(Math.random() * 1000000), {
        energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
        groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
        aggression: 0.4, brightness: 0.55,
      });
      engineRef.current = engine;
      setEnginePlaying(true);

      // Attach self-analyzer after engine starts
      // Use getAnalyser() which is always available (both legacy + worklet modes)
      setTimeout(async () => {
        try {
          if (engineRef.current?.ctx) {
            const analyser = engineRef.current.getAnalyser();
            if (analyser) {
              const { SelfAnalyzer } = await import('@/lib/studio/engine/reference/selfAnalyzer');
              const analyzer = new SelfAnalyzer();
              analyzer.attach(analyser, engineRef.current.ctx);
              analyzer.onMetrics(m => setSelfMetrics(m));
              analyzer.start();
              selfAnalyzerRef.current = analyzer;
            }
          }
        } catch (err) {
          console.warn('[SelfAnalyzer] attach failed:', err);
        }
      }, 2000);

      toast.success('Engine started — self-analysis active');
    } catch (err) {
      toast.error(`Engine error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [worldId]);

  const stopEngine = useCallback(() => {
    if (selfAnalyzerRef.current) {
      selfAnalyzerRef.current.detach();
      selfAnalyzerRef.current = null;
    }
    if (engineRef.current) {
      engineRef.current.stop();
      engineRef.current = null;
    }
    setEnginePlaying(false);
    setSelfMetrics(null);
  }, []);

  // ─── Training ────────────────────────────────────────────────────────────

  const runTraining = useCallback(async () => {
    if (!refProfile) {
      toast.error('No reference profile — connect to a stream first');
      return;
    }
    if (perfStable === false) {
      toast.error('Engine not stable — fix performance issues before training');
      return;
    }

    setTraining(true);
    setTrainingResult(null);

    try {
      const response = await fetch('/api/reference/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worldId,
          seed: 1234,
          duration: 12,
          currentParams: {},
          referenceProfile: refProfile,
          maxIterations: 6,
          maxChangesPerIteration: 2,
        }),
      });
      const data = await response.json();
      if (data.ok) {
        setTrainingResult(data);
        toast.success(`Training complete: ${data.initialScore} → ${data.finalScore}`);
      } else {
        toast.error(`Training failed: ${data.error}`);
      }
    } catch (err) {
      toast.error(`Training error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTraining(false);
    }
  }, [refProfile, worldId, perfStable]);

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (listenerRef.current) listenerRef.current.disconnect();
      if (selfAnalyzerRef.current) selfAnalyzerRef.current.detach();
      if (engineRef.current) engineRef.current.stop();
    };
  }, []);

  // ─── Derived data ────────────────────────────────────────────────────────

  const selectedStream = streams.find(s => s.id === selectedStreamId);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Toaster />

      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-8 h-8 text-fuchsia-400" />
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">
                PSY4 REFERENCE TRAINING
              </h1>
              <p className="text-xs text-slate-400 font-mono">
                REFERENCE-DRIVEN · SELF-LISTENING · ACCEPT/REJECT OPTIMIZER
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={refConnected ? 'default' : 'secondary'} className="font-mono">
              {refConnected ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
              {refConnected ? 'REF LIVE' : 'REF OFFLINE'}
            </Badge>
            <Badge variant={enginePlaying ? 'default' : 'secondary'} className="font-mono">
              {enginePlaying ? <Activity className="w-3 h-3 mr-1" /> : <Activity className="w-3 h-3 mr-1 opacity-40" />}
              {enginePlaying ? 'ENGINE ON' : 'ENGINE OFF'}
            </Badge>
            {perfStable !== null && (
              <Badge variant={perfStable ? 'default' : 'destructive'} className="font-mono">
                {perfStable ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
                {perfStable ? 'STABLE' : 'UNSTABLE'}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Mode selector */}
        <Card className="border-slate-800 bg-slate-900/60">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-mono text-slate-400">MODE:</span>
              {(['listen', 'analyze', 'train'] as Mode[]).map(m => (
                <Button
                  key={m}
                  variant={mode === m ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMode(m)}
                  className={mode === m ? 'bg-fuchsia-600 hover:bg-fuchsia-700' : ''}
                >
                  {m === 'listen' && <Volume2 className="w-4 h-4 mr-1" />}
                  {m === 'analyze' && <Activity className="w-4 h-4 mr-1" />}
                  {m === 'train' && <Brain className="w-4 h-4 mr-1" />}
                  {m.toUpperCase()}
                </Button>
              ))}
              <div className="ml-auto flex items-center gap-2">
                <Label className="text-xs font-mono text-slate-400">WORLD:</Label>
                <select
                  value={worldId}
                  onChange={e => setWorldId(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm font-mono"
                >
                  {WORLD_OPTIONS.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.bpm} BPM)</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-2 font-mono">
              {mode === 'listen' && 'Connect to a live psytrance radio stream. No optimization. Pure listening + feature extraction.'}
              {mode === 'analyze' && 'Compare reference stream vs our engine output side-by-side. See measured differences.'}
              {mode === 'train' && 'Run the optimizer: generate → analyze → compare → modify → accept/reject. 1-3 params per iteration.'}
            </p>
          </CardContent>
        </Card>

        {/* Reference stream control */}
        <Card className="border-slate-800 bg-slate-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="w-4 h-4 text-fuchsia-400" />
              REFERENCE STREAM
            </CardTitle>
            <CardDescription className="text-xs">
              Live 24/7 psytrance radio — used for feature extraction, NOT playback
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <Label className="text-xs font-mono text-slate-400">STREAM</Label>
                <select
                  value={selectedStreamId}
                  onChange={e => setSelectedStreamId(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm font-mono"
                >
                  {streams.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.genre} ({s.bitrate}kbps {s.format.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
              {!refConnected ? (
                <Button onClick={connectReference} className="bg-emerald-600 hover:bg-emerald-700">
                  <Wifi className="w-4 h-4 mr-1" /> CONNECT
                </Button>
              ) : (
                <Button onClick={disconnectReference} variant="destructive">
                  <WifiOff className="w-4 h-4 mr-1" /> DISCONNECT
                </Button>
              )}
              {refConnected && (
                <Button
                  onClick={toggleRefAudio}
                  variant={refAudioPlaying ? 'secondary' : 'outline'}
                  className={refAudioPlaying ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'border-amber-600 text-amber-400 hover:bg-amber-950'}
                >
                  {refAudioPlaying ? <Volume2 className="w-4 h-4 mr-1" /> : <VolumeX className="w-4 h-4 mr-1" />}
                  {refAudioPlaying ? 'STOP AUDIO' : 'PLAY REFERENCE'}
                </Button>
              )}
            </div>
            {selectedStream && (
              <p className="text-xs text-slate-500 font-mono">
                {selectedStream.notes} · {selectedStream.hasMetadata ? 'ICY metadata available' : 'no metadata'}
              </p>
            )}
            {refConnected && refProfile && (
              <div className="text-xs font-mono text-slate-400">
                Windows collected: {refProfile.windowCount} · Updated: {new Date(refProfile.lastUpdated).toLocaleTimeString()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Engine control */}
        <Card className="border-slate-800 bg-slate-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="w-4 h-4 text-cyan-400" />
              OUR ENGINE (SELF-LISTENING)
            </CardTitle>
            <CardDescription className="text-xs">
              Play our engine — self-analyzer taps the actual audio bus (AnalyserNode, no ScriptProcessor)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!enginePlaying ? (
              <Button onClick={startEngine} className="bg-cyan-600 hover:bg-cyan-700">
                <Play className="w-4 h-4 mr-1" /> START ENGINE + SELF-ANALYSIS
              </Button>
            ) : (
              <Button onClick={stopEngine} variant="destructive">
                <Square className="w-4 h-4 mr-1" /> STOP ENGINE
              </Button>
            )}
          </CardContent>
        </Card>

        {/* A/B comparison (analyze mode) */}
        {(mode === 'analyze' || mode === 'train') && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="w-4 h-4 text-amber-400" />
                A/B COMPARISON: REFERENCE vs OUR ENGINE
              </CardTitle>
              <CardDescription className="text-xs">
                Side-by-side measured features. Every number comes from real audio analysis.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700">
                    <TableHead className="text-slate-400 font-mono text-xs">METRIC</TableHead>
                    <TableHead className="text-fuchsia-400 font-mono text-xs">REFERENCE</TableHead>
                    <TableHead className="text-cyan-400 font-mono text-xs">OUR ENGINE</TableHead>
                    <TableHead className="text-amber-400 font-mono text-xs">ERROR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <ComparisonRow label="BPM" refVal={refProfile?.bpm.mean} ourVal={refMetrics?.bpm || selfMetrics?.bpm} unit="" />
                  <ComparisonRow label="LUFS" refVal={refProfile?.lufs.mean} ourVal={selfMetrics?.lufs} unit=" dB" />
                  <ComparisonRow label="Sub energy" refVal={refProfile?.subEnergy.mean} ourVal={selfMetrics?.subEnergy} unit="" />
                  <ComparisonRow label="Low energy" refVal={refProfile?.lowEnergy.mean} ourVal={selfMetrics?.lowEnergy} unit="" />
                  <ComparisonRow label="Mid energy" refVal={refProfile?.midEnergy.mean} ourVal={selfMetrics?.midEnergy} unit="" />
                  <ComparisonRow label="High energy" refVal={refProfile?.highEnergy.mean} ourVal={selfMetrics?.highEnergy} unit="" />
                  <ComparisonRow label="Air energy" refVal={refProfile?.airEnergy.mean} ourVal={selfMetrics?.airEnergy} unit="" />
                  <ComparisonRow label="Spectral centroid" refVal={refProfile?.spectralCentroid.mean} ourVal={selfMetrics?.spectralCentroid} unit=" Hz" />
                  <ComparisonRow label="Transient density" refVal={refProfile?.transientDensity.mean} ourVal={selfMetrics?.transientDensity} unit="/s" />
                  <ComparisonRow label="Kick decay" refVal={refProfile?.kickDecayMs.mean} ourVal={selfMetrics?.kickDecayMs} unit="ms" />
                  <ComparisonRow label="Bass decay" refVal={refProfile?.bassDecayMs.mean} ourVal={selfMetrics?.bassDecayMs} unit="ms" />
                  <ComparisonRow label="Stereo width" refVal={refProfile?.stereoWidth.mean} ourVal={selfMetrics?.stereoWidth} unit="" />
                  <ComparisonRow label="Energy" refVal={refProfile?.energy.mean} ourVal={selfMetrics?.energy} unit="" />
                </TableBody>
              </Table>
              {(!refProfile || !selfMetrics) && (
                <p className="text-xs text-slate-500 mt-3 font-mono">
                  {!refProfile ? '⚠ Connect reference stream to see reference metrics' : ''}
                  {!selfMetrics ? '⚠ Start engine to see our metrics' : ''}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Training control + results (train mode) */}
        {mode === 'train' && (
          <>
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brain className="w-4 h-4 text-emerald-400" />
                  TRAINING LOOP
                </CardTitle>
                <CardDescription className="text-xs">
                  GENERATE → ANALYZE → COMPARE → MODIFY → ACCEPT/REJECT
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={runTraining}
                  disabled={training || !refProfile}
                  className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                >
                  {training ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
                  {training ? 'TRAINING...' : 'RUN TRAINING (6 ITERATIONS)'}
                </Button>
                {!refProfile && (
                  <p className="text-xs text-amber-400 mt-2 font-mono">
                    ⚠ Connect reference stream and wait for profile to build before training
                  </p>
                )}
                {perfStable === false && (
                  <p className="text-xs text-red-400 mt-2 font-mono">
                    ⚠ Engine unstable — do not train until performance is stable
                  </p>
                )}
              </CardContent>
            </Card>

            {trainingResult && (
              <Card className="border-slate-800 bg-slate-900/60">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="w-4 h-4 text-fuchsia-400" />
                    TRAINING RESULTS
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <ScoreBox label="INITIAL" value={trainingResult.initialScore} color="amber" />
                    <ScoreBox label="FINAL" value={trainingResult.finalScore} color="cyan" />
                    <ScoreBox label="BEST" value={trainingResult.bestScore} color="emerald" />
                  </div>

                  <div>
                    <h4 className="text-sm font-mono text-slate-400 mb-2">ITERATIONS</h4>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {trainingResult.iterations.map(iter => (
                        <IterationCard key={iter.iteration} iter={iter} />
                      ))}
                    </div>
                  </div>

                  {trainingResult.referenceScoreBreakdown && (
                    <div>
                      <h4 className="text-sm font-mono text-slate-400 mb-2">REFERENCE SCORE BREAKDOWN</h4>
                      <pre className="text-xs font-mono text-slate-300 bg-slate-950 p-3 rounded border border-slate-800">
                        {trainingResult.referenceScoreBreakdown.join('\n')}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Reference metrics history (listen mode) */}
        {mode === 'listen' && refMetrics && (
          <Card className="border-slate-800 bg-slate-900/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="w-4 h-4 text-fuchsia-400" />
                LIVE REFERENCE METRICS
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm font-mono">
                <MetricBox label="BPM" value={refMetrics.bpm.toFixed(0)} />
                <MetricBox label="LUFS" value={refMetrics.lufs.toFixed(1)} />
                <MetricBox label="SUB" value={refMetrics.subEnergy.toFixed(2)} />
                <MetricBox label="LOW" value={refMetrics.lowEnergy.toFixed(2)} />
                <MetricBox label="MID" value={refMetrics.midEnergy.toFixed(2)} />
                <MetricBox label="HIGH" value={refMetrics.highEnergy.toFixed(2)} />
                <MetricBox label="TRANSIENT" value={`${refMetrics.transientDensity.toFixed(1)}/s`} />
                <MetricBox label="KICK DECAY" value={`${refMetrics.kickDecayMs.toFixed(0)}ms`} />
                <MetricBox label="CENTROID" value={`${refMetrics.spectralCentroid.toFixed(0)}Hz`} />
                <MetricBox label="FLATNESS" value={refMetrics.spectralFlatness.toFixed(3)} />
                <MetricBox label="ENERGY" value={refMetrics.energy.toFixed(2)} />
                <MetricBox label="CONFIDENCE" value={`${(refMetrics.overallConfidence * 100).toFixed(0)}%`} />
              </div>
              {refProfile && (
                <div className="mt-4 text-xs font-mono text-slate-400">
                  <p>ROLLING PROFILE ({refProfile.windowCount} windows):</p>
                  <p>BPM: {refProfile.bpm.mean.toFixed(0)} (p10 {refProfile.bpm.p10.toFixed(0)}, p90 {refProfile.bpm.p90.toFixed(0)})</p>
                  <p>LUFS: {refProfile.lufs.mean.toFixed(1)} (p10 {refProfile.lufs.p10.toFixed(1)}, p90 {refProfile.lufs.p90.toFixed(1)})</p>
                  <p>Kick decay: {refProfile.kickDecayMs.mean.toFixed(0)}ms (p10 {refProfile.kickDecayMs.p10.toFixed(0)}, p90 {refProfile.kickDecayMs.p90.toFixed(0)})</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/60 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
            <Radio className="w-3 h-3 text-fuchsia-400" />
            <span>PSY4 · REFERENCE-DRIVEN TRAINING</span>
          </div>
          <div className="text-xs text-slate-500 font-mono">
            NO ScriptProcessor · NO audio copying · ONLY feature extraction
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Helper components ──────────────────────────────────────────────────────

function ComparisonRow({ label, refVal, ourVal, unit }: {
  label: string;
  refVal?: number;
  ourVal?: number;
  unit: string;
}) {
  const refStr = refVal !== undefined ? refVal.toFixed(unit === '' ? 2 : 1) : '—';
  const ourStr = ourVal !== undefined ? ourVal.toFixed(unit === '' ? 2 : 1) : '—';
  const error = (refVal !== undefined && ourVal !== undefined) ? ourVal - refVal : null;
  const errorStr = error !== null ? `${error > 0 ? '+' : ''}${error.toFixed(unit === '' ? 2 : 1)}${unit}` : '—';
  const errorColor = error === null ? 'text-slate-500' :
                     Math.abs(error) < 0.1 ? 'text-emerald-400' :
                     Math.abs(error) < 0.3 ? 'text-amber-400' : 'text-red-400';

  return (
    <TableRow className="border-slate-800">
      <TableCell className="font-mono text-xs text-slate-300">{label}</TableCell>
      <TableCell className="font-mono text-xs text-fuchsia-300">{refStr}{refVal !== undefined ? unit : ''}</TableCell>
      <TableCell className="font-mono text-xs text-cyan-300">{ourStr}{ourVal !== undefined ? unit : ''}</TableCell>
      <TableCell className={`font-mono text-xs ${errorColor}`}>{errorStr}</TableCell>
    </TableRow>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2">
      <div className="text-[10px] text-slate-500 uppercase">{label}</div>
      <div className="text-base text-slate-200">{value}</div>
    </div>
  );
}

function ScoreBox({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClass = color === 'emerald' ? 'text-emerald-400 border-emerald-700' :
                     color === 'cyan' ? 'text-cyan-400 border-cyan-700' :
                     'text-amber-400 border-amber-700';
  return (
    <div className={`bg-slate-950 border ${colorClass} rounded p-3 text-center`}>
      <div className="text-[10px] text-slate-500 uppercase font-mono">{label}</div>
      <div className={`text-2xl font-bold ${colorClass.split(' ')[0]}`}>{value.toFixed(0)}</div>
      <div className="text-[10px] text-slate-500 font-mono">/ 100</div>
    </div>
  );
}

function IterationCard({ iter }: { iter: TrainingIteration }) {
  const accepted = iter.accepted;
  return (
    <div className={`border rounded p-3 font-mono text-xs ${
      accepted ? 'border-emerald-800 bg-emerald-950/30' : 'border-red-800 bg-red-950/30'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-slate-300">ITERATION {iter.iteration}</span>
        <Badge variant={accepted ? 'default' : 'destructive'} className="text-[10px]">
          {accepted ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <XCircle className="w-3 h-3 mr-1" />}
          {accepted ? 'ACCEPTED' : 'REJECTED'}
        </Badge>
      </div>
      {iter.changes.length > 0 ? (
        <div className="space-y-1">
          {iter.changes.map((c, i) => (
            <div key={i} className="text-slate-400">
              <span className="text-cyan-300">{c.name}</span>: {c.oldValue.toFixed(3)} → {c.newValue.toFixed(3)}
              <span className="text-slate-600"> (Δ {c.delta > 0 ? '+' : ''}{c.delta.toFixed(3)})</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-slate-500">No changes proposed</div>
      )}
      <div className="mt-2 text-slate-300">
        Score: {iter.oldScore.toFixed(1)} → {iter.newScore.toFixed(1)}
        <span className={iter.scoreDelta > 0 ? 'text-emerald-400' : iter.scoreDelta < 0 ? 'text-red-400' : 'text-slate-500'}>
          {' '}({iter.scoreDelta > 0 ? '+' : ''}{iter.scoreDelta.toFixed(1)})
        </span>
      </div>
      <div className="text-slate-500 mt-1">{iter.reason}</div>
    </div>
  );
}
