/**
 * MaterialRegistry — extensible material identity system.
 *
 * Materials are NOT channels. They are musical identities with:
 * - kind (drums, low, musical, texture, transition)
 * - role (kick, bass, lead, pad, riser, etc.)
 * - character (subtype/description)
 *
 * The registry is extensible: new materials can be registered at runtime.
 * The CausalComposer queries the registry to know what's available.
 */

export type MaterialKind = 'drums' | 'low' | 'musical' | 'texture' | 'transition';

export interface MaterialDefinition {
  id: string;
  kind: MaterialKind;
  role: string;
  name: string;
  character?: string;
  register: 'sub' | 'bass' | 'low-mid' | 'mid' | 'high-mid' | 'high' | 'air';
  pitchable: boolean;
  defaultMidi?: number;
  velocityRange?: [number, number];
}

export const CANONICAL_MATERIALS: MaterialDefinition[] = [
  // DRUMS
  { id: 'kick', kind: 'drums', role: 'rhythmic-anchor', name: 'Kick', register: 'sub', pitchable: false, defaultMidi: 36, velocityRange: [0.8, 1.0] },
  { id: 'snare', kind: 'drums', role: 'backbeat', name: 'Snare', register: 'high-mid', pitchable: false, defaultMidi: 38, velocityRange: [0.5, 0.8] },
  { id: 'clap', kind: 'drums', role: 'backbeat-layer', name: 'Clap', register: 'high-mid', pitchable: false, defaultMidi: 39, velocityRange: [0.4, 0.7] },
  { id: 'hat-closed', kind: 'drums', role: 'subdivision', name: 'Closed Hat', register: 'high', pitchable: false, defaultMidi: 42, velocityRange: [0.2, 0.5] },
  { id: 'hat-open', kind: 'drums', role: 'accent', name: 'Open Hat', register: 'high', pitchable: false, defaultMidi: 46, velocityRange: [0.3, 0.6] },
  { id: 'ride', kind: 'drums', role: 'shimmer', name: 'Ride', register: 'high', pitchable: false, defaultMidi: 59, velocityRange: [0.2, 0.4] },
  { id: 'crash', kind: 'drums', role: 'accent-crash', name: 'Crash', register: 'high', pitchable: false, defaultMidi: 49, velocityRange: [0.5, 0.9] },
  { id: 'shaker', kind: 'drums', role: 'subdivision-layer', name: 'Shaker', register: 'high', pitchable: false, defaultMidi: 70, velocityRange: [0.15, 0.35] },
  { id: 'percussion', kind: 'drums', role: 'groove-fill', name: 'Percussion', register: 'low-mid', pitchable: false, defaultMidi: 50, velocityRange: [0.3, 0.6] },
  { id: 'tom', kind: 'drums', role: 'fill', name: 'Tom', register: 'low-mid', pitchable: false, defaultMidi: 45, velocityRange: [0.4, 0.7] },
  { id: 'rim', kind: 'drums', role: 'accent-rim', name: 'Rim', register: 'high-mid', pitchable: false, defaultMidi: 37, velocityRange: [0.3, 0.5] },
  // LOW
  { id: 'bass', kind: 'low', role: 'rolling-bass', name: 'Bass', register: 'bass', pitchable: true, defaultMidi: 33, velocityRange: [0.6, 0.9] },
  { id: 'sub', kind: 'low', role: 'sub-anchor', name: 'Sub', register: 'sub', pitchable: true, defaultMidi: 24, velocityRange: [0.5, 0.8] },
  // MUSICAL
  { id: 'lead', kind: 'musical', role: 'primary-melody', name: 'Lead', register: 'high-mid', pitchable: true, defaultMidi: 64, velocityRange: [0.5, 0.8] },
  { id: 'counterline', kind: 'musical', role: 'response-melody', name: 'Counterline', register: 'mid', pitchable: true, defaultMidi: 57, velocityRange: [0.4, 0.6] },
  { id: 'motif', kind: 'musical', role: 'identity-motif', name: 'Motif', register: 'high-mid', pitchable: true, defaultMidi: 64, velocityRange: [0.5, 0.8] },
  { id: 'stab', kind: 'musical', role: 'accent-hit', name: 'Stab', register: 'mid', pitchable: true, defaultMidi: 60, velocityRange: [0.6, 0.9] },
  { id: 'chord', kind: 'musical', role: 'harmonic-hit', name: 'Chord', register: 'mid', pitchable: true, defaultMidi: 60, velocityRange: [0.4, 0.7] },
  { id: 'arp', kind: 'musical', role: 'arpeggio', name: 'Arpeggio', register: 'high-mid', pitchable: true, defaultMidi: 72, velocityRange: [0.3, 0.6] },
  // TEXTURE
  { id: 'pad', kind: 'texture', role: 'harmonic-bed', name: 'Pad', register: 'low-mid', pitchable: true, defaultMidi: 48, velocityRange: [0.2, 0.4] },
  { id: 'drone', kind: 'texture', role: 'tonal-anchor', name: 'Drone', register: 'sub', pitchable: true, defaultMidi: 28, velocityRange: [0.2, 0.4] },
  { id: 'atmosphere', kind: 'texture', role: 'environment', name: 'Atmosphere', register: 'air', pitchable: false, defaultMidi: 72, velocityRange: [0.15, 0.3] },
  { id: 'texture', kind: 'texture', role: 'psychedelic-motion', name: 'Texture', register: 'mid', pitchable: false, defaultMidi: 60, velocityRange: [0.2, 0.4] },
  // TRANSITION
  { id: 'riser', kind: 'transition', role: 'build-tension', name: 'Riser', register: 'high', pitchable: false, defaultMidi: 72, velocityRange: [0.4, 0.8] },
  { id: 'impact', kind: 'transition', role: 'section-marker', name: 'Impact', register: 'high', pitchable: false, defaultMidi: 36, velocityRange: [0.8, 1.0] },
  { id: 'downlifter', kind: 'transition', role: 'release', name: 'Downlifter', register: 'high', pitchable: false, defaultMidi: 72, velocityRange: [0.3, 0.6] },
  { id: 'sweep', kind: 'transition', role: 'transition-smear', name: 'Sweep', register: 'high', pitchable: false, defaultMidi: 72, velocityRange: [0.3, 0.6] },
  { id: 'reverse', kind: 'transition', role: 'reverse-smear', name: 'Reverse', register: 'high', pitchable: false, defaultMidi: 72, velocityRange: [0.3, 0.6] },
  { id: 'fill', kind: 'transition', role: 'phrase-fill', name: 'Fill', register: 'low-mid', pitchable: false, defaultMidi: 45, velocityRange: [0.4, 0.7] },
];

export class MaterialRegistry {
  private readonly materials = new Map<string, MaterialDefinition>();
  constructor() { for (const m of CANONICAL_MATERIALS) this.materials.set(m.id, m); }
  register(def: MaterialDefinition): void { this.materials.set(def.id, def); }
  get(id: string): MaterialDefinition | undefined { return this.materials.get(id); }
  has(id: string): boolean { return this.materials.has(id); }
  getByKind(kind: MaterialKind): MaterialDefinition[] { return Array.from(this.materials.values()).filter(m => m.kind === kind); }
  getAllIds(): string[] { return Array.from(this.materials.keys()); }
  getRegister(id: string): string | undefined { return this.materials.get(id)?.register; }
  isPitchable(id: string): boolean { return this.materials.get(id)?.pitchable ?? false; }
  getDefaultMidi(id: string): number | undefined { return this.materials.get(id)?.defaultMidi; }
  get size(): number { return this.materials.size; }
}
