// diamondcoreprocessor.com/assistant/conversation.drone.ts

import { Drone, EffectBus, normalizeCell, hypercomb } from '@hypercomb/core'
import {
  MODELS, API_KEY_STORAGE, getApiKey, callAnthropicMultiTurn,
} from './llm-api.js'
import {
  type ThreadManifest, type ThreadTurn,
  computeThreadId, saveThread, loadThread, buildMessages,
} from './thread.js'

type ConversationSendPayload = {
  threadId?: string
  message: string
  model?: string
}

const SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`

const PROPS_FILE = '0000'

/**
 * Orchestrates multi-turn Claude conversations.
 *
 * /chat creates a question tile at the current level. The response becomes
 * a child tile inside it. Navigate into the question to see responses.
 * Tags auto-applied: ['question', model] on the question, ['response', model, stopReason] on answers.
 * Tag filter for 'question' surfaces all questions across the workspace.
 */
export class ConversationDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  override description = 'Orchestrates multi-turn Claude conversations as question tiles with response children'

  protected override deps = {
    store: '@hypercomb.social/Store',
    lineage: '@hypercomb.social/Lineage',
  }

  protected override listens = ['conversation:send']
  protected override emits = [
    'conversation:response', 'conversation:turn-added',
    'cell:added', 'llm:request-start', 'llm:request-done', 'llm:error',
  ]

  #effectsRegistered = false
  #busy = false

  protected override heartbeat = async (): Promise<void> => {
    if (this.#effectsRegistered) return
    this.#effectsRegistered = true

    this.onEffect<ConversationSendPayload>('conversation:send', (payload) => {
      void this.#handleSend(payload)
    })
  }

  async #handleSend(payload: ConversationSendPayload): Promise<void> {
    if (this.#busy) return
    this.#busy = true

    try {
      const apiKey = getApiKey()
      if (!apiKey) {
        console.warn(`[conversation] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`)
        EffectBus.emit('llm:api-key-required', {})
        return
      }

      const store = this.resolve<{
        putResource: (blob: Blob) => Promise<string>
        getResource: (sig: string) => Promise<Blob | null>
        threads: FileSystemDirectoryHandle
      }>('store')
      const lineage = this.resolve<{
        explorerDir: () => Promise<FileSystemDirectoryHandle | null>
      }>('lineage')

      if (!store || !lineage) {
        console.warn('[conversation] Store or Lineage not available')
        return
      }

      const explorerDir = await lineage.explorerDir()
      if (!explorerDir) return

      const modelKey = payload.model?.toLowerCase() ?? 'opus'
      const model = MODELS[modelKey] ?? MODELS['opus']
      const modelAlias = Object.entries(MODELS).find(([k, v]) => v === model && k.length > 1)?.[0] ?? modelKey

      // ── resolve or create thread ────────────────────

      let manifest: ThreadManifest
      let questionDir: FileSystemDirectoryHandle

      if (payload.threadId) {
        // Continue existing thread — find the question tile
        const loaded = await loadThread(store.threads, payload.threadId)
        if (!loaded) {
          console.warn(`[conversation] Thread not found: ${payload.threadId}`)
          return
        }
        manifest = loaded

        const tileName = await this.#findThreadTile(explorerDir, payload.threadId)
        if (!tileName) {
          console.warn(`[conversation] Question tile not found for: ${payload.threadId}`)
          return
        }
        questionDir = await explorerDir.getDirectoryHandle(tileName)
      } else {
        // New thread — create question tile at current level
        const threadId = await computeThreadId(SYSTEM_PROMPT, payload.message)
        const tileName = normalizeCell(payload.message.slice(0, 40)) || `chat-${threadId.slice(0, 8)}`

        questionDir = await explorerDir.getDirectoryHandle(tileName, { create: true })

        // Store question text as resource
        const questionBlob = new Blob([payload.message], { type: 'text/plain' })
        const questionSig = await store.putResource(questionBlob)

        await this.#writeProps(questionDir, {
          thread: threadId,
          contentSig: questionSig,
          tags: ['question', modelAlias],
        })
        EffectBus.emit('cell:added', { cell: tileName })

        manifest = {
          id: threadId,
          model,
          systemPrompt: SYSTEM_PROMPT,
          turns: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

        // Record the question as the first turn
        manifest.turns.push({
          role: 'user',
          contentSig: questionSig,
          tileName,
          at: Date.now(),
        })
      }

      EffectBus.emit('llm:request-start', { model, threadId: manifest.id })

      // ── for continuation, store the new user message ──

      if (payload.threadId) {
        const userBlob = new Blob([payload.message], { type: 'text/plain' })
        const userSig = await store.putResource(userBlob)

        const turnIndex = manifest.turns.length + 1
        const followUpName = `${String(turnIndex).padStart(2, '0')}-followup`
        const followUpDir = await questionDir.getDirectoryHandle(followUpName, { create: true })
        await this.#writeProps(followUpDir, {
          contentSig: userSig,
          tags: ['followup'],
        })
        EffectBus.emit('cell:added', { cell: followUpName })

        manifest.turns.push({
          role: 'user',
          contentSig: userSig,
          tileName: followUpName,
          at: Date.now(),
        })
      }

      // ── call Claude with full history ───────────────

      const messages = await buildMessages(
        (sig) => store.getResource(sig),
        manifest,
      )

      const result = await callAnthropicMultiTurn(
        model, manifest.systemPrompt, messages, apiKey,
      )

      // ── store response as child tile ────────────────

      const responseBlob = new Blob([result.text], { type: 'text/plain' })
      const responseSig = await store.putResource(responseBlob)

      const responseIndex = manifest.turns.length + 1
      const responseName = `${String(responseIndex).padStart(2, '0')}-response`
      const responseDir = await questionDir.getDirectoryHandle(responseName, { create: true })

      const stopReasonTag = result.stopReason.replace(/_/g, '-')
      await this.#writeProps(responseDir, {
        contentSig: responseSig,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        tags: ['response', modelAlias, stopReasonTag],
      })
      EffectBus.emit('cell:added', { cell: responseName })

      const responseTurn: ThreadTurn = {
        role: 'assistant',
        contentSig: responseSig,
        tileName: responseName,
        at: Date.now(),
        meta: {
          stopReason: result.stopReason,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      }
      manifest.turns.push(responseTurn)

      // ── persist manifest ────────────────────────────

      manifest.updatedAt = Date.now()
      await saveThread(store.threads, manifest)

      // ── emit effects ────────────────────────────────

      EffectBus.emit('conversation:response', { threadId: manifest.id, responseSig, model })
      EffectBus.emit('llm:request-done', { model, threadId: manifest.id, success: true })

      console.log(`[conversation] ${modelAlias} thread ${manifest.id.slice(0, 12)}... → ${manifest.turns.length} turns`)

      await new hypercomb().act()
    } catch (err: any) {
      EffectBus.emit('llm:error', { message: err?.message ?? 'Unknown error' })
      EffectBus.emit('llm:request-done', { model: '', threadId: '', success: false })
      console.warn('[conversation] failed:', err)
    } finally {
      this.#busy = false
    }
  }

  async #findThreadTile(
    dir: FileSystemDirectoryHandle,
    threadId: string,
  ): Promise<string | null> {
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind !== 'directory') continue
      if (name.startsWith('__')) continue
      try {
        const props = await this.#readProps(handle as FileSystemDirectoryHandle)
        if (props.thread === threadId) return name
      } catch { /* skip */ }
    }
    return null
  }

  async #readProps(cellDir: FileSystemDirectoryHandle): Promise<Record<string, unknown>> {
    try {
      const fh = await cellDir.getFileHandle(PROPS_FILE)
      const file = await fh.getFile()
      return JSON.parse(await file.text())
    } catch {
      return {}
    }
  }

  async #writeProps(cellDir: FileSystemDirectoryHandle, updates: Record<string, unknown>): Promise<void> {
    const existing = await this.#readProps(cellDir)
    const merged = { ...existing, ...updates }
    const fh = await cellDir.getFileHandle(PROPS_FILE, { create: true })
    const writable = await fh.createWritable()
    try {
      await writable.write(JSON.stringify(merged))
    } finally {
      await writable.close()
    }
  }
}

const _conversation = new ConversationDrone()
window.ioc.register('@diamondcoreprocessor.com/ConversationDrone', _conversation)
