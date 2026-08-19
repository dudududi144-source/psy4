'use client';
// src/components/psyforge/MasterChainMeter.tsx
// Shows real-time master chain metrics: per-band compression, sidechain, limiter.

import React from 'react';
import type { MasterChainMetrics } from '@/lib/psyLive4/psyLive4';

interface MasterChainMeterProps {
  metrics: MasterChainMetrics;
  peakDb: number;
  rmsDb: number;
}

// Convert dB reduction to a 0..1 bar width (0dB = empty, -12dB = full)
function dbToPct(db: number): number {
  return Math.max(0, Math.min(100, (-db / 12) * 100));
}

// Convert dB to color (green = safe, yellow = hot, red = heavy reduction)
function dbToColor(db: number): string {
  if (db > -2) return '#3df08a';
  if (db > -6) return '#b8f22e';
  if (db > -10) return '#ff9a2a';
  return '#ef4444';
}

export function MasterChainMeter({ metrics, peakDb, rmsDb }: MasterChainMeterProps) {
  const sidechainPct = (1.0 - metrics.sidechainGain) * 100;
  return (
    <div className="pf-m intel">
      <h4>MASTER CHAIN</h4>
      {/* Peak/RMS meters */}
      <div className="meter-row">
        <span className="meter-label">PEAK</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{
              width: `${Math.max(0, Math.min(100, (peakDb + 40) / 40 * 100))}%`,
              background: dbToColor(peakDb),
            }}
          />
        </div>
        <span className="meter-value">{peakDb === -Infinity ? '-∞' : peakDb.toFixed(1)}dB</span>
      </div>
      <div className="meter-row">
        <span className="meter-label">RMS</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{
              width: `${Math.max(0, Math.min(100, (rmsDb + 40) / 40 * 100))}%`,
              background: dbToColor(rmsDb),
            }}
          />
        </div>
        <span className="meter-value">{rmsDb === -Infinity ? '-∞' : rmsDb.toFixed(1)}dB</span>
      </div>

      {/* Per-band compression */}
      <div className="meter-section-title">MULTIBAND COMP</div>
      <div className="meter-row">
        <span className="meter-label">LOW</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{ width: `${dbToPct(metrics.lowCompReduction)}%`, background: '#3b82f6' }}
          />
        </div>
        <span className="meter-value">{metrics.lowCompReduction.toFixed(1)}dB</span>
      </div>
      <div className="meter-row">
        <span className="meter-label">MID</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{ width: `${dbToPct(metrics.midCompReduction)}%`, background: '#c93df0' }}
          />
        </div>
        <span className="meter-value">{metrics.midCompReduction.toFixed(1)}dB</span>
      </div>
      <div className="meter-row">
        <span className="meter-label">HIGH</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{ width: `${dbToPct(metrics.highCompReduction)}%`, background: '#b8f22e' }}
          />
        </div>
        <span className="meter-value">{metrics.highCompReduction.toFixed(1)}dB</span>
      </div>

      {/* Sidechain + Limiter */}
      <div className="meter-section-title">DYNAMICS</div>
      <div className="meter-row">
        <span className="meter-label">SIDE</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{ width: `${sidechainPct}%`, background: sidechainPct > 10 ? '#ff9a2a' : '#3df08a' }}
          />
        </div>
        <span className="meter-value">{sidechainPct.toFixed(0)}%</span>
      </div>
      <div className="meter-row">
        <span className="meter-label">LIM</span>
        <div className="meter-bar-track">
          <div
            className="meter-bar-fill"
            style={{ width: `${dbToPct(metrics.limiterReduction)}%`, background: dbToColor(metrics.limiterReduction) }}
          />
        </div>
        <span className="meter-value">{metrics.limiterReduction.toFixed(1)}dB</span>
      </div>
    </div>
  );
}
