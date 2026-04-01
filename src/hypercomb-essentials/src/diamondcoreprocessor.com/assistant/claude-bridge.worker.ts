// diamondcoreprocessor.com/bridge/claude-bridge.worker.ts
import { Worker, EffectBus, normalizeCell, hypercomb } from '@hypercomb/core'
import { readCellProperties } from '../editor/tile-properties.js'
import type { HistoryService } from '../history/history.service.js'

// Bridge protocol — matches @hypercomb/sdk/bridge
const BRIDGE_PORT = 2401
const BRIDGE_ENABLED_QUERY_KEY = 'claudeBridge'
const BRIDGE_ENABLED_STORAGE_KEY = 'hypercomb.claudeBridge.enabled'
type BridgeRequest = { id: string; op: string; cells?: string[]; all?: boolean; cell?: string }
type BridgeResponse = { id: string; ok: boolean; data?: unknown; error?: string }

const RECONNECT_MS = 3_000

export class ClaudeBridgeWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'

  public override description =
    'Claude CLI bridge — receives tile commands over WebSocket and executes against OPFS.'

  public override grammar = [
    { example: 'claude bridge' }
  ]

  public override effects = [] as const

  #ws: WebSocket | null = null
  #timer: ReturnType<typeof setTimeout> | null = null

  protected override act = async (): Promise<void> => {
    if (!this.#isEnabled()) return
    this.#connect()
  }

  #isEnabled(): boolean {
    try {
      // bridge only operates on localhost — never attempt in production
      const host = window.location.hostname
      if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false

      const queryValue = new URLSearchParams(window.location.search).get(BRIDGE_ENABLED_QUERY_KEY)
      if (queryValue !== null) return /^(1|true|yes|on)$/i.test(queryValue)

      const storedValue = window.localStorage.getItem(BRIDGE_ENABLED_STORAGE_KEY)
      if (storedValue !== null) return /^(1|true|yes|on)$/i.test(storedValue)
    } catch {
      return false
    }

    return false
  }

  // ------- WebSocket lifecycle -------

  #connected = false

  #connect(): void {
    try {
      const ws = new WebSocket(`ws://localhost:${BRIDGE_PORT}`)

      ws.onopen = () => {
        this.#connected = true
        ws.send(JSON.stringify({ type: 'renderer' }))
        console.log('[claude-bridge] connected')
      }

      ws.onmessage = (event) => {
        void this.#handleMessage(String(event.data))
      }

      ws.onclose = () => {
        const wasConnected = this.#connected
        this.#ws = null
        this.#connected = false
        // Only reconnect if we previously had a successful connection.
        // Avoids spamming the console when the bridge server isn't running.
        if (wasConnected) {
          console.log('[claude-bridge] disconnected, will reconnect')
          this.#scheduleReconnect()
        }
      }

      ws.onerror = () => {
        // onclose fires after onerror — reconnect handled there
      }

      this.#ws = ws
    } catch {
      // Initial connection failed — bridge server not running, stay silent
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
    const cells = req.cells
    if (!cells?.length) return { id: req.id, ok: false, error: 'no cells provided' }

    const dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    let count = 0
    for (const name of cells) {
      const normalized = normalizeCell(name)
      if (!normalized) continue
      await dir.getDirectoryHandle(normalized, { create: true })
      EffectBus.emit('cell:added', { cell: normalized })
      count++
    }

    await new hypercomb().act()
    return { id: req.id, ok: true, data: { count } }
  }

  async #remove(req: BridgeRequest): Promise<BridgeResponse> {
    if (req.all) {
      const visible = await this.#visibleCells()
      for (const cell of visible) {
        EffectBus.emit('cell:removed', { cell })
      }
      await new hypercomb().act()
      return { id: req.id, ok: true, data: { count: visible.length } }
    }

    const cells = req.cells
    if (!cells?.length) return { id: req.id, ok: false, error: 'no cells provided' }

    let count = 0
    for (const raw of cells) {
      const cell = normalizeCell(raw)
      if (!cell) continue
      EffectBus.emit('cell:removed', { cell })
      count++
    }

    await new hypercomb().act()
    return { id: req.id, ok: true, data: { count } }
  }

  async #list(req: BridgeRequest): Promise<BridgeResponse> {
    const cells = await this.#visibleCells()
    return { id: req.id, ok: true, data: cells }
  }

  async #inspect(req: BridgeRequest): Promise<BridgeResponse> {
    const name = req.cell ? normalizeCell(req.cell) : ''
    if (!name) return { id: req.id, ok: false, error: 'no cell name' }

    const dir = await this.#explorerDir()
    if (!dir) return { id: req.id, ok: false, error: 'no explorer directory' }

    try {
      const cellDir = await dir.getDirectoryHandle(name, { create: false })
      const props = await readCellProperties(cellDir)
      return { id: req.id, ok: true, data: props }
    } catch {
      return { id: req.id, ok: false, error: `cell not found: ${name}` }
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

  async #listCellFolders(dir: FileSystemDirectoryHandle): Promise<string[]> {
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

  async #visibleCells(): Promise<string[]> {
    const dir = await this.#explorerDir()
    if (!dir) return []

    const all = await this.#listCellFolders(dir)

    const historyService = get<HistoryService>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<any>('@hypercomb.social/Lineage')
    if (!historyService || !lineage) return all

    const sig = await historyService.sign(lineage)
    const ops = await historyService.replay(sig)
    const cellState = new Map<string, string>()
    for (const op of ops) cellState.set(op.cell, op.op)

    // Only honor 'remove' for cells whose OPFS directory no longer exists.
    // Every cell in `all` physically exists — if its last op is 'remove' the
    // cell was just recreated and the async HistoryRecorder hasn't caught up.
    const allSet = new Set(all)
    return all.filter(cell => {
      const lastOp = cellState.get(cell)
      return lastOp !== 'remove' || allSet.has(cell)
    })
  }
}

const _claudeBridgeWorker = new ClaudeBridgeWorker()
window.ioc.register('@diamondcoreprocessor.com/ClaudeBridgeWorker', _claudeBridgeWorker)
