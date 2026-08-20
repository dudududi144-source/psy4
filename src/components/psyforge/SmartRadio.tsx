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
// NEW: added RESET button + reconnect status indicator so the user can
// manually retry when streams die, and so the user can SEE that we're
// retrying infinitely (not silently giving up).
//
// No more fake countdowns. What you see is what's real.

import React from 'react';
import type { MusicalStyle } from '@/lib/psyLive4/types';

interface SmartRadioProps {
  on: boolean;
  onToggle: () => void;
  onReset?: () => void;           // manual reset (clears failed streams + reconnects)
  streamName: string;             // name of connected stream (empty if none)
  detectedBpm: number;            // BPM detected from radio (0 = unknown)
  bpmConfidence: number;         // 0..1 — how stable the estimate is
  currentStyle: MusicalStyle;
  energy: number;
  reconnectAttempts: number;      // how many auto-reconnect cycles have run
  lastConnectTime: number;        // epoch ms of last successful connect (0 = never)
}

export function SmartRadio({
  on, onToggle, onReset,
  streamName, detectedBpm, bpmConfidence, currentStyle, energy,
  reconnectAttempts, lastConnectTime,
}: SmartRadioProps) {
  const bpmLabel = detectedBpm > 0
    ? `${detectedBpm.toFixed(0)} BPM`
    : '— BPM';
  const confPct = Math.round(bpmConfidence * 100);
  const confLabel = bpmConfidence > 0.6 ? 'STABLE' : bpmConfidence > 0.3 ? 'LOCKING' : 'SEARCHING';

  // Reconnect status: if we've had to auto-reconnect, show a small badge
  const showReconnectBadge = on && reconnectAttempts > 0;
  const lastConnectLabel = lastConnectTime > 0
    ? `connected ${Math.max(0, Math.round((Date.now() - lastConnectTime) / 1000))}s ago`
    : 'never connected';

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
          {/* Reconnect status — visible proof we never give up */}
          {showReconnectBadge && (
            <div className="radio-reconnect" title={lastConnectLabel}>
              <span className="radio-label">AUTO-RECONNECT</span>
              <span className="radio-reconnect-count">#{reconnectAttempts}</span>
              <span className="radio-reconnect-time">{lastConnectLabel}</span>
            </div>
          )}
        </>
      )}
      <div className="radio-buttons" style={{ display: 'flex', gap: '6px', marginTop: '8px', width: '100%' }}>
        <button
          className={`pf-btn radio-toggle${on ? ' on' : ''}`}
          onClick={onToggle}
          style={{ flex: 1 }}
        >
          {on ? 'STOP RADIO' : 'START RADIO'}
        </button>
        {on && onReset && (
          <button
            className="pf-btn radio-reset"
            onClick={onReset}
            title="Clear failed streams + reconnect from scratch"
            style={{ flex: '0 0 auto', padding: '0 12px' }}
          >
            RESET
          </button>
        )}
      </div>
    </div>
  );
}
