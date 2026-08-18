'use client';
// src/components/psyforge/SynthRack.tsx
// 3-column synth rack: OSC / FILTER / AMP.
// HONEST FIX: only show knobs that psysynth actually maps.
// psysynth CC map: 74=cutoff, 71=resonance, 5=glide, 12=energyMacro, 14=delaySend, 15=reverbSend.
// Removed dead knobs: CC9, CC13, CC20-23 (Atk/Dec/Sus/Rel/EnvDep/VelTrk) — psysynth ignores them.

import React from 'react';
import { Knob, type KnobAccent } from './Knob';

interface SynthRackProps {
  params: Record<number, number>;
  onParam: (cc: number, value: number) => void;
}

const fmtHz = (v: number) => `${(80 + v * 7920).toFixed(0)}Hz`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;

function Param({ cc, label, value, onParam, display, accent }: {
  cc: number; label: string; value: number;
  onParam: (cc: number, v: number) => void; display: string; accent?: KnobAccent;
}) {
  return (
    <Knob
      label={label}
      value={value}
      onChange={(v) => onParam(cc, v)}
      display={display}
      accent={accent}
    />
  );
}

export function SynthRack({ params, onParam }: SynthRackProps) {
  const get = (cc: number) => params[cc] ?? 0.5;
  return (
    <div className="pf-g3">
      {/* ── OSC + ROLLING BASS ── */}
      <div className="pf-m">
        <h4>OSC + ROLLING BASS</h4>
        <div className="pf-kn">
          <Param cc={74} label="Cutoff" value={get(74)} onParam={onParam} display={fmtHz(get(74))} />
          <Param cc={5} label="Glide" value={get(5)} onParam={onParam} display={`${Math.round(get(5) * 200)}ms`} />
          <Param cc={12} label="Energy" value={get(12)} onParam={onParam} display={fmtPct(get(12))} />
          <Param cc={14} label="DlySend" value={get(14)} onParam={onParam} display={fmtPct(get(14))} accent="mg" />
          <Param cc={15} label="RevSend" value={get(15)} onParam={onParam} display={fmtPct(get(15))} />
        </div>
      </div>

      {/* ── ACID FILTER 303 ── */}
      <div className="pf-m fl">
        <h4>ACID FILTER 303</h4>
        <div className="pf-kn">
          <Param cc={74} label="Cutoff" value={get(74)} onParam={onParam} display={fmtHz(get(74))} accent="mg" />
          <Param cc={71} label="Reso" value={get(71)} onParam={onParam} display={fmtPct(get(71))} accent="mg" />
          <Param cc={5} label="Glide" value={get(5)} onParam={onParam} display={`${Math.round(get(5) * 200)}ms`} accent="mg" />
          <Param cc={12} label="Energy" value={get(12)} onParam={onParam} display={fmtPct(get(12))} accent="mg" />
        </div>
      </div>

      {/* ── FX SENDS ── */}
      <div className="pf-m">
        <h4>FX SENDS</h4>
        <div className="pf-kn">
          <Param cc={14} label="Delay" value={get(14)} onParam={onParam} display={fmtPct(get(14))} accent="mg" />
          <Param cc={15} label="Reverb" value={get(15)} onParam={onParam} display={fmtPct(get(15))} />
          <Param cc={71} label="Reso" value={get(71)} onParam={onParam} display={fmtPct(get(71))} />
          <Param cc={74} label="Cutoff" value={get(74)} onParam={onParam} display={fmtHz(get(74))} />
        </div>
      </div>
    </div>
  );
}
