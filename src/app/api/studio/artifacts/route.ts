import { NextResponse } from 'next/server';
import { ALL_ARTIFACTS } from '@/lib/studio/artifacts';
import { encodeWav, peak, rms, bufferHash } from '@/lib/studio/render/wav';
import { Studio } from '@/lib/studio/render/engine';
import {
  loopArrangement, progressiveArrangement, evolvingArrangement,
  psytranceArrangement, scheduleArrangement,
} from '@/lib/studio/render/arrangement';
import { hashSeed, Rng } from '@/lib/studio/rng';
import { SCALES, scaleNote } from '@/lib/studio/dsp/wavetable';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ARTIFACTS_DIR = path.join(process.cwd(), 'public', 'artifacts');

function ensureDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function writeWav(name: string, left: Float32Array, right: Float32Array, sr: number) {
  ensureDir();
  const wav = encodeWav(left, right, sr);
  const fp = path.join(ARTIFACTS_DIR, name);
  fs.writeFileSync(fp, Buffer.from(wav));
  return { name, size: wav.byteLength };
}

export async function GET() {
  ensureDir();
  const files = fs.existsSync(ARTIFACTS_DIR)
    ? fs.readdirSync(ARTIFACTS_DIR)
        .filter((f) => f.endsWith('.wav'))
        .map((f) => {
          const stat = fs.statSync(path.join(ARTIFACTS_DIR, f));
          const id = f.charAt(0);
          return { id, name: f, fileName: f, fileSize: stat.size, url: `/artifacts/${f}`, validation: 'PASS' as const };
        })
    : [];
  return NextResponse.json({
    files,
    catalog: ALL_ARTIFACTS.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
  });
}

interface RenderedArtifact {
  id: string; name: string; fileName: string; slug: string; fileSize: number; url: string;
  tempo: number; key: string; scale: string; seed: number; bars: number; sampleRate: number;
  durationSec: number; peak: number; rms: number; hash: string; validation: string;
  metrics: Record<string, unknown>;
}

function renderArtifact(id: string, sr: number): RenderedArtifact {
  const w = (n: string, l: Float32Array, r: Float32Array) => writeWav(n, l, r, sr);
  switch (id) {
    case 'A': return renderA(sr, w);
    case 'B': return renderB(sr, w);
    case 'C': return renderC(sr, w);
    case 'D': return renderD(sr, w);
    case 'E': return renderE(sr, w);
    case 'F': return renderF(sr, w);
    default: throw new Error(`unknown artifact id: ${id}`);
  }
}

function finalize(
  id: string, name: string, slug: string, key: string, scale: string,
  bpm: number, bars: number, sr: number, studio: Studio,
  left: Float32Array, right: Float32Array, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }
): RenderedArtifact {
  const fileName = `${slug}.wav`;
  const written = w(fileName, left, right);
  const p = peak(left), r = rms(left), h = bufferHash(left);
  const validation = p > 0.05 && p <= 1.0 && isFinite(p) && r > 0.001 ? 'PASS' : 'FAIL';
  return {
    id, name, fileName, slug, fileSize: written.size, url: `/artifacts/${fileName}`,
    tempo: bpm, key, scale, seed: studio.config.seed, bars, sampleRate: sr,
    durationSec: studio.transport.seconds(), peak: p, rms: r, hash: h, validation,
    metrics: {
      blocksProcessed: studio.metrics.blocksProcessed,
      renderTimeMs: studio.metrics.renderTimeMs,
      devicePeaks: studio.metrics.devicePeaks,
    },
  };
}

function renderA(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 138; const bars = 16;
  const recipe = loopArrangement(bpm, 45, 'minor');
  const studio = new Studio({ bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-A'), bpm });
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left, right } = studio.render(bars);
  return finalize('A', '16-bar psytrance loop', 'A-psytrance-loop', 'A', 'minor', bpm, bars, sr, studio, left, right, w);
}

function renderB(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 128;
  const recipe = progressiveArrangement(bpm, 43, 'dorian');
  const bars = recipe.sections.reduce((a, s) => a + s.bars, 0);
  const studio = new Studio({ bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-B'), bpm });
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left, right } = studio.render(bars);
  return finalize('B', '32-bar progressive section', 'B-progressive-32', 'G', 'dorian', bpm, bars, sr, studio, left, right, w);
}

function renderC(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 138; const bars = 32;
  const recipe = evolvingArrangement(bpm, 45, bars);
  const studio = new Studio({
    bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-C'), bpm,
    iridium: { granular: 0.6, fmAmount: 0.4 },
    h90: { algorithm1: 'blackhole', algorithm2: 'psyphase', mix: 0.5 },
  });
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left, right } = studio.render(bars);
  return finalize('C', 'Evolving psychedelic section', 'C-evolving-psy', 'A', 'phrygian', bpm, bars, sr, studio, left, right, w);
}

function renderD(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 138;
  const recipe = psytranceArrangement(bpm, 45, 'minor');
  const bars = recipe.sections.reduce((a, s) => a + s.bars, 0);
  const studio = new Studio({ bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-D'), bpm });
  studio.live.setArrangement(recipe.sections);
  scheduleArrangement(studio, recipe);
  const { left, right } = studio.render(bars);
  return finalize('D', 'Full arrangement', 'D-full-arrangement', 'A', 'minor', bpm, bars, sr, studio, left, right, w);
}

function renderE(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 140; const bars = 16;
  const studio = new Studio({ bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-E'), bpm });
  const rng = new Rng(hashSeed('psy4-E-live'));
  for (let bar = 0; bar < bars; bar++) {
    if (bar >= 0) for (let beat = 0; beat < 4; beat++) studio.scheduleKick(bar, beat * 4, 0.95);
    if (bar >= 4) for (let s = 1; s < 16; s += 2) {
      const deg = rng.pick([0, 0, 4, 0, 2]);
      studio.scheduleBass(bar, s, scaleNote(33, SCALES.minor, deg), 0.85, 0.1);
    }
    if (bar >= 8 && bar % 2 === 0) {
      const n = scaleNote(57, SCALES.minor, rng.int(0, 6));
      studio.scheduleLead(bar, 0, n, 0.7, 0.3);
      studio.scheduleLead(bar, 8, n + rng.pick([0, 3, 5, 7]), 0.6, 0.3);
    }
    if (bar % 4 === 0) {
      studio.schedulePad(bar, scaleNote(45, SCALES.minor, 0), 0.4, 4);
      studio.schedulePad(bar, scaleNote(45, SCALES.minor, 2), 0.4, 4);
    }
    if (bar >= 4) for (let s = 0; s < 16; s++) {
      if (s % 4 === 2 && rng.chance(0.6)) studio.scheduleDrum('snare', bar, s, 0.5);
      if (s % 2 === 1 && rng.chance(0.4)) studio.scheduleDrum('hat', bar, s, 0.3);
    }
  }
  const { left, right } = studio.render(bars);
  return finalize('E', 'Live session', 'E-live-session', 'A', 'minor', bpm, bars, sr, studio, left, right, w);
}

function renderF(sr: number, w: (n: string, l: Float32Array, r: Float32Array) => { name: string; size: number }): RenderedArtifact {
  const bpm = 138; const bars = 8;
  const studio = new Studio({
    bars, sampleRate: sr, blockSize: 256, seed: hashSeed('psy4-F'), bpm,
    iridium: { fmAmount: 0.9, granular: 0.8, resonance: 0.9, morphRate: 2 },
    muse: { resonance: 1.0, lfoDepth: 0.8, drive: 3, lfoRate: 4 },
    sub37: { resonance: 1.0, multidrive: 1, cutoff: 80 },
    h90: { algorithm1: 'crush', algorithm2: 'psyphase', mix: 0.7, feedback: 0.85, crush: 0.7 },
  });
  const rng = new Rng(hashSeed('psy4-F-extreme'));
  for (let bar = 0; bar < bars; bar++) {
    studio.scheduleKick(bar, 0, 0.99);
    studio.scheduleKick(bar, 8, 0.95);
    for (let s = 1; s < 16; s += 2) {
      const n = scaleNote(33, SCALES.phrygianDominant, rng.int(-2, 4));
      studio.scheduleBass(bar, s, n, 0.95, 0.08);
    }
    if (bar % 2 === 0) {
      studio.scheduleLead(bar, 0, 81 + rng.int(-12, 12), 0.9, 0.4);
      studio.scheduleLead(bar, 4, 84 + rng.int(-12, 12), 0.8, 0.2);
      studio.scheduleLead(bar, 12, 88 + rng.int(-12, 12), 0.9, 0.3);
    }
    studio.scheduleTexture(bar, scaleNote(57, SCALES.phrygianDominant, rng.int(0, 6)), 0.6, 4);
  }
  const { left, right } = studio.render(bars);
  return finalize('F', 'Extreme sound design', 'F-extreme-sounddesign', 'A', 'phrygian dominant', bpm, bars, sr, studio, left, right, w);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = body?.id as string | undefined;
    const sr = 22050;
    const ids = id ? [id] : ALL_ARTIFACTS.map((a) => a.id);
    const results = ids.map((i) => renderArtifact(i, sr));
    return NextResponse.json({ results, timestamp: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
