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
  broodRoster, broodRules, EffectBus, get, I18N_IOC_KEY, mayRunBee, QueenBee, setBroodRules,
  type BroodRecord, type I18nProvider,
} from '@hypercomb/core'
import { acceptByHand, auditLine, broodLabel, refuseByHand } from '../safety/brood-accept.js'
import { riskLine, riskOf } from '../safety/brood-risk.js'

export const BROOD_OPEN = 'brood:open'

const SIG = /^[0-9a-f]{4,64}$/i

export class BroodQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'safety'
  readonly command = 'brood'
  override description =
    'Automatons this hive is holding but will not run — read them, accept one by hand, or set what gets held'
  override descriptionKey = 'slash.brood'
  override options = ['list', 'scan', 'read <n>', 'accept <n>', 'refuse <n>', 'rules', 'test mine', 'trust <n>']
  override examples = [
    { input: '/brood', result: 'Opens what this hive is holding' },
    { input: '/brood read 1', result: 'Has a reader go through that code and records what it found' },
    { input: '/brood scan', result: 'Scans everything held for what it reaches, reads what nobody has read, and gives each a risk level' },
    { input: '/brood accept 1', result: 'Two warnings, then that automaton may run' },
    { input: '/brood test mine', result: 'Holds your own code too, until you have read it' },
  ]

  public override slashComplete(args: string): readonly string[] {
    const q = String(args ?? '').trim().toLowerCase()
    const base = ['list', 'scan', 'read', 'accept', 'refuse', 'rules', 'test mine', 'test off', 'trust']
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
      case 'scan':
        return this.#scan()
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
    // Your own drafts are recorded here too (the draft audit), and most of
    // them run — so each row says whether it runs, and why not when it does not.
    const runs = await Promise.all(roster.map(record => mayRunBee(record.sig).catch(() => false)))
    roster.forEach((record, row) => {
      const flag = record.flags?.[record.flags.length - 1]
      const state = record.ruling
        ? record.ruling.verdict
        : flag ? `held: ${flag.reason}`
        : runs[row] ? ((record.source.kind ?? 'stranger') === 'own' ? 'yours, runs' : 'runs')
        : 'held'
      const vouches = record.vouches.filter(vouch => vouch.verdict === 'accepted').length
      EffectBus.emit('activity:log', {
        message: `${row + 1}. ${broodLabel(record)} — ${state}${vouches ? `, ${vouches} vouching` : ''} · ${riskLine(riskOf(record))}`,
        icon: runs[row] ? '◆' : '○',
      })
    })
    const held = runs.filter(run => !run).length
    this.#say(`${held} held of ${roster.length} — see the activity log, then: brood read 1`)
  }

  /** SCAN THE BROOD: what every held automaton reaches, a reading of what
   *  nobody has read (a few per pass — each spends the participant's model),
   *  and the risk level that makes of each. Said only when asked. */
  async #scan(): Promise<void> {
    this.#say('Scanning the brood…')
    try {
      const { scanBrood } = await import('../safety/brood-audit.js')
      const outcome = await scanBrood()
      const roster = (await broodRoster()).filter(record => !record.ruling)
      const levels = { high: 0, medium: 0, low: 0, unread: 0 }
      for (const record of roster) levels[riskOf(record).level]++
      this.#say(`Scanned ${outcome.scanned}, read ${outcome.read}${outcome.failed ? ` (${outcome.failed} could not be read)` : ''}${outcome.unread ? ` — ${outcome.unread} still unread: brood scan again` : ''}. Held: ${levels.high} high, ${levels.medium} medium, ${levels.low} low, ${levels.unread} unread. brood list names them.`, levels.high ? 'error' : 'info')
    } catch (error) {
      this.#say(`The scan stopped: ${error instanceof Error ? error.message : String(error)}`, 'error')
    }
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
