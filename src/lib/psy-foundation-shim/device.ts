// VERBATIM SHIM from psy-foundation/packages/device-sdk/src/device.ts
// Source: psy-audit/psy-foundation/packages/device-sdk/src/device.ts (lines 1-13)
// SHIM_VERSION: pinned to psy-foundation commit 4ae95d3 (2026-08-13).
//
// A sync test (tests/psy-sampler/shim-sync.test.ts) verifies this file stays
// byte-equivalent to the canonical source. If the canonical contract evolves,
// the test fails and the shim must be re-synced.
//
// Do not modify. Replace with `import { PsyDevice } from '@psy-foundation/device-sdk'`
// when integrated into the canonical workspace.

import type { DeviceCapabilities, MusicalContext, MusicalEvent } from './protocol'
import type { MusicalTransport } from './transport'

export interface PsyDevice {
  id: string
  capabilities(): DeviceCapabilities
  onTransport(transport: MusicalTransport): void
  onContext(context: MusicalContext): void
  onEvent(event: MusicalEvent): void
  onStart?(): void
  onStop?(): void
  reportLatencyMs?(): number
}
