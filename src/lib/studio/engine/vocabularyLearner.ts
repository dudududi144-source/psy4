/**
 * VocabularyLearner — learns musical vocabulary from the radio.
 *
 * Task ID: P5-ADAPTIVE-LEARNING (Phase 5 — real-time adaptation).
 *
 * Unlike LearningMemory (which stores parameter configs), this module
 * stores MUSICAL CONTENT:
 *   - Melodic motifs (note sequences) extracted from the radio
 *   - Rhythmic patterns (gate strings) extracted from the radio
 *   - Bass patterns (future)
 *   - Chord voicings (future)
 *
 * The MusicalDirector can query this vocabulary when composing phrases,
 * blending learned material with generated material. The lead can "quote"
 * the radio's melodies; the drums can adopt the radio's kick/hat patterns.
 *
 * ## Learning pipeline
 *
 *   1. MusicAnalyzer detects a melodic contour + rhythmic pattern from the
 *      radio's spectral features (every ~10s reference window).
 *   2. The engine calls `learnMotif()` (when contour is non-static) and
 *      `learnRhythm()` (always — even a "no-percussion" pattern is data).
 *   3. Inside `learnMotif` / `learnRhythm`, we DEDUPLICATE against the
 *      existing vocabulary: if a near-identical entry exists, we bump its
 *      useCount + refresh its sourceTime (no duplicate stored). This means
 *      a radio station with a stable groove accumulates ONE rhythm pattern,
 *      not 30 copies.
 *   4. The MusicalDirector queries `getMotifForPhrase(energy, style)` and
 *      `getRhythmForPhrase(energy, style)`. With 30%/40% probability (when
 *      vocabulary is available), the director uses the learned entry INSTEAD
 *      of fresh material — applying the same development techniques
 *      (transpose / invert / sequence) so the quote EVOLVES across phrases.
 *   5. When a learned entry is used, `markUsed(id)` records the current
 *      match-score baseline. 30 seconds later, `tickEvaluation(score)`
 *      compares the current match score to the baseline and reinforces
 *      (raises effectiveness) or decays (lowers effectiveness). Low-
 *      effectiveness entries get pruned so the vocabulary stays fresh.
 *
 * ## Storage
 *
 * localStorage with a graceful fallback when storage is unavailable (private
 * browsing, SSR, etc.). Persisted every saveIntervalSec (default 60s) plus
 * on `save()` calls from the engine's stop().
 *
 * ## Efficiency
 *
 * All operations are O(n) with n ≤ maxItems (default 30). No allocation in
 * the steady state beyond the rare push. `tickEvaluation` is O(activeItems)
 * with activeItems ≤ ~5. The learner runs inside `liveTrack()` so no
 * separate timer is needed.
 *
 * ## Guards
 *
 * Every input is validated: motifs must have ≥3 notes with matching-length
 * durations/velocities; rhythms must be 16-char gate strings. Malformed
 * input is silently rejected (no throw) so a single bad reference window
 * can't poison the vocabulary. localStorage access is wrapped in try/catch.
 */

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * A learned melodic motif. Notes are SCALE DEGREES (integers, may be
 * negative/>7) so the motif transposes cleanly across any key — the
 * MelodyEngine's `setMotif` consumes this shape directly.
 *
 *   - durations: 16th-note steps (1=16th, 2=8th, 4=quarter, ...).
 *   - velocities: 0..1.
 *   - sourceTime: wall-clock ms when learned (Date.now()).
 *   - useCount: how many times the director has quoted this motif.
 *   - effectiveness: 0..1 EMA of how much the match score improved while
 *     this motif was in use. Starts at 0.5 (neutral); rises with successful
 *     use, falls with unsuccessful use.
 */
export interface LearnedMotif {
  id: string;
  notes: number[];        // scale degrees (root-relative)
  durations: number[];    // 16th steps
  velocities: number[];   // 0..1
  sourceTime: number;     // ms when learned
  useCount: number;
  effectiveness: number;  // 0..1
}

/**
 * A learned rhythmic pattern. Each pattern is a 16-char gate string ('x'
 * = hit, '.' = rest) at 16th-note resolution — one bar of 4/4.
 *
 *   - kickPattern / hatPattern / percPattern: 16-char gates.
 *   - sourceTime, useCount, effectiveness: as LearnedMotif.
 */
export interface LearnedRhythm {
  id: string;
  kickPattern: string;    // 16-char gate
  hatPattern: string;
  percPattern: string;
  sourceTime: number;
  useCount: number;
  effectiveness: number;
}

/**
 * Snapshot for the UI (VOCABULARY card). All fields are defensive copies
 * so callers can't mutate internal state.
 */
export interface VocabularyStats {
  motifCount: number;
  rhythmCount: number;
  avgEffectiveness: number;
  topMotifs: LearnedMotif[];     // top 3, sorted by effectiveness × useCount
  topRhythms: LearnedRhythm[];   // top 3
  learning: boolean;             // true if we learned something in the last 30s
  lastLearnedAt: number;         // ms timestamp of last successful learn() call
  activeQuoteCount: number;      // how many motifs/rhythms are currently in use
}

// ─── Internal types ─────────────────────────────────────────────────────────

/**
 * Tracks a vocabulary entry currently "in use" by the director. After
 * EVALUATION_WINDOW_SEC, the learner compares the current match score to
 * the baseline captured at markUsed() time and reinforces / decays the
 * entry's effectiveness accordingly.
 */
interface ActiveUse {
  id: string;
  kind: 'motif' | 'rhythm';
  startMs: number;
  baselineScore: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'psy4_vocabulary_v1';
const MAX_ITEMS = 30;
const EVALUATION_WINDOW_SEC = 30;       // reinforce after 30s of use
const EVALUATION_WINDOW_MS = EVALUATION_WINDOW_SEC * 1000;
const LEARNING_RECENT_MS = 30_000;       // "learning..." indicator window
const EFFECTIVENESS_NEUTRAL = 0.5;
const EFFECTIVENESS_MIN = 0.05;
const EFFECTIVENESS_PRUNE_THRESHOLD = 0.10;
const EFFECTIVENESS_EMA = 0.35;          // weight on the new observation
const REINFORCE_DELTA = 0.18;            // ±0.18 per evaluation
const MOTIF_SIMILARITY_THRESHOLD = 0.85; // dedupe motifs above this
const SAVE_INTERVAL_MS = 60_000;
const GATE_LEN = 16;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ─── VocabularyLearner ──────────────────────────────────────────────────────

export class VocabularyLearner {
  private motifs: LearnedMotif[] = [];
  private rhythms: LearnedRhythm[] = [];
  private activeUses: ActiveUse[] = [];
  private storageAvailable = false;
  private lastSavedAt = 0;
  private lastLearnedAt = 0;
  private lastKnownMatchScore = 0;
  private maxItems = MAX_ITEMS;

  constructor() {
    this.storageAvailable = this.checkStorage();
    this.load();
  }

  // ─── Public API: learning ──────────────────────────────────────────────

  /**
   * Learn a melodic motif from the radio. The contour comes from the
   * MusicAnalyzer's spectral-centroid tracking (each reference window's
   * centroid → MIDI note → quantized scale degree).
   *
   * Dedupe: if a near-identical motif exists (similarity ≥ threshold), bump
   * its useCount + refresh sourceTime instead of storing a duplicate. This
   * keeps the vocabulary focused on the radio's actual musical vocabulary,
   * not 30 copies of the same groove.
   *
   * Guards: rejects motifs with <3 notes, mismatched array lengths, or
   * non-finite values.
   */
  learnMotif(contour: {
    notes: number[];
    durations: number[];
    velocities: number[];
  }): void {
    const notes = contour?.notes;
    const durations = contour?.durations;
    const velocities = contour?.velocities;
    if (!Array.isArray(notes) || !Array.isArray(durations) || !Array.isArray(velocities)) return;
    if (notes.length < 3 || notes.length > 16) return;
    if (durations.length !== notes.length || velocities.length !== notes.length) return;

    // Validate + sanitize each element.
    const cleanNotes: number[] = [];
    const cleanDurs: number[] = [];
    const cleanVels: number[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const d = durations[i];
      const v = velocities[i];
      if (typeof n !== 'number' || !isFinite(n)) return;
      if (typeof d !== 'number' || !isFinite(d) || d <= 0) return;
      if (typeof v !== 'number' || !isFinite(v)) return;
      cleanNotes.push(Math.round(n));
      cleanDurs.push(Math.max(1, Math.min(8, Math.round(d))));
      cleanVels.push(clamp(v, 0.05, 1.0));
    }

    // Dedupe: find a similar existing motif. Similarity = fraction of
    // scale degrees that match (modulo octave wraparound is NOT applied —
    // an octave-shifted motif is treated as different).
    const existing = this.findSimilarMotif(cleanNotes);
    const now = Date.now();
    if (existing) {
      existing.useCount += 1;
      existing.sourceTime = now;
      this.lastLearnedAt = now;
      // Don't save on every dedupe — periodic save covers it.
      return;
    }

    // New motif.
    const motif: LearnedMotif = {
      id: this.makeId('m'),
      notes: cleanNotes,
      durations: cleanDurs,
      velocities: cleanVels,
      sourceTime: now,
      useCount: 0,
      effectiveness: EFFECTIVENESS_NEUTRAL,
    };
    this.motifs.push(motif);
    this.lastLearnedAt = now;
    this.trimIfNeeded();
  }

  /**
   * Learn a rhythmic pattern from the radio. The MusicAnalyzer produces
   * 16-char gate strings for kick + hat (and we derive perc from the
   * transient density if the caller doesn't supply one).
   *
   * Dedupe: if an identical kick+hat+perc pattern already exists, bump its
   * useCount + refresh sourceTime.
   */
  learnRhythm(rhythm: {
    kickPattern: string;
    hatPattern: string;
    percPattern?: string;
  }): void {
    const kick = this.normalizeGate(rhythm?.kickPattern);
    const hat = this.normalizeGate(rhythm?.hatPattern);
    // percPattern is optional — when absent, derive one from kick+hat.
    const perc = this.normalizeGate(rhythm?.percPattern)
      ?? this.derivePercPattern(kick ?? '................', hat ?? '................');
    if (!kick || !hat || !perc) return;

    const now = Date.now();
    // Dedupe: identical 16-char gates → same rhythm.
    const existing = this.rhythms.find(
      r => r.kickPattern === kick && r.hatPattern === hat && r.percPattern === perc,
    );
    if (existing) {
      existing.useCount += 1;
      existing.sourceTime = now;
      this.lastLearnedAt = now;
      return;
    }

    const entry: LearnedRhythm = {
      id: this.makeId('r'),
      kickPattern: kick,
      hatPattern: hat,
      percPattern: perc,
      sourceTime: now,
      useCount: 0,
      effectiveness: EFFECTIVENESS_NEUTRAL,
    };
    this.rhythms.push(entry);
    this.lastLearnedAt = now;
    this.trimIfNeeded();
  }

  // ─── Public API: recall ────────────────────────────────────────────────

  /**
   * Pick a motif to use in composition. Returns null if the vocabulary is
   * empty or no motif has effectiveness above the use threshold.
   *
   * Selection: weighted random by effectiveness × useCount (favors proven
   * motifs but doesn't always pick the top one — keeps variety). Energy is
   * used to filter: low-energy phrases avoid high-register motifs (avg
   * degree > 7); high-energy phrases avoid very low motifs. Style is
   * informational only (not yet used for filtering — future enhancement).
   */
  getMotifForPhrase(energy: number, _style: string): LearnedMotif | null {
    if (this.motifs.length === 0) return null;
    const usable = this.motifs.filter(m => m.effectiveness > EFFECTIVENESS_PRUNE_THRESHOLD);
    if (usable.length === 0) return null;

    // Energy gating: skip motifs whose average degree is far from the
    // phrase's register.
    const targetDeg = energy > 0.7 ? 5 : energy < 0.3 ? -2 : 2;
    const energyFiltered = usable.filter(m => {
      const avg = m.notes.reduce((s, n) => s + n, 0) / m.notes.length;
      return Math.abs(avg - targetDeg) <= 7;
    });
    const pool = energyFiltered.length > 0 ? energyFiltered : usable;

    // Weighted random: weight = effectiveness × (1 + useCount * 0.1).
    const weights = pool.map(m => Math.max(0.01, m.effectiveness * (1 + m.useCount * 0.1)));
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  /**
   * Pick a rhythm to use in composition. Same weighted-random approach.
   * Returns null if vocabulary is empty.
   */
  getRhythmForPhrase(_energy: number, _style: string): LearnedRhythm | null {
    if (this.rhythms.length === 0) return null;
    const usable = this.rhythms.filter(r => r.effectiveness > EFFECTIVENESS_PRUNE_THRESHOLD);
    if (usable.length === 0) return null;

    const weights = usable.map(r => Math.max(0.01, r.effectiveness * (1 + r.useCount * 0.1)));
    const total = weights.reduce((s, w) => s + w, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < usable.length; i++) {
      r -= weights[i];
      if (r <= 0) return usable[i];
    }
    return usable[usable.length - 1];
  }

  // ─── Public API: effectiveness tracking ────────────────────────────────

  /**
   * Mark that a vocabulary entry is currently in use. Captures the baseline
   * match score so `tickEvaluation()` can compute the delta 30s later.
   *
   * Called by the MusicalDirector when it quotes a learned motif/rhythm.
   */
  markUsed(id: string, kind: 'motif' | 'rhythm'): void {
    if (!id) return;
    // Don't double-track the same id.
    if (this.activeUses.some(a => a.id === id)) return;
    this.activeUses.push({
      id,
      kind,
      startMs: Date.now(),
      baselineScore: this.lastKnownMatchScore,
    });
  }

  /**
   * Update the current match-score baseline. Called by the engine on every
   * liveTrack() with the latest `learningMemory.getStatus().recentAvgScore`.
   * Used both as the baseline for new markUsed() calls AND as the
   * comparison point in tickEvaluation().
   */
  setMatchScore(score: number): void {
    if (typeof score === 'number' && isFinite(score)) {
      this.lastKnownMatchScore = clamp(score, 0, 1);
    }
  }

  /**
   * Evaluate active uses older than EVALUATION_WINDOW_SEC. For each:
   *   - Compare the current match score to the baseline.
   *   - If score improved → reinforce (effectiveness += REINFORCE_DELTA).
   *   - If score worsened → decay (effectiveness -= REINFORCE_DELTA).
   *   - Either way, EMA-blend the new effectiveness with the old.
   *   - Prune entries whose effectiveness falls below the prune threshold.
   *
   * Called by the engine from liveTrack() (every ~10s). Safe to call
   * repeatedly — entries are only evaluated once (then removed from the
   * active list).
   */
  tickEvaluation(currentMatchScore: number): void {
    this.setMatchScore(currentMatchScore);
    const now = Date.now();
    const remaining: ActiveUse[] = [];
    for (const use of this.activeUses) {
      if (now - use.startMs < EVALUATION_WINDOW_MS) {
        remaining.push(use);
        continue;
      }
      // 30s have passed — evaluate.
      const delta = this.lastKnownMatchScore - use.baselineScore;
      const target = use.kind === 'motif'
        ? this.motifs.find(m => m.id === use.id)
        : this.rhythms.find(r => r.id === use.id);
      if (!target) continue; // was pruned or never existed
      // Map delta to effectiveness change: ±0.05 for small deltas, ±0.18
      // for large ones. Squash via tanh so noisy 30s windows don't whipsaw.
      const change = REINFORCE_DELTA * Math.tanh(delta * 8);
      const newEff = clamp(target.effectiveness + change, EFFECTIVENESS_MIN, 1.0);
      target.effectiveness = (1 - EFFECTIVENESS_EMA) * target.effectiveness + EFFECTIVENESS_EMA * newEff;
    }
    this.activeUses = remaining;

    // Prune low-effectiveness entries (but never prune the last 3 — we want
    // SOME vocabulary even early on when scores are noisy).
    if (this.motifs.length > 3) {
      this.motifs = this.motifs.filter(m =>
        m.effectiveness >= EFFECTIVENESS_PRUNE_THRESHOLD || m.useCount > 0,
      );
    }
    if (this.rhythms.length > 3) {
      this.rhythms = this.rhythms.filter(r =>
        r.effectiveness >= EFFECTIVENESS_PRUNE_THRESHOLD || r.useCount > 0,
      );
    }

    // Periodic save.
    if (now - this.lastSavedAt > SAVE_INTERVAL_MS) {
      this.save();
    }
  }

  /**
   * Manually reinforce an entry (e.g. when the engine detects a clear
   * match-score improvement attributable to a specific quote). Blends the
   * supplied effectiveness into the stored value via EMA.
   */
  reinforce(id: string, effectiveness: number): void {
    if (!id) return;
    const eff = clamp(effectiveness, 0, 1);
    const motif = this.motifs.find(m => m.id === id);
    if (motif) {
      motif.effectiveness = (1 - EFFECTIVENESS_EMA) * motif.effectiveness + EFFECTIVENESS_EMA * eff;
      return;
    }
    const rhythm = this.rhythms.find(r => r.id === id);
    if (rhythm) {
      rhythm.effectiveness = (1 - EFFECTIVENESS_EMA) * rhythm.effectiveness + EFFECTIVENESS_EMA * eff;
    }
  }

  // ─── Public API: stats / persistence ───────────────────────────────────

  getStats(): VocabularyStats {
    const now = Date.now();
    const topMotifs = [...this.motifs]
      .sort((a, b) => (b.effectiveness * (1 + b.useCount * 0.1))
                    - (a.effectiveness * (1 + a.useCount * 0.1)))
      .slice(0, 3);
    const topRhythms = [...this.rhythms]
      .sort((a, b) => (b.effectiveness * (1 + b.useCount * 0.1))
                    - (a.effectiveness * (1 + a.useCount * 0.1)))
      .slice(0, 3);
    const allEff = [...this.motifs, ...this.rhythms].map(x => x.effectiveness);
    const avgEff = allEff.length > 0 ? allEff.reduce((s, e) => s + e, 0) / allEff.length : 0;
    return {
      motifCount: this.motifs.length,
      rhythmCount: this.rhythms.length,
      avgEffectiveness: avgEff,
      topMotifs: topMotifs.map(m => ({
        ...m,
        notes: [...m.notes],
        durations: [...m.durations],
        velocities: [...m.velocities],
      })),
      topRhythms: topRhythms.map(r => ({ ...r })),
      learning: now - this.lastLearnedAt < LEARNING_RECENT_MS,
      lastLearnedAt: this.lastLearnedAt,
      activeQuoteCount: this.activeUses.length,
    };
  }

  clear(): void {
    this.motifs = [];
    this.rhythms = [];
    this.activeUses = [];
    this.lastLearnedAt = 0;
    this.lastKnownMatchScore = 0;
    this.save();
  }

  save(): void {
    this.lastSavedAt = Date.now();
    if (!this.storageAvailable) return;
    try {
      const data = JSON.stringify({
        motifs: this.motifs,
        rhythms: this.rhythms,
        version: 1,
      });
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      // storage full or unavailable — silently no-op
    }
  }

  load(): void {
    if (!this.storageAvailable) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.motifs)) {
        this.motifs = data.motifs
          .filter((m: any) => m && Array.isArray(m.notes) && Array.isArray(m.durations))
          .slice(0, this.maxItems)
          .map((m: any) => ({
            id: String(m.id ?? this.makeId('m')),
            notes: m.notes.map((n: number) => Math.round(n)),
            durations: m.durations.map((d: number) => Math.max(1, Math.round(d))),
            velocities: m.velocities.map((v: number) => clamp(v, 0.05, 1.0)),
            sourceTime: Number(m.sourceTime) || 0,
            useCount: Number(m.useCount) || 0,
            effectiveness: typeof m.effectiveness === 'number'
              ? clamp(m.effectiveness, 0, 1) : EFFECTIVENESS_NEUTRAL,
          }));
      }
      if (Array.isArray(data.rhythms)) {
        this.rhythms = data.rhythms
          .filter((r: any) => r && typeof r.kickPattern === 'string')
          .slice(0, this.maxItems)
          .map((r: any) => ({
            id: String(r.id ?? this.makeId('r')),
            kickPattern: this.normalizeGate(r.kickPattern) ?? '................',
            hatPattern: this.normalizeGate(r.hatPattern) ?? '................',
            percPattern: this.normalizeGate(r.percPattern) ?? '................',
            sourceTime: Number(r.sourceTime) || 0,
            useCount: Number(r.useCount) || 0,
            effectiveness: typeof r.effectiveness === 'number'
              ? clamp(r.effectiveness, 0, 1) : EFFECTIVENESS_NEUTRAL,
          }));
      }
    } catch {
      this.motifs = [];
      this.rhythms = [];
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private checkStorage(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const k = '__psy4_vocab_test__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch {
      return false;
    }
  }

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
  }

  /**
   * Normalize a 16-char gate string. Returns null if the input is not a
   * string of length 16 (or shorter strings padded to 16 with rests).
   * Any non-'x' character is treated as a rest.
   */
  private normalizeGate(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    let s = input.slice(0, GATE_LEN);
    if (s.length < GATE_LEN) s = s.padEnd(GATE_LEN, '.');
    let out = '';
    for (let i = 0; i < GATE_LEN; i++) {
      out += s[i] === 'x' ? 'x' : '.';
    }
    return out;
  }

  /**
   * Derive a perc pattern from the kick + hat patterns. The perc plays on
   * the "e" and "a" of each beat (steps 2, 6, 10, 14) ONLY when neither
   * kick nor hat is hitting there — fills the gaps with light percussion.
   */
  private derivePercPattern(kick: string, hat: string): string {
    let out = '';
    for (let i = 0; i < GATE_LEN; i++) {
      const isOffbeatSlot = i === 2 || i === 6 || i === 10 || i === 14;
      const busy = kick[i] === 'x' || hat[i] === 'x';
      out += isOffbeatSlot && !busy ? 'x' : '.';
    }
    return out;
  }

  /**
   * Find a similar existing motif. Similarity = (matching degree count) /
   * max(len). Two motifs are similar if ≥85% of their notes match by
   * scale-degree value (NOT pitch class — an octave-shifted motif is
   * considered different). Lengths must match within ±2 notes.
   */
  private findSimilarMotif(notes: number[]): LearnedMotif | null {
    let best: LearnedMotif | null = null;
    let bestSim = MOTIF_SIMILARITY_THRESHOLD;
    for (const m of this.motifs) {
      if (Math.abs(m.notes.length - notes.length) > 2) continue;
      const minLen = Math.min(m.notes.length, notes.length);
      const maxLen = Math.max(m.notes.length, notes.length);
      let matches = 0;
      for (let i = 0; i < minLen; i++) {
        if (m.notes[i] === notes[i]) matches++;
      }
      const sim = matches / maxLen;
      if (sim >= bestSim) {
        bestSim = sim;
        best = m;
      }
    }
    return best;
  }

  /**
   * Keep the vocabulary under maxItems. When over the limit, evict the
   * least-effective entry (lowest effectiveness × useCount). Never evicts
   * entries currently in active use.
   */
  private trimIfNeeded(): void {
    const activeIds = new Set(this.activeUses.map(a => a.id));
    const trim = <T extends { id: string; effectiveness: number; useCount: number }>(arr: T[]): T[] => {
      if (arr.length <= this.maxItems) return arr;
      // Score = effectiveness × (1 + useCount). Lower = evict first.
      const scored = arr.map(x => ({
        x,
        score: x.effectiveness * (1 + x.useCount * 0.1),
        active: activeIds.has(x.id),
      }));
      scored.sort((a, b) => a.score - b.score);
      const toEvict = scored.length - this.maxItems;
      const evictIds = new Set<string>();
      let evicted = 0;
      for (const s of scored) {
        if (evicted >= toEvict) break;
        if (s.active) continue; // don't evict in-use entries
        evictIds.add(s.x.id);
        evicted++;
      }
      return arr.filter(x => !evictIds.has(x.id));
    };
    this.motifs = trim(this.motifs);
    this.rhythms = trim(this.rhythms);
  }
}
