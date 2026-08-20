// src/app/api/learning/state/route.ts
// GET  /api/learning/state    → fetch best params + convergence from LOCAL DB
// POST /api/learning/state     → push best params + convergence to LOCAL DB

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

export async function GET(req: NextRequest) {
  try {
    await ensureLocalSchema();
    const userId = getUserId(req);
    const params = await getLearningParams(userId);
    const bestReward = await getBestReward(userId);
    const convergenceHistory = await getConvergenceHistory(userId, 60);

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
    await ensureLocalSchema();
    const userId = getUserId(req);
    const body = await req.json();
    const { bestParams, bestReward, convergence } = body as {
      bestParams?: Record<string, number>;
      bestReward?: number;
      convergence?: number;
    };

    let pushed = 0;

    if (bestParams && typeof bestReward === 'number') {
      for (const [ccStr, value] of Object.entries(bestParams)) {
        const cc = Number(ccStr);
        if (typeof cc === 'number' && typeof value === 'number' && isFinite(value)) {
          await upsertLearningParam(userId, cc, value, bestReward);
          pushed++;
        }
      }
    }
    if (typeof convergence === 'number' && isFinite(convergence)) {
      await addConvergence(userId, convergence);
      pushed++;
    }

    // OPTIONAL: Turso backup (lazy, non-blocking, fails silently)
    if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
      try {
        const { isTursoConfigured, ensureSchema, tursoBatch } = await import('@/lib/turso');
        if (isTursoConfigured()) {
          await ensureSchema();
          const now = Date.now();
          const stmts: Array<{ sql: string; args: (string | number | null)[] }> = [];
          if (bestParams && typeof bestReward === 'number') {
            for (const [ccStr, value] of Object.entries(bestParams)) {
              const cc = Number(ccStr);
              if (typeof cc === 'number' && typeof value === 'number' && isFinite(value)) {
                // Two-step upsert: DELETE the existing row ONLY if its reward
                // is lower than the new one (so we don't clobber a better
                // existing entry), then INSERT the new row. This pattern is
                // used because SQLite's ON CONFLICT DO UPDATE WHERE clause
                // doesn't reliably fire when the conflict target is an
                // expression-based PRIMARY KEY (which we use: COALESCE(user_id,
                // 'anonymous') to treat NULL user_ids as 'anonymous').
                stmts.push({
                  sql: `DELETE FROM learning_params
                        WHERE cc = ? AND COALESCE(user_id, 'anonymous') = COALESCE(?, 'anonymous')
                          AND reward < ?`,
                  args: [cc, userId, bestReward],
                });
                stmts.push({
                  sql: `INSERT OR IGNORE INTO learning_params (cc, value, reward, updated_at, user_id)
                        VALUES (?, ?, ?, ?, ?)`,
                  args: [cc, value, bestReward, now, userId],
                });
              }
            }
          }
          if (typeof convergence === 'number' && isFinite(convergence)) {
            stmts.push({ sql: 'INSERT INTO convergence_history (value, measured_at, user_id) VALUES (?, ?, ?)', args: [convergence, now, userId] });
          }
          if (stmts.length > 0) await tursoBatch(stmts);
        }
      } catch (err) {
        console.warn('[API /learning/state POST] Turso backup failed (non-fatal):', err);
      }
    }

    return NextResponse.json({ ok: true, pushed, source: 'local' });
  } catch (err) {
    console.error('[API /learning/state POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
