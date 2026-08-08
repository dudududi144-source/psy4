'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  const [, setStatsTick] = useState(0); // forces re-render for voice count display
  const [engineMode, setEngineMode] = useState('Web Audio');
  const [activeVoices, setActiveVoices] = useState(0);
  const [sampleUsage, setSampleUsage] = useState<Record<string, number>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    engineRef.current = new Psy4LiveEngine();
    setWorlds(engineRef.current.getWorlds());
    return () => { engineRef.current?.stop(); };
  }, []);

  // update UI state from engine
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
      setSampleUsage(e.getSampleUsage());
      setStatsTick(t => t + 1); // force re-render for voice count
      // audio level from analyser
      const analyser = e.getAnalyser();
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < 64; i++) sum += data[i];
        setAudioLevel(sum / 64 / 255);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [playing]);

  // visualizer
  useEffect(() => {
    if (!playing || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const e = engineRef.current;
    const analyser = e?.getAnalyser();
    if (!analyser) return;

    const draw = () => {
      const data = new Uint8Array(analyser.frequencyBinCount);
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
      toast.success('Live playback started');
    }
  }, [playing, worldId, macros]);

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
    // update macro display to reflect action
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
    { key: 'surprise' as keyof Macros, label: 'Surprise', icon: Shuffle, color: 'text-pink-400' },
    { key: 'aggression' as keyof Macros, label: 'Aggression', icon: Flame, color: 'text-red-400' },
  ];

  const actionButtons = [
    { label: 'Stranger', action: 'stranger', icon: Shuffle, color: 'bg-fuchsia-600 hover:bg-fuchsia-700' },
    { label: 'Darker', action: 'darker', icon: Moon, color: 'bg-purple-600 hover:bg-purple-700' },
    { label: 'Brighter', action: 'brighter', icon: Sun, color: 'bg-yellow-600 hover:bg-yellow-700' },
    { label: 'More Bass', action: 'more-bass', icon: Drum, color: 'bg-orange-600 hover:bg-orange-700' },
    { label: 'More Groove', action: 'more-groove', icon: Music, color: 'bg-lime-600 hover:bg-lime-700' },
    { label: 'More Space', action: 'more-space', icon: Waves, color: 'bg-blue-600 hover:bg-blue-700' },
    { label: 'Breakdown', action: 'breakdown', icon: Activity, color: 'bg-indigo-600 hover:bg-indigo-700' },
    { label: 'Build', action: 'build', icon: TrendingUp, color: 'bg-cyan-600 hover:bg-cyan-700' },
    { label: 'Drop', action: 'drop', icon: Flame, color: 'bg-red-600 hover:bg-red-700' },
    { label: 'Reset', action: 'reset', icon: RotateCcw, color: 'bg-gray-600 hover:bg-gray-700' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden">
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at top, rgba(168,85,247,0.12), transparent 60%), radial-gradient(ellipse at bottom, rgba(34,211,238,0.08), transparent 55%)' }} />
      <Toaster richColors position="top-right" />

      <header className="relative z-10 border-b border-border/60 backdrop-blur-sm bg-background/40 sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl border border-fuchsia-500/30 flex items-center justify-center ${playing ? 'bg-gradient-to-br from-red-500/30 to-fuchsia-500/30' : 'bg-card/60'}`}>
              <Radio className={`w-5 h-5 ${playing ? 'text-red-300 animate-pulse' : 'text-fuchsia-300'}`} />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight bg-gradient-to-r from-fuchsia-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">PSY4 LIVE</h1>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Browser-native Web Audio · instant playback · zero latency</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-fuchsia-500/30 text-fuchsia-300">{section}</Badge>
            <Badge variant="outline" className="border-cyan-500/30 text-cyan-300">bar {bar}</Badge>
            <Badge variant="outline" className="border-lime-500/30 text-lime-300">phrase {phrase}</Badge>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 space-y-5">
        {/* TRANSPORT */}
        <Card className="p-5 sm:p-6 border-fuchsia-500/20 bg-card/60">
          <div className="grid sm:grid-cols-[1fr_auto_auto_auto] gap-3 items-end">
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
          {playing && Object.keys(sampleUsage).length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-black/40 border border-border/40">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">NOW PLAYING</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 text-xs">
                {/* Find the top sample per voice category */}
                {(() => {
                  const categories: Record<string, { name: string; hits: number }> = {};
                  Object.entries(sampleUsage).forEach(([name, hits]) => {
                    let cat = 'FX';
                    if (name.includes('kick') || name.includes('BD')) cat = 'KICK';
                    else if (name.includes('bass')) cat = 'BASS';
                    else if (name.includes('hat')) cat = 'HAT';
                    else if (name.includes('clap') || name.includes('snare')) cat = 'CLAP';
                    else if (name.includes('perc') || name.includes('tom')) cat = 'PERC';
                    else if (name.includes('stab')) cat = 'LEAD';
                    if (!categories[cat] || hits > categories[cat].hits) {
                      categories[cat] = { name, hits };
                    }
                  });
                  const labels: Record<string, string> = {
                    KICK: 'KICK', BASS: 'BASS', HAT: 'HAT', CLAP: 'CLAP',
                    PERC: 'PERC', LEAD: 'LEAD', FX: 'FX',
                  };
                  return Object.entries(categories)
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([cat, { name, hits }]) => {
                      const isReal = name.startsWith('nord') || name.startsWith('909') || name.startsWith('real') || name.startsWith('md_');
                      const shortName = name.replace('real/', '').replace('.wav', '').substring(0, 25);
                      return (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-muted-foreground font-bold w-10">{labels[cat] || cat}</span>
                          <span className={`font-mono truncate flex-1 ${isReal ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {shortName}
                          </span>
                          <span className="text-muted-foreground tabular-nums">{hits}</span>
                        </div>
                      );
                    });
                })()}
              </div>
              <div className="mt-2 flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>Phrase: {phrase}</span>
                <span>Section: {section}</span>
                <span>Voices: {activeVoices}</span>
              </div>
            </div>
          )}
        </Card>

        {/* MACRO CONTROLS */}
        <Card className="p-5 sm:p-6 border-fuchsia-500/20 bg-card/60">
          <h4 className="font-semibold mb-4 flex items-center gap-2"><Gauge className="w-4 h-4 text-fuchsia-300" /> Live Macros — changes apply instantly</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
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
            <p className="text-sm text-muted-foreground">Browser-native Web Audio · no server rendering · no loading · macros apply instantly</p>
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
