// diamondcoreprocessor.com/assistant/conversation.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /chat — multi-turn conversation with Claude.
 *
 * Syntax:
 *   /chat What is TypeScript?                    — start new thread
 *   /chat(threadId) Tell me about interfaces     — continue existing thread
 *   /chat --model sonnet What is TypeScript?     — specify model
 */
export class ConversationQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'chat'
  override readonly aliases = ['c', 'ask']
  override description = 'Multi-turn conversation with Claude — creates thread tiles with Q&A children'

  protected async execute(args: string): Promise<void> {
    const parsed = parseChatArgs(args)
    if (!parsed.message) {
      console.warn('[chat] No message provided')
      return
    }

    EffectBus.emit('conversation:send', {
      threadId: parsed.threadId,
      message: parsed.message,
      model: parsed.model,
    })
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseChatArgs(args: string): {
  threadId?: string
  model?: string
  message: string
} {
  let remaining = args.trim()
  let threadId: string | undefined
  let model: string | undefined

  // Extract (threadId) prefix
  const threadMatch = remaining.match(/^\(([0-9a-f]+)\)\s*/)
  if (threadMatch) {
    threadId = threadMatch[1]
    remaining = remaining.slice(threadMatch[0].length)
  }

  // Extract --model flag
  const modelMatch = remaining.match(/--model\s+(\S+)\s*/)
  if (modelMatch) {
    model = modelMatch[1]
    remaining = remaining.replace(modelMatch[0], '').trim()
  }

  return { threadId, model, message: remaining }
}

// ── registration ────────────────────────────────────────

const _conversation = new ConversationQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ConversationQueenBee', _conversation)
