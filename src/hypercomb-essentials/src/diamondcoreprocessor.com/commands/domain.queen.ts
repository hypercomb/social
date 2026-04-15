// diamondcoreprocessor.com/commands/domain.queen.ts

import { QueenBee } from '@hypercomb/core'

/**
 * /domain — manage mesh relay domains.
 *
 * Syntax:
 *   /domain wss://relay.example.com     — add a relay domain
 *   /domain ws://localhost:7777          — add a local relay
 *   /domain remove wss://relay.example.com — remove a relay domain
 *   /domain list                         — list all configured domains
 *   /domain clear                        — remove all domains
 *   /domain                              — list all configured domains
 *
 * Domains are relay URLs that the mesh passively monitors.
 * Subscribe to a signature and the mesh fans out the request
 * to every known domain — whichever has matching events responds.
 */
export class DomainQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'domain'
  override readonly aliases = ['relay']
  override description = 'Add, remove, or list mesh relay domains'
  override descriptionKey = 'slash.domain'

  protected execute(args: string): void {
    const mesh = get('@diamondcoreprocessor.com/NostrMeshDrone') as any
    if (!mesh) {
      console.warn('[/domain] Mesh not available')
      return
    }

    const trimmed = args.trim()

    // no args or /domain list — show current domains
    if (!trimmed || trimmed.toLowerCase() === 'list') {
      this.#list(mesh)
      return
    }

    // /domain clear — remove all
    if (trimmed.toLowerCase() === 'clear') {
      mesh.configureRelays([], true)
      console.log('[/domain] All domains cleared')
      return
    }

    // /domain remove <url> — remove one
    const removeMatch = trimmed.match(/^remove\s+(.+)$/i)
    if (removeMatch) {
      const url = removeMatch[1].trim()
      this.#remove(mesh, url)
      return
    }

    // /domain <url> — add one
    this.#add(mesh, trimmed)
  }

  #list(mesh: any): void {
    const debug = mesh.getDebug?.()
    const relays: string[] = debug?.relays ?? []

    if (relays.length === 0) {
      console.log('[/domain] No domains configured')
      return
    }

    console.log(`[/domain] ${relays.length} domain(s):`)
    for (const url of relays) {
      const socket = debug?.sockets?.find((s: any) => s.url === url)
      const state = socket ? ['connecting', 'open', 'closing', 'closed'][socket.readyState] ?? 'unknown' : 'no socket'
      console.log(`  ${url}  (${state})`)
    }
  }

  #add(mesh: any, url: string): void {
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      console.warn(`[/domain] Invalid URL — must start with ws:// or wss://`)
      return
    }

    const debug = mesh.getDebug?.()
    const current: string[] = debug?.relays ?? []

    if (current.includes(url)) {
      console.log(`[/domain] Already configured: ${url}`)
      return
    }

    mesh.configureRelays([...current, url], true)
    console.log(`[/domain] Added: ${url}`)
  }

  #remove(mesh: any, url: string): void {
    const debug = mesh.getDebug?.()
    const current: string[] = debug?.relays ?? []
    const next = current.filter(u => u !== url)

    if (next.length === current.length) {
      console.log(`[/domain] Not found: ${url}`)
      return
    }

    mesh.configureRelays(next, true)
    console.log(`[/domain] Removed: ${url}`)
  }
}

// ── slash completion ────────────────────────────────────

DomainQueenBee.prototype.slashComplete = function (args: string): readonly string[] {
  const subcommands = ['list', 'remove', 'clear']
  const q = args.toLowerCase().trim()
  if (!q) return subcommands
  return subcommands.filter(s => s.startsWith(q))
}

const _domain = new DomainQueenBee()
window.ioc.register('@diamondcoreprocessor.com/DomainQueenBee', _domain)
