'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, SyncStatus } from '@/lib/psyLive';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Play, Square, Radio, Volume2, Lock, Unlock, Waves, Zap, ArrowDown, ArrowUp, Flame, RotateCcw } from 'lucide-react';

const STYLES = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID'] as const;
type MusicalStyle = typeof STYLES[number];
type Channel = 'kick' | 'bass' | 'lead' | 'hat';

const SECTIONS = ['INTRO', 'STATEMENT', 'DEVELOPMENT', 'RESPONSE', 'CONTRAST', 'DEVELOPMENT2', 'CLIMAX', 'RESOLUTION'];

const SYNC_META: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  idle:        { label: 'IDLE',        color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  connecting:  { label: 'CONNECTING',  color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  no_signal:   { label: 'NO SIGNAL',   color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  listening:   { label: 'LISTENING',   color: '#f59e0b', bg: 'rgba(245,158,11,0.2)' },
  following:   { label: 'FOLLOWING',   color: '#10b981', bg: 'rgba(16,185,129,0.2)' },
  holdover:    { label: 'HOLDOVER',    color: '#a855f7', bg: 'rgba(168,85,247,0.2)' },
  error:       { label: 'ERROR',       color: '#ef4444', bg: 'rgba(239,68,68,0.25)' },
};

function ChannelStrip({
  label, value, onChange, onMute, onSolo, muted, soloed, color, active,
}: {
  label: string; value: number; onChange: (v: number) => void;
  onMute: () => void; onSolo: () => void; muted: boolean; soloed: boolean; color: string; active: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all"
      style={{ background: active ? `${color}15` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? `${color}40` : 'transparent'}` }}>
      <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color }}>{label}</span>
      <div className="relative h-20 flex items-center justify-center">
        <Slider orientation="vertical" value={[value]} onValueChange={(v) => onChange(v[0])} min={0} max={1} step={0.01}
          className="h-20" style={{ '--slider-color': color } as React.CSSProperties} />
        {active && <div className="absolute -right-1 top-0 w-1 h-20 rounded-full overflow-hidden pointer-events-none">
          <div className="absolute bottom-0 w-full transition-all" style={{ height: `${value * 100}%`, background: color, opacity: 0.3 }} />
        </div>}
      </div>
      <span className="text-[9px] tabular-nums text-slate-400">{Math.round(value * 100)}</span>
      <div className="flex gap-1">
        <button onClick={onMute}
          className={`w-5 h-5 rounded text-[8px] font-bold transition-colors ${muted ? 'bg-red-500/80 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>M</button>
        <button onClick={onSolo}
          className={`w-5 h-5 rounded text-[8px] font-bold transition-colors ${soloed ? 'bg-yellow-500/80 text-black' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>S</button>
      </div>
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
    radioSignalState: 'DISCONNECTED', radioObservationState: 'NO_SIGNAL', radioConfidence: 0,
  });

  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.9);
  const [style, setStyle] = useState<MusicalStyle>('FULL_ON');
  const [channelVols, setChannelVols] = useState({ kick: 0.95, bass: 0.85, lead: 0.5, hat: 0.55 });
  const [muteState, setMuteState] = useState({ kick: false, bass: false, lead: false, hat: false });
  const [soloState, setSoloState] = useState<string | null>(null);
  const [delayAmt, setDelayAmt] = useState(0.6);
  const [delayFb, setDelayFb] = useState(0.34);
  const [reverbSend, setReverbSend] = useState(0.2);
  const [energy, setEnergy] = useState(0.5);
  const [tension, setTension] = useState(0.3);
  const [locks, setLocks] = useState({ energy: false, tension: false, style: false });
  const [sessionSnap, setSessionSnap] = useState<any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);
  useEffect(() => { init(); }, [init]);

  // Poll session for arrangement state
  useEffect(() => {
    if (!s.playing) return;
    const t = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const debug = (e as any).getTransportDebug?.();
      if (debug) setSessionSnap(debug);
    }, 200);
    return () => clearInterval(t);
  }, [s.playing]);

  // Visualizer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const draw = () => {
      const engine = engineRef.current;
      const analyser = engine?.analyserNode;
      if (!analyser || !ctx) { rafRef.current = requestAnimationFrame(draw); return; }
      const W = canvas.width = canvas.offsetWidth, H = canvas.height = canvas.offsetHeight;
      ctx.fillStyle = 'rgba(7,3,18,0.4)'; ctx.fillRect(0, 0, W, H);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      const bars = 48, bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const v = buf[Math.floor(i * buf.length / bars)] / 255;
        const h = v * H * 0.85;
        const hue = 180 - i * 2.5;
        ctx.fillStyle = `hsl(${hue}, 75%, ${25 + v * 45}%)`;
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const togglePlay = () => {
    const e = engineRef.current; if (!e) return;
    if (s.playing) e.stop();
    else { e.setStyle(style); e.setEnergy(energy); e.setTension(tension); e.play(); }
  };
  const connectRadio = async () => {
    const e = engineRef.current; if (!e) return;
    const stream = STREAMS.find(x => x.id === streamId) || STREAMS[0];
    await e.connectRadio(stream);
  };
  const disconnectRadio = () => engineRef.current?.disconnectRadio();
  const handleStyle = (st: MusicalStyle) => { setStyle(st); setLocks(p => ({ ...p, style: true })); engineRef.current?.setStyle(st); };
  const handleVol = (v: number) => { setVol(v); engineRef.current?.setVolume(v); };
  const handleRadioVol = (v: number) => { setRadioVol(v); engineRef.current?.setRadioVolume(v); };
  const handleChannelVol = (ch: Channel, v: number) => { setChannelVols(p => ({ ...p, [ch]: v })); engineRef.current?.setChannelVolume(ch, v); };
  const handleMute = (ch: Channel) => { const m = !muteState[ch]; setMuteState(p => ({ ...p, [ch]: m })); engineRef.current?.setChannelMute(ch, m); };
  const handleSolo = (ch: Channel) => { const so = soloState === ch ? null : ch; setSoloState(so); engineRef.current?.setChannelSolo(so as any); };
  const handleDelay = (v: number) => { setDelayAmt(v); engineRef.current?.setDelayAmount(v); };
  const handleFb = (v: number) => { setDelayFb(v); engineRef.current?.setDelayFeedback(v); };
  const handleReverb = (v: number) => { setReverbSend(v); engineRef.current?.setReverbSend(v); };
  const handleEnergy = (v: number) => { setEnergy(v); if (!locks.energy) setLocks(p => ({ ...p, energy: true })); engineRef.current?.setEnergy(v); };
  const handleTension = (v: number) => { setTension(v); if (!locks.tension) setLocks(p => ({ ...p, tension: true })); engineRef.current?.setTension(v); };
  const toggleLock = (prop: 'energy' | 'tension' | 'style') => {
    const nl = !locks[prop]; setLocks(p => ({ ...p, [prop]: nl }));
    if (!nl) { if (prop === 'energy') engineRef.current?.unlockEnergy(); if (prop === 'tension') engineRef.current?.unlockTension(); if (prop === 'style') engineRef.current?.unlockStyle(); }
  };

  // Arrangement controls
  const forceSection = (sec: string) => engineRef.current?.forceSection(sec);
  const releaseSection = () => engineRef.current?.releaseSection();
  const triggerBreak = () => engineRef.current?.triggerBreak(4);
  const triggerBuild = () => engineRef.current?.triggerBuild(4);
  const triggerDrop = () => engineRef.current?.triggerDrop(4);

  const syncMeta = SYNC_META[s.syncStatus] || SYNC_META.idle;
  const currentSection = sessionSnap?.sessionSection ?? '—';
  const currentPhrase = sessionSnap?.sessionPhrase ?? 0;
  const currentBar = sessionSnap?.transportBar ?? 0;
  const barInPhrase = currentBar % 8;
  const phraseProgress = (barInPhrase / 8) * 100;

  // Active channel detection (which voices are playing this bar)
  const activeRoles = sessionSnap?.sessionRole ?? 'GROOVE';
  const isActive = (ch: Channel) => {
    if (activeRoles === 'BREAK') return ch === 'kick' || ch === 'bass';
    if (ch === 'lead') return activeRoles === 'LEAD';
    return true;
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#070312', color: '#e2e8f0' }}>
      {/* HEADER — Timeline + Status */}
      <header className="p-3 border-b border-white/10">
        <div className="flex items-center gap-4 flex-wrap mb-2">
          <h1 className="text-xl font-black tracking-tight"
            style={{ background: 'linear-gradient(90deg,#00ffc8,#b967ff,#ff2e88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PSY4
          </h1>
          <div className="flex items-center gap-4 text-xs">
            <span className="tabular-nums font-bold" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)} BPM</span>
            <span className="tabular-nums" style={{ color: '#b967ff' }}>KEY {s.bassNote}</span>
            <span className="tabular-nums text-slate-400">{s.kickCount} kicks</span>
          </div>
          <div className="ml-auto">
            <Badge variant="outline" className="font-bold"
              style={{ color: syncMeta.color, background: syncMeta.bg, borderColor: `${syncMeta.color}40` }}>
              {syncMeta.label}
            </Badge>
          </div>
        </div>
        {/* TIMELINE — current section + phrase progress */}
        <div className="flex items-center gap-1 text-[9px]">
          {SECTIONS.map((sec, i) => {
            const isCurrent = currentSection === sec;
            const isPast = currentBar >= i * 8 && currentBar < (i + 1) * 8;
            return (
              <div key={sec} className="flex-1 flex flex-col items-center gap-0.5">
                <button onClick={() => forceSection(sec)} disabled={!s.playing}
                  className={`w-full px-1 py-1 rounded text-center font-bold transition-all uppercase tracking-wider ${
                    isCurrent ? 'bg-white/15 text-white' : isPast ? 'text-slate-300' : 'text-slate-600 hover:text-slate-400'
                  } ${!s.playing ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  style={isCurrent ? { background: 'linear-gradient(90deg,#00ffc830,#b967ff30)', border: '1px solid #00ffc840' } : {}}
                >
                  {sec.slice(0, 4)}
                </button>
                {isCurrent && (
                  <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${phraseProgress}%`, background: '#00ffc8' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </header>

      {/* MAIN */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-3 space-y-3">

        {/* TRANSPORT + VISUALIZER */}
        <Card className="p-3 bg-white/[0.03] border-white/10">
          <div className="flex items-center gap-3">
            <Button onClick={togglePlay} size="lg"
              className="min-w-[90px] h-11 text-sm font-bold rounded-full"
              style={{ background: s.playing ? 'linear-gradient(135deg,#ff2e88,#b967ff)' : 'linear-gradient(135deg,#00ffc8,#10b981)', color: s.playing ? '#fff' : '#070312' }}>
              {s.playing ? <><Square className="w-3.5 h-3.5 mr-1.5" />STOP</> : <><Play className="w-3.5 h-3.5 mr-1.5" />PLAY</>}
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Volume2 className="w-3 h-3 text-slate-400" />
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Master</span>
                <span className="text-[9px] tabular-nums text-slate-500 ml-auto">{Math.round(vol * 100)}</span>
              </div>
              <Slider value={[vol]} onValueChange={(v) => handleVol(v[0])} min={0} max={1} step={0.01}
                style={{ '--slider-color': '#00ffc8' } as React.CSSProperties} />
            </div>
            {/* Arrangement triggers */}
            <div className="flex gap-1">
              <button onClick={triggerBreak} disabled={!s.playing}
                className="flex flex-col items-center px-2 py-1 rounded-lg text-[9px] font-bold transition-colors disabled:opacity-30 bg-white/5 hover:bg-white/10 text-slate-300"
                title="Breakdown — kick+bass only">
                <ArrowDown className="w-3 h-3 mb-0.5" />BREAK
              </button>
              <button onClick={triggerBuild} disabled={!s.playing}
                className="flex flex-col items-center px-2 py-1 rounded-lg text-[9px] font-bold transition-colors disabled:opacity-30 bg-white/5 hover:bg-white/10 text-slate-300"
                title="Build — ramp density up">
                <ArrowUp className="w-3 h-3 mb-0.5" />BUILD
              </button>
              <button onClick={triggerDrop} disabled={!s.playing}
                className="flex flex-col items-center px-2 py-1 rounded-lg text-[9px] font-bold transition-colors disabled:opacity-30 bg-white/5 hover:bg-white/10 text-slate-300"
                title="Drop — peak density">
                <Flame className="w-3 h-3 mb-0.5" />DROP
              </button>
              <button onClick={releaseSection} disabled={!s.playing}
                className="flex flex-col items-center px-2 py-1 rounded-lg text-[9px] font-bold transition-colors disabled:opacity-30 bg-white/5 hover:bg-white/10 text-slate-300"
                title="Return to automatic arc">
                <RotateCcw className="w-3 h-3 mb-0.5" />AUTO
              </button>
            </div>
          </div>
          <div className="mt-2 h-16 rounded-lg overflow-hidden border border-white/5">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        </Card>

        {/* MUSIC DIRECTOR — macros */}
        <Card className="p-3 bg-white/[0.03] border-white/10">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Music Director</h2>
          <div className="flex gap-1 mb-3">
            {STYLES.map(st => (
              <button key={st} onClick={() => handleStyle(st)} disabled={!s.playing}
                className="flex-1 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all min-h-[32px] disabled:opacity-40"
                style={{
                  background: style === st && locks.style ? 'linear-gradient(135deg,#b967ff,#ff2e88)' : 'rgba(255,255,255,0.05)',
                  color: style === st && locks.style ? '#fff' : '#94a3b8',
                }}>
                {st.replace('_', ' ')}
              </button>
            ))}
            <button onClick={() => toggleLock('style')} disabled={!s.playing}
              className="px-2 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-40"
              style={{ background: locks.style ? 'rgba(185,103,255,0.2)' : 'rgba(255,255,255,0.05)', color: locks.style ? '#b967ff' : '#64748b' }}>
              {locks.style ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between mb-0.5">
                <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-1"><Zap className="w-2.5 h-2.5" />Energy</span>
                <button onClick={() => toggleLock('energy')} disabled={!s.playing}
                  className="text-[8px] px-1 rounded" style={{ background: locks.energy ? 'rgba(0,255,200,0.2)' : 'transparent', color: locks.energy ? '#00ffc8' : '#64748b' }}>
                  {locks.energy ? 'LOCK' : 'AUTO'}
                </button>
              </div>
              <Slider value={[energy]} onValueChange={(v) => handleEnergy(v[0])} min={0} max={1} step={0.01} disabled={!s.playing}
                style={{ '--slider-color': '#00ffc8' } as React.CSSProperties} />
            </div>
            <div>
              <div className="flex justify-between mb-0.5">
                <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-300 flex items-center gap-1"><Waves className="w-2.5 h-2.5" />Tension</span>
                <button onClick={() => toggleLock('tension')} disabled={!s.playing}
                  className="text-[8px] px-1 rounded" style={{ background: locks.tension ? 'rgba(255,46,136,0.2)' : 'transparent', color: locks.tension ? '#ff2e88' : '#64748b' }}>
                  {locks.tension ? 'LOCK' : 'AUTO'}
                </button>
              </div>
              <Slider value={[tension]} onValueChange={(v) => handleTension(v[0])} min={0} max={1} step={0.01} disabled={!s.playing}
                style={{ '--slider-color': '#ff2e88' } as React.CSSProperties} />
            </div>
          </div>
          {/* Live state readout */}
          <div className="mt-2 grid grid-cols-4 gap-2 text-[9px]">
            <div className="text-center"><div className="text-slate-500 uppercase">Section</div><div className="font-bold text-cyan-300">{currentSection}</div></div>
            <div className="text-center"><div className="text-slate-500 uppercase">Phrase</div><div className="font-bold tabular-nums">{currentPhrase}</div></div>
            <div className="text-center"><div className="text-slate-500 uppercase">Bar</div><div className="font-bold tabular-nums">{currentBar}</div></div>
            <div className="text-center"><div className="text-slate-500 uppercase">Role</div><div className="font-bold text-pink-300">{activeRoles}</div></div>
          </div>
        </Card>

        {/* RADIO + MIX side by side on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* RADIO */}
          <Card className="p-3 bg-white/[0.03] border-white/10">
            <h2 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2 flex items-center gap-1.5">
              <Radio className="w-3 h-3" /> Radio
            </h2>
            <Select value={streamId} onValueChange={setStreamId} disabled={s.radioOn}>
              <SelectTrigger className="w-full bg-white/5 border-white/10 h-8 text-xs mb-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STREAMS.map(st => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1.5 mb-2">
              {!s.radioOn ? (
                <Button onClick={connectRadio} size="sm" className="h-7 text-xs flex-1 bg-emerald-600 hover:bg-emerald-500">Connect</Button>
              ) : (
                <Button onClick={disconnectRadio} size="sm" variant="destructive" className="h-7 text-xs flex-1">Disconnect</Button>
              )}
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] uppercase text-slate-400 w-12">Vol</span>
              <Slider value={[radioVol]} onValueChange={(v) => handleRadioVol(v[0])} min={0} max={1} step={0.01}
                style={{ '--slider-color': '#f59e0b' } as React.CSSProperties} />
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[9px]">
              {(['low', 'mid', 'high'] as const).map(band => (
                <div key={band}>
                  <div className="flex justify-between mb-0.5"><span className="uppercase text-slate-500">{band}</span><span className="tabular-nums">{Math.round((s.radioBands[band] || 0) * 100)}</span></div>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${(s.radioBands[band] || 0) * 100}%`, background: '#f59e0b' }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* MIX */}
          <Card className="p-3 bg-white/[0.03] border-white/10">
            <h2 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2 flex items-center gap-1.5">
              <Waves className="w-3 h-3" /> Mix
            </h2>
            <div className="grid grid-cols-4 gap-1.5">
              <ChannelStrip label="KICK" value={channelVols.kick} onChange={(v) => handleChannelVol('kick', v)} onMute={() => handleMute('kick')} onSolo={() => handleSolo('kick')} muted={muteState.kick} soloed={soloState === 'kick'} color="#00ffc8" active={isActive('kick')} />
              <ChannelStrip label="BASS" value={channelVols.bass} onChange={(v) => handleChannelVol('bass', v)} onMute={() => handleMute('bass')} onSolo={() => handleSolo('bass')} muted={muteState.bass} soloed={soloState === 'bass'} color="#10b981" active={isActive('bass')} />
              <ChannelStrip label="LEAD" value={channelVols.lead} onChange={(v) => handleChannelVol('lead', v)} onMute={() => handleMute('lead')} onSolo={() => handleSolo('lead')} muted={muteState.lead} soloed={soloState === 'lead'} color="#ff2e88" active={isActive('lead')} />
              <ChannelStrip label="HATS" value={channelVols.hat} onChange={(v) => handleChannelVol('hat', v)} onMute={() => handleMute('hat')} onSolo={() => handleSolo('hat')} muted={muteState.hat} soloed={soloState === 'hat'} color="#f59e0b" active={isActive('hat')} />
            </div>
          </Card>
        </div>

        {/* FX */}
        <Card className="p-3 bg-white/[0.03] border-white/10">
          <h2 className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">FX</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="flex justify-between mb-0.5"><span className="text-[9px] uppercase font-semibold text-slate-300">Echo</span><span className="text-[9px] tabular-nums text-slate-500">{Math.round(delayAmt * 100)}</span></div>
              <Slider value={[delayAmt]} onValueChange={(v) => handleDelay(v[0])} min={0} max={1} step={0.01} disabled={!s.playing} style={{ '--slider-color': '#f59e0b' } as React.CSSProperties} />
            </div>
            <div>
              <div className="flex justify-between mb-0.5"><span className="text-[9px] uppercase font-semibold text-slate-300">Feedback</span><span className="text-[9px] tabular-nums text-slate-500">{Math.round(delayFb * 100)}</span></div>
              <Slider value={[delayFb]} onValueChange={(v) => handleFb(v[0])} min={0} max={0.85} step={0.01} disabled={!s.playing} style={{ '--slider-color': '#a855f7' } as React.CSSProperties} />
            </div>
            <div>
              <div className="flex justify-between mb-0.5"><span className="text-[9px] uppercase font-semibold text-slate-300">Space</span><span className="text-[9px] tabular-nums text-slate-500">{Math.round(reverbSend * 100)}</span></div>
              <Slider value={[reverbSend]} onValueChange={(v) => handleReverb(v[0])} min={0} max={1} step={0.01} disabled={!s.playing} style={{ '--slider-color': '#06b6d4' } as React.CSSProperties} />
            </div>
          </div>
        </Card>
      </main>

      <footer className="mt-auto p-2 border-t border-white/10 flex items-center justify-between text-[9px] text-slate-500">
        <span>PSY4 · Musical Device</span>
        <span className="tabular-nums">{s.playing ? 'PLAYING' : 'STOPPED'} · {s.radioOn ? 'RADIO ON' : 'RADIO OFF'} · {style}</span>
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
