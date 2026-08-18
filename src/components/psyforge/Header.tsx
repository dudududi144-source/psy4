'use client';
// src/components/psyforge/Header.tsx
// Top bar: logo, preset select, BPM, transport buttons.

import React from 'react';

interface HeaderProps {
  bpm: number;
  onBpm: (v: number) => void;
  power: boolean;
  onPower: () => void;
  arpOn: boolean;
  onArp: () => void;
  seqOn: boolean;
  onSeq: () => void;
  presetName: string;
  onPreset: () => void;
  onSave: () => void;
  onMIDI: () => void;
  onWAV: () => void;
}

export function Header(props: HeaderProps) {
  const { bpm, onBpm, power, onPower, arpOn, onArp, seqOn, onSeq, presetName, onPreset, onSave, onMIDI, onWAV } = props;
  return (
    <div className="pf-hd">
      <div className="pf-lg"><b>PsyForge</b> <i>4</i></div>
      <button className="pf-sel" onClick={onPreset} style={{ cursor: 'pointer' }} title="Click to cycle presets">
        {presetName} ▾
      </button>
      <div className="pf-bpm">
        <span style={{ fontSize: '10px', color: 'var(--pf-dm)' }}>BPM</span>
        <input
          type="number"
          min={120}
          max={160}
          value={bpm}
          onChange={(e) => onBpm(parseInt(e.target.value) || 145)}
        />
      </div>
      <div className="pf-sp" />
      <button className={`pf-btn${arpOn ? ' on' : ''}`} onClick={onArp}>ARP</button>
      <button className={`pf-btn${seqOn ? ' on' : ''}`} onClick={onSeq}>SEQ</button>
      <button className="pf-btn" onClick={onSave}>SAVE</button>
      <button className="pf-btn" onClick={onMIDI} title="Export MIDI">🎵</button>
      <button className="pf-btn" onClick={onWAV} title="Export WAV">🎚</button>
      <button className={`pf-btn pw${power ? '' : ' off'}`} onClick={onPower}>
        {power ? '■ STOP' : '▶ POWER'}
      </button>
    </div>
  );
}
