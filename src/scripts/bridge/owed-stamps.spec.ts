import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const here = dirname(fileURLToPath(import.meta.url))
const owedStamps = createRequire(import.meta.url)('./owed-stamps.cjs') as {
  readOwed(file: string): Record<string, { sig: string; host?: string }>
  recordOwed(channel: string, sig: string, host: string | undefined, file: string): boolean
  settleOwed(channel: string, sig: string, file: string): boolean
  servedByRelay(sig: string, dir: string): boolean
}

const BUILT = 'a'.repeat(64)
const NEWER = 'b'.repeat(64)
const PUBLISHER = 'c'.repeat(64)
const STRANGER = 'd'.repeat(64)
const POOL = createHash('sha256').update('host:packages', 'utf8').digest('hex')

const scratch: string[] = []
const brokers: ChildProcess[] = []

afterEach(() => {
  for (const broker of brokers.splice(0)) broker.kill()
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const workspace = (served: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'owed-stamps-'))
  scratch.push(dir)
  const relay = join(dir, 'relay')
  mkdirSync(join(relay, POOL), { recursive: true })
  served.forEach((sig, index) => writeFileSync(join(relay, POOL, String(index).padStart(8, '0')), `${sig}\ndevelopment`))
  writeFileSync(join(relay, POOL, 'index.html'), served.map((_, index) => String(index).padStart(8, '0')).join('\n'))
  const publisher = join(dir, 'install-publisher.json')
  writeFileSync(publisher, JSON.stringify({ pubkey: PUBLISHER, hosts: [], channel: 'essentials' }))
  return { owed: join(dir, 'owed.json'), relay, publisher }
}

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

const startBroker = async (ws: ReturnType<typeof workspace>) => {
  const port = await freePort()
  const child = spawn(process.execPath, [join(here, 'run-bridge.cjs')], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      HYPERCOMB_STAMP_OWED_FILE: ws.owed,
      HYPERCOMB_INSTALL_PUBLISHER_FILE: ws.publisher,
      HYPERCOMB_RELAY_CONTENT_DIR: ws.relay,
      BRIDGE_OWED_POLL_MS: '100',
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

const attachRenderer = (port: number, signer: string) => new Promise<Record<string, unknown>[]>(resolve => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`)
  const ops: Record<string, unknown>[] = []
  socket.on('message', raw => {
    const op = JSON.parse(String(raw)) as Record<string, unknown>
    ops.push(op)
    socket.send(JSON.stringify({ id: op['id'], ok: true, data: { pubkey: signer, host: 'content.example' } }))
  })
  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'renderer' }))
    resolve(ops)
  })
})

const health = (port: number) => new Promise<{ status: number | undefined; cors: string | string[] | undefined }>((resolve, reject) => {
  const request = get(`http://127.0.0.1:${port}/healthz`, response => {
    response.resume()
    response.on('end', () => resolve({ status: response.statusCode, cors: response.headers['access-control-allow-origin'] }))
  })
  request.on('error', reject)
})

describe('owed install stamps', () => {
  it('answers the renderer health probe over HTTP', async () => {
    const ws = workspace([])
    const broker = await startBroker(ws)
    await expect(health(broker.port)).resolves.toEqual({ status: 200, cors: '*' })
  })

  it('keeps one debt per channel, the newest build replacing an older one', () => {
    const ws = workspace([])
    expect(owedStamps.recordOwed('essentials', BUILT, undefined, ws.owed)).toBe(true)
    expect(owedStamps.recordOwed('essentials', NEWER, 'content.example', ws.owed)).toBe(true)
    expect(owedStamps.recordOwed('essentials', 'not-a-signature', undefined, ws.owed)).toBe(false)
    expect(owedStamps.readOwed(ws.owed)).toEqual({ essentials: expect.objectContaining({ sig: NEWER, host: 'content.example' }) })
  })

  it('settles only the debt that names the stamped build, and removes the file when none remain', () => {
    const ws = workspace([])
    owedStamps.recordOwed('essentials', NEWER, undefined, ws.owed)
    expect(owedStamps.settleOwed('essentials', BUILT, ws.owed)).toBe(false)
    expect(existsSync(ws.owed)).toBe(true)
    expect(owedStamps.settleOwed('essentials', NEWER, ws.owed)).toBe(true)
    expect(existsSync(ws.owed)).toBe(false)
  })

  it('knows a build the relay serves from one it does not', () => {
    const ws = workspace([BUILT])
    expect(owedStamps.servedByRelay(BUILT, ws.relay)).toBe(true)
    expect(owedStamps.servedByRelay(NEWER, ws.relay)).toBe(false)
  })

  it('the broker pays the debt the moment a hive attaches, and settles it when the followed key signed', async () => {
    const ws = workspace([BUILT])
    owedStamps.recordOwed('essentials', BUILT, undefined, ws.owed)
    const broker = await startBroker(ws)
    const ops = await attachRenderer(broker.port, PUBLISHER)
    await waitFor(() => !existsSync(ws.owed))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'hive-root-set', key: 'install:essentials', sig: BUILT })
    expect(broker.log()).toContain('owed stamp paid')
  })

  it('leaves the debt owed when a different key answered', async () => {
    const ws = workspace([BUILT])
    owedStamps.recordOwed('essentials', BUILT, undefined, ws.owed)
    const broker = await startBroker(ws)
    const ops = await attachRenderer(broker.port, STRANGER)
    await waitFor(() => broker.log().includes('not the followed publisher'))
    expect(ops).toHaveLength(1)
    expect(owedStamps.readOwed(ws.owed)['essentials']?.sig).toBe(BUILT)
  })

  it('never asks the hive to sign a build the local relay does not serve', async () => {
    const ws = workspace([BUILT])
    owedStamps.recordOwed('essentials', NEWER, undefined, ws.owed)
    const broker = await startBroker(ws)
    const ops = await attachRenderer(broker.port, PUBLISHER)
    await waitFor(() => broker.log().includes('does not serve it'))
    expect(ops).toHaveLength(0)
    expect(owedStamps.readOwed(ws.owed)['essentials']?.sig).toBe(NEWER)
  })

  it('pays a debt recorded while a hive is already attached, without waiting for it to reconnect', async () => {
    // Found 2026-09-13: a build's stamp timed out against a slow tab that stayed
    // attached, and the debt waited for a reconnect that never came.
    const ws = workspace([BUILT])
    const broker = await startBroker(ws)
    const ops = await attachRenderer(broker.port, PUBLISHER)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(ops).toHaveLength(0)
    owedStamps.recordOwed('essentials', BUILT, undefined, ws.owed)
    await waitFor(() => !existsSync(ws.owed), 5000)
    expect(ops[0]).toMatchObject({ op: 'hive-root-set', key: 'install:essentials', sig: BUILT })
    expect(broker.log()).toContain('owed stamp paid')
  })
})
