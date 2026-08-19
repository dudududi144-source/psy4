// src/app/api/learning/state/route.ts
// GET  /api/learning/state    → fetch best params + latest convergence from Turso
// POST /api/learning/state     → push best params + convergence measurement
//
// This is the cross-session sync endpoint. The browser's CCLearner
// calls POST every ~20s (debounced) to persist its state to the cloud,
// and GET on init to load state from previous sessions (including
// sessions on other devices).

import { NextRequest, NextResponse } from 'next/server';
import { isTursoConfigured, ensureSchema, tursoExecute, tursoBatch } from '@/lib/turso';

export async function GET() {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    // Fetch all best params
    const paramsResult = await tursoExecute('SELECT cc, value, reward, updated_at FROM learning_params');
    // Fetch last 60 convergence measurements (4 min at 4s/tick)
    const convergenceResult = await tursoExecute(
      'SELECT value, measured_at FROM convergence_history ORDER BY measured_at DESC LIMIT 60'
    );
    // Fetch latest reward for display
    const rewardResult = await tursoExecute('SELECT MAX(reward) as best_reward FROM learning_params');

    const params: Record<number, { value: number; reward: number }> = {};
    for (const row of paramsResult.rows) {
      const cc = Number(row.cc);
      params[cc] = {
        value: Number(row.value),
        reward: Number(row.reward),
      };
    }
    const convergence = convergenceResult.rows
      .map(r => ({ value: Number(r.value), measuredAt: Number(r.measured_at) }))
      .reverse();  // chronological order for sparkline

    const bestReward = rewardResult.rows[0]?.best_reward
      ? Number(rewardResult.rows[0].best_reward)
      : 0;

    return NextResponse.json({
      ok: true,
      bestParams: params,
      bestReward,
      convergenceHistory: convergence,
      count: Object.keys(params).length,
    });
  } catch (err) {
    console.error('[API /learning/state GET] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isTursoConfigured()) {
    return NextResponse.json({ ok: false, reason: 'turso not configured' }, { status: 503 });
  }
  try {
    await ensureSchema();
    const body = await req.json();
    const { bestParams, bestReward, convergence } = body as {
      bestParams?: Record<string, number>;
      bestReward?: number;
      convergence?: number;
    };

    let pushed = 0;
    const now = Date.now();

    // Upsert best params
    if (bestParams && typeof bestReward === 'number') {
      const stmts: Array<{ sql: string; args: (string | number | null)[] }> = [];
      for (const [ccStr, value] of Object.entries(bestParams)) {
        const cc = Number(ccStr);
        if (typeof cc === 'number' && typeof value === 'number' && isFinite(value)) {
          stmts.push({
            sql: `INSERT INTO learning_params (cc, value, reward, updated_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT(cc) DO UPDATE SET value = excluded.value, reward = excluded.reward, updated_at = excluded.updated_at
                  WHERE excluded.reward > learning_params.reward`,
            args: [cc, value, bestReward, now],
          });
          pushed++;
        }
      }
      // Append convergence measurement
      if (typeof convergence === 'number' && isFinite(convergence)) {
        stmts.push({
          sql: 'INSERT INTO convergence_history (value, measured_at) VALUES (?, ?)',
          args: [convergence, now],
        });
        pushed++;
      }
      if (stmts.length > 0) {
        await tursoBatch(stmts);
      }
    }

    return NextResponse.json({ ok: true, pushed });
  } catch (err) {
    console.error('[API /learning/state POST] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
