'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, SyncStatus } from '@/lib/psyLive';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Play, Square, Radio, Volume2, Lock, Unlock, Waves } from 'lucide-react';

const STYLES = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID'] as const;
type MusicalStyle = typeof STYLES[number];

const SYNC_META: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  idle:        { label: 'IDLE',        color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  connecting:  { label: 'CONNECTING',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  no_signal:   { label: 'NO SIGNAL',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  listening:   { label: 'LISTENING',   color: '#f59e0b', bg: 'rgba(245,158,11,0.2)' },
  following:   { label: 'FOLLOWING',   color: '#10b981', bg: 'rgba(16,185,129,0.2)' },
  holdover:    { label: 'HOLDOVER',    color: '#a855f7', bg: 'rgba(168,85,247,0.2)' },
  error:       { label: 'ERROR',       color: '#ef4444', bg: 'rgba(239,68,68,0.25)' },
};

function Metric({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex flex-col items-center min-w-[60px]">
      <span className="text-[9px] uppercase tracking-wider text-slate-400 font-medium">{label}</span>
      <span className="text-sm font-bold tabular-nums" style={{ color: color || '#e2e8f0' }}>{value}</span>
    </div>
  );
}

function ChannelStrip({
  label, value, onChange, onMute, onSolo, muted, soloed, color,
}: {
  label: string; value: number; onChange: (v: number) => void;
  onMute: () => void; onSolo: () => void; muted: boolean; soloed: boolean; color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color }}>{label}</span>
      <Slider
        orientation="vertical"
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={0} max={1} step={0.01}
        className="h-24"
        style={{ '--slider-color': color } as React.CSSProperties}
      />
      <span className="text-[9px] tabular-nums text-slate-400">{Math.round(value * 100)}%</span>
      <div className="flex gap-1">
        <button
          onClick={onMute}
          className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${muted ? 'bg-red-500/80 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
        >M</button>
        <button
          onClick={onSolo}
          className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${soloed ? 'bg-yellow-500/80 text-black' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}
        >S</button>
      </div>
    </div>
  );
}

function MusicalSlider({
  label, value, onChange, onLockToggle, locked, color,
}: {
  label: string; value: number; onChange: (v: number) => void;
  onLockToggle: () => void; locked: boolean; color: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-300">{label}</span>
        <button
          onClick={onLockToggle}
          className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded transition-colors"
          style={{ background: locked ? `${color}30` : 'rgba(255,255,255,0.05)', color: locked ? color : '#94a3b8' }}
        >
          {locked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
          {locked ? 'LOCKED' : 'AUTO'}
        </button>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={0} max={1} step={0.01}
        style={{ '--slider-color': color } as React.CSSProperties}
      />
      <span className="text-[9px] tabular-nums text-slate-500 text-right">{Math.round(value * 100)}%</span>
    </div>
  );
}

export default function Page() {
  const engineRef = useRef<PsyLive | null>(null);
  const [s, setS] = useState<LiveState>({
    playing: false, radioOn: false, radioBpm: 0, engineBpm: 145,
    syncStatus: 'idle', mixMode: 'solo', kickCount: 0, bassNote: '—',
    radioLevel: 0, engineLevel: 0, presetId: 'rolling_bass', variant: 'A',
    learned: null, sidechainActive: false, harmonicLocked: false,
    radioRms: 0, radioBands: { low: 0, mid: 0, high: 0 },
    compositionMode: false,
    occupancy: { kick: 0, bass: 0, lead: 0, hats: 0 },
    radioSignalState: 'DISCONNECTED',
    radioObservationState: 'NO_SIGNAL',
    radioConfidence: 0,
  });

  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.9);
  const [style, setStyle] = useState<MusicalStyle>('FULL_ON');
  const [channelVols, setChannelVols] = useState({ kick: 0.95, bass: 0.85, lead: 0.5, hat: 0.55 });
  const [muteState, setMuteState] = useState({ kick: false, bass: false, lead: false, hat: false });
  const [soloState, setSoloState] = useState<string | null>(null);
  const [delayAmt, setDelayAmt] = useState(1.0);
  const [delayFb, setDelayFb] = useState(0.34);
  const [reverbSend, setReverbSend] = useState(0.15);
  const [energy, setEnergy] = useState(0.5);
  const [density, setDensity] = useState(0.6);
  const [tension, setTension] = useState(0.3);
  const [locks, setLocks] = useState({ energy: false, density: false, tension: false, style: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);

  useEffect(() => { init(); }, [init]);

  // Visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const engine = engineRef.current;
      const analyser = engine?.analyserNode;
      const radioAnalyser = engine?.radioAnalyserNode;
      if (!analyser || !ctx) { rafRef.current = requestAnimationFrame(draw); return; }

      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = canvas.offsetHeight;
      ctx.fillStyle = 'rgba(7,3,18,0.4)';
      ctx.fillRect(0, 0, W, H);

      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      const bars = 64;
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const v = buf[Math.floor(i * buf.length / bars)] / 255;
        const h = v * H * 0.9;
        const hue = 180 - i * 2;
        ctx.fillStyle = `hsl(${hue}, 80%, ${30 + v * 40}%)`;
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
      }

      if (radioAnalyser) {
        const rbuf = new Uint8Array(radioAnalyser.frequencyBinCount);
        radioAnalyser.getByteFrequencyData(rbuf);
        ctx.strokeStyle = 'rgba(245,158,11,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < bars; i++) {
          const v = rbuf[Math.floor(i * rbuf.length / bars)] / 255;
          const h = v * H * 0.9;
          if (i === 0) ctx.moveTo(i * bw + bw / 2, H - h);
          else ctx.lineTo(i * bw + bw / 2, H - h);
        }
        ctx.stroke();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const togglePlay = () => {
    const e = engineRef.current;
    if (!e) return;
    if (s.playing) { e.stop(); }
    else {
      e.setStyle(style);
      e.setEnergy(energy); e.setDensity(density); e.setTension(tension);
      e.play();
    }
  };

  const connectRadio = async () => {
    const e = engineRef.current;
    if (!e) return;
    const stream = STREAMS.find(x => x.id === streamId) || STREAMS[0];
    await e.connectRadio(stream);
  };

  const disconnectRadio = () => { engineRef.current?.disconnectRadio(); };

  const handleStyle = (st: MusicalStyle) => {
    setStyle(st);
    setLocks(p => ({ ...p, style: true }));
    engineRef.current?.setStyle(st);
  };

  const handleVol = (v: number) => { setVol(v); engineRef.current?.setVolume(v); };
  const handleRadioVol = (v: number) => { setRadioVol(v); engineRef.current?.setRadioVolume(v); };
  const handleChannelVol = (ch: 'kick' | 'bass' | 'lead' | 'hat', v: number) => {
    setChannelVols(p => ({ ...p, [ch]: v }));
    engineRef.current?.setChannelVolume(ch, v);
  };
  const handleMute = (ch: 'kick' | 'bass' | 'lead' | 'hat') => {
    const newMuted = !muteState[ch];
    setMuteState(p => ({ ...p, [ch]: newMuted }));
    engineRef.current?.setChannelMute(ch, newMuted);
  };
  const handleSolo = (ch: 'kick' | 'bass' | 'lead' | 'hat') => {
    const newSolo = soloState === ch ? null : ch;
    setSoloState(newSolo);
    engineRef.current?.setChannelSolo(newSolo as any);
  };
  const handleDelay = (v: number) => { setDelayAmt(v); engineRef.current?.setDelayAmount(v); };
  const handleFb = (v: number) => { setDelayFb(v); engineRef.current?.setDelayFeedback(v); };
  const handleReverb = (v: number) => { setReverbSend(v); engineRef.current?.setReverbSend(v); };

  const handleEnergy = (v: number) => { setEnergy(v); if (!locks.energy) { setLocks(p => ({ ...p, energy: true })); } engineRef.current?.setEnergy(v); };
  const handleDensity = (v: number) => { setDensity(v); if (!locks.density) { setLocks(p => ({ ...p, density: true })); } engineRef.current?.setDensity(v); };
  const handleTension = (v: number) => { setTension(v); if (!locks.tension) { setLocks(p => ({ ...p, tension: true })); } engineRef.current?.setTension(v); };

  const toggleLock = (prop: 'energy' | 'density' | 'tension' | 'style') => {
    const newLocked = !locks[prop];
    setLocks(p => ({ ...p, [prop]: newLocked }));
    if (!newLocked) {
      if (prop === 'energy') engineRef.current?.unlockEnergy();
      else if (prop === 'density') engineRef.current?.unlockDensity();
      else if (prop === 'tension') engineRef.current?.unlockTension();
      else if (prop === 'style') engineRef.current?.unlockStyle();
    }
  };

  const syncMeta = SYNC_META[s.syncStatus] || SYNC_META.idle;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#070312', color: '#e2e8f0' }}>
      {/* HEADER */}
      <header className="flex items-center gap-3 sm:gap-6 p-3 sm:p-4 border-b border-white/10 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-black tracking-tight"
          style={{ background: 'linear-gradient(90deg,#00ffc8,#b967ff,#ff2e88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          PSY4
        </h1>
        <div className="flex items-center gap-3 sm:gap-5 flex-wrap">
          <Metric label="BPM" value={Math.round(s.engineBpm)} color="#00ffc8" />
          <Metric label="KEY" value={s.bassNote} color="#b967ff" />
          <Metric label="KICKS" value={s.kickCount} color="#ff2e88" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="font-bold tabular-nums"
            style={{ color: syncMeta.color, background: syncMeta.bg, borderColor: `${syncMeta.color}40` }}>
            {syncMeta.label}
          </Badge>
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-4 space-y-3 sm:space-y-4">

        {/* TRANSPORT + VISUALIZER */}
        <Card className="p-4 bg-white/[0.03] border-white/10">
          <div className="flex items-center gap-4 flex-wrap">
            <Button
              onClick={togglePlay}
              size="lg"
              className="min-w-[100px] h-12 text-base font-bold rounded-full"
              style={{
                background: s.playing
                  ? 'linear-gradient(135deg,#ff2e88,#b967ff)'
                  : 'linear-gradient(135deg,#00ffc8,#10b981)',
                color: s.playing ? '#fff' : '#070312',
              }}
            >
              {s.playing ? <><Square className="w-4 h-4 mr-2" /> STOP</> : <><Play className="w-4 h-4 mr-2" /> PLAY</>}
            </Button>
            <div className="flex-1 min-w-[150px]">
              <div className="flex items-center gap-2 mb-1">
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Master</span>
                <span className="text-[10px] tabular-nums text-slate-500 ml-auto">{Math.round(vol * 100)}%</span>
              </div>
              <Slider value={[vol]} onValueChange={(v) => handleVol(v[0])} min={0} max={1} step={0.01}
                style={{ '--slider-color': '#00ffc8' } as React.CSSProperties} />
            </div>
          </div>
          <div className="mt-3 h-20 sm:h-24 rounded-lg overflow-hidden border border-white/5">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        </Card>

        {/* MUSIC DIRECTOR */}
        <Card className="p-4 bg-white/[0.03] border-white/10">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3">Music Director</h2>
          <div className="flex gap-1.5 mb-4 flex-wrap">
            {STYLES.map(st => (
              <button
                key={st}
                onClick={() => handleStyle(st)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all min-h-[36px]"
                style={{
                  background: style === st && locks.style ? 'linear-gradient(135deg,#b967ff,#ff2e88)' : 'rgba(255,255,255,0.05)',
                  color: style === st && locks.style ? '#fff' : '#94a3b8',
                  border: style === st ? '1px solid rgba(185,103,255,0.4)' : '1px solid transparent',
                }}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
            <button
              onClick={() => toggleLock('style')}
              className="px-2 py-1.5 rounded-lg text-[10px] font-bold transition-colors min-h-[36px]"
              style={{ background: locks.style ? 'rgba(185,103,255,0.2)' : 'rgba(255,255,255,0.05)', color: locks.style ? '#b967ff' : '#64748b' }}
            >
              {locks.style ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MusicalSlider label="Energy" value={energy} onChange={handleEnergy} onLockToggle={() => toggleLock('energy')} locked={locks.energy} color="#00ffc8" />
            <MusicalSlider label="Density" value={density} onChange={handleDensity} onLockToggle={() => toggleLock('density')} locked={locks.density} color="#10b981" />
            <MusicalSlider label="Tension" value={tension} onChange={handleTension} onLockToggle={() => toggleLock('tension')} locked={locks.tension} color="#ff2e88" />
          </div>
        </Card>

        {/* RADIO */}
        <Card className="p-4 bg-white/[0.03] border-white/10">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3 flex items-center gap-2">
            <Radio className="w-3.5 h-3.5" /> Radio
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={streamId} onValueChange={setStreamId} disabled={s.radioOn}>
              <SelectTrigger className="w-[200px] bg-white/5 border-white/10 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STREAMS.map(st => (
                  <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!s.radioOn ? (
              <Button onClick={connectRadio} size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-500">Connect</Button>
            ) : (
              <Button onClick={disconnectRadio} size="sm" variant="destructive" className="h-9">Disconnect</Button>
            )}
            <div className="flex-1 min-w-[120px]">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Radio Vol</span>
                <span className="text-[10px] tabular-nums text-slate-500 ml-auto">{Math.round(radioVol * 100)}%</span>
              </div>
              <Slider value={[radioVol]} onValueChange={(v) => handleRadioVol(v[0])} min={0} max={1} step={0.01}
                style={{ '--slider-color': '#f59e0b' } as React.CSSProperties} />
            </div>
          </div>
          {/* Radio bands */}
          <div className="mt-3 flex gap-3 text-[10px]">
            {(['low', 'mid', 'high'] as const).map(band => (
              <div key={band} className="flex-1">
                <div className="flex justify-between mb-0.5">
                  <span className="uppercase text-slate-500">{band}</span>
                  <span className="tabular-nums text-slate-400">{Math.round((s.radioBands[band] || 0) * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${(s.radioBands[band] || 0) * 100}%`, background: '#f59e0b' }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* MIX */}
        <Card className="p-4 bg-white/[0.03] border-white/10">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3 flex items-center gap-2">
            <Waves className="w-3.5 h-3.5" /> Mix
          </h2>
          <div className="grid grid-cols-4 gap-2">
            <ChannelStrip label="KICK" value={channelVols.kick} onChange={(v) => handleChannelVol('kick', v)} onMute={() => handleMute('kick')} onSolo={() => handleSolo('kick')} muted={muteState.kick} soloed={soloState === 'kick'} color="#00ffc8" />
            <ChannelStrip label="BASS" value={channelVols.bass} onChange={(v) => handleChannelVol('bass', v)} onMute={() => handleMute('bass')} onSolo={() => handleSolo('bass')} muted={muteState.bass} soloed={soloState === 'bass'} color="#10b981" />
            <ChannelStrip label="LEAD" value={channelVols.lead} onChange={(v) => handleChannelVol('lead', v)} onMute={() => handleMute('lead')} onSolo={() => handleSolo('lead')} muted={muteState.lead} soloed={soloState === 'lead'} color="#ff2e88" />
            <ChannelStrip label="HATS" value={channelVols.hat} onChange={(v) => handleChannelVol('hat', v)} onMute={() => handleMute('hat')} onSolo={() => handleSolo('hat')} muted={muteState.hat} soloed={soloState === 'hat'} color="#f59e0b" />
          </div>
        </Card>

        {/* FX */}
        <Card className="p-4 bg-white/[0.03] border-white/10">
          <h2 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3">FX</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-300">Delay</span>
                <span className="text-[10px] tabular-nums text-slate-500">{Math.round(delayAmt * 100)}%</span>
              </div>
              <Slider value={[delayAmt]} onValueChange={(v) => handleDelay(v[0])} min={0} max={1} step={0.01} style={{ '--slider-color': '#f59e0b' } as React.CSSProperties} />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-300">Feedback</span>
                <span className="text-[10px] tabular-nums text-slate-500">{Math.round(delayFb * 100)}%</span>
              </div>
              <Slider value={[delayFb]} onValueChange={(v) => handleFb(v[0])} min={0} max={0.85} step={0.01} style={{ '--slider-color': '#a855f7' } as React.CSSProperties} />
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-300">Reverb</span>
                <span className="text-[10px] tabular-nums text-slate-500">{Math.round(reverbSend * 100)}%</span>
              </div>
              <Slider value={[reverbSend]} onValueChange={(v) => handleReverb(v[0])} min={0} max={1} step={0.01} style={{ '--slider-color': '#06b6d4' } as React.CSSProperties} />
            </div>
          </div>
        </Card>
      </main>

      {/* FOOTER */}
      <footer className="mt-auto p-3 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-500">
        <span>PSY4 · Musical Device</span>
        <span className="tabular-nums">
          {s.playing ? 'PLAYING' : 'STOPPED'} · {s.radioOn ? 'RADIO ON' : 'RADIO OFF'} · {style}
        </span>
      </footer>

      <style>{`
        [data-radix-slider-orientation="vertical"] { height: 100%; }
        .slider-track { background: rgba(255,255,255,0.1); }
        .slider-range { background: var(--slider-color, #00ffc8); }
        .slider-thumb { background: var(--slider-color, #00ffc8); border: 2px solid #070312; }
      `}</style>
    </div>
  );
}
