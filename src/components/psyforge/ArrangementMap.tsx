'use client';
// src/components/psyforge/ArrangementMap.tsx
// 64-bar timeline visualization with section colors + current position marker.

import React from 'react';

interface ArrangementMapProps {
  bar: number;              // absolute bar
  barInCycle: number;       // 0..63
}

// Same section logic as composer.ts getSection()
function getSection(bar: number): string {
  const p = bar % 64;
  const cycle = Math.floor(bar / 64);
  if (cycle === 0) {
    if (p < 8) return 'INTRO';
    if (p < 16) return 'GROOVE';
    if (p < 24) return 'DROP';
    if (p < 28) return 'BREAKDOWN';
    if (p < 32) return 'REBUILD';
    if (p < 40) return 'DROP';
    if (p < 44) return 'BREAKDOWN';
    if (p < 52) return 'REBUILD';
    if (p < 60) return 'DROP';
    return 'OUTRO';
  }
  if (p < 4) return 'DROP';
  if (p < 8) return 'BREAKDOWN';
  if (p < 24) return 'DROP';
  if (p < 32) return 'BREAKDOWN';
  if (p < 48) return 'REBUILD';
  if (p < 56) return 'DROP';
  if (p < 60) return 'BREAKDOWN';
  return 'OUTRO';
}

const SECTION_COLORS: Record<string, string> = {
  INTRO: '#8a4dff',
  GROOVE: '#b8f22e',
  DROP: '#ff2e88',
  BREAKDOWN: '#c93df0',
  REBUILD: '#3df08a',
  OUTRO: '#ff9a2a',
};

export function ArrangementMap({ bar, barInCycle }: ArrangementMapProps) {
  // Build 64 cells representing the arrangement cycle
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 64; i++) {
    const section = getSection(bar - barInCycle + i);
    const color = SECTION_COLORS[section] ?? '#3a2b5e';
    const isCurrent = i === barInCycle;
    const isPast = i < barInCycle;
    const letter = section[0];  // I/G/D/B/R/O
    cells.push(
      <div
        key={i}
        className={`arr-cell${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}`}
        style={{
          background: color,
          opacity: isPast ? 0.25 : isCurrent ? 1 : 0.55,
          boxShadow: isCurrent ? `0 0 8px ${color}` : 'none',
        }}
        title={`Bar ${i} — ${section}`}
      >
        <span className="arr-cell-letter">{isCurrent ? letter : ''}</span>
      </div>
    );
  }

  // Section legend
  const sections = ['INTRO', 'GROOVE', 'DROP', 'BREAKDOWN', 'REBUILD', 'OUTRO'];

  return (
    <div className="pf-m intel">
      <h4>ARRANGEMENT MAP (64 bars)</h4>
      <div className="arr-grid">
        {cells}
      </div>
      <div className="arr-legend">
        {sections.map(s => (
          <div key={s} className="arr-legend-item">
            <div className="arr-legend-dot" style={{ background: SECTION_COLORS[s] }} />
            <span>{s.slice(0, 4)}</span>
          </div>
        ))}
      </div>
      <div className="arr-pos">
        Position: bar {barInCycle}/64 · cycle {Math.floor(bar / 64)}
      </div>
    </div>
  );
}
