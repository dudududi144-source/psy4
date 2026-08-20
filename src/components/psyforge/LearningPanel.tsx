'use client';
// src/components/psyforge/LearningPanel.tsx
// Shows the learning loop: grammar stats + CC exploration + reward history.
//
// v3 (current) upgrades — REAL musical learning:
// - GRAMMAR STATS — actual observations: bass 12x12 transitions, melodic
//   intervals, kick onsets. Visible counts + confidence metric.
// - GRAMMAR IMPACT — "samples applied" counter shows how many notes the
//   composer has actually REPLACED with grammar-sampled ones. This is the
//   "the music changes because of learning" proof.
// - Convergence metric (kept for backwards compat) — how close engine is to radio
// - Convergence sparkline — last 60 measurements
// - Error counter — if learning threw, show it
// - Pattern memory count — how many high-reward patterns are remembered
// - A/B mix mode toggle — solo radio / solo engine / both

import React from 'react';
import type { CCExplorationState } from '@/lib/psyLive4/learning';
import type { GrammarStats } from '@/lib/psyLive4/grammar-learner';

interface LearningPanelProps {
  on: boolean;
  onToggle: () => void;
  states: CCExplorationState[];
  currentCc: number;
  trialRemaining: number;
  convergence: number;
  convergenceHistory: number[];
  learningErrors: number;
  patternCount: number;
  radioMixMode: 'both' | 'radio' | 'engine';
  onRadioMixMode: (mode: 'both' | 'radio' | 'engine') => void;
  radioConnected: boolean;
  cloudSync: boolean;  // Turso cloud sync active
  grammarStats: GrammarStats | null;        // NEW v3 — real musical learning
  grammarSamplesApplied: number;            // NEW v3 — count of notes the composer replaced
}

const CC_NAMES: Record<number, string> = {
  74: 'CUTOFF',
  71: 'RESO',
  5: 'GLIDE',
  12: 'ENERGY',
  14: 'DELAY',
  15: 'VERB',
};

export function LearningPanel({
  on, onToggle, states, currentCc, trialRemaining,
  convergence, convergenceHistory, learningErrors, patternCount,
  radioMixMode, onRadioMixMode, radioConnected, cloudSync,
  grammarStats, grammarSamplesApplied,
}: LearningPanelProps) {
  const convPct = Math.round(convergence * 100);
  const convColor = convPct > 70 ? 'var(--pf-ok, #4ade80)' : convPct > 40 ? 'var(--pf-mg)' : 'var(--pf-warn, #fbbf24)';

  // Sparkline: map convergence history (0..1) to a tiny SVG polyline
  const sparkW = 200, sparkH = 30;
  const sparkPath = convergenceHistory.length > 1
    ? convergenceHistory.map((v, i) => {
        const x = (i / (convergenceHistory.length - 1)) * sparkW;
        const y = sparkH - v * sparkH;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ')
    : '';

  return (
    <div className={`pf-m intel learning${on ? ' active' : ''}`}>
      <h4>LEARNING LOOP{cloudSync && <span className="cloud-sync-badge" title="Turso cloud sync active">☁</span>}</h4>
      <div className="learning-status">
        <div className={`learning-led${on ? ' on' : ''}`} />
        <span className="learning-status-text">{on ? 'EXPLORING' : 'IDLE'}</span>
      </div>

      {/* v3 — REAL GRAMMAR LEARNING STATS */}
      {on && grammarStats && (
        <div className="learning-grammar" style={{ marginTop: '8px' }}>
          <div className="learning-trial">
            <span className="intel-label">GRAMMAR CONFIDENCE</span>
            <span className="learning-cc" style={{ color: grammarStats.confidence > 0.5 ? 'var(--pf-gr, #4ade80)' : 'var(--pf-warn, #fbbf24)' }}>
              {Math.round(grammarStats.confidence * 100)}%
            </span>
          </div>
          <div className="convergence-bar-track">
            <div
              className="convergence-bar-fill"
              style={{ width: `${grammarStats.confidence * 100}%`, background: 'var(--pf-mg, #d93df0)' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px', marginTop: '6px', fontSize: '10px' }}>
            <div>
              <div className="intel-label" style={{ fontSize: '9px' }}>BASS</div>
              <div style={{ color: 'var(--pf-ac)' }}>{grammarStats.bass.total}</div>
              {grammarStats.bass.topTransition && (
                <div style={{ color: 'var(--pf-dm)', fontSize: '9px' }}>
                  {grammarStats.bass.topTransition.from}→{grammarStats.bass.topTransition.to}
                </div>
              )}
            </div>
            <div>
              <div className="intel-label" style={{ fontSize: '9px' }}>MELODIC</div>
              <div style={{ color: 'var(--pf-ac)' }}>{grammarStats.melodic.total}</div>
              {grammarStats.melodic.topInterval && (
                <div style={{ color: 'var(--pf-dm)', fontSize: '9px' }}>
                  int {grammarStats.melodic.topInterval.interval > 0 ? '+' : ''}{grammarStats.melodic.topInterval.interval}
                </div>
              )}
            </div>
            <div>
              <div className="intel-label" style={{ fontSize: '9px' }}>RHYTHM</div>
              <div style={{ color: 'var(--pf-ac)' }}>{grammarStats.rhythm.total}</div>
              {grammarStats.rhythm.topStep && (
                <div style={{ color: 'var(--pf-dm)', fontSize: '9px' }}>
                  step {grammarStats.rhythm.topStep.step}
                </div>
              )}
            </div>
          </div>
          {/* Grammar impact — proof that learning changes the music */}
          <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(61,240,138,0.06)', border: '1px solid rgba(61,240,138,0.20)', borderRadius: '6px', fontSize: '10px' }}>
            <span className="intel-label" style={{ color: 'var(--pf-gr, #4ade80)' }}>NOTES REPLACED</span>
            <span style={{ color: 'var(--pf-gr, #4ade80)', fontWeight: 800, marginLeft: '8px' }}>{grammarSamplesApplied}</span>
            <span style={{ color: 'var(--pf-dm)', fontSize: '9px', marginLeft: '6px' }}>from grammar</span>
          </div>
        </div>
      )}

      {/* DEEP GAP C: Convergence metric + sparkline */}
      {on && radioConnected && (
        <div className="learning-convergence">
          <div className="learning-trial">
            <span className="intel-label">CONVERGENCE</span>
            <span className="learning-cc" style={{ color: convColor }}>{convPct}%</span>
          </div>
          <div className="convergence-bar-track">
            <div
              className="convergence-bar-fill"
              style={{ width: `${convPct}%`, background: convColor }}
            />
          </div>
          {convergenceHistory.length > 1 && (
            <svg className="convergence-spark" width={sparkW} height={sparkH} style={{ display: 'block', marginTop: '4px' }}>
              <path d={sparkPath} stroke={convColor} strokeWidth="1.5" fill="none" />
              <line x1="0" y1={sparkH} x2={sparkW} y2={sparkH} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
            </svg>
          )}
          <div className="convergence-stats">
            <span>patterns: <span style={{ color: 'var(--pf-ac)' }}>{patternCount}</span></span>
            {learningErrors > 0 && (
              <span style={{ color: 'var(--pf-warn, #fbbf24)' }}>errors: {learningErrors}</span>
            )}
          </div>
        </div>
      )}

      {/* DEEP GAP F: A/B mix mode */}
      {on && radioConnected && (
        <div className="learning-ab">
          <span className="intel-label">A/B MIX</span>
          <div className="ab-buttons">
            <button
              className={`pf-btn ab-btn${radioMixMode === 'radio' ? ' active' : ''}`}
              onClick={() => onRadioMixMode('radio')}
              title="Hear radio only (reference)"
            >RADIO</button>
            <button
              className={`pf-btn ab-btn${radioMixMode === 'both' ? ' active' : ''}`}
              onClick={() => onRadioMixMode('both')}
              title="Hear both"
            >BOTH</button>
            <button
              className={`pf-btn ab-btn${radioMixMode === 'engine' ? ' active' : ''}`}
              onClick={() => onRadioMixMode('engine')}
              title="Hear engine only (test)"
            >ENGINE</button>
          </div>
        </div>
      )}

      {on && (
        <>
          <div className="learning-trial">
            <span className="intel-label">NOW TESTING</span>
            <span className="learning-cc" style={{ color: 'var(--pf-ac)' }}>{CC_NAMES[currentCc] ?? `CC${currentCc}`}</span>
            <span className="learning-timer">{trialRemaining.toFixed(0)}s left</span>
          </div>
          <div className="learning-params">
            {states.map(s => (
              <div key={s.cc} className={`learning-row${s.cc === currentCc ? ' current' : ''}`}>
                <span className="learning-param-label">{CC_NAMES[s.cc] ?? `CC${s.cc}`}</span>
                <div className="learning-bar-track">
                  <div
                    className="learning-bar-fill"
                    style={{
                      width: `${s.value * 100}%`,
                      background: s.cc === currentCc ? 'var(--pf-ac)' : 'var(--pf-mg)',
                    }}
                  />
                </div>
                <span className="learning-reward">{s.reward.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <button
        className={`pf-btn learning-toggle${on ? ' on' : ''}`}
        onClick={onToggle}
        style={{ marginTop: '8px', width: '100%' }}
      >
        {on ? 'STOP LEARNING' : 'START LEARNING'}
      </button>
    </div>
  );
}
