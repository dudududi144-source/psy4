'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS, PRESETS } from '@/lib/psyLive';

const SYNC_META: Record<string, { color: string; label: string }> = {
  idle:      { color: '#6b7280', label: 'IDLE' },
  listening: { color: '#f59e0b', label: 'LISTENING' },
  following: { color: '#10b981', label: 'FOLLOWING' },
};

const MIX_META: Record<string, { color: string; label: string; desc: string }> = {
  solo:       { color: '#00ffc8', label: 'SOLO',       desc: 'standalone patterns' },
  glue:       { color: '#f59e0b', label: 'GLUE',       desc: 'harmonic lock' },
  reinforce:  { color: '#ff2e88', label: 'REINFORCE',  desc: 'tight sync' },
};

export default function Page() {
  const engineRef = useRef<PsyLive | null>(null);
  const [s, setS] = useState<LiveState>({
    playing: false, radioOn: false, radioBpm: 0, engineBpm: 145,
    syncStatus: 'idle', mixMode: 'solo', kickCount: 0, bassNote: '—',
    radioLevel: 0, engineLevel: 0, presetId: 'rolling_bass', variant: 'A',
    learned: null, sidechainActive: false, harmonicLocked: false,
    radioRms: 0, radioBands: { low: 0, mid: 0, high: 0 },
    compositionMode: false,
  });
  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.9);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);

  useEffect(() => { init(); }, [init]);

  const play = useCallback(async () => { await init(); engineRef.current?.play(); }, [init]);
  const stop = useCallback(() => engineRef.current?.stop(), []);

  const connectRadio = useCallback(async () => {
    await init();
    const engine = engineRef.current;
    if (!engine) return;
    const stream = engine.getStreams().find(x => x.id === streamId);
    if (stream) await engine.connectRadio(stream);
  }, [streamId, init]);

  const disconnectRadio = useCallback(() => engineRef.current?.disconnectRadio(), []);

  useEffect(() => () => { engineRef.current?.stop(); engineRef.current?.disconnectRadio(); }, []);

  // Visualizer (like psy — simple bar viz)
  useEffect(() => {
    if (!s.playing && !s.radioOn) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const rAn = engineRef.current?.radioAnalyserNode;
    const eAn = engineRef.current?.analyserNode;
    const rd = rAn ? new Uint8Array(rAn.frequencyBinCount) : null;
    const ed = eAn ? new Uint8Array(eAn.frequencyBinCount) : null;

    const draw = () => {
      const w = c.width = c.offsetWidth, h = c.height = c.offsetHeight;
      ctx.fillStyle = '#070312'; ctx.fillRect(0, 0, w, h);
      const bars = 64, barW = w / bars;
      if (eAn && ed) {
        eAn.getByteFrequencyData(ed);
        for (let i = 0; i < bars; i++) {
          const val = ed[Math.floor((i / bars) * ed.length * 0.7)] / 255;
          const bh = val * h * 0.9, hue = 280 - val * 120;
          ctx.fillStyle = `hsl(${hue},100%,${40 + val * 30}%)`;
          ctx.fillRect(i * barW + 1, h - bh, barW - 2, bh);
        }
      }
      if (rAn && rd) {
        rAn.getByteFrequencyData(rd);
        for (let i = 0; i < bars; i++) {
          const val = rd[Math.floor((i / bars) * rd.length * 0.7)] / 255;
          ctx.fillStyle = `rgba(245,158,11,${0.3 + val * 0.4})`;
          ctx.fillRect(i * barW + 1, h - val * h * 0.5, barW - 2, 2);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [s.playing, s.radioOn]);

  const streams = STREAMS;
  const presets = PRESETS;
  const syncM = SYNC_META[s.syncStatus];
  const mixM = MIX_META[s.mixMode];

  return (
    <div style={{ minHeight: '100dvh', background: '#070312', color: '#efe9fb', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      <header style={{ borderBottom: '1px solid rgba(150,90,255,0.15)', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, background: 'linear-gradient(90deg,#00ffc8,#b967ff,#ff2e88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PSY LIVE</h1>
          <p style={{ fontSize: 9, color: mixM.color, fontFamily: 'monospace' }}>● {mixM.label} — {mixM.desc}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Metric label="ENGINE" value={s.engineBpm} color="#00ffc8" />
          <Metric label="RADIO" value={s.radioBpm || '—'} color="#f59e0b" />
          <Metric label="KICKS" value={s.kickCount} color="#ff2e88" />
          <Metric label="KEY" value={s.bassNote} color="#b967ff" />
          <div style={{ padding: '6px 14px', borderRadius: 10, fontSize: 11, fontWeight: 'bold', fontFamily: 'monospace', background: syncM.color + '18', color: syncM.color, border: `1px solid ${syncM.color}50` }}>{syncM.label}</div>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 900, width: '100%', margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Transport */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
          {!s.playing ? (
            <button onClick={play} style={{ fontSize: 18, padding: '14px 44px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(90deg,#00ffc8,#b967ff)', color: '#0a0518', border: 'none', fontWeight: 700 }}>▶ Play</button>
          ) : (
            <button onClick={stop} style={{ fontSize: 18, padding: '14px 44px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(90deg,#ff2e88,#b967ff)', color: '#0a0518', border: 'none', fontWeight: 700 }}>■ Stop</button>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>VOL</span>
            <input type="range" min="0" max="1" step="0.05" value={vol} onChange={e => { setVol(parseFloat(e.target.value)); engineRef.current?.setVolume(parseFloat(e.target.value)); }} style={{ width: 120 }} />
            <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>{Math.round(vol * 100)}%</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['A', 'B'] as const).map(v => (
              <button key={v} onClick={() => engineRef.current?.setVariant(v)} style={{
                padding: '8px 26px', borderRadius: 10, background: s.variant === v ? '#b967ff' : 'transparent',
                border: '1px solid rgba(150,90,255,0.25)', color: s.variant === v ? '#0a0518' : '#9d8fc0',
                cursor: 'pointer', fontWeight: 700,
              }}>{v}</button>
            ))}
          </div>
          {(s.playing || s.radioOn) && (
            <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 620, height: 120, borderRadius: 12, border: '1px solid rgba(150,90,255,0.25)', background: '#070312' }} />
          )}
        </div>

        {/* Presets */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 16, padding: 20 }}>
          <h2 style={{ fontSize: 15, letterSpacing: '0.08em', marginBottom: 14, color: '#00ffc8', textTransform: 'uppercase' }}>Presets</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
            {presets.map(p => (
              <button key={p.id} onClick={() => engineRef.current?.setPreset(p.id)} style={{
                textAlign: 'left', padding: 16, borderRadius: 12, cursor: 'pointer',
                background: '#0d0620', border: s.presetId === p.id ? '1px solid #00ffc8' : '1px solid rgba(150,90,255,0.25)',
                color: '#efe9fb', font: 'inherit',
              }}>
                <div style={{ fontWeight: 700, color: '#00ffc8' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: '#ff2e88', fontFamily: 'monospace', margin: '4px 0' }}>{p.tag} · {p.bpm} BPM</div>
                <div style={{ fontSize: 12, color: '#9d8fc0' }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Radio */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 16, padding: 20 }}>
          <h2 style={{ fontSize: 15, letterSpacing: '0.08em', marginBottom: 14, color: '#00ffc8', textTransform: 'uppercase' }}>Radio</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={streamId} onChange={e => setStreamId(e.target.value)} disabled={s.radioOn} style={{ background: '#0d0620', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 8, padding: '8px 12px', color: '#efe9fb', fontSize: 13, flex: 1, minWidth: 150 }}>
              {streams.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
            {!s.radioOn ? (
              <button onClick={connectRadio} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#f59e0b', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: 13 }}>CONNECT</button>
            ) : (
              <button onClick={disconnectRadio} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#ff4d6d', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: 13 }}>DISCONNECT</button>
            )}
          </div>
          {s.radioOn && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>RADIO VOL</span>
              <input type="range" min="0" max="1" step="0.05" value={radioVol} onChange={e => { setRadioVol(parseFloat(e.target.value)); engineRef.current?.setRadioVolume(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
              <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>{Math.round(radioVol * 100)}%</span>
            </div>
          )}
          {s.radioOn && (
            <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 10, fontFamily: 'monospace' }}>
              <span>LOW: {Math.round(s.radioBands.low * 100)}%</span>
              <span>MID: {Math.round(s.radioBands.mid * 100)}%</span>
              <span>HIGH: {Math.round(s.radioBands.high * 100)}%</span>
            </div>
          )}
        </div>

        {/* Learning */}
        {s.learned && s.learned.confidence > 0 && (
          <div style={{ background: 'rgba(61,255,168,0.05)', border: '1px solid rgba(61,255,168,0.2)', borderRadius: 16, padding: 20 }}>
            <h2 style={{ fontSize: 15, letterSpacing: '0.08em', marginBottom: 14, color: '#3dffa8', textTransform: 'uppercase' }}>Learned</h2>
            <div style={{ display: 'flex', gap: 20, fontSize: 13, fontFamily: 'monospace', flexWrap: 'wrap' }}>
              <span>Tempo: <b style={{ color: '#f59e0b' }}>{s.learned.bpm} BPM</b></span>
              <span>Key: <b style={{ color: '#b967ff' }}>{s.learned.key}</b></span>
              <span>Scale: <b style={{ color: '#3dffa8' }}>{s.learned.scale || '—'}</b></span>
              <span>Confidence: <b style={{ color: '#3dffa8' }}>{Math.round(s.learned.confidence * 100)}%</b></span>
            </div>
            {!s.compositionMode && (
              <button onClick={() => engineRef.current?.toggleComposition()} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 10, border: 'none', background: '#3dffa8', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>▶ PLAY ORIGINAL</button>
            )}
            {s.compositionMode && (
              <button onClick={() => engineRef.current?.toggleComposition()} style={{ marginTop: 12, padding: '10px 20px', borderRadius: 10, border: 'none', background: '#ff2e88', color: '#fff', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>■ STOP ORIGINAL</button>
            )}
          </div>
        )}
      </main>

      <footer style={{ borderTop: '1px solid rgba(150,90,255,0.15)', padding: '10px 16px', fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span>PSY LIVE · Web Audio</span>
        <span>{s.radioOn ? '● RADIO ON' : '○ NO RADIO'} · {s.playing ? '● PLAYING' : '○ IDLE'}</span>
      </footer>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 7, color: '#9d8fc0', textTransform: 'uppercase', fontFamily: 'monospace' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 'bold', fontFamily: 'monospace', color }}>{value}</div>
    </div>
  );
}
