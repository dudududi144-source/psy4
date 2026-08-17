/**
 * PSY4 Composition Worker v2 — Deterministic, sample-based
 *
 * Architecture:
 *   - Runs on Web Worker (off main thread)
 *   - Composes 3 bars ahead, sends events as Float64Array (Transferable)
 *   - Uses mulberry32 seeded PRNG (deterministic)
 *   - 64-bar arrangement: INTRO → GROOVE → DROP → BREAKDOWN → REBUILD
 *   - Bass moves every 2 bars (I-IV-V-IV-iii cycle)
 *   - Lead/acid/pad enter at arrangement sections
 *
 * Event format: Float64Array [at, voiceId, note, vel, dur, param] × N
 *   at = AudioContext time
 *   voiceId = 0-14 (kick/bass/lead/acid/pad/hat/hatOpen/clap/perc/shaker/texture/riser/impact/sweep/snare)
 *   note = MIDI note
 *   vel = 0..1
 *   dur = seconds
 *   param = unused (0)
 */

// ─── mulberry32 PRNG (deterministic) ───────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Voice IDs (must match engine) ─────────────────────────────────────────
const V_KICK = 0, V_BASS = 1, V_LEAD = 2, V_ACID = 3, V_PAD = 4;
const V_HAT = 5, V_HAT_OPEN = 6, V_CLAP = 7, V_PERC = 8, V_SHAKER = 9;
const V_TEXTURE = 10, V_RISER = 11, V_IMPACT = 12, V_SWEEP = 13, V_SNARE = 14;

// ─── Scales ────────────────────────────────────────────────────────────────
const SCALES = {
  phrygianDominant: [0, 1, 4, 5, 7, 8, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

// ─── Arrangement sections (64-bar cycle with VARIATION per cycle) ──────────
// FIX: Each 64-bar cycle sounds DIFFERENT — cycle 0 is standard, cycle 1+ varies.
// This prevents the "stuck loop" feeling.
function getSection(bar) {
  const p = bar % 64;
  const cycle = Math.floor(bar / 64);
  // Cycle 0: standard arrangement
  if (cycle === 0) {
    if (p < 8) return 'INTRO';
    if (p < 16) return 'GROOVE';
    if (p < 24) return 'DROP';
    if (p < 28) return 'BREAKDOWN';
    if (p < 32) return 'REBUILD';
    if (p < 40) return 'DROP';
    if (p < 44) return 'BREAKDOWN';
    if (p < 52) return 'REBUILD';
    if (p < 60) return 'DROP';
    return 'OUTRO';
  }
  // Cycle 1+: VARIATION — different order, different energy
  // Start with DROP (skip intro), longer breaks, more energy
  if (p < 4) return 'DROP';          // jump straight to drop
  if (p < 8) return 'BREAKDOWN';     // quick break
  if (p < 24) return 'DROP';         // long drop
  if (p < 32) return 'BREAKDOWN';    // long breakdown (pad-heavy)
  if (p < 48) return 'REBUILD';     // long rebuild with acid
  if (p < 56) return 'DROP';         // final drop
  if (p < 60) return 'BREAKDOWN';
  return 'OUTRO';
}

// ─── Bass root movement (I-IV-V-IV-iii, changes every 2 bars) ──────────────
const BASS_ROOT_SHIFTS = [0, 0, 0, 0, 5, 5, 5, 5, 7, 7, 7, 7, 5, 5, 3, 3];

class CompositionWorkerV2 {
  constructor(opts) {
    this.opts = { ...opts };
    this.bpm = opts.bpm || 145;
    this.rootPc = opts.rootPc || 0;
    this.seed = opts.seed || 42;
    this.rng = mulberry32(this.seed);
    this.scale = SCALES.phrygianDominant;
    this.userEnergy = 0.5;
    this.userTension = 0.3;
    this.userStyle = 'FULL_ON';
    this.lastComposedBar = -1;
  }

  setControls(controls) {
    if (controls.energy !== undefined) this.userEnergy = controls.energy;
    if (controls.tension !== undefined) this.userTension = controls.tension;
    if (controls.style !== undefined) {
      this.userStyle = controls.style;
      // Scale per style
      const scaleMap = {
        FULL_ON: 'phrygianDominant',
        DARK: 'phrygian',
        PROGRESSIVE: 'dorian',
        ACID: 'phrygianDominant',
      };
      this.scale = SCALES[scaleMap[controls.style]] || SCALES.phrygianDominant;
    }
  }

  setBPM(bpm) { this.bpm = bpm; }
  setRoot(rootPc) { this.rootPc = ((Math.round(rootPc) % 12) + 12) % 12; }

  /**
   * Compose events for a single bar.
   * Returns array of {at, voiceId, note, vel, dur, param}.
   */
  composeBar(bar, barOriginAudioTime) {
    const events = [];
    const beatDur = 60 / this.bpm;
    const stepDur = beatDur / 4; // 16th notes
    const barStart = barOriginAudioTime + bar * 4 * beatDur;
    const section = getSection(bar);
    const velScale = 0.7 + this.userEnergy * 0.3;

    // FIX: Root note CHANGES every 64 bars (per cycle) for harmonic variety
    // Cycle 0: rootPc (default), Cycle 1: +5 (fourth), Cycle 2: +7 (fifth), Cycle 3: +3 (minor third)
    const cycle = Math.floor(bar / 64);
    const rootShifts = [0, 5, 7, 3, 10, 2];  // I, IV, V, iii, vi, ii
    const cycleRootShift = rootShifts[cycle % rootShifts.length];
    const effectiveRootPc = (this.rootPc + cycleRootShift) % 12;

    // Bass root (moves every 2 bars)
    const shiftIdx = Math.floor(bar / 2) % BASS_ROOT_SHIFTS.length;
    const bassRoot = effectiveRootPc + 33 + BASS_ROOT_SHIFTS[shiftIdx]; // MIDI 33 = C1
    const subRoot = bassRoot - 12; // sub octave below

    // Lead root (octave above bass)
    const leadRoot = effectiveRootPc + 60 + BASS_ROOT_SHIFTS[shiftIdx];

    // ── KICK: 4-on-the-floor (always) ──
    for (let beat = 0; beat < 4; beat++) {
      const vel = beat === 0 ? 0.95 : 0.85;
      events.push({
        at: barStart + beat * beatDur,
        voiceId: V_KICK,
        note: 36,
        vel: Math.min(1, vel * velScale),
        dur: beatDur * 0.8,
        param: 0,
      });
    }

    // ── BASS: rolling 16ths (always except BREAKDOWN) ──
    if (section !== 'BREAKDOWN' && section !== 'OUTRO') {
      const acidBass = (section === 'DROP' || section === 'REBUILD') && this.userStyle === 'ACID';
      for (let step = 0; step < 16; step++) {
        // Offbeat pattern: strong on steps 0,4,8,12 (downbeats), lighter on others
        const isDownbeat = step % 4 === 0;
        const isAfterKick = step % 4 === 2;
        if (isDownbeat || isAfterKick || this.rng() < 0.3) {
          const vel = isDownbeat ? 0.8 : (isAfterKick ? 0.6 : 0.4);
          const noteOffset = this.scale[step % this.scale.length] - this.scale[0];
          events.push({
            at: barStart + step * stepDur,
            voiceId: acidBass ? V_ACID : V_BASS,
            note: bassRoot + noteOffset,
            vel: Math.min(1, vel * velScale),
            dur: stepDur * 0.9,
            param: 0,
          });
        }
      }
    }

    // ── HATS: 8th notes (GROOVE, DROP, REBUILD) ──
    if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
      for (let step = 0; step < 16; step += 2) {
        const isOpen = step % 8 === 6; // open hat on offbeat
        events.push({
          at: barStart + step * stepDur,
          voiceId: isOpen ? V_HAT_OPEN : V_HAT,
          note: 60,
          vel: Math.min(1, (isOpen ? 0.3 : 0.4) * velScale),
          dur: stepDur * 0.3,
          param: 0,
        });
      }
    }

    // ── SHAKER: 16th notes (GROOVE, DROP, REBUILD) ──
    if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
      for (let step = 0; step < 16; step++) {
        if (step % 2 === 1) { // offbeats
          events.push({
            at: barStart + step * stepDur,
            voiceId: V_SHAKER,
            note: 70,
            vel: Math.min(1, 0.2 * velScale),
            dur: stepDur * 0.15,
            param: 0,
          });
        }
      }
    }

    // ── PERC: occasional hits (GROOVE, DROP, REBUILD) ──
    if (section === 'GROOVE' || section === 'DROP' || section === 'REBUILD') {
      if (this.rng() < 0.6) {
        const step = 3 + Math.floor(this.rng() * 4) * 4; // steps 3,7,11,15
        events.push({
          at: barStart + step * stepDur,
          voiceId: V_PERC,
          note: 50,
          vel: Math.min(1, 0.4 * velScale),
          dur: stepDur * 0.2,
          param: 0,
        });
      }
    }

    // ── SNARE/CLAP: backbeat (beats 2 & 4) in DROP/REBUILD ──
    if (section === 'DROP' || section === 'REBUILD') {
      for (const beat of [1, 3]) {
        events.push({
          at: barStart + beat * beatDur,
          voiceId: V_SNARE,
          note: 38,
          vel: Math.min(1, 0.5 * velScale),
          dur: stepDur * 0.5,
          param: 0,
        });
        events.push({
          at: barStart + beat * beatDur,
          voiceId: V_CLAP,
          note: 39,
          vel: Math.min(1, 0.4 * velScale),
          dur: stepDur * 0.3,
          param: 0,
        });
      }
    }

    // ── LEAD: melodic motif (DROP, REBUILD) ──
    if (section === 'DROP' || section === 'REBUILD') {
      // 4-note motif on scale tones
      const steps = [0, 4, 8, 12];
      for (let i = 0; i < steps.length; i++) {
        const scaleIdx = Math.floor(this.rng() * this.scale.length);
        const note = leadRoot + this.scale[scaleIdx];
        events.push({
          at: barStart + steps[i] * stepDur,
          voiceId: V_LEAD,
          note: note,
          vel: Math.min(1, 0.5 * velScale),
          dur: stepDur * 2,
          param: 0,
        });
      }
    }

    // ── ACID: TB-303 style (DROP only, if ACID style) ──
    if (section === 'DROP' && this.userStyle === 'ACID') {
      for (let step = 0; step < 16; step++) {
        if (step % 2 === 0 || this.rng() < 0.4) {
          const scaleIdx = Math.floor(this.rng() * this.scale.length);
          events.push({
            at: barStart + step * stepDur,
            voiceId: V_ACID,
            note: leadRoot + this.scale[scaleIdx],
            vel: Math.min(1, 0.5 * velScale),
            dur: stepDur * 0.7,
            param: 0,
          });
        }
      }
    }

    // ── PAD: sustained chord (INTRO, BREAKDOWN) ──
    if (section === 'INTRO' || section === 'BREAKDOWN' || section === 'OUTRO') {
      const chord = [0, 7, 12]; // root + fifth + octave
      for (const interval of chord) {
        events.push({
          at: barStart,
          voiceId: V_PAD,
          note: effectiveRootPc + 48 + interval,
          vel: Math.min(1, 0.3 * velScale),
          dur: 4 * beatDur,
          param: 0,
        });
      }
    }

    // ── RISER: bar before DROP ──
    const nextSection = getSection(bar + 1);
    if (nextSection === 'DROP' && section !== 'DROP') {
      events.push({
        at: barStart,
        voiceId: V_RISER,
        note: 60,
        vel: 0.4,
        dur: 4 * beatDur,
        param: 0,
      });
    }

    // ── IMPACT: at DROP start ──
    if (section === 'DROP' && bar % 8 === 0) {
      events.push({
        at: barStart,
        voiceId: V_IMPACT,
        note: 36,
        vel: 0.5,
        dur: 0.3,
        param: 0,
      });
    }

    // ── SWEEP: at BREAKDOWN start ──
    if (section === 'BREAKDOWN' && bar % 4 === 0) {
      events.push({
        at: barStart,
        voiceId: V_SWEEP,
        note: 60,
        vel: 0.3,
        dur: 4 * beatDur,
        param: 0,
      });
    }

    return events;
  }

  /**
   * Compose a range of bars and return as Float64Array (Transferable).
   */
  composeRange(startBar, endBar, barOriginAudioTime) {
    const allEvents = [];
    for (let bar = startBar; bar < endBar; bar++) {
      const events = this.composeBar(bar, barOriginAudioTime);
      allEvents.push(...events);
    }

    // Convert to Float64Array
    const EVENT_SIZE = 6;
    const buffer = new Float64Array(allEvents.length * EVENT_SIZE);
    for (let i = 0; i < allEvents.length; i++) {
      const e = allEvents[i];
      const base = i * EVENT_SIZE;
      buffer[base] = e.at;
      buffer[base + 1] = e.voiceId;
      buffer[base + 2] = e.note;
      buffer[base + 3] = e.vel;
      buffer[base + 4] = e.dur;
      buffer[base + 5] = e.param;
    }

    return { events: buffer, count: allEvents.length };
  }
}

// ─── Worker entry ──────────────────────────────────────────────────────────
const worker = new CompositionWorkerV2({});

self.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      worker.opts = { ...msg.opts };
      worker.bpm = msg.opts.bpm || 145;
      worker.rootPc = msg.opts.rootPc || 0;
      worker.seed = msg.opts.seed || 42;
      worker.rng = mulberry32(worker.seed);
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'controls': {
      worker.setControls(msg);
      break;
    }
    case 'setBPM': {
      worker.setBPM(msg.bpm);
      break;
    }
    case 'setRoot': {
      worker.setRoot(msg.rootPc);
      break;
    }
    case 'compose': {
      const { startBar, endBar, barOriginAudioTime } = msg;
      const result = worker.composeRange(startBar, endBar, barOriginAudioTime);
      self.postMessage({
        type: 'events',
        events: result.events,
        count: result.count,
        startBar,
        endBar,
      }, [result.events.buffer]);
      break;
    }
  }
};
