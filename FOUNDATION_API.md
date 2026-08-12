# FOUNDATION API

## PSY4 Foundation Lab — Public API Reference

The foundation is a shared infrastructure library for all PSY family devices.
It is NOT a device itself. Devices consume the foundation; they do not modify it.

---

## foundation/transport

### MusicalTransport

The single source of truth for musical time.

```ts
import { MusicalTransport } from '@/foundation/transport';

const transport = new MusicalTransport(
  () => audioContext.currentTime,  // clock function
  { initialBpm: 145 }              // optional config
);

transport.start();
transport.observeBeat({ time: audioContext.currentTime, confidence: 0.9, source: 'radio' });
const snap = transport.snapshot();
```

#### Methods

| Method | Purpose |
|--------|---------|
| `start()` | Start the transport, set initial anchor |
| `stop()` | Stop the transport, freeze position |
| `seek(beatIndex)` | Jump to a specific beat (increments epoch) |
| `setTempo(bpm, source)` | Change tempo without phase reset (re-anchors to preserve position) |
| `observeBeat(obs)` | Feed a beat observation (from PLL, manual tap, external sync) |
| `loseSource()` | Signal radio/source loss (enters holdover) |
| `onAudioContextResume()` | Signal AudioContext resume (re-anchors, increments epoch) |
| `reset()` | Full reset (increments epoch) |
| `snapshot()` | Get immutable TransportSnapshot |
| `predictBeats(horizonSec)` | Get upcoming beat times |
| `getHypotheses()` | Get tempo hypotheses (for half/double ambiguity) |
| `subscribe(listener)` | Subscribe to state changes (returns subscription with unsubscribe) |

### TransportSnapshot

Immutable view of transport state. This is the ONLY way consumers read state.

```ts
interface TransportSnapshot {
  readonly timestamp: number;      // AudioContext.currentTime of snapshot
  readonly bpm: number;            // current tempo
  readonly confidence: number;     // 0..1
  readonly locked: boolean;        // stable tempo lock
  readonly beatTime: number;       // audio time of last beat boundary
  readonly barTime: number;        // audio time of last bar boundary
  readonly beat: number;           // beat within bar (0..beatsPerBar-1)
  readonly bar: number;            // global bar index
  readonly beatIndex: number;      // global beat index
  readonly phase: number;          // 0..1 within beat
  readonly barPhase: number;       // 0..1 within bar
  readonly source: TransportSource; // 'internal' | 'radio' | 'external' | 'manual'
  readonly epoch: number;          // increments on every disruption
  readonly beatsPerBar: number;    // usually 4
  readonly beatDuration: number;   // 60 / bpm
  readonly nextBeatTime: number;   // predicted next beat
}
```

### TransportAdapter

Bridges Transport to existing psyLive scheduler.

```ts
import { TransportAdapter } from '@/foundation/transport';

const adapter = new TransportAdapter(transport);
const clockInfo = adapter.getClockInfo();  // { bpm, beatIndex, step16, bar, nextBeatTime, ... }
const beats = adapter.getUpcomingBeats(0.2); // predicted beat times
adapter.observeBeat(time, confidence, 'radio');
adapter.loseRadioSource();
adapter.onAudioContextResume();
```

---

## Design Principles

1. **AudioContext.currentTime is the ONLY musical clock.** Date.now(), performance.now(), setInterval() are forbidden for musical decisions.

2. **Transport ≠ PLL.** BeatPLL is an observer. Transport is a time model. Transport works without radio.

3. **Anchor-based clock (no float drift).** `beatTime = anchorTime + beatIndex * beatDuration`. No accumulation.

4. **Immutable snapshots.** Consumers receive `TransportSnapshot` (Object.freeze'd). Cannot modify transport state.

5. **Epoch.** Increments on every disruption (seek, reset, resume, re-anchor). Consumers compare epoch to detect changes.

6. **Holdover.** Radio loss → continue at last BPM with decaying confidence. No hard stop.

7. **Half/double tempo.** Tracked as hypotheses. No false certainty.

8. **Tab suspension.** DROP STALE EVENTS policy. Position computed from AudioContext time.
