// src/lib/turso-sync.ts
// Client-side sync — LOCAL-FIRST architecture.
//
// All API calls go to our own server routes (which use local SQLite as primary).
// The browser sends X-User-Id header (from localStorage) to scope learning state.
// Turso cloud is used as optional backup on the server side — the browser
// doesn't know or care whether Turso is configured.

import { getAuthHeaders } from './user-identity';

export interface CloudLearningState {
  ok: boolean;
  bestParams?: Record<number, { value: number; reward: number }>;
  bestReward?: number;
  convergenceHistory?: Array<{ value: number; measuredAt: number }>;
  count?: number;
  source?: string;
}

export async function loadCloudLearningState(): Promise<CloudLearningState | null> {
  try {
    const resp = await fetch('/api/learning/state', {
      cache: 'no-store',
      headers: getAuthHeaders(),
    });
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
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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
    const resp = await fetch(`/api/learning/patterns?limit=${limit}`, {
      cache: 'no-store',
      headers: getAuthHeaders(),
    });
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
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(payload),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
