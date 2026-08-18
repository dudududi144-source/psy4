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

  return (
    <div className="pf-stt" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ color: ctxOk ? 'var(--pf-gr)' : 'var(--pf-or)' }}>
        {state.ctxState.toUpperCase()}
      </span>
      <span>{state.bpm} BPM</span>
      <span style={{ color: 'var(--pf-mg)' }}>{state.style.replace('_', '.')}</span>
      <span>{state.voicesActive} voices</span>
      <span style={{ color: peakOk ? 'var(--pf-gr)' : 'var(--pf-or)' }}>peak {peakStr}dB</span>
      <span>rms {rmsStr}dB</span>
      <span style={{ color: schedOk ? 'var(--pf-dm)' : 'var(--pf-or)' }}>sched {state.schedulerStaleMs}ms</span>
      <span>bar {state.bar}</span>
      <span>{state.kickCount} kicks</span>
      <span style={{ color: 'var(--pf-dm)' }}>{arpOn ? 'ARP' : ''} {seqOn ? 'SEQ' : ''}</span>
      {state.suspended && <span style={{ color: 'var(--pf-or)' }}>SUSPENDED</span>}
    </div>
  );
}
