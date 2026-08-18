'use client';
// src/components/psyforge/StatusStrip.tsx
// Single-line status: BPM, style, voices, peak, scheduler health.

import React from 'react';
import type { LiveState4 } from '@/lib/psyLive4/psyLive4';

interface StatusStripProps {
  state: LiveState4;
  arpOn: boolean;
  seqOn: boolean;
}

export function StatusStrip({ state, arpOn, seqOn }: StatusStripProps) {
  const peakOk = state.peakDb > -40 && state.peakDb < -0.3;
  const schedOk = state.schedulerStaleMs < 200;
  const ctxOk = state.ctxState === 'running';
  const peakStr = state.peakDb === -Infinity ? '-∞' : state.peakDb.toFixed(1);
  const rmsStr = state.rmsDb === -Infinity ? '-∞' : state.rmsDb.toFixed(1);

  // When not playing, show minimal status
  if (!state.playing) {
    return (
      <div className="pf-stt" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: 'var(--pf-dm)' }}><span className="pf-dot" /> READY</span>
        <span style={{ color: 'var(--pf-dm)' }}>{state.bpm} BPM</span>
        <span style={{ color: 'var(--pf-dm)' }}>{state.style.replace('_', '.')}</span>
        <span style={{ color: 'var(--pf-dm)' }}>Press POWER to start</span>
      </div>
    );
  }

  return (
    <div className="pf-stt" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ color: ctxOk ? 'var(--pf-gr)' : 'var(--pf-or)' }}><span className={`pf-dot ${ctxOk ? 'on' : ''}`} /> {state.ctxState.toUpperCase()}</span>
      <span style={{ color: 'var(--pf-tx)', fontWeight: 600 }}>{state.bpm} BPM</span>
      <span style={{ color: 'var(--pf-mg)' }}>{state.style.replace('_', '.')}</span>
      <span style={{ color: 'var(--pf-dm)' }}>{state.voicesActive} voices</span>
      <span style={{ color: peakOk ? 'var(--pf-gr)' : 'var(--pf-or)' }}>peak {peakStr}dB</span>
      <span style={{ color: 'var(--pf-dm)' }}>rms {rmsStr}dB</span>
      <span style={{ color: 'var(--pf-dm)' }}>bar {state.bar}</span>
      {arpOn && <span style={{ color: 'var(--pf-gr)' }}>ARP</span>}
      {seqOn && <span style={{ color: 'var(--pf-gr)' }}>SEQ</span>}
      {state.smartRadioOn && <span style={{ color: 'var(--pf-ac)' }}>RADIO</span>}
      {state.learningOn && <span style={{ color: 'var(--pf-ac)' }}>LEARN</span>}
      {state.suspended && <span style={{ color: 'var(--pf-or)' }}>SUSPENDED</span>}
    </div>
  );
}
