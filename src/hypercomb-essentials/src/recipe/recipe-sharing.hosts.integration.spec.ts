// @vitest-environment node
//
// recipe/recipe-sharing.hosts.integration.spec.ts : RECIPE SHARING AGAINST THE
// REAL SERVERS. Every other recipe and pool spec injects a fake host. This one
// runs the hive's own client functions over real HTTP (and a real WebSocket for
// the room's liveness) against:
//
//   RELAY   hypercomb-relay/relay.js, a child process on a free port, started
//           with --writers <P1> --allow-participants and a temp content dir.
//           Named `127.0.0.1:<port>`: a loopback host, so the client speaks
//           plain http to it with no mapping at all.
//   WORKER  hypercomb-relay/blossom-worker/worker.js, the Cloudflare host's
//           own code, behind a small node:http server on another port that
//           turns each IncomingMessage into a Request for worker.fetch(request,
//           env) over in-memory R2/KV (scripts/local-content-host.mjs does the
//           same). Named `localhost:<port>`, bound in SITE_BINDINGS as the zone
//           `localhost`, so the worker sees the URL the client signed.
//
// Nothing about a host is mapped: the client's own originOf() turns both names
// into http origins. What IS injected, and why, is named where it happens:
// the hive's signer and store (IoC, one actor at a time), who a reader follows
// (the hosts' ledgers do not list these publishers, see the ledger test), the
// room's standing (the shell's room store), and the leader's page check (no
// built visitor shell is served here).
//
// Run from src/:  node <repo>/src/node_modules/vitest/vitest.mjs run hypercomb-essentials/src/recipe/recipe-sharing.hosts.integration.spec.ts

import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { POST_SHELL_MARK_CONTENT, POST_SHELL_MARK_NAME, lifecyclePreimage } from '@hypercomb/core'

// The host sync service reads `window.ioc`: in a node environment the window is the global.
;(globalThis as { window?: unknown }).window ??= globalThis

const sha = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const enc = new TextEncoder()
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// ── the world clock ─────────────────────────────────────────────────────────
// The worker runs in this process and reads Date.now(), as the client does. To
// let a pool expire, the whole world moves forward together (time passes); the
// relay, a child process, keeps its own clock and is not used after the skip.
const realNow = Date.now.bind(Date)
let shiftMs = 0
Date.now = () => realNow() + shiftMs

// ── actors: one signer and one store at a time, as one tab has ──────────────

interface Actor { readonly name: string; readonly secret: Uint8Array; readonly pubkey: string; readonly heap: Map<string, Uint8Array> }
const actor = (name: string): Actor => {
  const secret = generateSecretKey()
  return { name, secret, pubkey: getPublicKey(secret), heap: new Map() }
}
const signerOf = (who: Actor) => ({
  getPublicKeyHex: async () => who.pubkey,
  knownPublicKeyHex: async () => who.pubkey,
  signEvent: async (evt: { kind: number; created_at: number; tags: string[][]; content: string }) => finalizeEvent(evt, who.secret) as unknown as Record<string, unknown>,
})
const storeOf = (who: Actor) => {
  const blobOf = (sig: string): Blob | null => { const bytes = who.heap.get(sig); return bytes ? new Blob([bytes.slice()]) : null }
  return {
    putResource: async (blob: Blob): Promise<string> => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const sig = sha(bytes)
      who.heap.set(sig, bytes)
      return sig
    },
    getResourceLocal: async (sig: string) => blobOf(sig),
    getResource: async (sig: string) => blobOf(sig),
  }
}
const keep = (who: Actor, bytes: Uint8Array): string => { const sig = sha(bytes); who.heap.set(sig, bytes); return sig }

let current: Actor | null = null
let hostSync: unknown = null
;(globalThis as { ioc?: unknown }).ioc = {
  register: () => undefined,
  whenReady: () => undefined,
  get: (key: string): unknown => {
    if (key === '@diamondcoreprocessor.com/NostrSigner') return current ? signerOf(current) : undefined
    if (key === '@hypercomb.social/Store') return current ? storeOf(current) : undefined
    if (key === '@diamondcoreprocessor.com/HostSyncService') return hostSync
    return undefined
  },
}
/** Act as `who`: the hive's signer and store are theirs for the call. Calls are awaited one at a time. */
const as = async <T>(who: Actor, run: () => Promise<T>): Promise<T> => {
  current = who
  try { return await run() } finally { current = null }
}

// ── the modules under test (imported after the IoC and window are in place) ─

type Modules = {
  offered: typeof import('../pools/offered-pool.js')
  room: typeof import('../pools/room-entries.js')
  entries: typeof import('../pools/open-entries.js')
  flows: typeof import('../pools/open-entries-flows.js')
  recipeEntries: typeof import('./recipe-entries.js')
  catalogue: typeof import('./recipe-catalogue.js')
  template: typeof import('./recipe-template.js')
  defaults: typeof import('./recipe-defaults.js')
  pointer: typeof import('../sharing/hive-pointer.js')
}
let m: Modules

// ── the two servers ─────────────────────────────────────────────────────────

const RELAY_DIR = fileURLToPath(new URL('../../../hypercomb-relay/', import.meta.url))
const WORKER_URL = new URL('../../../hypercomb-relay/blossom-worker/worker.js', import.meta.url).href

let scratch = ''
let relayProcess: ChildProcess | null = null
let relayLog = ''
let workerServer: Server | null = null
let RELAY = ''
let WORKER = ''
const sockets: WebSocket[] = []

/** R2 as the worker uses it: bytes, custom metadata, upload time, paged listing. */
const r2 = () => {
  const objects = new Map<string, { bytes: Uint8Array; customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; uploaded: Date }>()
  const meta = (key: string) => {
    const entry = objects.get(key)!
    return {
      key, size: entry.bytes.byteLength, etag: sha(entry.bytes), httpEtag: `"${sha(entry.bytes)}"`, uploaded: entry.uploaded,
      customMetadata: entry.customMetadata, httpMetadata: entry.httpMetadata ?? {},
      writeHttpMetadata: (headers: Headers) => { if (entry.httpMetadata?.['contentType']) headers.set('content-type', entry.httpMetadata['contentType']) },
    }
  }
  return {
    objects,
    head: async (key: string) => objects.has(key) ? meta(key) : null,
    get: async (key: string) => {
      const entry = objects.get(key)
      if (!entry) return null
      const copy = () => entry.bytes.slice()
      return {
        ...meta(key),
        get body() { return new Response(copy()).body },
        arrayBuffer: async () => copy().buffer,
        text: async () => new TextDecoder().decode(copy()),
        json: async () => JSON.parse(new TextDecoder().decode(copy())),
      }
    },
    put: async (key: string, body: unknown, options: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, string>; onlyIf?: Headers; sha256?: string } = {}) => {
      if (options.onlyIf?.get?.('If-None-Match') === '*' && objects.has(key)) return null
      const bytes = new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
      if (options.sha256 && sha(bytes) !== options.sha256) throw new Error('put: the bytes do not match their sha256')
      objects.set(key, { bytes, customMetadata: options.customMetadata, httpMetadata: options.httpMetadata, uploaded: new Date(Date.now()) })
      return meta(key)
    },
    list: async ({ prefix = '', limit = 1000, cursor }: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix) && (cursor === undefined || key > cursor)).sort()
      const page = keys.slice(0, limit)
      const truncated = page.length < keys.length
      return { objects: page.map(key => meta(key)), truncated, ...(truncated ? { cursor: page.at(-1) } : {}) }
    },
    delete: async (key: string) => { objects.delete(key) },
  }
}
const kv = () => {
  const values = new Map<string, string>()
  return { values, get: async (key: string) => values.get(key) ?? null, put: async (key: string, value: string) => { values.set(key, String(value)) }, delete: async (key: string) => { values.delete(key) } }
}
let workerEnv: Record<string, unknown> & { CONTENT: ReturnType<typeof r2> }

const freePort = (): Promise<number> => new Promise(resolve => {
  const probe = createServer()
  probe.listen(0, '127.0.0.1', () => { const port = (probe.address() as AddressInfo).port; probe.close(() => resolve(port)) })
})

const P1 = actor('P1')      // publishes on the relay (one of its --writers)
const P2 = actor('P2')      // publishes on the worker (a bound publisher of its zone)
const LEADER = actor('L')   // opens a pool on the worker (one of its HOST_FRIENDS)

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'hc-recipe-hosts-'))

  // RELAY: the machine host, exactly as an operator starts it.
  const relayPort = await freePort()
  RELAY = `127.0.0.1:${relayPort}`
  relayProcess = spawn(process.execPath, [
    'relay.js', '--port', String(relayPort), '--memory', '--content-dir', scratch,
    '--writers', P1.pubkey, '--allow-participants',
  ], { cwd: RELAY_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  relayProcess.stdout?.on('data', chunk => { relayLog += String(chunk) })
  relayProcess.stderr?.on('data', chunk => { relayLog += String(chunk) })

  // WORKER: the Cloudflare host's code over in-memory storage. Its own people
  // are the zone's bound publisher (P2) and one friend (the leader); a stranger
  // is kept nothing (AUTO_GRANT '0', as deployed).
  const worker = (await import(/* @vite-ignore */ WORKER_URL)).default as { fetch(request: Request, env: unknown, ctx?: unknown): Promise<Response> }
  workerEnv = {
    SITE_BINDINGS: JSON.stringify({ localhost: { title: 'Kitchen', lineage: 'kitchen', publishers: [{ pubkey: P2.pubkey, label: 'P2', primary: true }] } }),
    HOST_FRIENDS: LEADER.pubkey,
    AUTO_GRANT: '0',
    CONTENT: r2(),
    HIVES: kv(),
    GRANTS: kv(),
  }
  workerServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks)
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value)
    const pending: Promise<unknown>[] = []
    try {
      // The URL the client asked for, as it signed it: http, the Host it sent, the path and query.
      const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body })
      const response = await worker.fetch(request, workerEnv, { waitUntil: (work: Promise<unknown>) => { pending.push(work) } })
      const out = req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer())
      await Promise.allSettled(pending)
      const sent: Record<string, string> = {}
      response.headers.forEach((value, key) => { if (key !== 'content-encoding' && key !== 'content-length') sent[key] = value })
      res.writeHead(response.status, sent)
      res.end(out)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String((error as Error)?.stack ?? error))
    }
  })
  const workerPort = await freePort()
  await new Promise<void>(resolve => workerServer!.listen(workerPort, resolve))  // every address: `localhost` may resolve to ::1
  WORKER = `localhost:${workerPort}`

  for (let tries = 0; tries < 100; tries++) {
    try { if ((await fetch(`http://${RELAY}/`)).status < 500) break } catch { /* not up yet */ }
    await wait(50)
  }

  hostSync = (await import('../sharing/host-sync.service.js')).hostSyncService
  m = {
    offered: await import('../pools/offered-pool.js'),
    room: await import('../pools/room-entries.js'),
    entries: await import('../pools/open-entries.js'),
    flows: await import('../pools/open-entries-flows.js'),
    recipeEntries: await import('./recipe-entries.js'),
    catalogue: await import('./recipe-catalogue.js'),
    template: await import('./recipe-template.js'),
    defaults: await import('./recipe-defaults.js'),
    pointer: await import('../sharing/hive-pointer.js'),
  }
}, 30_000)

afterAll(async () => {
  Date.now = realNow
  for (const socket of sockets) { try { socket.close() } catch { /* gone */ } }
  relayProcess?.kill()
  if (relayProcess && relayProcess.exitCode === null) await new Promise(resolve => relayProcess!.once('exit', resolve))
  await new Promise<void>(resolve => workerServer ? workerServer.close(() => resolve()) : resolve())
  workerServer?.closeAllConnections?.()
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

// ── recipes ─────────────────────────────────────────────────────────────────

/** A template, a recipe written into it, and its entry, all held in `who`'s hive. */
const cook = (who: Actor, name: string, story: string) => {
  const template = keep(who, m.template.recipeTemplateBytes(m.defaults.RECIPE_TEMPLATE_WEEKNIGHT))
  const key = m.defaults.RECIPE_TEMPLATE_WEEKNIGHT.sections.find(section => section.kind === 'text')!.key
  const recipeBytes = m.template.recipeBytes({ template, values: { [key]: { kind: 'text', text: story } } })
  const recipe = keep(who, recipeBytes)
  const entry = keep(who, m.template.recipeEntryBytes({ name, recipe }))
  return { template, recipe, recipeBytes, entry }
}

const MEANING = 'recipe:entry'
const TEMPLATE_MEANING = 'recipe:template'

// ── A. across two servers ───────────────────────────────────────────────────

describe('A. a recipe pool left at the root domain, read across two real hosts', () => {
  it('a reader following both hosts reads the union by node; a tampered member is refused, the other host still shows; unlighting clears the key and keeps the bytes', async () => {
    const soup = cook(P1, 'Grandma\'s soup', 'Simmer the bones all day.')
    const cake = cook(P1, 'Lemon cake', 'Zest three lemons.')
    const tacos = cook(P2, 'Fish tacos', 'Char the tortillas.')

    // Each publisher leaves their lit tiles at their own host: the template pool and the entry pool.
    for (const [who, host, rows] of [[P1, RELAY, [soup, cake]], [P2, WORKER, [tacos]]] as const) {
      await as(who, async () => {
        const entries = await m.offered.publishOfferedPool(host, MEANING, rows.map(row => row.entry), {
          closure: [...new Set(rows.flatMap(row => [row.template, row.recipe]))],
        })
        expect(entries, `${who.name} leaves its entries at ${host}`).toEqual({ ok: true, host, meaning: MEANING, count: rows.length })
        const templates = await m.offered.publishOfferedPool(host, TEMPLATE_MEANING, [rows[0].template])
        expect(templates, `${who.name} leaves its template at ${host}`).toMatchObject({ ok: true, count: 1 })
      })
    }

    // The reader follows each host's publisher by key; every index, list and member is read over HTTP.
    const follows: Record<string, string[]> = { [RELAY]: [P1.pubkey], [WORKER]: [P2.pubkey] }
    const io = { keysOf: async (host: string) => follows[host] ?? [], own: async () => null }
    const read = () => m.recipeEntries.findRecipeEntries({ zones: [RELAY, WORKER] }, { io, ownHost: () => '' })

    const offers = await read()
    expect(offers.map(offer => offer.entry.name).sort(), 'the reader sees every recipe both hosts offer').toEqual(['Fish tacos', 'Grandma\'s soup', 'Lemon cake'])
    const groups = m.catalogue.recipeCatalogueGroups(offers.map(offer => ({ sig: offer.sig, name: offer.entry.name, nodes: offer.nodes })))
    expect(groups.map(group => [group.node.kind, group.node.id, group.rows.map(row => row.name).sort()]), 'grouped by the domain each came from')
      .toEqual(expect.arrayContaining([
        ['domain', RELAY, ['Grandma\'s soup', 'Lemon cake']],
        ['domain', WORKER, ['Fish tacos']],
      ]))
    expect(groups).toHaveLength(2)

    // The one template both offer is ONE row of the union, offered by both hosts.
    const templates = await m.offered.readOfferedPools([RELAY, WORKER], TEMPLATE_MEANING, { io })
    expect(templates.map(row => [row.sig, row.hosts]), 'one template, two hosts').toEqual([[soup.template, [RELAY, WORKER]]])

    // A byte of one member changed on the relay's disk: that member is refused, the rest still show.
    const tamperedAt = join(scratch, cake.entry)
    const honest = readFileSync(tamperedAt)
    expect(sha(honest), 'the relay keeps the entry flat, under its signature').toBe(cake.entry)
    const forged = Buffer.from(honest)
    forged[forged.length - 3] ^= 1
    writeFileSync(tamperedAt, forged)
    const served = Buffer.from(await (await fetch(`http://${RELAY}/${cake.entry}`)).arrayBuffer())
    expect(sha(served), 'the relay serves the changed bytes as they are').not.toBe(cake.entry)
    expect((await read()).map(offer => offer.entry.name).sort(), 'the tampered member is refused by its hash; the other host is untouched')
      .toEqual(['Fish tacos', 'Grandma\'s soup'])
    writeFileSync(tamperedAt, honest)

    // P1 unlights everything: the key is cleared, nothing is sent, and P1's rows leave the reader.
    await as(P1, async () => {
      expect(await m.offered.publishOfferedPool(RELAY, MEANING, [])).toEqual({ ok: true, host: RELAY, meaning: MEANING, count: 0 })
    })
    const index = await m.pointer.fetchHiveIndex(RELAY, P1.pubkey, undefined, { fresh: true })
    expect(index.ok && Object.keys(index.manifest.roots), 'the relay holds P1\'s newer index: the template pool stays, the entry pool is gone')
      .toEqual([`pool:${TEMPLATE_MEANING}`])
    expect((await read()).map(offer => offer.entry.name), 'the reader lists only what P2 still offers').toEqual(['Fish tacos'])
    const kept = await fetch(`http://${RELAY}/${soup.entry}`)
    expect(kept.status, 'the bytes stay on the host (withdrawn, never deleted)').toBe(200)
    expect(sha(new Uint8Array(await kept.arrayBuffer()))).toBe(soup.entry)
  }, 30_000)

  it('the hosts\' own ledgers do not name these publishers, so a reader that relies on the ledger alone finds nothing', async () => {
    // documentation/recipe-templates.md, "Known limit": keys come only from the ledger row for the zone itself.
    // The relay serves no host:publications ledger; the worker's names the zone `localhost`, never `localhost:<port>`.
    const tacos = cook(P2, 'Ledger probe', 'Nothing here is followed by key.')
    await as(P2, async () => { await m.offered.publishOfferedPool(WORKER, 'recipe:probe', [tacos.entry], { closure: [tacos.template, tacos.recipe] }) })
    const ledgerOnly = { own: async () => null }
    expect(await m.offered.readOfferedPool(RELAY, MEANING, { io: ledgerOnly }), 'the relay: no ledger').toEqual([])
    expect(await m.offered.readOfferedPool(WORKER, 'recipe:probe', { io: ledgerOnly }), 'the worker: the ledger row is not this zone').toEqual([])
    // The publisher's own key on its own host does read back (the `own` path).
    const own = await m.offered.readOfferedPool(WORKER, 'recipe:probe', { io: { own: async () => ({ host: WORKER, pubkey: P2.pubkey }) } })
    expect(own.map(row => row.sig)).toEqual([tacos.entry])
  }, 20_000)
})

// ── B. one host, many participants: the room ────────────────────────────────

/** Speak once on the relay's socket, as joining does: a signed {alive} beacon at the room's lifecycle address. */
const joinOnSocket = async (who: Actor, room: string, secret: string): Promise<void> => {
  const socket = new WebSocket(`ws://${RELAY}`)
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => { socket.onopen = () => resolve(); socket.onerror = () => reject(new Error('socket')) })
  const beacon = finalizeEvent({
    kind: 30206, created_at: Math.floor(Date.now() / 1000),
    tags: [['x', sha(lifecyclePreimage(room, secret, RELAY))], ['d', 'presence']],
    content: JSON.stringify({ alive: true }),
  }, who.secret)
  const answered = new Promise<unknown[]>(resolve => { socket.onmessage = (message) => { const said = JSON.parse(String(message.data)); if (said[0] === 'OK') resolve(said) } })
  socket.send(JSON.stringify(['EVENT', beacon]))
  const ok = await answered
  expect(ok[1], `${who.name}'s beacon was answered`).toBe(beacon.id)
}

const roomDeps = (who: Actor, label: string, room: string, secret: string) => ({
  joined: () => true,
  room: () => room,
  secret: () => secret,
  host: () => RELAY,
  signer: () => signerOf(who),
  bytesOf: async (sig: string) => who.heap.get(sig) ?? null,
  myName: () => label,
})

describe('B. one host, many participants: a room on the relay', () => {
  it('two participants share lit recipes, a third reads both by name, a take-back hides one, and a wrong secret reads nothing', async () => {
    const ROOM = 'tuesday-kitchen'
    const SECRET = 'a7f3-room-secret'
    const ana = actor('Ana'), ben = actor('Ben'), cleo = actor('Cleo'), late = actor('Late')
    await joinOnSocket(ana, ROOM, SECRET)
    await joinOnSocket(ben, ROOM, SECRET)

    const pageOf = (who: Actor) => sha(`kitchen/${who.name}\u0000${who.pubkey}`)
    const shareOf = async (who: Actor, label: string, title: string, gone = false) => {
      const made = cook(who, title, `${label} wrote this.`)
      return m.room.shareRoomEntry(MEANING, { head: made.entry, page: pageOf(who), closure: [made.template, made.recipe], ...(gone ? { gone } : {}) }, roomDeps(who, label, ROOM, SECRET))
    }
    expect(await shareOf(ana, 'Ana', 'Ana\'s dal'), 'Ana\'s entry is kept by the relay').toEqual({ ok: true, host: RELAY, kept: true })
    expect(await shareOf(ben, 'Ben', 'Ben\'s bread'), 'Ben\'s entry is kept by the relay').toEqual({ ok: true, host: RELAY, kept: true })

    // A key that never spoke on the relay's socket is not admitted: shared live only.
    const refused = await shareOf(late, 'Late', 'Late soup')
    expect(refused, 'a participant not live on the relay is told the entry is live only').toMatchObject({ ok: false, live: true })

    const readAs = (who: Actor, secret = SECRET) => m.recipeEntries.findRecipeEntries({ zones: [], room: true }, { room: roomDeps(who, who.name, ROOM, secret) })
    const both = await readAs(cleo)
    expect(both.map(offer => [offer.entry.name, offer.node.kind, offer.node.name]).sort(), 'Cleo reads both, each under its maker\'s name')
      .toEqual([['Ana\'s dal', 'participant', 'Ana'], ['Ben\'s bread', 'participant', 'Ben']])
    expect(both.find(offer => offer.node.name === 'Ana')?.node.id).toBe(ana.pubkey)

    // Ana takes hers back: a newer member for the same page that says gone. Nothing is deleted.
    expect(await shareOf(ana, 'Ana', 'Ana\'s dal', true), 'the take-back is kept').toEqual({ ok: true, host: RELAY, kept: true })
    expect((await readAs(cleo)).map(offer => offer.entry.name), 'Cleo no longer sees Ana\'s').toEqual(['Ben\'s bread'])

    expect(await readAs(cleo, 'not-the-secret'), 'a reader with the wrong secret sees nothing').toEqual([])
  }, 30_000)
})

// ── C. one host, many participants: an open entry pool on the worker ────────

describe('C. one host, many participants: an open entry pool on the worker', () => {
  it('a leader opens a pool, two phones post, the leader reads, hides, sees changes and take-backs, the count stops at 8, closing stops posts, and the pool expires and recycles', async () => {
    const template = keep(LEADER, m.template.recipeTemplateBytes(m.defaults.RECIPE_TEMPLATE_WEEKNIGHT))
    const records: Parameters<typeof m.flows.openedRecordBytes>[0][number][] = []
    const nonces = new Map<string, string>()
    // Injected: the leader's own record and nonce store (the hive's store and secret store), and the page check.
    // No visitor shell is built here, so the page a visitor would get is stood in for, mark and package included;
    // every other step of the open (record, template, read-back, index write, proof, first member) is the real one.
    const visitorPage = `<!doctype html><meta name="${POST_SHELL_MARK_NAME}" content="${POST_SHELL_MARK_CONTENT}">`
      + `<script id="hc-install" type="application/json">${JSON.stringify({ text: `${'e'.repeat(64)}\n` })}</script>`
    const deps = {
      records: { read: async () => [...records], write: async (pools: readonly (typeof records)[number][]) => { records.splice(0, records.length, ...pools); return true } },
      nonces: { get: (pool: string) => nonces.get(pool) ?? '', set: (pool: string, nonce: string) => { nonces.set(pool, nonce); return true }, drop: (pool: string) => { nonces.delete(pool) } },
      page: async () => ({ status: 200, html: visitorPage }),
      postBee: async () => 'has' as const,
      sleep: (ms: number) => wait(Math.min(ms, 200)),
    }

    const opened = await as(LEADER, () => m.flows.openEntryPool({ host: WORKER, page: WORKER, title: 'Tuesday class', meaning: MEANING, template }, deps))
    expect(opened.ok, `the pool opens: ${JSON.stringify(opened)}`).toBe(true)
    if (!opened.ok) return
    const { pool, record, until } = opened.pool

    // A phone holds only the code. It reads the public record from the page, and derives A and H itself.
    const code = m.entries.entryCodeOf(opened.link)!
    expect(code.record).toBe(record)
    const recordBytes = await m.entries.readEntryAtom(WORKER, code.record, m.entries.ENTRY_LIMITS.recordBytes)
    const parsed = await m.entries.parseEntryRecord(recordBytes!, code.record)
    expect(parsed.ok, 'the opening record is served to a stranger').toBe(true)
    if (!parsed.ok) return
    const address = await m.entries.entryPoolAddress(code.record, code.nonce)
    expect(await m.entries.entryPoolName(address, parsed.record.by, parsed.record.until)).toBe(pool)
    const path = { page: WORKER, address, by: parsed.record.by, until: parsed.record.until }

    const phone = (name: string) => ({ name, secretKey: generateSecretKey(), page: m.entries.newEntryPage() })
    const ana = phone('Ana'), ben = phone('Ben')
    const keyOf = (who: { secretKey: Uint8Array }) => getPublicKey(who.secretKey)
    const recipeText = (text: string) => new TextDecoder().decode(m.template.recipeBytes({
      template, values: { [m.defaults.RECIPE_TEMPLATE_WEEKNIGHT.sections.find(section => section.kind === 'text')!.key]: { kind: 'text', text } },
    }))
    const post = async (who: ReturnType<typeof phone>, title: string, options: { page?: string; gone?: boolean } = {}) => {
      // Presses come back to back, inside one second: postEntryMember stamps each post of one entry past the
      // last, so a change or a take-back always wins over the member it replaces (foldEntryMembers breaks a
      // same-second tie by name, which would let the older one win about half the time).
      const listing = await m.entries.readEntryListing(path)
      return m.flows.postEntryMember({
        path, pool, secretKey: who.secretKey, offset: m.entries.hostOffsetOf(listing, Date.now()),
        entry: { page: options.page ?? who.page, name: who.name, title, content: recipeText(`${who.name}: ${title}`), ...(options.gone ? { gone: true } : {}) },
      })
    }
    const leaderReads = async () => {
      const read = await m.entries.readEntryPool(path, pool)
      const offers = await m.recipeEntries.postedRecipeOffers(read.rows, { pool, host: WORKER, template })
      return { read, titles: offers.map(offer => `${offer.node.name}: ${offer.entry.name}`).sort() }
    }

    expect(await post(ana, 'Sunday soup'), 'phone 1 posts').toMatchObject({ ok: true, held: false })
    expect(await post(ben, 'Rye bread'), 'phone 2 posts').toMatchObject({ ok: true, held: false })
    const first = await leaderReads()
    expect(first.read.state).toBe('open')
    // The worker serves an entry member only beside its pool's `by` and `until` (worker.js getRoomMember).
    const someone = first.read.members![0].name
    expect((await fetch(`http://${WORKER}/${address}/${someone}`)).status, 'a member asked without its pool is not served').toBe(404)
    expect((await fetch(m.entries.entryMemberUrl(path, someone))).status, 'beside its pool it is').toBe(200)
    expect(first.titles, 'the leader reads both, under the names they typed (the hive\'s own first member draws nothing)')
      .toEqual(['Ana: Sunday soup', 'Ben: Rye bread'])

    // The leader hides phone 2.
    const hidden = await as(LEADER, () => m.flows.setEntryHidden({ host: WORKER, pool, line: { key: keyOf(ben) }, hide: true, page: WORKER }, deps))
    expect(hidden.ok, `the hide is written: ${JSON.stringify(hidden)}`).toBe(true)
    const afterHide = await leaderReads()
    expect(afterHide.read.hidden.named, 'the listing names the leader\'s hidden list').toBe(hidden.ok ? hidden.sig : '')
    expect(afterHide.titles, 'phone 2 is hidden').toEqual(['Ana: Sunday soup'])

    // Phone 1 changes its entry (same page), then takes it back.
    expect(await post(ana, 'Sunday soup, less salt'), 'phone 1 changes its entry').toMatchObject({ ok: true })
    expect((await leaderReads()).titles, 'the change replaces the entry').toEqual(['Ana: Sunday soup, less salt'])
    expect(await post(ana, 'Sunday soup, less salt', { gone: true }), 'phone 1 takes it back').toMatchObject({ ok: true })
    const gone = await leaderReads()
    expect(gone.titles, 'taken back: nothing of phone 1 is drawn').toEqual([])
    expect(gone.read.members?.filter(member => member.signer === keyOf(ana)).length, 'three members of phone 1 are held').toBe(3)

    // Every post, change and take-back counts toward 8 a key.
    for (let n = 4; n <= 8; n++) expect(await post(ana, `Dish ${n}`, { page: m.entries.newEntryPage() }), `post ${n} of 8`).toMatchObject({ ok: true })
    const ninth = await post(ana, 'Dish 9', { page: m.entries.newEntryPage() })
    expect(ninth, 'the ninth is refused by the host').toMatchObject({ ok: false, status: 429 })
    expect(!ninth.ok && ninth.reason).toMatch(/posted its 8/)

    // Shown again: a hide is reversible.
    expect(await as(LEADER, () => m.flows.setEntryHidden({ host: WORKER, pool, line: { key: keyOf(ben) }, hide: false, page: WORKER }, deps))).toMatchObject({ ok: true })
    expect((await leaderReads()).titles, 'phone 2 shows again beside phone 1\'s five').toContain('Ben: Rye bread')

    // The leader closes: one index write, proved by the listing.
    const closed = await as(LEADER, () => m.flows.closeEntryPool({ pool, record, host: WORKER, page: WORKER, until }, deps))
    expect(closed, 'closed, and the host says so').toEqual({ ok: true, proved: true })
    const late = await post(ben, 'Too late')
    expect(late, 'a post after closing is refused').toMatchObject({ ok: false, status: 403 })
    expect(!late.ok && late.reason).toMatch(/closed/)
    const afterClose = await leaderReads()
    expect(afterClose.read.state, 'the listing says closed').toBe('closed')
    expect(afterClose.titles, 'what was posted stays readable').toContain('Ben: Rye bread')
    const own = await as(LEADER, () => m.flows.ownEntryPools(WORKER, deps))
    expect(own.ok && own.pools.map(one => [one.pool, one.state]), 'the leader\'s index says closed').toEqual([[pool, 'closed']])

    // Thirty days past its end the pool has expired, and the host drops its members when asked.
    const memberKeys = () => [...workerEnv.CONTENT.objects.keys()].filter(key => key.startsWith(`${address}/`))
    expect(memberKeys().length, 'members held before expiry').toBeGreaterThan(0)
    shiftMs = (until + m.entries.ENTRY_LIMITS.keptSeconds + 60) * 1000 - realNow()
    try {
      const expired = await m.entries.readEntryListing(path)
      expect([expired.state, expired.said], 'the listing says expired').toEqual(['expired', 'this one has expired'])
      for (let tries = 0; tries < 20 && memberKeys().length; tries++) await m.entries.readEntryListing(path)
      expect(memberKeys(), 'the expired pool\'s members are dropped').toEqual([])
      expect((await post(ben, 'After the end')), 'a post to an expired pool is refused').toMatchObject({ ok: false, status: 410 })

      const past = await as(LEADER, () => m.flows.ownEntryPools(WORKER, deps))
      expect(past.ok && past.pools.map(one => one.pastKeeping), 'the hive sees it past keeping').toEqual([true])
      const recycled = await as(LEADER, () => m.flows.recycleEntryPool({ pool, record, host: WORKER, page: WORKER, until }, deps))
      expect(recycled, 'recycled in one index write').toEqual({ ok: true, asked: true })
      const after = await as(LEADER, () => m.flows.ownEntryPools(WORKER, deps))
      expect(after.ok && after.pools, 'the index names no pool').toEqual([])
      expect(await m.entries.readEntryAtom(WORKER, template, 64 * 1024), 'the template stays served: recycling stops at what others name').not.toBeNull()
    } finally {
      shiftMs = 0
    }
  }, 60_000)
})
