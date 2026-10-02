// agent-turn.spec.ts — the model's loop with no window: a scripted model
// reads a held revision's tree through the real tree reader, opens one file,
// writes it into a draft, and answers. The hive runs what the model asks and
// tells it what happened in the loop's own words (core work-words.ts).

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { READ_FENCE_LANG, WRITE_FENCE_LANG, type StretchChunk } from '@hypercomb/core'
import { HypercombHiveTreeReader } from './hive-tree-reader.js'
import { agentTurn, runAgentTurn, type AgentQueue, type AgentRouter, type AgentVersions } from './agent-turn.js'

const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

/** A version pool held in memory, readable the way OPFS is. */
const pool = () => {
  const files = new Map<string, string>()
  const put = (text: string): string => { const sig = sha(text); files.set(sig, text); return sig }
  const dir = {
    getFileHandle: async (name: string) => {
      const text = files.get(name)
      if (text === undefined) throw new DOMException('not found', 'NotFoundError')
      return { getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(text).buffer }) }
    },
  }
  return { files, put, dir }
}

/** A revision of two files, as the version pools hold one. */
const held = () => {
  const p = pool()
  const a = p.put('export const greeting = \'hello\'\n')
  const b = p.put('# notes\n')
  const workspace = p.put(JSON.stringify({ name: 'workspace', files: { 'src/hypercomb-essentials/src/a.ts': a, 'src/documentation/notes.md': b } }))
  const revision = p.put(JSON.stringify({ name: 'build', label: 'host', version: '2026.10.2.1', parent: null, workspace }))
  const reader = new HypercombHiveTreeReader(((key: string) => ({
    '@hypercomb.social/Store': { getResource: async () => null, openPool: async (meaning: string) => meaning === 'host:builds' ? p.dir : null },
    '@diamondcoreprocessor.com/HistoryService': { getLayerBySig: async () => null, treeEpoch: () => 1 },
  } as Record<string, unknown>)[key]) as never)
  const staged: Array<{ base: string; files: Record<string, string | null> }> = []
  const versions: AgentVersions = {
    revisions: async () => [{ sig: revision, label: 'host', version: '2026.10.2.1' }],
    read: async (rev, path) => {
      const tree = JSON.parse(p.files.get(JSON.parse(p.files.get(rev)!).workspace)!).files as Record<string, string>
      if (!tree[path]) throw new Error(`${path} is not in that revision`)
      return p.files.get(tree[path])!
    },
    stage: async request => { staged.push(request); return sha(JSON.stringify(request)) },
  }
  return { p, revision, reader, versions, staged }
}

/** A model that answers each round from a script, and remembers what it was sent. */
const scripted = (replies: ((sent: { role: string; content: string }[], system: string) => string)[]) => {
  const calls: { messages: { role: string; content: string }[]; system: string }[] = []
  const router: AgentRouter = {
    async *stream(call): AsyncIterable<StretchChunk> {
      const messages = (call['messages'] as { role: string; content: string }[]).map(m => ({ ...m }))
      calls.push({ messages, system: String(call['system']) })
      const reply = replies[calls.length - 1]
      if (!reply) throw new Error('the script ran out')
      const text = reply(messages, String(call['system']))
      // Streamed in pieces, as a provider does.
      for (let i = 0; i < text.length; i += 17) yield { providerId: 'local', model: 'scripted-1', text: text.slice(i, i + 17) }
    },
    contextLengthForModel: () => 64_000,
  }
  return { router, calls }
}

const block = (lang: string, ...lines: string[]): string => `\n\n\`\`\`${lang}\n${lines.join('\n')}\n\`\`\``

describe('a turn with no window', () => {
  it('reads a held revision, writes a file of it into a draft, and answers', async () => {
    const h = held()
    const path = 'src/hypercomb-essentials/src/a.ts'
    const { router, calls } = scripted([
      () => `Let me look at the revision.${block(READ_FENCE_LANG, `read ${h.revision}`)}`,
      sent => {
        // The top of the tree: one folder, and how many files it holds.
        expect(sent.at(-1)!.content).toContain('src/  (2 files)')
        return `Opening the file.${block(READ_FENCE_LANG, `read ${h.revision} ${path}`)}`
      },
      sent => {
        expect(sent.at(-1)!.content).toContain('export const greeting = \'hello\'')
        return `Changing it.${block(WRITE_FENCE_LANG, `version ${h.revision} ${path}`, '<<<<<<< SEARCH', 'export const greeting = \'hello\'', '=======', 'export const greeting = \'hello, hive\'', '>>>>>>> REPLACE')}`
      },
      sent => {
        expect(sent.at(-1)!.content).toContain('staged draft')
        return 'Done: the greeting now says hello, hive, in a draft you can send to a builder.'
      },
    ])
    const result = await runAgentTurn({ request: 'make the greeting say hello, hive' }, {
      router, reader: h.reader, versions: h.versions, readsFreely: () => true,
    })
    // What the model was taught: the version write, and the revisions held.
    expect(calls[0]!.system).toContain(`version <revision signature> <path>`)
    expect(calls[0]!.system).toContain(`${h.revision} host 2026.10.2.1`)
    expect(result.rounds).toBe(4)
    expect(result.read).toEqual([`/read ${h.revision}`, `/read ${h.revision} ${path}`])
    expect(h.staged).toEqual([{ base: h.revision, files: { [path]: 'export const greeting = \'hello, hive\'\n' } }])
    expect(result.drafts).toEqual([{ draft: sha(JSON.stringify(h.staged[0])), version: h.revision, paths: [path] }])
    expect(result.answer).toContain('Done: the greeting now says hello, hive')
    expect(result.answer).not.toContain('```')
    expect(result.left).toBeUndefined()
  })

  it('lists a folder of the tree, and keeps every file written over one revision in one draft', async () => {
    const h = held()
    const { router } = scripted([
      () => block(READ_FENCE_LANG, `read ${h.revision} src/documentation`),
      sent => {
        expect(sent.at(-1)!.content).toContain('src/documentation/notes.md')
        return block(WRITE_FENCE_LANG, `version ${h.revision} src/documentation/notes.md`, '# notes', 'one more line')
      },
      () => block(WRITE_FENCE_LANG, `version ${h.revision} src/documentation/new.md`, 'a new file'),
      () => 'Two files drafted.',
    ])
    const result = await runAgentTurn({ request: 'add notes' }, { router, reader: h.reader, versions: h.versions, readsFreely: () => true })
    expect(h.staged.at(-1)).toEqual({ base: h.revision, files: { 'src/documentation/notes.md': '# notes\none more line\n', 'src/documentation/new.md': 'a new file\n' } })
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]!.paths).toEqual(['src/documentation/new.md', 'src/documentation/notes.md'])
  })

  it('waits for the participant in Execution, and tells the model what they skipped', async () => {
    const h = held()
    const asked: { kind: string; lines: readonly string[]; needsGrant: boolean }[] = []
    const settled: string[] = []
    const queue: AgentQueue = {
      request: ask => { asked.push(ask); return { id: String(asked.length), decision: Promise.resolve(ask.kind === 'read' ? 'run' : 'skip') } },
      settle: (id, state) => { settled.push(`${id} ${state}`) },
    }
    const { router } = scripted([
      () => block(READ_FENCE_LANG, `read ${h.revision} src/documentation/notes.md`),
      () => block(WRITE_FENCE_LANG, `version ${h.revision} src/documentation/notes.md`, 'replaced'),
      sent => {
        expect(sent.at(-1)!.content).toContain('skipped your hypercomb-write block')
        return 'Understood, nothing was changed.'
      },
    ])
    const result = await runAgentTurn({ request: 'rewrite notes' }, { router, reader: h.reader, versions: h.versions, queue, readsFreely: () => false })
    expect(asked.map(a => [a.kind, a.needsGrant])).toEqual([['read', true], ['additive', false]])
    expect(settled).toEqual(['1 ran'])
    expect(h.staged).toEqual([])
    expect(result.drafts).toEqual([])
  })

  it('turns back a block it cannot run in the gate\'s own words, and stops after three in a row', async () => {
    const h = held()
    const bad = () => block(WRITE_FENCE_LANG, `${'a'.repeat(64)} src/x.ts`, 'body')
    const { router, calls } = scripted([bad, bad, bad])
    const result = await runAgentTurn({ request: 'write a module' }, { router, reader: h.reader, versions: h.versions, readsFreely: () => true })
    expect(calls[1]!.messages.at(-1)!.content).toContain('only the build\'s own source is written here')
    expect(result.stopped).toContain('only the build\'s own source is written here')
    expect(result.answer).toContain('turned back 3 blocks in a row')
  })

  it('streams the prose and never the block', async () => {
    const h = held()
    const { router } = scripted([
      () => `Reading.${block(READ_FENCE_LANG, `read ${h.revision}`)}`,
      () => 'All read.',
    ])
    const shown: string[] = []
    const loop = agentTurn({ request: 'look' }, { router, reader: h.reader, versions: h.versions, readsFreely: () => true })
    let step = await loop.next()
    while (!step.done) { shown.push(step.value); step = await loop.next() }
    expect(shown.join('')).not.toContain('```')
    expect(shown.join('').replace(/\s+/g, ' ')).toBe('Reading. All read.')
    expect(step.value.answer).toBe('Reading.\n\nAll read.')
  })
})
