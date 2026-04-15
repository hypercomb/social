// diamond-core-processor/src/app/core/toggle-state.service.ts

import { Injectable } from '@angular/core'
import type { TreeNode } from './tree-node'

const STORAGE_KEY = 'dcp.toggleState'
const TOGGLE_CHANNEL = 'dcp-toggle-state'

@Injectable({ providedIn: 'root' })
export class ToggleStateService {

  #state: Map<string, boolean>
  #channel: BroadcastChannel | null = null
  #dirty = false

  constructor() {
    this.#state = this.#load()
    window.addEventListener('pagehide', () => this.flush())
  }

  toggle(nodeId: string): void {
    const current = this.isEnabled(nodeId)
    this.#state.set(nodeId, !current)
    this.#persist()
    this.#dirty = true
  }

  /** Broadcast pending toggle changes to the sentinel. Call once when done toggling. */
  flush(): void {
    if (!this.#dirty) return
    this.#dirty = false
    try {
      if (!this.#channel) this.#channel = new BroadcastChannel(TOGGLE_CHANNEL)
      this.#channel.postMessage({ type: 'toggle-changed' })
    } catch { /* BroadcastChannel unavailable — sentinel sync will pick up on next poll */ }
  }

  isEnabled(nodeId: string): boolean {
    return this.#state.get(nodeId) ?? true
  }

  isEffectivelyEnabled(node: TreeNode, nodeMap: Map<string, TreeNode>): boolean {
    if (!this.isEnabled(node.id)) return false
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
