import { NextResponse } from 'next/server';
import { queueMacroChange, getLiveSession } from '@/lib/studio/engine/liveEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId;
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    const session = getLiveSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const changes = body.macros || {};
    // clamp all macros to 0..1
    const clamped: Record<string, number> = {};
    for (const [k, v] of Object.entries(changes)) {
      clamped[k] = Math.max(0, Math.min(1, Number(v) || 0));
    }
    queueMacroChange(sessionId, clamped);
    return NextResponse.json({
      ok: true,
      sessionId,
      queued: clamped,
      message: 'Macros queued for next phrase boundary',
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
