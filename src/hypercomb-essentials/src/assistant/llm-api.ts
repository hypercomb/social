// assistant/llm-api.ts
//
// BACK-COMPAT SHIM. This file used to BE the AI layer: one endpoint, one
// vendor, `x-api-key` written out three times. All of that now lives behind
// the provider registry (`llm-provider-registry.ts` + `providers/`) and the
// one dispatch seam (`llm-dispatch.ts`).
//
// What remains here is the old surface, re-expressed over the new one, so the
// three callers that still import it keep working while they migrate:
//
//   commands/translation.service.ts        callAnthropic, callAnthropicBatch, getApiKey, MODELS
//   diamond-core-processor layer-edit-ai   callAnthropicMultiTurn, getApiKey, ChatMessage
//   assistant/ai-key.drone.ts              (migrated — reads LlmKeyStore now)
//
// New code calls `callModel` / `streamModel` and names a provider. Nothing
// new should import this file; when the two callers above move, it goes.

import { llmKeyStore } from '@hypercomb/core'
import { callModel } from './llm-dispatch.js'
import { ANTHROPIC_PROVIDER } from './providers/anthropic.provider.js'
import type { LlmCallResult, LlmChatMessage } from './providers/llm-provider.types.js'

/** @deprecated Use the provider descriptor's `models` / `resolveModelId`. */
export type ChatMessage = LlmChatMessage

/** @deprecated Use `LlmCallResult` from the dispatch seam. */
export type LlmResult = LlmCallResult

/**
 * Short model aliases. Derived from the Anthropic descriptor so there is one
 * roster, not two — adding a model to the descriptor adds it here.
 *
 * @deprecated Ask the registry: `registry.resolveModelId(provider, name)`.
 */
export const MODELS: Record<string, string> = Object.fromEntries(
  ANTHROPIC_PROVIDER.models.flatMap(m => [[m.name, m.id], [m.name[0], m.id]]),
)

/**
 * The legacy single-vendor storage key.
 *
 * @deprecated Keys live in the core LlmKeyStore under `hc:llm:<provider>:key`;
 * this slot is a read-only drain source it still honours.
 */
export const API_KEY_STORAGE = 'hc:anthropic-api-key'

/** @deprecated `llmKeyStore.get('anthropic')`. */
export const getApiKey = (): string | null => llmKeyStore.get('anthropic') || null

/** @deprecated `callModel({ providerId: 'anthropic', … })`. */
export const callAnthropic = async (
  model: string,
  systemPrompt: string,
  userMessage: string,
  _apiKey: string,
  maxTokens = 4096,
): Promise<string> => {
  const result = await callModel({
    providerId: 'anthropic',
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens,
  })
  return result.text
}

/** @deprecated `callModel({ providerId: 'anthropic', messages, … })`. */
export const callAnthropicMultiTurn = async (
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  _apiKey: string,
  maxTokens = 4096,
): Promise<LlmResult> =>
  callModel({
    providerId: 'anthropic',
    model,
    system: systemPrompt,
    messages,
    maxTokens,
  })

const BATCH_SYSTEM_PROMPT =
  'You are a translation engine. You will receive a JSON array of strings. ' +
  'Translate each string to the requested target language. ' +
  'Return ONLY a JSON array of translated strings — same length, same order, no commentary, no code fences. ' +
  'Preserve original tone, meaning, technical terms, names, numbers, and URLs. ' +
  'If a string is already in the target language, return it unchanged.'

/**
 * Batched translation. Kept as its own function because of the CONTRACT, not
 * the transport: the assistant must return a JSON array of the same length
 * and order, and a batch that cannot be parsed returns null so the caller
 * falls back per-string rather than shipping garbage.
 *
 * `cacheSystem` marks the (constant) system prompt for prompt caching, which
 * is what made repeated batches to one locale cheap — that behaviour now
 * lives in the Anthropic adapter and every vendor that supports it inherits
 * the hint for free.
 *
 * @deprecated Call `callModel` with `cacheSystem: true` directly.
 */
export const callAnthropicBatch = async (
  model: string,
  targetLocale: string,
  texts: readonly string[],
  _apiKey: string,
): Promise<string[] | null> => {
  if (!texts.length) return []

  const { text: raw } = await callModel({
    providerId: 'anthropic',
    model,
    system: BATCH_SYSTEM_PROMPT,
    cacheSystem: true,
    maxTokens: Math.min(4096, 64 + texts.join('').length * 3),
    messages: [{
      role: 'user',
      content: `Target language: ${targetLocale}\n\nStrings:\n${JSON.stringify(texts)}`,
    }],
  })

  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) {
      console.warn('[callAnthropicBatch] no JSON array in response:', raw.slice(0, 200))
      return null
    }
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) {
      console.warn('[callAnthropicBatch] parsed value is not an array:', parsed)
      return null
    }
    if (parsed.length !== texts.length) {
      console.warn(
        `[callAnthropicBatch] length mismatch: got ${parsed.length}, expected ${texts.length}. `
        + `Input: ${JSON.stringify(texts).slice(0, 200)}. Output: ${JSON.stringify(parsed).slice(0, 200)}`,
      )
      return null
    }
    return parsed.map((s) => String(s))
  } catch (err) {
    console.warn('[callAnthropicBatch] parse failed:', err, 'raw:', raw.slice(0, 300))
    return null
  }
}
