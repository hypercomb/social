// diamondcoreprocessor.com/assistant/conversation.drone.ts

import { Drone, EffectBus, normalizeCell, hypercomb } from '@hypercomb/core'
import {
  MODELS, API_KEY_STORAGE, getApiKey, callAnthropicMultiTurn,
} from './llm-api.js'
import {
  type ThreadManifest, type ThreadTurn,
  computeThreadId, saveThread, loadThread, buildMessages,
} from './thread.js'
import { writeTilePropertiesAt } from '../editor/tile-properties.js'

type ConversationSendPayload = {
  threadId?: string
  message: string
  model?: string
}

const SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`

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
        explorerSegments?: () => readonly string[]
      }>('lineage')

      if (!store || !lineage) {
        console.warn('[conversation] Store or Lineage not available')
        return
      }

      const parentSegments = (lineage.explorerSegments?.() ?? []).map(s => String(s ?? ''))

      const modelKey = payload.model?.toLowerCase() ?? 'opus'
      const model = MODELS[modelKey] ?? MODELS['opus']
      const modelAlias = Object.entries(MODELS).find(([k, v]) => v === model && k.length > 1)?.[0] ?? modelKey

      // ── resolve or create thread ────────────────────

      let manifest: ThreadManifest
      let questionTileName: string
      let questionSegments: string[] // parent path of the question tile (== current explorer)
      let questionPath: string[] // segments-path-to-question (questionSegments + questionTileName)

      if (payload.threadId) {
        // Continue existing thread — load manifest. Locating the original
        // question tile under the layer-primitive doctrine requires a
        // layer.children scan, which isn't wired here yet; we recover the
        // tile name from the manifest's first turn (saved at create time)
        // and trust the segments match the current explorer.
        const loaded = await loadThread(store.threads, payload.threadId)
        if (!loaded) {
          console.warn(`[conversation] Thread not found: ${payload.threadId}`)
          return
        }
        manifest = loaded

        const firstTurn = manifest.turns[0]
        if (!firstTurn?.tileName) {
          console.warn(`[conversation] Thread has no question tile recorded: ${payload.threadId}`)
          return
        }
        questionTileName = firstTurn.tileName
        questionSegments = parentSegments
        questionPath = [...questionSegments, questionTileName]
      } else {
        // New thread — create question tile at current level via layer-slot
        // write. Folder mints are retired; writeTilePropertiesAt commits a
        // properties slot on the tile's own layer and the cell:added emit
        // drives the children-slot cascade up the parent chain.
        const threadId = await computeThreadId(SYSTEM_PROMPT, payload.message)
        questionTileName = normalizeCell(payload.message.slice(0, 40)) || `chat-${threadId.slice(0, 8)}`
        questionSegments = parentSegments
        questionPath = [...questionSegments, questionTileName]

        // Store question text as resource
        const questionBlob = new Blob([payload.message], { type: 'text/plain' })
        const questionSig = await store.putResource(questionBlob)

        await writeTilePropertiesAt(questionSegments, questionTileName, {
          thread: threadId,
          contentSig: questionSig,
          tags: ['question', modelAlias],
        })
        EffectBus.emit('cell:added', { cell: questionTileName, segments: questionSegments.slice() })

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
          tileName: questionTileName,
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
        await writeTilePropertiesAt(questionPath, followUpName, {
          contentSig: userSig,
          tags: ['followup'],
        })
        EffectBus.emit('cell:added', { cell: followUpName, segments: questionPath.slice() })

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

      const stopReasonTag = result.stopReason.replace(/_/g, '-')
      await writeTilePropertiesAt(questionPath, responseName, {
        contentSig: responseSig,
        stopReason: result.stopReason,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
        tags: ['response', modelAlias, stopReasonTag],
      })
      EffectBus.emit('cell:added', { cell: responseName, segments: questionPath.slice() })

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

}

const _conversation = new ConversationDrone()
window.ioc.register('@diamondcoreprocessor.com/ConversationDrone', _conversation)
