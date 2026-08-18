'use client';

// PSY4 — Phase 1 test page
// Minimal UI that uses PsyLive4 (the new clean architecture).
// Purpose: PROVE the engine plays continuously without stopping,
// even through background-tab cycles.
//
// This replaces the 800-line dashboard. Phase 2 will build the full
// psyforge synth-rack UI.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive4, type LiveState4 } from '@/lib/psyLive4/psyLive4';
import type { MusicalStyle } from '@/lib/psyLive4/types';

const STYLES: MusicalStyle[] = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID', 'GOA', 'HI_TECH', 'FOREST'];

const STYLE_COLORS: Record<string, string> = {
  FULL_ON: '#ff2e88',
  DARK: '#8b5cf6',
  PROGRESSIVE: '#06b6d4',
  ACID: '#10b981',
  GOA: '#f59e0b',
  HI_TECH: '#ef4444',
  FOREST: '#84cc16',
};

const initialState: LiveState4 = {
  playing: false,
  bpm: 145,
  style: 'FULL_ON',
  energy: 0.5,
  kickCount: 0,
  bar: 0,
  engineLevel: 0,
  voicesActive: 0,
  patchesLoaded: 0,
  peakDb: -Infinity,
  rmsDb: -Infinity,
  schedulerStaleMs: 0,
  ctxState: 'suspended',
  suspended: false,
  repetition: { uniqueBars: 0, repeatedBars: 0, maxStreak: 0, windowSize: 0 },
};

export default function Page() {
  const engineRef = useRef<PsyLive4 | null>(null);
  const [s, setS] = useState<LiveState4>(initialState);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bpm, setBpm] = useState(145);
  const [style, setStyle] = useState<MusicalStyle>('FULL_ON');
  const [energy, setEnergy] = useState(0.5);
  const [vol, setVol] = useState(1.0);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // ── Init engine on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const engine = new PsyLive4();
        await engine.init();
        if (cancelled) { engine.dispose(); return; }
        engineRef.current = engine;
        // Expose globally for browser diagnostics
        (window as any).__psyLive4 = engine;
        setReady(true);
        addLog('Engine ready — PsyLive4 initialized');
      } catch (e: any) {
        setError(e?.message ?? String(e));
        addLog('ERROR: ' + (e?.message ?? String(e)));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Poll state at 4Hz (not 10Hz — avoid main-thread pressure) ──
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const e = engineRef.current;
      if (e) setS(e.getState());
    }, 250);
    return () => clearInterval(id);
  }, [ready]);

  // ── Capture console logs for the status panel ──
  useEffect(() => {
    const orig = console.log;
    const origWarn = console.warn;
    const origErr = console.error;
    const cap = (level: string) => (...args: any[]) => {
      const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
      if (msg.includes('PSY4') || msg.includes('PsyLive4') || msg.includes('REPETITION') || msg.includes('HEARTBEAT')) {
        setLogs(prev => [...prev.slice(-12), msg.slice(0, 120)]);
      }
    };
    console.log = cap('log');
    console.warn = cap('warn');
    console.error = cap('err');
    return () => {
      console.log = orig;
      console.warn = origWarn;
      console.error = origErr;
    };
  }, []);

  // ── Auto-scroll logs ──
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-12), msg.slice(0, 120)]);
  }, []);

  // ── Controls ──
  const onPlay = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    await e.play();
    addLog('Play pressed');
  }, [addLog]);

  const onStop = useCallback(() => {
    engineRef.current?.stop();
    addLog('Stop pressed');
  }, [addLog]);

  const onBpm = useCallback((v: number) => {
    setBpm(v);
    engineRef.current?.setBPM(v);
  }, []);

  const onStyle = useCallback((st: MusicalStyle) => {
    setStyle(st);
    engineRef.current?.setStyle(st);
    addLog(`Style: ${st}`);
  }, [addLog]);

  const onEnergy = useCallback((v: number) => {
    setEnergy(v);
    engineRef.current?.setEnergy(v);
  }, []);

  const onVol = useCallback((v: number) => {
    setVol(v);
    // TODO: wire to master gain (for now, just state)
  }, []);

  // ── Render ──
  const peakOk = s.peakDb > -40 && s.peakDb < -0.5;
  const schedulerOk = s.schedulerStaleMs < 200;
  const ctxOk = s.ctxState === 'running';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #08051a 0%, #0a0820 100%)',
      color: '#eee8fb',
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      display: 'flex',
      flexDirection: 'column',
      padding: '16px',
      gap: '12px',
    }}>
      {/* ── Header ── */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: '#b8f22e' }}>PSY4</span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>Phase 1 — Clean Architecture</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onPlay}
            disabled={!ready || s.playing}
            style={{
              padding: '8px 20px',
              background: s.playing ? 'rgba(100,116,139,0.2)' : 'rgba(34,197,94,0.2)',
              color: s.playing ? '#64748b' : '#22c55e',
              border: `1px solid ${s.playing ? 'rgba(100,116,139,0.3)' : 'rgba(34,197,94,0.4)'}`,
              borderRadius: '6px',
              cursor: s.playing ? 'default' : 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            ▶ Play
          </button>
          <button
            onClick={onStop}
            disabled={!s.playing}
            style={{
              padding: '8px 20px',
              background: 'rgba(239,68,68,0.15)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '6px',
              cursor: s.playing ? 'pointer' : 'default',
              fontSize: '13px',
              fontWeight: 600,
              opacity: s.playing ? 1 : 0.4,
            }}
          >
            ■ Stop
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', fontSize: '12px' }}>
          ERROR: {error}
        </div>
      )}

      {/* ── Status strip — THE key indicators ── */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '8px',
      }}>
        <StatusCell label="CTX STATE" value={s.ctxState} ok={ctxOk} />
        <StatusCell label="SCHEDULER" value={`${s.schedulerStaleMs}ms stale`} ok={schedulerOk} />
        <StatusCell label="PEAK" value={`${s.peakDb === -Infinity ? '-∞' : s.peakDb.toFixed(1)}dB`} ok={peakOk} />
        <StatusCell label="RMS" value={`${s.rmsDb === -Infinity ? '-∞' : s.rmsDb.toFixed(1)}dB`} ok={s.rmsDb > -30} />
        <StatusCell label="VOICES" value={`${s.voicesActive}`} ok={s.voicesActive < 32} />
        <StatusCell label="PATCHES" value={`${s.patchesLoaded}`} ok={s.patchesLoaded > 0} />
        <StatusCell label="KICKS" value={`${s.kickCount}`} ok={s.playing ? s.kickCount > 0 : true} />
        <StatusCell label="BAR" value={`${s.bar}`} ok={s.playing ? s.bar > 0 : true} />
        <StatusCell label="SUSPENDED" value={s.suspended ? 'YES' : 'no'} ok={!s.suspended} />
        <StatusCell label="REP MAX" value={`${s.repetition.maxStreak}x`} ok={s.repetition.maxStreak < 8} />
      </section>

      {/* ── Controls ── */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        {/* BPM + Energy + Volume */}
        <div style={{
          padding: '16px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '12px', letterSpacing: '0.1em' }}>TRANSPORT</div>
          <Slider label="BPM" value={bpm} min={120} max={160} step={1} onChange={onBpm} display={`${bpm}`} />
          <Slider label="ENERGY" value={energy} min={0} max={1} step={0.01} onChange={onEnergy} display={`${(energy * 100).toFixed(0)}%`} />
          <Slider label="VOLUME" value={vol} min={0} max={1.5} step={0.01} onChange={onVol} display={`${(vol * 100).toFixed(0)}%`} />
        </div>

        {/* Style selector */}
        <div style={{
          padding: '16px',
          background: 'rgba(255,255,255,0.03)',
          borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '12px', letterSpacing: '0.1em' }}>STYLE</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '6px' }}>
            {STYLES.map(st => (
              <button
                key={st}
                onClick={() => onStyle(st)}
                style={{
                  padding: '8px 4px',
                  background: style === st ? `${STYLE_COLORS[st]}22` : 'rgba(255,255,255,0.03)',
                  color: style === st ? STYLE_COLORS[st] : '#9a8cc4',
                  border: `1px solid ${style === st ? STYLE_COLORS[st] : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                }}
              >
                {st.replace('_', '.')}
              </button>
            ))}
          </div>
          <div style={{ marginTop: '12px', fontSize: '10px', color: '#64748b' }}>
            Current: <span style={{ color: STYLE_COLORS[style] }}>{style}</span>
          </div>
        </div>
      </section>

      {/* ── Log panel ── */}
      <section style={{
        flex: 1,
        padding: '12px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.06)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '180px',
      }}>
        <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '8px', letterSpacing: '0.1em' }}>CONSOLE (filtered: PSY4/PsyLive4/REPETITION/HEARTBEAT)</div>
        <div ref={logRef} style={{ flex: 1, overflowY: 'auto', fontSize: '10px', fontFamily: 'inherit', lineHeight: 1.6 }}>
          {logs.length === 0 ? (
            <div style={{ color: '#475569' }}>— no logs yet —</div>
          ) : (
            logs.map((l, i) => (
              <div key={i} style={{ color: l.includes('ERROR') || l.includes('WARN') ? '#f59e0b' : '#9a8cc4' }}>
                {l}
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        textAlign: 'center',
        fontSize: '10px',
        color: '#475569',
        padding: '8px',
      }}>
        PSY4 Phase 1 — PsyLive4 clean architecture · {ready ? 'READY' : 'INITIALIZING…'}
      </footer>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusCell({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.02)',
      borderRadius: '6px',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
    }}>
      <div style={{ fontSize: '9px', color: '#64748b', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: ok ? '#22c55e' : '#ef4444' }}>{value}</div>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, display }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', marginBottom: '4px' }}>
        <span style={{ color: '#9a8cc4' }}>{label}</span>
        <span style={{ color: '#eee8fb', fontWeight: 600 }}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width: '100%', accentColor: '#b8f22e' }}
      />
    </div>
  );
}
