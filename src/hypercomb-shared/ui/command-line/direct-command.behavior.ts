// hypercomb-shared/ui/command-line/direct-command.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'

/**
 * Bare-word queen bee commands — no prefix.
 *
 * When the user types a word that matches a registered queen bee's
 * `command` or `aliases`, it's invoked directly. No `/`, no ceremony —
 * the queen speaks and the hive acts.
 *
 * Examples:
 *   "debug"       → toggles the Pixi debug overlay
 *   "help"        → lists available commands
 *
 * This behavior must be registered LAST among pluggable behaviors
 * so it only fires when no other behavior (slash, hash, delete, etc.)
 * has claimed the input. If the bare word doesn't match any queen bee,
 * it falls through to cell creation.
 */
export class DirectCommandBehavior implements CommandLineBehavior {

  readonly name = 'direct-command'
  readonly operations = [
    {
      trigger: 'Enter',
      // bare word(s), no prefix characters that other behaviors claim
      pattern: /^[a-zA-Z][a-zA-Z0-9\-]*(\s.*)?$/,
      description: 'Invoke a queen bee command by name (no prefix)',
      examples: [
        { input: 'debug', key: 'Enter', result: 'Toggles the Pixi debug overlay' },
        { input: 'help', key: 'Enter', result: 'Lists all available commands' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false

    const trimmed = input.trim()
    if (!trimmed || trimmed.length < 2) return false

    // skip inputs claimed by other behaviors
    if (trimmed.startsWith('/') || trimmed.startsWith('~') || trimmed.startsWith('[')
      || trimmed.startsWith('#') || trimmed.startsWith('..') || trimmed.includes(':')) return false

    // extract the command word (first token)
    const spaceIndex = trimmed.indexOf(' ')
    const commandName = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)

    return this.#findQueen(commandName) !== null
  }

  async execute(input: string): Promise<void> {
    const trimmed = input.trim()
    const spaceIndex = trimmed.indexOf(' ')
    const commandName = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)
    const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

    const queen = this.#findQueen(commandName)
    if (!queen) {
      console.warn(`[direct] Unknown command: ${commandName}`)
      return
    }

    await queen.invoke(args)
  }

  #findQueen(commandName: string): any | null {
    const keys = list()
    for (const key of keys) {
      const instance = get(key) as any
      if (instance && typeof instance.command === 'string' && typeof instance.invoke === 'function' && typeof instance.matches === 'function') {
        if (instance.matches(commandName)) return instance
      }
    }
    return null
  }
}
