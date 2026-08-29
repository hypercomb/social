// diamondcoreprocessor.com/commands/enroll.queen.ts
//
// `/enroll` — the ONE verb for relating artifacts, and the end of dependent
// parent behaviours.
//
// Before this, every collection kind taught its own container: a deck cell held
// slides, a site cell held pages, a workflow cell held steps. Making anything
// meant first making a parent for it, a member belonged to exactly one
// collection, and re-ordering edited the hive.
//
// Now there is one act and it is type-agnostic. A website, a slide, a photo, a
// page and a workflow step all enrol the same way, into the same kind of set,
// and any of them can be the artifact that NAMES it. Nothing here knows what a
// slide is — enrolment is about the relation, and each view asks the set for the
// kinds it renders.
//
//   /enroll                — what is this tile part of?
//   /enroll <name>         — join <name>; re-run to leave
//   /enroll as <name>      — become the WEBSITE ARTIFACT for <name>
//
// A tile can be in any number of sites at once, and its position in each rides
// that membership's own mark — so joining a second site can never renumber the
// first. Full doctrine: documentation/website-artifact-paradigm.md.

import { EffectBus, QueenBee } from '@hypercomb/core'
import {
  siteNameOf,
} from '../pheromones/enrollment.js'
import {
  sitesOf,
  toggleEnrollment,
  toggleSiteArtifact,
} from '../pheromones/enrollment-acts.js'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

type LineageShape = { explorerSegments?: () => readonly string[] }

export class EnrollQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'enroll'
  override readonly aliases = ['enrol', 'join']
  override description = 'Relate this tile to a website — the one way artifacts belong together'
  override descriptionKey = 'slash.enroll'
  override options = ['as']
  override examples = [
    { input: '/enroll pitch', result: 'Relates this tile into the website "pitch"' },
    { input: '/enroll as pitch', result: 'Makes this tile the website artifact "pitch"' },
    { input: '/enroll', result: 'Lists the websites this tile is part of' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['as'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const raw = args.trim()
    const segments = this.#segments()
    if (segments.length === 0) {
      this.#log('Stand on a tile first — enrolment is something a tile does, not a place')
      return
    }

    if (!raw) { await this.#report(segments); return }

    const lower = raw.toLowerCase()
    if (lower === 'as') { this.#log('Which website? — /enroll as <name>'); return }
    if (lower.startsWith('as ')) { await this.#name(segments, raw.slice(3).trim()); return }
    await this.#join(segments, raw)
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** "What am I part of?" — a question the tile answers ALONE, with no parent to
   *  consult and no index to keep. That it can is the whole test of the model. */
  async #report(segments: readonly string[]): Promise<void> {
    try {
      const meanings = await sitesOf(segments)
      if (meanings.length === 0) {
        this.#log('Part of no website yet — /enroll <name> relates this tile into one', '○')
        return
      }
      const names = meanings.map(m => siteNameOf(m) || m)
      this.#log(`Part of ${names.map(n => `"${n}"`).join(', ')}`, '◆')
    } catch (err) {
      console.warn('[/enroll] could not read memberships', err)
      this.#log('Could not read this tile\'s memberships (see console)')
    }
  }

  async #join(segments: readonly string[], name: string): Promise<void> {
    try {
      const result = await toggleEnrollment(segments, name)
      if (!result.ok) { this.#log('That is not a website name — /enroll <name>'); return }
      this.#log(
        result.act === 'enrolled' ? `Enrolled in "${result.slug}"` : `Left "${result.slug}"`,
        result.act === 'enrolled' ? '◆' : '○',
      )
    } catch (err) {
      console.warn('[/enroll] failed', err)
      this.#log('Could not change this tile\'s membership (see console)')
    }
  }

  async #name(segments: readonly string[], name: string): Promise<void> {
    try {
      const result = await toggleSiteArtifact(segments, name)
      if (!result.ok) { this.#log('That is not a website name — /enroll as <name>'); return }
      this.#log(
        result.act === 'named'
          ? `This tile is the website "${result.slug}" — /enroll ${result.slug} relates others into it`
          : `No longer the website "${result.slug}"`,
        result.act === 'named' ? '◆' : '○',
      )
    } catch (err) {
      console.warn('[/enroll as] failed', err)
      this.#log('Could not name this website (see console)')
    }
  }

  #log(message: string, icon = '◆'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _enroll = new EnrollQueenBee()
window.ioc.register('@diamondcoreprocessor.com/EnrollQueenBee', _enroll)
