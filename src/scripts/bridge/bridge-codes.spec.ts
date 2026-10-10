import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import {
  codeAdmitted as cliCodeAdmitted,
  hashCode as cliHashCode,
  parseCodeHashes as cliParseCodeHashes,
  rendererOriginAllowed as cliRendererOriginAllowed,
  rendererOrigins as cliRendererOrigins,
} from '../../hypercomb-cli/src/bridge/server.js'

// "MAKE SURE THE SERVER CAN ONLY BE USED BY ME OR SOMEONE WITH A CODE"
// (jwize, 2026-10-09). "Me" is this machine's own tools — a loopback socket
// with no Origin. Every page (localhost included) and every remote sender
// presents a code the hive made; the broker holds only the hashes, and the
// list belongs to the renderer socket. These pin who passes.

const here = dirname(fileURLToPath(import.meta.url))
const codes = createRequire(import.meta.url)('./bridge-codes.cjs') as {
  hashCode(code: unknown): string
  parseCodeHashes(list: unknown): Set<string>
  codeAdmitted(presentedHash: string, hashes: Iterable<string>, tokenHash: string): boolean
}
const origins = createRequire(import.meta.url)('./bridge-origin.cjs') as {
  rendererOrigins(env: string | undefined): Set<string>
  rendererOriginAllowed(origin: string | undefined, allowed: Set<string>): boolean
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const PAGE = 'http://localhost:4250'
const CODE = 'hcb-abcdefghijklmnopqrstuvwxyz234567abcd'
const OTHER = 'hcb-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
const REFUSAL = 'unauthorized — this bridge serves its own machine; anyone else needs a bridge code from the hive (bridge give <name>), sent as Authorization: Bearer <code>, or from a page as {"type":"code","code":"<code>"} first'

const brokers: ChildProcess[] = []
const sockets: WebSocket[] = []
const scratch: string[] = []

afterEach(() => {
  for (const socket of sockets.splice(0)) { try { socket.terminate() } catch { /* already gone */ } }
  for (const broker of brokers.splice(0)) broker.kill()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const waitFor = async (check: () => boolean, ms = 5000): Promise<void> => {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > ms) throw new Error('timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

const freePort = () => new Promise<number>(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    server.close(() => resolve(port))
  })
})

const startBroker = async (env: Record<string, string> = {}) => {
  const port = await freePort()
  const dir = mkdtempSync(join(tmpdir(), 'bridge-codes-'))
  scratch.push(dir)
  const child = spawn(process.execPath, [join(here, 'run-bridge.cjs')], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      // No owed stamps here — the fake renderer must see only the ops under test.
      HYPERCOMB_STAMP_OWED_FILE: join(dir, 'owed.json'),
      HYPERCOMB_INSTALL_PUBLISHER_FILE: join(dir, 'install-publisher.json'),
      HYPERCOMB_RELAY_CONTENT_DIR: join(dir, 'relay'),
      HYPERCOMB_BRIDGE_TOKEN: '',
      HYPERCOMB_BRIDGE_BROKER_TOKEN: '',
      BRIDGE_RENDERER_ORIGINS: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  brokers.push(child)
  let log = ''
  child.stdout!.on('data', chunk => { log += String(chunk) })
  child.stderr!.on('data', chunk => { log += String(chunk) })
  await waitFor(() => log.includes('listening'))
  return { port, log: () => log }
}

const open = (port: number, options: { origin?: string; bearer?: string } = {}) => new Promise<WebSocket>((resolve, reject) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.bearer ? { headers: { Authorization: `Bearer ${options.bearer}` } } : {}),
  })
  sockets.push(socket)
  socket.once('open', () => resolve(socket))
  socket.once('error', reject)
})

// A fake hive tab: registers with the hashes it is given and answers every op.
type Broker = Awaited<ReturnType<typeof startBroker>>
const registrations = (broker: Broker) => broker.log().split('renderer connected').length - 1

const attachRenderer = async (broker: Broker, codeHashes?: unknown, options: { origin?: string; answer?: boolean; as?: string } = {}) => {
  const before = registrations(broker)
  const socket = await open(broker.port, { origin: options.origin })
  const ops: Record<string, unknown>[] = []
  socket.on('message', raw => {
    const op = JSON.parse(String(raw)) as Record<string, unknown>
    ops.push(op)
    if (options.answer !== false) socket.send(JSON.stringify({ id: op['id'], ok: true, data: { echoed: op['op'], by: options.as } }))
  })
  socket.send(JSON.stringify(codeHashes === undefined ? { type: 'renderer' } : { type: 'renderer', codes: codeHashes }))
  // Sockets are not ordered against each other: be the renderer before anyone asks.
  await waitFor(() => registrations(broker) > before)
  return { socket, ops }
}

let nextId = 0
// Sends one op and resolves with the reply, and whether the broker then closed the socket.
const ask = (socket: WebSocket) => new Promise<{ reply: Record<string, unknown>; closed: boolean }>((resolve, reject) => {
  const id = `t-${++nextId}`
  const onMessage = (raw: WebSocket.RawData) => {
    const reply = JSON.parse(String(raw)) as Record<string, unknown>
    if (reply['id'] !== id) return
    socket.off('message', onMessage)
    // A refusal is followed by the close; give it a moment to land.
    setTimeout(() => resolve({ reply, closed: socket.readyState !== WebSocket.OPEN }), 150)
  }
  socket.on('message', onMessage)
  socket.once('error', reject)
  socket.send(JSON.stringify({ id, op: 'ping' }))
})

const settle = () => new Promise(resolve => setTimeout(resolve, 150))

describe('the bridge codes, broker side', () => {
  it("forwards this machine's own tools — loopback, no Origin — with no code at all", async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker)
    await waitFor(() => broker.log().includes('renderer connected (0 codes)'))
    const tool = await open(broker.port)
    const { reply, closed } = await ask(tool)
    expect(reply).toMatchObject({ ok: true, data: { echoed: 'ping' } })
    expect(closed).toBe(false)
    expect(renderer.ops).toHaveLength(1)
  })

  it('refuses a page op that brought no code, with the exact refusal, and closes its socket', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker, [sha(CODE)])
    const page = await open(broker.port, { origin: PAGE })
    const { reply, closed } = await ask(page)
    expect(reply).toEqual({ id: expect.any(String), ok: false, error: REFUSAL })
    expect(closed).toBe(true)
    expect(renderer.ops).toHaveLength(0)
    expect(broker.log()).toContain(`(page ${PAGE})`)
  })

  it('admits a page that sent {type:"code"} first, and a page that sent a Bearer header', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker, [sha(CODE)])

    const typed = await open(broker.port, { origin: PAGE })
    typed.send(JSON.stringify({ type: 'code', code: `  ${CODE}  ` }))
    expect((await ask(typed)).reply).toMatchObject({ ok: true })

    const bearer = await open(broker.port, { origin: PAGE, bearer: CODE })
    expect((await ask(bearer)).reply).toMatchObject({ ok: true })

    // A resend replaces the code — a wrong one now is refused.
    typed.send(JSON.stringify({ type: 'code', code: OTHER }))
    expect((await ask(typed)).reply).toMatchObject({ ok: false, error: REFUSAL })
    expect(renderer.ops).toHaveLength(2)
  })

  it('a renderer `codes: []` revokes a page that is already admitted, on its next op', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker, [sha(CODE)])
    const page = await open(broker.port, { origin: PAGE })
    page.send(JSON.stringify({ type: 'code', code: CODE }))
    expect((await ask(page)).reply).toMatchObject({ ok: true })

    renderer.socket.send(JSON.stringify({ type: 'codes', codes: [] }))
    await waitFor(() => broker.log().includes('code list now 0 codes'))
    const { reply, closed } = await ask(page)
    expect(reply).toMatchObject({ ok: false, error: REFUSAL })
    expect(closed).toBe(true)
  })

  it('ignores a `codes` message from any socket that is not the renderer', async () => {
    const broker = await startBroker()
    await attachRenderer(broker, [])
    const tool = await open(broker.port)
    tool.send(JSON.stringify({ type: 'codes', codes: [sha(CODE)] }))
    await waitFor(() => broker.log().includes('ignored a code list'))

    const page = await open(broker.port, { origin: PAGE })
    page.send(JSON.stringify({ type: 'code', code: CODE }))
    expect((await ask(page)).reply).toMatchObject({ ok: false, error: REFUSAL })
  })

  it('clears the code list when the renderer closes', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker, [sha(CODE)])
    renderer.socket.close()
    await waitFor(() => broker.log().includes('renderer disconnected'))

    // No renderer: an admitted op would hear "no renderer connected" — this one is refused.
    const page = await open(broker.port, { origin: PAGE })
    page.send(JSON.stringify({ type: 'code', code: CODE }))
    expect((await ask(page)).reply).toMatchObject({ ok: false, error: REFUSAL })
  })

  it('admits the broker env token as a fallback code', async () => {
    const broker = await startBroker({ HYPERCOMB_BRIDGE_BROKER_TOKEN: OTHER })
    await attachRenderer(broker, [])
    expect(broker.log()).toContain('HYPERCOMB_BRIDGE_BROKER_TOKEN is set as a fallback code')

    const bearer = await open(broker.port, { origin: PAGE, bearer: OTHER })
    expect((await ask(bearer)).reply).toMatchObject({ ok: true })
    const typed = await open(broker.port, { origin: PAGE })
    typed.send(JSON.stringify({ type: 'code', code: OTHER }))
    expect((await ask(typed)).reply).toMatchObject({ ok: true })
  })

  it('drops malformed hashes from the renderer list', async () => {
    const broker = await startBroker()
    await attachRenderer(broker, [sha(CODE).toUpperCase(), 'abc', 42, null, sha(OTHER), sha(OTHER)])
    await waitFor(() => broker.log().includes('renderer connected (1 codes)'))

    const upper = await open(broker.port, { origin: PAGE, bearer: CODE })
    expect((await ask(upper)).reply).toMatchObject({ ok: false, error: REFUSAL })
    const good = await open(broker.port, { origin: PAGE, bearer: OTHER })
    expect((await ask(good)).reply).toMatchObject({ ok: true })
  })

  it("never admits the CLIENT's HYPERCOMB_BRIDGE_TOKEN — a code held for another hive must not open this one", async () => {
    const broker = await startBroker({ HYPERCOMB_BRIDGE_TOKEN: OTHER })
    await attachRenderer(broker, [])
    expect(broker.log()).toContain('HYPERCOMB_BRIDGE_TOKEN is set here')
    const bearer = await open(broker.port, { origin: PAGE, bearer: OTHER })
    expect((await ask(bearer)).reply).toMatchObject({ ok: false, error: REFUSAL })
  })

  it('survives `null` and other non-object frames from a sender with no code', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker)
    const page = await open(broker.port, { origin: PAGE })
    for (const frame of ['null', '[]', '42', '"x"', 'true']) page.send(frame)
    await settle()
    const tool = await open(broker.port)
    expect((await ask(tool)).reply).toMatchObject({ ok: true })
    expect(renderer.ops).toHaveLength(1)
  })

  it('refuses a renderer from a localhost page that is not a hive page, and keeps the real one', async () => {
    const broker = await startBroker()
    const hive = await attachRenderer(broker, [sha(CODE)], { origin: PAGE })
    const stranger = await open(broker.port, { origin: 'http://localhost:9999' })
    const strangerOps: unknown[] = []
    stranger.on('message', raw => { strangerOps.push(JSON.parse(String(raw))) })
    stranger.send(JSON.stringify({ type: 'renderer', codes: [] }))
    await waitFor(() => broker.log().includes('refused a renderer from page http://localhost:9999'))
    await waitFor(() => stranger.readyState === WebSocket.CLOSED)

    const tool = await open(broker.port)
    expect((await ask(tool)).reply).toMatchObject({ ok: true })
    expect(hive.ops).toHaveLength(1)
    expect(strangerOps).toEqual([])
    // The hive's code list was not replaced either.
    const holder = await open(broker.port, { origin: PAGE, bearer: CODE })
    expect((await ask(holder)).reply).toMatchObject({ ok: true })
  })

  it('takes a page renderer from BRIDGE_RENDERER_ORIGINS when it is set', async () => {
    const broker = await startBroker({ BRIDGE_RENDERER_ORIGINS: 'http://localhost:9999, http://localhost:4267' })
    const renderer = await attachRenderer(broker, [], { origin: 'http://localhost:9999' })
    const tool = await open(broker.port)
    expect((await ask(tool)).reply).toMatchObject({ ok: true })
    expect(renderer.ops).toHaveLength(1)

    const hiveDefault = await open(broker.port, { origin: PAGE })
    hiveDefault.send(JSON.stringify({ type: 'renderer' }))
    await waitFor(() => broker.log().includes(`refused a renderer from page ${PAGE}`))
  })

  it('never lets a second hive page displace an open renderer, until the first one closes', async () => {
    const broker = await startBroker()
    const first = await attachRenderer(broker, [sha(CODE)], { origin: PAGE, as: 'first' })
    const second = await open(broker.port, { origin: 'http://localhost:4251' })
    second.send(JSON.stringify({ type: 'renderer', codes: [] }))
    await waitFor(() => broker.log().includes('refused a second renderer from page http://localhost:4251'))
    await waitFor(() => second.readyState === WebSocket.CLOSED)

    const tool = await open(broker.port)
    expect((await ask(tool)).reply).toMatchObject({ ok: true, data: { by: 'first' } })
    expect(first.ops).toHaveLength(1)

    first.socket.close()
    await waitFor(() => broker.log().includes('renderer disconnected'))
    const next = await attachRenderer(broker, [], { origin: 'http://localhost:4251', as: 'next' })
    expect((await ask(tool)).reply).toMatchObject({ ok: true, data: { by: 'next' } })
    expect(next.ops).toHaveLength(1)
  })

  it('passes the slot to another tab of the same hive, or to a newcomer holding the same code list', async () => {
    const broker = await startBroker()
    await attachRenderer(broker, [], { origin: PAGE, as: 'tab-1' })
    await attachRenderer(broker, [], { origin: PAGE, as: 'tab-2' })
    const tool = await open(broker.port)
    expect((await ask(tool)).reply).toMatchObject({ data: { by: 'tab-2' } })

    const other = await startBroker()
    await attachRenderer(other, [sha(CODE), sha(OTHER)], { origin: PAGE, as: 'here' })
    await attachRenderer(other, [sha(OTHER), sha(CODE)], { origin: 'http://localhost:4251', as: 'there' })
    const tool2 = await open(other.port)
    expect((await ask(tool2)).reply).toMatchObject({ data: { by: 'there' } })
  })

  it('takes an answer only from the renderer socket the op was forwarded to', async () => {
    const broker = await startBroker()
    const old = await attachRenderer(broker, [], { origin: PAGE, answer: false })
    const tool = await open(broker.port)
    const replies: Record<string, unknown>[] = []
    tool.on('message', raw => { replies.push(JSON.parse(String(raw)) as Record<string, unknown>) })

    tool.send(JSON.stringify({ id: 'in-flight', op: 'ping' }))
    await waitFor(() => old.ops.length === 1)
    // Another tab of the same hive takes the slot; the old socket stays open.
    const fresh = await attachRenderer(broker, [], { origin: PAGE, answer: false })
    tool.send(JSON.stringify({ id: 'later', op: 'ping' }))
    await waitFor(() => fresh.ops.length === 1)

    // The displaced socket forges an answer for the op it never saw: ignored.
    old.socket.send(JSON.stringify({ id: 'later', ok: true, data: { forged: true } }))
    await waitFor(() => broker.log().includes('ignored an answer from a renderer socket the op was not sent to'))
    // Its answer to the op it WAS sent still lands, and the new renderer answers its own.
    old.socket.send(JSON.stringify({ id: 'in-flight', ok: true, data: { by: 'old' } }))
    fresh.socket.send(JSON.stringify({ id: 'later', ok: true, data: { by: 'fresh' } }))
    await waitFor(() => replies.length === 2)
    expect(replies).toEqual([
      { id: 'in-flight', ok: true, data: { by: 'old' } },
      { id: 'later', ok: true, data: { by: 'fresh' } },
    ])
  })

  it('never logs a code or a hash', async () => {
    const broker = await startBroker()
    const renderer = await attachRenderer(broker, [sha(CODE)])
    renderer.socket.send(JSON.stringify({ type: 'codes', codes: [sha(CODE), sha(OTHER)] }))
    await waitFor(() => broker.log().includes('code list now 2 codes'))
    const page = await open(broker.port, { origin: PAGE, bearer: OTHER })
    await ask(page)
    const refused = await open(broker.port, { origin: PAGE })
    refused.send(JSON.stringify({ type: 'code', code: 'hcb-not-a-code-anyone-gave' }))
    await ask(refused)
    await settle()
    for (const secret of [CODE, OTHER, sha(CODE), sha(OTHER), 'hcb-not-a-code-anyone-gave']) {
      expect(broker.log()).not.toContain(secret)
    }
  })
})

// The same three functions live inline in the CLI twin; they must agree.
const LONG = 'x'.repeat(257)
const HASH_TABLE: [unknown, string][] = [
  [CODE, sha(CODE)],
  [`  ${CODE}\n`, sha(CODE)],
  ['HCB-ABC', sha('HCB-ABC')],
  ['~!#$%&*+-./:;<=>?@[]^_`{|}', sha('~!#$%&*+-./:;<=>?@[]^_`{|}')],
  ['x'.repeat(256), sha('x'.repeat(256))],
  // Printable ASCII only: a header cannot carry anything else intact.
  ['ünïcödé', ''],
  ['たなかのひみつ', ''],
  ['two words', ''],
  ['tab\there', ''],
  [LONG, ''],
  ['', ''],
  ['   ', ''],
  [undefined, ''],
  [null, ''],
]

const PARSE_TABLE: [unknown, string[]][] = [
  [undefined, []],
  ['not a list', []],
  [{ 0: sha(CODE) }, []],
  [[sha(CODE), sha(CODE), sha(CODE).toUpperCase(), 'abc', 7, null, sha(OTHER)], [sha(CODE), sha(OTHER)]],
  [Array.from({ length: 300 }, (_, i) => sha(`code-${i}`)), Array.from({ length: 256 }, (_, i) => sha(`code-${i}`))],
]

const ADMIT_TABLE: [string, string[], string, boolean][] = [
  ['', [sha(CODE)], '', false],
  ['', [], '', false],
  [sha(CODE), [sha(CODE)], '', true],
  [sha(CODE), [sha(OTHER), sha(CODE)], '', true],
  [sha(CODE), [], sha(CODE), true],
  [sha(CODE), [sha(OTHER)], '', false],
  [sha(CODE), [sha(OTHER)], sha(OTHER), false],
  [sha(CODE).toUpperCase(), [sha(CODE)], '', false],
  ['zz', ['zz'], 'zz', false],
]

const ORIGIN_TABLE: [string | undefined, string | undefined, boolean][] = [
  [undefined, undefined, true],
  ['http://localhost:4250', undefined, true],
  ['http://127.0.0.1:4200', undefined, true],
  ['http://[::1]:4450', undefined, true],
  ['https://localhost:4260', undefined, true],
  ['http://localhost:9999', undefined, false],
  ['http://localhost:6006', undefined, false],
  ['http://try-x.localhost:4250', undefined, false],
  ['null', undefined, false],
  ['http://localhost:9999', 'http://localhost:9999', true],
  ['http://localhost:4250', 'http://localhost:9999', false],
  ['http://localhost:4267', 'http://localhost:9999,http://localhost:4267/', true],
  ['http://localhost:4267', 'localhost:4267 garbage', false],
]

describe('bridge-codes.cjs and its twin in hypercomb-cli agree', () => {
  it.each(HASH_TABLE)('hashCode(%j)', (code, expected) => {
    expect(codes.hashCode(code)).toBe(expected)
    expect(cliHashCode(code)).toBe(expected)
  })

  it.each(PARSE_TABLE)('parseCodeHashes(%#)', (list, expected) => {
    expect([...codes.parseCodeHashes(list)]).toEqual(expected)
    expect([...cliParseCodeHashes(list)]).toEqual(expected)
  })

  it.each(ADMIT_TABLE)('codeAdmitted(%#)', (presented, hashes, token, expected) => {
    expect(codes.codeAdmitted(presented, new Set(hashes), token)).toBe(expected)
    expect(cliCodeAdmitted(presented, new Set(hashes), token)).toBe(expected)
  })

  it.each(ORIGIN_TABLE)('rendererOriginAllowed(%j) with BRIDGE_RENDERER_ORIGINS=%j', (origin, env, expected) => {
    expect(origins.rendererOriginAllowed(origin, origins.rendererOrigins(env))).toBe(expected)
    expect(cliRendererOriginAllowed(origin, cliRendererOrigins(env))).toBe(expected)
  })
})
