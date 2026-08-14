/**
 * PatternMutator — evolves patterns slowly with musical constraints.
 *
 * From architecture review:
 * - Don't generate random new patterns
 * - Mutate existing pattern with small changes
 * - Score candidates against musical constraints
 * - Choose best candidate
 * - Mutation budget: kick barely changes, hats change most
 *
 * Every 8 bars:
 *   current pattern → 8 mutations → score → best → crossfade
 */

export interface Pattern {
  kick: number[];
  bass: (number | null)[];
  lead: (number | null)[];
  hat: number[];
}

export interface MutationBudget {
  kick: number;  // probability of mutation per step
  bass: number;
  lead: number;
  hats: number;
}

const DEFAULT_BUDGET: MutationBudget = {
  kick: 0.05,   // almost never changes
  bass: 0.10,   // rarely
  lead: 0.15,   // sometimes
  hats: 0.20,   // often
};

// Musical constraints per role
function kickConstraints(pattern: number[]): boolean {
  // Beat 0 (downbeat) must be on
  if (!pattern[0]) return false;
  // At least 2 kicks in 16 steps
  const count = pattern.filter(x => x === 1).length;
  if (count < 2) return false;
  // Not more than 8 (would be too busy)
  if (count > 8) return false;
  return true;
}

function bassConstraints(pattern: (number | null)[]): boolean {
  // At least 2 notes
  const count = pattern.filter(x => x !== null).length;
  if (count < 2) return false;
  if (count > 12) return false;
  return true;
}

function leadConstraints(pattern: (number | null)[]): boolean {
  // Lead can be sparse
  const count = pattern.filter(x => x !== null).length;
  if (count > 10) return false;
  return true;
}

function hatConstraints(pattern: number[]): boolean {
  const count = pattern.filter(x => x === 1).length;
  if (count > 12) return false;
  if (count < 1) return false;
  return true;
}

// Mutation operators
function mutateKick(pattern: number[]): number[] {
  const result = [...pattern];
  const ops = [
    () => { // Add a kick on a strong position
      const candidates = [4, 8, 12, 7, 11, 15];
      const step = candidates[Math.floor(Math.random() * candidates.length)];
      result[step] = 1;
    },
    () => { // Remove a kick (not beat 0)
      const onSteps = [];
      for (let i = 4; i < 16; i++) if (result[i]) onSteps.push(i);
      if (onSteps.length > 0) {
        const step = onSteps[Math.floor(Math.random() * onSteps.length)];
        result[step] = 0;
      }
    },
  ];
  ops[Math.floor(Math.random() * ops.length)]();
  return kickConstraints(result) ? result : pattern;
}

function mutateBass(pattern: (number | null)[]): (number | null)[] {
  const result = [...pattern];
  const ops = [
    () => { // Add a note
      const emptySteps = [];
      for (let i = 0; i < 16; i++) if (result[i] === null) emptySteps.push(i);
      if (emptySteps.length > 0) {
        const step = emptySteps[Math.floor(Math.random() * emptySteps.length)];
        result[step] = [0, 0, 3, 5, 7][Math.floor(Math.random() * 5)];
      }
    },
    () => { // Remove a note
      const onSteps = [];
      for (let i = 0; i < 16; i++) if (result[i] !== null) onSteps.push(i);
      if (onSteps.length > 2) {
        const step = onSteps[Math.floor(Math.random() * onSteps.length)];
        result[step] = null;
      }
    },
    () => { // Change a note pitch
      const onSteps = [];
      for (let i = 0; i < 16; i++) if (result[i] !== null) onSteps.push(i);
      if (onSteps.length > 0) {
        const step = onSteps[Math.floor(Math.random() * onSteps.length)];
        result[step] = [0, 3, 5, 7, 10][Math.floor(Math.random() * 5)];
      }
    },
  ];
  ops[Math.floor(Math.random() * ops.length)]();
  return bassConstraints(result) ? result : pattern;
}

function mutateLead(pattern: (number | null)[]): (number | null)[] {
  const result = [...pattern];
  const ops = [
    () => { // Add a note
      const emptySteps = [];
      for (let i = 0; i < 16; i++) if (result[i] === null) emptySteps.push(i);
      if (emptySteps.length > 0) {
        const step = emptySteps[Math.floor(Math.random() * emptySteps.length)];
        result[step] = [0, 3, 5, 7, 10, 12, 15][Math.floor(Math.random() * 7)];
      }
    },
    () => { // Remove a note
      const onSteps = [];
      for (let i = 0; i < 16; i++) if (result[i] !== null) onSteps.push(i);
      if (onSteps.length > 1) {
        const step = onSteps[Math.floor(Math.random() * onSteps.length)];
        result[step] = null;
      }
    },
    () => { // Shift a note
      const onSteps = [];
      for (let i = 0; i < 16; i++) if (result[i] !== null) onSteps.push(i);
      if (onSteps.length > 0) {
        const from = onSteps[Math.floor(Math.random() * onSteps.length)];
        const to = (from + [-1, 1, 2, -2][Math.floor(Math.random() * 4)] + 16) % 16;
        if (result[to] === null) {
          result[to] = result[from];
          result[from] = null;
        }
      }
    },
  ];
  ops[Math.floor(Math.random() * ops.length)]();
  return leadConstraints(result) ? result : pattern;
}

function mutateHat(pattern: number[]): number[] {
  const result = [...pattern];
  const ops = [
    () => { // Add a hat
      const emptySteps = [];
      for (let i = 0; i < 16; i++) if (!result[i]) emptySteps.push(i);
      if (emptySteps.length > 0) {
        const step = emptySteps[Math.floor(Math.random() * emptySteps.length)];
        result[step] = 1;
      }
    },
    () => { // Remove a hat
      const onSteps = [];
      for (let i = 0; i < 16; i++) if (result[i]) onSteps.push(i);
      if (onSteps.length > 1) {
        const step = onSteps[Math.floor(Math.random() * onSteps.length)];
        result[step] = 0;
      }
    },
  ];
  ops[Math.floor(Math.random() * ops.length)]();
  return hatConstraints(result) ? result : pattern;
}

// Score a candidate pattern (higher = better)
export function scorePattern(
  candidate: Pattern,
  current: Pattern,
  occupancy: { kick: number; bass: number; lead: number; hats: number },
  density: number,
): number {
  let score = 0;

  // Novelty: how different is it from current?
  let diff = 0;
  for (let i = 0; i < 16; i++) {
    if (candidate.kick[i] !== current.kick[i]) diff++;
    if (candidate.bass[i] !== current.bass[i]) diff++;
    if (candidate.lead[i] !== current.lead[i]) diff++;
    if (candidate.hat[i] !== current.hat[i]) diff++;
  }
  score += Math.min(diff / 16, 1) * 0.20; // novelty (up to 20%)

  // Density fit: how well does it match desired density?
  const kickCount = candidate.kick.filter(x => x).length / 16;
  const hatCount = candidate.hat.filter(x => x).length / 16;
  const targetKick = density * (1 - occupancy.kick); // less kick if radio has kick
  const targetHat = density * 0.5;
  score += (1 - Math.abs(kickCount - targetKick)) * 0.15;
  score += (1 - Math.abs(hatCount - targetHat)) * 0.10;

  // Complement: does it fill gaps the radio leaves?
  if (occupancy.kick > 0.7 && kickCount < 0.3) score += 0.10; // good: less kick when radio has kick
  if (occupancy.bass > 0.75 && candidate.bass.filter(x => x !== null).length < 4) score += 0.10;
  if (occupancy.lead < 0.5 && candidate.lead.filter(x => x !== null).length > 2) score += 0.10;

  // Stability: don't change kick too much
  const kickDiff = candidate.kick.filter((x, i) => x !== current.kick[i]).length;
  score -= kickDiff * 0.05; // penalize kick changes

  return score;
}

/**
 * Generate mutated patterns and pick the best.
 * Returns new pattern or null if no improvement.
 */
export function mutatePattern(
  current: Pattern,
  occupancy: { kick: number; bass: number; lead: number; hats: number },
  density: number,
): Pattern | null {
  // Generate 4 candidates
  const candidates: Pattern[] = [];
  for (let i = 0; i < 4; i++) {
    candidates.push({
      kick: mutateKick(current.kick),
      bass: mutateBass(current.bass),
      lead: mutateLead(current.lead),
      hat: mutateHat(current.hat),
    });
  }

  // Score each
  const scored = candidates.map(c => ({
    pattern: c,
    score: scorePattern(c, current, occupancy, density),
  }));

  // Pick best
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  // Only adopt if it's better than current
  const currentScore = scorePattern(current, current, occupancy, density);
  if (best.score > currentScore) {
    return best.pattern;
  }

  return null;
}
