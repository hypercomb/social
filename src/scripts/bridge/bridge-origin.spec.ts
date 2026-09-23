import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { get } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { bridgeOriginAllowed as cliBridgeOriginAllowed } from '../../hypercomb-cli/src/bridge/server.js'

// THE BROKER TRUSTED ANY BROWSER PAGE. Trust was the loopback socket alone,
// and every page the participant opens — a try- door running a publisher's
// code, or any site — dials ws://localhost:2401 from their own browser. The
// page's Origin is what decides now; these pin who passes.

const here = dirname(fileURLToPath(import.meta.url))
const { bridgeOriginAllowed } = createRequire(import.meta.url)('./bridge-origin.cjs') as {
  bridgeOriginAllowed(origin: string | undefined): boolean
}

const TABLE: [string | undefined, boolean][] = [
  [undefined, true],
  ['http://localhost:4250', true],
  ['http://127.0.0.1:9', true],
  ['http://[::1]:4250', true],
  ['https://try-x.hypercomb.com', false],
  ['http://try-x.localhost:4291', false],
  ['https://hypercomb.io', false],
  ['null', false],
  ['garbage', false],
]

describe('bridge origin gate', () => {
  it.each(TABLE)('scripts/bridge/bridge-origin.cjs: %s → %s', (origin, allowed) => {
    expect(bridgeOriginAllowed(origin)).toBe(allowed)
  })

  it.each(TABLE)('its twin in hypercomb-cli agrees: %s → %s', (origin, allowed) => {
    expect(cliBridgeOriginAllowed(origin)).toBe(allowed)
  })
})

// The predicate is only half of it — the broker has to actually ask it.
const brokers: ChildProcess[] = []
afterEach(() => { for (const broker of brokers.splice(0)) broker.kill() })

const freePort = () => new Promise<number>(resolve => {
  const server = createServer()
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as { port: number }
    server.close(() => resolve(port))
  })
})

const startBroker = async (): Promise<number> => {
  const port = await freePort()
  const child = spawn(process.execPath, [join(here, 'run-bridge.cjs')], {
    env: { ...process.env, BRIDGE_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  brokers.push(child)
  let log = ''
  child.stdout!.on('data', chunk => { log += String(chunk) })
  const started = Date.now()
  while (!log.includes('listening')) {
    if (Date.now() - started > 5000) throw new Error('broker did not start')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return port
}

const handshake = (port: number, origin?: string) => new Promise<number | 'open'>(resolve => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {})
  socket.on('open', () => { socket.close(); resolve('open') })
  socket.on('unexpected-response', (_req, res) => { resolve(res.statusCode ?? 0) })
  socket.on('error', () => { /* the refusal already resolved */ })
})

const healthCors = (port: number, origin?: string) => new Promise<string | string[] | undefined>((resolve, reject) => {
  const request = get(`http://127.0.0.1:${port}/healthz`, { headers: origin ? { origin } : {} }, response => {
    response.resume()
    response.on('end', () => resolve(response.headers['access-control-allow-origin']))
  })
  request.on('error', reject)
})

describe('run-bridge.cjs asks the gate', () => {
  it('admits a Node client and a hive page, refuses a door with 403, and tells only the hive it is up', async () => {
    const port = await startBroker()
    expect(await handshake(port)).toBe('open')
    expect(await handshake(port, 'http://localhost:4250')).toBe('open')
    expect(await handshake(port, 'https://try-x.hypercomb.com')).toBe(403)
    expect(await handshake(port, 'http://try-x.localhost:4291')).toBe(403)
    expect(await healthCors(port, 'http://localhost:4250')).toBe('http://localhost:4250')
    expect(await healthCors(port, 'https://try-x.hypercomb.com')).toBeUndefined()
    expect(await healthCors(port)).toBeUndefined()
  })
})
