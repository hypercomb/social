// diamondcoreprocessor.com/assistant/conversation.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /chat — open the chat window (ui/chat-window).
 *
 * Syntax:
 *   /chat                          — open, resuming the last conversation
 *   /chat What is TypeScript?      — open and ask, in a new conversation
 *   /chat --model sonnet <message> — pick the tier for it
 *
 * It used to do something else: build a question TILE with a response child
 * tile, over a direct Anthropic call that needed a pasted API key. That made
 * `/chat` a third rival to `/opus` and `/ask`, each with its own transport, its
 * own storage and its own idea of where an answer goes — which is most of why
 * nobody could say what talking to Claude in this app actually did.
 *
 * Now all six commands open the same window. The conversation is the artifact,
 * and it is durable on its own (the `sign('threads')` pool) without minting
 * tiles nobody asked for.
 */
export class ConversationQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'chat'
  override readonly aliases = []
  override description = 'Open the chat — one conversation per chat, history kept'
  override descriptionKey = 'slash.chat'
  override options = ['<message>', '--model <model> <message>']
  override examples = [
    { input: '/chat', result: 'Opens the chat where you left it' },
    { input: '/chat What is TypeScript?', result: 'Opens the chat and asks, in a new conversation' },
  ]

  protected async execute(args: string): Promise<void> {
    const parsed = parseChatArgs(args)
    EffectBus.emit('chat:open', { prefill: parsed.message, ...(parsed.model ? { model: parsed.model } : {}) })
  }
}

// ── arg parsing ──────────────────────────────────────────

function parseChatArgs(args: string): { model?: string; message: string } {
  let remaining = args.trim()
  let model: string | undefined

  // Extract --model flag
  const modelMatch = remaining.match(/--model\s+(\S+)\s*/)
  if (modelMatch) {
    model = modelMatch[1]
    remaining = remaining.replace(modelMatch[0], '').trim()
  }

  return { model, message: remaining }
}

// ── registration ────────────────────────────────────────

const _conversation = new ConversationQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ConversationQueenBee', _conversation)
