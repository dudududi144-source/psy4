# Skill Research — Audio Production

## Summary

A systematic search was conducted for Skills that could help with audio production, sound design, DSP, music theory, sample libraries, and related tasks.

## Search Results

### ClawHub Skills Repository
Searched `clawhub search "audio production music DSP"` and `clawhub search "sound design sample"` — **no results found**. ClawHub does not currently host any audio-production-specific skills.

### Available Z.ai Skills (from system)

| Skill | Purpose | Useful for PSY4? | Integration Cost | Dependency | Verdict |
|-------|---------|------------------|------------------|------------|---------|
| **web-search** | Web search via z-ai-web-dev-sdk | 2/10 — could find CC0 sample sources but results need manual verification | Low | z-ai-web-dev-sdk | MAYBE — for finding legal sample sources |
| **web-reader** | Extract content from web pages | 1/10 — could read sample license pages but not audio | Low | z-ai-web-dev-sdk | SKIP |
| **image-search** | Find images on the web | 0/10 — not audio | Low | z-ai-web-dev-sdk | SKIP |
| **image-generation** | AI image generation | 0/10 — not audio | Med | z-ai-web-dev-sdk | SKIP |
| **VLM** | Vision language model | 1/10 — could analyze spectrograms if visualized, but indirect | Med | z-ai-web-dev-sdk | SKIP |
| **LLM** | Large language model chat | 3/10 — could generate musical patterns textually, but we already have PSY3 grammar | Med | z-ai-web-dev-sdk | MAYBE — for reference analysis descriptions |
| **TTS** | Text to speech | 0/10 — not music | Med | z-ai-web-dev-sdk | SKIP |
| **ASR** | Speech to text | 0/10 — not music | Med | z-ai-web-dev-sdk | SKIP |
| **video-understand** | Video analysis | 0/10 — not audio production | Med | z-ai-web-dev-sdk | SKIP |
| **agent-browser** | Browser automation | 2/10 — could automate downloading CC0 samples, but fragile | Med | Playwright | MAYBE — for batch sample download |
| **charts** | Chart/diagram creation | 2/10 — could visualize frequency analysis | Low | matplotlib/ECharts | MAYBE — for benchmark reports |
| **xlsx** | Spreadsheet creation | 1/10 — could store sample metadata, but JSON is better | Low | ExcelJS | SKIP |
| **pdf** | PDF generation | 1/10 — could generate reports, but Markdown is better | Low | ReportLab | SKIP |

## Conclusion

**No audio-production-specific Skills are available.** The available skills are general-purpose tools (web search, image processing, text generation) that don't provide DSP, audio analysis, sample management, or music theory capabilities.

### Skills Selected for Use

**None.** None of the available skills provide capabilities that would improve PSY4's audio production quality. The audio engine must be built with:
- Native Web Audio API + AudioWorklet (already in place)
- Procedural DSP (Moog filter, BL oscillators — already in place)
- Procedural sample generation (already in place)
- TypeScript-native musical grammar (already in place)

### Skills That Could Be Useful in Future

- **web-search**: Could be used to find legal CC0/public-domain sample URLs, but each sample would need manual license verification before use. Too fragile for automated pipeline.
- **LLM**: Could be used to generate textual descriptions of reference tracks for the reference analyzer, but the actual audio analysis must be done with DSP (FFT, spectral analysis), not text generation.

### Why No Skills Were Installed

1. **No audio-specific skills exist** on ClawHub or in the Z.ai skill set
2. **General-purpose skills don't add value** — web-search can't analyze audio, VLM can't process WAV files, LLM can't do DSP
3. **PSY4's audio needs are specialized** — real-time DSP, sample-accurate timing, AudioWorklet integration — none of which any available skill provides
4. **Building native is better** — TypeScript DSP code runs in the AudioWorklet with zero latency, which is what PSY4 needs

## Final Verdict

**SKIP all available skills.** Build the production intelligence system natively in TypeScript, leveraging the existing AudioWorklet architecture. The "intelligence" must come from:
- Context-aware selection algorithms (TypeScript)
- Mix analysis (FFT in AudioWorklet)
- Musical grammar (ported from PSY3)
- Production rules (extracted from PSY3 knowledge transfer)

No external skill can replace these — they must be built as integrated systems.
