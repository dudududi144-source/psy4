'use client';
// src/components/psyforge/LearningPanel.tsx
// Shows the CC exploration learning loop: current trial + reward history.

import React from 'react';
import type { CCExplorationState } from '@/lib/psyLive4/learning';

interface LearningPanelProps {
  on: boolean;
  onToggle: () => void;
  states: CCExplorationState[];
  currentCc: number;
  trialRemaining: number;
}

const CC_NAMES: Record<number, string> = {
  74: 'CUTOFF',
  71: 'RESO',
  5: 'GLIDE',
  12: 'ENERGY',
};

export function LearningPanel({ on, onToggle, states, currentCc, trialRemaining }: LearningPanelProps) {
  return (
    <div className={`pf-m intel learning${on ? ' active' : ''}`}>
      <h4>LEARNING LOOP</h4>
      <div className="learning-status">
        <div className={`learning-led${on ? ' on' : ''}`} />
        <span className="learning-status-text">{on ? 'EXPLORING' : 'IDLE'}</span>
      </div>
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
        {on ? '■ STOP LEARNING' : '▶ START LEARNING'}
      </button>
    </div>
  );
}
