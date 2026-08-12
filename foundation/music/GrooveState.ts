/**
 * GrooveState — F21 Phase 1: Shared rhythmic identity.
 *
 * This is NOT an observational object. It is a CAUSAL musical state that
 * drives kick, bass, and lead generation. All voices read this state to
 * know where accents, ghosts, and spaces are.
 *
 * The groove PERSISTS across bars — it has identity. Notes change, but
 * the groove pocket stays recognizable.
 */

export interface GrooveState {
  /** 16-step accent map (0-1 velocity multiplier per step) */
  accentMap: number[];
  /** 16-step ghost note map (0-1 probability of ghost note per step) */
  ghostMap: number[];
  /** 16-step space map (0-1 — how much rhythmic space at this step; 1 = open) */
  spaceMap: number[];
  /** Swing amount (0 = straight, 1 = full swing). Applied to odd 16th steps. */
  swing: number;
  /** Microtiming offset in seconds per step (0 = on-grid) */
  microTiming: number[];
  /** Velocity accent profile — which beats are strong/weak */
  velocityProfile: number[];
  /** Groove identity hash — for tracking persistence */
  identityHash: string;
  /** Density target (0-1) */
  density: number;
  /** Syncopation level (0-1) */
  syncopation: number;
}

export function createDefaultGroove(): GrooveState {
  return {
    accentMap: [1.0, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3, 0.7, 0.3, 0.5, 0.3, 0.8, 0.3, 0.5, 0.3],
    ghostMap: new Array(16).fill(0),
    spaceMap: [0, 0.5, 0.3, 0.5, 0.2, 0.5, 0.3, 0.5, 0.1, 0.5, 0.3, 0.5, 0.2, 0.5, 0.3, 0.5],
    swing: 0,
    microTiming: new Array(16).fill(0),
    velocityProfile: [1.0, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4, 0.7, 0.4, 0.6, 0.4, 0.8, 0.4, 0.6, 0.4],
    identityHash: 'default',
    density: 0.5,
    syncopation: 0.3,
  };
}

/**
 * Generate a groove state from context.
 * The groove is STABLE — it doesn't change every bar. It changes when
 * the section changes or when the user requests a different feel.
 */
export function generateGrooveState(context: {
  section: string;
  style: string;
  energy: number;
  bpm: number;
  isBreak: boolean;
  isDrop: boolean;
}): GrooveState {
  const { section, style, energy, isBreak, isDrop } = context;

  // Base accent map: 4-on-floor with downbeat accent
  const accentMap = new Array(16).fill(0.3);
  accentMap[0] = 1.0;   // downbeat — strongest
  accentMap[4] = 0.8;   // beat 2
  accentMap[8] = 0.7;   // beat 3 (backbeat)
  accentMap[12] = 0.8;  // beat 4

  // Ghost map: empty by default
  const ghostMap = new Array(16).fill(0);

  // Space map: where is there rhythmic space (no kick/bass)?
  const spaceMap = new Array(16).fill(0.5);
  spaceMap[0] = 0; spaceMap[4] = 0.2; spaceMap[8] = 0.1; spaceMap[12] = 0.2;

  // Swing
  let swing = 0;
  if (style === 'DARK') swing = 0.15;
  else if (style === 'PROGRESSIVE') swing = 0.08;

  // Microtiming: laid-back for DARK, pushed for ACID
  const microTiming = new Array(16).fill(0);
  if (style === 'DARK') {
    // Laid-back: slight delay on beats
    for (let i = 0; i < 16; i += 4) microTiming[i] = 0.008;
  } else if (style === 'ACID') {
    // Pushed: slight advance on offbeats
    for (let i = 2; i < 16; i += 4) microTiming[i] = -0.005;
  }

  // Velocity profile
  const velocityProfile = [...accentMap];

  // Density
  let density = 0.5;
  if (section === 'CLIMAX' || isDrop) density = 0.8;
  else if (section === 'INTRO') density = 0.3;
  else if (isBreak) density = 0.2;

  // Syncopation
  let syncopation = 0.3;
  if (style === 'ACID') syncopation = 0.6;
  else if (style === 'DARK') syncopation = 0.2;

  // Ghost notes: add for CLIMAX/DROP
  if (section === 'CLIMAX' || isDrop) {
    ghostMap[7] = 0.3;
    ghostMap[10] = 0.25;
    ghostMap[14] = 0.2;
  }

  // Style-specific accent modifications
  if (style === 'DARK') {
    // Half-time feel: accent beats 0 and 8 only
    accentMap[4] = 0.3; accentMap[12] = 0.3;
    spaceMap[4] = 0.5; spaceMap[12] = 0.5;
  } else if (style === 'ACID') {
    // Syncopated accents
    accentMap[3] = 0.6; accentMap[6] = 0.5; accentMap[11] = 0.6; accentMap[14] = 0.5;
  }

  const identityHash = `${style}-${section}-${isBreak ? 'break' : isDrop ? 'drop' : 'normal'}`;

  return {
    accentMap, ghostMap, spaceMap, swing, microTiming,
    velocityProfile, identityHash, density, syncopation,
  };
}
