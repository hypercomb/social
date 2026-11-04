// hypercomb-shared/ui/participants/participants-roster.ts
//
// WHO IS IN THE SWARM — one read model for the two surfaces that show it:
// the header rail's participant group (rail-participants) and the left
// sidebar list (participants-sidebar). jwize, 2026-11-04: nothing swarm-
// related sits across the top of the hexagons; the rail says who is there,
// the sidebar is where you pick whose tiles you see.
//
// Fed by the swarm's own broadcasts (last-value replayed, so a late mount is
// correct at once): `mesh:public-changed` gates the whole thing, `swarm:
// presence-changed` carries the room (`zonePeers`: everyone but you, with
// where they stand), `swarm:label-changed` renames, `swarm:filter` is the
// selection SwarmFilterService owns. Shell UI never imports essentials — the
// swarm is reached through window.ioc for labels only.

import { computed, signal } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

const SWARM_KEY = '@diamondcoreprocessor.com/SwarmDrone'
const SWARM_FILTER_KEY = '@diamondcoreprocessor.com/SwarmFilterService'

const get = (key: string): any => (globalThis as { ioc?: { get(k: string): unknown } }).ioc?.get(key)

export type Where = 'self' | 'here' | 'elsewhere' | 'away'

export interface Participant {
  /** 'self' for you, else the pubkey. */
  key: string
  label: string
  initials: string
  where: Where
  /** In SwarmFilterService's selection — only their tiles show. */
  selected: boolean
}

interface ZonePeer { pubkey?: unknown; label?: unknown; state?: unknown }

const _public = signal(false)
const _zone = signal<readonly { pubkey: string; label: string; state: Where }[]>([])
const _selected = signal<ReadonlySet<string>>(new Set())
const _labelVersion = signal(0)

/** Two-letter initials: first letter of the first two words, else the first
 *  two characters. Codepoint-safe. */
export const initialsOf = (label: string): string => {
  const parts = label.trim().split(/\s+/).filter(Boolean)
  const head = (s: string): string => Array.from(s)[0] ?? ''
  if (parts.length >= 2) return (head(parts[0]) + head(parts[1])).toUpperCase()
  return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
}

EffectBus.on<{ public?: boolean }>('mesh:public-changed', (p) => _public.set(!!p?.public))

EffectBus.on<{ zonePeers?: readonly unknown[] }>('swarm:presence-changed', (p) => {
  const rows: { pubkey: string; label: string; state: Where }[] = []
  for (const raw of p?.zonePeers ?? []) {
    const z = raw as ZonePeer
    const pubkey = String(z?.pubkey ?? '').trim().toLowerCase()
    if (!pubkey) continue
    const state = z?.state === 'elsewhere' || z?.state === 'away' ? z.state : 'here'
    rows.push({ pubkey, label: String(z?.label ?? '').trim(), state })
  }
  _zone.set(rows)
})

EffectBus.on('swarm:label-changed', () => _labelVersion.update(v => v + 1))

EffectBus.on<{ participants?: readonly string[] }>('swarm:filter', (p) => {
  _selected.set(new Set((p?.participants ?? []).map(s => String(s)).filter(Boolean)))
})

/** Whether this tab is in a swarm at all. */
export const inSwarm = computed(() => _public())

/** You first, then the room nearest first: here, elsewhere, away. */
export const participants = computed<readonly Participant[]>(() => {
  _labelVersion()
  const swarm = get(SWARM_KEY) as { myLabel?: () => string; labelFor?: (pk: string) => string } | undefined
  const selected = _selected()
  const mine = (swarm?.myLabel?.() ?? '').trim()
  const out: Participant[] = [{
    key: 'self', label: mine, initials: mine ? initialsOf(mine) : '+', where: 'self', selected: false,
  }]
  const order: Record<Where, number> = { self: 0, here: 1, elsewhere: 2, away: 3 }
  const room = [..._zone()].sort((a, b) => order[a.state] - order[b.state])
  for (const z of room) {
    const label = z.label || (swarm?.labelFor?.(z.pubkey) ?? '').trim()
    out.push({
      key: z.pubkey,
      label,
      initials: label ? initialsOf(label) : z.pubkey.slice(0, 2).toUpperCase(),
      where: z.state,
      selected: selected.has(z.pubkey),
    })
  }
  return out
})

/** Flip a member in or out of the tile filter (SwarmFilterService owns it). */
export const toggleParticipant = (pubkey: string): void => {
  if (pubkey === 'self') return
  get(SWARM_FILTER_KEY)?.toggle?.(pubkey)
}

/** Everyone shows again. */
export const clearParticipantFilter = (): void => {
  get(SWARM_FILTER_KEY)?.clear?.()
}
