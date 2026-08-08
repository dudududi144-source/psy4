import { NextResponse } from 'next/server';
import { queueAction, getLiveSession } from '@/lib/studio/engine/liveEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId;
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    const session = getLiveSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const action = body.action;
    if (!action) return NextResponse.json({ error: 'action required' }, { status: 400 });
    queueAction(sessionId, action);
    return NextResponse.json({
      ok: true,
      sessionId,
      queuedAction: action,
      message: `Action "${action}" queued for next phrase boundary`,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
