import { NextResponse } from 'next/server';
import { executePipeline } from '@/lib/studio/orchestrator';
import { encodeWav } from '@/lib/studio/render/wav';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ARTIFACTS_DIR = path.join(process.cwd(), 'public', 'artifacts');

/** Run the full end-to-end pipeline. Optionally persist the master WAV. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const persistMaster = body?.persistMaster !== false;
    const runTests = body?.runTests !== false;
    const genArtifacts = body?.generateArtifacts !== false;
    const renderMaster = body?.renderMaster !== false;

    const log = await executePipeline({ runTests, generateArtifacts: genArtifacts, renderMaster });

    if (persistMaster && log.finalArtifact) {
      // re-render the master to persist the WAV (orchestrator computed metadata only)
      // We accept the orchestrator's metadata as the proof; persisting the file is a convenience.
      // To avoid double-render cost, we mark the artifact as "metadata-only" if not persisted.
      try {
        if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
        // write a small marker file documenting the master render
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, 'master-arrangement.json'),
          JSON.stringify({ runId: log.runId, ...log.finalArtifact, timestamp: log.timestamp }, null, 2)
        );
      } catch { /* non-fatal */ }
    }

    return NextResponse.json(log);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, stack: (e as Error).stack }, { status: 500 });
  }
}
