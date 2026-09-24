// sharing/hosts.drone.spec.ts — the host directory's code arrives with its
// open, not at boot (atomic-modules-plan.md, "adopt the proper load"). Every
// way the window is asked for fetches the view once and defines its element
// once; the bee alone fetches nothing, and it keeps answering the update door.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EffectBus } from '@hypercomb/core'

const wired = vi.hoisted(() => {
  const state = {
    loads: 0,
    fail: false,
    registered: new Map<string, unknown>(),
    ready: new Map<string, (value: unknown) => void>(),
  }
  ;(window as unknown as { ioc: unknown }).ioc = {
    // First wins, as the real container does.
    register: (key: string, value: unknown) => { if (!state.registered.has(key)) state.registered.set(key, value) },
    get: (key: string) => state.registered.get(key),
    has: (key: string) => state.registered.has(key),
    list: () => [...state.registered.keys()],
    whenReady: (key: string, callback: (value: unknown) => void) => { state.ready.set(key, callback) },
  }
  return state
})

// The view stands in: what is measured is WHEN the bee fetches it. Mocked
// afresh on every boot (vi.doMock), since a module reset keeps a mock's result.
const standInView = (): Record<string, unknown> => {
  wired.loads++
  if (wired.fail) throw new Error('offline')
  class HostDirectoryElement extends HTMLElement {
    renders: { open?: boolean }[] = []
    connectedCallback(): void { EffectBus.on<{ open?: boolean }>('hosts:render', p => { this.renders.push(p) }) }
  }
  return { HostDirectoryElement, hostDirectoryFacade: { open: true } }
}
vi.mock('./community-hosts.js', () => ({
  addCommunityHost: async () => '',
  hostZone: (raw: string) => raw,
  listCommunityHosts: async () => [],
  removeCommunityHost: async () => false,
}))
vi.mock('./update-scout.service.js', () => ({ updateScout: {} }))
vi.mock('./package-attestation.js', () => ({ packageAttestation: {} }))

const TAG = 'hc-host-directory'
const KEY = '@diamondcoreprocessor.com/HostDirectoryView'
const here = dirname(fileURLToPath(import.meta.url))
const BEE = readFileSync(join(here, 'hosts.drone.ts'), 'utf8')
const define = vi.spyOn(customElements, 'define')
const definedHere = (): number => define.mock.calls.filter(([tag]) => tag === TAG).length

/** A fresh boot of the bee: its module state, its drone, an empty bus. */
const boot = async (): Promise<void> => {
  vi.resetModules()
  vi.doMock('./host-directory.view.js', standInView)
  EffectBus.clear()
  wired.loads = 0
  wired.registered.clear()
  wired.ready.clear()
  await import('./hosts.drone.js')
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('the hosts bee loads the host directory with its open', () => {
  afterEach(() => {
    document.body.replaceChildren()
    try { sessionStorage.removeItem('hc:hosts:reopen') } catch { /* none */ }
    wired.fail = false
  })

  it('fetches nothing at boot: the surface is its tag, and the face answers closed', async () => {
    await boot()
    await settle()
    expect(wired.loads).toBe(0)
    expect(customElements.get(TAG)).toBeUndefined()
    const surfaces: unknown[] = []
    wired.ready.get('@hypercomb.social/ShellSurfaceRegistry')!({ add: (surface: unknown) => surfaces.push(surface) })
    expect(surfaces).toEqual([{ name: TAG, owner: KEY, element: TAG, order: 144 }])
    expect((wired.registered.get(KEY) as { open: boolean }).open).toBe(false)
    // The only mention of the view in the bee's imports is erased by the compiler.
    expect(BEE).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+'\.\/host-directory\.view\.js'/m)
  })

  // ONE REGISTRY PER FILE. A module reset gives the bee a fresh boot but not a
  // fresh `customElements`, so the first define can be watched exactly once:
  // here. Every later boot finds the tag defined, which is what the guard is for.
  it('the first load defines the element once, and the element already in the page upgrades in place', async () => {
    await boot()
    expect(customElements.get(TAG)).toBeUndefined()
    // The shell's host made the element before its code was here.
    const element = document.createElement(TAG) as HTMLElement & { renders?: { open?: boolean }[] }
    document.body.append(element)
    expect(element.renders).toBeUndefined()
    EffectBus.emit('hosts:view-toggle', {})
    await vi.waitFor(() => expect(customElements.get(TAG)).toBeDefined())
    await settle()
    expect(definedHere()).toBe(1)
    expect(element).toBeInstanceOf(customElements.get(TAG)!)
    expect(element.renders?.some(render => render.open)).toBe(true)
  })

  for (const effect of ['hosts:view-toggle', 'hosts:open', 'packages:open']) {
    it(`\`${effect}\` fetches the view once; a second ask fetches nothing and never defines it twice`, async () => {
      await boot()
      const face = wired.registered.get(KEY) as { open: boolean }
      EffectBus.emit(effect, {})
      await vi.waitFor(() => expect(wired.loads).toBe(1))
      await settle()
      // The face forwards only once THIS boot's load has landed.
      expect(face.open).toBe(true)

      EffectBus.emit(effect, {})
      EffectBus.emit('hosts:open', {})
      EffectBus.emit('packages:open', {})
      await settle()
      expect(wired.loads).toBe(1)
      // Still the first test's one define: the guard skipped every later one.
      expect(definedHere()).toBe(1)
    })
  }

  it('keeps answering the update door, before the view and after it', async () => {
    await boot()
    expect(EffectBus.listens('packages:open')).toBe(true)
    EffectBus.emit('packages:open', {})
    await vi.waitFor(() => expect(wired.loads).toBe(1))
    expect(EffectBus.listens('packages:open')).toBe(true)
  })

  it('fetches the view at boot when a restart left the reopen note, and leaves the note to the view', async () => {
    sessionStorage.setItem('hc:hosts:reopen', JSON.stringify({ scope: '', at: '' }))
    await boot()
    await vi.waitFor(() => expect(wired.loads).toBe(1))
    expect(sessionStorage.getItem('hc:hosts:reopen')).not.toBeNull()
  })

  it('registers its face once, forwarding to the view once it is here', async () => {
    await boot()
    const face = wired.registered.get(KEY) as { open: boolean }
    expect(face.open).toBe(false)
    EffectBus.emit('hosts:open', {})
    await vi.waitFor(() => expect(wired.loads).toBe(1))
    await settle()
    expect(wired.registered.get(KEY)).toBe(face)
    expect(face.open).toBe(true)
  })

  it('says so when the view cannot load, reads as closed, and tries again on the next ask', async () => {
    wired.fail = true
    await boot()
    const said: string[] = []
    EffectBus.on<{ message?: string }>('activity:log', p => { if (p?.message) said.push(p.message) })
    let open: boolean | undefined
    EffectBus.on<{ open?: boolean }>('hosts:render', p => { open = p?.open })
    EffectBus.emit('hosts:open', {})
    await vi.waitFor(() => expect(said.some(line => line.startsWith('Could not load the host directory'))).toBe(true))
    expect(open).toBe(false)

    wired.fail = false
    EffectBus.emit('hosts:open', {})
    await vi.waitFor(() => expect(wired.loads).toBe(2))
    await settle()
    // Only the retry's own load makes the face forward.
    expect((wired.registered.get(KEY) as { open: boolean }).open).toBe(true)
    expect(open).toBe(true)
  })
})
