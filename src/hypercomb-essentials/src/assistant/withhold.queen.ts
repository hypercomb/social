// assistant/withhold.queen.ts
//
// `withhold` — keep a tile from outside models.
//
//   withhold                 list what is withheld
//   withhold /susan          withhold /susan and everything under it
//   withhold off /susan      stop withholding it
//
// A withheld tile is read only by the participant's own local model: the
// chat's read step refuses a read aimed there for every other provider, and
// leaves it out of what a tree or a find returns. The list is one document
// in the `ai:withheld` pool, held by the shell (hypercomb-shared/core/
// ai-withheld.store.ts); this word asks for it over the bus, since a module
// never imports the shell.
//
// No `machine` declaration: what a model may read is the participant's to
// say, never a model's.
import { QueenBee, EffectBus } from '@hypercomb/core'

export class WithholdQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'withhold'
  override description = 'Keep a tile from outside models — only your own local model may read it'
  override descriptionKey = 'slash.withhold'
  override options = ['/<route>', 'off /<route>']
  override examples = [
    { input: '/withhold /susan', result: 'No outside model can read /susan or anything under it' },
    { input: '/withhold off /susan', result: 'Outside models may read /susan again' },
    { input: '/withhold', result: 'Lists what is withheld' },
  ]

  // A route is the whole argument: no dot is a walk, no word another
  // behaviour's.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const text = args.trim()
    const off = /^off\s+/i.test(text)
    const route = (off ? text.replace(/^off\s+/i, '') : text).trim()
    const answered = new Promise<{ routes?: string[]; changed?: boolean }>(resolve => {
      const stop = EffectBus.on<{ routes?: string[]; changed?: boolean }>('ai:withheld', reply => { stop(); resolve(reply ?? {}) })
      setTimeout(() => { stop(); resolve({}) }, 2_000)
    })
    EffectBus.emit('ai:withhold', route ? { op: off ? 'remove' : 'add', route } : {})
    const reply = await answered
    const routes = reply.routes ?? []
    const message = !reply.routes
      ? 'Withhold — the list is not available here'
      : !route
        ? (routes.length ? `Withheld from outside models: ${routes.join(', ')}` : 'Nothing is withheld from outside models')
        : off
          ? (reply.changed ? `Outside models may read ${route} again` : `${route} was not withheld`)
          : (reply.changed ? `Withheld from outside models: ${route} and everything under it` : `${route} was already withheld`)
    EffectBus.emit('activity:log', { message, icon: '🔒' })
    EffectBus.emit('toast:show', { type: 'info', message })
  }
}

const _withhold = new WithholdQueenBee()
window.ioc.register('@diamondcoreprocessor.com/WithholdQueenBee', _withhold)
