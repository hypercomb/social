// sharing/discover.queen.ts
//
// /discover <domain> — DISCOVERY: point the publication directory at any
// domain and see everything its hypercomb host shares.
//
// The protocol is the ledger itself: every hypercomb worker answers
// `GET /publications.json` with its operator-approved bindings and, per
// publisher, the verified signed head of each lineage (publications-ledger.ts
// documents the read; the worker derives the answer from publisher-signed
// hive indexes, so discovery can never advertise what the router would
// refuse to serve). This verb is deliberately NOT a new surface: it opens
// the SAME publications view every directory cell opens, pointed at a
// foreign door — one grammar, any number of domains.
//
// The gesture is read-only: nothing is adopted, nothing lands in the hive.
// Plates stay external doors; replication remains its own explicit verb.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { fetchPublicationCards } from './publications-ledger.js'

/** Effect the publications view listens for. `at` guards the bus's
 *  last-value replay: only a fresh gesture may take the view over. */
export const DISCOVER_EFFECT = 'publications:discover'

export interface DiscoverPayload {
  readonly origin: string
  readonly host: string
  readonly at: number
}

/** A pasted domain in any casual shape → its origin, or null when it cannot
 *  name one: scheme optional (https assumed; http kept only for local dev
 *  doors), path and query dropped — discovery addresses a HOST. */
export function normalizeDirectory(input: string): { origin: string; host: string } | null {
  const raw = input.trim().replace(/^[<"'‘’“”]+|[>"'‘’“”.,;]+$/g, '')
  if (!raw || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.host.toLowerCase()
    const local = url.hostname === 'localhost' || /^127\./.test(url.hostname)
    if (!host || (!host.includes('.') && !local)) return null
    return { origin: `${local ? url.protocol : 'https:'}//${host}`, host }
  } catch { return null }
}

/** A dead DNS lookup must not hold the verb — past this, the honest answer
 *  is "no ledger answered". */
const PROBE_TIMEOUT_MS = 12_000

export class DiscoverQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'discover'
  override description = 'Discover a domain — every creation its hypercomb host publishes, as plates'
  override options = ['<domain>']
  override examples = [
    { input: '/discover pluginthematrix.com', result: 'Opens the publication directory that domain serves' },
  ]

  protected async execute(args: string): Promise<void> {
    const directory = normalizeDirectory(args)
    if (!directory) {
      this.#toast('tip', this.#t('discover.title', 'Discover'),
        this.#t('discover.usage', 'Name a domain — try /discover pluginthematrix.com'))
      return
    }

    // Probe before taking the view over: an unreachable domain is a toast,
    // never a page.
    const cards = await Promise.race([
      fetchPublicationCards({}, directory.origin),
      new Promise<null>(resolve => setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)),
    ])
    if (cards === null) {
      this.#toast('error', this.#t('discover.title', 'Discover'),
        this.#t('discover.unreachable', 'No publication ledger answered at {host}.')
          .replace('{host}', directory.host))
      return
    }

    EffectBus.emit(DISCOVER_EFFECT, {
      origin: directory.origin, host: directory.host, at: Date.now(),
    } satisfies DiscoverPayload)
    EffectBus.emit('activity:log', {
      message: `Discovering ${directory.host} — ${cards.length} published creation${cards.length === 1 ? '' : 's'}`,
      icon: 'public',
    })
  }

  #toast(type: string, title: string, message: string): void {
    EffectBus.emit('toast:show', { type, title, message })
  }

  /** Localized text with the echo guard — `t()` hands the key back when it
   *  cannot resolve one. */
  #t(key: string, fallback: string): string {
    const i18n = window.ioc?.get<{ t(k: string): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key)
    return text && text !== key ? text : fallback
  }
}

const _discover = new DiscoverQueenBee()
window.ioc.register('@DiscoverQueenBee', _discover)
