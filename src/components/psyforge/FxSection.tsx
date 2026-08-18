'use client';
// src/components/psyforge/FxSection.tsx
// FX knobs: Drive, Delay, Reverb, DelayFb, Volume.

import React from 'react';
import { Knob } from './Knob';

interface FxSectionProps {
  drive: number;
  onDrive: (v: number) => void;
  delay: number;
  onDelay: (v: number) => void;
  reverb: number;
  onReverb: (v: number) => void;
  volume: number;
  onVolume: (v: number) => void;
}

export function FxSection({ drive, onDrive, delay, onDelay, reverb, onReverb, volume, onVolume }: FxSectionProps) {
  return (
    <div className="pf-m">
      <h4>FX (tempo-sync)</h4>
      <div className="pf-kn">
        <Knob label="Drive" value={drive} onChange={onDrive} display={`${Math.round(drive * 100)}%`} />
        <Knob label="Dly .8" value={delay} onChange={onDelay} display={`${Math.round(delay * 100)}%`} accent="mg" />
        <Knob label="Reverb" value={reverb} onChange={onReverb} display={`${Math.round(reverb * 100)}%`} />
        <Knob label="Volume" value={volume} onChange={onVolume} display={`${Math.round(volume * 100)}%`} />
      </div>
    </div>
  );
}
