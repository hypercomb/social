// assistant/providers/openrouter.provider.ts
//
// OpenRouter. OpenAI-shaped, and an AGGREGATOR: one key reaches every model
// the router lists, from fractions of a cent per call up to frontier pricing.
// That range is exactly the hazard — `modelForTier` picks the FIRST model in
// this array whose `tier` matches, so whatever sits on `deep`/`balanced` here
// is what an automatic pick or a tier PIN reaches with no further say-so.
//
// THE ROSTER IS THEREFORE DELIBERATELY ECONOMICAL, NOT REPRESENTATIVE. Every
// tier below resolves to a DeepSeek or budget model — never an Anthropic,
// OpenAI, or router `auto` id, and never the model that made OpenRouter's
// homepage. A participant who genuinely wants Opus-via-OpenRouter can still
// name `anthropic/claude-opus-4.1` explicitly when composing a call (explicit
// naming always wins over tier resolution — see `ModelNeed` in
// `model-policy.ts`), but no tier pin or "decide for me" plan can land there
// by surprise. If OpenRouter ever needs a frontier-tier option, it must be a
// SEPARATE explicit choice, never a member of this default ladder.
//
// The optional ranking headers (`HTTP-Referer`, `X-Title`) are deliberately
// NOT sent: they would hand the hive's origin to the router on every call.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export const OPENROUTER_PROVIDER: LlmProviderDescriptor = {
  id: 'openrouter',
  label: 'OpenRouter',
  vendor: 'openrouter',
  transport: 'browser-http',
  endpoint: ENDPOINT,
  models: [
    // Pinned to a dated snapshot rather than a rolling `deepseek-chat` alias
    // on purpose: the alias is OpenRouter's to silently repoint at whatever
    // checkpoint DeepSeek ships next, and this codebase's whole discipline is
    // content addressed by what it actually is, not by a name that can shift
    // under it. GA as of 2026-07-31: sparse MoE, 13B active / 284B total,
    // built for coding, reasoning and agent workflows, $0.05/$0.16 per M
    // tokens in/out — still budget-tier, so it stays on the safety ladder.
    { name: 'deepseek', id: 'deepseek/deepseek-v4-flash-0731', tier: 'balanced' },
    { name: 'deepseek-reasoner', id: 'deepseek/deepseek-r1', tier: 'deep' },
    { name: 'gemini-flash-lite', id: 'google/gemini-2.5-flash-lite', tier: 'fast' },
  ],
  defaultModel: 'deepseek/deepseek-v4-flash-0731',
  docsUrl: 'https://openrouter.ai/settings/keys',
  keyPattern: /^sk-or-v1-[A-Za-z0-9]{32,}$/,
  // OpenRouter passes `cache_control` through to Anthropic and Gemini
  // upstreams (OpenAI upstreams cache prefixes on their own), so the anatomy
  // system turn is sent as a cacheable part. Design: anatomy-context-need §7.
  toRequest: request => openAiRequest(ENDPOINT, request, undefined, { cacheableSystem: true }),
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(OPENROUTER_PROVIDER)
