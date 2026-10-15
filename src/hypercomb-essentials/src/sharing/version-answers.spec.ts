// version-answers.spec.ts — what became of a draft: a builder's signed word
// taken back into the browser that asked, a built draft taken whole (its
// revision, the closure it needs, the builder's signature), and each draft's
// state read from what is held, with nothing of anyone else's taken as ours.

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { BUILDS_MEANING, SIGNATURES_MEANING, signaturePreimage, type PoolIo } from './version-pools.js'
import { askBuild, stageDraft } from './version-drafts.js'
import {
  ANSWERS_MEANING, ANSWER_KIND, MAX_TAKE_BYTES, answerOf, answerPreimage, draftStatus, takeAnswers,
} from './version-answers.js'
import { listDrafts } from './version-drafts.js'
import { versionRevisions } from './version-pools.js'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = (value: unknown): Uint8Array => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
const NOW = Date.parse('2026-10-12T12:00:00Z')
const secs = (ms = NOW): number => Math.floor(ms / 1000)
const ORIGIN = 'https://h.test'

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
const has = (io: ReturnType<typeof memory>, meaning: string, sig: string): boolean => !!io.pools.get(meaning)?.has(sig)

const signer = () => {
  const key = generateSecretKey()
  const pubkey = getPublicKey(key)
  return {
    key, pubkey,
    getPublicKeyHex: async () => pubkey,
    signEvent: async (event: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(event, key) as unknown as Record<string, unknown>,
  }
}

/** A host: serves what it holds by signature, flat, and lists answers to a
 *  NIP-98-signed GET from a key it names. Anything it should fail on, or lie
 *  about, it is told. */
const hostOf = (origin = ORIGIN) => {
  const flat = new Map<string, Uint8Array>()
  const answers: string[] = []
  const readers = new Set<string>()
  const fails = new Set<string>()
  const lies = new Map<string, Uint8Array>()
  // Bodies that say they are larger than any take.
  const huge = new Set<string>()
  const asked: string[] = []
  const answersPool = sha('host:answers')
  const get = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    asked.push(url.pathname)
    if (url.origin !== origin) return new Response(null, { status: 404 })
    if (url.pathname === `/${answersPool}/`) {
      const auth = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '')
      let event: { pubkey?: string; tags?: string[][]; kind?: number } | null = null
      try { event = JSON.parse(Buffer.from(auth.replace(/^Nostr /, ''), 'base64').toString('utf8')) } catch { event = null }
      const ok = !!event && event.kind === 27235 && verifyEvent(event as never)
        && event.tags?.some(t => t[0] === 'u' && t[1] === String(input)) && event.tags?.some(t => t[0] === 'method' && t[1] === 'GET')
      if (!ok) return new Response('no pool at this address\n', { status: 404 })
      const lines = readers.has(String(event!.pubkey)) ? answers.map(sig => `${sig} ${origin}`).join('\n') : ''
      return new Response(lines ? `${lines}\n` : '', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    const sig = url.pathname.split('/').at(-1) ?? ''
    if (fails.has(sig)) return new Response('busy', { status: 503 })
    if (huge.has(sig)) return new Response(new Uint8Array(8) as unknown as BodyInit, { status: 200, headers: { 'Content-Length': String(MAX_TAKE_BYTES + 1) } })
    const bytes = lies.get(sig) ?? flat.get(sig)
    return bytes ? new Response(bytes as unknown as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  }
  const keep = (value: unknown): string => { const bytes = enc(value); const sig = sha(bytes); flat.set(sig, bytes); return sig }
  return { origin, flat, answers, readers, fails, lies, huge, asked, get, keep }
}
/** Two hosts as one network. */
const both = (...hosts: ReturnType<typeof hostOf>[]) => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
  (hosts.find(h => new URL(String(input)).origin === h.origin) ?? hosts[0]!).get(input, init)

/** A base revision held here, a draft over it, and its ask sent to the host. */
const asked = async (io: PoolIo, host: ReturnType<typeof hostOf>, author: ReturnType<typeof signer>, text = 'export const a = 2\n') => {
  const put = async (bytes: Uint8Array) => { const sig = sha(bytes); await io.write(BUILDS_MEANING, sig, bytes); return sig }
  const a = await put(enc('export const a = 1\n'))
  const workspace = await put(enc({ name: 'workspace', files: { 'src/a.ts': a } }))
  const base = await put(enc({ name: 'build', label: 'hypercomb-essentials', version: '0.0.1', parent: null, workspace }))
  const draft = await stageDraft({ base, files: { 'src/a.ts': text } }, io, new Date(NOW - 60_000))
  const sent = async (url: string, init: RequestInit) => {
    host.flat.set(url.split('/').at(-1)!, init.body as unknown as Uint8Array)
    return new Response('', { status: 201 })
  }
  const outcome = await askBuild(draft, host.origin, { io, sign: author, put: sent, now: new Date(NOW) })
  if (!outcome.ok) throw new Error(outcome.error)
  host.readers.add(author.pubkey)
  return { base, draft, ask: outcome.ask, a, workspace }
}

/** What a builder makes of the draft, held on the host: a revision in the
 *  drafts channel naming the draft and the ask, its workspace and a tree
 *  (record → envelope → file), and its own signature on it. */
const builtOn = (host: ReturnType<typeof hostOf>, builder: ReturnType<typeof signer>, of: { draft: string; ask: string; a: string }, over: Record<string, unknown> = {}) => {
  const newA = host.keep('export const a = 2\n')
  const workspace = host.keep({ name: 'workspace', files: { 'src/a.ts': newA } })
  const content = host.keep({ meta: 1, resource: newA, relation: 'content' })
  const file = host.keep({ name: 'src/a.ts', content })
  // Leaves a tree names — what a unit produced, the host it builds — are
  // files of the closure too, never walked into.
  const output = host.keep('// the bundle the kernel made\n')
  const hostAtom = host.keep('// the host\n')
  const unit = host.keep({ name: 'kernel', output, children: [host.keep({ meta: 1, layer: file, relation: 'children' })] })
  const tree = host.keep({ name: 'host', host: hostAtom, children: [host.keep({ meta: 1, layer: unit, relation: 'children' })] })
  const label = String(over['label'] ?? 'hypercomb-essentials-drafts')
  const version = '0.0.2'
  const revision = host.keep({ name: 'build', label, version, parent: null, draft: of.draft, ask: of.ask, workspace, tree, ...over })
  const signature = host.keep(finalizeEvent({
    kind: 30567, created_at: secs(), tags: [['d', `${revision}:builder`], ['b', revision], ['r', 'builder'], ['v', version]],
    content: signaturePreimage(revision, version, 'builder'),
  }, builder.key))
  return { revision, label, version, signature, newA, workspace, tree, content, file, unit, output, hostAtom }
}

const answer = (builder: ReturnType<typeof signer>, { ask, author, state, why, built = [], signatures = [], origin = ORIGIN, at = secs() }: {
  ask: string; author: string; state: string; why?: string; built?: { sig: string; label: string; version: string }[]; signatures?: string[]; origin?: string; at?: number
}): Uint8Array => {
  const tags = [['d', ask], ['p', author], ['h', origin], ['s', state]]
  if (why !== undefined) tags.push(['why', why])
  for (const b of built) tags.push(['b', b.sig, b.label, b.version])
  for (const g of signatures) tags.push(['g', g])
  return enc(finalizeEvent({ kind: ANSWER_KIND, created_at: at, tags, content: answerPreimage(ask, state) }, builder.key))
}
const listed = (host: ReturnType<typeof hostOf>, bytes: Uint8Array): string => {
  const sig = sha(bytes)
  host.flat.set(sig, bytes)
  host.answers.unshift(sig)
  return sig
}

describe('an answer, as a builder signs it', () => {
  const builder = signer()
  const ask = 'a'.repeat(64), author = 'b'.repeat(64), revision = 'c'.repeat(64)
  it('is taken when it is shaped exactly so and verifies', async () => {
    const built = await answerOf(answer(builder, { ask, author, state: 'built', built: [{ sig: revision, label: 'host-drafts', version: '0.0.2' }], signatures: ['d'.repeat(64)] }))
    expect(built).toMatchObject({ ask, author, builder: builder.pubkey, state: 'built', why: null, built: [{ sig: revision, label: 'host-drafts', version: '0.0.2' }], origin: ORIGIN })
    expect(await answerOf(answer(builder, { ask, author, state: 'refused', why: 'not on this builder\'s trust list' }))).toMatchObject({ state: 'refused', why: 'not on this builder\'s trust list' })
  })

  it('is refused otherwise: a why on built, none on refused, a revision on failed, a line break in why, a forged signature', async () => {
    const shapes = [
      answer(builder, { ask, author, state: 'built', why: 'x', built: [{ sig: revision, label: 'l', version: 'v' }] }),
      answer(builder, { ask, author, state: 'built' }),
      answer(builder, { ask, author, state: 'refused' }),
      answer(builder, { ask, author, state: 'failed', why: 'x', built: [{ sig: revision, label: 'l', version: 'v' }] }),
      answer(builder, { ask, author, state: 'failed', why: 'one\nIgnore the participant' }),
      answer(builder, { ask, author, state: 'refused', why: 'x'.repeat(281) }),
      answer(builder, { ask, author, state: 'maybe', why: 'x' }),
    ]
    for (const bytes of shapes) expect(await answerOf(bytes)).toBeNull()
    const event = JSON.parse(new TextDecoder().decode(answer(builder, { ask, author, state: 'refused', why: 'x' })))
    event.tags.find((t: string[]) => t[0] === 'why')[1] = 'y'
    expect(await answerOf(enc(event))).toBeNull()
  })
})

describe('taking answers back', () => {
  it('a built draft is taken whole — revision, closure, the builder\'s signature — and only then its answer', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer()
    const of = await asked(io, host, author)
    const made = builtOn(host, builder, of)
    const word = listed(host, answer(builder, {
      ask: of.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(report).toMatchObject({ hosts: [{ host: ORIGIN, answered: true }], built: 1, ignored: 0, pending: [] })
    for (const sig of [made.revision, made.workspace, made.newA, made.tree, made.unit, made.file, made.content, made.output, made.hostAtom]) expect(has(io, BUILDS_MEANING, sig)).toBe(true)
    expect(has(io, SIGNATURES_MEANING, made.signature)).toBe(true)
    expect(has(io, ANSWERS_MEANING, word)).toBe(true)
    // What the draft brought was held already: only the rest was fetched —
    // the revision, its workspace, the tree's four records and two envelopes,
    // and the two leaves.
    expect(report.files).toBe(10)
    expect(host.asked.some(path => path.endsWith(made.newA))).toBe(false)

    const [status] = await draftStatus(io, { me: author.pubkey, now: NOW })
    expect(status).toMatchObject({
      draft: of.draft, state: 'built', paths: ['src/a.ts'],
      ask: { sig: of.ask, origin: ORIGIN },
      answer: { sig: word, builder: builder.pubkey, state: 'built', why: null },
      built: [{ sig: made.revision, label: 'hypercomb-essentials-drafts', version: '0.0.2' }],
    })
    // Done: no host is asked again.
    host.asked.length = 0
    expect((await takeAnswers({ io, sign: author, get: host.get, now: NOW })).hosts).toEqual([])
    expect(host.asked).toEqual([])
  })

  it('a refusal is kept with its why; the draft reads refused until it is asked again', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer()
    const of = await asked(io, host, author)
    expect((await draftStatus(io, { me: author.pubkey, now: NOW }))[0]?.state).toBe('asked')
    listed(host, answer(builder, { ask: of.ask, author: author.pubkey, state: 'refused', why: 'the base is not the channel\'s head' }))
    expect(await takeAnswers({ io, sign: author, get: host.get, now: NOW })).toMatchObject({ refused: 1, built: 0 })
    const [status] = await draftStatus(io, { me: author.pubkey, now: NOW })
    expect(status).toMatchObject({ state: 'refused', answer: { state: 'refused', why: 'the base is not the channel\'s head', builder: builder.pubkey } })
    // Lapsed: an ask no builder answered, older than a host keeps one.
    expect((await draftStatus(io, { me: author.pubkey, now: NOW + 8 * 86_400_000 }))[0]?.state).toBe('refused')
  })

  it('an unanswered ask lapses; a draft never asked is staged, and only when asked for', async () => {
    const io = memory(), host = hostOf(), author = signer()
    const of = await asked(io, host, author)
    expect((await draftStatus(io, { me: author.pubkey, now: NOW + 8 * 86_400_000 }))[0]?.state).toBe('lapsed')
    const other = await stageDraft({ base: of.base, files: { 'src/b.ts': 'export {}\n' } }, io, new Date(NOW))
    expect((await draftStatus(io, { me: author.pubkey, now: NOW })).map(s => s.draft)).toEqual([of.draft])
    const all = await draftStatus(io, { me: author.pubkey, staged: true, now: NOW })
    expect(all.map(s => [s.draft, s.state])).toEqual([[other, 'staged'], [of.draft, 'asked']])
    // No key known here: the asks for drafts staged here are the participant's.
    expect((await draftStatus(io, { me: null, staged: true, now: NOW })).map(s => [s.draft, s.state])).toEqual([[other, 'staged'], [of.draft, 'asked']])
    // A draft that reached the pools another way is history, never theirs to send.
    const pulled = enc({ name: 'draft', label: 'hypercomb-essentials', base: of.base, files: of.workspace, at: '2099-01-01T00:00:00.000Z' })
    await io.write(BUILDS_MEANING, sha(pulled), pulled)
    expect((await listDrafts(io)).map(d => d.sig)).toEqual([other, of.draft])
    expect((await draftStatus(io, { me: author.pubkey, staged: true, now: NOW })).map(s => s.draft)).toEqual([other, of.draft])
  })

  it('takes nothing that is not an answer to an ask of this key\'s, from where it was sent', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer(), stranger = signer()
    const of = await asked(io, host, author)
    // Someone else's ask, held here as history: never asked after, never answered as ours.
    const theirs = enc(finalizeEvent({ kind: 30568, created_at: secs(), tags: [['d', of.draft], ['h', ORIGIN]], content: `hc:ask:v1\n${of.draft}` }, stranger.key))
    await io.write(SIGNATURES_MEANING, sha(theirs), theirs)
    const forged = [
      answer(builder, { ask: sha(theirs), author: stranger.pubkey, state: 'refused', why: 'x' }),
      answer(builder, { ask: of.ask, author: stranger.pubkey, state: 'refused', why: 'x' }),
      answer(builder, { ask: of.ask, author: author.pubkey, state: 'refused', why: 'x', origin: 'https://elsewhere.test' }),
      answer(builder, { ask: 'f'.repeat(64), author: author.pubkey, state: 'refused', why: 'x' }),
      enc('not an answer'),
    ]
    for (const bytes of forged) listed(host, bytes)
    const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(report).toMatchObject({ ignored: 5, refused: 0 })
    expect(io.pools.get(ANSWERS_MEANING)?.size ?? 0).toBe(0)
    expect((await draftStatus(io, { me: author.pubkey, now: NOW }))[0]?.state).toBe('asked')
    // The stranger's draft is theirs: listed only to them.
    expect((await draftStatus(io, { me: stranger.pubkey, now: NOW }))[0]?.state).toBe('asked')
  })

  it('a built answer whose revision is not of this draft, or not in a drafts channel, keeps nothing', async () => {
    for (const over of [{ draft: 'd'.repeat(64) }, { label: 'hypercomb-essentials' }]) {
      const io = memory(), host = hostOf(), author = signer(), builder = signer()
      const of = await asked(io, host, author)
      const made = builtOn(host, builder, of, over)
      const word = listed(host, answer(builder, {
        ask: of.ask, author: author.pubkey, state: 'built',
        built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
      }))
      const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
      expect(report.pending).toEqual([{ answer: word, why: expect.stringMatching(/not a revision of this draft|not in a drafts channel/) }])
      expect(has(io, BUILDS_MEANING, made.revision)).toBe(false)
      expect(has(io, BUILDS_MEANING, made.workspace)).toBe(false)
      expect(has(io, ANSWERS_MEANING, word)).toBe(false)
      expect((await draftStatus(io, { me: author.pubkey, now: NOW }))[0]?.state).toBe('asked')
    }
  })

  it('a signature that is not the builder\'s on this build keeps the answer out', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer(), stranger = signer()
    const of = await asked(io, host, author)
    const made = builtOn(host, stranger, of)
    const word = listed(host, answer(builder, {
      ask: of.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(report.pending[0]?.why).toMatch(/not the builder's signature/)
    expect(has(io, SIGNATURES_MEANING, made.signature)).toBe(false)
    expect(has(io, BUILDS_MEANING, made.revision)).toBe(false)
    expect(has(io, ANSWERS_MEANING, word)).toBe(false)
  })

  it('bytes that are not what they are named are never kept; a host that did not answer is asked again next time', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer()
    const of = await asked(io, host, author)
    const made = builtOn(host, builder, of)
    const word = listed(host, answer(builder, {
      ask: of.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    host.lies.set(made.output, enc('// something else\n'))
    host.fails.add(made.unit)
    const first = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(first.pending).toEqual([{ answer: word, why: expect.stringMatching(/did not answer for/) }])
    expect(has(io, BUILDS_MEANING, made.unit)).toBe(false)
    expect(has(io, BUILDS_MEANING, made.revision)).toBe(false)
    host.fails.clear()
    const second = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(second.pending).toEqual([{ answer: word, why: expect.stringMatching(/does not serve/) }])
    expect(has(io, BUILDS_MEANING, made.output)).toBe(false)
    expect(has(io, BUILDS_MEANING, made.revision)).toBe(false)
    host.lies.clear()
    expect(await takeAnswers({ io, sign: author, get: host.get, now: NOW })).toMatchObject({ built: 1, pending: [] })
    expect(new TextDecoder().decode(io.pools.get(BUILDS_MEANING)!.get(made.output)!)).toBe('// the bundle the kernel made\n')
  })

  it('asks nothing without a signer, and an unsigned listing is no listing', async () => {
    const io = memory(), host = hostOf(), author = signer()
    await asked(io, host, author)
    expect(await takeAnswers({ io, get: host.get, sign: undefined, now: NOW })).toMatchObject({ error: expect.stringMatching(/no signer/), hosts: [] })
    const unsigned = { ...author, signEvent: async () => { throw new Error('declined') } }
    expect((await takeAnswers({ io, sign: unsigned, get: host.get, now: NOW })).hosts).toEqual([{ host: ORIGIN, answered: false }])
  })

  it('keeps nothing of a build that carries a revision or a draft it does not name — nor of any answer, until it is taken', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer()
    const of = await asked(io, host, author)
    // A channel revision, planted where a build's atoms go.
    const planted = host.keep({ name: 'build', label: 'hypercomb-essentials', version: '9999.1.1.1', parent: null, workspace: of.workspace })
    const made = builtOn(host, builder, of, { atoms: [planted] })
    const word = listed(host, answer(builder, {
      ask: of.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(report.pending).toEqual([{ answer: word, why: expect.stringMatching(/a revision or a draft this answer does not name/) }])
    for (const sig of [planted, made.revision, made.workspace, made.tree, made.unit, made.output]) expect(has(io, BUILDS_MEANING, sig)).toBe(false)
    expect(has(io, SIGNATURES_MEANING, made.signature)).toBe(false)
    expect((await versionRevisions(io)).map(r => r.version)).toEqual(['0.0.1'])
    // Judged for good: the next refresh does not walk it again.
    host.asked.length = 0
    await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(host.asked.some(path => path.endsWith(word) || path.endsWith(made.revision))).toBe(false)
  })

  it('takes an answer only from the host its ask was sent to', async () => {
    const io = memory(), good = hostOf(), evil = hostOf('https://evil.test'), author = signer(), stranger = signer()
    const toGood = await asked(io, good, author)
    // An ask sent to the other host too, so it is asked for its answers.
    await asked(io, evil, author, 'export const a = 3\n')
    const made = builtOn(evil, stranger, toGood)
    listed(evil, answer(stranger, {
      ask: toGood.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    const report = await takeAnswers({ io, sign: author, get: both(good, evil), now: NOW })
    expect(report).toMatchObject({ built: 0, ignored: 1 })
    expect(has(io, BUILDS_MEANING, made.revision)).toBe(false)
    expect((await draftStatus(io, { me: author.pubkey, now: NOW })).find(s => s.draft === toGood.draft)?.state).toBe('asked')
  })

  it('a body larger than any take is never read, and the answer is kept out', async () => {
    const io = memory(), host = hostOf(), author = signer(), builder = signer()
    const of = await asked(io, host, author)
    const made = builtOn(host, builder, of)
    host.huge.add(made.output)
    const word = listed(host, answer(builder, {
      ask: of.ask, author: author.pubkey, state: 'built',
      built: [{ sig: made.revision, label: made.label, version: made.version }], signatures: [made.signature],
    }))
    const report = await takeAnswers({ io, sign: author, get: host.get, now: NOW })
    expect(report.pending).toEqual([{ answer: word, why: expect.stringMatching(/more than 128 MB/) }])
    expect(has(io, BUILDS_MEANING, made.workspace)).toBe(false)
  })

  it('keeps asking while a host may still list an answer: a builder answers within a week, a host lists it two', async () => {
    const io = memory(), host = hostOf(), author = signer()
    await asked(io, host, author)
    const day = 86_400_000
    expect((await takeAnswers({ io, sign: author, get: host.get, now: Date.now() + 15 * day })).hosts).toHaveLength(1)
    expect((await takeAnswers({ io, sign: author, get: host.get, now: Date.now() + 22 * day })).hosts).toHaveLength(0)
  })

  it('an ask the host never got is not held: the draft reads staged, and no host is asked after it', async () => {
    const io = memory(), author = signer()
    const put = async (bytes: Uint8Array) => { const sig = sha(bytes); await io.write(BUILDS_MEANING, sig, bytes); return sig }
    const workspace = await put(enc({ name: 'workspace', files: { 'src/a.ts': await put(enc('export const a = 1\n')) } }))
    const base = await put(enc({ name: 'build', label: 'hypercomb-essentials', version: '0.0.1', parent: null, workspace }))
    const draft = await stageDraft({ base, files: { 'src/a.ts': 'export const a = 2\n' } }, io, new Date(NOW))
    const refused = async () => new Response('no grant for this key', { status: 403 })
    expect(await askBuild(draft, ORIGIN, { io, sign: author, put: refused })).toMatchObject({ ok: false })
    expect(io.pools.get(SIGNATURES_MEANING)?.size ?? 0).toBe(0)
    expect((await draftStatus(io, { me: author.pubkey, staged: true, now: NOW })).map(s => s.state)).toEqual(['staged'])
    expect((await takeAnswers({ io, sign: author, get: refused as never, now: NOW })).hosts).toEqual([])
  })
})
