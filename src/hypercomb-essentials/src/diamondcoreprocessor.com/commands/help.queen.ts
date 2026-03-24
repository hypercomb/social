// diamondcoreprocessor.com/ui/help.queen.ts

import { QueenBee, EffectBus } from '@hypercomb/core'

/**
 * /help — lists all registered queen bees and their commands.
 * First queen bee. Proves out the pattern.
 */
export class HelpQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'help'
  override readonly aliases = ['?', 'commands']

  override description = 'List all available queen bee commands'

  protected execute(_args: string): void {
    const queens = this.#findQueenBees()

    if (queens.length === 0) {
      EffectBus.emit('queen:help', { commands: [] })
      console.log('[/help] No queen bees registered.')
      return
    }

    const commands = queens.map(q => ({
      command: q.command,
      aliases: q.aliases,
      description: q.description ?? '',
    }))

    // emit for UI to pick up (future: render in command line dropdown or overlay)
    EffectBus.emit('queen:help', { commands })

    // also log to console for immediate visibility
    console.group('[/help] Available commands:')
    for (const cmd of commands) {
      const aliasStr = cmd.aliases.length ? ` (aliases: ${cmd.aliases.join(', ')})` : ''
      console.log(`  /${cmd.command}${aliasStr} — ${cmd.description}`)
    }
    console.groupEnd()
  }

  #findQueenBees(): QueenBee[] {
    const keys = list()
    const queens: QueenBee[] = []
    for (const key of keys) {
      const instance = get(key) as any
      if (instance && typeof instance.command === 'string' && typeof instance.invoke === 'function') {
        queens.push(instance as QueenBee)
      }
    }
    return queens
  }
}

const _help = new HelpQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HelpQueenBee', _help)
