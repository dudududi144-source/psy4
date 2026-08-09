#!/usr/bin/env python3
"""
PSY4 Audio Analysis using ced.cpp
Analyzes rendered audio and reports what the AI "hears".
"""

import subprocess
import sys
import os
import json
import numpy as np
import wave

CED_CLI = "/tmp/ced.cpp/build/examples/cli/ced-cli"
CED_MODEL = "/tmp/ced.cpp/models/ced-base-q8_0.gguf"

def analyze_with_ced(wav_path):
    """Run ced-cli on a WAV file and return top-10 tags."""
    result = subprocess.run(
        [CED_CLI, CED_MODEL, wav_path],
        capture_output=True, text=True, timeout=30
    )
    tags = []
    for line in result.stdout.strip().split('\n')[1:]:  # skip first line (filename)
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            score = float(parts[0])
            tag = parts[1]
            tags.append({'score': score, 'tag': tag})
    return tags

def analyze_audio_dsp(wav_path):
    """Basic DSP analysis of a WAV file."""
    w = wave.open(wav_path, 'r')
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    sr = w.getframerate()
    w.close()
    
    n = len(data)
    peak = np.max(np.abs(data))
    rms = np.sqrt(np.mean(data**2))
    crest = peak / (rms + 1e-9)
    lufs = 20 * np.log10(rms + 1e-9) - 0.691
    
    # FFT
    fft_size = min(8192, n)
    windowed = data[:fft_size] * np.hanning(fft_size)
    spectrum = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(fft_size, 1/sr)
    
    def band(lo, hi):
        mask = (freqs >= lo) & (freqs < hi)
        return np.sum(spectrum[mask]**2)
    
    sub = band(20, 60)
    low = band(60, 200)
    mid = band(200, 3000)
    high = band(3000, 20000)
    total = sub + low + mid + high + 1e-9
    
    centroid = np.sum(freqs * spectrum) / (np.sum(spectrum) + 1e-9)
    
    return {
        'duration': n / sr,
        'peak': peak,
        'rms': rms,
        'crest_factor': crest,
        'lufs': lufs,
        'spectral_centroid': centroid,
        'sub_energy_pct': sub / total * 100,
        'low_energy_pct': low / total * 100,
        'mid_energy_pct': mid / total * 100,
        'high_energy_pct': high / total * 100,
    }

def analyze_repetition(wav_path, bpm=138):
    """Check if the audio is looping."""
    w = wave.open(wav_path, 'r')
    data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    sr = w.getframerate()
    w.close()
    
    bar_samples = int(60 / bpm * 4 * sr)
    if len(data) < bar_samples * 4:
        return {'loop_detected': False, 'similarity': 0, 'note': 'Not enough data'}
    
    # Compare 4-bar blocks
    block1 = data[:bar_samples * 4]
    block2 = data[bar_samples * 4:bar_samples * 8]
    
    if len(block2) == 0:
        return {'loop_detected': False, 'similarity': 0, 'note': 'Not enough data'}
    
    # RMS envelope comparison
    window = sr // 10  # 100ms windows
    n_windows = min(len(block1), len(block2)) // window
    rms1 = np.array([np.sqrt(np.mean(block1[i*window:(i+1)*window]**2)) for i in range(n_windows)])
    rms2 = np.array([np.sqrt(np.mean(block2[i*window:(i+1)*window]**2)) for i in range(n_windows)])
    
    # Normalized correlation
    corr = np.corrcoef(rms1, rms2)[0, 1] if np.std(rms1) > 0 and np.std(rms2) > 0 else 0
    similarity = max(0, corr) * 100
    
    return {
        'loop_detected': similarity > 95,
        'similarity': round(similarity, 1),
        'threshold': 95,
    }

def full_analysis(wav_path, bpm=138):
    """Full audio analysis: DSP + CED AI + repetition."""
    print(f"\n{'='*60}")
    print(f"ANALYZING: {wav_path}")
    print(f"{'='*60}")
    
    # DSP analysis
    dsp = analyze_audio_dsp(wav_path)
    print(f"\n--- DSP ANALYSIS ---")
    print(f"Duration:      {dsp['duration']:.2f}s")
    print(f"Peak:          {dsp['peak']:.4f}")
    print(f"RMS:           {dsp['rms']:.4f}")
    print(f"Crest factor:  {dsp['crest_factor']:.2f}")
    print(f"LUFS (approx): {dsp['lufs']:.1f}")
    print(f"Centroid:      {dsp['spectral_centroid']:.0f} Hz")
    print(f"Sub energy:    {dsp['sub_energy_pct']:.1f}%")
    print(f"Low energy:    {dsp['low_energy_pct']:.1f}%")
    print(f"Mid energy:    {dsp['mid_energy_pct']:.1f}%")
    print(f"High energy:   {dsp['high_energy_pct']:.1f}%")
    
    # CED AI analysis
    print(f"\n--- AI AUDIO CLASSIFICATION (ced.cpp) ---")
    tags = analyze_with_ced(wav_path)
    for t in tags[:10]:
        bar = '█' * int(t['score'] * 40)
        print(f"  {t['score']:.4f}  {t['tag']:30s} {bar}")
    
    # Repetition
    print(f"\n--- REPETITION ANALYSIS ---")
    rep = analyze_repetition(wav_path, bpm)
    if rep.get('note'):
        print(f"  {rep['note']}")
    else:
        status = "LOOP DETECTED ⚠️" if rep['loop_detected'] else "OK — evolving"
        print(f"  4-bar similarity: {rep['similarity']:.1f}% (threshold: {rep['threshold']}%)")
        print(f"  Status: {status}")
    
    # Verdict
    print(f"\n--- VERDICT ---")
    is_music = any(t['tag'] == 'Music' and t['score'] > 0.5 for t in tags)
    is_techno = any(t['tag'] in ('Techno', 'Electronic music', 'Electronic dance music') for t in tags)
    is_drums = any(t['tag'] in ('Drum machine', 'Drum', 'Bass drum') for t in tags)
    
    if is_music:
        print(f"  ✅ AI identifies this as MUSIC (confidence: {max(t['score'] for t in tags if t['tag']=='Music')*100:.0f}%)")
    else:
        print(f"  ❌ AI does NOT identify this as music")
    
    if is_techno:
        print(f"  ✅ AI identifies electronic/techno elements")
    
    if is_drums:
        print(f"  ✅ AI identifies drum elements")
    
    if dsp['lufs'] > -14:
        print(f"  ✅ Loudness is commercial-level ({dsp['lufs']:.1f} LUFS)")
    else:
        print(f"  ⚠️ Loudness is low ({dsp['lufs']:.1f} LUFS, target: >-14)")
    
    if dsp['sub_energy_pct'] > 15:
        print(f"  ✅ Sub energy is present ({dsp['sub_energy_pct']:.1f}%)")
    else:
        print(f"  ⚠️ Sub energy is low ({dsp['sub_energy_pct']:.1f}%)")
    
    return {'dsp': dsp, 'tags': tags, 'repetition': rep}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 psy4_audio_analyzer.py <wav_file> [bpm]")
        sys.exit(1)
    
    wav = sys.argv[1]
    bpm = int(sys.argv[2]) if len(sys.argv) > 2 else 138
    full_analysis(wav, bpm)
