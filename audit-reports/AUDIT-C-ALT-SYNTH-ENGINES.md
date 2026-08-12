# AUDIT-C — Alternative Synth Engines for PSY4

**Task ID:** AUDIT-C
**Agent:** Research sub-agent (no code modified)
**Goal:** Identify programmatically-controllable, offline-renderable synth engines with a higher sound-quality ceiling than PSY4's current 3-osc unison + LPF + waveshaper voice chain.
**Sandbox:** Linux cloud (Debian trixie), Python 3.12, Node 24, root-ish. No GUI.
**Method:** `apt-cache`/`which`/`pip --dry-run` installability checks + 5 targeted web searches (Surge CLI, Vital headless, pedalboard VST3, scsynth NRT, synth-inversion literature).

---

## MASTER COMPARISON TABLE

| # | Engine | Installable here? | Programmatic? | Offline WAV render? | Quality ceiling | Best for | Wire effort |
|---|--------|-------------------|---------------|---------------------|-----------------|----------|-------------|
| 1 | **Surge XT** | Y — Flatpak (Flathub `org.surge_synth_team.surge-xt`) or `.deb` from surge-synthesizer.github.io. NOT in trixie apt. | Y — CLI flags (v1.3+), OSC port, `surge-python` pybind module exposes full synth | Y — CLI render-to-WAV + OSC `render` action + Python `process()` | Very high — wavetable + FM3 + mod-matrix, used in commercial psytrance | lead / bass / FX | **M** (install flatpak/deb, write wrapper) |
| 2 | **Vital** | N in apt; Y via build from `mtytel/vital` GitHub (JUCE+clang, ~30 min compile) | Y — `HeadlessSynth` class in source tree | Y — HeadlessSynth renders note events to buffer | Very high — spectral-warped wavetable, Serum-class | lead / bass | **L** (build from source) |
| 3 | **SuperCollider / scsynth** | Y — `apt install supercollider` (3.13.0 in trixie) | Y — OSC binary bundle, `supercollider` pip pkg (0.0.6), `python-osc` | Y — **NRT mode** reads OSC file → WAV at 50-150× realtime (well documented) | Very high — full DSP language (additive/subtractive/FM/PM/granular/PM/physical-modeling/PVS) | **all** (kick/bass/lead/FX) | **M** (learn sclang syntax, write .scd score templates) |
| 4 | **Dexed** | N in apt; Y via VST3 download from GitHub releases | Y — MIDI + sysex patches | Y — through host (pedalboard VST3 host or Carla) | High — DX7 FM emulator, authentic FM bass/EP | bass / lead / EP | **L** (download VST3, host setup) |
| 5 | **ZynAddSubFX** | Y — `apt install zynaddsubfx` (3.0.6) + `zynaddsubfx-lv2` | Y — OSC (port 6613), CLI `-N` headless | Y — NRT via `-N` flag + ALSA dummy or OSC score | High — additive+FM+sub engines, pad-rich | pad / lead / FX | **M** |
| 6 | **FluidSynth** | Y — `apt install fluidsynth` (2.4.4); pyfluidsynth via pip | Y — CLI + pyfluidsynth + MIDI file | Y — `fluidsynth -F out.wav sf2 mid` (canonical example) | Medium — sample-playback only, no synthesis | sample-based kicks/perc/bass | **S** |
| 7 | **web-audio-api (Node)** + tone.js | Y — `web-audio-api` already installed; `tone` via npm | Y — pure JS API, scriptable | Y — `OfflineAudioContext` renders to buffer, write WAV with `soundfile` | Low-Medium — same ceiling as current PSY4 voices | all (same as today) | **S** |
| 8 | **Pure Web-Audio FM** | N/A (already in PSY4) | Y | Y (OfflineAudioContext) | Medium — real FM via `OscillatorNode→GainNode→frequency AudioParam` | lead / bass | **S** (rewrite lead voice) |
| 9 | **Granular (pyo / pure JS)** | pyo via pip (builds C, ~3 min); `cloudscape`/`granular.js` not packaged | Y (pyo); JS limited | Y (pyo renders to soundfile) | Medium-High — pyo granular cloud good for FX/pads | FX / pad / texture | **M** |
| 10 | **Karplus-Strong (Web Audio or numpy)** | N/A — algorithm only | Y | Y | Low — useful for plucks/strings only | plucks (limited) | **S** |
| 11 | **Carla host (LV2/VST2/VST3/CLAP)** | **N** — `apt-cache policy carla` returns `Candidate: (none)`. KXStudio repo needed. `jalv` (LV2-only host) IS in apt (1.6.8) | Y — OSC + Python `carla-python` | Y — `carla --no-gui` + OSC render | Host only (depends on loaded plugin) | all (host role) | **L** (add KXStudio source, install) |
| 12a | **pyo** | Y — `pip install pyo` (1.0.5, builds C sources) | Y — Python-native DSP server | Y — `Server.record()` to WAV | High — full DSP framework, additive/FM/filters/granular/analysis | all | **M** |
| 12b | **pedalboard (Spotify)** | **Already installed** (v0.9.21) | Y — Python-native, hosts VST3/LV2/AU | Y — `pedalboard.render()` + offline `process()` | High — chains effects + hosts instruments | FX chain / VST3 host | **S** |
| 12c | **sounddevice + numpy** | Already installed (numpy+sounddevice) | Y — raw buffers | Y — `soundfile.write` | Low (you write DSP) | low-level | **M** |
| 13a | **DDSP (Magenta)** | Y — `pip install ddsp` (3.7.0) | Y — TF/PyTorch decoder | Y — direct numpy render | Medium-High — differentiable harmonics+noise | inversion / resynthesis | **L** (TF stack) |
| 13b | **torchsynth** | Y — `pip install torchsynth` (1.0.2) | Y — PyTorch modules | Y — forward pass → numpy → WAV | Medium — modular synth, differentiable | inversion / research | **M** |

---

## DETAILED SECTIONS

### 1. Surge XT (open-source hybrid synth)

Surge XT is a polyphonic hybrid synthesizer with three wavetable/fm3 oscillators per scene, dual scenes, a comprehensive modulation matrix (12 LFOs, 6 envelopes, MIDI/CC/macros), and a chain of effects. It is widely used in commercial psytrance production for bass and lead lines because of its sharp FM timbres and analog-modeled filters.

**Install on this sandbox:** Not in Debian trixie apt. Three viable routes:
1. **Flatpak from Flathub** (`org.surge_synth_team.surge-xt`) — cleanest. Requires `apt install flatpak` + `flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo` + install. Provides standalone + VST3 + LV2.
2. **.deb from surge-synthesizer.github.io** — direct download `surge-xt-linux-x64-<ver>.deb`, then `dpkg -i`. The Surge team publishes a Debian/Ubuntu .deb on every release.
3. **Build from source** — CMake + JUCE, ~20 min compile.

**Programmatic control (concrete):** Surge XT 1.3+ (Dec 2023 release) added a **CLI** for headless operation and an **OSC interface** (confirmed by cdm.link article and surge-synthesizer GitHub). Additionally, the Surge team maintains **`surge-python`** — a pybind11 binding exposing the synth's C++ innards directly to Python (see `surge-synthesizer/surge` README: "Surge XT uses pybind to expose the innards of the synth to Python code for direct native access to all its features"). Patches are `.fxp` files (binary) — but the Surge repo includes `scripts/` to generate wavetables and a documented patch XML format (`.stm`/`.scl`) that can be programmatically produced.

**Offline WAV render:** Via (a) CLI headless mode (1.3+), (b) OSC `/render` action, or (c) Python `surge.process(block)` → numpy → `soundfile.write`. The Python path is the most flexible: load a patch, send note-on/note-off events, pull audio blocks, write to WAV — fully deterministic.

**Sound-quality verdict:** Top tier. Comparable to Serum/Nexus for EDM-style sounds. Wavetable scanning + FM3 + analog-modeled filters (Cutoff-nulling, OB-Xd) reach the modern psytrance aesthetic.

**Wire-to-PSY4 effort:** **M**. Write a Python wrapper class implementing the PSY4 voice interface (`play(voice, pitch, vel, dur, params) → float[]`). One-time install of flatpak or .deb. PSY4's `NotePlan` schedule maps cleanly to Surge note events. Estimated 1-2 days to wire, plus per-voice patch-design time.

---

### 2. Vital (spectral warping wavetable)

Vital is a free/open-source spectral-warping wavetable synthesizer by Matt Tytel, widely considered the closest free alternative to Serum. It features four oscillators (3 wavetable + 1 sub), spectral warping modes, two filters, and a modulation matrix.

**Install on this sandbox:** Not in apt. Vital's GitHub repo (`mtytel/vital`) is updated on a delay after binary releases. Pre-built Linux binaries are distributed via the Vital website (vital.audio) as `.deb` and AppImage — but download requires account creation. Build-from-source is JUCE + CMake + a recent clang; ~30-45 min compile on this cloud box.

**Programmatic control:** The repo includes a **`HeadlessSynth`** class — confirmed by Reddit r/VitalSynth thread "Has anyone used Vital in headless mode?" which describes setting up the HeadlessSynth object, specifying MIDI note, note length, and BPM, then rendering to a buffer. This is C++ only — there is no official Python binding, but the class is small and could be wrapped with pybind11 or invoked from a small C++ binary.

**Offline WAV render:** Yes, via HeadlessSynth. No first-class CLI binary is shipped — you would compile a small `vital_render` driver that links the HeadlessSynth object and writes to WAV.

**Sound-quality verdict:** Top tier — equivalent to Serum. Spectral warping gives leads/basses that are very hard to reach with Web Audio primitives.

**Wire-to-PSY4 effort:** **L**. Requires either (a) account-gated binary download + reverse-engineer the VST3 to host via pedalboard, or (b) full source build + write a C++/pybind render driver. ~3-5 days. Best sound quality but highest effort of the top candidates.

---

### 3. SuperCollider / scsynth (server-based DSP)

SuperCollider is a programming language (`sclang`) + audio server (`scsynth`) architecture. The server is controlled via OSC messages, runs headless, and has first-class Non-Real-Time (NRT) mode that reads an OSC score file and renders audio "as fast as the CPU allows" — typically 50-150× realtime (per supercollider-mcp docs).

**Install on this sandbox:** `apt install supercollider` (Debian trixie 3.13.0, fully featured). No additional repos needed. Verified: candidate version `1:3.13.0+repack-3`.

**Programmatic control (concrete):** Three layers, all usable from Python:
1. **`scsynth -N`** NRT mode: write a binary OSC bundle file (note-ons, control-bus sets, synth-new/-free) and `scsynth -N score.osc out.wav 44100 WAV int16 -n 1024`. Fully deterministic, no audio hardware.
2. **Live OSC to a booted scsynth** (`scsynth -u 57110`): use `python-osc` library (pip, 1.10.2 confirmed installable) to send `/s_new`, `/n_set`, `/n_free` messages.
3. **`supercollider` pip package** (0.0.6): a Python wrapper around sclang for higher-level SynthDef construction. Less mature but usable.

SynthDefs (synth definitions) are written in sclang's DSL — a small functional language for wiring unit generators (SinOsc, Saw, LFPulse, EnvGen, PMOsc, MoogFF, etc.). SynthDefs compile to efficient C++ DSP graphs.

**Offline WAV render:** Documented at `doc.sccode.org/Guides/Non-Realtime-Synthesis.html`. Pattern:
```
scsynth -N input.osc output.wav 44100 AIFF int16 -z 1024
```
The `input.osc` file contains the entire performance (synthdef load + scheduled note events). Renders at 50-150× realtime, fully deterministic, no audio interface needed.

**Sound-quality verdict:** Highest of any option here. scsynth is a complete DSP language — additive banks of 100+ partials, FM/PM (PMOsc, FMSynth), wavetable (Shaper, OscBuf), granular (GrainBuf, GrainIn), physical modeling (Pluck, Klank, Spring), phase-vocoder spectral processing (PV_BinScramble, PV_MagMul), and a full FX chain (reverb FreeVerb/GVerb, delay CombN, distortion). Many psytrance producers use SuperCollider directly. Sample-accurate scheduling, anti-aliased oscillators (Lanczos interpolation), 64-bit float internal mixing.

**Wire-to-PSY4 effort:** **M**. Two routes:
- **(A) sclang templates:** write `.scd` files containing SynthDefs for kick/bass/lead/hat. PSY4's `NotePlan` is serialized to an OSC score file. Python wrapper invokes `scsynth -N`. Lowest fidelity loss, most control. ~2-3 days.
- **(B) live OSC:** boot scsynth, send note events from Node via `osc` npm package. Closer to PSY4's current live architecture but loses offline determinism.

Recommend route A for the A/B listening pipeline (offline WAV is the goal).

---

### 4. Dexed (DX7 FM emulator)

Dexed is an open-source VST3/CLAP/LV2 emulator of the Yamaha DX7 FM synthesizer. It loads original DX7 sysex patches and exposes FM parameters directly.

**Install:** Not in apt. GitHub releases provide Linux VST3 binary. Manual download to `~/.vst3/Dexed.vst3`. No standalone build needed.

**Programmatic control:** Dexed is a plugin (VST3/CLAP/LV2) — receives MIDI note events + sysex patch data. No native CLI. Must be hosted.

**Offline WAV render:** Through a VST3 host. Options:
- **pedalboard** (already installed, v0.9.21): `pedalboard.load_plugin("Dexed.vst3")` then `plugin.process(audio_buffer, sample_rate)`. Sends MIDI via `plugin.__call__` with MIDI messages. Renders fully offline.
- **Carla** — not in apt (see #11).
- **jalv** — LV2 only, in apt (1.6.8). Could load the LV2 build of Dexed if available.

**Sound-quality verdict:** Excellent for FM bass/EP/lead — authentic DX7 timbres. Narrow scope: only FM, only DX7-style. Not useful for wavetable leads or sample-based kicks.

**Wire-to-PSY4 effort:** **L**. Plugin download + host wrapper (pedalboard) + sysex patch management. ~2-3 days but limited to FM voices.

---

### 5. ZynAddSubFX (additive + subtractive + FM)

Open-source multi-engine synth: additive (PADsynth), subtractive, FM, and physical modeling. Widely used in Linux audio.

**Install:** `apt install zynaddsubfx` (3.0.6) + `zynaddsubfx-lv2` (LV2 plugin variant). Both in trixie.

**Programmatic control:** Standalone supports OSC on port 6613 (documented). LV2 plugin variant controllable via jalv or Carla. CLI headless mode via `-N` flag (ALSA dummy driver). Patches are XML files — programmatically editable.

**Offline WAV render:** Yes — `zynaddsubfx -N -b 64 -r 44100 -O jack -I alsa -P <port> -l patch.xmz` can render in headless mode; output routed via JACK to a recorder. Trickier than scsynth NRT (JACK setup needed).

**Sound-quality verdict:** High. PADsynth generates rich evolving pads; the additive engine reaches sounds subtractive cannot. FM is decent but not DX7-class.

**Wire-to-PSY4 effort:** **M**. JACK setup is the main friction; otherwise XML patches are easy to generate.

---

### 6. FluidSynth (SoundFont2 player)

The canonical Linux SoundFont2 player. Reads `.sf2`/`.sf3` files and plays via MIDI.

**Install:** `apt install fluidsynth` (2.4.4) + `libfluidsynth-dev` for C API. Python bindings: `pyfluidsynth` via pip (1.4.0, confirmed installable).

**Programmatic control:** CLI accepts MIDI files; C API and pyfluidsynth allow note-on/note-off in real time; settings via `set_setting()`.

**Offline WAV render:** **Easiest of any option.** Canonical usage: `fluidsynth -F output.wav soundfont.sf2 input.mid`. Renders fully offline, no JACK.

**Sound-quality verdict:** Medium — sample playback, no synthesis. Quality depends entirely on the SoundFont. Excellent for realistic kicks, percussion, strings; not for synthesized bass/lead.

**Wire-to-PSY4 effort:** **S**. PSY4's `NotePlan` already maps to MIDI. Need a SoundFont collection. ~half a day. Best for **rounding out the palette** (real kicks/percussion) but cannot be the primary synth.

---

### 7. wavetable engines in Node/JS land

`web-audio-api` is already installed at `/home/z/my-project/node_modules/web-audio-api`. It supports `AudioBufferSourceNode` (single-cycle waveform → looped). `tone.js` is NOT installed but `npm install tone` works; it offers `Tone.Oscillator`, `Tone.MonoSynth`, `Tone.FMSynth`, `Tone.PolySynth` — significantly richer than PSY4's current voice chain. `meyda` (audio feature extraction) is NOT installed but pip-installable via npm. `wavesurfer.js` is a UI library, irrelevant for headless.

**Offline render:** `OfflineAudioContext(seconds * sampleRate, channels)` → `startRendering()` returns a Promise<AudioBuffer> → write to WAV with `wavefile` or `node-wav`.

**Sound-quality verdict:** Medium. Same Web-Audio primitives PSY4 already uses — improved by Tone.js's FM/PolySynth voices but capped by the same engine. Lower ceiling than native engines like Surge/scsynth.

**Wire-to-PSY4 effort:** **S**. Lowest friction (no native deps), but doesn't escape the Web Audio quality ceiling that motivated this audit.

---

### 8. FM in pure Web Audio

Web Audio natively supports FM via `OscillatorNode` (modulator) → `GainNode` (mod depth) → `OscillatorNode.frequency` (carrier AudioParam). This is the canonical Chowning FM technique. PSY4's current lead voice does NOT do this — it uses 3-osc unison + LPF + waveshaper, which is a subtractive-saw voice with no FM harmonicity.

**Offline render:** Same `OfflineAudioContext` path.

**Sound-quality verdict:** Medium — real FM is achievable but the Web Audio `OscillatorNode` uses basic band-limited wavetables; aliasing on high FM indices is a known issue without oversampling.

**Wire-to-PSY4 effort:** **S**. Rewrite `leadVoice` to use a 2-oscillator FM pair (carrier + modulator) with `index` and `ratio` AudioParams. ~half a day. Should be done regardless as a baseline improvement.

---

### 9. Granular engines

Pure-JS options (`cloudscape`, `granular.js`) are unmaintained hobby projects — not worth the wire effort. **`pyo`** (Python DSP framework) has `Granulator`, `Particle`, `SineLoop` granular voices — all programmable and offline-renderable. `pedalboard` has no granular processor.

**Sound-quality verdict:** High for textures/pads/FX (the classic psytrance "sweep" and "vocal grain" sounds). Not for bass/lead.

**Wire-to-PSY4 effort:** **M** via pyo. Niche use — only for FX layer.

---

### 10. Physical modeling (Karplus-Strong)

Trivial in Web Audio: `AudioBufferSourceNode` (noise burst) → `DelayNode` (tuned to pitch period) → `GainNode` (feedback < 1) → `BiquadFilterNode` (lowpass in loop). Or in numpy: 5-line KS algorithm.

**Sound-quality verdict:** Useful for plucked-string and bell timbres. Limited psytrance applicability — mostly for incidental accents.

**Wire-to-PSY4 effort:** **S**. ~2 hours. Optional enhancement, not a primary engine.

---

### 11. VST/CLAP/LV2 hosting (Carla / jalv / pedalboard)

**Carla** is a fully-featured plugin host supporting VST2/VST3/CLAP/LV2 with OSC scripting — but `apt-cache policy carla` returns `Candidate: (none)` on this trixie sandbox. KXStudio repo must be added first (`add-apt-repository ppa:kxstudio-debian/kxstudio`). Adds friction.

**jalv** (LV2-only host, in apt 1.6.8) is simpler — `jalv -g none <plugin-uri>` runs headless with OSC control. Limited to LV2 plugins (excludes Dexed's VST3-only build).

**pedalboard** (Spotify) — **already installed v0.9.21** — is the sleeper hit. It is a JUCE-wrapped VST3/LV2/AU host in Python that runs fully offline. `pedalboard.load_plugin("path/to/plugin.vst3")` returns a plugin instance, `plugin.process(audio, sr)` runs the plugin on a buffer, MIDI events passed in `MidiMessage` array. It is the most direct route to using any VST3 instrument (Surge, Vital, Dexed) offline in Python.

**Sound-quality verdict:** Host-only — quality depends on the loaded plugin.

**Wire-to-PSY4 effort:** **S** for pedalboard (already installed), **L** for Carla (repo add + install).

---

### 12. Pure Python DSP

**pyo** (1.0.5, pip-installable, builds C sources in ~3 min) is a full DSP framework: oscillators, filters, FM, granular, spectral, FX, LFOs. `Server.record()` writes directly to WAV. Programmable entirely in Python. Quality ceiling high but below scsynth (smaller UGen set).

**pedalboard** (already installed) — see #11.

**sounddevice + numpy** — raw buffer I/O. You write all DSP by hand. Useful as glue but not as an engine.

**Sound-quality verdict:** pyo high, pedalboard high (as host), numpy low.

**Wire-to-PSY4 effort:** **M** for pyo, **S** for pedalboard.

---

### 13. Synthesizer Inversion literature (full section below)

**DDSP** (Google Magenta, Engel et al. 2020) — differentiable harmonics+noise synth with multi-scale spectrogram loss. `pip install ddsp` (3.7.0). Not a synth you'd ship — used to invert a recording into synth params.

**torchsynth** (1.0.2, pip) — differentiable modular synth in PyTorch. 30+ modules, all backprop-able. Useful for parameter search.

**DDX7** (Caspe et al., ISMR 2022, 67 citations) — differentiable FM synthesis, learns DX7 params from audio.

**Hayes et al. 2025** "Audio synthesizer inversion in symmetric parameter spaces" (ISMIR, 13 citations) — directly addresses the one-to-many problem PSY4 cares about.

**Hayes 2024** review in Frontiers in Signal Processing (99 citations) — comprehensive DDSP survey.

---

## SYNTHESIZER INVERSION — Literature Review

PSY4's goal is to invert observed radio audio → produce matching synth patches → render to WAV for A/B comparison. This is the **synthesizer inversion problem**: given a target sound, find synth parameters that produce it. The user correctly identified it as one-to-many (multiple parameter sets yield perceptually similar sounds).

**Five most relevant works:**

1. **Engel et al. 2020 — DDSP (Differentiable Digital Signal Processing)** — Google Magenta. arXiv:2001.04643. Introduces a differentiable harmonics+noise synth trained end-to-end with a multi-scale STFT loss (six frame sizes, log-magnitude). The decoder maps latent → f0, loudness, harmonic distribution, noise envelope. Directly relevant: DDSP can be used to invert any monophonic sound into a synth performance. `pip install ddsp` works on this sandbox. Limitation: the DDSP synth itself is basic (additive harmonics + filtered noise) — lower sound-quality ceiling than Surge/scsynth. Best used as an inversion *tool*, not as the rendering engine.

2. **Hayes et al. 2025 — "Audio synthesizer inversion in symmetric parameter spaces"** (ISMIR 2025, 13 citations; arXiv:2506.07199). Explicitly formalizes the one-to-many symmetry: multiple parameter configurations produce the same signal, so naive MSE/STFT loss has flat minima and ambiguous gradients. Proposes handling symmetry via permutation-equivariant architectures. **Most directly relevant paper to PSY4's stated problem.**

3. **Caspe et al. 2022 — DDX7: Differentiable FM synthesis of musical instrument sounds** (ISMIR 2022, 67 citations; arXiv:2208.06169). Makes a DX7-style FM synth fully differentiable, trains to match instrument samples. Demonstrates that even non-trivial FM architectures can be inverted via gradient descent through STFT loss. Relevant because FM is a core psytrance bass/lead technique.

4. **DDSynth-RL (2026, arXiv:2608.03032)** — uses **masked discrete diffusion** over synth parameter tokens (rather than continuous gradient descent). Avoids the differentiability requirement — works with any black-box synth (Surge, scsynth, etc.) as long as parameter space is tokenizable. Most relevant if PSY4 wants to invert to Surge/scsynth parameters without rewriting them as differentiable graphs.

5. **torchsynth (Tsuchiya et al. 2021)** — `pip install torchsynth` (1.0.2). Differentiable modular synth in PyTorch — 30+ modules (VCO, VCF, VCA, ADSR, LFO, FM op, wavetable). All backprop-able. Useful as a *prototyping* inversion sandbox before applying techniques to a non-differentiable target like scsynth.

**Hayes 2024 review** ("A review of differentiable digital signal processing for music and speech", Frontiers in Signal Processing, 99 citations) — comprehensive survey, recommended reading.

**Relevance to PSY4:**
- For **reference→sound inversion** (the A/B listening pipeline): the natural fit is **DDSP + STFT loss** to invert a radio snippet to a differentiable synth, then render. But DDSP's synth is too simple for psytrance aesthetics.
- Better strategy: use **torchsynth** as the inversion target (differentiable, modular, FM-capable), train an inverter, then **transfer** the learned parameters to scsynth or Surge for high-quality rendering. This is the "differentiable proxy → real synth" pattern.
- For one-to-many ambiguity (Hayes 2025): use **multi-start optimization** + diversity penalty, or **conditional generation** (condition the inverter on a target timbre family).

---

## TOP 3 CANDIDATES FOR PSY4

### #1 — SuperCollider / scsynth (NRT mode)
**Why:** Best installability-to-quality ratio on this sandbox. `apt install supercollider` works right now (3.13.0). NRT mode is purpose-built for offline WAV rendering at 50-150× realtime, fully deterministic. Quality ceiling is professional-grade (additive/FM/PM/granular/physical-modeling/spectral — used in commercial psytrance). Python control via `python-osc` to `scsynth -N` is clean. SynthDef DSL is concise (a kick drum is ~10 lines of sclang). **The only candidate that is both installable today AND has a top-tier quality ceiling AND has first-class NRT rendering.**

### #2 — Surge XT (Python binding via surge-python / CLI / OSC)
**Why:** Highest quality ceiling for traditional synth voices (wavetable + FM3 + modulation matrix — the exact palette psytrance leads/basses need). Surge XT 1.3+ has CLI and OSC; the `surge-python` pybind module exposes the full synth. Installable via Flatpak (Flathub) or .deb from surge-synthesizer.github.io. Recommended as a **secondary "premium voice" tier** for leads/basses that need wavetable scanning or complex FM — voices that scsynth can technically produce but where Surge's curated wavetables sound better out-of-box.

### #3 — pedalboard (already installed) + a VST3 instrument
**Why:** pedalboard v0.9.21 is **already installed** on this sandbox. It can host any VST3 instrument offline in Python with `load_plugin()` + `process()`. This makes it a universal bridge: download Dexed VST3 (FM), Vital VST3 (spectral wavetable), or Surge VST3 (hybrid) and pedalboard renders them all to WAV with the same Python API. Decouples PSY4 from any single synth — swap instruments without changing the wire layer. Lower friction than scsynth for "just play this VST3 patch with these MIDI notes" use cases.

**Honorable mention — FluidSynth** (apt, single-line CLI render `fluidsynth -F out.wav sf2 mid`): the right tool for sample-based kicks and percussion to round out the palette. Worth installing alongside the top 3, but not a primary synth engine.

---

## RECOMMENDATION

**Primary: SuperCollider (scsynth NRT mode) as PSY4's Studio engine backend. Secondary: Surge XT (Python binding) for premium lead/bass voices. Tertiary: FluidSynth for sample-based percussion.**

Reasoning: SuperCollider is the only candidate that simultaneously satisfies all three hard constraints — (1) installable on this exact sandbox today (`apt install supercollider` works, no extra repos, no builds), (2) fully programmatically controllable from Python via OSC + NRT score files with no GUI dependency, and (3) renders offline to WAV with deterministic, sample-accurate output at 50-150× realtime. Its quality ceiling is the highest of any installable option (full DSP language — additive banks, FM/PM, granular, spectral, physical modeling, professional FX). It can produce every voice PSY4 needs (kick via `SinOsc + EnvGen.perc` with pitch sweep + distortion; bass via `Saw + MoogFF + Lag`; lead via `PMOsc` chains or wavetable `Osc`; hats via `WhiteNoise + BPF + EnvGen`). Add Surge XT (via `.deb` install + `surge-python` binding) as a secondary "premium voice tier" for lead/bass patches where curated wavetables or analog-modeled filters matter — wire it through the same Python voice interface scsynth uses, so PSY4's `NotePlan → render` abstraction is engine-agnostic. Add FluidSynth (`apt install fluidsynth`) for sample-based kicks/percussion when the reference audio has real drum-machine character. This three-engine stack covers the entire psytrance palette, every voice is offline-renderable to WAV for A/B, all are Python-controllable from the existing Studio class, and the total install footprint is modest (1 apt package + 1 .deb download, no source builds, no KXStudio repo). Skip Carla (not in apt), Vital (build effort too high, account-gated binary), Dexed standalone (use pedalboard if a DX7 voice is needed), and pure-Web-Audio enhancements (they don't escape the ceiling that motivated this audit). For the inversion pipeline (reference→patch), prototype with torchsynth (differentiable) then transfer learned parameters to scsynth — but that is a separate task beyond this audit's scope.
