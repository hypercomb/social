// commands/interest.queen.ts

import { QueenBee, EffectBus, get } from '@hypercomb/core'
import { knownPheromoneKinds } from '../pheromones/pheromone-deposits.js'

/**
 * /interest — say which pheromones you watch for, or never want, and browse
 * what's available to turn on.
 *
 * This is the surface documentation/intake-filter.md's "Owed" section named
 * as missing: "nothing yet lets a participant SAY which marks they want."
 * `InterestRegistry` (hypercomb-shared/core/interest-registry.ts), the intake
 * gate and its three call sites were already built and proven; only the
 * editing surface was absent, so every verdict shipped as the empty-set
 * default (allow) until now.
 *
 * `InterestRegistry` lives in shared, so this queen — essentials — reaches
 * it through the loose-IoC seam pheromones/intake-filter.ts already uses,
 * never a direct import (the dependency direction is one-way: modules may
 * not import shared).
 *
 * Syntax:
 *   /interest                — list what you watch for, never want, and
 *                              what's available to add (kinds you or others
 *                              have deposited that you have not turned on)
 *   /interest mark            — watch for "mark" (KEEP)
 *   /interest mark1, mark2   — watch for several at once
 *   /interest ~mark           — stop filtering on "mark", wherever it sits
 *   /interest !mark           — never want "mark" (DROP) — refuses content
 *                              carrying it regardless of any KEEP match
 *
 * "Available to add" reads `knownPheromoneKinds()` (pheromones/pheromone-
 * deposits.ts) — the declared vocabulary this participant already holds,
 * never a network enumeration (documentation/pheromones.md: anchor-first,
 * receptor-relative — there is no "list every kind that exists" endpoint).
 */

type IntakeSets = { keep?: string; drop?: string }
type RegistryLike = {
  ensureLoaded(): Promise<void>
  roles: IntakeSets
  marks(name: string): string[]
  save(name: string, marks: string[]): Promise<string | null>
  setRole(role: 'keep' | 'drop', name: string): Promise<boolean>
}

const registry = (): RegistryLike | undefined =>
  get('@hypercomb.social/InterestRegistry') as RegistryLike | undefined

/** Add a mark to whichever named interest currently plays `role`, creating
 *  one named after the role itself on first use. Idempotent. */
async function addTo(reg: RegistryLike, role: 'keep' | 'drop', mark: string): Promise<void> {
  const name = reg.roles[role] ?? role
  const current = reg.marks(name)
  if (current.includes(mark)) return
  await reg.save(name, [...current, mark])
  if (!reg.roles[role]) await reg.setRole(role, name)
}

/** Remove a mark from whichever role (KEEP or DROP) currently holds it — the
 *  participant said "stop filtering on this", not which half it lived in. */
async function removeFrom(reg: RegistryLike, mark: string): Promise<boolean> {
  for (const role of ['keep', 'drop'] as const) {
    const name = reg.roles[role]
    if (!name) continue
    const current = reg.marks(name)
    if (!current.includes(mark)) continue
    await reg.save(name, current.filter(m => m !== mark))
    return true
  }
  return false
}

export class InterestQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'interest'
  override description = 'Say which pheromones you watch for or never want, and see what\'s available to turn on'
  override options = ['', '<mark>', '<mark1>, <mark2>', '~<mark>', '!<mark>']
  override examples = [
    { input: '/interest', result: 'Lists what you watch for, never want, and what\'s available to add' },
    { input: '/interest cigars', result: 'Watches for "cigars"' },
    { input: '/interest ~cigars', result: 'Stops filtering on "cigars"' },
    { input: '/interest !malicious', result: 'Never wants content marked "malicious"' },
  ]

  protected async execute(args: string): Promise<void> {
    const reg = registry()
    if (!reg) { this.#log('Interest — the registry is not available'); return }
    await reg.ensureLoaded()

    const trimmed = args.trim()
    if (!trimmed) { await this.#list(reg); return }

    const items = trimmed.split(',').map(m => m.trim()).filter(Boolean)
    if (items.length === 0) return

    let watching = 0, refusing = 0, cleared = 0
    for (const raw of items) {
      if (raw.startsWith('~')) {
        const mark = raw.slice(1).trim()
        if (mark && await removeFrom(reg, mark)) cleared++
      } else if (raw.startsWith('!')) {
        const mark = raw.slice(1).trim()
        if (mark) { await addTo(reg, 'drop', mark); refusing++ }
      } else {
        await addTo(reg, 'keep', raw); watching++
      }
    }

    const said: string[] = []
    if (watching) said.push(`now watching for ${watching} more`)
    if (refusing) said.push(`never want ${refusing} more`)
    if (cleared) said.push(`stopped filtering on ${cleared}`)
    this.#log(said.length ? `Interest — ${said.join(', ')}` : 'Interest — nothing changed')
  }

  async #list(reg: RegistryLike): Promise<void> {
    const keep = reg.roles.keep ? reg.marks(reg.roles.keep) : []
    const drop = reg.roles.drop ? reg.marks(reg.roles.drop) : []
    const known = await knownPheromoneKinds()
    const available = known.filter(k => !keep.includes(k) && !drop.includes(k))

    const lines = [
      keep.length ? `Watching for: ${keep.join(', ')}` : 'Watching for: nothing yet',
      ...(drop.length ? [`Never want: ${drop.join(', ')}`] : []),
      available.length
        ? `Available to add (/interest <mark>): ${available.join(', ')}`
        : 'Available to add: nothing offered yet',
    ]
    this.#log(lines.join(' — '))
  }

  #log(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '#' })
  }
}

const _interest = new InterestQueenBee()
