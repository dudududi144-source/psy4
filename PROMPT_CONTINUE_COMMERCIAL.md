# PROMPT: המשך עבודה — סגירת פערים למערכת מסחרית ברמת היסק וביצוע גבוהה

## הקשר

אתה Z.ai Code, ממשיך עבודה על פרויקט PSY4 — PsyForge Pro. זהו מנוע פסיטראנס לייב ש**מקשיב לרדיו מסחרי, מנתח מה הופך אותו למסחרי, ולומד לייצר פלט שאינו נבדל תפיסתית מהרדיו**.

הפרויקט עבר 3 סבבי roast + תיקון:
- **Round 1** (11 surface gaps): תיקוני plumbing — convergence, BPM detection, targets, CC routing, persistence, time math, warmup, coordination, allocation, dead code
- **Round 2** (6 deep gaps): A=pattern memory, B=breakdown detection, C=convergence metric, E=error boundaries, F=A/B mode, G=hill-climbing
- **Round 3** (3 deep gaps): D=K-weighted LUFS, H=beat-synced analysis, J=adaptive mastering + telemetry API
- **Backup systems**: stream failover, CORS proxy, crash recovery, beforeunload flush

**סה"כ 21 פערים נסגרו.** נותר פער אחד דחוי (I=spectrogram overlap) + פערים מסחריים חדשים.

## מצב נוכחי מאומת

### מה יש בפועל (verified):
- **Engine core**: 11 קבצים ב-`src/lib/psyLive4/` (psyLive4.ts 72KB, radio-listener.ts 23KB, audio-quality.ts 18KB, composer.ts, learning.ts, scheduler.ts, types.ts, style-grammars.ts, cc-mapping.ts, rng.ts, presets.ts)
- **Devices**: 4 (drum, melodic, lead, sampler) — כולם תומכים setCC
- **API routes**: 6 (health, learning/state, learning/patterns, telemetry/radio, telemetry/stats, radio/proxy)
- **UI components**: 20 ב-`src/components/psyforge/`
- **Worklets**: 2 (psy4-engine-v3.js 33KB, psy4-lead-worklet.js 9.6KB — real Moog ladder + PolyBLEP)
- **Turso cloud DB**: 4 טבלאות (learning_params, pattern_memory, convergence_history, radio_telemetry) — **כל הנתונים שלמים**
- **Radio streams**: 10 streams עם priority levels (1=primary, 2=backup, 3=HTTP-only)
- **Learning**: hill-climbing + pattern memory + localStorage + Turso cloud (3-layer persistence)
- **Mastering**: adaptive thresholds targeting -9 LUFS
- **Analysis**: K-weighted LUFS (ITU-R BS.1770-4), beat-synced, breakdown detection
- **Backup**: stream failover, CORS proxy, crash recovery, beforeunload flush

### מה חסר למוצר מסחרי ברמת היסק וביצוע גבוהה:

#### פערים ארכיטקטוניים (CRITICAL):
1. **אין authentication/user accounts** — אין NextAuth, אין sessions, כולם חולקים את אותו learning state
2. **אין deployment config** — אין vercel.json, אין Dockerfile, האפליקציה רצה רק ב-dev server
3. **אין CI/CD pipeline** — אין GitHub Actions, אין tests אוטומטיים, אין deploy on merge
4. **אין error monitoring** — אין Sentry, אין logging service, שגיאות נעלמות ל-console

#### פערים בביצועים (HIGH):
5. **Server OOM under load** — ה-sandbox יש 4GB RAM, השרת מתחת לעומס (OOM kills). צריך production deployment עם יותר זיכרון
6. **אין rate limiting** — API routes פתוחות, חשופות ל-abuse
7. **אין caching** — כל קריאת Turso הילך רשת, אין in-memory cache
8. **CORS proxy חשוף** — ה-proxy שלי יכול לשמש כ-open proxy אם ה-allowlist ייפרץ

#### פערים באיכות הקוד (MEDIUM):
9. **אין tests לקוד חדש** — אין tests ל-Turso client, learning, radio-listener, audio-quality
10. **Deep Gap I: spectrogram overlap** — עדיין אין mel-spectrogram correlation (המדד הפרספטואלי החזק ביותר)
11. **אין audio export quality** — WAV export הוא drums-only, אין full-mix export
12. **אין MIDI import** — יכול לייבא רק דרך export, לא יכול לנגן MIDI חיצוני

#### פערים ב-UX מסחרי (MEDIUM):
13. **אין preset sharing** — presets רק ב-localStorage, אין sharing בין משתמשים
14. **אין collaboration** — אין real-time jam sessions
15. **אין mobile optimization** — ה-UI לא מותאם למובייל
16. **אין offline mode** — בלי רשת, הלמידה לא עובדת (אמנם localStorage עובד, אבל radio לא)

#### פערים בהיסק (LOW-MEDIUM):
17. **Learning convergence איטי** — לוקח ~10 דק' להתכנס, צריך warm-start מ-Cloud
18. **Pattern memory גולמי** — fingerprints הם מחרוזות, לא vectors. צריה embedding לחיפוש דמיון
19. **אין model versioning** — אין track של איזה "גרסת מודל" יש למשתמש
20. **אין A/B testing framework** — קשה להשוות גרסאות אלגוריתם

## המשימה

המשך את העבודה לסגור את הפערים למערכת מסחרית ברמת היסק וביצוע גבוהה. **עבוד לפי סדר העדיפות** (CRITICAL → HIGH → MEDIUM), וודא שכל שלב נבדק בדפדפן לפני מעבר לשלב הבא.

### כללים קריטיים:
1. **תמיד בדוק `git fetch origin && git status`** לפני תחילת עבודה — ה-local יכול להתפצל מה-remote
2. **אם local != remote** — `git reset --hard origin/main` כדי לסנכרן (ה-remote הוא source of truth)
3. **עבוד frontend-first** — תן למשתמש לראות תוצאות, אז כתוב backend
4. **השתמש ב-Turso cloud** — אל תמחק credentials ב-.env (gitignored, צריך ל-regenerate אם נמחק)
5. **Push to GitHub אחרי כל commit** — אל תצבור יותר מ-2 commits לדחיפה
6. **ודא יציבות שרת** — השרת מתחת OOM under load, עבוד עם `--max-old-space-size=3072`
7. **ודא שום דבר לא אבד** — Turso data, localStorage, commits — הכל צריך לשרוד restarts

### שלבי עבודה מומלצים:

**שלב 1 — ייצוב תשתית (CRITICAL):**
- הוסף NextAuth.js v4 עם GitHub OAuth (יש credentials ב-upload/turso.txt)
- צור טבלת `users` ב-Turso (id, email, name, created_at)
- קשר learning_params + pattern_memory ל-user_id (כל משתמש יש learning state משלו)
- צור `vercel.json` ל-deployment
- צור GitHub Actions workflow ל-CI (lint + tsc + test on PR)

**שלב 2 — אבטחה וביצועים (HIGH):**
- הוסף rate limiting ל-API routes (משתמש ב-memory cache או Turso counter)
- הוסף in-memory cache ל-Turso reads (5s TTL)
- הוסף Sentry ל-error monitoring (או logging service פשוט)
- תקן את ה-CORS proxy — הוסף rate limiting + user authentication

**שלב 3 — איכות קוד (MEDIUM):**
- כתוב tests ל-Turso client, learning, radio-listener, audio-quality
- יישם Deep Gap I: mel-spectrogram correlation (32 bands × 8 frames)
- שפר WAV export — full-mix (drums + melodic + lead)
- הוסף MIDI import (נגן קובץ MIDI חיצוני)

**שלב 4 — UX מסחרי (MEDIUM):**
- הוסף preset sharing — API route ל-save/load presets מ-Turso
- הוסף mobile optimization (responsive design)
- הוסף offline indicator + graceful degradation
- שפר את ה-LearningPanel — הצג model version, convergence forecast

**שלב 5 — היסק מתקדם (LOW-MEDIUM):**
- Warm-start מ-Cloud — טען best params מכל המשתמשים כ-starting point
- Pattern embeddings — המר fingerprints ל-vectors לחיפוש דמיון
- A/B testing framework לגרסאות אלגוריתם

### איך להתחיל:
1. קרא את `PSY4_CLAIMS_VS_REALITY_ROAST.md` + `PSY4_DEEP_ROAST_V2.md` להבנת הפערים שכבר נסגרו
2. בדוק `git log --oneline -10` לראות את היסטוריית הקומיטים האחרונה
3. התחל מ-**שלב 1** (authentication) — זה הפער הקריטי ביותר למוצר מסחרי
4. אחרי כל שלב: commit + push + verify בדפדפן

### קבצים חשובים להכרות:
- `src/lib/psyLive4/psyLive4.ts` — המנוע הראשי (72KB, 1500+ שורות)
- `src/lib/psyLive4/learning.ts` — הלומד (hill-climbing + pattern memory + Turso sync)
- `src/lib/psyLive4/audio-quality.ts` — 7 metrics + K-weighted LUFS + convergence
- `src/lib/psyLive4/radio-listener.ts` — radio connection + BPM + breakdown detection + failover
- `src/lib/turso.ts` — Turso HTTP client (fetch-based, not @libsql/client)
- `src/lib/turso-sync.ts` — client-side sync bridge
- `src/app/api/` — 6 API routes
- `src/app/page.tsx` — ה-UI הראשי
- `src/components/psyforge/` — 20 רכיבי UI

### Credentials זמינים (ב-upload/turso.txt):
- Turso platform token + database (forge-db) — **עובד**
- Cloudflare API token — לא בשימוש עדיין
- Supabase key — לא בשימוש עדיין
- GitHub token — **[REDACTED]** — צריך token חדש ל-push

### חשוב:
- **אל תמחק נתוני Turso** — יש שם learning history יקר
- **אל תשנה את ה-credentials ב-.env** ללא גיבוי
- **ודא שהשרת שורד page loads** לפני שמכריז על הצלחה
- **Push to GitHub אחרי כל שלב** — אל תצבור עבודה לא מחויבת

התחל עכשיו ב-**שלב 1: Authentication + Deployment** — זה הפער הקריטי ביותר שמונע מהמוצר להיות מסחרי.
