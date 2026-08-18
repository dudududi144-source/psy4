'use client';
// src/components/psyforge/SmartRadio.tsx
// Smart Radio: auto-evolution mode that cycles styles every ~2 minutes.
// Think of it as an AI DJ that never stops.

import React from 'react';
import type { MusicalStyle } from '@/lib/psyLive4/types';

interface SmartRadioProps {
  on: boolean;
  onToggle: () => void;
  nextStyleChange: number;   // seconds
  currentStyle: MusicalStyle;
  energy: number;
}

const STYLE_ORDER: MusicalStyle[] = ['FULL_ON', 'DARK', 'PROGRESSIVE', 'ACID', 'GOA', 'HI_TECH', 'FOREST'];

export function SmartRadio({ on, onToggle, nextStyleChange, currentStyle, energy }: SmartRadioProps) {
  const currentIdx = STYLE_ORDER.indexOf(currentStyle);
  const nextStyle = STYLE_ORDER[(currentIdx + 1) % STYLE_ORDER.length];
  const mins = Math.floor(nextStyleChange / 60);
  const secs = Math.floor(nextStyleChange % 60);

  return (
    <div className={`pf-m intel smart-radio${on ? ' active' : ''}`}>
      <h4>SMART RADIO</h4>
      <div className="radio-status">
        <div className={`radio-led${on ? ' on' : ''}`} />
        <span className="radio-status-text">
          {on ? 'BROADCASTING' : 'OFFLINE'}
        </span>
      </div>
      {on && (
        <>
          <div className="radio-now">
            <span className="radio-label">NOW</span>
            <span className="radio-style" style={{ color: 'var(--pf-mg)' }}>{currentStyle.replace('_', '.')}</span>
          </div>
          <div className="radio-next">
            <span className="radio-label">NEXT</span>
            <span className="radio-style-next">{nextStyle.replace('_', '.')}</span>
          </div>
          <div className="radio-countdown">
            <div className="radio-countdown-bar">
              <div
                className="radio-countdown-fill"
                style={{ width: `${Math.max(0, Math.min(100, (1 - nextStyleChange / 120) * 100))}%` }}
              />
            </div>
            <span className="radio-time">{mins}:{secs.toString().padStart(2, '0')}</span>
          </div>
          <div className="radio-energy">
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
