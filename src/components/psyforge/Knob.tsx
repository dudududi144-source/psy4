'use client';
// src/components/psyforge/Knob.tsx
// The fundamental synth knob primitive.
// Vertical drag to change value (0..1). Rotation visualized via --r CSS var.
// Mirrors psyforge-pro.html's `.d` element behavior.

import React, { useCallback, useRef } from 'react';

export type KnobAccent = 'ac' | 'mg' | 'or' | 'gr';

interface KnobProps {
  label: string;
  value: number;            // 0..1 normalized
  onChange: (v: number) => void;
  display: string;          // formatted value, e.g. "1.8k", "65%", "40ms"
  accent?: KnobAccent;
  size?: number;             // px (default 40)
}

export function Knob({ label, value, onChange, display, accent = 'ac', size = 40 }: KnobProps) {
  const sy = useRef(0);
  const v0 = useRef(value);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    sy.current = e.clientY;
    v0.current = value;
  }, [value]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.buttons & 1)) return;
    // Drag UP = increase. 120px = full range.
    const dv = (sy.current - e.clientY) / 120;
    const v = Math.max(0, Math.min(1, v0.current + dv));
    onChange(v);
  }, [onChange]);

  // Rotation: -120deg (min) to +120deg (max)
  const rotation = (value * 240 - 120).toFixed(0);

  const accentClass = accent === 'ac' ? '' : ` pf-d ${accent}`;

  return (
    <div className="pf-k">
      <span>{label}</span>
      <div
        className={`pf-d${accentClass}`}
        style={{
          ['--r' as string]: `${rotation}deg`,
          width: `${size}px`,
          height: `${size}px`,
        } as React.CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      />
      <span className="pf-v">{display}</span>
    </div>
  );
}
