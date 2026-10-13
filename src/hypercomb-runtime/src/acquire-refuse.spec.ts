// acquire-refuse.spec.ts — the caller's last word comes before anything runs.
//
// The package floor moves a package that still dials the home machine, and
// must never land it on a target that does too (package-floor.ts
// refuseOldMeetingPoint). Its only hold on that is `refuse`, asked by the real
// installer once every module is held and verified. These cases drive the real
// installPackage over an in-memory store: a refusal activates nothing, and it
// is asked before the picks branch (which returns early) and before activation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignatureService } from '@hypercomb/core'
import { installPackage, type InstallOptions } from './acquire'
import { INSTALLED_KEY } from './installed-package'
import { PICKS_KEY } from './package-tree'
import type { HostPackage } from './host-packages'

// The publisher is not the question here: the floor door admits the package.
vi.mock('./activation-authority', () => ({
  activationAuthority: vi.fn(async () => ({ ok: true, by: 'floor' })),
  registeredAttester: () => null,
}))

const MANIFEST_KEY = 'core-adapter.installed-manifest'
const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>
const sigOf = (bytes: Uint8Array<ArrayBuffer>): Promise<string> => SignatureService.sign(bytes.buffer)

/** A directory as OPFS hands it back, over a Map of file name → bytes. */
const memoryDir = (files = new Map<string, Uint8Array<ArrayBuffer>>()): FileSystemDirectoryHandle => ({
  getFileHandle: async (name: string, opts?: { create?: boolean }) => {
    if (!files.has(name) && !opts?.create) throw new DOMException('not found', 'NotFoundError')
    return {
      getFile: async () => ({ arrayBuffer: async () => (files.get(name) ?? new Uint8Array()).slice().buffer }),
      createWritable: async () => ({
        write: async (data: ArrayBuffer) => { files.set(name, new Uint8Array(data.slice(0)) as Uint8Array<ArrayBuffer>) },
        close: async () => {},
      }),
    }
  },
  entries: async function* () { for (const name of files.keys()) yield [name, {}] },
} as unknown as FileSystemDirectoryHandle)

/** A package whose every atom is already held here: one root layer naming one
 *  bee and one dependency, under their real signatures. */
const heldPackage = async (): Promise<{ pkg: HostPackage; bee: string; dependency: string; beeBytes: Uint8Array<ArrayBuffer> }> => {
  const beeBytes = encode(`globalThis["__HYPERCOMB_RELAYS__"] = { live: "wss://example.test" }`)
  const depBytes = encode('export const nostr = 1')
  const bee = await sigOf(beeBytes)
  const dependency = await sigOf(depBytes)
  const rootBytes = encode(JSON.stringify({ name: 'essentials', cells: [], bees: [`${bee}.js`], dependencies: [`${dependency}.js`] }))
  const root = await sigOf(rootBytes)
  const store = {
    initialize: async () => {},
    opfsAvailable: true,
    hypercombRoot: memoryDir(new Map([[root, rootBytes]])),
    bees: memoryDir(new Map([[`${bee}.js`, beeBytes]])),
    dependencies: memoryDir(new Map([[`${dependency}.js`, depBytes]])),
  }
  vi.stubGlobal('ioc', { get: (key: string) => key === '@hypercomb.social/Store' ? store : undefined })
  const pkg: HostPackage = {
    zone: 'host.test', base: 'https://host.test/content', packageSig: root,
    label: 'essentials', at: '', generation: null, layers: [], bees: [], dependencies: [],
  }
  return { pkg, bee, dependency, beeBytes }
}

describe('installPackage — the caller\'s last word', () => {
  beforeEach(() => {
    localStorage.clear()
    // Nothing is fetched: every atom is held, and a transfer pack is a 404.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('is asked over every held module, and a refusal activates nothing', async () => {
    const { pkg, bee, dependency, beeBytes } = await heldPackage()
    let seen: Uint8Array | null = null
    const refuse = vi.fn<NonNullable<InstallOptions['refuse']>>(async (_modules, read) => {
      seen = await read(bee)
      return 'the target still dials the home machine'
    })

    const outcome = await installPackage(pkg, [], { floor: true, refuse })

    expect(outcome).toMatchObject({ ok: false, error: 'the target still dials the home machine' })
    expect(refuse).toHaveBeenCalledOnce()
    expect([...refuse.mock.calls[0]![0]].sort()).toEqual([bee, dependency].sort())
    expect(seen && [...seen]).toEqual([...beeBytes])
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
    expect(localStorage.getItem(MANIFEST_KEY)).toBeNull()
  })

  it('is asked before the picks branch — a pick never lets a refused target through', async () => {
    const { pkg } = await heldPackage()
    localStorage.setItem(PICKS_KEY, JSON.stringify({ sharing: { layer: '0'.repeat(64), root: 'f'.repeat(64), hides: false, at: 1 } }))

    const refused = await installPackage(pkg, [], { floor: true, refuse: async () => 'refused' })
    expect(refused).toMatchObject({ ok: false, error: 'refused' })

    // Control: with no refusal the same install goes on into the picks branch,
    // which answers for itself (the picked layer is not held here).
    const allowed = await installPackage(pkg, [], { floor: true, refuse: async () => null })
    expect(allowed.ok).toBe(false)
    expect(allowed.error).not.toBe('refused')
    expect(allowed.error).toMatch(/not held here/)
    expect(localStorage.getItem(INSTALLED_KEY)).toBeNull()
  })
})
