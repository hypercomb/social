// pools/lights-contract.ts
//
// THE WORDS POOLS MODE IS MADE OF. Pools mode is the stage between private and
// the swarm (the header's lock, then the globe), made plain: every tile is lit
// or unlit, a lit tile is one you offer, and Publish leaves what the lit tiles
// carry in your pools at your own root domain
// (documentation/pools-as-relational-database.md, documentation/recipe-templates.md).
//
// The header, the bar, the badges, the domain shelf and a view's own picker
// live in separate bundles and never import each other. They meet on the
// EffectBus, and these are the names. Pure: constants and types, no state, no
// subscription, nothing registered.
//
import type { PoolNode } from './pool-node.js'

// NAMING: none of these constants carries the words the pool census reads
// (doctrine.spec.ts takes an upper-case constant named for a pool to BE a pool
// meaning), because none of them is one.

/** Whether pools mode is up. Last-value; the header is its one writer. `{ active }`. */
export const LIGHTS_MODE = 'world:mode'
/** A tile was lit or unlit. `{ cell, location, public, branch? }`. The tile actions drone is its writer. */
export const LIGHTS_CHANGED = 'tile:public-changed'

/** Ask the header to enter pools mode. Transient: a command, never replayed. */
export const LIGHTS_ENTER = 'pools:enter'
/** Ask the header to go back to private. Transient. */
export const LIGHTS_LEAVE = 'pools:leave'
/** Ask the header to go on to the swarm: the step the second press of the globe used to be. Transient. */
export const LIGHTS_JOIN_SWARM = 'pools:join-swarm'
/** Ask for what the lit tiles carry to be left in the pools at the root domain. Transient. */
export const LIGHTS_PUBLISH = 'pools:publish'
/** What the last publish did. Last-value. */
export const LIGHTS_PUBLISHED = 'pools:published'

/** Which followed hosts are drawn from, and the words being searched for. Last-value; the domain shelf is its writer. */
export const SOURCES_CHANGED = 'pools:sources-changed'
/** Put words in the domain shelf's search from somewhere else (a view's own picker). Transient. `{ query }`. */
export const SOURCES_QUERY = 'pools:query'
/** A surface wants the domain shelf in view, or is done with it. `{ owner, wanted }`. Transient; the shelf keeps the set of owners. */
export const DOMAIN_SHELF_WANTED = 'pools:domain-shelf'
/**
 * How many members each source offers of the pool on screen, so the shelf can say so on its chips.
 * `{ meaning, counts }`, keyed by a domain's zone, or for a participant by `poolNodeKey(node)`. Last-value.
 */
export const SOURCES_COUNTED = 'pools:sources-counted'

/**
 * The participants a surface found in the joined room for the pool it is showing, so the shelf can
 * carry them as chips beside the domains. `{ nodes }`. Last-value; a surface that leaves announces none.
 */
export const SOURCES_NODES = 'pools:sources-nodes'

export interface LightsMode { readonly active: boolean }

export interface LightsPublishedPool {
  /** The pool's meaning, `family:name`. */
  readonly meaning: string
  /** How many members the lit tiles left in it. Zero means the pool was withdrawn. */
  readonly count: number
}

export interface LightsPublished {
  /** When it finished, so a replayed last value is not taken for a new one. */
  readonly at: number
  readonly ok: boolean
  /** The root domain it was left on. Empty when no host is named. */
  readonly host: string
  readonly pools: readonly LightsPublishedPool[]
  /** Why it did not happen, in words for the participant. */
  readonly reason?: string
}

export interface SourcesState {
  /** The followed hosts that are switched on, in the order the shelf shows them. */
  readonly zones: readonly string[]
  /** Every followed host, on or off. */
  readonly all: readonly string[]
  /** The words in the search field, trimmed and lowercased. Empty for none. */
  readonly query: string
  /**
   * Every node that is switched on: the domains of `zones`, then the room's
   * participants. Always sent by the node shelf, empty when there is none; a
   * reader that only knows domains may ignore it.
   */
  readonly nodes?: readonly PoolNode[]
  /** Every node the shelf shows, on or off. */
  readonly allNodes?: readonly PoolNode[]
}

export interface SourcesNodes { readonly nodes: readonly PoolNode[] }

export interface DomainShelfWanted { readonly owner: string; readonly wanted: boolean }

export interface SourcesCounted { readonly meaning: string; readonly counts: Readonly<Record<string, number>> }
