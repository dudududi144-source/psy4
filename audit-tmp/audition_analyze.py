#!/usr/bin/env python3
"""
AUDIT-A: Forensic DSP analysis of PSY4 audition WAVs.

Computes waveform stats, spectrum, transient, dynamics, pitch, harmonics,
and (for full mixes) low-end overlap and masking proxies.

Usage: python3 audition_analyze.py <wav_path> [label]
"""
import sys, os, json
import numpy as np
import soundfile as sf
import librosa
from scipy import signal as scisig

def safe(v, default=0.0):
    try:
        if v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))):
            return default
        return float(v)
    except Exception:
        return default

def band_energy(S, freqs, lo, hi):
    mask = (freqs >= lo) & (freqs < hi)
    return float(np.sum(S[mask]**2)) if mask.any() else 0.0

def analyze(path, label=None):
    if not os.path.exists(path):
        print(f'MISSING: {path}')
        return None
    y, sr = sf.read(path)
    if y.ndim > 1: y = y.mean(axis=1)
    y = y.astype(np.float64)
    N = len(y)
    dur = N / sr
    label = label or os.path.basename(path)

    # ── TIME DOMAIN ──
    peak = float(np.max(np.abs(y)))
    rms_all = float(np.sqrt(np.mean(y**2)))
    rms_db = 20*np.log10(rms_all + 1e-12)
    peak_db = 20*np.log10(peak + 1e-12)
    crest = peak / (rms_all + 1e-12)
    # LUFS-ish estimate (K-weighted approx: simple highpass + 1.5dB headroom)
    # Use librosa feature.rms as proxy
    dc = float(np.mean(y))
    # LUFS approximation: ITU-R BS.1770 K-weighting (simplified — high-pass + shelving)
    try:
        y_k = librosa.filters.get_filter('high', sr=sr, cutoff=38, order=4)(y) if hasattr(librosa, 'filters') else y
    except Exception:
        y_k = y
    mean_sq_k = float(np.mean(y_k**2))
    lufs = -0.691 + 10*np.log10(mean_sq_k + 1e-12)

    # ── SPECTRUM (long-term average) ──
    n_fft = 8192
    hop = 2048
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
    Savg = np.mean(S, axis=1)
    Spow = Savg**2
    total = float(np.sum(Spow) + 1e-12)

    centroid = safe(np.sum(freqs * Savg) / (np.sum(Savg) + 1e-12))
    spread = safe(np.sqrt(np.sum(Spow * (freqs - centroid)**2) / (np.sum(Savg) + 1e-12)))
    cum = np.cumsum(Spow)
    rolloff_idx = np.searchsorted(cum, 0.85 * cum[-1])
    rolloff = safe(freqs[rolloff_idx])
    # spectral flatness
    geom = np.exp(np.mean(np.log(Savg + 1e-12)))
    arith = np.mean(Savg)
    flatness = safe(geom / (arith + 1e-12))
    # band energies
    sub = band_energy(Savg, freqs, 20, 60)
    low = band_energy(Savg, freqs, 60, 200)
    lomid = band_energy(Savg, freqs, 200, 800)
    mid = band_energy(Savg, freqs, 800, 2500)
    himid = band_energy(Savg, freqs, 2500, 6000)
    high = band_energy(Savg, freqs, 6000, 16000)
    air = band_energy(Savg, freqs, 16000, 20000)
    bands = {'sub20_60':sub,'low60_200':low,'lomid200_800':lomid,'mid800_2500':mid,
             'himid2500_6000':himid,'high6000_16000':high,'air16000_20k':air}
    pct = {k: 100*v/total for k,v in bands.items()}

    # ── TRANSIENT ──
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
    onset_env = float(np.max(env)) if len(env) else 0.0
    onset_mean = float(np.mean(env)) if len(env) else 0.0
    # onset detection
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=512, units='time')
    # attack time: time to first 90% peak
    peak_idx = int(np.argmax(np.abs(y)))
    peak_time = peak_idx / sr
    # attack: from start (or from previous zero crossing) to peak
    # Find attack from previous zero crossing
    start_idx = peak_idx
    while start_idx > 0 and y[start_idx-1] * y[peak_idx] >= 0 and (peak_idx - start_idx) < sr*0.1:
        start_idx -= 1
    attack_time = (peak_idx - start_idx) / sr
    # decay time: from peak to 10% of peak
    thr = 0.1 * np.abs(y[peak_idx])
    decay_idx = peak_idx
    while decay_idx < N-1 and np.abs(y[decay_idx]) > thr:
        decay_idx += 1
    decay_time = (decay_idx - peak_idx) / sr
    # transient duration: from onset to 50% decay (energy)
    win = max(1, int(0.001 * sr))  # 1ms RMS window
    rms_env = np.array([np.sqrt(np.mean(y[i:i+win]**2)) for i in range(0, N-win, win)])
    if len(rms_env) > 0:
        env_peak = np.max(rms_env)
        env_peak_idx = int(np.argmax(rms_env))
        # find where envelope drops to 10% of peak
        decay_env_idx = env_peak_idx
        while decay_env_idx < len(rms_env)-1 and rms_env[decay_env_idx] > 0.1*env_peak:
            decay_env_idx += 1
        transient_dur = (decay_env_idx - env_peak_idx) * win / sr
    else:
        transient_dur = 0.0

    # ── DYNAMICS ──
    # dynamic range (DR): approximated as peak - average RMS (lufs-ish)
    # Use frame RMS for variability
    rms_frames = librosa.feature.rms(y=y, frame_length=4096, hop_length=2048)[0]
    rms_var = float(np.std(rms_frames))
    rms_min = float(np.min(rms_frames))
    rms_max = float(np.max(rms_frames))
    # loudness range (LRA) approx
    lra = float(20*np.log10((rms_max + 1e-12) / (rms_min + 1e-12)))
    # DR (rough): peak_db - mean_rms_db over loud frames
    loud_frames = rms_frames[rms_frames > 0.01*rms_max]
    mean_loud_rms = float(np.mean(loud_frames)) if len(loud_frames) else rms_all
    dr = peak_db - (20*np.log10(mean_loud_rms + 1e-12))

    # ── PITCH (YIN) ──
    try:
        f0, voiced_flag, voiced_prob = librosa.pyin(
            y, fmin=20, fmax=2000, sr=sr, frame_length=2048
        )
        f0_v = f0[voiced_flag & (voiced_prob > 0.5) & ~np.isnan(f0)]
        f0_v = f0_v[f0_v > 0]
        if len(f0_v) > 5:
            f0_median = float(np.median(f0_v))
            f0_mean = float(np.mean(f0_v))
            f0_std = float(np.std(f0_v))
            f0_min = float(np.min(f0_v))
            f0_max = float(np.max(f0_v))
            # pitch contour variability (pitch stability)
            pitch_stability = safe(1.0 - (f0_std / (f0_mean + 1e-12)))
        else:
            f0_median = f0_mean = f0_std = f0_min = f0_max = 0.0
            pitch_stability = 0.0
    except Exception as e:
        f0_median = f0_mean = f0_std = f0_min = f0_max = 0.0
        pitch_stability = 0.0

    # ── HARMONICS ──
    # inharmonicity (rough): ratio of energy between harmonics to total
    try:
        # Use librosa.effects.harmonic vs percussive
        y_h, y_p = librosa.effects.hpss(y)
        harmonicity = safe(np.sum(y_h**2) / (np.sum(y**2) + 1e-12))
        percussivity = safe(np.sum(y_p**2) / (np.sum(y**2) + 1e-12))
    except Exception:
        harmonicity = percussivity = 0.0
    # noisiness: 1 - harmonicity
    noisiness = safe(1.0 - harmonicity)
    # HNR approx: 10*log10(harmonic_power / noise_power)
    hnr = safe(10*np.log10((np.sum(y_h**2) + 1e-12) / (np.sum(y_p**2) + 1e-12)))

    # ── KICK SPECIFIC: pitch-drop trajectory ──
    # Use larger zero-padded windows for better frequency resolution (~10Hz)
    pitch_drop = None
    if 'kick' in label.lower() or 'kickbass' in label.lower():
        # find first onset
        if len(onsets) > 0:
            on0 = int(onsets[0] * sr)
            seg = y[on0:on0+int(0.06*sr)]
            if len(seg) > 256:
                win_samps = 512  # ~11.6ms
                hop_samps = 128   # ~2.9ms
                fft_n = 4096     # zero-pad → 10.7 Hz resolution
                frames = []
                for i in range(0, len(seg)-win_samps, hop_samps):
                    w = seg[i:i+win_samps] * np.hanning(win_samps)
                    sp = np.abs(np.fft.rfft(w, n=fft_n))
                    fr = np.fft.rfftfreq(fft_n, 1/sr)
                    mask = (fr >= 30) & (fr <= 250)
                    if mask.any():
                        peak_bin = fr[mask][np.argmax(sp[mask])]
                        frames.append((i/sr, float(peak_bin)))
                pitch_drop = frames[:20]  # first 20 frames (~60ms)

    # ── BASS SPECIFIC: filter envelope (centroid over time) ──
    bass_filter_env = None
    if ('bass' in label.lower() and 'kickbass' not in label.lower()) or 'AUDIT-B' in label:
        # spectral centroid per frame for first 100ms of first onset
        if len(onsets) > 0:
            on0 = int(onsets[0] * sr)
            seg = y[on0:on0+int(0.12*sr)]
            if len(seg) > 1024:
                S2 = np.abs(librosa.stft(seg, n_fft=1024, hop_length=256))
                fr2 = librosa.fft_frequencies(sr=sr, n_fft=1024)
                cents = []
                for i in range(S2.shape[1]):
                    col = S2[:, i]
                    c = np.sum(fr2 * col) / (np.sum(col) + 1e-12)
                    cents.append((i*256/sr, float(c)))
                bass_filter_env = cents[:25]

    # ── LEAD SPECIFIC: detuning & modulation depth ──
    lead_metrics = None
    if 'lead' in label.lower() or 'AUDIT-D' in label:
        # Peak frequency in steady-state (200-500ms region of first lead note)
        if len(onsets) > 0:
            on0 = int(onsets[0] * sr)
            seg = y[on0:on0+int(0.4*sr)]
            if len(seg) > 4096:
                S3 = np.abs(librosa.stft(seg, n_fft=8192, hop_length=1024))
                fr3 = librosa.fft_frequencies(sr=sr, n_fft=8192)
                cents_per_frame = []
                amps_per_frame = []
                for i in range(S3.shape[1]):
                    col = S3[:, i]
                    # find peak in 100-2000 Hz
                    mask = (fr3 >= 100) & (fr3 <= 2000)
                    if mask.any():
                        pk = fr3[mask][np.argmax(col[mask])]
                        cents_per_frame.append(pk)
                        amps_per_frame.append(float(np.max(col[mask])))
                if cents_per_frame:
                    f0_arr = np.array(cents_per_frame)
                    # convert to cents from median
                    med = np.median(f0_arr[f0_arr > 0]) if (f0_arr > 0).any() else 1.0
                    cents_dev = 1200 * np.log2((f0_arr + 1e-9) / (med + 1e-9))
                    lead_metrics = {
                        'f0_median_hz': float(med),
                        'f0_std_cents': float(np.std(cents_dev)),
                        'f0_max_cents': float(np.max(cents_dev)),
                        'f0_min_cents': float(np.min(cents_dev)),
                        'amp_mod_depth': float((np.max(amps_per_frame) - np.min(amps_per_frame)) / (np.max(amps_per_frame) + 1e-12)),
                    }

    # ── FULL MIX SPECIFIC: low-end overlap ──
    mix_metrics = None
    if 'AUDIT-E' in label or 'AUDIT-F' in label or 'AUDIT-C' in label:
        # Compute spectral flux over time
        S_flux = librosa.onset.onset_strength(y=y, sr=sr, hop_length=512)
        flux_mean = float(np.mean(S_flux))
        flux_std = float(np.std(S_flux))
        # Masking proxy: ratio of low energy to mid energy in sustained region
        sub_low_pct = pct['sub20_60'] + pct['low60_200']
        mid_pct = pct['lomid200_800'] + pct['mid800_2500']
        # Tempo estimate (BPM detection)
        try:
            tempo = float(librosa.beat.tempo(y=y, sr=sr)[0])
        except Exception:
            tempo = 0.0
        mix_metrics = {
            'sub_plus_low_pct': sub_low_pct,
            'mid_pct': mid_pct,
            'flux_mean': flux_mean,
            'flux_std': flux_std,
            'detected_bpm': tempo,
        }

    return {
        'label': label,
        'path': path,
        'sample_rate': sr,
        'duration_s': dur,
        'num_samples': N,
        'time': {
            'peak': peak, 'peak_db': peak_db,
            'rms': rms_all, 'rms_db': rms_db,
            'crest_factor': crest,
            'lufs_estimate': lufs,
            'dc_offset': dc,
        },
        'spectrum': {
            'centroid_hz': centroid,
            'spread_hz': spread,
            'rolloff_85_hz': rolloff,
            'flatness': flatness,
            'bands_pct': pct,
        },
        'transient': {
            'onset_strength_max': onset_env,
            'onset_strength_mean': onset_mean,
            'attack_time_s': attack_time,
            'decay_time_s': decay_time,
            'transient_duration_s': transient_dur,
            'num_onsets': len(onsets),
            'onset_rate_hz': len(onsets) / dur if dur > 0 else 0,
        },
        'dynamics': {
            'dynamic_range_db': dr,
            'rms_envelope_std': rms_var,
            'rms_min': rms_min,
            'rms_max': rms_max,
            'loudness_range_db': lra,
        },
        'pitch': {
            'f0_median_hz': f0_median,
            'f0_mean_hz': f0_mean,
            'f0_std_hz': f0_std,
            'f0_min_hz': f0_min,
            'f0_max_hz': f0_max,
            'pitch_stability': pitch_stability,
        },
        'harmonics': {
            'harmonicity': harmonicity,
            'percussivity': percussivity,
            'noisiness': noisiness,
            'hnr_db': hnr,
        },
        'kick_pitch_drop': pitch_drop,
        'bass_filter_envelope': bass_filter_env,
        'lead_metrics': lead_metrics,
        'mix_metrics': mix_metrics,
    }

def main():
    if len(sys.argv) < 2:
        print('Usage: python3 audition_analyze.py <wav> [label]')
        sys.exit(1)
    path = sys.argv[1]
    label = sys.argv[2] if len(sys.argv) > 2 else None
    r = analyze(path, label)
    print(json.dumps(r, indent=2, default=str))

if __name__ == '__main__':
    main()
