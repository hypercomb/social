// diamond-core-processor/src/app/core/toggle-state.service.ts

import { Injectable } from '@angular/core'
import { defaultEnabled, type TreeNode } from './tree-node'

const STORAGE_KEY = 'dcp.toggleState'
const TOGGLE_CHANNEL = 'dcp-toggle-state'

@Injectable({ providedIn: 'root' })
export class ToggleStateService {

  #state: Map<string, boolean>
  #channel: BroadcastChannel | null = null

  constructor() {
    this.#state = this.#load()
  }

  toggle(nodeId: string, def = true): void {
    const current = this.isEnabled(nodeId, def)
    this.#state.set(nodeId, !current)
    this.#persist()
    this.#broadcastChange()
  }

  /** Force an explicit state (the select-all / clear-all gesture). One
   *  persist+broadcast per call — callers batching a subtree should use
   *  setManyEnabled instead. */
  setEnabled(nodeId: string, value: boolean): void {
    this.#state.set(nodeId, value)
    this.#persist()
    this.#broadcastChange()
  }

  /** Batch form of setEnabled: one persist + one broadcast for the whole
   *  set, so a ctrl+click over a large subtree doesn't write localStorage
   *  per node. */
  setManyEnabled(nodeIds: Iterable<string>, value: boolean): void {
    for (const id of nodeIds) this.#state.set(id, value)
    this.#persist()
    this.#broadcastChange()
  }

  /**
   * Public hook for non-toggle events that should still trigger a web
   * resync — e.g. a freshly installed domain on DCP. The sentinel
   * relays `dcp-toggle-state` to web, which runs resyncAndEnforce. We
   * reuse that channel so callers don't need to know about transport.
   */
  notifyChanged(): void {
    this.#broadcastChange()
  }

  /** Notify the sentinel iframe (and any same-origin listener) that toggles changed. */
  #broadcastChange(): void {
    try {
      if (!this.#channel) this.#channel = new BroadcastChannel(TOGGLE_CHANNEL)
      this.#channel.postMessage({ type: 'toggle-changed' })
    } catch { /* BroadcastChannel unavailable — sentinel sync will pick up on next poll */ }
  }

  /** Enabled state with an explicit absent-default. Callers that know the
   *  node's kind pass `defaultEnabled(kind)` so adopted CODE reads OFF and
   *  adopted DATA reads ON when no explicit flag has been set. */
  isEnabled(nodeId: string, def = true): boolean {
    return this.#state.get(nodeId) ?? def
  }

  isEffectivelyEnabled(node: TreeNode, nodeMap: Map<string, TreeNode>): boolean {
    if (!this.isEnabled(node.id, defaultEnabled(node.kind))) return false
    if (!node.parentId) return true

    const parent = nodeMap.get(node.parentId)
    if (!parent) return true

    return this.isEffectivelyEnabled(parent, nodeMap)
  }

  #load(): Map<string, boolean> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return new Map()
      const obj = JSON.parse(raw) as Record<string, boolean>
      return new Map(Object.entries(obj))
    } catch {
      return new Map()
    }
  }

  #persist(): void {
    const obj: Record<string, boolean> = {}
    for (const [k, v] of this.#state) {
      obj[k] = v
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
  }
}
