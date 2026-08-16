// src/psy-sampler/types.ts
function parseChannel(channel) {
  const parts = channel.split(":");
  const role = parts[0];
  const bank = parts.length > 1 && parts[1] ? parts[1] : null;
  return { role, bank };
}
function roleToBus(role) {
  switch (role) {
    case "kick":
    case "hat-closed":
    case "hat-open":
    case "clap":
    case "perc":
      return "drum";
    case "bass":
    case "lead":
      return "music";
    case "texture":
    case "fx":
      return "atmos";
    default:
      return "drum";
  }
}
// src/psy-sampler/provenance.ts
class ProvenanceError extends Error {
  sampleId;
  constructor(message, sampleId) {
    super(message);
    this.sampleId = sampleId;
    this.name = "ProvenanceError";
  }
}
function provenanceFromEntry(entry) {
  return {
    source: entry.source,
    author: entry.author,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    commercialUse: entry.commercialUse,
    attribution: entry.attribution,
    dateAcquired: entry.dateAcquired,
    usageRestrictions: entry.usageRestrictions
  };
}
function validateProvenance(entry) {
  const id = entry.id;
  if (!entry.source || entry.source.trim() === "") {
    throw new ProvenanceError(`Sample "${id}" missing required field: source`, id);
  }
  if (!entry.author || entry.author.trim() === "") {
    throw new ProvenanceError(`Sample "${id}" missing required field: author`, id);
  }
  if (!entry.license || entry.license.trim() === "") {
    throw new ProvenanceError(`Sample "${id}" missing required field: license`, id);
  }
  if (typeof entry.commercialUse !== "boolean") {
    throw new ProvenanceError(`Sample "${id}" missing required field: commercialUse (must be boolean)`, id);
  }
  if (!entry.dateAcquired || entry.dateAcquired.trim() === "") {
    throw new ProvenanceError(`Sample "${id}" missing required field: dateAcquired`, id);
  }
  if (typeof entry.usageRestrictions !== "string") {
    throw new ProvenanceError(`Sample "${id}" missing required field: usageRestrictions`, id);
  }
}
function isCommerciallyUsable(entry) {
  return entry.commercialUse === true;
}
// src/psy-sampler/manifest.ts
class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManifestError";
  }
}
var VALID_VERIFICATIONS = ["VERIFIED", "PROCEDURAL", "UNKNOWN", "QUARANTINED"];
var LOADABLE_VERIFICATIONS = ["VERIFIED", "PROCEDURAL"];
async function loadManifest(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ManifestError(`Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  return validateManifest(data);
}
function validateManifest(data) {
  if (typeof data !== "object" || data === null) {
    throw new ManifestError("Manifest root must be an object");
  }
  const obj = data;
  if (typeof obj.version !== "string") {
    throw new ManifestError('Manifest missing "version" string');
  }
  if (!Array.isArray(obj.samples)) {
    throw new ManifestError('Manifest missing "samples" array');
  }
  const entries = obj.samples;
  const validatedEntries = [];
  for (let i = 0;i < entries.length; i++) {
    const entry = entries[i];
    const validated = validateEntry(entry, i);
    if (!isCommerciallyUsable(validated)) {
      console.warn(`[psy-sampler] Manifest entry "${validated.id}" has commercialUse=false — skipping load.`);
      continue;
    }
    if (!LOADABLE_VERIFICATIONS.includes(validated.verification)) {
      console.warn(`[psy-sampler] Manifest entry "${validated.id}" has verification=${validated.verification} — skipping load (only VERIFIED/PROCEDURAL load at runtime).`);
      continue;
    }
    validateProvenance(validated);
    validatedEntries.push(validated);
  }
  return {
    version: obj.version,
    description: typeof obj.description === "string" ? obj.description : "",
    generated: typeof obj.generated === "string" ? obj.generated : "",
    licensePolicy: typeof obj.licensePolicy === "string" ? obj.licensePolicy : "NEVER assume a random downloaded sample is commercially usable. All imported samples MUST have explicit license metadata.",
    samples: validatedEntries
  };
}
function validateEntry(entry, index) {
  if (typeof entry !== "object" || entry === null) {
    throw new ManifestError(`Manifest entry ${index} must be an object`);
  }
  const e = entry;
  const label = `Manifest entry ${index} ("${e.id ?? "?"}")`;
  const required = [
    "id",
    "file",
    "category",
    "subcategory",
    "source",
    "author",
    "license",
    "licenseUrl",
    "commercialUse",
    "attribution",
    "dateAcquired",
    "usageRestrictions",
    "character",
    "genreFit",
    "bpmRange",
    "rootNote",
    "verification"
  ];
  for (const key of required) {
    if (!(key in e)) {
      throw new ManifestError(`${label} missing field: ${key}`);
    }
  }
  const stringFields = [
    "id",
    "file",
    "category",
    "subcategory",
    "source",
    "author",
    "license",
    "dateAcquired",
    "usageRestrictions"
  ];
  for (const f of stringFields) {
    if (typeof e[f] !== "string") {
      throw new ManifestError(`${label} field "${f}" must be string, got ${typeof e[f]}`);
    }
  }
  if (typeof e.licenseUrl !== "string" && e.licenseUrl !== null) {
    throw new ManifestError(`${label} field "licenseUrl" must be string or null`);
  }
  if (typeof e.attribution !== "string" && e.attribution !== null) {
    throw new ManifestError(`${label} field "attribution" must be string or null`);
  }
  if (typeof e.commercialUse !== "boolean") {
    throw new ManifestError(`${label} field "commercialUse" must be boolean, got ${typeof e.commercialUse}`);
  }
  if (typeof e.rootNote !== "number" || !Number.isFinite(e.rootNote)) {
    throw new ManifestError(`${label} field "rootNote" must be a finite number`);
  }
  if (!Array.isArray(e.character) || !e.character.every((c) => typeof c === "string")) {
    throw new ManifestError(`${label} field "character" must be string[]`);
  }
  if (!Array.isArray(e.genreFit) || !e.genreFit.every((c) => typeof c === "string")) {
    throw new ManifestError(`${label} field "genreFit" must be string[]`);
  }
  if (!Array.isArray(e.bpmRange) || e.bpmRange.length !== 2 || typeof e.bpmRange[0] !== "number" || typeof e.bpmRange[1] !== "number") {
    throw new ManifestError(`${label} field "bpmRange" must be [number, number]`);
  }
  const v = e.verification;
  if (!VALID_VERIFICATIONS.includes(v)) {
    throw new ManifestError(`${label} has invalid verification="${v}" (must be one of ${VALID_VERIFICATIONS.join(", ")})`);
  }
  return e;
}
// src/psy-sampler/loader.ts
class SampleLoader {
  audioContext;
  constructor(audioContext) {
    this.audioContext = audioContext;
  }
  async load(entry) {
    let response;
    try {
      response = await fetch(entry.file);
    } catch (err) {
      console.warn(`[psy-sampler] Network error fetching "${entry.file}":`, err);
      return null;
    }
    if (!response.ok) {
      console.warn(`[psy-sampler] Failed to fetch "${entry.file}": ${response.status} ${response.statusText}`);
      return null;
    }
    let arrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      console.warn(`[psy-sampler] Failed to read body of "${entry.file}":`, err);
      return null;
    }
    let audioBuffer;
    try {
      audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.warn(`[psy-sampler] Failed to decode "${entry.file}":`, err);
      return null;
    }
    const monoData = this.toMono(audioBuffer);
    const features = this.extractFeatures(audioBuffer, monoData);
    return {
      metadata: {
        id: entry.id,
        file: entry.file,
        category: entry.category,
        subcategory: entry.subcategory,
        provenance: provenanceFromEntry(entry),
        character: {
          character: entry.character,
          genreFit: entry.genreFit,
          bpmRange: entry.bpmRange,
          rootNote: entry.rootNote
        },
        duration: features.duration,
        sampleRate: features.sampleRate,
        channels: features.channels
      },
      audioBuffer,
      monoData,
      features
    };
  }
  toMono(buffer) {
    const ch = buffer.numberOfChannels;
    const len = buffer.length;
    if (ch === 1) {
      return buffer.getChannelData(0).slice();
    }
    const mono = new Float32Array(len);
    for (let c = 0;c < ch; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0;i < len; i++) {
        mono[i] += data[i] / ch;
      }
    }
    return mono;
  }
  extractFeatures(buffer, mono) {
    let peak = 0;
    let sumSq = 0;
    for (let i = 0;i < mono.length; i++) {
      const s = Math.abs(mono[i]);
      if (s > peak)
        peak = s;
      sumSq += mono[i] * mono[i];
    }
    const rms = mono.length > 0 ? Math.sqrt(sumSq / mono.length) : 0;
    return {
      peak,
      rms,
      duration: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels
    };
  }
}
// src/psy-sampler/library.ts
class SampleLibrary {
  loader;
  samples = new Map;
  byCategory = new Map;
  subcategories = new Map;
  constructor(loader) {
    this.loader = loader;
  }
  async load(manifestUrl, onProgress) {
    const manifest = await loadManifest(manifestUrl);
    const total = manifest.samples.length;
    let loaded = 0;
    let skipped = 0;
    let completed = 0;
    const CONCURRENCY = 6;
    const entries = manifest.samples;
    let nextIdx = 0;
    const loadNext = async () => {
      while (nextIdx < entries.length) {
        const idx = nextIdx++;
        const entry = entries[idx];
        const asset = await this.loader.load(entry);
        if (asset === null) {
          skipped += 1;
        } else {
          this.add(asset, entry);
          loaded += 1;
        }
        completed += 1;
        onProgress?.(completed, total);
      }
    };
    const workers = [];
    for (let i = 0;i < Math.min(CONCURRENCY, entries.length); i++) {
      workers.push(loadNext());
    }
    await Promise.all(workers);
    return { loaded, skipped, total };
  }
  add(asset, _entry) {
    const id = asset.metadata.id;
    const cat = asset.metadata.category;
    if (this.samples.has(id)) {
      const existingCat = this.samples.get(id).metadata.category;
      const arr = this.byCategory.get(existingCat);
      if (arr) {
        const idx = arr.indexOf(id);
        if (idx >= 0)
          arr.splice(idx, 1);
      }
    }
    this.samples.set(id, asset);
    if (!this.byCategory.has(cat))
      this.byCategory.set(cat, []);
    this.byCategory.get(cat).push(id);
    if (!this.subcategories.has(cat))
      this.subcategories.set(cat, new Set);
    this.subcategories.get(cat).add(asset.metadata.subcategory);
  }
  get(id) {
    return this.samples.get(id);
  }
  query(q) {
    if (q.category) {
      const ids = this.byCategory.get(q.category) ?? [];
      if (q.subcategory) {
        return ids.filter((id) => this.samples.get(id)?.metadata.subcategory === q.subcategory);
      }
      return [...ids];
    }
    return Array.from(this.samples.keys());
  }
  subcategoriesFor(category) {
    return Array.from(this.subcategories.get(category) ?? []);
  }
  list() {
    return Array.from(this.samples.values());
  }
  get size() {
    return this.samples.size;
  }
  get ready() {
    return this.samples.size > 0;
  }
}
// src/psy-sampler/voice.ts
class SampleVoice {
  ctx;
  gainEnv;
  panner;
  currentSource = null;
  currentSourceGain = null;
  _active = false;
  constructor(init) {
    this.ctx = init.audioContext;
    this.gainEnv = this.ctx.createGain();
    this.gainEnv.gain.value = 1;
    this.panner = this.ctx.createStereoPanner();
    this.gainEnv.connect(this.panner);
    this.panner.connect(init.output);
  }
  get active() {
    return this._active;
  }
  trigger(buffer, opts) {
    if (this.currentSource !== null && this.currentSourceGain !== null) {
      const now = this.ctx.currentTime;
      const oldGain = this.currentSourceGain;
      const oldSource = this.currentSource;
      try {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.005);
        oldSource.stop(now + 0.008);
      } catch {}
      oldSource.onended = () => {
        try {
          oldGain.disconnect();
        } catch {}
      };
      this.currentSource = null;
      this.currentSourceGain = null;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = opts.playbackRate;
    const sourceGain = this.ctx.createGain();
    sourceGain.gain.value = 0;
    source.connect(sourceGain);
    sourceGain.connect(this.gainEnv);
    this.currentSource = source;
    this.currentSourceGain = sourceGain;
    this.panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
    const at = Math.max(opts.at, this.ctx.currentTime);
    const gain = Math.max(0.0001, opts.gain);
    sourceGain.gain.cancelScheduledValues(at);
    sourceGain.gain.setValueAtTime(0.0001, at);
    sourceGain.gain.linearRampToValueAtTime(gain, at + 0.001);
    sourceGain.gain.exponentialRampToValueAtTime(0.0001, at + opts.decay);
    source.onended = () => {
      if (this.currentSource === source) {
        this._active = false;
        try {
          sourceGain.disconnect();
        } catch {}
        try {
          source.disconnect();
        } catch {}
        this.currentSource = null;
        this.currentSourceGain = null;
      }
    };
    try {
      source.start(at);
      source.stop(at + opts.decay + 0.05);
    } catch {
      if (this.currentSource === source) {
        try {
          sourceGain.disconnect();
        } catch {}
        try {
          source.disconnect();
        } catch {}
        this.currentSource = null;
        this.currentSourceGain = null;
      }
      this._active = false;
      return;
    }
    this._active = true;
  }
  noteOn(_note, _velocity) {}
  noteOff() {}
  panic() {
    if (this.currentSource !== null) {
      try {
        this.currentSource.stop();
      } catch {}
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    if (this.currentSourceGain !== null) {
      try {
        this.currentSourceGain.disconnect();
      } catch {}
      this.currentSourceGain = null;
    }
    this._active = false;
  }
  connectTo(output) {
    this.panner.disconnect();
    this.panner.connect(output);
  }
}
// src/psy-sampler/variance-rules.ts
var DEFAULT_VARIANCE_RULES = {
  kick: { variants: 4, pitchVar: 0.003, gainVar: 0.045, panVar: 0 },
  bass: { variants: 2, pitchVar: 0.002, gainVar: 0, panVar: 0 },
  lead: { variants: 2, pitchVar: 0.01, gainVar: 0, panVar: 0.1 },
  "hat-closed": { variants: 4, pitchVar: 0.0045, gainVar: 0, panVar: 0.045 },
  "hat-open": { variants: 8, pitchVar: 0.0175, gainVar: 0, panVar: 0.14 },
  clap: { variants: 4, pitchVar: 0.003, gainVar: 0.03, panVar: 0 },
  perc: { variants: 4, pitchVar: 0.005, gainVar: 0.03, panVar: 0.05 },
  texture: { variants: 2, pitchVar: 0.02, gainVar: 0, panVar: 0.2 },
  fx: { variants: 2, pitchVar: 0.02, gainVar: 0, panVar: 0.2 }
};
// src/psy-foundation-shim/voice-pool.ts
class VoicePool {
  voices;
  next = 0;
  maxVoices;
  constructor(voiceFactory, voiceCount) {
    this.voices = Array.from({ length: voiceCount }, () => voiceFactory());
    this.maxVoices = voiceCount;
  }
  allocate() {
    for (let i = 0;i < this.maxVoices; i++) {
      const idx = (this.next + i) % this.maxVoices;
      const v2 = this.voices[idx];
      if (v2 && !v2.active) {
        this.next = (idx + 1) % this.maxVoices;
        return v2;
      }
    }
    const stolen = this.voices[this.next];
    if (stolen)
      stolen.panic();
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.maxVoices;
    return v;
  }
  noteOn(note, velocity) {
    const v = this.allocate();
    v.noteOn(note, velocity);
    return v;
  }
  allOff() {
    for (const v of this.voices)
      v.noteOff();
  }
  panic() {
    for (const v of this.voices)
      v.panic();
  }
  get size() {
    return this.maxVoices;
  }
  get activeCount() {
    let count = 0;
    for (const v of this.voices)
      if (v.active)
        count += 1;
    return count;
  }
  get all() {
    return this.voices;
  }
}

class Rng {
  state;
  constructor(seed) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = this.state + 1831565813 >>> 0;
    let t = this.state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + this.next() * (max - min);
  }
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick(arr) {
    if (arr.length === 0)
      throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)];
  }
}

// src/psy-sampler/selector.ts
var PITCHED_ROLES = new Set(["bass", "lead"]);
function pitchRatio(sourceMidi, targetMidi) {
  if (!Number.isFinite(sourceMidi) || sourceMidi === 0)
    return 1;
  if (!Number.isFinite(targetMidi))
    return 1;
  return Math.pow(2, (targetMidi - sourceMidi) / 12);
}

class SelectionPolicy {
  library;
  defaultDecay;
  varianceRules;
  constructor(library, opts = {}) {
    this.library = library;
    this.varianceRules = opts.varianceRules ?? DEFAULT_VARIANCE_RULES;
    this.defaultDecay = opts.defaultDecay ?? {
      kick: 0.3,
      bass: 0.4,
      lead: 0.5,
      "hat-closed": 0.05,
      "hat-open": 0.2,
      clap: 0.15,
      perc: 0.1,
      texture: 1.5,
      fx: 0.8
    };
  }
  select(input) {
    const candidates = this.findCandidates(input.role, input.bank);
    if (candidates.length === 0)
      return null;
    const variant = this.deriveVariant(input.seed, input.role, input.phraseIndex);
    const sampleId = candidates[variant % candidates.length];
    const rule = this.varianceRules[input.role] ?? DEFAULT_VARIANCE_RULES[input.role];
    const { pitch, gain, pan } = this.deriveVariance(variant, rule);
    const finalGain = Math.max(0, Math.min(1.5, input.velocity * gain));
    const finalPan = Math.max(-1, Math.min(1, pan));
    return { sampleId, playbackRate: pitch, gain: finalGain, pan: finalPan };
  }
  selectWithNote(input, targetMidi) {
    const base = this.select(input);
    if (base === null)
      return null;
    if (!PITCHED_ROLES.has(input.role)) {
      return base;
    }
    const asset = this.library.get(base.sampleId);
    if (!asset)
      return base;
    const rootNote = asset.metadata.character.rootNote;
    const noteRatio = pitchRatio(rootNote, targetMidi);
    return {
      ...base,
      playbackRate: base.playbackRate * noteRatio
    };
  }
  decayFor(role) {
    return this.defaultDecay[role] ?? 0.3;
  }
  reset() {}
  deriveVariant(seed, role, phraseIndex) {
    const rule = this.varianceRules[role] ?? DEFAULT_VARIANCE_RULES[role];
    const variants = rule.variants;
    const combinedSeed = this.hashSeed3(seed, role, Math.max(0, Math.floor(phraseIndex)));
    const rng = new Rng(combinedSeed);
    return rng.int(0, variants - 1);
  }
  deriveVariance(variant, rule) {
    const variants = rule.variants;
    if (variants < 2) {
      return { pitch: 1, gain: 1, pan: 0 };
    }
    const half = (variants - 1) / 2;
    const microVar = variant % variants - half;
    const pitch = 1 + (rule.pitchVar === 0 ? 0 : microVar * rule.pitchVar / half);
    const gain = 1 + (rule.gainVar === 0 ? 0 : microVar * rule.gainVar / half);
    const pan = rule.panVar === 0 ? 0 : microVar * rule.panVar / half;
    return { pitch, gain, pan };
  }
  findCandidates(role, bank) {
    let candidates = this.library.query({ category: role });
    if (bank !== null) {
      const filtered = candidates.filter((id) => {
        const asset = this.library.get(id);
        return asset?.metadata.subcategory === bank;
      });
      if (filtered.length > 0)
        candidates = filtered;
    }
    return candidates;
  }
  hashSeed3(seed, role, phraseIndex) {
    let h = seed >>> 0 ^ phraseIndex * 2654435769;
    for (let i = 0;i < role.length; i++) {
      h = Math.imul(h ^ role.charCodeAt(i), 16777619) >>> 0;
    }
    return h;
  }
}
// src/lib/timer-worker.ts
var TIMER_WORKER_SRC = `let iv=null;self.onmessage=function(e){const d=e.data;if(d.cmd==='start'){if(iv)clearInterval(iv);iv=setInterval(()=>self.postMessage('tick'),d.ms)}else if(d.cmd==='stop'){if(iv)clearInterval(iv);iv=null}};`;
function createTimerWorker(onTick, ms) {
  try {
    const blob = new Blob([TIMER_WORKER_SRC], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.onerror = (e) => {
      console.error("[timer-worker] Worker error:", e.message ?? e);
    };
    worker.postMessage({ cmd: "start", ms });
    return {
      stop: () => {
        try {
          worker.postMessage({ cmd: "stop" });
          worker.terminate();
        } catch {}
        URL.revokeObjectURL(url);
      }
    };
  } catch {
    const id = setInterval(onTick, ms);
    return { stop: () => clearInterval(id) };
  }
}

// src/psy-sampler/realization-scheduler.ts
var TICK_MS = 25;
var HORIZON_SEC = 0.1;

class RealizationScheduler {
  ctx;
  triggerFn;
  queue = [];
  timer = null;
  running = false;
  lastTickWarned = Number.NEGATIVE_INFINITY;
  constructor(ctx, triggerFn = () => {}) {
    this.ctx = ctx;
    this.triggerFn = triggerFn;
  }
  setTriggerFn(fn) {
    this.triggerFn = fn;
  }
  start() {
    if (this.running)
      return;
    this.running = true;
    this.timer = createTimerWorker(() => this.tick(), TICK_MS);
  }
  stop() {
    this.running = false;
    if (this.timer) {
      this.timer.stop();
      this.timer = null;
    }
    this.queue = [];
  }
  schedule(event) {
    const arr = this.queue;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (arr[mid].at < event.at)
        lo = mid + 1;
      else
        hi = mid;
    }
    arr.splice(lo, 0, event);
  }
  get pendingCount() {
    return this.queue.length;
  }
  get isRunning() {
    return this.running;
  }
  tick() {
    if (!this.running)
      return;
    const now = this.ctx.currentTime;
    const horizon = now + HORIZON_SEC;
    while (this.queue.length > 0 && this.queue[0].at <= horizon) {
      const event = this.queue.shift();
      if (event.at < now - 0.05) {
        if (now - this.lastTickWarned > 1) {
          console.warn(`[psy-sampler] Dropping stale event (late by ${((now - event.at) * 1000).toFixed(1)}ms)`);
          this.lastTickWarned = now;
        }
        continue;
      }
      try {
        this.triggerFn(event);
      } catch (err) {
        console.error("[psy-sampler] triggerFn error for event:", err);
      }
    }
  }
}
// src/psy-sampler/audio-graph.ts
class AudioGraph {
  ctx;
  master;
  compressor;
  analyser;
  delay;
  delayFeedback;
  delayReturn;
  reverb;
  reverbReturn;
  buses = new Map;
  sidechainEnabled = false;
  sidechainDepth = 0.6;
  sidechainAttack = 0.008;
  sidechainRelease = 0.15;
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    const masterGain = opts.masterGain ?? 0.85;
    const delaySendAmt = opts.delaySend ?? 0.15;
    const reverbSendAmt = opts.reverbSend ?? 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = masterGain;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.2;
    this.analyser = opts.enableAnalyser !== false ? ctx.createAnalyser() : null;
    if (this.analyser)
      this.analyser.fftSize = 256;
    const outputTarget = opts.outputNode ?? ctx.destination;
    this.master.connect(this.compressor);
    if (this.analyser) {
      this.compressor.connect(this.analyser);
      this.analyser.connect(outputTarget);
    } else {
      this.compressor.connect(outputTarget);
    }
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.3;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.35;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.8;
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(1.8, 2.4);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.8;
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.master);
    const busConfig = [
      { name: "drum", gain: 0.9, delay: 0.05, reverb: 0.1 },
      { name: "music", gain: 0.85, delay: 0.2, reverb: 0.25 },
      { name: "atmos", gain: 0.7, delay: 0.4, reverb: 0.5 }
    ];
    for (const cfg of busConfig) {
      const input = ctx.createGain();
      input.gain.value = cfg.gain;
      const duckGain = ctx.createGain();
      duckGain.gain.value = 1;
      const ds = ctx.createGain();
      ds.gain.value = cfg.delay * delaySendAmt * 4;
      const rs = ctx.createGain();
      rs.gain.value = cfg.reverb * reverbSendAmt * 4;
      input.connect(duckGain);
      duckGain.connect(this.master);
      duckGain.connect(ds);
      ds.connect(this.delay);
      duckGain.connect(rs);
      rs.connect(this.reverb);
      this.buses.set(cfg.name, { input, duckGain, delaySend: ds, reverbSend: rs, userGain: cfg.gain, muted: false });
    }
  }
  getBusInput(name) {
    const bus = this.buses.get(name);
    if (!bus)
      throw new Error(`Unknown bus: ${name}`);
    return bus.input;
  }
  setMasterGain(value) {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }
  setBusGain(name, value) {
    const bus = this.buses.get(name);
    if (!bus)
      return;
    bus.userGain = Math.max(0, Math.min(1.5, value));
    if (!bus.muted) {
      bus.input.gain.setTargetAtTime(bus.userGain, this.ctx.currentTime, 0.01);
    }
  }
  setBusMuted(name, muted) {
    const bus = this.buses.get(name);
    if (!bus)
      return;
    bus.muted = muted;
    bus.input.gain.setTargetAtTime(muted ? 0 : bus.userGain, this.ctx.currentTime, 0.01);
  }
  getBusGain(name) {
    const bus = this.buses.get(name);
    return bus ? bus.userGain : 0;
  }
  isBusMuted(name) {
    const bus = this.buses.get(name);
    return bus ? bus.muted : false;
  }
  applySolo(soloed) {
    const soloSet = new Set(soloed);
    const anySoloed = soloSet.size > 0;
    for (const [name, bus] of this.buses.entries()) {
      const effectiveMuted = bus.muted || anySoloed && !soloSet.has(name);
      bus.input.gain.setTargetAtTime(effectiveMuted ? 0 : bus.userGain, this.ctx.currentTime, 0.01);
    }
  }
  syncDelayToBpm(bpm) {
    const safeBpm = Math.max(1, Math.min(400, bpm));
    const dottedEighth = 60 / safeBpm * 0.75;
    this.delay.delayTime.setTargetAtTime(dottedEighth, this.ctx.currentTime, 0.01);
  }
  setSidechainEnabled(enabled) {
    this.sidechainEnabled = enabled;
    if (!enabled) {
      const now = this.ctx.currentTime;
      for (const bus of this.buses.values()) {
        bus.duckGain.gain.cancelScheduledValues(now);
        bus.duckGain.gain.setTargetAtTime(1, now, 0.01);
      }
    }
  }
  get isSidechainEnabled() {
    return this.sidechainEnabled;
  }
  setSidechainDepth(depth) {
    this.sidechainDepth = Math.max(0, Math.min(1, depth));
  }
  get sidechainDepthValue() {
    return this.sidechainDepth;
  }
  triggerSidechain(at) {
    if (!this.sidechainEnabled)
      return;
    const dipGain = 1 - this.sidechainDepth;
    const now = Math.max(at, this.ctx.currentTime);
    for (const name of ["music", "atmos"]) {
      const bus = this.buses.get(name);
      if (!bus || bus.muted)
        continue;
      bus.duckGain.gain.cancelScheduledValues(now);
      bus.duckGain.gain.setValueAtTime(bus.duckGain.gain.value, now);
      bus.duckGain.gain.linearRampToValueAtTime(dipGain, now + this.sidechainAttack);
      bus.duckGain.gain.linearRampToValueAtTime(1, now + this.sidechainAttack + this.sidechainRelease);
    }
  }
  makeImpulse(durationSec, decay) {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0;ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0;i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return impulse;
  }
  dispose() {
    this.master.disconnect();
    this.compressor.disconnect();
    if (this.analyser)
      this.analyser.disconnect();
    this.delay.disconnect();
    this.delayFeedback.disconnect();
    this.delayReturn.disconnect();
    this.reverb.disconnect();
    this.reverbReturn.disconnect();
    for (const bus of this.buses.values()) {
      bus.input.disconnect();
      bus.duckGain.disconnect();
      bus.delaySend.disconnect();
      bus.reverbSend.disconnect();
    }
    this.buses.clear();
  }
}
// src/psy-sampler/device.ts
class SamplerDevice {
  id = "psy-sampler";
  transport = null;
  context = null;
  started = false;
  opts;
  barsPerPhrase = 8;
  eventsReceived = 0;
  notesTriggered = 0;
  notesSkipped = 0;
  lastEvent = null;
  get lastTransport() {
    return this.transport;
  }
  get lastContext() {
    return this.context;
  }
  constructor(opts) {
    this.opts = opts;
  }
  capabilities() {
    return {
      audio: true,
      midi: false,
      inputs: 0,
      outputs: 1,
      voices: this.opts.voiceCount,
      latencyMs: 12,
      roles: ["sampler", "kick", "bass", "lead", "hat-closed", "hat-open", "clap", "perc", "texture", "fx"]
    };
  }
  onTransport(transport) {
    this.transport = transport;
    this.opts.audioGraph.syncDelayToBpm(transport.bpm);
  }
  onContext(context) {
    this.context = context;
  }
  onEvent(event) {
    this.eventsReceived += 1;
    if (event.type !== "note")
      return;
    this.handleNoteEvent(event);
  }
  onStart() {
    this.started = true;
    this.opts.scheduler.start();
    this.opts.onReady?.();
  }
  onStop() {
    this.started = false;
    this.opts.scheduler.stop();
    this.opts.voicePool.panic();
  }
  reportLatencyMs() {
    return 12;
  }
  handleNoteEvent(event) {
    const parsed = parseChannel(event.channel);
    const bus = roleToBus(parsed.role);
    const seed = this.transport?.revision ?? 0;
    const phraseIndex = this.transport ? Math.floor(Math.max(0, this.transport.bar) / this.barsPerPhrase) : 0;
    const selection = this.opts.selectionPolicy.selectWithNote({
      role: parsed.role,
      bank: parsed.bank,
      velocity: event.velocity,
      phraseIndex,
      seed
    }, event.note);
    if (selection === null) {
      this.notesSkipped += 1;
      this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, triggered: false };
      return;
    }
    const asset = this.opts.library.get(selection.sampleId);
    if (!asset) {
      this.notesSkipped += 1;
      this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, triggered: false };
      return;
    }
    this.lastEvent = { channel: event.channel, note: event.note, velocity: event.velocity, at: event.at, sampleId: selection.sampleId, triggered: true };
    const decay = this.opts.selectionPolicy.decayFor(parsed.role);
    if (parsed.role === "kick") {
      this.opts.audioGraph.triggerSidechain(event.at);
    }
    const scheduledEvent = {
      at: event.at,
      sampleId: selection.sampleId,
      buffer: asset.audioBuffer,
      bus,
      opts: {
        at: event.at,
        playbackRate: selection.playbackRate,
        gain: selection.gain,
        pan: selection.pan,
        decay
      }
    };
    this.opts.scheduler.schedule(scheduledEvent);
    this.notesTriggered += 1;
  }
  get isStarted() {
    return this.started;
  }
  get librarySize() {
    return this.opts.library.size;
  }
  get activeVoices() {
    return this.opts.voicePool.activeCount;
  }
  get pendingEvents() {
    return this.opts.scheduler.pendingCount;
  }
}
function wireSchedulerTrigger(scheduler, voicePool, audioGraph) {
  scheduler.setTriggerFn((event) => {
    const voice = voicePool.allocate();
    const busInput = audioGraph.getBusInput(event.bus);
    voice.connectTo(busInput);
    voice.trigger(event.buffer, event.opts);
  });
}
// src/psy-foundation-shim/host.ts
class DeviceHost {
  devices = new Map;
  channel;
  opts;
  channelUnsub = null;
  lastTransportRevision = null;
  lastTransportPushAt = 0;
  constructor(channel, opts = {}) {
    this.channel = channel;
    this.opts = {
      transportMinIntervalMs: opts.transportMinIntervalMs ?? 0,
      transportDedupByRevision: opts.transportDedupByRevision ?? true
    };
    this.startEventRouting();
  }
  register(device) {
    if (this.devices.has(device.id))
      throw new Error(`Device already registered: ${device.id}`);
    this.devices.set(device.id, device);
    device.onStart?.();
  }
  unregister(id) {
    const device = this.devices.get(id);
    if (!device)
      return;
    device.onStop?.();
    this.devices.delete(id);
  }
  list() {
    return Array.from(this.devices.values()).map((d) => ({
      id: d.id,
      capabilities: d.capabilities()
    }));
  }
  findByRole(role) {
    return Array.from(this.devices.values()).filter((d) => d.capabilities().roles.includes(role));
  }
  pushTransport(transport, nowMs) {
    if (this.opts.transportDedupByRevision) {
      if (this.lastTransportRevision === transport.revision)
        return;
      this.lastTransportRevision = transport.revision;
    }
    if (this.opts.transportMinIntervalMs > 0) {
      if (nowMs - this.lastTransportPushAt < this.opts.transportMinIntervalMs)
        return;
      this.lastTransportPushAt = nowMs;
    }
    for (const device of this.devices.values())
      device.onTransport(transport);
  }
  pushContext(context) {
    for (const device of this.devices.values())
      device.onContext(context);
  }
  publish(event) {
    this.channel.publish(event);
  }
  dispose() {
    for (const device of Array.from(this.devices.values()))
      device.onStop?.();
    this.devices.clear();
    this.channelUnsub?.();
    this.channelUnsub = null;
  }
  get deviceCount() {
    return this.devices.size;
  }
  startEventRouting() {
    this.channelUnsub = this.channel.subscribe((event) => {
      for (const device of this.devices.values()) {
        try {
          device.onEvent(event);
        } catch (err) {
          console.error(`[device-host] Device "${device.id}" onEvent error:`, err);
        }
      }
    });
  }
}
// src/psy-foundation-shim/protocol.ts
class InMemoryChannel {
  name;
  listeners = new Set;
  closed = false;
  constructor(name = "in-memory") {
    this.name = name;
  }
  subscribe(listener) {
    if (this.closed)
      throw new Error(`Channel "${this.name}" is closed`);
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(event) {
    if (this.closed)
      return;
    const listeners = Array.from(this.listeners);
    for (const l of listeners) {
      try {
        l(event);
      } catch (err) {
        console.error("[in-memory-channel] Listener error:", err);
      }
    }
  }
  close() {
    this.closed = true;
    this.listeners.clear();
  }
  get subscriberCount() {
    return this.listeners.size;
  }
}
// src/psy-sampler/factory.ts
function createSamplerDevice(opts) {
  const ctx = opts.audioContext;
  const voiceCount = opts.voiceCount ?? 32;
  const audioGraph = new AudioGraph(ctx, {
    masterGain: opts.masterGain ?? 0.85,
    outputNode: opts.outputNode ?? null
  });
  const defaultBus = audioGraph.getBusInput("drum");
  const voicePool = new VoicePool(() => new SampleVoice({ audioContext: ctx, output: defaultBus }), voiceCount);
  const loader = new SampleLoader(ctx);
  const library = new SampleLibrary(loader);
  const selectionPolicy = new SelectionPolicy(library);
  const scheduler = new RealizationScheduler(ctx);
  wireSchedulerTrigger(scheduler, voicePool, audioGraph);
  const device = new SamplerDevice({
    audioContext: ctx,
    library,
    selectionPolicy,
    scheduler,
    audioGraph,
    voicePool,
    voiceCount,
    manifestUrl: opts.manifestUrl
  });
  return {
    device,
    library,
    selectionPolicy,
    scheduler,
    audioGraph,
    voicePool,
    load: async () => {
      const result = await library.load(opts.manifestUrl, opts.onProgress);
      opts.onLoaded?.(result);
      return result;
    },
    dispose: () => {
      scheduler.stop();
      voicePool.panic();
      audioGraph.dispose();
    }
  };
}
export {
  wireSchedulerTrigger,
  validateProvenance,
  validateManifest,
  roleToBus,
  provenanceFromEntry,
  pitchRatio,
  parseChannel,
  loadManifest,
  isCommerciallyUsable,
  createSamplerDevice,
  SelectionPolicy,
  SamplerDevice,
  SampleVoice,
  SampleLoader,
  SampleLibrary,
  RealizationScheduler,
  ProvenanceError,
  ManifestError,
  DEFAULT_VARIANCE_RULES,
  AudioGraph
};

if (typeof window !== 'undefined') {
  window.PsySampler = { createSamplerDevice, SamplerDevice, SelectionPolicy, RealizationScheduler, AudioGraph, SampleVoice, SampleLibrary, SampleLoader, VoicePool, InMemoryChannel, DeviceHost, Rng, parseChannel, roleToBus, DEFAULT_VARIANCE_RULES, pitchRatio };
}
