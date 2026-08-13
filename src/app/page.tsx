'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, SyncStatus } from '@/lib/psyLive';
import { Play, Square, Radio, Volume2, Zap, Waves, ArrowDown, ArrowUp, Flame, RotateCcw, Activity, Layers, Cpu, ChevronUp, ChevronDown, Brain } from 'lucide-react';

const STYLES = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID'] as const;
type MusicalStyle = typeof STYLES[number];

const SYNC_META: Record<SyncStatus, { label: string; color: string }> = {
  idle: { label: 'IDLE', color: '#64748b' },
  connecting: { label: 'CONNECTING', color: '#f59e0b' },
  no_signal: { label: 'NO SIGNAL', color: '#ef4444' },
  listening: { label: 'LISTENING', color: '#f59e0b' },
  following: { label: 'FOLLOWING', color: '#10b981' },
  holdover: { label: 'HOLDOVER', color: '#a855f7' },
  error: { label: 'ERROR', color: '#ef4444' },
};

const MATERIAL_COLORS: Record<string, string> = {
  kick: '#00ffc8', bass: '#3b82f6', sub: '#1e40af', snare: '#f97316', clap: '#fb923c',
  'hat-closed': '#eab308', 'hat-open': '#facc15', shaker: '#fde047', ride: '#a855f7',
  crash: '#c084fc', percussion: '#06b6d4', tom: '#0891b2', rim: '#0e7490',
  lead: '#ff2e88', counterline: '#ec4899', motif: '#f472b6', stab: '#e11d48',
  chord: '#be185d', arp: '#9f1239', pad: '#8b5cf6', drone: '#7c3aed',
  atmosphere: '#6d28d9', texture: '#5b21b6', riser: '#f59e0b', impact: '#ef4444',
  downlifter: '#f97316', sweep: '#eab308', reverse: '#ca8a04', fill: '#a16207',
};

const ACTION_COLORS: Record<string, string> = {
  NO_CHANGE: '#64748b', INTRODUCE_HATS: '#eab308', INTRODUCE_LEAD: '#ff2e88',
  INTRODUCE_PERCUSSION: '#06b6d4', INTRODUCE_COUNTERLINE: '#ec4899',
  VARY_MOTIF: '#f59e0b', TRANSFORM_MOTIF: '#f97316', CALLBACK_MOTIF: '#a855f7',
  BREAKDOWN: '#ef4444', THIN_REGISTER: '#64748b', RESPONSE: '#10b981',
};

function StateBar({ label, value, color, threshold }: { label: string; value: number; color: string; threshold?: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-slate-400 w-12 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden relative">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
        {threshold !== undefined && threshold > 0 && (
          <div className="absolute top-0 bottom-0 w-px bg-white/30" style={{ left: `${threshold * 100}%` }} />
        )}
      </div>
      <span className="text-[9px] tabular-nums text-slate-500 w-8 text-right">{value.toFixed(2)}</span>
    </div>
  );
}

function MaterialChip({ material }: { material: string }) {
  const color = MATERIAL_COLORS[material] || '#64748b';
  return (
    <span className="text-[9px] px-2 py-1 rounded-md font-mono font-semibold transition-all"
      style={{ background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {material}
    </span>
  );
}

function HistoryEntry({ entry }: { entry: { bar: number; action: string } }) {
  const color = ACTION_COLORS[entry.action] || '#64748b';
  return (
    <div className="flex items-center gap-2 text-[9px] font-mono py-0.5 px-1 rounded hover:bg-white/5 transition-colors">
      <span className="text-slate-600 w-8 flex-shrink-0">B{entry.bar}</span>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <span style={{ color }}>{entry.action}</span>
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
    causalAction: 'NO_CHANGE', causalWhyNow: '', causalTension: 0, causalContrastDebt: 0,
    causalAnticipation: 0, causalGrooveStability: 0, causalExpectation: 0,
    causalActiveMaterials: [], causalHistory: [],
  });

  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.9);
  const [style, setStyle] = useState<MusicalStyle>('FULL_ON');
  const [energy, setEnergy] = useState(0.5);
  const [tension, setTension] = useState(0.3);
  const [showMix, setShowMix] = useState(false);
  const [showFx, setShowFx] = useState(false);
  const [showRadio, setShowRadio] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);
  useEffect(() => { init(); }, [init]);

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
      ctx.fillStyle = 'rgba(7,3,18,0.4)'; ctx.fillRect(0, 0, W, H);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(buf);
      const bars = 48, bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const v = buf[Math.floor(i * buf.length / bars)] / 255;
        const h = v * H * 0.95;
        const hue = 175 - i * 2.5;
        ctx.fillStyle = `hsl(${hue}, 80%, ${15 + v * 55}%)`;
        ctx.fillRect(i * bw + 0.5, H - h, bw - 1, h);
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
  const connectRadio = async () => { const e = engineRef.current; if (!e) return; const stream = STREAMS.find(x => x.id === streamId) || STREAMS[0]; await e.connectRadio(stream); };
  const disconnectRadio = () => engineRef.current?.disconnectRadio();
  const handleStyle = (st: MusicalStyle) => { setStyle(st); engineRef.current?.setStyle(st); };
  const handleVol = (v: number) => { setVol(v); engineRef.current?.setVolume(v); };
  const handleRadioVol = (v: number) => { setRadioVol(v); engineRef.current?.setRadioVolume(v); };
  const handleEnergy = (v: number) => { setEnergy(v); engineRef.current?.setEnergy(v); };
  const handleTension = (v: number) => { setTension(v); engineRef.current?.setTension(v); };
  const triggerBreak = () => engineRef.current?.triggerBreak(4);
  const triggerBuild = () => engineRef.current?.triggerBuild(4);
  const triggerDrop = () => engineRef.current?.triggerDrop(4);
  const releaseSection = () => engineRef.current?.releaseSection();

  const syncMeta = SYNC_META[s.syncStatus] || SYNC_META.idle;
  const actionColor = ACTION_COLORS[s.causalAction] || '#64748b';

  // Causal thresholds for display
  const THRESHOLDS = { tension: 0.5, contrast: 0.7, anticipation: 0.6, groove: 0.6, expectation: 0.6 };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#06030d', color: '#e2e8f0' }}>
      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-30 px-4 py-2.5 border-b border-white/8" style={{ background: 'rgba(6,3,13,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-4 max-w-7xl mx-auto">
          <h1 className="text-lg font-black tracking-tight"
            style={{ background: 'linear-gradient(90deg,#00ffc8 0%,#b967ff 50%,#ff2e88 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PSY4
          </h1>
          <button onClick={togglePlay}
            className="flex items-center justify-center w-11 h-11 rounded-full transition-all hover:scale-105 active:scale-95"
            style={{ background: s.playing ? '#ff2e88' : '#00ffc8', color: s.playing ? '#fff' : '#06030d', boxShadow: s.playing ? '0 0 20px rgba(255,46,136,0.4)' : '0 0 20px rgba(0,255,200,0.3)' }}
            aria-label={s.playing ? 'Stop' : 'Play'}>
            {s.playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-xl font-mono font-bold tabular-nums" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span>
              <span className="text-[9px] text-slate-500 uppercase">BPM</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-mono tabular-nums" style={{ color: '#b967ff' }}>{s.bassNote}</span>
              <span className="text-[9px] text-slate-500 uppercase">Key</span>
            </div>
            <div className="hidden sm:flex items-center gap-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: syncMeta.color, background: `${syncMeta.color}18` }}>
                {syncMeta.label}
              </span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-slate-500" />
            <input type="range" min={0} max={1} step={0.01} value={vol} onChange={e => handleVol(parseFloat(e.target.value))}
              className="w-20 sm:w-32 accent-cyan-400" style={{ height: '4px' }} />
          </div>
        </div>
      </header>

      {/* ─── MAIN BODY — 3-column on desktop ─── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 py-3">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-3">

          {/* ═══ LEFT COLUMN — CAUSAL STATE ═══ */}
          <div className="space-y-3">

            {/* CAUSAL ACTION — the hero card */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,46,136,0.04)', border: `1px solid ${actionColor}30` }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Brain className="w-3.5 h-3.5" style={{ color: actionColor }} />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Causal Decision</span>
              </div>
              <div className="text-base font-mono font-bold mb-1" style={{ color: actionColor }}>
                {s.causalAction}
              </div>
              {s.causalWhyNow && (
                <div className="text-[9px] text-slate-500 font-mono leading-relaxed mt-1 p-1.5 rounded bg-black/30">
                  {s.causalWhyNow}
                </div>
              )}
            </div>

            {/* STATE METERS */}
            <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">State</span>
              </div>
              <StateBar label="Tension" value={s.causalTension} color="#ef4444" threshold={THRESHOLDS.tension} />
              <StateBar label="Contrast" value={s.causalContrastDebt} color="#f59e0b" threshold={THRESHOLDS.contrast} />
              <StateBar label="Anticip." value={s.causalAnticipation} color="#a855f7" threshold={THRESHOLDS.anticipation} />
              <StateBar label="Groove" value={s.causalGrooveStability} color="#00ffc8" threshold={THRESHOLDS.groove} />
              <StateBar label="Expect." value={s.causalExpectation} color="#06b6d4" threshold={THRESHOLDS.expectation} />
            </div>

            {/* CONTROLS */}
            <div className="rounded-xl p-3 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Controls</span>
              <div>
                <div className="flex justify-between mb-1"><span className="text-[9px] text-slate-400 flex items-center gap-1"><Zap className="w-3 h-3" /> Energy</span><span className="text-[9px] tabular-nums text-slate-500">{energy.toFixed(2)}</span></div>
                <input type="range" min={0} max={1} step={0.01} value={energy} onChange={e => handleEnergy(parseFloat(e.target.value))} disabled={!s.playing}
                  className="w-full accent-cyan-400" style={{ height: '4px' }} />
              </div>
              <div>
                <div className="flex justify-between mb-1"><span className="text-[9px] text-slate-400 flex items-center gap-1"><Waves className="w-3 h-3" /> Tension</span><span className="text-[9px] tabular-nums text-slate-500">{tension.toFixed(2)}</span></div>
                <input type="range" min={0} max={1} step={0.01} value={tension} onChange={e => handleTension(parseFloat(e.target.value))} disabled={!s.playing}
                  className="w-full accent-pink-400" style={{ height: '4px' }} />
              </div>
              <div>
                <span className="text-[9px] text-slate-400 mb-1 block">Style</span>
                <div className="grid grid-cols-4 gap-1">
                  {STYLES.map(st => (
                    <button key={st} onClick={() => handleStyle(st)} disabled={!s.playing}
                      className="text-[8px] font-bold py-1.5 rounded transition-all disabled:opacity-30 hover:scale-105"
                      style={{ background: style === st ? 'rgba(185,103,255,0.3)' : 'rgba(255,255,255,0.05)', color: style === st ? '#fff' : '#94a3b8', border: style === st ? '1px solid rgba(185,103,255,0.5)' : '1px solid transparent' }}>
                      {st === 'FULL_ON' ? 'F.ON' : st.slice(0, 4)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1 pt-1">
                <button onClick={triggerBreak} disabled={!s.playing} className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[8px] font-bold transition-all disabled:opacity-30 hover:scale-105" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>
                  <ArrowDown className="w-3 h-3" /> BREAK
                </button>
                <button onClick={triggerBuild} disabled={!s.playing} className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[8px] font-bold transition-all disabled:opacity-30 hover:scale-105" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
                  <ArrowUp className="w-3 h-3" /> BUILD
                </button>
                <button onClick={triggerDrop} disabled={!s.playing} className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[8px] font-bold transition-all disabled:opacity-30 hover:scale-105" style={{ background: 'rgba(255,46,136,0.1)', border: '1px solid rgba(255,46,136,0.2)', color: '#ff2e88' }}>
                  <Flame className="w-3 h-3" /> DROP
                </button>
                <button onClick={releaseSection} disabled={!s.playing} className="flex flex-col items-center gap-0.5 py-2 rounded-lg text-[8px] font-bold transition-all disabled:opacity-30 hover:scale-105" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8' }}>
                  <RotateCcw className="w-3 h-3" /> AUTO
                </button>
              </div>
            </div>
          </div>

          {/* ═══ CENTER COLUMN — MATERIALS + VISUALIZER ═══ */}
          <div className="space-y-3">

            {/* VISUALIZER */}
            {s.playing && (
              <div className="h-16 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <canvas ref={canvasRef} className="w-full h-full block" />
              </div>
            )}

            {/* ACTIVE MATERIALS */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Active Materials</span>
                <span className="ml-auto text-[9px] tabular-nums text-slate-600">{s.causalActiveMaterials.length} active</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.causalActiveMaterials.length === 0 ? (
                  <span className="text-[10px] text-slate-600">No materials active — engine building groove</span>
                ) : (
                  s.causalActiveMaterials.map(m => <MaterialChip key={m} material={m} />)
                )}
              </div>
            </div>

            {/* DECISION HISTORY */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center gap-1.5 mb-2">
                <Cpu className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Decision History</span>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
                {s.causalHistory.length === 0 ? (
                  <span className="text-[10px] text-slate-600">—</span>
                ) : (
                  s.causalHistory.slice().reverse().map((h, i) => <HistoryEntry key={i} entry={h} />)
                )}
              </div>
            </div>

            {/* MIX — collapsible */}
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowMix(!showMix)} className="w-full flex items-center justify-between px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Mix</span>
                {showMix ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {showMix && (
                <div className="px-3 pb-3 space-y-1.5">
                  {[
                    { label: 'DRUMS', color: '#00ffc8', vol: 0.8 },
                    { label: 'BASS', color: '#3b82f6', vol: 0.6 },
                    { label: 'LEAD', color: '#ff2e88', vol: 0.45 },
                    { label: 'TEXTURE', color: '#8b5cf6', vol: 0.3 },
                    { label: 'FX', color: '#f59e0b', vol: 0.5 },
                  ].map(ch => (
                    <div key={ch.label} className="flex items-center gap-2 p-1.5 rounded" style={{ background: `${ch.color}08` }}>
                      <span className="text-[10px] font-bold w-10" style={{ color: ch.color }}>{ch.label}</span>
                      <input type="range" min={0} max={1} step={0.01} defaultValue={ch.vol} className="flex-1" style={{ accentColor: ch.color, height: '4px' }} />
                      <span className="text-[9px] tabular-nums text-slate-500 w-6 text-right">{Math.round(ch.vol * 100)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* FX — collapsible */}
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowFx(!showFx)} className="w-full flex items-center justify-between px-3 py-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">FX</span>
                {showFx ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {showFx && (
                <div className="px-3 pb-3 grid grid-cols-3 gap-3">
                  {[
                    { label: 'Echo', color: '#f59e0b' }, { label: 'Feedback', color: '#a855f7' }, { label: 'Space', color: '#06b6d4' },
                  ].map(fx => (
                    <div key={fx.label}>
                      <div className="flex justify-between mb-0.5"><span className="text-[9px] uppercase font-semibold text-slate-300">{fx.label}</span></div>
                      <input type="range" min={0} max={1} step={0.01} defaultValue={0.3} className="w-full" style={{ accentColor: fx.color, height: '4px' }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ═══ RIGHT COLUMN — RADIO + LEARNING ═══ */}
          <div className="space-y-3">

            {/* RADIO */}
            <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(245,158,11,0.03)', border: '1px solid rgba(245,158,11,0.1)' }}>
              <button onClick={() => setShowRadio(!showRadio)} className="w-full flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" style={{ color: '#f59e0b' }} />
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#f59e0b' }}>Radio</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: syncMeta.color, background: `${syncMeta.color}20` }}>{syncMeta.label}</span>
                </div>
                {showRadio ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />}
              </button>
              {showRadio && (
                <div className="px-3 pb-3 space-y-2">
                  <select value={streamId} onChange={e => setStreamId(e.target.value)} disabled={s.radioOn}
                    className="w-full bg-white/5 text-[10px] rounded px-2 py-1 border border-white/10 text-slate-300">
                    {STREAMS.map(st => <option key={st.id} value={st.id}>{st.name} — {st.genre}</option>)}
                  </select>
                  {!s.radioOn ? (
                    <button onClick={connectRadio} className="w-full py-1.5 rounded text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 transition-colors">Connect</button>
                  ) : (
                    <button onClick={disconnectRadio} className="w-full py-1.5 rounded text-[10px] font-bold bg-red-600 hover:bg-red-500 transition-colors">Disconnect</button>
                  )}
                  {s.radioOn && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] uppercase text-slate-500 w-8">Vol</span>
                        <input type="range" min={0} max={1} step={0.01} value={radioVol} onChange={e => handleRadioVol(parseFloat(e.target.value))} className="flex-1" style={{ accentColor: '#f59e0b', height: '4px' }} />
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <div className="text-center p-1.5 rounded bg-white/5">
                          <div className="text-[8px] text-slate-500 uppercase">Low</div>
                          <div className="text-[10px] tabular-nums font-mono" style={{ color: '#3b82f6' }}>{Math.round(s.radioBands.low * 100)}</div>
                        </div>
                        <div className="text-center p-1.5 rounded bg-white/5">
                          <div className="text-[8px] text-slate-500 uppercase">Mid</div>
                          <div className="text-[10px] tabular-nums font-mono" style={{ color: '#f59e0b' }}>{Math.round(s.radioBands.mid * 100)}</div>
                        </div>
                        <div className="text-center p-1.5 rounded bg-white/5">
                          <div className="text-[8px] text-slate-500 uppercase">High</div>
                          <div className="text-[10px] tabular-nums font-mono" style={{ color: '#ff2e88' }}>{Math.round(s.radioBands.high * 100)}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {[
                          { label: 'Kick', val: s.occupancy.kick, color: '#00ffc8' },
                          { label: 'Bass', val: s.occupancy.bass, color: '#3b82f6' },
                          { label: 'Lead', val: s.occupancy.lead, color: '#ff2e88' },
                          { label: 'Hats', val: s.occupancy.hats, color: '#eab308' },
                        ].map(o => (
                          <div key={o.label} className="text-center p-1 rounded bg-white/5">
                            <div className="text-[8px] text-slate-500 uppercase">{o.label}</div>
                            <div className="h-1 rounded-full bg-white/10 mt-0.5 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${o.val * 100}%`, background: o.color }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* LEARNING */}
            {s.learned && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(0,255,200,0.03)', border: '1px solid rgba(0,255,200,0.1)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Cpu className="w-3.5 h-3.5" style={{ color: '#00ffc8' }} />
                  <span className="text-[10px] uppercase tracking-wider font-bold" style={{ color: '#00ffc8' }}>Learning</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[9px]"><span className="text-slate-400">Detected Key</span><span className="font-mono" style={{ color: '#b967ff' }}>{s.learned.key}</span></div>
                  <div className="flex justify-between text-[9px]"><span className="text-slate-400">Detected Scale</span><span className="font-mono" style={{ color: '#00ffc8' }}>{s.learned.scale || '—'}</span></div>
                  <div className="flex justify-between text-[9px]"><span className="text-slate-400">Tempo Conf.</span><span className="font-mono tabular-nums" style={{ color: '#06b6d4' }}>{Math.round(s.learned.confidence * 100)}%</span></div>
                  <div className="flex justify-between text-[9px]"><span className="text-slate-400">Top BPM</span><span className="font-mono tabular-nums" style={{ color: '#f59e0b' }}>{s.learned.bpm}</span></div>
                </div>
              </div>
            )}

            {/* ENGINE STATUS */}
            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-2 block">Engine</span>
              <div className="space-y-1">
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Engine BPM</span><span className="font-mono tabular-nums" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Kick Count</span><span className="font-mono tabular-nums text-slate-300">{s.kickCount}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Radio RMS</span><span className="font-mono tabular-nums text-slate-300">{(s.radioRms * 100).toFixed(1)}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Signal State</span><span className="font-mono text-slate-300">{s.radioSignalState}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Observation</span><span className="font-mono text-slate-300">{s.radioObservationState}</span></div>
                <div className="flex justify-between text-[9px]"><span className="text-slate-400">Confidence</span><span className="font-mono tabular-nums" style={{ color: s.radioConfidence > 0.5 ? '#10b981' : '#64748b' }}>{Math.round(s.radioConfidence * 100)}%</span></div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="sticky bottom-0 z-20 px-4 py-2 border-t border-white/8" style={{ background: 'rgba(6,3,13,0.92)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-7xl mx-auto flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span>
            <span className="text-slate-600">BPM</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono" style={{ color: actionColor }}>{s.causalAction}</span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="font-mono text-slate-500">{s.causalActiveMaterials.length} materials</span>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-500">{s.causalHistory.length} decisions</span>
            <span className="text-slate-600">·</span>
            <span className="font-bold px-1.5 py-0.5 rounded" style={{ color: syncMeta.color, background: `${syncMeta.color}18` }}>{syncMeta.label}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
