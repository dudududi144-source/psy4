'use client';
// src/components/psyforge/VoiceActivity.tsx
// Per-role voice pool monitor — shows which voices are active right now.

import React from 'react';
import type { RoleVoiceCount } from '@/lib/psyLive4/psyLive4';

interface VoiceActivityProps {
  roleVoices: RoleVoiceCount;
  totalActive: number;
}

const ROLE_META: Array<{ key: keyof RoleVoiceCount; label: string; color: string; max: number }> = [
  { key: 'kick', label: 'KICK', color: '#00ffc8', max: 4 },
  { key: 'bass', label: 'BASS', color: '#3b82f6', max: 4 },
  { key: 'lead', label: 'LEAD', color: '#ff2e88', max: 4 },
  { key: 'acid', label: 'ACID', color: '#10b981', max: 4 },
  { key: 'pad', label: 'PAD', color: '#8a4dff', max: 6 },
  { key: 'hat', label: 'HAT', color: '#eab308', max: 3 },
  { key: 'clap', label: 'CLAP', color: '#06b6d4', max: 2 },
  { key: 'perc', label: 'PERC', color: '#f59e0b', max: 3 },
  { key: 'snare', label: 'SNARE', color: '#ef4444', max: 2 },
];

export function VoiceActivity({ roleVoices, totalActive }: VoiceActivityProps) {
  return (
    <div className="pf-m intel">
      <h4>VOICE ACTIVITY (recent hits)</h4>
      <div className="voice-grid">
        {ROLE_META.map(({ key, label, color, max }) => {
          const count = roleVoices[key] ?? 0;
          const pct = Math.min(100, (count / max) * 100);
          return (
            <div key={key} className="voice-row">
              <span className="voice-label" style={{ color }}>{label}</span>
              <div className="voice-bar-track">
                <div
                  className="voice-bar-fill"
                  style={{ width: `${pct}%`, background: color, boxShadow: count > 0 ? `0 0 6px ${color}` : 'none' }}
                />
              </div>
              <span className="voice-count" style={{ color: count > 0 ? color : 'var(--pf-dm)' }}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
