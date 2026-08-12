# F16 — PRODUCT DESIGN

**HEAD:** post-implementation · **Principle:** One coherent musical instrument, not a panel collection.

## PRODUCT DEFINITION

PSY4 is a live generative music instrument / radio-aware performance environment.

The user's mental model:
```
PLAY → observe structure → shape energy/tension → influence arrangement → respond to radio → mix → hear evolving composition
```

## INFORMATION ARCHITECTURE

### PRIMARY (always visible, no scroll)
1. **Transport** — Play/Stop, BPM, KEY, Master volume (sticky top bar)
2. **Timeline** — 8 section blocks, playhead, phrase progress, bar position, cycle
3. **Performance macros** — Energy, Tension, Style (with AUTO/LOCK)
4. **Arrangement triggers** — BREAK, BUILD, DROP, AUTO
5. **Radio** — status, adaptation display, connect/disconnect

### SECONDARY (collapsible)
6. **Mix** — 4 horizontal channel strips (collapsible)
7. **FX** — Echo, Feedback, Space (collapsible)

### MOBILE
- Sticky bottom transport bar (Play/Stop + BPM + section + status)
- Timeline is primary (horizontal blocks)
- Mix/FX in collapsible sections
- No horizontal overflow (verified: scrollWidth = viewport width)

## VISUAL LANGUAGE

- **Background**: #0a0612 (dark, not pure black)
- **Primary accent**: #00ffc8 (cyan — energy, transport, timeline)
- **Secondary accents**: #ff2e88 (pink — tension), #b967ff (purple — style), #f59e0b (amber — radio)
- **Type**: 10px labels, 9px values, 8px micro — consistent scale
- **Spacing**: 2px / 6px / 12px — consistent system
- **No cards** — sections are bordered surfaces with subtle backgrounds
- **No gradients** except PSY4 logo
- **No decorative elements** — visualizer only when playing, compact (48px)

## CONTROL MAPPING (every control → real effect)

| Control | Effect | Proven By |
|---------|--------|-----------|
| Play/Stop | scheduler start/stop | control-reality.ts |
| Master VOL | master.gain | — |
| Energy | ctx.energy (locked) → lead density | control-reality.ts |
| Tension | ctx.tension (locked) → lead density + hat vel | control-reality.ts |
| Style | kick/bass/hat grammar | musical-instrumentation.ts |
| BREAK | kick+bass only for 4 bars | arrangement API |
| BUILD | ramp lead density over 4 bars | arrangement API |
| DROP | force 0.75 lead density | arrangement API |
| AUTO | release forced section | arrangement API |
| Timeline click | forceSection(name) | arrangement API |
| Radio Connect | connectRadio → markConnected | radio-wiring-reality.ts |
| Radio VOL | radioGain.gain | — |
| Channel VOL | bus.gain (user-owned) | control-reality.ts (R3) |
| Mute/Solo | muteGain node | control-reality.ts |
| Echo | delaySend.gain | — |
| Feedback | delayFb.gain (clamped 0.85) | — |
| Space | reverbSend.gain | — |

## REMOVED ELEMENTS

- Visualizer when stopped (was 60fps RAF, now only when playing)
- Kick count metric (dead — not useful)
- Role readout as single word (replaced with bar/phrase/cycle context)
- `getTransportDebug` 20+ field polling (now fetches only 8 fields)
- Radio band meters (replaced with musical interpretation: "BASS adapting")
- Dead LiveState fields from UI (learned, mixMode, harmonicLocked, compositionMode)
