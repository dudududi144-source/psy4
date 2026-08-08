import { NextResponse } from 'next/server';
import { generateNextPhrase, getLiveSession } from '@/lib/studio/engine/liveEngine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body.sessionId;
    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    const session = getLiveSession(sessionId);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const phraseBars = body.bars || 4;
    const phrase = generateNextPhrase(sessionId, phraseBars);
    // return WAV as base64 (small enough for 4 bars at 22kHz)
    const wavBase64 = Buffer.from(phrase.wav).toString('base64');
    return NextResponse.json({
      phraseIndex: phrase.phraseIndex,
      startBar: phrase.startBar,
      bars: phrase.bars,
      durationSec: phrase.durationSec,
      bpm: phrase.bpm,
      section: phrase.section,
      energy: phrase.energy,
      density: phrase.density,
      seed: phrase.seed,
      taste: phrase.taste,
      analysis: {
        peak: phrase.analysis.peak,
        rms: phrase.analysis.rms,
        kickPeriodicity: phrase.analysis.kickPeriodicity,
        bassKickAlignment: phrase.analysis.bassKickAlignment,
        lowEnergy: phrase.analysis.lowEnergy,
      },
      wavBase64,
      wavSize: phrase.wav.byteLength,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
