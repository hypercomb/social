// hypercomb-shared/ui/command-line/slash-behaviour.behavior.ts

import type { CommandLineBehavior } from './command-line-behavior'

/**
 * `/behaviour args` → invoke a queen bee by its `command` property.
 *
 * Examples:
 *   "/help"          → invokes the queen bee with command 'help'
 *   "/paste interests" → invokes 'paste' queen bee with args 'interests'
 *   "/?"             → alias for /help
 */
export class SlashBehaviourBehavior implements CommandLineBehavior {

  readonly name = 'slash-behaviour'
  readonly operations = [
    {
      trigger: 'Enter',
      pattern: /^\/.+/,
      description: 'Invoke a queen bee slash behaviour',
      examples: [
        { input: '/help', key: 'Enter', result: 'Lists all available queen bee behaviours' },
        { input: '/? ', key: 'Enter', result: 'Alias for /help' },
      ]
    }
  ]

  match(event: KeyboardEvent, input: string): boolean {
    if (event.key !== 'Enter' || event.shiftKey) return false
    if (!input.startsWith('/') || input.length < 2) return false

    // only match if a queen bee recognizes the behaviour — otherwise fall through
    // to path-based behaviors (e.g. /folder/ for navigation)
    const behaviourName = this.#extractBehaviourName(input)
    return this.#findQueen(behaviourName) !== null
  }

  async execute(input: string): Promise<void> {
    const behaviourName = this.#extractBehaviourName(input)
    const args = this.#extractArgs(input)

    const queen = this.#findQueen(behaviourName)
    if (!queen) {
      console.warn(`[/] Unknown behaviour: ${behaviourName}`)
      return
    }

    await queen.invoke(args)
  }

  /** Extract behaviour name from input, handling both `/cmd args` and `/cmd[args]` syntax. */
  #extractBehaviourName(input: string): string {
    const stripped = input.slice(1).trim()
    // bracket syntax: /delete[items] → behaviour is 'delete'
    const bracketIdx = stripped.indexOf('[')
    const spaceIdx = stripped.indexOf(' ')
    // pick whichever delimiter comes first
    const end = bracketIdx >= 0 && (spaceIdx < 0 || bracketIdx < spaceIdx) ? bracketIdx
      : spaceIdx >= 0 ? spaceIdx
      : stripped.length
    return stripped.slice(0, end)
  }

  /** Extract args from input, handling both `/cmd args` and `/cmd[args]` syntax. */
  #extractArgs(input: string): string {
    const stripped = input.slice(1).trim()
    const bracketIdx = stripped.indexOf('[')
    const spaceIdx = stripped.indexOf(' ')
    // bracket syntax: /delete[items] → args is '[items]'
    if (bracketIdx >= 0 && (spaceIdx < 0 || bracketIdx < spaceIdx)) {
      return stripped.slice(bracketIdx)
    }
    return spaceIdx >= 0 ? stripped.slice(spaceIdx + 1).trim() : ''
  }

  #findQueen(behaviourName: string): any | null {
    const keys = list()
    for (const key of keys) {
      const instance = get(key) as any
      if (instance && typeof instance.command === 'string' && typeof instance.invoke === 'function' && typeof instance.matches === 'function') {
        if (instance.matches(behaviourName)) return instance
      }
    }
    return null
  }
}
