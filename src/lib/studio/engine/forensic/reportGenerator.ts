/**
 * Forensic Report Generator — produces the final FORENSIC AUDIO REPORT.
 *
 * No marketing language. Only metrics. Only evidence.
 *
 * Format matches the user's specification:
 *   LATENCY / JITTER / UNDERRUNS / CPU
 *   WORLD DIFFERENTIATION
 *   BASS / KICK / KICK-BASS OVERLAP
 *   REPETITION
 *   OFFLINE RENDER: PASS/FAIL
 *   A/B ANALYSIS: PASS/FAIL
 *   CLOSED LOOP: PASS/FAIL
 */

import type { AudioAnalysis } from './audioAnalyzer';
import type { RepetitionReport } from './repetitionDetector';
import type { WorldDifferentiationReport } from './worldDifferentiator';
import type { ParamValidationReport } from './paramValidator';
import type { ClosedLoopResult } from './closedLoop';
import type { QualityScore } from './qualityScore';
import { FORENSIC_WORLDS } from './worlds';

export interface LatencyMetrics {
  audioContextLatency: number;   // seconds
  averageJitter: number;         // seconds (std dev of step timing)
  maxJitter: number;             // seconds
  lateEvents: number;            // count
  droppedEvents: number;         // count
  underruns: number;             // count
  activeVoices: number;          // average
  cpuLoad: number;               // 0..1
  uiRenderCount: number;         // per second
  workletMessageCount: number;   // per second
}

export interface ForensicReport {
  // Latency section
  latency: LatencyMetrics | null;
  latencyVerdict: 'PASS' | 'FAIL';

  // World differentiation
  worldDiff: WorldDifferentiationReport | null;
  worldDiffVerdict: 'PASS' | 'FAIL';

  // Per-world analysis
  worldAnalyses: Record<string, AudioAnalysis>;

  // Parameter validation
  paramValidation: ParamValidationReport | null;
  paramVerdict: 'PASS' | 'FAIL';

  // Bass isolation
  bassIsolation: AudioAnalysis | null;
  kickOnly: AudioAnalysis | null;
  kickBassCombined: AudioAnalysis | null;
  bassVerdict: 'PASS' | 'FAIL';

  // Repetition
  repetition: RepetitionReport | null;
  repetitionVerdict: 'PASS' | 'FAIL';

  // Quality score
  qualityScore: QualityScore | null;

  // Closed loop
  closedLoop: ClosedLoopResult | null;
  closedLoopVerdict: 'PASS' | 'FAIL';

  // Overall
  offlineRenderVerdict: 'PASS' | 'FAIL';
  abAnalysisVerdict: 'PASS' | 'FAIL';
  summary: string;
  rawText: string;
}

/**
 * Generate the full forensic report.
 */
export function generateReport(data: {
  latency?: LatencyMetrics;
  worldDiff?: WorldDifferentiationReport;
  worldAnalyses: Record<string, AudioAnalysis>;
  paramValidation?: ParamValidationReport;
  bassIsolation?: AudioAnalysis;
  kickOnly?: AudioAnalysis;
  kickBassCombined?: AudioAnalysis;
  repetition?: RepetitionReport;
  qualityScore?: QualityScore;
  closedLoop?: ClosedLoopResult;
}): ForensicReport {
  const latencyVerdict: 'PASS' | 'FAIL' =
    data.latency ? (data.latency.underruns === 0 && data.latency.maxJitter < 0.005 ? 'PASS' : 'FAIL') : 'FAIL';

  const worldDiffVerdict: 'PASS' | 'FAIL' =
    data.worldDiff ? (data.worldDiff.worldSystemFailed ? 'FAIL' : 'PASS') : 'FAIL';

  const paramVerdict: 'PASS' | 'FAIL' =
    data.paramValidation ? (data.paramValidation.deadParams.length === 0 ? 'PASS' : 'FAIL') : 'FAIL';

  const bassVerdict: 'PASS' | 'FAIL' =
    data.bassIsolation && data.kickOnly && data.kickBassCombined ? 'PASS' : 'FAIL';

  const repetitionVerdict: 'PASS' | 'FAIL' =
    data.repetition ? (!data.repetition.loopWarning && !data.repetition.arrangementRepetitive ? 'PASS' : 'FAIL') : 'FAIL';

  const closedLoopVerdict: 'PASS' | 'FAIL' =
    data.closedLoop ? (data.closedLoop.finalScore > data.closedLoop.initialScore ? 'PASS' : 'FAIL') : 'FAIL';

  const offlineRenderVerdict: 'PASS' | 'FAIL' =
    Object.keys(data.worldAnalyses).length > 0 ? 'PASS' : 'FAIL';

  const abAnalysisVerdict: 'PASS' | 'FAIL' =
    data.worldDiff && data.paramValidation ? 'PASS' : 'FAIL';

  const report: ForensicReport = {
    latency: data.latency ?? null,
    latencyVerdict,
    worldDiff: data.worldDiff ?? null,
    worldDiffVerdict,
    worldAnalyses: data.worldAnalyses,
    paramValidation: data.paramValidation ?? null,
    paramVerdict,
    bassIsolation: data.bassIsolation ?? null,
    kickOnly: data.kickOnly ?? null,
    kickBassCombined: data.kickBassCombined ?? null,
    bassVerdict,
    repetition: data.repetition ?? null,
    repetitionVerdict,
    qualityScore: data.qualityScore ?? null,
    closedLoop: data.closedLoop ?? null,
    closedLoopVerdict,
    offlineRenderVerdict,
    abAnalysisVerdict,
    summary: '',
    rawText: '',
  };

  report.rawText = formatReportText(report);
  report.summary = generateSummary(report);
  return report;
}

function formatReportText(r: ForensicReport): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  FORENSIC AUDIO REPORT');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // LATENCY
  lines.push('LATENCY');
  if (r.latency) {
    lines.push(`  AudioContext latency:  ${(r.latency.audioContextLatency * 1000).toFixed(1)} ms`);
    lines.push(`  Average jitter:       ${(r.latency.averageJitter * 1000).toFixed(2)} ms`);
    lines.push(`  Max jitter:           ${(r.latency.maxJitter * 1000).toFixed(2)} ms`);
    lines.push(`  Late events:          ${r.latency.lateEvents}`);
    lines.push(`  Dropped events:       ${r.latency.droppedEvents}`);
    lines.push(`  Underruns:            ${r.latency.underruns}`);
    lines.push(`  Active voices (avg):  ${r.latency.activeVoices}`);
    lines.push(`  CPU load:             ${(r.latency.cpuLoad * 100).toFixed(1)}%`);
    lines.push(`  UI renders/sec:       ${r.latency.uiRenderCount}`);
    lines.push(`  Worklet msgs/sec:     ${r.latency.workletMessageCount}`);
    lines.push(`  VERDICT:              ${r.latencyVerdict}`);
  } else {
    lines.push('  (not measured)');
    lines.push(`  VERDICT: ${r.latencyVerdict}`);
  }
  lines.push('');

  // WORLD DIFFERENTIATION
  lines.push('WORLD DIFFERENTIATION');
  if (r.worldDiff) {
    for (const [wid, analysis] of Object.entries(r.worldAnalyses)) {
      const world = FORENSIC_WORLDS[wid];
      lines.push(`  ${world?.name || wid}:`);
      lines.push(`    BPM: ${world?.bpm}, LUFS: ${analysis.dynamics.lufs.toFixed(1)}, Centroid: ${analysis.spectrum.centroidHz.toFixed(0)}Hz, Bass RMS: ${analysis.lowEnd.bassRms.toFixed(3)}`);
    }
    lines.push('');
    lines.push('  Cross-world comparisons:');
    for (const c of r.worldDiff.comparisons.slice(0, 6)) {
      lines.push(`    ${FORENSIC_WORLDS[c.worldA]?.name || c.worldA} vs ${FORENSIC_WORLDS[c.worldB]?.name || c.worldB}:`);
      lines.push(`      spectral distance: ${c.spectralDistance.toFixed(4)}`);
      lines.push(`      bass RMS diff: ${c.bassRmsDiff.toFixed(4)}`);
      lines.push(`      centroid diff: ${c.centroidDiff.toFixed(0)}Hz`);
      lines.push(`      low-end diff: ${c.lowEndDiff.toFixed(4)}`);
      lines.push(`      verdict: ${c.verdict}`);
    }
    lines.push(`  Average spectral distance: ${r.worldDiff.averageSpectralDistance.toFixed(4)}`);
    lines.push(`  VERDICT: ${r.worldDiffVerdict} — ${r.worldDiff.summary}`);
  } else {
    lines.push('  (not measured)');
    lines.push(`  VERDICT: ${r.worldDiffVerdict}`);
  }
  lines.push('');

  // PARAMETER VALIDATION
  lines.push('PARAMETER VALIDATION');
  if (r.paramValidation) {
    for (const res of r.paramValidation.results) {
      lines.push(`  ${res.paramName}: ${res.verdict} (spectral distance: ${res.spectralDistance.toFixed(4)})`);
    }
    lines.push(`  VERDICT: ${r.paramVerdict} — ${r.paramValidation.summary}`);
  } else {
    lines.push('  (not measured)');
    lines.push(`  VERDICT: ${r.paramVerdict}`);
  }
  lines.push('');

  // BASS / KICK
  lines.push('BASS');
  if (r.bassIsolation) {
    lines.push(`  Fundamental: ${r.bassIsolation.lowEnd.bassFundamental.toFixed(0)} Hz`);
    lines.push(`  Decay:       ${r.bassIsolation.lowEnd.bassDecay.toFixed(3)} s`);
    lines.push(`  RMS:         ${r.bassIsolation.lowEnd.bassRms.toFixed(4)}`);
  } else {
    lines.push('  (not measured)');
  }
  lines.push('');

  lines.push('KICK');
  if (r.kickOnly) {
    lines.push(`  Fundamental: ${r.kickOnly.lowEnd.kickFundamental.toFixed(0)} Hz`);
    lines.push(`  Decay:       ${r.kickOnly.lowEnd.kickDecay.toFixed(3)} s`);
    lines.push(`  RMS:         ${r.kickOnly.lowEnd.kickRms.toFixed(4)}`);
  } else {
    lines.push('  (not measured)');
  }
  lines.push('');

  lines.push('KICK/BASS OVERLAP');
  if (r.kickBassCombined) {
    lines.push(`  Overlap:     ${r.kickBassCombined.lowEnd.overlap.toFixed(3)}`);
    if (r.kickBassCombined.lowEnd.overlap > 0.5) {
      lines.push('  WARNING:     KICK/BASS CONFLICT');
    }
  } else {
    lines.push('  (not measured)');
  }
  lines.push('');

  // REPETITION
  lines.push('REPETITION');
  if (r.repetition) {
    lines.push(`  8-bar average:   ${r.repetition.averageEightBar.toFixed(3)}`);
    lines.push(`  8-bar max:       ${r.repetition.maxEightBar.toFixed(3)}`);
    lines.push(`  16-bar average:  ${r.repetition.averageSixteenBar.toFixed(3)}`);
    lines.push(`  Loop warning:    ${r.repetition.loopWarning}`);
    if (r.repetition.sectionSimilarity.length > 0) {
      lines.push('  Section similarity:');
      for (const s of r.repetition.sectionSimilarity) {
        lines.push(`    ${s.label}: ${s.similarity.toFixed(3)} — ${s.verdict}`);
      }
      lines.push(`  Arrangement repetitive: ${r.repetition.arrangementRepetitive}`);
    }
    lines.push(`  VERDICT: ${r.repetitionVerdict} — ${r.repetition.summary}`);
  } else {
    lines.push('  (not measured)');
    lines.push(`  VERDICT: ${r.repetitionVerdict}`);
  }
  lines.push('');

  // QUALITY SCORE
  lines.push('QUALITY SCORE');
  if (r.qualityScore) {
    for (const line of r.qualityScore.breakdown) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push('  (not computed)');
  }
  lines.push('');

  // CLOSED LOOP
  lines.push('CLOSED LOOP');
  if (r.closedLoop) {
    lines.push(`  Initial score:  ${r.closedLoop.initialScore}`);
    lines.push(`  Final score:    ${r.closedLoop.finalScore}`);
    lines.push(`  Iterations:     ${r.closedLoop.iterations.length}`);
    for (const it of r.closedLoop.iterations) {
      const status = it.accepted ? 'KEEP' : 'REJECT';
      lines.push(`    Iteration ${it.iteration}: ${it.paramName} ${it.oldValue.toFixed(3)}→${it.newValue.toFixed(3)} | score ${it.oldScore}→${it.newScore} | ${status}`);
    }
    lines.push(`  VERDICT: ${r.closedLoopVerdict} — ${r.closedLoop.summary}`);
  } else {
    lines.push('  (not run)');
    lines.push(`  VERDICT: ${r.closedLoopVerdict}`);
  }
  lines.push('');

  // OVERALL VERDICTS
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  OVERALL VERDICTS');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`  OFFLINE RENDER:   ${r.offlineRenderVerdict}`);
  lines.push(`  A/B ANALYSIS:     ${r.abAnalysisVerdict}`);
  lines.push(`  CLOSED LOOP:      ${r.closedLoopVerdict}`);
  lines.push(`  WORLD DIFF:       ${r.worldDiffVerdict}`);
  lines.push(`  PARAM VALIDATION: ${r.paramVerdict}`);
  lines.push(`  REPETITION:       ${r.repetitionVerdict}`);
  lines.push(`  LATENCY:          ${r.latencyVerdict}`);
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function generateSummary(r: ForensicReport): string {
  const parts: string[] = [];
  parts.push(`Offline render: ${r.offlineRenderVerdict}`);
  parts.push(`World differentiation: ${r.worldDiffVerdict}`);
  parts.push(`Parameter validation: ${r.paramVerdict}`);
  parts.push(`Repetition: ${r.repetitionVerdict}`);
  parts.push(`Closed loop: ${r.closedLoopVerdict}`);
  if (r.qualityScore) {
    parts.push(`Quality score: ${r.qualityScore.total}/100`);
  }
  return parts.join(' | ');
}
