// diamondcoreprocessor.com/assistant/llm-api.ts

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

export const MODELS: Record<string, string> = {
  opus: 'claude-opus-4-6',
  o: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  s: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  h: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
  g: 'gemini-2.5-flash',
}

export const API_KEY_STORAGE = 'hc:anthropic-api-key'
export const GEMINI_API_KEY_STORAGE = 'hc:gemini-api-key'

export const getApiKey = (): string | null =>
  localStorage.getItem(API_KEY_STORAGE)

export const getGeminiApiKey = (): string | null =>
  localStorage.getItem(GEMINI_API_KEY_STORAGE)

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

// ── Gemini support (free tier) ────────────────────────

export const callGemini = async (
  model: string,
  systemPrompt: string,
  userMessage: string,
  apiKey: string,
  maxTokens = 4096,
): Promise<string> => {
  const url = `${GEMINI_ENDPOINT}/${model}:generateContent?key=${apiKey}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gemini API ${response.status}: ${text}`)
  }

  const json = await response.json()
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}
