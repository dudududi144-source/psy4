# F13 — UI FORENSIC AUDIT

**HEAD:** `017ef70` (F11) · **Scope:** `src/app/page.tsx` (290 lines — the ENTIRE UI) + traced dependencies.

---

## 1. IMPORT GRAPH

`page.tsx:3-4` — the complete import list:
```ts
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PsyLive, LiveState, STREAMS } from '@/lib/psyLive';
```

**page.tsx imports ZERO components from `src/components/`.** The entire 50-file shadcn/ui library is unused. Two inline components defined:
- `Metric` (lines 271-278) — label/value tile
- `SliderControl` (lines 280-290) — label + range input + percentage

`layout.tsx:4` imports `Toaster` from `@/components/ui/toaster`, but `useToast()` is never called by page.tsx → Toaster renders nothing.

---

## 2. CONTROL-BY-CONTROL AUDIT

### 2.1 TRANSPORT (lines 149-176)

| # | Control | UI State | Function | Runtime Owner | Audio Effect | Class |
|---|---------|----------|----------|---------------|--------------|-------|
| 1 | ▶ Play / ■ Stop | `s.playing` | `engine.play()` / `.stop()` | psyLive + Transport | ✅ Starts/stops scheduler → voices → buses → master | **LIVE** |
| 2 | VOL slider | `vol` (0.9) | `engine.setVolume(v)` → master.gain | psyLive.master | ✅ Scales master output | **LIVE** |
| 3 | Canvas visualizer | reads `analyserNode` + `radioAnalyserNode` | requestAnimationFrame drawing 64 bars | psyLive.analyser (post-master) + radioAnalyser (pre-engineBus) | ❌ Read-only display | **DECORATIVE** |
| 4 | Role activity bars KICK/BASS/PERC/LEAD/FX | `channelVols`, `delayAmt`, `reverbSend` | Pure UI: `FX = delay*0.5 + reverb*0.5` | local React state ONLY | ❌ Shows slider positions, NOT actual bus gains. When radio on, detect() clobbers gains but bars show user intent. | **FAKE** |

### 2.2 MUSIC (lines 178-209)

| # | Control | UI State | Function | Runtime Owner | Audio Effect | Class |
|---|---------|----------|----------|---------------|--------------|-------|
| 5 | STYLE buttons (FULL_ON/DARK/PROGRESSIVE/ACID) | `style` local, `styleName` from sessionSnap | `engine.setStyle(st)` → `(session as any).style = st` | MusicalSession.style (private, mutated via `as any`) | ❌ `session.style` NEVER READ by generateKick/Bass/Hats/Lead. Only metadata. detectStyle() overwrites every 200ms when radio on. UI highlight follows engine, not user click. | **BROKEN** |
| 6 | ENERGY slider (0.5) | `energy` | `engine.setEnergy(v)` → `(session.getContext() as any).energy = v` | **BROKEN** — MusicalSession has no getContext() | ❌ TypeError thrown. ctx.energy overwritten by updateFromRadio every 200ms. Never read by generators. | **DEAD** |
| 7 | DENSITY slider (0.6) | `density` | `engine.setDensity(v)` → same broken pattern | **BROKEN** | ❌ TypeError. ctx.density only affects phrase reward bookkeeping. Never read by generators. | **DEAD** |
| 8 | TENSION slider (0.3) | `tension` | `engine.setTension(v)` → same broken pattern | **BROKEN** | ❌ TypeError. ctx.tension IS read by lead density/velocity, but updateFromTransport reverts toward arc target every bar. | **BROKEN** |
| 9 | ROLE/MOTIFS/TENSION text readout | `sessionSnap` | Display only | MusicalSession snapshot | ❌ Display | **DISPLAY** |

### 2.3 MIX (lines 211-220)

| # | Control | UI State | Function | Runtime Owner | Audio Effect | Class |
|---|---------|----------|----------|---------------|--------------|-------|
| 10 | KICK slider (0.95) | `channelVols.kick` | `engine.setChannelVolume('kick', v)` → kickBus.gain | psyLive.kickBus | ⚠️ Radio OFF: ✅ LIVE. Radio ON: detect() line 870-871 clobbers to 0.05/0.9 every 200ms. | **BROKEN** (radio on) |
| 11 | BASS slider (0.85) | `channelVols.bass` | → bassBus.gain | psyLive.bassBus | ⚠️ Same clobbering (872-873) | **BROKEN** (radio on) |
| 12 | LEAD slider (0.5) | `channelVols.lead` | → leadBus.gain | psyLive.leadBus | ⚠️ Same clobbering (874-875) | **BROKEN** (radio on) |
| 13 | HATS slider (0.55) | `channelVols.hat` | → hatBus.gain | psyLive.hatBus | ⚠️ detect() line 876 forces to 0.6 (constant, ignores user AND occupancy) | **BROKEN** (radio on) |

### 2.4 FX (lines 222-230)

| # | Control | UI State | Function | Runtime Owner | Audio Effect | Class |
|---|---------|----------|----------|---------------|--------------|-------|
| 14 | DELAY slider (1.0) | `delayAmt` | `engine.setDelayAmount(v)` → delaySend.gain | psyLive.delaySend | ✅ Real delay wet control. Not clobbered. (Effective wet = v × 0.22) | **LIVE** |
| 15 | FEEDBACK slider (0.34) | `delayFb` | `engine.setDelayFeedback(v)` → delayFb.gain | psyLive.delayFb | ✅ Real feedback control. Not clobbered. (No safety clamp — 100% howl risk) | **LIVE** |
| 16 | REVERB slider (0.15) | `reverbSend` | `engine.setReverbSend(v)` → reverbSend.gain | psyLive.reverbSend | ✅ Real reverb send. Not clobbered. (Effective wet = v × 0.5) | **LIVE** |

### 2.5 RADIO (lines 232-259)

| # | Control | UI State | Function | Runtime Owner | Audio Effect | Class |
|---|---------|----------|----------|---------------|--------------|-------|
| 17 | Stream `<select>` | `streamId` ('psyndora') | `setStreamId(e.target.value)`, disabled when radioOn | local React state | ✅ Indirect — read by connectRadio() on next Connect | **LIVE** |
| 18 | CONNECT button | `s.radioOn` | `connectRadio()` → engine.connectRadio(stream) | psyLive radio chain | ✅ Opens stream, routes through engineBus. (Follower dead, but audio works.) | **LIVE** |
| 19 | DISCONNECT button | `s.radioOn` | `disconnectRadio()` → engine.disconnectRadio() | psyLive radio chain | ✅ Silences radio, transport holdover | **LIVE** |
| 20 | Radio VOL slider (0.5) | `radioVol` | `engine.setRadioVolume(v)` → radioGain.gain.value = v | psyLive.radioGain | ✅ Scales radio level. (Uses .value= not setTargetAtTime — clicks on rapid drag) | **LIVE** |
| 21 | LOW/MID/HIGH/KICKS readout | `s.radioBands`, `s.kickCount` | Display only | psyLive radio observer | ❌ Display | **DISPLAY** |

### 2.6 HEADER + FOOTER

| # | Control | UI State | Function | Class |
|---|---------|----------|----------|-------|
| 22 | BPM metric | `s.engineBpm` | Display from transport.snapshot().bpm | **DISPLAY** |
| 23 | KEY metric | `s.bassNote` | Display from freqToNote(bassFreq). bassFreq NEVER ASSIGNED → always '—' | **DEAD** |
| 24 | Sync status badge | `s.syncStatus` | 5-state badge. Only 3 states reachable (idle/connecting/no_signal). 'listening'/'following' UNREACHABLE. | **DISPLAY** (broken) |
| 25 | SECTION metric | `sessionSnap.sessionSection` | Display from session.snapshot() | **DISPLAY** |
| 26 | PHRASE metric | `sessionSnap.sessionPhrase` | Display | **DISPLAY** |
| 27 | Footer status | `s.radioOn`, `s.playing`, `styleName` | Display | **DISPLAY** |

---

## 3. CLASSIFICATION TALLY

| Class | Count | Controls |
|-------|-------|----------|
| **LIVE** (always) | 9 | Play/Stop, VOL, DELAY, FEEDBACK, REVERB, CONNECT, DISCONNECT, Radio VOL, Stream select |
| **BROKEN** | 5 | KICK/BASS/LEAD/HATS (clobbered when radio on), TENSION (TypeError + arc revert), STYLE (label-only + overwritten) |
| **DEAD** | 3 | ENERGY (TypeError), DENSITY (TypeError), KEY metric (bassFreq never assigned) |
| **FAKE** | 1 | Role activity bars (show slider values, not audio) |
| **DECORATIVE** | 1 | Canvas visualizer (read-only) |
| **DISPLAY** | 8 | BPM, SECTION, PHRASE, sync badge, LOW/MID/HIGH, KICKS, ROLE/MOTIFS/TENSION, footer |

**Effective playable controls: 9 live + 4 conditionally-live (mixer when radio off) = 13.**
**Non-functional or misleading: 9 (5 broken + 3 dead + 1 fake).**

---

## 4. STRUCTURAL AUDIT

### 4.1 Layout
- **Header** (line 136): `PSY4` gradient title + 4 metric tiles + sync badge. `flexWrap: 'wrap'`.
- **Main** (line 147): `maxWidth: 960, margin: '0 auto'`, vertical stack of 5 cards:
  1. Transport + Visualizer
  2. Music (Style + Energy + Density + Tension)
  3. Mix (Kick/Bass/Lead/Hats)
  4. FX (Delay/Feedback/Reverb)
  5. Radio (Stream + Connect + Vol + bands)
- **Footer** (line 263): status line.

### 4.2 Sticky footer ✅
- Line 134: `minHeight: '100dvh', display: 'flex', flexDirection: 'column'` — equivalent to `min-h-screen flex flex-col`.
- Footer line 263: `marginTop: 'auto'` — sticky to bottom via flex push-down.
- **Compliant with project rules.**

### 4.3 Instrument vs. Dashboard — HYBRID (leans dashboard)
**Instrument signals:**
- Footer: `"PSY4 · Musical Device"` (line 264)
- Play button: `▶`/`■` glyphs with gradient (lines 153-155)
- H1: `linear-gradient(90deg,#00ffc8,#b967ff,#ff2e88)` text clip (line 137)
- Neon slider accents, rounded "pill" transport buttons (`borderRadius: 999`)

**Dashboard signals:**
- 5-state sync badge (IDLE/CONNECTING/NO_SIGNAL/LISTENING/FOLLOWING)
- LOW/MID/HIGH percentage readouts
- KICKS counter
- ROLE/MOTIFS/TENSION text row
- `window.__psy4TransportDebug` global debug function (line 50) exposing 20+ internal fields
- 200ms polling of `getTransportDebug()` returning transport/radio/session internals

**Verdict:** The UI is a **dashboard wearing an instrument costume**. The visual styling says "musical device" but the information architecture says "debug monitor."

### 4.4 Forbidden colors — 4 VIOLATIONS
Project rules forbid indigo/blue:
1. **Line 9:** `connecting: { color: '#3b82f6' }` — Tailwind **blue-500** (CONNECTING badge)
2. **Line 226:** `<SliderControl ... color="#3b82f6" />` — blue-500 (DELAY slider)
3. **Line 227:** `<SliderControl ... color="#8b5cf6" />` — Tailwind **violet-500** (indigo-adjacent, FEEDBACK slider)
4. **Line 228:** `<SliderControl ... color="#06b6d4" />` — Tailwind **cyan-500** (blue-adjacent, REVERB slider)

### 4.5 Responsiveness — POOR
- Header: `flexWrap: 'wrap'` ✅
- Music grid: `repeat(auto-fill, minmax(180px, 1fr))` ✅
- **Mix grid: `repeat(4, 1fr)` — FIXED 4 columns.** On 360px phone → 80px/column, labels at fontSize 9 are illegible.
- **FX grid: `repeat(3, 1fr)` — FIXED 3 columns.** Same issue.
- **Touch targets violate 44px minimum:** Style buttons `padding: 6px 10px` → ~24px. Connect/Disconnect → ~24px. Stream select → ~24px. Native `<input type="range">` → ~16px. Only Play/Stop (`padding: 12px 40px`) approaches 44px.
- Main `maxWidth: 960` — no breakpoint-based adaptation.

### 4.6 UI ↔ Engine state sync — DESYNCED
- **Energy/Density/Tension sliders** are local React state. When engine overwrites ctx.energy/density (via updateFromRadio, every 200ms) or ctx.tension (via updateFromTransport, every bar), **sliders do NOT move**. TENSION text readout shows engine's actual tension while slider stays at user's last input — visible contradiction.
- **Style button highlight** follows `sessionSnap.sessionStyle` (engine-detected), not user's click. User clicks DARK, engine detects FULL_ON → FULL_ON button highlights instead.
- **Mixer sliders** stay at user's position while detect() clobbers the actual bus gains. Bars show intent, audio uses ducked values.
- BPM/SECTION/PHRASE/sync badge correctly reflect runtime via polling. ✅

---

## 5. UI → psyLive METHOD VERIFICATION

Every `engineRef.current?.<method>()` call verified against psyLive.ts:

| Call site | Method | Exists? | Does what name implies? |
|-----------|--------|---------|-------------------------|
| play() :66 | play() :533 | ✅ | ✅ Starts transport + scheduler |
| stop() :67 | stop() :547 | ✅ | ✅ Clears timers |
| connectRadio(stream) :74 | connectRadio(stream) :731 | ✅ | ⚠️ Audio works, follower dead |
| disconnectRadio() :77 | disconnectRadio() :769 | ✅ | ✅ |
| setVolume(v) :159 | setVolume(v) :570 | ✅ | ✅ master.gain |
| setStyle(st) :187 | setStyle(st) :595 | ✅ | ❌ Writes display-only field, overwritten by detectStyle |
| setEnergy(v) :198 | setEnergy(v) :603 | ✅ | ❌ **TypeError: getContext() not a function** |
| setDensity(v) :200 | setDensity(v) :607 | ✅ | ❌ **TypeError** |
| setTension(v) :202 | setTension(v) :611 | ✅ | ❌ **TypeError** |
| setChannelVolume(ch,v) :215-218 | setChannelVolume(ch,v) :576 | ✅ | ⚠️ Clobbered by detect() when radio on |
| setDelayAmount(v) :226 | setDelayAmount(v) :582 | ✅ | ✅ delaySend.gain |
| setDelayFeedback(v) :227 | setDelayFeedback(v) :586 | ✅ | ✅ delayFb.gain |
| setReverbSend(v) :228 | setReverbSend(v) :590 | ✅ | ✅ reverbSend.gain |
| setRadioVolume(v) :249 | setRadioVolume(v) :789 | ✅ | ✅ radioGain.gain (immediate, not smoothed) |

**All 14 called methods exist.** 7 do what they imply (LIVE), 4 are clobbered (BROKEN), 3 throw TypeError (DEAD).

**Methods on psyLive NOT called by page.tsx (dead from UI):** `setPreset`, `setVariant`, `toggleComposition`, `hasSavedComposition`, `getPresets`, `getPreset`, `getVariant`, `getMusicState`, `getMelodyObservations`, `getRecentMelody`, `getTransport`.

---

## 6. DEBUG SURFACES EXPOSED TO USER

1. **`window.__psy4TransportDebug`** (line 50) — global function exposing `engine.getTransportDebug()`. Returns 20+ fields: transportBpm/Beat/Bar/Phase/Epoch/Confidence/Locked/Source, schedulerBeat/Bar/Epoch/LastScheduledStepIndex, radioState/observationState/observationCount/lastObservationTime/rms/confidence, sessionStyle/Role/Action/Section/Phrase/Tension/Density/MotifCount/Reason/hasLearned/lastReward.
2. **200ms polling** (lines 57-64) — populates sessionSnap driving SECTION/PHRASE/ROLE/MOTIFS/TENSION displays.
3. **LOW/MID/HIGH/KICKS readout** — radio band occupancy + kick counter.
4. **5-state sync badge** — only 3 states reachable.
5. **ROLE/MOTIFS/TENSION text row** — session internals.

---

## 7. TEST COVERAGE OF UI

Grep'd `tests/` for all 10 setter methods:

| Method | Test calls |
|--------|-----------|
| setStyle | **0** |
| setEnergy | **0** |
| setDensity | **0** |
| setTension | **0** |
| setChannelVolume | **0** |
| setDelayAmount | **0** |
| setDelayFeedback | **0** |
| setReverbSend | **0** |
| setVolume | **0** |
| setRadioVolume | **0** |

**Zero tests prove that pressing any UI control changes what sound comes out.** No React Testing Library renders of page.tsx exist.

---

## 8. PRODUCT AUDIT — WHAT THE USER NEEDS

The user wants a **musical instrument + performance workstation**, not a debug dashboard. They need to control:

| Need | Current state | Gap |
|------|--------------|-----|
| **TRANSPORT** (play/stop/bpm) | ✅ Play/Stop work. BPM is display-only (no tap tempo, no manual override). | No BPM control, no tap tempo |
| **MUSICAL DIRECTION** (style/key/energy/density/tension) | ❌ All 4 controls broken or dead. Style is label-only. Energy/Density throw TypeError. Tension is TypeError + arc-reverted. | Entire section is theatrical |
| **ARRANGEMENT** (section/phrase/scene) | Display-only. No way to jump to a section, trigger a break, or force a climax. | No arrangement control |
| **RADIO** (station/connect/status) | ✅ Connect/Disconnect work. Stream select works. 3/6 stations dead. Follower dead. | No station health, no follower feedback |
| **MIX** (per-bus volume/mute/solo) | ⚠️ Sliders work when radio off, clobbered when on. No mute. No solo. | No mute/solo, clobbered by ducking |
| **FX** (delay/reverb/filter/drive) | ⚠️ Delay + Feedback + Reverb work. No filter cutoff control. No drive. No width. | Missing filter, drive, width |
| **PERFORMANCE** (real-time macros) | ❌ No performance macros. No scene recall. No parameter locking. | Entirely missing |

---

## 9. TARGET UI INFORMATION ARCHITECTURE

```
MAIN PERFORMANCE
├── Transport (Play/Stop, BPM, Tap)
├── Musical Direction (Style, Key, Energy, Density, Tension) ← MUST BE REAL
├── Scene / Arrangement (Section jump, Break trigger, Climax)
├── Radio (Station, Connect, Status, Volume)
└── Current Musical State (BPM, Key, Section, Phrase, Sync)

MIX
├── Kick (Volume, Mute, Solo)
├── Bass (Volume, Mute, Solo)
├── Perc (Volume, Mute, Solo)
├── Lead (Volume, Mute, Solo)
├── Radio (Volume, Mute, Solo)
└── Master (Volume, Limiter)

FX
├── Filter (Cutoff, Resonance)
├── Delay (Time, Feedback, Mix)
├── Reverb (Size, Damping, Mix)
├── Drive (Amount, Tone)
└── Width (Stereo)

ADVANCED
└── Diagnostics (collapsed by default)
```

**Design principles:**
- Performance-oriented layout (transport + direction front and center)
- Clear current state (always-visible BPM/Key/Section/Sync)
- Fast access to key actions (Play, Connect, Scene)
- Musical macros (not per-note MIDI)
- Real-time feedback (visualizer, level meters)
- Responsive (mobile-first, ≥44px touch targets)
- Premium electronic instrument aesthetic (not admin dashboard)
- NO indigo/blue colors
- NO debug metrics as primary UI
- NO `window.__psy4TransportDebug` in production

---

## 10. VERDICT

The UI is a **290-line single-file dashboard** with:
- 9 working controls (transport + FX + radio connect)
- 9 broken/dead controls (musical direction + mixer)
- 1 fake display (role activity bars)
- 8 display-only metrics
- 4 forbidden color violations
- Poor mobile responsiveness
- Zero test coverage
- 50-file shadcn library completely unused
- Debug surface permanently exposed

The UI does NOT need to be "redesigned." It needs to be **rebuilt from the user workflow**, with every control traced to a real runtime effect, and every runtime state correctly reflected back to the user.
