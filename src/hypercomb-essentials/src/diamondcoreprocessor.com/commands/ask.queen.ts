// diamondcoreprocessor.com/commands/ask.queen.ts
//
// /ask — open the chat and ask.
//
// Syntax:
//   /ask <question>        — open the chat window and ask it
//   /ask                   — open the chat window
//   /ask host <domain>     — point at a different AI host (bare domain)
//   /ask host              — show the current AI host
//
// The answer used to arrive as a STICKY TOAST and nowhere else: unsearchable,
// unscrollable, clipped at 600 characters, gone on dismiss, and with the full
// text only on the console. It was also the third place in this app where
// talking to Claude could happen, each with its own window and its own idea of
// where an answer goes.
//
// So the question now goes to the chat window (ui/chat-window) like every other
// one, and the answer lands in a durable thread. The TRANSPORT is unchanged —
// the window still streams from HostAiService when no session is on the bridge,
// which is exactly what this command always did. Only the surface moved.
//
// `host` stays here: it is configuration, not a question, and it is what names
// the endpoint the shallow tier streams from.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { HOST_AI_IOC_KEY } from '../assistant/host-ai.service.js'
import type { HostAiService } from '../assistant/host-ai.service.js'

export class AskQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'ask'
  override readonly aliases = []
  override description = 'Open the chat and ask'
  override descriptionKey = 'slash.ask'
  override options = ['<question>', 'host <domain>']
  override examples = [
    { input: '/ask what is this hive about?', result: 'Opens the chat and asks' },
    { input: '/ask host content.jwize.com', result: 'Point at a different AI host' },
  ]

  protected execute(args: string): void {
    const raw = args.trim()

    // host subcommand — configuration, no spend, and the only thing left here.
    if (raw.toLowerCase() === 'host' || raw.toLowerCase().startsWith('host ')) {
      const svc = get(HOST_AI_IOC_KEY) as HostAiService | undefined
      if (!svc) {
        console.warn('[/ask] HostAiService not available')
        return
      }
      const domain = raw.slice(4).trim()
      if (!domain) {
        EffectBus.emit('toast:show', { type: 'info', message: `AI host: ${svc.host}` })
        return
      }
      svc.setHost(domain)
      EffectBus.emit('toast:show', { type: 'success', message: `AI host set to ${svc.host}` })
      return
    }

    // A bare `/ask` opens the window rather than scolding — there is somewhere
    // to go now, so "Ask something: /ask <question>" is one refusal too many.
    EffectBus.emit('chat:open', { prefill: raw })
  }
}

const _ask = new AskQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AskQueenBee', _ask)
