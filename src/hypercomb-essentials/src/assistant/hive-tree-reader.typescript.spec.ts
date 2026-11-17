// hive-tree-reader.typescript.spec.ts — the package's TypeScript through the
// reader: which atom holds a file is answered from layers held here with no
// request; one file's text is the only read that asks a host; what comes back
// stays in memory; and a model's `read <atomSig>` never reaches the store.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_IOC_KEY } from '@hypercomb/core'
import { HypercombHiveTreeReader } from './hive-tree-reader.js'

const sig = (n: number): string => n.toString(16).padStart(64, '0')
const HISTORY = '@diamondcoreprocessor.com/HistoryService'
const STORE = '@hypercomb.social/Store'

const ROOT = sig(1)
const ASSISTANT = sig(2)
const GAMES_PICKED = sig(3)
const SHARING = sig(4)
const HISTORY_LAYER = sig(5)
const EDITOR = sig(6)
/** A bee the assistant layer names, and a dependency the root layer names. */
const MODULE = sig(40)
const DEPENDENCY = sig(43)
const PLATFORM = sig(41)
/** Code held here that no layer of the running package names. */
const FOREIGN = sig(42)
const ATOM = { assistant: sig(0xa1), sharing: sig(0xa2), history: sig(0xa3), editor: sig(0xa4) }

const atomText = (folder: string, files: Record<string, string>): string => [
  `// @hypercomb/typescript/${folder}`,
  '// lazy: never imported at boot',
  '// TypeScript as written, never run.',
  ...Object.entries(files).flatMap(([path, text]) => [`// ${path}`, text]),
  '',
].join('\n')

const atoms = new Map<string, string>([
  [ATOM.assistant, atomText('assistant', {
    'src/assistant/x.ts': 'export const x: number = 1\nexport type X = typeof x',
    'src/assistant/y.ts': 'export const y: string = "two"',
  })],
  [ATOM.sharing, atomText('sharing', { 'src/sharing/a.ts': 'export const a = 1' })],
  [ATOM.history, atomText('history', { 'src/history/h.ts': 'export const h = 1' })],
  [ATOM.editor, atomText('editor', { 'src/editor/e.ts': 'export const e = 1' })],
])

const layers = new Map<string, Record<string, unknown>>([
  // The root names no atom: a file directly in src/ has none.
  [ROOT, { name: 'essentials', cells: [], bees: [], dependencies: [DEPENDENCY] }],
  [ASSISTANT, { name: 'assistant', cells: [], bees: [`${MODULE}.js`], dependencies: [], typescript: ATOM.assistant }],
  [GAMES_PICKED, { name: 'games', cells: [], bees: [], dependencies: [] }],
  [SHARING, { name: 'sharing', cells: [], bees: [], dependencies: [], typescript: ATOM.sharing }],
  [HISTORY_LAYER, { name: 'history', cells: [], bees: [], dependencies: [], typescript: ATOM.history }],
  [EDITOR, { name: 'editor', cells: [], bees: [], dependencies: [], typescript: ATOM.editor }],
])
const node = (path: string, layerSig: string, base = layerSig) => ({ path, name: path, layerSig, base, bees: [], children: [], description: '' })
const selection = {
  trunk: ROOT, picks: {}, applied: [], eclipsed: [],
  nodes: [node('assistant', ASSISTANT), node('games', GAMES_PICKED, sig(9)), node('sharing', SHARING), node('history', HISTORY_LAYER), node('editor', EDITOR)],
}

let hosted: Set<string>
let read: ReturnType<typeof vi.fn>
let getResource: ReturnType<typeof vi.fn>
let getLayerBySig: ReturnType<typeof vi.fn>
let aliasesBefore: unknown

const readerWith = (install: unknown = { selection: async () => selection, installedSig: () => ROOT }): HypercombHiveTreeReader => {
  const services = new Map<string, unknown>([
    [HISTORY, { getLayerBySig, sign: async () => sig(999), currentLayerRefAt: async () => null, treeEpoch: () => 1 }],
    [STORE, {
      getResource,
      getBeeBytes: async () => null,
      getDependencyBytes: async () => null,
      getLayerBytes: async (wanted: string) => layers.has(wanted) ? new TextEncoder().encode(JSON.stringify(layers.get(wanted))) : null,
    }],
  ])
  if (install) services.set(INSTALL_IOC_KEY, install)
  return new HypercombHiveTreeReader(
    (<T>(key: string) => services.get(key) as T | undefined),
    read as unknown as (sig: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; host: string } | null>,
  )
}

beforeEach(() => {
  hosted = new Set(atoms.keys())
  read = vi.fn(async (wanted: string) => hosted.has(wanted) ? { bytes: new TextEncoder().encode(atoms.get(wanted)!), host: 'hypercomb.com' } : null)
  getResource = vi.fn(async () => null)
  getLayerBySig = vi.fn(async () => null)
  const aliases = globalThis as { __hypercombAliasMap?: unknown }
  aliasesBefore = aliases.__hypercombAliasMap
  aliases.__hypercombAliasMap = new Map([['@hypercomb/source/core', PLATFORM]])
})
afterEach(() => {
  const aliases = globalThis as { __hypercombAliasMap?: unknown }
  if (aliasesBefore === undefined) delete aliases.__hypercombAliasMap
  else aliases.__hypercombAliasMap = aliasesBefore
})

describe('which atom holds a file’s TypeScript', () => {
  it('answers from the layers held here, and asks no host', async () => {
    const reader = readerWith()
    expect(await reader.typescriptFor(MODULE, 'src/assistant/x.ts')).toEqual({ atom: ATOM.assistant, section: 'src/assistant/x.ts' })
    // A dependency the root layer names is the package's own too.
    expect(await reader.typescriptFor(DEPENDENCY, 'src/sharing/a.ts')).toEqual({ atom: ATOM.sharing, section: 'src/sharing/a.ts' })
    expect(read).not.toHaveBeenCalled()
    expect(getResource).not.toHaveBeenCalled()
  })

  it('answers nothing for a file the atoms never carry: no root atom, no generated index, no keys file', async () => {
    const reader = readerWith()
    for (const section of [
      'src/preload-effects.ts', 'src/side-effects.ts',
      'src/assistant/index.ts', 'src/assistant/assistant-keys.ts', 'src/assistant/x.keys.ts',
      'src/assistant/x.spec.ts', 'src/assistant/x.d.ts', 'src/assistant/x.entry.ts', 'src/types/global.ts',
    ]) {
      expect(await reader.typescriptFor(MODULE, section), section).toBeUndefined()
    }
    // The same module, a file the atoms do carry.
    expect(await reader.typescriptFor(MODULE, 'src/assistant/x.ts')).toBeDefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('answers nothing for a module the running package does not name, whatever its section headers say', async () => {
    const reader = readerWith()
    // Held code from elsewhere can carry a `// src/assistant/x.ts` header.
    expect(await reader.typescriptFor(FOREIGN, 'src/assistant/x.ts')).toBeUndefined()
    expect(await reader.typescriptFor(sig(44), 'src/sharing/a.ts')).toBeUndefined()
    // A layer signature and an atom signature are not modules either.
    expect(await reader.typescriptFor(ASSISTANT, 'src/assistant/x.ts')).toBeUndefined()
    expect(await reader.typescriptFor(ATOM.assistant, 'src/assistant/x.ts')).toBeUndefined()
    expect(await reader.typescriptFor(MODULE, 'src/assistant/x.ts')).toBeDefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('answers nothing where no TypeScript can exist', async () => {
    const reader = readerWith()
    // Not a TypeScript file.
    expect(await reader.typescriptFor(MODULE, 'src/assistant/words.json')).toBeUndefined()
    // The platform's own source atoms already are TypeScript.
    expect(await reader.typescriptFor(PLATFORM, 'src/assistant/x.ts')).toBeUndefined()
    // A picked layer with no slot: what runs there is not what the root's atom holds.
    expect(await reader.typescriptFor(MODULE, 'src/games/solomon/maze.ts')).toBeUndefined()
    // Not a signature.
    expect(await reader.typescriptFor('nope', 'src/assistant/x.ts')).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('answers nothing with no install port, with no installed package, and for a package without slots', async () => {
    expect(await readerWith(null).typescriptFor(MODULE, 'src/assistant/x.ts')).toBeUndefined()
    const none = { selection: async () => ({ trunk: null, picks: {}, applied: [], eclipsed: [], nodes: [] }) }
    expect(await readerWith(none).typescriptFor(MODULE, 'src/assistant/x.ts')).toBeUndefined()
    const bare = { selection: async () => ({ ...selection, trunk: sig(70), nodes: [node('assistant', sig(71))] }) }
    expect(await readerWith(bare).typescriptFor(MODULE, 'src/assistant/x.ts')).toBeUndefined()
    const failing = { selection: async () => { throw new Error('not ready') } }
    expect(await readerWith(failing).typescriptFor(MODULE, 'src/assistant/x.ts')).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('reads a port that throws, or answers something that is no selection, as no atoms and never as a rejection', async () => {
    const ports: unknown[] = [
      { selection: () => { throw new Error('thrown before any promise') }, installedSig: () => ROOT },
      { selection: async () => ({ trunk: ROOT }), installedSig: () => ROOT },
      { selection: async () => ({ trunk: ROOT, nodes: 'nodes' }), installedSig: () => ROOT },
      { selection: async () => null, installedSig: () => ROOT },
      { selection: () => ({ trunk: ROOT, nodes: [null, { path: 7 }, {}] }), installedSig: () => { throw new Error('no root') } },
      { selection: 'not a function', installedSig: () => ROOT },
      { installedSig: () => ROOT },
    ]
    for (const port of ports) {
      const reader = readerWith(port)
      await expect(reader.typescriptFor(MODULE, 'src/assistant/x.ts')).resolves.toBeUndefined()
      await expect(reader.typescriptAtom(ATOM.assistant)).resolves.toMatchObject({ atom: false })
      await expect(reader.readNodeBySig(sig(77))).resolves.toMatchObject({ ok: false })
      await expect(reader.readBytesBySig(sig(77))).resolves.toMatchObject({ ok: false, code: 'not-found' })
    }
    expect(read).not.toHaveBeenCalled()
  })
})

describe('one file’s TypeScript', () => {
  it('is not asked for until a layer here has named the atom', async () => {
    const reader = readerWith()
    expect(await reader.typescriptText(ATOM.assistant, 'src/assistant/x.ts')).toEqual({ ok: false, code: 'not-named' })
    expect(read).not.toHaveBeenCalled()
  })

  it('is the file as written, without its header line, from one request for the whole folder', async () => {
    const reader = readerWith()
    const source = (await reader.typescriptFor(MODULE, 'src/assistant/x.ts'))!
    const signal = new AbortController().signal
    expect(await reader.typescriptText(source.atom, source.section, { signal })).toEqual({
      ok: true, host: 'hypercomb.com', text: 'export const x: number = 1\nexport type X = typeof x\n',
    })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(ATOM.assistant, signal)
    // A second file of the same folder is read from memory.
    expect(await reader.typescriptText(source.atom, 'src/assistant/y.ts')).toMatchObject({ ok: true, text: 'export const y: string = "two"\n' })
    expect(read).toHaveBeenCalledTimes(1)
    // A file the atom does not hold.
    expect(await reader.typescriptText(source.atom, 'src/assistant/absent.ts')).toEqual({ ok: false, code: 'no-section' })
    expect(getResource).not.toHaveBeenCalled()
  })

  it('keeps three atoms, and a fourth drops the one read longest ago', async () => {
    const reader = readerWith()
    for (const section of ['src/assistant/x.ts', 'src/sharing/a.ts', 'src/history/h.ts', 'src/editor/e.ts']) {
      const source = (await reader.typescriptFor(MODULE, section))!
      expect((await reader.typescriptText(source.atom, section)).ok).toBe(true)
    }
    expect(read).toHaveBeenCalledTimes(4)
    // The last three are held.
    await reader.typescriptText(ATOM.sharing, 'src/sharing/a.ts')
    await reader.typescriptText(ATOM.editor, 'src/editor/e.ts')
    expect(read).toHaveBeenCalledTimes(4)
    // The first was dropped, so it is asked for again.
    await reader.typescriptText(ATOM.assistant, 'src/assistant/x.ts')
    expect(read).toHaveBeenCalledTimes(5)
  })

  it('says when no host holds it, and asks again the next time', async () => {
    const reader = readerWith()
    hosted.delete(ATOM.assistant)
    const source = (await reader.typescriptFor(MODULE, 'src/assistant/x.ts'))!
    expect(await reader.typescriptText(source.atom, source.section)).toEqual({ ok: false, code: 'not-hosted' })
    expect(await reader.typescriptText(source.atom, source.section)).toEqual({ ok: false, code: 'not-hosted' })
    expect(read).toHaveBeenCalledTimes(2)
    hosted.add(ATOM.assistant)
    expect((await reader.typescriptText(source.atom, source.section)).ok).toBe(true)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('is never a listed module: the code reads do not ask a host and do not name an atom', async () => {
    const reader = readerWith()
    await reader.typescriptFor(MODULE, 'src/assistant/x.ts')
    const listed = await reader.listCode('')
    const index = await reader.codeIndex()
    await reader.codeQuoting('typescript')
    await reader.listCode('x.ts')
    const named = [...(listed.ok ? listed.entries ?? [] : []), ...index].map(entry => entry.sig)
    for (const atom of Object.values(ATOM)) expect(named).not.toContain(atom)
    expect(await reader.moduleText(ATOM.assistant)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('a model’s read of an atom stays in memory', () => {
  it('is not a layer: the history service is never asked for it', async () => {
    const reader = readerWith()
    expect(await reader.readNodeBySig(ATOM.assistant)).toMatchObject({ ok: false, code: 'not-found' })
    expect(getLayerBySig).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('reads a file of it through the package’s hosts once, pages from memory, and never asks the store', async () => {
    const reader = readerWith()
    const file = await reader.readBytesBySig(ATOM.assistant, { section: 'src/assistant/x.ts' })
    expect(file).toMatchObject({ ok: true, of: 'resource', type: 'text/plain', section: 'src/assistant/x.ts' })
    expect(file.ok && file.text).toContain('export const x: number = 1')
    expect(file.ok && file.text).not.toContain('export const y')
    expect(read).toHaveBeenCalledTimes(1)
    const next = await reader.readBytesBySig(ATOM.assistant, { section: 'src/assistant/x.ts', from: 10 })
    expect(next.ok && next.from).toBe(10)
    // Opened whole it names its files.
    const whole = await reader.readBytesBySig(ATOM.assistant)
    expect(whole.ok && whole.sections?.map(section => section.path)).toEqual(['src/assistant/x.ts', 'src/assistant/y.ts'])
    expect(read).toHaveBeenCalledTimes(1)
    expect(getResource).not.toHaveBeenCalled()
  })

  it('answers not-found for an atom no host holds, and still never asks the store', async () => {
    const reader = readerWith()
    hosted.clear()
    expect(await reader.readBytesBySig(ATOM.sharing)).toMatchObject({ ok: false, code: 'not-found' })
    expect(read).toHaveBeenCalledTimes(1)
    expect(getResource).not.toHaveBeenCalled()
  })

  it('leaves every other signature on the path it had', async () => {
    const reader = readerWith()
    const other = sig(77)
    getResource.mockImplementation(async (wanted: string) => wanted === other ? { type: 'text/plain', arrayBuffer: async () => new TextEncoder().encode('a note').buffer } : null)
    expect(await reader.readBytesBySig(other)).toMatchObject({ ok: true, of: 'resource', text: 'a note' })
    expect(getResource).toHaveBeenCalledWith(other)
    await reader.readNodeBySig(other)
    expect(getLayerBySig).toHaveBeenCalledWith(other)
    expect(read).not.toHaveBeenCalled()
  })

  it('says whether a signature is an atom, and whether it could tell', async () => {
    const reader = readerWith()
    expect(await reader.typescriptAtom(ATOM.sharing)).toEqual({ atom: true, known: true })
    expect(await reader.typescriptAtom(sig(77))).toEqual({ atom: false, known: true })
    expect(await reader.typescriptAtom(MODULE)).toEqual({ atom: false, known: true })
    expect(await readerWith(null).typescriptAtom(ATOM.sharing)).toEqual({ atom: false, known: false })
    expect(read).not.toHaveBeenCalled()
    expect(getResource).not.toHaveBeenCalled()
  })
})

describe('an atom reached another way is never read through the store', () => {
  const blobOf = (text: string, type = 'text/plain') => ({ type, size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer })

  it('a tile whose child pointer is an atom signature is read without the store being asked for it', async () => {
    // A child slot may hold one signature, a pointer the store resolves; the
    // store fetches a signature it lacks and writes what answers.
    const tile = sig(80)
    const pointer = sig(81)
    const reader = readerWith()
    getLayerBySig.mockImplementation(async (wanted: string) => wanted === tile ? { name: 'tile', cells: ATOM.assistant } : wanted === sig(82) ? { name: 'tile', cells: pointer } : null)
    getResource.mockImplementation(async () => blobOf('[]', 'application/json'))
    expect(await reader.readNodeBySig(tile)).toMatchObject({ ok: true, children: [] })
    expect(getResource).not.toHaveBeenCalled()
    // Any other pointer is the store's to resolve, as it was.
    expect(await reader.readNodeBySig(sig(82))).toMatchObject({ ok: true, children: [] })
    expect(getResource).toHaveBeenCalledTimes(1)
    expect(getResource).toHaveBeenCalledWith(pointer)
    expect(read).not.toHaveBeenCalled()
  })

  it('every atom of the selection is closed to the store, not only one already read', async () => {
    const reader = readerWith()
    getResource.mockImplementation(async () => blobOf('[]', 'application/json'))
    for (const [at, atom] of Object.values(ATOM).entries()) {
      const tile = sig(90 + at)
      getLayerBySig.mockImplementation(async (wanted: string) => wanted === tile ? { name: 'tile', children: atom } : null)
      await reader.readNodeBySig(tile)
    }
    expect(getResource).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
})

describe('the reader has one door to the store', () => {
  it('looks the store up in one place, the one that closes its read by signature to atoms', () => {
    // A second lookup would be a read by signature the guard never sees: the
    // site-file search, the child pointers and a model's read all pass here.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'hive-tree-reader.ts'), 'utf8')
    expect(source.match(/#lookup<HiveStore>\(STORE_KEY\)/g)).toHaveLength(1)
    expect(source).toMatch(/#store\(\): HiveStore \| undefined \{\s*const store = this\.#lookup<HiveStore>\(STORE_KEY\)\s*return store && typeof store === 'object' \? this\.#guardedStore\(store\) : store/)
    expect(source).not.toMatch(/ioc\??\.get[^\n]*Store'/)
  })

  it('hands every other method of the store through as the store\'s own', async () => {
    // The store keeps private state; a method called on a wrapper would lose it.
    class Store {
      #layers = layers
      calls: string[] = []
      async getResource(wanted: string) { this.calls.push(wanted); return null }
      async getLayerBytes(wanted: string) { return this.#layers.has(wanted) ? new TextEncoder().encode(JSON.stringify(this.#layers.get(wanted))) : null }
      async getBeeBytes() { return null }
      async getDependencyBytes() { return null }
    }
    const store = new Store()
    const services = new Map<string, unknown>([
      [HISTORY, { getLayerBySig, sign: async () => sig(999), currentLayerRefAt: async () => null, treeEpoch: () => 1 }],
      [STORE, store],
      [INSTALL_IOC_KEY, { selection: async () => selection, installedSig: () => ROOT }],
    ])
    const reader = new HypercombHiveTreeReader((<T>(key: string) => services.get(key) as T | undefined), read as never)
    expect(await reader.typescriptFor(MODULE, 'src/assistant/x.ts')).toEqual({ atom: ATOM.assistant, section: 'src/assistant/x.ts' })
    await reader.readBytesBySig(ATOM.assistant)
    await reader.readBytesBySig(sig(77))
    expect(store.calls).toEqual([sig(77)])
  })
})

describe('where no selection can be read', () => {
  const blobOf = (text: string) => ({ type: 'text/plain', size: text.length, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer })
  // Three shells in which nothing says which signatures the package names.
  const ports: Array<[string, unknown]> = [
    ['no install port', null],
    ['a port without selection()', { installedSig: () => ROOT }],
    ['a port whose selection() throws', { selection: async () => { throw new Error('not ready') }, installedSig: () => ROOT }],
  ]

  for (const [shell, port] of ports) {
    it(`${shell}: text that opens as a source atom is refused, not handed on from the store`, async () => {
      const reader = readerWith(port)
      const note = sig(77)
      getResource.mockImplementation(async (wanted: string) =>
        wanted === ATOM.assistant ? blobOf(atoms.get(ATOM.assistant)!) : wanted === note ? blobOf('// a note about @hypercomb/typescript/ and nothing more') : null)
      // The guard cannot know, so the store is asked; what it hands back is an atom by its first line.
      const refused = await reader.readBytesBySig(ATOM.assistant)
      expect(getResource).toHaveBeenCalledWith(ATOM.assistant)
      expect(refused).toEqual({ ok: false, root: ATOM.assistant, code: 'not-found' })
      expect(await reader.readBytesBySig(ATOM.assistant, { section: 'src/assistant/x.ts' })).toMatchObject({ ok: false, code: 'not-found' })
      // Any other text is read as before.
      expect(await reader.readBytesBySig(note)).toMatchObject({ ok: true, of: 'resource', text: '// a note about @hypercomb/typescript/ and nothing more' })
      expect(read).not.toHaveBeenCalled()
    })
  }

  it('with a selection that names it, the same signature is answered from memory and the store is never asked', async () => {
    const reader = readerWith()
    getResource.mockImplementation(async () => blobOf(atoms.get(ATOM.assistant)!))
    expect(await reader.readBytesBySig(ATOM.assistant, { section: 'src/assistant/x.ts' })).toMatchObject({ ok: true, section: 'src/assistant/x.ts' })
    expect(getResource).not.toHaveBeenCalled()
    expect(read).toHaveBeenCalledTimes(1)
  })
})
