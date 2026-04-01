// diamond-core-processor/src/app/tree-view/tree-view.component.ts

import { Component, input, output } from '@angular/core'
import { TreeRowComponent } from './tree-row.component'
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
          [hasChildren]="node.children.length > 0 || !node.loaded"
          (toggle)="toggle.emit($event)"
          (open)="open.emit($event)"
          (openDetail)="openDetail.emit($event)"
          (expandToggle)="expandToggle.emit($event)"
          (promoteToPackage)="promoteToPackage.emit($event)"
          (openEditor)="openEditor.emit($event)" />

        @if (node.expanded && node.children.length) {
          <dcp-tree-view
            [nodes]="node.children"
            [toggleState]="toggleState()"
            [nodeMap]="nodeMap()"
            (toggle)="toggle.emit($event)"
            (open)="open.emit($event)"
            (openDetail)="openDetail.emit($event)"
            (expandToggle)="expandToggle.emit($event)"
            (promoteToPackage)="promoteToPackage.emit($event)"
            (openEditor)="openEditor.emit($event)" />
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

  toggle = output<TreeNode>()
  open = output<TreeNode>()
  openDetail = output<TreeNode>()
  expandToggle = output<TreeNode>()
  promoteToPackage = output<TreeNode>()
  openEditor = output<TreeNode>()

  isEmptyFolder(node: TreeNode): boolean {
    return (node.kind === 'layer' || node.kind === 'domain') && node.loaded && node.children.length === 0
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
}
