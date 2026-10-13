// @vitest-environment node
//
// The builder takes an ask only when everything it names is what it says:
// the ask a verifying event for one draft, the draft and every file hashing
// to their names, every path inside the tree. Then it keeps them, so the
// revision it builds carries its provenance.

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = (value: unknown): Buffer => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hc-builder-spec-'))
  vi.stubEnv('HYPERCOMB_POOLS_DIR', resolve(root, 'pools'))
  vi.resetModules()
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) })

/** A host holding a draft and its ask, flat by signature. */
/** When the specs' asks are taken: a minute after they were signed. */
const NOW = new Date(1_790_000_060_000)

const hosting = ({ kind = 30568, path = 'src/a.ts', h = 'http://h.test', at = 1_790_000_000 } = {}) => {
  const key = generateSecretKey()
  const file = enc('export const a = 2\n')
  const layer = enc({ name: 'draft-files', files: { [path]: sha(file), 'docs/old.md': null } })
  const draft = enc({ name: 'draft', label: 'hypercomb-essentials', base: 'b'.repeat(64), files: sha(layer), at: '2026-10-02T10:00:00.000Z' })
  const ask = enc(finalizeEvent({ kind, created_at: at, content: `hc:ask:v1\n${sha(draft)}`, tags: [['d', sha(draft)], ['h', h]] }, key))
  const served = new Map([[sha(file), file], [sha(layer), layer], [sha(draft), draft], [sha(ask), ask]])
  const get = (async (url: string) => {
    const sig = url.split('/').pop()!
    const bytes = served.get(sig)
    if (!bytes || url.includes('/content/')) return new Response('', { status: 404 })
    return new Response(bytes)
  }) as unknown as typeof fetch
  return { get, ask: sha(ask), draft: sha(draft), layer: sha(layer), file: sha(file), author: getPublicKey(key) }
}

describe('the builder takes an ask', () => {
  it('verifies the ask, the draft and every file, and keeps them for the revision\'s provenance', async () => {
    const { takeAsk } = await import('./builder.mjs')
    const { poolDir } = await import('./builds.mjs')
    const h = hosting()
    const taken = await takeAsk('http://h.test', h.ask, { get: h.get, now: NOW })
    expect(taken.author).toBe(h.author)
    expect(taken.draft).toBe(h.draft)
    expect([...taken.files.keys()].sort()).toEqual(['docs/old.md', 'src/a.ts'])
    expect(taken.files.get('docs/old.md')).toBeNull()
    expect(taken.files.get('src/a.ts')!.toString()).toBe('export const a = 2\n')
    for (const sig of [h.draft, h.layer, h.file]) expect(sha(await readFile(resolve(poolDir('host:builds'), sig)))).toBe(sig)
    expect(sha(await readFile(resolve(poolDir('host:build-signatures'), h.ask)))).toBe(h.ask)
  })

  it('refuses bytes that are not what they are named, an event that is not an ask, and a path out of the tree', async () => {
    const { takeAsk } = await import('./builder.mjs')
    // A file whose bytes are not what the layer names.
    const h = hosting()
    const tamper = (async (url: string) => url.endsWith(h.file) ? new Response('something else') : h.get(url)) as unknown as typeof fetch
    await expect(takeAsk('http://h.test', h.ask, { get: tamper, now: NOW })).rejects.toThrow(/not what it is named/)
    const wrongKind = hosting({ kind: 30567 })
    await expect(takeAsk('http://h.test', wrongKind.ask, { get: wrongKind.get, now: NOW })).rejects.toThrow(/does not verify/)
    const escaping = hosting({ path: '../outside.ts' })
    await expect(takeAsk('http://h.test', escaping.ask, { get: escaping.get, now: NOW })).rejects.toThrow(/not a path inside the tree/)
    await expect(takeAsk('http://h.test', 'nope', { get: h.get, now: NOW })).rejects.toThrow(/named by its signature/)
  })

  it('refuses an ask sent to another host, an old one, and a path into .git, node_modules or out of plain text', async () => {
    const { takeAsk } = await import('./builder.mjs')
    const elsewhere = hosting({ h: 'https://other.example' })
    await expect(takeAsk('http://h.test', elsewhere.ask, { get: elsewhere.get, now: NOW })).rejects.toThrow(/sent to https:\/\/other.example, not http:\/\/h.test/)
    const old = hosting({ at: 1_790_000_000 - 8 * 86_400 })
    await expect(takeAsk('http://h.test', old.ask, { get: old.get, now: NOW })).rejects.toThrow(/older than 7 days/)
    for (const path of ['.git/hooks/post-checkout', 'src/node_modules/x/index.js', 'src\\a.ts', 'C:/a.ts']) {
      const bad = hosting({ path })
      await expect(takeAsk('http://h.test', bad.ask, { get: bad.get, now: NOW })).rejects.toThrow(/\.git or node_modules|not a plain path/)
    }
  })
})

describe('a draft\'s build', () => {
  it('is never handed the builder\'s key or any other secret in the environment', async () => {
    const { buildEnv } = await import('./builder.mjs')
    const env = buildEnv('/work', {
      PATH: '/usr/bin', HOME: '/home/b', HYPERCOMB_POOLS_DIR: '/pools',
      HYPERCOMB_SIGNER_KEY: 'a'.repeat(64), HYPERCOMB_SIGNER_KEY_FILE: '/secret/key', AWS_SECRET_ACCESS_KEY: 'x', GITHUB_TOKEN: 'y',
    })
    expect(env).toEqual({
      PATH: '/usr/bin', HOME: '/home/b', HYPERCOMB_POOLS_DIR: '/pools',
      HYPERCOMB_HOST_OUT_DIR: resolve('/work', 'out'), HYPERCOMB_WEB_CONTENT_DIR: resolve('/work', 'web-content'), HYPERCOMB_RELAY_CONTENT_DIR: resolve('/work', 'relay-content'),
    })
  })
})

describe('a builder lists the asks a host holds for it', () => {
  /** A host that lists its asks only to `builder`'s signed request (NIP-98),
   *  as hypercomb-relay/build-asks.js has a host do. */
  const listing = async (h: ReturnType<typeof hosting>, builder: Uint8Array, names: string[], sentTo = 'http://h.test') => {
    const { verifyEvent } = await import('nostr-tools/pure')
    const pool = sha('host:asks')
    return (async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/${pool}/`)) {
        const header = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
        let event: { kind?: number; pubkey?: string; tags?: string[][] } | null = null
        try { event = JSON.parse(Buffer.from(header.replace(/^Nostr /, ''), 'base64').toString('utf8')) } catch { event = null }
        const signed = !!event && event.kind === 27235 && verifyEvent(event as never) && event.pubkey === getPublicKey(builder)
          && event.tags?.some(t => t[0] === 'u' && t[1] === url) && event.tags?.some(t => t[0] === 'method' && t[1] === 'GET')
        return signed ? new Response(names.map(n => `${n} ${sentTo}\n`).join('')) : new Response('no pool at this address\n', { status: 404 })
      }
      return h.get(url)
    }) as unknown as typeof fetch
  }

  it('reads each listed ask under its key, and says which authors it trusts', async () => {
    const { listAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const asks = await listAsks('http://h.test', { get: await listing(h, builder, [h.ask, 'f'.repeat(64)]), key: builder, now: NOW })
    expect(asks[0]).toEqual({ ask: h.ask, origin: 'http://h.test', author: h.author, draft: h.draft, at: 1_790_000_000, trusted: true, built: false })
    expect(asks[1]).toMatchObject({ ask: 'f'.repeat(64), refused: expect.stringMatching(/does not serve/) })
  })

  it('says how to be named a builder when the host lists nothing to its key', async () => {
    const { listAsks } = await import('./builder.mjs')
    const h = hosting()
    const someoneElse = generateSecretKey()
    await expect(listAsks('http://h.test', { get: await listing(h, generateSecretKey(), [h.ask]), key: someoneElse, now: NOW }))
      .rejects.toThrow(/hosts builders add <your pubkey> @h.test/)
  })
})

describe('an ask sent to another face of the zone', () => {
  it('is read at the origin the listing names, where its h tag holds', async () => {
    const { listAsks } = await import('./builder.mjs')
    const builder = generateSecretKey()
    const h = hosting({ h: 'http://content.h.test' })
    const pool = sha('host:asks')
    const { verifyEvent } = await import('nostr-tools/pure')
    const get = (async (url: string, init?: RequestInit) => {
      if (url === `http://h.test/${pool}/`) {
        const header = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
        const event = JSON.parse(Buffer.from(header.replace(/^Nostr /, ''), 'base64').toString('utf8'))
        return verifyEvent(event) && event.pubkey === getPublicKey(builder) ? new Response(`${h.ask} http://content.h.test\n`) : new Response('', { status: 404 })
      }
      // The ask's bytes are served only where it was sent.
      return url.startsWith('http://content.h.test/') ? h.get(url) : new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const [ask] = await listAsks('http://h.test', { get, key: builder, now: NOW })
    expect(ask).toMatchObject({ ask: h.ask, origin: 'http://content.h.test', author: h.author })
    expect(ask.refused).toBeUndefined()
  })

  it('a page some face answers is never read as a listing', async () => {
    const { listAsks } = await import('./builder.mjs')
    const html = (async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
    await expect(listAsks('http://h.test', { get: html, key: generateSecretKey(), now: NOW })).rejects.toThrow(/not a listing of asks/)
    const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    await expect(listAsks('http://h.test', { get: down, key: generateSecretKey(), now: NOW })).rejects.toThrow(/did not answer/)
  })
})

describe('origins compare normalized, as a host compares them', () => {
  it('lowercases, drops a default port and a path, and keeps loopback on http', async () => {
    const { originOf } = await import('./builder.mjs')
    expect(originOf('Content.Example.org')).toBe('https://content.example.org')
    expect(originOf('https://content.example.org:443/x')).toBe('https://content.example.org')
    expect(originOf('localhost:4291')).toBe('http://localhost:4291')
    expect(originOf('try-x.localhost:4291')).toBe('http://try-x.localhost:4291')
  })
})

describe('a watching builder', () => {
  const ORIGIN = 'http://h.test'
  /** A host that lists `names` to `builder`'s signed request, serves every
   *  hosting's bytes, lists `pooled` in its version pools, and takes PUTs. */
  const host = async (builder: Uint8Array, hostings: ReturnType<typeof hosting>[], {
    pooled = [] as string[], refuse = (_sig: string) => false, failing = (_url: string) => false, answersListed = null as string[] | null,
  } = {}) => {
    const { verifyEvent } = await import('nostr-tools/pure')
    const asks = sha('host:asks')
    const puts: { sig: string; body: Buffer }[] = []
    const signedBy = (init: RequestInit | undefined, url: string, method: string) => {
      const header = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
      try {
        const event = JSON.parse(Buffer.from(header.replace(/^Nostr /, ''), 'base64').toString('utf8'))
        return event.kind === 27235 && verifyEvent(event) && event.pubkey === getPublicKey(builder)
          && event.tags.some((t: string[]) => t[0] === 'u' && t[1] === url) && event.tags.some((t: string[]) => t[0] === 'method' && t[1] === method)
      } catch { return false }
    }
    const get = (async (url: string, init?: RequestInit) => {
      if (failing(url)) return new Response('slow down', { status: 429 })
      if (url === `${ORIGIN}/${sha('host:answers')}/` && answersListed && signedBy(init, url, 'GET')) return new Response(answersListed.map(n => `${n} ${ORIGIN}\n`).join(''))
      if (url === `${ORIGIN}/${asks}/`) {
        return signedBy(init, url, 'GET') ? new Response(hostings.map(h => `${h.ask} ${ORIGIN}\n`).join('')) : new Response('', { status: 404 })
      }
      if (url === `${ORIGIN}/${sha('host:builds')}/`) return new Response(pooled.map(n => `${n}\n`).join(''))
      for (const h of hostings) {
        const response = await h.get(url)
        if (response.ok) return response
      }
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const send = (async (url: string, init?: RequestInit) => {
      const body = Buffer.from(init?.body as Uint8Array)
      const sig = url.split('/').pop()!
      if (init?.method !== 'PUT' || !signedBy(init, url, 'PUT') || sha(body) !== sig) return new Response('unauthorized', { status: 401 })
      if (refuse(sig)) return new Response('busy', { status: 503 })
      puts.push({ sig, body })
      return new Response(`stored ${sig}`, { status: 201 })
    }) as unknown as typeof fetch
    return { get, send, puts }
  }
  /** A promoted drafts revision, held in this builder's pool — signed in the
   *  role builder by `signer`, as promote signs it, when one is named. */
  const promoted = async (ask: string, label: string, version = '2026.10.12.1', signer?: Uint8Array) => {
    const { poolDir, signaturePreimage } = await import('./builds.mjs')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const bytes = enc({ name: 'build', label, version, ask, at: NOW.toISOString() })
    await mkdir(poolDir('host:builds'), { recursive: true })
    await writeFile(resolve(poolDir('host:builds'), sha(bytes)), bytes)
    let signature: string | undefined
    if (signer) {
      const event = enc(finalizeEvent({ kind: 30567, created_at: 1_790_000_000, content: signaturePreimage(sha(bytes), version, 'builder'),
        tags: [['d', `${sha(bytes)}:builder`], ['b', sha(bytes)], ['r', 'builder'], ['v', version]] }, signer))
      await mkdir(poolDir('host:build-signatures'), { recursive: true })
      await writeFile(resolve(poolDir('host:build-signatures'), sha(event)), event)
      signature = sha(event)
    }
    return { label, version, sig: sha(bytes), signature }
  }
  const answersIn = (puts: { body: Buffer }[]) => puts.map(p => { try { return JSON.parse(p.body.toString('utf8')) } catch { return null } })
    .filter(event => event?.kind === 30569)
  const tagOf = (event: { tags: string[][] }, name: string) => event.tags.find(t => t[0] === name)?.[1]

  it('builds a trusted author\'s ask, carries what the host does not list, then answers built — and holds a stranger\'s', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const { verifyEvent } = await import('nostr-tools/pure')
    const builder = generateSecretKey()
    const trusted = hosting()
    const stranger = hosting()
    await trustAuthor(trusted.author)
    // The stand-in build promotes as the real one does: into this builder's pool.
    const made: { label: string; version: string; sig: string }[] = []
    const build = vi.fn(async (origin: string, ask: string) => {
      expect([origin, ask]).toEqual([ORIGIN, trusted.ask])
      made.push(await promoted(ask, 'hypercomb-essentials-drafts', '2026.10.12.1', builder), await promoted(ask, 'host-drafts', '2026.10.12.1', builder))
      return { promoted: made.map(({ label, version, sig }) => ({ label, version, sig })) }
    })
    // The host lists the package already (its bytes are the stand-in's, made the same way).
    const pkgSig = sha(enc({ name: 'build', label: 'hypercomb-essentials-drafts', version: '2026.10.12.1', ask: trusted.ask, at: NOW.toISOString() }))
    const { get, send, puts } = await host(builder, [trusted, stranger], { pooled: [pkgSig] })
    const lines: string[] = []
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: l => { lines.push(l) }, carry: async () => [], build })
    expect(build).toHaveBeenCalledTimes(1)
    const [pkg, hostRevision] = made
    expect(pkg.sig).toBe(pkgSig)
    // The host already listed the package: only the host revision and the
    // builder's signatures were carried, before the answer.
    expect(puts.map(p => p.sig).slice(0, -1).sort()).toEqual([hostRevision.sig, pkg.signature!, hostRevision.signature!].sort())
    const [answer] = answersIn(puts)
    expect(puts.at(-1)!.sig).toBe(sha(JSON.stringify(answer)))
    expect(verifyEvent(answer)).toBe(true)
    expect(answer.pubkey).toBe(getPublicKey(builder))
    expect(answer.content).toBe(`hc:answer:v1\n${trusted.ask}\nbuilt`)
    expect({ d: tagOf(answer, 'd'), p: tagOf(answer, 'p'), h: tagOf(answer, 'h'), s: tagOf(answer, 's') })
      .toEqual({ d: trusted.ask, p: trusted.author, h: ORIGIN, s: 'built' })
    expect(answer.tags.filter((t: string[]) => t[0] === 'b')).toEqual([['b', pkg.sig, pkg.label, pkg.version], ['b', hostRevision.sig, hostRevision.label, hostRevision.version]])
    expect(answer.tags.filter((t: string[]) => t[0] === 'g').map((t: string[]) => t[1])).toEqual([pkg.signature!, hostRevision.signature!].sort())
    // The stranger's ask is held, unanswered.
    expect(lines.some(l => l.includes(`held: ${stranger.ask.slice(0, 12)}`))).toBe(true)
    expect(answersIn(puts).some(a => tagOf(a, 'd') === stranger.ask)).toBe(false)
  })

  it('answers each ask once: a later pass sends a lost answer again and builds nothing', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    let down = true
    const { get, send, puts } = await host(builder, [h], { refuse: () => down })
    const failing = vi.fn(async () => { throw new Error('npm run build:core failed:\nerror TS2304: Cannot find name x') })
    const lines: string[] = []
    const log = (l: string) => { lines.push(l) }
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log, build: failing, carry: async () => [] })
    expect(failing).toHaveBeenCalledTimes(1)
    expect(puts).toEqual([])
    expect(lines.some(l => /did not reach http:\/\/h\.test yet/.test(l))).toBe(true)
    down = false
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log, build: failing, carry: async () => [] })
    expect(failing).toHaveBeenCalledTimes(1)
    const [answer] = answersIn(puts)
    expect(tagOf(answer, 's')).toBe('failed')
    expect(tagOf(answer, 'why')).toBe('npm run build:core failed: error TS2304: Cannot find name x')
  })

  it('answers refused when it will not build the ask as asked, and waits out a host that does not answer', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const { get, send, puts } = await host(builder, [h])
    const lines: string[] = []
    const waiting = vi.fn(async () => { throw Object.assign(new Error('h.test did not answer'), { transient: true }) })
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: l => { lines.push(l) }, build: waiting, carry: async () => [] })
    expect(puts).toEqual([])
    expect(lines.some(l => l.includes('waits: h.test did not answer'))).toBe(true)
    // The real build: the draft starts from a revision nobody holds.
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: () => {}, carry: async () => [] })
    const [answer] = answersIn(puts)
    expect(tagOf(answer, 's')).toBe('refused')
    expect(tagOf(answer, 'why')).toMatch(/the draft starts from bbbbbbbbbbbb, which neither this builder nor http:\/\/h\.test holds/)
  })

  it('a build of its own that stopped before its answer is answered, not built again — another builder\'s is not its own', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    // Not trusted any longer: the build happened, so it is answered all the same.
    const theirs = await promoted(h.ask, 'host-drafts', '2026.10.12.3', generateSecretKey())
    const done = await promoted(h.ask, 'host-drafts', '2026.10.12.2', builder)
    const { get, send, puts } = await host(builder, [h])
    const build = vi.fn()
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: () => {}, build, carry: async () => [] })
    expect(build).not.toHaveBeenCalled()
    const [answer] = answersIn(puts)
    expect(answer.tags.filter((t: string[]) => t[0] === 'b')).toEqual([['b', done.sig, 'host-drafts', done.version]])
    expect(JSON.stringify(answer)).not.toContain(theirs.sig)
  })

  it('watches alone, and takes over a lock its holder left behind', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { localFile } = await import('./builds.mjs')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const builder = generateSecretKey()
    const { get, send } = await host(builder, [])
    await mkdir(resolve(localFile('builder.lock'), '..'), { recursive: true })
    await writeFile(localFile('builder.lock'), JSON.stringify({ pid: process.ppid, host: 'http://other.test' }))
    await expect(watchAsks(ORIGIN, { once: true, key: builder, get, send, log: () => {} })).rejects.toThrow(/another builder is at work here/)
    // Gone, or never fully written: taken over.
    for (const left of [JSON.stringify({ pid: 2 ** 22 + 12_345, host: 'http://other.test' }), '', '{"pid":']) {
      await writeFile(localFile('builder.lock'), left)
      await watchAsks(ORIGIN, { once: true, key: builder, get, send, log: () => {} })
      await expect(readFile(localFile('builder.lock'))).rejects.toThrow()
    }
  })

  it('says why with the line that says it — not a stack frame, nor the brace closing an error dump', async () => {
    const { whyOf } = await import('./builder.mjs')
    // npm run build:module, as a draft with a syntax error leaves it.
    const work = `${tmpdir()}/hc-builder-Qx9/src`
    const esbuild = ['npm run build:module failed:', '> @hypercomb/essentials@0.1.0 build:module', '[build-module] dependencies: 61 cached, 1 built',
      '✘ [ERROR] Unexpected ";"', '', '    src/presentation/screen-state.ts:5:22:', '      5 │ export const broken = ;', '',
      'Error: Build failed with 1 error:', 'src/presentation/screen-state.ts:5:22: ERROR: Unexpected ";"',
      `    at failureErrorWithLog (${work}/node_modules/esbuild/lib/main.js:1467:15)`, '    at Socket.emit (node:events:519:28) {',
      '  errors: [Getter/Setter],', '  warnings: [Getter/Setter]', '}'].join('\n')
    expect(whyOf(new Error(esbuild))).toBe('npm run build:module failed: src/presentation/screen-state.ts:5:22: ERROR: Unexpected ";"')
    expect(whyOf(new Error('npm run build:core failed:\nsrc/a.ts(3,5): error TS1109: Expression expected.\nnpm error Lifecycle script `build` failed'))).toBe('npm run build:core failed: src/a.ts(3,5): error TS1109: Expression expected.')
    expect(whyOf(new Error('npm run build:core failed:\nwrote nothing\n}'))).toBe('npm run build:core failed: wrote nothing')
  })

  it('says why in one line, with nothing of this machine in it', async () => {
    const { whyOf } = await import('./builder.mjs')
    const { homedir } = await import('node:os')
    const why = whyOf(new Error(`npm ci failed:\nnpm ERR! in ${tmpdir()}/hc-builder-AbC123/src\nnpm ERR! see ${homedir()}/.npm/_logs/debug.log`))
    expect(why).toBe('npm ci failed: npm ERR! in <build>/src')
    expect(whyOf(new Error(`npm ci failed:\nnpm ERR! see ${homedir()}/.npm/_logs/debug.log`))).toBe('npm ci failed: npm ERR! see ~/.npm/_logs/debug.log')
    expect(whyOf(new Error(`the tree differs at ${tmpdir()}/hc-builder-pools-x1/host`))).toBe('the tree differs at <pools>/host')
    expect(whyOf(new Error('x'.repeat(400))).length).toBe(280)
  })

  it('signs only answers the host itself would note: built with its signatures, a refusal at the longest why, a failure of many lines', async () => {
    const { answerEvent, whyOf } = await import('./builder.mjs')
    const { noteableAnswer } = await import('../../hypercomb-relay/build-asks.js')
    const { verifyEvent } = await import('nostr-tools/pure')
    const builder = generateSecretKey()
    const ask = 'a'.repeat(64), author = getPublicKey(generateSecretKey())
    const events = [
      await answerEvent({ ask, author, origin: ORIGIN, state: 'built', built: [{ sig: 'b'.repeat(64), label: 'hypercomb-essentials-drafts', version: '2026.10.12.1' }, { sig: 'c'.repeat(64), label: 'host-drafts', version: '2026.10.12.2' }], signatures: ['d'.repeat(64), 'e'.repeat(64)] }, builder, NOW),
      await answerEvent({ ask, author, origin: 'HTTP://H.TEST:80/', state: 'refused', why: whyOf(new Error('x'.repeat(1000))) }, builder, NOW),
      await answerEvent({ ask, author, origin: ORIGIN, state: 'failed', why: whyOf(new Error('npm run build:core failed:\nline\twith a tab\nthe last line')) }, builder, NOW),
      await answerEvent({ ask, author, origin: ORIGIN, state: 'failed', why: '' }, builder, NOW),
    ]
    for (const event of events) {
      const verdict = await noteableAnswer(Buffer.from(JSON.stringify(event)), { uploader: getPublicKey(builder), origin: ORIGIN, now: Math.floor(NOW.getTime() / 1000), verify: async (e: unknown) => verifyEvent(e as never) })
      expect(verdict, JSON.stringify(event.tags)).toMatchObject({ ok: true })
    }
    expect(tagOf(events[1], 'why')).toHaveLength(280)
    expect(tagOf(events[2], 'why')).toBe('npm run build:core failed: the last line')
  })

  it('waits, unanswered, on a host that does not give the draft or its version pools', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    for (const failing of [(url: string) => url.endsWith(h.draft), (url: string) => url.endsWith(`/${sha('host:builds')}/`)]) {
      const { get, send, puts } = await host(builder, [h], { failing })
      const lines: string[] = []
      await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: l => { lines.push(l) }, carry: async () => [] })
      expect(puts).toEqual([])
      expect(lines.some(l => l.includes(`${h.ask.slice(0, 12)} waits:`))).toBe(true)
    }
  })

  it('holds an author untrusted while it worked, and answers nothing for a build it was stopped in', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const { get, send, puts } = await host(builder, [h])
    const lines: string[] = []
    const log = (l: string) => { lines.push(l) }
    const untrusted = vi.fn(async () => { throw Object.assign(new Error(`${h.author} is not an author this builder trusts`), { held: true }) })
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log, build: untrusted, carry: async () => [] })
    const stop = new AbortController()
    const stopped = vi.fn(async () => { stop.abort(); throw new Error('npm ci failed:\nnpm ERR! signal SIGINT') })
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log, build: stopped, carry: async () => [], signal: stop.signal })
    expect(untrusted).toHaveBeenCalledTimes(1)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(puts).toEqual([])
    expect(lines.some(l => l.startsWith('[builder] held:'))).toBe(true)
  })

  it('answers nothing until the build is carried; a sync that throws does not stop the carrying', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    let down = true
    const { get, send, puts } = await host(builder, [h], { refuse: () => down })
    const build = vi.fn(async (_origin: string, ask: string) => {
      const p = await promoted(ask, 'host-drafts', '2026.10.12.1', builder)
      return { promoted: [{ label: p.label, version: p.version, sig: p.sig }] }
    })
    const lines: string[] = []
    const carry = async () => { throw new Error('the subscription directory is gone') }
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: l => { lines.push(l) }, build, carry })
    expect(answersIn(puts)).toEqual([])
    expect(lines.some(l => l.includes('waits to be carried'))).toBe(true)
    expect(lines.some(l => l.includes('sync: the subscription directory is gone'))).toBe(true)
    // The host back: carried and answered, and not built again.
    down = false
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: () => {}, build, carry })
    expect(build).toHaveBeenCalledTimes(1)
    expect(answersIn(puts).map(a => tagOf(a, 's'))).toEqual(['built'])
  })

  it('sends an answer again while the host has never listed it; once listed, one dropped since stays dropped', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const failing = vi.fn(async () => { throw new Error('the tests fail') })
    const pass = async (answersListed: string[] | null) => {
      const at = await host(builder, [h], { answersListed })
      await watchAsks(ORIGIN, { once: true, key: builder, get: at.get, send: at.send, now: () => NOW, log: () => {}, build: failing, carry: async () => [] })
      return at.puts.map(p => p.sig)
    }
    const [answer] = await pass(null)
    expect(await pass([])).toEqual([answer])
    expect(await pass([answer])).toEqual([])
    // Swept, or withdrawn by its builder: not put back.
    expect(await pass([])).toEqual([])
    expect(failing).toHaveBeenCalledTimes(1)
  })

  it('answers failed once a draft\'s install has found the registry out of reach three times, run after run', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const offline = vi.fn(async () => { throw Object.assign(new Error('npm ci from the draft\'s tree failed:\nnpm ERR! code ECONNREFUSED'), { transient: true, network: true }) })
    const states: (string | undefined)[][] = []
    for (let run = 0; run < 3; run++) {
      const at = await host(builder, [h])
      await watchAsks(ORIGIN, { once: true, key: builder, get: at.get, send: at.send, now: () => NOW, log: () => {}, build: offline, carry: async () => [] })
      states.push(answersIn(at.puts).map(a => tagOf(a, 's')))
    }
    expect(states).toEqual([[], [], ['failed']])
  })

  it('waits to carry a build while the host does not answer for its version pools, instead of sending everything', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const { get, send, puts } = await host(builder, [h], { failing: url => url.endsWith(`/${sha('host:builds')}/`) })
    const build = vi.fn(async (_origin: string, ask: string) => {
      const p = await promoted(ask, 'host-drafts', '2026.10.12.1', builder)
      return { promoted: [{ label: p.label, version: p.version, sig: p.sig }] }
    })
    const lines: string[] = []
    await watchAsks(ORIGIN, { once: true, key: builder, get, send, now: () => NOW, log: l => { lines.push(l) }, build, carry: async () => [] })
    expect(puts).toEqual([])
    expect(lines.some(l => l.includes('waits to be carried') && l.includes('did not list host:builds'))).toBe(true)
  })

  it('holds an ask another builder built, and waits out a download cut off on the way', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    // Cut off: the draft's body breaks after its headers.
    const cut = await host(builder, [h])
    const cutGet = (async (url: string, init?: RequestInit) => url.endsWith(h.draft)
      ? new Response(new ReadableStream({ pull: c => c.error(new TypeError('terminated')) }))
      : cut.get(url, init)) as unknown as typeof fetch
    const lines: string[] = []
    await watchAsks(ORIGIN, { once: true, key: builder, get: cutGet, send: cut.send, now: () => NOW, log: l => { lines.push(l) }, carry: async () => [] })
    expect(cut.puts).toEqual([])
    expect(lines.some(l => l.includes(`${h.ask.slice(0, 12)} waits:`))).toBe(true)
    // Built by someone else: theirs to answer.
    await promoted(h.ask, 'host-drafts', '2026.10.12.1', generateSecretKey())
    const theirs = await host(builder, [h])
    lines.length = 0
    await watchAsks(ORIGIN, { once: true, key: builder, get: theirs.get, send: theirs.send, now: () => NOW, log: l => { lines.push(l) }, carry: async () => [] })
    expect(theirs.puts).toEqual([])
    expect(lines.some(l => l.startsWith('[builder] held: that ask was built already'))).toBe(true)
  })

  it('runs each build step as a group it can end: past its time, or when this builder stops', async () => {
    const { buildStep, stepTrouble } = await import('./builder.mjs')
    // A step that starts a grandchild and never ends: the time limit ends both.
    const forever = `require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)`
    const late = await buildStep(process.execPath, ['-e', forever], { minutes: 0.01 })
    expect(late.timedOut).toBe(true)
    expect(stepTrouble('npm run build:core', ['run'], late)).toMatchObject({ message: expect.stringMatching(/ran past \d+ minutes and was stopped/) })
    expect(stepTrouble('npm run build:core', ['run'], late).transient).toBeUndefined()
    // Stopped by this builder: transient, never the draft's failure.
    const stop = new AbortController()
    setTimeout(() => stop.abort(), 200)
    const stopped = await buildStep(process.execPath, ['-e', forever], { signal: stop.signal })
    expect(stopped.stopped).toBe(true)
    expect(stepTrouble('npm ci', ['ci'], stopped)).toMatchObject({ transient: true })
    // Passed, and failed with what it printed last.
    expect(stepTrouble('npm run x', ['run'], await buildStep(process.execPath, ['-e', 'console.log("ok")']))).toBeNull()
    const broke = await buildStep(process.execPath, ['-e', 'console.error("error TS2304: Cannot find name x"); process.exit(2)'])
    expect(stepTrouble('npm run build:core', ['run'], broke)?.message).toMatch(/npm run build:core failed:\nerror TS2304/)
  })

  it('counts a registry out of reach against the draft only when the draft changed what an install fetches', async () => {
    const { stepTrouble } = await import('./builder.mjs')
    const offline = { code: 1, signal: null, said: 'npm ERR! code ENOTFOUND\nnpm ERR! network request to https://registry.example failed', timedOut: false, stopped: false }
    expect(stepTrouble('npm ci', ['ci'], offline)).toMatchObject({ transient: true, network: false })
    expect(stepTrouble('npm ci', ['ci'], offline, { touchesInstall: true })).toMatchObject({ transient: true, network: true })
    // The same words from a build script are the draft's failure.
    expect(stepTrouble('npm run build:core', ['run'], offline).transient).toBeUndefined()
    // Ended by a signal this builder did not send: the draft's doing.
    expect(stepTrouble('npm run build:core', ['run'], { code: null, signal: 'SIGKILL', said: '', timedOut: false, stopped: false }).transient).toBeUndefined()
  })

  it('sees an answer the moment the host lists it, so withdrawing it before the next pass keeps it withdrawn', async () => {
    const { watchAsks } = await import('./builder.mjs')
    const { trustAuthor } = await import('./builds.mjs')
    const builder = generateSecretKey()
    const h = hosting()
    await trustAuthor(h.author)
    const failing = vi.fn(async () => { throw new Error('the tests fail') })
    // The host notes what it is given, and lists it at once.
    const listed: string[] = []
    const first = await host(builder, [h], { answersListed: listed })
    const send = (async (url: string, init?: RequestInit) => {
      const response = await first.send(url, init)
      if (response.ok) listed.push(url.split('/').pop()!)
      return response
    }) as unknown as typeof fetch
    await watchAsks(ORIGIN, { once: true, key: builder, get: first.get, send, now: () => NOW, log: () => {}, build: failing, carry: async () => [] })
    expect(first.puts).toHaveLength(1)
    // Withdrawn before the next pass: not sent again.
    const after = await host(builder, [h], { answersListed: [] })
    await watchAsks(ORIGIN, { once: true, key: builder, get: after.get, send: after.send, now: () => NOW, log: () => {}, build: failing, carry: async () => [] })
    expect(after.puts).toEqual([])
  })

  it('names its newest signature on each revision, and cuts a why between characters', async () => {
    const { answerEvent, deliverBuilt, whyOf } = await import('./builder.mjs')
    const { poolDir, signaturePreimage } = await import('./builds.mjs')
    const { mkdir, writeFile } = await import('node:fs/promises')
    const builder = generateSecretKey()
    const rev = await promoted('a'.repeat(64), 'host-drafts', '2026.10.12.1', builder)
    // Signed again later (builds.mjs sign --as builder): the newer stands.
    const again = enc(finalizeEvent({ kind: 30567, created_at: 1_790_000_100, content: signaturePreimage(rev.sig, rev.version, 'builder'),
      tags: [['d', `${rev.sig}:builder`], ['b', rev.sig], ['r', 'builder'], ['v', rev.version]] }, builder))
    await mkdir(poolDir('host:build-signatures'), { recursive: true })
    await writeFile(resolve(poolDir('host:build-signatures'), sha(again)), again)
    const { get, send } = await host(builder, [])
    const carried = await deliverBuilt(ORIGIN, [rev.sig], { get, send, key: builder })
    expect(carried.signatures).toEqual([sha(again)])
    const why = whyOf(new Error('x'.repeat(278) + '\u{1F600}'.repeat(50)))
    expect(why.length).toBeLessThanOrEqual(280)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(why)).toBe(false)
    const event = await answerEvent({ ask: 'a'.repeat(64), author: getPublicKey(generateSecretKey()), origin: ORIGIN, state: 'failed', why }, builder, NOW)
    expect(tagOf(event, 'why')).toBe(why)
  })
})

