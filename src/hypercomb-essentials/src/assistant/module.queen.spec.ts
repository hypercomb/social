// assistant/module.queen.spec.ts — `module take` takes only the root `module
// audit` read: a door that names a new root after the audit is refused.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EffectBus, INSTALL_IOC_KEY, MODULE_DRAFTS_IOC_KEY } from '@hypercomb/core'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// The sub-words are the queen's own `options` — completion and dispatch read
// that one list — and the command line runs every behaviour word on a line in
// order, so a sub-word that is ALSO a behaviour word would run twice unless
// the queen keeps the rest of the line verbatim (`rawArgs`). `changes` is both
// a sub-word of `module` and a word of its own; `module` is safe only because
// it keeps its arguments.
describe('the sub-words of module', () => {
  const queen = new ModuleQueenBee()
  const here = dirname(fileURLToPath(import.meta.url))

  /** Every behaviour word the essentials tree declares (a queen's `command`). */
  const behaviourWords = (): Set<string> => {
    const words = new Set<string>()
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full) }
        else if (/\.queen\.ts$/.test(entry.name)) {
          const word = /readonly\s+command\s*=\s*'([^']+)'/.exec(readFileSync(full, 'utf8'))?.[1]
          if (word) words.add(word)
        }
      }
    }
    walk(join(here, '..'))
    return words
  }

  it('are the words of its options, and completion is derived from them', () => {
    expect([...queen.subWords]).toEqual(['list', 'drop', 'commit', 'promote', 'withdraw', 'review', 'assess', 'trials', 'changes', 'take', 'focus', 'audit'])
    expect(queen.slashComplete('')).toEqual(['list', 'drop ', 'commit ', 'promote ', 'withdraw ', 'review ', 'assess ', 'trials ', 'changes ', 'take ', 'focus ', 'audit '])
    expect(queen.slashComplete('ta')).toEqual(['take '])
    expect(queen.slashComplete('list')).toEqual([])
  })

  it('may be a behaviour word only because the queen keeps its arguments verbatim', () => {
    const behaviours = behaviourWords()
    expect(behaviours.has('module'), 'the scan found no queens').toBe(true)
    const colliding = [...queen.subWords].filter(word => behaviours.has(word))
    if (colliding.length) expect(queen.rawArgs, `${colliding.join(', ')} would run as its own action`).toBe(true)
  })
})
