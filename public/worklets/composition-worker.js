/**
 * PSY4 Composition Worker — runs CausalComposer on a dedicated thread.
 *
 * ADR-001: Composition on Web Worker
 * The main thread had 6 responsibilities (composition + scheduling + UI + learning
 * + radio + persistence). This caused jitter that affected audio scheduling.
 * This worker isolates composition and enables true parallelism.
 *
 * Communication:
 *   Main thread → Worker:  { type: 'init', opts } | { type: 'controls', energy, tension, style, forcedSection, bars } | { type: 'setBPM', bpm } | { type: 'setRoot', rootPc } | { type: 'setScale', scaleName }
 *   Worker → Main thread: { type: 'events', events: Float64Array } | { type: 'state', state } | { type: 'ready' }
 *
 * The worker composes 3 bars ahead and sends events as a flat Float64Array
 * (Transferable, zero-copy). The main thread forwards these to the AudioWorklet.
 */

// PRNG: mulberry32 — deterministic, seeded. ADR-003.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── CausalState (minimal, from CausalState.ts) ──────────────────────
function createCausalState() {
  return {
    bar: 0,
    tensionLevel: 0,
    unresolvedMaterial: [],
    contrastDebt: 0,
    anticipationLevel: 0,
    grooveStability: 0,
    materials: new Map(),
    withheldMaterialId: null,
    lastGrammaticalChangeBar: 0,
  };
}

function onBarAdvance(state, bar) {
  state.bar = bar;
  state.contrastDebt = Math.min(1, state.contrastDebt + 0.08);
  if (state.withheldMaterialId) {
    state.anticipationLevel = Math.min(1, state.anticipationLevel + 0.12);
  }
  // material familiarity/exhaustion decay
  for (const ms of state.materials.values()) {
    ms.listenerFamiliarity *= 0.98;
    ms.materialExhaustion *= 0.99;
  }
}

function onMaterialPlayed(state, materialId, bar) {
  let ms = state.materials.get(materialId);
  if (!ms) {
    ms = { repetitionCount: 0, listenerFamiliarity: 0, expectationLevel: 0, materialExhaustion: 0, lastPlayedBar: 0 };
    state.materials.set(materialId, ms);
  }
  ms.repetitionCount++;
  ms.listenerFamiliarity = Math.min(1, ms.listenerFamiliarity + 0.15);
  ms.expectationLevel = Math.min(1, ms.expectationLevel + 0.2);
  ms.materialExhaustion = Math.min(1, ms.materialExhaustion + 0.1);
  ms.lastPlayedBar = bar;
  state.grooveStability = Math.min(1, state.grooveStability + 0.05);
}

function onMaterialWithheld(state, materialId) {
  state.withheldMaterialId = materialId;
  state.anticipationLevel = Math.min(1, state.anticipationLevel + 0.2);
  state.grooveStability *= 0.7;
}

function onMaterialReturned(state, materialId) {
  state.withheldMaterialId = null;
  state.anticipationLevel = 0;
  state.contrastDebt = 0;
  state.grooveStability = Math.min(1, state.grooveStability + 0.15);
}

function onMaterialVaried(state, materialId) {
  const ms = state.materials.get(materialId);
  if (ms) {
    ms.expectationLevel = 0;
    ms.materialExhaustion *= 0.5;
  }
  state.tensionLevel = Math.min(1, state.tensionLevel + 0.15);
  state.unresolvedMaterial.push(materialId);
}

function onResponseGiven(state, answeredId) {
  state.unresolvedMaterial = state.unresolvedMaterial.filter(m => m !== answeredId);
  state.tensionLevel = Math.max(0, state.tensionLevel - 0.2);
}

function onGrammaticalChange(state, bar) {
  state.contrastDebt = 0;
  state.lastGrammaticalChangeBar = bar;
}

function onNewGridEntered(state) {
  state.grooveStability = Math.min(1, state.grooveStability + 0.1);
}

// ─── Inference Engine (from InferenceEngine.ts) ──────────────────────
const GROOVE_THRESHOLD = 0.3;  // FIX: was 0.6 — took 12 bars (20s) to introduce hats. Now 6 bars (10s).
const EXPECTATION_THRESHOLD = 0.6;
const TENSION_THRESHOLD = 0.5;
const EXHAUSTION_THRESHOLD = 0.7;
const CONTRAST_DEBT_THRESHOLD = 0.7;
const ANTICIPATION_THRESHOLD = 0.6;

function deriveRegisterSpace(activeVoices) {
  const has = (v) => activeVoices.includes(v);
  return {
    'sub': !has('sub') && !has('bass'),
    'low': !has('kick'),
    'low-mid': !has('bass') && !has('snare'),
    'mid': !has('lead') && !has('counterline'),
    'high-mid': !has('lead') && !has('acid') && !has('pad'),
    'high': !has('hat-closed') && !has('hat-open'),
    'ultra-high': !has('shaker') && !has('ride'),
  };
}

function generateCandidates(state, memory, activeVoices) {
  const candidates = [];
  const registerSpace = deriveRegisterSpace(activeVoices);
  const hasHats = activeVoices.includes('hat-closed') || activeVoices.includes('hat');

  // INTRODUCE_HATS
  if (state.grooveStability > GROOVE_THRESHOLD && !hasHats && registerSpace['high']) {
    candidates.push({ action: 'INTRODUCE_HATS', urgency: state.grooveStability > 0.8 ? 0.8 : 0.5, necessity: 'optional' });
  }
  // INTRODUCE_LEAD
  if (state.grooveStability > GROOVE_THRESHOLD && hasHats && !activeVoices.includes('lead') && registerSpace['high-mid']) {
    candidates.push({ action: 'INTRODUCE_LEAD', urgency: 0.6, necessity: 'optional', materialId: 'motif-A' });
  }
  // INTRODUCE_PERCUSSION
  if (state.grooveStability > 0.4 && !activeVoices.includes('percussion') && registerSpace['low-mid']) {  // FIX: was 0.7
    candidates.push({ action: 'INTRODUCE_PERCUSSION', urgency: 0.4, necessity: 'optional' });
  }
  // VARY_MOTIF
  for (const id of state.materials.keys()) {
    if (id.startsWith('motif')) {
      const ms = state.materials.get(id);
      if (ms.expectationLevel > EXPECTATION_THRESHOLD && ms.materialExhaustion < EXHAUSTION_THRESHOLD) {
        candidates.push({ action: 'VARY_MOTIF', urgency: ms.expectationLevel > 0.8 ? 0.8 : 0.5, necessity: 'optional', materialId: id });
      }
    }
  }
  // INTRODUCE_COUNTERLINE
  if (state.tensionLevel > TENSION_THRESHOLD && state.unresolvedMaterial.length > 0 && !activeVoices.includes('counterline') && registerSpace['mid']) {
    candidates.push({ action: 'INTRODUCE_COUNTERLINE', urgency: state.tensionLevel > 0.7 ? 0.7 : 0.5, necessity: 'optional' });
  }
  // TRANSFORM_MOTIF
  for (const id of state.materials.keys()) {
    if (id.startsWith('motif')) {
      const ms = state.materials.get(id);
      if (ms.materialExhaustion > EXHAUSTION_THRESHOLD) {
        candidates.push({ action: 'TRANSFORM_MOTIF', urgency: 0.9, necessity: 'required', materialId: id });
      }
    }
  }
  // BREAKDOWN
  if (state.contrastDebt > CONTRAST_DEBT_THRESHOLD) {
    for (const id of state.materials.keys()) {
      if (id.startsWith('motif')) {
        candidates.push({ action: 'BREAKDOWN', urgency: state.contrastDebt > 0.85 ? 0.9 : 0.6, necessity: state.contrastDebt > 0.9 ? 'required' : 'optional', materialId: id });
        break;
      }
    }
  }
  // CALLBACK_MOTIF
  if (state.anticipationLevel > ANTICIPATION_THRESHOLD && state.withheldMaterialId) {
    candidates.push({ action: 'CALLBACK_MOTIF', urgency: state.anticipationLevel > 0.8 ? 0.9 : 0.6, necessity: state.anticipationLevel > 0.85 ? 'required' : 'optional', materialId: state.withheldMaterialId });
  }
  // THIN_REGISTER
  const occupied = Object.values(registerSpace).filter(e => !e).length;
  if (occupied >= 6) {
    candidates.push({ action: 'THIN_REGISTER', urgency: 0.5, necessity: 'optional' });
  }
  // INTRODUCE_ACID
  if (state.tensionLevel > 0.6 && !activeVoices.includes('acid') && registerSpace['high-mid'] && state.grooveStability > 0.6) {
    candidates.push({ action: 'INTRODUCE_ACID', urgency: state.tensionLevel > 0.8 ? 0.8 : 0.6, necessity: 'optional', materialId: 'acid-A' });
  }
  // INTRODUCE_PAD
  if (state.contrastDebt < 0.3 && !activeVoices.includes('pad') && registerSpace['low-mid'] && state.grooveStability > 0.4 && state.bar > 4) {
    candidates.push({ action: 'INTRODUCE_PAD', urgency: 0.3, necessity: 'optional', materialId: 'pad-A' });
  }
  // RESPONSE
  if (state.unresolvedMaterial.length > 0 && state.tensionLevel > 0.4 && !activeVoices.includes('counterline')) {
    candidates.push({ action: 'RESPONSE', urgency: state.tensionLevel > 0.7 ? 0.8 : 0.5, necessity: state.tensionLevel > 0.8 ? 'required' : 'optional', materialId: state.unresolvedMaterial[0] });
  }

  return candidates;
}

function resolveConflict(candidates) {
  if (candidates.length === 0) return null;
  const required = candidates.filter(c => c.necessity === 'required');
  if (required.length > 0) {
    required.sort((a, b) => b.urgency - a.urgency);
    return required[0];
  }
  const sorted = [...candidates].sort((a, b) => b.urgency - a.urgency);
  return sorted[0];
}

// ─── Style Grammars ──────────────────────────────────────────────────
const STYLE_GRAMMARS = {
  FULL_ON: {
    scaleName: 'phrygian-dominant',
    motifIntervals: [0, 4, 7, 4],
    motifSteps: [0, 4, 8, 12],
    bassPattern: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    acidBass: false,
    percussionDensity: 0.8,
  },
  DARK: {
    scaleName: 'phrygian',
    motifIntervals: [0, 1, 3, 1],
    motifSteps: [0, 6, 8, 14],
    bassPattern: [0, 3, 6, 8, 11, 14],
    acidBass: false,
    percussionDensity: 0.4,
  },
  PROGRESSIVE: {
    scaleName: 'dorian',
    motifIntervals: [0, 3, 5, 7],
    motifSteps: [0, 4, 8, 12],
    bassPattern: [1, 3, 5, 7, 9, 11, 13, 15],
    acidBass: false,
    percussionDensity: 0.6,
  },
  ACID: {
    scaleName: 'phrygian-dominant',
    motifIntervals: [0, 1, 7, 1],
    motifSteps: [0, 4, 8, 12],
    bassPattern: [0, 3, 6, 9, 12, 15],
    acidBass: true,
    percussionDensity: 0.7,
  },
};

// ─── CausalComposer (worker-local) ───────────────────────────────────
class CausalComposerWorker {
  constructor(opts) {
    this.opts = { ...opts };
    this.state = createCausalState();
    this.activeVoices = new Set();
    this.materialIntroBar = new Map();
    this.userEnergy = 0.5;
    this.userTension = 0.3;
    this.userStyle = 'FULL_ON';
    this.forcedSection = null;
    this.forcedBarsRemaining = 0;
    this.rng = mulberry32(opts.seed || 42);
  }

  setEnergy(v) { this.userEnergy = Math.max(0, Math.min(1, v)); }
  setTension(v) { this.userTension = Math.max(0, Math.min(1, v)); }
  setStyle(s) {
    this.userStyle = s;
    const g = STYLE_GRAMMARS[s];
    if (g) this.opts.scaleName = g.scaleName;
  }
  forceSection(section, bars) { this.forcedSection = section; this.forcedBarsRemaining = Math.max(1, bars); }
  releaseSection() { this.forcedSection = null; this.forcedBarsRemaining = 0; }
  setBPM(bpm) { this.opts.bpm = Math.max(60, Math.min(200, bpm)); }
  setRoot(rootPc) { this.opts.rootPc = ((Math.round(rootPc) % 12) + 12) % 12; }
  setScale(scaleName) { this.opts.scaleName = scaleName; }

  composeBar(bar) {
    onBarAdvance(this.state, bar);
    if (this.userTension > 0.5) {
      const target = this.userTension;
      this.state.tensionLevel += (target - this.state.tensionLevel) * 0.15;
      this.state.contrastDebt += (this.userTension - 0.5) * 0.05;
    }

    const activeVoicesArr = Array.from(this.activeVoices);
    let decision;
    if (this.forcedSection && this.forcedBarsRemaining > 0) {
      decision = this.buildForcedDecision(this.forcedSection, activeVoicesArr);
      this.forcedBarsRemaining--;
      if (this.forcedBarsRemaining === 0) this.forcedSection = null;
    } else {
      const candidates = generateCandidates(this.state, null, activeVoicesArr);
      const selected = resolveConflict(candidates);
      if (!selected) {
        decision = { action: 'NO_CHANGE', selected: { action: 'NO_CHANGE', whyNow: 'no preconditions met', whyNotYet: '', urgency: 0, necessity: 'optional', enables: [] }, candidates };
      } else {
        decision = { action: selected.action, selected, candidates };
      }
    }

    const events = this.executeDecision(decision, bar);
    if (decision.action !== 'BREAKDOWN') {
      events.push(...this.generateGroove(bar));
    }
    if (decision.action !== 'BREAKDOWN') {
      if (this.activeVoices.has('lead')) onMaterialPlayed(this.state, 'motif-A', bar);
      if (this.activeVoices.has('acid')) onMaterialPlayed(this.state, 'acid-A', bar);
      if (this.activeVoices.has('pad')) onMaterialPlayed(this.state, 'pad-A', bar);
    }

    // Track intro bars for fade-in
    const voicesBefore = new Set(this.materialIntroBar.keys());
    for (const v of this.activeVoices) {
      if (!voicesBefore.has(v)) this.materialIntroBar.set(v, bar);
    }
    for (const tracked of Array.from(this.materialIntroBar.keys())) {
      if (!this.activeVoices.has(tracked)) this.materialIntroBar.delete(tracked);
    }
    this.applyFadeIn(events, bar);

    return { bar, decision, events, stateAfter: this.snapshotState() };
  }

  snapshotState() {
    const motifState = this.state.materials.get('motif-A');
    return {
      tensionLevel: this.state.tensionLevel,
      contrastDebt: this.state.contrastDebt,
      anticipationLevel: this.state.anticipationLevel,
      grooveStability: this.state.grooveStability,
      expectationLevel: motifState?.expectationLevel ?? 0,
    };
  }

  buildForcedDecision(section, activeVoices) {
    let action;
    if (section === 'BREAK') {
      action = 'BREAKDOWN';
    } else if (section === 'DROP') {
      if (!activeVoices.includes('hat-closed')) action = 'INTRODUCE_HATS';
      else if (!activeVoices.includes('lead')) action = 'INTRODUCE_LEAD';
      else if (!activeVoices.includes('percussion')) action = 'INTRODUCE_PERCUSSION';
      else action = 'NO_CHANGE';
    } else {
      if (!activeVoices.includes('hat-closed')) action = 'INTRODUCE_HATS';
      else if (!activeVoices.includes('lead')) action = 'INTRODUCE_LEAD';
      else if (!activeVoices.includes('percussion')) action = 'INTRODUCE_PERCUSSION';
      else if (!activeVoices.includes('counterline')) action = 'INTRODUCE_COUNTERLINE';
      else action = 'NO_CHANGE';
    }
    return { action, selected: { action, whyNow: 'user override', whyNotYet: '', urgency: 1.0, necessity: 'required', enables: [] }, candidates: [] };
  }

  executeDecision(decision, bar) {
    const events = [];
    const action = decision.action;
    const beatDur = 60 / this.opts.bpm;
    const stepDur = beatDur / 4;
    const barStart = bar * 4 * beatDur;
    const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;
    const velScale = 0.8 + this.userEnergy * 0.4;

    switch (action) {
      case 'INTRODUCE_HATS': {
        this.activeVoices.add('hat-closed');
        onNewGridEntered(this.state);
        for (let step = 2; step < 16; step += 2) {
          const isOpen = step % 8 === 6;
          events.push({ at: barStart + step * stepDur, note: isOpen ? 46 : 42, velocity: Math.min(1, (isOpen ? 0.35 : 0.3) * velScale), duration: stepDur * (isOpen ? 0.8 : 0.3), channel: isOpen ? 'hat-open' : 'hat-closed' });
        }
        this.activeVoices.add('shaker');
        for (let step = 0; step < 16; step++) {
          events.push({ at: barStart + step * stepDur, note: 70, velocity: Math.min(1, (0.15 + (step % 4 === 0 ? 0.1 : 0)) * velScale), duration: stepDur * 0.2, channel: 'shaker' });
        }
        break;
      }
      case 'INTRODUCE_LEAD': {
        this.activeVoices.add('lead');
        onMaterialPlayed(this.state, 'motif-A', bar);
        const root = this.opts.rootPc + 60;
        const steps = grammar.motifSteps;
        const intervals = grammar.motifIntervals;
        for (let i = 0; i < steps.length; i++) {
          events.push({ at: barStart + steps[i] * stepDur, note: root + intervals[i], velocity: Math.min(1, 0.6 * velScale), duration: stepDur * 2, channel: 'lead' });
        }
        break;
      }
      case 'INTRODUCE_PERCUSSION': {
        this.activeVoices.add('percussion');
        onNewGridEntered(this.state);
        for (let step = 6; step < 16; step += 4) {
          events.push({ at: barStart + step * stepDur, note: 50, velocity: Math.min(1, 0.5 * velScale), duration: stepDur * 0.3, channel: 'percussion' });
        }
        break;
      }
      case 'VARY_MOTIF': {
        const shift = 2 + Math.round(this.userTension * 3);
        onMaterialVaried(this.state, 'motif-A');
        const root = this.opts.rootPc + 60 + shift;
        const steps = grammar.motifSteps;
        const intervals = grammar.motifIntervals;
        for (let i = 0; i < steps.length; i++) {
          events.push({ at: barStart + steps[i] * stepDur, note: root + intervals[i], velocity: Math.min(1, 0.65 * velScale), duration: stepDur * 2, channel: 'lead' });
        }
        break;
      }
      case 'INTRODUCE_COUNTERLINE': {
        this.activeVoices.add('counterline');
        const answeredId = this.state.unresolvedMaterial[0] || 'motif-A';
        onResponseGiven(this.state, answeredId);
        const root = this.opts.rootPc + 55;
        const steps = [2, 6, 10, 14];
        const invIntervals = grammar.motifIntervals.map(iv => -iv + 7);
        for (let i = 0; i < steps.length; i++) {
          events.push({ at: barStart + steps[i] * stepDur, note: root + invIntervals[i % invIntervals.length], velocity: Math.min(1, 0.55 * velScale), duration: stepDur * 1.5, channel: 'counterline' });
        }
        break;
      }
      case 'BREAKDOWN': {
        onMaterialWithheld(this.state, 'motif-A');
        onGrammaticalChange(this.state, bar);
        this.activeVoices.delete('lead');
        this.activeVoices.delete('hat-closed');
        this.activeVoices.delete('hat-open');
        this.activeVoices.delete('shaker');
        this.activeVoices.delete('percussion');
        this.activeVoices.delete('counterline');
        this.activeVoices.add('pad');
        const padRoot = this.opts.rootPc + 48;
        events.push({ at: barStart, note: padRoot, velocity: Math.min(1, 0.25 * velScale), duration: 4 * beatDur, channel: 'pad' });
        events.push({ at: barStart, note: padRoot + 7, velocity: Math.min(1, 0.2 * velScale), duration: 4 * beatDur, channel: 'pad' });
        events.push({ at: barStart, note: padRoot + 12, velocity: Math.min(1, 0.15 * velScale), duration: 4 * beatDur, channel: 'pad' });
        // COMMERCIAL FIX: Removed 'drone' — was an unwanted low sound that muddied the mix
        break;
      }
      case 'CALLBACK_MOTIF': {
        onMaterialReturned(this.state, 'motif-A');
        onGrammaticalChange(this.state, bar);
        this.activeVoices.add('lead');
        this.activeVoices.delete('pad');
        this.activeVoices.add('hat-closed');
        this.activeVoices.add('percussion');
        // COMMERCIAL FIX: Removed 'impact' — was an unwanted sound that didn't fit
        const root = this.opts.rootPc + 72;
        const steps = grammar.motifSteps;
        const intervals = grammar.motifIntervals;
        for (let i = 0; i < steps.length; i++) {
          events.push({ at: barStart + steps[i] * stepDur, note: root + intervals[i], velocity: Math.min(1, 0.7 * velScale), duration: stepDur * 2, channel: 'lead' });
        }
        break;
      }
      case 'INTRODUCE_ACID': {
        this.activeVoices.add('acid');
        onMaterialPlayed(this.state, 'acid-A', bar);
        const acidRoot = this.opts.rootPc + 57;
        const acidIntervals = grammar.scaleName === 'phrygian' || grammar.scaleName === 'phrygian-dominant'
          ? [0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 1, 3, 0, 1, 0, 0]
          : [0, 0, 2, 0, 3, 0, 2, 0, 0, 0, 3, 2, 0, 2, 0, 0];
        for (let step = 0; step < 16; step++) {
          const isBeat = step % 4 === 0;
          events.push({ at: barStart + step * stepDur, note: acidRoot + acidIntervals[step], velocity: Math.min(1, (isBeat ? 0.7 : 0.5) * velScale), duration: stepDur * 0.7, channel: 'acid' });
        }
        break;
      }
      case 'INTRODUCE_PAD': {
        this.activeVoices.add('pad');
        onMaterialPlayed(this.state, 'pad-A', bar);
        const padRoot = this.opts.rootPc + 48;
        let chord;
        if (grammar.scaleName === 'phrygian' || grammar.scaleName === 'phrygian-dominant') chord = [0, 1, 7, 12];
        else if (grammar.scaleName === 'dorian') chord = [0, 3, 7, 10];
        else chord = [0, 4, 7, 11];
        for (const interval of chord) {
          events.push({ at: barStart, note: padRoot + interval, velocity: Math.min(1, 0.22 * velScale), duration: 4 * beatDur, channel: 'pad' });
        }
        break;
      }
      case 'RESPONSE': {
        this.activeVoices.add('counterline');
        const answeredId = this.state.unresolvedMaterial[0] || 'motif-A';
        onResponseGiven(this.state, answeredId);
        const root = this.opts.rootPc + 55;
        const invIntervals = grammar.motifIntervals.map(iv => -iv + 7);
        const responseSteps = [2, 6, 10, 14];
        for (let i = 0; i < responseSteps.length; i++) {
          events.push({ at: barStart + responseSteps[i] * stepDur, note: root + invIntervals[i % invIntervals.length], velocity: Math.min(1, 0.55 * velScale), duration: stepDur * 1.5, channel: 'counterline' });
        }
        break;
      }
      case 'THIN_REGISTER': {
        if (this.activeVoices.has('counterline')) this.activeVoices.delete('counterline');
        break;
      }
    }
    return events;
  }

  applyFadeIn(events, bar) {
    for (const ev of events) {
      if (ev.channel === 'kick' || ev.channel === 'bass' || ev.channel === 'sub') continue;
      const introBar = this.materialIntroBar.get(ev.channel);
      if (introBar === undefined) continue;
      const barsSince = bar - introBar;
      if (barsSince === 0) ev.velocity *= 0.3;
      else if (barsSince === 1) ev.velocity *= 0.55;
      else if (barsSince === 2) ev.velocity *= 0.8;
      else if (barsSince === 3) ev.velocity *= 0.95;
    }
  }

  generateGroove(bar) {
    this.activeVoices.add('kick');
    this.activeVoices.add('bass');
    const events = [];
    const beatDur = 60 / this.opts.bpm;
    const stepDur = beatDur / 4;
    const barStart = bar * 4 * beatDur;
    const bassRoot = this.opts.rootPc + 33;
    const subRoot = this.opts.rootPc + 24;
    const velScale = 0.8 + this.userEnergy * 0.4;
    const grammar = STYLE_GRAMMARS[this.userStyle] || STYLE_GRAMMARS.FULL_ON;

    for (let beat = 0; beat < 4; beat++) {
      events.push({ at: barStart + beat * beatDur, note: 36, velocity: Math.min(1, (beat === 0 ? 0.95 : 0.88) * velScale), duration: beatDur * 0.8, channel: 'kick' });
    }

    const phrasePos = bar % 8;
    const bassChannel = grammar.acidBass ? 'acid' : 'bass';
    let bassOffsets = [0];
    if (phrasePos >= 2) bassOffsets = [0, 0];
    if (phrasePos >= 4) bassOffsets = [0, 7];
    if (phrasePos >= 6) bassOffsets = [0, 7, 12];

    for (let i = 0; i < grammar.bassPattern.length; i++) {
      const step = grammar.bassPattern[i];
      const isAfterKick = step % 4 === 1;
      const offset = bassOffsets[i % bassOffsets.length];
      events.push({ at: barStart + step * stepDur, note: bassRoot + offset, velocity: Math.min(1, (isAfterKick ? 0.6 : 0.8) * velScale), duration: stepDur * 0.9, channel: bassChannel });
    }

    if (this.state.grooveStability > 0.5) {
      this.activeVoices.add('sub');
      events.push({ at: barStart, note: subRoot, velocity: 0.4, duration: 4 * beatDur, channel: 'sub' });
    }

    if (this.state.grooveStability > 0.4 && this.userEnergy > 0.3) {
      this.activeVoices.add('snare');
      const build = phrasePos >= 6 ? 1.2 : 1.0;
      events.push({ at: barStart + beatDur, note: 38, velocity: Math.min(1, 0.55 * velScale * build), duration: stepDur * 0.5, channel: 'snare' });
      events.push({ at: barStart + 3 * beatDur, note: 38, velocity: Math.min(1, 0.55 * velScale * build), duration: stepDur * 0.5, channel: 'snare' });
      events.push({ at: barStart + beatDur, note: 39, velocity: Math.min(1, 0.4 * velScale * build), duration: stepDur * 0.3, channel: 'clap' });
      events.push({ at: barStart + 3 * beatDur, note: 39, velocity: Math.min(1, 0.4 * velScale * build), duration: stepDur * 0.3, channel: 'clap' });
    }

    if (this.state.grooveStability > 0.8 && this.userEnergy > 0.6) {
      this.activeVoices.add('ride');
      for (let beat = 0; beat < 4; beat++) {
        events.push({ at: barStart + beat * beatDur + stepDur * 0.5, note: 59, velocity: Math.min(1, 0.2 * velScale), duration: stepDur * 0.3, channel: 'ride' });
      }
    }

    if (phrasePos === 7) {
      for (let s = 0; s < 4; s++) {
        events.push({ at: barStart + 3 * beatDur + s * stepDur, note: 38, velocity: Math.min(1, (0.4 + s * 0.15) * velScale), duration: stepDur * 0.4, channel: 'snare' });
      }
      events.push({ at: barStart + 3 * beatDur + stepDur * 2, note: 45, velocity: Math.min(1, 0.6 * velScale), duration: stepDur * 0.4, channel: 'fill' });
      events.push({ at: barStart + 3 * beatDur + stepDur * 3, note: 50, velocity: Math.min(1, 0.7 * velScale), duration: stepDur * 0.3, channel: 'fill' });
      if (bar % 16 === 15) {
        events.push({ at: barStart, note: 72, velocity: Math.min(1, 0.4 * velScale), duration: 2 * beatDur, channel: 'riser' });
      }
    }

    onMaterialPlayed(this.state, 'groove', bar);
    return events;
  }
}

// ─── Worker message handler ──────────────────────────────────────────
let composer = null;
let lastComposedBar = -1;

self.onmessage = function(e) {
  const msg = e.data;
  switch (msg.type) {
    case 'init': {
      composer = new CausalComposerWorker(msg.opts);
      self.postMessage({ type: 'ready' });
      break;
    }
    case 'compose': {
      if (!composer) return;
      const barOriginAudioTime = msg.barOriginAudioTime;
      const beatDur = 60 / composer.opts.bpm;
      const allEvents = [];
      if (lastComposedBar < msg.targetBar) {
        for (let b = lastComposedBar + 1; b <= msg.targetBar; b++) {
          const result = composer.composeBar(b);
          const evs = result.events;
          for (let i = 0; i < evs.length; i++) {
            evs[i].at += barOriginAudioTime;
            allEvents.push(evs[i]);
          }
          lastComposedBar = b;
        }
      }
      // FIX: Always send a response, even if 0 events.
      // This lets the main thread know we're alive and tracking.
      if (allEvents.length === 0) {
        // No new bars to compose — send empty response
        self.postMessage({ type: 'events', events: new Float64Array(0), count: 0, bar: msg.targetBar });
        return;
      }
      // Convert to flat Float64Array: [at, note, velocity, duration, channelHash, ...]
      // channelHash: map channel string to voice ID number
      const CHANNEL_TO_ID = {
        kick: 0, bass: 1, sub: 1, lead: 2, counterline: 2, motif: 2,
        acid: 3, pad: 4, 'hat-closed': 5, hat: 5, 'hat-open': 6, clap: 7, snare: 7,
        percussion: 8, tom: 8, fill: 8, rim: 8, shaker: 9, ride: 5, crash: 6,
        texture: 10, atmosphere: 10, riser: 11, impact: 12, sweep: 13, zap: 14,
        blip: 15, downlifter: 16, drone: 4, chord: 2,
      };
      const EVENT_SIZE = 6;
      const flat = new Float64Array(allEvents.length * EVENT_SIZE);
      for (let i = 0; i < allEvents.length; i++) {
        const ev = allEvents[i];
        const base = i * EVENT_SIZE;
        flat[base] = ev.at;
        flat[base + 1] = ev.note;
        flat[base + 2] = ev.velocity;
        flat[base + 3] = ev.duration;
        flat[base + 4] = CHANNEL_TO_ID[ev.channel] ?? 0;
        flat[base + 5] = ev.channel === 'sub' ? 1 : (ev.channel === 'counterline' ? 2 : 0); // param
      }
      // Transfer the buffer (zero-copy)
      self.postMessage({ type: 'events', events: flat, count: allEvents.length, bar: msg.targetBar }, [flat.buffer]);
      // Also send state snapshot
      const cs = composer.snapshotState();
      self.postMessage({
        type: 'state',
        state: cs,
        action: composer.activeVoices.size > 0 ? 'COMPOSED' : 'NO_CHANGE',
        activeVoices: Array.from(composer.activeVoices),
      });
      break;
    }
    case 'controls': {
      if (!composer) return;
      if (msg.energy !== undefined) composer.setEnergy(msg.energy);
      if (msg.tension !== undefined) composer.setTension(msg.tension);
      if (msg.style !== undefined) composer.setStyle(msg.style);
      if (msg.forcedSection !== undefined) {
        if (msg.forcedSection) composer.forceSection(msg.forcedSection, msg.bars || 4);
        else composer.releaseSection();
      }
      break;
    }
    case 'setBPM': { if (composer) composer.setBPM(msg.bpm); break; }
    case 'setRoot': { if (composer) composer.setRoot(msg.rootPc); break; }
    case 'setScale': { if (composer) composer.setScale(msg.scaleName); break; }
    case 'reset': {
      if (composer) {
        const opts = composer.opts;
        composer = new CausalComposerWorker(opts);
        lastComposedBar = -1;
      }
      break;
    }
  }
};
