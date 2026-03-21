// diamondcoreprocessor.com/bridge/claude-bridge.drone.ts
import { Worker, EffectBus, normalizeSeed } from '@hypercomb/core'
import { readSeedProperties } from '../editor/tile-properties.js'
import type { HistoryService } from '../core/history.service.js'

// Bridge protocol — matches @hypercomb/sdk/bridge
const BRIDGE_PORT = 2401
type BridgeRequest = { id: string; op: string; seeds?: string[]; all?: boolean; seed?: string }
type BridgeResponse = { id: string; ok: boolean; data?: unknown; error?: string }

const RECONNECT_MS = 3_000

export class ClaudeBridgeWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Claude CLI bridge — receives tile commands over WebSocket and executes against OPFS.'

  public override grammar = [
    { example: 'claude bridge' }
  ]

  public override effects = [] as const

  #ws: WebSocket | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  protected override act = async (): Promise<void> => {
    this.#connect()
  }

  // ------- WebSocket lifecycle -------

  #connect(): void {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'renderer' }))
        console.log('[claude-bridge] connected')
      }

      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data))
      }

      ws.onclose = () => {
        this.#ws = null
        this.#scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose fires after onerror — reconnect handled there
      }

      this.#ws = ws
    } catch {
      this.#scheduleReconnect()
    }
  }

  #scheduleReconnect(): void {
    if (this.#timer) return
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.#connect()
    }, RECONNECT_MS)
  }

  // ------- message handling -------

  async #handleMessage(raw: string): Promise<void> {
    let req: BridgeRequest
    try {
      req = JSON.parse(raw)
    } catch {
      return
    }

    if (!req.id || !req.op) return

    let res: BridgeResponse
    try {
      res = await this.#dispatch(req)
    } catch (err: any) {
      res = { id: req.id, ok: false, error: err?.message ?? 'unknown error' }
    }

    if (this.#ws?.readyState === WebSocket.OPEN) {
      this.#ws.send(JSON.stringify(res))
    }
  }

  async #dispatch(req: BridgeRequest): Promise<BridgeResponse> {
    switch (req.op) {
      case 'add':     return this.#add(req)
      case 'remove':  return this.#remove(req)
      case 'list':    return this.#list(req)
      case 'inspect': return this.#inspect(req)
      case 'history': return this.#history(req)
      default:        return { id: req.id, ok: false, error: `unknown op: ${req.op}` }
    }
  }

  // ------- operations -------

  async #add(req: BridgeRequest): Promise<BridgeResponse> {
    const seeds = req.seeds
    if (!seeds?.length) return { id: req.id, ok: false, error: 'no seeds provided' }

    const dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    let count = 0
    for (const name of seeds) {
      const normalized = normalizeSeed(name)
      if (!normalized) continue
      await dir.getDirectoryHandle(normalized, { create: true })
      EffectBus.emit('seed:added', { seed: normalized })
      count++
    }

    window.dispatchEvent(new Event('synchronize'))
    return { id: req.id, ok: true, data: { count } }
  }

  async #remove(req: BridgeRequest): Promise<BridgeResponse> {
    if (req.all) {
      const visible = await this.#visibleSeeds()
      for (const seed of visible) {
        EffectBus.emit('seed:removed', { seed })
      }
      window.dispatchEvent(new Event('synchronize'))
      return { id: req.id, ok: true, data: { count: visible.length } }
    }

    const seeds = req.seeds
    if (!seeds?.length) return { id: req.id, ok: false, error: 'no seeds provided' }

    let count = 0
    for (const raw of seeds) {
      const seed = normalizeSeed(raw)
      if (!seed) continue
      EffectBus.emit('seed:removed', { seed })
      count++
    }

    window.dispatchEvent(new Event('synchronize'))
    return { id: req.id, ok: true, data: { count } }
  }

  async #list(req: BridgeRequest): Promise<BridgeResponse> {
    const seeds = await this.#visibleSeeds()
    return { id: req.id, ok: true, data: seeds }
  }

  async #inspect(req: BridgeRequest): Promise<BridgeResponse> {
    const name = req.seed ? normalizeSeed(req.seed) : ''
    if (!name) return { id: req.id, ok: false, error: 'no seed name' }

    const dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    try {
      const seedDir = await dir.getDirectoryHandle(name, { create: false })
      const props = await readSeedProperties(seedDir)
      return { id: req.id, ok: true, data: props }
    } catch {
      return { id: req.id, ok: false, error: `seed not found: ${name}` }
    }
  }

  async #history(req: BridgeRequest): Promise<BridgeResponse> {
    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<any>('@hypercomb.social/Lineage')
    if (!historyService || !lineage) {
      return { id: req.id, ok: false, error: 'history service not available' }
    }

    const sig = await historyService.sign(lineage)
    const ops = await historyService.replay(sig)
    return { id: req.id, ok: true, data: ops }
  }

  // ------- helpers -------

  async #explorerDir(): Promise<FileSystemDirectoryHandle | null> {
    const lineage = get<any>('@hypercomb.social/Lineage')
    return lineage?.explorerDir?.() ?? null
  }

  async #listSeedFolders(dir: FileSystemDirectoryHandle): Promise<string[]> {
    const out: string[] = []
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'directory') continue
      if (!name) continue
      if (name.startsWith('__') && name.endsWith('__')) continue
      out.push(name)
    }
    out.sort((a, b) => a.localeCompare(b))
    return out
  }

  async #visibleSeeds(): Promise<string[]> {
    const dir = await this.#explorerDir()
    if (!dir) return []

    const all = await this.#listSeedFolders(dir)

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<any>('@hypercomb.social/Lineage')
    if (!historyService || !lineage) return all

    const sig = await historyService.sign(lineage)
    const ops = await historyService.replay(sig)
    const seedState = new Map<string, string>()
    for (const op of ops) seedState.set(op.seed, op.op)

    return all.filter(seed => seedState.get(seed) !== 'remove')
  }
}

const _claudeBridgeWorker = new ClaudeBridgeWorker()
window.ioc.register('@diamondcoreprocessor.com/ClaudeBridgeWorker', _claudeBridgeWorker)
