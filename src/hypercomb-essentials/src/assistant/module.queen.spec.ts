// assistant/module.queen.spec.ts — `module take` takes only the root `module
// audit` read: a door that names a new root after the audit is refused.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, INSTALL_IOC_KEY, MODULE_DRAFTS_IOC_KEY } from '@hypercomb/core'

vi.hoisted(() => {
  ;(window as unknown as { ioc: unknown }).ioc = {
    register: () => { /* noop */ },
    get: (key: string) => (window as unknown as { __reg?: Record<string, unknown> }).__reg?.[key],
    whenReady: () => { /* noop */ },
    onRegister: () => () => { /* noop */ },
  }
})

const { ModuleQueenBee } = await import('./module.queen.js')

const AUDITED = 'a'.repeat(64)
const SWAPPED = 'b'.repeat(64)

const toasts: { type: string; message: string }[] = []
EffectBus.on('toast:show', (toast: { type: string; message: string }) => { toasts.push(toast) })

const revisionsOf = vi.fn(async () => [])
/** The door's own bag, sign(<door host>), names `root`: one marker. */
const doorNames = (root: string): void => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (/\/[0-9a-f]{64}\/$/.test(url)) return new Response('00000000\n')
    if (/\/[0-9a-f]{64}\/00000000$/.test(url)) {
      return new Response(JSON.stringify({ sandbox: true, title: 'fresh rooms', layer: root, pubkey: 'e'.repeat(64) }))
    }
    return new Response(null, { status: 404 })
  }))
}
const audited = (root: string): void => {
  localStorage.setItem('hc:module-audited', JSON.stringify({ 'try-fresh-rooms': { root, record: 'c'.repeat(64) } }))
}

beforeEach(() => {
  toasts.length = 0
  revisionsOf.mockClear()
  localStorage.clear()
  ;(window as unknown as { __reg: Record<string, unknown> }).__reg = {
    [MODULE_DRAFTS_IOC_KEY]: { list: async () => [], offPaths: () => [], bytesOf: async () => null },
    [INSTALL_IOC_KEY]: { revisionsOf, pick: vi.fn() },
  }
})
afterEach(() => { vi.unstubAllGlobals() })

describe('module take after module audit', () => {
  it('refuses a root the door named after the audit read another', async () => {
    audited(AUDITED)
    doorNames(SWAPPED)
    await new ModuleQueenBee().invoke('take fresh-rooms games')
    expect(revisionsOf).not.toHaveBeenCalled()
    expect(toasts.at(-1)?.type).toBe('warning')
    expect(toasts.at(-1)?.message).toContain(`not the ${AUDITED.slice(0, 12)}… you audited`)
  })

  it('takes the root that was audited — and, with no audit, takes as before', async () => {
    audited(AUDITED)
    doorNames(AUDITED)
    await new ModuleQueenBee().invoke('take fresh-rooms games')
    expect(revisionsOf).toHaveBeenCalledTimes(1)
    localStorage.clear()
    doorNames(SWAPPED)
    await new ModuleQueenBee().invoke('take fresh-rooms games')
    expect(revisionsOf).toHaveBeenCalledTimes(2)
  })
})
