// diamond-core-processor/src/app/core/toggle-state.service.ts

import { Injectable } from '@angular/core'
import type { TreeNode } from './tree-node'

const STORAGE_KEY = 'dcp.toggleState'

@Injectable({ providedIn: 'root' })
export class ToggleStateService {

  #state: Map<string, boolean>

  constructor() {
    this.#state = this.#load()
  }

  toggle(nodeId: string): void {
    const current = this.isEnabled(nodeId)
    this.#state.set(nodeId, !current)
    this.#persist()
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
