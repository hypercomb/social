// diamondcoreprocessor.com/ui/slash-behaviour/slash-behaviour.drone.ts
import { I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import type { SlashBehaviour, SlashBehaviourMatch, SlashBehaviourProvider } from './slash-behaviour.provider.js'

export class SlashBehaviourDrone extends EventTarget {
  #providers: SlashBehaviourProvider[] = []

  addProvider(provider: SlashBehaviourProvider): void {
    this.#providers.push(provider)
    this.#providers.sort((a, b) => b.priority - a.priority)
  }

  all(): SlashBehaviour[] {
    const results: SlashBehaviour[] = []
    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour)
        results.push(localized)
        for (const alias of behaviour.aliases ?? []) {
          results.push({ ...localized, name: alias })
        }
      }
    }
    return results
  }

  match(query: string): SlashBehaviourMatch[] {
    const q = query.toLowerCase().trim()
    const results: SlashBehaviourMatch[] = []

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const localized = this.#localize(behaviour)
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]

        for (const name of names) {
          if (!q || name.startsWith(q)) {
            // each matching name (primary or alias) becomes its own entry
            // so autocomplete sees every reachable name, not just the primary
            results.push({
              behaviour: name === behaviour.name
                ? localized
                : { ...localized, name },
              provider,
            })
          }
        }
      }
    }

    return results
  }

  #localize(behaviour: SlashBehaviour): SlashBehaviour {
    if (!behaviour.descriptionKey) return behaviour
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    if (!i18n) return behaviour
    const translated = i18n.t(behaviour.descriptionKey)
    if (translated === behaviour.descriptionKey) return behaviour
    return { ...behaviour, description: translated }
  }

  complete(behaviourName: string, args: string): readonly string[] {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name) && provider.complete) {
          return provider.complete(behaviour.name, args)
        }
      }
    }
    return []
  }

  execute(behaviourName: string, args: string): Promise<void> | void {
    const name = behaviourName.toLowerCase().trim()

    for (const provider of this.#providers) {
      for (const behaviour of provider.behaviours) {
        const names = [behaviour.name, ...(behaviour.aliases ?? [])]
        if (names.includes(name)) {
          return provider.execute(name, args)
        }
      }
    }
  }
}

// ── registration ────────────────────────────────────────

const _slashBehaviours = new SlashBehaviourDrone()

// ── auto-discovery of QueenBees ─────────────────────────
//
// The queen class IS the source of truth. SlashBehaviourDrone auto-wraps
// any registered QueenBee into a provider at call time, reading fields
// live from the queen instance — so there is no way for a provider to
// drift out of sync with its queen. New queens don't need a mirror class;
// they just register in IoC.
//
// Precedence: manual providers (above) win if they declare the same command
// name. This lets legacy queens keep their manual provider until migrated.

const autoWrappedCommands = new Set<string>()

const isQueen = (value: unknown): value is {
  command: string
  aliases?: readonly string[]
  description?: string
  descriptionKey?: string
  invokedAs?: string
  invoke: (args: string) => Promise<void> | void
  slashComplete?: (args: string) => readonly string[]
} => {
  return !!value
    && typeof (value as any).command === 'string'
    && typeof (value as any).invoke === 'function'
}

const alreadyDeclared = (command: string): boolean => {
  return _slashBehaviours.all().some(b => b.name === command)
}

const wrapQueen = (queen: ReturnType<typeof isQueen> extends true ? never : any): SlashBehaviourProvider => ({
  name: `auto-${queen.command}`,
  priority: 50, // below manual providers — they win on command-name ties
  behaviours: [{
    name: queen.command,
    description: queen.description ?? queen.command,
    descriptionKey: queen.descriptionKey,
    aliases: queen.aliases ?? [],
  }],
  execute(behaviourName: string, args: string): Promise<void> | void {
    queen.invokedAs = behaviourName
    return queen.invoke(args)
  },
  complete: typeof queen.slashComplete === 'function'
    ? (_behaviourName: string, args: string) => queen.slashComplete(args)
    : undefined,
} as SlashBehaviourProvider)

const considerQueen = (value: unknown): void => {
  if (!isQueen(value)) return
  if (autoWrappedCommands.has(value.command)) return
  if (alreadyDeclared(value.command)) return
  autoWrappedCommands.add(value.command)
  _slashBehaviours.addProvider(wrapQueen(value))
}

// Scan queens that registered before the drone itself was set up.
for (const key of window.ioc.list()) {
  considerQueen(window.ioc.get(key))
}

// Subscribe to future registrations so dynamically-loaded queens auto-wire too.
window.ioc.onRegister((_key, value) => considerQueen(value))
window.ioc.register('@diamondcoreprocessor.com/SlashBehaviourDrone', _slashBehaviours)
