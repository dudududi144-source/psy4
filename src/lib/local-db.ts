// src/lib/local-db.ts
// PHASE 0 STUB — the real SQLite implementation is backed up at
// psy4-backup/local-db.ts.bak and will return in Phase 8 as a proper
// Prisma schema (User, Preset, LearningState) with Turso cloud sync.
//
// Why a stub: the original used `await import('better-sqlite3')` which
// Turbopack statically resolves at compile time and fails (even with
// serverExternalPackages configured). This blocked the entire app — every
// route returned 500. The stub unblocks Phase 0–7 work; the API routes
// gracefully return empty states so the UI renders and the engine runs
// fully offline. No data is lost — localStorage still works client-side.

// Local-only type placeholder. The real DB type comes back in Phase 8 (Prisma).
// type DB = Database.Database;
type DB = unknown;

export interface LocalUser {
  id: string;
  name: string | null;
  created_at: number;
  last_seen: number | null;
}

export interface LearningParam {
  cc: number;
  value: number;
  reward: number;
  updated_at: number;
}

export interface PatternEntry {
  fingerprint: string;
  reward: number;
  updated_at: number;
}

export async function initLocalSchema(): Promise<boolean> {
  // No-op in Phase 0 stub. Schema will be created in Phase 8 (Prisma db:push).
  return true;
}

export async function ensureLocalSchema(): Promise<boolean> {
  return true;
}

export async function getOrCreateUser(userId: string): Promise<LocalUser> {
  const now = Date.now();
  return { id: userId, name: null, created_at: now, last_seen: now };
}

export async function getLearningParams(_userId: string): Promise<LearningParam[]> {
  return [];
}

export async function upsertLearningParam(
  _userId: string,
  _cc: number,
  _value: number,
  _reward: number
): Promise<void> {
  // No-op. Client-side localStorage is the source of truth until Phase 8.
}

export async function getBestReward(_userId: string): Promise<number> {
  return 0;
}

export async function getTopPatterns(_userId: string, _limit = 32): Promise<PatternEntry[]> {
  return [];
}

export async function upsertPattern(
  _userId: string,
  _fingerprint: string,
  _reward: number
): Promise<void> {
  // No-op until Phase 8.
}

export async function getConvergenceHistory(
  _userId: string,
  _limit = 60
): Promise<Array<{ value: number; measured_at: number }>> {
  return [];
}

export async function addConvergence(_userId: string, _value: number): Promise<void> {
  // No-op until Phase 8.
}

export async function addRadioTelemetry(_t: {
  userId: string;
  streamName: string;
  detectedBpm: number;
  bpmConfidence: number;
  loudness: number;
  inBreakdown: boolean;
  measuredAt: number;
}): Promise<void> {
  // No-op until Phase 8.
}

export async function getTelemetryStats(_hours = 24): Promise<any[]> {
  return [];
}

export async function getDBStats(): Promise<{
  learningParams: number;
  patterns: number;
  telemetry: number;
  users: number;
}> {
  return { learningParams: 0, patterns: 0, telemetry: 0, users: 0 };
}
