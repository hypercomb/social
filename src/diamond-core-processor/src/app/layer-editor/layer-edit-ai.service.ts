// diamond-core-processor/src/app/layer-editor/layer-edit-ai.service.ts

import { Injectable } from '@angular/core'
import {
  callAnthropicMultiTurn,
  getApiKey,
  MODELS,
  type ChatMessage,
} from '../../../../hypercomb-essentials/src/diamondcoreprocessor.com/assistant/llm-api.js'

export type AiEditChange = {
  signature: string
  modifiedSource: string
}

export type AiEditResult = {
  explanation: string
  changes: AiEditChange[]
  inputTokens: number
  outputTokens: number
}

export type FileContext = {
  signature: string
  name: string
  source: string
  kind: string
}

const SYSTEM_PROMPT = `You are a code editor integrated into a content-addressed module system. You modify source files that are identified by their SHA-256 signature.

When the user asks you to make changes, respond with a JSON block containing your explanation and the modified files. Only include files you actually changed.

IMPORTANT: Return your response in this exact format — a single JSON code block:

\`\`\`json
{
  "explanation": "Brief description of what was changed and why",
  "changes": [
    {
      "signature": "the original file signature",
      "modifiedSource": "the complete modified source code"
    }
  ]
}
\`\`\`

Rules:
- Each change must reference a file by its original signature from the context provided
- Include the COMPLETE modified source, not a diff or partial update
- Only modify files within the provided context — do not create new files
- If no code changes are needed (e.g. the user asked a question), return an empty changes array
- Use private class fields (#field) instead of the private keyword
- Use ESM imports with .js extensions for relative paths
- Keep changes minimal and focused on what was requested`

@Injectable({ providedIn: 'root' })
export class LayerEditAiService {

  async requestEdit(params: {
    instruction: string
    files: FileContext[]
    lineageDescription: string
    history: ChatMessage[]
    model?: string
  }): Promise<AiEditResult> {
    const apiKey = getApiKey()
    if (!apiKey) throw new Error('Anthropic API key not configured (localStorage hc:anthropic-api-key)')

    const model = MODELS[params.model ?? 'sonnet'] ?? MODELS['sonnet']

    const contextBlock = params.files.map(f =>
      `<file signature="${f.signature}" name="${f.name}" kind="${f.kind}">\n${f.source}\n</file>`
    ).join('\n\n')

    const userMessage = `## Context

Lineage: ${params.lineageDescription}

${contextBlock}

## Instruction

${params.instruction}`

    const messages: ChatMessage[] = [
      ...params.history,
      { role: 'user', content: userMessage },
    ]

    const result = await callAnthropicMultiTurn(model, SYSTEM_PROMPT, messages, apiKey, 8192)

    return {
      ...this.#parseResponse(result.text),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }
  }

  #parseResponse(text: string): { explanation: string; changes: AiEditChange[] } {
    // try to extract JSON from a code block
    const jsonBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/)
    if (jsonBlockMatch) {
      try {
        const parsed = JSON.parse(jsonBlockMatch[1])
        return {
          explanation: parsed.explanation ?? '',
          changes: Array.isArray(parsed.changes) ? parsed.changes : [],
        }
      } catch { /* fall through */ }
    }

    // try parsing the whole response as JSON
    try {
      const parsed = JSON.parse(text)
      if (parsed.explanation !== undefined || parsed.changes !== undefined) {
        return {
          explanation: parsed.explanation ?? '',
          changes: Array.isArray(parsed.changes) ? parsed.changes : [],
        }
      }
    } catch { /* fall through */ }

    // treat as explanation only (no code changes)
    return { explanation: text, changes: [] }
  }
}
