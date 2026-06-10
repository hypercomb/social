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

/** The always-first sibling: the active/logical install view — this IS the
 *  data plane (the hive), so it's labelled by the hive domain. */
const LOGICAL_VIEW_NAME = 'hypercomb.io'

/** The installer's OWN baseline domain(s) — the DCP application itself. Its
 *  modules (keyboard, navigation, presentation, editor, …) are the runtime /
 *  tooling, NOT adoptable content, so they are excluded from the logical view
 *  and its view-logical overlay. Otherwise an enabled installer feature like
 *  `presentation` bleeds into an unrelated adopted domain's view (e.g. showing
 *  under jwize.com/dolphin), which is never what "logically enabled here"
 *  means. Operators forking under a different canonical domain override via
 *  localStorage `dcp.installer-domains` (a JSON array of domain names). */
const INSTALLER_BASELINE_DOMAINS = ['diamondcoreprocessor.com']
function isInstallerBaselineDomain(domainName: string): boolean {
  const d = String(domainName || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').toLowerCase()
  let list = INSTALLER_BASELINE_DOMAINS
  try {
    const raw = localStorage.getItem('dcp.installer-domains')
    if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed) && parsed.length) list = parsed.map(String) }
  } catch { /* ignore — fall back to the default */ }
  return list.map(x => x.toLowerCase()).includes(d)
}

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
  /** For an adopted branch nested under a host folder: the human TILE name
   *  the participant adopted (e.g. "dolphin"). The resolved root node is
   *  renamed to this so the tree reads "<host>/ → dolphin → …" rather than
   *  exposing the layer's internal name (e.g. "presentation"). */
  adoptLabel?: string
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
    const walk = (nodes: TreeNode[], adopted: boolean) => {
      for (const n of nodes) {
        // ADOPTED root = the MASTER SWITCH: off by default (nothing runs
        // until the participant flips it). Its DESCENDANTS default ON, so
        // one click on the root lights the whole subtree through the
        // effective-enabled cascade — no per-level clicking. Outside an
        // adopted subtree, the kind-aware default applies (own DATA reads
        // ON, CODE OFF). `adopted` latches on the freshly-adopted root and
        // flows to all descendants.
        const inAdopted = adopted || !!n.freshlyAdopted
        const def = adopted ? true : (n.freshlyAdopted ? false : defaultEnabled(n.kind))
        map.set(n.id, this.#toggleState.isEnabled(n.id, def))
        walk(n.children, inAdopted)
      }
    }
    for (const s of this.sections()) walk(s.items, false)
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
        // Prefer the section WITH content (e.g. a freshly-adopted tile) over an
        // empty import-source marker, so the adopted node shows INSIDE the
        // host folder instead of being hidden behind the empty marker.
        const best = [...group.sections].sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0))[0]
        group.sections = [best]
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

    // VIEW-LOGICAL OVERLAY: any folder with the toggle on (or the importing
    // domain during an adopt) APPENDS the current logical view's behaviors to
    // its own list — own content first (what's here / newly adopted), then the
    // existing logical behaviors (deduped by name), so you see the combined
    // set "what's here + what's enabled". Append, not replace, so the folder's
    // own/new content stays visible.
    const logical = this.logicalViewItems()
    for (const g of libraryGroups) {
      if (!this.isViewLogical(g.domainName) || !g.sections[0]) continue
      const ownNames = new Set(g.sections[0].items.map(i => i.name))
      const overlay = logical.filter(i => !ownNames.has(i.name)).map(i => ({ ...i }))
      if (overlay.length) {
        g.sections = [{ ...g.sections[0], items: [...g.sections[0].items, ...overlay] }]
      }
    }

    return [logicalGroup, ...libraryGroups]
  })

  /** The current active logical view: the MERGE of every library's
   *  EFFECTIVELY-ENABLED content into one root-level hierarchy (the .com
   *  domain layer dissolved; same-named folders combined). This is what
   *  actually RUNS in hypercomb.io — DISABLED features are filtered out (they
   *  live in their owning-domain sibling, where you re-enable them). Reactive
   *  to toggles (a toggle bumps sections via #refreshSections, recomputing
   *  this). */
  readonly logicalViewItems = computed<TreeNode[]>(() => {
    // every source sibling EXCEPT the synthetic logical view itself AND the
    // installer's own baseline domain (its features are tooling, not adopted
    // content — see INSTALLER_BASELINE_DOMAINS). The jwize.com import marker +
    // unresolved adopt eggs contribute [] naturally.
    const sources = this.sections().filter(s =>
      s.domain !== '@logical' && !isInstallerBaselineDomain(s.domainName))
    const enabled = sources.map(s => this.#enabledSubtree(s.items, true))
    return this.#mergeTrees(enabled)
  })

  /** Keep only the EFFECTIVELY-ENABLED subtree: a node survives iff its own
   *  toggle is on AND its parent chain is on (parentEnabled). An enabled LEAF
   *  is kept; a folder is kept only if it has surviving descendants (so the
   *  logical view never shows empty branches for disabled features). */
  #enabledSubtree(nodes: TreeNode[], parentEnabled: boolean): TreeNode[] {
    const out: TreeNode[] = []
    const map = this.toggleMap()
    for (const n of (nodes ?? [])) {
      // Same source of truth as the rendered toggles (adopted-aware
      // defaults) — reading the bare kind default here made the logical view
      // disagree with what the switches showed.
      const selfOn = map.get(n.id) ?? defaultEnabled(n.kind)
      const eff = parentEnabled && selfOn
      const kids = this.#enabledSubtree(n.children ?? [], eff)
      if (kids.length > 0 || (eff && !(n.children?.length))) {
        out.push({ ...n, children: kids })
      }
    }
    return out
  }

  /** Accordion: the one top-level sibling whose tree is open (mutually
   *  exclusive — look at one level at a time). Empty = all collapsed. */
  readonly openGroup = signal<string>(LOGICAL_VIEW_NAME)
  toggleGroupOpen(domainName: string): void {
    this.importMode.set(false)   // any manual navigation leaves import mode
    this.openGroup.update(cur => cur === domainName ? '' : domainName)
  }
  isGroupOpen(domainName: string): boolean { return this.openGroup() === domainName }

  /** IMPORT mode: set when you arrive via an adopt (a #branch handoff), so
   *  the installer opens the IMPORTING domain (not the logical-view sibling)
   *  and renders the logical PANE — the merged "what's here + what you're
   *  adding" view — INSIDE that domain. Distinct from normal package
   *  management; cleared on any manual navigation (toggleGroupOpen). */
  readonly importMode = signal(false)
  readonly importDomainName = signal('')

  /** "View logical" overlay per domain folder: when on, the folder ALSO lists
   *  the current active logical view's behaviors alongside its own — so you
   *  can imagine the combined set ("what's here + what might soon be on"). A
   *  per-folder toggle; defaults ON for the importing domain during an adopt
   *  so you immediately see the new behaviors against the existing logical. */
  readonly viewLogicalGroups = signal<Set<string>>(new Set<string>())
  toggleViewLogical(domainName: string): void {
    this.viewLogicalGroups.update(s => {
      const next = new Set(s)
      if (next.has(domainName)) next.delete(domainName); else next.add(domainName)
      return next
    })
  }
  isViewLogical(domainName: string): boolean {
    // Manual toggle ONLY. Import mode used to auto-apply the logical overlay
    // to the importing host group, which made an adopt land in a merged
    // "logical view" instead of the host domain at the adopted location. An
    // adopt now opens the host folder showing ITS OWN tree (adopted node
    // focused); the logical stays what it is — the hypercomb.io sibling that
    // reflects the enabled features across folders, combined.
    return this.viewLogicalGroups().has(domainName)
  }

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
      // The adopt nests INSIDE the importing host's folder (jwize.com) — you
      // import INTO your host at your current lineage level — so the folder is
      // the importing host; the adopted tile (dolphin) is a child node inside
      // it. Fall back to the source host, then the tile name, then a sig
      // prefix when no host is configured.
      const importHost = (devDefaultBootstrap()?.host || '').trim()
      const displayName = importHost || sourceHost || tileName || `branch-${branchSig.slice(0, 8)}`
      // The cue always names the tile being adopted (the child), even though
      // the folder is the host.
      const cueName = tileName || sourceHost || displayName

      const branchSection: DomainSection = {
        // The section's domain == the IMPORTING HOST (https://<displayName>,
        // e.g. https://jwize.com) so the layer bytes #fetchLayer writes land
        // in the SAME per-domain OPFS dir the lineage rebuild reads from
        // (#refreshFromLineage resolves under `https://<host>`). Aligning them
        // is what makes the adopt "saved": after a reload the subtree resolves
        // straight from local OPFS, no re-fetch. Falls back to the source
        // scope / a synthetic branch:// id only when there's no host.
        domain:         displayName ? `https://${displayName}` : (sourceDomainScoped || `branch://${branchSig}`),
        domainName:     displayName,
        displayDomain:  displayName,
        rootSig:        branchSig,
        originalRootSig: branchSig,
        items:          [],
        loading:        true,
        error:          null,
        // Language: clicking adopt fetches the FILES (adopts them); ENABLING a
        // behavior is what "adopts the behavior" (activation). Off by default.
        installStatus:  `Adopting ${cueName}'s files — enable a behavior to adopt it (all off by default).`,
        patches:        [],
        enabled:        true,
        // the resolved root is renamed to this tile name (e.g. "dolphin") so
        // the nested node reads as what you adopted, not the layer's internal
        // name — and you walk its resolved children underneath.
        adoptLabel:     cueName,
      }
      this.sections.update(secs => [...secs, branchSection])

      // Resolve the branch by FETCHING it from its byte source — "send the
      // signature → fetch → fill." byteSource = the dev relay (devDefault-
      // Bootstrap) in development, else the publisher's advertised domain.
      // If neither serves it (browser-published, no endpoint), the resolver
      // falls back to polling local OPFS and ultimately an undelivered egg.
      const byteSource = (devDefaultBootstrap()?.byteSource || sourceDomainScoped || '').trim()
      void this.#resolveBranchSection(branchSig, branchSection.domain, byteSource)

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
        // IMPORT mode: arriving by adopt opens the IMPORTING domain (the
        // host you're importing into) and shows the logical pane inside it —
        // "what's here + what you're adding" — not the logical-view sibling.
        const importHost = (ownerDomain || devDefaultBootstrap()?.host || '').trim()
        if (importHost) {
          this.importMode.set(true)
          this.importDomainName.set(importHost)
          this.openGroup.set(importHost)
        }

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
        const recordInLineage = (): void => {
          try {
            // SAVE the adopted layer's signature into the IMPORTING HOST's
            // sigbag — the SAME folder the section renders under (displayName,
            // e.g. jwize.com). You import INTO your host at your lineage level.
            // Recording the ADDRESS is independent of fetching the bytes (the
            // egg model: known now, hatches when the bytes arrive) — so this
            // runs IMMEDIATELY, not gated on the broker walk succeeding (a
            // browser-published tile may have no advertised owner domain at
            // all, which is why the old getKnownDomains[0] path deferred
            // forever and nothing persisted). tileName is stored as the branch
            // entry's name so the rebuild reads the tile ("dolphin"), not the
            // layer's internal name.
            // Same precedence as the section's displayName (importing host
            // first), so the sigbag tile == the rendered folder.
            const owner = (devDefaultBootstrap()?.host || ownerDomain || tileName || '').trim().toLowerCase()
            if (!owner) return
            void this.#domainStorage.addDomainBranch(owner, branchSig, at, tileName || undefined)
              .then(() => {
                console.info('[home] recorded adopt in', owner, 'sigbag ←', branchSig.slice(0, 12), 'at', at.join('/') || '/')
                // #62: a new adoption changed the registry — tell the hive.
                void this.#postRegistrySnapshot()
              })
              .catch(e => console.warn('[home] addDomainBranch failed', e))
          } catch (e) { console.warn('[home] recordInLineage failed', e) }
        }

        // Persist the adopt into the host sigbag NOW (independent of bytes).
        recordInLineage()

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
  async #resolveBranchSection(branchSig: string, sectionDomain: string, byteSource?: string): Promise<void> {
    // BYTE PATH — "send the signature → fetch from the domain → the tree
    // fills." If we know where the bytes live, FETCH the branch (layer + refs)
    // from that domain first, so the subtree appears rather than waiting for
    // the mesh broker to maybe deliver. resolveBranchFromDomain caches layers
    // to OPFS as it walks.
    if (byteSource) {
      try {
        const root = await this.#resolver.resolveBranchFromDomain(byteSource, branchSig, sectionDomain)
        if (root) { this.#fillBranchSection(branchSig, sectionDomain, root); return }
      } catch (e) { console.warn('[home] branch fetch from domain failed', e) }
    }

    // Fallback: poll local OPFS — the mesh broker may have delivered the bytes
    // out-of-band (browser-published content with no HTTP endpoint).
    const MAX_RETRIES = 30 // ~6s at 200ms cadence
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        const root = await this.#resolver.resolveFromLocal(branchSig, sectionDomain)
        if (root) { this.#fillBranchSection(branchSig, sectionDomain, root); return }
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
                // an un-hatched adopt still reads as the TILE you adopted
                // ("dolphin"), not the host folder name.
                name: s.adoptLabel || s.domainName || branchSig.slice(0, 8),
                kind: 'layer',
                lineage: s.domainName || '',
                children: [],
                expanded: false,
                loaded: true,
                depth: 0,
                hatchBlocker: 'undelivered',
                freshlyAdopted: true,
              } as TreeNode,
              ...s.items.filter(it => it.visualContext),
            ],
          }
        : s
    ))
  }

  /** Populate a branch section with its resolved tree — auto-expanded so its
   *  features are visible the moment it fills (whether the bytes came from a
   *  domain fetch or local OPFS). Preserves visual-context nodes; scrolls to
   *  it; records cross-domain deps. */
  #fillBranchSection(branchSig: string, sectionDomain: string, root: TreeNode): void {
    this.sections.update(secs => secs.map(s => {
      if (s.rootSig !== branchSig) return s
      // Rename the resolved root to the TILE name the participant adopted
      // (e.g. "dolphin") instead of the layer's internal name (e.g.
      // "presentation"); its resolved children stay underneath so you walk
      // the hierarchy. Expanded so the subtree shows immediately. freshly-
      // Adopted marks it for the persistent highlight.
      const named: TreeNode = {
        ...root,
        name: s.adoptLabel || root.name,
        expanded: true,
        freshlyAdopted: true,
      }
      return { ...s, items: [named, ...s.items.filter(it => it.visualContext)], loading: false, installStatus: null }
    }))
    // #74: scroll to + briefly highlight the freshly-filled branch.
    setTimeout(() => this.#scrollSectionIntoView(sectionDomain, true), 60)
    // #71: record cross-domain dependencies under THEIR own silos.
    const sec = this.sections().find(s => s.rootSig === branchSig)
    if (sec) {
      void this.recordTreeDeps(root, sec.domainName)
        .then(n => { if (n > 0) void this.#postRegistrySnapshot() })
        .catch(e => console.warn('[home] recordTreeDeps failed', e))
    }
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
    // Clear the matched domains from the SIGBAG too, so the removal PERSISTS —
    // otherwise #refreshFromLineage rebuilds them from the lineage on the next
    // reload (which is why stale adopts kept coming back). Keyed by the tile
    // name (domainName), the sigbag's tile key.
    const removedNames = new Set(this.sections().filter(s => s.domain === domain).map(s => s.domainName))
    for (const name of removedNames) {
      if (name) void this.#domainStorage.removeDomain(name).catch(() => { /* non-fatal */ })
    }
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
        // Skip junk pseudo-domains left by the old recordTreeDeps bug: a real
        // host has a dot (jwize.com); a content tile mis-filed as a domain
        // (coaching, intake, alumni) has none. Ignoring them on rebuild means
        // no manual cleanup is needed and they stop flooding the installer +
        // rendering as non-dolphin content at the root.
        if (!String(domain.name ?? '').includes('.')) continue
        const branches = await this.#domainStorage.loadDomainBranches(domain.name)
        for (const b of branches) {
          const sig = String(b.branchSig ?? '').trim().toLowerCase()
          if (!/^[a-f0-9]{64}$/.test(sig)) continue
          if (this.sections().some(s => s.rootSig === sig)) continue   // idempotent
          if (fresh.some(s => s.rootSig === sig)) continue
          // The recorded tile name (e.g. "dolphin") renames the resolved root
          // so the rebuilt section reads as what was adopted, not the layer's
          // internal name. Skip a bare sig-prefix fallback (8 hex).
          const recordedName = String(b.name ?? '').trim()
          const adoptLabel = /^[a-f0-9]{8}$/.test(recordedName) ? undefined : (recordedName || undefined)
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
            adoptLabel,
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
      // Pass the dev byteSource so the rebuild can RE-FETCH the branch from
      // the host (the live adopt fetched into memory; on reload the bytes may
      // not be in local OPFS). Without it the section can only poll local and
      // falls to an egg named after the domain. In prod (no dev bootstrap)
      // byteSource is undefined → poll-local → broker-adopted bytes or egg.
      const byteSource = (devDefaultBootstrap()?.byteSource || '').trim() || undefined
      for (const s of fresh) void this.#resolveBranchSection(s.rootSig, s.domain, byteSource)
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

    // Accordion: only one node open per level. Collapse this node's siblings
    // (the parent's other children) before opening it, so the tree stays a
    // single drill-down path instead of a sprawl.
    const parent = this.#findParentNode(node)
    if (parent) for (const sib of parent.children) { if (sib.id !== node.id) sib.expanded = false }

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
    // Read the node's current state from the SAME map the tree displays
    // (adopted-aware defaults). Reading a different default here (the bare
    // kind default) made the first click a visual no-op — it "flipped" from a
    // state the user never saw — so every toggle took two clicks.
    const before = this.toggleMap()
    const currentlyEnabled = before.get(node.id) ?? defaultEnabled(node.kind)

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

    // Flip from the TRUE displayed state (toggle negates `stored ?? def`, so
    // passing the displayed value as def is an exact single-click flip
    // whether or not a stored value exists).
    this.#toggleState.toggle(node.id, currentlyEnabled)

    // ENABLE CASCADES DOWN: turning a node ON turns its whole subtree on —
    // descendants already default ON inside an adopted tree, so this only
    // has to revive ones the participant explicitly switched off. To be
    // selective you flip the parent on, then switch off what you don't want
    // (turning a node OFF does NOT force-disable descendants). The trust
    // gate already cleared above covers the subtree's source domain, so the
    // cascade doesn't re-prompt.
    const nowOn = !currentlyEnabled
    if (nowOn && node.children?.length) {
      const cascade = (nodes: TreeNode[]) => {
        for (const c of nodes) {
          const cur = before.get(c.id) ?? defaultEnabled(c.kind)
          if (!cur) this.#toggleState.toggle(c.id, cur)
          if (c.children?.length) cascade(c.children)
        }
      }
      cascade(node.children)
    }
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
        // Only a REAL cross-domain dependency counts — the dep's domain must
        // look like a domain (contain a dot, e.g. "diamondcoreprocessor.com").
        // A content tree's lineage segments are tile names ("coaching",
        // "intake") with no dot; without this guard every nested content tile
        // got filed as its own top-level domain, flooding the installer.
        if (/^[a-f0-9]{64}$/.test(sig) && depDomain && depDomain.includes('.') && depDomain !== owner && !seen.has(`${depDomain}:${sig}`)) {
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

  /** The node whose children include `target` (its parent), searched across
   *  all sections. Null for a top-level node. Used by the accordion to find
   *  a node's siblings. */
  #findParentNode(target: TreeNode): TreeNode | null {
    const search = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if ((n.children ?? []).some(c => c.id === target.id)) return n
        const found = search(n.children ?? [])
        if (found) return found
      }
      return null
    }
    for (const s of this.sections()) { const r = search(s.items); if (r) return r }
    return null
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
