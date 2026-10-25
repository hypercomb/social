// assistant/permit.queen.ts
//
// `permit` — what runs on arrival, said per actor (documentation/
// permission-groups.md). `grant` says how far a machine may go at all; this
// says, of what it may do, what runs without waiting for a hand. Every group
// is the Execution window's policy with a name and members: `everyone` is the
// window's own (whatever no group names), `held` runs nothing by itself.
//
//   permit                                every group: mode, kinds, members
//   permit <group>                        one group, and what it ran by policy
//   permit <group> <kind> [<kind>…]       these kinds run on arrival; the rest wait
//   permit <group> manual | everything    nothing runs by itself / every kind does
//   permit <group> add provider <id>      also `add model <id>`, `add conversation <id>`
//   permit <group> drop <label>           the actor is held — never set free
//   permit held drop <label>              releases it: it runs as everyone again
//   permit <group> dissolve               the group goes; its members are held
//
// Kinds: read, additive, editing, destructive. A new group starts manual. The
// holds still wait whatever a group says: a read from a provider not let read
// the hive, a change that leaves the machine, one that follows someone else's
// words, and anything marked for review.
//
// DELIBERATELY NO `machine` BLOCK, as `grant` has none: a policy a model can
// loosen is not a policy.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { executionQueue, type ExecutionKind } from './execution-queue.js'
import { llmProviderRegistry } from './llm-provider-registry.js'
import {
  permitGroups, kindsRun, EVERYONE, HELD, PERMIT_FACETS, PERMIT_KINDS,
  type PermitFacet, type PermitGroup,
} from './permit-groups.js'

export type PermitReading =
  | { readonly show: 'all' }
  | { readonly show: 'group'; readonly name: string }
  | { readonly policy: string; readonly mode: 'manual' | 'everything' }
  | { readonly policy: string; readonly mode: 'auto'; readonly kinds: readonly ExecutionKind[] }
  | { readonly add: string; readonly facet: PermitFacet; readonly label: string }
  | { readonly drop: string; readonly label: string }
  | { readonly dissolve: string }
  | { readonly refuse: string }

/** What a `permit` line means — one reading, so what the word does and what
 *  it says it did never disagree. Group names and the structural words fold to
 *  lowercase; an id keeps its case. */
export const readPermit = (args: string): PermitReading => {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { show: 'all' }
  const name = words[0]!.toLowerCase()
  const verb = (words[1] ?? '').toLowerCase()
  const rest = words.slice(2).join(' ')
  if (words.length === 1) return { show: 'group', name }
  if (verb === 'add') {
    const facet = (words[2] ?? '').toLowerCase()
    const label = words.slice(3).join(' ')
    if (facet === 'code') return { refuse: 'a bridge code joins a group once the broker stamps who is speaking, which is not built yet' }
    if (!PERMIT_FACETS.includes(facet as PermitFacet)) return { refuse: `say what to add: permit ${name} add provider <id>, add model <id> or add conversation <id>` }
    if (!label) return { refuse: `say which ${facet}: permit ${name} add ${facet} <id>` }
    if (facet === 'conversation' && label.toLowerCase() === 'this') return { refuse: 'say the conversation\'s id; "this" arrives with the chat window step' }
    return { add: name, facet: facet as PermitFacet, label }
  }
  if (verb === 'drop') return rest ? { drop: name, label: rest } : { refuse: `say who: permit ${name} drop <label>` }
  if (verb === 'dissolve' && words.length === 2) return { dissolve: name }
  if ((verb === 'manual' || verb === 'everything') && words.length === 2) return { policy: name, mode: verb }
  const kinds = words.slice(1).map(word => word.toLowerCase()).filter(word => word !== 'auto')
  const unknown = kinds.filter(word => !PERMIT_KINDS.includes(word as ExecutionKind))
  if (unknown.length || !kinds.length) {
    return { refuse: `"${unknown[0] ?? words[1]}" is not something to permit — say kinds (${PERMIT_KINDS.join(', ')}), manual, everything, add, drop or dissolve` }
  }
  return { policy: name, mode: 'auto', kinds: PERMIT_KINDS.filter(kind => kinds.includes(kind)) }
}

const ranByPolicy = (name: string): number =>
  executionQueue.requests().filter(row => row.auto && (row.group ?? '').split(' ∩ ').includes(name)).length

export class PermitQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'permit'
  override description = 'Say what runs on arrival, per conversation, provider or model'
  override options = ['<group>', '<group> read additive editing destructive', '<group> manual', '<group> everything', '<group> add provider <id>', '<group> add model <id>', '<group> add conversation <id>', '<group> drop <label>', '<group> dissolve']
  override examples = [
    { input: '/permit', result: 'Lists every group: what runs on arrival, and who is in it' },
    { input: '/permit hermes add provider hermes-local', result: 'The hermes-local provider is judged by the hermes group, which starts manual' },
    { input: '/permit hermes read', result: 'Reads the hermes group asks for run on arrival; every change waits for your hand' },
    { input: '/permit hermes drop hermes-local', result: 'hermes-local is held: nothing it asks for runs by itself' },
  ]

  // Ids carry dots, slashes and colons (`deepseek/deepseek-v4-flash`,
  // `chat:tile:/::job-…`): the whole line is this word's.
  override rawArgs = true

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    const names = permitGroups.groups().map(group => group.name)
    const words = typed.split(/\s+/)
    if (words.length <= 1) return names.filter(name => name.startsWith(typed) && name !== typed)
    const [name = '', ...after] = words
    const next = after[after.length - 1] ?? ''
    if (after.length === 1) {
      return [...PERMIT_KINDS, 'manual', 'everything', 'add', 'drop', 'dissolve']
        .filter(word => word.startsWith(next) && word !== next).map(word => `${name} ${word}`)
    }
    if (after[0] === 'add' && after.length === 2) {
      return PERMIT_FACETS.filter(facet => facet.startsWith(next) && facet !== next).map(facet => `${name} add ${facet}`)
    }
    if (after[0] === 'drop' && after.length === 2) {
      const members = permitGroups.group(name)?.members.map(member => member.label) ?? []
      return members.filter(label => label.toLowerCase().startsWith(next) && label.toLowerCase() !== next).map(label => `${name} drop ${label}`)
    }
    return []
  }

  protected async execute(args: string): Promise<void> {
    const reading = readPermit(args)
    if ('refuse' in reading) { this.#say('permit.refused', 'Permit — {reason}', { reason: reading.refuse }); return }
    if ('show' in reading) {
      if (reading.show === 'all') { this.#showAll(); return }
      const group = permitGroups.group(reading.name)
      if (!group) { this.#say('permit.none', 'Permit — there is no group called {name}; permit lists them', { name: reading.name }); return }
      this.#showGroup(group, true)
      return
    }
    if ('policy' in reading) {
      const kinds = reading.mode === 'auto' ? reading.kinds : undefined
      const made = !permitGroups.group(reading.policy)
      const done = permitGroups.setPolicy(reading.policy, reading.mode, kinds)
      if (!done.ok) { this.#say('permit.refused', 'Permit — {reason}', { reason: done.reason }); return }
      if (made) this.#say('permit.made', 'Permit — a new group, {name}', { name: done.group.name })
      this.#showGroup(done.group, false)
      return
    }
    if ('add' in reading) {
      const done = await permitGroups.addMember(reading.add, reading.facet, reading.label)
      if (!done.ok) { this.#say('permit.refused', 'Permit — {reason}', { reason: done.reason }); return }
      this.#showGroup(done.group, false)
      if (reading.facet === 'provider' && !llmProviderRegistry().all().some(provider => provider.id.toLowerCase() === reading.label.toLowerCase())) {
        this.#say('permit.unknown-provider', 'Permit — no provider called {id} is on this device right now; the group judges it once one is', { id: reading.label })
      }
      return
    }
    if ('drop' in reading) {
      const done = permitGroups.drop(reading.drop, reading.label)
      if (!done.ok) { this.#say('permit.refused', 'Permit — {reason}', { reason: done.reason }); return }
      if (reading.drop === HELD) this.#say('permit.released', 'Permit — {label} is released; it runs as everyone again', { label: reading.label })
      else this.#say('permit.held', 'Permit — {label} is held; nothing it asks for runs by itself. permit held drop {label} releases it', { label: reading.label })
      return
    }
    const done = permitGroups.dissolve(reading.dissolve)
    if (!done.ok) { this.#say('permit.refused', 'Permit — {reason}', { reason: done.reason }); return }
    this.#say('permit.dissolved', 'Permit — {name} is gone; its members are held', { name: reading.dissolve })
  }

  #showAll(): void {
    if (permitGroups.reading) this.#say('permit.reading', 'Permit — the groups are still being read; ask again in a moment')
    for (const group of permitGroups.groups()) this.#showGroup(group, false)
  }

  #showGroup(group: PermitGroup, full: boolean): void {
    const runs = [...kindsRun(group)]
    const policy = runs.length === PERMIT_KINDS.length ? this.#t('permit.runs.all', 'every kind runs on arrival')
      : runs.length ? this.#t('permit.runs.some', '{kinds} run on arrival', { kinds: runs.join(', ') })
      : this.#t('permit.runs.none', 'nothing runs by itself')
    const who = group.name === EVERYONE ? this.#t('permit.everyone', 'whatever no group names — the Execution window\'s own policy')
      : group.members.length ? group.members.map(member => `${member.facet} ${member.label}`).join(', ')
      : this.#t('permit.empty', 'no members')
    const ran = ranByPolicy(group.name)
    const tail = full && ran ? ` · ${this.#t('permit.ran', 'ran {count} by policy this session', { count: ran })}` : ''
    this.#log(`Permit — ${group.name}: ${policy} · ${who}${tail}`)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const i18n = window.ioc?.get?.(I18N_IOC_KEY) as I18nProvider | undefined
    const value = i18n?.t?.(key, params)
    return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
  }

  #say(key: string, fallback: string, params?: Record<string, string | number>): void {
    this.#log(this.#t(key, fallback, params))
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◌' })
  }
}

const _permit = new PermitQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PermitQueenBee', _permit)
