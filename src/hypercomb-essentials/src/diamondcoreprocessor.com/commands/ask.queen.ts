// diamondcoreprocessor.com/commands/ask.queen.ts
//
// /ask — talk to your host's AI and get an answer immediately.
//
// Syntax:
//   /ask <question>        — stream an answer from the host AI (Haiku tier)
//   /ask host <domain>     — point at a different AI host (bare domain)
//   /ask host              — show the current AI host
//
// The transport, auth, and streaming live in HostAiService; this queen is
// the slash surface. Answers stream onto the `ai:answer` EffectBus channel
// (any chat surface can subscribe); this queen renders the minimal default:
// a progress toast while streaming, the full answer as a sticky toast +
// console line when done.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { HOST_AI_IOC_KEY } from '../assistant/host-ai.service.js'
import type { HostAiService } from '../assistant/host-ai.service.js'

export class AskQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'ask'
  override readonly aliases = []
  override description = 'Ask the host AI — immediate streamed answer'
  override descriptionKey = 'slash.ask'
  override options = []
  override examples = [
    { input: '/ask what is this hive about?', result: 'Streams a short answer from the host AI' },
    { input: '/ask host content.jwize.com', result: 'Point at a different AI host' },
  ]

  #busy = false

  protected execute(args: string): void {
    const raw = args.trim()
    const svc = get(HOST_AI_IOC_KEY) as HostAiService | undefined
    if (!svc) {
      console.warn('[/ask] HostAiService not available')
      return
    }

    // host subcommand — configuration, no spend.
    if (raw.toLowerCase() === 'host' || raw.toLowerCase().startsWith('host ')) {
      const domain = raw.slice(4).trim()
      if (!domain) {
        EffectBus.emit('toast:show', { type: 'info', message: `AI host: ${svc.host}` })
        return
      }
      svc.setHost(domain)
      EffectBus.emit('toast:show', { type: 'success', message: `AI host set to ${svc.host}` })
      return
    }

    if (!raw) {
      EffectBus.emit('toast:show', { type: 'info', message: 'Ask something: /ask <question>' })
      return
    }
    if (this.#busy) {
      EffectBus.emit('toast:show', { type: 'warning', message: 'Still answering the previous ask…' })
      return
    }
    void this.#run(svc, raw)
  }

  async #run(svc: HostAiService, question: string): Promise<void> {
    this.#busy = true
    EffectBus.emit('toast:show', { type: 'tip', message: 'Asking…', duration: 2_500 })
    try {
      const answer = await svc.askText(question)
      const trimmed = answer.trim()
      console.log(`[/ask] Q: ${question}\nA: ${trimmed}`)
      EffectBus.emit('toast:show', {
        type: 'success',
        title: 'Host AI',
        // Sticky (duration 0) so a real answer can actually be read; the
        // toast's own dismiss is the way out. Long answers are clipped —
        // the full text is on the console and the ai:answer bus.
        message: trimmed.length > 600 ? trimmed.slice(0, 600) + ' …' : trimmed,
        duration: 0,
      })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      EffectBus.emit('toast:show', { type: 'warning', title: 'Host AI', message: reason })
    } finally {
      this.#busy = false
    }
  }
}

const _ask = new AskQueenBee()
window.ioc.register('@diamondcoreprocessor.com/AskQueenBee', _ask)
