#!/usr/bin/env python3
"""
PSY4 Vertical Validation — Blind Listening Protocol Setup

Creates:
  - validation/listening/blind-renders/  (45 WAVs with SHA-hashed filenames)
  - validation/listening/rating-sheet.csv (empty rating sheet for listener)
  - validation/listening/key.json (mapping hash → real variant, kept secret until analysis)
  - validation/listening/playlist.m3u (randomized playback order)
"""

import os
import json
import hashlib
import random
import shutil
from pathlib import Path

RENDERS_DIR = '/home/z/my-project/validation/renders'
BLIND_DIR = '/home/z/my-project/validation/listening/blind-renders'
LISTENING_DIR = '/home/z/my-project/validation/listening'

os.makedirs(BLIND_DIR, exist_ok=True)

UNITS = [(c, s) for c in ['comp-1', 'comp-2', 'comp-3'] for s in [1, 2, 3]]
VARIANTS = ['A', 'B', 'C', 'D', 'E']

# Build mapping
key = {}
blind_files = []
for comp, seed in UNITS:
    for variant in VARIANTS:
        src = os.path.join(RENDERS_DIR, f'{comp}-seed{seed}-{variant}.wav')
        if not os.path.exists(src):
            print(f'MISSING: {src}')
            continue
        # Hash filename
        h = hashlib.sha256(f'{comp}-seed{seed}-{variant}'.encode()).hexdigest()[:12]
        dst = os.path.join(BLIND_DIR, f'{h}.wav')
        shutil.copy2(src, dst)
        key[h] = {'comp': comp, 'seed': seed, 'variant': variant}
        blind_files.append(h)

# Save key (secret until analysis)
with open(os.path.join(LISTENING_DIR, 'key.json'), 'w') as f:
    json.dump(key, f, indent=2)

# Randomize playback order (seeded for reproducibility)
rng = random.Random(20260812)
randomized = blind_files[:]
rng.shuffle(randomized)

# Write playlist
with open(os.path.join(LISTENING_DIR, 'playlist.m3u'), 'w') as f:
    f.write('#EXTM3U\n')
    for i, h in enumerate(randomized, 1):
        f.write(f'#EXTINF:-1,Render {i:02d}\n')
        f.write(f'{h}.wav\n')

# Write rating sheet
with open(os.path.join(LISTENING_DIR, 'rating-sheet.csv'), 'w') as f:
    f.write('render_id,filename,kick_quality,bass_quality,lead_quality,mix_quality,commercial,notes\n')
    for i, h in enumerate(randomized, 1):
        f.write(f'{i:02d},{h}.wav,,,,,,\n')

# Write instructions
with open(os.path.join(LISTENING_DIR, 'INSTRUCTIONS.md'), 'w') as f:
    f.write("""# Blind Listening Protocol

## Setup
- Use the same headphones/speakers you'd use to judge psytrance.
- Play at -16 LUFS playback gain (level-matched). If your player doesn't support LUFS, just pick a comfortable volume and keep it constant.
- Take a 2-minute break every 9 renders (to prevent ear fatigue).

## Task per render
1. Listen to the full render.
2. Rate 4 dimensions on a 1-5 Likert scale:
   - **kick_quality**: 1=terrible, 5=commercial psytrance kick
   - **bass_quality**: 1=terrible, 5=commercial psytrance bass
   - **lead_quality**: 1=terrible, 5=commercial psytrance lead
   - **mix_quality**: 1=terrible, 5=commercial mix
3. Rate overall: **commercial** (1=no, not commercial; 5=yes, fully commercial)
4. Optional: notes on what's wrong/good.

## After all 45
- Save the completed rating-sheet.csv.
- Run: `python3 validation/listening/analyze-listening.py`
- This will reveal the labels and compute H5 (evaluator/perception agreement) and the H6 human component.

## Important
- Do NOT look at key.json until after rating.
- The filenames are SHA hashes — they reveal nothing about the variant.
- Renders are in randomized order (not A/B/C/D/E).
""")

print(f'Created {len(blind_files)} blind renders in {BLIND_DIR}')
print(f'Rating sheet: {LISTENING_DIR}/rating-sheet.csv')
print(f'Playlist: {LISTENING_DIR}/playlist.m3u')
print(f'Key (secret): {LISTENING_DIR}/key.json')
print(f'Instructions: {LISTENING_DIR}/INSTRUCTIONS.md')
print(f'\nListener: open {LISTENING_DIR}/INSTRUCTIONS.md to begin.')
