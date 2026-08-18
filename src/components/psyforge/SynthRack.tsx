'use client';
// src/components/psyforge/SynthRack.tsx
// 3-column synth rack: OSC / FILTER / AMP.
// Each knob maps to a CC number that psysynth understands.

import React from 'react';
import { Knob, type KnobAccent } from './Knob';

interface SynthRackProps {
  // CC values (0..1)
  params: Record<number, number>;
  onParam: (cc: number, value: number) => void;
}

// Helpers to format knob display values
const fmtHz = (v: number) => `${(80 + v * 7920).toFixed(0)}Hz`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtMs = (v: number) => v < 0.1 ? `${Math.round(v * 1000)}ms` : `${(v).toFixed(2)}s`;
const fmtDb = (v: number) => `${(v * 12).toFixed(1)}dB`;

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
          <Param cc={9} label="EnvDep" value={get(9)} onParam={onParam} display={fmtPct(get(9))} accent="mg" />
          <Param cc={13} label="VelTrk" value={get(13)} onParam={onParam} display={fmtPct(get(13))} accent="mg" />
        </div>
      </div>

      {/* ── ENVELOPE ── */}
      <div className="pf-m">
        <h4>ENVELOPE (tight psy)</h4>
        <div className="pf-kn">
          <Param cc={20} label="Atk" value={get(20)} onParam={onParam} display={fmtMs(get(20) * 0.5)} />
          <Param cc={21} label="Dec" value={get(21)} onParam={onParam} display={fmtMs(get(21))} />
          <Param cc={22} label="Sus" value={get(22)} onParam={onParam} display={fmtPct(get(22))} />
          <Param cc={23} label="Rel" value={get(23)} onParam={onParam} display={fmtMs(get(23) * 0.5)} />
        </div>
      </div>
    </div>
  );
}
