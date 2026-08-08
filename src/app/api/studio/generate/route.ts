import { NextResponse } from 'next/server';
import { generate, GenerateRequest } from '@/lib/studio/engine/autonomousEngine';
import { evaluateTaste } from '@/lib/studio/engine/tasteEngine';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ARTIFACTS_DIR = path.join(process.cwd(), 'public', 'artifacts');

export async function POST(req: Request) {
  try {
    const body = await req.json() as GenerateRequest;
    const result = generate(body);

    // evaluate taste
    const taste = evaluateTaste(result.analysis, result.memory);

    // persist WAV to disk
    if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const fileName = `generated-${result.provenance.artifactId}.wav`;
    fs.writeFileSync(path.join(ARTIFACTS_DIR, fileName), Buffer.from(result.wav));

    return NextResponse.json({
      success: true,
      fileName,
      url: `/artifacts/${fileName}`,
      fileSize: result.wav.byteLength,
      provenance: result.provenance,
      analysis: result.analysis,
      verdict: result.verdict,
      taste,
      memory: {
        worldId: result.memory.worldId,
        seed: result.memory.seed,
        songId: result.memory.songId,
        currentKey: result.memory.currentKey,
        currentScale: result.memory.currentScale,
        currentTempo: result.memory.currentTempo,
        currentSection: result.memory.currentSection,
        totalMutations: result.memory.totalMutations,
        macros: {
          energy: result.memory.energy,
          psychedelia: result.memory.psychedelia,
          darkness: result.memory.darkness,
          density: result.memory.density,
          groove: result.memory.groove,
          evolution: result.memory.evolution,
          space: result.memory.space,
          surprise: result.memory.surprise,
          aggression: result.memory.aggression,
          brightness: result.memory.brightness,
        },
      },
      arrangement: result.arrangement.map((s) => ({ type: s.type, bars: s.bars, energy: s.energy, density: s.density, layers: s.activeLayers.length })),
      renderMs: result.renderMs,
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
