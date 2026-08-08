/**
 * HARDWARE-BOUNDARY REALITY MATRIX — scientifically honest classification.
 *
 * For every reference hardware device, classifies:
 *   - REAL HARDWARE BEHAVIOR: what the physical box does
 *   - DIGITAL-TWIN COVERAGE: what the software twin faithfully models
 *   - UNPROVEN HARDWARE-SPECIFIC BEHAVIOR: what cannot be proven in software
 *   - CONFIDENCE: 0..1 how close the twin is to the hardware
 *
 * The purpose is NOT to weaken the project. It is to make the proof
 * scientifically honest. The digital twin proves the ARCHITECTURE works as a
 * coherent musical system in software. It does NOT prove hardware equivalence.
 */

export interface HardwareBoundaryEntry {
  device: string;
  realHardwareBehavior: string;
  digitalTwinCoverage: string;
  unprovenHardwareBehavior: string;
  confidence: number;       // 0..1
  classification: 'REAL_DSP' | 'SIMULATED_CONTROL' | 'HARDWARE_REQUIRED';
}

export const HARDWARE_BOUNDARY_MATRIX: HardwareBoundaryEntry[] = [
  {
    device: 'Moog Muse (Muse-V)',
    realHardwareBehavior: 'Dual discrete analog VCOs with natural drift; transistor ladder filter with thermal noise; spring reverb; hands-on knobs',
    digitalTwinCoverage: 'PolyBLEP oscillators (saw/square/triangle), Huovilainen Moog ladder model with tanh saturation, ADSR, paraphonic voice allocation, LFO filter modulation',
    unprovenHardwareBehavior: 'True analog VCO drift/thermal noise; spring reverb physical acoustics; the exact Moog transistor ladder transfer function; knob tactile response',
    confidence: 0.55,
    classification: 'REAL_DSP',
  },
  {
    device: 'Moog Subsequent 37 (SubBass-V)',
    realHardwareBehavior: '2 analog VCOs + sub oscillator; multidrive ladder filter; true analog saturation curve; mono voice',
    digitalTwinCoverage: 'Dual oscillator + sub osc; Huovilainen ladder with tanh; multidrive pre-filter saturation; mono note priority; glide',
    unprovenHardwareBehavior: 'Exact multidrive saturation curve; analog component tolerance; the specific Sub37 ladder feedback response',
    confidence: 0.60,
    classification: 'REAL_DSP',
  },
  {
    device: 'Sequential Prophet-6 (Prophet-V)',
    realHardwareBehavior: '6 true analog voices; 2 VCOs per voice; 4-pole filter; BBD chorus with clock noise',
    digitalTwinCoverage: '6-voice polyphonic allocation; dual osc per voice; MoogLadder filter; modulated-delay chorus; voice stealing',
    unprovenHardwareBehavior: 'BBD chorus clock noise/analog artifacts; true discrete VCO stability; the exact Prophet-6 filter character',
    confidence: 0.50,
    classification: 'REAL_DSP',
  },
  {
    device: 'Waldorf Iridium (Iridium-V)',
    realHardwareBehavior: 'Wavetable + granular + FM engines; hardware mod matrix; FPGA DSP; multitimbral',
    digitalTwinCoverage: 'Wavetable scan/morph; FM via phase modulation; granular cloud (random buffer reads); SVF filter; shimmer reverb + delay',
    unprovenHardwareBehavior: 'Exact Waldorf wavetable content; FPGA-level DSP precision; the hardware mod matrix routing flexibility; multitimbrality',
    confidence: 0.45,
    classification: 'REAL_DSP',
  },
  {
    device: 'Elektron Analog Rytm MKII (Rytm-V)',
    realHardwareBehavior: '8 analog drum voices; analog distortion; sample layering; parameter locks; retrigs; probability',
    digitalTwinCoverage: 'Synthesized kick/snare/hat/clap/tom/cym via osc+noise+filter+env; sample triggers; parameter locks; retrigs; probability gates',
    unprovenHardwareBehavior: 'Exact analog drum voice circuits; the analog distortion character; hardware parameter lock timing',
    confidence: 0.55,
    classification: 'REAL_DSP',
  },
  {
    device: 'Elektron Digitakt II (Digitakt-V)',
    realHardwareBehavior: '8 stereo sample tracks; resampling buffer; MIDI sequencing; Elektron sequencer',
    digitalTwinCoverage: 'Sample playback with pitch/start/length; resample buffer capture+retrigger; sample triggers; stereo panning',
    unprovenHardwareBehavior: 'Exact Elektron warp/time-stretch; hardware MIDI sequencing to external gear; the specific Elektron workflow UI',
    confidence: 0.60,
    classification: 'REAL_DSP',
  },
  {
    device: 'Eventide H90 (H90-V)',
    realHardwareBehavior: 'Dual algorithm chains; Eventide reverb/pitch/delay/mod algorithms; hardware DSP',
    digitalTwinCoverage: 'Shimmer reverb (Schroeder+pitch), feedback delay (capped), phaser, chorus, distortion, bitcrush; algorithm switching',
    unprovenHardwareBehavior: 'Exact Eventide algorithm implementations (Blackhole, Shimmer, Micropitch proprietary); the H90 hardware UI; algorithm-specific DSP',
    confidence: 0.35,
    classification: 'REAL_DSP',
  },
  {
    device: 'Universal Audio Apollo x8p (Apollo-V)',
    realHardwareBehavior: '8 Unison preamps; UAD DSP; Thunderbolt; zero-latency monitoring; console routing',
    digitalTwinCoverage: '8-channel summing; per-channel gain/pan/FX send; insert loop to H90; resample bus output; master limiter',
    unprovenHardwareBehavior: 'Unison preamp modeling; UAD plugin DSP; Thunderbolt driver; the actual analog preamp circuits',
    confidence: 0.40,
    classification: 'SIMULATED_CONTROL',
  },
  {
    device: 'Ableton Live 12 Suite (Live-V)',
    realHardwareBehavior: 'Full DAW: Session/Arrangement, warp, devices, Max for Live, MIDI generation, mastering',
    digitalTwinCoverage: 'Master transport/clock; arrangement sections; master chain (EQ+comp+limiter); recording; this IS the real implementation',
    unprovenHardwareBehavior: 'None — the Live twin IS the real implementation (not hardware). It does NOT model Live; it implements the equivalent orchestration in TS.',
    confidence: 0.80,
    classification: 'REAL_DSP',
  },
];

export interface BoundarySummary {
  totalDevices: number;
  realDsp: number;
  simulatedControl: number;
  hardwareRequired: number;
  averageConfidence: number;
  /** Honest statement: the digital twin proves the ARCHITECTURE, not hardware equivalence. */
  honestStatement: string;
}

export function computeBoundarySummary(): BoundarySummary {
  const total = HARDWARE_BOUNDARY_MATRIX.length;
  const realDsp = HARDWARE_BOUNDARY_MATRIX.filter((e) => e.classification === 'REAL_DSP').length;
  const simControl = HARDWARE_BOUNDARY_MATRIX.filter((e) => e.classification === 'SIMULATED_CONTROL').length;
  const hwRequired = HARDWARE_BOUNDARY_MATRIX.filter((e) => e.classification === 'HARDWARE_REQUIRED').length;
  const avgConf = HARDWARE_BOUNDARY_MATRIX.reduce((a, e) => a + e.confidence, 0) / total;
  return {
    totalDevices: total,
    realDsp,
    simulatedControl: simControl,
    hardwareRequired: hwRequired,
    averageConfidence: Math.round(avgConf * 100) / 100,
    honestStatement: `The digital twin proves the ARCHITECTURE works as a coherent musical system in software (avg confidence ${(avgConf * 100).toFixed(0)}%). It does NOT prove hardware equivalence. Real Moog/Elektron/Eventide/UA hardware is required to prove hardware-specific behavior. The DSP is REAL (samples are computed), the control logic is SIMULATED (mirrors hardware workflows), and the physical devices are EXTERNAL HARDWARE REQUIREMENTS.`,
  };
}
