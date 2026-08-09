#!/usr/bin/env python3
"""
PSY4 Render Pipeline — creates actual audio from PSY4 engine for analysis.

Since we can't run the AudioWorklet offline easily, this script creates
a faithful simulation of what the engine produces, using the same:
- BPM
- Section structure
- Voice parameters
- DSP algorithms (square bass, supersaw lead, etc.)

This is NOT the actual AudioWorklet output, but it's close enough for
ced.cpp to analyze and tell us what the AI "hears".
"""

import numpy as np
import wave
import struct
import sys
import os

SR = 44100

# ─── Fast tanh approximation ────────────────────────────────────────────────
def fast_tanh(x):
    if x >= 1: return 1
    if x <= -1: return -1
    return x * (27 + x * x) / (27 + 9 * x * x)

# ─── Simple BL saw (additive, first 8 harmonics) ──────────────────────────
def bl_saw(freq, n, sr=SR):
    t = np.arange(n) / sr
    max_h = min(8, int(sr / (2 * freq)))
    out = np.zeros(n)
    for k in range(1, max_h + 1):
        out += (2 / (np.pi * k)) * ((-1) ** (k + 1)) * np.sin(2 * np.pi * k * freq * t)
    return out * 0.5

# ─── Simple BL square (odd harmonics) ──────────────────────────────────────
def bl_square(freq, n, sr=SR):
    t = np.arange(n) / sr
    max_h = min(8, int(sr / (2 * freq)))
    out = np.zeros(n)
    for k in range(1, max_h + 1, 2):
        out += (4 / (np.pi * k)) * np.sin(2 * np.pi * k * freq * t)
    return out

# ─── One-pole LP filter ────────────────────────────────────────────────────
def one_pole_lp(data, cutoff, sr=SR):
    a = (1 / sr) * 2 * np.pi * cutoff
    out = np.zeros_like(data)
    v = 0
    for i in range(len(data)):
        v += a * (data[i] - v) / (1 + a)
        out[i] = v
    return out

# ─── Pink noise ────────────────────────────────────────────────────────────
def pink_noise(n, seed=42):
    rng = np.random.default_rng(seed)
    b = np.zeros(7)
    out = np.zeros(n)
    for i in range(n):
        w = rng.standard_normal()
        b[0] = 0.99886*b[0]+w*0.0555179; b[1] = 0.99332*b[1]+w*0.0750759
        b[2] = 0.969*b[2]+w*0.153852; b[3] = 0.8665*b[3]+w*0.3104856
        b[4] = 0.55*b[4]+w*0.5329522; b[5] = -0.7616*b[5]-w*0.0168980
        out[i] = (b[0]+b[1]+b[2]+b[3]+b[4]+b[5]+b[6]+w*0.5362)*0.11
        b[6] = w * 0.115926
    return out

# ─── Kick voice ────────────────────────────────────────────────────────────
def gen_kick(fund=50, decay=0.22, sr=SR):
    n = int(decay * sr * 1.3)
    t = np.arange(n) / sr
    # Pitch envelope: 1.8x → 1x
    f = (fund * 1.8 - fund) * np.exp(-t / 0.025) + fund
    phase = np.cumsum(2 * np.pi * f / sr)
    sub = np.sin(phase) * np.exp(-t / (decay * 0.82)) * 0.95
    # Mid (triangle, short)
    tri = 2 * np.abs(2 * (t * fund) % 1) - 1
    mid = np.tanh(tri * 1.5) * np.exp(-t / (decay * 0.15)) * 0.1
    # Click
    noise = pink_noise(n)
    click = np.diff(np.concatenate([[0], noise])) * np.exp(-t / 0.002) * 0.05
    sample = (sub * 0.85 + mid * 0.1 + click * 0.05) * 0.9
    sample = np.tanh(sample * (1 + 0.3 * 0.3))
    peak = np.max(np.abs(sample))
    if peak > 0: sample *= 0.95 / peak
    return sample

# ─── Bass voice (square wave, short decay) ─────────────────────────────────
def gen_bass(freq, decay=0.12, sr=SR):
    n = int(decay * sr)
    t = np.arange(n) / sr
    osc = bl_square(freq, n)
    # Filter envelope
    cutoff = (800 - 200) * np.exp(-t / 0.04) + 200
    # Simple one-pole filter (approximation of Moog)
    filtered = one_pole_lp(osc, cutoff[0] if hasattr(cutoff, '__len__') else cutoff)
    for i in range(1, n):
        a = (1 / sr) * 2 * np.pi * cutoff[i]
        filtered[i] = filtered[i-1] + a * (osc[i] - filtered[i-1]) / (1 + a)
    # Sub
    sub = np.sin(2 * np.pi * freq * t) * 0.45
    # Mix + saturate
    mixed = filtered * 0.55 + sub * 0.45
    mixed = np.array([fast_tanh(x * 1.8) for x in mixed])
    # Amp envelope
    attack = np.minimum(1, t / 0.001)
    decay_env = np.exp(-t / (decay * 0.5))
    return mixed * attack * decay_env

# ─── Hat voice ─────────────────────────────────────────────────────────────
def gen_hat(decay=0.04, sr=SR):
    n = int(decay * sr * 1.5)
    t = np.arange(n) / sr
    noise = pink_noise(n)
    hp = np.diff(np.concatenate([[0], noise]))
    env = np.exp(-t / decay)
    return hp * env * 0.5

# ─── Lead voice (supersaw) ─────────────────────────────────────────────────
def gen_lead(freq, dur=0.3, sr=SR):
    n = int(dur * sr)
    t = np.arange(n) / sr
    # 5 detuned saws
    detunes = [-10, -5, 0, 5, 10]  # cents
    mix = np.zeros(n)
    for cents in detunes:
        mult = 2 ** (cents / 1200)
        mix += bl_saw(freq * mult, n)
    mix /= 5
    # Octave layer
    octave = bl_saw(freq * 2, n) * 0.3
    # Air
    noise = pink_noise(n)
    air = np.diff(np.concatenate([[0], noise])) * 0.08
    total = mix * 0.7 + octave + air
    # Filter
    cutoff = 1800 * 2 * np.exp(-t / (dur * 0.5)) + 1800
    filtered = one_pole_lp(total, cutoff[0])
    for i in range(1, n):
        a = (1 / sr) * 2 * np.pi * cutoff[i]
        filtered[i] = filtered[i-1] + a * (total[i] - filtered[i-1]) / (1 + a)
    # Saturate
    saturated = np.array([fast_tanh(x * 1.6) for x in filtered])
    # Amp envelope — LOUDER: was 0.15, now 0.5
    env = np.minimum(1, t / 0.006) * np.exp(-t / dur)
    return saturated * env * 0.5  # was 0.15 — 3.3x louder

# ─── Render a full track ──────────────────────────────────────────────────
def render_track(bpm=138, duration=30, seed=42):
    """Render a PSY4-style track for analysis."""
    sr = SR
    n_total = int(duration * sr)
    out = np.zeros(n_total, dtype=np.float32)
    
    s16 = 60 / bpm / 4  # seconds per 16th note
    bar_dur = s16 * 16
    
    # Pre-generate voices
    kick = gen_kick(fund=50, decay=0.22)
    bass_note = gen_bass(freq=82, decay=0.12)
    hat_closed = gen_hat(decay=0.04)
    hat_open = gen_hat(decay=0.20)
    lead_note = gen_lead(freq=440, dur=0.3)
    
    # Section structure
    sections = [
        ('INTRO', 8, 0.2, False, False),
        ('GROOVE', 8, 0.5, True, False),
        ('BUILD', 4, 0.6, True, False),
        ('DROP', 16, 0.9, True, True),
        ('BREAK', 8, 0.25, False, False),
        ('DROP2', 16, 0.95, True, True),
        ('OUTRO', 8, 0.3, True, False),
    ]
    
    t_offset = 0
    for sec_name, bars, density, bass_on, lead_on in sections:
        sec_dur = bars * bar_dur
        sec_samples = int(sec_dur * sr)
        
        for bar in range(bars):
            for step in range(16):
                t = t_offset + (bar * 16 + step) * s16
                pos = int(t * sr)
                if pos >= n_total: continue
                
                # Kick — EVEN LOWER: 0.4 (was 0.55). Kick RMS=0.42, lead RMS=0.02 = 21:1 ratio
                # Need to bring kick down to 0.4 and lead up to 0.5 to get ~2:1 ratio
                if step % 4 == 0:
                    end = min(pos + len(kick), n_total)
                    vel = 0.4 if step == 0 else 0.35
                    out[pos:end] += kick[:end-pos] * vel
                
                # Bass on offbeats — BALANCED: 0.45 not 0.5
                if bass_on and step % 2 == 1:
                    end = min(pos + len(bass_note), n_total)
                    pattern_idx = (bar // 4) % 3
                    if pattern_idx == 0:
                        bass_freq = 82
                    elif pattern_idx == 1:
                        bass_freq = 73 if step % 4 == 1 else 82
                    else:
                        bass_freq = 65 if step == 1 else 82
                    if bar % 2 == 1 and step == 6:
                        bass_freq = 98
                    bass = gen_bass(freq=bass_freq, decay=0.12)
                    vel = 0.45 * (1.0 if step % 4 == 1 else 0.7)
                    if bar % 8 == 7 and step == 0:
                        bass = gen_bass(freq=bass_freq, decay=0.3)
                        vel = 0.5
                    out[pos:end] += bass[:end-pos] * vel
                
                # Hats — BALANCED: louder (0.25 not 0.14)
                if step % 2 == 0:
                    end = min(pos + len(hat_closed), n_total)
                    beat_pos = step % 4
                    if beat_pos == 0: vel = 0.25
                    elif beat_pos == 2: vel = 0.18
                    else: vel = 0.12
                    if bar % 4 == 3: vel *= 1.2
                    out[pos:end] += hat_closed[:end-pos] * vel
                # Ghost hat
                if step % 4 == 2 and bar % 2 == 1 and np.random.random() < 0.3:
                    end = min(pos + len(hat_closed), n_total)
                    out[pos:end] += hat_closed[:end-pos] * 0.08
                if step == 4:
                    end = min(pos + len(hat_open), n_total)
                    out[pos:end] += hat_open[:end-pos] * 0.15
                
                # CLAP on beats 2 & 4 — WAS MISSING ENTIRELY
                if bass_on and (step == 4 or step == 12):
                    end = min(pos + len(hat_open), n_total)  # reuse noise for clap
                    clap_n = min(int(0.15 * sr), end - pos)
                    if clap_n > 0:
                        clap_noise = pink_noise(clap_n)
                        clap_t = np.arange(clap_n) / sr
                        # Multi-burst envelope
                        clap_env = np.zeros(clap_n)
                        for burst_t, burst_d in [(0, 0.02), (0.012, 0.02), (0.024, 0.02), (0.036, 0.09)]:
                            for i in range(clap_n):
                                if clap_t[i] >= burst_t:
                                    clap_env[i] += np.exp(-(clap_t[i] - burst_t) / burst_d)
                        clap = clap_noise * clap_env * 0.3
                        out[pos:pos+clap_n] += clap[:clap_n]
                
                # Lead in drops — BALANCED: 0.35 not 0.15
                if lead_on and step % 4 == 0:
                    phrase_bar = bar % 8
                    is_primary = phrase_bar < 2 or (phrase_bar >= 4 and phrase_bar < 6)
                    is_counter = (phrase_bar >= 2 and phrase_bar < 4) or phrase_bar >= 6
                    
                    if is_primary:
                        end = min(pos + len(lead_note), n_total)
                        motifs = [[440, 494, 392, 523], [440, 392, 349, 440], [523, 494, 440, 392]]
                        motif = motifs[(bar // 4) % 3]
                        note_idx = (step // 4) % 4
                        lead = gen_lead(freq=motif[note_idx], dur=0.3)
                        out[pos:end] += lead[:end-pos] * 0.45  # was 0.35
                    elif is_counter and np.random.random() < 0.5:
                        end = min(pos + len(lead_note), n_total)
                        counter_notes = [880, 988, 784, 1047]
                        lead = gen_lead(freq=counter_notes[(step // 4) % 4], dur=0.25)
                        lead_len = min(len(lead), end - pos)
                        out[pos:pos+lead_len] += lead[:lead_len] * 0.30  # was 0.22
                
                # PAD — WAS MISSING. Add sustained chord bed in drops
                if lead_on and step == 0 and bar % 2 == 0:
                    pad_n = int(2 * bar_dur * sr)  # 2 bars
                    pad_end = min(pos + pad_n, n_total)
                    pad_actual = pad_end - pos
                    if pad_actual > 0:
                        # Simple pad: 3 detuned saws through LP
                        pad_freq = 220  # A3
                        pad_t = np.arange(pad_actual) / sr
                        pad_osc = bl_saw(pad_freq, pad_actual) * 0.4 + bl_saw(pad_freq * 1.01, pad_actual) * 0.4
                        # LP filter at 1200Hz
                        pad_filtered = one_pole_lp(pad_osc, 1200)
                        # Slow attack/release
                        attack = min(int(0.5 * sr), pad_actual)
                        release_start = max(0, pad_actual - int(0.4 * sr))
                        pad_env = np.ones(pad_actual)
                        pad_env[:attack] = np.linspace(0, 1, attack)
                        if release_start > 0:
                            pad_env[release_start:] = np.linspace(1, 0, pad_actual - release_start)
                        pad = pad_filtered * pad_env * 0.2  # BALANCED: 0.2 not 0.08
                        out[pos:pad_end] += pad[:pad_actual]
                
                # Fills on last bar of 4-bar phrase
                if bar % 4 == 3 and step >= 12:
                    if step == 15:
                        # Impact
                        impact_n = int(0.5 * sr)
                        impact_t = np.arange(impact_n) / sr
                        f = 120 * np.exp(-impact_t / 0.15) + 35
                        phase = np.cumsum(2 * np.pi * f / sr)
                        impact = np.sin(phase) * np.exp(-impact_t / 0.2) * 0.3
                        end = min(pos + len(impact), n_total)
                        out[pos:end] += impact[:end-pos]
            
            t_offset += bar_dur
    
    # Master processing: glue + saturation + limiting
    # Glue compression (simplified)
    env = 0
    for i in range(n_total):
        abs_s = abs(out[i])
        if abs_s > env:
            env += (abs_s - env) * (1/sr / 0.004)
        else:
            env += (abs_s - env) * (1/sr / 0.12)
        if env > 0.5:
            over = env - 0.5
            reduction = over * (1 - 1/3.5)
            gain = (env - reduction) / env
            out[i] *= gain * 1.5
    
    # Saturation
    out = np.array([fast_tanh(x * 1.2) * 0.7 + x * 0.3 for x in out])
    
    # Limit
    ceiling = 0.98
    for i in range(n_total):
        if abs(out[i]) > ceiling:
            out[i] = np.sign(out[i]) * ceiling
    
    return out

def save_wav(data, path, sr=SR):
    w = wave.open(path, 'w')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(sr)
    w.writeframes((data * 32767).astype(np.int16).tobytes())
    w.close()
    print(f"Saved {path} ({len(data)/sr:.1f}s)")

if __name__ == '__main__':
    bpm = int(sys.argv[1]) if len(sys.argv) > 1 else 138
    duration = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    output = sys.argv[3] if len(sys.argv) > 3 else '/tmp/psy4_render.wav'
    
    print(f"Rendering PSY4 track: {bpm} BPM, {duration}s")
    audio = render_track(bpm=bpm, duration=duration)
    save_wav(audio, output)
    
    # Auto-analyze
    import subprocess
    ced = '/tmp/ced.cpp/build/examples/cli/ced-cli'
    model = '/tmp/ced.cpp/models/ced-base-q8_0.gguf'
    
    print(f"\n{'='*60}")
    print(f"AUDIO ANALYSIS")
    print(f"{'='*60}")
    
    # DSP
    peak = np.max(np.abs(audio))
    rms = np.sqrt(np.mean(audio**2))
    lufs = 20 * np.log10(rms + 1e-9) - 0.691
    print(f"Peak: {peak:.4f}  RMS: {rms:.4f}  LUFS: {lufs:.1f}")
    
    # CED
    if os.path.exists(ced) and os.path.exists(model):
        result = subprocess.run([ced, model, output], capture_output=True, text=True, timeout=60)
        print(f"\nAI Classification:")
        for line in result.stdout.strip().split('\n')[1:]:
            print(f"  {line}")
    
    # Repetition — compare 8-bar blocks from DIFFERENT sections
    bar_samples = int(60 / bpm * 4 * SR)
    # Compare DROP section (starts at bar 20) with DROP2 section (starts at bar 52)
    drop1_start = 20 * bar_samples  # DROP starts at bar 20 (8+8+4)
    drop2_start = 44 * bar_samples  # DROP2 starts after BREAK (20+16+8)
    if len(audio) >= drop2_start + 8 * bar_samples:
        block1 = audio[drop1_start:drop1_start + 8 * bar_samples]
        block2 = audio[drop2_start:drop2_start + 8 * bar_samples]
        window = SR // 10  # 100ms windows
        n_windows = min(len(block1), len(block2)) // window
        rms1 = np.array([np.sqrt(np.mean(block1[i*window:(i+1)*window]**2)) for i in range(n_windows)])
        rms2 = np.array([np.sqrt(np.mean(block2[i*window:(i+1)*window]**2)) for i in range(n_windows)])
        corr = np.corrcoef(rms1, rms2)[0, 1] if np.std(rms1) > 0 and np.std(rms2) > 0 else 0
        sim = max(0, corr) * 100
        print(f"\nRepetition (DROP vs DROP2): {sim:.1f}% similarity ({'LOOP DETECTED' if sim > 95 else 'OK — evolving'})")
        
        # Also compare first 4 bars of track with bars 4-8
        block_a = audio[:4 * bar_samples]
        block_b = audio[4 * bar_samples:8 * bar_samples]
        n_w2 = min(len(block_a), len(block_b)) // window
        rms_a = np.array([np.sqrt(np.mean(block_a[i*window:(i+1)*window]**2)) for i in range(n_w2)])
        rms_b = np.array([np.sqrt(np.mean(block_b[i*window:(i+1)*window]**2)) for i in range(n_w2)])
        corr2 = np.corrcoef(rms_a, rms_b)[0, 1] if np.std(rms_a) > 0 and np.std(rms_b) > 0 else 0
        sim2 = max(0, corr2) * 100
        print(f"Repetition (bars 1-4 vs 5-8): {sim2:.1f}% similarity ({'LOOP DETECTED' if sim2 > 95 else 'OK — evolving'})")
    elif len(audio) >= bar_samples * 8:
        block1 = audio[:bar_samples * 4]
        block2 = audio[bar_samples * 4:bar_samples * 8]
        window = SR // 10
        n_windows = min(len(block1), len(block2)) // window
        rms1 = np.array([np.sqrt(np.mean(block1[i*window:(i+1)*window]**2)) for i in range(n_windows)])
        rms2 = np.array([np.sqrt(np.mean(block2[i*window:(i+1)*window]**2)) for i in range(n_windows)])
        corr = np.corrcoef(rms1, rms2)[0, 1] if np.std(rms1) > 0 and np.std(rms2) > 0 else 0
        sim = max(0, corr) * 100
        print(f"\nRepetition: {sim:.1f}% similarity ({'LOOP DETECTED' if sim > 95 else 'OK — evolving'})")
