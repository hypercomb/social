// version-drafts.spec.ts — authoring the minimal build from the browser: a
// draft over a revision this browser holds, the author's signed ask, and the
// draft sent to a host under the key's grant.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { BUILDS_MEANING, SIGNATURES_MEANING, type PoolIo } from './version-pools.js'
import { ASK_KIND, askBuild, askPreimage, draftClosure, listDrafts, readRevisionFile, stageDraft } from './version-drafts.js'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))

const memory = (): PoolIo & { pools: Map<string, Map<string, Uint8Array>> } => {
  const pools = new Map<string, Map<string, Uint8Array>>()
  const pool = (meaning: string) => pools.get(meaning) ?? pools.set(meaning, new Map()).get(meaning)!
  return {
    pools,
    names: async meaning => [...pool(meaning).keys()],
    read: async (meaning, name) => pool(meaning).get(name) ?? null,
    write: async (meaning, name, bytes) => { pool(meaning).set(name, bytes) },
  }
}

/** A host revision with a workspace of two files, held in `io`. */
const held = async (io: PoolIo) => {
  const put = async (bytes: Uint8Array) => { const sig = sha(bytes); await io.write(BUILDS_MEANING, sig, bytes); return sig }
  const a = await put(enc('export const a = 1\n')), b = await put(enc('# notes\n'))
  const workspace = await put(enc({ name: 'workspace', files: { 'src/a.ts': a, 'docs/b.md': b } }))
  return put(enc({ name: 'build', label: 'host', version: '2026.10.2.1', parent: null, workspace }))
}

const signer = () => {
  const key = generateSecretKey()
  return { key, pubkey: getPublicKey(key), signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, key) as unknown as Record<string, unknown> }
}

describe('a draft from the browser', () => {
  it('reads a revision\'s files, stages a draft over it, and names exactly what it brings', async () => {
    const io = memory()
    const base = await held(io)
    expect(await readRevisionFile(base, 'src/a.ts', io)).toBe('export const a = 1\n')

    const draft = await stageDraft({ base, files: { 'src/a.ts': 'export const a = 2\n', 'docs/b.md': null, 'src/new.ts': 'export {}\n' } }, io, new Date('2026-10-02T10:00:00Z'))
    const record = JSON.parse(new TextDecoder().decode((await io.read(BUILDS_MEANING, draft))!))
    expect(record).toMatchObject({ name: 'draft', label: 'hypercomb-essentials', base, at: '2026-10-02T10:00:00.000Z' })
    const layer = JSON.parse(new TextDecoder().decode((await io.read(BUILDS_MEANING, record.files))!))
    expect(layer).toEqual({ name: 'draft-files', files: { 'docs/b.md': null, 'src/a.ts': sha('export const a = 2\n'), 'src/new.ts': sha('export {}\n') } })
    expect((await draftClosure(draft, io)).sort()).toEqual([draft, record.files, sha('export const a = 2\n'), sha('export {}\n')].sort())
    expect(await listDrafts(io)).toEqual([{ sig: draft, label: 'hypercomb-essentials', base, at: '2026-10-02T10:00:00.000Z', paths: ['docs/b.md', 'src/a.ts', 'src/new.ts'] }])
  })

  it('refuses a path outside the tree, and deleting what the base does not carry', async () => {
    const io = memory()
    const base = await held(io)
    await expect(stageDraft({ base, files: { '../etc/passwd': 'x' } }, io)).rejects.toThrow(/not a path inside the tree/)
    await expect(stageDraft({ base, files: { 'src/gone.ts': null } }, io)).rejects.toThrow(/does not carry it/)
    await expect(stageDraft({ base, files: {} }, io)).rejects.toThrow(/at least one file/)
  })

  it('signs the ask and sends the draft and the ask under the key\'s grant, each by its own signature', async () => {
    const io = memory()
    const base = await held(io)
    const draft = await stageDraft({ base, files: { 'src/a.ts': 'export const a = 2\n' } }, io)
    const author = signer()
    const puts: Array<{ url: string; auth: string; body: Uint8Array }> = []
    const put = async (url: string, init: RequestInit) => {
      const body = init.body as unknown as Uint8Array
      puts.push({ url, auth: String((init.headers as Record<string, string>)['Authorization']), body })
      return new Response('', { status: url.endsWith(sha('export const a = 2\n')) ? 200 : 201 })
    }
    const outcome = await askBuild(draft, 'localhost:4291', { io, sign: author, put })
    expect(outcome).toMatchObject({ ok: true, draft, sent: 3, held: 1 })
    if (!outcome.ok) return
    // Every PUT names its bytes, and is signed for its own URL (NIP-98).
    for (const { url, auth, body } of puts) {
      expect(url).toBe(`http://localhost:4291/${sha(body)}`)
      const event = JSON.parse(Buffer.from(auth.replace(/^Nostr /, ''), 'base64').toString('utf8'))
      expect(event.kind).toBe(27235)
      expect(event.tags).toContainEqual(['u', url])
    }
    // The ask: the author's signed word for one draft, kept here too.
    const ask = JSON.parse(new TextDecoder().decode((await io.read(SIGNATURES_MEANING, outcome.ask))!))
    expect(verifyEvent(ask)).toBe(true)
    expect(ask).toMatchObject({ kind: ASK_KIND, pubkey: author.pubkey, content: askPreimage(draft) })
    expect(ask.tags).toEqual(expect.arrayContaining([['d', draft], ['h', 'http://localhost:4291'], ['count', '3']]))
  })

  it('stops at a host that refuses the key, and says so', async () => {
    const io = memory()
    const draft = await stageDraft({ base: await held(io), files: { 'src/a.ts': 'x' } }, io)
    const put = async () => new Response('hosting quota used up', { status: 403 })
    expect(await askBuild(draft, 'host.example', { io, sign: signer(), put })).toEqual({ ok: false, error: 'host.example refused this key: hosting quota used up', sent: 0 })
    expect(await askBuild(draft, 'host.example', { io, sign: undefined, put })).toEqual({ ok: false, error: 'no signer here: the ask is signed by the author' })
  })
})
