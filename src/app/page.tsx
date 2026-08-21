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

// PRESETS — manually tuned per style. Each preset includes the CC values
// that give that style its characteristic sound. The values were chosen
// based on psytrance sound-design conventions:
//   CC74 CUTOFF — filter cutoff (high=bright, low=dark)
//   CC71 RESO   — filter resonance (high=squelchy, low=smooth)
//   CC5  GLIDE  — portamento (low=tight bass, high=sliding 303)
//   CC12 ENERGY — drive/intensity (low=restrained, high=driving)
//   CC14 DELAY  — delay send (low=tight, high=atmospheric)
//   CC15 VERB   — reverb send (low=dry, high=spacious)
// Drive/delay/reverb (FX) values are also set per style.
const PRESETS = [
  {
    name: 'Full-On Rolling', style: 'FULL_ON' as MusicalStyle, bpm: 145, energy: 0.7,
    ccParams: { 74: 0.70, 71: 0.60, 5: 0.10, 12: 0.75, 14: 0.30, 15: 0.20 },
    fx: { drive: 0.40, delay: 0.30, reverb: 0.22, volume: 0.85 },
  },
  {
    name: 'Dark Psy', style: 'DARK' as MusicalStyle, bpm: 148, energy: 0.6,
    ccParams: { 74: 0.35, 71: 0.75, 5: 0.25, 12: 0.55, 14: 0.40, 15: 0.35 },
    fx: { drive: 0.50, delay: 0.38, reverb: 0.32, volume: 0.82 },
  },
  {
    name: 'Progressive', style: 'PROGRESSIVE' as MusicalStyle, bpm: 134, energy: 0.5,
    ccParams: { 74: 0.55, 71: 0.40, 5: 0.20, 12: 0.55, 14: 0.45, 15: 0.40 },
    fx: { drive: 0.32, delay: 0.42, reverb: 0.38, volume: 0.85 },
  },
  {
    name: 'Acid', style: 'ACID' as MusicalStyle, bpm: 140, energy: 0.65,
    ccParams: { 74: 0.65, 71: 0.85, 5: 0.35, 12: 0.70, 14: 0.20, 15: 0.15 },
    fx: { drive: 0.55, delay: 0.20, reverb: 0.15, volume: 0.82 },
  },
  {
    name: 'Goa', style: 'GOA' as MusicalStyle, bpm: 144, energy: 0.75,
    ccParams: { 74: 0.75, 71: 0.70, 5: 0.15, 12: 0.75, 14: 0.45, 15: 0.45 },
    fx: { drive: 0.42, delay: 0.45, reverb: 0.42, volume: 0.85 },
  },
  {
    name: 'Hi-Tech', style: 'HI_TECH' as MusicalStyle, bpm: 150, energy: 0.85,
    ccParams: { 74: 0.85, 71: 0.75, 5: 0.10, 12: 0.85, 14: 0.20, 15: 0.18 },
    fx: { drive: 0.60, delay: 0.22, reverb: 0.18, volume: 0.85 },
  },
  {
    name: 'Forest', style: 'FOREST' as MusicalStyle, bpm: 146, energy: 0.6,
    ccParams: { 74: 0.45, 71: 0.60, 5: 0.25, 12: 0.60, 14: 0.35, 15: 0.40 },
    fx: { drive: 0.45, delay: 0.35, reverb: 0.38, volume: 0.82 },
  },
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
  smartRadioOn: false,
  radioStreamName: '',
  radioDetectedBpm: 0,
  radioBpmConfidence: 0,
  drumStats: null, learningOn: false, learningStates: [], learningCurrentCc: 74, learningTrialRemaining: 0,
  // DEEP ROAST V2 fields
  convergence: 0, convergenceHistory: [], learningErrors: 0, patternCount: 0,
  radioMixMode: 'both' as 'both', radioInBreakdown: false,
  cloudSync: false, cloudParamsLoaded: 0,
  // Radio reconnect status
  radioReconnectAttempts: 0, radioLastConnectTime: 0,
  // Grammar learning stats
  grammarStats: null, grammarSamplesApplied: 0,
};

export default function Page() {
  const engineRef = useRef<PsyLive4 | null>(null);
  const [s, setS] = useState<LiveState4>(initialState);
  const [ready, setReady] = useState(false);
  const [bpm, setBpm] = useState(145);
  const [power, setPower] = useState(false);
  // OPENING SCREEN: separate from power. The idle screen shows on first load.
  // Clicking ENTER goes to the synth UI WITHOUT auto-starting Play.
  // User then clicks POWER from inside the synth UI to actually start audio.
  // After entering, we don't return to the idle screen — it's only the opener.
  const [entered, setEntered] = useState(false);
  const [arpOn, setArpOn] = useState(false);
  const [seqOn, setSeqOn] = useState(false);
  const [presetIdx, setPresetIdx] = useState(0);
  const [octave, setOctave] = useState(3);
  const [smartRadioOn, setSmartRadioOn] = useState(false);
  const [learningOn, setLearningOn] = useState(false);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [savedPresets, setSavedPresets] = useState<PsyPreset[]>([]);

  // Synth params (CC values 0..1)
  // Initial values match the FIRST preset (Full-On Rolling) so the engine
  // starts with the manually-tuned sound for that style, not random defaults.
  const [ccParams, setCcParams] = useState<Record<number, number>>({
    5: 0.10, 9: 0.7, 12: 0.75, 13: 0.2, 14: 0.30, 15: 0.20,
    20: 0.0, 21: 0.3, 22: 0.55, 23: 0.2, 71: 0.60, 74: 0.70,
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
    // Initialize user identity BEFORE any API calls
    // This ensures X-User-Id header is sent on the first request
    import('@/lib/user-identity').then(({ getOrCreateUserId }) => {
      const userId = getOrCreateUserId();
      console.log('[Page] user identity:', userId);
    });
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
        // Load learning state from local DB (per-user, scoped by X-User-Id header)
        // Non-blocking — engine works fully offline
        engine.loadCloudState().then(loaded => {
          if (loaded > 0) {
            // Sync the ccParams UI state with loaded values
            const cloudParams = engine.getState().ccParams;
            setCcParams(prev => ({ ...prev, ...cloudParams }));
          }
        }).catch(() => {});
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
    // Cycle through built-in presets + saved presets.
    // Built-in presets now ship with MANUALLY-TUNED CC values + FX per style
    // (see PRESETS array). Don't override ccParams with {} — use the real values.
    const allPresets = [
      ...PRESETS.map(p => ({
        name: p.name,
        style: p.style,
        bpm: p.bpm,
        energy: p.energy,
        ccParams: p.ccParams,   // ← use the tuned values, was: {}
        fx: p.fx,               // ← use the tuned values, was: defaults
      })),
      ...savedPresets.map(p => ({
        name: p.name,
        style: p.style as MusicalStyle,
        bpm: p.bpm,
        energy: p.energy,
        ccParams: p.ccParams,
        fx: p.fx,
      })),
    ];
    const next = (presetIdx + 1) % allPresets.length;
    const p = allPresets[next];
    setPresetIdx(next < PRESETS.length ? next : 0);  // built-in index or 0 for saved
    setBpm(p.bpm);
    engineRef.current?.setBPM(p.bpm);
    engineRef.current?.setStyle(p.style);
    engineRef.current?.setEnergy(p.energy);
    // Apply CC params (per-style tuning: cutoff, reso, glide, energy, delay, verb)
    if (p.ccParams && Object.keys(p.ccParams).length > 0) {
      setCcParams(prev => ({ ...prev, ...p.ccParams }));
      for (const [cc, val] of Object.entries(p.ccParams)) {
        engineRef.current?.setCC(parseInt(cc), val as number);
      }
    }
    // Apply FX (per-style drive/delay/reverb/volume)
    if (p.fx) {
      setDrive(p.fx.drive);
      setDelay(p.fx.delay);
      setReverb(p.fx.reverb);
      setVolume(p.fx.volume);
      engineRef.current?.setMasterVolume(p.fx.volume);
    }
  }, [presetIdx, savedPresets]);

  const onParam = useCallback((cc: number, value: number) => {
    setCcParams(prev => ({ ...prev, [cc]: value }));
    engineRef.current?.setCC(cc, value);
  }, []);

  const onVolume = useCallback((v: number) => {
    setVolume(v);
    engineRef.current?.setMasterVolume(v);
  }, []);

  // FX knobs — must call setCC so the engine actually changes the send amounts.
  // Without this, turning the Delay/Reverb knob changed the UI display but
  // had ZERO effect on the audio (the psysynth voices never got the new CC value).
  const onDelay = useCallback((v: number) => {
    setDelay(v);
    engineRef.current?.setCC(14, v);   // CC14 = delay send
  }, []);

  const onReverb = useCallback((v: number) => {
    setReverb(v);
    engineRef.current?.setCC(15, v);   // CC15 = reverb send
  }, []);

  const onDrive = useCallback((v: number) => {
    setDrive(v);
    // Drive is not a CC — it's the saturation stage's input level.
    // We don't have a direct drive control, but we can nudge CC12 (energy macro)
    // which affects the melodic device's drive parameter.
    engineRef.current?.setCC(12, v * 0.5 + 0.5);
  }, []);

  const onNoteOn = useCallback((midi: number) => { engineRef.current?.noteOn(midi); }, []);
  const onNoteOff = useCallback((midi: number) => { engineRef.current?.noteOff(midi); }, []);

  const onToggleStep = useCallback((i: number) => {
    setSeqSteps(prev => prev.map((st, j) => j === i ? !st : st));
  }, []);

  const onSmartRadio = useCallback(async () => {
    const newOn = !smartRadioOn;
    setSmartRadioOn(newOn);
    await engineRef.current?.setSmartRadio(newOn);
  }, [smartRadioOn]);

  // Manual reset — user clicked RESET button in Smart Radio UI.
  // Clears failed-stream memory + reconnects from scratch.
  const onResetRadio = useCallback(async () => {
    await engineRef.current?.resetRadio();
  }, []);

  const onLearning = useCallback(() => {
    const newOn = !learningOn;
    setLearningOn(newOn);
    engineRef.current?.setLearning(newOn);
  }, [learningOn]);

  // ── Keyboard shortcuts ──
  // On the opening screen: Enter / Space triggers ENTER (goes into the workstation
  //   without starting audio). Once entered: Space toggles POWER, R toggles radio,
  //   L toggles learning, 1-7 selects preset.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Opening screen: Enter / Space enters the workstation (no audio)
      if (!entered) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setEntered(true);
        }
        return;
      }
      // Inside the workstation
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
            // Apply the manually-tuned CC + FX for this style (was: skipped)
            if (p.ccParams) {
              setCcParams(prev => ({ ...prev, ...p.ccParams }));
              for (const [cc, val] of Object.entries(p.ccParams)) {
                engineRef.current?.setCC(parseInt(cc), val as number);
              }
            }
            if (p.fx) {
              setDrive(p.fx.drive);
              setDelay(p.fx.delay);
              setReverb(p.fx.reverb);
              setVolume(p.fx.volume);
              engineRef.current?.setMasterVolume(p.fx.volume);
            }
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entered, onPower, onSmartRadio, onLearning]);

  const onExportMIDI = useCallback(() => {
    engineRef.current?.exportMIDI(8);
  }, []);

  const onExportWAV = useCallback(() => {
    engineRef.current?.exportWAV(8);
  }, []);

  if (!ready) {
    return (
      <div className="pf-root">
        <div className="pf-wrap" style={{ textAlign: 'center', padding: '60px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <div className="pf-lg"><b>PsyForge</b> <i>4</i></div>
          <div style={{ width: '40px', height: '40px', border: '3px solid var(--pf-ln)', borderTopColor: 'var(--pf-ac)', borderRadius: '50%', animation: 'pf-spin 0.8s linear infinite' }} />
          <div style={{ color: 'var(--pf-dm)', fontSize: '13px' }}>Initializing audio engine…</div>
          <style>{`@keyframes pf-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-root">
      <div className="pf-wrap">
        {/* Header only renders AFTER entering. On the opening screen we show
            just the ENTER card — no synth controls visible until the user
            chooses to enter the workstation. */}
        {entered && (
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
          }}
          onMIDI={onExportMIDI}
          onWAV={onExportWAV}
        />
        )}

        {/* When not entered: show opening screen with ENTER button (does NOT auto-start Play).
            Once entered, we never return here — clicking ENTER goes straight to the
            synth UI with power OFF; user clicks POWER from inside to start audio.
            Layout: brand → big spectrum → button → features. No dead zones. */}
        {!entered ? (
          <div className="pf-idle">
            <div className="pf-idle-card" style={{ display: 'flex', flexDirection: 'column', maxWidth: '1080px', width: '100%', minHeight: 'calc(100vh - 32px)' }}>
              {/* TOP: brand (compact) */}
              <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                <div className="pf-idle-logo"><b>PsyForge</b> <i>4</i></div>
                <div className="pf-idle-subtitle">Psytrance Workstation · in-browser synthesis + radio learning</div>
              </div>
              {/* MIDDLE: big spectrum preview — the focal point, fills the available space */}
              <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '180px', width: '100%' }}>
                <div className="pf-idle-spectrum" aria-hidden="true" style={{ flex: '1 1 auto', height: 'auto', minHeight: '180px' }}>
                  {Array.from({ length: 56 }).map((_, i) => (
                    <span
                      key={i}
                      className="pf-idle-bar"
                      style={{
                        animationDelay: `${(i * 0.045).toFixed(2)}s`,
                        animationDuration: `${(0.9 + (i % 9) * 0.10).toFixed(2)}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
              {/* BELOW SPECTRUM: single-line tagline + ENTER button — small gap above for breathing room */}
              <div style={{ flex: '0 0 auto', textAlign: 'center', marginTop: '18px', marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', color: 'var(--pf-tx)', opacity: 0.85, letterSpacing: '0.03em', marginBottom: '12px' }}>
                  Audio starts when you press <strong style={{ color: 'var(--pf-tx)', opacity: 1, fontWeight: 800 }}>POWER</strong> inside the workstation.
                </div>
                <button
                  className="pf-btn pf-idle-enter"
                  onClick={() => setEntered(true)}
                  style={{ width: '100%', maxWidth: '460px', padding: '14px 24px', fontSize: '14px', letterSpacing: '0.06em', fontWeight: 800 }}
                >
                  ENTER WORKSTATION →
                </button>
              </div>
              {/* BOTTOM: feature highlights — horizontal pill row, no center hollow */}
              <div style={{ flex: '0 0 auto' }}>
                <div className="pf-idle-features" style={{ maxWidth: '100%', marginTop: '0' }}>
                  <span>7 Styles</span>
                  <span>Smart Radio</span>
                  <span>Learning Loop</span>
                  <span>MIDI / WAV Export</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
        /* 2-column layout: synth rack left, intelligence right.
           Renders whenever entered === true. When power is OFF, panels still
           render — the user can tweak knobs, start Radio/Learning, etc.
           Pressing POWER (in the header) starts audio. */
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
              <FxSection drive={drive} onDrive={onDrive} delay={delay} onDelay={onDelay} reverb={reverb} onReverb={onReverb} volume={volume} onVolume={onVolume} />
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
              onReset={onResetRadio}
              streamName={s.radioStreamName}
              detectedBpm={s.radioDetectedBpm}
              bpmConfidence={s.radioBpmConfidence}
              currentStyle={s.style}
              energy={s.energy}
              reconnectAttempts={s.radioReconnectAttempts}
              lastConnectTime={s.radioLastConnectTime}
            />
            <LearningPanel
              on={learningOn}
              onToggle={onLearning}
              states={s.learningStates}
              currentCc={s.learningCurrentCc}
              trialRemaining={s.learningTrialRemaining}
              convergence={s.convergence}
              convergenceHistory={s.convergenceHistory}
              learningErrors={s.learningErrors}
              patternCount={s.patternCount}
              radioMixMode={s.radioMixMode}
              onRadioMixMode={(mode) => engineRef.current?.setRadioMixMode(mode)}
              radioConnected={s.smartRadioOn}
              cloudSync={s.cloudSync}
              grammarStats={s.grammarStats}
              grammarSamplesApplied={s.grammarSamplesApplied}
            />
          </div>
        </div>
        )}

        {entered && (
          <StatusStrip state={s} arpOn={arpOn} seqOn={seqOn} />
        )}
      </div>
    </div>
  );
}
