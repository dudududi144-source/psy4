// src/lib/psyLive4/presets.ts
// Preset save/load — stores CC params + FX + BPM/style/energy to localStorage.

export interface PsyPreset {
  name: string;
  bpm: number;
  style: string;
  energy: number;
  ccParams: Record<number, number>;
  fx: { drive: number; delay: number; reverb: number; volume: number };
  savedAt: number;
}

const STORAGE_KEY = 'psy4-presets';

export function loadPresets(): PsyPreset[] {
  try {
    const json = localStorage.getItem(STORAGE_KEY);
    if (!json) return [];
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePreset(preset: PsyPreset): PsyPreset[] {
  const existing = loadPresets();
  // Replace if same name, else add
  const idx = existing.findIndex(p => p.name === preset.name);
  if (idx >= 0) existing[idx] = preset;
  else existing.push(preset);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}

export function deletePreset(name: string): PsyPreset[] {
  const existing = loadPresets().filter(p => p.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}
