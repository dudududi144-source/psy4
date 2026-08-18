'use client';

// PSY4 — Full synth UI with intelligence panel
// Left: synth rack (OSC/FILTER/AMP + ARP/SEQ/MOD/FX + keyboard)
// Right: engine intelligence (context + arrangement map + voices + master chain + smart radio)

import '../components/psyforge/psyforge.css';
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
import { EngineContext } from '@/components/psyforge/EngineContext';
import { ArrangementMap } from '@/components/psyforge/ArrangementMap';
import { VoiceActivity } from '@/components/psyforge/VoiceActivity';
import { MasterChainMeter } from '@/components/psyforge/MasterChainMeter';
import { SmartRadio } from '@/components/psyforge/SmartRadio';
import { LearningPanel } from '@/components/psyforge/LearningPanel';
import { SpectrumVisualizer } from '@/components/psyforge/SpectrumVisualizer';
import { loadPresets, savePreset, type PsyPreset } from '@/lib/psyLive4/presets';

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
  kickCount: 0, bar: 0, section: 'INTRO', barInCycle: 0, cycle: 0,
  engineLevel: 0, voicesActive: 0, patchesLoaded: 0,
  peakDb: -Infinity, rmsDb: -Infinity, schedulerStaleMs: 0,
  ctxState: 'suspended', suspended: false,
  repetition: { uniqueBars: 0, repeatedBars: 0, maxStreak: 0, windowSize: 0 },
  roleVoices: { kick: 0, bass: 0, lead: 0, acid: 0, pad: 0, hat: 0, clap: 0, perc: 0, snare: 0 },
  masterChain: { lowCompReduction: 0, midCompReduction: 0, highCompReduction: 0, sidechainGain: 1, limiterReduction: 0 },
  recentEvents: [], eventsPerSec: 0, ccParams: {},
  smartRadioOn: false, smartRadioNextStyleChange: 0,
  drumStats: null, learningOn: false, learningStates: [], learningCurrentCc: 74, learningTrialRemaining: 0,
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
  const [smartRadioOn, setSmartRadioOn] = useState(false);
  const [learningOn, setLearningOn] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [savedPresets, setSavedPresets] = useState<PsyPreset[]>([]);

  // Synth params (CC values 0..1)
  const [ccParams, setCcParams] = useState<Record<number, number>>({
    5: 0.2, 9: 0.7, 12: 0.5, 13: 0.2, 14: 0.3, 15: 0.22,
    20: 0.0, 21: 0.3, 22: 0.55, 23: 0.2, 71: 0.65, 74: 0.5,
  });

  const [drive, setDrive] = useState(0.35);
  const [delay, setDelay] = useState(0.3);
  const [reverb, setReverb] = useState(0.22);
  const [volume, setVolume] = useState(0.85);

  const [arpMode, setArpMode] = useState('up');
  const [arpRate, setArpRate] = useState('1/8');
  const [arpGate, setArpGate] = useState(0.55);
  const [swing, setSwing] = useState(0);
  const [seqSteps, setSeqSteps] = useState<boolean[]>(Array(16).fill(false).map((_, i) => i % 4 === 0));
  const [currentStep, setCurrentStep] = useState(-1);

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
        // Expose analyser for the visualizer
        setAnalyser((engine as any).analyser as AnalyserNode);
        // Load saved presets
        setSavedPresets(loadPresets());
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

  // ── Step sequencer ──
  useEffect(() => {
    if (!seqOn || !power) return;
    const stepDur = (60 / bpm) / 4;
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
    if (power) { e.stop(); setPower(false); }
    else { await e.play(); setPower(true); }
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

  const onNoteOn = useCallback((midi: number) => { engineRef.current?.noteOn(midi); }, []);
  const onNoteOff = useCallback((midi: number) => { engineRef.current?.noteOff(midi); }, []);

  const onToggleStep = useCallback((i: number) => {
    setSeqSteps(prev => prev.map((st, j) => j === i ? !st : st));
  }, []);

  const onSmartRadio = useCallback(() => {
    const newOn = !smartRadioOn;
    setSmartRadioOn(newOn);
    engineRef.current?.setSmartRadio(newOn);
  }, [smartRadioOn]);

  const onLearning = useCallback(() => {
    const newOn = !learningOn;
    setLearningOn(newOn);
    engineRef.current?.setLearning(newOn);
  }, [learningOn]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          onPower();
          break;
        case 'r': case 'R':
          onSmartRadio();
          break;
        case 'l': case 'L':
          onLearning();
          break;
        case '1': case '2': case '3': case '4': case '5': case '6': case '7':
          const idx = parseInt(e.key) - 1;
          if (idx < PRESETS.length) {
            const p = PRESETS[idx];
            setPresetIdx(idx);
            setBpm(p.bpm);
            engineRef.current?.setBPM(p.bpm);
            engineRef.current?.setStyle(p.style);
            engineRef.current?.setEnergy(p.energy);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPower, onSmartRadio, onLearning]);

  const onExportMIDI = useCallback(() => {
    engineRef.current?.exportMIDI(8);
  }, []);

  const onExportWAV = useCallback(() => {
    engineRef.current?.exportWAV(8);
  }, []);

  if (!ready) {
    return (
      <div className="pf-root">
        <div className="pf-wrap" style={{ textAlign: 'center', padding: '60px' }}>
          <div className="pf-lg"><b>PsyForge</b> <i>4</i></div>
          <div style={{ marginTop: '20px', color: 'var(--pf-dm)', fontSize: '13px' }}>Initializing engine…</div>
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
          onSave={() => {
            const name = prompt('Preset name:', PRESETS[presetIdx].name);
            if (!name) return;
            const preset: PsyPreset = {
              name, bpm, style: s.style, energy: s.energy,
              ccParams, fx: { drive, delay, reverb, volume },
              savedAt: Date.now(),
            };
            const updated = savePreset(preset);
            setSavedPresets(updated);
            alert(`Saved "${name}" (${updated.length} presets total)`);
          }}
        />

        {/* 2-column layout: synth rack left, intelligence right */}
        <div className="pf-layout">
          {/* ── LEFT: Synth rack + keyboard ── */}
          <div>
            <SpectrumVisualizer analyser={analyser} height={70} />
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
              <ModMatrix lfoAmt={lfoAmt} onLfoAmt={setLfoAmt} lfoRate={lfoRate} onLfoRate={setLfoRate} />
              <FxSection drive={drive} onDrive={setDrive} delay={delay} onDelay={setDelay} reverb={reverb} onReverb={setReverb} volume={volume} onVolume={onVolume} onExportMIDI={onExportMIDI} onExportWAV={onExportWAV} />
            </div>
            <Keyboard octave={octave} onOctave={setOctave} onNoteOn={onNoteOn} onNoteOff={onNoteOff} />
          </div>

          {/* ── RIGHT: Engine intelligence panel ── */}
          <div className="pf-sidebar">
            <EngineContext state={s} />
            <ArrangementMap bar={s.bar} barInCycle={s.barInCycle} />
            <VoiceActivity roleVoices={s.roleVoices} totalActive={s.voicesActive} />
            <MasterChainMeter metrics={s.masterChain} peakDb={s.peakDb} rmsDb={s.rmsDb} />
            <SmartRadio
              on={smartRadioOn}
              onToggle={onSmartRadio}
              nextStyleChange={s.smartRadioNextStyleChange}
              currentStyle={s.style}
              energy={s.energy}
            />
            <LearningPanel
              on={learningOn}
              onToggle={onLearning}
              states={s.learningStates}
              currentCc={s.learningCurrentCc}
              trialRemaining={s.learningTrialRemaining}
            />
          </div>
        </div>

        <StatusStrip state={s} arpOn={arpOn} seqOn={seqOn} />
      </div>
    </div>
  );
}
