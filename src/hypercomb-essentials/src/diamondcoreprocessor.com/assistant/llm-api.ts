// diamondcoreprocessor.com/assistant/llm-api.ts

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export const MODELS: Record<string, string> = {
  opus: 'claude-opus-4-6',
  o: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  s: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  h: 'claude-haiku-4-5-20251001',
}

export const API_KEY_STORAGE = 'hc:anthropic-api-key'

export const getApiKey = (): string | null =>
  localStorage.getItem(API_KEY_STORAGE)

export const callAnthropic = async (
  model: string,
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> => {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API ${response.status}: ${text}`)
  }

  const json = await response.json()
  return json.content?.[0]?.text ?? ''
}

// ── multi-turn conversation support ─────────────────────

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export type LlmResult = {
  text: string
  stopReason: string
  inputTokens: number
  outputTokens: number
  model: string
}

// ── batched translation with prompt caching ─────────────
//
// Sends an array of strings in one request. The system prompt is marked
// cache_control: ephemeral so repeated batches to the same locale hit
// the prompt cache (~10× cheaper on the system portion).
//
// Response contract: assistant returns a JSON array of translated strings,
// same length and order as the input array. If parsing fails the batch
// returns null and the caller falls back.

export const callAnthropicBatch = async (
  model: string,
  targetLocale: string,
  texts: readonly string[],
  apiKey: string,
): Promise<string[] | null> => {
  if (!texts.length) return []

  const systemPrompt =
    'You are a translation engine. You will receive a JSON array of strings. ' +
    'Translate each string to the requested target language. ' +
    'Return ONLY a JSON array of translated strings — same length, same order, no commentary, no code fences. ' +
    'Preserve original tone, meaning, technical terms, names, numbers, and URLs. ' +
    'If a string is already in the target language, return it unchanged.'

  const userMessage =
    `Target language: ${targetLocale}\n\n` +
    `Strings:\n${JSON.stringify(texts)}`

  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(4096, 64 + texts.join('').length * 3),
      system: [
        { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API ${response.status}: ${text}`)
  }

  const json = await response.json()
  const raw = json.content?.[0]?.text ?? ''
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

export const callAnthropicMultiTurn = async (
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  apiKey: string,
  maxTokens = 4096,
): Promise<LlmResult> => {
  const response = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Anthropic API ${response.status}: ${text}`)
  }

  const json = await response.json()
  return {
    text: json.content?.[0]?.text ?? '',
    stopReason: json.stop_reason ?? 'end_turn',
    inputTokens: json.usage?.input_tokens ?? 0,
    outputTokens: json.usage?.output_tokens ?? 0,
    model: json.model ?? model,
  }
}
