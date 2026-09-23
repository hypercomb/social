// module-commit.boot-bees.spec.ts — THE BOOT LANE FOLLOWS A COMMIT. A root
// names its boot bees by sig (`bootBees`, loaded before the runtime and the
// shell start — atomic-modules-plan.md, the boot lane). A commit that drafts a
// boot bee must name the draft's sig there; left on the old sig, the old code
// would load first and register first, and the draft's copy would never win.

import { describe, expect, it } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { commitSelection, draftModule, type ModuleDraftDeps, type PackagePool } from './module-drafts'
import { formatMember } from './host-pool'
import type { Picks } from './package-tree'
import type { ReplicationIo } from './replication-walker'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const sigOf = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

const BOOT = ['// src/navigation/input-gate.service.ts', 'var gate = "closed";', '// src/navigation/navigation.boot.drone.ts', 'export {};'].join('\n')
const GAME = ['// src/games/solomon/labyrinth.ts', 'var rooms = "remembered";', '// src/games/solomon/solomon.drone.ts', 'export {};'].join('\n')

const world = async () => {
  const heap = new Map<string, Uint8Array<ArrayBuffer>>()
  const bees = new Map<string, Uint8Array>()
  const put = async (text: string): Promise<string> => { const bytes = encode(text); const sig = await sigOf(bytes); heap.set(sig, bytes); return sig }
  const bootBee = await sigOf(encode(BOOT))
  const gameBee = await sigOf(encode(GAME))
  bees.set(bootBee, encode(BOOT))
  bees.set(gameBee, encode(GAME))
  const navigation = await put(JSON.stringify({ name: 'navigation', cells: [], bees: [bootBee], dependencies: [] }))
  const solomon = await put(JSON.stringify({ name: 'solomon', cells: [], bees: [gameBee], dependencies: [] }))
  const games = await put(JSON.stringify({ name: 'games', cells: [solomon], bees: [], dependencies: [] }))
  // As the build spells them: bare sigs, root only.
  const trunk = await put(JSON.stringify({ name: 'root', cells: [navigation, games], bees: [], dependencies: [], criticalBees: [], bootBees: [bootBee] }))
  const io: ReplicationIo = { read: async sig => heap.get(sig) ?? null, fetch: async () => null, write: async (sig, bytes) => { heap.set(sig, bytes) } }
  let picks: Picks = {}
  let installed = trunk
  let off = new Set<string>()
  const entries = new Map<string, string>([['00000000', formatMember(trunk, 'main')]])
  const pool: PackagePool = { names: async () => [...entries.keys()], write: async (name, text) => { entries.set(name, text) } }
  const deps: ModuleDraftDeps = {
    trunk: () => installed,
    store: () => ({
      getBeeBytes: async sig => bees.get(sig) ?? null,
      writeBeeBytes: async (sig, bytes) => { bees.set(sig, bytes) },
      writeLayerBytes: async (sig, bytes) => { heap.set(sig, new Uint8Array(bytes) as Uint8Array<ArrayBuffer>) },
    }),
    layers: async () => io,
    picks: () => picks,
    apply: async (t, _admitted, next) => { picks = next; installed = t; return { ok: true } },
    now: () => 1_700_000_000_000,
    pool: async () => pool,
    off: () => off,
    setOff: paths => { off = new Set(paths) },
  }
  return {
    bootBee, gameBee, deps,
    turnOff: (...paths: string[]) => { off = new Set([...off, ...paths]) },
    read: (sig: string) => JSON.parse(decode(heap.get(sig)!)) as Record<string, unknown>,
  }
}

describe('commitSelection and the boot lane', () => {
  it('names the drafted boot bee, so the new code is the one that loads first', async () => {
    const w = await world()
    const draft = await draftModule({ beeSig: w.bootBee, section: 'src/navigation/input-gate.service.ts', body: 'var gate = "open";' }, w.deps)
    if (!draft.ok) throw new Error(draft.error)
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(draft.beeSig).not.toBe(w.bootBee)
    expect(w.read(outcome.rootSig)['bootBees']).toEqual([draft.beeSig])
  })

  it('leaves the boot lane as it was when the draft is somewhere else', async () => {
    const w = await world()
    const draft = await draftModule({ beeSig: w.gameBee, section: 'src/games/solomon/labyrinth.ts', body: 'var rooms = "fresh";' }, w.deps)
    if (!draft.ok) throw new Error(draft.error)
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(w.read(outcome.rootSig)['bootBees']).toEqual([w.bootBee])
  })

  it('drops a boot bee the new root no longer reaches', async () => {
    const w = await world()
    w.turnOff('navigation')
    const outcome = await commitSelection('essentials', w.deps)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(w.read(outcome.rootSig)['bootBees']).toEqual([])
  })
})
