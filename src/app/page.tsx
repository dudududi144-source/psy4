'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Radio, Play, Square, Activity, Wifi, WifiOff, Volume2, VolumeX,
  Zap, Brain, CheckCircle2, Music, Gauge, Waves,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RadioStream {
  id: string; name: string; url: string; format: string; bitrate: number;
  genre: string; worldMapping: string[]; hasMetadata: boolean; priority: number;
}

interface RefMetrics {
  bpm: number; lufs: number; subEnergy: number; lowEnergy: number;
  midEnergy: number; highEnergy: number; airEnergy: number;
  spectralCentroid: number; transientDensity: number; kickDecayMs: number;
  bassDecayMs: number; stereoWidth: number; energy: number;
  detectedKey?: { root: number; rootName: string; scale: string; confidence: number };
  detectedStyle?: { style: string; confidence: number };
}

interface RefProfile {
  bpm: { mean: number }; lufs: { mean: number };
  subEnergy: { mean: number }; lowEnergy: { mean: number };
  midEnergy: { mean: number }; highEnergy: { mean: number }; airEnergy: { mean: number };
  spectralCentroid: { mean: number }; transientDensity: { mean: number };
  kickDecayMs: { mean: number }; bassDecayMs: { mean: number };
  stereoWidth: { mean: number }; energy: { mean: number };
  windowCount: number;
}

type Mode = 'listen' | 'analyze' | 'train';

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
  const [engineState, setEngineState] = useState<{ bpm: number; key: string; section: string }>({
    bpm: 145, key: 'phrygian', section: 'INTRO',
  });

  // Learning
  const [learning, setLearning] = useState(false);
  const [learnState, setLearnState] = useState<any>(null);

  // Refs
  const listenerRef = useRef<any>(null);
  const analyzerRef = useRef<any>(null);
  const engineRef = useRef<any>(null);
  const trainerRef = useRef<any>(null);
  const refAudioRef = useRef<HTMLAudioElement | null>(null);

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
          engineRef.current.liveTrack({ lufs: m.lufs, kickDecayMs: m.kickDecayMs, spectralCentroid: m.spectralCentroid, subEnergy: m.subEnergy, highEnergy: m.highEnergy, transientDensity: m.transientDensity, energy: m.energy });
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
      engine.start(worldId);
      engineRef.current = engine;
      setEngineOn(true);
      setEngineState({ bpm: (engine as any)._bpm || 145, key: engine.getMusicalKey()?.scale || 'phrygian', section: 'INTRO' });

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
          if (engineRef.current?.selfTrack) engineRef.current.selfTrack(m);
          setEngineState(prev => ({ ...prev, bpm: (engineRef.current as any)?._bpm || prev.bpm, key: engineRef.current?.getMusicalKey()?.scale || prev.key }));
        });
        a.start();
        analyzerRef.current = a;
      }
      toast.success('Engine V2 started');
    } catch (e) { toast.error(`Engine error: ${e instanceof Error ? e.message : String(e)}`); }
  }, [worldId]);

  const stopEngine = useCallback(() => {
    if (analyzerRef.current) { analyzerRef.current.detach(); analyzerRef.current = null; }
    if (engineRef.current) { engineRef.current.stop(); engineRef.current = null; }
    if (trainerRef.current) { trainerRef.current.stop(); trainerRef.current = null; }
    setEngineOn(false); setSelfMetrics(null); setLearning(false);
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

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (listenerRef.current) listenerRef.current.disconnect();
    if (analyzerRef.current) analyzerRef.current.detach();
    if (engineRef.current) engineRef.current.stop();
    if (trainerRef.current) trainerRef.current.stop();
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const refVal = (v?: number) => v !== undefined ? v.toFixed(2) : '—';
  const refDb = (v?: number) => v !== undefined ? `${v.toFixed(1)} dB` : '—';
  const refHz = (v?: number) => v !== undefined ? `${v.toFixed(0)} Hz` : '—';
  const refMs = (v?: number) => v !== undefined ? `${v.toFixed(0)} ms` : '—';

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Toaster />
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Radio className="w-7 h-7 text-fuchsia-400" />
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">PSY4 ENGINE V2</h1>
              <p className="text-[10px] text-slate-400 font-mono">POOLED VOICES · FACTORY PRESETS · LIVE SYNC</p>
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
              <div className="ml-auto flex items-center gap-2">
                <select value={streamId} onChange={e => setStreamId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono">
                  {streams.map(s => <option key={s.id} value={s.id}>{s.name} ({s.bitrate}kbps)</option>)}
                </select>
                <select value={worldId} onChange={e => setWorldId(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono">
                  {['progressive-psy', 'dark-psy', 'goa', 'morning-psy', 'forest', 'acid-psy'].map(w => <option key={w} value={w}>{w}</option>)}
                </select>
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
                  BPM: <span className="text-cyan-400">{engineState.bpm}</span> · Key: <span className="text-cyan-400">{engineState.key}</span> · Section: <span className="text-cyan-400">{engineState.section}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* A/B Comparison */}
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
                    const errColor = err === '—' ? 'text-slate-500' : Math.abs(parseFloat(err)) < 0.1 ? 'text-emerald-400' : Math.abs(parseFloat(err)) < 0.3 ? 'text-amber-400' : 'text-red-400';
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
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {[...learnState.iterations].reverse().slice(0, 10).map((it: any, i: number) => (
                    <div key={i} className={`border rounded p-2 text-[10px] font-mono ${it.accepted ? 'border-emerald-800 bg-emerald-950/30' : 'border-red-800 bg-red-950/30'}`}>
                      <span className="text-slate-300">#{it.iteration}</span> {' '}
                      {it.changes.map((c: any) => `${c.name} ${c.oldValue.toFixed(2)}→${c.newValue.toFixed(2)}`).join(', ')} {' '}
                      <span className={it.accepted ? 'text-emerald-400' : 'text-red-400'}>{it.accepted ? '✓' : '✗'} {it.newScore.toFixed(1)}</span>
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
                  ENGINE SYNCED: BPM {engineState.bpm} · Key {engineState.key} · Section {engineState.section}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>

      <footer className="border-t border-slate-800 bg-slate-900/60 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-3 text-[10px] text-slate-500 font-mono flex items-center justify-between">
          <span>PSY4 · Engine V2 · Pooled Voices · 8 Tracks · Factory Presets</span>
          <span>NO ScriptProcessor · NO AudioWorklet · Pure Web Audio</span>
        </div>
      </footer>
    </div>
  );
}
