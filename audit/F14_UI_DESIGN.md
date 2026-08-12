# F14 — UI DESIGN DOCUMENT

**HEAD:** post-R6 · **Task:** R7 UI Full Rebuild

## 1. USER WORKFLOW

The user is a **psytrance performer/DJ** who wants to:
1. Start a groove (PLAY)
2. Direct the music musically (style, energy, tension)
3. Listen to a radio stream and have the engine complement it
4. Mix the engine's output against the radio
5. Apply FX (delay, reverb)
6. Monitor the current musical state

## 2. INFORMATION ARCHITECTURE

```
┌─────────────────────────────────────────────────┐
│ HEADER: PSY4 · BPM · KEY · SECTION · PHRASE · SYNC │
├─────────────────────────────────────────────────┤
│ TRANSPORT                                        │
│   ▶ Play / ■ Stop    Master VOL ────●────        │
├─────────────────────────────────────────────────┤
│ MUSIC DIRECTOR                                   │
│   Style: [FULL_ON] [DARK] [PROGRESSIVE] [ACID]  │
│   Energy ──●──   Density ──●──   Tension ──●──  │
│   (each with LOCK indicator: AUTO / LOCKED)      │
├─────────────────────────────────────────────────┤
│ RADIO                                            │
│   Station: [Psyndora ▾]  CONNECT  DISCONNECT     │
│   Status: FOLLOWING · BPM 163 · ●●●○○            │
│   Radio VOL ──●──                                │
├─────────────────────────────────────────────────┤
│ MIX                                              │
│   KICK ──●── M S    BASS ──●── M S              │
│   LEAD ──●── M S    HATS ──●── M S              │
│   (M = mute, S = solo)                           │
├─────────────────────────────────────────────────┤
│ FX                                               │
│   DELAY ──●──   FEEDBACK ──●──   REVERB ──●──   │
├─────────────────────────────────────────────────┤
│ VISUALIZER (frequency spectrum)                  │
├─────────────────────────────────────────────────┤
│ FOOTER: PSY4 · Musical Device · status line      │
└─────────────────────────────────────────────────┘
```

## 3. CONTROL MAPPING (every control → real runtime effect)

| Control | UI Element | psyLive Method | Runtime Effect | Proven By |
|---------|-----------|----------------|----------------|-----------|
| Play/Stop | Button | play()/stop() | Starts/stops scheduler | control-reality.ts |
| Master VOL | Slider | setVolume(v) | master.gain | control-reality.ts |
| Style | Button group | setStyle(s) | Changes kick/bass/hat grammar | musical-instrumentation.ts (R4-D) |
| Energy | Slider + Lock | setEnergy(v) / unlockEnergy() | ctx.energy (locked) | control-reality.ts (R2B) |
| Density | Slider + Lock | setDensity(v) / unlockDensity() | ctx.density (locked) | control-reality.ts |
| Tension | Slider + Lock | setTension(v) / unlockTension() | ctx.tension (locked) | control-reality.ts |
| Station | Select | (indirect, via connectRadio) | Picks stream URL | radio-wiring-reality.ts |
| Connect/Disconnect | Button | connectRadio()/disconnectRadio() | Opens/closes stream | radio-wiring-reality.ts |
| Radio VOL | Slider | setRadioVolume(v) | radioGain.gain | — |
| Kick/Bass/Lead/Hats VOL | Slider | setChannelVolume(ch, v) | bus.gain (user-owned) | control-reality.ts (R3) |
| Mute/Solo | Button | setChannelMute/Solo | muteGain node | control-reality.ts |
| Delay | Slider | setDelayAmount(v) | delaySend.gain | — |
| Feedback | Slider | setDelayFeedback(v) | delayFb.gain (clamped 0.85) | — |
| Reverb | Slider | setReverbSend(v) | reverbSend.gain | — |

## 4. DESIGN PRINCIPLES

- **Instrument aesthetic**: dark background, neon accents (cyan/magenta/pink/amber), NO indigo/blue
- **Responsive**: mobile-first, ≥44px touch targets, grids collapse on mobile
- **Sticky footer**: min-h-screen flex flex-col, footer mt-auto
- **No debug surfaces**: remove window.__psy4TransportDebug
- **Real-time feedback**: visualizer, status badge, level meters
- **shadcn/ui**: use Button, Slider, Card, Select, Switch, Badge, Separator

## 5. STATE REFLECTION

Every runtime state change must be visible in the UI:
- BPM changes (from Transport) → header BPM display
- Key changes (from radio pitch) → header KEY display
- Section changes (from composition arc) → header SECTION display
- Sync status changes → badge color + text
- Occupancy changes → radio band bars

## 6. REMOVED DEAD CONTROLS

- `window.__psy4TransportDebug` — removed
- Fake "role activity bars" (showed slider values, not audio) — removed
- Debug metrics as primary UI — moved to collapsed "Advanced" section (future)
