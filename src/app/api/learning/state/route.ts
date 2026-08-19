// src/app/api/learning/state/route.ts
// GET  /api/learning/state    → fetch best params + convergence from LOCAL DB
// POST /api/learning/state     → push best params + convergence to LOCAL DB
//
// LOCAL-FIRST architecture:
//   - Local SQLite is PRIMARY (always works, no cloud dependency)
//   - Turso is OPTIONAL backup (synced asynchronously if configured)
//
// User ID comes from X-User-Id header (anonymous, localStorage-generated).

import { NextRequest, NextResponse } from 'next/server';
import {
  ensureLocalSchema,
  getLearningParams,
  getBestReward,
  getConvergenceHistory,
  upsertLearningParam,
  addConvergence,
} from '@/lib/local-db';

function getUserId(req: NextRequest): string {
  return req.headers.get('X-User-Id') || 'anonymous';
}

// Lazy Turso import — only loaded if env vars are configured.
// This keeps the route lightweight when Turso is disabled.
async function tryTursoBackup(userId: string, bestParams: Record<string, number> | undefined, bestReward: number | undefined, convergence: number | undefined): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) return;
  try {
    const { isTursoConfigured, ensureSchema, tursoBatch } = await import('@/lib/turso');
    if (!isTursoConfigured()) return;
    await ensureSchema();
    const now = Date.now();
    const stmts: Array<{ sql: string; args: (string | number | null)[] }> = [];
    if (bestParams && typeof bestReward === 'number') {
      for (const [ccStr, value] of Object.entries(bestParams)) {
        const cc = Number(ccStr);
        if (typeof cc === 'number' && typeof value === 'number' && isFinite(value)) {
          stmts.push({
            sql: `INSERT INTO learning_params (cc, value, reward, updated_at, user_id) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(cc, COALESCE(user_id, 'anonymous')) DO UPDATE SET value = excluded.value, reward = excluded.reward, updated_at = excluded.updated_at
                  WHERE excluded.reward > learning_params.reward`,
            args: [cc, value, bestReward, now, userId],
          });
        }
      }
    }
    if (typeof convergence === 'number' && isFinite(convergence)) {
      stmts.push({
        sql: 'INSERT INTO convergence_history (value, measured_at, user_id) VALUES (?, ?, ?)',
        args: [convergence, now, userId],
      });
    }
    if (stmts.length > 0) await tursoBatch(stmts);
  } catch (err) {
    console.warn('[API /learning/state POST] Turso backup failed (non-fatal):', err);
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureLocalSchema();
    const userId = getUserId(req);
    const params = getLearningParams(userId);
    const bestReward = getBestReward(userId);
    const convergenceHistory = getConvergenceHistory(userId, 60);

    return NextResponse.json({
      ok: true,
      bestParams: Object.fromEntries(params.map(p => [p.cc, { value: p.value, reward: p.reward }])),
      bestReward,
      convergenceHistory,
      count: params.length,
      source: 'local',
    });
  } catch (err) {
    console.error('[API /learning/state GET] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureLocalSchema();
    const userId = getUserId(req);
    const body = await req.json();
    const { bestParams, bestReward, convergence } = body as {
      bestParams?: Record<string, number>;
      bestReward?: number;
      convergence?: number;
    };

    let pushed = 0;

    // PRIMARY: write to local SQLite
    if (bestParams && typeof bestReward === 'number') {
      for (const [ccStr, value] of Object.entries(bestParams)) {
        const cc = Number(ccStr);
        if (typeof cc === 'number' && typeof value === 'number' && isFinite(value)) {
          upsertLearningParam(userId, cc, value, bestReward);
          pushed++;
        }
      }
    }
    if (typeof convergence === 'number' && isFinite(convergence)) {
      addConvergence(userId, convergence);
      pushed++;
    }

    // OPTIONAL: sync to Turso as backup (lazy import, non-blocking, fail silently)
    await tryTursoBackup(userId, bestParams as Record<string, number> | undefined, bestReward, convergence);

    return NextResponse.json({ ok: true, pushed, source: 'local' });
  } catch (err) {
    console.error('[API /learning/state POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
