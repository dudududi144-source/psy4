'use client';
// src/components/psyforge/SpectrumVisualizer.tsx
// Real-time frequency spectrum bars + waveform overlay.
// Uses requestAnimationFrame (60fps) but reads from analyser (zero-copy).

import React, { useRef, useEffect } from 'react';

interface SpectrumVisualizerProps {
  analyser: AnalyserNode | null;
  height?: number;
}

export function SpectrumVisualizer({ analyser, height = 80 }: SpectrumVisualizerProps) {
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
      // Clear with dark bg
      ctx.fillStyle = '#08051a';
      ctx.fillRect(0, 0, w, h);

      // Draw spectrum bars (logarithmic, 64 bars)
      const numBars = 64;
      const barWidth = w / numBars;
      for (let i = 0; i < numBars; i++) {
        // Log-spaced bar index
        const logIdx = Math.floor(Math.pow(i / numBars, 2) * freq.length);
        const v = freq[logIdx] / 255;
        const barH = v * h * 0.85;
        // Color: green→yellow→red by intensity
        const hue = 120 - v * 120;  // 120=green, 0=red
        ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;
        ctx.fillRect(i * barWidth, h - barH, barWidth - 1, barH);
      }

      // Draw waveform overlay (top half)
      ctx.strokeStyle = 'rgba(184, 242, 46, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const slice = w / td.length;
      for (let i = 0; i < td.length; i++) {
        const v = td[i];
        const y = h * 0.5 + v * h * 0.35;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser]);

  // Resize canvas to match container
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
    <div className="pf-m" style={{ padding: '6px' }}>
      <h4 style={{ marginBottom: '4px' }}>SPECTRUM</h4>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: `${height}px`, display: 'block', borderRadius: '4px' }}
      />
    </div>
  );
}
