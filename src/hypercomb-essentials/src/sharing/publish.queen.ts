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
//   publish as <label> on <domain>
//                           give the tile its OWN ADDRESS on that domain —
//                           https://<label>.<domain> instead of <name>.<domain>
//                           (`@` is the domain itself: its front page). The
//                           tile must already be published on that domain.
//
// Every form but the bare word also takes a ROUTE first — `publish
// /revolucion/lounge on hypercomb.com` — so a sentence can NAME the tile
// instead of standing on it: a session or a manager acts from wherever it
// is, and the tile is read once, never off a tab that may move meanwhile
// (host-gesture.ts). `publish /route` alone is `publish here` for that tile.
//
// `on`/`off`/`as` are the panel's per-domain switch and its own-address field
// said in words — the same marks and the same signed index, no second
// mechanism.

import { EffectBus, lineageKey } from '@hypercomb/core'
import { hostCurrentBranch } from './host-gesture.js'
import { hostZone, hostsOfBranch, setBranchHosts } from './community-hosts.js'
import { setBranchAddress, setBranchDoors, unpublishBranch } from './publish-branch.js'
import { latestByLineageKey } from './publish-heads.js'
import { APEX_LABEL, ownAddressRefusal } from './zone-door.js'

type LineageLike = { explorerSegments?: () => readonly string[] }

const say = (message: string, type: 'info' | 'warning' | 'success' = 'info'): void => {
  EffectBus.emit('activity:log', { message, icon: '⇪' })
  if (type !== 'info') EffectBus.emit('toast:show', { type, message })
}

/** A route said first — `/a/b …` — as segments, with the rest of the line. */
const splitRoute = (text: string): { route: string[] | null; rest: string } => {
  if (!text.startsWith('/')) return { route: null, rest: text }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(text)
  const route = (m?.[1] ?? '').split('/').map(s => s.trim()).filter(Boolean)
  return { route, rest: (m?.[2] ?? '').trim() }
}

export class PublishQueenBee {
  readonly command = 'publish'
  /** Everything after the word is kept verbatim: a route (`/a/b`), a domain
   *  and a label are exact, never prose for the reader to fold — the
   *  Tongue read `publish /revolucion/lounge …` as `revolucion/lounge …`. */
  readonly rawArgs = true
  readonly description =
    'Show what your published hive is serving right now, next to what has changed here since — one row per branch, with publish, re-check and unpublish per row. `publish here` publishes the layer you stand on to its hosts; `publish on <domain>` and `publish off <domain>` switch one domain for it; `publish as <label> on <domain>` gives it its own address there. Say a route first (`publish /a/b on <domain>`) to name the tile instead of standing on it.'
  readonly descriptionKey = 'slash.publish'

  async invoke(args: string): Promise<void> {
    const { route, rest } = splitRoute(String(args ?? '').trim())
    const lower = rest.toLowerCase()
    // `publish here` — publish the layer you stand on to the hosts THIS layer
    // names (its host marks, else your standing host), with the `shared`
    // list riding along: the offering act. Joining offers what this served.
    // With a route and nothing else, the same act for that tile.
    if (lower === 'here' || (route && !rest)) { await hostCurrentBranch(route ?? undefined); return }
    const door = lower.match(/^(on|off)(?:\s+(\S+))?$/)
    if (door) { await this.#door(route, door[1] === 'on', door[2] ?? ''); return }
    const own = lower.match(/^as(?:\s+(\S+))?(?:\s+on(?:\s+(\S+))?)?$/)
    if (own) { await this.#address(route, own[1] ?? '', own[2] ?? ''); return }
    if (route) {
      say(`Say what to do with /${route.join('/')}: on <domain>, off <domain>, or as <label> on <domain>.`, 'warning')
      return
    }
    EffectBus.emit('publish:view-toggle', {})
  }

  /** The tile a form acts on: the route it named, else where you stand. */
  #segments(route: readonly string[] | null): string[] {
    const segments = (route ?? (window.ioc.get<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.()) ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) {
      const message = route
        ? 'Say the tile as a route: publish /a/b on <domain>.'
        : 'Go into the tile you want to publish first — the hive root is not a branch.'
      say(message, 'warning')
      throw new Error(message)
    }
    return segments
  }

  async #door(route: readonly string[] | null, on: boolean, raw: string): Promise<void> {
    const segments = this.#segments(route)
    const fail = (message: string): never => { say(message, 'warning'); throw new Error(message) }
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

  /** OWN ADDRESS — `<label>.<zone>` for a tile already published on that
   *  zone's door (`@` = the zone itself). One signed index rewrite, the same
   *  the panel's own-address field makes; nothing is uploaded. */
  async #address(route: readonly string[] | null, label: string, raw: string): Promise<void> {
    const segments = this.#segments(route)
    const fail = (message: string): never => { say(message, 'warning'); throw new Error(message) }
    const path = `/${segments.join('/')}`
    if (!label) fail(`Say the name: publish as <label> on <domain>, for example publish ${path} as virtual-lounge on hypercomb.com — "@" is the domain itself.`)
    const zone = hostZone(raw)
    if (!zone) fail(`Say the domain: publish as ${label} on <domain>, for example hypercomb.com.`)
    const refusal = ownAddressRefusal(label)
    if (refusal === 'not-a-label') fail('An address name is letters, digits and hyphens, up to 63 characters, with no hyphen at either end.')
    if (refusal === 'reserved') fail('"content", "host" and names starting with "try-" belong to the host — choose another name.')

    const name = segments[segments.length - 1]
    const named = await hostsOfBranch(segments)
    if (!named.includes(zone)) fail(`"${name}" is not on ${zone} — say: publish ${path} on ${zone} first.`)
    const result = await setBranchAddress(segments, zone, label)
    if (result.ok) {
      say(label === APEX_LABEL
        ? `${zone} now opens on "${name}" — its host card is at host.${zone}`
        : `"${name}" answers at https://${result.host}/`, 'success')
      return
    }
    if (result.failure === 'not-published') fail(`"${name}" is not published on ${zone} yet — say: publish ${path} on ${zone} first.`)
    const address = label === APEX_LABEL ? zone : `${label}.${zone}`
    fail(`"${name}" could not take ${address} (${result.failure}${result.reason ? `: ${result.reason}` : ''}).`)
  }
}

const _publish = new PublishQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PublishQueenBee', _publish)
