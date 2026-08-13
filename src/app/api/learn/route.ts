import { createClient, type Client } from '@libsql/client';

/**
 * POST /api/learn
 * Body: { deviceId, action, payload }
 *
 * Actions:
 *   - 'session'    → upsert a learning session summary
 *   - 'scale_vote' → increment pitch class vote
 *   - 'tempo_vote' → increment bpm vote
 *   - 'sync'       → bulk sync localStorage learning data
 *
 * GET /api/learn?deviceId=xxx
 *   → returns aggregated learning stats for this device
 *
 * Uses Turso (libsql) via HTTP transport — works in Edge runtime.
 */

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface LearnRequest {
  deviceId: string;
  action: 'session' | 'scale_vote' | 'tempo_vote' | 'sync';
  payload: any;
}

function getClient(): Client | null {
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_TOKEN;
  if (!url || !token || url.includes('example.com')) return null;
  try {
    return createClient({ url, authToken: token });
  } catch {
    return null;
  }
}

async function ensureTables(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS LearningSession (
      id TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL,
      streamId TEXT,
      presetId TEXT,
      variant TEXT,
      detectedBpm INTEGER,
      detectedKey TEXT,
      detectedScale TEXT,
      scaleMatch REAL,
      kickCount INTEGER,
      sessionStart DATETIME,
      duration INTEGER,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS ScaleVote (
      id TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL,
      pitchClass INTEGER NOT NULL,
      count INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(deviceId, pitchClass)
    );
    CREATE TABLE IF NOT EXISTS TempoVote (
      id TEXT PRIMARY KEY,
      deviceId TEXT NOT NULL,
      bpm INTEGER NOT NULL,
      count INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(deviceId, bpm)
    );
  `);
}

async function safeExecute(client: Client, sql: string, args: any[]): Promise<boolean> {
  try {
    await client.execute({ sql, args });
    return true;
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      await ensureTables(client);
      try {
        await client.execute({ sql, args });
        return true;
      } catch { return false; }
    }
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as LearnRequest;
    const client = getClient();
    if (!client) {
      // DB not configured — accept silently (localStorage is the source of truth)
      return Response.json({ ok: true, stored: false, reason: 'db_not_configured' });
    }

    const { deviceId, action, payload } = body;
    if (!deviceId || !action) {
      return Response.json({ ok: false, error: 'Missing deviceId or action' }, { status: 400 });
    }

    if (action === 'session') {
      try {
        await client.execute({
          sql: `INSERT INTO LearningSession (id, deviceId, streamId, presetId, variant, detectedBpm, detectedKey, detectedScale, scaleMatch, kickCount, duration, createdAt)
                VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          args: [
            deviceId,
            payload.streamId || 'unknown',
            payload.presetId || 'unknown',
            payload.variant || 'A',
            payload.detectedBpm || null,
            payload.detectedKey || null,
            payload.detectedScale || null,
            payload.scaleMatch || null,
            payload.kickCount || 0,
            payload.duration || 0,
          ],
        });
      } catch (e: any) {
        if (e.message?.includes('no such table')) {
          // Tables don't exist — create them
          await ensureTables(client);
          return Response.json({ ok: true, stored: true, created: true });
        }
        throw e;
      }
      return Response.json({ ok: true });
    }

    if (action === 'scale_vote') {
      const pc = payload.pitchClass;
      const count = payload.count || 1;
      await safeExecute(client,
        `INSERT INTO ScaleVote (id, deviceId, pitchClass, count, createdAt)
              VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now'))
              ON CONFLICT(deviceId, pitchClass) DO UPDATE SET count = count + ?`,
        [deviceId, pc, count, count],
      );
      return Response.json({ ok: true });
    }

    if (action === 'tempo_vote') {
      const bpm = payload.bpm;
      const count = payload.count || 1;
      await safeExecute(client,
        `INSERT INTO TempoVote (id, deviceId, bpm, count, createdAt)
              VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now'))
              ON CONFLICT(deviceId, bpm) DO UPDATE SET count = count + ?`,
        [deviceId, bpm, count, count],
      );
      return Response.json({ ok: true });
    }

    if (action === 'sync') {
      // Bulk sync: takes { bpmVotes, pitchClassHistogram }
      const { bpmVotes, pitchClassHistogram } = payload;
      if (bpmVotes) {
        for (const [bpmStr, count] of Object.entries(bpmVotes)) {
          const bpm = parseInt(bpmStr);
          if (bpm > 0 && (count as number) > 0) {
            await safeExecute(client,
              `INSERT INTO TempoVote (id, deviceId, bpm, count, createdAt)
                    VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now'))
                    ON CONFLICT(deviceId, bpm) DO UPDATE SET count = count + ?`,
              [deviceId, bpm, count, count, count],
            );
          }
        }
      }
      if (pitchClassHistogram) {
        for (let pc = 0; pc < 12; pc++) {
          const count = pitchClassHistogram[pc] || 0;
          if (count > 0) {
            await safeExecute(client,
              `INSERT INTO ScaleVote (id, deviceId, pitchClass, count, createdAt)
                    VALUES (lower(hex(randomblob(8))), ?, ?, ?, datetime('now'))
                    ON CONFLICT(deviceId, pitchClass) DO UPDATE SET count = count + ?`,
              [deviceId, pc, count, count],
            );
          }
        }
      }
      return Response.json({ ok: true, synced: true });
    }

    return Response.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const deviceId = url.searchParams.get('deviceId');
    if (!deviceId) {
      return Response.json({ ok: false, error: 'Missing deviceId' }, { status: 400 });
    }
    const client = getClient();
    if (!client) {
      return Response.json({ ok: false, error: 'DB not configured' }, { status: 503 });
    }

    const [scaleVotes, tempoVotes, sessions] = await Promise.all([
      client.execute({ sql: 'SELECT pitchClass, count FROM ScaleVote WHERE deviceId = ? ORDER BY count DESC', args: [deviceId] }),
      client.execute({ sql: 'SELECT bpm, count FROM TempoVote WHERE deviceId = ? ORDER BY count DESC', args: [deviceId] }),
      client.execute({ sql: 'SELECT * FROM LearningSession WHERE deviceId = ? ORDER BY createdAt DESC LIMIT 20', args: [deviceId] }),
    ]);

    return Response.json({
      ok: true,
      scaleVotes: scaleVotes.rows,
      tempoVotes: tempoVotes.rows,
      sessions: sessions.rows,
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
