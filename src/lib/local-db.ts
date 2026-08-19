// src/lib/local-db.ts
// Local-first SQLite database — the PRIMARY data store.
//
// Architecture (no cloud dependency):
//   Browser → API routes → local-db (SQLite, synchronous)
//                       → localStorage (immediate backup in browser)
//                       → Turso (OPTIONAL cloud sync — only if configured + reachable)
//
// This file runs SERVER-SIDE only. The browser never touches SQLite directly.
// All browser→DB communication goes through API routes.
//
// Tables:
//   - users: local user profiles (anonymous id, optional name)
//   - learning_params: per-user best CC params + rewards
//   - pattern_memory: per-user high-reward bar fingerprints
//   - convergence_history: per-user convergence over time
//   - radio_telemetry: radio analysis snapshots (shared, not per-user)

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';

let _db: Database.Database | null = null;
let _schemaReady = false;

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || join(process.cwd(), 'db', 'custom.db');

export function getLocalDB(): Database.Database {
  if (_db) return _db;
  // Ensure directory exists
  mkdirSync(dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');  // better concurrent read performance
  _db.pragma('foreign_keys = ON');
  console.log('[LocalDB] connected:', DB_PATH);
  return _db;
}

export function initLocalSchema(): boolean {
  if (_schemaReady) return true;
  const db = getLocalDB();
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at INTEGER NOT NULL,
        last_seen INTEGER
      );

      CREATE TABLE IF NOT EXISTS learning_params (
        cc INTEGER NOT NULL,
        value REAL NOT NULL,
        reward REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'anonymous',
        PRIMARY KEY (cc, user_id)
      );

      CREATE TABLE IF NOT EXISTS pattern_memory (
        fingerprint TEXT NOT NULL,
        reward REAL NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        last_used REAL NOT NULL,
        created_at INTEGER NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'anonymous',
        PRIMARY KEY (fingerprint, user_id)
      );

      CREATE TABLE IF NOT EXISTS convergence_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value REAL NOT NULL,
        measured_at INTEGER NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'anonymous'
      );

      CREATE TABLE IF NOT EXISTS radio_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stream_name TEXT NOT NULL,
        bpm REAL NOT NULL,
        warmth REAL NOT NULL,
        brightness REAL NOT NULL,
        loudness REAL NOT NULL,
        smoothness REAL NOT NULL,
        style TEXT NOT NULL,
        in_breakdown INTEGER NOT NULL DEFAULT 0,
        measured_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pattern_reward ON pattern_memory(reward DESC);
      CREATE INDEX IF NOT EXISTS idx_convergence_time ON convergence_history(measured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_telemetry_time ON radio_telemetry(measured_at DESC);
      CREATE INDEX IF NOT EXISTS idx_learning_user ON learning_params(user_id);
      CREATE INDEX IF NOT EXISTS idx_pattern_user ON pattern_memory(user_id);
    `);
    _schemaReady = true;
    console.log('[LocalDB] schema initialized ✓');
    return true;
  } catch (err) {
    console.error('[LocalDB] schema init failed:', err);
    return false;
  }
}

export function ensureLocalSchema(): boolean {
  if (_schemaReady) return true;
  return initLocalSchema();
}

// ── User operations ──────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  name: string | null;
  created_at: number;
  last_seen: number | null;
}

export function getOrCreateUser(userId: string): LocalUser {
  ensureLocalSchema();
  const db = getLocalDB();
  const now = Date.now();
  // Try to find existing user
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as LocalUser | undefined;
  if (existing) {
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
    return { ...existing, last_seen: now };
  }
  // Create new user
  db.prepare('INSERT INTO users (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)').run(
    userId, null, now, now
  );
  console.log(`[LocalDB] created user: ${userId}`);
  return { id: userId, name: null, created_at: now, last_seen: now };
}

// ── Learning params operations ──────────────────────────────────────────

export interface LearningParam {
  cc: number;
  value: number;
  reward: number;
}

export function getLearningParams(userId: string): LearningParam[] {
  ensureLocalSchema();
  const db = getLocalDB();
  const rows = db.prepare(
    'SELECT cc, value, reward FROM learning_params WHERE user_id = ?'
  ).all(userId) as LearningParam[];
  return rows;
}

export function upsertLearningParam(userId: string, cc: number, value: number, reward: number): void {
  ensureLocalSchema();
  const db = getLocalDB();
  const now = Date.now();
  db.prepare(`
    INSERT INTO learning_params (cc, value, reward, updated_at, user_id) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cc, user_id) DO UPDATE SET
      value = excluded.value,
      reward = excluded.reward,
      updated_at = excluded.updated_at
    WHERE excluded.reward > learning_params.reward
  `).run(cc, value, reward, now, userId);
}

export function getBestReward(userId: string): number {
  ensureLocalSchema();
  const db = getLocalDB();
  const row = db.prepare(
    'SELECT MAX(reward) as best FROM learning_params WHERE user_id = ?'
  ).get(userId) as { best: number | null } | undefined;
  return row?.best ?? 0;
}

// ── Pattern memory operations ───────────────────────────────────────────

export interface PatternEntry {
  fingerprint: string;
  reward: number;
  hits: number;
  last_used: number;
  created_at: number;
}

export function getTopPatterns(userId: string, limit: number = 32): PatternEntry[] {
  ensureLocalSchema();
  const db = getLocalDB();
  return db.prepare(
    'SELECT fingerprint, reward, hits, last_used, created_at FROM pattern_memory WHERE user_id = ? ORDER BY reward DESC LIMIT ?'
  ).all(userId, Math.min(100, Math.max(1, limit))) as PatternEntry[];
}

export function upsertPattern(userId: string, fingerprint: string, reward: number): void {
  ensureLocalSchema();
  const db = getLocalDB();
  const now = Date.now();
  db.prepare(`
    INSERT INTO pattern_memory (fingerprint, reward, hits, last_used, created_at, user_id) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(fingerprint, user_id) DO UPDATE SET
      reward = (pattern_memory.reward * 0.7 + excluded.reward * 0.3),
      hits = pattern_memory.hits + 1,
      last_used = excluded.last_used
  `).run(fingerprint, reward, now / 1000, now, userId);
  // Prune: keep top 500 per user
  db.prepare(`
    DELETE FROM pattern_memory WHERE (fingerprint, user_id) IN (
      SELECT fingerprint, user_id FROM (
        SELECT fingerprint, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY reward DESC) as rn
        FROM pattern_memory WHERE user_id = ?
      ) WHERE rn > 500
    )
  `).run(userId);
}

// ── Convergence history operations ──────────────────────────────────────

export function getConvergenceHistory(userId: string, limit: number = 60): Array<{ value: number; measured_at: number }> {
  ensureLocalSchema();
  const db = getLocalDB();
  const rows = db.prepare(
    'SELECT value, measured_at FROM convergence_history WHERE user_id = ? ORDER BY measured_at DESC LIMIT ?'
  ).all(userId, limit) as Array<{ value: number; measured_at: number }>;
  return rows.reverse();  // chronological order
}

export function addConvergence(userId: string, value: number): void {
  ensureLocalSchema();
  const db = getLocalDB();
  const now = Date.now();
  db.prepare('INSERT INTO convergence_history (value, measured_at, user_id) VALUES (?, ?, ?)').run(value, now, userId);
  // Prune: keep last 1000 per user
  db.prepare(`
    DELETE FROM convergence_history WHERE id IN (
      SELECT id FROM convergence_history WHERE user_id = ? ORDER BY measured_at DESC LIMIT -1 OFFSET 1000
    )
  `).run(userId);
}

// ── Radio telemetry operations (shared, not per-user) ───────────────────

export function addRadioTelemetry(t: {
  streamName: string; bpm: number; warmth: number; brightness: number;
  loudness: number; smoothness: number; style: string; inBreakdown: boolean;
}): void {
  ensureLocalSchema();
  const db = getLocalDB();
  db.prepare(`
    INSERT INTO radio_telemetry (stream_name, bpm, warmth, brightness, loudness, smoothness, style, in_breakdown, measured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t.streamName, t.bpm, t.warmth, t.brightness, t.loudness, t.smoothness, t.style, t.inBreakdown ? 1 : 0, Date.now());
  // Prune: keep last 10000
  db.prepare('DELETE FROM radio_telemetry WHERE id IN (SELECT id FROM radio_telemetry ORDER BY measured_at DESC LIMIT -1 OFFSET 10000)').run();
}

export function getTelemetryStats(hours: number = 24): any {
  ensureLocalSchema();
  const db = getLocalDB();
  const sinceMs = Date.now() - hours * 3600 * 1000;
  const rows = db.prepare(`
    SELECT
      stream_name,
      COUNT(*) as samples,
      AVG(bpm) as avg_bpm,
      AVG(warmth) as avg_warmth,
      AVG(brightness) as avg_brightness,
      AVG(loudness) as avg_loudness,
      AVG(smoothness) as avg_smoothness,
      SUM(in_breakdown) as breakdown_count,
      MIN(measured_at) as first_seen,
      MAX(measured_at) as last_seen
    FROM radio_telemetry
    WHERE measured_at > ?
    GROUP BY stream_name
    ORDER BY samples DESC
  `).all(sinceMs) as any[];
  return rows.map(r => ({
    streamName: r.stream_name,
    samples: r.samples,
    avgBpm: r.avg_bpm ?? 0,
    avgWarmth: r.avg_warmth ?? 0,
    avgBrightness: r.avg_brightness ?? 0,
    avgLoudness: r.avg_loudness ?? 0,
    avgSmoothness: r.avg_smoothness ?? 0,
    breakdownPct: r.samples > 0 ? (r.breakdown_count / r.samples) * 100 : 0,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}

// ── Stats ────────────────────────────────────────────────────────────────

export function getDBStats(): { learningParams: number; patterns: number; telemetry: number; users: number } {
  ensureLocalSchema();
  const db = getLocalDB();
  return {
    learningParams: (db.prepare('SELECT COUNT(*) as c FROM learning_params').get() as any).c,
    patterns: (db.prepare('SELECT COUNT(*) as c FROM pattern_memory').get() as any).c,
    telemetry: (db.prepare('SELECT COUNT(*) as c FROM radio_telemetry').get() as any).c,
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
  };
}
