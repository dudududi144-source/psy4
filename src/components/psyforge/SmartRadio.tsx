'use client';
// src/components/psyforge/SmartRadio.tsx
// Smart Radio — REAL radio listener mode.
//
// FIX (roast GAP 10): the old component showed a fake "next style in M:SS"
// countdown that was always 0:00 (the value was hardcoded to 0 in getState()).
// This version shows what the radio listener is ACTUALLY doing:
// - The stream name we're connected to (e.g. "Psyndora Psytrance")
// - The BPM detected from the stream (with confidence)
// - The current engine style (synced from radio)
//
// No more fake countdowns. What you see is what's real.

import React from 'react';
import type { MusicalStyle } from '@/lib/psyLive4/types';

interface SmartRadioProps {
  on: boolean;
  onToggle: () => void;
  streamName: string;             // name of connected stream (empty if none)
  detectedBpm: number;            // BPM detected from radio (0 = unknown)
  bpmConfidence: number;         // 0..1 — how stable the estimate is
  currentStyle: MusicalStyle;
  energy: number;
}

export function SmartRadio({ on, onToggle, streamName, detectedBpm, bpmConfidence, currentStyle, energy }: SmartRadioProps) {
  const bpmLabel = detectedBpm > 0
    ? `${detectedBpm.toFixed(0)} BPM`
    : '— BPM';
  const confPct = Math.round(bpmConfidence * 100);
  const confLabel = bpmConfidence > 0.6 ? 'STABLE' : bpmConfidence > 0.3 ? 'LOCKING' : 'SEARCHING';

  return (
    <div className={`pf-m intel smart-radio${on ? ' active' : ''}`}>
      <h4>SMART RADIO</h4>
      <div className="radio-status">
        <div className={`radio-led${on ? ' on' : ''}`} />
        <span className="radio-status-text">
          {on ? 'LISTENING' : 'OFFLINE'}
        </span>
      </div>
      {on && (
        <>
          <div className="radio-now">
            <span className="radio-label">STREAM</span>
            <span className="radio-style" style={{ color: 'var(--pf-mg)' }}>
              {streamName || 'connecting…'}
            </span>
          </div>
          <div className="radio-next">
            <span className="radio-label">DETECTED</span>
            <span className="radio-style-next">{bpmLabel}</span>
          </div>
          <div className="radio-countdown">
            <div className="radio-countdown-bar">
              <div
                className="radio-countdown-fill"
                style={{ width: `${Math.max(0, Math.min(100, bpmConfidence * 100))}%` }}
              />
            </div>
            <span className="radio-time">{confLabel} {confPct}%</span>
          </div>
          <div className="radio-energy">
            ENGINE STYLE: <span style={{ color: 'var(--pf-ac)' }}>{currentStyle.replace('_', '.')}</span>
          </div>
          <div className="radio-energy" style={{ marginTop: '2px' }}>
            ENERGY: <span style={{ color: 'var(--pf-ac)' }}>{Math.round(energy * 100)}%</span>
          </div>
        </>
      )}
      <button
        className={`pf-btn radio-toggle${on ? ' on' : ''}`}
        onClick={onToggle}
        style={{ marginTop: '8px', width: '100%' }}
      >
        {on ? 'STOP RADIO' : 'START RADIO'}
      </button>
    </div>
  );
}
