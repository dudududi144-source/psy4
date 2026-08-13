'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, SyncStatus } from '@/lib/psyLive';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Square, Radio, Volume2, Lock, Unlock, Zap, Waves, ArrowDown, ArrowUp, Flame, RotateCcw, ChevronUp, ChevronDown } from 'lucide-react';

const STYLES = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID'] as const;
type MusicalStyle = typeof STYLES[number];
type Channel = 'kick' | 'bass' | 'lead' | 'hat';

const SECTIONS = ['INTRO', 'STATEMENT', 'DEVELOPMENT', 'RESPONSE', 'CONTRAST', 'DEVELOPMENT2', 'CLIMAX', 'RESOLUTION'];
const SECTION_SHORT = ['INTR', 'STAT', 'DEVE', 'RESP', 'CONT', 'DEVE', 'CLIM', 'RESO'];

const SYNC_META: Record<SyncStatus, { label: string; color: string }> = {
  idle:        { label: 'IDLE',       color: '#64748b' },
  connecting:  { label: 'CONNECTING', color: '#f59e0b' },
  no_signal:   { label: 'NO SIGNAL',  color: '#ef4444' },
  listening:   { label: 'LISTENING',  color: '#f59e0b' },
  following:   { label: 'FOLLOWING',  color: '#10b981' },
  holdover:    { label: 'HOLDOVER',   color: '#a855f7' },
  error:       { label: 'ERROR',      color: '#ef4444' },
};

function MixChannel({
  label, value, onChange, onMute, onSolo, muted, soloed, color, active,
}: {
  label: string; value: number; onChange: (v: number) => void;
  onMute: () => void; onSolo: () => void; muted: boolean; soloed: boolean; color: string; active: boolean;
}) {
  return (
    <div className="flex items-center gap-2 p-1.5 rounded-md transition-colors min-w-[110px]"
      style={{ background: active ? `${color}12` : 'transparent' }}>
      <span className="text-[10px] font-bold w-8" style={{ color }}>{label}</span>
      <div className="flex-1">
        <Slider value={[value]} onValueChange={(v) => onChange(v[0])} min={0} max={1} step={0.01}
          style={{ '--slider-color': color } as React.CSSProperties} />
      </div>
      <span className="text-[9px] tabular-nums w-6 text-right text-slate-500">{Math.round(value * 100)}</span>
      <button onClick={onMute} aria-label={`Mute ${label}`}
        className={`w-6 h-6 rounded text-[9px] font-bold transition-colors min-w-[24px] ${muted ? 'bg-red-500/80 text-white' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>M</button>
      <button onClick={onSolo} aria-label={`Solo ${label}`}
        className={`w-6 h-6 rounded text-[9px] font-bold transition-colors min-w-[24px] ${soloed ? 'bg-yellow-500/80 text-black' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>S</button>
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
  const [showMix, setShowMix] = useState(false);
  const [showFx, setShowFx] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);
  useEffect(() => { init(); }, [init]);

  // Poll session for arrangement state — only fetch what UI needs
  useEffect(() => {
    if (!s.playing) return;
    const t = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const debug = (e as any).getTransportDebug?.();
      if (debug) setSessionSnap({
        sessionSection: debug.sessionSection,
        sessionPhrase: debug.sessionPhrase,
        transportBar: debug.transportBar,
        sessionRole: debug.sessionRole,
        transportBpm: debug.transportBpm,
        sessionTension: debug.sessionTension,
        sessionDensity: debug.sessionDensity,
        radioState: debug.radioState,
        radioObservationState: debug.radioObservationState,
        occupancy: debug.occupancy || s.occupancy,
      });
    }, 250);
    return () => clearInterval(t);
  }, [s.playing]);

  // Visualizer — only run when playing
  useEffect(() => {
    if (!s.playing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let active = true;
    const draw = () => {
      if (!active) return;
      const engine = engineRef.current;
      const analyser = engine?.analyserNode;
      if (!analyser || !ctx) { rafRef.current = requestAnimationFrame(draw); return; }
      const W = canvas.width = canvas.offsetWidth, H = canvas.height = canvas.offsetHeight;
      ctx.fillStyle = 'rgba(7,3,18,0.5)'; ctx.fillRect(0, 0, W, H);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      const bars = 32, bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const v = buf[Math.floor(i * buf.length / bars)] / 255;
        const h = v * H * 0.9;
        ctx.fillStyle = `hsl(${175 - i * 3}, 70%, ${20 + v * 50}%)`;
        ctx.fillRect(i * bw + 1, H - h, bw - 2, h);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { active = false; cancelAnimationFrame(rafRef.current); };
  }, [s.playing]);

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
  const cycleBar = currentBar % 64;
  const activeRoles = sessionSnap?.sessionRole ?? 'GROOVE';
  const isActive = (ch: Channel) => {
    if (activeRoles === 'BREAK') return ch === 'kick' || ch === 'bass';
    if (ch === 'lead') return activeRoles === 'LEAD';
    return true;
  };

  // Radio adaptation interpretation
  const radioAdaptation = s.radioOn ? [
    { label: 'BASS', state: s.occupancy.bass > 0.6 ? 'adapting' : 'steady', color: '#10b981' },
    { label: 'LEAD', state: s.occupancy.lead > 0.7 ? 'creating space' : 'playing', color: '#ff2e88' },
    { label: 'GROOVE', state: s.occupancy.kick > 0.6 ? 'following' : 'leading', color: '#00ffc8' },
  ] : [];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0a0612', color: '#e2e8f0' }}>
      {/* TOP BAR — Transport + Status */}
      <header className="sticky top-0 z-20 px-3 py-2 border-b border-white/10" style={{ background: 'rgba(10,6,18,0.95)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3">
          <h1 className="text-base font-black tracking-tight"
            style={{ background: 'linear-gradient(90deg,#00ffc8,#b967ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PSY4
          </h1>
          <button onClick={togglePlay}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-all"
            style={{ background: s.playing ? '#ff2e88' : '#00ffc8', color: s.playing ? '#fff' : '#0a0612' }}
            aria-label={s.playing ? 'Stop' : 'Play'}>
            {s.playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <div className="flex items-center gap-3 text-xs">
            <span className="tabular-nums font-bold" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span>
            <span className="text-[10px] text-slate-500">BPM</span>
            <span className="tabular-nums text-[11px]" style={{ color: '#b967ff' }}>{s.bassNote}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: syncMeta.color, background: `${syncMeta.color}20` }}>
              {syncMeta.label}
            </span>
          </div>
        </div>
        {/* Master volume — compact, inline */}
        <div className="flex items-center gap-2 mt-1.5">
          <Volume2 className="w-3 h-3 text-slate-500 flex-shrink-0" />
          <Slider value={[vol]} onValueChange={(v) => handleVol(v[0])} min={0} max={1} step={0.01} className="flex-1"
            style={{ '--slider-color': '#00ffc8' } as React.CSSProperties} />
          <span className="text-[9px] tabular-nums text-slate-500 w-6 text-right">{Math.round(vol * 100)}</span>
        </div>
      </header>

      {/* MAIN — Timeline + Performance */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 py-3 space-y-3">

        {/* TIMELINE — PRIMARY, full width */}
        <section>
          <div className="flex items-center gap-1 mb-1.5">
            {SECTIONS.map((sec, i) => {
              const isCurrent = currentSection === sec;
              const isInCycle = cycleBar >= i * 8 && cycleBar < (i + 1) * 8;
              const isPast = cycleBar > (i + 1) * 8 - 1;
              return (
                <button key={i} onClick={() => forceSection(sec)} disabled={!s.playing}
                  className="flex-1 relative overflow-hidden rounded-md transition-all min-h-[44px] disabled:opacity-40"
                  style={{
                    background: isCurrent ? 'rgba(0,255,200,0.12)' : isPast ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isCurrent ? 'rgba(0,255,200,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: isCurrent ? '#00ffc8' : '#64748b' }}>
                    {SECTION_SHORT[i]}
                  </div>
                  {isCurrent && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
                      <div className="h-full transition-all" style={{ width: `${phraseProgress}%`, background: '#00ffc8' }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {/* Bar position + cycle indicator */}
          <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
            <span className="tabular-nums">Bar {currentBar} · Phrase {currentPhrase} · {activeRoles}</span>
            <span className="tabular-nums">Cycle {Math.floor(currentBar / 64) + 1}</span>
          </div>
        </section>

        {/* PERFORMANCE MACROS — Energy + Tension + Arrangement */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* Energy */}
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(0,255,200,0.05)', border: '1px solid rgba(0,255,200,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1" style={{ color: '#00ffc8' }}>
                <Zap className="w-3 h-3" /> Energy
              </span>
              <button onClick={() => toggleLock('energy')} disabled={!s.playing}
                className="text-[9px] px-1.5 py-0.5 rounded font-bold transition-colors disabled:opacity-30"
                style={{ background: locks.energy ? 'rgba(0,255,200,0.2)' : 'rgba(255,255,255,0.05)', color: locks.energy ? '#00ffc8' : '#64748b' }}>
                {locks.energy ? 'LOCK' : 'AUTO'}
              </button>
            </div>
            <Slider value={[energy]} onValueChange={(v) => handleEnergy(v[0])} min={0} max={1} step={0.01} disabled={!s.playing}
              style={{ '--slider-color': '#00ffc8' } as React.CSSProperties} />
          </div>
          {/* Tension */}
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(255,46,136,0.05)', border: '1px solid rgba(255,46,136,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-bold flex items-center gap-1" style={{ color: '#ff2e88' }}>
                <Waves className="w-3 h-3" /> Tension
              </span>
              <button onClick={() => toggleLock('tension')} disabled={!s.playing}
                className="text-[9px] px-1.5 py-0.5 rounded font-bold transition-colors disabled:opacity-30"
                style={{ background: locks.tension ? 'rgba(255,46,136,0.2)' : 'rgba(255,255,255,0.05)', color: locks.tension ? '#ff2e88' : '#64748b' }}>
                {locks.tension ? 'LOCK' : 'AUTO'}
              </button>
            </div>
            <Slider value={[tension]} onValueChange={(v) => handleTension(v[0])} min={0} max={1} step={0.01} disabled={!s.playing}
              style={{ '--slider-color': '#ff2e88' } as React.CSSProperties} />
          </div>
          {/* Style */}
          <div className="p-2.5 rounded-lg" style={{ background: 'rgba(185,103,255,0.05)', border: '1px solid rgba(185,103,255,0.15)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#b967ff' }}>Style</span>
              <button onClick={() => toggleLock('style')} disabled={!s.playing}
                className="text-[9px] px-1.5 py-0.5 rounded font-bold transition-colors disabled:opacity-30"
                style={{ background: locks.style ? 'rgba(185,103,255,0.2)' : 'rgba(255,255,255,0.05)', color: locks.style ? '#b967ff' : '#64748b' }}>
                {locks.style ? 'LOCK' : 'AUTO'}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {STYLES.map(st => (
                <button key={st} onClick={() => handleStyle(st)} disabled={!s.playing}
                  className="text-[8px] font-bold py-1 rounded transition-colors disabled:opacity-30"
                  style={{
                    background: style === st && locks.style ? 'rgba(185,103,255,0.3)' : 'rgba(255,255,255,0.05)',
                    color: style === st && locks.style ? '#fff' : '#94a3b8',
                  }}>
                  {st === 'FULL_ON' ? 'F.ON' : st.slice(0, 4)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ARRANGEMENT TRIGGERS */}
        <section className="flex gap-1.5">
          <button onClick={triggerBreak} disabled={!s.playing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 min-h-[40px]"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
            <ArrowDown className="w-3 h-3" /> BREAK
          </button>
          <button onClick={triggerBuild} disabled={!s.playing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 min-h-[40px]"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
            <ArrowUp className="w-3 h-3" /> BUILD
          </button>
          <button onClick={triggerDrop} disabled={!s.playing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 min-h-[40px]"
            style={{ background: 'rgba(255,46,136,0.1)', border: '1px solid rgba(255,46,136,0.2)', color: '#ff2e88' }}>
            <Flame className="w-3 h-3" /> DROP
          </button>
          <button onClick={releaseSection} disabled={!s.playing}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold transition-colors disabled:opacity-30 min-h-[40px]"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
            <RotateCcw className="w-3 h-3" /> AUTO
          </button>
        </section>

        {/* VISUALIZER — compact, only when playing */}
        {s.playing && (
          <div className="h-12 rounded-lg overflow-hidden border border-white/5">
            <canvas ref={canvasRef} className="w-full h-full block" />
          </div>
        )}

        {/* RADIO — musical relationship display */}
        <section className="p-3 rounded-lg" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.12)' }}>
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
            <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#f59e0b' }}>Radio</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: syncMeta.color, background: `${syncMeta.color}20` }}>
              {syncMeta.label}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Select value={streamId} onValueChange={setStreamId} disabled={s.radioOn}>
                <SelectTrigger className="w-[130px] h-7 text-[10px] bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAMS.map(st => <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {!s.radioOn ? (
                <Button onClick={connectRadio} size="sm" className="h-7 text-[10px] bg-emerald-600 hover:bg-emerald-500">Connect</Button>
              ) : (
                <Button onClick={disconnectRadio} size="sm" variant="destructive" className="h-7 text-[10px]">Disconnect</Button>
              )}
            </div>
          </div>
          {/* Radio adaptation display — musical interpretation, not raw values */}
          {s.radioOn ? (
            <div className="grid grid-cols-3 gap-2">
              {radioAdaptation.map(a => (
                <div key={a.label} className="flex items-center justify-between px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <span className="text-[9px] font-bold uppercase" style={{ color: a.color }}>{a.label}</span>
                  <span className="text-[9px] text-slate-400">{a.state}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[10px] text-slate-500">Disconnected — connect to let radio influence the composition</div>
          )}
          {s.radioOn && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[9px] uppercase text-slate-500 w-8">Vol</span>
              <Slider value={[radioVol]} onValueChange={(v) => handleRadioVol(v[0])} min={0} max={1} step={0.01}
                style={{ '--slider-color': '#f59e0b' } as React.CSSProperties} />
              <span className="text-[9px] tabular-nums text-slate-500 w-6 text-right">{Math.round(radioVol * 100)}</span>
            </div>
          )}
        </section>

        {/* MIX — collapsible */}
        <section className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={() => setShowMix(!showMix)} className="w-full flex items-center justify-between px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 flex items-center gap-1.5">
              <Waves className="w-3 h-3" /> Mix
            </span>
            {showMix ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
          </button>
          {showMix && (
            <div className="px-3 pb-3 space-y-1.5">
              <MixChannel label="KICK" value={channelVols.kick} onChange={(v) => handleChannelVol('kick', v)} onMute={() => handleMute('kick')} onSolo={() => handleSolo('kick')} muted={muteState.kick} soloed={soloState === 'kick'} color="#00ffc8" active={isActive('kick')} />
              <MixChannel label="BASS" value={channelVols.bass} onChange={(v) => handleChannelVol('bass', v)} onMute={() => handleMute('bass')} onSolo={() => handleSolo('bass')} muted={muteState.bass} soloed={soloState === 'bass'} color="#10b981" active={isActive('bass')} />
              <MixChannel label="LEAD" value={channelVols.lead} onChange={(v) => handleChannelVol('lead', v)} onMute={() => handleMute('lead')} onSolo={() => handleSolo('lead')} muted={muteState.lead} soloed={soloState === 'lead'} color="#ff2e88" active={isActive('lead')} />
              <MixChannel label="HATS" value={channelVols.hat} onChange={(v) => handleChannelVol('hat', v)} onMute={() => handleMute('hat')} onSolo={() => handleSolo('hat')} muted={muteState.hat} soloed={soloState === 'hat'} color="#f59e0b" active={isActive('hat')} />
            </div>
          )}
        </section>

        {/* FX — collapsible */}
        <section className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={() => setShowFx(!showFx)} className="w-full flex items-center justify-between px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">FX</span>
            {showFx ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
          </button>
          {showFx && (
            <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          )}
        </section>

        {/* CAUSAL COMPOSITION PANEL */}
        {s.playing && (
          <section className="rounded-lg border border-white/10 p-3" style={{ background: 'rgba(10,6,18,0.6)' }}>
            <h3 className="text-[10px] uppercase font-bold text-slate-400 mb-2">Causal Engine</h3>

            {/* Current Action */}
            <div className="mb-3 p-2 rounded-md" style={{ background: 'rgba(255,46,136,0.08)', border: '1px solid rgba(255,46,136,0.2)' }}>
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-semibold text-slate-400">Action</span>
                <span className="text-[11px] font-mono font-bold" style={{ color: s.causalAction === 'NO_CHANGE' ? '#64748b' : '#ff2e88' }}>
                  {s.causalAction}
                </span>
              </div>
              {s.causalWhyNow && (
                <div className="mt-1 text-[9px] text-slate-500 font-mono leading-tight">{s.causalWhyNow}</div>
              )}
            </div>

            {/* State Variables */}
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {[
                { label: 'Tension', value: s.causalTension, color: '#ef4444' },
                { label: 'Contrast', value: s.causalContrastDebt, color: '#f59e0b' },
                { label: 'Anticip.', value: s.causalAnticipation, color: '#a855f7' },
                { label: 'Groove', value: s.causalGrooveStability, color: '#00ffc8' },
                { label: 'Expect.', value: s.causalExpectation, color: '#06b6d4' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="text-[9px] text-slate-400 w-12">{label}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-200" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
                  </div>
                  <span className="text-[9px] tabular-nums text-slate-500 w-6 text-right">{value.toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Active Materials */}
            <div className="mb-3">
              <span className="text-[9px] uppercase font-semibold text-slate-400">Materials</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {s.causalActiveMaterials.length === 0 ? (
                  <span className="text-[9px] text-slate-600">none</span>
                ) : (
                  s.causalActiveMaterials.map((m) => (
                    <span key={m} className="text-[9px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'rgba(0,255,200,0.1)', color: '#00ffc8' }}>{m}</span>
                  ))
                )}
              </div>
            </div>

            {/* Decision History */}
            <div>
              <span className="text-[9px] uppercase font-semibold text-slate-400">History</span>
              <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                {s.causalHistory.length === 0 ? (
                  <span className="text-[9px] text-slate-600">—</span>
                ) : (
                  s.causalHistory.slice().reverse().map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-[9px] font-mono">
                      <span className="text-slate-600 w-8">B{h.bar}</span>
                      <span style={{ color: h.action === 'NO_CHANGE' ? '#64748b' : '#ff2e88' }}>{h.action}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* MOBILE STICKY TRANSPORT — bottom bar on small screens */}
      <footer className="sticky bottom-0 z-20 px-3 py-2 border-t border-white/10 sm:hidden" style={{ background: 'rgba(10,6,18,0.95)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2">
          <button onClick={togglePlay}
            className="flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0"
            style={{ background: s.playing ? '#ff2e88' : '#00ffc8', color: s.playing ? '#fff' : '#0a0612' }}
            aria-label={s.playing ? 'Stop' : 'Play'}>
            {s.playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <div className="flex-1 text-[10px] text-slate-400">
            <span className="tabular-nums font-bold" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span> BPM · {currentSection} · {syncMeta.label}
          </div>
        </div>
      </footer>

      <style>{`
        .slider-track { background: rgba(255,255,255,0.08); }
        .slider-range { background: var(--slider-color, #00ffc8); }
        .slider-thumb { background: var(--slider-color, #00ffc8); border: 2px solid #0a0612; width: 14px; height: 14px; }
        [data-radix-slider-orientation="vertical"] .slider-thumb { width: 12px; height: 12px; }
      `}</style>
    </div>
  );
}
