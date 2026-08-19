# EXECUTION PLAN — סגירת פערים אמיתיים לרמה מסחרית

> נכתב אחרי ביקורת אמיתית של הקוד, לא על סמך תיאורים.

## מצב נוכחי מאומת (מה יש בפועל)

### ✅ מה עובד באמת:
- **Engine core**: 1629 שורות ב-`psyLive4.ts` — 4 devices, scheduler, master chain, learning loop
- **Local-first DB**: SQLite עובד, נתונים שורדים קריסות (verified: 2 params, 2 patterns, 1 telemetry)
- **API routes**: 6 routes עובדים, source:local
- **Worklets**: נטענים (HTTP 200), real Moog ladder + PolyBLEP
- **Page loads**: HTTP 200 ב-55ms (cached)
- **GitHub push**: עובד, local = remote = `6f84ad3`

### ❌ פערים אמיתיים (נמצאו בביקורת):

#### GAP-1: User identity לא מאותחל (CRITICAL — אבדק שוב)
**הקוד**: `page.tsx` קורא ל-`loadCloudState()` אבל **אף פעם לא קורא ל-`getOrCreateUserId()`**.
**התוצאה**: כל ה-learning state נשמר תחת `user_id='anonymous'` — כל משתמש חולק את אותו state.
**הפער מול מסחרי**: אי אפשר להפריד משתמשים, אי אפשר לתת שירות אישי.

#### GAP-2: 56 console.log ב-psyLive4.ts (MEDIUM — רעש production)
**הקוד**: 56 `console.log` + 10 `console.warn` ב-engine הראשי.
**התוצאה**: הקונסולה מוצפת בלוגים בכל learning tick (כל 4 שנ').
**הפער מול מסחרי**: production אמיתי צריך structured logging (levels: debug/info/warn/error), לא console.log.

#### GAP-3: אין tests לקוד החדש (HIGH — איכות)
**הקוד**: יש 3 קבצי tests אבל הם ישנים (audio-quality, causal-composition, causal-worker). **אין tests ל-local-db, learning, radio-listener, API routes.**
**התוצאה**: שינוי קוד יכול לשבור משהו בלי שנדע.
**הפער מול מסחרי**: commercial דורש test coverage > 70%.

#### GAP-4: אין CI/CD (HIGH — deployment)
**הקוד**: אין `.github/workflows`, אין `vercel.json`, אין Dockerfile.
**התוצאה**: כל deploy ידני, אין בדיקות אוטומטיות לפני merge.
**הפער מול מסחרי**: commercial דורש CI pipeline (lint + test + build לפני merge).

#### GAP-5: אין error monitoring (MEDIUM — observability)
**הקוד**: `try/catch` עם `console.error` — שגיאות נעלמות לקונסולת השרת.
**התוצאה**: ב-production, שגיאות משתמשים לא נאספות.
**הפער מול מסחרי**: צריך error tracking service (Sentry/self-hosted).

#### GAP-6: אין rate limiting (MEDIUM — security)
**הקוד**: API routes פתוחות, אין הגבלת קצב.
**התוצאה**: ניתן להציף את ה-API.
**הפער מול מסחרי**: צריך rate limiting לפחות 60 req/min למשתמש.

#### GAP-7: שרת לא יציב תחת עומס (HIGH — reliability)
**הקוד**: עם `--max-old-space-size=3072`, השרת מתחת OOM תחת בקשות מהירות.
**התוצאה**: המשתמש רואה "Connection refused" בעת שימוש מהיר.
**הפער מול מסחרי**: commercial דורש 99.9% uptime.

#### GAP-8: אין audio export איכותי (LOW — feature gap)
**הקוד**: WAV export הוא drums-only (ScriptProcessorNode, לא עובד עם worklet ב-offline).
**התוצאה**: אי אפשר לייצא את המיקס המלא.
**הפער מול מסחרי**: commercial DAW מייצא full mix.

#### GAP-9: אין mobile responsive (MEDIUM — UX)
**הקוד**: ה-UI לא מותאם למובייל (synth rack + keyboard דורשים desktop).
**התוצאה**: בלתי שמיש במובייל.
**הפער מול מסחרי**: >50% משתמשים במובייל.

#### GAP-10: אין preset sharing (LOW — feature gap)
**הקוד**: presets רק ב-localStorage.
**התוצאה**: אי אפשר לשתף פריסטים בין משתמשים.

---

## תוכנית ביצוע — 5 שלבים לרמה מסחרית

### שלב 1: תיקון פערים קריטיים (2-3 שעות)

**1.1 — תקן את user identity wiring** (GAP-1)
- הוסף `import { getOrCreateUserId } from '@/lib/user-identity'` ב-page.tsx
- קרא ל-`getOrCreateUserId()` ב-useEffect הראשון, לפני `loadCloudState()`
- ודא שה-user ID נוצר לפני ה-API call הראשון

**1.2 — החלף console.log ב-structured logger** (GAP-2)
- צור `src/lib/logger.ts` עם levels: debug/info/warn/error
- ב-production: רק warn+error לקונסולה
- ב-dev: הכל עם timestamps
- החלף את 56 ה-console.log ב-psyLive4.ts

**1.3 — ייצוב שרת תחת עומס** (GAP-7)
- הוסף request queueing (לא יותר מ-3 בקשות במקביל)
- cache API responses ל-5 שנ' (health, stats)
- lazy-compile routes ברקע

### שלב 2: איכות ו-CI (3-4 שעות)

**2.1 — כתוב tests לקוד החדש** (GAP-3)
- `tests/local-db.test.ts` — CRUD operations
- `tests/learning.test.ts` — hill-climbing + pattern memory
- `tests/api/health.test.ts` — API integration
- עדיפות: smoke tests שמוודאים שהכל עובד end-to-end

**2.2 — צור CI pipeline** (GAP-4)
- `.github/workflows/ci.yml` — lint + tsc + test על כל PR
- `.github/workflows/deploy.yml` — deploy on merge to main
- צור `Dockerfile` ל-deployment יציב

### שלב 3: אבטחה ו-observability (2-3 שעות)

**3.1 — Rate limiting** (GAP-6)
- `src/lib/rate-limit.ts` — in-memory rate limiter (60 req/min per user)
- החל על כל API routes

**3.2 — Error monitoring** (GAP-5)
- `src/lib/error-tracking.ts` — אוסף שגיאות ל-local DB
- `/api/errors` route — מציג שגיאות אחרונות
- (ללא Sentry חיצוני — local-first)

### שלב 4: UX מסחרי (2-3 שעות)

**4.1 — Mobile responsive** (GAP-9)
- התאם את synth rack + keyboard למובייל
- הוסף touch targets (min 44px)
- הוסף תפריט המבורגר ל-sidebar

**4.2 — Full-mix audio export** (GAP-8)
- החלף את ScriptProcessorNode ב-OfflineAudioContext
- רנדר את כל 4 ה-devices ל-WAV אחד

### שלב 5: פיצ'רים מתקדמים (אופציונלי)

**5.1 — Preset sharing** (GAP-10)
- API route `/api/presets` — save/load מ-local DB
- UI ל-share + import

**5.2 — Deep Gap I: spectrogram overlap**
- mel-spectrogram correlation (32 bands × 8 frames)
- מדד דמיון פרספטואלי חזק יותר מ-7 metrics

---

## סדר עדיפויות מומלץ

| שלב | זמן | השפעה מסחרית |
|------|------|-------------|
| 1.1 user identity | 30 דק' | CRITICAL — בלי זה אי אפשר להפריד משתמשים |
| 1.3 ייצוב שרת | 1 שעה | HIGH — בלי זה המוצר לא עובד |
| 1.2 structured logging | 1 שעה | MEDIUM — נראות ל-production |
| 2.1 tests | 2 שעות | HIGH — איכות קוד |
| 2.2 CI/CD | 2 שעות | HIGH — deployment אוטומטי |
| 3.1 rate limiting | 1 שעה | MEDIUM — security |
| 3.2 error monitoring | 1 שעה | MEDIUM — observability |
| 4.1 mobile | 2 שעות | MEDIUM — >50% משתמשים |
| 4.2 full export | 2 שעות | LOW — feature gap |
| 5.1 presets | 1 שעה | LOW — feature gap |
| 5.2 spectrogram | 3 שעות | LOW — inference quality |

**סה"כ: ~16 שעות לרמה מסחרית מלאה.**

## איך להתחיל

**מיידי** — שלב 1.1 (user identity) + 1.3 (server stability):
- אלו הפערים הקריטיים ביותר
- בלי user identity, הרבה מהעבודה הקודמת לא מתפקדת כמסחרי
- בלי ייצוב שרת, המשתמש רואה קריסות

התחל עכשיו בשלב 1.1 + 1.3, וודא commit + push אחרי כל שלב.
