// packed-collect-subbucket.spec.ts
//
// THE SAME BUG THE COLLECTOR JUST FIXED, ONE LEVEL DOWN.
//
// `packed-collect.ts` was fixed to treat a pool member's NAME as a content
// address:
//
//     if (isSigName(member)) reachable.add(member.toLowerCase())
//
// with the reason stated in place: "under the molecule model a member IS an
// atom's address. Reading only its BYTES left the atom unreferenced, so the
// sweep deleted `<root>/<sig>` while the pool still named it."
//
// But pools nest one level, and the packed store stores a sub-bucket member
// under a PREFIXED key — `packed-store.worker.ts` drains it as
// `${bucketName}/${leafName}`, and `native-filesystem.ts` documents the same
// representation ("POOLS NEST ONE LEVEL. `Store.putPoolDoc` writes document
// pools as `<pool>/<sign(subKey)>/<sig>`"). `isSigName('<64hex>/<64hex>')` is
// false, so the fix does not reach it: a sub-bucket member's name is not
// marked reachable and the content it addresses is swept.
//
// That is the shape the molecule direction puts another participant's data
// in — `sign(name)/<pubkey>/<claim>` — so the guard has to hold at any depth,
// not only at the pool root.

import { describe, expect, it } from 'vitest'
import { collect } from './packed-collect'
import { MemorySyncFile, PackedStoreEngine } from './packed-store-engine'

const json = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value))

const address = (seed: number): string =>
  seed.toString(16).padStart(8, '0').repeat(8)

describe('collection and nested pool buckets', () => {
  it('keeps content addressed by a SUB-BUCKET member name', async () => {
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    const pool = address(0x50)
    const bucket = address(0x51)      // sign(subKey) — or a per-author pubkey
    const atom = address(0x52)        // the member's name IS this atom

    engine.putContent(atom, json({ name: 'the atom the member names' }))
    // The drained representation: one prefixed key, one level deep. The bytes
    // deliberately do NOT mention the atom — the NAME is the reference, which
    // is the whole point of a content-addressed member.
    engine.putPool(pool, `${bucket}/${atom}`, json({ state: 'current' }))

    await collect(engine)

    expect(
      engine.hasContent(atom),
      'a sub-bucket member NAMES its content — the collector must not sweep it',
    ).toBe(true)
  })

  it('keeps content a sub-bucket member merely names at the pool ROOT too (control)', async () => {
    // The already-fixed case, kept beside it so a regression in either half
    // is legible.
    const engine = PackedStoreEngine.open(new MemorySyncFile())
    const pool = address(0x60)
    const atom = address(0x61)
    engine.putContent(atom, json({ name: 'the atom the member names' }))
    engine.putPool(pool, atom, json({ state: 'current' }))

    await collect(engine)
    expect(engine.hasContent(atom)).toBe(true)
  })
})
