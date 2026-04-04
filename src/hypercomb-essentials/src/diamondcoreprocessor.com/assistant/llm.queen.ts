// diamondcoreprocessor.com/assistant/llm.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { MODELS, API_KEY_STORAGE, getApiKey, callAnthropic } from './llm-api.js'

const SYSTEM_PROMPT = `You are an assistant integrated into a spatial knowledge graph called Hypercomb.
You receive context gathered from content-addressed lineages (folder paths) and signatures (SHA-256 hashes).
Respond concisely and helpfully based on the provided context. Your response will be stored as a content-addressed resource.`

/**
 * /opus, /sonnet, /haiku — send selected tiles + context refs to Claude API.
 *
 * Syntax:
 *   /select[tiles]/opus('[lineage1, lineage2]')
 *   /select[tiles]/sonnet('[sig1, sig2]')
 *   /select[tiles]/haiku('[lineage]')
 *
 * The queen's responsibility ends at: call API → store resource → emit effect.
 * Downstream systems (history recorder) handle attaching the response sig to
 * tile properties via history ops, enabling undo/redo.
 */
export class LlmQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'opus'
  override readonly aliases = []
  override description = 'Send context to a Claude LLM and store the response as a resource'

  /** Set by the provider before invoke() to select which model to use */
  activeModel = 'opus'

  protected async execute(args: string): Promise<void> {
    const apiKey = getApiKey()
    if (!apiKey) {
      console.warn(`[llm] No API key. Set via: localStorage.setItem('${API_KEY_STORAGE}', 'sk-ant-...')`)
      EffectBus.emit('llm:api-key-required', {})
      return
    }

    const contextRefs = parseLlmArgs(args)

    const selection = get('@diamondcoreprocessor.com/SelectionService') as
      { selected: ReadonlySet<string> } | undefined
    const targets = selection ? Array.from(selection.selected) : []

    if (targets.length === 0) {
      console.warn('[llm] No tiles selected')
      return
    }

    const model = MODELS[this.activeModel.toLowerCase()] ?? MODELS['opus']

    EffectBus.emit('llm:request-start', { model, targets, contextRefs })

    try {
      const context = await gatherContext(contextRefs)
      const userMessage = context || `Selected tiles: ${targets.join(', ')}`
      const responseText = await callAnthropic(model, SYSTEM_PROMPT, userMessage, apiKey)

      // Store response as content-addressed resource
      const store = get('@hypercomb.social/Store') as
        { putResource: (blob: Blob) => Promise<string> } | undefined
      if (!store) {
        console.warn('[llm] Store not available')
        return
      }

      const blob = new Blob([responseText], { type: 'text/plain' })
      const sig = await store.putResource(blob)

      // Emit — downstream history recorder handles tile property attachment
      EffectBus.emit('llm:response', { model, targets, sig, contextRefs })
      EffectBus.emit('llm:request-done', { model, targets, success: true })
      console.log(`[llm] ${this.activeModel} response stored: ${sig.slice(0, 12)}...`)
    } catch (err: any) {
      EffectBus.emit('llm:error', { message: err?.message ?? 'Unknown error' })
      EffectBus.emit('llm:request-done', { model, targets, success: false })
      console.warn('[llm] Request failed:', err)
    }
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseLlmArgs(args: string): string[] {
  const trimmed = args.trim()
  if (!trimmed) return []

  // Match: ('[ref1, ref2]') or ('ref1')
  const parenMatch = trimmed.match(/^\('(.+)'\)$/)
  if (parenMatch) {
    const inner = parenMatch[1]
    // Bracket list: [ref1, ref2, ...]
    const bracketMatch = inner.match(/^\[(.+)\]$/)
    if (bracketMatch) {
      return bracketMatch[1].split(',').map(s => s.trim()).filter(Boolean)
    }
    // Single reference
    return [inner.trim()]
  }

  // Fallback: bare args as a single ref
  if (trimmed) return [trimmed]
  return []
}

// ── context gathering ────────────────────────────────────

const SIG_PATTERN = /^[0-9a-f]{64}$/

async function gatherContext(refs: string[]): Promise<string> {
  const sections: string[] = []

  for (const ref of refs) {
    try {
      if (SIG_PATTERN.test(ref)) {
        // Signature: read from __resources__
        const store = get('@hypercomb.social/Store') as
          { getResource: (sig: string) => Promise<Blob | null> } | undefined
        const blob = await store?.getResource(ref)
        if (blob) {
          const text = await blob.text()
          sections.push(`## Resource ${ref.slice(0, 12)}...\n${text}`)
        }
      } else {
        // Lineage: walk OPFS path and read cells
        const lineageContext = await readLineageContext(ref)
        if (lineageContext) {
          sections.push(`## Lineage: ${ref}\n${lineageContext}`)
        }
      }
    } catch (err) {
      console.warn(`[llm] Failed to gather context for ${ref}:`, err)
    }
  }

  return sections.join('\n\n')
}

async function readLineageContext(_lineagePath: string): Promise<string | null> {
  // directory-based lineage context removed
  return null
}

// ── registration ────────────────────────────────────────

const _llm = new LlmQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LlmQueenBee', _llm)
