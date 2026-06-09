// diamond-core-processor/src/app/home/home.component.ts

import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core'
import { TreeResolverService } from '../core/tree-resolver.service'
import { ToggleStateService } from '../core/toggle-state.service'
import { DcpDomainStorage, normalizeDomainKey } from '../core/dcp-domain-storage.service'
import { PatchStore, type PatchRecord } from '../core/patch-store'
import { PackageExportService } from '../core/package-export.service'
import { TreeViewComponent } from '../tree-view/tree-view.component'
import { AuditorSettingsComponent } from '../settings/auditor-settings.component'
import { RelayPanelComponent } from '../relay/relay-panel.component'
import { BeeInspectorComponent } from '../tree-view/bee-inspector.component'
import { DiamondIconComponent } from '../tree-view/diamond-icon.component'
import { PatchListComponent } from '../patch-list/patch-list.component'
import { DcpCommandLineComponent } from '../command-line/dcp-command-line.component'
import { LayerEditorComponent } from '../layer-editor/layer-editor.component'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import { defaultHostOrigin, devDefaultBootstrap } from '../core/default-host'
import { EffectBus } from '@hypercomb/core'
import type { BatchPatchResult, PatchResult } from '../core/merkle-patch.service'
import { isCodeKind, defaultEnabled } from '../core/tree-node'
import type { BeeDocEntry, TreeNode, TreeNodeKind } from '../core/tree-node'

const DOMAINS_KEY = 'dcp.domains'

/** The always-first sibling: the active/logical install view. */
const LOGICAL_VIEW_NAME = 'current active logical view'

export interface DomainSection {
  domain: string
  domainName: string
  /** Display name derived from the root layer's domain folder (e.g. "diamondcoreprocessor.com") */
  displayDomain: string
  rootSig: string
  originalRootSig: string
  items: TreeNode[]
  loading: boolean
  error: string | null
  installStatus: string | null
  patches: PatchRecord[]
  enabled: boolean
}

export interface DomainGroup {
  domain: string
  domainName: string
  sections: DomainSection[]
  hiddenVersionCount: number
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [TreeViewComponent, AuditorSettingsComponent, RelayPanelComponent, BeeInspectorComponent, DiamondIconComponent, PatchListComponent, DcpCommandLineComponent, LayerEditorComponent, DcpTranslatePipe],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnDestroy {

  readonly #resolver = inject(TreeResolverService)
  readonly #toggleState = inject(ToggleStateService)
  readonly #domainStorage = inject(DcpDomainStorage)
  readonly #patchStore = inject(PatchStore)
  readonly #exporter = inject(PackageExportService)

  // Per-domain visibility is PARTICIPANT-LOCAL decoration (localStorage),
  // NOT in the domains lineage — same principle as "viewport/clipboard
  // never in history". DcpDomainStorage owns the sticky storage; this
  // signal is just a reactivity trigger so the template re-renders when a
  // toggle flips. isDomainVisible() reads the service synchronously.
  readonly #visibilityVersion = signal(0)

  // Reactivity trigger bumped after a logical recompute so any view reading
  // the logical (e.g. the visual-context nodes) re-renders. The logical
  // itself lives in the `logical` sigbag lineage (DcpDomainStorage); this is
  // just the signal that says "it changed, re-read it".
  readonly #logicalVersion = signal(0)

  readonly receivedLayerSigs = signal<string[]>([])
  #fromHcChannel: BroadcastChannel | null = null

  // "Pushed to Hypercomb" toast — shown after the user installs a new
  // domain so they know the cross-origin push happened and to switch
  // back to their Hypercomb tab.
  readonly installToastVisible = signal(false)
  #installToastTimer: ReturnType<typeof setTimeout> | null = null

  // state
  // Default content source: Azure blob storage (the canonical, deployed
  // location for bee/layer/dependency bundles). DCP's own origin no
  // longer serves content — it is a UI-only static web app.
  // Default trusted-domain suggestion. On a real host (e.g. jwize.com) this
  // is the page's own origin — the host that served you the SPA is the
  // obvious source of truth for which domain to install from. On localhost
  // we fall back to the Azure blob storage URL so dev keeps working without
  // configuration. Same helper backs the relay-panel's URL default so both
  // install UIs in the top bar agree on what "this DCP instance's host" is.
  readonly defaultContentBase = defaultHostOrigin('https://storagehypercomb.blob.core.windows.net/dcp')
  readonly domains = signal<string[]>(this.#loadDomains())
  readonly domainInput = signal('')
  readonly searchTerm = signal('')
  readonly sections = signal<DomainSection[]>([])
  readonly inspectBee = signal<string | null>(null)
  readonly inspectKind = signal<TreeNodeKind>('bee')
  readonly kindFilters = signal<Set<string>>(new Set())
  readonly layersCollapsed = signal(false)
  readonly showAllVersions = signal(false)
  readonly #savedExpandStates = new Map<string, boolean>()
  readonly filterKinds: { key: string, diamond: TreeNodeKind }[] = [
    { key: 'bee', diamond: 'bee' },
    { key: 'worker', diamond: 'worker' },
    { key: 'dependency', diamond: 'dependency' }
  ]
  readonly inspectSection = signal<DomainSection | null>(null)
  readonly inspectDoc = signal<BeeDocEntry | undefined>(undefined)
  readonly inspectLineage = signal('')
  readonly inspectMode = signal<'code' | 'detail'>('code')
  readonly selectedNodeNames = signal<string[]>([])

  // layer editor state
  readonly inspectLayer = signal<TreeNode | null>(null)
  readonly inspectLayerSection = signal<DomainSection | null>(null)

  // flat list of all nodes for command line suggestions
  readonly allNodes = computed(() => {
    const result: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        result.push(n)
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return result
  })

  // all nodes flattened for toggle lookups
  readonly toggleMap = computed(() => {
    const map = new Map<string, boolean>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        // Kind-aware absent-default: adopted CODE reads OFF, DATA reads ON,
        // so the tree shows "adopt all tiles, functions off" out of the box.
        map.set(n.id, this.#toggleState.isEnabled(n.id, defaultEnabled(n.kind)))
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return map
  })

  readonly nodeMap = computed(() => {
    const map = new Map<string, TreeNode>()
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n)
        walk(n.children)
      }
    }
    for (const s of this.sections()) walk(s.items)
    return map
  })


  readonly domainGrouped = computed<DomainGroup[]>(() => {
    const groups = new Map<string, DomainGroup>()
    for (const s of this.filteredSections()) {
      const key = s.displayDomain
      let group = groups.get(key)
      if (!group) {
        group = { domain: s.domain, domainName: s.displayDomain, sections: [], hiddenVersionCount: 0 }
        groups.set(key, group)
      }
      group.sections.push(s)
    }
    const showAll = this.showAllVersions()
    for (const group of groups.values()) {
      if (!showAll && group.sections.length > 1) {
        group.hiddenVersionCount = group.sections.length - 1
        group.sections = group.sections.slice(0, 1)
      }
    }
    // Library/source siblings, sorted alphabetically (diamondcoreprocessor.com,
    // jwize.com, miro.com…).
    const libraryGroups = Array.from(groups.values())
      .sort((a, b) => a.domainName.localeCompare(b.domainName))

    // The "current active logical view" is NOT a domain — it's the MERGED mix
    // of all enabled libraries, combined into one root-level hierarchy (no
    // .coms; same-named folders fold together). Prepended as the first sibling.
    const logicalGroup: DomainGroup = {
      domain: '@logical', domainName: LOGICAL_VIEW_NAME, hiddenVersionCount: 0,
      sections: [{
        domain: '@logical', domainName: LOGICAL_VIEW_NAME, displayDomain: LOGICAL_VIEW_NAME,
        rootSig: '', originalRootSig: '', items: this.logicalViewItems(),
        loading: false, error: null, installStatus: null, patches: [], enabled: true,
      }],
    }
    return [logicalGroup, ...libraryGroups]
  })

  /** The current active logical view: the MERGE of every library's content
   *  into one root-level hierarchy (the .com domain layer dissolved; same-
   *  named folders combined). This is the "mixed" result — what actually runs
   *  in hypercomb.io — as opposed to the per-domain source siblings. Reactive
   *  to the sections + (later) the enable selections. */
  readonly logicalViewItems = computed<TreeNode[]>(() => {
    // every source sibling EXCEPT the synthetic logical view itself; the
    // jwize.com import marker + unresolved adopt eggs contribute [] naturally.
    const sources = this.sections().filter(s => s.domain !== '@logical')
    return this.#mergeTrees(sources.map(s => s.items))
  })

  /** Accordion: the one top-level sibling whose tree is open (mutually
   *  exclusive — look at one level at a time). Empty = all collapsed. */
  readonly openGroup = signal<string>(LOGICAL_VIEW_NAME)
  toggleGroupOpen(domainName: string): void {
    this.openGroup.update(cur => cur === domainName ? '' : domainName)
  }
  isGroupOpen(domainName: string): boolean { return this.openGroup() === domainName }

  readonly filteredSections = computed(() => {
    const term = this.searchTerm().toLowerCase().trim()
    const active = this.kindFilters()
    let sections = this.sections()

    if (term) {
      sections = sections
        .map(s => ({ ...s, items: this.#filterTree(s.items, term) }))
        .filter(s => s.items.length > 0)
    }

    if (active.size > 0) {
      const kindSet = new Set<TreeNodeKind>()
      if (active.has('bee')) { kindSet.add('bee'); kindSet.add('drone') }
      if (active.has('worker')) kindSet.add('worker')
      if (active.has('dependency')) kindSet.add('dependency')
      sections = sections
        .map(s => ({ ...s, items: this.#flattenByKind(s.items, kindSet) }))
        .filter(s => s.items.length > 0)
    }

    return sections
  })

  constructor() {
    // auto-load on init
    effect(() => {
      const doms = this.domains()
      if (doms.length) this.#loadAllDomains(doms)
    })

    // Warm the settings sigbag into the in-memory cache so visibility reads
    // are accurate, then bump the reactivity trigger so the template
    // re-renders with the loaded values. Settings now live in an undoable
    // sigbag lineage (not localStorage) — load it like any other hive.
    void this.#domainStorage.loadSettingsCache()
      .then(() => this.#visibilityVersion.update(v => v + 1))
      .catch(() => { /* empty/first-run — defaults apply */ })

    // #60: render the installer's adopted-branch sections FROM the domains
    // lineage on load. The lineage is the durable source of "what I've
    // adopted, from whom, where" (it persists across reloads in OPFS); the
    // sections signal does not. So on init we rebuild the per-domain
    // sections from loadDomainsHive() — adopted branches reappear under
    // their owner domain (the root/[domain] view) every time the installer
    // opens, sourced from the sigbag, not from a transient in-memory push.
    void this.#refreshFromLineage()

    // Default baseline: if the dashboard would otherwise be empty, resolve a
    // hard-coded dev (domain, sig) so we always see files load. The baseline
    // resolves EXACTLY like an adopt — a signature filled out by a domain.
    void this.#seedDefaultBaseline()

    // #62: post an initial registry snapshot to the hive on load, so the
    // consumer surface has the current logical projection from the start.
    void this.#postRegistrySnapshot()

    // Dev-only: expose the lineage-storage service on window so the driver
    // test can exercise the domains / host-domains / settings sigbags
    // against the real service code. Guarded to loopback so it never
    // appears in a production installer.
    try {
      const host = window.location.hostname
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        ;(window as unknown as { __dcpDomains?: unknown }).__dcpDomains = this.#domainStorage
        ;(window as unknown as { __dcpHome?: unknown }).__dcpHome = this
      }
    } catch { /* ignore */ }

    // Surface anything the user has authored in hypercomb-web — every
    // sentinel intake broadcasts here, so this list reflects all the
    // changes the user has made up to this point in time.
    void this.#refreshReceivedLayers()
    try {
      this.#fromHcChannel = new BroadcastChannel('dcp-from-hypercomb')
      this.#fromHcChannel.onmessage = () => {
        void this.#refreshReceivedLayers()
        // Existing sections might depend on a layer that just arrived
        // (e.g. resolving a freshly received subtree). Bumping the
        // sections signal forces re-renders to pick up new bytes.
        this.#refreshSections()
      }
    } catch { /* BroadcastChannel unavailable */ }

    // Adoption flow — branch-rooted section.
    //
    // Click Adopt → broker.adopt(branchSig) walks recursively → adopt:meta
    // fires with { rootSig: branchSig, domains }. We push a NEW section
    // keyed by the branchSig, NOT by the source domain. The section
    // displays ONLY the recursive subtree under that branchSig — the
    // dependencies the participant actually adopted, not the whole
    // host's manifest. Idempotent: if a section for this branchSig is
    // already present, we just scroll to it (no duplicate).
    //
    // The section starts in `loading: true`. In parallel, broker.adopt is
    // landing bytes in OPFS; #resolveBranchSection polls
    // TreeResolver.resolveFromLocal until the walk completes, then
    // populates section.items. Failure after the retry budget surfaces
    // as section.error.
    EffectBus.on<{ rootSig?: string; domains?: string[]; label?: string }>('adopt:meta', (p) => {
      const branchSig = String(p?.rootSig ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(branchSig)) return

      const domains = Array.isArray(p?.domains)
        ? p.domains.map(d => String(d ?? '').trim()).filter(Boolean)
        : []
      const sourceDomainScoped = domains[0] ? this.#prependScheme(domains[0]) : ''
      const tileName = String(p?.label ?? '').trim()

      // Idempotent re-adopt: existing section for this branchSig wins
      const existing = this.sections().find(s => s.rootSig === branchSig)
      if (existing) {
        setTimeout(() => this.#scrollSectionIntoView(existing.domain), 50)
        return
      }

      // Organize by capture-source DOMAIN folder — content lands under the
      // host it came from (jwize.com, alice.dev), the same as the default
      // baseline. The tile name is the CUE (installStatus + the portal
      // breadcrumb), NOT the folder label. Only when the publisher advertised
      // no domain (a browser-published swarm tile) do we fall back to the
      // tile name, then a sig prefix, so the section still reads recognizably.
      const sourceHost = (() => {
        try { return sourceDomainScoped ? new URL(sourceDomainScoped).hostname.toLowerCase() : '' }
        catch { return sourceDomainScoped }
      })()
      const displayName = sourceHost || tileName || `branch-${branchSig.slice(0, 8)}`
      // The cue always names the tile being adopted, even when the folder is
      // the domain.
      const cueName = tileName || displayName

      const branchSection: DomainSection = {
        // domain doubles as the section's idempotency key + scroll target
        // selector; for branch sections without a known source we synthesize
        // a `branch://` URI so the section still has a unique identifier.
        domain:         sourceDomainScoped || `branch://${branchSig}`,
        domainName:     displayName,
        displayDomain:  displayName,
        rootSig:        branchSig,
        originalRootSig: branchSig,
        items:          [],
        loading:        true,
        error:          null,
        installStatus:  `Adopting ${cueName} — resolving content. Features arrive OFF; turn on what you want.`,
        patches:        [],
        enabled:        true,
      }
      this.sections.update(secs => [...secs, branchSection])

      // Resolve the walked subtree from local OPFS in parallel. broker.adopt
      // is already fetching the bytes; this just waits for them to land.
      void this.#resolveBranchSection(branchSig, branchSection.domain)

      // Scroll once Angular renders the new section element.
      setTimeout(() => this.#scrollSectionIntoView(branchSection.domain), 100)
    })

    // ─── URL-hash handoff from the hive's adopt button ─────────────────
    // When the hive (hypercomb-dev / hypercomb-web) opens DCP via
    // portal:open with a branchSig, portal-overlay appends `#branch=<sig>`
    // to the iframe URL. This reads that sig on init and fires a synthetic
    // adopt:meta so the branch-section handler above picks it up — same
    // path as an in-process adopt would take, just sourced from the URL
    // instead of EffectBus. Also kicks off this DCP instance's broker.adopt
    // so the bytes land in DCP's OPFS for resolveFromLocal to find. Defers
    // a microtask so the adopt:meta listener (registered above) and the
    // broker IoC entry are both in place when we fire.
    this.#processBranchHash()

    // Browsers do NOT reload an iframe on hash-only URL changes, so when
    // portal-overlay swaps `…#branch=A` → `…#branch=B` for a second adopt
    // the constructor doesn't re-run. Listen for hashchange too so each
    // adopt-via-iframe gets processed even on a persistent DCP instance.
    window.addEventListener('hashchange', () => this.#processBranchHash())
  }

  /** Read `#branch=<sig>&at=<segments>` from the URL hash and route it
   *  through the same adopt:meta pathway the in-process adopt button uses.
   *  `branch` = WHAT (the meta-layer signature). `at` = WHERE (the
   *  participant's current location at click-time, comma-joined segments).
   *  Together they're the entire iframe handoff: the gesture IS the
   *  placement, no installer organization step. */
  #processBranchHash(): void {
    try {
      const hash = window.location.hash.replace(/^#/, '')
      if (!hash) return
      const params = new URLSearchParams(hash)
      const branchSig = (params.get('branch') ?? '').trim().toLowerCase()
      if (!/^[a-f0-9]{64}$/.test(branchSig)) return

      // Comma-joined segments because URLSearchParams reserves `&` and `=`.
      // Empty `at` = root; non-empty = path from root.
      const atRaw = params.get('at') ?? ''
      const at = atRaw.split(',').map(s => s.trim()).filter(Boolean)

      // The publisher's domain (byte path) — WHERE to HTTP-direct fetch the
      // adopted content's resources from. Seeded into the broker as a
      // session fetch source so this fresh installer context (no observed
      // mesh responses) can pull resources from the source host. Empty for
      // a domainless browser-only publisher.
      const ownerDomain = (params.get('domain') ?? '').trim()

      // Human tile name (display only — never used for resolution). Lets the
      // section header read "Adopting <name>" instead of a sig prefix.
      const tileName = (params.get('label') ?? '').trim()

      queueMicrotask(() => {
        // Pass the publisher's domain so the branch organizes under its
        // capture-source DOMAIN FOLDER (where it came from), same as the
        // default baseline. Empty for a browser-published tile → the handler
        // falls back to the tile name.
        EffectBus.emit('adopt:meta', {
          rootSig: branchSig,
          domains: ownerDomain ? [ownerDomain] : [],
          at,
          label: tileName,
        })

        const ioc = (window as { ioc?: {
          get?: (k: string) => unknown
          whenReady?: <T>(k: string, cb: (v: T) => void) => void
        } }).ioc

        // After the walk resolves, record the adoption in the OWNING
        // domain's lineage sigbag at the placement location. Per the design:
        // "add the current adopt to that folder and that location in DCP …
        // the domain request dictates what domain sigbag it runs in and the
        // domain comes from the adopt click." The mesh is pubkey-based, so
        // the publisher's DOMAIN is learned during the walk (the broker's
        // {bytes, domains} address graph) — getKnownDomains(branchSig)
        // returns it once attributed. We record under the FIRST known owner
        // domain; if the owner isn't attributed yet we DEFER (don't mis-file
        // under a guessed domain) — the existing synthetic section still
        // surfaces the branch, and a later re-adopt can record it once the
        // owner is known. Dependencies are resolved by the broker from THEIR
        // respective domains (the walk's per-sig domain attribution +
        // TreeResolver's namespace-lineage map); recording each dep under
        // its own domain silo is the follow-on refinement.
        type BrokerLike = {
          adopt?: (sig: string) => Promise<unknown>
          getKnownDomains?: (sig: string) => string[]
          noteDomain?: (domain: string) => void
        }
        const recordInLineage = (broker: BrokerLike): void => {
          try {
            const domains = broker.getKnownDomains?.(branchSig) ?? []
            const owner = String(domains[0] ?? '').trim().toLowerCase()
            if (!owner) {
              console.info('[home] adopt owner not yet attributed; deferring lineage record for', branchSig.slice(0, 12))
              return
            }
            void this.#domainStorage.addDomainBranch(owner, branchSig, at)
              .then(() => {
                console.info('[home] recorded adopt in lineage:', owner, '←', branchSig.slice(0, 12), 'at', at.join('/') || '/')
                // #60: reflect the lineage's domain organization in the
                // render. The adopt:meta handler created the branch's
                // section under a provisional `branch://<sig>` bucket
                // (owner wasn't known at hash-time). Now that the walk has
                // resolved the OWNER domain, reclassify the section under
                // it so domainGrouped() groups the branch in the
                // root/[domain] view (e.g. under "alice.com") — the
                // per-domain source view you adopt into. Matched by
                // rootSig so it finds the right section regardless of the
                // in-flight resolveBranchSection poll.
                this.sections.update(secs => secs.map(s =>
                  s.rootSig === branchSig
                    ? { ...s, domain: `https://${owner}`, domainName: owner, displayDomain: owner }
                    : s
                ))
                // #62: a new adoption changed the registry — tell the hive.
                void this.#postRegistrySnapshot()
              })
              .catch(e => console.warn('[home] addDomainBranch failed', e))
          } catch (e) { console.warn('[home] recordInLineage failed', e) }
        }

        const startWalk = (broker: BrokerLike): void => {
          // Byte path: seed the publisher's domain as a fetch source BEFORE
          // the walk, so broker.adopt's HTTP-direct resource fetches have a
          // target host (this installer context has observed no mesh
          // responses of its own). sha256 still gates acceptance.
          if (ownerDomain && broker?.noteDomain) {
            try { broker.noteDomain(ownerDomain) } catch { /* non-fatal */ }
          }
          if (broker?.adopt) {
            void broker.adopt(branchSig)
              .then(() => recordInLineage(broker))
              .catch(e =>
                console.warn('[home] broker.adopt failed for branch', branchSig.slice(0, 12), e)
              )
          }
        }

        const now = ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as
          BrokerLike | undefined
        if (now?.adopt) {
          startWalk(now)
        } else if (ioc?.whenReady) {
          ioc.whenReady<BrokerLike>(
            '@diamondcoreprocessor.com/ContentBrokerDrone',
            (broker) => startWalk(broker)
          )
        }
      })
    } catch { /* malformed hash → silent — user can re-trigger adopt */ }
  }

  /** Poll TreeResolver.resolveFromLocal until the branch's content is
   *  available in OPFS (broker.adopt is fetching in parallel), then
   *  populate the section's items. Bounded retries — if the walk doesn't
   *  complete in time the section surfaces an error and the user can
   *  decide whether to retry the adoption. */
  async #resolveBranchSection(branchSig: string, sectionDomain: string): Promise<void> {
    const MAX_RETRIES = 30 // ~6s at 200ms cadence
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const root = await this.#resolver.resolveFromLocal(branchSig, sectionDomain)
        if (root) {
          this.sections.update(secs => secs.map(s =>
            s.rootSig === branchSig
              // Preserve any visual-context nodes (#77-B) already appended to
              // the section — resolution replaces only the resolved root, not
              // the read-only context of other domains' features. #74:
              // auto-EXPAND the adopted branch root so its features are
              // visible the moment you land — "explore in realtime".
              ? { ...s, items: [{ ...root, expanded: true }, ...s.items.filter(it => it.visualContext)], loading: false, installStatus: null }
              : s
          ))
          // #74: now that the content is resolved + expanded, scroll to it
          // and briefly highlight so the participant lands ON the new node.
          setTimeout(() => this.#scrollSectionIntoView(sectionDomain, true), 60)
          // #71: record cross-domain dependencies under THEIR own silos.
          const sec = this.sections().find(s => s.rootSig === branchSig)
          if (sec) {
            void this.recordTreeDeps(root, sec.domainName)
              .then(n => { if (n > 0) void this.#postRegistrySnapshot() })
              .catch(e => console.warn('[home] recordTreeDeps failed', e))
          }
          return
        }
      } catch { /* swallow + retry — bytes may not have landed yet */ }
      await new Promise(r => setTimeout(r, 200))
    }
    // Bytes never arrived → the branch is an UNDELIVERED EGG: known (we hold
    // the sig in the lineage) but not hatched — no endpoint has delivered
    // the bytes yet. Show it as an egg "waiting for bytes", NOT a hard error:
    // it's durable + re-fetchable, never "failed", just "not yet delivered".
    // A later fetch (re-adopt, or an endpoint appearing for this sig) hatches
    // it. Preserve any visual-context nodes.
    this.sections.update(secs => secs.map(s =>
      s.rootSig === branchSig
        ? {
            ...s,
            loading: false,
            error: null,
            installStatus: null,
            items: [
              {
                id: `egg:${branchSig.slice(0, 12)}`,
                name: s.domainName || branchSig.slice(0, 8),
                kind: 'layer',
                lineage: s.domainName || '',
                children: [],
                expanded: false,
                loaded: true,
                depth: 0,
                hatchBlocker: 'undelivered',
              } as TreeNode,
              ...s.items.filter(it => it.visualContext),
            ],
          }
        : s
    ))
  }

  /** Add a domain to the trusted-domains list without going through the
   *  input field. Same dedupe + normalization as addDomain(); silent
   *  no-op if the domain is already trusted (the existing section stays
   *  put — the user already has it open). */
  #addTrustedDomainProgrammatic(rawUrl: string): void {
    try {
      const url = new URL(rawUrl)
      const scope = url.pathname && url.pathname !== '/'
        ? `${url.origin}${url.pathname.replace(/\/+$/, '')}`
        : url.origin
      if (this.domains().includes(scope)) return
      const next = [...this.domains(), scope]
      this.domains.set(next)
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
    } catch { /* malformed URL — drop silently */ }
  }

  /** Make a bare host name (e.g. `jwize.com`, `wss://jwize.com`) into a
   *  proper https URL that DCP's trusted-domain machinery understands.
   *  Mesh attributions arrive in any of these shapes; DCP needs an
   *  https origin. */
  #prependScheme(raw: string): string {
    const trimmed = String(raw ?? '').trim().replace(/\/+$/, '')
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^wss?:\/\//i.test(trimmed)) return trimmed.replace(/^wss?:\/\//i, 'https://')
    return 'https://' + trimmed
  }

  /** Scroll the .domain-section corresponding to `domain` into view so
   *  the user lands ON the installer node for the host they just
   *  adopted from. The DCP installer scrolls within the page's main
   *  scrolling element, so behavior is the standard browser smooth
   *  scroll. No-op if the section hasn't rendered yet. */
  #scrollSectionIntoView(domain: string, highlight = false): void {
    try {
      const el = document.querySelector(`.domain-section[data-domain="${CSS.escape(domain)}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      // #74: brief highlight so the participant sees WHERE they landed —
      // "the tree opens to that newly created node". Auto-clears.
      if (highlight) {
        el.classList.add('just-adopted')
        setTimeout(() => el.classList.remove('just-adopted'), 2200)
      }
    } catch { /* CSS.escape missing in old browsers, querySelector failed — non-fatal */ }
  }

  ngOnDestroy(): void {
    this.#fromHcChannel?.close()
    if (this.#installToastTimer) clearTimeout(this.#installToastTimer)
  }

  showInstallToast(): void {
    if (this.#installToastTimer) clearTimeout(this.#installToastTimer)
    this.installToastVisible.set(true)
    this.#installToastTimer = setTimeout(() => {
      this.installToastVisible.set(false)
      this.#installToastTimer = null
    }, 8_000)
  }

  dismissInstallToast(): void {
    if (this.#installToastTimer) {
      clearTimeout(this.#installToastTimer)
      this.#installToastTimer = null
    }
    this.installToastVisible.set(false)
  }

  async #refreshReceivedLayers(): Promise<void> {
    const sigs = await this.#resolver.listReceivedLayers()
    this.receivedLayerSigs.set(sigs)
  }

  // kind filter toggles
  toggleKindFilter(key: string): void {
    const next = new Set(this.kindFilters())
    if (next.has(key)) next.delete(key)
    else next.add(key)
    this.kindFilters.set(next)
  }

  isKindActive(key: string): boolean {
    return this.kindFilters().has(key)
  }

  isFiltering(): boolean {
    return this.kindFilters().size > 0
  }

  // command line bridge
  onFilterTerm(term: string): void {
    this.searchTerm.set(term)
  }

  onKindFilter(kinds: Set<string>): void {
    this.kindFilters.set(kinds)
  }

  onSelectedNames(names: string[]): void {
    this.selectedNodeNames.set(names)
  }

  toggleCollapseAllLayers(): void {
    const sections = this.sections()
    if (!this.layersCollapsed()) {
      this.#savedExpandStates.clear()
      for (const s of sections) for (const top of s.items) this.#walkLayers(top.children, (node) => {
        this.#savedExpandStates.set(node.id, node.expanded)
        node.expanded = false
      })
      this.layersCollapsed.set(true)
    } else {
      for (const s of sections) for (const top of s.items) this.#walkLayers(top.children, (node) => {
        const saved = this.#savedExpandStates.get(node.id)
        if (saved !== undefined) node.expanded = saved
      })
      this.#savedExpandStates.clear()
      this.layersCollapsed.set(false)
    }
    this.#refreshSections()
  }

  // domain management
  addDomain(): void {
    const raw = this.domainInput().trim()
    if (!raw) return

    try {
      const url = new URL(raw)
      const scope = url.pathname && url.pathname !== '/'
        ? `${url.origin}${url.pathname.replace(/\/+$/, '')}`
        : url.origin

      if (this.domains().includes(scope)) {
        this.domainInput.set('')
        return
      }

      const next = [...this.domains(), scope]
      this.domains.set(next)
      localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
      this.domainInput.set('')
      this.showInstallToast()
    } catch {
      // ignore invalid urls
    }
  }

  removeDomain(domain: string): void {
    const next = this.domains().filter(d => d !== domain)
    this.domains.set(next)
    localStorage.setItem(DOMAINS_KEY, JSON.stringify(next))
    const remaining = this.sections().filter(s => s.domain !== domain)
    this.sections.set(remaining)

    // clear search/filter state if no sections remain
    if (remaining.length === 0) {
      this.searchTerm.set('')
      this.kindFilters.set(new Set())
      this.layersCollapsed.set(false)
    }

    // Drop the domain's content from any connected web tab — the next
    // sync sig will exclude these sigs and resyncFromSentinel removes
    // disabled files.
    this.#toggleState.notifyChanged()
  }

  togglePackage(section: DomainSection): void {
    section.enabled = !section.enabled
    this.#refreshSections()
  }

  toggleShowAllVersions(): void {
    this.showAllVersions.set(!this.showAllVersions())
  }

  // ─── Per-domain visibility toggle (sticky, OPFS-persisted) ──────────
  // Master switch per domain. When toggled OFF, the domain's contribution
  // to the rendered installation union is filtered out even if individual
  // node toggles are on. Toggle state lives in
  // __domains__/<domain>/meta.json (via DcpDomainStorage) so it survives
  // reloads — "sticky" in user vocabulary.
  //
  // Default for any domain not in the visibility map is TRUE (visible).
  // First contact via touchDomain() also sets visible: true.

  /** #60: rebuild adopted-branch sections from the domains lineage. The
   *  lineage (sigbag, OPFS-durable) is the source of truth for what's been
   *  adopted and from whom; this reflects it into the rendered sections so
   *  adopted branches show under their OWNER domain (root/[domain] view) on
   *  every load — not just in the frame they were adopted. Idempotent:
   *  skips branchSigs that already have a section (so it composes with the
   *  live adopt:meta path without duplicating). Best-effort resolution via
   *  resolveFromLocal — content fetched during the original adopt persists
   *  in OPFS, so it re-resolves; if absent it surfaces as a loading/error
   *  row (the branch still shows under its domain). */
  async #refreshFromLineage(): Promise<void> {
    try {
      const hive = await this.#domainStorage.loadDomainsHive()
      if (!hive.length) return
      const fresh: DomainSection[] = []
      for (const domain of hive) {
        const branches = await this.#domainStorage.loadDomainBranches(domain.name)
        for (const b of branches) {
          const sig = String(b.branchSig ?? '').trim().toLowerCase()
          if (!/^[a-f0-9]{64}$/.test(sig)) continue
          if (this.sections().some(s => s.rootSig === sig)) continue   // idempotent
          if (fresh.some(s => s.rootSig === sig)) continue
          fresh.push({
            domain: `https://${domain.name}`,
            domainName: domain.name,
            displayDomain: domain.name,
            rootSig: sig,
            originalRootSig: sig,
            items: [],
            loading: true,
            error: null,
            installStatus: 'Resolving adopted branch…',
            patches: [],
            enabled: true,
          })
        }
      }
      if (!fresh.length) return
      this.sections.update(secs => [...secs, ...fresh])
      // #77-B: seed each fresh section with the visual-context nodes (the
      // already-there items from other enabled domains + default) so the
      // single tree shows incoming features landing among what's there.
      for (const s of fresh) {
        const ctx = await this.buildVisualContext(s.domainName)
        if (ctx.length) {
          this.sections.update(secs => secs.map(sec =>
            sec.rootSig === s.rootSig ? { ...sec, items: [...sec.items, ...ctx] } : sec
          ))
        }
      }
      for (const s of fresh) void this.#resolveBranchSection(s.rootSig, s.domain)
    } catch (e) {
      console.warn('[home] #refreshFromLineage failed', e)
    }
  }

  /** #77-B: build read-only VISUAL-CONTEXT nodes for a domain's tree — the
   *  features already in the logical from OTHER enabled domains + the default
   *  base. Marked visualContext:true so tree-row renders them dimmed +
   *  bordered (incoming vs already-there) with no toggle. Only ENABLED
   *  branches are included (they're what's actually in the logical). The
   *  focused domain's own features are excluded (they're the toggleable
   *  incoming nodes). Public so the UI + driver tests can call it. */
  async buildVisualContext(forDomain: string): Promise<TreeNode[]> {
    const me = normalizeDomainKey(forDomain)
    const out: TreeNode[] = []
    let i = 0
    const mkNode = (label: string, lineage: string, branchSig: string): TreeNode => ({
      id: `visual:${lineage}:${branchSig.slice(0, 12)}:${i++}`,
      name: label,
      kind: 'layer',
      lineage,
      children: [],
      expanded: false,
      loaded: true,
      depth: 0,
      visualContext: true,
    })

    // other enabled domains' features
    const hive = await this.#domainStorage.loadDomainsHive()
    for (const dom of hive) {
      if (normalizeDomainKey(dom.name) === me) continue        // skip the focused domain's own
      const branches = await this.#domainStorage.loadDomainBranches(dom.name)
      for (const b of branches) {
        if (!this.#domainStorage.isFeatureEnabled(b.branchSig)) continue   // only enabled = in logical
        out.push(mkNode(b.name, dom.name, b.branchSig))
      }
    }
    // default base items (always in the logical)
    const defaults = await this.#domainStorage.loadDefaultBranches()
    for (const b of defaults) out.push(mkNode(b.name, 'default', b.branchSig))

    return out
  }

  /** Synchronous read for the template. Reads the participant-local
   *  visibility from DcpDomainStorage (localStorage-backed). The
   *  #visibilityVersion() read registers the reactive dependency so the
   *  template re-renders when toggleDomainVisibility bumps it. Default for
   *  unknown domains is true. */
  isDomainVisible(domain: string): boolean {
    this.#visibilityVersion()                 // reactive dependency
    return this.#domainStorage.isDomainVisible(domain)
  }

  /** Toggle visibility. The service updates its in-memory cache
   *  synchronously (instant UI) and persists to the undoable settings
   *  sigbag asynchronously — so we bump the reactivity trigger immediately
   *  and let the sigbag append run in the background. */
  toggleDomainVisibility(domain: string): void {
    const next = !this.#domainStorage.isDomainVisible(domain)
    void this.#domainStorage.setDomainVisible(domain, next)
    this.#visibilityVersion.update(v => v + 1)
    // Notify the sentinel + any subscribers that visibility changed so the
    // hive's render filter (and any other consumer) can resync.
    this.#toggleState.notifyChanged()
  }


  // tree interactions
  async onExpandToggle(node: TreeNode): Promise<void> {
    if (node.expanded) {
      node.expanded = false
      this.#refreshSections()
      return
    }

    if (!node.loaded) {
      const section = this.sections().find(s =>
        this.#containsNode(s.items, node.id)
      )
      if (section) {
        await this.#resolver.expandNode(node, section.domain, section.rootSig, section.domainName)
      }
    }

    node.expanded = true
    if (node.kind === 'layer' && this.layersCollapsed()) {
      this.layersCollapsed.set(false)
      this.#savedExpandStates.clear()
    }
    this.#refreshSections()
  }

  async onToggle(node: TreeNode): Promise<void> {
    // Trust gate at activation. Tiles (layers, domain) and resources are
    // always safe to flip — they're data. Code items (bees, deps, workers,
    // drones) are gated: when turning ON code whose source domain isn't
    // in the participant's trusted community, the trust prompt fires
    // (community-trusted code activates silently — no nag).
    //
    // Disables and re-enables of already-on items always pass through.
    // The gate is one-way: off→on for code only.
    const isCode = isCodeKind(node.kind)
    // Kind-aware default so an unset adopted-code node reads OFF (first click
    // = turn ON → trust gate fires) and data reads ON.
    const currentlyEnabled = this.#toggleState.isEnabled(node.id, defaultEnabled(node.kind))

    if (!currentlyEnabled && isCode) {
      const sourceDomain = this.#findSectionDomain(node)
      if (sourceDomain) {
        interface TrustLike {
          check: (domains: string[]) => Promise<{ allow: boolean; addToCommunity: boolean }>
        }
        const trust = (window as { ioc?: { get: (k: string) => unknown } }).ioc
          ?.get?.('@hypercomb.social/TrustService') as TrustLike | undefined
        if (trust?.check) {
          const decision = await trust.check([sourceDomain])
          if (!decision.allow) {
            // Blocked by community safety → mark as an UNTRUSTED EGG: the
            // layer is known + visible but can't hatch (activate) until it
            // meets the bar (a community attestation arrives) or the
            // participant overrides. Durable, never "failed". The tree
            // renders the egg affordance with the "waiting for community
            // trust" reason.
            node.hatchBlocker = 'untrusted'
            this.#refreshSections()
            return
          }
          // Allowed → it hatched; clear any prior untrusted-egg state.
          if (node.hatchBlocker === 'untrusted') node.hatchBlocker = undefined
        }
      }
    }

    // Kind-aware default so the flip is computed from the node's TRUE current
    // state (an unset code node is OFF, not the bare default-true) — otherwise
    // the first click on an off-by-default code node would flip OFF→OFF.
    this.#toggleState.toggle(node.id, defaultEnabled(node.kind))
    this.#refreshSections()

    // #77: if a SECTION (adopted branch) was toggled, drive the LOGICAL
    // install. The feature's branchSig = the containing section's rootSig.
    // Flip its participant-local enabled flag + recompute the logical
    // (union-recompute; canonical layers + domain lineage untouched, per
    // the purity guarantee). Sub-node toggles (a bee within a branch) stay
    // with ToggleStateService only — the logical projection is at branch
    // granularity, so we recompute only when the branch root itself flips.
    const branchSig = this.#sectionRootSigForNode(node)
    if (/^[a-f0-9]{64}$/.test(branchSig)) {
      const nowEnabled = this.#toggleState.isEnabled(node.id, defaultEnabled(node.kind))
      void this.#domainStorage.setFeatureEnabled(branchSig, nowEnabled)
        .then(() => this.#domainStorage.recomputeLogical())
        .then(() => {
          this.#logicalVersion.update(v => v + 1)
          void this.#postRegistrySnapshot()   // #62: tell the hive the logical changed
        })
        .catch(e => console.warn('[home] logical recompute on toggle failed', e))
    }
  }

  /** #62: post the registry snapshot (the logical projection + domain
   *  visibility) to the hive parent, so the consumer surface can use it as a
   *  render filter (show/activate only effectively-installed content) and
   *  direct-fetch the bytes itself. DCP runs in a cross-origin iframe inside
   *  the hive; postMessage is the bridge. Standalone (not framed) →
   *  window.parent === window, so this harmlessly posts to self. Fire after
   *  any registry/logical change. */
  async #postRegistrySnapshot(): Promise<void> {
    try {
      const snapshot = await this.#domainStorage.getRegistrySnapshot()
      window.parent?.postMessage({ type: 'hc:registry-snapshot', ...snapshot }, '*')
    } catch (e) {
      console.warn('[home] postRegistrySnapshot failed', e)
    }
  }

  /** Find the section that contains a node (top-level OR nested). */
  #findSectionForNode(node: TreeNode): DomainSection | undefined {
    const contains = (nodes: TreeNode[]): boolean =>
      nodes.some(n => n.id === node.id || contains(n.children))
    return this.sections().find(s => contains(s.items))
  }

  /** #71: record cross-domain DEPENDENCIES under THEIR respective domain
   *  silos. Walks a resolved subtree; for every node whose owning domain
   *  (derived from its `lineage` namespace) differs from the branch's
   *  owner, records its sig in that OTHER domain's tile — so a branch from
   *  alice.com that depends on a bee from bob.com puts bob's bee in
   *  bob.com's silo (auto-creating it), not lumped under alice. Realizes
   *  "resolve the dependencies from their respective domains" at the
   *  lineage layer. Public so the resolve path + driver tests can call it.
   *  Returns the number of cross-domain deps recorded. */
  async recordTreeDeps(root: TreeNode, ownerDomain: string): Promise<number> {
    const owner = normalizeDomainKey(ownerDomain)
    const seen = new Set<string>()
    let recorded = 0
    const visit = async (node: TreeNode, isRoot: boolean): Promise<void> => {
      if (!isRoot) {
        const sig = String(node.signature ?? '').trim().toLowerCase()
        const depDomain = normalizeDomainKey(String(node.lineage ?? '').split('/')[0])
        if (/^[a-f0-9]{64}$/.test(sig) && depDomain && depDomain !== owner && !seen.has(`${depDomain}:${sig}`)) {
          seen.add(`${depDomain}:${sig}`)
          await this.#domainStorage.addDomainBranch(depDomain, sig, [], node.name)
          recorded++
        }
      }
      for (const c of (node.children ?? [])) await visit(c, false)
    }
    await visit(root, true)
    return recorded
  }

  /** Hatch an egg — clear its blocker and activate/retry it.
   *
   *  'untrusted' → the EXPLICIT ALLOW that bypasses the (absent) community
   *  check. There is no community yet, so the participant is the authority:
   *  we surface the trust prompt (allow-once / allow-always / deny); on
   *  allow, the egg hatches — its feature is enabled and the logical
   *  recomputes. This is the deliberate "I allow this to run" path.
   *
   *  'undelivered' → re-attempt resolution; the bytes may have arrived since
   *  (an endpoint appeared). If they still don't, it falls back to an egg. */
  async onHatchEgg(node: TreeNode): Promise<void> {
    const section = this.#findSectionForNode(node)

    if (node.hatchBlocker === 'untrusted') {
      const sourceDomain = this.#findSectionDomain(node) || (section?.domainName ?? '')
      interface TrustLike {
        check: (domains: string[]) => Promise<{ allow: boolean; addToCommunity: boolean }>
      }
      const trust = (window as { ioc?: { get: (k: string) => unknown } }).ioc
        ?.get?.('@hypercomb.social/TrustService') as TrustLike | undefined
      // Explicit allow — surface the prompt. With no source domain we still
      // allow (the participant deliberately clicked Allow on a clearly
      // marked untrusted egg).
      let allowed = true
      if (trust?.check && sourceDomain) {
        allowed = (await trust.check([sourceDomain])).allow
      }
      if (!allowed) return   // still an egg

      node.hatchBlocker = undefined
      this.#refreshSections()
      if (section && /^[a-f0-9]{64}$/.test(section.rootSig)) {
        void this.#domainStorage.setFeatureEnabled(section.rootSig, true)
          .then(() => this.#domainStorage.recomputeLogical())
          .then(() => { this.#logicalVersion.update(v => v + 1); void this.#postRegistrySnapshot() })
          .catch(e => console.warn('[home] hatch recompute failed', e))
      }
      return
    }

    if (node.hatchBlocker === 'undelivered' && section) {
      node.hatchBlocker = undefined
      this.sections.update(secs => secs.map(s =>
        s.rootSig === section.rootSig ? { ...s, loading: true, installStatus: 'Re-fetching…' } : s
      ))
      void this.#resolveBranchSection(section.rootSig, section.domain)
    }
  }

  /** Return the branchSig (section rootSig) iff `node` is a top-level
   *  section item (the adopted branch root). Sub-nodes return '' so the
   *  logical recompute fires only at branch granularity. */
  #sectionRootSigForNode(node: TreeNode): string {
    for (const section of this.sections()) {
      if (section.items.some(top => top.id === node.id)) return section.rootSig
    }
    return ''
  }

  /** Walk up the node tree to find which section's root contains this
   *  node, then return that section's domain hostname. Used by the
   *  activation trust gate to identify the source of code being turned on. */
  #findSectionDomain(node: TreeNode): string {
    const map = this.nodeMap()
    let current: TreeNode | undefined = node
    while (current?.parentId) {
      const parent = map.get(current.parentId)
      if (!parent) break
      current = parent
    }
    if (!current) return ''
    for (const section of this.sections()) {
      for (const top of section.items) {
        if (top.id === current.id) {
          try { return new URL(section.domain).hostname.toLowerCase() }
          catch { return String(section.domain ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase() }
        }
      }
    }
    return ''
  }

  onOpen(node: TreeNode): void {
    if ((node.kind === 'bee' || node.kind === 'worker' || node.kind === 'drone' || node.kind === 'dependency') && node.signature) {
      this.#openInspector(node, 'code')
    } else {
      this.onExpandToggle(node)
    }
  }

  onOpenDetail(node: TreeNode): void {
    if ((node.kind === 'bee' || node.kind === 'worker' || node.kind === 'drone' || node.kind === 'dependency') && node.signature) {
      this.#openInspector(node, 'detail')
    }
  }

  // patch handling
  async onPatchApplied(result: PatchResult): Promise<void> {
    const section = this.inspectSection()
    if (!section) return

    // record the patch
    await this.#patchStore.record(section.domainName, {
      originalFileSig: result.originalSig,
      newFileSig: result.newFileSig,
      originalRootSig: section.rootSig,
      newRootSig: result.newRootSig,
      kind: result.kind,
      lineage: result.lineage,
      timestamp: Date.now(),
      cascadedLayers: result.cascadedLayers
    })

    // reload patches for this domain
    section.patches = await this.#patchStore.list(section.domainName)

    // switch to new root
    await this.#switchSectionRoot(section, result.newRootSig)

    // close inspector
    this.onCloseInspector()
  }

  async onSwitchRoot(section: DomainSection, rootSig: string): Promise<void> {
    await this.#patchStore.setActiveRoot(section.domainName, rootSig)
    await this.#switchSectionRoot(section, rootSig)
  }

  async downloadPackage(section: DomainSection): Promise<void> {
    await this.#exporter.exportPackage(section.rootSig, section.domainName)
  }

  /**
   * Promote a branch (layer) to its own package root within the same domain.
   * Creates a new DomainSection using the branch signature as root.
   */
  async promoteBranchToPackage(node: TreeNode, sourceSection: DomainSection): Promise<void> {
    if (!node.signature || node.kind !== 'layer') return

    const branchSig = node.signature

    // check if already promoted
    if (this.sections().some(s => s.rootSig === branchSig)) return

    // resolve the subtree from local OPFS using the branch as root
    const root = await this.#resolver.resolveFromLocal(branchSig, sourceSection.domainName)
    if (!root) return

    const flat = this.#flattenDomainSubfolder(root.children)
    const section: DomainSection = {
      domain: sourceSection.domain,
      domainName: sourceSection.domainName,
      displayDomain: flat.displayDomain ?? sourceSection.displayDomain,
      rootSig: branchSig,
      originalRootSig: branchSig,
      items: flat.items,
      loading: false,
      error: null,
      installStatus: null,
      patches: [],
      enabled: true,
    }

    this.sections.set([...this.sections(), section])
  }

  #openInspector(node: TreeNode, mode: 'code' | 'detail'): void {
    const section = this.sections().find(s => this.#containsNode(s.items, node.id))
    this.inspectBee.set(node.signature!)
    this.inspectKind.set(node.kind)
    this.inspectSection.set(section ?? null)
    this.inspectDoc.set(node.doc)
    this.inspectLineage.set(node.lineage)
    this.inspectMode.set(mode)
  }

  onCloseInspector(): void {
    this.inspectBee.set(null)
    this.inspectKind.set('bee')
    this.inspectSection.set(null)
    this.inspectDoc.set(undefined)
    this.inspectLineage.set('')
  }

  // layer editor
  onOpenLayerEditor(node: TreeNode, section?: DomainSection): void {
    const resolved = section ?? this.sections().find(s => this.#containsNode(s.items, node.id)) ?? null
    console.log('[LayerEditor] opening', node.name, node.kind, node.signature?.slice(0, 12), resolved?.domainName)
    this.inspectLayer.set(node)
    this.inspectLayerSection.set(resolved)
  }

  onLayerEditorClose(): void {
    this.inspectLayer.set(null)
    this.inspectLayerSection.set(null)
  }

  async onLayerPatchApplied(result: BatchPatchResult): Promise<void> {
    const section = this.inspectLayerSection()
    if (!section) return

    for (const file of result.patchedFiles) {
      await this.#patchStore.record(section.domainName, {
        originalFileSig: file.originalSig,
        newFileSig: file.newFileSig,
        originalRootSig: section.rootSig,
        newRootSig: result.newRootSig,
        kind: file.kind,
        lineage: '',
        timestamp: Date.now(),
        cascadedLayers: result.cascadedLayers,
      })
    }

    section.patches = await this.#patchStore.list(section.domainName)
    await this.#switchSectionRoot(section, result.newRootSig)
    this.onLayerEditorClose()
  }

  onNavigateSig(sig: string): void {
    // find a node with this signature in any section
    for (const section of this.sections()) {
      const node = this.#findNodeBySig(section.items, sig)
      if (node) {
        this.onOpen(node)
        return
      }
    }
  }

  onNavigateDep(iocKey: string): void {
    // extract class name from IoC key (e.g. "@domain.com/ClassName" → "ClassName")
    const className = iocKey.includes('/') ? iocKey.slice(iocKey.lastIndexOf('/') + 1) : iocKey
    // humanize: PascalCase → "lower case words" to match tree node names
    const humanized = className
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
    for (const section of this.sections()) {
      const node = this.#findNodeByClassName(section.items, className, humanized)
      if (node) {
        this.#openInspector(node, 'detail')
        return
      }
    }
  }

  async #switchSectionRoot(section: DomainSection, rootSig: string): Promise<void> {
    section.loading = true
    section.rootSig = rootSig
    this.#refreshSections()

    try {
      const root = await this.#resolver.resolveFromLocal(rootSig, section.domainName)
      if (root) {
        const flat = this.#flattenDomainSubfolder(root.children)
        section.items = flat.items
        if (flat.displayDomain) section.displayDomain = flat.displayDomain
        section.rootSig = root.signature ?? rootSig
      } else {
        section.error = 'Failed to resolve patched tree'
      }
    } catch (e: unknown) {
      section.error = e instanceof Error ? e.message : 'Failed to load patched tree'
    } finally {
      section.loading = false
    }

    this.#refreshSections()
  }

  #findNodeBySig(nodes: TreeNode[], sig: string): TreeNode | null {
    for (const n of nodes) {
      if (n.signature === sig) return n
      const found = this.#findNodeBySig(n.children, sig)
      if (found) return found
    }
    return null
  }

  #findNodeByClassName(nodes: TreeNode[], className: string, humanized: string): TreeNode | null {
    for (const n of nodes) {
      if (n.doc?.className === className || n.name === className || n.name === humanized) return n
      const found = this.#findNodeByClassName(n.children, className, humanized)
      if (found) return found
    }
    return null
  }

  /** Resolve the dev default baseline (a hard-coded (domain, sig)) into a
   *  section — the user's always-present starting point, the same resolve as
   *  an adopt (a signature filled out by a domain). Shows even alongside
   *  adopted sections (it's the baseline, not an empty-dashboard fallback);
   *  idempotent against its own section so it never double-seeds. No-ops on a
   *  real host (production seeds from the deploy's default signature). If the
   *  pinned sig is stale it falls back to the domain's current manifest root,
   *  so a rebuild never leaves dev blank. */
  async #seedDefaultBaseline(): Promise<void> {
    const cfg = devDefaultBootstrap()
    if (!cfg?.byteSource) return

    // Let #refreshFromLineage + the persisted-domains effect settle first, so
    // the idempotency check below sees any already-present default section.
    await new Promise(r => setTimeout(r, 80))

    // byteSource = where we fetch (dev relay); host = the capture-source
    // identity that names the installer's DOMAIN FOLDER (jwize.com). In prod
    // these are the same; in dev the bytes are local but the folder is the host.
    const base = cfg.byteSource.replace(/\/+$/, '')
    const host = (cfg.host || base).trim()

    // The baseline is ALWAYS present — it shows even alongside adopted
    // sections (it's the user's starting point, not a fallback for an empty
    // dashboard). Skip only if the default's OWN section is already seeded
    // (idempotency), so it never double-seeds across reloads / hashchange.
    if (this.sections().some(s => s.domain === base)) return
    let sig = String(cfg.sig ?? '').trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sig)) {
      // No pinned sig (or stale) → take the domain's current manifest root.
      sig = (await this.#resolver.fetchAllRootSignatures(base))[0] ?? ''
    }
    if (!/^[a-f0-9]{64}$/.test(sig)) return

    const loading: DomainSection = {
      domain: base, domainName: host, displayDomain: host,
      rootSig: sig, originalRootSig: sig, items: [],
      loading: true, error: null, installStatus: `Loading ${host} baseline…`,
      patches: [], enabled: true,
    }
    this.sections.set([...this.sections(), loading])

    try {
      let root = await this.#resolver.resolveRoot(base, sig, host, (p) => {
        loading.installStatus = `Installing ${p.phase} ${p.current}/${p.total}`
        this.#refreshSections()
      })
      // Pinned sig stale (404 / not in manifest) → retry with the live root.
      if (!root) {
        const live = (await this.#resolver.fetchAllRootSignatures(base))[0] ?? ''
        if (/^[a-f0-9]{64}$/.test(live) && live !== sig) {
          root = await this.#resolver.resolveRoot(base, live, host)
        }
      }
      if (!root) {
        loading.loading = false
        loading.installStatus = null
        loading.error = 'default baseline did not resolve'
        this.#refreshSections()
        return
      }

      const rootSig = root.signature ?? sig
      const children = root.children ?? []
      // The content's OWN domains (diamondcoreprocessor.com, miro.com) are
      // HOISTED to top-level SIBLINGS — never nested under the host folder.
      const domainChildren = children.filter(c => c.kind === 'layer' && c.name.includes('.'))
      const mk = (domain: string, name: string, rs: string, items: TreeNode[],
                  status: string | null): DomainSection => ({
        domain, domainName: name, displayDomain: name,
        rootSig: rs, originalRootSig: rs, items,
        loading: false, error: null, installStatus: status, patches: [], enabled: true,
      })

      const siblings: DomainSection[] = []
      // one sibling PER content domain — its features directly inside. These
      // are the SOURCE libraries; the "current active logical view" is a
      // separate computed MERGE of what's enabled across them (see
      // logicalViewItems), so it never appears here as a static section.
      for (const child of domainChildren) {
        siblings.push(mk(base, child.name, child.signature ?? rootSig, child.children, null))
      }
      // the host/import source — a sibling created on import. Opening it (the
      // accordion action) reveals the current import; adopted items (e.g.
      // dolphin) nest INSIDE here, not at the root. No label — "open to
      // current import" is what clicking it DOES, not text on the node.
      siblings.push(mk(base, host, rootSig, [], null))

      // keep any pre-existing (adopted) sections, drop the loading placeholder,
      // then append the default's siblings; the template sorts for display.
      const others = this.sections().filter(s => s !== loading && s.domain !== base && s.domain !== '@logical')
      this.sections.set([...others, ...siblings])
    } catch (e: unknown) {
      loading.loading = false
      loading.installStatus = null
      loading.error = e instanceof Error ? e.message : 'failed to load default baseline'
      this.#refreshSections()
    }
  }

  // auto-load all domains — each root signature in the manifest becomes its own section
  async #loadAllDomains(doms: string[]): Promise<void> {
    const results: DomainSection[] = []

    for (const domain of doms) {
      const domainName = new URL(domain).hostname

      // fetch all root signatures from the manifest
      const rootSigs = await this.#resolver.fetchAllRootSignatures(domain)

      if (rootSigs.length === 0) {
        // no packages found — show placeholder with error
        results.push({
          domain, domainName, displayDomain: domainName, rootSig: '', originalRootSig: '', items: [],
          loading: false, error: 'No packages found in manifest', installStatus: null, patches: [], enabled: true
        })
        continue
      }

      // create a section per root signature
      for (const rootSig of rootSigs) {
        results.push({
          domain, domainName, displayDomain: domainName, rootSig, originalRootSig: rootSig, items: [],
          loading: true, error: null, installStatus: null, patches: [], enabled: true
        })
      }
    }

    this.sections.set([...results])

    // load each section in parallel
    for (const section of results) {
      if (!section.rootSig) continue

      try {
        const root = await this.#resolver.resolveRoot(section.domain, section.rootSig, section.domainName, (p) => {
          section.installStatus = `Installing ${p.phase} ${p.current}/${p.total}`
          this.sections.set([...results])
        })
        if (root) {
          section.rootSig = root.signature ?? section.rootSig
          section.originalRootSig = root.signature ?? section.originalRootSig
          const flat = this.#flattenDomainSubfolder(root.children)
          section.items = flat.items
          if (flat.displayDomain) section.displayDomain = flat.displayDomain

          // load patches and check for active patched root
          section.patches = await this.#patchStore.list(section.domainName)
          const activeRoot = await this.#patchStore.activeRoot(section.domainName)
          if (activeRoot && activeRoot !== section.rootSig) {
            // hot-swap to the active patched root
            const patched = await this.#resolver.resolveFromLocal(activeRoot, section.domainName)
            if (patched) {
              section.rootSig = patched.signature ?? activeRoot
              const patchedFlat = this.#flattenDomainSubfolder(patched.children)
              section.items = patchedFlat.items
              if (patchedFlat.displayDomain) section.displayDomain = patchedFlat.displayDomain
            }
          }
        } else {
          section.error = 'No content found'
        }
      } catch (e: unknown) {
        section.error = e instanceof Error ? e.message : 'Failed to load'
      } finally {
        section.loading = false
        section.installStatus = null
      }
      this.sections.set([...results])
    }

    // Tell the sentinel that DCP's content set has changed so any
    // connected hypercomb-web tab resyncs against our latest OPFS
    // state. Without this, installing a new domain leaves web frozen
    // on its previous sync until the user toggles something or
    // reloads. We broadcast unconditionally — sync-sig short-circuits
    // a no-op resync on the web side.
    this.#toggleState.notifyChanged()

    // Check for navigate query param (from structure atomizer drop in Hypercomb.io)
    this.#handleNavigateQueryParam()
  }

  #handleNavigateQueryParam(): void {
    const params = new URLSearchParams(window.location.search)
    const navigateLineage = params.get('navigate')
    if (!navigateLineage) return

    const signature = params.get('signature')

    // Clean up URL to prevent re-navigation on refresh
    const url = new URL(window.location.href)
    url.searchParams.delete('navigate')
    url.searchParams.delete('signature')
    url.searchParams.delete('kind')
    window.history.replaceState({}, '', url.toString())

    // If we have a signature, try direct lookup first
    if (signature) {
      this.onNavigateSig(signature)
      return
    }

    // Walk lineage path segments to find the target node
    // Lineage format: "domain.com/layer/sublayer/BeeName"
    const segments = navigateLineage.split('/').filter(Boolean)
    if (!segments.length) return

    // Find the matching node by walking the tree with path segments
    const node = this.#findNodeByLineagePath(segments)
    if (node) {
      this.onOpen(node)
    }
  }

  #findNodeByLineagePath(segments: string[]): TreeNode | null {
    // Start from all section items
    let candidates: TreeNode[] = []
    for (const section of this.sections()) {
      candidates.push(...section.items)
    }

    let target: TreeNode | null = null

    // Walk through segments, narrowing candidates at each level
    for (const segment of segments) {
      const match = candidates.find(n => n.name === segment || n.doc?.className === segment)
      if (!match) return target // return last matched node
      target = match
      match.expanded = true
      candidates = match.children
    }

    this.#refreshSections()
    return target
  }

  /**
   * Skip domain-name subfolder layers that exist only for development organization.
   * In deployment, packages go to the root — so if the only child is a layer whose
   * name looks like a domain (contains a dot), promote its children up and return
   * the domain name for display.
   */
  /** Merge several trees into one by NAME at each level — same-named nodes
   *  fold together (their children merge recursively). This is how the logical
   *  view combines all libraries into one root-level hierarchy: e.g. two
   *  libraries that each contribute a "tools" folder yield ONE "tools" with the
   *  union of both. First occurrence wins for a node's own metadata; children
   *  are unioned. Pure (clones nodes) so it never mutates the source sections. */
  #mergeTrees(groups: TreeNode[][]): TreeNode[] {
    const order: string[] = []
    const byName = new Map<string, TreeNode>()
    for (const nodes of groups) {
      for (const n of (nodes ?? [])) {
        const existing = byName.get(n.name)
        if (existing) {
          existing.children = this.#mergeTrees([existing.children, n.children ?? []])
        } else {
          order.push(n.name)
          byName.set(n.name, { ...n, children: this.#mergeTrees([n.children ?? []]) })
        }
      }
    }
    return order.map(name => byName.get(name)!)
  }

  #flattenDomainSubfolder(items: TreeNode[]): { items: TreeNode[], displayDomain: string | null } {
    if (items.length === 1 && items[0].kind === 'layer' && items[0].name.includes('.')) {
      return { items: items[0].children, displayDomain: items[0].name }
    }
    return { items, displayDomain: null }
  }

  #containsNode(nodes: TreeNode[], id: string): boolean {
    for (const n of nodes) {
      if (n.id === id) return true
      if (this.#containsNode(n.children, id)) return true
    }
    return false
  }

  #walkLayers(nodes: TreeNode[], fn: (node: TreeNode) => void): void {
    for (const node of nodes) {
      if (node.kind === 'layer') fn(node)
      this.#walkLayers(node.children, fn)
    }
  }

  #refreshSections(): void {
    this.sections.set([...this.sections()])
  }

  #filterTree(nodes: TreeNode[], term: string): TreeNode[] {
    const result: TreeNode[] = []
    for (const node of nodes) {
      const nameMatch = node.name.toLowerCase().includes(term)
      const filteredChildren = this.#filterTree(node.children, term)

      if (nameMatch || filteredChildren.length > 0) {
        result.push({
          ...node,
          children: nameMatch ? node.children : filteredChildren,
          expanded: filteredChildren.length > 0 ? true : node.expanded
        })
      }
    }
    return result
  }

  #filterByKind(nodes: TreeNode[], active: Set<TreeNodeKind>): TreeNode[] {
    const result: TreeNode[] = []
    for (const node of nodes) {
      const filteredChildren = this.#filterByKind(node.children, active)
      if (active.has(node.kind) || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren.length ? filteredChildren : node.children })
      }
    }
    return result
  }

  #flattenByKind(nodes: TreeNode[], kinds: Set<TreeNodeKind>): TreeNode[] {
    const result: TreeNode[] = []
    const walk = (items: TreeNode[]) => {
      for (const node of items) {
        if (kinds.has(node.kind)) {
          result.push({ ...node, depth: 0, children: [], expanded: false })
        }
        walk(node.children)
      }
    }
    walk(nodes)
    return result
  }

  #loadDomains(): string[] {
    try {
      return JSON.parse(localStorage.getItem(DOMAINS_KEY) ?? '[]')
    } catch {
      return []
    }
  }
}
