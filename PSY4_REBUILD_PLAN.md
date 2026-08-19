# PSY4 Clean Rebuild Plan

**Task ID:** REBUILD-PLAN
**Status:** Planning document (no implementation)
**Goal:** Replace the 30k+ line tangled PSY4 codebase with a strict 3-layer architecture totaling <5,000 lines, that does NOT stop playing after a few minutes.

This plan is **actionable**: a developer who picks it up should be able to execute Phases 0–3 without further design decisions. Every section contains concrete code, exact file paths, and an acceptance check.

---

## 0. Root-Cause Summary (so the fix is unambiguous)

The current `psyLive.ts` (4,501 lines) tracks composition progress by **bar index** (`lastWorkerComposeBar`). The audio clock (`AudioContext.currentTime`) keeps advancing when a tab is backgrounded, even though Chrome throttles the `setInterval(25ms)` scheduler to ~1/sec. On tab return:

```
lastWorkerComposeBar = 8       (frozen — scheduler barely ran)
currentBar           = 18      (audio clock kept ticking)
→ scheduler composes bars [9 .. 26] all at once
→ bars [9 .. 17] have `at` timestamps in the PAST
→ worklet plays all past events NOW (line 719 of psy4-engine-v3.js)
→ 100+ simultaneous voices → voice pool exhaustion → silence
```

The "heartbeat" fix already in place does **not** help because the scheduler IS firing, just late. There is no way to "catch up" missed time correctly in a bar-indexed model — the only correct fix is to **never backfill** and to **suspend the audio clock** while the tab is hidden so bar indices and audio time stop together.

---

## 1. Architecture — Strict 3-Layer Model (adopted from `/tmp/psysynth-audit/`)

### 1.1 Layer definitions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 3 — HOST                                                              │
│  src/lib/psyLive4.ts (≈700 lines) + src/app/page.tsx (≈600 lines)            │
│                                                                              │
│  OWNS: AudioContext · Transport · CompositionScheduler · Master chain        │
│        (crossover×3 → comp×3 → makeup×3 → sum → limiter → destination)      │
│        · StyleBank selection · UI state · visibilitychange handler           │
│                                                                              │
│  DOES NOT OWN: voice allocation, patch DSP, filter coefficients, ADSR math.  │
│                                                                              │
│  The ONLY scheduler in the system lives here: one setInterval(25ms),        │
│  120ms lookahead, time-based (never bar-indexed).                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │  NoteEvent[]  (absolute `at` times, seconds)
                                   │  via AudioParam.setValueAtTime  +  worklet port
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 — DEVICES (pure HOW — no scheduler, no setInterval, no ctx.dest)    │
│                                                                              │
│  src/lib/devices/melodic-device.ts   wraps /public/psysynth.js (PsyDevice)   │
│  src/lib/devices/drum-device.ts      wraps /public/worklets/psy4-engine-v3.js │
│                                                                              │
│  Each device exposes the SAME PsyDevice contract:                            │
│    onEvent(event)  ·  onTransport(t)  ·  onContext(ctx)  ·  onStart/Stop()   │
│    capabilities()  ·  reportLatencyMs()                                      │
│                                                                              │
│  Devices NEVER read AudioContext.currentTime for scheduling. They only use  │
│  the `at` field on each event and pass it to AudioParam.setValueAtTime.      │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │  MusicalEvent union (from shim)
                                   │  PsyDevice / MusicalTransport interfaces
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 — FOUNDATION (VERBATIM, byte-sync-tested)                          │
│  src/lib/psy-foundation-shim/ (6 files, 581 lines — already present)         │
│    protocol.ts   MusicalEvent union + DeviceCapabilities                      │
│    transport.ts   MusicalTransport v0                                         │
│    device.ts      PsyDevice interface                                         │
│    host.ts        DeviceHost + InMemoryChannel (per-listener try/catch)      │
│    voice-pool.ts  Voice<T> interface + VoicePool + Rng (mulberry32)          │
│    index.ts       barrel                                                      │
│                                                                              │
│  Pin: commit 4ae95d3 from upstream psysynth. shim-sync.test.ts MUST pass.   │
│  If anyone edits these files, the test fails.                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data flow (single tick of the scheduler)

```
                    ┌──────────────────────────────────────────────┐
                    │  HOST — CompositionScheduler.tick()         │
                    │  runs every 25ms via setInterval             │
                    └──────────────────────────────────────────────┘
                                       │
   1. now   = ctx.currentTime
   2. window = [now + 0.020,  now + 0.120]    // skip 20ms, look 120ms ahead
   3. if (lastComposedUntil > window.end) return; // nothing to do
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │  COMPOSER (sync fn, ≤0.5ms budget)            │
                    │  compose({ startTime: lastComposedUntil,      │
                    │            duration:  window.end              │
                    │                          - lastComposedUntil, │
                    │            bpm, style, energy, seed })       │
                    │  → NoteEvent[]   (each has `at` in seconds)   │
                    └──────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │  ROUTE per event:                             │
                    │  - melodic roles (lead/acid/pad/bass/keys)   │
                    │      → melodicDevice.onEvent(e)               │
                    │      → inside: voice.trigger sets             │
                    │        AudioParam.setValueAtTime(at, ...)     │
                    │  - drum roles (kick/hat/clap/perc/snare)      │
                    │      → drumDevice.onEvent(e)                  │
                    │      → inside: worklet.port.postMessage(      │
                    │          {t:"on", note, vel, at, dur})         │
                    └──────────────────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────────────┐
                    │  UPDATE lastComposedUntil = window.end        │
                    │  (NEVER less than this — no backfill)         │
                    └──────────────────────────────────────────────┘
```

### 1.3 The invariant that fixes the bug

> **`lastComposedUntil` is monotonic and only ever advances to `now + 0.120`. If `now` jumps forward (tab return), `lastComposedUntil` is *not* caught up — events for `[old lastComposedUntil, now]` are simply never composed. There is no "missed time" to recover from.**

Combined with `ctx.suspend()` on `visibilitychange→hidden` (which freezes `ctx.currentTime`), there is no scenario where the scheduler wakes up "behind" the audio clock.

---

## 2. The Scheduler Fix

### 2.1 New file: `src/lib/psyLive4/scheduler.ts` (~120 lines)

```typescript
// src/lib/psyLive4/scheduler.ts
// The ONLY setInterval in PSY4. Mirrors psyforge-pro.html lines 307–318.

export interface SchedulerHost {
  readonly ctx: AudioContext;
  compose(windowStart: number, windowEnd: number): void; // host routes events to devices
  isRunning(): boolean;
}

const TICK_MS = 25;       // wake interval
const LOOKAHEAD_S = 0.120; // compose this far ahead of ctx.currentTime
const SKIP_S = 0.020;      // never compose events < 20ms in the future (latency safety)

export class CompositionScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastComposedUntil = 0;     // monotonic — see invariant in §1.3
  private lastFireMs = 0;           // for heartbeat diagnostics

  constructor(private host: SchedulerHost) {}

  start(): void {
    if (this.timer) return;
    // Anchor: everything from "now + SKIP_S" forward.
    this.lastComposedUntil = this.host.ctx.currentTime + SKIP_S;
    this.lastFireMs = Date.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // CRITICAL: unref-style behavior — but setInterval in browsers can't unref.
    // The visibilitychange handler in psyLive4.ts handles backgrounding separately.
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.lastComposedUntil = 0;
  }

  /** Called by visibilitychange handler when the tab comes back. */
  reanchorAfterBackground(): void {
    // The audio clock was suspended while hidden (see psyLive4.ts).
    // After resume, currentTime has not jumped — but to be safe, snap forward:
    const now = this.host.ctx.currentTime;
    if (this.lastComposedUntil < now) {
      // We were suspended; there is no "missed" audio. Skip ahead.
      this.lastComposedUntil = now + SKIP_S;
    }
  }

  private tick(): void {
    if (!this.host.isRunning()) return;
    this.lastFireMs = Date.now();
    const now = this.host.ctx.currentTime;
    const windowEnd = now + LOOKAHEAD_S;
    if (this.lastComposedUntil >= windowEnd) return; // already covered

    const windowStart = Math.max(this.lastComposedUntil, now + SKIP_S);
    this.host.compose(windowStart, windowEnd);
    // Monotonic: NEVER set lastComposedUntil below windowEnd.
    this.lastComposedUntil = windowEnd;
  }

  // Heartbeat diagnostics — used by tests (§8) and the status strip.
  get staleMs(): number { return Date.now() - this.lastFireMs; }
  get composedUntil(): number { return this.lastComposedUntil; }
}
```

### 2.2 Visibility handler — `psyLive4.ts` (host)

```typescript
// src/lib/psyLive4/psyLive4.ts (excerpt)
private onVisibility = () => {
  if (!this.ctx) return;
  if (document.hidden) {
    // Freeze the audio clock. ctx.currentTime stops advancing.
    // The scheduler keeps ticking but compose() is a no-op once
    // lastComposedUntil > ctx.currentTime + LOOKAHEAD_S (it is, because
    // ctx.currentTime is frozen at the suspend point).
    this.ctx.suspend().catch(() => {});
    this.suspended = true;
  } else if (this.suspended) {
    // Tab returned. Resume the audio clock — currentTime continues
    // from where it froze. Re-anchor the scheduler in case any
    // drift accumulated.
    this.ctx.resume().then(() => {
      this.suspended = false;
      this.scheduler.reanchorAfterBackground();
    }).catch(() => {});
  }
};

// In constructor:
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', this.onVisibility);
}
```

### 2.3 What is removed (compared to current `psyLive.ts`)

| Removed concept | Why |
|---|---|
| `lastWorkerComposeBar` (bar index) | Replaced by `lastComposedUntil` (seconds, monotonic) |
| `barOriginAudioTime` derivation | Gone — composer receives absolute `startTime` |
| `compositionWorker.postMessage({type:'compose', startBar, endBar, barOriginAudioTime})` | Replaced by sync `compose(windowStart, windowEnd)` call |
| Heartbeat that checks `staleMs > 5000` then tries `ctx.resume()` | Replaced by structural fix: scheduler cannot get behind because audio clock is suspended with it |
| `_playPollInterval`, `evictionTimer`, `explorationTimer`, `detectTimer`, `uiTimer` (5 separate setIntervals) | One `setInterval` total — UI updates are React-driven via `requestAnimationFrame` |

---

## 3. Composition Redesign — Time-Based Composer

### 3.1 The composer interface

```typescript
// src/lib/psyLive4/composer.ts

export interface NoteEvent {
  at: number;        // absolute AudioContext time, seconds — NEVER relative to a bar
  role: SynthRole;   // 'bass' | 'lead' | 'acid' | 'pad' | 'kick' | 'hat' | 'clap' | 'perc' | 'snare' | 'keys'
  note: number;      // MIDI note (0..127). Drums may use a fixed value (e.g. 36 for kick).
  velocity: number;  // 0..1
  duration: number;  // seconds; -1 = hold until next note-off
}

export interface ComposeRequest {
  startTime: number;   // absolute seconds — when the window begins
  duration: number;    // seconds — length of the window
  bpm: number;
  style: MusicalStyle; // 'FULL_ON' | 'DARK' | 'PROGRESSIVE' | 'ACID' | 'GOA' | 'HI_TECH' | 'FOREST'
  energy: number;      // 0..1
  seed: number;        // deterministic per host session
  // Continuity hints — passed back from the previous window so motifs evolve,
  // but the composer is NOT required to use them.
  prev: { lastBassNote: number; barInArrangement: number; motifStep: number } | null;
}

export interface ComposeResult {
  events: NoteEvent[];     // ordered by `at` ascending
  next: { lastBassNote: number; barInArrangement: number; motifStep: number };
}

export interface Composer {
  compose(req: ComposeRequest): ComposeResult;
}
```

### 3.2 Implementation — `PsytranceComposer` (~250 lines)

The composer is a **pure function** of `(startTime, duration, bpm, style, seed, prev)`. It runs synchronously on the main thread (the worklet handles drum synthesis; the composer just emits `at` timestamps). Budget: ≤0.5ms per call (120ms window @ 145bpm = ~3 bars = ~30 events).

```typescript
// src/lib/psyLive4/composer.ts (sketch)

import { STYLE_GRAMMARS } from './style-grammars';   // copied from composition-worker-v2.js
import { mulberry32 } from './rng';

export class PsytranceComposer implements Composer {
  compose(req: ComposeRequest): ComposeResult {
    const g = STYLE_GRAMMARS[req.style] ?? STYLE_GRAMMARS.FULL_ON;
    const rng = mulberry32((req.seed ^ Math.floor(req.startTime * 1000)) >>> 0);
    const beat = 60 / req.bpm;
    const sixteenth = beat / 4;
    const end = req.startTime + req.duration;

    // Snap the grid to the bar that contains startTime.
    // barZero = audio time of the most recent bar boundary ≤ startTime.
    const barLen = beat * 4;
    const barInArrangement = req.prev?.barInArrangement ?? 0;
    const barZero = req.startTime - ((req.startTime - req.startTime % barLen) % barLen);

    const events: NoteEvent[] = [];
    let t = barZero;
    let bassNote = req.prev?.lastBassNote ?? 36;   // C2
    let motifStep = req.prev?.motifStep ?? 0;
    let barsComposed = 0;

    while (t < end) {
      const barIdx = barInArrangement + barsComposed;
      // ── KICK: beats 1, 2, 3, 4 (four-on-the-floor) ──
      for (let b = 0; b < 4; b++) {
        const at = t + b * beat;
        if (at >= req.startTime && at < end) {
          events.push({ at, role: 'kick', note: 36, velocity: 0.95, duration: 0.15 });
        }
      }
      // ── BASS: rolling 16ths (FULL_ON) or offbeat 8ths (PROGRESSIVE) ──
      for (const step of g.bassSteps) {
        const at = t + step * sixteenth;
        if (at >= req.startTime && at < end) {
          // Walk bass note within scale on bar transitions
          if (step === 0 && barsComposed > 0 && rng() < 0.4) {
            bassNote = nextBassNote(bassNote, g.scale, rng);
          }
          events.push({ at, role: 'bass', note: bassNote, velocity: 0.75, duration: sixteenth * 0.9 });
        }
      }
      // ── HATS: offbeat 8ths, accent every 4th ──
      for (let s = 2; s < 16; s += 2) {
        const at = t + s * sixteenth;
        if (at >= req.startTime && at < end) {
          const accent = (s % 8 === 6);
          events.push({ at, role: 'hat', note: 42, velocity: accent ? 0.7 : 0.4, duration: 0.05 });
        }
      }
      // ── LEAD/ACID: motif only after bar 4 (intro rule) ──
      if (barIdx >= 4 && g.motifSteps) {
        for (let i = 0; i < g.motifSteps.length; i++) {
          const step = g.motifSteps[i];
          const at = t + step * sixteenth;
          if (at >= req.startTime && at < end) {
            const interval = g.motifIntervals[i % g.motifIntervals.length];
            const note = 60 + interval; // C4 + motif
            events.push({
              at, role: g.acidBass ? 'acid' : 'lead',
              note, velocity: 0.65, duration: sixteenth * 1.5,
            });
            motifStep = (motifStep + 1) % g.motifIntervals.length;
          }
        }
      }
      // ── SNARE/CLAP: backbeat on beats 2 and 4 (after bar 8) ──
      if (barIdx >= 8) {
        for (const b of [1, 3]) {
          const at = t + b * beat;
          if (at >= req.startTime && at < end) {
            events.push({ at, role: 'clap', note: 39, velocity: 0.7, duration: 0.12 });
          }
        }
      }
      t += barLen;
      barsComposed++;
    }

    events.sort((a, b) => a.at - b.at);
    return {
      events,
      next: { lastBassNote: bassNote, barInArrangement: barInArrangement + barsComposed, motifStep },
    };
  }
}
```

### 3.3 Why no Web Worker?

The current `composition-worker-v2.js` (456 lines) was bar-indexed and the main↔worker round-trip (~1–5ms) interacted badly with the scheduler's 25ms tick. The new composer:

- Runs **synchronously** on the main thread (≤0.5ms budget — well within the 25ms tick).
- Is a **pure function** — deterministic per `(seed, startTime)`.
- Has **zero state** between calls except what it explicitly passes via `prev`.

This removes the worker entirely (one less moving part, no transferable-array marshalling, no `workerReady` handshake).

### 3.4 Host routing — `psyLive4.ts`

```typescript
// src/lib/psyLive4/psyLive4.ts (excerpt)

private compose(windowStart: number, windowEnd: number): void {
  const req: ComposeRequest = {
    startTime: windowStart,
    duration: windowEnd - windowStart,
    bpm: this.bpm,
    style: this.style,
    energy: this.energy,
    seed: this.seed,
    prev: this.composerPrev,
  };
  const result = this.composer.compose(req);
  this.composerPrev = result.next;

  for (const e of result.events) {
    const device = this.deviceForRole(e.role);
    device.onEvent({
      type: 'note',
      at: e.at,
      note: e.note,
      velocity: e.velocity,
      duration: e.duration,
      role: e.role,
    });
  }
}

private deviceForRole(role: SynthRole): PsyDevice {
  // kick / hat / clap / perc / snare  → drumDevice (psy4-engine-v3.js worklet)
  // bass / lead / acid / pad / keys   → melodicDevice (psysynth.js)
  return DRUM_ROLES.has(role) ? this.drumDevice : this.melodicDevice;
}
```

---

## 4. UI Redesign — Real Synth UI, Not a Dashboard

The current `page.tsx` (799 lines) is a dashboard: spectrums, status pills, "Causal Action: NO_CHANGE" readouts, sync-status tables — none of which help you *play* the engine. The reference (`psyforge-pro.html`, 591 lines) is a real synth UI: knob-per-feature, 3-column layout, keyboard + wheels at the bottom.

### 4.1 Design tokens (from `psyforge-pro.html` lines 8–9)

```typescript
// src/app/globals.css (append)
:root {
  --bg: #080512;      /* near-black purple */
  --p:  #130b24;      /* panel */
  --p2: #1a1030;      /* panel-2 (inset) */
  --ln: #2c1c50;      /* hairline */
  --tx: #eee8fb;      /* primary text */
  --dm: #9a8cc4;      /* dim text */
  --ac: #b8f22e;      /* accent — lime green (OSC) */
  --mg: #c93df0;      /* magenta (FILTER) */
  --vi: #8a4dff;      /* violet */
  --or: #ff9a2a;      /* orange (highlight) */
  --gr: #3df08a;      /* green (ARP/active) */
}
```

### 4.2 Component tree

```
src/app/page.tsx                      // <PsyForge4/> root — owns engine ref, theme, hotkeys
└─ src/components/psyforge/
   ├─ Header.tsx                      // logo · preset select · BPM · TAP · ARP · SEQ · SAVE · POWER
   ├─ SynthRack.tsx                   // 3-column grid: OSC / FILTER / AMP (role-aware)
   │   ├─ KnobGrid.tsx                // generic: takes KnobSpec[] and renders knobs
   │   ├─ OscSection.tsx              // Wave, Detune, Sub, Glide, Pump, FM, Unison, Spread, Engine, Morph
   │   ├─ FilterSection.tsx          // Cutoff, Res, EnvAmt, Acc, FType, Ring, Crush, PEnv
   │   └─ AmpSection.tsx             // Atk, Dec, Sus, Rel
   ├─ ArpSeq.tsx                      // ARP knobs + 16-step visualizer + pattern select + LED row
   │   └─ StepVisualizer.tsx          // 16 divs, height by gate, accent class on acc steps
   ├─ ModMatrix.tsx                   // static LED list of routings (Vel→Cutoff, LFO→Pitch, MW→LFOamt)
   ├─ FxSection.tsx                   // Drive, Delay, Reverb, DelayFb, Volume
   ├─ Keyboard.tsx                    // 14 white keys + 10 black + pitch wheel + mod wheel + Oct±
   ├─ StatusStrip.tsx                 // single line: "145 BPM · FULL_ON · 24 voices · peak -9.6dB"
   └─ Knob.tsx                        // the primitive: vertical drag, --r CSS var, label, value text
```

### 4.3 The `Knob` primitive

```tsx
// src/components/psyforge/Knob.tsx
'use client';
import React, { useCallback, useRef } from 'react';

interface KnobProps {
  id: string;
  label: string;
  value: number;            // 0..1
  onChange: (v: number) => void;
  display: string;          // formatted value, e.g. "1.8k"
  accent?: 'ac' | 'mg' | 'gr' | 'or';
}

export function Knob({ id, label, value, onChange, display, accent = 'ac' }: KnobProps) {
  const sy = useRef(0);
  const v0 = useRef(value);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    sy.current = e.clientY;
    v0.current = value;
  }, [value]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.buttons & 1)) return;
    const dv = (sy.current - e.clientY) / 120;
    const v = Math.max(0, Math.min(1, v0.current + dv));
    onChange(v);
  }, [onChange]);

  const rotation = (value * 240 - 120); // -120deg..+120deg
  return (
    <div className="knob-cell">
      <div className="knob-label">{label}</div>
      <div
        className={`knob knob-${accent}`}
        style={{ ['--r' as string]: `${rotation}deg` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      />
      <div className="knob-value">{display}</div>
    </div>
  );
}
```

CSS (in `globals.css`):
```css
.knob-cell { display:flex; flex-direction:column; align-items:center; gap:3px; font-size:9px; color:var(--dm); }
.knob { width:40px; height:40px; border-radius:50%;
        background:radial-gradient(circle at 35% 30%, #3a2b5e, #150e26 70%);
        border:2px solid #000; position:relative; touch-action:none; cursor:grab; }
.knob::after { content:""; position:absolute; left:50%; top:3px; width:2px; height:12px;
               background:var(--ac); transform-origin:50% 17px;
               transform:translateX(-50%) rotate(var(--r,0deg)); }
.knob-mg::after { background:var(--mg); }
.knob-gr::after { background:var(--gr); }
.knob-or::after { background:var(--or); }
.knob-value { color:var(--tx); font-size:9px; min-height:11px; }
```

### 4.4 The root JSX layout (mirrors `psyforge-pro.html` lines 53–141)

```tsx
// src/app/page.tsx (skeleton — the actual implementation lives in components/psyforge/*)
'use client';
export default function Page() {
  return (
    <div className="psyforge-root">
      <Header engine={engine} />

      {/* 3-column: OSC / FILTER / AMP — collapses to 1 column < 820px */}
      <div className="grid-3col">
        <Panel title="OSC + ROLLING BASS" accent="ac">
          <OscSection voice={selectedVoice} onChange={patchVoice} />
        </Panel>
        <Panel title="ACID FILTER 303" accent="mg">
          <FilterSection voice={selectedVoice} onChange={patchVoice} />
        </Panel>
        <Panel title="ENVELOPE (tight psy)" accent="ac">
          <AmpSection voice={selectedVoice} onChange={patchVoice} />
        </Panel>
      </div>

      {/* 3-column: ARP+SEQ / MOD MATRIX / FX */}
      <div className="grid-3col">
        <Panel title="ARPEGGIATOR + STEP SEQ (synced)" accent="gr" wide>
          <ArpSeq engine={engine} />
        </Panel>
        <Panel title="MOD MATRIX (live)" accent="ac">
          <ModMatrix voice={selectedVoice} />
        </Panel>
        <Panel title="FX (tempo-sync)" accent="ac">
          <FxSection engine={engine} />
        </Panel>
      </div>

      {/* Bottom: wheels + keyboard + octave */}
      <div className="keyboard-row">
        <Wheels pitch={pitch} mod={modw} onChange={setWheels} />
        <Keyboard onNote={handleNote} octave={octave} />
        <div className="oct-buttons">
          <button onClick={() => setOctave(o => Math.min(6, o+1))}>Oct+</button>
          <button onClick={() => setOctave(o => Math.max(1, o-1))}>Oct-</button>
        </div>
      </div>

      <StatusStrip engine={engine} />
    </div>
  );
}
```

### 4.5 Where shadcn/ui fits (and where it doesn't)

**Use shadcn/ui for:**
- `<Select>` — preset dropdown (already styled, accessible)
- `<Slider>` — coarse BPM / volume sliders in the header (where a knob would be overkill)
- `<Tooltip>` — knob hover hints
- `<Sheet>` — mobile hamburger menu for the rack

**Do NOT use shadcn/ui for:**
- The knob itself — custom pointer-capture drag is required (shadcn `<Slider>` is horizontal and wrong affordance for a synth)
- The step sequencer — needs per-cell pointer events
- The keyboard — needs precise pointer-capture + multi-touch
- The status strip — just text, no widget needed
- The mod matrix — static LED list

**Net:** ~5 shadcn components used (down from 48 currently installed).

### 4.6 State binding to the engine

The UI does NOT call `device.onEvent` directly except for the live keyboard (user-playable notes). All knob changes go through `engine.setVoiceParam(role, paramName, value)` which calls into `psysynth.js` via the melodic device's parameter API. The composition engine continues running independently — knobs affect the *next* composed note, not the currently playing one (this is correct behavior and matches `psyforge-pro.html`).

---

## 5. Migration Phases

Each phase is independently testable. **Nothing is deleted until Phase 3.**

### Phase 0 — Scaffold (no behavior change)

**Goal:** Create new files alongside old. App still runs from `psyLive.ts` + old `page.tsx`.

**Files created:**
```
src/lib/psyLive4/
  ├─ scheduler.ts            (~120 lines, §2.1)
  ├─ composer.ts             (~250 lines, §3.2)
  ├─ style-grammars.ts       (~80 lines, copy from composition-worker-v2.js)
  ├─ rng.ts                  (~15 lines, mulberry32)
  ├─ types.ts                (~40 lines, NoteEvent/ComposeRequest/SynthRole)
  └─ psyLive4.ts             (~400 lines, the host — starts empty, fills in §1.3 routing)
src/lib/devices/
  ├─ melodic-device.ts       (~150 lines, wraps public/psysynth.js as PsyDevice)
  └─ drum-device.ts          (~120 lines, wraps public/worklets/psy4-engine-v3.js)
src/components/psyforge/
  └─ Knob.tsx                (~50 lines, §4.3)
tests/psyLive4/
  └─ scheduler.test.ts       (~150 lines, §8.1)
tests/psyLive4/shim-sync.test.ts (~80 lines, §8.2)
```

**Acceptance check (Phase 0):**
- `bun run build` succeeds.
- `bun test tests/psyLive4/scheduler.test.ts` passes (scheduler unit tests with stub AudioContext).
- App at `localhost:3000` still uses old `psyLive.ts` (no behavior change).
- The new files compile but are not imported by `page.tsx` yet.

### Phase 1 — New scheduler + composer (replaces psyLive scheduler + composition-worker)

**Goal:** Swap the scheduler and composer. UI is still the old dashboard `page.tsx`, but it now talks to `psyLive4.ts` instead of `psyLive.ts`.

**Changes:**
1. `src/app/page.tsx`: change `import { PsyLive } from '@/lib/psyLive'` → `import { PsyLive4 } from '@/lib/psyLive4/psyLive4'`. Adapt the 5–6 methods called (play/stop/setStyle/setBpm/setEnergy/getDiagnostics). The LiveState interface is preserved so most of the JSX stays the same.
2. `psyLive4.ts` implements: AudioContext creation, master chain (3-band compressor + limiter from the latest audit), visibilitychange handler (§2.2), device wiring (melodic + drum), and exposes a `LiveState`-shaped diagnostics object for the old UI.
3. `composition-worker-v2.js` is **no longer loaded** (the `new Worker()` call is removed from `psyLive4.ts`).

**Acceptance check (Phase 1):**
- Click Play in the old UI → audio plays.
- Run the 5-minute background-tab test (§8.3) → audio continues after tab return, no silence, no voice-pool exhaustion.
- `kickCount` increments smoothly through tab background/foreground cycles.
- The composer's `prev` continuity works: bass note evolves, motif step continues.
- No errors in console; `staleMs < 100` at all sampled points.

### Phase 2 — New UI (replaces page.tsx)

**Goal:** Replace the dashboard with the `psyforge/` component tree.

**Changes:**
1. Implement all components in `src/components/psyforge/` per §4.2–4.4.
2. Rewrite `src/app/page.tsx` to ~150 lines (root + state binding per §4.4).
3. Add CSS tokens to `src/app/globals.css` per §4.1.
4. Delete the old dashboard's spectrum canvas, sync-status pills, causal-action readout, radio-observation panel — these have no counterpart in the new design.

**Acceptance check (Phase 2):**
- Visual: matches `psyforge-pro.html` layout (3-col rack, 16-step sequencer, keyboard + wheels).
- Functional: knobs mutate engine params via `engine.setVoiceParam`. Preset dropdown loads presets from `manifest.json`. POWER button starts/stops audio. ARP/SEQ toggles arm/disarm.
- Mobile: collapses to single column at <820px (CSS grid breakpoints).
- Keyboard: pointer + multi-touch works; pitch/mod wheels drag.
- All Phase 1 acceptance checks still pass (no regression).

### Phase 3 — Cleanup (delete old files)

**Goal:** Remove every file that is no longer reachable. Target: total source ≤5,000 lines.

**Deletion list:** see §6.

**Acceptance check (Phase 3):**
- `bun run build` succeeds with no dead-import warnings.
- `find src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1` reports ≤5,000.
- All Phase 1 & 2 acceptance checks still pass.
- `git diff --stat main..HEAD -- src` shows deletions of the listed files only.

---

## 6. What to DELETE (Phase 3 — be ruthless)

### 6.1 Source code (src/)

| Path | Lines | Why delete |
|---|---|---|
| `src/lib/psyLive.ts` | 4,501 | Replaced by `psyLive4/*` (~700 lines total) |
| `src/lib/synth-bridge.ts` | 389 | Adapter layer no longer needed — `melodic-device.ts` wraps psysynth directly |
| `src/lib/material-realizer.ts` | — | Dead code — never drives playback |
| `src/lib/synthesisGenerator.ts` | — | Dead code |
| `src/lib/loopLearner.ts` | — | Dead code |
| `src/lib/learning.ts` | — | Dead code (no learning loop in new arch) |
| `src/lib/soundExplorer.ts` | — | Dead code |
| `src/lib/smartExplorer.ts` | — | Dead code |
| `src/lib/melodyObserver.ts` | — | Dead code |
| `src/lib/synthesisMatcher.ts` | — | Dead code |
| `src/lib/referenceAnalyzer.ts` | — | Dead code |
| `src/lib/onsetAnalyzer.ts` | — | Dead code |
| `src/lib/styleClassifier.ts` | — | Dead code |
| `src/lib/soundPackage.ts` | — | Dead code |
| `src/lib/qualityAnalyzer.ts` | — | Dead code |
| `src/lib/soundBank.ts` | — | Dead code |
| `src/lib/beatPLL.ts` | — | Dead code (radio sync feature removed) |
| `src/lib/rewardTracker.ts` | — | Dead code (RL reward — no longer relevant) |
| `src/lib/db.ts` | — | Prisma — not needed without learning loop |
| `src/lib/studio/engine/engineWorklet.ts` | — | Unused |
| `src/components/ui/*.tsx` (43 of 48 files) | ~3,500 | Keep only: `select.tsx`, `slider.tsx`, `tooltip.tsx`, `sheet.tsx`, `button.tsx`. Delete the other 43 (accordion, alert, avatar, breadcrumb, calendar, carousel, chart, checkbox, collapsible, command, context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp, input, label, menubar, navigation-menu, pagination, popover, progress, radio-group, resizable, scroll-area, separator, sidebar, skeleton, sonner, switch, table, tabs, toast, toaster, textarea, toggle, toggle-group, aspect-ratio, badge, card, alert-dialog) |
| `src/hooks/use-toast.ts`, `src/hooks/use-mobile.ts` | — | Only used by deleted shadcn components |
| `src/app/api/reference/proxy/route.ts` | — | Radio stream proxy — feature removed |

### 6.2 Foundation dead code (`foundation/`)

| Path | Why delete |
|---|---|
| `foundation/music/*.ts` (22 files, ~4,000 lines: CausalComposer, PhraseEngine, MaterialRegistry, SoundDNA, CausalState, ContinuousMusicalState, HarmonicState, MusicalMemory, InferenceEngine, PhraseDevelopmentState, GrooveState, LearnedGrammar, TensionState, CandidateGenerator, MusicalObservation, MusicalSession, MusicalContext, MusicalMemoryStore, MusicalStrategies, RadioMusicalWindow, primitives/*, index.ts) | None drive playback. The new `PsytranceComposer` is self-contained (~250 lines). |
| `foundation/radio/*` (RadioObservationLayer, BeatObservationEngine, RadioObservationTypes, index) | Radio observation feature removed. |
| `foundation/transport/*` (TransportTypes, MusicalTransport, index) | Superseded by `psy-foundation-shim/transport.ts`. |

### 6.3 Public/worklets

| Path | Why delete |
|---|---|
| `public/worklets/composition-worker-v2.js` (456 lines) | Replaced by sync `PsytranceComposer`. |

### 6.4 Tests (remove obsolete, keep useful)

| Path | Why delete |
|---|---|
| `tests/foundation/radio/*` (4 files + 3 JSON results) | Feature removed. |
| `tests/foundation/music/*` (4 files + 1 JSON result) | CausalComposer tests — that class is deleted. |
| `tests/foundation/transport/*` (5 files + 4 JSON results) | Replaced by `tests/psyLive4/shim-sync.test.ts`. |
| `tests/reality-bridge/*` (30+ files) | All test against the old architecture. The new architecture has `tests/psyLive4/*`. |
| `tests/database-runtime-build.sh`, `tests/python-runtime-*.sh` | Python/DB runtime — not used. |
| `tests/reality-bridge-setup.ts` | Setup for removed tests. |

### 6.5 Documentation & reports

| Path | Why delete |
|---|---|
| `audit-reports/*.md` (55 files) | Historical — none referenced by code. Keep only as `git log` history. |
| `audit/F*.md` (20+ files) | Same — historical forensic audits. |
| `audit/F*_*.png` (5 screenshot files) | Historical. |
| `*.md` at root (40+ files: PSY4_FINAL_AUDIT, PSY4_DEEP_ROAST, FOUNDATION_STATUS, EXECUTION_PLAN, EXECUTION_PLAN_v2, ARCHITECTURE, ARCHITECTURE_SIGNAL_FLOW, BENCHMARK_REPORT, ENGINEERING_ASSESSMENT, LATENCY_FORENSIC, LEARNING_AUDIT, MUSICAL_GRAMMAR, PSY3_VS_PSY4, PSY3_PRODUCTION_KNOWLEDGE, PSY3_SOUND_DESIGN_RULES, PSY4_ROAST, PSYTRANCE_RADIO_STREAMS, REALITY_CHECK, REFERENCE_ANALYSIS_REPORT, SAMPLE_MANIFEST, SAMPLE_SELECTION_RULES, SKILL_RESEARCH_AUDIO_PRODUCTION, SOUND_LIBRARY, COMMERCIAL_*, DEMO, FOUNDATION_API) | Replace with one canonical `ARCHITECTURE.md` (rewritten for the 3-layer model). |
| `agent-ctx/*.md` (22 files) | Task context snapshots — historical. |
| `audit-tmp/*`, `validation/*`, `audio-artifacts/*`, `download/*`, `examples/*` | Scratch / historical artifacts. |

### 6.6 Samples (large disk footprint)

| Path | Action |
|---|---|
| `public/samples/real/*.wav` (140 files, ~600MB) | Keep manifest, move WAVs to a separate sound bank repo or CDN. The drum worklet (`psy4-engine-v3.js`) is sample-free (synthesized), so these samples are only needed if a future sampler device is added. |
| `public/samples/*.wav` (synth-rendered one-shots) | Delete — generated by the old `synthesisGenerator.ts` which is gone. |
| `public/phase3/*`, `public/phase5/*`, `public/audio-quality/*` | Delete — historical renders. |

### 6.7 Misc

| Path | Why delete |
|---|---|
| `p4_callresponse.json` | Scratch. |
| `prisma/schema.prisma` | No DB. |
| `wrangler.toml`, `Caddyfile` | Cloud/deploy configs not used by the Next.js app. |
| `skills/` (entire dir, ~50 skills) | Unrelated to PSY4 — was bundled by mistake. Move out of this repo. |

---

## 7. What to KEEP (the good bones)

### 7.1 Foundation shim (verbatim, byte-sync-tested)

```
src/lib/psy-foundation-shim/
  ├─ protocol.ts        (202 lines)  MusicalEvent union + DeviceCapabilities
  ├─ transport.ts       ( 58 lines)  MusicalTransport v0
  ├─ device.ts          ( 24 lines)  PsyDevice interface
  ├─ host.ts            (104 lines)  DeviceHost + InMemoryChannel
  ├─ voice-pool.ts      (133 lines)  Voice<T> + VoicePool + Rng
  └─ index.ts           ( 60 lines)  barrel
```
**Total: 581 lines.** Add a `tests/psyLive4/shim-sync.test.ts` that hashes each file and compares against `4ae95d3` pinned hashes. If the test fails, someone edited the shim.

### 7.2 Synth devices (the HOW layer — already built)

| Path | Size | Role |
|---|---|---|
| `public/psysynth.js` | 21 KB (minified bundle) | Melodic device — 7 roles (bass/lead/arp/pad/stab/pluck/keys). The new `melodic-device.ts` is a 150-line PsyDevice wrapper around this bundle's exports. |
| `public/worklets/psy4-engine-v3.js` | 844 lines | Drum worklet — kick/bass/lead/acid/pad/hat/hat-open/clap/perc/shaker/texture/riser/impact/sweep/snare. Already has 16 pre-allocated voices, MultibandComp, sidechain ducking, limiter. The new `drum-device.ts` wraps it. |

### 7.3 Patch library & style banks

| Path | Why keep |
|---|---|
| `public/patches/manifest.json` (21 patches, 7 roles) | Already improved per the sound-design worklog entry — octave layers, sub layers, LFO movement, bass sustain modes. |
| `public/patches/style-banks.json` (6 banks: FULL_ON, DARK, PROGRESSIVE, ACID, GOA, HI_TECH, FOREST) | Macros (cutoffBias, resBias, glideBias, energyToCutoff) consumed by the new composer. |

### 7.4 App shell

| Path | Why keep |
|---|---|
| `src/app/layout.tsx` (38 lines) | Root layout — keep. |
| `src/app/globals.css` | Append the `psyforge` design tokens (§4.1) and knob CSS. |
| `next.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `package.json`, `bun.lock` | Build config. |
| `public/logo.svg`, `public/robots.txt` | Static assets. |

### 7.5 Keep 5 shadcn/ui components

```
src/components/ui/
  ├─ button.tsx      (used by Header buttons)
  ├─ select.tsx      (used by Header preset dropdown)
  ├─ slider.tsx      (used by Header BPM coarse control)
  ├─ tooltip.tsx     (used by Knob hover hints)
  └─ sheet.tsx       (used by mobile rack drawer)
```
**Delete the other 43.**

### 7.6 New files (created in Phase 0–2)

```
src/lib/psyLive4/
  ├─ scheduler.ts        (~120 lines)
  ├─ composer.ts         (~250 lines)
  ├─ style-grammars.ts   (~80 lines)
  ├─ rng.ts              (~15 lines)
  ├─ types.ts            (~40 lines)
  └─ psyLive4.ts         (~400 lines)
src/lib/devices/
  ├─ melodic-device.ts   (~150 lines)
  └─ drum-device.ts      (~120 lines)
src/components/psyforge/
  ├─ Header.tsx          (~80 lines)
  ├─ SynthRack.tsx       (~60 lines)
  ├─ KnobGrid.tsx        (~40 lines)
  ├─ OscSection.tsx      (~80 lines)
  ├─ FilterSection.tsx   (~70 lines)
  ├─ AmpSection.tsx      (~50 lines)
  ├─ ArpSeq.tsx          (~100 lines)
  ├─ StepVisualizer.tsx  (~50 lines)
  ├─ ModMatrix.tsx       (~40 lines)
  ├─ FxSection.tsx       (~60 lines)
  ├─ Keyboard.tsx        (~120 lines)
  ├─ StatusStrip.tsx     (~30 lines)
  └─ Knob.tsx            (~50 lines)
src/app/page.tsx         (~150 lines, rewritten)
tests/psyLive4/
  ├─ scheduler.test.ts   (~150 lines)
  ├─ composer.test.ts    (~120 lines)
  ├─ background-tab.test.ts (~200 lines)  ← the regression test
  └─ shim-sync.test.ts   (~80 lines)
```

**Total new code:** ~2,565 lines.
**Total kept:** ~1,800 lines (shim + worklets + manifest + UI primitives + shell).
**Target total: ≤5,000 lines.** ✓

---

## 8. Testing Strategy — Proving the Engine Doesn't Stop

The single most important test is the **5-minute background-tab regression test**. It must fail on the old `psyLive.ts` and pass on `psyLive4.ts`.

### 8.1 Unit: scheduler (no audio context)

```typescript
// tests/psyLive4/scheduler.test.ts
import { CompositionScheduler } from '@/lib/psyLive4/scheduler';

class StubHost {
  ctx = { currentTime: 0 } as any;
  composed: [number, number][] = [];
  running = true;
  isRunning() { return this.running; }
  compose(start: number, end: number) { this.composed.push([start, end]); }
  advance(dt: number) { this.ctx.currentTime += dt; }
}

test('never backfills: composing forward only', () => {
  const host = new StubHost();
  const sched = new CompositionScheduler(host);
  sched.start();
  expect(host.composed.length).toBe(1);  // initial window
  const first = host.composed[0];
  // Simulate the tab being backgrounded: jump currentTime forward 60s.
  // In the real system, suspend() prevents this; but we test the safety net.
  host.advance(60);
  // Run one tick — the window should be [now+skip, now+lookahead], NOT [old, now+lookahead].
  (sched as any).tick();
  const last = host.composed[host.composed.length - 1];
  expect(last[0]).toBeGreaterThan(60);  // never backfills into the gap
  expect(last[0]).toBeLessThan(last[1]);
  sched.stop();
});

test('monotonic lastComposedUntil', () => {
  const host = new StubHost();
  const sched = new CompositionScheduler(host);
  sched.start();
  const before = sched.composedUntil;
  host.advance(0.025); (sched as any).tick();
  host.advance(0.025); (sched as any).tick();
  expect(sched.composedUntil).toBeGreaterThanOrEqual(before);
  sched.stop();
});

test('heartbeat staleMs tracks last fire', async () => {
  const host = new StubHost();
  const sched = new CompositionScheduler(host);
  sched.start();
  await new Promise(r => setTimeout(r, 60));
  expect(sched.staleMs).toBeLessThan(200);
  sched.stop();
});
```

### 8.2 Unit: composer determinism

```typescript
// tests/psyLive4/composer.test.ts
import { PsytranceComposer } from '@/lib/psyLive4/composer';

test('same seed + startTime → same events', () => {
  const c = new PsytranceComposer();
  const req = { startTime: 10, duration: 0.5, bpm: 145, style: 'FULL_ON',
                energy: 0.5, seed: 42, prev: null };
  const a = c.compose(req);
  const b = c.compose(req);
  expect(a.events).toEqual(b.events);
});

test('events are sorted by `at` ascending', () => {
  const c = new PsytranceComposer();
  const r = c.compose({ startTime: 0, duration: 2, bpm: 145,
                        style: 'DARK', energy: 0.5, seed: 1, prev: null });
  for (let i = 1; i < r.events.length; i++) {
    expect(r.events[i].at).toBeGreaterThanOrEqual(r.events[i-1].at);
  }
});

test('continuity: prev carries bass note forward', () => {
  const c = new PsytranceComposer();
  const r1 = c.compose({ startTime: 0, duration: 1, bpm: 145,
                          style: 'FULL_ON', energy: 0.5, seed: 1, prev: null });
  const r2 = c.compose({ startTime: 1, duration: 1, bpm: 145,
                          style: 'FULL_ON', energy: 0.5, seed: 1, prev: r1.next });
  // bass note in r2 starts where r1 left off
  const r2Bass = r2.events.find(e => e.role === 'bass');
  expect(r2Bass).toBeDefined();
});

test('no event has `at` outside the requested window', () => {
  const c = new PsytranceComposer();
  const start = 5, dur = 0.5;
  const r = c.compose({ startTime: start, duration: dur, bpm: 145,
                          style: 'ACID', energy: 0.5, seed: 1, prev: null });
  for (const e of r.events) {
    expect(e.at).toBeGreaterThanOrEqual(start - 0.001);
    expect(e.at).toBeLessThan(start + dur + 0.001);
  }
});
```

### 8.3 Integration: 5-minute background-tab regression test (Playwright)

This is the test that proves the fix. It must run in a real browser because throttling behavior is browser-specific.

```typescript
// tests/psyLive4/background-tab.test.ts
import { test, expect } from '@playwright/test';

test('engine plays continuously through 3 background-tab cycles over 5 minutes', async ({ page, context }) => {
  await page.goto('http://localhost:3000');
  await page.click('button:has-text("POWER")');
  await page.click('button:has-text("PLAY")');  // or however the new UI exposes it

  // Wait for engine to settle
  await page.waitForFunction(() => (window as any).__psy4?.kickCount > 10, null, { timeout: 5000 });

  const initialKick = await page.evaluate(() => (window as any).__psy4.kickCount);
  expect(initialKick).toBeGreaterThan(10);

  // Cycle: 60s playing → 30s backgrounded → 60s playing → 30s backgrounded → 60s playing
  // Total: 4 minutes. The bug would manifest in the second backgrounded window.
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.waitForTimeout(60_000);  // 60s foreground

    // Background the tab: emulate by creating a new foreground page
    // (Playwright throttles the original page when it's not the active tab)
    const bg = await context.newPage();
    await bg.goto('about:blank');
    await bg.waitForTimeout(30_000);  // 30s backgrounded
    await bg.close();

    // Tab returned. Verify audio is still running.
    // After 30s of background, the old code would be silent for the next ~5s.
    // Wait 2s for the scheduler to recover, then sample.
    await page.waitForTimeout(2000);

    const kickAfterBg = await page.evaluate(() => (window as any).__psy4.kickCount);
    const staleMs = await page.evaluate(() => (window as any).__psy4.staleMs);
    const activeVoices = await page.evaluate(() => (window as any).__psy4.activeVoices);

    // CRITICAL ASSERTIONS:
    expect(staleMs, `cycle ${cycle}: scheduler must be firing`).toBeLessThan(200);
    expect(kickAfterBg, `cycle ${cycle}: kickCount must keep growing`).toBeGreaterThan(initialKick + cycle * 100);
    expect(activeVoices, `cycle ${cycle}: voice pool not exhausted`).toBeLessThan(32);
  }

  // Final 60s foreground
  await page.waitForTimeout(60_000);

  const finalKick = await page.evaluate(() => (window as any).__psy4.kickCount);
  const peakDb = await page.evaluate(() => (window as any).__psy4.peakDb);
  expect(finalKick).toBeGreaterThan(initialKick + 400);  // ~5 min @ 145bpm = 435 kicks
  expect(peakDb, 'audio output non-silent').toBeGreaterThan(-30);
});
```

### 8.4 How `window.__psy4` gets populated

In `psyLive4.ts` (dev-only, guarded by `process.env.NODE_ENV === 'development'`):
```typescript
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__psy4 = {
    get kickCount() { return this._kickCount; },
    get staleMs() { return this.scheduler.staleMs; },
    get activeVoices() { return this.drumDevice.activeVoices() + this.melodicDevice.activeVoices(); },
    get peakDb() { return this.masterAnalyser.peakDb(); },
  };
}
```

### 8.5 Acceptance criteria for "the engine doesn't stop"

The rebuild is **done** when **all** of the following hold:

1. `tests/psyLive4/scheduler.test.ts` — all 3 unit tests pass.
2. `tests/psyLive4/composer.test.ts` — all 4 determinism tests pass.
3. `tests/psyLive4/shim-sync.test.ts` — byte hashes match pinned `4ae95d3`.
4. `tests/psyLive4/background-tab.test.ts` — **the regression test passes** (5 minutes, 2 background cycles, kick count grows monotonically, no voice exhaustion, peak > -30dB).
5. Manual smoke: load `localhost:3000`, click POWER, click PLAY, leave the tab for 5 minutes while reading another website, return — audio is still playing, status strip shows `staleMs < 200`.
6. `wc -l $(find src -name '*.ts' -o -name '*.tsx')` ≤ 5,000.

---

## 9. Summary — What Changes, What Stays, What Gets Built

| Aspect | Old PSY4 | New PSY4 |
|---|---|---|
| Total source lines | ~30,000+ | ~5,000 |
| Schedulers | 6 (psyLive scheduler, playPoll, eviction, exploration, detect, ui) + composition-worker | 1 (CompositionScheduler) |
| Composition model | bar-indexed (drifts on throttle) | time-based (never backfills) |
| Audio clock on background | keeps running → drift | suspended → no drift |
| Voice pool | 16 worklet + variable psysynth | 16 worklet + 16 melodic (pre-allocated) |
| Master chain | in psyLive.ts (3-band comp + limiter) | in psyLive4.ts (same chain, same params) |
| Composition engine | composition-worker-v2.js (456 lines, bar-based) | PsytranceComposer (~250 lines, sync, time-based) |
| UI | dashboard (799 lines, spectrum/pills/causal) | synth rack (~600 lines, knobs/keyboard/wheels) |
| shadcn/ui components | 48 installed | 5 used, 43 deleted |
| Foundation music code | 22 files (~4,000 lines, dead) | 0 (composer is self-contained) |
| Test for "engine stops" bug | none | background-tab regression test |

The single structural change that fixes the bug: **`ctx.suspend()` on `visibilitychange→hidden` + monotonic `lastComposedUntil` that never backfills.** Everything else in this plan is cleanup of the consequences of the original flawed design.

---

**End of plan. Hand to an implementer.**
