# Commercial Reference Forensic Analysis V2

## Executive Summary

A forensic A/B analysis was performed comparing PSY3 samples vs PSY4 procedurally generated samples. The analysis revealed a **critical root cause** of the "MIDI toy" sound:

**PSY4's generated kick had only 4.9% sub energy vs PSY3's 90.7%** — the kick was putting its energy in the wrong frequency band (60-200Hz "low" region instead of 20-60Hz "sub" region), making it sound like a cardboard box instead of a professional kick.

## Forensic Measurement Method

Python analysis using numpy + scipy FFT:
- 6-band spectral analysis: sub (20-60Hz), low (60-200Hz), lowMid (200-800Hz), mid (800-3000Hz), high (3000-8000Hz), air (8000+)
- Peak, RMS, crest factor
- Spectral centroid
- Fundamental frequency detection
- Transient ratio (attack energy / body energy)

## PSY3 Sample Baseline (Reference)

| Sample | Duration | Peak | RMS | Crest | Centroid | Sub% | Low% | Mid% | High% | Transient |
|--------|----------|------|-----|-------|----------|------|------|------|-------|-----------|
| kick.wav | 0.280s | 1.000 | 0.319 | 3.1 | 221Hz | 90.6% | 9.3% | 0.2% | 0.0% | 1.08 |
| bass_A.wav | 0.180s | 0.675 | 0.200 | 3.4 | 858Hz | 72.5% | 20.1% | 7.3% | 0.1% | 1.32 |
| lead.wav | 0.300s | 0.274 | 0.052 | 5.3 | 7583Hz | 0.0% | 0.0% | 91.5% | 8.5% | 0.51 |
| hat_closed.wav | 0.060s | 1.000 | 0.331 | 3.0 | 13963Hz | 0.0% | 0.0% | 0.5% | 99.5% | 1.20 |
| clap.wav | 0.250s | 1.000 | 0.374 | 2.7 | 11004Hz | 0.2% | 1.2% | 14.4% | 84.2% | 0.95 |

## PSY4 Original Generated Kick (BEFORE FIX)

| Metric | PSY3 kick.wav | PSY4 Generated (original) | Problem |
|--------|---------------|---------------------------|---------|
| Fundamental | 53.8Hz | 75.4Hz | **+21.6Hz too high** |
| Sub energy (<60Hz) | 90.7% | 4.9% | **-85.8% — critically low** |
| Low energy (60-200Hz) | 9.3% | 95.1% | **+85.8% — wrong band** |
| Centroid | 221Hz | 84Hz | Different (but misleading) |
| Crest | 3.1 | 2.3 | Lower (less punch) |

### Root Cause Analysis

1. **Pitch sweep too high**: PSY4 used `f0 * 2.4 = 120Hz` as the starting pitch, which kept the average frequency high during the FFT window
2. **Pitch decay too slow**: 0.04s time constant meant the pitch took too long to settle to the fundamental
3. **Mid triangle too loud**: The body layer (triangle at f0) added harmonics in the 60-200Hz range, competing with the sub
4. **Saturation too aggressive**: `tanh(sample * (1 + sat * 2))` with sat=0.4 added too many harmonics

## PSY4 Fixed Kick (AFTER FIX)

| Metric | PSY3 kick.wav | PSY4 Fixed | Improvement |
|--------|---------------|------------|-------------|
| Fundamental | 53.8Hz | 53.8Hz | **EXACT MATCH** |
| Sub energy (<60Hz) | 90.7% | 60.1% | **+55.2% improvement** (from 4.9% to 60.1%) |
| Low energy (60-200Hz) | 9.3% | 39.9% | Reduced from 95.1% to 39.9% |
| Pitch sweep start | N/A | f0*1.8 (90Hz) | Reduced from f0*2.4 (120Hz) |
| Mid level | N/A | 0.2x (was 0.5x) | Reduced to let sub dominate |

### Fixes Applied

1. **Reduced pitch sweep range**: `f0 * 2.4` → `f0 * 1.8` (120Hz → 90Hz start)
2. **Faster pitch decay**: 0.04s → 0.025s (settles to fundamental faster)
3. **Reduced mid triangle level**: 0.5x → 0.2x (sub dominates the spectrum)
4. **Reduced mid decay time**: 0.2 * decay → 0.15 * decay (mid decays faster)
5. **Milder saturation**: `(1 + sat * 2)` → `(1 + sat * 0.3)` (fewer harmonics)
6. **Sub-dominant mix**: `sub * 0.85 + mid * 0.1 + click * 0.05` (sub clearly dominates)

## Remaining Gap

The PSY4 fixed kick has 60.1% sub energy vs PSY3's 90.7%. The remaining 40% is from:
- Mid triangle harmonics (still present at 0.2x level)
- Saturation harmonics (tanh adds some upper harmonics)
- Click transient (broadband)

Further improvement would require:
- Removing the mid triangle entirely (pure sine kick)
- Using PSY3's actual kick.wav sample instead of synthesis (already available as fallback)

## Conclusion

The forensic analysis identified a **measurable, fixable root cause** of the "MIDI toy" sound: the kick's energy was in the wrong frequency band. The fix (reduced pitch sweep, faster decay, lower mid level) moved the energy into the correct sub region, matching PSY3's fundamental frequency exactly (53.8Hz).

**PHYSICAL LISTENING UNVERIFIED** — the improvement is measured via spectral analysis (sub energy 4.9% → 60.1%, fundamental 75Hz → 53.8Hz). The actual sonic impact should be a kick with more weight and punch, less cardboard-box character.
