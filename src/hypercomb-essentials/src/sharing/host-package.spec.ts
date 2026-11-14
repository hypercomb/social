// A package made on the hosts desk and made a host's root (host-package.ts): the two
// acts as data, and the shape the desk keeps around them. (jwize, 2026-11-13: "You
// should be able to create any variety of package here and then use it as a host root".)

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ModuleCommitOutcome } from '@hypercomb/core'
import { packageName, savePackage, servePackage, type ServeDeps } from './host-package'

const here = dirname(fileURLToPath(import.meta.url))
const VIEW = readFileSync(join(here, 'host-directory.view.ts'), 'utf8')
const SOURCE = readFileSync(join(here, 'host-package.ts'), 'utf8')
const between = (from: string, to: string): string => VIEW.slice(VIEW.indexOf(from), VIEW.indexOf(to, VIEW.indexOf(from) + 1))

const ROOT = 'a'.repeat(64)
const committed = (over: Partial<Extract<ModuleCommitOutcome, { ok: true }>> = {}): ModuleCommitOutcome => ({
  ok: true, rootSig: ROOT, index: 3, atoms: ['l1'], files: ['l1', 'b1', 'd1'], drafts: [], changes: [], off: ['calendar', 'games/arkanoid'], ...over,
})

describe('a package name', () => {
  it('is one lowercase word — the install channel publish:revision would take', () => {
    expect(packageName('minimal')).toBe('minimal')
    expect(packageName('  My Hive  ')).toBe('my-hive')
    expect(packageName('no_ai')).toBe('no-ai')
    expect(packageName('essentials')).toBe('essentials')
  })

  it('is nothing when it could not be a channel', () => {
    for (const bad of ['', '   ', '9lives', 'a/b', 'install:x', 'x'.repeat(41), 'ünï', null, undefined]) expect(packageName(bad), String(bad)).toBe('')
  })
})

describe('save', () => {
  it('commits what runs here under the name and says what it made', async () => {
    const commit = vi.fn(async () => committed({ taken: [{ path: 'assistant', root: 'r'.repeat(64) }], drafts: ['games/solomon'], held: ['comfy'] }))
    const outcome = await savePackage(' Minimal ', commit)
    expect(commit).toHaveBeenCalledWith('minimal')
    expect(outcome).toEqual({ ok: true, saved: {
      name: 'minimal', root: ROOT, index: 3, files: ['l1', 'b1', 'd1'],
      off: ['calendar', 'games/arkanoid'], folded: ['assistant', 'games/solomon'], held: ['comfy'],
    } })
  })

  it('never commits under a name that is not one, or where nothing can commit', async () => {
    const commit = vi.fn(async () => committed())
    expect(await savePackage('9 lives!', commit)).toEqual({ ok: false, error: 'name' })
    expect(commit).not.toHaveBeenCalled()
    expect(await savePackage('minimal', undefined)).toEqual({ ok: false, error: 'unavailable' })
  })

  it('passes the runtime\'s refusal on, and a throw is a refusal', async () => {
    expect(await savePackage('minimal', async () => ({ ok: false, error: 'nothing to commit: no draft is picked and nothing is turned off' })))
      .toEqual({ ok: false, error: 'nothing to commit: no draft is picked and nothing is turned off' })
    expect(await savePackage('minimal', async () => { throw new Error('store gone') })).toEqual({ ok: false, error: 'store gone' })
  })
})

describe('serve', () => {
  const saved = { name: 'minimal', root: ROOT, files: ['l1', 'b1', 'd1'] }
  const world = (over: Partial<ServeDeps> = {}) => {
    const order: string[] = []
    const deps: ServeDeps = {
      publishAtoms: async (host, sigs) => { order.push(`files:${host}:${sigs.join(',')}`); return { ok: true, sent: 2, held: 1 } },
      bytesOf: async () => new Uint8Array([1]),
      stamp: async (host, key, root) => { order.push(`pointer:${host}:${key}:${root === ROOT}`); return { ok: true } },
      unaccepted: async () => { order.push('check'); return [] },
      ...over,
    }
    return { order, deps }
  }

  it('checks, sends every file, and only then moves the signed pointer install:<name>', async () => {
    const { order, deps } = world()
    expect(await servePackage('jwize.com', saved, deps)).toEqual({ ok: true, host: 'jwize.com', channel: 'install:minimal', sent: 2, held: 1 })
    expect(order).toEqual(['check', 'files:jwize.com:l1,b1,d1', 'pointer:jwize.com:install:minimal:true'])
  })

  it('sends nothing while code in it waits in the brood, or when that cannot be told', async () => {
    const held = world({ unaccepted: async () => ['b1', 'd1'] })
    expect(await servePackage('jwize.com', saved, held.deps)).toEqual({ ok: false, stage: 'check', error: 'held', waiting: 2 })
    expect(held.order).toEqual([])
    const unread = world({ unaccepted: async () => null })
    expect(await servePackage('jwize.com', saved, unread.deps)).toEqual({ ok: false, stage: 'check', error: 'unread' })
    const threw = world({ unaccepted: async () => { throw new Error('x') } })
    expect(await servePackage('jwize.com', saved, threw.deps)).toMatchObject({ ok: false, stage: 'check', error: 'unread' })
    expect([...unread.order, ...threw.order]).toEqual([])
  })

  it('never moves the pointer when the files did not all arrive', async () => {
    const { order, deps } = world({ publishAtoms: async () => ({ ok: false, error: 'b1… is not held here' }) })
    expect(await servePackage('jwize.com', saved, deps)).toEqual({ ok: false, stage: 'files', error: 'b1… is not held here' })
    expect(order).toEqual(['check'])
    const threw = world({ publishAtoms: async () => { throw new Error('offline') } })
    expect(await servePackage('jwize.com', saved, threw.deps)).toEqual({ ok: false, stage: 'files', error: 'offline' })
    expect(threw.order).toEqual(['check'])
  })

  it('says the files are there when only the pointer refused', async () => {
    const { deps } = world({ stamp: async () => ({ ok: false, reason: 'no signer' }) })
    expect(await servePackage('jwize.com', saved, deps)).toEqual({ ok: false, stage: 'pointer', error: 'no signer' })
  })

  it('needs a host, a name and the host service', async () => {
    const { deps } = world()
    expect(await servePackage('', saved, deps)).toMatchObject({ ok: false, stage: 'check', error: 'no-host' })
    expect(await servePackage('jwize.com', { ...saved, name: '9x' }, deps)).toMatchObject({ ok: false, stage: 'check', error: 'name' })
    expect(await servePackage('jwize.com', saved, { ...deps, publishAtoms: undefined })).toMatchObject({ ok: false, stage: 'check', error: 'unavailable' })
  })
})

describe('the desk around them', () => {
  it('offers Save only on this origin, where a package runs', () => {
    const section = between('  #sectionBody(zone: string): HTMLElement {', '  // ── a package of your own')
    expect(section).toMatch(/if \(reach && trunk\) \{\s*const save = button\('hd-link hd-package-open'/)
    // Inside the branch for this origin: a host's pane has no Save.
    expect(section.indexOf('hd-package-open')).toBeGreaterThan(section.indexOf('} else {'))
    expect(section).toMatch(/if \(!zone && \(this\.#packaging \|\| this\.#saved \|\| this\.#packageNote\)\) section\.append\(this\.#packageBlock\(\)\)/)
  })

  it('saves through the runtime\'s commit, and what is typed survives a repaint', () => {
    const block = between('  #packageBlock(): HTMLElement {', '  /** SAVE: the runtime re-mints')
    expect(block).toMatch(/field\.dataset\['field'\] = 'package-name'/)
    expect(block).toMatch(/field\.value = this\.#packageName/)
    const save = between('  async #savePackage(): Promise<void> {', '  /** USE AS THE ROOT')
    expect(save).toMatch(/savePackage\(this\.#packageName, drafts \? label => drafts\.commit\(label\) : undefined\)/)
    // Saving sends nothing anywhere.
    expect(save).not.toMatch(/publishAtoms|setHiveRoot|fetch\(/)
  })

  it('serves only on the participant\'s own press, to the Home Domain, through the one sequence', () => {
    const block = between('  #packageBlock(): HTMLElement {', '  /** SAVE: the runtime re-mints')
    expect(block).toMatch(/serve\.addEventListener\('click', \(\) => \{ void this\.#servePackage\(home\) \}\)/)
    expect(block).toMatch(/home = zoneOf\(localStorage\.getItem\(OWN_HOST_KEY\) \?\? ''\)/)
    // The only caller of the serve is that press.
    expect([...VIEW.matchAll(/this\.#servePackage\(/g)]).toHaveLength(1)
    const serve = between('  async #servePackage(host: string): Promise<void> {', '  /** THE FIREWALL, as its own list')
    expect(serve).toMatch(/await servePackage\(host, saved, \{/)
    expect(serve).toMatch(/stamp: \(zone, key, root\) => setHiveRoot\(zone, key, root\)/)
    expect(serve).toMatch(/if \(!\(await mayRunBee\(sig\)\)\) waiting\.push\(sig\)/)
  })

  it('lets Escape drop the question before anything else it unwinds, and keeps what was saved', () => {
    const back = between('  #back(): boolean {', '  // ── what is on screen')
    expect(back).toMatch(/if \(this\.#packaging\) \{ this\.#packaging = false; this\.#packageNote = null; this\.#renderBody\(\); return true \}/)
    expect(back.indexOf('this.#packaging')).toBeLessThan(back.indexOf('if (this.#query)'))
  })

  it('is no revision picker: a root domain stays on and off (2026-11-13)', () => {
    const block = between('  // ── a package of your own', '  /** THE FIREWALL, as its own list')
    expect(block).not.toMatch(/#openRevisions|revisionsOf|hosts\.revisions/)
  })

  it('registers nothing and reaches no other tier', () => {
    expect(SOURCE).not.toMatch(/ioc\.register|window\.ioc|localStorage|fetch\(/)
    expect([...SOURCE.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1])).toEqual(['@hypercomb/core', './hive-link.js'])
  })
})
