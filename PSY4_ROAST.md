# PSY4 ROAST — Brutal Honest Audit

## WHAT WAS BAD

### 1. UI Spam Causing Latency (CRITICAL)
The #1 cause of "heavy latency" was NOT the audio engine. It was the UI:
- 8 React `setState` calls every 100ms = 80 re-renders/second
- `setSampleUsage()` sends a potentially large object (147 samples) to React state every 100ms
- React reconciles the entire NOW PLAYING component tree on every update
- Plus a `requestAnimationFrame` visualizer at 60fps creating `new Uint8Array()` every frame
- Total: ~180 main-thread operations/sec competing with the audio scheduler
- The audio scheduler runs on `setInterval(25ms)` on the SAME main thread
- When React is busy re-rendering, the scheduler misses its window → jitter, gaps, latency

**This was the actual cause of the user-perceived "heavy latency." Not the AudioWorklet. Not the lookahead. The UI.**

### 2. 147 Samples Loaded Was Fake Progress
Loading 141 real drum machine samples did NOT make the music sound better. It made it sound like a **sample browser** — a different kick every hit, no sonic identity. Commercial tracks use ONE kick for 32+ bars. Loading more samples just increased memory and decode time without improving the music.

### 3. NOW PLAYING Display Was Diagnostic Leakage
Showing `md_hat_Hats_0008.wav` jumping on screen during playback is:
- Distracting to the user
- CPU-expensive (React re-renders)
- Not how commercial software looks
- Proof that the architecture was optimizing for "proving it works" instead of "sounding good"

### 4. 11-Section Arrangement Was Still a Loop
Adding 11 sections with different `bassOn`/`leadOn` flags doesn't create musical evolution. If every section uses the same kick pattern, same bass grammar, same lead motif generator — it's still the same loop with different mutes. The music didn't actually change between sections.

### 5. Bass Was Still Wrong
Despite the "square wave + 120ms decay" fix, the bass was still using `bass_A.wav` (a PSY3 sample) as the primary character layer. PSY3 is explicitly NOT a sound quality reference. Using PSY3's bass sample as the foundation of PSY4's bass is architecturally wrong.

### 6. MachineDrum Stabs Are NOT Leads
Using drum machine stab samples as the lead voice is fundamentally wrong. A stab is a short percussive hit — it has no sustain, no melodic character, no filter movement. It's a drum, not a synth lead. This made the lead sound like a drum machine, not a musical instrument.

### 7. React State Updates During Playback
The architecture violated a basic real-time audio rule: **never block the main thread with UI updates during audio playback.** The 100ms `setInterval` with 8 `setState` calls was the worst offender.

## WHAT WAS FAKE PROGRESS

| Change | Claimed | Reality |
|--------|---------|---------|
| 141 real samples loaded | "Professional sound library" | Sample browser, not production |
| NOW PLAYING display | "Proves what's playing" | Caused latency, distracted user |
| 11-section arrangement | "Real arrangement engine" | Same loop with different mutes |
| Phrase locking | "Sonic consistency" | Same kick for 8 bars, but still same music |
| Bass_A.wav as bass | "Hybrid sample bass" | PSY3 sample = not commercial quality |
| MachineDrum stabs as lead | "Real sample lead" | Drum stabs are not leads |
| 80 re-renders/sec | "Real-time UI" | Main thread blocking = latency |

## WHAT WAS ACTUALLY BROKEN

1. **UI performance**: 80 React re-renders/sec + 60fps canvas = main thread starvation
2. **Audio scheduling**: setInterval(25ms) competing with React for main thread time
3. **Sample architecture**: 147 samples decoded and kept in memory = unnecessary overhead
4. **Lead identity**: Drum stabs used as melodic leads = wrong sound category
5. **Bass foundation**: PSY3 bass sample used as character layer = wrong quality reference
6. **Arrangement**: Section changes only changed mutes, not musical content

## WHAT NEEDS TO CHANGE

### IMMEDIATE (P0)
1. **Kill the NOW PLAYING UI spam** — remove all per-hit React state updates
2. **Throttle UI updates to 2/sec** (not 10/sec) — only update section/level display
3. **Remove sample usage from React state** — keep it internal, don't render it
4. **Simplify the visualizer** — or remove it entirely during playback

### SECONDARY (P1)
5. **Remove bass_A.wav from bass** — use pure synth bass (the square wave fix was correct)
6. **Remove MachineDrum stabs from lead** — use synth lead (stabs are drums, not leads)
7. **Reduce active samples** — don't need 147, need ~20 well-chosen ones

### TERTIARY (P2)
8. **Make sections actually different** — different bass patterns, not just mutes
9. **Add real musical mutation** — change bass rhythm, not just density

## REMAINING FAILURES (HONEST)

- PHYSICAL LISTENING UNVERIFIED — cannot hear the output
- No WAV rendering pipeline — cannot A/B test
- No repetition analysis — cannot detect loops
- Bass still uses PSY3 sample — not commercial quality
- Lead still uses drum stabs — not a real lead sound
- Sections still use same musical grammar — not real variation
- UI still causes main-thread pressure — latency source not fully fixed
