# COMMERCIAL SOUND BANK AUDIT — PSY4

## תאריך: 2026-08-08
## מבוסס על: ניתוח PSY3 samples + ניתוח PSY4 synthesis + signal flow mapping

---

## 1. PSY3 SOUND ASSET INVENTORY

### Audio Assets Found

| File | Duration | SR | Ch | Peak | RMS | Crest | Centroid | Purpose | Usable? |
|------|----------|----|----|------|-----|-------|----------|---------|---------|
| kick.wav | 0.280s | 44100 | 1 | 1.000 | 0.319 | 3.13 | 111Hz | Drum kick | **YES — use directly** |
| bass_A.wav | 0.180s | 44100 | 1 | 0.675 | 0.200 | 3.38 | 821Hz | Bass note | **YES — use as layer** |
| lead.wav | 0.300s | 44100 | 1 | 0.274 | 0.052 | 5.27 | 7789Hz | Lead note | **YES — use as layer** |
| hat_closed.wav | 0.060s | 44100 | 1 | 1.000 | 0.331 | 3.02 | 13963Hz | Closed hat | **YES — use directly** |
| hat_open.wav | 0.300s | 44100 | 1 | 1.000 | 0.390 | 2.57 | 13987Hz | Open hat | **YES — use directly** |
| clap.wav | 0.250s | 44100 | 1 | 1.000 | 0.374 | 2.67 | 11009Hz | Clap | **YES — use directly** |

### Spectral Profiles

**kick.wav:** 93.6% sub (20-60Hz), 1.3% low, 4.8% body — **pure sub kick, almost no high content**
**bass_A.wav:** 72.6% sub, 18.9% low, 6.0% body — **deep bass with controlled harmonics**
**lead.wav:** 63.1% lowmid (250-500Hz), 16.8% mid — **warm lead, not harsh**
**hat_closed.wav:** 21.3% high, 22.3% air — **bright hat, properly distributed**
**hat_open.wav:** 19.5% high, 21.3% air — **similar to closed but longer decay**
**clap.wav:** 28.5% low, 22.1% body, 13.8% lowmid — **warm clap with body**

### Design Principles Extracted from PSY3 Samples

1. **Kick = 93.6% sub** — the kick is almost entirely sub-frequency. No click, no mid-punch. Just pure low-end power. PSY4 kick has 53% low — half of PSY3's power.

2. **Bass = 91.5% sub+low** — the bass is deeply rooted in low frequencies. Only 8.5% is above 120Hz. PSY4 bass has 46% low — barely half.

3. **Lead = 63.1% lowmid** — the lead lives in 250-500Hz, NOT in high frequencies. PSY4 lead has 92% high — completely wrong register.

4. **Hats = 43.6% high+air** — hats are properly bright but not harsh. Balanced distribution above 5kHz.

5. **Clap = 50.6% sub+low+body** — the clap has significant low-frequency body. Not just high-frequency noise.

6. **All samples are normalized to peak 1.0** (except bass and lead which are lower) — PSY3 samples are louder than PSY4 synthesis.

---

## 2. WHY THE CURRENT SOUND BANK SOUNDS CHEAP

### A. Every Voice is the Same Architecture

Every PSY4 voice follows: `oscillator → BiquadFilter → GainNode → sum`

There is no:
- FM synthesis (except in texture())
- Ring modulation
- Wavetable interpolation
- Comb filtering
- Feedback networks
- Parallel processing paths
- Sample layering
- Hybrid sample+synthesis

**A commercial synth has multiple synthesis architectures. PSY4 has one.**

### B. No Sound Identity System

Every kick sounds the same. Every bass sounds the same. Every lead sounds the same.
There is no way to select "dark aggressive kick" vs "tight club kick" — there is only one kick function with slightly different parameters per world.

**A commercial drum machine has 20+ kick variations. PSY4 has 1.**

### C. No Channel Gain Staging in Live Engine

All voices connect directly to `this.sum` with no intermediate gain stage.
There is no hierarchy: kick and pad are at the same level.
There is no headroom management.

**A commercial mix has -2dB to -14dB channel gains. PSY4 live has 0dB everywhere.**

### D. No Production Processing Per Voice

No per-voice compression. No per-voice saturation (except bass/acid). No per-voice EQ.
Just oscillator → filter → gain → sum.

**A commercial production processes each voice individually before it hits the bus.**

### E. The Filter is Sterile

BiquadFilter (native Web Audio) has no character. No saturation. No warmth.
PSY3 uses Moog-style filter with tanh saturation in the feedback loop.
PSY4 offline engine has MoogLadder — but the live engine doesn't use it.

**A commercial synth filter adds harmonics and character. PSY4's filter removes them.**

### F. No Articulation

No velocity→cutoff mapping. No velocity→amp mapping. No accent. No portamento.
Every note at the same velocity sounds identical.

**A commercial instrument responds to performance. PSY4 doesn't.**

---

## 3. VOICE-BY-VOICE VERDICT

| Voice | Current State | Usable? | Action |
|-------|--------------|---------|--------|
| **Kick** | 3-layer synth (sub+mid+click+sat). Still too quiet. Click too prominent. | **Salvageable** | Add PSY3 sample as base layer + synthetic sub + click on top |
| **Bass** | Saw+sub through LP+saturation. Cutoff now 150Hz. Better but still thin. | **Salvageable** | Add PSY3 bass sample as character layer + synthetic sub |
| **Lead** | 5-osc supersaw through BiquadFilter. Sterile filter. Too bright. | **Needs rebuild** | Lower cutoff, add Moog-style filter, add velocity response, add articulation |
| **Acid** | Square through resonant LP + distortion. Decent. | **Usable** | Add pattern identity, add slide/portamento |
| **Pad** | 2 detuned oscs + LFO evolve. Still too quiet. | **Needs rebuild** | Double amplitude, add chorus, add filter movement |
| **Hat** | 4 metallic squares + noise. Good architecture. | **Usable** | Add per-hit variation (pitch/decay/tone) |
| **Clap** | 4-burst multi-hit. Good architecture. | **Usable** | Add per-hit variation |
| **Perc** | Triangle osc with pitch drop. Basic. | **Salvageable** | Add noise component, add variation |
| **Shaker** | Noise through HP. Basic. | **Usable** | Add per-hit variation |
| **Texture** | FM/wavetable/noise. Good architecture. | **Usable** | Make continuous (not just every 4 bars) |
| **Riser** | Noise through BP sweep. Basic. | **Usable** | Add harmonic content (saw sweep) |
| **Impact** | Sine pitch drop. Basic. | **Usable** | Add noise burst component |
| **Zap** | FM. Good. | **Usable** | Keep |
| **Blip** | Sine. Basic but intentional. | **Usable** | Keep |
| **Downlifter** | Saw pitch drop. Basic. | **Usable** | Keep |

---

## 4. WHAT PSY3 SOUNDS MUST ENTER PSY4 DIRECTLY

### Priority 1: Direct Sample Usage

| PSY3 Sample | Why Use It | How to Use | Priority |
|-------------|-----------|------------|----------|
| **kick.wav** | 93.6% sub, peak 1.0, normalized — far better than PSY4 synth kick | Use as base layer + synthetic click on top | **P0** |
| **hat_closed.wav** | Proper metallic character, 60ms, normalized | Use directly for closed hats | **P0** |
| **hat_open.wav** | Proper metallic character, 300ms, normalized | Use directly for open hats | **P0** |
| **clap.wav** | Warm clap with body, 250ms, normalized | Use directly for claps | **P0** |
| **bass_A.wav** | Deep bass with controlled harmonics, 180ms | Use as character layer + synthetic sub | **P1** |
| **lead.wav** | Warm lead in 250-500Hz range, 300ms | Use as reference for lead filter cutoff | **P1** |

### Priority 2: Design Principles to Adopt

| Principle | From PSY3 | PSY4 Current | Action |
|-----------|-----------|-------------|--------|
| Kick = 93% sub | Pure low-end, no harshness | 53% low, 4.8% high (after rebuild) | Still needs more sub, less click |
| Bass = 91% sub+low | Deep, controlled | 46% low (before rebuild), improved but not enough | Continue improving sub level |
| Lead = 63% lowmid | Warm, not harsh | 92% high (before rebuild), improved to 13% high | Keep improving |
| All samples normalized | Peak 1.0 | Peak 0.03-0.83 | **Normalize all voices** |

---

## 5. WHAT NEEDS REBUILD (not patch)

### Must Rebuild:
1. **Lead voice** — needs Moog-style filter, velocity response, articulation, lower cutoff
2. **Pad voice** — needs chorus, filter movement, higher amplitude
3. **Channel gain staging** — needs GainNode per voice with proper dB values
4. **Master chain** — needs multiband, true-peak, LUFS targeting

### Can Salvage:
1. **Kick** — add PSY3 sample as base layer
2. **Bass** — add PSY3 sample as character layer
3. **Hat** — add per-hit variation
4. **Clap** — add per-hit variation

### Can Keep:
1. **Acid** — decent architecture
2. **Texture** — good architecture
3. **Zap/Blip/Downlifter** — functional ear candy
4. **Riser/Impact/Sweep** — functional transitions

---

## 6. DSP PRIMITIVES GAP

### Missing from PSY4 Live Engine:

| Primitive | PSY3 Has It? | Commercial Standard | Priority |
|-----------|-------------|---------------------|----------|
| **Moog-style filter** | Yes (pro_dsp.py) | Essential for warmth | P0 |
| **Phaser** | Yes (pro_fx.py) | Essential for psychedelic | P1 |
| **Shimmer** | Yes (pro_fx.py) | Essential for space | P1 |
| **Multiband comp** | Yes (style_master.py) | Essential for master | P0 |
| **True-peak limiter** | Yes (style_master.py) | Essential for master | P0 |
| **FM synthesis** | Partial (zap only) | Essential for timbral variety | P1 |
| **Ring modulation** | No | Useful for metallic timbres | P2 |
| **Comb filter** | No | Useful for resonant textures | P2 |
| **Wavetable interpolation** | Partial (texture only) | Useful for evolving timbres | P1 |
| **Modulation matrix** | No | Essential for routing | P0 |

---

## 7. WHAT WILL GIVE 80% OF THE IMPROVEMENT

If we can only do 5 things:

1. **Use PSY3 kick/hat/clap samples directly** — replaces weak synth drums with real samples
2. **Add channel gains to live engine** — creates mix hierarchy and headroom
3. **Lower lead cutoff + add Moog-style saturation** — makes lead warm instead of harsh
4. **Double pad/bass amplitude** — makes them audible
5. **Add per-hit variation to drums** — makes them sound human, not machine-like

These 5 changes would move the sonic quality from 25/100 to ~50/100.

The remaining 50% requires:
- Modulation matrix
- Phaser/shimmer
- Multiband compression
- Voice identity system
- Reference analysis
- AudioWorklet
