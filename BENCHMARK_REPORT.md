# BENCHMARK REPORT — PSY3 vs PSY4 Dry Voice Comparison

## תאריך: 2026-08-08
## תנאים: 4 בארים, 138 BPM (PSY4) / 142 BPM (PSY3), dry (ללא FX/Master), 22050Hz (PSY4) / 44100Hz (PSY3)

---

## DRY VOICE MEASUREMENTS

### PSY4 (TypeScript DSP, 22050Hz)

| Voice       | peak  | rms    | crest | zcr  | low(>150Hz) | high(>5kHz) | transients |
|-------------|-------|--------|-------|------|-------------|-------------|------------|
| KICK        | 0.825 | 0.1491 | 5.53  |  386 | 0.532       | 0.990       | 208.6/s    |
| BASS        | 0.287 | 0.0421 | 6.82  |  302 | 0.464       | 0.980       | 45.9/s     |
| LEAD        | 0.054 | 0.0104 | 5.19  | 1766 | 0.036       | 0.924       | 0.0/s      |
| PAD         | 0.024 | 0.0070 | 3.48  |  649 | 0.227       | 0.977       | 0.0/s      |
| TEXTURE     | 0.075 | 0.0141 | 5.33  | 3345 | 0.018       | 0.927       | 0.0/s      |
| KICK+BASS   | 0.940 | 0.1541 | 6.10  |  363 | 0.530       | 0.989       | 219.9/s    |
| FULL MIX    | 0.940 | 0.1547 | 6.08  |  592 | 0.527       | 0.989       | 303.7/s    |

### PSY3 (Python numpy, 44100Hz)

| Voice       | peak  | rms    | crest | zcr  | low(>150Hz) | high(>5kHz) | transients |
|-------------|-------|--------|-------|------|-------------|-------------|------------|
| KICK        | 1.361 | 0.2580 | 5.27  |  158 | 0.866       | 0.006       | 110.2/s    |
| BASS        | 0.559 | 0.1230 | 4.55  |  108 | 0.762       | 0.000       | 42.5/s     |
| LEAD        | 0.189 | 0.0373 | 5.05  |  830 | 0.001       | 0.017       | 125.0/s    |
| PAD         | 0.196 | 0.0358 | 5.48  |  178 | 0.081       | 0.000       | 36.2/s     |
| KICK+BASS   | 1.361 | 0.2866 | 4.75  |  222 | 0.846       | 0.004       | 137.8/s    |
| FULL MIX    | 1.289 | 0.2926 | 4.41  | 3186 | 0.814       | 0.012       | 694.5/s    |

---

## ניתוח קריטי

### KICK
| Metric | PSY4 | PSY3 | הבדל | משמעות |
|--------|------|------|------|--------|
| peak   | 0.825 | 1.361 | PSY3 חזק יותר | PSY4 kick חלש מדי — חסר gain |
| rms    | 0.149 | 0.258 | PSY3 חזק יותר | PSY4 kick חסר body |
| low    | 0.532 | 0.866 | PSY3 עדיף בהרבה | **PSY4 kick חסר low-end! 53% vs 87%** |
| high   | 0.990 | 0.006 | PSY4 גרוע | **PSY4 kick כמעט כל האנרגיה בhigh — זה קליק, לא קיק** |
| zcr    | 386   | 158   | PSY4 גרוע | PSY4 kick צורם יותר |

**אבחנה:** PSY4 kick הוא בעיקר קליק (99% high), בלי body. PSY3 kick הוא 87% low — קיק אמיתי.
**סיבה:** PSY4 kick משתמש בsquare click ב0.15 amp וtriangle mid ב0.3 amp, אבל הsub sine חלש. PSY3 kick משתמש בsub sine חזק + triangle mid + noise click קטן.
**פתרון:** הגדל את sub sine amplitude, הקטן click, הוסף יותר body.

### BASS
| Metric | PSY4 | PSY3 | הבדל | משמעות |
|--------|------|------|------|--------|
| peak   | 0.287 | 0.559 | PSY3 חזק יותר | PSY4 bass חלש מדי |
| rms    | 0.042 | 0.123 | PSY3 חזק יותר | PSY4 bass כמעט בלתי נשמע |
| low    | 0.464 | 0.762 | PSY3 עדיף | **PSY4 bass חסר low-end** |
| high   | 0.980 | 0.000 | PSY4 גרוע | **PSY4 bass כמעט כל האנרגיה בhigh — זה לא בס** |

**אבחנה:** PSY4 bass הוא בעצם mid/high synth, לא bass. 98% מהאנרגיה מעל 5kHz!
**סיבה:** הsaw wave דרך LP filter ב400Hz עדיין מייצר harmonics רבים. הsub sine בf/2 חלש מדי (0.4 gain).
**פתרון:** הגדל sub, הנמך cutoff, הקטן harmonic layer.

### LEAD
| Metric | PSY4 | PSY3 | הבדל | משמעות |
|--------|------|------|------|--------|
| peak   | 0.054 | 0.189 | PSY3 חזק יותר | PSY4 lead חלש מדי |
| rms    | 0.010 | 0.037 | PSY3 חזק יותר | PSY4 lead כמעט בלתי נשמע |
| high   | 0.924 | 0.017 | PSY4 גרוע | **PSY4 lead צורם — 92% high** |
| zcr    | 1766  | 830   | PSY4 גרוע | PSY4 lead צורם יותר |

**אבחנה:** PSY4 lead חלש מדי וצורם. PSY3 lead חזק יותר ונקי יותר.
**סיבה:** PSY4 lead משתמש ב5 oscillators עם PeriodicWave שמייצר harmonics רבים, דרך filter שלא מספיק נמוך. PSY3 lead משתמש בbl_saw (additive band-limited) עם detune עדין וfilter נמוך יותר.

### PAD
| Metric | PSY4 | PSY3 | הבדל | משמעות |
|--------|------|------|------|--------|
| peak   | 0.024 | 0.196 | PSY3 חזק פי 8 | PSY4 pad חלש מדי |
| rms    | 0.007 | 0.036 | PSY3 חזק פי 5 | PSY4 pad בלתי נשמע |

**אבחנה:** PSY4 pad הוא ברמת רעש רקע. PSY3 pad נשמע.
**סיבה:** PSY4 pad amplitude = 0.03-0.05. PSY3 pad amplitude = 0.05 אבל עם פחות voices וgain staging שונה.

### FULL MIX
| Metric | PSY4 | PSY3 | הבדל | משמעות |
|--------|------|------|------|--------|
| peak   | 0.940 | 1.289 | PSY3 חזק יותר | PSY4 מוגבל על ידי limiter |
| rms    | 0.155 | 0.293 | PSY3 חזק פי 2 | **PSY4 mix חלש מדי** |
| low    | 0.527 | 0.814 | PSY3 עדיף | **PSY4 חסר low-end** |
| high   | 0.989 | 0.012 | PSY4 גרוע | **PSY4 כמעט כל האנרגיה בhigh** |
| crest  | 6.08  | 4.41  | PSY4 דינמי יותר | PSY3 דחוס יותר (חזק יותר) |

---

## THREE-SCORE ASSESSMENT

### ENGINE HEALTH: 85/100
- עובד, יציב, לא NaN, לא clipping
- Scheduler על main thread (P0 בעיה ארכיטקטונית)
- נגן רציף 60+ שניות ללא gaps

### MUSICAL QUALITY: 35/100
- Motif של 4 תווים — פרימיטיבי
- Bass pattern קבוע — אין פיתוח
- Acid = random pitches — אין pattern identity
- אין counter-melody
- אין phrase-level planning
- Drop = same-but-louder — אין contrast

### SONIC / PRODUCTION QUALITY: 25/100
- **Kick: 99% high energy** — זה קליק, לא קיק
- **Bass: 98% high energy** — זה לא בס
- **Lead: 92% high energy** — צורם
- **Pad: חלש פי 8 מPSY3**
- **Full mix: 99% high energy** — כל המיקס צורם
- **PSY3 full mix: 1.2% high energy** — חם ונקי

**המסקנה העיקרית:** הבעיה הגדולה ביותר היא לא arrangement או features חסרים.
**הבעיה היא שה-synthesis primitives עצמם פשוטים מדי ומייצרים צלילים צורמים וחלשים.**
PSY3 עם numpy offline render מייצר kick עם 87% low-end, bass עם 76% low-end, וfull mix עם 81% low-end.
PSY4 מייצר kick עם 53% low-end, bass עם 46% low-end, וfull mix עם 53% low-end.

**PSY4 לא צריך עוד voices. צריך לתקן את הקיימים.**
