'use client';

// PSY4 — Phase 2 full synth UI
// Built on the psyforge-pro.html design: knob-per-feature, 3-column rack,
// 16-step sequencer, keyboard + wheels.
//
// Uses PsyLive4 (the new clean architecture — Layer 3 host).

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive4, type LiveState4 } from '@/lib/psyLive4/psyLive4';
import type { MusicalStyle } from '@/lib/psyLive4/types';
import { Header } from '@/components/psyforge/Header';
import { SynthRack } from '@/components/psyforge/SynthRack';
import { ArpSeq } from '@/components/psyforge/ArpSeq';
import { ModMatrix } from '@/components/psyforge/ModMatrix';
import { FxSection } from '@/components/psyforge/FxSection';
import { Keyboard } from '@/components/psyforge/Keyboard';
import { StatusStrip } from '@/components/psyforge/StatusStrip';

const PRESETS = [
  { name: 'Full-On Rolling', style: 'FULL_ON' as MusicalStyle, bpm: 145, energy: 0.7 },
  { name: 'Dark Psy', style: 'DARK' as MusicalStyle, bpm: 148, energy: 0.6 },
  { name: 'Progressive', style: 'PROGRESSIVE' as MusicalStyle, bpm: 134, energy: 0.5 },
  { name: 'Acid', style: 'ACID' as MusicalStyle, bpm: 140, energy: 0.65 },
  { name: 'Goa', style: 'GOA' as MusicalStyle, bpm: 144, energy: 0.75 },
  { name: 'Hi-Tech', style: 'HI_TECH' as MusicalStyle, bpm: 150, energy: 0.85 },
  { name: 'Forest', style: 'FOREST' as MusicalStyle, bpm: 146, energy: 0.6 },
];

const initialState: LiveState4 = {
  playing: false, bpm: 145, style: 'FULL_ON', energy: 0.5,
  kickCount: 0, bar: 0, engineLevel: 0, voicesActive: 0, patchesLoaded: 0,
  peakDb: -Infinity, rmsDb: -Infinity, schedulerStaleMs: 0,
  ctxState: 'suspended', suspended: false,
  repetition: { uniqueBars: 0, repeatedBars: 0, maxStreak: 0, windowSize: 0 },
};

export default function Page() {
  const engineRef = useRef<PsyLive4 | null>(null);
  const [s, setS] = useState<LiveState4>(initialState);
  const [ready, setReady] = useState(false);
  const [bpm, setBpm] = useState(145);
  const [power, setPower] = useState(false);
  const [arpOn, setArpOn] = useState(false);
  const [seqOn, setSeqOn] = useState(false);
  const [presetIdx, setPresetIdx] = useState(0);
  const [octave, setOctave] = useState(3);

  // Synth params (CC values 0..1)
  const [ccParams, setCcParams] = useState<Record<number, number>>({
    5: 0.2,   // glide
    9: 0.7,   // env depth
    12: 0.5,  // energy macro
    13: 0.2,  // vel track
    14: 0.3,  // delay send
    15: 0.22, // reverb send
    20: 0.0,  // attack
    21: 0.3,  // decay
    22: 0.55, // sustain
    23: 0.2,  // release
    71: 0.65, // resonance
    74: 0.5,  // cutoff (CC74)
  });

  // FX
  const [drive, setDrive] = useState(0.35);
  const [delay, setDelay] = useState(0.3);
  const [reverb, setReverb] = useState(0.22);
  const [volume, setVolume] = useState(0.85);

  // Arp
  const [arpMode, setArpMode] = useState('up');
  const [arpRate, setArpRate] = useState('1/8');
  const [arpGate, setArpGate] = useState(0.55);
  const [swing, setSwing] = useState(0);
  const [seqSteps, setSeqSteps] = useState<boolean[]>(Array(16).fill(false).map((_, i) => i % 4 === 0));
  const [currentStep, setCurrentStep] = useState(-1);

  // Mod
  const [lfoAmt, setLfoAmt] = useState(0.25);
  const [lfoRate, setLfoRate] = useState(0.3);

  // ── Init engine ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const engine = new PsyLive4();
        await engine.init();
        if (cancelled) { engine.dispose(); return; }
        engineRef.current = engine;
        (window as any).__psyLive4 = engine;
        setReady(true);
      } catch (e) {
        console.error('PsyLive4 init failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Poll state at 4Hz ──
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      const e = engineRef.current;
      if (e) setS(e.getState());
    }, 250);
    return () => clearInterval(id);
  }, [ready]);

  // ── Simulate step sequencer advance when seq is on ──
  useEffect(() => {
    if (!seqOn || !power) return;
    const stepDur = (60 / bpm) / 4;  // 16th note
    let step = 0;
    const id = setInterval(() => {
      setCurrentStep(step);
      step = (step + 1) % 16;
    }, stepDur * 1000);
    return () => clearInterval(id);
  }, [seqOn, power, bpm]);

  // ── Controls ──
  const onPower = useCallback(async () => {
    const e = engineRef.current;
    if (!e) return;
    if (power) {
      e.stop();
      setPower(false);
    } else {
      await e.play();
      setPower(true);
    }
  }, [power]);

  const onBpm = useCallback((v: number) => {
    setBpm(v);
    engineRef.current?.setBPM(v);
  }, []);

  const onPreset = useCallback(() => {
    const next = (presetIdx + 1) % PRESETS.length;
    const p = PRESETS[next];
    setPresetIdx(next);
    setBpm(p.bpm);
    engineRef.current?.setBPM(p.bpm);
    engineRef.current?.setStyle(p.style);
    engineRef.current?.setEnergy(p.energy);
  }, [presetIdx]);

  const onParam = useCallback((cc: number, value: number) => {
    setCcParams(prev => ({ ...prev, [cc]: value }));
    engineRef.current?.setCC(cc, value);
  }, []);

  const onVolume = useCallback((v: number) => {
    setVolume(v);
    engineRef.current?.setMasterVolume(v);
  }, []);

  const onNoteOn = useCallback((midi: number) => {
    engineRef.current?.noteOn(midi);
  }, []);

  const onNoteOff = useCallback((midi: number) => {
    engineRef.current?.noteOff(midi);
  }, []);

  const onToggleStep = useCallback((i: number) => {
    setSeqSteps(prev => prev.map((s, j) => j === i ? !s : s));
  }, []);

  if (!ready) {
    return (
      <div className="pf-root">
        <div className="pf-wrap" style={{ textAlign: 'center', padding: '60px' }}>
          <div className="pf-lg"><b>PsyForge</b> <i>4</i></div>
          <div style={{ marginTop: '20px', color: 'var(--pf-dm)', fontSize: '13px' }}>
            Initializing engine…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-root">
      <div className="pf-wrap">
        <Header
          bpm={bpm}
          onBpm={onBpm}
          power={power}
          onPower={onPower}
          arpOn={arpOn}
          onArp={() => setArpOn(v => !v)}
          seqOn={seqOn}
          onSeq={() => setSeqOn(v => !v)}
          presetName={PRESETS[presetIdx].name}
          onPreset={onPreset}
          onSave={() => alert('Preset save — TODO (localStorage)')}
        />

        <div className="pf-g3">
          <SynthRack params={ccParams} onParam={onParam} />
        </div>

        <div className="pf-g2">
          <ArpSeq
            seqSteps={seqSteps}
            currentStep={currentStep}
            onToggleStep={onToggleStep}
            arpMode={arpMode}
            onArpMode={() => {
              const modes = ['up', 'down', 'updn', 'rnd', 'conv', 'walk'];
              setArpMode(modes[(modes.indexOf(arpMode) + 1) % modes.length]);
            }}
            arpRate={arpRate}
            onArpRate={() => {
              const rates = ['1/4', '1/8', '1/8.', '1/16', '1/16.', '1/32'];
              setArpRate(rates[(rates.indexOf(arpRate) + 1) % rates.length]);
            }}
            arpGate={arpGate}
            onArpGate={setArpGate}
            swing={swing}
            onSwing={setSwing}
          />
          <ModMatrix
            lfoAmt={lfoAmt}
            onLfoAmt={setLfoAmt}
            lfoRate={lfoRate}
            onLfoRate={setLfoRate}
          />
          <FxSection
            drive={drive}
            onDrive={setDrive}
            delay={delay}
            onDelay={setDelay}
            reverb={reverb}
            onReverb={setReverb}
            volume={volume}
            onVolume={onVolume}
          />
        </div>

        <Keyboard
          octave={octave}
          onOctave={setOctave}
          onNoteOn={onNoteOn}
          onNoteOff={onNoteOff}
        />

        <StatusStrip state={s} arpOn={arpOn} seqOn={seqOn} />
      </div>
    </div>
  );
}
