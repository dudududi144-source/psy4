# PSY4 — ניתוח הנדסי מסחרי: האם זה יעשה את העבודה?

## ממצאים מבוססי קוד + מדידות runtime

### 1. רדיו — עובד אבל יש בעיות

**מה עובד:**
- התחברות ל-Psyndora Psytrance — ✓ (freqAvg=61, peak=0.3, hasAudio=true)
- ניתוח 7 מדדים — ✓ (warmth=0.80, brightness=1.00, smoothness=0.20)
- עדכון טרגטים — ✓ (COMMERCIAL_TARGETS מתעדכן)
- סנכרון BPM — ✓ (145)
- סנכרון סגנון — ✓ (ACID כשרדיו מנגן ACID)

**מה לא עובד / בעייתי:**

**א. CORS — הבעיה הגדולה ביותר:**
רוב תחנות הרדיו לא שולחות CORS headers. כשיש `crossOrigin = 'anonymous'`
ויש `createMediaElementSource`, דפדפן יכול להשתיק את האודיו.
Psyndora כרגע עובד (אולי כי הם שולחים headers), אבל אחרות לא יעבדו.

**פתרון:** צריך proxy server שמעביר את ה-stream עם CORS headers.
או: להשתמש ב-`<audio>` בלי `createMediaElementSource` (אבל אז אי אפשר לנתח).

**ב. ניתוח רועש:**
- radioLoudness=0.00 בדגימה הראשונה (הרדיו עדיין לא התחיל לנגן)
- brightness=1.00 (מקסימלי — נראה שגוי, אולי בגלל רעש בחיבור)
- הניתוח צריך warmup period (5-10 שניות של "אל תנתח עדיין")

**ג. BPM detection לא מדויק:**
- ה-BPM detector משתמש ב-energy threshold פשוט מדי
- לא עובד טוב כשהרדיו בין טראקים (שקט → BPM נופל ל-0)
- צריך confidence score + hysteresis

---

### 2. Learning — עובד אבל לא מספיק חכם

**מה עובד:**
- 6 CCs נחקרים — ✓ (74, 71, 5, 12, 14, 15)
- rewards מגוונים — ✓ (0.389-0.403, לא זהים)
- COMMERCIAL_TARGETS מתעדכן מרדיו — ✓
- suggestAdjustments משתמש בטרגטים המעודכנים — ✓

**מה לא עובד / בעייתי:**

**א. engineAvgReward = 0.329 — רחוק מ-1.0:**
המנוע מנגן ב-33% מהאיכות של הרדיו. זה רחוק.
הסיבה: ה-reward מודד 7 דברים אבל:
- loudness=0.00 כשרדיו מתחיל → טרגט loudnessMin=0.00 → מנוע לא יודע שזה שגוי
- brightness=1.00 → טרגט brightnessMax=1.0 → מנוע יכול להיות בהיר כמה שרוצה
- הטרגטים מתעדכנים כל 2 שניות → לא יציבים (רדיו מתחלף בין טראקים)

**ב. ה-learning רק משנה CC params:**
זה לא מספיק. CC params שולטים ב:
- cutoff (74) — תדר חיתוך
- res (71) — resonance
- glide (5) — מעבר בין תווים
- drive (12) — סאטורציה
- delay (14) — שליחת delay
- reverb (15) — שליחת reverb

אבל CC params **לא יכולים** לשנות:
- איזה oscillator (saw vs square vs sine)
- איזה envelope (attack/decay/sustain/release)
- איזה קומפוזיציה (איזה תווים, איזה rhythm)
- איזה arrangement (מתי lead נכנס, מתי breakdown)
- את ה-master chain (compression, EQ)

**ג. אין השוואה ישירה:**
ה-learning מודד את המנוע עם `analyzeQuality()` ומשווה ל-COMMERCIAL_TARGETS.
אבל הוא לא מודד את ההפרש בין מנוע לרדיו באותו רגע.
הוא צריך: `delta = engine.brightness - radio.brightness` ואז לתקן לפי delta.

---

### 3. מה דרוש כדי להגיע לפתרון

**שלב 1: תקן את הניתוח (1-2 שעות)**
- [ ] הוסף warmup: אל תנתח ב-5 שניות הראשונות
- [ ] הוסף confidence score ל-BPM (אל תסנכרן אם confidence < 0.5)
- [ ] הוסף smoothing: ממוצע נע של 3 דגימות אחרונות
- [ ] תקן brightness: הגבל ל-0.8 מקסימלי (1.0 אומר "רעש לבן")

**שלב 2: השוואה ישירה (2-3 שעות)**
- [ ] בכל tick, מדוד גם מנוע וגם רדיו
- [ ] חשב delta = engine - radio לכל מדד
- [ ] התאם CC ישירות לפי delta (לא רק לפי absolute target)
- [ ] אם engine.brightness > radio.brightness → הפחת cutoff
- [ ] אם engine.warmth < radio.warmth → העלה bass (לא יכול דרך CC! צריך volume)

**שלב 3: שליטה מעבר ל-CC (יום-יומיים)**
- [ ] הוסף שליטה על volume per-device (drum/melodic/lead/sampler)
- [ ] הוסף שליטה על envelope (attack/decay/release) — דרך lead worklet
- [ ] הוסף שליטה על oscillator mix (fundamental vs octave vs sub)
- [ ] הוסף שליטה על composition (bass pattern density, lead motif complexity)

**שלב 4: CORS proxy (יום)**
- [ ] בנה proxy server (Cloudflare Worker או Vercel edge function)
- [ ] כל בקשה ל-`/radio-proxy?url=XXX` מחזירה את ה-stream עם CORS headers
- [ ] זה יפתח את כל 10 ה-streams, לא רק את Psyndora

---

### 4. סיכום: האם זה יעשה את העבודה?

**כרגע: לא.** המערכת מתחברת לרדיו ומודדת, אבל:
1. הניתוח רועש (brightness=1.0, loudness=0.0)
2. ה-learning רק משנה CC (לא מספיק)
3. אין השוואה ישירה engine-vs-radio
4. אין warmup, אין confidence, אין smoothing

**אחרי התיקונים: כן, בערך.** עם:
1. ניתוח מדויק (warmup + smoothing + confidence)
2. השוואה ישירה (delta-based adjustments)
3. שליטה מעבר ל-CC (volume + envelope + mix)
4. CORS proxy לכל ה-streams

המערכת תוכל ללמוד מרדיו ולהתקרב לסאונד מסחרי.

**זמן מוערך לפתרון מלא:** 2-3 ימי עבודה.
