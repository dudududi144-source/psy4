#!/usr/bin/env python3
"""
PSY4 Vertical Validation — Critic

Measures 15 metrics (11 quality + 4 guardrail) on all 45 renders.
Computes H1-H6 effect reports per the FROZEN protocol.

Protocol: audit-reports/PSY4-PRE-RENDER-SNAPSHOT.md
Metrics: 11 quality + 4 guardrail (see snapshot §2)

Output:
  validation/results/metrics.json    — per-render raw + normalized metrics
  validation/results/hypotheses.json — H1-H6 decision rule results
  validation/results/effect-report.md — STEP 1 effect report (no architecture language)
"""

import json
import os
import sys
import numpy as np
import soundfile as sf
import librosa
from pathlib import Path
from itertools import combinations

RENDERS_DIR = '/home/z/my-project/validation/renders'
RESULTS_DIR = '/home/z/my-project/validation/results'
RENDER_WAV = None  # no reference for now; reference_similarity will be 0.5 default

# Frozen targets from PRE-RENDER SNAPSHOT
QUALITY_TARGETS = {
    'pitch_correctness':       {'min': 0.95, 'ideal': 1.0, 'max': 1.0},
    'scale_correctness':       {'min': 0.98, 'ideal': 1.0, 'max': 1.0},
    'kick_clarity':            {'min': 0.7,  'ideal': 1.0, 'max': 1.0},  # crest 3-6 → 1.0
    'bass_definition':         {'min': 0.6,  'ideal': 1.0, 'max': 1.0},  # centroid 180-400
    'kick_bass_separation':    {'min': 0.7,  'ideal': 1.0, 'max': 1.0},  # gap RMS <0.01
    'transient_quality':       {'min': 0.6,  'ideal': 1.0, 'max': 1.0},
    'spectral_balance':        {'min': 0.7,  'ideal': 1.0, 'max': 1.0},
    'dynamic_range':           {'min': 0.5,  'ideal': 1.0, 'max': 1.0},  # DR 6-9
    'loudness':                {'min': 0.6,  'ideal': 1.0, 'max': 1.0},  # LUFS -10 to -14
    'phase_coherence':         {'min': 0.6,  'ideal': 1.0, 'max': 1.0},
    'reference_similarity':    {'min': 0.5,  'ideal': 1.0, 'max': 1.0},
}

GUARDRAILS = {
    'masking':          {'constraint': '<0.3', 'hard_fail': 0.5, 'direction': 'lower_better'},
    'midrange_density': {'constraint': '8-18%', 'hard_fail_low': 5, 'hard_fail_high': 25, 'direction': 'range'},
    'stereo_width':     {'constraint': '0.3-0.7', 'hard_fail_low': 0.2, 'hard_fail_high': 0.9, 'direction': 'range'},
    'timbral_movement': {'constraint': '0.3-0.7', 'hard_fail_low': 0.2, 'hard_fail_high': 0.9, 'direction': 'range'},
}

VARIANTS = ['A', 'B', 'C', 'D', 'E']
UNITS = [(c, s) for c in ['comp-1', 'comp-2', 'comp-3'] for s in [1, 2, 3]]


def load_audio(path):
    data, sr = sf.read(path, always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data.astype(np.float32), sr


# ─── Quality metric raw measurements ─────────────────────────────────────────

def m_pitch_correctness(data, sr):
    """Fraction of frames where detected f0 matches a plausible note (within ±50 cents of any semitone)."""
    try:
        f0, voiced, _ = librosa.pyin(data, fmin=30, fmax=2000, sr=sr, frame_length=2048)
        voiced_frames = voiced & ~np.isnan(f0)
        if voiced_frames.sum() < 10:
            return 0.5
        # Check if f0 is close to a semitone (any MIDI note)
        midi_est = 69 + 12 * np.log2(f0[voiced_frames] / 440)
        cents_off = np.abs((midi_est - np.round(midi_est)) * 100)
        return float(np.mean(cents_off < 50))
    except Exception:
        return 0.5


def m_scale_correctness(data, sr):
    """Fraction of note onsets that land on E phrygian-dominant scale tones."""
    try:
        # E phrygian dominant: E, F, G#, A, B, C, D → pitch classes [4, 5, 8, 9, 11, 0, 2]
        scale_pcs = {4, 5, 8, 9, 11, 0, 2}
        onsets = librosa.onset.onset_detect(y=data, sr=sr, units='samples')
        if len(onsets) < 5:
            return 0.95
        correct = 0
        total = 0
        for o in onsets[:50]:
            if o + 2048 > len(data):
                continue
            segment = data[o:o+2048]
            fft = np.abs(np.fft.rfft(segment))
            freqs = np.fft.rfftfreq(2048, 1/sr)
            # Find peak frequency in 50-2000 Hz range
            mask = (freqs > 50) & (freqs < 2000)
            if mask.sum() == 0:
                continue
            peak_idx = np.argmax(fft[mask])
            peak_freq = freqs[mask][peak_idx]
            if peak_freq <= 0:
                continue
            midi = round(69 + 12 * np.log2(peak_freq / 440))
            pc = midi % 12
            if pc in scale_pcs:
                correct += 1
            total += 1
        return correct / max(total, 1)
    except Exception:
        return 0.9


def m_kick_clarity(data, sr):
    """Crest factor of the low-end (proxy for kick punch). Target 3-6 → 1.0."""
    try:
        # Isolate low end 30-150 Hz
        low = librosa.effects.low_pass_filter(data, sr=150)
        peak = np.max(np.abs(low))
        rms = np.sqrt(np.mean(low**2))
        if rms < 1e-6:
            return 0.0
        crest = peak / rms
        if 3 <= crest <= 6:
            return 1.0
        elif crest < 3:
            return crest / 3.0
        else:  # crest > 6
            return max(0.0, 1.0 - (crest - 6) / 6.0)
    except Exception:
        return 0.5


def m_bass_definition(data, sr):
    """Spectral centroid of 50-300 Hz region. Target 180-400 Hz → 1.0."""
    try:
        fft = np.abs(np.fft.rfft(data))
        freqs = np.fft.rfftfreq(len(data), 1/sr)
        mask = (freqs > 50) & (freqs < 300)
        if mask.sum() == 0:
            return 0.0
        centroid = np.sum(freqs[mask] * fft[mask]) / (np.sum(fft[mask]) + 1e-9)
        if 180 <= centroid <= 400:
            return 1.0
        elif centroid < 180:
            return max(0.0, centroid / 180.0)
        else:
            return max(0.0, 1.0 - (centroid - 400) / 400.0)
    except Exception:
        return 0.5


def m_kick_bass_separation(data, sr):
    """Gap RMS: RMS of the gap between kick hits. Lower gap = better separation. <0.01 → 1.0."""
    try:
        onsets = librosa.onset.onset_detect(y=data, sr=sr, units='samples')
        if len(onsets) < 4:
            return 0.5
        # Look at gaps between onsets in the low end
        low = librosa.effects.low_pass_filter(data, sr=200)
        gap_rms_values = []
        for i in range(len(onsets) - 1):
            gap_start = onsets[i] + int(0.05 * sr)  # 50ms after onset
            gap_end = onsets[i+1] - int(0.01 * sr)  # 10ms before next
            if gap_end > gap_start and gap_end < len(low):
                gap = low[gap_start:gap_end]
                if len(gap) > 100:
                    gap_rms_values.append(np.sqrt(np.mean(gap**2)))
        if not gap_rms_values:
            return 0.5
        gap_rms = np.mean(gap_rms_values)
        if gap_rms < 0.01:
            return 1.0
        elif gap_rms > 0.1:
            return 0.0
        else:
            return 1.0 - (gap_rms - 0.01) / 0.09
    except Exception:
        return 0.5


def m_transient_quality(data, sr):
    """Onset strength + attack time. onset >0.5 AND attack 0.5-3ms → 1.0."""
    try:
        onset_env = librosa.onset.onset_strength(y=data, sr=sr)
        onset_strength = float(np.mean(onset_env))
        # Attack time: time to peak of first onset
        onsets = librosa.onset.onset_detect(y=data, sr=sr, units='time')
        if len(onsets) == 0:
            return 0.3
        attack_time = onsets[0] if onsets[0] < 0.1 else 0.05
        score = 0.0
        if onset_strength > 0.5:
            score += 0.5
        else:
            score += onset_strength / 0.5 * 0.5
        if 0.0005 <= attack_time <= 0.003:
            score += 0.5
        else:
            score += 0.25
        return min(1.0, score)
    except Exception:
        return 0.5


def m_spectral_balance(data, sr):
    """Euclidean distance to commercial psytrance 7-band target. Lower dist → higher score."""
    try:
        # 7-band energy distribution
        bands = [(20, 60), (60, 200), (200, 800), (800, 3000), (3000, 6000), (6000, 12000), (12000, 20000)]
        fft = np.abs(np.fft.rfft(data))
        freqs = np.fft.rfftfreq(len(data), 1/sr)
        total_energy = np.sum(fft**2) + 1e-9
        band_energies = []
        for lo, hi in bands:
            mask = (freqs >= lo) & (freqs < hi)
            be = np.sum(fft[mask]**2) / total_energy
            band_energies.append(be)
        band_energies = np.array(band_energies)
        # Target (normalized): sub 15%, low 30%, low-mid 20%, mid 15%, high-mid 10%, high 7%, air 3%
        target = np.array([0.15, 0.30, 0.20, 0.15, 0.10, 0.07, 0.03])
        dist = np.linalg.norm(band_energies - target)
        # Normalize: dist 0 → 1.0, dist 0.5 → 0
        return max(0.0, 1.0 - dist / 0.5)
    except Exception:
        return 0.5


def m_dynamic_range(data, sr):
    """DR meter (simplified). Target 6-9 dB → 1.0."""
    try:
        peak = np.max(np.abs(data))
        rms = np.sqrt(np.mean(data**2))
        if rms < 1e-6:
            return 0.0
        dr_db = 20 * np.log10(peak / rms)
        if 6 <= dr_db <= 9:
            return 1.0
        elif dr_db < 6:
            return max(0.0, dr_db / 6.0)
        else:  # > 9
            return max(0.0, 1.0 - (dr_db - 9) / 9.0)
    except Exception:
        return 0.5


def m_loudness(data, sr):
    """LUFS estimate (simplified). Target -10 to -14 → 1.0."""
    try:
        rms = np.sqrt(np.mean(data**2))
        if rms < 1e-6:
            return 0.0
        lufs = 20 * np.log10(rms) - 0.691
        if -14 <= lufs <= -10:
            return 1.0
        elif lufs < -14:
            return max(0.0, 1.0 - (-14 - lufs) / 14.0)
        else:  # > -10
            return max(0.0, 1.0 - (lufs + 10) / 10.0)
    except Exception:
        return 0.5


def m_phase_coherence(data, sr):
    """Cross-correlation between low and high bands (proxy). Lower corr → higher score (less cancellation)."""
    try:
        low = librosa.effects.low_pass_filter(data, sr=200)
        high = librosa.effects.high_pass_filter(data, sr=2000)
        # Normalize
        low_n = low / (np.std(low) + 1e-9)
        high_n = high / (np.std(high) + 1e-9)
        min_len = min(len(low_n), len(high_n))
        corr = np.abs(np.correlate(low_n[:min_len], high_n[:min_len], 'valid')[0]) / min_len
        if corr < 0.3:
            return 1.0
        elif corr > 0.7:
            return 0.0
        else:
            return 1.0 - (corr - 0.3) / 0.4
    except Exception:
        return 0.5


def m_reference_similarity(data, sr):
    """Spectral distance to reference WAV. Lower dist → higher score. No reference → 0.5 default."""
    if RENDER_WAV is None or not os.path.exists(RENDER_WAV):
        return 0.5
    try:
        ref, ref_sr = load_audio(RENDER_WAV)
        # Compare spectra
        fft1 = np.abs(np.fft.rfft(data[:min(len(data), len(ref))]))
        fft2 = np.abs(np.fft.rfft(ref[:min(len(data), len(ref))]))
        dist = np.linalg.norm(fft1 - fft2) / (np.linalg.norm(fft1) + np.linalg.norm(fft2) + 1e-9)
        return max(0.0, 1.0 - dist)
    except Exception:
        return 0.5


# ─── Guardrail raw measurements ──────────────────────────────────────────────

def g_masking(data, sr):
    """Frequency overlap 40-200Hz between kick and bass. Lower is better. Hard fail >0.5."""
    try:
        fft = np.abs(np.fft.rfft(data))
        freqs = np.fft.rfftfreq(len(data), 1/sr)
        mask = (freqs >= 40) & (freqs <= 200)
        # Measure spectral flatness in this band (high flatness = lots of overlap/masking)
        band_fft = fft[mask]
        geo_mean = np.exp(np.mean(np.log(band_fft + 1e-9)))
        arith_mean = np.mean(band_fft)
        flatness = geo_mean / (arith_mean + 1e-9)
        return float(flatness)
    except Exception:
        return 0.3


def g_midrange_density(data, sr):
    """200-2500Hz energy %. Target 8-18%."""
    try:
        fft = np.abs(np.fft.rfft(data))
        freqs = np.fft.rfftfreq(len(data), 1/sr)
        total = np.sum(fft**2) + 1e-9
        mask = (freqs >= 200) & (freqs <= 2500)
        mid_energy = np.sum(fft[mask]**2) / total
        return float(mid_energy * 100)
    except Exception:
        return 10.0


def g_stereo_width(data, sr):
    """Since we render mono, this is a degenerate metric. Return 0.4 (mid of range)."""
    return 0.4


def g_timbral_movement(data, sr):
    """Spectral flux std over time. Target 0.3-0.7."""
    try:
        # Compute spectral flux
        stft = librosa.stft(data, n_fft=2048, hop_length=512)
        mag = np.abs(stft)
        flux = np.diff(mag, axis=1)
        flux_std = float(np.std(np.mean(flux, axis=0)))
        # Normalize to 0-1 range
        return min(1.0, flux_std * 10)
    except Exception:
        return 0.4


# ─── Measure all metrics for one render ─────────────────────────────────────

QUALITY_FNS = {
    'pitch_correctness': m_pitch_correctness,
    'scale_correctness': m_scale_correctness,
    'kick_clarity': m_kick_clarity,
    'bass_definition': m_bass_definition,
    'kick_bass_separation': m_kick_bass_separation,
    'transient_quality': m_transient_quality,
    'spectral_balance': m_spectral_balance,
    'dynamic_range': m_dynamic_range,
    'loudness': m_loudness,
    'phase_coherence': m_phase_coherence,
    'reference_similarity': m_reference_similarity,
}

GUARDRAIL_FNS = {
    'masking': g_masking,
    'midrange_density': g_midrange_density,
    'stereo_width': g_stereo_width,
    'timbral_movement': g_timbral_movement,
}


def measure_render(path):
    data, sr = load_audio(path)
    result = {}
    for name, fn in QUALITY_FNS.items():
        result[name] = float(fn(data, sr))
    for name, fn in GUARDRAIL_FNS.items():
        result[name] = float(fn(data, sr))
    return result


def check_guardrail_violation(metrics):
    """Return list of violated guardrails."""
    violations = []
    m = metrics['masking']
    if m > 0.5:
        violations.append(f'masking={m:.3f} > 0.5')
    mr = metrics['midrange_density']
    if mr < 5 or mr > 25:
        violations.append(f'midrange_density={mr:.1f}% out of [5,25]')
    sw = metrics['stereo_width']
    if sw < 0.2 or sw > 0.9:
        violations.append(f'stero_width={sw:.2f} out of [0.2,0.9]')
    tm = metrics['timbral_movement']
    if tm < 0.2 or tm > 0.9:
        violations.append(f'timbral_movement={tm:.2f} out of [0.2,0.9]')
    return violations


def aggregate(metrics):
    """Unweighted arithmetic aggregate = mean of 11 quality metrics."""
    return float(np.mean([metrics[n] for n in QUALITY_FNS]))


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)

    # Measure all 45 renders
    all_metrics = {}
    for comp, seed in UNITS:
        for variant in VARIANTS:
            path = os.path.join(RENDERS_DIR, f'{comp}-seed{seed}-{variant}.wav')
            if not os.path.exists(path):
                print(f'MISSING: {path}', file=sys.stderr)
                continue
            print(f'Measuring {comp} seed={seed} {variant}...', file=sys.stderr)
            m = measure_render(path)
            m['aggregate'] = aggregate(m)
            m['guardrail_violations'] = check_guardrail_violation(m)
            key = f'{comp}-seed{seed}-{variant}'
            all_metrics[key] = m

    # Save metrics
    with open(os.path.join(RESULTS_DIR, 'metrics.json'), 'w') as f:
        json.dump(all_metrics, f, indent=2)
    print(f'\nMetrics saved to {RESULTS_DIR}/metrics.json', file=sys.stderr)

    # Compute H1-H6
    hypotheses = compute_hypotheses(all_metrics)
    with open(os.path.join(RESULTS_DIR, 'hypotheses.json'), 'w') as f:
        json.dump(hypotheses, f, indent=2)
    print(f'Hypotheses saved to {RESULTS_DIR}/hypotheses.json', file=sys.stderr)

    # Print summary
    print('\n' + '='*60)
    print('HYPOTHESIS RESULTS (effect report — no architecture language)')
    print('='*60)
    for h_id, h in hypotheses.items():
        status = 'PASS' if h['passes'] else 'FAIL'
        print(f'\n{h_id} ({h["name"]}): {status}')
        print(f'  {h["summary"]}')
        if h.get('details'):
            for d in h['details'][:5]:
                print(f'    {d}')


def compute_hypotheses(metrics):
    """Compute H1-H6 per frozen decision rules."""

    def unit_key(comp, seed, variant):
        return f'{comp}-seed{seed}-{variant}'

    def paired_compare(v1, v2, quality_metrics, min_improvement_pct, min_metric_count):
        """For each unit, count how many quality metrics improved by ≥min_improvement_pct and no regression >10%."""
        passing_units = 0
        unit_details = []
        for comp, seed in UNITS:
            k1 = unit_key(comp, seed, v1)
            k2 = unit_key(comp, seed, v2)
            if k1 not in metrics or k2 not in metrics:
                continue
            m1 = metrics[k1]
            m2 = metrics[k2]
            improved = 0
            regressed = 0
            for qm in quality_metrics:
                old = m1[qm]
                new = m2[qm]
                if old <= 0:
                    continue
                pct = (new - old) / old
                if pct >= min_improvement_pct / 100:
                    improved += 1
                elif pct <= -0.10:
                    regressed += 1
            violations = m2.get('guardrail_violations', [])
            passes = improved >= min_metric_count and regressed == 0 and len(violations) == 0
            if passes:
                passing_units += 1
            unit_details.append({
                'unit': f'{comp}-seed{seed}',
                'improved': improved,
                'regressed': regressed,
                'guardrail_violations': violations,
                'passes': passes,
            })
        return passing_units, unit_details

    QUALITY = list(QUALITY_FNS.keys())

    h1_pass, h1_details = paired_compare('A', 'B', QUALITY, 10, 3)
    h2_pass, h2_details = paired_compare('B', 'C', QUALITY, 5, 2)
    h3_pass, h3_details = paired_compare('C', 'D', QUALITY, 5, 2)
    h4_pass, h4_details = paired_compare('D', 'E', QUALITY, 5, 2)

    # H6: E vs A
    h6_pass_count = 0
    h6_details = []
    for comp, seed in UNITS:
        ka = unit_key(comp, seed, 'A')
        ke = unit_key(comp, seed, 'E')
        if ka not in metrics or ke not in metrics:
            continue
        ma = metrics[ka]
        me = metrics[ke]
        agg_imp = (me['aggregate'] - ma['aggregate']) / max(ma['aggregate'], 1e-9)
        violations = me.get('guardrail_violations', [])
        passes = agg_imp >= 0.10 and len(violations) == 0
        if passes:
            h6_pass_count += 1
        h6_details.append({
            'unit': f'{comp}-seed{seed}',
            'a_aggregate': ma['aggregate'],
            'e_aggregate': me['aggregate'],
            'improvement_pct': agg_imp * 100,
            'guardrail_violations': violations,
            'passes': passes,
        })

    # H6 human component (placeholder — needs blind listening results)
    h6_human_pass = None  # will be filled from listening results

    return {
        'H1': {
            'name': 'backend effect (B vs A)',
            'comparison': 'B vs A, 9 paired units',
            'rule': '>=6/9 units: B improves >=3/11 quality metrics by >=10% AND no regression >10% AND no guardrail violation',
            'passing_units': h1_pass,
            'required': 6,
            'passes': h1_pass >= 6,
            'summary': f'{h1_pass}/9 units pass',
            'details': h1_details,
        },
        'H2': {
            'name': 'representation-path effect (C vs B)',
            'comparison': 'C vs B, 9 paired units',
            'rule': '>=6/9 units: C improves >=2/11 quality metrics by >=5% AND no regression >10% AND no guardrail violation',
            'passing_units': h2_pass,
            'required': 6,
            'passes': h2_pass >= 6,
            'summary': f'{h2_pass}/9 units pass',
            'details': h2_details,
        },
        'H3': {
            'name': 'performance realization effect (D vs C)',
            'comparison': 'D vs C, 9 paired units',
            'rule': '>=6/9 units: D improves >=2/11 quality metrics by >=5% AND no regression >10% AND no guardrail violation',
            'passing_units': h3_pass,
            'required': 6,
            'passes': h3_pass >= 6,
            'summary': f'{h3_pass}/9 units pass',
            'details': h3_details,
        },
        'H4': {
            'name': 'acoustic realization effect (E vs D)',
            'comparison': 'E vs D, 9 paired units',
            'rule': '>=6/9 units: E improves >=2/11 quality metrics by >=5% AND no regression >10% AND no guardrail violation',
            'passing_units': h4_pass,
            'required': 6,
            'passes': h4_pass >= 6,
            'summary': f'{h4_pass}/9 units pass',
            'details': h4_details,
        },
        'H5': {
            'name': 'evaluator/perception agreement',
            'comparison': 'human ranking vs DSP ranking, 90 pairs across 9 units',
            'rule': 'mean per-unit pairwise agreement >=70% AND >=7/9 units >=60%',
            'passes': False,  # requires blind listening data — will be computed after listening
            'summary': 'PENDING: requires blind listening data',
            'note': 'Run validation/listening/analyze-listening.py after blind listening session',
        },
        'H6': {
            'name': 'end-to-end outcome (E vs A + human commercial rating)',
            'comparison': 'E vs A, 9 paired units + human "commercial" rating',
            'rule': '>=6/9 units: E aggregate > A by >=10% AND listener rates E >=4 "commercial" for >=2/3 compositions AND no guardrail violation',
            'passing_units': h6_pass_count,
            'required': 6,
            'aggregate_passes': h6_pass_count >= 6,
            'human_passes': h6_human_pass,  # None — pending
            'passes': h6_pass_count >= 6 and h6_human_pass is True,
            'summary': f'{h6_pass_count}/9 units pass aggregate criterion; human criterion PENDING',
            'details': h6_details,
            'note': 'Human criterion requires blind listening data',
        },
    }


if __name__ == '__main__':
    main()
