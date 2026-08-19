'use client';
// src/components/psyforge/EngineContext.tsx
// Shows the real-time musical context: section, bar position, style, energy.

import React from 'react';
import type { LiveState4 } from '@/lib/psyLive4/psyLive4';

const SECTION_COLORS: Record<string, string> = {
  INTRO: '#8a4dff',
  GROOVE: '#b8f22e',
  DROP: '#ff2e88',
  BREAKDOWN: '#c93df0',
  REBUILD: '#3df08a',
  OUTRO: '#ff9a2a',
};

interface EngineContextProps {
  state: LiveState4;
}

export function EngineContext({ state }: EngineContextProps) {
  const sectionColor = SECTION_COLORS[state.section] ?? '#9a8cc4';
  const energyPct = Math.round(state.energy * 100);

  return (
    <div className="pf-m intel">
      <h4>ENGINE CONTEXT</h4>
      <div className="intel-grid">
        <div className="intel-cell">
          <span className="intel-label">SECTION</span>
          <span className="intel-value" style={{ color: sectionColor }}>{state.section}</span>
        </div>
        <div className="intel-cell">
          <span className="intel-label">BAR</span>
          <span className="intel-value">{state.bar}</span>
        </div>
        <div className="intel-cell">
          <span className="intel-label">CYCLE</span>
          <span className="intel-value">{state.cycle}</span>
        </div>
        <div className="intel-cell">
          <span className="intel-label">BPM</span>
          <span className="intel-value">{state.bpm}</span>
        </div>
        <div className="intel-cell">
          <span className="intel-label">STYLE</span>
          <span className="intel-value" style={{ color: '#c93df0' }}>{state.style.replace('_', '.')}</span>
        </div>
        <div className="intel-cell">
          <span className="intel-label">EVENTS/S</span>
          <span className="intel-value">{state.eventsPerSec}</span>
        </div>
      </div>
      {/* Energy bar */}
      <div className="energy-bar-wrap">
        <span className="intel-label">ENERGY {energyPct}%</span>
        <div className="energy-bar">
          <div className="energy-bar-fill" style={{ width: `${energyPct}%`, background: sectionColor }} />
        </div>
      </div>
    </div>
  );
}
