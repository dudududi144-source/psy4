'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, MixMode, SyncStatus, STREAMS, PRESETS } from '@/lib/psyLive';

const SYNC_META: Record<SyncStatus, { color: string; label: string; glow: string }> = {
  idle:      { color: '#6b7280', label: 'IDLE',      glow: 'rgba(107,114,128,0.4)' },
  listening: { color: '#f59e0b', label: 'LISTENING', glow: 'rgba(245,158,11,0.6)' },
  following: { color: '#10b981', label: 'FOLLOWING', glow: 'rgba(16,185,129,0.7)' },
  lost:      { color: '#ef4444', label: 'LOST',      glow: 'rgba(239,68,68,0.6)' },
};

const MIX_META: Record<MixMode, { color: string; label: string; desc: string }> = {
  solo:       { color: '#00ffc8', label: 'SOLO',       desc: 'standalone patterns' },
  glue:       { color: '#f59e0b', label: 'GLUE',       desc: 'harmonic lock + duck' },
  reinforce:  { color: '#ff2e88', label: 'REINFORCE',  desc: 'tight kick sync' },
};

export default function Page() {
  const engineRef = useRef<PsyLive | null>(null);
  const [s, setS] = useState<LiveState>({
    playing: false, radioOn: false, radioBpm: 0, engineBpm: 145,
    syncStatus: 'idle', mixMode: 'solo', kickCount: 0, bassNote: '—',
    radioLevel: 0, engineLevel: 0, presetId: 'rolling_bass', variant: 'A',
    learned: null, sidechainActive: false, harmonicLocked: false,
    duckAmount: 0, radioRms: 0, radioBands: { low: 0, mid: 0, high: 0 },
    compositionMode: false, composition: null, deviceId: '',
    activeNodes: 0, maxNodes: 0,
  });
  const [streamId, setStreamId] = useState('psyndora');
  const [radioVol, setRadioVol] = useState(0.5);
  const [vol, setVol] = useState(0.7);
  const [connecting, setConnecting] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const pulseRef = useRef<number>(0);

  const init = useCallback(async () => {
    if (engineRef.current) return;
    const e = new PsyLive();
    e.onState = setS;
    engineRef.current = e;
  }, []);

  const [hasSaved, setHasSaved] = useState(false);

  // Initialize engine immediately on mount (to load learning data + show insights)
  useEffect(() => {
    init().then(() => {
      // Check for saved composition (memory feature) — don't auto-play (browser blocks)
      const engine = engineRef.current;
      if (engine && engine.hasSavedComposition()) {
        setHasSaved(true);
      }
    });
  }, [init]);

  const resumeSaved = useCallback(async () => {
    await init();
    const engine = engineRef.current;
    if (!engine) return;
    engine.play();
    engine.toggleComposition();
    setHasSaved(false);
  }, [init]);

  const play = useCallback(async () => { await init(); engineRef.current?.play(); }, [init]);
  const stop = useCallback(() => engineRef.current?.stop(), []);

  const connectRadio = useCallback(async () => {
    await init();
    const engine = engineRef.current;
    if (!engine) return;
    const stream = engine.getStreams().find(x => x.id === streamId);
    if (!stream) return;
    setConnecting(true);
    setStreamError(null);
    // Timeout safety — if play() never resolves, still update UI
    const ok = await Promise.race([
      engine.connectRadio(stream),
      new Promise<boolean>(r => setTimeout(() => r(true), 3000)),
    ]);
    setConnecting(false);
    if (!ok) setStreamError('Stream unavailable — try another channel');
  }, [streamId, init]);

  const disconnectRadio = useCallback(() => {
    engineRef.current?.disconnectRadio();
    setStreamError(null);
  }, []);

  useEffect(() => () => { engineRef.current?.stop(); engineRef.current?.disconnectRadio(); }, []);

  // ── Radial visualizer ──
  useEffect(() => {
    if (!s.playing && !s.radioOn) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const rAn = engineRef.current?.radioAnalyserNode;
    const eAn = engineRef.current?.analyserNode;
    const rd = rAn ? new Uint8Array(rAn.frequencyBinCount) : null;
    const ed = eAn ? new Uint8Array(eAn.frequencyBinCount) : null;

    const draw = () => {
      const w = c.width = c.offsetWidth * (window.devicePixelRatio || 1);
      const h = c.height = c.offsetHeight * (window.devicePixelRatio || 1);
      const dpr = window.devicePixelRatio || 1;
      ctx.scale(1, 1);
      // fade trail
      ctx.fillStyle = 'rgba(7,3,15,0.18)';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2, cy = h / 2;
      const baseR = Math.min(w, h) * 0.22;
      const bars = 32; // was 48 — less canvas work, still full spectrum

      // pulse decay
      pulseRef.current *= 0.9;

      // Radio ring (outer, amber) — full spectrum, no /1.8 compression
      if (rAn && rd) {
        rAn.getByteFrequencyData(rd);
        for (let i = 0; i < bars; i++) {
          const idx = Math.floor(i * rd.length / bars);
          const v = rd[idx] / 255;
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const r1 = baseR + 12 * dpr;
          const r2 = r1 + v * baseR * 1.4;  // was 1.1 — taller bars
          const x1 = cx + Math.cos(angle) * r1;
          const y1 = cy + Math.sin(angle) * r1;
          const x2 = cx + Math.cos(angle) * r2;
          const y2 = cy + Math.sin(angle) * r2;
          ctx.strokeStyle = `rgba(245,158,11,${0.3 + v * 0.6})`;
          ctx.lineWidth = 2.5 * dpr;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }

      // Engine ring (inner, cyan/magenta) — full spectrum
      if (eAn && ed) {
        eAn.getByteFrequencyData(ed);
        for (let i = 0; i < bars; i++) {
          const idx = Math.floor(i * ed.length / bars);
          const v = ed[idx] / 255;
          const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
          const r1 = baseR - 6 * dpr;
          const r2 = r1 - v * baseR * 0.85;
          const x1 = cx + Math.cos(angle) * r1;
          const y1 = cy + Math.sin(angle) * r1;
          const x2 = cx + Math.cos(angle) * Math.max(8, r2);
          const y2 = cy + Math.sin(angle) * Math.max(8, r2);
          const hue = s.mixMode === 'reinforce' ? 330 : 165;
          ctx.strokeStyle = `hsla(${hue},100%,${55 + v * 25}%,${0.35 + v * 0.55})`;
          ctx.lineWidth = 2.5 * dpr;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }
      }

      // Center glow circle (pulses on kick)
      const pulseR = baseR * 0.55 + pulseRef.current * 20;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
      const syncColor = SYNC_META[s.syncStatus].color;
      grd.addColorStop(0, syncColor + 'cc');
      grd.addColorStop(0.5, syncColor + '33');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(cx, cy, pulseR, 0, Math.PI * 2); ctx.fill();

      // Center ring
      ctx.strokeStyle = syncColor + '80';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, baseR * 0.5, 0, Math.PI * 2); ctx.stroke();

      // Sidechain duck indicator (ring shrinks when ducking)
      const duckR = baseR * 0.5 * (1 - s.duckAmount * 0.35);
      ctx.strokeStyle = `rgba(255,46,136,${0.4 + s.duckAmount * 0.6})`;
      ctx.lineWidth = (2 + s.duckAmount * 4) * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, duckR, 0, Math.PI * 2); ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [s.playing, s.radioOn, s.syncStatus, s.mixMode]);

  // Pulse on kick count change
  useEffect(() => { pulseRef.current = 1; }, [s.kickCount]);

  const streams = STREAMS;
  const presets = PRESETS;
  const syncM = SYNC_META[s.syncStatus];
  const mixM = MIX_META[s.mixMode];

  return (
    <div style={rootStyle}>
      {/* Animated nebula background */}
      <div style={nebulaStyle} />
      <div style={gridStyle} />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
        {/* Header */}
        <header style={headerStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={logoGlowStyle}>
              <span style={{ fontSize: 22, fontWeight: 900, background: 'linear-gradient(110deg,#00ffc8,#b967ff,#ff2e88)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>PSY LIVE</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em' }}>SMART MIX ENGINE</span>
              <span style={{ fontSize: 8, color: mixM.color, fontFamily: 'monospace', letterSpacing: '0.1em' }}>● {mixM.label} — {mixM.desc}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Metric label="ENGINE" value={s.engineBpm} color="#00ffc8" />
            <Metric label="RADIO" value={s.radioBpm || '—'} color="#f59e0b" />
            <Metric label="KICKS" value={s.kickCount} color="#ff2e88" />
            <Metric label="KEY" value={s.bassNote} color="#b967ff" />
            <Metric label="NODES" value={`${s.activeNodes}/${s.maxNodes}`} color="#3dffa8" />
            <div style={{
              padding: '6px 14px', borderRadius: 10, fontSize: 11, fontWeight: 'bold',
              fontFamily: 'monospace', letterSpacing: '0.1em',
              background: syncM.color + '18', color: syncM.color,
              border: `1px solid ${syncM.color}50`,
              boxShadow: `0 0 16px -2px ${syncM.glow}`,
              minWidth: 100, textAlign: 'center',
            }}>{syncM.label}</div>
          </div>
        </header>

        {/* Main */}
        <main style={{ flex: 1, maxWidth: 1100, width: '100%', margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Top row: Transport + Visualizer */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) 1fr', gap: 16 }}>
            {/* Transport panel */}
            <div style={glassPanelStyle}>
              <div style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em', marginBottom: 12 }}>TRANSPORT</div>
              {hasSaved && !s.playing && (
                <button onClick={resumeSaved} style={{ ...primaryBtn('#3dffa8'), width: '100%', marginBottom: 10, padding: '12px 16px', fontSize: 13, boxShadow: '0 0 24px -4px #3dffa8' }}>
                  ↻ RESUME LAST SESSION
                </button>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
                {!s.playing ? (
                  <button onClick={play} style={primaryBtn('#00ffc8')}>▶ START</button>
                ) : (
                  <button onClick={stop} style={primaryBtn('#ff4d6d')}>■ STOP</button>
                )}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="0" max="1" step="0.05" value={vol} onChange={e => { setVol(parseFloat(e.target.value)); engineRef.current?.setVolume(parseFloat(e.target.value)); }} style={sliderStyle} />
                  <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace', minWidth: 28 }}>{Math.round(vol * 100)}%</span>
                </div>
              </div>
              {/* A/B variant */}
              <div style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: 6 }}>VARIANT</div>
              <div style={{ display: 'flex', border: '1px solid rgba(150,90,255,0.25)', borderRadius: 10, overflow: 'hidden' }}>
                {(['A', 'B'] as const).map(v => (
                  <button key={v} onClick={() => engineRef.current?.setVariant(v)} style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                    fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14,
                    background: s.variant === v ? (v === 'A' ? 'rgba(0,255,200,0.15)' : 'rgba(255,46,136,0.15)') : 'transparent',
                    color: s.variant === v ? (v === 'A' ? '#00ffc8' : '#ff2e88') : '#9d8fc0',
                    boxShadow: s.variant === v ? `inset 0 0 16px -4px ${v === 'A' ? '#00ffc8' : '#ff2e88'}` : 'none',
                    transition: 'all 0.2s',
                  }}>{v}</button>
                ))}
              </div>
            </div>

            {/* Radial visualizer */}
            <div style={{ ...glassPanelStyle, padding: 0, overflow: 'hidden', minHeight: 240, position: 'relative' }}>
              <div style={{ position: 'absolute', top: 12, left: 16, fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em', zIndex: 2 }}>SPECTRUM</div>
              <div style={{ position: 'absolute', top: 12, right: 16, display: 'flex', gap: 12, fontSize: 8, fontFamily: 'monospace', zIndex: 2 }}>
                <span style={{ color: '#f59e0b' }}>● RADIO</span>
                <span style={{ color: s.mixMode === 'reinforce' ? '#ff2e88' : '#00ffc8' }}>● ENGINE</span>
              </div>
              {(s.playing || s.radioOn) ? (
                <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#5d4f80', fontFamily: 'monospace', fontSize: 11 }}>
                  press START or CONNECT RADIO
                </div>
              )}
            </div>
          </div>

          {/* Smart Mix Panel */}
          <div style={glassPanelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em' }}>SMART MIX</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: mixM.color, padding: '2px 8px', borderRadius: 6, border: `1px solid ${mixM.color}40`, background: mixM.color + '15' }}>{mixM.label}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              {/* Sidechain duck */}
              <SmartMetric label="SIDECHAIN" value={Math.round((1 - s.duckAmount) * 100) + '%'} color="#ff2e88" active={s.sidechainActive}>
                <DuckBar amount={s.duckAmount} />
              </SmartMetric>
              {/* Harmonic lock */}
              <SmartMetric label="HARMONIC" value={s.harmonicLocked ? s.bassNote : '—'} color="#b967ff" active={s.harmonicLocked}>
                <div style={{ fontSize: 8, color: s.harmonicLocked ? '#3dffa8' : '#5d4f80', fontFamily: 'monospace' }}>
                  {s.harmonicLocked ? '◉ LOCKED to radio key' : '○ searching...'}
                </div>
              </SmartMetric>
              {/* Auto level */}
              <SmartMetric label="AUTO LEVEL" value={Math.round(s.engineLevel * 100) + '%'} color="#00ffc8" active={s.radioOn}>
                <MiniBar value={s.engineLevel} color="#00ffc8" />
              </SmartMetric>
              {/* Radio RMS */}
              <SmartMetric label="RADIO RMS" value={Math.round(s.radioRms * 100) + '%'} color="#f59e0b" active={s.radioOn}>
                <MiniBar value={s.radioRms} color="#f59e0b" />
              </SmartMetric>
            </div>
            {/* Spectral bands */}
            <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <BandMeter label="LOW" value={s.radioBands.low} color="#ff2e88" />
              <BandMeter label="MID" value={s.radioBands.mid} color="#f59e0b" />
              <BandMeter label="HIGH" value={s.radioBands.high} color="#00ffc8" />
            </div>
          </div>

          {/* Radio channels */}
          <div style={glassPanelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em' }}>RADIO CHANNELS</span>
              {s.radioOn && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="0" max="1" step="0.05" value={radioVol} onChange={e => { setRadioVol(parseFloat(e.target.value)); engineRef.current?.setRadioVolume(parseFloat(e.target.value)); }} style={{ ...sliderStyle, width: 80 }} />
                  <span style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', minWidth: 28 }}>{Math.round(radioVol * 100)}%</span>
                  <button onClick={disconnectRadio} style={smallBtn('#ff4d6d')}>DISCONNECT</button>
                </div>
              )}
            </div>
            {streamError && (
              <div style={{ marginBottom: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, fontSize: 11, color: '#fca5a5', fontFamily: 'monospace' }}>⚠ {streamError}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, maxHeight: 280, overflowY: 'auto' }} className="psy-scroll">
              {streams.map(st => {
                const active = s.radioOn && streamId === st.id;
                return (
                  <button key={st.id} onClick={() => { if (!s.radioOn) setStreamId(st.id); }} disabled={s.radioOn} style={{
                    padding: 12, borderRadius: 10, cursor: s.radioOn ? 'default' : 'pointer', textAlign: 'left',
                    background: active ? 'rgba(245,158,11,0.12)' : 'rgba(20,10,40,0.4)',
                    border: active ? '1px solid rgba(245,158,11,0.5)' : '1px solid rgba(150,90,255,0.12)',
                    boxShadow: active ? '0 0 20px -4px rgba(245,158,11,0.4)' : 'none',
                    opacity: s.radioOn && !active ? 0.4 : 1,
                    transition: 'all 0.2s',
                    position: 'relative',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 'bold', fontSize: 12, color: active ? '#f59e0b' : '#efe9fb' }}>{st.name}</span>
                      {active && <span style={{ fontSize: 8, color: '#10b981', fontFamily: 'monospace' }}>● LIVE</span>}
                    </div>
                    <div style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', lineHeight: 1.3 }}>{st.genre}</div>
                    <div style={{ fontSize: 8, color: '#5d4f80', fontFamily: 'monospace', marginTop: 4 }}>{st.bitrate} kbps</div>
                  </button>
                );
              })}
            </div>
            {!s.radioOn && (
              <button onClick={connectRadio} disabled={connecting} style={{ ...primaryBtn('#f59e0b'), marginTop: 12, width: '100%', opacity: connecting ? 0.6 : 1 }}>
                {connecting ? '◌ CONNECTING...' : `▶ CONNECT ${streams.find(x => x.id === streamId)?.name?.toUpperCase() ?? ''}`}
              </button>
            )}
          </div>

          {/* Presets */}
          <div style={glassPanelStyle}>
            <div style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em', marginBottom: 12 }}>PRESETS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {presets.map(p => (
                <button key={p.id} onClick={() => engineRef.current?.setPreset(p.id)} style={{
                  padding: 14, borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  background: s.presetId === p.id ? 'rgba(0,255,200,0.08)' : 'rgba(20,10,40,0.4)',
                  border: s.presetId === p.id ? '1px solid rgba(0,255,200,0.4)' : '1px solid rgba(150,90,255,0.12)',
                  boxShadow: s.presetId === p.id ? '0 0 20px -4px rgba(0,255,200,0.3)' : 'none',
                  transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 'bold', fontSize: 13, color: s.presetId === p.id ? '#00ffc8' : '#efe9fb' }}>{p.name}</span>
                    <span style={{ fontSize: 9, color: '#ff2e88', fontFamily: 'monospace', textTransform: 'uppercase' }}>{p.tag}</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#9d8fc0', marginTop: 4, fontFamily: 'monospace' }}>{p.bpm} BPM · {p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* INSIGHTS — learned data panel */}
          {s.learned && (
            <div style={{ ...glassPanelStyle, background: 'rgba(61,255,168,0.04)', borderColor: 'rgba(61,255,168,0.18)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontSize: 9, color: '#3dffa8', fontFamily: 'monospace', letterSpacing: '0.15em' }}>INSIGHTS — learned from listening</span>
                <span style={{ fontSize: 8, color: '#5d4f80', fontFamily: 'monospace' }}>
                  {s.learned.totalKicks} kicks · {s.learned.sessions} sessions
                </span>
              </div>

              {/* Scale + Tempo + Composition */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
                {/* Detected Scale */}
                <div style={{ padding: 12, borderRadius: 10, background: 'rgba(7,3,15,0.5)', border: '1px solid rgba(185,103,255,0.25)' }}>
                  <div style={{ fontSize: 7, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: 6 }}>DETECTED SCALE</div>
                  {s.learned.scale ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace', color: '#b967ff', textShadow: '0 0 12px rgba(185,103,255,0.6)' }}>
                        {scaleName(s.learned.scale.root)} {s.learned.scale.name}
                      </div>
                      <div style={{ fontSize: 9, color: '#3dffa8', fontFamily: 'monospace', marginTop: 4 }}>
                        {Math.round(s.learned.scale.matchScore * 100)}% match
                      </div>
                      <div style={{ marginTop: 6, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {s.learned.scale.intervals.map((iv, i) => (
                          <span key={i} style={{ fontSize: 8, padding: '2px 5px', background: 'rgba(185,103,255,0.15)', borderRadius: 4, color: '#c4b5fd', fontFamily: 'monospace' }}>
                            {scaleName((s.learned!.scale!.root + iv) % 12)}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: '#5d4f80', fontFamily: 'monospace' }}>listening... need more data</div>
                  )}
                </div>

                {/* Tempo Stability */}
                <div style={{ padding: 12, borderRadius: 10, background: 'rgba(7,3,15,0.5)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  <div style={{ fontSize: 7, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: 6 }}>TEMPO STABILITY</div>
                  {s.learned.tempo && s.learned.tempo.stable > 0 ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 'bold', fontFamily: 'monospace', color: '#f59e0b', textShadow: '0 0 12px rgba(245,158,11,0.6)' }}>
                        {s.learned.tempo.stable} BPM
                      </div>
                      <div style={{ fontSize: 9, color: '#9d8fc0', fontFamily: 'monospace', marginTop: 4 }}>
                        σ={s.learned.tempo.stddev} · {Math.round(s.learned.tempo.confidence * 100)}% conf
                      </div>
                      <div style={{ marginTop: 6, height: 4, background: 'rgba(245,158,11,0.15)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: (s.learned.tempo.confidence * 100) + '%', background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', transition: 'width 0.3s' }} />
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: '#5d4f80', fontFamily: 'monospace' }}>no tempo data yet</div>
                  )}
                </div>

                {/* Top votes */}
                <div style={{ padding: 12, borderRadius: 10, background: 'rgba(7,3,15,0.5)', border: '1px solid rgba(0,255,200,0.25)' }}>
                  <div style={{ fontSize: 7, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: 6 }}>TOP DETECTIONS</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>BPM</span>
                    <span style={{ fontSize: 11, color: '#00ffc8', fontFamily: 'monospace', fontWeight: 'bold' }}>{s.learned.topBpm} ({s.learned.topBpmCount})</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>Key</span>
                    <span style={{ fontSize: 11, color: '#b967ff', fontFamily: 'monospace', fontWeight: 'bold' }}>{s.learned.topKey} ({s.learned.topKeyCount})</span>
                  </div>
                  {s.learned.radioProfile && s.learned.radioProfile.samples > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace' }}>Profile</span>
                      <span style={{ fontSize: 10, color: '#ff2e88', fontFamily: 'monospace' }}>
                        L{Math.round(s.learned.radioProfile.lowAvg * 100)}/M{Math.round(s.learned.radioProfile.midAvg * 100)}/H{Math.round(s.learned.radioProfile.highAvg * 100)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Original Composition */}
              <div style={{ padding: 12, borderRadius: 10, background: s.compositionMode ? 'rgba(255,46,136,0.08)' : 'rgba(7,3,15,0.5)', border: s.compositionMode ? '1px solid rgba(255,46,136,0.4)' : '1px solid rgba(150,90,255,0.15)', transition: 'all 0.2s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 9, color: s.compositionMode ? '#ff2e88' : '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.15em' }}>ORIGINAL COMPOSITION</span>
                    {s.composition && (
                      <div style={{ fontSize: 10, color: '#9d8fc0', fontFamily: 'monospace', marginTop: 2 }}>
                        {s.composition.scaleName} · {s.composition.bpm} BPM · root {scaleName(s.composition.rootPc)}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => engineRef.current?.toggleComposition()}
                    disabled={!s.learned.scale || !s.learned.tempo?.stable}
                    style={{
                      padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontFamily: 'monospace', fontWeight: 'bold', fontSize: 11,
                      background: s.compositionMode ? '#ff2e88' : (s.learned.scale && s.learned.tempo?.stable ? '#3dffa8' : '#2a1f4a'),
                      color: s.compositionMode ? '#fff' : (s.learned.scale && s.learned.tempo?.stable ? '#000' : '#5d4f80'),
                      boxShadow: s.compositionMode ? '0 0 20px -4px #ff2e88' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    {s.compositionMode ? '■ STOP ORIGINAL' : '▶ PLAY ORIGINAL'}
                  </button>
                </div>
                {s.composition && s.composition.reasoning.length > 0 && (
                  <div style={{ fontSize: 9, color: '#5d4f80', fontFamily: 'monospace', lineHeight: 1.5 }}>
                    {s.composition.reasoning.map((r, i) => (<div key={i}>· {r}</div>))}
                  </div>
                )}
                {!s.learned.scale && (
                  <div style={{ fontSize: 9, color: '#5d4f80', fontFamily: 'monospace' }}>
                    Connect radio and let it listen to collect scale data, then generate original music in the detected scale.
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, fontSize: 8, color: '#5d4f80', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between' }}>
                <span>device: {s.deviceId || '—'}</span>
                <span>synced to Turso every 60s</span>
              </div>
            </div>
          )}
        </main>

        {/* Footer (sticky) */}
        <footer style={footerStyle}>
          <span>PSY LIVE · Web Audio · Smart Mix</span>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ color: s.radioOn ? '#f59e0b' : '#5d4f80' }}>{s.radioOn ? '● RADIO ON' : '○ NO RADIO'}</span>
            <span style={{ color: s.playing ? '#00ffc8' : '#5d4f80' }}>{s.playing ? '● ENGINE' : '○ IDLE'}</span>
            <span style={{ color: mixM.color }}>{mixM.label}</span>
          </span>
        </footer>
      </div>

      <style>{globalStyle}</style>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function scaleName(pc: number): string { return NOTE_NAMES[((pc % 12) + 12) % 12]; }

function Metric({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 44 }}>
      <div style={{ fontSize: 7, color: '#9d8fc0', textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 'bold', fontFamily: 'monospace', color, textShadow: `0 0 12px ${color}80` }}>{value}</div>
    </div>
  );
}

function SmartMetric({ label, value, color, active, children }: { label: string; value: any; color: string; active: boolean; children?: React.ReactNode }) {
  return (
    <div style={{ padding: 10, borderRadius: 8, background: 'rgba(7,3,15,0.5)', border: `1px solid ${active ? color + '40' : 'rgba(150,90,255,0.1)'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 7, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ fontSize: 8, color: active ? '#3dffa8' : '#5d4f80', fontFamily: 'monospace' }}>{active ? '●' : '○'}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 'bold', fontFamily: 'monospace', color, textShadow: `0 0 10px ${color}60`, marginBottom: 6 }}>{value}</div>
      {children}
    </div>
  );
}

function DuckBar({ amount }: { amount: number }) {
  // amount = 1 right after kick (ducked), decays to 0
  const pct = (1 - amount) * 100;
  return (
    <div style={{ height: 4, background: 'rgba(255,46,136,0.15)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: pct + '%', background: 'linear-gradient(90deg,#ff2e88,#b967ff)', transition: 'width 0.05s', boxShadow: '0 0 8px #ff2e88' }} />
    </div>
  );
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 4, background: color + '20', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: Math.min(100, value * 140) + '%', background: color, transition: 'width 0.1s', boxShadow: `0 0 6px ${color}` }} />
    </div>
  );
}

function BandMeter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 7, color: '#9d8fc0', fontFamily: 'monospace', letterSpacing: '0.1em' }}>{label}</span>
        <span style={{ fontSize: 7, color, fontFamily: 'monospace' }}>{Math.round(value * 100)}%</span>
      </div>
      <div style={{ height: 6, background: color + '15', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: Math.min(100, value * 120) + '%', background: `linear-gradient(90deg,${color}80,${color})`, transition: 'width 0.1s', boxShadow: `0 0 8px ${color}80` }} />
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const rootStyle: React.CSSProperties = {
  minHeight: '100dvh', background: '#07030f', color: '#efe9fb',
  fontFamily: 'system-ui, -apple-system, sans-serif', position: 'relative',
};

const nebulaStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none',
  background: `
    radial-gradient(ellipse 60% 50% at 20% 30%, rgba(185,103,255,0.18), transparent 60%),
    radial-gradient(ellipse 50% 40% at 80% 20%, rgba(0,255,200,0.12), transparent 60%),
    radial-gradient(ellipse 70% 60% at 60% 80%, rgba(255,46,136,0.14), transparent 60%),
    radial-gradient(ellipse 40% 30% at 30% 70%, rgba(245,158,11,0.08), transparent 60%)
  `,
  animation: 'nebula-shift 18s ease-in-out infinite alternate',
};

const gridStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', opacity: 0.04,
  backgroundImage: `linear-gradient(rgba(185,103,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(185,103,255,1) 1px, transparent 1px)`,
  backgroundSize: '48px 48px',
};

const glassPanelStyle: React.CSSProperties = {
  background: 'rgba(15,8,30,0.55)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(150,90,255,0.15)', borderRadius: 14, padding: 16,
  boxShadow: '0 4px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)',
};

const headerStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(150,90,255,0.15)', padding: '14px 20px',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  background: 'rgba(7,3,15,0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  position: 'sticky', top: 0, zIndex: 10,
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid rgba(150,90,255,0.15)', padding: '10px 20px', fontSize: 10,
  color: '#9d8fc0', fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between',
  background: 'rgba(7,3,15,0.7)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
  marginTop: 'auto', flexWrap: 'wrap', gap: 8,
};

const logoGlowStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 10,
  background: 'rgba(15,8,30,0.6)', border: '1px solid rgba(150,90,255,0.2)',
  boxShadow: '0 0 24px -4px rgba(185,103,255,0.4)',
};

const primaryBtn = (color: string): React.CSSProperties => ({
  padding: '10px 18px', borderRadius: 10, border: 'none', background: color, color: '#000',
  fontWeight: 'bold', cursor: 'pointer', fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.05em',
  boxShadow: `0 0 20px -4px ${color}, 0 2px 8px rgba(0,0,0,0.4)`, transition: 'all 0.15s',
});

const smallBtn = (color: string): React.CSSProperties => ({
  padding: '6px 12px', borderRadius: 8, border: 'none', background: color, color: '#000',
  fontWeight: 'bold', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace',
  boxShadow: `0 0 12px -4px ${color}`,
});

const sliderStyle: React.CSSProperties = {
  flex: 1, height: 4, appearance: 'none', WebkitAppearance: 'none',
  background: 'rgba(150,90,255,0.2)', borderRadius: 2, outline: 'none', cursor: 'pointer',
};

const globalStyle = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes nebula-shift {
    0% { transform: translate(0,0) scale(1); }
    50% { transform: translate(2%,-1%) scale(1.05); }
    100% { transform: translate(-1%,2%) scale(1); }
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 14px; height: 14px; border-radius: 50%;
    background: linear-gradient(135deg,#00ffc8,#b967ff);
    cursor: pointer; box-shadow: 0 0 12px rgba(185,103,255,0.6);
    border: none;
  }
  input[type="range"]::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%;
    background: linear-gradient(135deg,#00ffc8,#b967ff);
    cursor: pointer; box-shadow: 0 0 12px rgba(185,103,255,0.6);
    border: none;
  }
  button:hover { filter: brightness(1.15); }
  button:active { transform: scale(0.98); }
  @media (max-width: 700px) {
    .grid-2 { grid-template-columns: 1fr !important; }
  }
`;
