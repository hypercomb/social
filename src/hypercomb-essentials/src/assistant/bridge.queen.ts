// assistant/bridge.queen.ts
//
// `bridge` — who besides this machine may use the Claude bridge.
//
//   bridge                                list the codes: fingerprint and name
//   bridge give <name>                    mint a code for someone; copied once, never shown again
//   bridge add <name>                     hold a code they already have — asked for, never read from the line
//   bridge withdraw <fingerprint|name>    that code stops working at once
//
// The broker (scripts/bridge/run-bridge.cjs) serves this machine's own tools
// — a loopback Node client that sends no Origin — and nobody else unless they
// present a code: a remote answering session, and every browser page. With no
// codes, nobody else gets in. Codes are secrets: the store keeps only their
// SHA-256 (hypercomb-core/src/core/llm-keys.ts `BridgeCodeStore`), the
// renderer tab hands the broker those hashes (claude-bridge.worker.ts), and
// the one moment a code exists in the clear is `give`, which copies it and
// says so — no toast, log or event ever carries it. That is why `add` asks
// for the code in a prompt: the command line keeps a history of every line
// as typed, before this queen is handed it. So `give` and `add` take the
// name and nothing after it: a line that carries more (`bridge add susan
// <code>`, the natural slip) does nothing, asks the history to cut that line
// back to its name (`command-history:forget`, transient — the words, never
// the code) and says so.
//
// `machine.refuse` refuses every form. Who may reach this machine is the
// participant's to say, never a model's and never a bridge `submit`'s — and a
// declared `machine` block keeps this queen awake, so the remote door finds
// the refusal on her rather than a sleeping stand-in that would run the word.
//
// Documentation: documentation/claude-bridge-setup.md, "Who may use the
// bridge — codes".
import {
  QueenBee, EffectBus, I18N_IOC_KEY, BRIDGE_CODE_STORE_IOC_KEY, bridgeCodeStore,
  type I18nProvider, type MachineGrammar, type BridgeCodeStore, type BridgeCodeRefusal,
} from '@hypercomb/core'

const SUB_WORDS = ['give', 'add', 'withdraw'] as const

/** The store the shell holds, or core's own when no shell registry answers. */
const codeStore = (): BridgeCodeStore | undefined =>
  (window.ioc?.get?.(BRIDGE_CODE_STORE_IOC_KEY) as BridgeCodeStore | undefined) ?? bridgeCodeStore

const t = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
  const value = i18n?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

const toast = (message: string, type: 'info' | 'success' | 'warning' = 'info'): void => {
  EffectBus.emit('toast:show', { type, message })
}

/** The one refusal, for every form a machine might say. */
export const bridgeMachineRefusal = (): string =>
  t('bridge.machine-refused', 'Bridge codes decide who may reach this machine — only the participant gives, adds or withdraws one, at the keyboard')

export class BridgeQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'bridge'
  override description = 'Who besides this machine may use the Claude bridge — give someone a code, add one, list them, withdraw one'
  override descriptionKey = 'slash.bridge'
  override options = ['give <name>', 'add <name>', 'withdraw <fingerprint|name>']
  override examples = [
    { input: '/bridge', result: 'Lists the bridge codes by fingerprint and name' },
    { input: '/bridge give susan', result: 'Copies a new code for susan — it is never shown again' },
    { input: '/bridge withdraw susan', result: "susan's code stops working at once" },
  ]

  // Everything after the word is this word's, verbatim: a name is not a walk,
  // and no word after `bridge` is another behaviour's.
  override rawArgs = true

  override machine: MachineGrammar = {
    forms: 'give <name> | add <name> | withdraw <fingerprint|name>',
    example: '/bridge',
    // A ceiling: `withdraw` takes a code away; all of it stays on this
    // machine (the store, and the broker the renderer tells).
    reach: 'destructive',
    scope: 'local',
    consequence: 'refused for every caller but the participant at the keyboard',
    refuse: () => bridgeMachineRefusal(),
  }

  // The sub-words first; after `withdraw`, the names and fingerprints held.
  override slashComplete(args: string): readonly string[] {
    const words = args.trimStart().split(/\s+/)
    const verb = (words[0] ?? '').toLowerCase()
    if (words.length === 1) {
      return SUB_WORDS.map(word => `${word} `).filter(word => word.startsWith(verb) && word.trim() !== verb)
    }
    if (words.length === 2 && verb === 'withdraw') {
      const typed = (words[1] ?? '').toLowerCase()
      const held = codeStore()?.list() ?? []
      const offers = [...held.map(entry => entry.label), ...held.map(entry => entry.fingerprint)]
      return offers.filter(offer => offer.toLowerCase().startsWith(typed) && offer.toLowerCase() !== typed)
    }
    return []
  }

  protected async execute(args: string): Promise<void> {
    const store = codeStore()
    if (!store) { toast(t('bridge.unavailable', 'Bridge codes are not kept here'), 'warning'); return }
    const [word = '', name = '', ...after] = args.trim().split(/\s+/).filter(Boolean)
    const verb = word.toLowerCase()

    if (!verb) { this.#list(store); return }
    if (!SUB_WORDS.includes(verb as typeof SUB_WORDS[number]) || !name) {
      toast(t('bridge.usage', 'bridge · bridge give <name> · bridge add <name> · bridge withdraw <fingerprint|name>'), 'warning')
      return
    }
    if ((verb === 'give' || verb === 'add') && after.length) { this.#lineCarriedMore(verb, name); return }
    if (verb === 'give') { await this.#give(store, name); return }
    if (verb === 'add') { await this.#add(store, name); return }
    this.#withdraw(store, name)
  }

  #list(store: BridgeCodeStore): void {
    const held = store.list()
    if (!held.length) {
      toast(t('bridge.none', "No bridge codes — only this machine's own tools can use the bridge"))
      return
    }
    const codes = held.map(entry => `${entry.fingerprint} ${entry.label}`).join(' · ')
    toast(t('bridge.list', 'Bridge codes: {codes}', { codes }))
  }

  /** The code is in the clear only here, and only on its way to the
   *  clipboard — or, when the clipboard refuses, into a prompt the
   *  participant copies from. Never a toast. */
  async #give(store: BridgeCodeStore, name: string): Promise<void> {
    const given = await store.generate(name)
    if (!given.ok) { this.#refused(given.reason, name); return }
    const { fingerprint } = given
    try {
      await navigator.clipboard.writeText(given.code)
      toast(t('bridge.given', 'Bridge code for {name} ({fingerprint}) copied — it will not be shown again', { name, fingerprint }), 'success')
    } catch {
      window.prompt(t('bridge.copy-manually', 'Copy the bridge code for {name} ({fingerprint}) now — it will not be shown again', { name, fingerprint }), given.code)
      toast(t('bridge.added', '{name} may use the bridge — code {fingerprint}', { name, fingerprint }), 'success')
    }
  }

  /** The code is read from a prompt and nowhere else — the command line
   *  keeps a history. A line that carried more never reaches here. */
  async #add(store: BridgeCodeStore, name: string): Promise<void> {
    const typed = window.prompt(t('bridge.enter-code', 'The bridge code {name} was given', { name }))
    if (typed === null || !typed.trim()) return
    const added = await store.add(name, typed)
    if (!added.ok) { this.#refused(added.reason, name); return }
    toast(t('bridge.added', '{name} may use the bridge — code {fingerprint}', { name, fingerprint: added.fingerprint }), 'success')
  }

  /** `give` and `add` take one word, the name. Whatever followed it — for
   *  `add`, most likely the code itself — is already in the command history
   *  as typed, so that line is cut back to its name there, and nothing is
   *  given, prompted for or added. */
  #lineCarriedMore(verb: 'give' | 'add', name: string): void {
    EffectBus.emitTransient('command-history:forget', { words: `${this.command} ${verb} ${name}` })
    toast(verb === 'add'
      ? t('bridge.code-on-line', 'Not added — a bridge code goes in the prompt, never on the line. The command history keeps only "bridge add {name}"; if anyone saw the code, give {name} a new one instead (bridge give {name})', { name })
      : t('bridge.one-name', 'Not given — bridge give takes one word, the name. The command history keeps only "bridge give {name}"', { name }),
    'warning')
  }

  #withdraw(store: BridgeCodeStore, query: string): void {
    const before = store.list()
    const named = store.withdraw(query)
    if (named === 0) { toast(t('bridge.not-found', 'No bridge code is named {query}', { query }), 'warning'); return }
    if (named > 1) {
      toast(t('bridge.ambiguous', '{query} names {count} bridge codes — say more of the fingerprint', { query, count: named }), 'warning')
      return
    }
    const after = new Set(store.list().map(entry => entry.fingerprint))
    const gone = before.find(entry => !after.has(entry.fingerprint))
    toast(t('bridge.withdrawn', 'Withdrawn: {name} ({fingerprint}) can no longer use the bridge', {
      name: gone?.label ?? query, fingerprint: gone?.fingerprint ?? '',
    }), 'success')
  }

  #refused(reason: BridgeCodeRefusal, name: string): void {
    const message = reason === 'duplicate'
      ? t('bridge.duplicate', 'Not added — {name} already has a bridge code, or that code is already held', { name })
      : reason === 'invalid'
        ? t('bridge.invalid', 'A name is up to 64 characters, and a bridge code 1 to 256 letters, digits or ASCII symbols, with no spaces')
        : t('bridge.unavailable', 'Bridge codes are not kept here')
    toast(message, 'warning')
  }
}

const _bridge = new BridgeQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BridgeQueenBee', _bridge)
