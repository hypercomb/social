// assistant/anatomy/doctrine-codex.drone.ts
//
// The minting half of the doctrine record (doctrine-record.ts): the
// optimize-phase bee that writes `{ source, codexSig }` for every doctrine
// head vector a cold read derived a complete codex for. A pass with nothing
// queued costs nothing. A signature already recorded is a skip, never a
// refresh: its record cannot go stale.

import { Drone } from '@hypercomb/core'
import { readDoctrineRecord, takeQueuedDoctrineRecords, writeDoctrineRecord, type DoctrineRecordStore } from './doctrine-record.js'

const STORE_KEY = '@hypercomb.social/Store'

export class DoctrineCodexDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'records the doctrine codex for each /doctrine signature during the optimize phase'

  public override optimize = async (): Promise<void> => {
    const batch = takeQueuedDoctrineRecords()
    if (!batch.length) return
    const store = window.ioc?.get?.(STORE_KEY) as DoctrineRecordStore | undefined
    if (!store) return
    for (const [source, codex] of batch) {
      if (await readDoctrineRecord(store, source)) continue
      await writeDoctrineRecord(store, source, codex)
    }
  }
}

// Self-registers, like every bee: the optimize phase calls `optimize()` on
// every registered bee.
window.ioc.register('@diamondcoreprocessor.com/DoctrineCodexDrone', new DoctrineCodexDrone())
