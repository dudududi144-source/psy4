'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Activity, AlertTriangle, CheckCircle2, XCircle, Copy, Download,
  FlaskConical, Gauge, Loader2, ChevronDown, ChevronRight, Microscope,
  Waves, Drum, RotateCw, FileText, ShieldCheck, ShieldAlert, Hash, Clock,
} from 'lucide-react';
import type { ForensicReport } from '@/lib/studio/engine/forensic/reportGenerator';
import type { SubScore } from '@/lib/studio/engine/forensic/qualityScore';

// ─── World catalogue ────────────────────────────────────────────────────────
// Mirrors FORENSIC_WORLDS in src/lib/studio/engine/forensic/worlds.ts.
// Kept here so the client bundle does not import the full DSP module.
const WORLD_OPTIONS: { id: string; name: string; bpm: number }[] = [
  { id: 'progressive-psy', name: 'Progressive Psy', bpm: 128 },
  { id: 'dark-psy',        name: 'Dark Psy',        bpm: 150 },
  { id: 'goa',             name: 'Goa',             bpm: 140 },
  { id: 'morning-psy',     name: 'Morning Psy',     bpm: 142 },
  { id: 'forest',          name: 'Forest',          bpm: 148 },
  { id: 'acid-psy',        name: 'Acid Psy',        bpm: 142 },
];

const DEFAULT_WORLDS = ['progressive-psy', 'dark-psy', 'goa', 'acid-psy'];

// ─── Color helpers ──────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}
function scoreText(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 40) return 'text-amber-400';
  return 'text-red-400';
}
function verdictBadge(v: 'PASS' | 'FAIL'): React.ReactNode {
  return v === 'PASS' ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-emerald-300">
      <CheckCircle2 className="h-3 w-3" /> PASS
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-xs font-bold tracking-wider text-red-300">
      <XCircle className="h-3 w-3" /> FAIL
    </span>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function VerdictCard({ label, verdict }: { label: string; verdict: 'PASS' | 'FAIL' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-1 rounded-lg border p-3 text-center ${
      verdict === 'PASS'
        ? 'border-emerald-500/30 bg-emerald-500/5'
        : 'border-red-500/30 bg-red-500/5'
    }`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      {verdictBadge(verdict)}
    </div>
  );
}

function ScoreBar({ sub }: { sub: SubScore }) {
  const metricEntries = Object.entries(sub.metrics || {});
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <div className="group cursor-help">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="font-mono text-xs font-semibold tracking-wider text-slate-300">
              {sub.name}
            </span>
            <span className={`font-mono text-sm font-bold ${scoreText(sub.score)}`}>
              {sub.score}
              <span className="text-slate-500">/100</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${scoreColor(sub.score)}`}
              style={{ width: `${Math.max(2, Math.min(100, sub.score))}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-md border-slate-700 bg-slate-900 p-3 text-left">
        <div className="space-y-2">
          <p className="font-mono text-[11px] leading-relaxed text-slate-300">{sub.explanation}</p>
          {metricEntries.length > 0 && (
            <div className="border-t border-slate-700 pt-2">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">Metrics</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px]">
                {metricEntries.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2">
                    <span className="text-slate-400">{k}</span>
                    <span className="text-fuchsia-300">{typeof v === 'number' ? v.toFixed(3) : String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function SectionCard({
  icon, title, description, children, accent = 'slate',
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  accent?: 'slate' | 'emerald' | 'red' | 'amber' | 'fuchsia';
}) {
  const accentMap: Record<string, string> = {
    slate:   'text-slate-300',
    emerald: 'text-emerald-400',
    red:     'text-red-400',
    amber:   'text-amber-400',
    fuchsia: 'text-fuchsia-400',
  };
  return (
    <Card className="border-slate-800 bg-slate-900/70">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <span className={accentMap[accent]}>{icon}</span>
          <CardTitle className="font-mono text-sm uppercase tracking-widest text-slate-100">
            {title}
          </CardTitle>
        </div>
        {description && (
          <CardDescription className="font-mono text-xs text-slate-500">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      <div className="font-mono text-xs leading-relaxed text-red-200">{children}</div>
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function ForensicDashboardPage() {
  // control panel state
  const [seed, setSeed] = useState<number>(1234);
  const [duration, setDuration] = useState<number>(12);
  const [selectedWorlds, setSelectedWorlds] = useState<string[]>(DEFAULT_WORLDS);
  const [skipClosedLoop, setSkipClosedLoop] = useState(false);
  const [skipParamValidation, setSkipParamValidation] = useState(false);
  const [skipBassIsolation, setSkipBassIsolation] = useState(false);

  // analysis state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ForensicReport | null>(null);
  const [runTimeMs, setRunTimeMs] = useState<number | null>(null);

  // raw report collapse
  const [rawOpen, setRawOpen] = useState(false);

  // WAV download tracking
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});

  const toggleWorld = (id: string) => {
    setSelectedWorlds(prev =>
      prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id]
    );
  };

  const runAnalysis = useCallback(async () => {
    if (selectedWorlds.length === 0) {
      setError('Select at least one world to analyze.');
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    setRunTimeMs(null);
    const t0 = performance.now();
    try {
      const res = await fetch('/api/forensic/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed,
          duration,
          worlds: selectedWorlds,
          skipClosedLoop,
          skipParamValidation,
          skipBassIsolation,
        }),
      });
      const data = await res.json();
      const elapsed = performance.now() - t0;
      setRunTimeMs(elapsed);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setReport(data.report as ForensicReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [seed, duration, selectedWorlds, skipClosedLoop, skipParamValidation, skipBassIsolation]);

  const downloadWav = useCallback(async (
    key: string, worldId: string, onlyVoices?: string[],
  ) => {
    setDownloading(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/forensic/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed, worldId, duration, onlyVoices }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => 'render error');
        throw new Error(txt);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const voiceTag = onlyVoices ? `_${onlyVoices.join('-')}` : '';
      a.href = url;
      a.download = `psy4_${worldId}_seed${seed}_dur${duration}${voiceTag}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`WAV download failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDownloading(prev => ({ ...prev, [key]: false }));
    }
  }, [seed, duration]);

  const copyRawReport = useCallback(() => {
    if (!report) return;
    navigator.clipboard?.writeText(report.rawText).catch(() => {});
  }, [report]);

  // ─── Derived report data ────────────────────────────────────────────────
  const qualitySubs: SubScore[] | null = useMemo(() => {
    if (!report?.qualityScore) return null;
    const q = report.qualityScore;
    return [
      q.lowEnd, q.kick, q.bass, q.transients, q.spectrum,
      q.dynamics, q.worldIdentity, q.arrangement, q.repetition,
    ];
  }, [report]);

  const deadParams = report?.paramValidation?.deadParams ?? [];
  const worldSystemFailed = report?.worldDiff?.worldSystemFailed ?? false;
  const overlapWarn = (report?.kickBassCombined?.lowEnd.overlap ?? 0) > 0.5;
  const loopWarning = report?.repetition?.loopWarning ?? false;
  const arrangementRepetitive = report?.repetition?.arrangementRepetitive ?? false;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
        {/* HEADER */}
        <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur supports-[backdrop-filter]:bg-slate-950/80">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10">
                <Microscope className="h-5 w-5 text-fuchsia-400" />
              </div>
              <div>
                <h1 className="font-mono text-base font-bold tracking-[0.2em] text-slate-50 sm:text-lg">
                  PSY4 FORENSIC ANALYSIS
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Deterministic offline render · evidence-based measurement
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              <span className="hidden items-center gap-1 sm:flex">
                <Activity className="h-3 w-3 text-emerald-400" /> engine ready
              </span>
              {runTimeMs !== null && (
                <Badge variant="outline" className="border-slate-700 font-mono text-[10px] text-slate-300">
                  <Clock className="mr-1 h-3 w-3" />
                  last run: {(runTimeMs / 1000).toFixed(2)}s
                </Badge>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-6 sm:px-6">
          {/* CONTROL PANEL */}
          <SectionCard
            icon={<FlaskConical className="h-4 w-4" />}
            title="Control Panel"
            description="Configure deterministic render seed, duration, and world selection."
            accent="fuchsia"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="seed" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  <Hash className="mr-1 inline h-3 w-3" />Seed
                </Label>
                <Input
                  id="seed"
                  type="number"
                  value={seed}
                  onChange={e => setSeed(Number(e.target.value) || 0)}
                  className="border-slate-700 bg-slate-950 font-mono text-sm text-fuchsia-300"
                />
                <p className="font-mono text-[10px] text-slate-500">Deterministic PRNG seed</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="duration" className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  <Clock className="mr-1 inline h-3 w-3" />Duration (s)
                </Label>
                <Input
                  id="duration"
                  type="number"
                  min={2}
                  max={60}
                  value={duration}
                  onChange={e => setDuration(Math.max(2, Number(e.target.value) || 0))}
                  className="border-slate-700 bg-slate-950 font-mono text-sm text-fuchsia-300"
                />
                <p className="font-mono text-[10px] text-slate-500">Render length per world</p>
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">
                  <ShieldCheck className="mr-1 inline h-3 w-3" />Skip Flags (faster)
                </Label>
                <div className="space-y-2 pt-1">
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={skipClosedLoop}
                      onCheckedChange={(v) => setSkipClosedLoop(v === true)}
                    />
                    <span className="font-mono text-xs text-slate-300">Skip closed loop</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={skipParamValidation}
                      onCheckedChange={(v) => setSkipParamValidation(v === true)}
                    />
                    <span className="font-mono text-xs text-slate-300">Skip param validation</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      checked={skipBassIsolation}
                      onCheckedChange={(v) => setSkipBassIsolation(v === true)}
                    />
                    <span className="font-mono text-xs text-slate-300">Skip bass isolation</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider text-slate-400">
                Worlds (multi-select)
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {WORLD_OPTIONS.map(w => {
                  const active = selectedWorlds.includes(w.id);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => toggleWorld(w.id)}
                      className={`flex flex-col items-start gap-0.5 rounded-md border p-2 text-left transition-colors ${
                        active
                          ? 'border-fuchsia-500/50 bg-fuchsia-500/10'
                          : 'border-slate-700 bg-slate-950 hover:border-slate-600'
                      }`}
                    >
                      <span className={`font-mono text-xs font-semibold ${active ? 'text-fuchsia-300' : 'text-slate-400'}`}>
                        {w.name}
                      </span>
                      <span className="font-mono text-[10px] text-slate-500">{w.bpm} BPM · {w.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                onClick={runAnalysis}
                disabled={loading || selectedWorlds.length === 0}
                size="lg"
                className="bg-fuchsia-600 font-mono text-sm font-bold uppercase tracking-widest text-white hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    RENDERING + ANALYZING...
                  </>
                ) : (
                  <>
                    <FlaskConical className="mr-2 h-4 w-4" />
                    RUN FORENSIC ANALYSIS
                  </>
                )}
              </Button>
              <p className="font-mono text-[10px] text-slate-500">
                {loading
                  ? 'Rendering worlds, FFT analysis, param validation. 5–15s typical.'
                  : `${selectedWorlds.length} world(s) selected · ${duration}s each`}
              </p>
            </div>

            {error && (
              <WarningBanner>
                <strong className="font-bold">ANALYSIS ERROR:</strong> {error}
              </WarningBanner>
            )}
          </SectionCard>

          {/* Loading state */}
          {loading && !report && (
            <Card className="border-fuchsia-500/30 bg-slate-900/70">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-fuchsia-400" />
                <p className="font-mono text-sm uppercase tracking-widest text-slate-300">
                  RENDERING + ANALYZING...
                </p>
                <p className="font-mono text-[10px] text-slate-500">
                  Generating audio · FFT analysis · cross-world comparison
                </p>
              </CardContent>
            </Card>
          )}

          {/* REPORT BODY */}
          {report && (
            <div className="space-y-5">
              {/* 3. OVERALL VERDICTS */}
              <SectionCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Overall Verdicts"
                description="Top-level PASS/FAIL across the measurement pipeline."
                accent={report.qualityScore && report.qualityScore.total >= 60 ? 'emerald' : 'amber'}
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
                  <VerdictCard label="Offline Render"   verdict={report.offlineRenderVerdict} />
                  <VerdictCard label="A/B Analysis"     verdict={report.abAnalysisVerdict} />
                  <VerdictCard label="Closed Loop"      verdict={report.closedLoopVerdict} />
                  <VerdictCard label="World Diff"       verdict={report.worldDiffVerdict} />
                  <VerdictCard label="Param Validation" verdict={report.paramVerdict} />
                  <VerdictCard label="Repetition"       verdict={report.repetitionVerdict} />
                  <VerdictCard label="Latency"          verdict={report.latencyVerdict} />
                </div>

                {report.qualityScore && (
                  <div className="mt-5 flex flex-col items-center justify-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-5">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                      Total Quality Score
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className={`font-mono text-5xl font-black ${scoreText(report.qualityScore.total)}`}>
                        {report.qualityScore.total}
                      </span>
                      <span className="font-mono text-xl text-slate-500">/100</span>
                    </div>
                    <p className="mt-1 text-center font-mono text-[10px] leading-relaxed text-slate-500">
                      {report.summary}
                    </p>
                  </div>
                )}
              </SectionCard>

              {/* 4. QUALITY SCORE BREAKDOWN */}
              {qualitySubs && (
                <SectionCard
                  icon={<Gauge className="h-4 w-4" />}
                  title="Quality Score Breakdown"
                  description="9 sub-scores derived from measured metrics. Hover for explanation."
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    {qualitySubs.map(s => (
                      <ScoreBar key={s.name} sub={s} />
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* 5. WORLD DIFFERENTIATION */}
              {report.worldDiff && (
                <SectionCard
                  icon={<Waves className="h-4 w-4" />}
                  title="World Differentiation"
                  description="Cross-world comparison: do different param sets produce different audio?"
                  accent={worldSystemFailed ? 'red' : 'emerald'}
                >
                  {worldSystemFailed && (
                    <WarningBanner>
                      <strong className="font-bold">WORLD SYSTEM FAILED:</strong>{' '}
                      {report.worldDiff.summary}
                    </WarningBanner>
                  )}

                  <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    Per-world metrics
                  </p>
                  <div className="overflow-hidden rounded-md border border-slate-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">World</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">BPM</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">LUFS</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Centroid (Hz)</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Bass RMS</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(report.worldAnalyses).map(([wid, a]) => {
                          const w = WORLD_OPTIONS.find(o => o.id === wid);
                          return (
                            <TableRow key={wid} className="border-slate-800">
                              <TableCell className="font-mono text-xs text-slate-200">
                                {w?.name ?? wid}
                                <span className="ml-1 text-[10px] text-slate-500">[{wid}]</span>
                              </TableCell>
                              <TableCell className="font-mono text-xs text-slate-300">{w?.bpm ?? '-'}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-300">{a.dynamics.lufs.toFixed(1)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-300">{a.spectrum.centroidHz.toFixed(0)}</TableCell>
                              <TableCell className="font-mono text-xs text-slate-300">{a.lowEnd.bassRms.toFixed(4)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <p className="mb-3 mt-5 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                    Pairwise comparisons
                  </p>
                  <div className="overflow-hidden rounded-md border border-slate-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">World A</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">World B</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Spectral Δ</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Bass RMS Δ</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Centroid Δ (Hz)</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Verdict</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.worldDiff.comparisons.map((c, i) => (
                          <TableRow key={i} className="border-slate-800">
                            <TableCell className="font-mono text-xs text-slate-300">{c.worldA}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">{c.worldB}</TableCell>
                            <TableCell className="font-mono text-xs text-fuchsia-300">{c.spectralDistance.toFixed(4)}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">{c.bassRmsDiff.toFixed(4)}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">{c.centroidDiff.toFixed(0)}</TableCell>
                            <TableCell>
                              <span className={`font-mono text-[10px] font-bold uppercase ${
                                c.verdict === 'DIFFERENT' ? 'text-emerald-400'
                                  : c.verdict === 'SIMILAR' ? 'text-amber-400'
                                  : 'text-red-400'
                              }`}>{c.verdict}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-xs">
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Avg spectral Δ</p>
                      <p className="text-slate-200">{report.worldDiff.averageSpectralDistance.toFixed(4)}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Min spectral Δ</p>
                      <p className="text-slate-200">{report.worldDiff.minSpectralDistance.toFixed(4)}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">Max spectral Δ</p>
                      <p className="text-slate-200">{report.worldDiff.maxSpectralDistance.toFixed(4)}</p>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* 6. PARAMETER VALIDATION */}
              {report.paramValidation && (
                <SectionCard
                  icon={<ShieldAlert className="h-4 w-4" />}
                  title="Parameter Validation"
                  description={`Each param rendered at min and max — does the audio change? World: ${report.paramValidation.worldId}`}
                  accent={deadParams.length > 0 ? 'red' : 'emerald'}
                >
                  {deadParams.length > 0 && (
                    <WarningBanner>
                      {deadParams.map(p => (
                        <div key={p}>
                          <strong className="font-bold">DEAD PARAMETER:</strong>{' '}
                          <span className="font-mono">{p}</span> does not affect audio output.
                        </div>
                      ))}
                    </WarningBanner>
                  )}

                  <div className="overflow-hidden rounded-md border border-slate-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Param</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Min</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Max</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Spectral Δ</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">RMS Δ</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Waveform Δ</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Verdict</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.paramValidation.results.map(r => (
                          <TableRow key={r.paramName} className="border-slate-800">
                            <TableCell className="font-mono text-xs text-slate-200">{r.paramName}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{r.minValue.toFixed(3)}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-400">{r.maxValue.toFixed(3)}</TableCell>
                            <TableCell className="font-mono text-xs text-fuchsia-300">{r.spectralDistance.toFixed(4)}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">{r.rmsDifference.toFixed(4)}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">{r.waveformDifference.toFixed(4)}</TableCell>
                            <TableCell>
                              <span className={`font-mono text-[10px] font-bold uppercase ${
                                r.verdict === 'ACTIVE' ? 'text-emerald-400'
                                  : r.verdict === 'WEAK' ? 'text-amber-400'
                                  : 'text-red-400'
                              }`}>{r.verdict}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 font-mono text-xs">
                    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-emerald-500/80">Active</p>
                      <p className="text-emerald-300">{report.paramValidation.activeParams.length}</p>
                    </div>
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-amber-500/80">Weak</p>
                      <p className="text-amber-300">{report.paramValidation.weakParams.length}</p>
                    </div>
                    <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-red-500/80">Dead</p>
                      <p className="text-red-300">{report.paramValidation.deadParams.length}</p>
                    </div>
                  </div>

                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-slate-500">
                    {report.paramValidation.summary}
                  </p>
                </SectionCard>
              )}

              {/* 7. BASS / KICK ANALYSIS */}
              {(report.bassIsolation || report.kickOnly || report.kickBassCombined) && (
                <SectionCard
                  icon={<Drum className="h-4 w-4" />}
                  title="Bass / Kick Analysis"
                  description="Isolated voice renders — kick only, bass only, kick+bass combined."
                  accent={overlapWarn ? 'amber' : 'slate'}
                >
                  {overlapWarn && (
                    <WarningBanner>
                      <strong className="font-bold">KICK/BASS CONFLICT:</strong>{' '}
                      overlap value{' '}
                      <span className="font-mono text-fuchsia-300">
                        {report.kickBassCombined!.lowEnd.overlap.toFixed(3)}
                      </span>{' '}
                      is above 0.5 — kick and bass spectra overlap too much.
                    </WarningBanner>
                  )}

                  <div className="grid gap-4 md:grid-cols-3">
                    {/* BASS ONLY */}
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Waves className="h-4 w-4 text-fuchsia-400" />
                        <span className="font-mono text-xs uppercase tracking-widest text-slate-200">Bass Only</span>
                      </div>
                      {report.bassIsolation ? (
                        <dl className="space-y-1.5 font-mono text-xs">
                          <div className="flex justify-between"><dt className="text-slate-500">Fundamental</dt><dd className="text-fuchsia-300">{report.bassIsolation.lowEnd.bassFundamental.toFixed(0)} Hz</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Decay</dt><dd className="text-slate-200">{report.bassIsolation.lowEnd.bassDecay.toFixed(3)} s</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">RMS</dt><dd className="text-slate-200">{report.bassIsolation.lowEnd.bassRms.toFixed(4)}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Transient str.</dt><dd className="text-slate-200">{report.bassIsolation.transients.transientStrength.toFixed(2)}</dd></div>
                        </dl>
                      ) : (
                        <p className="font-mono text-[10px] text-slate-500">Not measured (skipped)</p>
                      )}
                    </div>

                    {/* KICK ONLY */}
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Drum className="h-4 w-4 text-fuchsia-400" />
                        <span className="font-mono text-xs uppercase tracking-widest text-slate-200">Kick Only</span>
                      </div>
                      {report.kickOnly ? (
                        <dl className="space-y-1.5 font-mono text-xs">
                          <div className="flex justify-between"><dt className="text-slate-500">Fundamental</dt><dd className="text-fuchsia-300">{report.kickOnly.lowEnd.kickFundamental.toFixed(0)} Hz</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Decay</dt><dd className="text-slate-200">{report.kickOnly.lowEnd.kickDecay.toFixed(3)} s</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">RMS</dt><dd className="text-slate-200">{report.kickOnly.lowEnd.kickRms.toFixed(4)}</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Transient str.</dt><dd className="text-slate-200">{report.kickOnly.transients.transientStrength.toFixed(2)}</dd></div>
                        </dl>
                      ) : (
                        <p className="font-mono text-[10px] text-slate-500">Not measured (skipped)</p>
                      )}
                    </div>

                    {/* KICK + BASS */}
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Activity className="h-4 w-4 text-fuchsia-400" />
                        <span className="font-mono text-xs uppercase tracking-widest text-slate-200">Kick + Bass</span>
                      </div>
                      {report.kickBassCombined ? (
                        <dl className="space-y-1.5 font-mono text-xs">
                          <div className="flex justify-between"><dt className="text-slate-500">Kick fund.</dt><dd className="text-slate-200">{report.kickBassCombined.lowEnd.kickFundamental.toFixed(0)} Hz</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Bass fund.</dt><dd className="text-slate-200">{report.kickBassCombined.lowEnd.bassFundamental.toFixed(0)} Hz</dd></div>
                          <div className="flex justify-between"><dt className="text-slate-500">Sub RMS</dt><dd className="text-slate-200">{report.kickBassCombined.lowEnd.subRms.toFixed(4)}</dd></div>
                          <div className="flex justify-between">
                            <dt className="text-slate-500">Overlap</dt>
                            <dd className={overlapWarn ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                              {report.kickBassCombined.lowEnd.overlap.toFixed(3)}
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="font-mono text-[10px] text-slate-500">Not measured (skipped)</p>
                      )}
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* 8. REPETITION ANALYSIS */}
              {report.repetition && (
                <SectionCard
                  icon={<RotateCw className="h-4 w-4" />}
                  title="Repetition Analysis"
                  description="Spectral similarity between 4/8/16-bar segments and structural sections."
                  accent={(loopWarning || arrangementRepetitive) ? 'red' : 'slate'}
                >
                  {(loopWarning || arrangementRepetitive) && (
                    <WarningBanner>
                      {loopWarning && (
                        <div>
                          <strong className="font-bold">LOOP WARNING:</strong>{' '}
                          max 8-bar similarity{' '}
                          <span className="font-mono text-fuchsia-300">{report.repetition.maxEightBar.toFixed(3)}</span>{' '}
                          exceeds 0.95 threshold.
                        </div>
                      )}
                      {arrangementRepetitive && (
                        <div>
                          <strong className="font-bold">ARRANGEMENT REPETITIVE:</strong>{' '}
                          structural sections too similar.
                        </div>
                      )}
                    </WarningBanner>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: '4-bar avg',  v: report.repetition.averageFourBar },
                      { label: '8-bar avg',  v: report.repetition.averageEightBar },
                      { label: '8-bar max',  v: report.repetition.maxEightBar },
                      { label: '16-bar avg', v: report.repetition.averageSixteenBar },
                    ].map(s => (
                      <div key={s.label} className="rounded-md border border-slate-800 bg-slate-950 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">{s.label}</p>
                        <p className={`font-mono text-lg font-bold ${s.v > 0.95 ? 'text-red-400' : s.v > 0.85 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {s.v.toFixed(3)}
                        </p>
                      </div>
                    ))}
                  </div>

                  {report.repetition.sectionSimilarity.length > 0 && (
                    <>
                      <p className="mb-3 mt-5 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                        Section similarity comparisons
                      </p>
                      <div className="overflow-hidden rounded-md border border-slate-800">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
                              <TableHead className="font-mono text-[10px] uppercase text-slate-400">Section Comparison</TableHead>
                              <TableHead className="font-mono text-[10px] uppercase text-slate-400">Bars A</TableHead>
                              <TableHead className="font-mono text-[10px] uppercase text-slate-400">Bars B</TableHead>
                              <TableHead className="font-mono text-[10px] uppercase text-slate-400">Similarity</TableHead>
                              <TableHead className="font-mono text-[10px] uppercase text-slate-400">Verdict</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {report.repetition.sectionSimilarity.map((s, i) => (
                              <TableRow key={i} className="border-slate-800">
                                <TableCell className="font-mono text-xs text-slate-200">{s.label}</TableCell>
                                <TableCell className="font-mono text-xs text-slate-400">{s.barRange1[0]}–{s.barRange1[1]}</TableCell>
                                <TableCell className="font-mono text-xs text-slate-400">{s.barRange2[0]}–{s.barRange2[1]}</TableCell>
                                <TableCell className={`font-mono text-xs font-bold ${s.similarity > 0.9 ? 'text-red-400' : s.similarity > 0.8 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                  {s.similarity.toFixed(3)}
                                </TableCell>
                                <TableCell className="font-mono text-[10px] text-slate-400">{s.verdict}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}

                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-slate-500">
                    {report.repetition.summary}
                  </p>
                </SectionCard>
              )}

              {/* 9. CLOSED-LOOP OPTIMIZATION */}
              {report.closedLoop && (
                <SectionCard
                  icon={<RotateCw className="h-4 w-4" />}
                  title="Closed-Loop Optimization"
                  description={`Iterative param adjustment — each change attributable. World: ${report.closedLoop.worldId}, seed: ${report.closedLoop.seed}`}
                  accent={report.closedLoop.finalScore > report.closedLoop.initialScore ? 'emerald' : 'amber'}
                >
                  <div className="mb-4 grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Initial score</p>
                      <p className="font-mono text-2xl font-bold text-slate-200">{report.closedLoop.initialScore}</p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Final score</p>
                      <p className={`font-mono text-2xl font-bold ${report.closedLoop.finalScore > report.closedLoop.initialScore ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {report.closedLoop.finalScore}
                      </p>
                    </div>
                    <div className="rounded-md border border-slate-800 bg-slate-950 p-3">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">Iterations</p>
                      <p className="font-mono text-2xl font-bold text-slate-200">{report.closedLoop.iterations.length}</p>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-md border border-slate-800">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-800 bg-slate-950/60 hover:bg-slate-950/60">
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">#</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Param</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Old → New</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Old → New Score</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Weakest Area</TableHead>
                          <TableHead className="font-mono text-[10px] uppercase text-slate-400">Decision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.closedLoop.iterations.map(it => (
                          <TableRow key={it.iteration} className="border-slate-800">
                            <TableCell className="font-mono text-xs text-slate-400">{it.iteration}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-200">{it.paramName}</TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">
                              <span className="text-slate-500">{it.oldValue.toFixed(3)}</span>
                              <span className="mx-1 text-fuchsia-400">→</span>
                              <span className="text-fuchsia-300">{it.newValue.toFixed(3)}</span>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-slate-300">
                              <span className="text-slate-500">{it.oldScore}</span>
                              <span className="mx-1 text-fuchsia-400">→</span>
                              <span className={it.newScore > it.oldScore ? 'text-emerald-400' : 'text-red-400'}>{it.newScore}</span>
                            </TableCell>
                            <TableCell className="font-mono text-[10px] text-slate-400">
                              {it.weakestArea} <span className="text-slate-600">({it.weakestScore})</span>
                            </TableCell>
                            <TableCell>
                              <span className={`font-mono text-[10px] font-bold uppercase ${
                                it.accepted ? 'text-emerald-400' : 'text-red-400'
                              }`}>
                                {it.accepted ? 'KEEP' : 'REJECT'}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-slate-500">
                    {report.closedLoop.summary}
                  </p>
                </SectionCard>
              )}

              {/* 11. WAV DOWNLOAD */}
              <SectionCard
                icon={<Download className="h-4 w-4" />}
                title="WAV Download"
                description="Render and download stereo 44.1kHz / 16-bit WAV files for each world."
                accent="fuchsia"
              >
                <div className="space-y-3">
                  {selectedWorlds.map(wid => {
                    const w = WORLD_OPTIONS.find(o => o.id === wid);
                    return (
                      <div key={wid} className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <Waves className="h-4 w-4 text-fuchsia-400" />
                          <div>
                            <p className="font-mono text-xs font-semibold text-slate-200">
                              {w?.name ?? wid}
                            </p>
                            <p className="font-mono text-[10px] text-slate-500">
                              {wid} · {w?.bpm ?? '-'} BPM · {duration}s
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloading[`${wid}-full`]}
                            onClick={() => downloadWav(`${wid}-full`, wid)}
                            className="border-fuchsia-500/40 bg-fuchsia-500/10 font-mono text-[10px] uppercase tracking-wider text-fuchsia-200 hover:bg-fuchsia-500/20"
                          >
                            {downloading[`${wid}-full`]
                              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />RENDERING</>
                              : <><Download className="mr-1 h-3 w-3" />Full Mix</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloading[`${wid}-kick`]}
                            onClick={() => downloadWav(`${wid}-kick`, wid, ['kick'])}
                            className="border-slate-700 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800"
                          >
                            {downloading[`${wid}-kick`]
                              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />RENDERING</>
                              : <><Drum className="mr-1 h-3 w-3" />Kick Only</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloading[`${wid}-bass`]}
                            onClick={() => downloadWav(`${wid}-bass`, wid, ['bass'])}
                            className="border-slate-700 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800"
                          >
                            {downloading[`${wid}-bass`]
                              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />RENDERING</>
                              : <><Waves className="mr-1 h-3 w-3" />Bass Only</>}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={downloading[`${wid}-kb`]}
                            onClick={() => downloadWav(`${wid}-kb`, wid, ['kick', 'bass'])}
                            className="border-slate-700 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800"
                          >
                            {downloading[`${wid}-kb`]
                              ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />RENDERING</>
                              : <><Activity className="mr-1 h-3 w-3" />Kick+Bass</>}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {/* 10. RAW REPORT TEXT */}
              <SectionCard
                icon={<FileText className="h-4 w-4" />}
                title="Raw Report Text"
                description="Full evidence-based forensic report as plain text."
              >
                <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
                  <div className="mb-3 flex items-center justify-between">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRawOpen(o => !o)}
                      className="border-slate-700 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800"
                    >
                      {rawOpen
                        ? <><ChevronDown className="mr-1 h-3 w-3" />Collapse</>
                        : <><ChevronRight className="mr-1 h-3 w-3" />Expand</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyRawReport}
                      className="border-slate-700 bg-slate-950 font-mono text-[10px] uppercase tracking-wider text-slate-300 hover:bg-slate-800"
                    >
                      <Copy className="mr-1 h-3 w-3" />Copy
                    </Button>
                  </div>
                  <CollapsibleContent>
                    <pre className="max-h-[28rem] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-4 font-mono text-[10px] leading-relaxed text-slate-300">
                      {report.rawText}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </SectionCard>
            </div>
          )}

          {/* Empty state — pre-run */}
          {!loading && !report && !error && (
            <Card className="border-dashed border-slate-800 bg-slate-900/40">
              <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Microscope className="h-10 w-10 text-slate-600" />
                <p className="font-mono text-sm uppercase tracking-widest text-slate-400">
                  No analysis yet
                </p>
                <p className="max-w-md font-mono text-xs leading-relaxed text-slate-500">
                  Configure the control panel above and press{' '}
                  <span className="text-fuchsia-400">RUN FORENSIC ANALYSIS</span>{' '}
                  to render deterministic audio, run FFT analysis, validate parameters,
                  measure repetition, and optimize in a closed loop.
                </p>
              </CardContent>
            </Card>
          )}
        </main>

        {/* FOOTER */}
        <footer className="mt-auto border-t border-slate-800 bg-slate-950">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 sm:flex-row sm:px-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-slate-600">
              PSY4 · FORENSIC AUDIO ANALYSIS · deterministic offline render
            </p>
            <p className="font-mono text-[10px] text-slate-600">
              No marketing language. Only metrics. Only evidence.
            </p>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
