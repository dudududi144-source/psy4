'use client';
// src/components/psyforge/ArpSeq.tsx
// Arpeggiator + 16-step sequencer visualizer.

import React from 'react';
import { Knob } from './Knob';

interface ArpSeqProps {
  seqSteps: boolean[];      // 16 steps
  currentStep: number;       // -1 if not playing
  onToggleStep: (i: number) => void;
  arpMode: string;
  onArpMode: () => void;
  arpRate: string;
  onArpRate: () => void;
  arpGate: number;
  onArpGate: (v: number) => void;
  swing: number;
  onSwing: (v: number) => void;
}

const ARP_MODES = ['up', 'down', 'updn', 'rnd', 'conv', 'walk'];
const ARP_RATES = ['1/4', '1/8', '1/8.', '1/16', '1/16.', '1/32'];

export function ArpSeq(props: ArpSeqProps) {
  const { seqSteps, currentStep, onToggleStep, arpMode, onArpMode, arpRate, onArpRate, arpGate, onArpGate, swing, onSwing } = props;
  return (
    <div className="pf-m ar">
      <h4>ARPEGGIATOR + STEP SEQ (synced)</h4>
      <div className="pf-kn" style={{ marginBottom: '10px' }}>
        <Knob label="Mode" value={ARP_MODES.indexOf(arpMode) / (ARP_MODES.length - 1)} onChange={onArpMode} display={arpMode} accent="gr" />
        <Knob label="Rate" value={ARP_RATES.indexOf(arpRate) / (ARP_RATES.length - 1)} onChange={onArpRate} display={arpRate} accent="gr" />
        <Knob label="Gate" value={arpGate} onChange={onArpGate} display={`${Math.round(arpGate * 100)}%`} accent="gr" />
        <Knob label="Swing" value={swing} onChange={onSwing} display={`${Math.round(swing * 100)}%`} accent="gr" />
      </div>
      {/* 16-step sequencer */}
      <div className="pf-seq">
        {seqSteps.map((on, i) => (
          <div
            key={i}
            className={`pf-st${on ? ' on' : ''}${i % 4 === 0 ? ' acc' : ''}${i === currentStep ? ' on' : ''}`}
            style={{ height: on ? `${40 + (i % 4) * 4}px` : '8px' }}
            onClick={() => onToggleStep(i)}
          />
        ))}
      </div>
      <div className="pf-ledrow" style={{ marginTop: '6px' }}>
        <div className={`pf-led${currentStep >= 0 ? ' on' : ''}`} /> clock
        <div className={`pf-led${currentStep >= 0 ? ' ac' : ''}`} /> step {currentStep >= 0 ? currentStep + 1 : '—'}
      </div>
    </div>
  );
}
