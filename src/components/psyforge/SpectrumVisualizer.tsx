'use client';
// src/components/psyforge/SpectrumVisualizer.tsx
// Real-time frequency spectrum bars + waveform overlay + frequency axis labels.
// Uses requestAnimationFrame (60fps) but reads from analyser (zero-copy).

import React, { useRef, useEffect } from 'react';

interface SpectrumVisualizerProps {
  analyser: AnalyserNode | null;
  height?: number;
}

export function SpectrumVisualizer({ analyser, height = 90 }: SpectrumVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const freqBufRef = useRef<Uint8Array | null>(null);
  const tdBufRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    if (!analyser) return;
    freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);
    tdBufRef.current = new Float32Array(analyser.fftSize);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const freq = freqBufRef.current!;
      const td = tdBufRef.current!;
      analyser.getByteFrequencyData(freq as Uint8Array<ArrayBuffer>);
      analyser.getFloatTimeDomainData(td as Float32Array<ArrayBuffer>);

      const w = canvas.width;
      const h = canvas.height;
      const axisH = 14;  // space for frequency labels at bottom
      const specH = h - axisH;

      // Clear with dark bg
      ctx.fillStyle = '#050310';
      ctx.fillRect(0, 0, w, h);

      // Draw subtle grid lines (dB scale)
      ctx.strokeStyle = 'rgba(60, 40, 100, 0.15)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const y = (specH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Detect silence (power OFF or engine suspended) — if the analyser
      // gives us basically zeros, show an idle pattern instead of an
      // empty canvas. This prevents the spectrum area from looking like
      // a dead zone.
      let signalEnergy = 0;
      for (let i = 0; i < 32; i++) signalEnergy += freq[i];
      const isIdle = signalEnergy < 8;

      // Draw spectrum bars (64 bars, linear-spaced for even display)
      const numBars = 64;
      const barWidth = w / numBars;
      for (let i = 0; i < numBars; i++) {
        let v: number;
        if (isIdle) {
          // Idle pattern: animated sine wave — slow, calm, clearly "off"
          const t = performance.now() / 1000;
          const wave = (Math.sin(i * 0.4 + t * 0.8) + 1) / 2;       // 0..1
          const decay = 1 - (i / numBars) * 0.55;                    // taper to right
          v = wave * decay * 0.32;                                   // stay low + calm
        } else {
          // Linear mapping — shows full frequency range evenly
          const idx = Math.floor((i / numBars) * freq.length * 0.7);  // 0-70% of bins (skip ultra-high silence)
          v = freq[idx] / 255;
        }
        const barH = v * specH * 0.9;
        const hue = isIdle ? 270 : (120 - v * 120);  // idle = magenta-tinted, live = green→red
        ctx.fillStyle = `hsl(${hue}, ${isIdle ? '45' : '75'}%, ${isIdle ? '40' : '50'}%)`;
        ctx.fillRect(i * barWidth, specH - barH, barWidth - 1, barH);
      }

      // Draw waveform overlay (center line) — idle shows flat line, live shows wave
      ctx.strokeStyle = isIdle ? 'rgba(217, 61, 240, 0.25)' : 'rgba(184, 242, 46, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const slice = w / td.length;
      for (let i = 0; i < td.length; i++) {
        const v = isIdle ? 0 : td[i];
        const y = specH * 0.5 + v * specH * 0.35;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();

      // Idle badge — clear "POWER OFF" hint so the dead zone has a meaning
      if (isIdle) {
        ctx.fillStyle = 'rgba(184, 168, 216, 0.5)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('— POWER OFF · press POWER to start —', w / 2, specH * 0.5 + 4);
        ctx.textAlign = 'left';
      }

      // Draw frequency axis labels at bottom
      ctx.fillStyle = 'rgba(154, 140, 196, 0.5)';
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'left';
      const labels = ['100', '500', '1k', '2k', '5k', '10k'];
      const positions = [0.08, 0.22, 0.35, 0.5, 0.72, 0.92];
      for (let i = 0; i < labels.length; i++) {
        const x = positions[i] * w;
        ctx.fillText(labels[i] + 'Hz', x, h - 3);
      }

      // Draw baseline
      ctx.strokeStyle = 'rgba(60, 40, 100, 0.3)';
      ctx.beginPath();
      ctx.moveTo(0, specH);
      ctx.lineTo(w, specH);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = height;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [height]);

  return (
    <div className="pf-m" style={{ padding: '8px 12px' }}>
      <h4 style={{ marginBottom: '6px', paddingBottom: '4px' }}>SPECTRUM</h4>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px`, display: 'block', borderRadius: '4px' }}
      />
    </div>
  );
}
