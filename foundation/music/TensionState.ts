/**
 * TensionState — F21 Phase 1: Multi-dimensional musical tension.
 *
 * Tension is NOT a single scalar. It is a multi-dimensional construct
 * where each dimension DRIVES generation decisions.
 *
 * High harmonic tension → less stable chord tones, more dissonance
 * High melodic tension → larger intervals, higher register
 * High rhythmic tension → more syncopation, more density
 * High register tension → notes pushed to upper register
 * High density tension → more notes per bar
 * High expectation tension → anticipation of resolution
 */

export interface TensionState {
  /** Harmonic tension: dissonance level, non-chord tone ratio (0-1) */
  harmonic: number;
  /** Melodic tension: interval size, contour steepness (0-1) */
  melodic: number;
  /** Rhythmic tension: syncopation, displacement, polyrhythm (0-1) */
  rhythmic: number;
  /** Register tension: how far from comfortable center (0-1) */
  register: number;
  /** Density tension: how many notes per bar vs target (0-1) */
  density: number;
  /** Spectral tension: brightness/noisiness level (0-1) */
  spectral: number;
  /** Expectation tension: anticipation of resolution (0-1) */
  expectation: number;
  /** Derived overall tension (weighted average) */
  overall: number;
  /** Is the system in a resolution phase? */
  resolving: boolean;
  /** Tension trajectory: rising or falling */
  trajectory: 'rising' | 'falling' | 'stable';
}

export function createInitialTension(): TensionState {
  return {
    harmonic: 0.2,
    melodic: 0.2,
    rhythmic: 0.2,
    register: 0.3,
    density: 0.3,
    spectral: 0.3,
    expectation: 0.2,
    overall: 0.25,
    resolving: false,
    trajectory: 'stable',
  };
}

/**
 * Update tension state from musical context.
 * This is a CAUSAL function — the tension values DRIVE generation.
 */
export function updateTension(
  state: TensionState,
  context: {
    section: string;
    phraseIndex: number;
    barInPhrase: number;
    energy: number;
    isBuild: boolean;
    isDrop: boolean;
    isBreak: boolean;
  },
): TensionState {
  const { section, phraseIndex, barInPhrase, energy, isBuild, isDrop, isBreak } = context;

  // Section-based tension targets
  let harmonicTarget = 0.2;
  let melodicTarget = 0.2;
  let rhythmicTarget = 0.2;
  let registerTarget = 0.3;
  let densityTarget = 0.3;
  let spectralTarget = 0.3;
  let expectationTarget = 0.2;
  let resolving = false;

  switch (section) {
    case 'INTRO':
      harmonicTarget = 0.15; melodicTarget = 0.15; rhythmicTarget = 0.15;
      registerTarget = 0.25; densityTarget = 0.2; spectralTarget = 0.25;
      break;
    case 'STATEMENT':
      harmonicTarget = 0.25; melodicTarget = 0.3; rhythmicTarget = 0.25;
      registerTarget = 0.35; densityTarget = 0.35; spectralTarget = 0.35;
      break;
    case 'DEVELOPMENT':
    case 'DEVELOPMENT2':
      harmonicTarget = 0.4; melodicTarget = 0.45; rhythmicTarget = 0.35;
      registerTarget = 0.45; densityTarget = 0.45; spectralTarget = 0.4;
      break;
    case 'CONTRAST':
      harmonicTarget = 0.55; melodicTarget = 0.5; rhythmicTarget = 0.5;
      registerTarget = 0.5; densityTarget = 0.5; spectralTarget = 0.5;
      break;
    case 'CLIMAX':
      harmonicTarget = 0.65; melodicTarget = 0.65; rhythmicTarget = 0.6;
      registerTarget = 0.65; densityTarget = 0.7; spectralTarget = 0.6;
      expectationTarget = 0.6;
      break;
    case 'RESOLUTION':
      harmonicTarget = 0.15; melodicTarget = 0.15; rhythmicTarget = 0.15;
      registerTarget = 0.25; densityTarget = 0.25; spectralTarget = 0.25;
      expectationTarget = 0.1;
      resolving = true;
      break;
  }

  // Arrangement overrides
  if (isBuild) {
    // Building: increase all tension dimensions
    const buildProgress = 1 - (barInPhrase / 8);
    harmonicTarget = Math.min(0.8, harmonicTarget + buildProgress * 0.2);
    melodicTarget = Math.min(0.8, melodicTarget + buildProgress * 0.2);
    densityTarget = Math.min(0.85, densityTarget + buildProgress * 0.2);
    registerTarget = Math.min(0.8, registerTarget + buildProgress * 0.15);
    expectationTarget = 0.7;
  }
  if (isDrop) {
    harmonicTarget = 0.7; melodicTarget = 0.7; rhythmicTarget = 0.7;
    registerTarget = 0.7; densityTarget = 0.8; spectralTarget = 0.7;
  }
  if (isBreak) {
    harmonicTarget = 0.3; melodicTarget = 0.2; rhythmicTarget = 0.15;
    registerTarget = 0.3; densityTarget = 0.15; spectralTarget = 0.3;
  }

  // Phrase-end: increase expectation (approaching cadence)
  if (barInPhrase >= 6) {
    expectationTarget = Math.min(0.9, expectationTarget + 0.2);
  }

  // Smooth toward targets (EMA)
  const lr = 0.15;
  const newHarmonic = state.harmonic + (harmonicTarget - state.harmonic) * lr;
  const newMelodic = state.melodic + (melodicTarget - state.melodic) * lr;
  const newRhythmic = state.rhythmic + (rhythmicTarget - state.rhythmic) * lr;
  const newRegister = state.register + (registerTarget - state.register) * lr;
  const newDensity = state.density + (densityTarget - state.density) * lr;
  const newSpectral = state.spectral + (spectralTarget - state.spectral) * lr;
  const newExpectation = state.expectation + (expectationTarget - state.expectation) * lr;

  // Overall tension: weighted average
  const overall = (
    newHarmonic * 0.2 +
    newMelodic * 0.15 +
    newRhythmic * 0.15 +
    newRegister * 0.1 +
    newDensity * 0.15 +
    newSpectral * 0.1 +
    newExpectation * 0.15
  );

  // Trajectory: compare to previous overall
  const trajectory = overall > state.overall + 0.01 ? 'rising'
    : overall < state.overall - 0.01 ? 'falling'
    : 'stable';

  return {
    harmonic: newHarmonic,
    melodic: newMelodic,
    rhythmic: newRhythmic,
    register: newRegister,
    density: newDensity,
    spectral: newSpectral,
    expectation: newExpectation,
    overall,
    resolving,
    trajectory,
  };
}
