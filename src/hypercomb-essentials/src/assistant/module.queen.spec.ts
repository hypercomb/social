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

// A take whose code the brood holds — the real take needs the brood roster,
// so the outcome is handed in for the one case that pins the held answer.
const heldTake = vi.hoisted(() => ({ next: null as null | { taken: string[]; refused: { path: string; error: string }[]; held: number } }))
vi.mock('./module-review.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./module-review.js')>()
  return {
    ...real,
    takeTrial: (...args: Parameters<typeof real.takeTrial>) =>
      heldTake.next ? Promise.resolve(heldTake.next) : real.takeTrial(...args),
  }
})

const { ModuleQueenBee, unacceptedIn } = await import('./module.queen.js')

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
  heldTake.next = null
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

describe('module take with held code', () => {
  // A window opens only from its own door: the take answers in a toast that
  // names the brood word, and never opens the brood itself.
  it('says brood in the toast and emits no brood:open', async () => {
    doorNames(AUDITED)
    heldTake.next = { taken: ['games'], refused: [], held: 1 }
    const opens: unknown[] = []
    const off = EffectBus.on('brood:open', p => { opens.push(p) })
    opens.length = 0 // drop any replay delivered at subscribe time
    await new ModuleQueenBee().invoke('take fresh-rooms games')
    off()
    expect(opens).toEqual([])
    expect(toasts.at(-1)?.type).toBe('success')
    expect(toasts.at(-1)?.message).toContain('brood')
    // ...and the toast carries the brood's door, for a tap.
    expect((toasts.at(-1) as { actionEffect?: string } | undefined)?.actionEffect).toBe('brood:open')
  })
})

// 2026-10-25: `module trials @localhost:4291` vanished on the Enter path — the
// tag extractor read `localhost:4291` as `label:tag` and stripped the line
// before the word ran. A word whose arguments name hosts keeps them verbatim.
describe('a host with a port', () => {
  it('reaches the word: the module word keeps its arguments verbatim', () => {
    expect(new ModuleQueenBee().rawArgs).toBe(true)
  })
})

// jwize, 2026-10-26: "there is no bot accepting going live in the hive".
describe('promote goes live only with what you accepted', () => {
  const install = (bees: string[], deps: string[] = []) => ({
    modulesOf: async () => ({ root: 'r', bees: bees.map(sig => ({ sig, path: 'p' })), dependencies: deps.map(sig => ({ sig, alias: '' })) }),
  })
  it('names every module the trial carries that this hive still holds', async () => {
    const accepted = new Set(['a', 'd1'])
    expect(await unacceptedIn('r', ['h'], install(['a', 'b', 'b'], ['d1', 'd2']), async sig => accepted.has(sig))).toEqual(['b', 'd2'])
    expect(await unacceptedIn('r', ['h'], install(['a'], ['d1']), async sig => accepted.has(sig))).toEqual([])
  })
  it('says it cannot tell when the trial cannot be read here', async () => {
    expect(await unacceptedIn('r', ['h'], { modulesOf: async () => null })).toBeNull()
    expect(await unacceptedIn('r', ['h'], undefined)).toBeNull()
  })
})
