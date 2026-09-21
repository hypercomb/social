// commands/brood.queen.ts
//
// `brood` — the automatons this hive is holding, and what happens to them.
//
//   brood                → open the brood
//   brood list           → say what is held, in the activity log
//   brood read 1         → have a reader go through that one's code
//   brood accept 1       → two warnings, then it may run
//   brood refuse 1       → it stays held and inert
//   brood rules          → what the rules currently do with an arrival
//   brood test mine      → hold your own code too, until you have read it
//   brood trust 3        → how many followed communities stand in for you
//
// Held code is addressed by its ROW NUMBER as the list prints it, or by the
// first characters of its signature. A row number is the citeable form on
// purpose: a participant reading a list should be able to act on it without
// copying 64 hex characters.
//
// Nothing here can accept on its own. `read` is a reading and writes only an
// audit; `accept` goes through the same two warnings the surface shows
// (brood-accept.ts), which is the only door there is.

import {
  broodRoster, broodRules, EffectBus, get, I18N_IOC_KEY, QueenBee, setBroodRules,
  type BroodRecord, type I18nProvider,
} from '@hypercomb/core'
import { acceptByHand, auditLine, broodLabel, refuseByHand } from '../safety/brood-accept.js'

export const BROOD_OPEN = 'brood:open'

const SIG = /^[0-9a-f]{4,64}$/i

export class BroodQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'safety'
  readonly command = 'brood'
  override description =
    'Automatons this hive is holding but will not run — read them, accept one by hand, or set what gets held'
  override descriptionKey = 'slash.brood'
  override options = ['list', 'read <n>', 'accept <n>', 'refuse <n>', 'rules', 'test mine', 'trust <n>']
  override examples = [
    { input: '/brood', result: 'Opens what this hive is holding' },
    { input: '/brood read 1', result: 'Has a reader go through that code and records what it found' },
    { input: '/brood accept 1', result: 'Two warnings, then that automaton may run' },
    { input: '/brood test mine', result: 'Holds your own code too, until you have read it' },
  ]

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    const base = ['list', 'read', 'accept', 'refuse', 'rules', 'test mine', 'test off', 'trust']
    return base.filter(option => !q || option.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const trimmed = String(args ?? '').trim()
    const [verb, ...rest] = trimmed.split(/\s+/)
    const remainder = rest.join(' ').trim()

    switch ((verb ?? '').toLowerCase()) {
      case '':
        EffectBus.emit(BROOD_OPEN, { at: Date.now() })
        return
      case 'list':
        return this.#list()
      case 'read':
      case 'audit':
        return this.#read(remainder)
      case 'accept':
        return this.#accept(remainder)
      case 'refuse':
        return this.#refuse(remainder)
      case 'rules':
        return this.#rules()
      case 'test':
        return this.#test(remainder)
      case 'trust':
        return this.#trust(remainder)
      default:
        // `brood 1` with no verb reads most naturally as "show me that one".
        return SIG.test(verb ?? '') || /^\d+$/.test(verb ?? '') ? this.#read(trimmed) : this.#list()
    }
  }

  /** Held code by row number as `list` prints it, or by signature prefix. */
  async #find(key: string): Promise<BroodRecord | null> {
    const roster = await broodRoster()
    const want = String(key ?? '').trim().toLowerCase()
    if (!want) return null
    const index = Number.parseInt(want, 10)
    if (Number.isFinite(index) && index >= 1 && index <= roster.length) return roster[index - 1] ?? null
    return roster.find(record => record.sig.startsWith(want)) ?? null
  }

  async #list(): Promise<void> {
    const roster = await broodRoster()
    if (!roster.length) {
      this.#say('Nothing is held. Every automaton here has been cleared by your rules.')
      return
    }
    roster.forEach((record, row) => {
      const ruling = record.ruling ? record.ruling.verdict : 'held'
      const vouches = record.vouches.filter(vouch => vouch.verdict === 'accepted').length
      EffectBus.emit('activity:log', {
        message: `${row + 1}. ${broodLabel(record)} — ${ruling}${vouches ? `, ${vouches} vouching` : ''}`,
        icon: record.ruling?.verdict === 'accepted' ? '◆' : '○',
      })
    })
    this.#say(`${roster.length} held — see the activity log, then: brood read 1`)
  }

  async #read(key: string): Promise<void> {
    const record = await this.#find(key)
    if (!record) return this.#say(`Nothing held under "${key}".`, 'error')
    this.#say(`Reading ${broodLabel(record)}…`)
    try {
      // Loaded only when asked: a participant who never reads held code never
      // evaluates the audit stack, and never reaches a model.
      const { auditHeldBee } = await import('../safety/brood-audit.js')
      const after = await auditHeldBee(record.sig)
      this.#say(after ? auditLine(after) : 'Nothing came back.')
    } catch (error) {
      this.#say(`Could not read it: ${(error as Error)?.message ?? 'unknown'}`, 'error')
    }
  }

  async #accept(key: string): Promise<void> {
    const record = await this.#find(key)
    if (!record) return this.#say(`Nothing held under "${key}".`, 'error')
    const ruled = await acceptByHand(record)
    this.#say(ruled
      ? `${broodLabel(ruled)} may run. It loads on the next boot.`
      : `${broodLabel(record)} stays held.`, ruled ? 'success' : 'info')
  }

  async #refuse(key: string): Promise<void> {
    const record = await this.#find(key)
    if (!record) return this.#say(`Nothing held under "${key}".`, 'error')
    await refuseByHand(record)
    this.#say(`${broodLabel(record)} stays held and will not run.`)
  }

  async #rules(): Promise<void> {
    const rules = await broodRules()
    this.#say([
      `Your own code: ${rules.own === 'hold' ? 'held until you accept it' : 'runs'}.`,
      `A community you follow: ${rules.followed === 'hold' ? 'held' : 'runs'}.`,
      `A stranger: ${rules.stranger === 'refuse' ? 'refused' : 'held'}.`,
      rules.vouchesNeeded > 0
        ? `${rules.vouchesNeeded} followed communities accepting stands in for you.`
        : 'No number of vouches stands in for you.',
    ].join(' '))
  }

  async #test(what: string): Promise<void> {
    const off = /^(off|no|never)$/i.test(what.trim())
    const rules = await setBroodRules({ own: off ? 'run' : 'hold' })
    this.#say(rules.own === 'hold'
      ? 'Your own code is held now, so you can read it before it runs.'
      : 'Your own code runs as soon as it arrives.')
  }

  async #trust(count: string): Promise<void> {
    const wanted = Number.parseInt(String(count ?? '').trim(), 10)
    if (!Number.isFinite(wanted) || wanted < 0) {
      return this.#say('Say how many followed communities stand in for you: brood trust 2', 'error')
    }
    const rules = await setBroodRules({ vouchesNeeded: wanted })
    this.#say(rules.vouchesNeeded > 0
      ? `${rules.vouchesNeeded} followed communities accepting now stands in for your hand.`
      : 'Only your own hand accepts anything now.')
  }

  #t(key: string, fallback: string): string {
    const i18n = get(I18N_IOC_KEY) as I18nProvider | undefined
    return i18n?.t(key, {}) || fallback
  }

  #say(message: string, type: 'info' | 'error' | 'success' = 'info'): void {
    EffectBus.emit('toast:show', { type, title: this.#t('brood.title', 'The brood'), message })
  }
}

// ── registration ────────────────────────────────────────

const _brood = new BroodQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BroodQueenBee', _brood)
