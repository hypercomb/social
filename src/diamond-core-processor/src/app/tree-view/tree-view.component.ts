// diamond-core-processor/src/app/tree-view/tree-view.component.ts

import { Component, input, output } from '@angular/core'
import { TreeRowComponent } from './tree-row.component'
import { isActiveElsewhere } from '../core/tree-node'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-tree-view',
  standalone: true,
  imports: [TreeRowComponent],
  template: `
    @for (node of nodes(); track node.id) {
      @if (!isEmptyFolder(node)) {
        <dcp-tree-row
          [node]="node"
          [enabled]="isEnabled(node)"
          [effectivelyEnabled]="isEffectivelyEnabled(node)"
          [activeElsewhere]="isActiveElsewhere(node)"
          [hasChildren]="node.children.length > 0 || !node.loaded"
          (toggle)="toggle.emit($event)"
          (toggleAll)="toggleAll.emit($event)"
          (open)="open.emit($event)"
          (openDetail)="openDetail.emit($event)"
          (expandToggle)="expandToggle.emit($event)"
          (promoteToPackage)="promoteToPackage.emit($event)"
          (openEditor)="openEditor.emit($event)"
          (hatch)="hatch.emit($event)" />

        @if (node.expanded && node.children.length) {
          <dcp-tree-view
            [nodes]="node.children"
            [toggleState]="toggleState()"
            [nodeMap]="nodeMap()"
            [activeSigs]="activeSigs()"
            (toggle)="toggle.emit($event)"
            (toggleAll)="toggleAll.emit($event)"
            (open)="open.emit($event)"
            (openDetail)="openDetail.emit($event)"
            (expandToggle)="expandToggle.emit($event)"
            (promoteToPackage)="promoteToPackage.emit($event)"
            (openEditor)="openEditor.emit($event)"
            (hatch)="hatch.emit($event)" />
        }
      }
    }
  `,
  styles: [`:host { display: block; }`]
})
export class TreeViewComponent {
  nodes = input.required<TreeNode[]>()
  toggleState = input<Map<string, boolean>>(new Map())
  nodeMap = input<Map<string, TreeNode>>(new Map())
  /** Signatures that actually RUN (collapsed from every effectively-enabled
   *  code node) — feeds the "already active via another feature" marker. */
  activeSigs = input<Set<string>>(new Set())

  toggle = output<TreeNode>()
  toggleAll = output<TreeNode>()
  open = output<TreeNode>()
  openDetail = output<TreeNode>()
  expandToggle = output<TreeNode>()
  promoteToPackage = output<TreeNode>()
  openEditor = output<TreeNode>()
  hatch = output<TreeNode>()

  isEmptyFolder(node: TreeNode): boolean {
    // Only hide empty DOMAIN placeholders. A leaf LAYER with no children is a
    // real content tile (a page like "intake"/"outcomes"), not an empty
    // folder — hiding it dropped the deepest level of an adopted tree.
    return node.kind === 'domain' && node.loaded && node.children.length === 0
  }

  isEnabled(node: TreeNode): boolean {
    return this.toggleState().get(node.id) ?? true
  }

  isEffectivelyEnabled(node: TreeNode): boolean {
    if (!this.isEnabled(node)) return false
    if (!node.parentId) return true

    const parent = this.nodeMap().get(node.parentId)
    if (!parent) return true

    return this.isEffectivelyEnabled(parent)
  }

  /** This script is OFF here, but its signature runs anyway because another
   *  enabled feature pulls it in. Self-exclusion is per-node via the same
   *  effective-enabled check used for the toggle, so a source never marks
   *  itself. See isActiveElsewhere in tree-node.ts. */
  isActiveElsewhere(node: TreeNode): boolean {
    return isActiveElsewhere(node, this.activeSigs(), this.isEffectivelyEnabled(node))
  }
}
