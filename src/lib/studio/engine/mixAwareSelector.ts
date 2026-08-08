/**
 * Mix-Aware Selector — tracks current mix state and avoids frequency masking.
 *
 * This is the "mix intelligence" that professional producers use:
 * - If bass already fills 80-150Hz, don't select a kick that adds more 120Hz body
 * - If lead already fills 2-5kHz, don't select an aggressive hat
 * - If drop lacks sub, prioritize deep kick/bass
 * - If break is empty, allow wide textures
 *
 * The selector tracks frequency occupancy per band and penalizes samples
 * that would create masking.
 */

export type FrequencyBand = 'sub' | 'low' | 'lowMid' | 'mid' | 'high' | 'air';

export interface BandOccupancy {
  sub: number;     // 20-60Hz
  low: number;     // 60-200Hz
  lowMid: number;  // 200-800Hz
  mid: number;     // 800-3000Hz
  high: number;    // 3000-8000Hz
  air: number;     // 8000-20000Hz
}

export interface MixSnapshot {
  bands: BandOccupancy;
  totalEnergy: number;
  stereoWidth: number;
  transientDensity: number;
  voiceCount: number;
  timestamp: number;
}

export interface SampleSpectralProfile {
  subEnergy: number;
  lowEnergy: number;
  lowMidEnergy: number;
  midEnergy: number;
  highEnergy: number;
  airEnergy: number;
}

/**
 * MixTracker — maintains a real-time estimate of the current mix's
 * frequency occupancy. Updated as voices trigger and decay.
 */
export class MixTracker {
  private current: BandOccupancy = {
    sub: 0, low: 0, lowMid: 0, mid: 0, high: 0, air: 0,
  };
  private decayRate = 0.95; // per update cycle (voices decay)

  /** Register a voice triggering with its spectral profile. */
  registerVoice(profile: SampleSpectralProfile, velocity: number) {
    // Add energy to each band (scaled by velocity)
    this.current.sub += profile.subEnergy * velocity * 0.3;
    this.current.low += profile.lowEnergy * velocity * 0.3;
    this.current.lowMid += profile.lowMidEnergy * velocity * 0.25;
    this.current.mid += profile.midEnergy * velocity * 0.2;
    this.current.high += profile.highEnergy * velocity * 0.15;
    this.current.air += profile.airEnergy * velocity * 0.1;

    // Clamp each band to 0..1
    this.current.sub = Math.min(1, this.current.sub);
    this.current.low = Math.min(1, this.current.low);
    this.current.lowMid = Math.min(1, this.current.lowMid);
    this.current.mid = Math.min(1, this.current.mid);
    this.current.high = Math.min(1, this.current.high);
    this.current.air = Math.min(1, this.current.air);
  }

  /** Decay all bands (voices finish, energy decreases). */
  decay() {
    this.current.sub *= this.decayRate;
    this.current.low *= this.decayRate;
    this.current.lowMid *= this.decayRate;
    this.current.mid *= this.decayRate;
    this.current.high *= this.decayRate;
    this.current.air *= this.decayRate;
  }

  /** Get current mix snapshot. */
  getSnapshot(): MixSnapshot {
    const totalEnergy = (this.current.sub + this.current.low + this.current.lowMid +
                         this.current.mid + this.current.high + this.current.air) / 6;
    return {
      bands: { ...this.current },
      totalEnergy,
      stereoWidth: 0.5, // TODO: track from stereo output
      transientDensity: 0.5, // TODO: track from onset detection
      voiceCount: 0, // tracked externally
      timestamp: Date.now(),
    };
  }

  /** Check if a band is congested (>0.7 occupancy). */
  isCongested(band: FrequencyBand): boolean {
    return this.current[band] > 0.7;
  }

  /** Get the most congested band. */
  getMostCongestedBand(): FrequencyBand {
    const bands: FrequencyBand[] = ['sub', 'low', 'lowMid', 'mid', 'high', 'air'];
    let max = 0;
    let result: FrequencyBand = 'mid';
    for (const b of bands) {
      if (this.current[b] > max) { max = this.current[b]; result = b; }
    }
    return result;
  }

  /** Get the emptiest band. */
  getEmptiestBand(): FrequencyBand {
    const bands: FrequencyBand[] = ['sub', 'low', 'lowMid', 'mid', 'high', 'air'];
    let min = 1;
    let result: FrequencyBand = 'sub';
    for (const b of bands) {
      if (this.current[b] < min) { min = this.current[b]; result = b; }
    }
    return result;
  }

  reset() {
    this.current = { sub: 0, low: 0, lowMid: 0, mid: 0, high: 0, air: 0 };
  }
}

/**
 * MixAwareSelector — scores sample candidates based on current mix state.
 *
 * Penalizes samples that would create frequency masking.
 * Rewards samples that fill empty frequency regions.
 */
export class MixAwareSelector {
  private mixTracker: MixTracker;

  constructor(mixTracker: MixTracker) {
    this.mixTracker = mixTracker;
  }

  /**
   * Score a sample's spectral fit with the current mix.
   * Returns 0..1 (1 = perfect fit, 0 = bad masking).
   */
  scoreSpectralFit(sampleProfile: SampleSpectralProfile): number {
    const mix = this.mixTracker.getSnapshot();
    let score = 0;
    let weightSum = 0;

    // For each band, check if the sample would add to a congested region
    const bands: { key: keyof BandOccupancy; profileKey: keyof SampleSpectralProfile; weight: number }[] = [
      { key: 'sub', profileKey: 'subEnergy', weight: 3 },    // sub is critical
      { key: 'low', profileKey: 'lowEnergy', weight: 2.5 },
      { key: 'lowMid', profileKey: 'lowMidEnergy', weight: 2 },
      { key: 'mid', profileKey: 'midEnergy', weight: 1.5 },
      { key: 'high', profileKey: 'highEnergy', weight: 1 },
      { key: 'air', profileKey: 'airEnergy', weight: 0.5 },
    ];

    for (const band of bands) {
      const mixOccupancy = mix.bands[band.key];
      const sampleEnergy = sampleProfile[band.profileKey];
      // If sample has high energy in this band AND mix is already congested → penalize
      if (sampleEnergy > 0.3 && mixOccupancy > 0.6) {
        // Masking risk — reduce score proportional to congestion
        score += (1 - mixOccupancy) * sampleEnergy * band.weight * 0.5;
      } else if (sampleEnergy > 0.3 && mixOccupancy < 0.3) {
        // Sample fills empty region — reward
        score += sampleEnergy * band.weight;
      } else {
        // Neutral
        score += sampleEnergy * band.weight * 0.7;
      }
      weightSum += band.weight;
    }

    return score / weightSum;
  }

  /**
   * Get a recommendation for what frequency region needs filling.
   * Returns the band that is most under-utilized.
   */
  getFillRecommendation(): FrequencyBand {
    return this.mixTracker.getEmptiestBand();
  }

  /**
   * Get a warning about what frequency region is congested.
   */
  getCongestionWarning(): { band: FrequencyBand; occupancy: number } | null {
    const band = this.mixTracker.getMostCongestedBand();
    const occ = this.mixTracker.getSnapshot().bands[band];
    if (occ > 0.7) return { band, occupancy: occ };
    return null;
  }
}
