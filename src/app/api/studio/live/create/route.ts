import { NextResponse } from 'next/server';
import { createLiveSession } from '@/lib/studio/engine/liveEngine';
import { WORLDS } from '@/lib/studio/engine/worlds';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const worldId = body.worldId || 'progressive-psy';
    if (!WORLDS[worldId]) return NextResponse.json({ error: `Unknown world: ${worldId}` }, { status: 400 });
    const session = createLiveSession(worldId, body.seed, body.macros);
    return NextResponse.json({
      sessionId: session.sessionId,
      worldId: session.worldId,
      worldName: session.world.name,
      seed: session.seed,
      bpm: session.bpm,
      macros: session.macros,
      currentBar: session.currentBar,
      section: session.memory.currentSection,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
