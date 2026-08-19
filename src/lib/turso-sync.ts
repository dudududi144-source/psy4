// Client-side Turso sync — bridges the CCLearner (in-memory) with the
// Turso cloud database (cross-session, cross-device persistence).
//
// The browser calls these functions to:
// - loadState(): on engine init, fetch best params + convergence from cloud
// - syncState(): every ~20s (debounced), push best params + convergence to cloud
// - syncPatterns(): every ~30s, push new pattern observations to cloud
// - logRadioTelemetry(): on each radio analysis, log to cloud for offline analysis
//
// If the API is unreachable, all functions fail silently (localStorage is
// the fallback). The learning system works fully offline; Turso is an
// enhancement for cross-device sync.

export interface CloudLearningState {
  ok: boolean;
  bestParams?: Record<number, { value: number; reward: number }>;
  bestReward?: number;
  convergenceHistory?: Array<{ value: number; measuredAt: number }>;
  count?: number;
}

export async function loadCloudLearningState(): Promise<CloudLearningState | null> {
  try {
    const resp = await fetch('/api/learning/state', { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data;
  } catch {
    return null;
  }
}

export async function syncCloudLearningState(
  bestParams: Record<number, number>,
  bestReward: number,
  convergence: number,
): Promise<boolean> {
  try {
    const resp = await fetch('/api/learning/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bestParams, bestReward, convergence }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function syncCloudPatterns(
  patterns: Array<{ fingerprint: string; reward: number }>,
): Promise<boolean> {
  try {
    const resp = await fetch('/api/learning/patterns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patterns }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function loadCloudPatterns(limit: number = 32): Promise<Array<{
  fingerprint: string;
  reward: number;
  hits: number;
}> | null> {
  try {
    const resp = await fetch(`/api/learning/patterns?limit=${limit}`, { cache: 'no-store' });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.patterns || null;
  } catch {
    return null;
  }
}

export async function logRadioTelemetry(payload: {
  streamName: string;
  bpm: number;
  warmth: number;
  brightness: number;
  loudness: number;
  smoothness: number;
  style: string;
  inBreakdown: boolean;
}): Promise<boolean> {
  try {
    const resp = await fetch('/api/telemetry/radio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
