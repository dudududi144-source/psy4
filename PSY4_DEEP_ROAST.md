# PSY4 — ROAST חריף ובוטה

## האמת הכואבת

PSY4 נשמע כמו **דמו סינת' עם רעש מקצועי מעל**. התופים נשמעים כמו תופים אמיתיים (909/MachineDrum). אבל כל מה שמתחת לתופים — הבאס, הליד, הפאד, האסיד, ה-texture — נשמע כמו **פרויקט סטודנט ב-FL Studio**. הסיבה לא חסרה דגימות. הסיבה היא שה-DSP של הקולות המלודיים הוא **פרימיטיבי**.

---

## 7 בעיות שגורמות לזה להישמע כמו דמו

### 1. הליד הוא 5x BL-Saw דרך Moog — זה לא ליד, זה אוסילטור
- 5 saws עם detune = supersaw גנרי. כל מתחיל ב-FL Studio עושה את זה.
- **בעיה אמיתית**: אין layer של גובה (octave-up), אין sub-layer, אין noise/air, אין delay throw, אין resonance movement, אין filter automation שמרגיש ידני.
- **מה צריך**: Lead = fundamental + octave layer + air/noise + saturation + delay throw + filter movement. לא רק "supersaw".

### 2. הפאד הוא 2x BL-Saw דרך Moog — זה לא פאד, זה אורגן
- 2 saws עם detune + slow envelope = צליל סטטי שלא זז.
- **בעיה אמיתית**: אין slow filter sweep, אין chorus/detune movement, אין stereo width משמעותי, אין shimmer/air. ה-LFO שמנע את ה-detune זז ב-0.1Hz — כל כך לאט שזה בלתי מורגש.
- **מה צריך**: Pad = 3+ oscillators + slow filter sweep + chorus movement + stereo width + reverb + shimmer/air.

### 3. האסיד הוא BL-Square דרך Moog — זה לא אסיד, זה באז
- Square wave + resonant filter + distortion = התחלה, אבל ה-envelope של ה-cutoff יורד **לינארית** (exponential). אסיד אמיתי צריך envelope ש**עולה ויורד** — resonance peak שזז.
- **בעיה אמיתית**: ה-filter sweep הוא חד-כיווני (גבוה→נמוך). אסיד אמיתי עושה up-down, לפעמים wobble, לפעמים held resonance.
- **מה צריך**: Acid = square + Moog with bidirectional cutoff LFO + envelope + heavy distortion + resonance peak movement.

### 4. ה-texture הוא FM פרימיטיבי או רעש — לא פסיכדלי
- FM: carrier + modulator עם index קבוע. זה נשמע כמו סירנה, לא כמו texture.
- Noise: pink noise דרך bandpass שזז. זה נשמע כמו רוח, לא כמו אווירה.
- **בעיה אמיתית**: אין granular, אין wavetable, אין morphing, אין multiple layers, אין evolving spectrum.
- **מה צריך**: Texture = multiple detuned oscs + slow filter morph + noise bed + stereo movement + reverb.

### 5. ה-bass envelope הוא חד-צדדי — אין groove
- Attack 1ms + exponential decay = pluck. זה נכון אבל חסר **sustain portion**.
- **בעיה אמיתית**: באס פסיכדלי צריך לפעמים short pluck ולפעמים sustained note. עכשיו כל באס = 120ms pluck. זה יוצר מכונה, לא מוזיקה.
- **מה צריך**: Bass עם mode נשלף: pluck (short decay) או sustain (held note with slight decay).

### 6. הקיק נשמע טוב אבל לא מתחבר לבאס — אין interlock
- הקיק מתנגן על beat, הבאס מתנגן על offbeat. אבל הם לא **מדברים** אחד עם השני.
- **בעיה אמיתית**: אין frequency separation מדודה. הקיק יושב ב-50Hz, הבאס ב-80Hz — אבל אין EQ שמבטיח שהם לא נלחמים. ה-sidechain עובד אבל לא מספיק עמוק.
- **מה צריך**: Sidechain depth: 6-8dB (עכשיו ~3dB). Bass HP at 40Hz (עכשיו 25Hz — נמוך מדי, מתחרה בקיק).

### 7. המאסטר לא מספיק חזק — LUFS נמוך מדי
- יש glue + saturation + limiter אבל ה-gain structure לא נכון.
- **בעיה אמיתית**: ה-makeup gain על ה-bus processors (1.1-1.3x) לא מספיק. ה-master gain (0.92) מוריד את הכל. ה-limiter ceiling (0.95) נמוך מדי. מוזיקה מסחרית נשמעת **חזק** — PSY4 נשמע **חלש**.
- **מה צריך**: Bus makeup גבוה יותר (1.4-1.5x), master gain 1.0, limiter ceiling 0.98, saturation drive גבוה יותר.

---

## מה צריך לקרות עכשיו

1. **ליד**: נוסיף octave-up layer, noise/air layer, ו-delay throw
2. **פאד**: נוסיף slow filter sweep ו-chorus movement
3. **אסיד**: נשנה את ה-filter envelope ל-bidirectional (LFO)
4. **טקסטורה**: נוסיף multiple layers + slow morph
5. **באס**: נוסיף sustain mode
6. **קיק/באס**: נעמיק sidechain ל-6dB, HP bass ל-40Hz
7. **מאסטר**: נגדיל makeup, נעלה ceiling, נגדיל drive
