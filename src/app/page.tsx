'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS } from '@/lib/psyLive';

const STYLES = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID'] as const;
const SYNC_META: Record<string, { color: string; label: string }> = {
  idle: { color: '#6b7280', label: 'IDLE' },
  connecting: { color: '#3b82f6', label: 'CONNECTING' },
  no_signal: { color: '#ef4444', label: 'NO SIGNAL' },
  listening: { color: '#f59e0b', label: 'LISTENING' },
  following: { color: '#10b981', label: 'FOLLOWING' },
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
    occupancy: { kick: 0, bass: 0, lead: 0, hats: 0 },
    radioState: 'DISCONNECTED' as any,
    radioSignalRms: 0,
    radioNonZeroRatio: 0,
  });
  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.9);
  const [style, setStyle] = useState<string>('FULL_ON');
  const [channelVols, setChannelVols] = useState({ kick: 0.95, bass: 0.85, lead: 0.5, hat: 0.55 });
  const [delayAmt, setDelayAmt] = useState(1.0);
  const [delayFb, setDelayFb] = useState(0.34);
  const [reverbSend, setReverbSend] = useState(0.15);
  const [energy, setEnergy] = useState(0.5);
  const [density, setDensity] = useState(0.6);
  const [tension, setTension] = useState(0.3);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [sessionSnap, setSessionSnap] = useState<any>(null);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
    if (typeof window !== 'undefined') {
      (window as any).__psy4TransportDebug = () => engineRef.current?.getTransportDebug();
    }
  }, []);

  useEffect(() => { init(); }, [init]);

  // F11: Poll session state for UI display (every 200ms, not every frame)
  useEffect(() => {
    if (!s.playing) return;
    const interval = setInterval(() => {
      const snap = engineRef.current?.getTransportDebug();
      if (snap) setSessionSnap(snap);
    }, 200);
    return () => clearInterval(interval);
  }, [s.playing]);

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

  // Visualizer
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

  const syncM = SYNC_META[s.syncStatus] || SYNC_META.idle;
  const sectionName = sessionSnap?.sessionSection ?? '—';
  const phraseNum = sessionSnap?.sessionPhrase ?? 0;
  const roleName = sessionSnap?.sessionRole ?? '—';
  const tensionVal = sessionSnap?.sessionTension ?? 0;
  const motifCount = sessionSnap?.sessionMotifCount ?? 0;
  const styleName = sessionSnap?.sessionStyle ?? style;

  // Role activity bars
  const roleBars = {
    KICK: channelVols.kick,
    BASS: channelVols.bass,
    PERC: channelVols.hat,
    LEAD: channelVols.lead,
    FX: delayAmt * 0.5 + reverbSend * 0.5,
  };

  return (
    <div style={{ minHeight: '100dvh', background: '#070312', color: '#efe9fb', fontFamily: 'system-ui', display: 'flex', flexDirection: 'column' }}>
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid rgba(150,90,255,0.15)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 18, fontWeight: 900, background: 'linear-gradient(90deg,#00ffc8,#b967ff,#ff2e88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>PSY4</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Metric label="BPM" value={s.engineBpm} color="#00ffc8" />
          <Metric label="KEY" value={s.bassNote} color="#b967ff" />
          <Metric label="SECTION" value={sectionName} color="#ff2e88" />
          <Metric label="PHRASE" value={phraseNum} color="#f59e0b" />
          <div style={{ padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 'bold', fontFamily: 'monospace', background: syncM.color + '18', color: syncM.color, border: `1px solid ${syncM.color}50` }}>{syncM.label}</div>
        </div>
      </header>

      <main style={{ flex: 1, maxWidth: 960, width: '100%', margin: '0 auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* TRANSPORT + VISUALIZER */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {!s.playing ? (
              <button onClick={play} style={{ fontSize: 16, padding: '12px 40px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(90deg,#00ffc8,#b967ff)', color: '#0a0518', border: 'none', fontWeight: 700 }}>▶ Play</button>
            ) : (
              <button onClick={stop} style={{ fontSize: 16, padding: '12px 40px', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(90deg,#ff2e88,#b967ff)', color: '#0a0518', border: 'none', fontWeight: 700 }}>■ Stop</button>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace' }}>VOL</span>
              <input type="range" min="0" max="1" step="0.05" value={vol} onChange={e => { setVol(parseFloat(e.target.value)); engineRef.current?.setVolume(parseFloat(e.target.value)); }} style={{ width: 100 }} />
            </div>
          </div>
          {(s.playing || s.radioOn) && (
            <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 600, height: 80, borderRadius: 10, border: '1px solid rgba(150,90,255,0.2)', background: '#070312' }} />
          )}
          {/* Role activity bars */}
          <div style={{ display: 'flex', gap: 8, fontSize: 9, fontFamily: 'monospace', color: '#9d8fc0' }}>
            {Object.entries(roleBars).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span>{k}</span>
                <div style={{ width: 40, height: 6, background: '#1a0e30', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${v * 100}%`, height: '100%', background: k === 'KICK' ? '#00ffc8' : k === 'BASS' ? '#f59e0b' : k === 'LEAD' ? '#b967ff' : '#ff2e88', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MUSIC CONTROLS */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 14, padding: 16 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.08em', marginBottom: 12, color: '#00ffc8', textTransform: 'uppercase' }}>Music</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {/* Style selector */}
            <div>
              <label style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace' }}>STYLE</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {STYLES.map(st => (
                  <button key={st} onClick={() => { setStyle(st); engineRef.current?.setStyle(st); }} style={{
                    padding: '6px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                    background: styleName === st ? '#b967ff' : '#0d0620',
                    color: styleName === st ? '#0a0518' : '#9d8fc0',
                    border: styleName === st ? 'none' : '1px solid rgba(150,90,255,0.2)',
                    fontWeight: 600,
                  }}>{st.replace('_', ' ')}</button>
                ))}
              </div>
            </div>
            {/* Energy */}
            <SliderControl label="ENERGY" value={energy} onChange={v => { setEnergy(v); engineRef.current?.setEnergy(v); }} color="#f59e0b" />
            {/* Density */}
            <SliderControl label="DENSITY" value={density} onChange={v => { setDensity(v); engineRef.current?.setDensity(v); }} color="#00ffc8" />
            {/* Tension */}
            <SliderControl label="TENSION" value={tension} onChange={v => { setTension(v); engineRef.current?.setTension(v); }} color="#ff2e88" />
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 10, fontFamily: 'monospace', color: '#9d8fc0' }}>
            <span>ROLE: <b style={{ color: '#b967ff' }}>{roleName}</b></span>
            <span>MOTIFS: <b style={{ color: '#3dffa8' }}>{motifCount}</b></span>
            <span>TENSION: <b style={{ color: '#ff2e88' }}>{(tensionVal * 100).toFixed(0)}%</b></span>
          </div>
        </div>

        {/* MIXER */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 14, padding: 16 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.08em', marginBottom: 12, color: '#00ffc8', textTransform: 'uppercase' }}>Mix</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            <SliderControl label="KICK" value={channelVols.kick} onChange={v => { setChannelVols(p => ({ ...p, kick: v })); engineRef.current?.setChannelVolume('kick', v); }} color="#00ffc8" />
            <SliderControl label="BASS" value={channelVols.bass} onChange={v => { setChannelVols(p => ({ ...p, bass: v })); engineRef.current?.setChannelVolume('bass', v); }} color="#f59e0b" />
            <SliderControl label="LEAD" value={channelVols.lead} onChange={v => { setChannelVols(p => ({ ...p, lead: v })); engineRef.current?.setChannelVolume('lead', v); }} color="#b967ff" />
            <SliderControl label="HATS" value={channelVols.hat} onChange={v => { setChannelVols(p => ({ ...p, hat: v })); engineRef.current?.setChannelVolume('hat', v); }} color="#ff2e88" />
          </div>
        </div>

        {/* FX */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 14, padding: 16 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.08em', marginBottom: 12, color: '#00ffc8', textTransform: 'uppercase' }}>FX</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <SliderControl label="DELAY" value={delayAmt} onChange={v => { setDelayAmt(v); engineRef.current?.setDelayAmount(v); }} color="#3b82f6" />
            <SliderControl label="FEEDBACK" value={delayFb} onChange={v => { setDelayFb(v); engineRef.current?.setDelayFeedback(v); }} color="#8b5cf6" />
            <SliderControl label="REVERB" value={reverbSend} onChange={v => { setReverbSend(v); engineRef.current?.setReverbSend(v); }} color="#06b6d4" />
          </div>
        </div>

        {/* RADIO */}
        <div style={{ background: 'rgba(20,10,40,0.72)', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 14, padding: 16 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.08em', marginBottom: 12, color: '#00ffc8', textTransform: 'uppercase' }}>Radio</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <select value={streamId} onChange={e => setStreamId(e.target.value)} disabled={s.radioOn} style={{ background: '#0d0620', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 6, padding: '6px 10px', color: '#efe9fb', fontSize: 12, flex: 1, minWidth: 140 }}>
              {STREAMS.map(st => <option key={st.id} value={st.id}>{st.name}</option>)}
            </select>
            {!s.radioOn ? (
              <button onClick={connectRadio} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#f59e0b', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>CONNECT</button>
            ) : (
              <button onClick={disconnectRadio} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: '#ff4d6d', color: '#000', fontWeight: 'bold', cursor: 'pointer', fontSize: 12 }}>DISCONNECT</button>
            )}
          </div>
          {s.radioOn && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace' }}>VOL</span>
                <input type="range" min="0" max="1" step="0.05" value={radioVol} onChange={e => { setRadioVol(parseFloat(e.target.value)); engineRef.current?.setRadioVolume(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 9, fontFamily: 'monospace', color: '#9d8fc0' }}>
                <span>LOW: {Math.round(s.radioBands.low * 100)}%</span>
                <span>MID: {Math.round(s.radioBands.mid * 100)}%</span>
                <span>HIGH: {Math.round(s.radioBands.high * 100)}%</span>
                <span>KICKS: {s.kickCount}</span>
              </div>
            </>
          )}
        </div>

      </main>

      <footer style={{ borderTop: '1px solid rgba(150,90,255,0.15)', padding: '8px 16px', fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between', marginTop: 'auto' }}>
        <span>PSY4 · Musical Device</span>
        <span>{s.radioOn ? '● RADIO' : '○ NO RADIO'} · {s.playing ? '● PLAYING' : '○ IDLE'} · {styleName}</span>
      </footer>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 7, color: '#9d8fc0', textTransform: 'uppercase', fontFamily: 'monospace' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 'bold', fontFamily: 'monospace', color }}>{value}</div>
    </div>
  );
}

function SliderControl({ label, value, onChange, color }: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace' }}>{label}</span>
        <span style={{ fontSize: 9, color, fontFamily: 'monospace' }}>{Math.round(value * 100)}%</span>
      </div>
      <input type="range" min="0" max="1" step="0.01" value={value} onChange={e => onChange(parseFloat(e.target.value))} style={{ width: '100%', accentColor: color }} />
    </div>
  );
}
