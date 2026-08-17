# PSY4 — תוכנית ביצוע אנד-טו-אנד

**תאריך:** 2026-08-16
**מבוסס על:** ביקורת קוד אמיתית (4 סוכנים עצמאיים) + אימות חי ב-Agent Browser
**לא מסתמך על** טענות קודמות או סיכומים קודמים

---

## 1. מטרת המוצר (מתוך DEMO.md + ARCHITECTURE.md)

> PSY4 is a **real-time causal composition engine** that generates psytrance music in the browser.
> **Press Play → hear a complete track:** intro → groove → drop → breakdown → rebuild.

**יעדים מרכזיים:**
1. השמעת פסיטראנס רציפה בלחיצה אחת — 12+ ערוצי סאונד, 32-בר עיבוד
2. יכולת למידה מרדיו ומקובצי לופ
3. יצוא/יבוא חבילות סאונד, MIDI, הקלטה, presets
4. רמת איכות מסחרית: multiband + glue + true-peak + LUFS targeting
5. ארכיטקטורה RT-safe: 3 תהליכים (Worker + AudioWorklet + UI), zero-alloc, SAB

---

## 2. מצב נוכחי — אמת ללא כיפות

### ✅ עובד באמת (מאומת בביקורת וב-Agent Browser)

| רכיב | מצב | ראיה |
|------|------|------|
| AudioWorklet engine | עובד | analyser avg=111/255, max=255 (אודיו זורם) |
| 14 voice classes | עובד | audit-B אישר: Kick/Bass/Lead/Acid/Pad/Hat/Clap/Perc/Shaker/Texture/Wavetable/FM/FX/SampleVoice (SnareVoice לא קיים — נעשה reuse ל-ClapVoice) |
| Master chain | עובד חלקית | EQ + glue + tanh + LUFS + limiter + stereo imager + sidechain |
| Composition worker | עובד | 64-bar arrangement, 6 scales, call-response, groove generation |
| SoundBank + SmartExplorer | עובד | 25 entries אחרי 15s, reward tracking פעיל |
| QualityAnalyzer | עובד | 5 מדדים (spectral/dynamic/stereo/transient/clarity) |
| Radio connect/disconnect | עובד | MediaElementSource + CORS + 13 streams |
| Loop learner | עובד | decodeAudioData + loop playback |
| Export/Import package | עובד | JSON עם 10 תפקידים |
| Generate Originals | עובד | createVariation לכל התפקידים |
| Recording | עובד | MediaRecorder |
| Preset save/load | עובד | localStorage |
| Reference analysis + A/B | עובד | decodeAudioData + spectral analysis |
| UI 11 כפתורים + spectrum + bank | עובד | כל הכפתורים מחוברים |

### ❌ באגים קריטיים שזוהו (end-to-end broken)

| # | באג | חומרה | השפעה |
|---|-----|------|-------|
| **B1** | `engineLevel` לא מתעדכן כשרדיו כבוי — LUFS תקוע ב- -80.7 | גבוהה | UI מציג מצב שקרי (האודיו עובד אבל המטר לא זז) |
| **B2** | SharedArrayBuffer **תיאטרלי** — מאותחל אבל `flushEvents()` לא כותב אליו (תמיד Float64Array fallback) | גבוהה | טענת "lock-free zero-copy" שקרית; יש GC pressure מיותר |
| **B3** | `mulberry32` PRNG **מת כימית** — מוגדר אבל אף פעם לא נקרא; 17 קריאות `Math.random()` ב-composition-worker | גבוהה | "deterministic" שקרי — אותו seed לא מייצר אותה יצירה; לא ניתן ל-replay/test |
| **B4** | Multiband compression **מנוטרל** (`const mbOut = eqOut`) | בינונית | חסר שלב קריטי ב-master chain; ידוע ש-Biquad crossover הרג גבוהים |
| **B5** | Sampler **dead code** — 6 SampleVoice instances מאותחלים אבל `triggerVoice` אף פעם לא מפעיל אותם | בינונית | טענת "real samples (909/MD/Nord)" שקרית — הכל סינתזה |
| **B6** | `exportMIDI()` rootPc bug — `this.opts?.rootPc ?? 0` אבל `opts` לא מוגדר ב-class | גבוהה | MIDI יוצא תמיד ב-C major ללא קשר ל-key שזוהה |
| **B7** | **כפילות אירועים** — `executeDecision` ו-`generateGroove` שניהם מייצרים events לאותו `at` עבור hat/shaker/lead/perc/acid | גבוהה | הכפלת עוצמה, voice stealing, artifacts |
| **B8** | `next.config.ts`: `typescript.ignoreBuildErrors: true` | גבוהה | מסתיר שגיאות TS אמיתיות (B6, duplicate getter, private access) |
| **B9** | `compareWithReference()` משתמש ב-RMS חלון יחיד ומתייג כ-LUFS | נמוכה | A/B לא מדויק |
| **B10** | `setVariant()` לא מחיל פרמטרים ל-worklet | נמוכה | אין השפעה שמיעתית |
| **B11** | TextureVoice לא מתוזמן אף פעם מה-composer | נמוכה | תפקיד "texture" לא נשמע |
| **B12** | `kickCount` double-counts כשרדיו+engine פועלים | נמוכה | מדד לא מדויק |

### 🗑️ קוד מת (34,825 שורות)

| תחום | קבצים | שורות |
|------|------|------|
| `src/lib/studio/` (71 קבצים) | 71 | 34,218 |
| `beatPLL.ts` + `melodyObserver.ts` | 2 | 607 |
| **סה"ק** | **73** | **34,825** |

97.4% מ-`studio/` מת. רק `engine/engineWorklet.ts` (281 שורות) חי.

### 🗄️ מסד נתונים מנותק

- `prisma/schema.prisma` מכיל רק `User` + `Post` (template Next.js — לא קשור ל-PSY4)
- `src/lib/db.ts` מייצא PrismaClient אבל אף אחד לא מייבא אותו
- `/api/learn` משתמש ב-`@libsql/client` ישירות עם 3 טבלאות שלא ב-schema
- רק `/api/reference/proxy` (מתוך 7 routes) נקרא מה-frontend

### 🤖 AI SDK

- `z-ai-web-dev-sdk` ב-`package.json` אבל **אף פעם לא מיובא** — אפס שימוש

---

## 3. פער מול מטרת המוצר

### פער 1: "Press Play → hear a complete track" — **חלקית עובד**
- ✅ אודיו זורם (analyser מאשר)
- ❌ LUFS meter מת (B1) — משתמש לא רואה שאודיו פועל
- ❌ Multiband חסר (B4) — איכות master נמוכה ממסחרי
- ❌ "Real samples" שקרי (B5) — הכל סינתזה

### פער 2: "Causal composition engine" — **חלקית עובד**
- ✅ 64-bar arrangement, 6 scales, call-response
- ❌ לא deterministic (B3) — טענה מרכזית של המוצר שקרית
- ❌ כפילות אירועים (B7) — artifacts שמיעתיים

### פער 3: "Commercial sound quality" — **חלקית עובד**
- ✅ EQ + glue + tanh + LUFS + limiter + stereo imager
- ❌ Multiband מנוטרל (B4)
- ❌ Sampler dead (B5) — אין דגימות 909/MD/Nord אמיתיות

### פער 4: "Engineering excellence" — **מסכה**
- ❌ `ignoreBuildErrors: true` (B8) מסתיר באגים
- ❌ SAB תיאטרלי (B2)
- ❌ 34,825 שורות קוד מת

### פער 5: Backend / API / DB — **כמעט לא קיים**
- ❌ Prisma schema ריק מ-PSY4
- ❌ 6/7 API routes לא בשימוש
- ❌ אפס שימוש ב-AI SDK

---

## 4. תוכנית ביצוע — מסודרת לפי עדיפות

### שלב 1: תיקוני קריטי (חוסמי end-to-end)
**יעד:** משתמש לוחץ Play → שומע פסיטראנס + רואה מטרים נכונים

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T1.1** | העבר את עדכון `engineLevel` מחוץ ל-`detect()` (ל-`uiTimer` נפרד) כך שירוץ גם כשרדיו כבוי | `psyLive.ts:2118-2128` | 15 דק' |
| **T1.2** | תקן `exportMIDI()` rootPc — החלף `this.opts?.rootPc ?? 0` בשדה אמיתי מה-transport או מ-CausalComposer | `psyLive.ts:2966` | 20 דק' |
| **T1.3** | תקן כפילות אירועים — `executeDecision` ו-`generateGroove` צריכים לתאם (הסר את ה-trigger מ-`executeDecision` כש-`generateGroove` כבר מייצר, או להיפך) | `composition-worker.js` | 30 דק' |
| **T1.4** | תקן M/S Stereo Imager מיקום — העבר לפני ה-limiter (כעת יכול לחרוג מ-ceiling) | `psy4-engine.js` process() | 15 דק' |

**סה"כ שלב 1:** ~80 דקות

### שלב 2: הפעלת דטרמיניזם (טענה מרכזית של המוצר)
**יעד:** אותו seed → אותה יצירה; ניתן ל-replay/test

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T2.1** | החלף את כל 17 קריאות `Math.random()` ב-`this.rng()` ב-composition-worker | `composition-worker.js` (17 אתרים) | 45 דק' |
| **T2.2** | תקן root-change שמשתמש ב-`Math.random` + רשימת roots קשיחה — השתמש ב-`this.rng()` וב-scale-aware roots | `composition-worker.js` | 20 דק' |
| **T2.3** | חשוף seed ב-UI (read-only display) + אפשרות להגדיר seed קבוע לבדיקות | `page.tsx` + `psyLive.ts` | 30 דק' |

**סה"כ שלב 2:** ~95 דקות

### שלב 3: ניקוי קוד מת (מפחית רעש, מאפשר תחזוקה)
**יעד:** קוד שניתן לתחזוקה, בנייה ללא ignoreBuildErrors

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T3.1** | מחק 71 קבצים מתים ב-`src/lib/studio/` (שמור רק `engine/engineWorklet.ts`) | `src/lib/studio/*` | 10 דק' |
| **T3.2** | מחק `beatPLL.ts` + `melodyObserver.ts` | `src/lib/` | 5 דק' |
| **T3.3** | מחק 3 API routes יתומים (`/api/forensic/*`, `/api/reference/train`, `/api/reference/streams`, `/api/learn`, `/api/route.ts`) | `src/app/api/` | 10 דק' |
| **T3.4** | הסר `typescript.ignoreBuildErrors: true` מ-next.config.ts ותקן את כל שגיאות ה-TS שיתגלו | `next.config.ts` + תיקונים | 60 דק' |
| **T3.5** | מחק legacy audio graph מת ב-`psyLive.ts` (kickBus/bassBus/leadBus/hatBus/mute/duck/engineBus/comp/masterEq/master/safetyLimiter/delay/reverb/noiseBuf/hat/makeShaper) | `psyLive.ts` | 40 דק' |
| **T3.6** | מחק legacy API שכותב ל-nodes יתומים (`setChannelVolume/Mute/Solo`, `setDelayAmount/Feedback`, `setReverbSend`, `setBusVolume`, `unlockStyle/Energy/Density/Tension/Key`, `setVariant` שלא עובד, `scheduleCausalEvent`, `causalEventQueue`) | `psyLive.ts` | 30 דק' |

**סה"כ שלב 3:** ~155 דקות

### שלב 4: הפעלת SharedArrayBuffer באמת (או הסרת הטענה)
**יעד:** תקשורת lock-free אמיתית, או הסרת קוד מטעה

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T4.1** | הפעל `flushEvents()` לכתוב ל-SAB דרך `Atomics.store` + `Atomics.notify` (ה-worklet כבר קורא מ-SAB נכון — רק ה-main thread לא כותב) | `psyLive.ts` + `engineWorklet.ts` | 60 דק' |
| **T4.2** | בדיקת fallback — כש-SAB לא זמין, חזור ל-Float64Array transferable | קיים, ודא שעובד | 15 דק' |
| **T4.3** | עדכן לוג: "SharedArrayBuffer active" רק כשבאמת נכתב אליו | `psyLive.ts` | 5 דק' |

**סה"כ שלב 4:** ~80 דקות

### שלב 5: איכות סאונד מסחרית
**יעד:** master chain מלא עם multiband, אופציה ל-real samples

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T5.1** | החלף Biquad LR2 crossover ב-Linkwitz-Riley 4th-order נכון (או FFT-based split) כדי ש-multiband לא יהרוג גבוהים | `psy4-engine.js` MultibandComp | 90 דק' |
| **T5.2** | הפעל multiband: `const mbOut = this.multiband.process(eqOut, ...)` במקום `const mbOut = eqOut` | `psy4-engine.js:2067` | 5 דק' |
| **T5.3** | חבר SampleVoice ל-trigger — כש-events מגיעים עם `voiceId=V_SAMPLE`, הפעל SampleVoice עם הדגימה המתאימה | `psy4-engine.js triggerVoice` | 40 דק' |
| **T5.4** | טען דגימות 909/MD/Nord אמיתיות (מ-`public/samples/` אם קיימות, או מ-fetch מ-CDN) | `psyLive.ts` initWorkletEngine | 60 דק' |
| **T5.5** | תקן LeadVoice air layer — `this.noise.prevOutput` undefined (PinkNoise לא מגדיר) | `psy4-engine.js LeadVoice` | 10 דק' |

**סה"כ שלב 5:** ~205 דקות

### שלב 6: חיבור backend (אופציונלי — אם נדרש שיתוף/שמירה בענן)
**יעד:** שמירת חבילות בשרת, או שילוב AI

| ID | משימה | קובץ | זמן |
|----|------|------|-----|
| **T6.1** | עדכן `prisma/schema.prisma` עם מודלים של PSY4 (SoundPackage, Preset, Reference) | `prisma/schema.prisma` | 20 דק' |
| **T6.2** | `bun run db:push` ליצירת טבלאות | - | 5 דק' |
| **T6.3** | כתוב API routes אמיתיים: `/api/packages` (GET/POST), `/api/presets` (GET/POST) — לשיתוף חבילות בין משתמשים | `src/app/api/` | 60 דק' |
| **T6.4** | חבר UI: כפתור "Share Package" שמעלה לשרת ומחזיר URL | `page.tsx` | 30 דק' |

**סה"כ שלב 6:** ~115 דקות (אופציונלי)

### שלב 7: אימות end-to-end (חובה)
**יעד:** אימות Agent Browser שכל השרשרת עובדת

| ID | משימה | זמן |
|----|------|-----|
| **T7.1** | לחץ Play → ודא LUFS זז (-10 עד -20), voices > 2, spectrum פעיל | 10 דק' |
| **T7.2** | לחץ על כל 11 הכפתורים → ודא שאף אחד לא זורק שגיאה | 15 דק' |
| **T7.3** | חבר רדיו → ודא ש-onsets מזוהים + style מזוהה + bank גדל | 10 דק' |
| **T7.4** | העלה קובץ לופ → ודא שמתנגן + bank לומד | 10 דק' |
| **T7.5** | Export MIDI → פתח ב-DAW / בדוק header (format 0, 480 tpq, 1 track, key נכון) | 10 דק' |
| **T7.6** | Export/Import Package → ודא ש-JSON תקין ונטען מחדש | 10 דק' |
| **T7.7** | בדוק responsive (mobile width) + sticky footer | 10 דק' |
| **T7.8** | `bun run lint` נקי | 5 דק' |

**סה"כ שלב 7:** ~80 דקות

---

## 5. סיכום זמנים ועדיפויות

| שלב | תיאור | זמן | חובה? |
|------|------|-----|------|
| 1 | תיקוני קריטי | 80 דק' | ✅ חובה |
| 2 | דטרמיניזם | 95 דק' | ✅ חובה (טענה מרכזית) |
| 3 | ניקוי קוד מת | 155 דק' | ✅ חובה (תחזוקה) |
| 4 | SAB אמיתי | 80 דק' | ⚠️ מומלץ |
| 5 | איכות סאונד | 205 דק' | ⚠️ מומלץ |
| 6 | Backend | 115 דק' | ❓ אופציונלי |
| 7 | אימות E2E | 80 דק' | ✅ חובה |
| **סה"כ חובה** | | **410 דק'** | **~7 שעות** |
| **סה"כ עם מומלץ** | | **695 דק'** | **~12 שעות** |
| **סה"כ מלא** | | **810 דק'** | **~13.5 שעות** |

---

## 6. סדר ביצוע מומלץ

```
שלב 1 (תיקוני קריטי)     ←─ ראשון, פותר את באג ה-LUFS הנראה
       ↓
שלב 7 חלקי (אימות Play)   ←─ ודא ש-LUFS זז
       ↓
שלב 3 (ניקוי קוד מת)      ←─ מפחית רעש לפני עבודה עמוקה
       ↓
שלב 2 (דטרמיניזם)         ←─ טענה מרכזית של המוצר
       ↓
שלב 4 (SAB)               ←─ תלוי ב-3 (אחרי ניקוי)
       ↓
שלב 5 (איכות סאונד)       ←─ תלוי ב-2 (deterministic אפשר לבדוק)
       ↓
שלב 7 מלא (E2E)           ←─ אחרון, אימות מקיף
       ↓
שלב 6 (Backend)           ←─ רק אם נדרש
```

---

## 7. קריטריוני הצלחה (Definition of Done)

- [ ] לחיצה על Play → LUFS נע בין -10 ל -25 (לא -80.7)
- [ ] אותו seed מייצר אותה יצירה (בדיקה: יצוא MIDI פעמיים והשוואה byte-to-byte)
- [ ] `bun run lint` נקי ללא warnings
- [ ] בנייה ללא `ignoreBuildErrors` עוברת
- [ ] אפס קוד מת ב-`src/lib/studio/` (רק `engineWorklet.ts`)
- [ ] Multiband פעיל ולא הורג גבוהים (FFT לפני ואחרי)
- [ ] כל 11 הכפתורים עובדים ללא שגיאות ב-Agent Browser
- [ ] רדיו מתחבר + onsets מזוהים + bank גדל
- [ ] Export MIDI תקין (header + key נכון)
- [ ] Export/Import Package עגול (export → import → אותו תוכן)
