// bee-deps.spec.ts — the last piece of inventory a host used to assert.
//
// The map is a HINT (dependency-loader.ts): present, a bee's own dependencies
// stay out of the eager boot pass; absent, everything loads eagerly and the
// hive is exactly as correct. Every case below is written from that fact — a
// derivation that comes up short must degrade, never fail.

import { describe, expect, it } from 'vitest'
import { deriveBeeDeps } from './bee-deps'

const DEP_A = 'a'.repeat(64)
const DEP_B = 'b'.repeat(64)
const BEE_ONE = '1'.repeat(64)
const BEE_TWO = '2'.repeat(64)

const bytes = (source: string): Uint8Array => new TextEncoder().encode(source)

/** Reads from a fixture heap; anything absent answers null, as OPFS would. */
const heap = (files: Record<string, string>) =>
  async (sig: string): Promise<Uint8Array | null> =>
    files[sig] === undefined ? null : bytes(files[sig]!)

/** A dependency bundle in the two shapes esbuild emits. */
const bundleDefining = (...classes: string[]): string =>
  classes.map((name, i) => i % 2 ? `class ${name} {}` : `var ${name} = class {};`).join('\n')

/** A bee whose compiled output declares a deps block. */
const beeClaiming = (...names: string[]): string =>
  `var Drone = class { deps = { ${names.map(n => `x: '@hypercomb.social/${n}'`).join(', ')} } }`

describe('deriveBeeDeps', () => {

  it('maps a bee to the bundles defining the classes it claims', async () => {
    const read = heap({
      [DEP_A]: bundleDefining('Store', 'Lineage'),
      [DEP_B]: bundleDefining('Navigation'),
      [BEE_ONE]: beeClaiming('Store', 'Navigation'),
      [BEE_TWO]: beeClaiming('Lineage'),
    })

    expect(await deriveBeeDeps([BEE_ONE, BEE_TWO], [DEP_A, DEP_B], read)).toEqual({
      [BEE_ONE]: [DEP_A, DEP_B].sort(),
      [BEE_TWO]: [DEP_A],
    })
  })

  it('omits a bee that claims nothing, rather than mapping it to an empty list', async () => {
    const read = heap({
      [DEP_A]: bundleDefining('Store'),
      [BEE_ONE]: 'var Drone = class { heartbeat() {} }',
    })

    expect(await deriveBeeDeps([BEE_ONE], [DEP_A], read)).toEqual({})
  })

  it('ignores a claimed class no bundle defines', async () => {
    const read = heap({
      [DEP_A]: bundleDefining('Store'),
      [BEE_ONE]: beeClaiming('Store', 'SomethingNobodyShips'),
    })

    expect(await deriveBeeDeps([BEE_ONE], [DEP_A], read)).toEqual({ [BEE_ONE]: [DEP_A] })
  })

  it('degrades to an empty map when nothing can be read — a hint, never a failure', async () => {
    const read = heap({})

    await expect(deriveBeeDeps([BEE_ONE], [DEP_A], read)).resolves.toEqual({})
  })

  it('skips a bee it cannot read and keeps the rest of the map', async () => {
    const read = heap({
      [DEP_A]: bundleDefining('Store'),
      [BEE_TWO]: beeClaiming('Store'),
    })

    expect(await deriveBeeDeps([BEE_ONE, BEE_TWO], [DEP_A], read)).toEqual({ [BEE_TWO]: [DEP_A] })
  })

  it('treats binary bytes as unreadable instead of decoding garbage', async () => {
    const read = async (sig: string): Promise<Uint8Array | null> =>
      sig === DEP_A ? new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) : bytes(beeClaiming('Store'))

    expect(await deriveBeeDeps([BEE_ONE], [DEP_A], read)).toEqual({})
  })

  it('answers empty when a build emits a shape it does not recognise', async () => {
    // No `deps = { … }` block at all — a future bundler, or a bee that
    // declares its dependencies some other way. Eager loading, not an error.
    const read = heap({
      [DEP_A]: bundleDefining('Store'),
      [BEE_ONE]: 'export const deps = ["@hypercomb.social/Store"]',
    })

    expect(await deriveBeeDeps([BEE_ONE], [DEP_A], read)).toEqual({})
  })
})
