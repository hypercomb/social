// publish-branch.index-door.spec.ts — A DOOR WITH NO INDEX NEVER HIDES ONE THAT HAS IT.
//
// A branch's doors are read in order for the publisher's index. jwize.com's
// apex keeps no index and answers 404, so a branch that listed it first had
// every door switch refused (`index-unsafe`), and a first publish through it
// would have started an empty index beside the real one. A verified index at
// any door wins; an honest 404 counts only when no door holds one.

import { describe, expect, it } from 'vitest'
import type { HiveIndexResult } from './hive-pointer.js'
import { resolveIndexDoor } from './publish-branch.js'

const PUBKEY = 'c'.repeat(64)
const INDEX: HiveIndexResult = { ok: true, manifest: { roots: { susan: 'a'.repeat(64) }, doors: {}, createdAt: 1_700_000_000, pubkey: PUBKEY } }
const ABSENT: HiveIndexResult = { ok: false, reason: 'http', status: 404 }
const DOWN: HiveIndexResult = { ok: false, reason: 'unreachable' }

const doors = (held: Record<string, HiveIndexResult>) => async (host: string): Promise<HiveIndexResult> => held[host] ?? DOWN

describe('resolveIndexDoor', () => {
  it('walks past a door that answers 404 to the door that holds the index', async () => {
    const found = await resolveIndexDoor(['jwize.com', 'realones.online'], PUBKEY, doors({ 'jwize.com': ABSENT, 'realones.online': INDEX }))
    expect(found).toEqual({ host: 'realones.online', read: INDEX })
  })

  it('takes the first honest 404 when no door holds an index — a first publish still lands', async () => {
    const found = await resolveIndexDoor(['down.example', 'a.example', 'b.example'], PUBKEY, doors({ 'a.example': ABSENT, 'b.example': ABSENT }))
    expect(found).toEqual({ host: 'a.example', read: ABSENT })
  })

  it('reports the last failure when no door answers at all', async () => {
    const found = await resolveIndexDoor(['x.example', 'y.example'], PUBKEY, doors({}))
    expect(found).toEqual({ host: 'y.example', read: DOWN })
  })
})
