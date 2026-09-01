// presentation/tiles/meaning-target.ts
//
// A HOLE SAYS WHAT BELONGS IN IT. ANYONE MAY ANSWER.
//
// A hole carries a conventional name — `site:masthead` — and this is where
// that name becomes an address. Two people who never met agree on what fills a
// hole by agreeing on a word: both derive the same signature from the same
// name, with no registry to consult and no message to exchange.
//
// ── IT IS A GROUP SIGNATURE, NOT A POOL SIGNATURE ───────────────────────
//
// "Pool of meaning" is the right instinct and the wrong primitive, and the
// difference matters enough to write down.
//
// A POOL IS A PLACE. `Store.getPool` opens a directory with `{ create: true }`
// and records are written into it. Worse, `Store.poolSignature` is
// `registerPoolMeaning` — deriving one REGISTERS the address as a pool for the
// rest of the session, which permanently tells the prune and purge guards to
// leave that 64-hex alone. That registry exists to stop `/flatten` destroying a
// real pool's contents; seeding it with markers that will never hold anything
// degrades the one guard it provides. And the registry is compile-time code: a
// peer cannot consult it, so a pool address classifies nothing beyond the
// machine that derived it.
//
// A GROUP SIGNATURE IS A NAME. `sha256('group:' + meaning)` — a DECLARED
// REFERENT with no bytes behind it by construction, which every precise
// closure walker already skips. It is the primitive this codebase already uses
// for "many independent artifacts declare themselves members of a conventional
// name", it travels with the artifact because it rides a decoration, and its
// `group:` prefix puts it in a namespace disjoint from every pool address and
// every lineage bag.
//
// So: the hole states a meaning, the composer writes the group signature, and
// an artifact answers by wearing the ordinary enrolment mark for that same
// meaning. No new decoration kind, no registration, nothing to keep in step.

import { groupSignature } from '@hypercomb/core'
import { meaningsIn, meaningsOf, type LayoutNode, type LayoutTemplate, type TargetResolver } from './layout-template.js'

/**
 * Resolve every conventional name an arrangement mentions, once, so the pure
 * builder can stay pure.
 *
 * Deriving a signature is asynchronous and the builder is not — that is the
 * whole reason `TargetResolver` is a parameter rather than a call. One pass up
 * front costs one hash per distinct name (memoized in core after that) and
 * leaves the composer synchronous, which is what lets the same function draw a
 * container at publish time, in the browser, and in a test.
 */
export async function targetsIn(node: LayoutNode): Promise<TargetResolver> {
  return resolverFor(meaningsIn(node))
}

/** The same, for a single template — what a palette chip needs. */
export async function targetsOf(template: LayoutTemplate): Promise<TargetResolver> {
  return resolverFor(meaningsOf(template))
}

async function resolverFor(meanings: readonly string[]): Promise<TargetResolver> {
  const table = new Map<string, string>()
  for (const meaning of meanings) {
    try {
      table.set(meaning, await groupSignature(meaning))
    } catch {
      // A name that will not hash is a name nobody can answer. The hole keeps
      // its meaning and gets no target, which reads as "nothing can fill this
      // yet" rather than as a broken container.
    }
  }
  return meaning => table.get(meaning)
}
