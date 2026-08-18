'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, SyncStatus } from '@/lib/psyLive';
import { Play, Square, Radio, Volume2, Zap, Waves, Activity, Database, Brain, Cpu } from 'lucide-react';

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

const ROLE_META: Record<string, { label: string; color: string }> = {
  kick: { label: 'KICK', color: '#00ffc8' },
  bass: { label: 'BASS', color: '#3b82f6' },
  lead: { label: 'LEAD', color: '#ff2e88' },
  hat:  { label: 'HAT', color: '#eab308' },
  perc: { label: 'PERC', color: '#06b6d4' },
};

const STYLE_COLORS: Record<string, string> = {
  fullOn: '#ff2e88',
  dark: '#8b5cf6',
  progressive: '#06b6d4',
  acid: '#10b981',
  forest: '#84cc16',
  hiTech: '#f59e0b',
  unknown: '#64748b',
};

interface BankStats {
  kick: number; bass: number; lead: number; hat: number; perc: number;
}

interface BankEntry {
  id: string;
  role: string;
  matchScore: number;
  reward: number;
  usageCount: number;
  sourceStyle: string;
}

export default function Page() {
  const engineRef = useRef<PsyLive | null>(null);
  const spectrumRef = useRef<HTMLCanvasElement | null>(null);
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
    audioProcessMs: 0, audioCpuLoad: 0, audioActiveVoices: 0, audioVoiceBudget: 0,
    userEnergy: 0.5, userTension: 0.3, userStyle: 'FULL_ON', forcedSection: null, forcedBarsRemaining: 0,
  });

  const [streamId, setStreamId] = useState('spaceunicorn');
  const [vol, setVol] = useState(0.9);
  const [recording, setRecording] = useState(false);
  const [radioVol, setRadioVol] = useState(0.15);  // FIX: was 0.5 — too loud with engine
  const [style, setStyle] = useState<MusicalStyle>('FULL_ON');
  const [energy, setEnergy] = useState(0.5);
  const [tension, setTension] = useState(0.3);
  const [showRadio, setShowRadio] = useState(false);
  const [synthOn, setSynthOn] = useState(false);
  const [synthDiag, setSynthDiag] = useState<any>(null);
  const [midiOn, setMidiOn] = useState(false);

  // שלב 4.7: נתוני learning (עדכון כל 2s — לא כל 100ms)
  const [bankStats, setBankStats] = useState<BankStats>({ kick: 0, bass: 0, lead: 0, hat: 0, perc: 0 });
  const [bankEntries, setBankEntries] = useState<BankEntry[]>([]);
  const [onsetCounts, setOnsetCounts] = useState<Record<string, number>>({ kick: 0, bass: 0, lead: 0, hat: 0, perc: 0 });
  const [detectedStyle, setDetectedStyle] = useState<{ style: string; confidence: number; distance: number }>({ style: 'unknown', confidence: 0, distance: 0 });
  const [totalOnsets, setTotalOnsets] = useState(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const w = window as any;
    if (w.__psyLive && w.__psyLive.audioContext && w.__psyLive.audioContext.state !== 'closed') {
      engineRef.current = w.__psyLive;
      engineRef.current!.onState = setS;
      return;
    }
    if (w.__psyLive) delete w.__psyLive;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
    w.__psyLive = e;
  }, []);
  useEffect(() => { init(); }, [init]);

  const playingRef = useRef(false);
  playingRef.current = s.playing;

  const togglePlay = useCallback(() => {
    const e = engineRef.current; if (!e) return;
    if (playingRef.current) e.stop();
    else { e.setStyle(style); e.setEnergy(energy); e.setTension(tension); e.play(); }
  }, [style, energy, tension]);
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  const connectRadio = async () => {
    const e = engineRef.current; if (!e) return;
    const stream = STREAMS.find(x => x.id === streamId) || STREAMS[0];
    await e.connectRadio(stream);
  };
  const disconnectRadio = () => engineRef.current?.disconnectRadio();
  const handleStyle = (st: MusicalStyle) => { setStyle(st); engineRef.current?.setStyle(st); };
  const handleVol = (v: number) => { setVol(v); engineRef.current?.setVolume(v); };
  const handleRadioVol = (v: number) => { setRadioVol(v); engineRef.current?.setRadioVolume(v); };
  const handleEnergy = (v: number) => { setEnergy(v); engineRef.current?.setEnergy(v); };
  const handleTension = (v: number) => { setTension(v); engineRef.current?.setTension(v); };

  // שלב 4.7: keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') {
        // FIX: Only toggle on Space if the page has focus (prevent agent-browser/visibility from stopping)
        if (document.hasFocus() && document.visibilityState === 'visible') {
          e.preventDefault();
          togglePlayRef.current();
        }
      }
      if (e.code === 'KeyR') { setShowRadio(p => !p); }
    };
    window.addEventListener('keydown', handler);
    // FIX: Prevent page visibility change from stopping audio
    const visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        // Page hidden — don't stop, just let it keep running
        console.log('[PSY4] Page hidden — audio continues');
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      window.removeEventListener('keydown', handler);
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, []);

  // שלב 4.7: עדכון נתוני learning כל 2 שניות (לא כל 100ms — מונע jitter)
  useEffect(() => {
    if (!s.playing) return;
    const updateLearning = async () => {
      const e = engineRef.current;
      if (!e) return;
      try {
        // Bank stats
        const stats = await e.getSoundBankStats();
        setBankStats(stats);
        // Bank entries (top 8 — לא כולם, כדי לא להכביד)
        const kickEntries = await e.getSoundBank().all('kick');
        const bassEntries = await e.getSoundBank().all('bass');
        const allEntries = [...kickEntries, ...bassEntries]
          .sort((a, b) => b.reward - a.reward)
          .slice(0, 8)
          .map(en => ({ id: en.id.slice(-8), role: en.role, matchScore: en.matchScore, reward: en.reward, usageCount: en.usageCount, sourceStyle: en.sourceStyle }));
        setBankEntries(allEntries);
        // Onset counts
        setOnsetCounts(e.getOnsetAnalyzer().getOnsetCounts());
        setTotalOnsets(e.getOnsetAnalyzer().getTotalOnsets());
        // Style
        const cls = e['lastClassification'] as any;
        if (cls) {
          setDetectedStyle({ style: cls.style, confidence: cls.confidence, distance: cls.distance });
        }
        // Synth device diagnostics
        const sd = e.getSynthBridgeDiagnostics?.();
        if (sd) setSynthDiag(sd);
      } catch (err) { console.warn('[PSY4] UI polling error:', err); }
    };
    updateLearning();
    const interval = setInterval(updateLearning, 2000);
    return () => clearInterval(interval);
  }, [s.playing]);

  // Phase 7.1: Spectrum analyzer — real-time FFT display
  useEffect(() => {
    if (!s.playing) return;
    const canvas = spectrumRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      const e = engineRef.current;
      if (!e) { raf = requestAnimationFrame(draw); return; }
      const analyser = (e as any).analyser || (e as any)._analyser;
      if (!analyser) { raf = requestAnimationFrame(draw); return; }
      const fd = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(fd as Uint8Array<ArrayBuffer>);
      const W = canvas.width = canvas.offsetWidth;
      const H = canvas.height = canvas.offsetHeight;
      ctx.fillStyle = 'rgba(6,3,13,0.4)';
      ctx.fillRect(0, 0, W, H);
      const bars = 48;
      const barW = W / bars;
      for (let i = 0; i < bars; i++) {
        const idx = Math.floor(i * fd.length / bars);
        const val = fd[idx] / 255;
        const barH = val * H;
        const hue = i / bars * 180 + 160; // cyan→purple→pink
        ctx.fillStyle = `hsl(${hue},80%,${40 + val * 30}%)`;
        ctx.fillRect(i * barW, H - barH, barW - 1, barH);
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [s.playing]);

  const syncMeta = SYNC_META[s.syncStatus] || SYNC_META.idle;
  const totalBankEntries = bankStats.kick + bankStats.bass + bankStats.lead + bankStats.hat + bankStats.perc;
  const styleColor = STYLE_COLORS[detectedStyle.style] || '#64748b';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#06030d', color: '#e2e8f0' }}>
      {/* ─── HEADER ─── */}
      <header className="sticky top-0 z-30 px-4 py-2.5 border-b border-white/8" style={{ background: 'rgba(6,3,13,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center gap-4 max-w-6xl mx-auto">
          <h1 className="text-xl font-black tracking-tight"
            style={{ background: 'linear-gradient(90deg,#00ffc8 0%,#b967ff 50%,#ff2e88 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            PSY4
          </h1>
          <button onClick={togglePlay}
            className="flex items-center justify-center w-12 h-12 rounded-full transition-all hover:scale-105 active:scale-95"
            style={{ background: s.playing ? '#ff2e88' : '#00ffc8', color: s.playing ? '#fff' : '#06030d', boxShadow: s.playing ? '0 0 20px rgba(255,46,136,0.4)' : '0 0 20px rgba(0,255,200,0.3)' }}
            aria-label={s.playing ? 'Stop' : 'Play'}>
            {s.playing ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <span className="text-2xl font-mono font-bold tabular-nums" style={{ color: '#00ffc8' }}>{Math.round(s.engineBpm)}</span>
              <span className="text-[9px] text-slate-500 uppercase">BPM</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm font-mono tabular-nums" style={{ color: '#b967ff' }}>{s.bassNote}</span>
              <span className="text-[9px] text-slate-500 uppercase">Key</span>
            </div>
          </div>

          <div className="flex-1" />

          {/* Radio status */}
          <button onClick={() => setShowRadio(p => !p)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            style={{ background: s.radioOn ? `${syncMeta.color}20` : 'rgba(255,255,255,0.05)', color: syncMeta.color, border: `1px solid ${syncMeta.color}40` }}>
            <Radio className="w-3.5 h-3.5" />
            <span>RADIO {syncMeta.label}</span>
          </button>

          {/* SYNTH DEVICE toggle (psysynth A/B) */}
          <button
            onClick={async () => {
              const e = engineRef.current; if (!e) return;
              const next = await e.toggleSynthDevice();
              setSynthOn(next);
              if (next) setSynthDiag(e.getSynthBridgeDiagnostics());
            }}
            disabled={!s.playing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 hover:scale-105"
            style={{
              background: synthOn ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.05)',
              color: synthOn ? '#22c55e' : '#94a3b8',
              border: synthOn ? '1px solid rgba(34,197,94,0.5)' : '1px solid rgba(255,255,255,0.1)',
            }}
            title="Toggle psysynth device (melodic voices route to psysynth + worklet)"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>SYNTH {synthOn ? 'ON' : 'OFF'}</span>
            {synthOn && synthDiag && synthDiag.eventsRoutedToSynth > 0 && (
              <span className="text-[9px] tabular-nums opacity-70">·{synthDiag.eventsRoutedToSynth}</span>
            )}
          </button>

          {/* MIDI input toggle (live keyboard playing) */}
          <button
            onClick={async () => {
              const e = engineRef.current; if (!e) return;
              if (e.isMidiActive()) {
                e.disableMidiInput();
                setMidiOn(false);
              } else {
                const ok = await e.enableMidiInput();
                setMidiOn(ok);
                if (!ok) alert('WebMIDI not available. Use Chrome/Edge with a MIDI keyboard connected.');
              }
            }}
            disabled={!s.playing}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-30 hover:scale-105"
            style={{
              background: midiOn ? 'rgba(168,85,247,0.2)' : 'rgba(255,255,255,0.05)',
              color: midiOn ? '#a855f7' : '#94a3b8',
              border: midiOn ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.1)',
            }}
            title="Toggle MIDI input — play with a hardware keyboard"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>MIDI {midiOn ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Radio panel — collapsible */}
        {showRadio && (
          <div className="mt-2.5 pt-2.5 border-t border-white/8 max-w-6xl mx-auto">
            <div className="flex items-center gap-3 flex-wrap">
              <select value={streamId} onChange={e => setStreamId(e.target.value)} disabled={s.radioOn}
                className="bg-white/5 text-slate-200 text-xs rounded-lg px-3 py-1.5 border border-white/10 focus:outline-none focus:border-cyan-400/50">
                {STREAMS.map(st => <option key={st.id} value={st.id}>{st.name} — {st.genre}</option>)}
              </select>
              {!s.radioOn ? (
                <button onClick={connectRadio} className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                  style={{ background: '#00ffc8', color: '#06030d' }}>Connect</button>
              ) : (
                <button onClick={disconnectRadio} className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105"
                  style={{ background: '#ef4444', color: '#fff' }}>Disconnect</button>
              )}
              <div className="flex items-center gap-2 flex-1 min-w-[140px]">
                <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                <input type="range" min={0} max={1} step={0.01} value={radioVol} onChange={e => handleRadioVol(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400" style={{ height: '4px' }} />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* ─── MAIN ─── */}
      <main className="flex-1 px-4 py-4 max-w-6xl mx-auto w-full">
        {/* Phase 7.1: Spectrum analyzer — real-time FFT display */}
        {s.playing && (
          <div className="mb-4 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 px-4 pt-2 pb-1">
              <Activity className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Spectrum</span>
              <span className="text-[10px] text-slate-500 ml-auto">LUFS ≈ {(20 * Math.log10(Math.max(0.0001, s.engineLevel)) - 0.691).toFixed(1)}</span>
            </div>
            <canvas ref={spectrumRef} className="w-full h-20 block" />
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* ═══ CONTROLS ═══ */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Controls</span>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-400 flex items-center gap-1"><Zap className="w-3 h-3" /> Energy</span>
                <span className="text-xs tabular-nums text-slate-500">{energy.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={energy} onChange={e => handleEnergy(parseFloat(e.target.value))} disabled={!s.playing}
                className="w-full accent-cyan-400" style={{ height: '4px' }} />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-slate-400 flex items-center gap-1"><Waves className="w-3 h-3" /> Tension</span>
                <span className="text-xs tabular-nums text-slate-500">{tension.toFixed(2)}</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={tension} onChange={e => handleTension(parseFloat(e.target.value))} disabled={!s.playing}
                className="w-full accent-pink-400" style={{ height: '4px' }} />
            </div>

            <div>
              <span className="text-xs text-slate-400 mb-1 block">Style</span>
              <div className="grid grid-cols-4 gap-1.5">
                {STYLES.map(st => (
                  <button key={st} onClick={() => handleStyle(st)} disabled={!s.playing}
                    className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                    style={{ background: s.userStyle === st ? 'rgba(185,103,255,0.3)' : 'rgba(255,255,255,0.05)', color: s.userStyle === st ? '#fff' : '#94a3b8', border: s.userStyle === st ? '1px solid rgba(185,103,255,0.5)' : '1px solid transparent' }}>
                    {st === 'FULL_ON' ? 'F.ON' : st.slice(0, 4)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <Volume2 className="w-3 h-3 text-slate-400" />
                <span className="text-xs tabular-nums text-slate-500">{Math.round(vol * 100)}%</span>
              </div>
              <input type="range" min={0} max={1} step={0.01} value={vol} onChange={e => handleVol(parseFloat(e.target.value))}
                className="w-full accent-slate-400" style={{ height: '4px' }} />
            </div>
          </div>

          {/* ═══ DETECTED STYLE ═══ */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Detected Style</span>
            </div>
            {!s.radioOn ? (
              <div className="text-center py-4 text-slate-500 text-sm">Connect radio to detect style</div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-black" style={{ color: styleColor }}>
                    {detectedStyle.style === 'unknown' ? 'UNKNOWN' : detectedStyle.style.toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] text-slate-500 mb-1">Confidence</div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round(detectedStyle.confidence * 100)}%`, background: styleColor }} />
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-500 font-mono">
                  distance: {detectedStyle.distance.toFixed(2)} · sourceStyle: {detectedStyle.style}
                </div>
              </>
            )}
          </div>

          {/* ═══ ONSET ACTIVITY ═══ */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Onset Activity</span>
              <span className="text-[10px] text-slate-500 ml-auto tabular-nums">{totalOnsets} total</span>
            </div>
            {!s.radioOn ? (
              <div className="text-center py-4 text-slate-500 text-sm">No radio signal</div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(ROLE_META).map(([role, meta]) => {
                  const count = onsetCounts[role] || 0;
                  const max = Math.max(1, ...Object.values(onsetCounts));
                  const height = (count / max) * 100;
                  return (
                    <div key={role} className="flex flex-col items-center gap-1">
                      <div className="w-full h-16 rounded-md bg-white/5 relative overflow-hidden flex items-end">
                        <div className="w-full rounded-md transition-all duration-500" style={{ height: `${height}%`, background: meta.color, minHeight: count > 0 ? '4px' : '0' }} />
                      </div>
                      <span className="text-[9px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-[9px] text-slate-500 tabular-nums">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ═══ SOUND BANK ═══ */}
          <div className="rounded-xl p-4 space-y-3 md:col-span-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-cyan-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Sound Bank</span>
              <span className="text-[10px] text-slate-500 ml-auto tabular-nums">{totalBankEntries} entries</span>
            </div>
            {/* Phase 6.2 + 9.3: Learning progress display + reward history bar */}
            {totalBankEntries > 0 && bankEntries.length > 0 && (
              <div className="mb-2">
                <div className="flex items-center gap-3 text-[10px] mb-2">
                  <span className="text-slate-400">Best reward:</span>
                  <span className="font-mono font-bold" style={{ color: bankEntries[0].reward > 0.7 ? '#22c55e' : bankEntries[0].reward > 0.5 ? '#f59e0b' : '#94a3b8' }}>
                    {bankEntries[0].reward.toFixed(2)}
                  </span>
                  <span className="text-slate-400 ml-2">Voices:</span>
                  <span className="font-mono font-bold text-purple-400 tabular-nums">
                    {s.audioActiveVoices}/{s.audioVoiceBudget}
                  </span>
                  <span className="text-slate-400 ml-2">CPU:</span>
                  <span className="font-mono font-bold" style={{ color: s.audioCpuLoad > 2 ? '#ef4444' : '#22c55e' }}>
                    {s.audioProcessMs.toFixed(1)}ms
                  </span>
                </div>
                {/* Phase 9.3: Reward history mini-bar chart */}
                <div className="flex items-end gap-0.5 h-6">
                  {bankEntries.slice(0, 20).map((entry, i) => (
                    <div key={i} className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${Math.max(4, entry.reward * 100)}%`,
                        background: entry.reward > 0.7 ? '#22c55e' : entry.reward > 0.5 ? '#f59e0b' : '#64748b',
                        opacity: 0.4 + (i / 20) * 0.6,
                      }}
                      title={`${entry.role}: ${entry.reward.toFixed(2)}`}
                    />
                  ))}
                </div>
              </div>
            )}
            {totalBankEntries === 0 ? (
              <div className="text-center py-6 text-slate-500 text-sm">
                {s.radioOn ? `Learning... (${totalOnsets} onsets detected)` : 'Connect radio to start learning'}
              </div>
            ) : (
              <>
                {/* Per-role counts */}
                <div className="grid grid-cols-5 gap-2">
                  {Object.entries(ROLE_META).map(([role, meta]) => (
                    <div key={role} className="flex flex-col items-center gap-1 p-2 rounded-lg" style={{ background: `${meta.color}10`, border: `1px solid ${meta.color}20` }}>
                      <span className="text-[10px] font-bold" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-xl font-mono font-bold tabular-nums text-white">{bankStats[role as keyof BankStats] || 0}</span>
                    </div>
                  ))}
                </div>

                {/* Top entries */}
                {bankEntries.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Top Entries (by reward)</div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {bankEntries.map((entry, i) => {
                        const entryColor = ROLE_META[entry.role]?.color || '#64748b';
                        const styleColor = STYLE_COLORS[entry.sourceStyle] || '#64748b';
                        return (
                          <div key={i} className="flex items-center gap-2 text-[10px] font-mono py-1 px-2 rounded hover:bg-white/5">
                            <span className="w-10 font-bold" style={{ color: entryColor }}>{entry.role.toUpperCase()}</span>
                            <span className="w-16 text-slate-400">m={entry.matchScore.toFixed(2)}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.round(entry.reward * 100)}%`, background: entryColor }} />
                            </div>
                            <span className="w-8 text-slate-500 text-right tabular-nums">{entry.reward.toFixed(2)}</span>
                            <span className="w-12 text-right" style={{ color: styleColor }}>{entry.sourceStyle.slice(0, 8)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ═══ LOOP LEARNER ═══ */}
          <div className="rounded-xl p-4 space-y-3 md:col-span-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-amber-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Loop Learner</span>
              <span className="text-[10px] text-slate-500 ml-auto">למידה מקובץ אודיו</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a"
                id="loop-file-input"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !engineRef.current) return;
                  const ok = await engineRef.current.loadLoopFile(file);
                  if (!ok) {
                    alert('פורמט קובץ לא נתמך. נסה MP3, WAV, או OGG.');
                  }
                  e.target.value = '';
                }}
                disabled={!s.playing}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => {
                  const input = document.getElementById('loop-file-input') as HTMLInputElement;
                  if (input) input.click();
                }}
                disabled={!s.playing}
                className="px-4 py-2 rounded-lg text-[10px] font-bold transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: s.playing ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.05)', color: s.playing ? '#f59e0b' : '#64748b', border: '1px solid rgba(245,158,11,0.3)' }}
              >
                העלה קובץ אודיו
              </button>
              <button
                onClick={() => engineRef.current?.stopLoop()}
                disabled={!s.playing || !engineRef.current?.isLoopRunning()}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                עצור לופ
              </button>
              {engineRef.current?.isLoopRunning() && (
                <span className="text-[10px] text-amber-400 font-bold">● לופ פעיל</span>
              )}
              <div className="flex items-center gap-2 flex-1 min-w-[120px]">
                <Volume2 className="w-3 h-3 text-slate-400" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  defaultValue={0.5}
                  onChange={e => engineRef.current?.setLoopVolume(parseFloat(e.target.value))}
                  disabled={!s.playing}
                  className="w-full accent-amber-400"
                  style={{ height: '4px' }}
                />
              </div>
            </div>
            <div className="text-[10px] text-slate-500">
              העלה קובץ אודיו (MP3/WAV/OGG) — המנוע ינגן אותו בלולאה וילמד ממנו.
              עובד עם כל קובץ, כולל הקלטות שהורדת מ-YouTube.
            </div>
          </div>

          {/* ═══ SOUND PACKAGE ═══ */}
          <div className="rounded-xl p-4 space-y-3 md:col-span-2" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-emerald-400" />
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Sound Package</span>
              <span className="text-[10px] text-slate-500 ml-auto">שלב 5</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => engineRef.current?.exportSoundPackage()} disabled={!s.playing || totalBankEntries === 0}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(0,255,200,0.15)', color: '#00ffc8', border: '1px solid rgba(0,255,200,0.3)' }}>
                Export Package
              </button>
              <button onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.onchange = async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file || !engineRef.current) return;
                  const text = await file.text();
                  await engineRef.current.importSoundPackage(text);
                };
                input.click();
              }} disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(185,103,255,0.15)', color: '#b967ff', border: '1px solid rgba(185,103,255,0.3)' }}>
                Import Package
              </button>
              <button onClick={() => engineRef.current?.generateAllOriginalSounds()} disabled={!s.playing || totalBankEntries === 0}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(255,46,136,0.15)', color: '#ff2e88', border: '1px solid rgba(255,46,136,0.3)' }}>
                Generate Originals
              </button>
              <button
                onClick={() => {
                  if (recording) {
                    engineRef.current?.stopRecording();
                    setRecording(false);
                  } else {
                    engineRef.current?.startRecording();
                    setRecording(true);
                  }
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: recording ? 'rgba(255,46,136,0.3)' : 'rgba(255,255,255,0.05)', color: recording ? '#ff2e88' : '#94a3b8', border: recording ? '1px solid rgba(255,46,136,0.5)' : '1px solid rgba(255,255,255,0.1)' }}>
                {recording ? '⏹ Stop Rec' : '● Record'}
              </button>
              <button
                onClick={() => {
                  if (confirm('Reset all learned sounds? This clears the bank + memory for a fresh start.')) {
                    engineRef.current?.resetAll();
                  }
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(255,255,255,0.05)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
                ↻ Reset
              </button>
              <button
                onClick={() => {
                  if (confirm('FACTORY RESET: wipes ALL stored state (localStorage + IndexedDB) and reloads the page.\n\nUse this when you hear stuck sounds from previous sessions.\n\nThis cannot be undone. Continue?')) {
                    engineRef.current?.factoryReset();
                  }
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}
                title="Wipe ALL stored state (localStorage + IndexedDB) and reload"
              >
                ⨯ Factory
              </button>
              <button
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'audio/*';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) {
                      try {
                        const dna = await engineRef.current?.analyzeReference(file);
                        if (dna) {
                          alert(`Reference analyzed!\nLUFS: ${dna.lufs.toFixed(1)}\nTrue Peak: ${dna.truePeak.toFixed(1)}\nBPM: ${dna.bpm}\nKey: ${dna.key} (${dna.scaleName})\nStereo Width: ${dna.stereoWidth.toFixed(2)}`);
                        }
                      } catch (err) {
                        alert('Reference analysis failed: ' + (err as Error).message);
                      }
                    }
                  };
                  input.click();
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                📁 Reference
              </button>
              <button
                onClick={() => {
                  const result = engineRef.current?.compareWithReference();
                  if (!result) {
                    alert('No reference loaded. Upload a reference track first (📁 Reference button).');
                  } else {
                    alert(`A/B Comparison:\nCurrent LUFS: ${result.currentLUFS.toFixed(1)}\nReference LUFS: ${result.refLUFS.toFixed(1)}\nDistance: ${(result.distance * 100).toFixed(0)}% (0% = identical)`);
                  }
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
                ⚖ A/B Compare
              </button>
              <button
                onClick={() => engineRef.current?.exportMIDI()}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
                🎵 MIDI Export
              </button>
              <button
                onClick={() => { engineRef.current?.exportWAV(8); }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(244,114,182,0.15)', color: '#f472b6', border: '1px solid rgba(244,114,182,0.3)' }}
                title="Render 8 bars of drums to WAV (offline). Melodic voices (psysynth) not included — see console log.">
                🎚 WAV Render
              </button>
              <button
                onClick={() => {
                  const name = prompt('Preset name:');
                  if (name) engineRef.current?.savePreset(name);
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                💾 Save Preset
              </button>
              <button
                onClick={() => {
                  const presets = engineRef.current?.listPresets() || [];
                  if (presets.length === 0) {
                    alert('No presets saved yet. Use 💾 Save Preset to create one.');
                    return;
                  }
                  const list = presets.map(p => `${p.name} (${p.bpm} BPM)`).join('\n');
                  const name = prompt(`Saved presets:\n${list}\n\nEnter preset name to load:`);
                  if (name) engineRef.current?.loadPreset(name);
                }}
                disabled={!s.playing}
                className="text-[10px] font-bold py-2 rounded-lg transition-all disabled:opacity-30 hover:scale-105"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                📂 Load Preset
              </button>
            </div>
            <div className="text-[10px] text-slate-500">
              Export: download JSON with all learned sounds + patterns · Import: load previous package · Generate: create new variations from learned sounds
            </div>
          </div>

        </div>
      </main>

      {/* ─── FOOTER (sticky) ─── */}
      <footer className="mt-auto px-4 py-2.5 border-t border-white/8" style={{ background: 'rgba(6,3,13,0.92)', backdropFilter: 'blur(12px)' }}>
        <div className="flex items-center justify-between gap-4 max-w-6xl mx-auto">
          <div className="flex items-center gap-3 text-[10px] text-slate-500">
            {s.playing && (
              <>
                <span className="flex items-center gap-1">
                  <Cpu className="w-3 h-3" />
                  <span className="tabular-nums">{s.audioProcessMs.toFixed(1)}ms</span>
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  <span className="tabular-nums">{s.audioActiveVoices}/{s.audioVoiceBudget} voices</span>
                </span>
              </>
            )}
            <span>Space: Play/Stop · R: Radio</span>
          </div>
          <div className="text-[10px] text-slate-600">
            PSY4 — Self-learning psytrance engine
          </div>
        </div>
      </footer>
    </div>
  );
}
