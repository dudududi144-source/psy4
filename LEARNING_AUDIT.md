# PSY4 — מצב ה-learning: דוח כן מלא

## 1. מה אנחנו לומדים עכשיו?

### ✅ מה עובד:
1. **SoundDNA extraction** — כל onset (מרדיו/loop) מנותח:
   - brightness (spectral centroid)
   - subEnergy / midEnergy / highEnergy
   - transientSharpness
2. **Role classification** — kick/bass/lead/hat/perc/acid/pad/clap/shaker/texture
3. **SoundBank** — שומר entries עם matchScore + reward ב-localStorage
4. **Scale/key detection** — מרדיו (rootPc + scaleName)
5. **RewardTracker** — עוקב אחר occupancy ומעדכן reward
6. **QualityAnalyzer** — מודד 5 מדדים (spectral/dynamic/stereo/transient/clarity)

### ❌ מה לא עובד / חסר:
1. **ה-learning לא משפיע על drums** — engine v3 הוא fixed synth (kick/hat/snare/etc), אי אפשר לשנות params
2. **רק melodic (bass/lead/acid/pad) מקבל CC params** — אבל רק cutoff/resonance/glide
3. **אין real-time feedback loop** — QualityAnalyzer מודד אבל לא מאכיל את ה-reward אמיתית
4. **SynthesisMatcher לא עובד עם engine v3** — renderVoice לא נתמך (drums only)
5. **אין learning מ-loop files** — לא נבדק עם engine v3
6. **Reward הוא "synthetic"** — כשאין רדיו, reward מבוסס על occupancy synthetic (לא אמיתי)

## 2. באיזה רמה ה-learning משפיע על הסאונד?

**רמה: 20%** — רק cutoff/resonance/glide של psysynth (melodic). ה-drums לא מושפעים כלל.

## 3. האם המנוע יודע "לשחק לייב"?

### ❌ לא מספיק:
- **אין נגינה לייב אמיתית** — ה-engine מנגן events מ-composition-worker (pre-composed)
- **אין MIDI input** — לא יכול לנגן עם keyboard
- **אין real-time parameter control** — רק CC params בסיסיים
- **אין real effects** — רק master chain (multiband + sidechain + stereo), אבל:
  - אין reverb (רק send)
  - אין delay (רק send)
  - אין filter sweeps
  - אין distortion
  - אין modulation

## 4. הדג השמן: Tone.js

מהרשת מצאתי את הפתרון המהיר: **Tone.js** — Web Audio framework עם:
- **Synths מוכנים** (MonoSynth, PolySynth, FMSynth, AMSynth)
- **Effects מוכנים** (Reverb, Delay, Filter, Distortion, Chorus, Phaser)
- **Presets** — אפשר לטעון sounds מוכנים
- **Transport** — scheduling מדויק
- **MIDI input** — נגינה live
- **Sample loading** — SoundFont support

### למה Tone.js?
1. **חינמי + open source** (MIT)
2. **מוכן ל-production** — נפוץ ויציב
3. **מכסה הכל** — synths + effects + scheduling + MIDI
4. **מתחבר ל-Web Audio** — עובד עם ה-AudioContext שלנו
5. **מהיר לחבר** — כמה שורות קוד

### מה ניקח מ-Tone.js?
1. **Effects chain** — Reverb, Delay, Distortion, Chorus לכל voice
2. **Synth presets** — sounds מוכנים ל-bass/lead/pad
3. **MIDI input** — נגינה live מ-keyboard
4. **Real-time control** — parameter automation
5. **Transport** — timing מדויק

### מה לא ניקח (הייחוד שלנו)?
- **Composition engine** — נשאר שלנו (causal + deterministic)
- **Learning loop** — נשאר שלנו (SoundBank + RewardTracker)
- **Psytrance arrangement** — נשאר שלנו (64-bar cycle)
- **psysynth contract** — נשאר שלנו

## 5. תוכנית ביצוץ מהירה

### שלב 1: התקן Tone.js + חבר effects
- npm install tone
- הוסף Reverb + Delay + Distortion לכל voice
- חבר ל-AudioContext הקיים

### שלב 2: הוסף synth presets
- טען presets מ-Tone.js ל-bass/lead/pad
- החלף את psysynth patches ב-Tone.js synths (יותר עשירים)

### שלב 3: MIDI input
- WebMIDI API
- נגינה live מ-keyboard
- נתיב MIDI → psysynth → effects → master

### שלב 4: Real-time learning
- חבר QualityAnalyzer → RewardTracker (real feedback)
- התאם params בזמן אמת לפי quality metrics

### שלב 5: Live performance mode
- Toggle "Live" ב-UI
- נגן עם keyboard + auto-composition
- ה-engine מלווה את הנגן
