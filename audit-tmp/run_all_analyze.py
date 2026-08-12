#!/usr/bin/env python3
"""Batch driver: analyze all 6 AUDIT WAVs and dump single JSON."""
import sys, os, json
sys.path.insert(0, '/home/z/my-project/audit-tmp')
from audition_analyze import analyze

WAVS = [
    ('audio-artifacts/AUDIT-A-kick.wav', 'AUDIT-A-kick'),
    ('audio-artifacts/AUDIT-B-bass.wav', 'AUDIT-B-bass'),
    ('audio-artifacts/AUDIT-C-kickbass.wav', 'AUDIT-C-kickbass'),
    ('audio-artifacts/AUDIT-D-lead.wav', 'AUDIT-D-lead'),
    ('audio-artifacts/AUDIT-E-8bar.wav', 'AUDIT-E-8bar-fullmix'),
    ('audio-artifacts/AUDIT-F-16bar.wav', 'AUDIT-F-16bar-fullmix'),
]

base = '/home/z/my-project'
results = {}
for rel, label in WAVS:
    p = os.path.join(base, rel)
    print(f'Analyzing {label}...', file=sys.stderr)
    r = analyze(p, label)
    results[label] = r

out = '/home/z/my-project/audit-tmp/audit-results.json'
with open(out, 'w') as f:
    json.dump(results, f, indent=2, default=str)
print(f'Wrote {out}', file=sys.stderr)

# Print summary table
print('\n=== SUMMARY ===')
for label, r in results.items():
    if r is None: continue
    t = r['time']; s = r['spectrum']; tr = r['transient']; d = r['dynamics']; p = r['pitch']; h = r['harmonics']
    print(f'\n{label} ({r["duration_s"]:.2f}s):')
    print(f'  Peak={t["peak"]:.4f} ({t["peak_db"]:+.1f}dB)  RMS={t["rms"]:.4f} ({t["rms_db"]:+.1f}dB)  Crest={t["crest_factor"]:.2f}  LUFS={t["lufs_estimate"]:+.1f}  DC={t["dc_offset"]:+.5f}')
    b = s['bands_pct']
    print(f'  Centroid={s["centroid_hz"]:.0f}Hz  Spread={s["spread_hz"]:.0f}Hz  Rolloff85={s["rolloff_85_hz"]:.0f}Hz  Flatness={s["flatness"]:.4f}')
    print(f'  Bands%: sub={b["sub20_60"]:.1f} low={b["low60_200"]:.1f} lomid={b["lomid200_800"]:.1f} mid={b["mid800_2500"]:.1f} himid={b["himid2500_6000"]:.1f} high={b["high6000_16000"]:.1f} air={b["air16000_20k"]:.1f}')
    print(f'  Onset max={tr["onset_strength_max"]:.2f} mean={tr["onset_strength_mean"]:.2f}  attack={tr["attack_time_s"]*1000:.2f}ms  decay={tr["decay_time_s"]*1000:.2f}ms  trans_dur={tr["transient_duration_s"]*1000:.2f}ms  n_onsets={tr["num_onsets"]}')
    print(f'  DR={d["dynamic_range_db"]:.1f}dB  LRA={d["loudness_range_db"]:.1f}dB  RMSenv_std={d["rms_envelope_std"]:.4f}')
    print(f'  F0 med={p["f0_median_hz"]:.1f}Hz mean={p["f0_mean_hz"]:.1f}Hz std={p["f0_std_hz"]:.1f}Hz min={p["f0_min_hz"]:.1f} max={p["f0_max_hz"]:.1f} stability={p["pitch_stability"]:.3f}')
    print(f'  Harm={h["harmonicity"]:.3f} Perc={h["percussivity"]:.3f} Noise={h["noisiness"]:.3f} HNR={h["hnr_db"]:+.1f}dB')
    if r.get('kick_pitch_drop'):
        frames = r['kick_pitch_drop']
        print(f'  KICK PITCH DROP (t,Hz): ' + ' '.join(f'{t*1000:.0f}ms:{f:.0f}Hz' for t,f in frames[:8]))
    if r.get('bass_filter_envelope'):
        frames = r['bass_filter_envelope']
        print(f'  BASS FILTER ENV (t,cents_Hz): ' + ' '.join(f'{t*1000:.0f}ms:{c:.0f}Hz' for t,c in frames[:10]))
    if r.get('lead_metrics'):
        lm = r['lead_metrics']
        print(f'  LEAD: f0_med={lm["f0_median_hz"]:.1f}Hz f0_std={lm["f0_std_cents"]:.1f}cents f0_range=[{lm["f0_min_cents"]:.1f},{lm["f0_max_cents"]:.1f}]cents AM_depth={lm["amp_mod_depth"]:.3f}')
    if r.get('mix_metrics'):
        m = r['mix_metrics']
        print(f'  MIX: sub+low={m["sub_plus_low_pct"]:.1f}% mid={m["mid_pct"]:.1f}% flux_mean={m["flux_mean"]:.2f} flux_std={m["flux_std"]:.2f} BPM={m["detected_bpm"]:.1f}')
