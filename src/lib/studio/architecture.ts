/**
 * FROZEN ARCHITECTURE — Phase 1.
 *
 * The single authoritative definition of the studio rig. Every device, every
 * connection, every role. The digital twin in /devices implements exactly this.
 */

export type DeviceId =
  | 'muse' | 'sub37' | 'prophet6' | 'iridium' | 'rytm'
  | 'digitakt' | 'h90' | 'apollo' | 'live';

export type ImplementationClass =
  | 'REAL_IMPLEMENTATION'
  | 'SIMULATED_HARDWARE_BEHAVIOR'
  | 'EXTERNAL_HARDWARE_REQUIREMENT';

export interface DeviceSpec {
  id: DeviceId;
  name: string;
  make: string;
  role: string;
  section: string;
  implementation: ImplementationClass;
  audioInputs: string[];
  audioOutputs: string[];
  midiInputs: string[];
  midiOutputs: string[];
  clockRelationship: string;
  sequencingResponsibility: string;
  synchronizationSource: string;
  signalProcessing: string;
  performanceResponsibility: string;
  recordingDestination: string;
  resamplingPath: string;
  feedbackSafeRouting: string;
  failureBehavior: string;
  why: string;
  inspiredBy?: string;
}

export const ARCHITECTURE: Record<DeviceId, DeviceSpec> = {
  muse: {
    id: 'muse', name: 'Moog Muse (twin: Muse-V)', make: 'Moog',
    role: 'Main synth voice — analog paraphonic lead/sequence engine',
    section: 'A. Main synth voice',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['— (sound source)'],
    audioOutputs: ['Apollo IN1/IN2 (stereo)'],
    midiInputs: ['Live MIDI A out', 'Rytm clock/transport'],
    midiOutputs: ['Muse MIDI thru → Sub37'],
    clockRelationship: 'Slave to Live master clock',
    sequencingResponsibility: 'Internal arpeggiator + Live note lanes',
    synchronizationSource: 'Live master clock',
    signalProcessing: 'Dual analog VCOs → ladder filter → VCA + spring/feedback FX',
    performanceResponsibility: 'Lead lines, hypnotic arp top-voice, filter sweeps',
    recordingDestination: 'Live track "MUSE" via Apollo IN1/IN2',
    resamplingPath: 'Live capture → resample clip → Digitakt pool',
    feedbackSafeRouting: 'FX send bounded by Apollo return gain; no direct out→in loop',
    failureBehavior: 'Holds last note on MIDI drop; analog audio path stays live',
    why: 'A single analog voice that breathes — the Moog ladder gives psytrance leads the squelch and weight that cuts a dense mix. Paraphonic mode turns it into a hypnotic sequence engine.',
    inspiredBy: 'Moog Muse',
  },
  sub37: {
    id: 'sub37', name: 'Moog Subsequent 37 (twin: SubBass-V)', make: 'Moog',
    role: 'Bass engine — monophonic analog bass + sub design',
    section: 'B. Bass engine',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['— (sound source)'],
    audioOutputs: ['Apollo IN3 (mono → stereo in Live)'],
    midiInputs: ['Muse MIDI thru', 'Live MIDI A out (bass lane)'],
    midiOutputs: ['—'],
    clockRelationship: 'Note-triggered from Live bass lane',
    sequencingResponsibility: 'None — driven by Live sequencer',
    synchronizationSource: 'Live note lane (sample-accurate via Apollo MIDI)',
    signalProcessing: '2 VCOs + sub osc → Moog ladder (multidrive) → VCA',
    performanceResponsibility: 'Live bass, filter modulation, patch tweaks',
    recordingDestination: 'Live track "BASS" via Apollo IN3',
    resamplingPath: 'Capture → resample one-shots → Rytm/Digitakt bass layer',
    feedbackSafeRouting: 'Sub out summed mono, never routed to own FX send',
    failureBehavior: 'Holds last pitch on MIDI fault; analog audio path independent',
    why: 'The tightest, most controllable analog bass for psytrance — multidrive ladder gives saturated mid-bite; sub oscillator locks under the kick. Nothing punches through a kick/bass pair like this.',
    inspiredBy: 'Moog Subsequent 37',
  },
  prophet6: {
    id: 'prophet6', name: 'Sequential Prophet-6 (twin: Prophet-V)', make: 'Sequential',
    role: 'Poly / chord / pad engine — 6-voice true analog polyphony',
    section: 'C. Poly / chord / pad engine',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['— (sound source)'],
    audioOutputs: ['Apollo IN4/IN5 (stereo)'],
    midiInputs: ['Live MIDI B out (chord/pad lane)'],
    midiOutputs: ['—'],
    clockRelationship: 'Note-driven; arp can slave to Live clock',
    sequencingResponsibility: 'Optional onboard arp (slaved); primarily Live-driven',
    synchronizationSource: 'Live note lane + MIDI clock',
    signalProcessing: '2 VCOs/voice → 4-pole filter (LP/HP) → analog VCA + chorus',
    performanceResponsibility: 'Pads, stabs, chord washes, breakdown swells',
    recordingDestination: 'Live track "PADS" via Apollo IN4/IN5',
    resamplingPath: 'Capture long pad tails → Digitakt texture pool',
    feedbackSafeRouting: 'Onboard FX bounded; chorus never fed to its own input',
    failureBehavior: 'Graceful voice-stealing; audio path stays live',
    why: 'True 6-voice analog polyphony — the chorus and round filter make pads that sit under a psytrance mix without eating the lead. Pads here are the "atmospheric layer" the genre lives on.',
    inspiredBy: 'Sequential Prophet-6',
  },
  iridium: {
    id: 'iridium', name: 'Waldorf Iridium Desktop MK2 (twin: Iridium-V)', make: 'Waldorf',
    role: 'Digital / wavetable / evolving texture engine',
    section: 'D. Digital / wavetable / evolving texture engine',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['Apollo IN6 (external audio → Iridium granular)'],
    audioOutputs: ['Apollo IN6/IN7 (stereo)'],
    midiInputs: ['Live MIDI C out (texture lane)'],
    midiOutputs: ['—'],
    clockRelationship: 'Note + clock from Live; LFOs sync to clock',
    sequencingResponsibility: 'None externally; deep internal mod matrix',
    synchronizationSource: 'Live clock + note lane',
    signalProcessing: 'Wavetable + granular + FM → multimode filter → FX + mod matrix',
    performanceResponsibility: 'Evolving textures, spectral movement, granular clouds',
    recordingDestination: 'Live track "TEXTURE" via Apollo IN6/IN7',
    resamplingPath: 'Capture evolving beds → resample → feed back via Apollo IN6',
    feedbackSafeRouting: 'Granular feedback bounded by input limiter on Apollo IN6',
    failureBehavior: 'Internal limiter; audio never exceeds 0 dBFS',
    why: 'Where analog gives weight, Iridium gives motion. Wavetable + granular scan builds the evolving texture layer that makes a track feel alive across 8 minutes. The spectral-movement engine.',
    inspiredBy: 'Waldorf Iridium Desktop MK2',
  },
  rytm: {
    id: 'rytm', name: 'Elektron Analog Rytm MKII (twin: Rytm-V)', make: 'Elektron',
    role: 'Drum and percussion engine — analog + sample hybrid',
    section: 'E. Drum and percussion engine',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['— (sound source)'],
    audioOutputs: ['Apollo IN8 (main) + individual outs optionally'],
    midiInputs: ['Live MIDI D out', 'MIDI in for pattern change'],
    midiOutputs: ['Rytm MIDI thru → Digitakt (clock chain)'],
    clockRelationship: 'Slave to Live (studio) / Master on stage',
    sequencingResponsibility: '64-step seq w/ parameter locks + probability + retrigs',
    synchronizationSource: 'Live MIDI clock (studio) / internal (stage)',
    signalProcessing: '8 analog voices (kick/snare/hat/tom/clap + flex) + samples + analog FX',
    performanceResponsibility: 'Live drums, pattern morphing, perf-mode muting',
    recordingDestination: 'Live track "DRUMS" via Apollo IN8',
    resamplingPath: 'Individual hits → Digitakt sample pool',
    feedbackSafeRouting: 'Analog distortion bounded; no send returned to itself',
    failureBehavior: 'Pattern holds on clock loss; analog voices stay playable',
    why: 'The only drum machine doing analog kick/snare AND sample layering with Elektron sequencing (parameter locks, retrigs, probability). The rhythmic spine — kick/bass relationship starts here.',
    inspiredBy: 'Elektron Analog Rytm MKII',
  },
  digitakt: {
    id: 'digitakt', name: 'Elektron Digitakt II (twin: Digitakt-V)', make: 'Elektron',
    role: 'Sampling / sequencing / resampling engine — stereo sampler + sequencer',
    section: 'F. Sampling / sequencing / resampling engine',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['Apollo IN7 → Digitakt audio in (resampling bus)'],
    audioOutputs: ['Apollo IN8 (shared/sub of Rytm) or dedicated'],
    midiInputs: ['Rytm MIDI thru (clock)', 'Live MIDI E out'],
    midiOutputs: ['—'],
    clockRelationship: 'Slave to Rytm clock chain (or Live)',
    sequencingResponsibility: '8 stereo sample/MIDI tracks; resampling host',
    synchronizationSource: 'Rytm clock (chained) / Live clock',
    signalProcessing: 'Sample playback, warp, filters, LFO, send FX; resample buffer',
    performanceResponsibility: 'Live sample triggering, resample loops, MIDI sequencing',
    recordingDestination: 'Live track "SAMPLES" via Apollo IN8',
    resamplingPath: 'Apollo resampling bus → Digitakt in → buffer → re-trigger',
    feedbackSafeRouting: 'Resample input gated; feedback limited by buffer length + gain cap',
    failureBehavior: 'Buffer overflow → oldest content dropped, audio never crashes',
    why: 'The resampling heart. Every device feeds it; it chops, re-pitches, re-triggers. Stereo sampling + MIDI tracks = it also sequences external gear. The hypnotic-loop engine.',
    inspiredBy: 'Elektron Digitakt II',
  },
  h90: {
    id: 'h90', name: 'Eventide H90 (twin: H90-V)', make: 'Eventide',
    role: 'FX and psychedelic movement — dual-algorithm multi-FX',
    section: 'G. FX and psychedelic movement',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['Apollo insert sends (FX1 stereo in)'],
    audioOutputs: ['Apollo insert returns (FX1 stereo out)'],
    midiInputs: ['Live MIDI F out (PC + clock-synced FX)'],
    midiOutputs: ['—'],
    clockRelationship: 'Slave to Live clock for tempo-synced FX',
    sequencingResponsibility: 'None (PC + expression only)',
    synchronizationSource: 'Live MIDI clock',
    signalProcessing: 'Dual algorithm chains: pitch/shimmer/reverb/delay/phase/mod/destroy',
    performanceResponsibility: 'Live FX morphing, expression sweeps, breakdown washes',
    recordingDestination: 'Printed via Apollo insert returns → Live FX track',
    resamplingPath: 'FX output can feed Digitakt resample bus',
    feedbackSafeRouting: 'Reverb/delay feedback capped at 0.99; pitch algorithms bounded',
    failureBehavior: 'Algorithm overload → graceful bypass, no silence',
    why: 'Eventide algorithms are the psychedelic movement — shimmer, blackhole, micropitch, modfilter. What makes breakdowns open and drops hit. One box, two algorithms, infinite motion.',
    inspiredBy: 'Eventide H90',
  },
  apollo: {
    id: 'apollo', name: 'Universal Audio Apollo x8p (twin: Apollo-V)', make: 'Universal Audio',
    role: 'Audio interface / studio hub — 8-in + DSP monitoring',
    section: 'H. Audio interface / studio hub',
    implementation: 'EXTERNAL_HARDWARE_REQUIREMENT',
    audioInputs: ['IN1-8: all hardware synth outputs + resample bus'],
    audioOutputs: ['OUT1-2 monitors', 'OUT3-4 cue', 'insert sends to H90'],
    midiInputs: ['—'],
    midiOutputs: ['— (MIDI handled by Live over USB)'],
    clockRelationship: 'Audio clock master (sample-accurate for all inputs)',
    sequencingResponsibility: 'None',
    synchronizationSource: 'Internal word clock (master)',
    signalProcessing: '8 Unison preamps + UAD DSP (console routing, monitoring, print FX)',
    performanceResponsibility: 'Zero-latency monitoring; print chain on record',
    recordingDestination: 'All inputs → Live via Thunderbolt',
    resamplingPath: 'Live resampling bus → Apollo OUT → Digitakt IN (analog loop)',
    feedbackSafeRouting: 'Insert loop to H90 bounded; monitor mixer prevents feedback',
    failureBehavior: 'DSP overload → bypass UAD plugins, keep audio path',
    why: '8 inputs = every synth recorded simultaneously, zero-latency Unison monitoring, UAD print chain. The hub that makes the hybrid studio one instrument instead of nine boxes.',
    inspiredBy: 'Universal Audio Apollo x8p',
  },
  live: {
    id: 'live', name: 'Ableton Live 12 Suite (twin: Live-V)', make: 'Ableton',
    role: 'DAW / software layer — sequencer, recorder, arranger, master',
    section: 'I. DAW / software layer',
    implementation: 'REAL_IMPLEMENTATION',
    audioInputs: ['Apollo 8 inputs (all hardware)'],
    audioOutputs: ['Apollo OUT1/2 (monitors)', 'resampling bus → Apollo OUT3 → Digitakt'],
    midiInputs: ['All hardware MIDI returns'],
    midiOutputs: ['MIDI A-E to all hardware', 'MIDI F to H90'],
    clockRelationship: 'MASTER clock for the entire studio',
    sequencingResponsibility: 'Master sequencer — note lanes, clip matrix, arrangement',
    synchronizationSource: 'Internal transport (master)',
    signalProcessing: 'Session/Arrangement, warp, devices, Max for Live, mastering chain',
    performanceResponsibility: 'Clip launching, arrangement, automation, live routing',
    recordingDestination: 'Disk (arrangement + clips)',
    resamplingPath: 'Internal resampling tracks + external via Apollo',
    feedbackSafeRouting: 'Resampling tracks never self-referenced; monitor discipline enforced',
    failureBehavior: 'Dropout protection + automatic delay compensation; launch fails safe',
    why: 'Live 12 is the brain. MIDI generation (12 tools), Session View for performance, Arrangement for production, Max for Live for custom psychedelic devices. The sequencer the whole rig obeys.',
    inspiredBy: 'Ableton Live 12 Suite',
  },
};

export interface GraphEdge {
  from: DeviceId; to: DeviceId; kind: 'audio' | 'midi' | 'clock'; label: string;
}

export const SYSTEM_GRAPH: GraphEdge[] = [
  { from: 'live', to: 'muse', kind: 'clock', label: 'MIDI clock + transport' },
  { from: 'live', to: 'sub37', kind: 'clock', label: 'note lane (sample-accurate)' },
  { from: 'live', to: 'prophet6', kind: 'clock', label: 'MIDI clock + note lane' },
  { from: 'live', to: 'iridium', kind: 'clock', label: 'MIDI clock + note lane' },
  { from: 'live', to: 'rytm', kind: 'clock', label: 'MIDI clock (studio master)' },
  { from: 'live', to: 'digitakt', kind: 'clock', label: 'via Rytm thru' },
  { from: 'live', to: 'h90', kind: 'clock', label: 'MIDI clock (FX sync)' },
  { from: 'live', to: 'muse', kind: 'midi', label: 'MIDI A: lead/arp lane' },
  { from: 'live', to: 'sub37', kind: 'midi', label: 'MIDI A: bass lane' },
  { from: 'live', to: 'prophet6', kind: 'midi', label: 'MIDI B: chord/pad lane' },
  { from: 'live', to: 'iridium', kind: 'midi', label: 'MIDI C: texture lane' },
  { from: 'live', to: 'rytm', kind: 'midi', label: 'MIDI D: pattern change' },
  { from: 'live', to: 'digitakt', kind: 'midi', label: 'MIDI E: sample seq' },
  { from: 'live', to: 'h90', kind: 'midi', label: 'MIDI F: program change' },
  { from: 'muse', to: 'sub37', kind: 'midi', label: 'MIDI thru' },
  { from: 'rytm', to: 'digitakt', kind: 'midi', label: 'MIDI thru (clock chain)' },
  { from: 'muse', to: 'apollo', kind: 'audio', label: 'IN1/IN2 stereo' },
  { from: 'sub37', to: 'apollo', kind: 'audio', label: 'IN3 mono' },
  { from: 'prophet6', to: 'apollo', kind: 'audio', label: 'IN4/IN5 stereo' },
  { from: 'iridium', to: 'apollo', kind: 'audio', label: 'IN6/IN7 stereo' },
  { from: 'rytm', to: 'apollo', kind: 'audio', label: 'IN8 main' },
  { from: 'digitakt', to: 'apollo', kind: 'audio', label: 'IN8 sub' },
  { from: 'apollo', to: 'h90', kind: 'audio', label: 'insert send FX1' },
  { from: 'h90', to: 'apollo', kind: 'audio', label: 'insert return FX1' },
  { from: 'apollo', to: 'digitakt', kind: 'audio', label: 'OUT3 resample bus → Digitakt in' },
  { from: 'apollo', to: 'iridium', kind: 'audio', label: 'IN6 external → Iridium granular' },
  { from: 'apollo', to: 'live', kind: 'audio', label: 'Thunderbolt 8→Live' },
  { from: 'live', to: 'apollo', kind: 'audio', label: 'monitor out OUT1/2' },
];

export const RIG_VISION = `This rig is a single instrument split across nine bodies: Live 12 is the brain and master clock, Apollo x8p is the spine that turns nine boxes into one zero-latency hybrid instrument, and the voice architecture is deliberately non-redundant — Muse and Sub37 share Moog DNA but never overlap (Muse = paraphonic lead/arp top-voice, Sub37 = mono bass locked under the kick), Prophet-6 owns true analog polyphony for pads and stabs, Iridium owns all digital motion (wavetable/granular/FM) so nothing analog is wasted on textures it can't do well, Rytm owns the analog+sample drum spine, Digitakt owns resampling and external sequencing so the whole rig can eat its own tail and mutate, and the H90 owns all psychedelic movement as a single insert loop. Every device has exactly one job; every connection is explained; the rig is built to generate trance journeys, not play presets.`;

export interface RigTier { name: string; devices: DeviceId[]; note: string; }

export const RIG_TIERS: RigTier[] = [
  {
    name: 'Minimal elite version',
    devices: ['sub37', 'rytm', 'digitakt', 'h90', 'apollo', 'live'],
    note: 'Sub37 (bass) + Rytm (drums) + Digitakt (samples/seq) + H90 (motion) + Apollo + Live. The psychoactive core: tight bass, drum spine, resampling loop, movement. Drop Muse, Prophet-6, Iridium — replace with Live instruments. Loses analog lead/poly/texture width; keeps the bass+drums+motion triad.',
  },
  {
    name: 'No-compromise monster version',
    devices: ['muse', 'sub37', 'prophet6', 'iridium', 'rytm', 'digitakt', 'h90', 'apollo', 'live'],
    note: 'All nine devices as specced. Add a second H90 (parallel FX loops for breakdown washes), a separate 8-channel line mixer for the Rytm individual outs, and a Moog Subharmonicon as a fifth analog voice for sub-bass ritual drones. Maximum bandwidth, motion, and cost.',
  },
  {
    name: 'Most practical version',
    devices: ['sub37', 'prophet6', 'rytm', 'digitakt', 'h90', 'apollo', 'live'],
    note: 'Drop Muse (Live+Sub37 cover lead/arp) and Iridium (Live wavetable covers texture). Keep analog bass, analog poly pads, analog+sample drums, resampling, FX, hub, DAW. 80% of the sonic capability at 60% of the cost and cabling complexity.',
  },
];

export const FINAL_RECOMMENDATION: RigTier = {
  name: 'Final recommendation — single best overall rig',
  devices: ['muse', 'sub37', 'prophet6', 'iridium', 'rytm', 'digitakt', 'h90', 'apollo', 'live'],
  note: 'The full 9-device rig. For a serious psytrance producer, the redundancy removed in the "practical" tier is exactly the analog lead (Muse) and digital texture (Iridium) width that separates a good track from a journey. The Muse/Iridium pair is the difference between a rig that sounds like synths and a rig that sounds alive. Keep all nine. The H90 insert loop + Digitakt resampling bus is the psychedelic engine; everything else is voice design. This is the rig.',
};

export const DEVICE_IDS: DeviceId[] = [
  'muse', 'sub37', 'prophet6', 'iridium', 'rytm', 'digitakt', 'h90', 'apollo', 'live',
];
