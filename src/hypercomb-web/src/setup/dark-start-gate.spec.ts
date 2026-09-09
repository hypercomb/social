// A HIVE WITH CONTENT IS NEVER A FRESH INSTALL.
//
// `seedDarkOnFreshInstall` writes the opt-in on-list EMPTY and stamps the
// cohort ledger '*', which together mean: every behaviour off, and no later
// seed may ever light one. That is right for a hive being born and
// catastrophic for one that already exists — every function on every tile
// disappears, permanently, and a reload cannot help because the emptied list
// outlives the page.
//
// It used to be gated on `!usableCache` alone. That flag describes
// localStorage's install manifest, NOT the hive: a hive predating the roster
// has no on-list either (it answers all-on from the legacy off-list), so an
// interrupted install or an evicted localStorage darkened it wholesale. This
// pins the question to the hive itself.
//
// Every uncertain answer must be "not empty": the cost of a wrong "empty" is
// a participant's whole roster, silently.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Importing ensure-install pulls the shared/core barrel, which registers
// services at module scope. Same mock set as bundled-completeness.spec.ts,
// and for the same reason: this suite is about one predicate, not the shell.
vi.stubGlobal('register', vi.fn())
vi.mock('@hypercomb/core', () => ({
  EffectBus: { emit: vi.fn() },
  SignatureStore: class SignatureStore {
    trustAll(): void { /* no-op */ }
    toJSON(): unknown { return {} }
  },
  registerPoolMeaning: async () => 'f'.repeat(64),
  SignatureService: { sign: async () => 'e'.repeat(64) },
}))
vi.mock('@hypercomb/shared/core', () => ({
  Store: class Store {
    static BEES_MEANING = 'bees'
    static DEPENDENCIES_MEANING = 'dependencies'
    static poolSignature = async (): Promise<string> => 'a'.repeat(64)
  },
  resolveInventory: vi.fn(),
  isComplete: vi.fn(),
  validateSealedPackage: vi.fn(() => ({ valid: true, errors: [] })),
}))
vi.mock('@hypercomb/shared/ui/features-viewer/behavior-enablement', () => ({
  seedDarkOnFreshInstall: vi.fn(),
}))

const { hiveLooksEmpty } = await import('./ensure-install')

type StoreLike = Parameters<typeof hiveLooksEmpty>[0]

const dir = (names: string[]) => ({
  entries: () => (async function* () {
    for (const n of names) yield [n, {}] as [string, unknown]
  })(),
})

const storeWith = (over: Record<string, unknown>): StoreLike =>
  ({ opfsAvailable: true, hypercombRoot: dir([]), ...over }) as unknown as StoreLike

describe('the dark-start gate asks the hive, not the cache', () => {
  it('an empty root is a fresh hive', async () => {
    expect(await hiveLooksEmpty(storeWith({}))).toBe(true)
  })

  it('one sig file at the root is content — never darken it', async () => {
    expect(await hiveLooksEmpty(storeWith({ hypercombRoot: dir(['a'.repeat(64)]) }))).toBe(false)
  })

  it('a lineage sigbag or a pool counts too — any entry at all', async () => {
    expect(await hiveLooksEmpty(storeWith({ hypercombRoot: dir(['b'.repeat(64)]) }))).toBe(false)
  })

  it('no OPFS means we cannot tell, so we do not darken', async () => {
    expect(await hiveLooksEmpty(storeWith({ opfsAvailable: false }))).toBe(false)
  })

  it('an unresolved root means we cannot tell, so we do not darken', async () => {
    expect(await hiveLooksEmpty(storeWith({ hypercombRoot: undefined }))).toBe(false)
  })

  it('an enumeration that throws means we cannot tell, so we do not darken', async () => {
    const root = { entries: () => (async function* () { throw new Error('opfs gone') })() }
    expect(await hiveLooksEmpty(storeWith({ hypercombRoot: root }))).toBe(false)
  })

  it('the gate actually consults it — the gate is the whole fix', () => {
    // Without this the predicate above is dead code and the bug is back.
    const src = readFileSync(join(__dirname, 'ensure-install.ts'), 'utf8')
    expect(src).toMatch(/if \(.*!usableCache.*await hiveLooksEmpty\(store\)\) seedDarkOnFreshInstall\(\)/)
    expect(src).not.toMatch(/if \(!usableCache && !isVisitorSession\(\)\) seedDarkOnFreshInstall/)
  })
})
