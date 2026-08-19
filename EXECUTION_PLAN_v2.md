# PSY4 × psysynth — תוכנית ביצוע מלאה לניתוב יכולות משופרות

**תאריך:** 2026-08-17
**מבוסס על:** ביקורת עומק של psysynth (2 סוכנים עצמאיים) + אימות חי (הרצת 133 בדיקות)
**כללי:** כל הכתיבה רק לתוך `/home/z/my-project/`

---

## 1. מצב סנכרון GitHub (מאומת)

```
origin/main = 7688fce (2026-08-15 13:01) "fix: Volume slider not working — worklet bypassed master gain"
local HEAD  = 09efa9a (2026-08-16 12:58) = origin/main + 2 קומיטים מקומיים
```

**הקומיטים המקומיים מכילים:**
- `worklog.md` (ביקורות סוכנים — נשמר)
- `EXECUTION_PLAN.md` (התוכנית הקודמת — נשמר)
- קבצי `public/samples/*.wav` + `public/psy-sampler.js` + `public/soundbank/index.json` (לא בשימוש — יימחקו בשלב 0)
- קבצי `.ts` ריקים (0 שורות) ב-`src/lib/` — יימחקו בשלב 0

**אין שום קוד מקור חדש מרוחק.** אני על הגרסה האחרונה מ-GitHub.

---

## 2. ממצאי ביקורת psysynth (האמת ללא כיפות)

### 📊 מספרים (מאומתים)

| מדד | psysynth | PSY4 הנוכחי |
|-----|----------|-------------|
| שורות קוד מקור | 3,321 | ~5,500 (psyLive 3644 + engineWorklet 281) |
| שורות בדיקות | 1,594 | ~50 (foundation) |
| בדיקות עוברות | 133 pass, 3 skip, 0 fail | לא רצות |
| קוד מת | 0 | 34,825 שורות (97.4% מ-studio/) |
| Bundle size | 21 KB | N/A (monolithic worklet 109 KB) |
| `ignoreBuildErrors` | false (strict TS) | **true** (מסתיר שגיאות) |
| `Math.random()` ב-composition | 0 (mulberry32 אמיתי) | 17 (mulberry32 מת) |

### ✅ מה משופר ב-psysynth (יכולות לנתב)

| יכולת | psysynth | PSY4 | ערך הניתוב |
|------|----------|------|-----------|
| **דטרמיניזם אמיתי** | mulberry32 verbatim shim, single lineage | Math.random ב-composition-worker | גבוה — מאפשר replay/test |
| **PsyDevice contract** | onTransport/onContext/onEvent/capabilities (clean) | אין (monolithic) | גבוה — ארכיטקטורה נקייה |
| **NoteEvent stream** | {note, velocity, duration, channel, at} קנוני | Float64Array גולמי | בינוני — כבר עובד |
| **Voice pool deterministic steal** | oldest-released → oldest-on, O(1) Map | first-allocated stealing | בינוני — איכות קול טובה יותר |
| **Patch validation** | 13 strict validators, rejects malformed | אין | גבוה — איכות נתונים |
| **20 patches + 6 subgenre banks** | manifest.json עם provenance | הרדקוד | גבוה — מגוון סאונד |
| **Observability counters** | eventsDropped/voicesStolen/patchLoadErrors | אין | בינוני — debug |
| **Zero-alloc hot path** | AudioParam scheduling only | preallocated `_out` (גם טוב) | נמוך — שניהם טובים |
| **PolyBLEP DSP** | קוד קיים + Goertzel alias test | לא קיים | בינוני — איכות תדר |
| **MIDI layer** | WebMIDI ב-host, CC mapping, MIDI-learn | אין | גבוה — יכולת חדשה |
| **Strict TypeScript** | `tsc --noEmit` עובר | `ignoreBuildErrors: true` | גבוה — אמינות |

### ❌ מה חסר ב-psysynth (לא לנתב / להשלים)

| חסרון | פירוט |
|------|-------|
| **Drum voices** | 7 תפקידים מלודיים בלבד (bass/lead/arp/pad/stab/pluck/keys). אין kick/snare/hat/clap/perc/shaker |
| **Master chain** | מפורשות לא קיים — "Mastering belongs to the host bus" (ARCHITECTURE.md §4.3) |
| **Sampler** | לא קיים — "no samples, pure synthesis" (README) |
| **PolyBLEP לא מחובר** | קוד קיים אבל `voice.ts` משתמש ב-PeriodicWave סטטי. רק 2 patches מסומנים כזקוקים (lead-hitech-sync, pluck-forest) |
| **"Moog ladder" הוא לא Moog** | 2 cascaded biquads + tanh. ה-docstring מודה: "Moog ladder character APPROXIMATED" |
| **Mod-matrix / LFO / step-seq רדומים** | מוגדרים ב-`voice-ext.ts` אבל אף patch לא משתמש (0/20) |
| **Transport ownership** | לא קיים — "Devices are pure HOW" (ARCHITECTURE.md §1) |

### 🔌 ה-seam ש-PSY4 כבר חשף (מצא עובד)

```typescript
// psyLive.ts — כל ה-4 הדרושים ל-psysynth כבר קיימים:
get audioContext(): AudioContext | null  // line 483
get engineBusInput(): AudioNode | null  // line 490 (duplicate ב-1615 — bug B8 מסתיר)
private delaySend: GainNode | null       // line 252, created line 621
private reverbSend: GainNode | null       // line 255, created line 632
```

**מסקנה:** הניתוב הוא **מכני, לא ארכיטקטוני**. PSY4 כבר מוכן לקלוט device.

---

## 3. עקרונות מנחים לתוכנית

1. **DRY על ידי contract, לא על ידי שכפול** — psysynth בא כ-device נפרד על אותו bus, לא כתחליף ל-psy4-engine.js
2. **A/B נקי** — כפתור ב-UI מחליף בין ה-bass/lead/pad הישן (worklet) לחדש (psysynth). ברירת מחדל OFF
3. **Drums נשארים** — kick/snare/hat/clap/perc/shaker נשארים ב-psy4-engine.js (psysynth לא עושה drums)
4. **דטרמיניזם קודם** — לפני שמעבירים תפקידים, חובה לתקן את B3 (mulberry32 ב-composition-worker) אחרת psysynth יקבל אירועים לא דטרמיניסטיים
5. **הסרת ignoreBuildErrors קודם** — אחרת שגיאות הטיפוס יוסתרו בזמן הניתוב
6. **כל כתיבה רק ל-`/home/z/my-project/`** — קוד psysynth מועתק פיזית לתוך PSY4 (לא symlink, לא git submodule)

---

## 4. תוכנית ביצוע — 9 שלבים

### שלב 0: סנכרון + ניקוי קדם-עבודה
**יעד:** נקודת התחלה נקייה, ללא קבצים מתים מקומיים

| ID | משימה | זמן |
|----|------|-----|
| T0.1 | מחק קבצים מתים מקומיים: `public/psy-sampler.js`, `public/soundbank/`, `public/samples/*.wav` (לא בשימוש), קבצי `.ts` ריקים ב-`src/lib/` | 5 דק' |
| T0.2 | ודא `git status` נקי (רק worklog + EXECUTION_PLAN + EXECUTION_PLAN_v2) | 2 דק' |
| T0.3 | אתחל dev server מחדש, ודא GET / 200 | 3 דק' |

**סה"כ:** 10 דק'

---

### שלב 1: הבא את psysynth לתוך PSY4 (פיזית, לא submodule)
**יעד:** bundle + patches + contract shim זמינים ב-PSY4

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T1.1 | העתק bundle: `/tmp/psysynth-audit/public/psysynth.js` → `/home/z/my-project/public/psysynth.js` | `public/psysynth.js` | 1 דק' |
| T1.2 | העתק patches: `/tmp/psysynth-audit/public/patches/` → `/home/z/my-project/public/patches/` | `public/patches/{manifest,style-banks}.json` | 1 דק' |
| T1.3 | העתק contract shim: `/tmp/psysynth-audit/src/psy-foundation-shim/` → `/home/z/my-project/src/lib/psy-foundation-shim/` | `src/lib/psy-foundation-shim/*.ts` | 2 דק' |
| T1.4 | ודא `bun run lint` עובר על ה-shim (TypeScript strict) | - | 5 דק' |
| T1.5 | בדוק ב-browser ש-`/psysynth.js` ו-`/patches/manifest.json` זמינים (200 OK) | - | 3 דק' |

**סה"כ:** 12 דק'

---

### שלב 2: צור SynthBridge (מתרגם PSY4 → NoteEvent)
**יעד:** composition-worker.js Float64Array → NoteEvent stream ל-DeviceHost

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T2.1 | כתוב `src/lib/synth-bridge.ts` — SynthBridge class עם DeviceHost + InMemoryChannel | `src/lib/synth-bridge.ts` | 40 דק' |
| T2.2 | מפת תפקידי PSY4 → 7 תפקידים קנוניים: `bass+sub→bass`, `lead+acid+counterline→lead`, `pad+texture→pad`, `pluck→pluck`, `keys→keys`. **Drums (kick/snare/hat/clap/perc/shaker) לא ממופים** — נשארים ב-worklet | חלק מ-T2.1 | 15 דק' |
| T2.3 | כתוב מתרגם Float64Array → NoteEvent: `[at, note, velocity, duration, voiceId, param]` → `{type:'note', note, velocity, duration, channel: roleMap[voiceId], at}` | חלק מ-T2.1 | 20 דק' |
| T2.4 | טפל ב-stale events (`at < ctx.currentTime - 50ms` → drop + count) | חלק מ-T2.1 | 5 דק' |
| T2.5 | כתוב בדיקת יחידה ל-bridge (mock Float64Array → NoteEvent stream) | `tests/synth-bridge.test.ts` | 20 דק' |

**סה"כ:** 100 דק'

---

### שלב 3: חבר SynthBridge ל-psyLive.ts
**יעד:** `attachSynthBridge()` API + lifecycle (onStart/onStop) משולב

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T3.1 | הוסף `attachSynthBridge(bridge: SynthBridge)` method ב-psyLive.ts — קורא `bundle.device.onStart?.()` ו-`await bundle.load()` | `src/lib/psyLive.ts` | 20 דק' |
| T3.2 | העבר Float64Array events ל-bridge.publishNote() בנוסף לעבודה הנוכחית (לא במקום — A/B) | `src/lib/psyLive.ts` (line ~1590) | 30 דק' |
| T3.3 | העבר transport snapshot ל-bridge.publishTransport() בכל שינוי BPM/beat | `src/lib/psyLive.ts` | 15 דק' |
| T3.4 | העבר context (key/rootPc/scale/style/section) ל-bridge.host.pushContext() בשינוי style | `src/lib/psyLive.ts` | 15 דק' |
| T3.5 | הוסף `detachSynthBridge()` + dispose ב-stop() | `src/lib/psyLive.ts` | 10 דק' |
| T3.6 | תקן duplicate `engineBusInput` getter (line 490 + 1615) — השאר אחד | `src/lib/psyLive.ts` | 5 דק' |

**סה"כ:** 95 דק'

---

### שלב 4: UI A/B toggle (ברירת מחדל OFF)
**יעד:** משתמש יכול להחליף בין bass/lead/pad ישן לחדש בלחיצה

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T4.1 | הוסף state `usePsysynth: boolean` (default false) | `src/app/page.tsx` | 5 דק' |
| T4.2 | הוסף כפתור "SYNTH DEVICE" ב-header (ליד Play) — toggle | `src/app/page.tsx` | 15 דק' |
| T4.3 | ב-toggle ON: קרא `engine.attachSynthBridge()` + mute את bass/lead/pad ב-psy4-engine.js (postMessage `setMacros`) | `src/app/page.tsx` + `psyLive.ts` | 25 דק' |
| T4.4 | ב-toggle OFF: קרא `engine.detachSynthBridge()` + unmute | כנ"ל | 10 דק' |
| T4.5 | הצג אבחנה חזותית: badge "SYNTH" בצבע ירוק כש-ON | `src/app/page.tsx` | 10 דק' |

**סה"כ:** 65 דק'

---

### שלב 5: תיקון דטרמיניזם ב-composition-worker (תנאי קדם לניתוב מלא)
**יעד:** אותו seed → אותה יצירה (אחרת psysynth מקבל אירועים לא דטרמיניסטיים)

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T5.1 | החלף 17 קריאות `Math.random()` ב-`this.rng()` ב-composition-worker.js | `public/worklets/composition-worker.js` | 45 דק' |
| T5.2 | תקן root-change: השתמש ב-`this.rng()` + scale-aware roots | `public/worklets/composition-worker.js` | 20 דק' |
| T5.3 | הוסף seed display ב-UI (read-only) | `src/app/page.tsx` | 15 דק' |
| T5.4 | כתוב בדיקת דטרמיניזם: יצוא MIDI פעמיים עם אותו seed → byte-identical | `tests/determinism.test.ts` | 30 דק' |

**סה"כ:** 110 דק'

---

### שלב 6: תיקון ignoreBuildErrors + שגיאות TS
**יעד:** `tsc --noEmit` עובר, `ignoreBuildErrors: false`

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T6.1 | הסר `typescript.ignoreBuildErrors: true` מ-next.config.ts | `next.config.ts` | 2 דק' |
| T6.2 | הרץ `bunx tsc --noEmit` ותקן את כל השגיאות שמתגלות | `src/**/*.ts` | 60 דק' |
| T6.3 | תקן את B6 (exportMIDI rootPc — `this.opts?.rootPc ?? 0`) | `src/lib/psyLive.ts:2966` | 20 דק' |
| T6.4 | תקן גישה ישירה ל-`engineNode.node` (private) | `src/lib/psyLive.ts` | 15 דק' |
| T6.5 | ודא `bun run lint` נקי | - | 10 דק' |

**סה"כ:** 107 דק'

---

### שלב 7: תיקוני קריטי מ-EXECUTION_PLAN הקודם
**יעד:** סגירת הפערים החוסמים end-to-end

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T7.1 | **B1**: העבר עדכון `engineLevel` מחוץ ל-`detect()` — רוץ גם כשרדיו כבוי | `src/lib/psyLive.ts:2118-2128` | 15 דק' |
| T7.2 | **B7**: תקן כפילות אירועים בין executeDecision ל-generateGroove | `public/worklets/composition-worker.js` | 30 דק' |
| T7.3 | **B4 (אופציונלי)**: החלף Biquad LR2 ב-Linkwitz-Riley 4th-order ל-multiband | `public/worklets/psy4-engine.js` | 90 דק' |
| T7.4 | **T1.4 imager**: העבר M/S Stereo Imager לפני limiter | `public/worklets/psy4-engine.js` | 15 דק' |

**סה"כ:** 150 דק' (T7.3 אופציונלי → 60 דק' חובה)

---

### שלב 8: ניקוי קוד מת (34,825 שורות)
**יעד:** תחזוקה אפשרית, `studio/` כמעט ריק

| ID | משימה | קובץ יעד | זמן |
|----|------|---------|-----|
| T8.1 | מחק 71 קבצים מתים ב-`src/lib/studio/` (שמור רק `engine/engineWorklet.ts`) | `src/lib/studio/*` | 10 דק' |
| T8.2 | מחק `beatPLL.ts` + `melodyObserver.ts` | `src/lib/` | 5 דק' |
| T8.3 | מחק 5 API routes יתומים (`/api/forensic/*`, `/api/reference/train`, `/api/reference/streams`, `/api/learn`, `/api/route.ts`) — שמור `/api/reference/proxy` | `src/app/api/` | 10 דק' |
| T8.4 | מחק legacy audio graph מת ב-psyLive.ts (kickBus/bassBus/leadBus/hatBus/mute/duck/engineBus/comp/masterEq/master/safetyLimiter/delay/reverb/noiseBuf/hat/makeShaper) — **שים לב: engineBus, delaySend, reverbSend נשארים** (psysynth צריך) | `src/lib/psyLive.ts` | 60 דק' |
| T8.5 | מחק legacy API שכותב ל-nodes יתומים (setChannelVolume/Mute/Solo, setDelayAmount/Feedback, setReverbSend, setBusVolume, unlockStyle/Energy/Density/Tension/Key, scheduleCausalEvent, causalEventQueue) | `src/lib/psyLive.ts` | 30 דק' |
| T8.6 | ודא `bun run lint` + `tsc --noEmit` עוברים אחרי ניקוי | - | 15 דק' |

**סה"כ:** 130 דק'

---

### שלב 9: אימות end-to-end (חובה)
**יעד:** Agent Browser מאשש שכל השרשרת עובדת

| ID | משימה | זמן |
|----|------|-----|
| T9.1 | לחץ Play (ללא psysynth) → ודא LUFS זז (-10 עד -25, לא -80.7) | 10 דק' |
| T9.2 | הפעל SYNTH DEVICE toggle → ודא bass/lead/pad מגיעים מ-psysynth (counters עולים, קול נשמע) | 15 דק' |
| T9.3 | כבה toggle → ודא חזרה ל-psy4-engine.js (no zombie voices) | 10 דק' |
| T9.4 | לחץ על כל 11 כפתורים + החדש → ודא שאף אחד לא זורק שגיאה | 15 דק' |
| T9.5 | חבר רדיו → ודא onsets + style + bank גדל (גם עם psysynth ON) | 10 דק' |
| T9.6 | Export MIDI → ודא header תקין (format 0, 480 tpq, 1 track, key נכון) | 10 דק' |
| T9.7 | Export/Import Package → ודא עגול | 10 דק' |
| T9.8 | בדוק responsive (mobile width) + sticky footer | 10 דק' |
| T9.9 | `bun run lint` + `bunx tsc --noEmit` נקיים | 5 דק' |
| T9.10 | בדיקת דטרמיניזם: אותו seed → אותו MIDI (byte-identical) | 15 דק' |

**סה"כ:** 110 דק'

---

## 5. סיכום זמנים

| שלב | תיאור | זמן חובה | זמן אופציונלי |
|------|------|---------|--------------|
| 0 | ניקוי קדם-עבודה | 10 דק' | - |
| 1 | הבאת psysynth ל-PSY4 | 12 דק' | - |
| 2 | SynthBridge | 100 דק' | - |
| 3 | חיבור ל-psyLive | 95 דק' | - |
| 4 | UI A/B toggle | 65 דק' | - |
| 5 | דטרמיניזם ב-composition-worker | 110 דק' | - |
| 6 | הסר ignoreBuildErrors + תיקון TS | 107 דק' | - |
| 7 | תיקוני קריטי (B1, B7, imager) | 60 דק' | +90 (multiband) |
| 8 | ניקוי 34,825 שורות מתות | 130 דק' | - |
| 9 | אימות E2E | 110 דק' | - |
| **סה"כ חובה** | | **799 דק'** | **~13.3 שעות** |
| **סה"כ מלא** | | | **~14.8 שעות** |

---

## 6. סדר ביצוע מומלץ (תלויות)

```
שלב 0 (ניקוי)
    ↓
שלב 6 (הסר ignoreBuildErrors) ←── חובה לפני כל שינוי קוד (אחרת שגיאות מוסתרות)
    ↓
שלב 5 (דטרמיניזם) ←── חובה לפני שלב 2 (אחרת psysynth מקבל אירועים לא דט')
    ↓
שלב 1 (העתקת psysynth)
    ↓
שלב 2 (SynthBridge) ←── תלוי ב-1
    ↓
שלב 3 (חיבור ל-psyLive) ←── תלוי ב-2
    ↓
שלב 4 (UI toggle) ←── תלוי ב-3
    ↓
שלב 7 (תיקוני קריטי B1, B7) ←── אחרי שלב 3 (כדי ש-LUFS יעבוד גם עם psysynth)
    ↓
שלב 8 (ניקוי 34K שורות) ←── אחרי שלב 3 (כדי לא למחוק משהו ש-psysynth צריך)
    ↓
שלב 9 (אימות E2E) ←── אחרון
```

---

## 7. ניתוב יכולות משופרות — מה משתפר אחרי הביצוע

| יכולת | לפני | אחרי | מקור |
|--------|------|------|------|
| דטרמיניזם | Math.random (17 קריאות) | mulberry32 verbatim | psysynth shim |
| ארכיטקטורה | monolithic worklet 3129 שורות | contract device + drum worklet | psysynth contract |
| ניהול קול רספונסיבי | first-allocated stealing | deterministic oldest-released | psysynth voice-pool |
| Patch validation | אין | 13 strict validators | psysynth patch-library |
| מגוון סאונד | הרדקוד | 20 patches + 6 subgenre banks | psysynth manifest |
| MIDI input | אין | WebMIDI + CC mapping + learn | psysynth midi-map |
| Observability | אין | counters (eventsDropped/voicesStolen/...) | psysynth counters |
| TypeScript strict | ignoreBuildErrors | tsc --noEmit עובר | הסרה |
| קוד מת | 34,825 שורות | 0 | ניקוי |
| A/B compare | אין | toggle SYNTH DEVICE | חדש |
| LUFS meter | תקוע -80.7 | נע -10 עד -25 | B1 fix |
| דטרמיניזם MIDI | אקראי | byte-identical per seed | B3 fix |

---

## 8. סיכונים ומיתון

| סיכון | הסתברות | חומרה | מיתון |
|------|---------|------|------|
| פעיגון זמן (5ms off = flam audible) | גבוהה | בינונית | בדיקת alignment בין worklet clock ל-AudioContext currentTime לפני ניתוב מלא |
| שבירת composition-worker בהחלפת Math.random | בינונית | גבוהה | בדיקת דטרמיניזם (T5.4) לפני המשך |
| איבוד קול כשמוחקים legacy graph | בינונית | גבוהה | A/B toggle (שלב 4) לפני מחיקה (שלב 8) |
| `tsc --noEmit` חושף 100+ שגיאות | גבוהה | בינונית | תיקון מדורג, לא all-at-once |
| psysynth נשמע רע יותר מ-psy4-engine.js bass | בינונית | נמוכה | "Moog ladder" של psysynth הוא 2 biquads — השאר את ה-bass ב-psy4-engine.js בשלב 1, העבר רק lead/pad/stab/arp/pluck/keys |

---

## 9. Definition of Done

- [ ] `git status` נקי, על origin/main (ללא קומיטים מקומיים שלא נדחפו מלבד docs)
- [ ] `public/psysynth.js` (21KB) + `public/patches/manifest.json` זמינים (200 OK)
- [ ] `src/lib/psy-foundation-shim/` קיים ועובר `tsc --noEmit`
- [ ] `src/lib/synth-bridge.ts` קיים עם בדיקות יחידה
- [ ] `engine.attachSynthBridge()` / `detachSynthBridge()` עובדים
- [ ] כפתור "SYNTH DEVICE" ב-UI — toggle A/B
- [ ] אותו seed → אותו MIDI (byte-identical)
- [ ] `next.config.ts` אין `ignoreBuildErrors`
- [ ] `bunx tsc --noEmit` עובר
- [ ] `bun run lint` נקי
- [ ] `src/lib/studio/` מכיל רק `engine/engineWorklet.ts`
- [ ] LUFS נע (-10 עד -25) בלחיצה על Play
- [ ] Agent Browser מאשש: כל 12 כפתורים עובדים ללא שגיאות
- [ ] רדיו + onsets + bank עובדים גם עם psysynth ON
- [ ] אפס קונסול שגיאות ב-Agent Browser
