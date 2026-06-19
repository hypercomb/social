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
        @if (!node().visualContext && !node().hatchBlocker) {
          <!-- Enable switch at EVERY level — adopt/enable from any node (the
               root you imported to, a collection, or a single behavior).
               Flipping it puts that node in the logical tree; effectively-
               enabled greys it out when an ancestor in the hierarchy is off
               (turning on "anywhere in the hierarchy" cascades down). -->
          <!-- Ctrl/Cmd+click = select-all gesture: force the WHOLE subtree to
               the clicked node's new state (all on / all off). Modifier is
               captured at pointerdown because dcp-toggle's (toggled) doesn't
               carry the mouse event. -->
          <span (pointerdown)="ctrlHeld = $event.ctrlKey || $event.metaKey">
            <dcp-toggle
              [enabled]="enabled()"
              [effectivelyEnabled]="effectivelyEnabled()"
              (toggled)="(ctrlHeld ? toggleAll : toggle).emit(node()); ctrlHeld = false" />
          </span>
        }
        @if (activeElsewhere() && !node().hatchBlocker) {
          <!-- Already active via another feature: this script's toggle stays
               (it's locally toggleable), but a quiet graphite "linked" glyph
               signals the signature already runs because a sibling pulls it
               in. Neutral on purpose — never a zone color — so it reads as
               "managed elsewhere", not as a sixth provenance. -->
          <span class="active-elsewhere-marker"
            title="Already running — another enabled feature pulls in this same script (same signature), so it's active even though it's off here.">&#9901;</span>
        }
        @if (node().visualContext) {
          <span class="visual-marker" title="Already in the logical install (from another domain or the base) — shown for context">&#9676;</span>
        }
        @if (node().hatchBlocker) {
          <span class="egg-marker"
            [title]="node().hatchBlocker === 'undelivered'
              ? 'Egg — waiting for bytes: no endpoint has delivered this content yet. Hatches when an endpoint serves it.'
              : 'Egg — waiting for community trust: blocked until it meets the safety bar (an attestation arrives) or you override.'">&#129370;</span>
        }

        <dcp-diamond
          [kind]="node().kind"
          (clicked)="open.emit(node())" />

        <button class="label" (click)="hasChildren() ? expandToggle.emit(node()) : open.emit(node())">
          @if (lineageDisplay()) {
            <span class="lineage">{{ lineageDisplay() }}</span>
          }
          <span class="name" [class]="node().kind">{{ node().name }}</span>
          @if (node().freshlyUpgraded && !node().hatchBlocker) {
            <span class="upgraded-note">new</span>
          }
          @if (activeElsewhere() && !node().hatchBlocker) {
            <span class="active-elsewhere-note">active</span>
          }
          @if (node().hatchBlocker) {
            <span class="egg-reason" [class]="node().hatchBlocker!">
              {{ node().hatchBlocker === 'undelivered' ? 'waiting for bytes' : 'waiting for community trust' }}
            </span>
          }
          @if (description()) {
            <span class="description">{{ description() }}</span>
          }
        </button>

        @if (node().hatchBlocker) {
          <button class="egg-hatch-btn" [class]="node().hatchBlocker!"
            (click)="hatch.emit(node()); $event.stopPropagation()"
            [title]="node().hatchBlocker === 'untrusted'
              ? 'Allow this to run — explicit override (there is no community verification yet, so you are the authority)'
              : 'Retry fetching this content from an endpoint'">
            {{ node().hatchBlocker === 'untrusted' ? 'Allow' : 'Retry' }}
          </button>
        }

        @if (splitClassName()) {
          <span class="kind-label" [class]="docKind()">{{ splitClassName() }}</span>
        }

        @if (node().signature) {
          <span class="sig">{{ node().signature!.slice(0, 8) }}</span>
        }

        @if (node().audit) {
          <span class="audit-badge" [class.met]="node().audit!.meetsThreshold" [class.unmet]="!node().audit!.meetsThreshold">
            {{ node().audit!.approvedBy.length }}/{{ node().audit!.total }}
          </span>
        }

        @if (node().signature && (node().kind === 'bee' || node().kind === 'worker' || node().kind === 'drone' || node().kind === 'dependency')) {
          <button class="info-btn" (click)="openDetail.emit(node()); $event.stopPropagation()">&#9432;</button>
        }

        @if (node().kind === 'layer' && node().signature) {
          <button class="edit-btn" (click)="openEditor.emit(node()); $event.stopPropagation()" title="AI Edit">&#9998;</button>
          <button class="promote-btn" (click)="promoteToPackage.emit(node()); $event.stopPropagation()" title="Promote to package root">&#8689;</button>
        }

        @if (hasChildren()) {
          <button class="chevron" (click)="expandToggle.emit(node())">
            {{ node().expanded ? '▾' : '▸' }}
          </button>
        }
      </div>
    } @else {
      <div class="row-placeholder" [style.--depth]="node().depth"></div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 1px; }

    .row-placeholder {
      height: 34px;
      padding-left: calc(12px + var(--depth, 0) * 20px);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px 7px 0;
      padding-left: calc(12px + var(--depth, 0) * 20px);
      border-bottom: 1px solid var(--dcp-line);
      transition: background 0.12s ease;
    }

    .row:hover {
      background: var(--dcp-hover);
    }

    /* Per-domain tint — a colored left edge keyed to the node's source domain,
       so in the mixed logical view you can tell which domain each feature
       belongs to. */
    .row.domain-tinted {
      border-left: 3px solid hsl(var(--domain-hue, 220), 52%, 58%);
      background: hsla(var(--domain-hue, 220), 52%, 55%, 0.045);
    }
    .row.domain-tinted:hover {
      background: hsla(var(--domain-hue, 220), 52%, 55%, 0.10);
    }

    /* Freshly-adopted: the tile you just adopted — persistently highlighted
       ("ready to enable") until you enable it or navigate away. */
    .row.freshly-adopted {
      background: rgba(90, 200, 120, 0.15);
      border-left: 3px solid rgba(60, 180, 100, 0.85);
      box-shadow: inset 0 0 0 1px rgba(60, 180, 100, 0.22);
    }
    .row.freshly-adopted .name { font-weight: 500; }

    /* Freshly-upgraded: a CHANGE-DELTA item from a package update — off by
       default, persistently highlighted as "new — review and enable" until
       the participant opts in. A warm amber to distinguish it from the green
       adopt highlight (different gesture: review an update vs. adopt a tile). */
    .row.freshly-upgraded {
      background: rgba(232, 168, 56, 0.14);
      border-left: 3px solid rgba(222, 158, 46, 0.9);
      box-shadow: inset 0 0 0 1px rgba(222, 158, 46, 0.22);
    }
    .row.freshly-upgraded .name { font-weight: 500; }
    .upgraded-note {
      font-size: 9.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 1px 7px;
      border-radius: 999px;
      background: rgba(222, 158, 46, 0.2);
      color: rgb(176, 118, 18);
      flex-shrink: 0;
      align-self: center;
    }

    /* Visual-context: a read-only item already in the logical install from
       ANOTHER domain or the base — marked by a left border + tinted
       background; no toggle, dimmed. */
    .row.visual-context {
      opacity: 0.7;
      background: rgba(90, 120, 200, 0.06);
      border-left: 3px solid rgba(90, 120, 200, 0.5);
    }
    .visual-marker {
      color: rgba(120, 145, 215, 0.85);
      font-size: 12px;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }

    /* Already active via another feature: a quiet, ZONE-NEUTRAL cue. A
       graphite inset rail (box-shadow, NOT border-left, so it never fights
       the domain-tint border) + a graphite "linked" glyph + a muted "active"
       label. The toggle stays — the node is locally toggleable; the cue only
       says "its signature already runs via a sibling". The name dims to
       secondary ink to read as "not the one in charge of this sig". */
    .row.active-elsewhere {
      box-shadow: inset 3px 0 0 var(--dcp-active-elsewhere);
      background: var(--dcp-active-elsewhere-soft);
    }
    .row.active-elsewhere:hover {
      background: var(--dcp-hover);
    }
    .row.active-elsewhere .name { color: var(--dcp-ink-2); }
    .active-elsewhere-marker {
      color: var(--dcp-active-elsewhere);
      font-size: 13px;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .active-elsewhere-note {
      font-size: 9.5px;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dcp-active-elsewhere);
      flex-shrink: 0;
      align-self: center;
    }

    /* Egg: a known-but-not-hatched layer. Two causes (undelivered bytes /
       untrusted), one affordance — muted row, egg marker, reason chip, no
       toggle (it can't activate until it hatches). */
    .row.egg { opacity: 0.78; }
    .egg-marker {
      font-size: 13px;
      width: 16px;
      text-align: center;
      flex-shrink: 0;
    }
    .egg-reason {
      font-size: 0.58rem;
      font-weight: 500;
      letter-spacing: 0.03em;
      padding: 1px 7px;
      border-radius: 999px;
      white-space: nowrap;
      flex-shrink: 0;
      background: var(--dcp-z-host-tint);
      color: var(--dcp-z-host-ink);
    }
    .egg-reason.untrusted {
      background: rgba(200, 90, 90, 0.16);
      color: var(--dcp-danger);
    }
    .egg-hatch-btn {
      font-size: 0.6rem;
      font-weight: 500;
      letter-spacing: 0.04em;
      padding: 3px 11px;
      border-radius: 999px;
      cursor: pointer;
      flex-shrink: 0;
      border: 1px solid currentColor;
      background: transparent;
    }
    .egg-hatch-btn.untrusted { color: var(--dcp-danger); }
    .egg-hatch-btn.undelivered { color: var(--dcp-z-host-ink); }
    .egg-hatch-btn:hover { background: var(--dcp-hover); }

    /* Pending: this row is a placeholder for content still being fetched.
       Muted text, gentle pulse, no edit/toggle actions reachable until
       the real subtree replaces it. */
    .row.pending {
      opacity: 0.55;
      pointer-events: none;
      font-style: italic;
      animation: row-pending-pulse 1.6s ease-in-out infinite;
    }

    @keyframes row-pending-pulse {
      0%, 100% { opacity: 0.55; }
      50%      { opacity: 0.85; }
    }

    .label {
      display: flex;
      align-items: baseline;
      gap: 8px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      flex: 1;
      min-width: 0;
      text-align: left;
      flex-wrap: wrap;
    }

    .name {
      font-size: 12px;
      font-weight: 500;
      color: var(--dcp-ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.005em;
    }

    .name.bee { color: var(--dcp-k-bee); }
    .name.worker { color: var(--dcp-k-worker); }
    .name.drone { color: var(--dcp-k-drone); }
    .name.dependency { color: var(--dcp-k-dependency); }

    .description {
      font-size: 10.5px;
      color: var(--dcp-ink-3);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      line-height: 1.25;
    }

    .lineage {
      font-size: 10px;
      color: var(--dcp-ink-3);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .kind-label {
      font-size: 11.5px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
      margin-left: auto;
      color: var(--dcp-k-bee);
    }

    .kind-label.worker { color: var(--dcp-k-worker); }
    .kind-label.drone { color: var(--dcp-k-drone); }
    .kind-label.queen { color: var(--dcp-k-queen); }
    .kind-label.dependency { color: var(--dcp-k-dependency); }

    .sig {
      font-family: var(--hc-mono);
      font-size: 10px;
      color: var(--dcp-ink-3);
      flex-shrink: 0;
      opacity: 0.8;
    }

    .audit-badge {
      font-size: 10px;
      font-weight: 500;
      padding: 1px 7px;
      border-radius: 999px;
      flex-shrink: 0;
    }

    .audit-badge.met {
      background: var(--dcp-z-logical-tint);
      color: var(--dcp-z-logical-ink);
    }

    .audit-badge.unmet {
      background: var(--dcp-z-host-tint);
      color: var(--dcp-z-host-ink);
    }

    .chevron {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      color: var(--dcp-ink-2);
      padding: 0 4px;
      flex-shrink: 0;
      transition: color 0.12s ease;
    }

    .chevron:hover {
      color: var(--dcp-ink);
    }

    .edit-btn,
    .promote-btn {
      background: none;
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm, 6px);
      cursor: pointer;
      font-size: 12px;
      color: var(--dcp-accent);
      padding: 2px 5px;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 0.15s, background 0.12s;
    }

    .row:hover .edit-btn,
    .row:hover .promote-btn {
      opacity: 1;
    }

    .edit-btn:hover,
    .promote-btn:hover {
      background: var(--dcp-accent-tint);
    }

    /* info / review-code button — opens the detail (doc, source, audit) for a
       code item (bee/worker/drone/dependency). */
    .info-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: 1px solid var(--dcp-line-2);
      border-radius: var(--dcp-radius-sm, 6px);
      cursor: pointer;
      font-size: 12px;
      color: var(--dcp-accent);
      padding: 2px 6px;
      flex-shrink: 0;
      transition: background 0.12s;
    }
    .info-btn:hover { background: var(--dcp-accent-tint); }

    @media (max-width: 600px) {
      .row {
        padding-left: calc(10px + var(--depth, 0) * 14px);
        gap: 8px;
        padding-top: 10px;
        padding-bottom: 10px;
        min-height: 48px;
      }

      .name {
        font-size: 15px;
        font-weight: 500;
      }

      /* hide technical details — tap to see them in the detail view */
      .description,
      .lineage,
      .kind-label,
      .sig,
      .audit-badge,
      .active-elsewhere-note,
      .upgraded-note {
        display: none;
      }

      .info-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 1px solid var(--dcp-line-2);
        border-radius: var(--dcp-radius-sm, 6px);
        cursor: pointer;
        font-size: 18px;
        color: var(--dcp-accent);
        min-width: 40px;
        min-height: 40px;
        flex-shrink: 0;
        margin-left: auto;
        transition: background 0.15s;
      }

      .info-btn:active {
        background: var(--dcp-accent-tint);
      }

      .row-placeholder {
        height: 48px;
        padding-left: calc(10px + var(--depth, 0) * 14px);
      }

      .chevron {
        font-size: 18px;
        padding: 4px 8px;
        min-width: 44px;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
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
