# F16 — MOBILE PROOF

**HEAD:** post-implementation · **Method:** Agent Browser at 390×844 (iPhone 13 size).

## MOBILE LAYOUT (390×844)

### Structure
```
┌─────────────────────────┐
│ STICKY TOP BAR          │
│ PSY4 ▶ 145 BPM A  IDLE  │
│ ──── Master VOL ────    │
├─────────────────────────┤
│ TIMELINE (8 blocks)     │
│ INTR STAT DEVE RESP     │
│ CONT DEVE CLIM RESO     │
│ Bar 1 · Phrase 0 · GROOVE│
├─────────────────────────┤
│ ENERGY  TENSION  STYLE  │
│ ──●──   ──●──   [F.ON]  │
│ AUTO    AUTO    AUTO     │
├─────────────────────────┤
│ BREAK BUILD DROP AUTO   │
├─────────────────────────┤
│ [visualizer 48px]       │
├─────────────────────────┤
│ RADIO                   │
│ IDLE  [Psyndora ▾] [Connect]│
│ Disconnected — connect  │
├─────────────────────────┤
│ ▼ Mix                    │
│ ▼ FX                     │
├─────────────────────────┤
│ STICKY BOTTOM BAR       │
│ ▶ 145 BPM · INTRO · IDLE│
└─────────────────────────┘
```

### VERIFIED
- **No horizontal overflow**: `document.body.scrollWidth` = 390 (= viewport width)
- **Sticky transport**: bottom bar always visible, Play/Stop + BPM + section + status
- **Touch targets**: timeline blocks = 44px min height, buttons = 40px min height
- **Collapsible sections**: Mix and FX in expandable sections (not always visible)
- **No desktop stacking**: layout is designed for mobile, not just narrow desktop

### SCREENSHOTS
- `audit/F16_mobile_playing.png` — playing state at 390×844

## DESKTOP LAYOUT (1440×900)

### Structure
```
┌──────────────────────────────────────────────────┐
│ STICKY TOP BAR                                    │
│ PSY4 ▶ 145 BPM A  IDLE    [master vol slider]    │
├──────────────────────────────────────────────────┤
│ TIMELINE (8 blocks, full width)                   │
│ INTR  STAT  DEVE  RESP  CONT  DEVE  CLIM  RESO   │
│ Bar 1 · Phrase 0 · GROOVE         Cycle 1        │
├──────────────────────────────────────────────────┤
│ ENERGY    TENSION    STYLE                        │
│ ──●──     ──●──     [F.ON][DARK][PROG][ACID]     │
│ AUTO      AUTO      AUTO                          │
├──────────────────────────────────────────────────┤
│ BREAK  BUILD  DROP  AUTO                          │
├──────────────────────────────────────────────────┤
│ [visualizer 48px]                                 │
├──────────────────────────────────────────────────┤
│ RADIO  IDLE  [Psyndora ▾] [Connect]              │
│ BASS adapting | LEAD creating space | GROOVE following│
├──────────────────────────────────────────────────┤
│ ▼ Mix   ▼ FX                                      │
└──────────────────────────────────────────────────┘
```

### VERIFIED
- Max width 6xl (1152px) — uses desktop space without wasting
- Timeline is primary (full width, prominent)
- Mix/FX are secondary (collapsible, below the fold)
- No scroll required for primary controls (transport + timeline + macros + arrangement + radio)

### SCREENSHOTS
- `audit/F16_desktop_idle.png` — idle state at 1440×900
- `audit/F16_desktop_playing.png` — playing state at 1440×900
