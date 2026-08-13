/**
 * PSY4 Vertical Validation — Variant B/C/D/E Renderer
 *
 * All 4 variants use the SAME refactored backend (voice-backend.ts).
 * The only difference is which VoiceSpec builder is used.
 */

import type { CompositionEvent, ExperimentalUnit, VoiceSpecification } from './types.ts';
import { createRenderCtx, mtof, writeWAV, unitDurationSec } from './audio-utils.ts';
import { SampleBank } from './sample-bank.ts';
import { playKickVoice, playBassVoice, playLeadVoice, playHatVoice } from './voice-backend.ts';
import { buildVariantB, buildVariantC, buildVariantD, buildVariantE } from './voice-spec-builders.ts';

type Role = 'kick' | 'bass' | 'lead' | 'hat' | 'perc';

function deriveRole(ev: CompositionEvent): Role {
  if (ev.trackName === 'kick') return 'kick';
  if (ev.trackName === 'hat') return 'hat';
  if (ev.trackName === 'perc') return 'perc';
  if (ev.sourceMaterial === 'bass-pattern') return 'bass';
  if (ev.sourceMaterial === 'motif') return 'lead';
  return 'perc';
}

async function renderWithSpecs(
  unit: ExperimentalUnit,
  specs: VoiceSpecification[],
  outPath: string,
  builderName: string,
): Promise<void> {
  const dur = unitDurationSec(unit.bars, unit.bpm);
  const { ctx, master, noiseBuf } = createRenderCtx(dur);

  // Buses
  const kickBus = ctx.createGain(); kickBus.gain.value = 0.8;
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.7;
  const leadBus = ctx.createGain(); leadBus.gain.value = 0.5;
  const hatBus = ctx.createGain(); hatBus.gain.value = 0.4;

  kickBus.connect(master.input);
  bassBus.connect(master.input);
  leadBus.connect(master.input);
  hatBus.connect(master.input);

  // Load samples (kick + hat)
  const sampleBank = new SampleBank(ctx);
  const kickSample = (await sampleBank.loadKick(0))?.buffer ?? null;
  const hatSample = (await sampleBank.loadHat(0))?.buffer ?? null;

  const stepDur = (60 / unit.bpm) / 4;

  // Render each event using its VoiceSpec
  for (let i = 0; i < unit.events.length; i++) {
    const ev = unit.events[i];
    const spec = specs[i];
    if (!spec) continue;
    const role = deriveRole(ev);
    const t = ev.step * stepDur; // raw step time (microtiming is in spec.performance)

    if (role === 'kick') {
      playKickVoice(ctx, kickBus, noiseBuf, sampleBank, kickSample, spec, t);
    } else if (role === 'bass') {
      playBassVoice(ctx, bassBus, spec, t);
    } else if (role === 'lead') {
      playLeadVoice(ctx, leadBus, spec, t);
    } else if (role === 'hat') {
      playHatVoice(ctx, hatBus, hatSample, spec, t);
    }
  }

  const rendered = await ctx.startRendering();
  writeWAV(outPath, rendered.getChannelData(0));
  console.log(`  ${builderName}: wrote ${outPath} (peak ${peak(rendered.getChannelData(0)).toFixed(3)})`);
}

function peak(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  return p;
}

export async function renderVariantB(unit: ExperimentalUnit, outPath: string): Promise<void> {
  const specs = buildVariantB(unit.events, unit.bpm);
  await renderWithSpecs(unit, specs, outPath, 'B');
}

export async function renderVariantC(unit: ExperimentalUnit, outPath: string): Promise<void> {
  const specs = buildVariantC(unit.events, unit.bpm);
  await renderWithSpecs(unit, specs, outPath, 'C');
}

export async function renderVariantD(unit: ExperimentalUnit, outPath: string): Promise<void> {
  const specs = buildVariantD(unit.events, unit.bpm);
  await renderWithSpecs(unit, specs, outPath, 'D');
}

export async function renderVariantE(unit: ExperimentalUnit, outPath: string): Promise<void> {
  const specs = buildVariantE(unit.events, unit.bpm);
  await renderWithSpecs(unit, specs, outPath, 'E');
}
