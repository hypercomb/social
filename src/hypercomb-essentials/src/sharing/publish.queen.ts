// sharing/publish.queen.ts
//
// `/publish` — open the publish differential.
//
// Branch-scoped publication: what the world sees, what changed here, where a
// branch publishes, and the publish/re-publish/unpublish acts for that row.
// The durable host and package directory stays in `/hosts`; this surface only
// consumes its destinations.
//
//   publish                 toggle the panel
//   publish here            publish the tile you stand on to the hosts it names
//   publish on <domain>     switch that domain's door ON for the tile you stand
//                           on: it names the domain, then publishes (asking
//                           your consent, as `publish here` does) — the tile's
//                           name becomes <name>.<domain>
//   publish off <domain>    switch it OFF; the last door off withdraws the tile
//
// `on`/`off` are the panel's per-domain switch said in words — the same marks
// and the same signed index, no second mechanism.

import { EffectBus, lineageKey } from '@hypercomb/core'
import { hostCurrentBranch } from './host-gesture.js'
import { hostZone, hostsOfBranch, setBranchHosts } from './community-hosts.js'
import { setBranchDoors, unpublishBranch } from './publish-branch.js'
import { latestByLineageKey } from './publish-heads.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const say = (message: string, type: 'info' | 'warning' | 'success' = 'info'): void => {
  EffectBus.emit('activity:log', { message, icon: '⇪' })
  if (type !== 'info') EffectBus.emit('toast:show', { type, message })
}

export class PublishQueenBee {
  readonly command = 'publish'
  readonly description =
    'Show what your published hive is serving right now, next to what has changed here since — one row per branch, with publish, re-check and unpublish per row. `publish here` publishes the layer you stand on to its hosts; `publish on <domain>` and `publish off <domain>` switch one domain for it.'
  readonly descriptionKey = 'slash.publish'

  async invoke(args: string): Promise<void> {
    const text = String(args ?? '').trim()
    const lower = text.toLowerCase()
    // `publish here` — publish the layer you stand on to the hosts THIS layer
    // names (its host marks, else your standing host), with the `shared`
    // list riding along: the offering act. Joining offers what this served.
    if (lower === 'here') { await hostCurrentBranch(); return }
    const door = lower.match(/^(on|off)(?:\s+(\S+))?$/)
    if (door) { await this.#door(door[1] === 'on', door[2] ?? ''); return }
    EffectBus.emit('publish:view-toggle', {})
  }

  async #door(on: boolean, raw: string): Promise<void> {
    const segments = ((window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.()) ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const fail = (message: string): never => { say(message, 'warning'); throw new Error(message) }
    if (segments.length === 0) fail('Go into the tile you want to publish first — the hive root is not a branch.')
    const zone = hostZone(raw)
    if (!zone) fail(`Say the domain: publish ${on ? 'on' : 'off'} <domain>, for example hypercomb.com.`)

    const name = segments[segments.length - 1]
    const named = await hostsOfBranch(segments)
    const next = on ? [...new Set([...named, zone])] : named.filter(z => z !== zone)

    if (on) {
      await setBranchHosts(segments, next)
      // Publishing reads the marks just written: the doors follow them. The
      // tile goes in as read above, never re-read from a tab that may move.
      await hostCurrentBranch(segments)
      return
    }

    if (!named.includes(zone)) { say(`"${name}" was not on ${zone}`); return }
    await setBranchHosts(segments, next)
    const published = (await latestByLineageKey()).has(lineageKey(segments))
    if (!published) { say(`"${name}" is no longer meant for ${zone}`); return }
    const result = next.length === 0 ? await unpublishBranch(segments) : await setBranchDoors(segments, next)
    if (!result.ok) fail(`"${name}" could not be taken off ${zone} (${result.failure}).`)
    say(next.length === 0 ? `"${name}" is withdrawn — ${zone} was its last door` : `"${name}" is off ${zone}`, 'success')
  }
}

const _publish = new PublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublishQueenBee', _publish)
