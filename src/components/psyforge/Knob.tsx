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

  // Keyboard support: arrow up/down = ±5%, left/right = ±1%
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    let delta = 0;
    switch (e.key) {
      case 'ArrowUp': delta = 0.05; break;
      case 'ArrowDown': delta = -0.05; break;
      case 'ArrowRight': delta = 0.01; break;
      case 'ArrowLeft': delta = -0.01; break;
      case 'Home': onChange(0); e.preventDefault(); return;
      case 'End': onChange(1); e.preventDefault(); return;
      default: return;
    }
    e.preventDefault();
    onChange(Math.max(0, Math.min(1, value + delta)));
  }, [value, onChange]);

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
        onKeyDown={onKeyDown}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={display}
      />
      <span className="pf-v">{display}</span>
    </div>
  );
}
