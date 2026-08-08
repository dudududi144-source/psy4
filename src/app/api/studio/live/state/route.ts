import { NextResponse } from 'next/server';
import { getSessionState } from '@/lib/studio/engine/liveEngine';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  const state = getSessionState(sessionId);
  if (!state) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  return NextResponse.json(state);
}
