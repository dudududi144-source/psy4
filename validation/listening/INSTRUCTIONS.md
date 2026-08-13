# Blind Listening Protocol

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
