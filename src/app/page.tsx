'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  Play, Square, Radio, Zap, Sparkle, Moon, Sun, Layers, Drum,
  TrendingUp, Waves, Shuffle, Flame, RotateCcw, Music, Activity, Gauge,
} from 'lucide-react';
import { Psy4LiveEngine, Macros } from '@/lib/studio/engine/psy4LiveEngine';

export default function LivePage() {
  const engineRef = useRef<Psy4LiveEngine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [worlds, setWorlds] = useState<{ id: string; name: string }[]>([]);
  const [worldId, setWorldId] = useState('progressive-psy');
  const [section, setSection] = useState('idle');
  const [bar, setBar] = useState(0);
  const [phrase, setPhrase] = useState(0);
  const [macros, setMacros] = useState<Macros>({
    energy: 0.6, psychedelia: 0.55, darkness: 0.4, density: 0.55,
    groove: 0.5, evolution: 0.5, space: 0.4, surprise: 0.3,
    aggression: 0.4, brightness: 0.55,
  });
  const [audioLevel, setAudioLevel] = useState(0);
  const [engineMode, setEngineMode] = useState('Web Audio');
  const [activeVoices, setActiveVoices] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);
  // Audio capture state
  const captureRef = useRef<{ buffer: Float32Array[]; recording: boolean }>({ buffer: [], recording: false });

  useEffect(() => {
    engineRef.current = new Psy4LiveEngine();
    setWorlds(engineRef.current.getWorlds());
    return () => { engineRef.current?.stop(); };
  }, []);

  // update UI state from engine — THROTTLED to 2/sec
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      const e = engineRef.current;
      if (!e || !e.ctx) return;
      setSection(e.currentSection);
      setBar(e.currentBar);
      setPhrase(e.currentPhrase);
      setEngineMode(e.isWorkletEngineActive() ? 'Worklet' : 'Web Audio');
      setActiveVoices(e.getEngineStats()?.activeVoices ?? 0);
      const analyser = e.getAnalyser();
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < 64; i++) sum += data[i];
        setAudioLevel(sum / 64 / 255);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [playing]);

  // visualizer — REUSED buffer
  useEffect(() => {
    if (!playing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const e = engineRef.current;
    const analyser = e?.getAnalyser();
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      analyser.getByteFrequencyData(data);
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = 'rgba(10, 5, 20, 0.3)';
      ctx.fillRect(0, 0, w, h);
      const bars = 64;
      const barW = w / bars;
      for (let i = 0; i < bars; i++) {
        const v = data[i * 2] / 255;
        const bh = v * h * 0.8;
        const hue = 280 + i * 2;
        ctx.fillStyle = `hsl(${hue}, 80%, ${30 + v * 40}%)`;
        ctx.fillRect(i * barW, h - bh, barW - 1, bh);
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing]);

  const handlePlay = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (playing) {
      e.stop();
      setPlaying(false);
    } else {
      e.start(worldId, Math.floor(Math.random() * 1000000), macros);
      setPlaying(true);

      // ── CAPTURE: Insert ScriptProcessor to capture worklet output ──
      // Delay 2s to ensure worklet is fully loaded
      setTimeout(() => {
        if (!e.ctx || !e.isWorkletEngineActive()) return;
        const engineNode = e.engineNodePublic;
        const engineOutput = engineNode?.outputNode;
        if (engineOutput) {
          const processor = e.ctx.createScriptProcessor(4096, 2, 2);
          const capture = captureRef.current;
          capture.buffer = [];
          capture.recording = true;
          processor.onaudioprocess = (event) => {
            if (!capture.recording) return;
            const inputL = event.inputBuffer.getChannelData(0);
            const inputR = event.inputBuffer.getChannelData(1);
            const mono = new Float32Array(inputL.length);
            for (let i = 0; i < inputL.length; i++) mono[i] = (inputL[i] + inputR[i]) * 0.5;
            capture.buffer.push(mono);
          };
          engineOutput.connect(processor);
          processor.connect(e.ctx.destination); // ScriptProcessor needs to connect to destination to process
          console.log('[PSY4] Audio capture started — recording worklet output');
        } else {
          console.warn('[PSY4] Cannot start capture — engine output not available');
        }
      }, 2000);

      toast.success('Live playback started');
    }
  }, [playing, worldId, macros]);

  // Stop capture and download WAV
  const handleDownloadCapture = useCallback(async () => {
    const capture = captureRef.current;
    capture.recording = false;
    if (capture.buffer.length === 0) {
      toast.error('No audio captured');
      return;
    }

    // Concatenate all buffers
    const totalLen = capture.buffer.reduce((sum, b) => sum + b.length, 0);
    const audio = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of capture.buffer) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }

    const sr = engineRef.current?.ctx?.sampleRate || 44100;
    const duration = (totalLen / sr).toFixed(1);

    // Convert to WAV
    const buffer = new ArrayBuffer(44 + audio.length * 2);
    const view = new DataView(buffer);
    const writeString = (off: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + audio.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sr, true);
    view.setUint32(28, sr * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, audio.length * 2, true);
    let off = 44;
    for (let i = 0; i < audio.length; i++) {
      const s = Math.max(-1, Math.min(1, audio[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }

    // Download
    const blob = new Blob([buffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `psy4_worklet_capture.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Also upload to server for ced.cpp analysis
    try {
      console.log('[PSY4] Uploading capture to /api/analyze-audio...');
      const formData = new FormData();
      formData.append('audio', blob, 'psy4_worklet_capture.wav');
      const response = await fetch('/api/analyze-audio', { method: 'POST', body: formData });
      console.log('[PSY4] API response status:', response.status);
      if (response.ok) {
        const result = await response.json();
        console.log('[PSY4] AI Analysis result:', JSON.stringify(result).substring(0, 200));
        toast.success(`Captured ${duration}s — AI: ${result.tags?.[0]?.tag || 'analyzed'} (${(result.tags?.[0]?.score * 100 || 0).toFixed(0)}%)`);
      } else {
        console.warn('[PSY4] API returned:', response.status, await response.text());
        toast.success(`Captured ${duration}s — WAV downloaded`);
      }
    } catch (err) {
      console.error('[PSY4] Upload failed:', err);
      toast.success(`Captured ${duration}s — WAV downloaded`);
    }

    console.log(`[PSY4] Captured ${duration}s (${totalLen} samples) — WAV downloaded`);
  }, []);

  const handleWorldChange = useCallback((id: string) => {
    setWorldId(id);
    engineRef.current?.setWorld(id);
  }, []);

  const handleMacroChange = useCallback((key: keyof Macros, value: number) => {
    setMacros(prev => {
      const next = { ...prev, [key]: value };
      engineRef.current?.setMacros(next);
      return next;
    });
  }, []);

  const handleAction = useCallback((action: string) => {
    engineRef.current?.triggerAction(action);
    setTimeout(() => {
      const e = engineRef.current;
      if (e) setMacros({ ...e.macros });
    }, 50);
    toast.success(`Action: ${action}`);
  }, []);

  const macroControls = [
    { key: 'energy' as keyof Macros, label: 'Energy', icon: Zap, color: 'text-orange-400' },
    { key: 'psychedelia' as keyof Macros, label: 'Psychedelia', icon: Sparkle, color: 'text-fuchsia-400' },
    { key: 'darkness' as keyof Macros, label: 'Darkness', icon: Moon, color: 'text-purple-400' },
    { key: 'brightness' as keyof Macros, label: 'Brightness', icon: Sun, color: 'text-yellow-400' },
    { key: 'density' as keyof Macros, label: 'Density', icon: Layers, color: 'text-cyan-400' },
    { key: 'groove' as keyof Macros, label: 'Groove', icon: Drum, color: 'text-lime-400' },
    { key: 'evolution' as keyof Macros, label: 'Evolution', icon: TrendingUp, color: 'text-emerald-400' },
    { key: 'space' as keyof Macros, label: 'Space', icon: Waves, color: 'text-blue-400' },
  ];

  const actionButtons = [
    { action: 'stranger', label: 'Stranger', icon: Shuffle, color: 'bg-fuchsia-600 hover:bg-fuchsia-700' },
    { action: 'darker', label: 'Darker', icon: Moon, color: 'bg-purple-600 hover:bg-purple-700' },
    { action: 'brighter', label: 'Brighter', icon: Sun, color: 'bg-yellow-600 hover:bg-yellow-700' },
    { action: 'more-bass', label: 'More Bass', icon: Zap, color: 'bg-orange-600 hover:bg-orange-700' },
    { action: 'more-groove', label: 'More Groove', icon: Drum, color: 'bg-lime-600 hover:bg-lime-700' },
    { action: 'more-space', label: 'More Space', icon: Waves, color: 'bg-blue-600 hover:bg-blue-700' },
    { action: 'breakdown', label: 'Breakdown', icon: Moon, color: 'bg-indigo-600 hover:bg-indigo-700' },
    { action: 'build', label: 'Build', icon: TrendingUp, color: 'bg-emerald-600 hover:bg-emerald-700' },
    { action: 'drop', label: 'Drop', icon: Flame, color: 'bg-red-600 hover:bg-red-700' },
    { action: 'reset', label: 'Reset', icon: RotateCcw, color: 'bg-slate-600 hover:bg-slate-700' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 text-foreground">
      <Toaster />
      <header className="relative z-10 border-b border-border/60 bg-background/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Radio className="w-8 h-8 text-fuchsia-400" />
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-fuchsia-400 to-cyan-400 bg-clip-text text-transparent">PSY4 LIVE</h1>
              <p className="text-xs text-muted-foreground">Browser-native Web Audio · instant playback · zero latency</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* TRANSPORT */}
        <Card className="p-5 sm:p-6 border-fuchsia-500/20 bg-card/60">
          <div className="grid sm:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">World</label>
              <Select value={worldId} onValueChange={handleWorldChange}>
                <SelectTrigger className="border-fuchsia-500/20 bg-card/60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {worlds.map(w => <SelectItem key={w.id} value={w.id}><span className="font-semibold">{w.name}</span></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handlePlay} size="lg" className={`h-14 px-8 font-bold text-lg ${playing ? 'bg-red-600 hover:bg-red-700' : 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:opacity-90'} text-white`}>
              {playing ? <Square className="w-5 h-5 mr-2" /> : <Play className="w-5 h-5 mr-2" />}
              {playing ? 'Stop' : 'Play'}
            </Button>
            <div className="text-center px-4 py-2 rounded-lg bg-card/40 border border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Level</div>
              <div className="text-sm font-bold text-emerald-400">{((audioLevel ?? 0) * 100).toFixed(0)}%</div>
            </div>
            <div className="text-center px-4 py-2 rounded-lg bg-card/40 border border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Engine</div>
              <div className="text-sm font-bold text-cyan-400">{engineMode}</div>
            </div>
            <div className="text-center px-4 py-2 rounded-lg bg-card/40 border border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Voices</div>
              <div className="text-sm font-bold text-fuchsia-400">{activeVoices}</div>
            </div>
          </div>
          {playing && (
            <div className="mt-4">
              <canvas ref={canvasRef} width={800} height={80} className="w-full h-20 rounded-lg bg-black/40" />
            </div>
          )}
          {playing && (
            <div className="mt-3 flex items-center gap-4 text-[10px] font-mono text-muted-foreground">
              <span>SECTION: <span className="text-cyan-400">{section}</span></span>
              <span>BAR: <span className="text-cyan-400">{bar}</span></span>
              <span>PHRASE: <span className="text-cyan-400">{phrase}</span></span>
              <span>VOICES: <span className="text-fuchsia-400">{activeVoices}</span></span>
            </div>
          )}
          {playing && (
            <div className="mt-3">
              <Button onClick={handleDownloadCapture} size="sm" variant="outline" className="border-fuchsia-500/30">
                <Music className="w-4 h-4 mr-2" /> Download Worklet Capture (WAV)
              </Button>
            </div>
          )}
        </Card>

        {/* MACRO CONTROLS */}
        <Card className="p-5 sm:p-6 border-fuchsia-500/20 bg-card/60">
          <h4 className="font-semibold mb-4 flex items-center gap-2"><Gauge className="w-4 h-4 text-fuchsia-300" /> Live Macros — changes apply instantly</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {macroControls.map(c => (
              <div key={c.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium flex items-center gap-1.5"><c.icon className={`w-3.5 h-3.5 ${c.color}`} />{c.label}</label>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(macros[c.key] * 100)}</span>
                </div>
                <Slider
                  value={[macros[c.key] * 100]}
                  onValueChange={(v) => handleMacroChange(c.key, v[0] / 100)}
                  min={0} max={100} step={1}
                />
              </div>
            ))}
          </div>
        </Card>

        {/* ACTIONS */}
        <Card className="p-5 sm:p-6 border-fuchsia-500/20 bg-card/60">
          <h4 className="font-semibold mb-4 flex items-center gap-2"><Zap className="w-4 h-4 text-fuchsia-300" /> Performance Actions</h4>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {actionButtons.map(b => (
              <Button
                key={b.action}
                onClick={() => handleAction(b.action)}
                disabled={!playing}
                className={`${b.color} text-white font-medium h-auto py-3 flex-col gap-1`}
              >
                <b.icon className="w-4 h-4" />
                <span className="text-xs">{b.label}</span>
              </Button>
            ))}
          </div>
        </Card>

        {!playing && (
          <Card className="p-10 text-center border-fuchsia-500/20 bg-card/60">
            <Radio className="w-12 h-12 mx-auto mb-4 text-fuchsia-400 animate-pulse" />
            <p className="text-lg font-semibold mb-1">Press Play for instant live psychedelic music.</p>
            <p className="text-sm text-muted-foreground">AudioWorklet Engine · Sample-accurate · Zero-alloc voices</p>
          </Card>
        )}
      </main>

      <footer className="relative z-10 mt-auto border-t border-border/60 bg-background/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="w-4 h-4 text-fuchsia-400" />
            <span className="font-semibold text-foreground">PSY4 LIVE</span>
            <span>·</span>
            <span>Browser-native realtime synthesis</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> AudioWorklet Engine</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" /> Sample-accurate</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-fuchsia-400 animate-pulse" /> Zero-alloc voices</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
