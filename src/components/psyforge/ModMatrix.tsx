'use client';
// src/components/psyforge/ModMatrix.tsx
// Static LED list of routings + LFO knobs.

import React from 'react';
import { Knob } from './Knob';

interface ModMatrixProps {
  lfoAmt: number;
  onLfoAmt: (v: number) => void;
  lfoRate: number;
  onLfoRate: (v: number) => void;
}

export function ModMatrix({ lfoAmt, onLfoAmt, lfoRate, onLfoRate }: ModMatrixProps) {
  return (
    <div className="pf-m">
      <h4>MOD MATRIX (live)</h4>
      <div className="pf-ledrow">Vel → Cutoff <div className="pf-led on" /></div>
      <div className="pf-ledrow">LFO(sync) → Pitch <div className="pf-led on" /></div>
      <div className="pf-ledrow">ModWheel → LFO amt <div className="pf-led on" /></div>
      <div className="pf-kn" style={{ marginTop: '6px' }}>
        <Knob label="LFO" value={lfoAmt} onChange={onLfoAmt} display={`${Math.round(lfoAmt * 100)}%`} />
        <Knob label="LFOrate" value={lfoRate} onChange={onLfoRate} display={`${(0.1 + lfoRate * 8).toFixed(1)}Hz`} />
      </div>
    </div>
  );
}
