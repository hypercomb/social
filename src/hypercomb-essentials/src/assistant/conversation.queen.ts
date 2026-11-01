// assistant/conversation.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'
import { listRailConversations, tileConvoId } from './chat-thread.js'
import { chatPathCompletions, chatPathOf } from './chat-path.js'
import { CHAT_LAYER_FACE, chatLayerFace } from './chat-layer-face.js'

/**
 * /chat — open the chat window (ui/chat-window).
 *
 * Syntax:
 *   /chat                          — open, resuming the last conversation
 *   /chat /path/to/tile            — open that tile's conversation
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
  override description = 'Open the chat — one conversation per chat, history kept'
  override descriptionKey = 'slash.chat'
  override options = ['<message>', '/<path>', '--model <model> <message>']
  override examples = [
    { input: '/chat', result: 'Opens the chat where you left it' },
    { input: '/chat /work/press-kit', result: 'Opens the conversation for that tile' },
    { input: '/chat What is TypeScript?', result: 'Opens the chat and asks, in a new conversation' },
  ]

  // THE QUESTION IS PROSE, VERBATIM. A question quoting code — 'const
  // blocked = ...;' — was read as the line's own grammar and never reached
  // the chat (jwize's drive session, 2026-10-01): no dot is a walk, no colon
  // a tag, no quote a literal, and no word in it another behaviour's.
  override rawArgs = true

  override slashComplete(args: string): readonly string[] {
    void refreshChatPaths()
    return chatPathCompletions(args, chatPaths)
  }

  protected async execute(args: string): Promise<void> {
    const path = chatPathOf(args)
    if (path) {
      EffectBus.emit('chat:open', { convoId: tileConvoId(path.split('/').filter(Boolean)) })
      return
    }
    const parsed = parseChatArgs(args)
    EffectBus.emit('chat:open', { prefill: parsed.message, ...(parsed.model ? { model: parsed.model } : {}) })
  }
}

let chatPaths: readonly string[] = []
let chatPathsRunning = false
let chatPathsAgain = false

/** One walk of the pool at a time. A change during the walk runs once more. */
const refreshChatPaths = (): void => {
  if (chatPathsRunning) { chatPathsAgain = true; return }
  chatPathsRunning = true
  void listRailConversations()
    .then(rows => { chatPaths = rows.filter(row => !row.archived).map(row => row.path) })
    .catch(() => { /* a missing pool offers no paths */ })
    .finally(() => {
      chatPathsRunning = false
      if (!chatPathsAgain) return
      chatPathsAgain = false
      refreshChatPaths()
    })
}

EffectBus.on('chat:threads-changed', () => { void refreshChatPaths() })

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
window.ioc.register(CHAT_LAYER_FACE, chatLayerFace)
