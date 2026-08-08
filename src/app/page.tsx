'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import {
  Activity, Radio, Cpu, AudioLines, Play, Square, Zap, GitBranch,
  CheckCircle2, XCircle, AlertCircle, FlaskConical, AudioWaveform,
  Network, Gauge, Sparkles, Terminal, Download, RefreshCw,
} from 'lucide-react';

interface DeviceSpec {
  id: string; name: string; make: string; role: string; section: string;
  implementation: string; why: string; inspiredBy?: string;
  audioInputs: string[]; audioOutputs: string[]; midiInputs: string[]; midiOutputs: string[];
  clockRelationship: string; sequencingResponsibility: string; synchronizationSource: string;
  signalProcessing: string; performanceResponsibility: string; recordingDestination: string;
  resamplingPath: string; feedbackSafeRouting: string; failureBehavior: string;
}
interface GraphEdge { from: string; to: string; kind: 'audio' | 'midi' | 'clock'; label: string; }
interface ArchData { vision: string; devices: DeviceSpec[]; graph: GraphEdge[]; tiers: { name: string; devices: string[]; note: string }[]; recommendation: { name: string; devices: string[]; note: string }; deviceCount: number; edgeCount: number; }
interface TestResult { id: string; name: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_IMPLEMENTED'; durationMs: number; assertions: number; message: string; metrics?: Record<string, number | string>; }
interface TestSummary { total: number; pass: number; fail: number; blocked: number; notImplemented: number; totalMs: number; }
interface ArtifactFile { id: string; name: string; fileName: string; slug: string; url: string; fileSize: number; tempo: number; key: string; scale: string; seed: number; bars: number; sampleRate: number; durationSec: number; peak: number; rms: number; hash: string; validation: string; metrics: Record<string, unknown>; }
interface CheckResult { id: string; category: string; description: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_IMPLEMENTED'; detail: string; }
interface ValidationReport { timestamp: string; checks: CheckResult[]; summary: { total: number; pass: number; fail: number; blocked: number; notImplemented: number }; overall: 'PASS' | 'FAIL'; }
interface PipelineStage { name: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; durationMs: number; detail: string; }
interface ExecutionLog { runId: string; timestamp: string; seed: number; bpm: number; sampleRate: number; stages: PipelineStage[]; tests: { results: TestResult[]; summary: TestSummary }; artifacts: ArtifactFile[]; validation: ValidationReport; finalArtifact?: { fileName: string; fileSize: number; peak: number; rms: number; hash: string }; overall: 'PASS' | 'FAIL'; totalDurationMs: number; }

const IMPL_COLORS: Record<string, string> = {
  REAL_IMPLEMENTATION: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  SIMULATED_HARDWARE_BEHAVIOR: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  EXTERNAL_HARDWARE_REQUIREMENT: 'text-fuchsia-400 border-fuchsia-500/40 bg-fuchsia-500/10',
};
const IMPL_LABEL: Record<string, string> = {
  REAL_IMPLEMENTATION: 'REAL IMPLEMENTATION',
  SIMULATED_HARDWARE_BEHAVIOR: 'SIMULATED HW BEHAVIOR',
  EXTERNAL_HARDWARE_REQUIREMENT: 'EXTERNAL HW REQUIREMENT',
};

export default function Page() {
  const [arch, setArch] = useState<ArchData | null>(null);
  const [tests, setTests] = useState<{ results: TestResult[]; summary: TestSummary } | null>(null);
  const [runningTests, setRunningTests] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([]);
  const [genArtifactId, setGenArtifactId] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [runningValid, setRunningValid] = useState(false);
  const [execLog, setExecLog] = useState<ExecutionLog | null>(null);
  const [runningExec, setRunningExec] = useState(false);
  const [activeTab, setActiveTab] = useState('rig');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { audioRef.current = new Audio(); }, []);

  const fetchArch = useCallback(async () => {
    try {
      const r = await fetch('/api/studio/architecture');
      const d = await r.json();
      setArch(d);
    } catch (e) { toast.error('Failed to load architecture: ' + (e as Error).message); }
  }, []);

  const fetchArtifacts = useCallback(async () => {
    try {
      const r = await fetch('/api/studio/artifacts');
      const d = await r.json();
      setArtifacts(d.files?.length ? d.files : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchArch(); fetchArtifacts(); }, [fetchArch, fetchArtifacts]);

  const runTests = async () => {
    setRunningTests(true); setTests(null);
    toast.info('Running 14-test stress suite...');
    try {
      const r = await fetch('/api/studio/tests', { method: 'POST' });
      const d = await r.json();
      setTests({ results: d.results, summary: d.summary });
      toast.success(`${d.summary.pass}/${d.summary.total} tests passed`);
    } catch (e) { toast.error('Test run failed: ' + (e as Error).message); }
    finally { setRunningTests(false); }
  };

  const generateArtifact = async (id: string) => {
    setGenArtifactId(id);
    toast.info(`Generating artifact ${id}...`);
    try {
      const r = await fetch('/api/studio/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const d = await r.json();
      if (d.results?.length) {
        setArtifacts((prev) => {
          const others = prev.filter((a) => a.id !== d.results[0].id);
          return [d.results[0], ...others];
        });
        toast.success(`Artifact ${id} generated (${d.results[0].validation})`);
      }
    } catch (e) { toast.error('Artifact generation failed: ' + (e as Error).message); }
    finally { setGenArtifactId(null); }
  };

  const generateAll = async () => {
    setGenArtifactId('ALL');
    toast.info('Generating all 6 artifacts...');
    try {
      const r = await fetch('/api/studio/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      setArtifacts(d.results || []);
      toast.success(`${d.results?.length} artifacts generated`);
    } catch (e) { toast.error('Artifact generation failed: ' + (e as Error).message); }
    finally { setGenArtifactId(null); }
  };

  const runValidation = async () => {
    setRunningValid(true); setValidation(null);
    toast.info('Running closed-loop validator...');
    try {
      const r = await fetch('/api/studio/validate', { method: 'POST' });
      const d = await r.json();
      setValidation(d);
      toast.success(`Validation: ${d.overall} (${d.summary.pass}/${d.summary.total})`);
    } catch (e) { toast.error('Validation failed: ' + (e as Error).message); }
    finally { setRunningValid(false); }
  };

  const runPipeline = async () => {
    setRunningExec(true); setExecLog(null);
    toast.info('Executing full end-to-end pipeline...');
    try {
      const r = await fetch('/api/studio/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json();
      setExecLog(d);
      if (d.overall === 'PASS') toast.success(`Pipeline PASSED in ${d.totalDurationMs}ms`);
      else toast.error(`Pipeline: ${d.overall} — see execution log`);
      // refresh artifacts list
      fetchArtifacts();
    } catch (e) { toast.error('Pipeline failed: ' + (e as Error).message); }
    finally { setRunningExec(false); }
  };

  const playArtifact = (url: string) => {
    if (audioRef.current) {
      audioRef.current.src = url + '?t=' + Date.now();
      audioRef.current.play().catch(() => toast.error('Playback failed'));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative overflow-hidden">
      <div className="fixed inset-0 psy-grid-bg pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at top, color-mix(in oklch, var(--psy-purple) 14%, transparent), transparent 60%), radial-gradient(ellipse at bottom right, color-mix(in oklch, var(--psy-cyan) 10%, transparent), transparent 55%)' }} />

      <Toaster richColors position="top-right" />

      {/* HEADER */}
      <header className="relative z-10 border-b border-border/60 backdrop-blur-sm bg-background/40 sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="relative w-11 h-11 rounded-xl psy-border psy-glow flex items-center justify-center bg-card/60">
              <Radio className="w-5 h-5 text-fuchsia-400 psy-pulse" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black tracking-tight psy-gradient-text">PSY4</h1>
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Psytrance Studio · Digital Twin · End-to-End Proof</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="psy-border text-fuchsia-300">{arch?.deviceCount ?? 9} devices</Badge>
            <Badge variant="outline" className="psy-border text-cyan-300">{arch?.edgeCount ?? 28} connections</Badge>
            <Badge variant="outline" className="psy-border text-emerald-300">REAL DSP</Badge>
          </div>
        </div>
      </header>

      {/* HERO / VISION */}
      <section className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-fuchsia-300/80 mb-4">
              <Sparkles className="w-3.5 h-3.5" /> Phase 1 · Frozen Architecture
            </div>
            <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] mb-5">
              A machine for creating <span className="psy-gradient-text">trance journeys</span>, not playing synth presets.
            </h2>
            <p className="text-muted-foreground text-base sm:text-lg leading-relaxed max-w-2xl">
              {arch?.vision ?? 'Loading rig vision...'}
            </p>
            <div className="flex flex-wrap gap-3 mt-7">
              <Button onClick={runPipeline} disabled={runningExec} size="lg" className="bg-gradient-to-r from-fuchsia-600 via-purple-600 to-cyan-600 hover:opacity-90 text-white font-semibold">
                {runningExec ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                {runningExec ? 'Executing pipeline...' : 'Execute End-to-End Proof'}
              </Button>
              <Button onClick={runTests} disabled={runningTests} variant="outline" size="lg" className="psy-border">
                {runningTests ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                Run Test Suite (14)
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Cpu, label: '9 Devices', sub: 'digital twins', color: 'text-fuchsia-300' },
              { icon: AudioWaveform, label: 'Real DSP', sub: 'sample-accurate', color: 'text-cyan-300' },
              { icon: GitBranch, label: '28 Edges', sub: 'no orphans', color: 'text-emerald-300' },
              { icon: FlaskConical, label: '14 Tests', sub: 'incl. adversarial', color: 'text-amber-300' },
              { icon: AudioLines, label: '6 Artifacts', sub: 'real WAV', color: 'text-lime-300' },
              { icon: Network, label: 'Validator', sub: 'closed-loop', color: 'text-fuchsia-300' },
            ].map((s, i) => (
              <Card key={i} className="psy-card p-4 flex flex-col items-center text-center gap-1.5">
                <s.icon className={`w-5 h-5 ${s.color}`} />
                <div className="text-lg font-bold">{s.label}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.sub}</div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* MAIN TABS */}
      <main className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 pb-16 flex-1">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto p-1 bg-card/40 psy-border">
            <TabsTrigger value="rig" className="data-[state=active]:bg-fuchsia-500/15 data-[state=active]:text-fuchsia-200"><Radio className="w-3.5 h-3.5 mr-1.5" />Rig</TabsTrigger>
            <TabsTrigger value="graph" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"><Network className="w-3.5 h-3.5 mr-1.5" />Graph</TabsTrigger>
            <TabsTrigger value="tests" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-200"><FlaskConical className="w-3.5 h-3.5 mr-1.5" />Tests</TabsTrigger>
            <TabsTrigger value="artifacts" className="data-[state=active]:bg-lime-500/15 data-[state=active]:text-lime-200"><AudioLines className="w-3.5 h-3.5 mr-1.5" />Artifacts</TabsTrigger>
            <TabsTrigger value="proof" className="data-[state=active]:bg-fuchsia-500/15 data-[state=active]:text-fuchsia-200"><Terminal className="w-3.5 h-3.5 mr-1.5" />Proof Log</TabsTrigger>
          </TabsList>

          {/* RIG TAB */}
          <TabsContent value="rig" className="mt-6 space-y-6">
            {arch?.devices.map((d) => <DeviceCard key={d.id} d={d} />)}
            {arch && <TiersSection tiers={arch.tiers} recommendation={arch.recommendation} />}
          </TabsContent>

          {/* GRAPH TAB */}
          <TabsContent value="graph" className="mt-6">
            <GraphView arch={arch} />
          </TabsContent>

          {/* TESTS TAB */}
          <TabsContent value="tests" className="mt-6 space-y-5">
            <Card className="psy-card p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2"><FlaskConical className="w-5 h-5 text-amber-300" /> Hard Test Suite + Adversarial</h3>
                <p className="text-sm text-muted-foreground">14 independent automated stress tests. Each asserts on real measurable output. No PASS without an evaluated assertion.</p>
              </div>
              <Button onClick={runTests} disabled={runningTests} className="bg-amber-600 hover:bg-amber-700 text-white">
                {runningTests ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
                {runningTests ? 'Running...' : 'Run All Tests'}
              </Button>
            </Card>
            {tests && (
              <>
                <SummaryBar summary={tests.summary} />
                <div className="space-y-2">
                  {tests.results.map((t) => <TestRow key={t.id} t={t} />)}
                </div>
              </>
            )}
            {!tests && !runningTests && (
              <Card className="psy-card p-10 text-center text-muted-foreground">
                <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-40" />
                Test suite not run yet. Each test instantiates the engine, runs a scenario, and asserts on real audio output.
              </Card>
            )}
          </TabsContent>

          {/* ARTIFACTS TAB */}
          <TabsContent value="artifacts" className="mt-6 space-y-5">
            <Card className="psy-card p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2"><AudioLines className="w-5 h-5 text-lime-300" /> Musical Artifacts</h3>
                <p className="text-sm text-muted-foreground">6 real WAV files generated by the system itself. 16-bit PCM, deterministic, hash-verified.</p>
              </div>
              <Button onClick={generateAll} disabled={!!genArtifactId} className="bg-lime-600 hover:bg-lime-700 text-white">
                {genArtifactId === 'ALL' ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Generate All
              </Button>
            </Card>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(['A','B','C','D','E','F'] as const).map((id) => {
                const a = artifacts.find((x) => x.id === id);
                return <ArtifactCard key={id} id={id} artifact={a} generating={genArtifactId === id} onGenerate={() => generateArtifact(id)} onPlay={() => a && playArtifact(a.url)} />;
              })}
            </div>
          </TabsContent>

          {/* PROOF LOG TAB */}
          <TabsContent value="proof" className="mt-6 space-y-5">
            <Card className="psy-card p-5 flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="font-bold text-lg flex items-center gap-2"><Terminal className="w-5 h-5 text-fuchsia-300" /> End-to-End Execution Log</h3>
                <p className="text-sm text-muted-foreground">INITIALIZE → CONNECT → CLOCK → SEQUENCE → SYNTHESIZE → MODULATE → PROCESS → RESAMPLE → ARRANGE → MIX → MASTER → EXPORT → VALIDATE</p>
              </div>
              <div className="flex gap-2">
                <Button onClick={runValidation} disabled={runningValid} variant="outline" className="psy-border">
                  {runningValid ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Gauge className="w-4 h-4 mr-2" />}
                  Validate
                </Button>
                <Button onClick={runPipeline} disabled={runningExec} className="bg-fuchsia-600 hover:bg-fuchsia-700 text-white">
                  {runningExec ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  Run Pipeline
                </Button>
              </div>
            </Card>

            {execLog && <ExecutionLogView log={execLog} />}
            {validation && !execLog && <ValidationView report={validation} />}
            {!execLog && !validation && (
              <Card className="psy-card p-10 text-center text-muted-foreground">
                <Terminal className="w-10 h-10 mx-auto mb-3 opacity-40" />
                No execution log yet. Run the pipeline to produce a complete machine-readable proof of execution.
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* FOOTER */}
      <footer className="relative z-10 mt-auto border-t border-border/60 bg-background/60 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="w-4 h-4 text-fuchsia-400" />
            <span className="font-semibold text-foreground">PSY4</span>
            <span>·</span>
            <span>The complete system is the proof.</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 psy-pulse" /> Real DSP</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 psy-pulse" /> Sample-accurate</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-fuchsia-400 psy-pulse" /> Deterministic</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function DeviceCard({ d }: { d: DeviceSpec }) {
  const [open, setOpen] = useState(false);
  const sectionLetter = d.section.split('.')[0];
  return (
    <Card className="psy-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-5 flex items-start gap-4 hover:bg-fuchsia-500/5 transition-colors">
        <div className="flex-shrink-0 w-12 h-12 rounded-lg psy-border bg-card/60 flex items-center justify-center font-black text-lg psy-gradient-text">{sectionLetter}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-base sm:text-lg">{d.name}</h3>
            <Badge variant="outline" className={`text-[10px] ${IMPL_COLORS[d.implementation]}`}>{IMPL_LABEL[d.implementation]}</Badge>
          </div>
          <p className="text-sm text-fuchsia-300/80 font-medium mt-0.5">{d.role}</p>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{d.why}</p>
        </div>
        <div className="text-muted-foreground text-xs uppercase tracking-wider hidden sm:block">{d.make}</div>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-border/40 pt-4">
          <Field label="Audio In" value={d.audioInputs.join(', ')} />
          <Field label="Audio Out" value={d.audioOutputs.join(', ')} />
          <Field label="MIDI In" value={d.midiInputs.join(', ')} />
          <Field label="MIDI Out" value={d.midiOutputs.join(', ')} />
          <Field label="Clock" value={d.clockRelationship} />
          <Field label="Sync Source" value={d.synchronizationSource} />
          <Field label="Sequencing" value={d.sequencingResponsibility} />
          <Field label="Signal Processing" value={d.signalProcessing} />
          <Field label="Performance" value={d.performanceResponsibility} />
          <Field label="Recording" value={d.recordingDestination} />
          <Field label="Resampling Path" value={d.resamplingPath} />
          <Field label="Feedback-Safe Routing" value={d.feedbackSafeRouting} />
          <Field label="Failure Behavior" value={d.failureBehavior} />
          {d.inspiredBy && <Field label="Inspired By" value={d.inspiredBy} />}
        </div>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">{label}</div>
      <div className="text-foreground/90">{value}</div>
    </div>
  );
}

function TiersSection({ tiers, recommendation }: { tiers: { name: string; devices: string[]; note: string }[]; recommendation: { name: string; devices: string[]; note: string } }) {
  return (
    <div className="space-y-4 pt-4">
      <h3 className="font-bold text-lg flex items-center gap-2"><Sparkles className="w-5 h-5 text-fuchsia-300" /> Rig Tiers</h3>
      <div className="grid lg:grid-cols-3 gap-4">
        {tiers.map((t) => (
          <Card key={t.name} className="psy-card p-5">
            <h4 className="font-semibold text-fuchsia-200 mb-2">{t.name}</h4>
            <div className="flex flex-wrap gap-1.5 mb-3">{t.devices.map((d) => <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>)}</div>
            <p className="text-sm text-muted-foreground">{t.note}</p>
          </Card>
        ))}
      </div>
      <Card className="p-6 psy-glow psy-border bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-cyan-500/10">
        <div className="flex items-center gap-2 mb-2"><Zap className="w-5 h-5 text-fuchsia-300" /><h4 className="font-bold text-lg psy-gradient-text">{recommendation.name}</h4></div>
        <div className="flex flex-wrap gap-1.5 mb-3">{recommendation.devices.map((d) => <Badge key={d} variant="outline" className="psy-border text-fuchsia-200">{d}</Badge>)}</div>
        <p className="text-sm text-foreground/90 leading-relaxed">{recommendation.note}</p>
      </Card>
    </div>
  );
}

function GraphView({ arch }: { arch: ArchData | null }) {
  if (!arch) return <Card className="psy-card p-10 text-center text-muted-foreground">Loading graph...</Card>;
  const deviceIds = arch.devices.map((d) => d.id);
  const pos = (id: string) => {
    const i = deviceIds.indexOf(id);
    const angle = (i / deviceIds.length) * Math.PI * 2 - Math.PI / 2;
    const r = 38;
    return { x: 50 + Math.cos(angle) * r, y: 50 + Math.sin(angle) * r };
  };
  const colorFor = (k: string) => k === 'audio' ? '#22d3ee' : k === 'midi' ? '#e879f9' : '#a3e635';
  return (
    <Card className="psy-card p-5">
      <h3 className="font-bold text-lg flex items-center gap-2 mb-1"><Network className="w-5 h-5 text-cyan-300" /> Authoritative System Graph</h3>
      <p className="text-sm text-muted-foreground mb-4">Live 12 = master clock. Apollo = audio hub. Every edge labeled. No unexplained connections.</p>
      <div className="grid lg:grid-cols-[1.3fr_1fr] gap-6">
        <div className="relative aspect-square max-w-2xl mx-auto w-full">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <defs>
              <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
              </marker>
            </defs>
            {arch.graph.map((e, i) => {
              const a = pos(e.from), b = pos(e.to);
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              const dx = b.x - a.x, dy = b.y - a.y;
              const curve = 6;
              const cx = mx - dy * 0.15, cy = my + dx * 0.15;
              return <path key={i} d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} fill="none" stroke={colorFor(e.kind)} strokeWidth="0.4" strokeOpacity="0.5" markerEnd="url(#arr)" />;
            })}
            {deviceIds.map((id) => {
              const p = pos(id);
              const dev = arch.devices.find((d) => d.id === id)!;
              return (
                <g key={id}>
                  <circle cx={p.x} cy={p.y} r="4.2" fill="oklch(0.2 0.02 320)" stroke={id === 'live' ? '#22d3ee' : id === 'apollo' ? '#e879f9' : '#a78bfa'} strokeWidth="0.6" />
                  <text x={p.x} y={p.y + 0.5} textAnchor="middle" fontSize="2.2" fill="white" fontWeight="bold">{id === 'prophet6' ? 'P6' : id.toUpperCase()}</text>
                  <text x={p.x} y={p.y + 7} textAnchor="middle" fontSize="1.8" fill="#a1a1aa">{dev.make}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="space-y-3">
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-cyan-400" /> audio</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-fuchsia-400" /> midi</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-lime-400" /> clock</span>
          </div>
          <ScrollArea className="h-[420px] psy-scroll pr-3">
            <div className="space-y-1.5">
              {arch.graph.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-fuchsia-500/5">
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: colorFor(e.kind) }} />
                  <span className="font-mono font-semibold text-fuchsia-300">{e.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono font-semibold text-cyan-300">{e.to}</span>
                  <span className="text-muted-foreground truncate ml-1">{e.label}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </Card>
  );
}

function SummaryBar({ summary }: { summary: TestSummary }) {
  const pct = (summary.pass / Math.max(1, summary.total)) * 100;
  return (
    <Card className="psy-card p-5">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">{summary.pass} PASS</Badge>
          {summary.fail > 0 && <Badge className="bg-red-500/20 text-red-300 border-red-500/40">{summary.fail} FAIL</Badge>}
          {summary.blocked > 0 && <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">{summary.blocked} BLOCKED</Badge>}
        </div>
        <div className="text-sm text-muted-foreground">{summary.total} tests · {summary.totalMs}ms total</div>
      </div>
      <Progress value={pct} className="h-2 bg-muted" />
    </Card>
  );
}

function TestRow({ t }: { t: TestResult }) {
  const [open, setOpen] = useState(false);
  const Icon = t.status === 'PASS' ? CheckCircle2 : t.status === 'FAIL' ? XCircle : AlertCircle;
  const color = t.status === 'PASS' ? 'text-emerald-400' : t.status === 'FAIL' ? 'text-red-400' : 'text-amber-400';
  return (
    <Card className="psy-card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full text-left p-4 flex items-center gap-3 hover:bg-fuchsia-500/5">
        <Icon className={`w-5 h-5 flex-shrink-0 ${color}`} />
        <span className="font-mono text-xs text-muted-foreground w-20">{t.id}</span>
        <span className="font-semibold flex-1">{t.name}</span>
        <Badge variant="outline" className="text-[10px]">{t.assertions} asserts</Badge>
        <span className="text-xs text-muted-foreground">{t.durationMs}ms</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm space-y-2 border-t border-border/40 pt-3">
          <p className="text-foreground/90">{t.message}</p>
          {t.metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2">
              {Object.entries(t.metrics).map(([k, v]) => (
                <div key={k} className="text-xs px-2 py-1 rounded bg-muted/30">
                  <span className="text-muted-foreground">{k}: </span>
                  <span className="font-mono text-fuchsia-300">{typeof v === 'number' ? v.toFixed(4) : String(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ArtifactCard({ id, artifact, generating, onGenerate, onPlay }: { id: string; artifact?: ArtifactFile; generating: boolean; onGenerate: () => void; onPlay: () => void }) {
  const names: Record<string, string> = { A: '16-bar psytrance loop', B: '32-bar progressive', C: 'Evolving psychedelic', D: 'Full arrangement', E: 'Live session', F: 'Extreme sound design' };
  const hasMetrics = !!artifact && !!artifact.peak;
  return (
    <Card className="psy-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-lg psy-border bg-card/60 flex items-center justify-center font-black psy-gradient-text">{id}</div>
        {artifact?.validation && <Badge className={artifact.validation === 'PASS' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-red-500/20 text-red-300 border-red-500/40'}>{artifact.validation}</Badge>}
      </div>
      <div>
        <h4 className="font-semibold">{names[id]}</h4>
        <p className="text-xs text-muted-foreground">{artifact ? `${artifact.bars ?? '—'} bars · ${artifact.tempo ?? 138} BPM` : 'Not generated yet'}</p>
      </div>
      {hasMetrics && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <Metric label="duration" value={`${(artifact!.durationSec ?? 0).toFixed(1)}s`} />
          <Metric label="size" value={`${((artifact!.fileSize ?? 0)/1024).toFixed(1)} KB`} />
          <Metric label="peak" value={(artifact!.peak ?? 0).toFixed(3)} />
          <Metric label="rms" value={(artifact!.rms ?? 0).toFixed(4)} />
          <Metric label="sr" value={`${(((artifact!.sampleRate ?? 22050))/1000).toFixed(1)}k`} />
          <Metric label="hash" value={artifact!.hash ?? '—'} mono />
        </div>
      )}
      {!hasMetrics && artifact && (
        <div className="text-xs text-muted-foreground">On disk · {((artifact.fileSize ?? 0)/1024).toFixed(0)} KB · click regenerate for full metrics</div>
      )}
      <div className="flex gap-2 mt-auto">
        <Button size="sm" variant="outline" className="psy-border flex-1" onClick={onGenerate} disabled={generating}>
          {generating ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
          {artifact ? 'Regenerate' : 'Generate'}
        </Button>
        {artifact && <Button size="sm" className="bg-lime-600 hover:bg-lime-700 text-white flex-1" onClick={onPlay}><Play className="w-3.5 h-3.5 mr-1.5" />Play</Button>}
      </div>
    </Card>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="px-2 py-1 rounded bg-muted/30">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-fuchsia-300 ${mono ? 'font-mono' : 'font-semibold'} truncate`}>{value}</div>
    </div>
  );
}

function ExecutionLogView({ log }: { log: ExecutionLog }) {
  return (
    <div className="space-y-4">
      <Card className={`p-5 ${log.overall === 'PASS' ? 'psy-border bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {log.overall === 'PASS' ? <CheckCircle2 className="w-7 h-7 text-emerald-400" /> : <XCircle className="w-7 h-7 text-red-400" />}
            <div>
              <div className="font-bold text-lg">{log.overall === 'PASS' ? 'PIPELINE PASSED' : 'PIPELINE FAILED'}</div>
              <div className="text-xs text-muted-foreground font-mono">{log.runId} · {log.totalDurationMs}ms · seed {log.seed} · {log.bpm} BPM · {log.sampleRate} Hz</div>
            </div>
          </div>
          {log.finalArtifact && (
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Master render</div>
              <div className="font-mono text-fuchsia-300">{(log.finalArtifact.fileSize/1024).toFixed(1)} KB · peak {log.finalArtifact.peak.toFixed(3)}</div>
              <div className="font-mono text-cyan-300">hash {log.finalArtifact.hash}</div>
            </div>
          )}
        </div>
      </Card>
      <Card className="psy-card p-5">
        <h4 className="font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-fuchsia-300" /> Pipeline Stages</h4>
        <div className="space-y-1.5">
          {log.stages.map((s) => (
            <div key={s.name} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-fuchsia-500/5">
              <span className={`w-2 h-2 rounded-full ${s.status === 'PASS' ? 'bg-emerald-400' : s.status === 'FAIL' ? 'bg-red-400' : 'bg-muted-foreground'}`} />
              <span className="font-mono text-xs text-cyan-300 w-32">{s.name}</span>
              <span className={`text-xs font-semibold ${s.status === 'PASS' ? 'text-emerald-300' : s.status === 'FAIL' ? 'text-red-300' : 'text-muted-foreground'}`}>{s.status}</span>
              <span className="text-xs text-muted-foreground flex-1 truncate">{s.detail}</span>
              <span className="text-xs text-muted-foreground font-mono">{s.durationMs}ms</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid lg:grid-cols-2 gap-4">
        {log.tests.results.length > 0 && (
          <Card className="psy-card p-5">
            <h4 className="font-semibold mb-3 flex items-center gap-2"><FlaskConical className="w-4 h-4 text-amber-300" /> Tests: {log.tests.summary.pass}/{log.tests.summary.total}</h4>
            <ScrollArea className="h-64 psy-scroll">
              <div className="space-y-1">
                {log.tests.results.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-xs py-1">
                    {t.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                    <span className="font-mono text-muted-foreground">{t.id}</span>
                    <span className="flex-1 truncate">{t.name}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </Card>
        )}
        <Card className="psy-card p-5">
          <h4 className="font-semibold mb-3 flex items-center gap-2"><Gauge className="w-4 h-4 text-fuchsia-300" /> Validation: {log.validation.overall}</h4>
          <ScrollArea className="h-64 psy-scroll">
            <div className="space-y-1">
              {log.validation.checks.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-xs py-1">
                  {c.status === 'PASS' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                  <span className="font-mono text-muted-foreground w-40 truncate">{c.id}</span>
                  <span className="flex-1 truncate text-muted-foreground">{c.detail}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}

function ValidationView({ report }: { report: ValidationReport }) {
  return (
    <Card className={`p-5 ${report.overall === 'PASS' ? 'psy-border bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
      <div className="flex items-center gap-3 mb-4">
        {report.overall === 'PASS' ? <CheckCircle2 className="w-6 h-6 text-emerald-400" /> : <XCircle className="w-6 h-6 text-red-400" />}
        <div>
          <div className="font-bold">Validation: {report.overall}</div>
          <div className="text-xs text-muted-foreground">{report.summary.pass}/{report.summary.total} checks · {report.timestamp}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        {report.checks.map((c) => (
          <div key={c.id} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-fuchsia-500/5">
            {c.status === 'PASS' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
            <span className="font-mono text-xs text-cyan-300 w-44 truncate">{c.id}</span>
            <span className="text-xs uppercase tracking-wider text-muted-foreground w-24">{c.category}</span>
            <span className="text-xs text-muted-foreground flex-1 truncate">{c.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
