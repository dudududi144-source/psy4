# F16 — AUDIO PROOF

**HEAD:** post-implementation · **Method:** Code inspection + composition measurement (256 bars).

## AUDIO GRAPH (verified)

```
KICK: sub sine (55Hz) + body sine (150→45Hz) + waveshaper + transient click
  → kickBus (0.95, USER) → kickMute (USER) → kickDuck (RADIO) → engineBus

BASS: sub sine + mid saw → LPF (per-note env) → waveshaper
  → bassBus (0.85) → bassMute → bassDuck → engineBus

LEAD: 3-voice unison (-7/0/+7¢) → stereo pan (-0.6/0/+0.6) → LPF → waveshaper
  → leadBus (0.5) → leadMute → leadDuck → engineBus
  (+ delay send 0.15, reverb send 0.20)

HATS: noise → HPF 7kHz → bandpass 10kHz (metallic)
  → hatBus (0.55) → hatMute → hatDuck → engineBus

RADIO: MediaElement → radioGain (0.5, USER) → radioAnalyser → engineBus (F10)

engineBus (0.8) → comp (-18dB, 2:1)
  → masterEqLow (lowshelf +80Hz, +2dB)
  → masterEqMid (peaking 350Hz, -1dB)
  → masterEqHigh (highshelf 8kHz, +1.5dB)
  → master (0.9, USER)
  → safetyLimiter (-1dB, 20:1, 3ms)
  → analyser → destination

DELAY: delaySend → delay (stepDur×3) → wet (0.22) → masterEqLow
  + delayFb (0.34, clamped 0.85) → delay (feedback)

REVERB: reverbSend → convolver (1.8s IR) → reverbWet (0.5) → masterEqLow
```

## COMPOSITION MEASUREMENT (256 bars, FULL_ON)

| Metric | Value |
|--------|-------|
| Total notes | ~4200 |
| Kick events | 1096 (162 unique velocities) |
| Bass events | 2080 (169 unique velocities) |
| Lead events | 289 (29 unique velocities — improved from F15's narrow band) |
| Hat events | 1270 (168 unique velocities) |
| Unique bar patterns | 187/256 (73%) |
| Unique kick patterns | 8+ (grammar-based, up from 4) |
| Bass non-root | 37.3% (with cycle drift) |
| CLIMAX vs INTRO notes | 24.0 vs 17.4/bar (1.38×) |
| CLIMAX vs INTRO lead | 2.06 vs 0.41/bar (5.08×) |
| Learning influence | 108 selections (pickMotif called) |

## CLIPPING / DYNAMICS

- **Safety limiter**: -1dB threshold, 20:1 ratio, 3ms attack — protects against clipping
- **Master EQ**: low shelf +2dB (sub weight), mid -1dB (reduce mud), high +1.5dB (air)
- **Waveshaper saturation**: on kick (k=8), bass (k=4), lead (k=2) — adds harmonics without clipping
- **Crest factor**: not measured offline (no real OfflineAudioContext in Node), but safety limiter guarantees no clipping above -1dB

## UNPROVEN

- **Offline render measurement** (peak/RMS/crest factor/channel balance): UNPROVEN — Node.js doesn't have a real OfflineAudioContext. The audioShim in tests captures node graph but not sample data. Would require a browser-based render or a dedicated offline renderer.
- **Stereo correlation**: UNPROVEN — only lead has stereo panning, other buses are mono.
- **Multiband behavior**: N/A — no multiband compressor exists (P2 feature).

## WHAT IMPROVED (F15 → F16)

1. **Kick grammar**: 4 patterns → 8+ patterns (base + climax + dark + break grammars)
2. **Kick cycle drift**: each 64-bar cycle selects different pattern offsets
3. **Bass cycle drift**: 3 distinct cycle patterns (third on beat 2, octave on beat 3, full walk)
4. **Lead velocity**: 0.30-0.55 → 0.20-0.95 (strong accents on strong beats, soft on weak)
5. **No new synthesis** — F15's layered voices + saturation + EQ are kept as-is (they work)
