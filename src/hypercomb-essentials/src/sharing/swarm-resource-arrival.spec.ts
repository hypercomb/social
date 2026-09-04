// sharing/swarm-resource-arrival.spec.ts
//
// A resource that arrives over the swarm is HASHED BEFORE IT IS WRITTEN, and a
// verified write is a peer's atom arriving — never this participant's own
// authoring. SwarmDrone is a live drone with a mesh behind it, so this is a
// mechanical guard on the arrival path's shape (write-conformance,
// swarm.drone.ts:3225).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(process.cwd(), 'hypercomb-essentials', 'src', 'sharing', 'swarm.drone.ts'), 'utf8')
const start = src.indexOf('#onResourceEvent = async')
const end = src.indexOf('swarm:resource-arrived', start)
const body = src.slice(start, end)

describe('the swarm resource arrival path', () => {
  it('exists where this guard expects it', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
  })

  it('hashes the bytes BEFORE any write, and writes only on a match', () => {
    const hash = body.indexOf('SignatureService.sign(bytes)')
    const put = body.indexOf('store.putResource(')
    expect(hash).toBeGreaterThan(-1)
    expect(put).toBeGreaterThan(hash)
    // the mismatch branch returns before the write
    const mismatch = body.indexOf('if (actual !== sig)')
    expect(mismatch).toBeGreaterThan(hash)
    expect(mismatch).toBeLessThan(put)
    expect(body.slice(mismatch, put).includes('return')).toBe(true)
  })

  it('never lets a peer\'s bytes become this participant\'s publish', () => {
    expect(body.includes("store.putResource(new Blob([bytes]), { emit: false })")).toBe(true)
    // the old shape — write first, read the verdict off the returned sig — is gone
    expect(body.includes('writtenSig')).toBe(false)
  })
})
