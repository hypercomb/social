// diamond-core-processor/src/app/tree-view/tree-row.component.ts

import { Component, computed, ElementRef, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core'
import { ToggleComponent } from './toggle.component'
import { DiamondIconComponent } from './diamond-icon.component'
import type { TreeNode } from '../core/tree-node'

@Component({
  selector: 'dcp-tree-row',
  standalone: true,
  imports: [ToggleComponent, DiamondIconComponent],
  template: `
    @if (visible()) {
      <div class="row" [class.pending]="node().pending" [class.visual-context]="node().visualContext" [class.egg]="node().hatchBlocker" [class.freshly-adopted]="node().freshlyAdopted" [class.freshly-upgraded]="node().freshlyUpgraded && !node().hatchBlocker" [class.active-elsewhere]="activeElsewhere() && !node().hatchBlocker" [class.domain-tinted]="domainHue() !== null" [style.--depth]="node().depth" [style.--domain-hue]="domainHue()">
        <span class="tint" aria-hidden="true"></span>

        <!-- col 1 — disclosure -->
        @if (hasChildren()) {
          <button class="disc" (click)="expandToggle.emit(node())" [attr.aria-expanded]="node().expanded" aria-label="Expand">
            <svg class="chev" [class.open]="node().expanded" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>
          </button>
        } @else { <span class="cell"></span> }

        <!-- col 2 — enable switch (absent for context / egg rows) -->
        @if (!node().visualContext && !node().hatchBlocker) {
          <!-- Ctrl/Cmd+click forces the whole subtree to the new state; the
               modifier is latched at pointerdown because dcp-toggle's
               (toggled) doesn't carry the mouse event. -->
          <span class="cell" (pointerdown)="ctrlHeld = $event.ctrlKey || $event.metaKey">
            <dcp-toggle
              [enabled]="enabled()"
              [effectivelyEnabled]="effectivelyEnabled()"
              (toggled)="(ctrlHeld ? toggleAll : toggle).emit(node()); ctrlHeld = false" />
          </span>
        } @else { <span class="cell"></span> }

        <!-- col 3 — kind mark -->
        <dcp-diamond [kind]="node().kind" (clicked)="open.emit(node())" />

        <!-- col 4 — name + inline metadata -->
        <button class="label" (click)="hasChildren() ? expandToggle.emit(node()) : open.emit(node())">
          <span class="name" [class]="node().kind">{{ node().name }}</span>
          @if (lineageDisplay()) { <span class="crumb">{{ lineageDisplay() }}</span> }
          @else if (splitClassName()) { <span class="crumb">{{ splitClassName() }}</span> }
          @if (node().freshlyUpgraded && !node().hatchBlocker) { <span class="chip new">new</span> }
          @if (activeElsewhere() && !node().hatchBlocker) { <span class="chip active">active</span> }
          @if (node().visualContext) { <span class="chip ctx">in&nbsp;install</span> }
          @if (node().hatchBlocker) {
            <span class="chip wait" [class.untrusted]="node().hatchBlocker === 'untrusted'"
              [title]="node().hatchBlocker === 'undelivered'
                ? 'Waiting for bytes — no endpoint has delivered this yet. Hatches when one serves it.'
                : 'Waiting for community trust — blocked until it meets the safety bar or you override.'">
              {{ node().hatchBlocker === 'undelivered' ? 'waiting for bytes' : 'waiting for trust' }}
            </span>
          }
          @if (node().audit) {
            <span class="chip audit" [class.met]="node().audit!.meetsThreshold" [class.unmet]="!node().audit!.meetsThreshold">
              {{ node().audit!.approvedBy.length }}/{{ node().audit!.total }}
            </span>
          }
          @if (description()) { <span class="desc">{{ description() }}</span> }
        </button>

        <!-- col 5 — signature -->
        @if (node().signature) { <span class="sig">{{ node().signature!.slice(0, 8) }}</span> }
        @else { <span class="cell"></span> }

        <!-- col 6 — actions -->
        <span class="acts">
          @if (node().hatchBlocker) {
            <button class="allow" [class]="node().hatchBlocker!"
              (click)="hatch.emit(node()); $event.stopPropagation()"
              [title]="node().hatchBlocker === 'untrusted'
                ? 'Allow this to run — an explicit override'
                : 'Retry fetching this content'">
              {{ node().hatchBlocker === 'untrusted' ? 'Allow' : 'Retry' }}
            </button>
          } @else {
            @if (node().signature && (node().kind === 'bee' || node().kind === 'worker' || node().kind === 'drone' || node().kind === 'dependency')) {
              <button class="ract" (click)="openDetail.emit(node()); $event.stopPropagation()" aria-label="Inspect">
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
              </button>
            }
            @if (node().kind === 'layer' && node().signature) {
              <button class="ract" (click)="openEditor.emit(node()); $event.stopPropagation()" aria-label="AI edit">
                <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>
              </button>
              <button class="ract" (click)="promoteToPackage.emit(node()); $event.stopPropagation()" aria-label="Promote to package root">
                <svg viewBox="0 0 24 24"><path d="M12 20V7M12 7l-5 5M12 7l5 5M5 4h14"/></svg>
              </button>
            }
          }
        </span>
      </div>
    } @else {
      <div class="row-placeholder" [style.--depth]="node().depth"></div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 1px; }

    .row-placeholder {
      height: 44px;
      padding-left: calc(var(--gut, 22px) + var(--depth, 0) * 18px);
    }

    /* Foundry row — a fixed six-column grid so every signature and action
       aligns down the list. Depth indents the LEFT cluster via padding-left;
       the sig + action columns are anchored to the right gutter, so they hold
       one vertical line at every depth. Optional cells render an empty
       <span class="cell"> so the six columns never shift. */
    .row {
      display: grid;
      grid-template-columns: 16px 34px 18px minmax(0, 1fr) 74px 66px;
      align-items: center;
      column-gap: 12px;
      min-height: 44px;
      padding: 0 var(--gut, 22px) 0 calc(var(--gut, 22px) + var(--depth, 0) * 18px);
      border-bottom: 1px solid var(--dcp-line);
      position: relative;
      background: var(--dcp-surface);
    }
    .row:hover { background: var(--dcp-surface-2); }
    .cell { display: inline-flex; align-items: center; min-width: 0; }

    /* state rail — a 2px left edge; absolute so it never consumes a column */
    .tint { position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: transparent; }

    /* disclosure */
    .disc { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; background: none; cursor: pointer; color: var(--dcp-ink-3); }
    .disc:hover { color: var(--dcp-ink); }
    .chev { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.12s ease; }
    .chev.open { transform: rotate(90deg); }

    /* name cluster */
    .label {
      display: flex; align-items: baseline; gap: 9px;
      background: none; border: none; cursor: pointer; padding: 0;
      min-width: 0; text-align: left; overflow: hidden;
    }
    .name {
      font-size: 14px; font-weight: 600; color: var(--dcp-ink);
      letter-spacing: -0.01em; white-space: nowrap; flex: none;
    }
    .name.bee { color: var(--dcp-k-bee); }
    .name.worker { color: var(--dcp-k-worker); }
    .name.drone { color: var(--dcp-k-drone); }
    .name.dependency { color: var(--dcp-k-dependency); }
    .crumb { font-family: var(--hc-mono); font-size: 10.5px; color: var(--dcp-ink-4); white-space: nowrap; flex: none; }
    .desc { font-size: 11.5px; color: var(--dcp-ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; min-width: 0; }

    /* chips — sharp, uppercase tags */
    .chip {
      font-size: 9px; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase;
      padding: 3px 8px; white-space: nowrap; flex: none; align-self: center; line-height: 1;
    }
    .chip.new { background: var(--dcp-gold-dim); color: var(--dcp-gold-ink); }
    .chip.active { background: var(--dcp-raise); color: var(--dcp-ink-2); border: 1px solid var(--dcp-line-2); }
    .chip.ctx { background: var(--dcp-z-package-tint); color: var(--dcp-z-package-ink); }
    .chip.wait { background: var(--dcp-z-host-tint); color: var(--dcp-z-host-ink); }
    .chip.wait.untrusted { background: rgba(226, 86, 75, 0.14); color: var(--dcp-danger); }
    .chip.audit { font-family: var(--hc-mono); letter-spacing: 0.04em; }
    .chip.audit.met { background: var(--dcp-z-logical-tint); color: var(--dcp-z-logical-ink); }
    .chip.audit.unmet { background: var(--dcp-z-host-tint); color: var(--dcp-z-host-ink); }

    /* signature */
    .sig { font-family: var(--hc-mono); font-size: 10.5px; color: var(--dcp-ink-3); letter-spacing: 0.03em; text-align: right; white-space: nowrap; }

    /* actions */
    .acts { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
    .ract {
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; padding: 0;
      border: 1px solid var(--dcp-line-2); background: none; cursor: pointer;
      color: var(--dcp-ink-2); opacity: 0;
      transition: opacity 0.12s, color 0.12s, border-color 0.12s;
    }
    .ract svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .row:hover .ract { opacity: 1; }
    .ract:hover { color: var(--dcp-accent); border-color: var(--dcp-accent); }
    @media (hover: none) { .ract { opacity: 1; } }

    /* egg hatch */
    .allow {
      font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
      padding: 6px 12px; white-space: nowrap; cursor: pointer;
      border: 1px solid currentColor; background: transparent;
    }
    .allow.untrusted { color: var(--dcp-danger); }
    .allow.undelivered { color: var(--dcp-z-host-ink); }
    .allow:hover { background: var(--dcp-hover); }

    /* ── state variants ── */
    .row.domain-tinted .tint { background: hsl(var(--domain-hue, 220), 45%, 55%); }

    .row.freshly-adopted { background: var(--dcp-z-logical-tint); }
    .row.freshly-adopted .tint { background: var(--dcp-z-logical-rail); }

    .row.freshly-upgraded { background: var(--dcp-z-host-tint); }
    .row.freshly-upgraded .tint { background: var(--dcp-z-host-rail); }

    .row.visual-context { opacity: 0.7; }
    .row.visual-context .tint { background: var(--dcp-z-package-rail); }

    .row.active-elsewhere .tint { background: var(--dcp-active-elsewhere); }
    .row.active-elsewhere .name { color: var(--dcp-ink-2); }

    .row.egg { opacity: 0.85; }

    .row.pending {
      opacity: 0.55; pointer-events: none; font-style: italic;
      animation: row-pending-pulse 1.6s ease-in-out infinite;
    }
    @keyframes row-pending-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.82; } }

    @media (max-width: 600px) {
      .row {
        grid-template-columns: 16px 44px 20px minmax(0, 1fr) 60px 56px;
        column-gap: 10px;
        min-height: 52px;
        padding-left: calc(14px + var(--depth, 0) * 14px);
      }
      .name { font-size: 15px; }
      .crumb, .desc, .chip.audit { display: none; }
      .ract { opacity: 1; }
      .row-placeholder { height: 52px; padding-left: calc(14px + var(--depth, 0) * 14px); }
    }
  `]
})
export class TreeRowComponent implements OnInit, OnDestroy {
  #el = inject(ElementRef)
  #observer: IntersectionObserver | null = null

  node = input.required<TreeNode>()
  enabled = input(true)
  effectivelyEnabled = input(true)
  /** This script is off here but its signature runs via another enabled
   *  feature — drives the quiet "already active" cue. */
  activeElsewhere = input(false)
  hasChildren = input(false)

  toggle = output<TreeNode>()
  /** Ctrl/Cmd was held on the switch — force the whole subtree to the new state. */
  toggleAll = output<TreeNode>()
  /** Modifier latch between pointerdown and dcp-toggle's (toggled). */
  ctrlHeld = false
  open = output<TreeNode>()
  openDetail = output<TreeNode>()
  expandToggle = output<TreeNode>()
  promoteToPackage = output<TreeNode>()
  openEditor = output<TreeNode>()
  /** Request to HATCH an egg — explicitly clear its blocker. For an
   *  'untrusted' egg this is the explicit ALLOW that bypasses the (absent)
   *  community check; for 'undelivered' it's a re-fetch attempt. */
  hatch = output<TreeNode>()

  visible = signal(true)

  docKind = computed(() => this.node().doc?.kind || this.node().kind)

  lineageDisplay = computed(() => {
    const n = this.node()
    if (!n.lineage || n.kind === 'layer' || n.kind === 'domain') return ''
    const parts = n.lineage.split('/')
    if (parts.length <= 1) return n.lineage + ' /'
    return parts.slice(0, -1).join('/') + ' / ' + parts[parts.length - 1] + ' /'
  })

  /** A stable hue (0–359) derived from the node's SOURCE DOMAIN (the first
   *  dotted segment of its lineage, e.g. "diamondcoreprocessor.com"). Tints
   *  the row so that in the mixed logical view you can see which domain each
   *  feature belongs to. Null when no domain can be derived (uncolored). */
  domainHue = computed<number | null>(() => {
    const lineage = this.node().lineage ?? ''
    const seg = lineage.split('/').find(s => s.includes('.')) || lineage.split('/')[0] || ''
    if (!seg) return null
    let h = 0
    for (let i = 0; i < seg.length; i++) h = (h * 31 + seg.charCodeAt(i)) % 360
    return h
  })

  splitClassName = computed(() => {
    const name = this.node().doc?.className
    if (!name) return ''
    const split = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    // don't duplicate when it matches the node name
    if (split === this.node().name) return ''
    return split
  })

  description = computed(() => {
    const n = this.node()
    return n.doc?.description || n.layerDocs?.description || ''
  })

  ngOnInit(): void {
    this.#observer = new IntersectionObserver(
      ([entry]) => this.visible.set(entry.isIntersecting),
      { rootMargin: '200px 0px' }
    )
    this.#observer.observe(this.#el.nativeElement)
  }

  ngOnDestroy(): void {
    this.#observer?.disconnect()
  }
}
